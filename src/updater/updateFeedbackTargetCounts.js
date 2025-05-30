const Sentry = require('@sentry/node')
const { QueryTypes } = require('sequelize')
const { FeedbackTarget } = require('../models')
const { sequelize } = require('../db/dbConnection')
const logger = require('../util/logger')
const { logOperation } = require('./util')

const updateHiddenCount = async () => {
  const countsById = await sequelize.query(
    `
    SELECT ufbt.feedback_target_id as id, COUNT(*) FROM (
      SELECT jsonb_array_elements(data) AS data, id FROM feedbacks
    ) as f
    INNER JOIN user_feedback_targets ufbt ON ufbt.feedback_id = f.id
    WHERE (f.data->>'hidden')::BOOLEAN
    GROUP BY ufbt.feedback_target_id
  `,
    { type: QueryTypes.SELECT },
  )

  if (Array.isArray(countsById)) {
    for (const { id, count } of countsById) {
      await FeedbackTarget.update(
        {
          hiddenCount: count,
        },
        { where: { id } },
      )
    }
  }

  return { updates: countsById?.length }
}

const updateFeedbackTargetCounts = async () => {
  logger.info('[UPDATER] starting to update feedbackTargetCounts')
  await logOperation(
    updateHiddenCount,
    '[UPDATER][feedbackTargetCounts] updated hiddenCounts',
  )
}

module.exports = {
  updateFeedbackTargetCounts,
}
