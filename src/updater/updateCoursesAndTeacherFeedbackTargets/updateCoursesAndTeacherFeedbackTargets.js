const dateFns = require('date-fns')
const { parseFromTimeZone } = require('date-fns-timezone')
const { Op } = require('sequelize')
const _ = require('lodash')

const {
  CourseUnit,
  CourseUnitsOrganisation,
  CourseRealisation,
  FeedbackTarget,
  Group,
  FeedbackTargetLog,
  UserFeedbackTarget,
  Survey,
  CourseRealisationsOrganisation,
  InactiveCourseRealisation,
  CourseRealisationsTag,
} = require('../../models')

const logger = require('../../util/logger')
const mangleData = require('../mangleData')
const { sequelize } = require('../../db/dbConnection')
const { safeBulkCreate } = require('../util')
const { createCourseRealisations, createInactiveCourseRealisations } = require('./createCourseRealisations')
const { formatWithHours, getFeedbackCount } = require('./utils')
const { createStudyGroups } = require('./createStudyGroups')

const validRealisationTypes = [
  'urn:code:course-unit-realisation-type:teaching-participation-lab',
  'urn:code:course-unit-realisation-type:teaching-participation-online',
  'urn:code:course-unit-realisation-type:teaching-participation-field-course',
  'urn:code:course-unit-realisation-type:teaching-participation-project',
  'urn:code:course-unit-realisation-type:teaching-participation-lectures',
  'urn:code:course-unit-realisation-type:teaching-participation-small-group',
  'urn:code:course-unit-realisation-type:teaching-participation-seminar',
  'urn:code:course-unit-realisation-type:teaching-participation-blended',
  'urn:code:course-unit-realisation-type:teaching-participation-contact',
  'urn:code:course-unit-realisation-type:teaching-participation-distance',
]

const inactiveRealisationTypes = [
  'urn:code:course-unit-realisation-type:independent-work-project',
  'urn:code:course-unit-realisation-type:independent-work-essay',
  'urn:code:course-unit-realisation-type:training-training',
]

const administrativePersonUrns = [
  'urn:code:course-unit-realisation-responsibility-info-type:administrative-person',
  'urn:code:module-responsibility-info-type:administrative-person',
]

const responsibleTeacherUrns = [
  'urn:code:course-unit-realisation-responsibility-info-type:responsible-teacher',
  'urn:code:course-unit-realisation-responsibility-info-type:contact-info',
  'urn:code:module-responsibility-info-type:responsible-teacher',
  'urn:code:module-responsibility-info-type:contact-info',
  ...administrativePersonUrns,
]

const commonFeedbackName = {
  fi: 'Yleinen palaute kurssista',
  en: 'General feedback about the course',
  sv: 'Allmän respons om kursen',
}

const findMatchingCourseUnit = async (course) => {
  try {
    const nonOpenCourse = await CourseUnit.findOne({
      where: {
        courseCode: course.code.substring(2),
      },
    })
    if (nonOpenCourse) return nonOpenCourse
    const regex = course.code.match('[0-9.]+')
    if (!regex) {
      logger.info('CODE WITH NO MATCH', { code: course.code })
      return null
    }
    const charCode = course.code.substring(2, regex.index)
    const sameOrg = await CourseUnit.findOne({
      where: {
        courseCode: {
          [Op.iLike]: `${charCode}%`,
        },
      },
    })
    return sameOrg
  } catch (_) {
    logger.info('ERR', course)
    return null
  }
}

const createCourseUnits = async (courseUnits) => {
  const ids = new Set()
  const filteredCourseUnits = courseUnits
    .filter((cu) => {
      if (ids.has(cu.id)) return false
      ids.add(cu.id)
      return true
    })
    .map(({ id, groupId, name, code, validityPeriod }) => ({
      id,
      groupId,
      name,
      courseCode: code,
      validityPeriod,
    }))

  await safeBulkCreate({
    entityName: 'CourseUnit',
    entities: filteredCourseUnits,
    bulkCreate: async (e, opt) => CourseUnit.bulkCreate(e, opt),
    fallbackCreate: async (e, opt) => CourseUnit.upsert(e, opt),
    options: {
      updateOnDuplicate: ['name', 'groupId', 'courseCode', 'validityPeriod'],
    },
  })

  const courseUnitsOrganisations = courseUnits
    .filter(({ code }) => !code.startsWith('AY'))
    .flatMap(({ id: courseUnitId, organisations }) =>
      organisations
        .filter(({ share, organisationId }) => share !== 0 && organisationId)
        .sort((a, b) => b.share - a.share)
        .map(({ organisationId }, index) => ({
          type: index === 0 ? 'PRIMARY' : 'DIRECT',
          courseUnitId,
          organisationId,
        })),
    )

  await safeBulkCreate({
    entityName: 'CourseUnitsOrganisation',
    entities: courseUnitsOrganisations,
    bulkCreate: async (entities, opt) =>
      CourseUnitsOrganisation.bulkCreate(entities, opt),
    fallbackCreate: async (entity, opt) =>
      CourseUnitsOrganisation.upsert(entity, opt),
    options: { ignoreDuplicates: true },
  })

  const openUniCourses = courseUnits.filter(({ code }) => code.startsWith('AY'))
  const openCourseUnitsOrganisations = []
  await openUniCourses.reduce(async (p, course) => {
    await p
    // try to find organisation for open uni course.
    // 1st option find by course code without AY part.
    // 2nd option find by course code without text part.
    // 3rd option if not found then course is probably open uni course.
    const nonOpenCourse = await findMatchingCourseUnit(course)
    if (nonOpenCourse) {
      const orgId = await CourseUnitsOrganisation.findOne({
        where: {
          courseUnitId: nonOpenCourse.id,
          type: 'PRIMARY',
        },
      })
      if (!orgId) {
        logger.info('OLD COURSE UNIT', { oldCourseUnit: nonOpenCourse })
        openCourseUnitsOrganisations.push({
          type: 'PRIMARY',
          courseUnitId: course.id,
          organisationId: course.organisations[0].organisationId,
        })
      } else {
        openCourseUnitsOrganisations.push({
          type: 'PRIMARY',
          courseUnitId: course.id,
          organisationId: orgId.organisationId,
        })
      }
    } else {
      // Acual open course?
      openCourseUnitsOrganisations.push({
        type: 'PRIMARY',
        courseUnitId: course.id,
        organisationId: course.organisations[0].organisationId,
      })
    }
  }, Promise.resolve())

  await safeBulkCreate({
    entityName: 'CourseUnitOrganisation',
    entities: openCourseUnitsOrganisations,
    bulkCreate: async (entities, opt) =>
      CourseUnitsOrganisation.bulkCreate(entities, opt),
    fallbackCreate: async (entity, opt) =>
      CourseUnitsOrganisation.upsert(entity, opt),
    options: { ignoreDuplicates: true },
  })
}

const getIncludeCurs = async () => {
  const includeCurs = await InactiveCourseRealisation.findAll({
    where: {
      manuallyEnabled: true,
    },
    attributes: ['id'],
  })

  return includeCurs.map(({ id }) => id)
}

const sortAccessStatus = (a, b) => {
  // Prevent more important access status from being overwritten
  // Sort teacherFeedbackTargets in the following order:
  // responsible teacher > administrative person > teacher
  const a1 = a.accessStatus === 'RESPONSIBLE_TEACHER'
  const a2 = !a.isAdministrativePerson
  const b1 = b.accessStatus === 'RESPONSIBLE_TEACHER'
  const b2 = !b.isAdministrativePerson

  if (a1 && !b1) return -1
  if (!a1 && b1) return 1
  if (a1 && b1) {
    if (a2 && !b2) return -1
    if (!a2 && b2) return 1
  }

  return 0
}

// Find the newest course unit that has started before the course realisation
const getCourseUnit = ({ activityPeriod, courseUnits }) => {
  let courseUnit = courseUnits[0] // old default

  const { startDate: realisationStartDate } = activityPeriod

  courseUnits.sort((a, b) => {
    const { startDate: aStartDate } = a.validityPeriod
    const { startDate: bStartDate } = b.validityPeriod

    if (!aStartDate || !bStartDate) return 0

    return dateFns.isAfter(new Date(aStartDate), new Date(bStartDate)) ? -1 : 1
  })

  courseUnit = courseUnits.find(({ validityPeriod }) => {
    const { startDate } = validityPeriod

    if (!startDate) return false

    return dateFns.isAfter(new Date(realisationStartDate), new Date(startDate))
  }) ?? courseUnit

  return courseUnit
}

const getAccessStatus = (roleUrn, courseRealisation) => {
  const { startDate } = courseRealisation.activityPeriod

  // All teachers have responsible teacher access before 2023
  if (startDate < '2023-01-01') return 'RESPONSIBLE_TEACHER'

  return responsibleTeacherUrns.includes(roleUrn) ? 'RESPONSIBLE_TEACHER' : 'TEACHER'
}

const getResponsibilityInfos = (_courseUnit, courseRealisation) => {
  const combinedResponsibilityInfos = courseRealisation.responsibilityInfos //.concat(courseUnit.responsibilityInfos)

  const uniqueResponsibilityInfos = _.uniqBy(combinedResponsibilityInfos, ({ personId, roleUrn }) => `${personId}${roleUrn}`)

  return uniqueResponsibilityInfos
}

const createFeedbackTargets = async (courses) => {
  const courseIdToPersonIds = {}

  const feedbackTargetPayloads = courses.map((course) => {
    const courseUnit = getCourseUnit(course)

    const responsibilityInfos = getResponsibilityInfos(courseUnit, course)

    courseIdToPersonIds[course.id] = responsibilityInfos
      .filter(({ personId }) => personId)
      .map(({ personId, roleUrn }) => ({ personId, roleUrn }))

    const courseEndDate = dateFns.endOfDay(
      new Date(course.activityPeriod.endDate),
    )

    const opensAtWithoutTimeZone = formatWithHours(dateFns.startOfDay(courseEndDate))

    const opensAt = parseFromTimeZone(opensAtWithoutTimeZone, {
      timeZone: 'Europe/Helsinki',
    })

    const closesAtWithoutTimeZone = formatWithHours(
      dateFns.endOfDay(dateFns.addDays(courseEndDate, 14)),
    )

    const closesAt = parseFromTimeZone(closesAtWithoutTimeZone, {
      timeZone: 'Europe/Helsinki',
    })

    return {
      feedbackType: 'courseRealisation',
      typeId: course.id,
      courseUnitId: courseUnit.id,
      courseRealisationId: course.id,
      name: commonFeedbackName,
      hidden: false,
      opensAt,
      closesAt,
    }
  })

  const existingCourseUnits = await CourseUnit.findAll({
    where: {
      id: {
        [Op.in]: _.uniq(
          feedbackTargetPayloads.map(({ courseUnitId }) => courseUnitId),
        ),
      },
    },
    attributes: ['id'],
  })

  const existingCourseUnitIds = existingCourseUnits.map(({ id }) => id)

  const feedbackTargets = feedbackTargetPayloads.filter(({ courseUnitId }) =>
    existingCourseUnitIds.includes(courseUnitId),
  )

  const feedbackTargetsWithEditedDatesIds = await FeedbackTarget.findAll({
    where: {
      feedbackDatesEditedByTeacher: true,
    },
    attributes: ['typeId'],
  })

  const feedbackTargetsWithEditedDatesTypeIds =
    feedbackTargetsWithEditedDatesIds.map((fbt) => fbt.typeId)

  const [feedbackTargetsWithEditedDates, feedbackTargetsWithoutEditedDates] =
    _.partition(feedbackTargets, (fbt) =>
      feedbackTargetsWithEditedDatesTypeIds.includes(fbt.typeId),
    )

  const feedbackTargetsWithEditedWithIds = await safeBulkCreate({
    entityName: 'FeedbackTarget',
    entities: feedbackTargetsWithEditedDates,
    bulkCreate: async (e, opts) => FeedbackTarget.bulkCreate(e, opts),
    fallbackCreate: async (e, opts) => FeedbackTarget.upsert(e, opts),
    options: {
      updateOnDuplicate: ['name', 'feedbackType', 'typeId', 'courseUnitId'],
      returning: ['id'],
    },
  })

  const feedbackTargetsWithoutEditedWithIds = await safeBulkCreate({
    entityName: 'FeedbackTarget',
    entities: feedbackTargetsWithoutEditedDates,
    bulkCreate: async (e, opts) => FeedbackTarget.bulkCreate(e, opts),
    fallbackCreate: async (e, opts) => FeedbackTarget.create(e, opts),
    options: {
      updateOnDuplicate: ['name', 'feedbackType', 'typeId', 'courseUnitId', 'opensAt', 'closesAt'],
      returning: ['id'],
    },
  })

  const feedbackTargetsWithIds = feedbackTargetsWithEditedWithIds.concat(
    feedbackTargetsWithoutEditedWithIds,
  )

  const teacherGroups = await createStudyGroups(feedbackTargetsWithIds, courses)

  const userFeedbackTargets = []
    .concat(
      ...feedbackTargetsWithIds.map(
        ({ id: feedbackTargetId, courseRealisationId }) =>
          courseIdToPersonIds[courseRealisationId].map(
            ({ personId, roleUrn }) => ({
              feedbackTargetId,
              userId: personId,
              groupIds: teacherGroups[personId], // Its allowed to be null
              accessStatus: getAccessStatus(roleUrn, courses.find(({ id }) => id === courseRealisationId)),
              isAdministrativePerson: administrativePersonUrns.includes(roleUrn),
            }),
          ),
      ),
    )
    .filter((target) => target.userId && target.feedbackTargetId)
    .sort(sortAccessStatus)
  
  const uniqueUfbts = _.uniqBy(userFeedbackTargets, ufbt => `${ufbt.userId}${ufbt.feedbackTargetId}`)
 
  await safeBulkCreate({
    entityName: 'UserFeedbackTarget',
    entities: uniqueUfbts,
    bulkCreate: async (e, opts) => UserFeedbackTarget.bulkCreate(e, opts),
    fallbackCreate: async (e, opts) => UserFeedbackTarget.upsert(e, opts),
    options: { updateOnDuplicate: ["groupIds", "accessStatus", "isAdministrativePerson"] },
  })
}

const deleteCancelledCourses = async (cancelledCourseIds) => {
  const rows = await sequelize.query(
    `
    SELECT count(user_feedback_targets.feedback_id) as feedback_count, feedback_targets.course_realisation_id
    FROM user_feedback_targets
    INNER JOIN feedback_targets ON user_feedback_targets.feedback_target_id = feedback_targets.id
    WHERE feedback_targets.course_realisation_id IN (:cancelledCourseIds)
    GROUP BY feedback_targets.course_realisation_id
    HAVING count(user_feedback_targets.feedback_id) = 0
  `,
    {
      replacements: {
        cancelledCourseIds,
      },
      type: sequelize.QueryTypes.SELECT,
    },
  )

  const courseRealisationIds = rows.map((row) => row.course_realisation_id)

  if (courseRealisationIds.length === 0) {
    return
  }

  const feedbackTargets = await FeedbackTarget.unscoped().findAll({
    where: {
      courseRealisationId: {
        [Op.in]: courseRealisationIds,
      },
    },
    attributes: ['id'],
  })

  const feedbackTargetIds = feedbackTargets.map((target) => target.id)

  const destroyedUserFeedbackTargets = await UserFeedbackTarget.destroy({
    where: {
      feedbackTargetId: {
        [Op.in]: feedbackTargetIds,
      },
    },
  })

  logger.info(`Destroyed ${destroyedUserFeedbackTargets} user feedback targets`)

  const destroyedSurveys = await Survey.destroy({
    where: {
      feedbackTargetId: {
        [Op.in]: feedbackTargetIds,
      },
    },
  })

  logger.info(`Destroyed ${destroyedSurveys} surveys`)

  const destroyedFeedbackTargetLogs = await FeedbackTargetLog.destroy({
    where: {
      feedbackTargetId: {
        [Op.in]: feedbackTargetIds,
      },
    },
  })

  logger.info(`Destroyed ${destroyedFeedbackTargetLogs} logs`)

  const destroyedGroups = await Group.destroy({
    where: {
      feedbackTargetId: {
        [Op.in]: feedbackTargetIds,
      }
    }
  })

  logger.info(`Destroyed ${destroyedGroups} groups`)

  const destroyedFeedbackTargets = await FeedbackTarget.unscoped().destroy({
    where: {
      id: {
        [Op.in]: feedbackTargetIds,
      },
    },
  })

  logger.info(`Destroyed ${destroyedFeedbackTargets} feedback targets`)

  const destroyedCourseRealisationOrganisations =
    await CourseRealisationsOrganisation.destroy({
      where: {
        courseRealisationId: {
          [Op.in]: courseRealisationIds,
        },
      },
    })

  logger.info(
    `Destroyed ${destroyedCourseRealisationOrganisations} course realisation organisations`,
  )

  const destroyedCourseRealisationsTags = await CourseRealisationsTag.destroy({
    where: {
      courseRealisationId: {
        [Op.in]: courseRealisationIds,
      },
    },
  })

  logger.info(
    `Destroyed ${destroyedCourseRealisationsTags} course realisations tags`,
  )

  const destroyedCourseRealisations = await CourseRealisation.destroy({
    where: {
      id: {
        [Op.in]: courseRealisationIds,
      },
    },
  })

  logger.info(`Destroyed ${destroyedCourseRealisations} course realisations`)
}
 
const getArchivedCoursesToDelete = async (courses) => {
  const allArchivedCourses = courses.filter(
    (course) => course.flowState === 'ARCHIVED',
  )

  await Promise.all(
    allArchivedCourses.map(async (course) => {
      const feedbackCount = await getFeedbackCount(course.id)
      course.feedbackCount = feedbackCount
    }),
  )

  const archivedCoursesWithoutFeedback = allArchivedCourses.filter(
    (course) => course.feedbackCount === 0,
  )

  return archivedCoursesWithoutFeedback
}

const coursesHandler = async (courses) => {
  const includeCurs = await getIncludeCurs()

  const filteredCourses = courses.filter(
    (course) =>
      includeCurs.includes(course.id) ||
      (course.courseUnits.length &&
        validRealisationTypes.includes(course.courseUnitRealisationTypeUrn) &&
        course.flowState !== 'CANCELLED' && course.flowState !== 'ARCHIVED'),
  )

  const cancelledCourses = courses.filter(
    (course) => course.flowState === 'CANCELLED',
  )

  const cancelledCourseIds = cancelledCourses.map((course) => course.id)

  const archivedCourses = await getArchivedCoursesToDelete(courses)
  const archivedCourseIds = archivedCourses.map((course) => course.id)

  await createCourseRealisations(filteredCourses)

  await createFeedbackTargets(filteredCourses)

  if (cancelledCourseIds.length > 0) await deleteCancelledCourses(cancelledCourseIds)
  if (archivedCourseIds.length > 0) await deleteCancelledCourses(archivedCourseIds)

  const inactiveCourseRealisations = courses.filter(
    (course) =>
      course.courseUnits.length &&
      inactiveRealisationTypes.includes(course.courseUnitRealisationTypeUrn) &&
      course.flowState !== 'CANCELLED',
  )

  await createInactiveCourseRealisations(inactiveCourseRealisations)
}

const courseUnitHandler = async (courseRealisations) => {
  await createCourseUnits(
    []
      .concat(...courseRealisations.map((course) => course.courseUnits))
      .filter(({ code }) => !code.startsWith('AY') && !code.match('^[0-9]+$')),
  )
}

const openCourseUnitHandler = async (courseRealisations) => {
  await createCourseUnits(
    []
      .concat(...courseRealisations.map((course) => course.courseUnits))
      .filter(({ code }) => code.startsWith('AY') && !code.match('^AY[0-9]+$')),
  )
}

// default 1000, set to 10 for example when debugging
const SPEED = 1000

const updateCoursesAndTeacherFeedbackTargets = async () => {
  // This will become absolute mayhem because of open uni.
  // What we have to do
  // All non-open courses have to mangled first, because some open course could
  // have the non-open version after the current batch.
  // 1. Go through all non-open course_units
  // 2. Go through all open course_units
  // 3. Go through all course_units and only then create realisations.
  // For each batch we ignore courses where code matches "[0-9]+" or "AY[0-9]+".

  // HOW ITS DONE HERE SUCKS LOL. Everything is fetched 3 times, literally torturing importer. FIX PLS

  await mangleData(
    'course_unit_realisations_with_course_units',
    SPEED,
    courseUnitHandler,
  )
  await mangleData(
    'course_unit_realisations_with_course_units',
    SPEED,
    openCourseUnitHandler,
  )

  // Delete all teacher rights once a week (saturday-sunday night)
  if (new Date().getDay() === 0) {
    logger.info('[UPDATER] Deleting teacher rights', {})
    await sequelize.query(
      `DELETE FROM user_feedback_targets WHERE feedback_id IS NULL AND is_teacher(access_status) AND user_created = false AND user_id != 'abc1234'`,
    )
  }

  await mangleData(
    'course_unit_realisations_with_course_units',
    SPEED,
    coursesHandler,
  )
}

module.exports = {
  updateCoursesAndTeacherFeedbackTargets,
  deleteCancelledCourses,
}
