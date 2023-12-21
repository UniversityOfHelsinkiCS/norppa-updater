const Sentry = require('@sentry/node')

const { redis } = require('../util/redisClient')
const logger = require('../util/logger')

const logError = (message, error) => {
  logger.error(`${message} ${error.name}, ${error.message}`)

  Sentry.captureException(error)
}

const safeBulkCreate = async ({
  entityName,
  bulkCreate,
  fallbackCreate,
  options,
  entities,
}) => {
  try {
    const result = await bulkCreate(entities, options)
    return result
  } catch (error) {
    const result = []
    logError(`[UPDATER] ${entityName}.bulkCreate failed, reason: `, error)
    logger.info(`[UPDATER] Creating ${entityName}s one by one`)
    for (const entity of entities) {
      try {
        const res = await fallbackCreate(entity, { ...options, fields: options.updateOnDuplicate })
        result.push(res)
      } catch (error) {
        logError(
          `[UPDATER] Fallback could not create ${entityName} (${JSON.stringify(
            entity,
          )}), reason:`,
          error,
        )
      }
    }
    return result
  }
}

const logOperation = async (func, message) => {
  const start = Date.now()
  let success = false
  let info = null
  try {
    info = await func()
    success = true
  } catch (error) {
    Sentry.captureMessage(`Operation failed: ${message}`)
    Sentry.captureException(error)
    logger.error('Error: ', error)
  }

  const durationMs = (Date.now() - start).toFixed()
  if (success) {
    logger.info(`${message} - done in ${durationMs} ms`, info)
  } else {
    logger.error(`Failure: ${message} - failed in ${durationMs} ms`, info)
  }
}

const clearOffsets = async () => {
  const keys = await redis.keys('*-offset')

  for (const key of keys) {
    await redis.delete(key)
  }
}

module.exports = {
  safeBulkCreate,
  logOperation,
  clearOffsets,
}
