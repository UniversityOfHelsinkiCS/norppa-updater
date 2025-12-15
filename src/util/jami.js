const axios = require('axios')
const { Op } = require('sequelize')
const { JAMI_URL, API_TOKEN, inProduction } = require('./config')
const { Organisation } = require('../models')

const jamiClient = axios.create({
  baseURL: JAMI_URL,
  params: {
    token: API_TOKEN,
    noLogging: !inProduction,
  },
})

let norppaLevelOrganisationIds = null

const getNorppaLevelOrganisationIds = async () => {
  if (!norppaLevelOrganisationIds) {
    const { data: access } = await jamiClient.get('/access-to-all')
    const norppaLevelOrganisationCodes = Object.keys(access)

    const organisations = await Organisation.findAll(
      {
        where: {
          code: {
            [Op.in]: norppaLevelOrganisationCodes
          }
        }
      }
    )

    norppaLevelOrganisationIds = organisations.map(org => org.id)
  }

  return norppaLevelOrganisationIds
}

module.exports = {
  getNorppaLevelOrganisationIds
}
