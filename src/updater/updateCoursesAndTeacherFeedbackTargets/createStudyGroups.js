const { Group } = require("../../models")
const { safeBulkCreate } = require("../util")

/**
 * 
 * @param {object[]} feedbackTargets 
 * @param {object[]} courses 
 * @returns {Promise<object>} map from teacher ids to their group ids
 */
const createStudyGroups = async (feedbackTargets, courses) => {
  const groups = []
  const teacherGroups = {}

  feedbackTargets.forEach((fbt) => {
    const courseRealisationData = courses.find(c => c.id === fbt.dataValues.typeId)
    if (!courseRealisationData) return
    const { studyGroupSets } = courseRealisationData

    for (const { studySubGroups } of studyGroupSets) {

      // Create groups only when more than 1 sub group.
      if (!studySubGroups?.length > 1) return
      
      for (const studySubGroup of studySubGroups) {
        groups.push({
          id: studySubGroup.id,
          feedbackTargetId: fbt.id,
          name: studySubGroup.name,
        })

        for (const teacherId of studySubGroup.teacherIds ?? []) {
          if (teacherGroups[teacherId]) {
            teacherGroups[teacherId].push(studySubGroup.id)
          } else {
            teacherGroups[teacherId] = [studySubGroup.id]
          }
        }
      }
    }
  })

  await safeBulkCreate({
    entityName: "Group",
    entities: groups,
    bulkCreate: async (e, opts) => Group.bulkCreate(e, opts),
    fallbackCreate: async (e, opts) => Group.create(e, opts),
    options: {
      updateOnDuplicate: ['name'],
    },
  })

  return teacherGroups
}

module.exports = {
  createStudyGroups
}