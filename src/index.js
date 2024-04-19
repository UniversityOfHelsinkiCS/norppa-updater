const express = require('express')
const Sentry = require('@sentry/node')

const { connectToDatabase } = require('./db/dbConnection')
const { initializeFunctions } = require('./db/postgresFunctions')
const { updater } = require('./updater')
const {
  updateEnrolmentsOfCourse,
} = require('./updater/updateStudentFeedbackTargets')
const {
  deleteCancelledCourses,
} = require('./updater/updateCoursesAndTeacherFeedbackTargets')
const { start: startEnrolmentsCron } = require('./util/updateEnrolmentsCron')
const logger = require('./util/logger')
const { PORT, NODE_ENV } = require('./util/config')
const initializeSentry = require('./util/sentry')
const { redis } = require('./util/redisClient')

const app = express()

initializeSentry(app)

app.use(Sentry.Handlers.requestHandler())
app.use(Sentry.Handlers.tracingHandler())

app.get('/ping', (_, res) => res.send('pong'))

app.get('/run', (_, res) => {
  updater.run()

  return res.status(202).end()
})

app.post('/enrolments/:id', async (req, res) => {
  const { id } = req.params

  await updateEnrolmentsOfCourse(id)

  return res.status(201).end()
})

app.delete('/courses/:id', async (req, res) => {
  const { id } = req.params

  await deleteCancelledCourses([id])

  return res.status(202).end()
})

app.use(Sentry.Handlers.errorHandler())

const start = async () => {
  await connectToDatabase()
  await initializeFunctions()
  await redis.connect()
  await updater.checkStatusOnStartup()
  await updater.run()
  await updater.start()
  await startEnrolmentsCron()

  app.listen(PORT, () => {
    logger.info(`Started on port ${PORT} with environment ${NODE_ENV}`)
  })
}

start()
