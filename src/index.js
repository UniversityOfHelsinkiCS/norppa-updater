const { connectToDatabase } = require('./db/dbConnection')
const { updater } = require('./updater')

const start = async () => {
  await connectToDatabase()

  updater.start()
}

start()
