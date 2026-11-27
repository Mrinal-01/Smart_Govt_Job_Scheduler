import mongoose from 'mongoose'
import { logger } from './lib/logger.js'
import './models/index.js'

export async function connectDb(uri: string) {
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'))
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })
  await migrateLegacyIndexes()
  // Ensure unique/partial indexes exist before serving traffic — several
  // business rules (dedupe, one active cycle, one running attempt) rely on them.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()))
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected')
}

export async function disconnectDb() {
  await mongoose.disconnect()
}

/**
 * `users.email_1` (unique, every document) predates phone sign-up and would reject a second
 * user without an email. It is replaced by the partial index `email_unique_when_present`.
 */
async function migrateLegacyIndexes() {
  const users = mongoose.connection.db?.collection('users')
  if (!users) return
  const indexes = await users.indexes().catch(() => [])
  const legacy = indexes.find((i) => i.name === 'email_1' && !i.partialFilterExpression)
  if (legacy) {
    await users.dropIndex('email_1')
    logger.info('Dropped legacy users.email_1 index (replaced by email_unique_when_present)')
  }
}
