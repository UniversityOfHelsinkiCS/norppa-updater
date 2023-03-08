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
const { formatDate, formatWithHours } = require('./utils')

const validRealisationTypes = [
  'urn:code:course-unit-realisation-type:teaching-participation-lab',
  'urn:code:course-unit-realisation-type:teaching-participation-online',
  'urn:code:course-unit-realisation-type:teaching-participation-field-course',
  'urn:code:course-unit-realisation-type:teaching-participation-project',
  'urn:code:course-unit-realisation-type:teaching-participation-lectures',
  'urn:code:course-unit-realisation-type:teaching-participation-small-group',
  'urn:code:course-unit-realisation-type:teaching-participation-seminar',
]

const independentWorkUrn =
  'urn:code:course-unit-realisation-type:independent-work-project'

const administrativePersonUrn =
  'urn:code:course-unit-realisation-responsibility-info-type:administrative-person'

const responsibleTeacherUrns = [
  'urn:code:course-unit-realisation-responsibility-info-type:responsible-teacher',
  'urn:code:course-unit-realisation-responsibility-info-type:contact-info',
  administrativePersonUrn,
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
    .map(({ id, name, code, validityPeriod }) => ({
      id,
      name,
      courseCode: code,
      validityPeriod,
    }))

  await safeBulkCreate({
    entityName: 'CourseUnit',
    entities: filteredCourseUnits,
    bulkCreate: async (e, opt) => CourseUnit.bulkCreate(e, opt),
    fallbackCreate: async (e, opt) => CourseUnit.create(e, opt),
    options: {
      updateOnDuplicate: ['name', 'courseCode', 'validityPeriod'],
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
      CourseUnitsOrganisation.create(entity, opt),
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
      CourseUnitsOrganisation.create(entity, opt),
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

const createStudyGroups = async (feedbackTargets, courses) => {
  const groups = []

  feedbackTargets.forEach((fbt) => {
    const courseRealisationData = courses.find(c => c.id === fbt.dataValues.typeId)
    if (!courseRealisationData) return
    const { studyGroupSets } = courseRealisationData

    for (const { studySubGroups } of studyGroupSets) {

      // Create groups only when more than 1 sub group.
      if (!studySubGroups?.length > 1) return
      
      groups.push(...studySubGroups.map(ssg => ({
        id: ssg.id,
        feedbackTargetId: fbt.id,
        name: ssg.name,
      })))
    }
  })

  await safeBulkCreate({
    entityName: "Group",
    entities: groups,
    bulkCreate: async (e, opts) => Group.bulkCreate(e, opts),
    fallbackCreate: async (e, opts) => Group.create(e, opts),
    options: {
      updateOnDuplicate: ['name'],
    },
  })
}

const createFeedbackTargets = async (courses) => {
  const courseIdToPersonIds = {}

  const feedbackTargetPayloads = courses.map((course) => {
    courseIdToPersonIds[course.id] = course.responsibilityInfos
      .filter(({ personId }) => personId)
      .map(({ personId, roleUrn }) => ({ personId, roleUrn }))

    const courseUnit = course.courseUnits[0]
    const courseEndDate = dateFns.endOfDay(
      new Date(course.activityPeriod.endDate),
    )

    const opensAt = formatDate(courseEndDate)
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
    fallbackCreate: async (e, opts) => FeedbackTarget.create(e, opts),
    options: {
      updateOnDuplicate: ['feedbackType', 'typeId'],
      returning: ['id'],
    },
  })

  const feedbackTargetsWithoutEditedWithIds = await safeBulkCreate({
    entityName: 'FeedbackTarget',
    entities: feedbackTargetsWithoutEditedDates,
    bulkCreate: async (e, opts) => FeedbackTarget.bulkCreate(e, opts),
    fallbackCreate: async (e, opts) => FeedbackTarget.create(e, opts),
    options: {
      updateOnDuplicate: ['feedbackType', 'typeId', 'opensAt', 'closesAt'],
      returning: ['id'],
    },
  })

  const feedbackTargetsWithIds = feedbackTargetsWithEditedWithIds.concat(
    feedbackTargetsWithoutEditedWithIds,
  )

  await createStudyGroups(feedbackTargetsWithIds, courses)

  const userFeedbackTargets = []
    .concat(
      ...feedbackTargetsWithIds.map(
        ({ id: feedbackTargetId, courseRealisationId }) =>
          courseIdToPersonIds[courseRealisationId].map(
            ({ personId, roleUrn }) => ({
              feedbackTargetId,
              userId: personId,
              accessStatus: responsibleTeacherUrns.includes(roleUrn)
                ? 'RESPONSIBLE_TEACHER'
                : 'TEACHER',
              isAdministrativePerson: roleUrn === administrativePersonUrn,
            }),
          ),
      ),
    )
    .filter((target) => target.user_id && target.feedback_target_id)
    .sort(sortAccessStatus)

  await safeBulkCreate({
    entityName: 'UserFeedbackTarget',
    entities: userFeedbackTargets,
    bulkCreate: async (e, opts) => UserFeedbackTarget.bulkCreate(e, opts),
    fallbackCreate: async (e, opts) => UserFeedbackTarget.create(e, opts),
    options: { ignoreDuplicates: true },
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

  const destroyedFeedbackTargets = await FeedbackTarget.unscoped().destroy({
    where: {
      id: {
        [Op.in]: feedbackTargetIds,
      },
    },
  })

  logger.info(`Destroyed ${destroyedFeedbackTargets} feedback targets`)

  const destroyedGroups = await Group.destroy({
    where: {
      feedbackTargetId: {
        [Op.in]: feedbackTargetIds,
      }
    }
  })

  logger.info(`Destroyed ${destroyedGroups} groups`)

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

const coursesHandler = async (courses) => {
  const includeCurs = await getIncludeCurs()

  const filteredCourses = courses.filter(
    (course) =>
      includeCurs.includes(course.id) ||
      (course.courseUnits.length &&
        validRealisationTypes.includes(course.courseUnitRealisationTypeUrn) &&
        course.flowState !== 'CANCELLED'),
  )

  const cancelledCourses = courses.filter(
    (course) => course.flowState === 'CANCELLED',
  )

  const cancelledCourseIds = cancelledCourses.map((course) => course.id)

  await createCourseRealisations(filteredCourses)

  await createFeedbackTargets(filteredCourses)

  if (cancelledCourseIds.length > 0) {
    await deleteCancelledCourses(cancelledCourseIds)
  }

  const independentWorkCourses = courses.filter(
    (course) =>
      course.courseUnits.length &&
      course.courseUnitRealisationTypeUrn === independentWorkUrn &&
      course.flowState !== 'CANCELLED',
  )

  await createInactiveCourseRealisations(independentWorkCourses)
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
      `DELETE FROM user_feedback_targets WHERE feedback_id IS NULL AND is_teacher(access_status) AND user_id != 'abc1234'`,
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
