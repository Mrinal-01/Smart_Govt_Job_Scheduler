import mongoose from 'mongoose'
import { logger } from './lib/logger.js'
import './models/index.js'

export async function connectDb(uri: string) {
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'))
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })
  // Ensure unique/partial indexes exist before serving traffic — several
  // business rules (dedupe, one active cycle, one running attempt) rely on them.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()))
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected')
}

export async function disconnectDb() {
  await mongoose.disconnect()
}
