require('dotenv').config()

const inProduction = process.env.NODE_ENV === 'production'
const inStaging = process.env.NODE_ENV === 'staging'

const GIT_SHA = process.env.REACT_APP_GIT_SHA || ''

const { API_TOKEN, REDIS_HOST } = process.env

const PORT = process.env.PORT || 3003

const NODE_ENV = process.env.NODE_ENV || 'development'

const IMPORTER_API_URL = process.env.IMPORTER_API_URL || ''

const DATABASE_URL = process.env.DATABASE_URL ||''

const REDIS_CONFIG = {
  url: `redis://default:redis@${REDIS_HOST}:6379`,
}

module.exports = {
  inProduction,
  inStaging,
  GIT_SHA,
  DATABASE_URL,
  PORT,
  NODE_ENV,
  API_TOKEN,
  IMPORTER_API_URL,
  REDIS_CONFIG,
}
