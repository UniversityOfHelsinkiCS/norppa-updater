const express = require('express')

const { connectToDatabase } = require('./db/dbConnection')
const { updater } = require('./updater')
const logger = require('./util/logger')
const { PORT, inProduction } = require('./util/config')

const app = express()

app.get('/ping', (_, res) => res.send('pong'))

app.get('/run', (_, res) => {
  updater.run()

  return res.status(202).end()
})

const start = async () => {
  await connectToDatabase()
  await updater.checkStatusOnStartup()
  await updater.start()

  app.listen(PORT, () => {
    logger.info(
      `Started on port ${PORT} with environment ${
        inProduction ? 'production' : 'development'
      }`,
    )
  })
}

start()
