const dateFns = require('date-fns')
const { stringSimilarity } = require("string-similarity-js")
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
const { updateTeacherFeedbackTargets } = require('./updateTeacherFeedbackTargets')

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

const commonFeedbackName = {
  fi: 'Yleinen palaute kurssista',
  en: 'General feedback about the course',
  sv: 'Allmän respons om kursen',
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

// Find the newest course unit that has started before the course realisation
const getCourseUnit = ({ activityPeriod, courseUnits, name }) => {
  const { startDate: realisationStartDate } = activityPeriod

  const scientificallyAccurateCUs = courseUnits.map((courseUnit) => {
    const getSimilarityRanking = (language) => stringSimilarity(name[language] ?? '', courseUnit.name[language] ?? '')
    
    const fiSimilarity = getSimilarityRanking('fi') 
    const enSimilarity = getSimilarityRanking('en')
    const svSimilarity = getSimilarityRanking('sv') 

    const similarityRanking = Math.max(fiSimilarity, enSimilarity, svSimilarity)

    return ({ ...courseUnit, similarityRanking })
  })

  const sortedCourseUnits = _.orderBy(scientificallyAccurateCUs, ['similarityRanking', (cu) => {
    const { startDate } = cu.validityPeriod.startDate

    return Date.parse(startDate)
  }], ['desc', 'desc'])


  const courseUnit = sortedCourseUnits.find(({ validityPeriod }) => {
    const { startDate } = validityPeriod

    if (!startDate) return false

    return dateFns.isAfter(new Date(realisationStartDate), new Date(startDate))
  }) ?? sortedCourseUnits[0]

  return courseUnit
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

  await updateTeacherFeedbackTargets(feedbackTargetsWithIds, teacherGroups, courseIdToPersonIds, courses)
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

  logger.info(`Starting to delete fbts with the following cur ids: ${courseRealisationIds}`)

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
  // Filter out old AY courses. Already existing ones remain in db.
  const courseUnits = [].concat(...courses.map((course) => course.courseUnits)).filter(({ code }) => code.startsWith('AY') && !code.match('^AY[0-9]+$'))
  await createCourseUnits(courseUnits)

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

// default 1000, set to 10 for example when debugging
const SPEED = 1000

const updateCoursesAndTeacherFeedbackTargets = async () => {
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
