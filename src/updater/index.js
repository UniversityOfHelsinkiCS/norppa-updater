const Sentry = require('@sentry/node')
const { inProduction, inStaging } = require('../util/config')
const logger = require('../util/logger')
const { schedule } = require('../util/cron')
const { clearOffsets } = require('./util')
const updateUsers = require('./updateUsers')
const updateOrganisations = require('./updateOrganisations')
const {
  updateCoursesAndTeacherFeedbackTargets,
} = require('./updateCoursesAndTeacherFeedbackTargets')
const {
  updateStudentFeedbackTargets,
} = require('./updateStudentFeedbackTargets')
const { updateFeedbackTargetCounts } = require('./updateFeedbackTargetCounts')
const { synchronizeInterimFeedbacks } = require('./synchronizeInterimFeedbacks')
const { UpdaterStatus } = require('../models')

const JOB_TYPE = 'NIGHTLY'

const runUpdater = async () => {
  // Dependencies between updating, may result in failure if order not kept
  await updateUsers() 
  // Note: if importer updates data after updateUsers but before updateStudentFeedbackTargets, you may get a foreign key constraint error. 
  // Its not a huge problem, just run the updater again or wait for the next cron.
  await updateOrganisations()
  await updateCoursesAndTeacherFeedbackTargets()
  await updateStudentFeedbackTargets()
  await updateFeedbackTargetCounts()
  await synchronizeInterimFeedbacks()
}

const run = async () => {
  logger.info('[UPDATER] Running updater')

  const status = await UpdaterStatus.create({
    status: 'RUNNING',
    jobType: JOB_TYPE,
  })

  try {
    await clearOffsets()
    await runUpdater()
  } catch (error) {
    Sentry.captureException(error)
    Sentry.captureMessage('Updater run failed!')
    status.status = 'FAILURE'
    status.finishedAt = new Date()
    await status.save()
    return logger.error('[UPDATER] finished with error', error)
  }

  status.status = 'FINISHED'
  status.finishedAt = new Date()
  await status.save()

  return logger.info('[UPDATER] Finished updating')
}

const continueRun = async (status) => {
  logger.info('[UPDATER] Continuing interrupted updater run')

  try {
    await runUpdater()
  } catch (error) {
    Sentry.captureException(error)
    Sentry.captureMessage('Updater run failed!')
    status.status = 'FAILURE'
    status.finishedAt = new Date()
    await status.save()
    return logger.error('[UPDATER] finished with error', error)
  }

  status.status = 'FINISHED'
  status.finishedAt = new Date()
  await status.save()

  return logger.info('[UPDATER] Finished updating')
}

const start = async () => {
  if (!(inProduction || inStaging)) {
    logger.info('Starting development updater run')
    // run()
    return
  }
  logger.info('Setup cron job')
  // Every night at 01:30 in production. Only on weekend in staging for teacher and enrolment deletion
  const cronTime = inProduction ? '30 1 * * *' : '30 1 * * 0,1'
  schedule(cronTime, run)

  logger.info('Running updater according to cron', { cron: cronTime })
}

const checkStatusOnStartup = async () => {
  const statuses = await UpdaterStatus.findAll({
    where: {
      status: 'RUNNING',
    },
  })

  if (inProduction && statuses.length === 1) {
    const status = statuses[0]
    logger.info(`Server had a restart while updater was running, continuing ${status.jobType}`)
    await continueRun(status)
  } else {
    for (const status of statuses) {
      status.status = 'INTERRUPTED'
      status.finishedAt = new Date()
      await status.save()
      const msg = `Server had a restart while updater was running, interrupting ${status.jobType}`
      Sentry.captureMessage(msg)
      logger.error(`[UPDATER] ${msg}`)
    }
  }
}

const updater = {
  start,
  run,
  checkStatusOnStartup,
}

module.exports = { updater }
