const { Op } = require("sequelize")
const { format } = require("date-fns")

const { FeedbackTarget, UserFeedbackTarget, Feedback } = require("../../models")

const formatDate = (date) => format(date, 'yyyy-MM-dd')
const formatWithHours = (date) => format(date, 'yyyy-MM-dd HH:mm:ss')

const getFeedbackCount = async (courseRealisationId) => {
  const feedbackTargets = await FeedbackTarget.findAll({
    where: {
      courseRealisationId,
    },
    attributes: ['id'],
  })

  const feedbackTargetIds = feedbackTargets.map((target) => target.id)

  const feedbackCount = await Feedback.count({
    include: [
      {
        model: UserFeedbackTarget,
        as: 'userFeedbackTarget',
        required: true,
        where: {
          feedbackTargetId: {
            [Op.in]: feedbackTargetIds,
          },
        },
      },
    ],
  })

  return feedbackCount
}

module.exports = {
  formatDate,
  formatWithHours,
  getFeedbackCount,
}
