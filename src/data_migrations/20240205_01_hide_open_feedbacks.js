/* eslint-disable */

const { FeedbackTarget } = require('../models')

module.exports = {
  up: async queryInterface => {
   const fbts = await queryInterface.sequelize.query(`
    SELECT distinct feedback_targets.id, ARRAY_AGG(questions.id) as public_question_ids
    FROM feedback_targets
    INNER JOIN questions 
    ON questions.id=any(public_question_ids) 
    WHERE NOT questions.type='OPEN'
    GROUP BY feedback_targets.id;
   `, { type: queryInterface.sequelize.QueryTypes.SELECT })
  
  await Promise.all(fbts.map(async ({id, public_question_ids}) => {
    await FeedbackTarget.update({publicQuestionIds: public_question_ids}, {where: {id}})
  }))

  },
  down: async queryInterface => {
    
  },
}