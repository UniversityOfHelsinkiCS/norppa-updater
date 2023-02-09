const { ENUM, DATE } = require('sequelize')
const { Model, JSONB } = require('sequelize')
const { sequelize } = require('../db/dbConnection')

class Banner extends Model {}

Banner.init(
  {
    data: {
      type: JSONB,
      allowNull: false,
    },
    accessGroup: {
      type: ENUM,
      values: ['STUDENT', 'TEACHER', 'ORG', 'ADMIN'],
    },
    startDate: {
      type: DATE,
      allowNull: false,
    },
    endDate: {
      type: DATE,
      allowNull: false,
    },
  },
  {
    underscored: true,
    timestamps: true,
    sequelize,
  },
)

module.exports = Banner
