const { Model, STRING, INTEGER, ARRAY, ENUM, VIRTUAL } = require('sequelize')

const { sequelize } = require('../db/dbConnection')

class Survey extends Model {}

Survey.init(
  {
    questionIds: {
      type: ARRAY(INTEGER),
      allowNull: false,
    },
    feedbackTargetId: {
      type: INTEGER,
    },
    type: {
      type: ENUM,
      values: ['feedbackTarget', 'courseUnit', 'programme', 'university'],
    },
    typeId: {
      type: STRING,
    },
    questions: {
      type: VIRTUAL,
    },
    publicQuestionIds: {
      type: VIRTUAL,
    },
  },
  {
    underscored: true,
    sequelize,
  },
)

module.exports = Survey
