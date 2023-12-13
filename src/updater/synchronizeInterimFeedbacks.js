const { Op } = require('sequelize')
const _ = require('lodash')
const { isAfter, addDays } = require('date-fns')

const { FeedbackTarget, CourseRealisation, UserFeedbackTarget } = require('../models')
const logger = require('../util/logger')
const { logOperation } = require('./util')

const getUserFeedbackTargets = async (feedbackTargetId, accessStatus) => {
  const userFeedbackTargets = await UserFeedbackTarget.findAll({
    where: {
      feedbackTargetId,
      accessStatus,
    },
    attributes: ['id', 'userId'],
  })

  return userFeedbackTargets
}

const updateUserFeedbackTargets = async (feedbackTargetId, userFeedbackTargets, accessStatus) => {
  const userIds = userFeedbackTargets.map(({ userId }) => userId)

  await UserFeedbackTarget.destroy({
    where: {
      feedbackTargetId,
      userId: { [Op.notIn]: userIds },
      accessStatus,
    },
  })

  const existingUserIds = (await getUserFeedbackTargets(feedbackTargetId, accessStatus)).map(({ userId }) => userId)
  const newUserFeedbackTargets = userFeedbackTargets.filter(({ userId }) => !existingUserIds.includes(userId))

  await UserFeedbackTarget.bulkCreate(
    newUserFeedbackTargets.map(({ userId, isAdministrativePerson, groupIds }) => ({
      feedbackTargetId,
      userId,
      accessStatus,
      isAdministrativePerson,
      groupIds,
      userCreated: true,
    }))
  )
}

const synchronizeUserFeedbackTargets = async () => {
  logger.info('[UPDATER] starting to synchronize interim feedback userFeedbackTargets')

  const courseRealisationsWithInterimFeedbacks = await CourseRealisation.findAll({
    where: {
      userCreated: false,
    },
    include: [
      {
        model: FeedbackTarget,
        as: 'feedbackTargets',
        required: true,
        where: {
          userCreated: true,
        },
      },
    ],
  })

  const courseRealisationIds = courseRealisationsWithInterimFeedbacks.map((({ id }) => id))

  const originalFeedbackTargets = await FeedbackTarget.findAll({
    where: {
      userCreated: false,
      courseRealisationId: { [Op.in]: courseRealisationIds },
    },
    include:
      {
        model: UserFeedbackTarget,
        as: 'userFeedbackTargets',
        attributes: ['userId', 'accessStatus', 'isAdministrativePerson', 'groupIds'],
      },
  })

  for (const courseRealisation of courseRealisationsWithInterimFeedbacks) {
    const originalFeedbackTarget = originalFeedbackTargets.find(
      ({ courseRealisationId }) => courseRealisationId === courseRealisation.id
    )

    const userFeedbackTargetsByAccessStatus = _.groupBy(
      originalFeedbackTarget.userFeedbackTargets,
      ({ accessStatus }) => accessStatus
    )

    for (const accessStatus of Object.keys(userFeedbackTargetsByAccessStatus)) {
      const userFeedbackTargets = userFeedbackTargetsByAccessStatus[accessStatus]

      for (const interimFeedbackTarget of courseRealisation.feedbackTargets) {
        // Skip updating if interim feedback closed over a month ago
        if (isAfter(addDays(interimFeedbackTarget.closesAt, 30), new Date())) {
          await updateUserFeedbackTargets(interimFeedbackTarget.id, userFeedbackTargets, accessStatus)
        }
      }
    }
  }
}

const synchronizeInterimFeedbacks = async () => {
  await logOperation(
    synchronizeUserFeedbackTargets,
    '[UPDATER][interimFeedbacks] synchronized user feedback targets',
  )
}

module.exports = {
  synchronizeInterimFeedbacks,
}
