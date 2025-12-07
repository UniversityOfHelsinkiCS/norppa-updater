const { Op } = require("sequelize")
const { format } = require("date-fns")

const { FeedbackTarget, UserFeedbackTarget, Feedback } = require("../../models")

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

const getLanguageValue = (values, preferred) => {
  if (!values) {
    return null
  }

  const possibleLangs = ['fi', 'en', 'sv']

  if (values[preferred]) return values[preferred]

  // eslint-disable-next-line
  for (const lang of possibleLangs) {
    if (values[lang]) return values[lang]
  }

  return null
}

// Documents created in sisu have id format of `otm-{UUID}`
const isSisuNativeId = (id) => id && id.startsWith('otm-')

const isAiliOriginatingId = (id) => id && id.startsWith('hy-cur-aili-')

const hasSisuLikeNamingConvention = (id) => id.startsWith('otm-') || id.startsWith('hy-cur-aili-')

const isOptimeOriginatingId = (id) => id && id.startsWith('hy-opt-cur-')

const courseNameWithCourseType = (name, type, lang) => {
  const nameTranslated = typeof (name) === 'string' ? name : getLanguageValue(name, lang)
  const typeTranslated = typeof (type) === 'string' ? type : getLanguageValue(type, lang)

  if (!nameTranslated) {
    return typeTranslated
  }
  if (!typeTranslated) {
    return nameTranslated
  }
  return `${nameTranslated}, ${typeTranslated}`
}

/**
 * Translate and format course name.
 *
 * Realisations created in Sisu (id format "otm-<nnn>") contain course type in "name" field and descriptive name in "nameSpecifier" field.
 * Realisations created in Optime (id format "hy-opt-cur-<nnn>") or Oodi (id format "hy-CUR-<nnn>") are opposite of this.
 *
 * Returns course name as "Descriptive name, Course type" for sisu native and oodi courses and courses descriptive name for
 * realisations created in Optime.
 *
 * @param {string} id - Course unit realisation id
 * @param {LocalizedText|string} name - Course unit realisation name from sisu
 * @param {LocalizedText|string} nameSpecifier - Course unit realisation nameSpecifier from sisu
 * @param {string} lang - Language to translate name in
 * @returns {string} - Formatted course name
 */
const formatCourseName = (id, name, nameSpecifier, lang) => {
  if (hasSisuLikeNamingConvention(id)) {
    return courseNameWithCourseType(nameSpecifier, name, lang)
  } if (isOptimeOriginatingId(id)) {
    return courseNameWithCourseType(name, null, lang)
  }
  return courseNameWithCourseType(name, nameSpecifier, lang)
}

// In case a course realisation belongs to many course units, updater tries to guess which one is the primary one.
// Sometimes teachers are not happy with the guess and they give feedback. If the course realisation is on this mapping,
// the correct course unit is selected directly without guessing.
// You can add new cases to this object as {curId: cuId}
const primaryCourseUnits = {
  'hy-opt-cur-2526-44c4994b-35ac-420d-9cb4-0b13a3c2a03e': 'otm-9e3bb204-ebef-45ef-912c-e7ca8e18aa53',
  'hy-opt-cur-2526-3b2e9946-2e1f-44c3-a38d-ba88da8281ce': 'otm-fdc7e4a3-2105-4548-ae9f-6fe1aea3c1b4',
}

const getPrimaryCourseUnitIdForCourseRealisation = (curId) =>
  primaryCourseUnits[curId]  // undefined if curId not found

module.exports = {
  formatWithHours,
  getFeedbackCount,
  isSisuNativeId,
  isAiliOriginatingId,
  hasSisuLikeNamingConvention,
  isOptimeOriginatingId,
  courseNameWithCourseType,
  formatCourseName,
  getPrimaryCourseUnitIdForCourseRealisation
}
