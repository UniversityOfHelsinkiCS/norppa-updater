const { parseFromTimeZone } = require("date-fns-timezone")
const dateFns = require('date-fns')
const { CourseRealisation, CourseRealisationsOrganisation, InactiveCourseRealisation } = require("../../models")
const { safeBulkCreate } = require("../util")
const { formatWithHours } = require("./utils")
const logger = require("../../util/logger")

const getCourseRealisationPeriod = (activityPeriod) => {
  const { startDate, endDate } = activityPeriod

  const formattedEndDate = endDate
    ? formatWithHours(
        dateFns.add(dateFns.subDays(dateFns.parseISO(endDate), 1), {
          hours: 23,
          minutes: 59,
        }),
      )
    : null

  return {
    startDate,
    endDate: endDate
      ? parseFromTimeZone(formattedEndDate, { timeZone: 'Europe/Helsinki' })
      : null,
  }
}

const getEducationalInstitutionUrn = (organisations) => {
  const urns = new Set()

  organisations.forEach((organisation) => {
    if (
      organisation.roleUrn ===
        'urn:code:organisation-role:coordinating-organisation' &&
      organisation.educationalInstitutionUrn
    ) {
      urns.add(organisation.educationalInstitutionUrn)
    }
  })

  if (urns.size > 1) {
    logger.info('More than one org', {})
  }

  return urns.values().next().value // Yes wtf
}

const isMoocCourse = (customCodeUrns) => {
  if (!customCodeUrns) return false
  if (!customCodeUrns['urn:code:custom:hy-university-root-id:opintotarjonta'])
    return false
  return customCodeUrns[
    'urn:code:custom:hy-university-root-id:opintotarjonta'
  ].includes('urn:code:custom:hy-university-root-id:opintotarjonta:mooc')
}

const getTeachingLanguages = (customCodeUrns) => {
  if (!customCodeUrns) return null
  if (!customCodeUrns['urn:code:custom:hy-university-root-id:opetuskielet'])
    return null

  const languages = customCodeUrns[
    'urn:code:custom:hy-university-root-id:opetuskielet'
  ].map((urn) => urn.slice(-2))

  if (languages.length === 0) return null

  return languages
}

const createInactiveCourseRealisations = async (inactiveCourseRealisations) => {
  for (const {
    id,
    name,
    activityPeriod,
    organisations,
    customCodeUrns,
  } of inactiveCourseRealisations) {
    await InactiveCourseRealisation.upsert({
      id,
      name,
      ...getCourseRealisationPeriod(activityPeriod),
      educationalInstitutionUrn: getEducationalInstitutionUrn(organisations),
      isMoocCourse: isMoocCourse(customCodeUrns),
      teachingLanguages: getTeachingLanguages(customCodeUrns),
    })
  }
}

const createCourseRealisations = async (courseRealisations) => {
  for (const {
    id,
    name,
    activityPeriod,
    organisations,
    customCodeUrns,
  } of courseRealisations) {
    await CourseRealisation.upsert({
      id,
      name,
      ...getCourseRealisationPeriod(activityPeriod),
      educationalInstitutionUrn: getEducationalInstitutionUrn(organisations),
      isMoocCourse: isMoocCourse(customCodeUrns),
      teachingLanguages: getTeachingLanguages(customCodeUrns),
    })
  }

  const courseRealisationsOrganisations = courseRealisations.flatMap(({ id, organisations }) =>
    organisations
      .filter(({ share, organisationId }) => share > 0 && organisationId !== null)
      .sort((a, b) => b.share - a.share)
      .map(({ organisationId }, index) => ({
        type: index === 0 ? 'PRIMARY' : 'DIRECT',
        courseRealisationId: id,
        organisationId,
      })),
  )

  await safeBulkCreate({
    entityName: 'CourseRealisationsOrganisation',
    entities: courseRealisationsOrganisations,
    bulkCreate: async (entities, opt) =>
      CourseRealisationsOrganisation.bulkCreate(entities, opt),
    fallbackCreate: async (entity, opt) =>
      CourseRealisationsOrganisation.upsert(entity, opt),
    options: { ignoreDuplicates: true },
  })
}

module.exports = {
  createCourseRealisations,
  createInactiveCourseRealisations
}
