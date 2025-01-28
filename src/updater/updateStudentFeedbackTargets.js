const _ = require('lodash')
const { Op } = require('sequelize')
const { subHours } = require('date-fns')

const { safeBulkCreate } = require('./util')
const { FeedbackTarget, UserFeedbackTarget } = require('../models')
const logger = require('../util/logger')
const mangleData = require('./mangleData')
const { fetchData } = require('./importerClient')

const getEnrolmentFeedbackTargets = async (enrolments) => {
  const courseUnitRealisationIds = enrolments.map(({ courseUnitRealisationId }) => courseUnitRealisationId)

  const feedbackTargets = await FeedbackTarget.findAll({
    where: {
      courseRealisationId: {
        [Op.in]: courseUnitRealisationIds
      },
    },
    attributes: ['id', 'courseRealisationId'],
  })

  return feedbackTargets
}

const createEnrolmentTargets = async (enrolments) => {
  const feedbackTargets = await getEnrolmentFeedbackTargets(enrolments)

  const enrolmentsByCourseUnitRealisationId = _.groupBy(enrolments, 'courseUnitRealisationId')

  const userFeedbackTargets = feedbackTargets.flatMap((feedbackTarget) => enrolmentsByCourseUnitRealisationId[feedbackTarget.courseRealisationId].map((enrolment) => ({
      accessStatus: 'STUDENT',
      userId: enrolment.personId,
      feedbackTargetId: feedbackTarget.id,
      groupIds: enrolment.confirmedStudySubGroupIds.length > 0 ? enrolment.confirmedStudySubGroupIds : null, // sequelize doesnt like empty arrays for some reason
    }))
  )

  const filteredUserFeedbackTargets = userFeedbackTargets.filter((target) => target.userId && target.feedbackTargetId)

  return filteredUserFeedbackTargets
}

const deleteInactiveEnrolments = async (enrolments) => {
  const feedbackTargets = await getEnrolmentFeedbackTargets(enrolments)
  logger.info(`Trying to delete ${enrolments.length} inactive enrolments for ${feedbackTargets.length} feedback targets`)

  const enrolmentsByCourseUnitRealisationId = _.groupBy(enrolments, 'courseUnitRealisationId')

  const userFeedbackTargetsToDelete = feedbackTargets.flatMap((feedbackTarget) => enrolmentsByCourseUnitRealisationId[feedbackTarget.courseRealisationId].map((enrolment) => ({
      userId: enrolment.personId,
      feedbackTargetId: feedbackTarget.id,
    }))
  )

  userFeedbackTargetsToDelete.forEach(async (ufbt) => {
    const deleted = await UserFeedbackTarget.destroy({
      where: {
        userId: ufbt.userId,
        feedbackTargetId: ufbt.feedbackTargetId,
        accessStatus: 'STUDENT',
        userCreated: false,
        feedbackOpenEmailSent: false,
        feedbackId: null,
      },
    })

    if (deleted) logger.debug('Deleted student feedback target', { userId: ufbt.userId, feedbackTargetId: ufbt.feedbackTargetId })
  })
}

const createEnrolmentFallback = async (ufbt) => {
  const { userId, feedbackTargetId, accessStatus, groupIds } = ufbt

  try {
    await UserFeedbackTarget.findOrCreate({
      where: {
        userId,
        feedbackTargetId,
      },
      defaults: {
        userId,
        feedbackTargetId,
        accessStatus,
        groupIds,
      },
    })
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      logger.info('[UPDATER] got enrolment of unknown user', { userId, feedbackTargetId })
    } else {
      logger.error(`[UPDATER] error: ${err.message}`)
    }
  }
}

const enrolmentsHandler = async (enrolments) => {
  const userFeedbackTargets = await createEnrolmentTargets(enrolments)

  const newUfbts = await safeBulkCreate({
    entityName: 'UserFeedbackTarget',
    entities: userFeedbackTargets,
    bulkCreate: async (e, opt) => UserFeedbackTarget.bulkCreate(e, opt),
    fallbackCreate: async (e) => createEnrolmentFallback(e),
    options: { updateOnDuplicate: ['groupIds'] },
  })

  return newUfbts.length
}

const deletedEnrolmentsHandler = async (enrolments) => {
  await deleteInactiveEnrolments(enrolments)

  return enrolments.length
}

/**
 * Deletes and creates UFBTs from deleted-enrolments and enrolments
 * 
 * It is important to first delete the deleted UFBTs and then create the existing ones, 
 * because the same UFBT can be in both lists.
 * 
 * Deleted enrolments can contain documents that are not actually deleted, 
 * but are in document_state DELETED and status NOT_ENROLLED (meaning the enrolment state NOT_ENROLLED is not valid anymore).
 * 
 * Then if the enrolment has also a document in document_state ACTIVE and status ENROLLED,
 * it will be created in the second step and everything is fine.
 */
const updateStudentFeedbackTargets = async () => {
  // Date from onwards the fbts are to be updated
  const getDataSince = new Date()
  getDataSince.setFullYear(getDataSince.getFullYear() - 2)

  // This order is important
  await mangleData('deleted-enrolments', 1_000, deletedEnrolmentsHandler, getDataSince)
  await mangleData('enrolments', 1_000, enrolmentsHandler, getDataSince)
}

const updateEnrolmentsOfCourse = async (courseRealisationId) => {
  const start = Date.now()
  try {
    const { data: enrolments } = await fetchData(
      `enrolments/${courseRealisationId}`,
    )
    await enrolmentsHandler(enrolments)
    const end = Date.now()
    logger.info(
      `[UPDATER] updated enrolments of ${courseRealisationId} (${
        enrolments.length
      }) - ${(end - start).toFixed(0)} ms`,
    )
    return 1
  } catch (error) {
    logger.error(`[UPDATER] error ${error}`)
    const end = Date.now()
    logger.info(
      `[UPDATER] failed to update enrolments of ${courseRealisationId} - ${(
        end - start
      ).toFixed(0)} ms`,
    )
    return 0
  }
}

const updateNewEnrolments = async () => {
  const start = new Date()
  const twoHoursAgo = subHours(start, 2)
  try {
    const enrolments = await fetchData(`enrolments-new`, {
      since: twoHoursAgo,
    }, (data) => Array.isArray(data))

    const count = await enrolmentsHandler(enrolments)

    const end = Date.now()
    logger.info(
      `[UPDATER] updated new enrolments (${
        enrolments.length
      } enrolments, ${count} new user feedback targets) - ${(
        end - start
      ).toFixed(0)} ms`,
    )
    return 1
  } catch (error) {
    logger.error(`[UPDATER] error ${error}`)
    const end = Date.now()
    logger.info(
      `[UPDATER] failed to update new enrolments - ${(end - start).toFixed(
        0,
      )} ms`,
    )
    throw error
  }
}

module.exports = {
  updateStudentFeedbackTargets,
  updateEnrolmentsOfCourse,
  updateNewEnrolments,
}
