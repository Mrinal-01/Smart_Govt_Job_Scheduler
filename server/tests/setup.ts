import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

// Must run before any app module reads process.env.
process.env.NODE_ENV = 'test'
const base = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017'
process.env.MONGODB_URI = `${base.replace(/\/$/, '')}/studyos_test_${crypto.randomBytes(4).toString('hex')}`
process.env.JWT_ACCESS_SECRET = 'test-secret-'.padEnd(48, 'x')
process.env.FILE_SIGNING_SECRET = 'test-file-secret-'.padEnd(48, 'y')
process.env.STORAGE_DIR = path.join(os.tmpdir(), `studyos-test-storage-${crypto.randomBytes(4).toString('hex')}`)
process.env.MAIL_DRIVER = 'console'
process.env.AI_PROVIDER = 'none'
process.env.OCR_PROVIDER = 'none'
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
process.env.CORS_ORIGINS = 'http://localhost:3000'
process.env.SCHEDULE_MAX_CHANGES = '3'
process.env.SCHEDULE_WINDOW_DAYS = '7'
process.env.AI_DAILY_REQUEST_LIMIT = '5'
