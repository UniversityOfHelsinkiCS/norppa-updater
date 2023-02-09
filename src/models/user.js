const { Model, STRING, BOOLEAN, DATE, VIRTUAL } = require('sequelize')

const { sequelize } = require('../db/dbConnection')
const { ADMINS } = require('../util/config')

class User extends Model {}

User.init(
  {
    id: {
      type: STRING,
      primaryKey: true,
      allowNull: false,
    },
    username: {
      type: STRING,
      allowNull: false,
    },
    firstName: {
      type: STRING,
    },
    lastName: {
      type: STRING,
    },
    email: {
      type: STRING,
    },
    secondaryEmail: {
      type: STRING,
    },
    employeeNumber: {
      type: STRING,
    },
    language: {
      type: STRING,
    },
    studentNumber: {
      type: STRING,
    },
    degreeStudyRight: {
      type: BOOLEAN,
      allowNull: true,
    },
    norppaFeedbackGiven: {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    lastLoggedIn: {
      type: DATE,
      allowNull: true,
    },
    isAdmin: {
      type: VIRTUAL,
      get() {
        return ADMINS?.includes(this.username)
      },
    },
  },
  {
    underscored: true,
    sequelize,
  },
)

module.exports = User
