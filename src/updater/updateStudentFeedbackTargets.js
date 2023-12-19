const _ = require('lodash')
const { Op } = require('sequelize')
const { subHours } = require('date-fns')

const { sequelize } = require('../db/dbConnection')
const { FeedbackTarget, UserFeedbackTarget } = require('../models')
const logger = require('../util/logger')
const mangleData = require('./mangleData')
const { fetchData } = require('./importerClient')
// const { notifyOnEnrolmentsIfRequested } = require('../services/enrolmentNotices/enrolmentNotices')

const createEnrolmentTargets = async (enrolments) => {
  const courseUnitRealisationIds = enrolments.map(({ courseUnitRealisationId }) => courseUnitRealisationId)

  const feedbackTargets = await FeedbackTarget.findAll({
    where: {
      feedbackType: 'courseRealisation',
      typeId: {
        [Op.in]: courseUnitRealisationIds
      },
    },
  })

  const enrolmentsByCourseUnitRealisationId = _.groupBy(enrolments, 'courseUnitRealisationId')

  const userFeedbackTargets = feedbackTargets.flatMap((feedbackTarget) => enrolmentsByCourseUnitRealisationId[feedbackTarget.typeId].map((enrolment) => ({
      accessStatus: 'STUDENT',
      userId: enrolment.personId,
      feedbackTargetId: feedbackTarget.id,
      groupIds: enrolment.confirmedStudySubGroupIds.length > 0 ? enrolment.confirmedStudySubGroupIds : null // sequelize doesnt like empty arrays for some reason
    }))
  )

  return userFeedbackTargets
}

const bulkCreateUserFeedbackTargets = async (userFeedbackTargets) => {
  const normalizedUserFeedbackTargets = userFeedbackTargets
    .map(({ userId, feedbackTargetId, accessStatus, groupIds }) => ({
      userId,
      feedbackTargetId,
      accessStatus,
      groupIds,
    }))
    .filter((target) => target.userId && target.feedbackTargetId)

  const ufbts = await UserFeedbackTarget.bulkCreate(
    normalizedUserFeedbackTargets,
    {
      updateOnDuplicate: ['groupIds']
    },
  )
  return ufbts.length
}

const enrolmentsHandler = async (enrolments) => {
  const userFeedbackTargets = await createEnrolmentTargets(enrolments)

  let count = 0
  try {
    count += await bulkCreateUserFeedbackTargets(userFeedbackTargets)
  } catch (err) {
    logger.info(
      `[UPDATER] RUNNING ${userFeedbackTargets.length} TARGETS ONE BY ONE`,
    )
    for (const ufbt of userFeedbackTargets) {
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
        count += 1
      } catch (err) {
        if (err.name === 'SequelizeForeignKeyConstraintError') {
          logger.info('[UPDATER] got enrolment of unknown user')
        } else {
          logger.error(`[UPDATER] error: ${err.message}`)
        }
      }
    }
  }
  return count
}

const updateStudentFeedbackTargets = async () => {
  // Date from onwards the fbts are to be updated
  const getDataSince = new Date()
  getDataSince.setFullYear(getDataSince.getFullYear() - 2)

  // Delete all old enrolments once a week sunday-monday night.
  // Delete only enrollments, not teacher relations
  if (new Date().getDay() === 1) {
    logger.info('[UPDATER] Deleting old enrolments', {})
    const [, {rowCount}] = await sequelize.query(
      `DELETE
        FROM user_feedback_targets ufbt
        USING feedback_targets fbt
      WHERE ufbt.feedback_target_id = fbt.id
        AND feedback_id IS NULL
        AND access_status = 'STUDENT'
        AND feedback_open_email_sent = false
        AND fbt.user_created = false
        AND fbt.closes_at >= '${getDataSince.toISOString()}'::date
      `,
    )

    logger.info(`DELETED ${rowCount} student feedback targets`)
  }

  await mangleData('enrolments', 10_000, enrolmentsHandler, getDataSince)
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

const saveNewEnrolments = async (enrolments) => {
  const userFeedbackTargets = []
  const newUfbts = []

  for (const enrolment of enrolments) {
    userFeedbackTargets.push(...(await createEnrolmentTargets(enrolment)))
  }

  for (const ufbt of userFeedbackTargets) {
    const { userId, feedbackTargetId, accessStatus } = ufbt
    try {
      const [it, created] = await UserFeedbackTarget.findOrCreate({
        where: {
          userId,
          feedbackTargetId,
        },
        defaults: {
          user_id: userId,
          feedback_target_id: feedbackTargetId,
          accessStatus,
        },
      })

      if (created) newUfbts.push(it)
    } catch (err) {
      if (err.name === 'SequelizeForeignKeyConstraintError') {
        logger.info(`[UPDATER] got enrolment of unknown user ${userId}`)
      } else {
        logger.error(`[UPDATER] error: ${err.message}`)
      }
    }
  }

  // await notifyOnEnrolmentsIfRequested(newUfbts)

  return newUfbts.length
}

const updateNewEnrolments = async () => {
  const start = new Date()
  const twoHoursAgo = subHours(start, 2)
  try {
    const enrolments = await fetchData(`enrolments-new`, {
      since: twoHoursAgo,
    }, (data) => Array.isArray(data))

    const count = await saveNewEnrolments(enrolments)
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
