const { Op } = require('sequelize')
const _ = require('lodash')

const { FeedbackTarget, CourseRealisation, UserFeedbackTarget } = require('../models')

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
    newUserFeedbackTargets.map(({ userId, isAdministrativePerson }) => ({
      accessStatus,
      feedbackTargetId,
      userId,
      isAdministrativePerson,
      userCreated: true,
    }))
  )
}

const synchronizeInterimFeedbacks = async () => {
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

  const courseRealisationIds = new Set(courseRealisationsWithInterimFeedbacks.map(
    (({ id }) => id)
  ))

  const originalFeedbackTargets = await FeedbackTarget.findAll({
    where: {
      userCreated: false,
      courseRealisationId: Array.from(courseRealisationIds),
    },
    include:
      {
        model: UserFeedbackTarget,
        as: 'userFeedbackTargets',
        attributes: ['userId', 'accessStatus', 'isAdministrativePerson'],
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

      for (const fbt of courseRealisation.feedbackTargets) {
        await updateUserFeedbackTargets(fbt.id, userFeedbackTargets, accessStatus)
      }
    }
  }
}

module.exports = {
  synchronizeInterimFeedbacks,
}
