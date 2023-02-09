const express = require('express')
const Sentry = require('@sentry/node')

const { connectToDatabase } = require('./db/dbConnection')
const { updater } = require('./updater')
const logger = require('./util/logger')
const { PORT, NODE_ENV } = require('./util/config')
const initializeSentry = require('./util/sentry')

const app = express()

initializeSentry(app)

app.use(Sentry.Handlers.requestHandler())
app.use(Sentry.Handlers.tracingHandler())

app.get('/ping', (_, res) => res.send('pong'))

app.get('/run', (_, res) => {
  updater.run()

  return res.status(202).end()
})

app.use(Sentry.Handlers.errorHandler())

const start = async () => {
  await connectToDatabase()
  await updater.checkStatusOnStartup()
  await updater.start()

  app.listen(PORT, () => {
    logger.info(`Started on port ${PORT} with environment ${NODE_ENV}`)
  })
}

start()
