/**
 * Development helper: creates (or resets) the MASTER ACCOUNT used to explore
 * every feature without email delivery.
 *
 *   npm run seed:master               (from the project root)
 *
 * - Phone login (MASTER_ACCOUNT_PHONE, default +919000000001); email/password kept on the record
 *   only for reference (override with MASTER_ACCOUNT_EMAIL / MASTER_ACCOUNT_PASSWORD)
 * - Workspace with the demo 365-day dataset
 * - Schedule v1 published (baseline)
 * - 36 sample questions, already VERIFIED, so mock tests can be built immediately
 * - Use samples/sample-question-paper.pdf for the PDF upload flow
 *
 * Refuses to run when NODE_ENV=production. It only ever touches this one account.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../src/config/env.ts'
import { connectDb, disconnectDb } from '../src/db.ts'
import * as M from '../src/models/index.ts'
import { hashPassword } from '../src/modules/auth/auth.service.ts'
import { publish } from '../src/modules/schedule/schedule.service.ts'
import { normalizeForHash } from '../src/modules/documents/extraction/questionParser.ts'
import { normalizePhone } from '../src/lib/phone.ts'
import { buildSeedState, chapterIdFor, subjectIdFor, topicIdFor } from '../../src/data/seed.ts'
import { QUESTION_BANK } from '../../src/data/questions.ts'

const EMAIL = (process.env.MASTER_ACCOUNT_EMAIL ?? 'tester@studyos.local').toLowerCase()
const PASSWORD = process.env.MASTER_ACCOUNT_PASSWORD ?? 'StudyOS-Test-2026'
const phoneInput = process.env.MASTER_ACCOUNT_PHONE ?? '+919000000001'
const normalized = normalizePhone(phoneInput)
if ('error' in normalized) {
  console.error(`MASTER_ACCOUNT_PHONE is invalid: ${normalized.error}`)
  process.exit(1)
}
const PHONE = normalized.phone
const NAME = 'StudyOS Master'
const here = path.dirname(fileURLToPath(import.meta.url))
const pdfPath = path.resolve(here, '../../samples/sample-question-paper.pdf')

if (env.isProd) {
  console.error('Refusing to create the master account with NODE_ENV=production.')
  process.exit(1)
}

async function wipe(userId: M.UserDoc['_id']) {
  const owned = [
    M.RefreshSession, M.EmailVerificationToken, M.PasswordResetToken, M.StudyWorkspace, M.UserSettings,
    M.Notification, M.Schedule, M.ScheduleVersion, M.StudySession, M.RevisionObligation, M.RevisionAttempt, M.GateOverride, M.UploadedDocument, M.ProcessingJob, M.Question, M.MockTest, M.MockTestAttempt, M.MockTestAnswer,
    M.ExamMistake, M.AIUsageLog
  ]
  for (const model of owned) await (model as unknown as { deleteMany: (f: object) => Promise<unknown> }).deleteMany({ userId })
  await fs.rm(path.join(env.storageDir, String(userId)), { recursive: true, force: true })
}

await connectDb(env.MONGODB_URI)

const existing = await M.User.findOne({ $or: [{ email: EMAIL }, { phone: PHONE }] })
if (existing) await wipe(existing._id)
await M.PhoneOtp.deleteMany({ phone: PHONE })
const user = existing ?? new M.User({ email: EMAIL, termsAcceptedAt: new Date() })
user.set({
  name: NAME,
  email: EMAIL,
  phone: PHONE,
  phoneVerifiedAt: new Date(),
  passwordHash: await hashPassword(PASSWORD),
  emailVerified: true,
  emailVerifiedAt: new Date(),
  status: 'active',
  failedLoginCount: 0,
  lockedUntil: null,
  termsAcceptedAt: user.termsAcceptedAt ?? new Date()
})
await user.save()

const data = buildSeedState()
data.profile = { ...data.profile, name: NAME, email: EMAIL }
await M.StudyWorkspace.create({ userId: user._id, origin: 'demo', schemaVersion: data.version, data })
await publish(user._id, { slots: data.schedule as never, changeReason: 'Initial schedule' })

const questions = QUESTION_BANK.map((q) => {
  const options = q.options.map((text, i) => ({ label: 'ABCD'[i], text }))
  const subject = data.subjects.find((s) => s.id === subjectIdFor(q.subjectKey))!
  return {
    userId: user._id,
    origin: 'manual',
    rawText: q.text,
    questionText: q.text,
    questionType: 'single_correct',
    options,
    correctAnswer: ['ABCD'[q.correctIndex]],
    answerSource: 'student',
    explanation: q.explanation,
    subjectId: subject.id,
    subjectName: subject.name,
    chapterId: chapterIdFor(q.subjectKey, q.chapter),
    chapterName: q.chapter,
    topicId: topicIdFor(q.subjectKey, q.chapter, q.topic),
    topicName: q.topic,
    difficulty: q.difficulty,
    status: 'verified',
    verifiedAt: new Date(),
    extractionConfidence: 1,
    flags: ['sample_data'],
    contentHash: normalizeForHash(q.text, options)
  }
})
await M.Question.insertMany(questions)
await disconnectDb()

const perSubject = data.subjects.map((s) => `${s.name}: ${questions.filter((q) => q.subjectId === s.id).length}`).join(', ')
console.log(`
Master account ready (development only)
  URL:       ${env.PUBLIC_APP_URL}/login
  Phone:     ${PHONE}  (log in with a one-time code — in development it is shown on the login
             screen, printed in the API log and listed at GET /api/dev/sms)
  Workspace: demo data (365 days), schedule v1 published
  Questions: ${questions.length} verified sample questions (${perSubject})
  Sample PDF for the upload flow: ${pdfPath}
Re-run this command at any time to reset the account to this state.`)
