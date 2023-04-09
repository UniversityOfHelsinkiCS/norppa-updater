const { User } = require('../models')
const mangleData = require('./mangleData')
const { safeBulkCreate } = require('./util')

const parsePreferredLanguageUrnToLanguage = (urn) => {
  const fallBackLanguage = 'en'
  if (!urn) return fallBackLanguage
  const possibleLanguages = ['fi', 'en', 'sv']
  const splitArray = urn.split(':')
  const language = splitArray[splitArray.length - 1]
  return possibleLanguages.includes(language) ? language : fallBackLanguage
}

const getFirstName = ({ callName, firstNames }) =>
  callName || (firstNames ? firstNames.split(' ')[0] : null)

const usersHandler = async (users) => {
  const parsedUsers = users.map((user) => ({
    ...user,
    email: user.primaryEmail ? user.primaryEmail : user.secondaryEmail,
    secondaryEmail: user.primaryEmail ? user.secondaryEmail : null,
    language: parsePreferredLanguageUrnToLanguage(user.preferredLanguageUrn),
    firstName: getFirstName(user),
    username: user.eduPersonPrincipalName
      ? user.eduPersonPrincipalName.split('@')[0]
      : user.id,
    degreeStudyRight: user.has_study_right,
  }))

  // By default updates all fields on duplicate id
  await safeBulkCreate({
    entityName: 'User',
    entities: parsedUsers,
    bulkCreate: async (e, opt) => User.bulkCreate(e, opt),
    fallbackCreate: async (e, opt) => User.create(e, opt),
    options: {
      updateOnDuplicate: [
        'firstName',
        'username',
        'lastName',
        'studentNumber',
        'employeeNumber',
        'language',
        'email',
        'degreeStudyRight',
        'secondaryEmail',
      ],
    },
  })
}

const updateUsers = async () => {
  await mangleData('persons', 2000, usersHandler)
}

module.exports = updateUsers
