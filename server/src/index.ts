import { env } from './config/env.js'
import { connectDb, disconnectDb } from './db.js'
import { createApp } from './app.js'
import { logger } from './lib/logger.js'
import { startJobWorker, stopJobWorker } from './jobs/queue.js'
import { startAttemptSweeper, stopAttemptSweeper } from './modules/exams/attempt.service.js'
import { describeIntegrations } from './modules/system/system.service.js'

async function main() {
  await connectDb(env.MONGODB_URI)
  const app = createApp()
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `StudyOS API listening on http://localhost:${env.PORT}`)
  })
  const integrations = await describeIntegrations()
  logger.info(integrations, 'Integration status')
  startJobWorker()
  startAttemptSweeper()

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down')
    stopJobWorker()
    stopAttemptSweeper()
    server.close()
    await disconnectDb().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server')
  process.exit(1)
})
