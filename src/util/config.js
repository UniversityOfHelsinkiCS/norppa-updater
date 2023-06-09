require('dotenv').config()

const inProduction = process.env.NODE_ENV === 'production'
const inStaging = process.env.NODE_ENV === 'staging'
const inE2EMode = process.env.REACT_APP_E2E === 'true'
const basePath = process.env.PUBLIC_URL || ''

const GIT_SHA = process.env.REACT_APP_GIT_SHA || ''

const { API_TOKEN } = process.env

const PORT = process.env.PORT || 3000

const NODE_ENV = process.env.NODE_ENV || 'development'

const IMPORTER_API_URL = process.env.IMPORTER_API_URL || ''

const DATABASE_URL = process.env.DATABASE_URL ||''

const ADMINS = ['mluukkai', 'ttiittan', 'kurhila', 'vesuvesu', 'kemiko']

module.exports = {
  inE2EMode,
  inProduction,
  inStaging,
  basePath,
  GIT_SHA,
  DATABASE_URL,
  PORT,
  NODE_ENV,
  API_TOKEN,
  IMPORTER_API_URL,
  ADMINS,
}
