const _ = require('lodash')

const { UserFeedbackTarget } = require('../../models')
const { safeBulkCreate } = require('../util')

const administrativePersonUrns = [
  'urn:code:course-unit-realisation-responsibility-info-type:administrative-person',
  'urn:code:module-responsibility-info-type:administrative-person',
]

const responsibleTeacherUrns = [
  'urn:code:course-unit-realisation-responsibility-info-type:responsible-teacher',
  'urn:code:course-unit-realisation-responsibility-info-type:contact-info',
  'urn:code:module-responsibility-info-type:responsible-teacher',
  'urn:code:module-responsibility-info-type:contact-info',
  ...administrativePersonUrns,
]

const sortAccessStatus = (a, b) => {
  // Prevent more important access status from being overwritten
  // Sort teacherFeedbackTargets in the following order:
  // responsible teacher > administrative person > teacher
  const a1 = a.accessStatus === 'RESPONSIBLE_TEACHER'
  const a2 = !a.isAdministrativePerson
  const b1 = b.accessStatus === 'RESPONSIBLE_TEACHER'
  const b2 = !b.isAdministrativePerson

  if (a1 && !b1) return -1
  if (!a1 && b1) return 1
  if (a1 && b1) {
    if (a2 && !b2) return -1
    if (!a2 && b2) return 1
  }

  return 0
}

const getAccessStatus = (roleUrn, courseRealisation) => {
  const { startDate } = courseRealisation.activityPeriod

  // All teachers have responsible teacher access before 2023
  if (startDate < '2023-01-01') return 'RESPONSIBLE_TEACHER'

  return responsibleTeacherUrns.includes(roleUrn) ? 'RESPONSIBLE_TEACHER' : 'TEACHER'
}

const updateTeacherFeedbackTargets = async (feedbackTargetsWithIds, teacherGroups, courseIdToPersonIds, courses) => {
  const userFeedbackTargets = []
    .concat(
      ...feedbackTargetsWithIds.map(
        ({ id: feedbackTargetId, courseRealisationId }) =>
          courseIdToPersonIds[courseRealisationId].map(
            ({ personId, roleUrn }) => ({
              feedbackTargetId,
              userId: personId,
              groupIds: teacherGroups[personId], // Its allowed to be null
              accessStatus: getAccessStatus(roleUrn, courses.find(({ id }) => id === courseRealisationId)),
              isAdministrativePerson: administrativePersonUrns.includes(roleUrn),
            }),
          ),
      ),
    )
    .filter((target) => target.userId && target.feedbackTargetId)
    .sort(sortAccessStatus)
  
  const uniqueUfbts = _.uniqBy(userFeedbackTargets, ufbt => `${ufbt.userId}${ufbt.feedbackTargetId}`)
 
  await safeBulkCreate({
    entityName: 'UserFeedbackTarget',
    entities: uniqueUfbts,
    bulkCreate: async (e, opts) => UserFeedbackTarget.bulkCreate(e, opts),
    fallbackCreate: async (e, opts) => UserFeedbackTarget.upsert(e, opts),
    options: { updateOnDuplicate: ["groupIds", "accessStatus", "isAdministrativePerson"] },
  })
}

module.exports = {
  updateTeacherFeedbackTargets,
}
