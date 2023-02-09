require('dotenv').config()

const inProduction = process.env.NODE_ENV === 'production'
const inStaging = process.env.REACT_APP_STAGING === 'true'
const inE2EMode = process.env.REACT_APP_E2E === 'true'
const basePath = process.env.PUBLIC_URL || ''

const GIT_SHA = process.env.REACT_APP_GIT_SHA || ''

const { API_TOKEN } = process.env

const PORT = process.env.PORT || 3000

const IMPORTER_API_URL = 'https://importer.cs.helsinki.fi/api/importer'

let DB_CONNECTION_STRING = `postgres://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}?targetServerType=primary`

if (inStaging) DB_CONNECTION_STRING = `${DB_CONNECTION_STRING}&ssl=true`

const ADMINS = ['mluukkai', 'ttiittan', 'kurhila', 'vesuvesu', 'kemiko']

module.exports = {
  inE2EMode,
  inProduction,
  inStaging,
  basePath,
  GIT_SHA,
  DB_CONNECTION_STRING,
  PORT,
  API_TOKEN,
  IMPORTER_API_URL,
  ADMINS,
}
