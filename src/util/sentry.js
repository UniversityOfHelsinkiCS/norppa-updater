const Sentry = require('@sentry/node')
const Tracing = require('@sentry/tracing') // eslint-disable-line
// Sentry docs Note: You MUST import the package for tracing to work
const { inProduction, inStaging, GIT_SHA } = require('./config')

const initializeSentry = (router) => {
  if (!inProduction || inStaging) return

  Sentry.init({
    dsn: 'https://c2bfd74ae83d84b110d89d5ca00e560f@toska.cs.helsinki.fi/20',
    release: GIT_SHA,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Tracing.Integrations.Express({ router }),
    ],
    tracesSampleRate: 1.0,
  })
}

module.exports = initializeSentry
