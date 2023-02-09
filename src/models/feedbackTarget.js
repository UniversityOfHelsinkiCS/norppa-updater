const {
  DATE,
  ENUM,
  STRING,
  Model,
  JSONB,
  BOOLEAN,
  VIRTUAL,
  ARRAY,
  INTEGER,
  TEXT,
} = require('sequelize')
const { sequelize } = require('../db/dbConnection')

class FeedbackTarget extends Model {}

FeedbackTarget.init(
  {
    feedbackType: {
      type: ENUM,
      values: ['courseRealisation', 'assessmentItem', 'studySubGroup'],
      allowNull: false,
      unique: 'source',
    },
    typeId: {
      type: STRING,
      allowNull: false,
      unique: 'source',
    },
    courseUnitId: {
      type: STRING,
      allowNull: false,
    },
    courseRealisationId: {
      type: STRING,
      allowNull: false,
    },
    name: {
      type: JSONB,
      allowNull: false,
    },
    hidden: {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    feedbackCount: {
      type: INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    hiddenCount: {
      type: INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    opensAt: {
      type: DATE,
    },
    closesAt: {
      type: DATE,
    },
    // potentially cached
    surveys: {
      type: VIRTUAL,
    },
    // potentially cached
    questions: {
      type: VIRTUAL,
    },
    // potentially cached
    questionOrder: {
      type: VIRTUAL,
    },
    // potentially cached
    responsibleTeachers: {
      type: VIRTUAL,
    },
    // potentially cached
    teachers: {
      type: VIRTUAL,
    },
    // potentially cached
    administrativePersons: {
      type: VIRTUAL,
    },
    // potentially cached
    tags: {
      type: VIRTUAL,
    },
    studentCount: {
      type: VIRTUAL,
      get() {
        return this.dataValues.studentCount
          ? Number(this.dataValues.studentCount)
          : 0
      },
    },
    publicQuestionIds: {
      type: ARRAY(INTEGER),
      allowNull: false,
      defaultValue: [],
    },
    feedbackResponse: {
      type: TEXT,
    },
    feedbackResponseEmailSent: {
      type: BOOLEAN,
    },
    feedbackOpeningReminderEmailSent: {
      type: BOOLEAN,
    },
    feedbackResponseReminderEmailSent: {
      type: BOOLEAN,
    },
    feedbackReminderLastSentAt: {
      type: DATE,
      defaultValue: null,
      allowNull: true,
    },
    feedbackVisibility: {
      type: TEXT,
      defaultValue: 'ENROLLED',
    },
    feedbackDatesEditedByTeacher: {
      type: BOOLEAN,
    },
    settingsReadByTeacher: {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    continuousFeedbackEnabled: {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    sendContinuousFeedbackDigestEmail: {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    underscored: true,
    sequelize,
    defaultScope: {
      where: {
        hidden: false,
      },
    },
  },
)

module.exports = FeedbackTarget
