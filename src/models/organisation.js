const {
  Model,
  JSONB,
  STRING,
  BOOLEAN,
  ARRAY,
  TEXT,
  INTEGER,
} = require('sequelize')
const { sequelize } = require('../db/dbConnection')

class Organisation extends Model {}

Organisation.init(
  {
    id: {
      type: STRING,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: JSONB,
    },
    code: {
      type: STRING,
    },
    parentId: {
      type: STRING,
    },
    studentListVisible: {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    disabledCourseCodes: {
      type: ARRAY(TEXT),
      allowNull: false,
      defaultValue: [],
    },
    studentListVisibleCourseCodes: {
      type: ARRAY(TEXT),
      allowNull: false,
      defaultValue: [],
    },
    publicQuestionIds: {
      type: ARRAY(INTEGER),
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    underscored: true,
    sequelize,
  },
)

module.exports = Organisation
