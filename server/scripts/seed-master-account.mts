/**
 * Development demo data: creates (or resets) the MASTER ACCOUNT with two weeks of realistic study
 * so every feature has something to show.
 *
 *   npm run seed:master                     (from the project root) — resets only the master account
 *   npm run seed:master -- --reset-all      wipes the WHOLE database first, then seeds (development only)
 *
 * How the data is made: nothing is hand-inserted into the study engine. The script moves the app's
 * clock (lib/clock.ts) through the last two weeks and drives the real services — publish the schedule,
 * revise carryover, start/complete sessions, revise same-day topics, Sunday review, overrides, skips —
 * so every session, revision obligation, attempt and override is exactly what a student would produce.
 *
 * Result (relative to the day you run it, student time zone Asia/Kolkata):
 *   - last week + this week of cycle study (4 subjects × 2 cycles, Mon–Sat)
 *   - last Sunday's weekly review completed for all 4 subjects; this week's review building up (4 subjects)
 *   - one skipped session, one missed session, two emergency overrides (one revision still overdue)
 *   - a published schedule change (v2) inside the 7-day change window
 *   - today: Mathematics already revised and studied (if the time has passed); other subjects locked
 *     behind their previous-day revision so you can test the gates yourself
 *   - Question Hub: 36 ready sample questions, a real PDF upload processed by the pipeline,
 *     questions waiting for an AI answer and one needing review
 *   - two finished mock tests (with Mistake Bank entries) and one test ready to take
 *
 * Login: MASTER_ACCOUNT_PHONE (default +91 90000 00001) with a one-time code — in development the code
 * is shown on the login screen, printed in the API log and listed at GET /api/dev/sms.
 * Refuses to run when NODE_ENV=production.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose, { Types } from 'mongoose'
import { env } from '../src/config/env.ts'
import { connectDb, disconnectDb } from '../src/db.ts'
import * as M from '../src/models/index.ts'
import { clock } from '../src/lib/clock.ts'
import { addDays, dateKey } from '../src/lib/dates.ts'
import { normalizePhone } from '../src/lib/phone.ts'
import { publish } from '../src/modules/schedule/schedule.service.ts'
import * as plan from '../src/modules/plan/plan.service.ts'
import { completeObligation, startObligation } from '../src/modules/plan/plan.revision.ts'
import { weekStartOf } from '../src/modules/plan/plan.context.ts'
import { createMockTest } from '../src/modules/exams/mockTest.service.ts'
import { configSchema } from '../src/modules/exams/mockTest.routes.ts'
import { saveAnswers, startAttempt, submitAttempt } from '../src/modules/exams/attempt.service.ts'
import { normalizeForHash } from '../src/modules/documents/extraction/questionParser.ts'
import { processDocument } from '../src/modules/documents/pipeline.ts'
import { sha256 } from '../src/lib/crypto.ts'
import { storage, storageKeyFor } from '../src/integrations/storage.ts'
import { buildSeedState, subjectIdFor, summarizeDay } from '../../src/data/seed.ts'
import type { SessionRecord, StudyState } from '../../src/types/index.ts'
import { QUESTION_BANK } from '../../src/data/questions.ts'

if (env.isProd) {
  console.error('Refusing to seed demo data with NODE_ENV=production.')
  process.exit(1)
}

const RESET_ALL = process.argv.includes('--reset-all')
const normalized = normalizePhone(process.env.MASTER_ACCOUNT_PHONE ?? '+919000000001')
if ('error' in normalized) {
  console.error(`MASTER_ACCOUNT_PHONE is invalid: ${normalized.error}`)
  process.exit(1)
}
const PHONE = normalized.phone
const NAME = 'Demo Student'
const TZ = 'Asia/Kolkata'
const here = path.dirname(fileURLToPath(import.meta.url))
const pdfPath = path.resolve(here, '../../samples/sample-question-paper.pdf')

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const realNow = new Date()
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`)
const at = (d: Date) => {
  clock.now = () => new Date(d)
}
const minus = (hhmm: string, mins: number) => {
  const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) - mins
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
/** Deterministic "random" so every run produces the same story. */
let seedState = 7
const rand = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648
  return seedState / 2147483648
}
const between = (a: number, b: number) => Math.round(a + rand() * (b - a))

/* ------------------------------------------------------------------ */
/* reset                                                               */
/* ------------------------------------------------------------------ */

await connectDb(env.MONGODB_URI)
if (RESET_ALL) {
  const db = mongoose.connection.db!
  console.log(`Resetting the whole database "${db.databaseName}"…`)
  await db.dropDatabase()
  // Model.init() is memoized, so indexes must be rebuilt explicitly after a drop.
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).createIndexes()))
  await fs.rm(env.storageDir, { recursive: true, force: true })
} else {
  const existing = await M.User.findOne({ phone: PHONE })
  if (existing) {
    const uid = existing._id
    const owned = [
      M.RefreshSession, M.StudyWorkspace, M.UserSettings, M.Notification, M.Schedule, M.ScheduleVersion, M.StudySession,
      M.RevisionObligation, M.RevisionAttempt, M.GateOverride, M.UploadedDocument, M.ProcessingJob, M.MockTest,
      M.MockTestAttempt, M.MockTestAnswer, M.ExamMistake, M.AIUsageLog, M.CustomSound
    ]
    for (const model of owned) await (model as unknown as { deleteMany: (f: object) => Promise<unknown> }).deleteMany({ userId: uid })
    await M.Question.deleteMany({ uploadedBy: uid })
    await M.User.deleteOne({ _id: uid })
    await fs.rm(path.join(env.storageDir, String(uid)), { recursive: true, force: true })
  }
  await M.PhoneOtp.deleteMany({ phone: PHONE })
}

/* ------------------------------------------------------------------ */
/* account, workspace, settings                                        */
/* ------------------------------------------------------------------ */

const today = dateKey(realNow, TZ)
const start = addDays(weekStartOf(today), -7) // Monday of last week
at(ist(start, '05:00'))

const user = await M.User.create({ name: NAME, phone: PHONE, phoneVerifiedAt: realNow, termsAcceptedAt: realNow, status: 'active' })
const uid = user._id as Types.ObjectId
const data: StudyState = buildSeedState(realNow)
data.profile = { ...data.profile, name: NAME, email: '' }
await M.StudyWorkspace.create({ userId: uid, origin: 'demo', schemaVersion: data.version, data })
await M.UserSettings.create({ userId: uid, timezone: TZ })

// Schedule v1 is the baseline (free), effective from the first simulated day.
await publish(uid, { slots: data.schedule as never, changeReason: 'Initial cycle timetable' })

// Topics are studied in syllabus order, per subject.
const topicQueue = new Map<string, string[]>()
for (const s of data.subjects) topicQueue.set(s.id, data.chapters.filter((c) => c.subjectId === s.id).flatMap((c) => c.topics.map((t) => t.id)))
const cursor = new Map<string, number>()
const nextTopics = (subjectId: string, withPartial: boolean) => {
  const list = topicQueue.get(subjectId) ?? []
  const i = cursor.get(subjectId) ?? 0
  cursor.set(subjectId, i + 1)
  const topics: Array<{ topicId: string; completion: 'completed' | 'partial' }> = [{ topicId: list[i % list.length], completion: 'completed' }]
  if (withPartial && list.length > 1) topics.push({ topicId: list[(i + 1) % list.length], completion: 'partial' })
  return topics
}

/* ------------------------------------------------------------------ */
/* the engine-driven story                                             */
/* ------------------------------------------------------------------ */

const stats = { sessions: 0, revisions: 0, overrides: 0, skipped: 0, missed: 0, weekly: 0 }

async function revise(obligationId: string, finishAt: Date, minutes = 14) {
  at(new Date(finishAt.getTime() - minutes * 60_000))
  await startObligation(uid, new Types.ObjectId(obligationId))
  at(finishAt)
  const o = await M.RevisionObligation.findById(obligationId).lean()
  if (!o || o.status === 'completed') return
  const attempted = o.type === 'weekly' ? 10 : 5
  const correct = Math.min(attempted, between(Math.round(attempted * 0.6), attempted))
  await completeObligation(uid, new Types.ObjectId(obligationId), {
    topicsRevised: o.topics.map((t) => t.topicId),
    questionsAttempted: attempted,
    questionsCorrect: correct,
    confidence: between(3, 5),
    notes: o.type === 'weekly' ? 'Weekly recap done; formulas rewritten from memory.' : ''
  })
  stats.revisions += 1
  if (o.type === 'weekly') stats.weekly += 1
}

type DayView = Awaited<ReturnType<typeof plan.getDay>>
type View = DayView['sessions'][number]

/** Clears the session's revision locks (or overrides them), then studies it. */
async function study(date: string, s: View, opts: { override?: string; partial?: boolean } = {}) {
  const id = new Types.ObjectId(s.id!)
  at(ist(date, minus(s.startTime, 1)))
  const fresh = (await plan.getSession(uid, id)).session
  if (fresh.locked) {
    if (opts.override) {
      await plan.overrideGate(uid, id, opts.override)
      stats.overrides += 1
    } else {
      const blocking = fresh.lockReasons.filter((r) => r.obligationId)
      for (const [i, r] of blocking.entries()) await revise(r.obligationId!, ist(date, minus(s.startTime, 1 + (blocking.length - 1 - i) * 15)))
      at(ist(date, minus(s.startTime, 1)))
    }
  }
  at(ist(date, s.startTime))
  await plan.startSession(uid, id)
  at(ist(date, minus(s.endTime, between(2, 9))))
  const target = s.practiceTarget || 10
  const attempted = between(Math.round(target * 0.7), target)
  await plan.completeSession(uid, id, {
    topics: s.sessionType === 'learning' ? nextTopics(s.subjectId, Boolean(opts.partial)) : [],
    questionsAttempted: attempted,
    questionsCorrect: between(Math.round(attempted * 0.55), attempted),
    confidence: between(3, 5),
    notes: rand() < 0.3 ? 'Made a formula card for this; revise tomorrow.' : ''
  })
  stats.sessions += 1
}

// Special days are picked among real study days (Mon–Sat) counting back from yesterday,
// so the story works whatever weekday you run the seed on.
const studyDaysBack: string[] = []
for (let d = addDays(today, -1); d >= start; d = addDays(d, -1)) if (weekday(d) !== 0) studyDaysBack.push(d)
const special = { override: studyDaysBack[0], missed: studyDaysBack[1], lateRevision: studyDaysBack[2], change: studyDaysBack[1], skipped: studyDaysBack[3] }

for (let date = start; date < today; date = addDays(date, 1)) {
  at(ist(date, '05:00'))
  const day = await plan.getDay(uid, date)
  if (weekday(date) === 0) {
    // Sunday: weekly review of Mon–Sat for every subject, then the Sunday revision sessions of the timetable.
    const weekly = await M.RevisionObligation.find({ userId: uid, type: 'weekly', weekStart: addDays(date, -6) }).sort({ subjectName: 1 }).lean()
    for (const [i, o] of weekly.entries()) await revise(String(o._id), ist(date, minus('10:00', -i * 35)), 30)
    for (const s of day.sessions) if (s.id && s.status === 'scheduled') await study(date, s)
    continue
  }
  for (const s of day.sessions) {
    if (!s.id || s.status !== 'scheduled') continue
    const subj = s.subjectName
    if (date === special.skipped && subj === 'Current Affairs' && s.cycleNumber === 2) {
      at(ist(date, minus(s.startTime, 5)))
      await plan.skipSession(uid, new Types.ObjectId(s.id), 'Family function in the evening')
      stats.skipped += 1
      continue
    }
    if (date === special.missed && subj === 'Reasoning' && s.cycleNumber === 2) {
      stats.missed += 1 // never started → recorded as missed when the day ends
      continue
    }
    if (date === special.lateRevision && subj === 'Physical Science' && s.cycleNumber === 1) {
      await study(date, s, { override: 'Coaching class test moved to this morning — will revise at lunch' })
      // …and the revision is done later that day, so the override shows in history but nothing stays open.
      const open = await M.RevisionObligation.find({ userId: uid, subjectId: s.subjectId, type: 'next_day', status: { $ne: 'completed' }, dueDate: { $lte: date } }).lean()
      for (const o of open) await revise(String(o._id), ist(date, '13:30'))
      continue
    }
    if (date === special.override && subj === 'Reasoning') {
      // Yesterday: Reasoning was started under an emergency override and its carryover was never revised,
      // so it is still overdue today (a bypassed revision is never counted as done).
      await study(date, s, { override: 'Power cut in the morning — revising tonight', partial: false })
      continue
    }
    await study(date, s, { partial: rand() < 0.2 })
  }
  if (date === special.change) {
    // A schedule change published inside the rolling 7-day window (uses 1 of 3 changes).
    at(ist(date, '21:00'))
    const slots = (await M.ScheduleVersion.findOne({ userId: uid }).sort({ version: -1 }).lean())!.slots as unknown as Array<Record<string, unknown>>
    const changed = slots.map((x) => (x.weekday === 0 && x.label === 'Weekly Revision — Current Affairs' ? { ...x, label: 'Weekly Revision — Current Affairs & GK', learningTarget: 'Revise the week’s current affairs + static GK' } : x))
    await publish(uid, { slots: changed as never, changeReason: 'Add static GK to the Sunday review', effectiveFrom: addDays(date, 1) })
  }
}

// Today: Mathematics is revised and studied if its time has passed; the rest is left for you to try.
at(realNow)
const nowIst = dateKey(realNow, TZ) === today ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(realNow) : '00:00'
const todayView = await plan.getDay(uid, today)
const mathsFirst = todayView.sessions.find((s) => s.subjectName === 'Mathematics' && s.sessionType === 'learning')
const todayDone: string[] = []
if (mathsFirst?.id && toMin(nowIst) > toMin(mathsFirst.endTime)) {
  await study(today, mathsFirst)
  todayDone.push(mathsFirst.slotId)
}
at(realNow)
await plan.getDay(uid, today) // generates anything due "now"

/* ------------------------------------------------------------------ */
/* workspace copy of today's sessions = server state                   */
/* ------------------------------------------------------------------ */

const ws = await M.StudyWorkspace.findOne({ userId: uid })
const wsData = ws!.data as StudyState
for (const [key, rec] of Object.entries(wsData.sessions as Record<string, SessionRecord>)) {
  if (rec.date !== today) continue
  const done = todayDone.includes(rec.slotId)
  const server = done ? await M.StudySession.findOne({ userId: uid, date: today, slotId: rec.slotId }).lean() : null
  const topic = server?.completion?.topics[0]
  wsData.sessions[key] = {
    ...rec,
    status: done ? 'completed' : 'upcoming',
    startedAt: server?.startedAt?.toISOString() ?? null,
    accumulatedSeconds: (server?.actualMinutes ?? 0) * 60,
    runningSince: null,
    revisionMarked: false,
    revisionSkippedReason: null,
    revisionChecklist: [],
    skipReason: null,
    snoozedUntil: null,
    remindedAt: null,
    graceUntil: null,
    completion:
      server && topic
        ? {
            chapterId: topic.chapterId,
            topicId: topic.topicId,
            topicName: topic.topicName,
            learningCompleted: true,
            revisionCompleted: false,
            practiceCompleted: true,
            questionsAttempted: server.completion!.questionsAttempted,
            correctAnswers: server.completion!.questionsCorrect,
            incorrectAnswers: server.completion!.questionsAttempted - server.completion!.questionsCorrect,
            notes: server.completion!.notes,
            confidence: server.completion!.confidence ?? 3,
            durationMinutes: server.actualMinutes,
            completedAt: server.completedAt!.toISOString(),
            chapterMastered: false
          }
        : null
  }
}
// Today's daily log (header progress, dashboard) is recomputed from the aligned records.
const sum = summarizeDay(wsData, today)
wsData.logs = [
  ...wsData.logs.filter((l) => l.date !== today),
  {
    date: today,
    plannedMinutes: sum.plannedMinutes,
    actualMinutes: sum.actualMinutes,
    sessionsPlanned: sum.sessionsPlanned,
    sessionsCompleted: sum.sessionsCompleted,
    topicsCovered: sum.topicsCovered,
    revisionsCompleted: sum.revisionsCompleted,
    mockTests: 0,
    accuracy: sum.accuracy,
    subjectMinutes: sum.subjectMinutes,
    seed: false
  }
].sort((a, b) => (a.date < b.date ? -1 : 1))
ws!.markModified('data')
await ws!.save()

/* ------------------------------------------------------------------ */
/* Question Hub                                                        */
/* ------------------------------------------------------------------ */

const subjectByKey = (key: string) => data.subjects.find((s) => s.id === subjectIdFor(key as never))!
const taxonomy = (subjectName: string, chapter: string | null, topic: string | null) => ({
  subjectName,
  subjectKey: M.taxonomyKey(subjectName),
  chapterName: chapter,
  chapterKey: M.taxonomyKey(chapter),
  topicName: topic,
  topicKey: M.taxonomyKey(topic)
})
const sample = QUESTION_BANK.map((q) => {
  const options = q.options.map((text, i) => ({ label: 'ABCD'[i], text }))
  return {
    uploadedBy: uid,
    origin: 'manual',
    rawText: q.text,
    questionText: q.text,
    questionType: 'single_correct',
    options,
    correctAnswer: ['ABCD'[q.correctIndex]],
    answerSource: 'student',
    explanation: q.explanation,
    ...taxonomy(subjectByKey(q.subjectKey).name, q.chapter, q.topic),
    difficulty: q.difficulty,
    status: 'ready',
    answeredAt: realNow,
    extractionConfidence: 1,
    flags: ['sample_data'],
    contentHash: normalizeForHash(q.text, options)
  }
})
// Questions waiting for an AI answer (no answer key) and one that needs review.
const opt = (...xs: string[]) => xs.map((text, i) => ({ label: 'ABCD'[i], text }))
const extra = [
  { text: 'If 15 workers build a wall in 12 days, how many days will 20 workers take?', options: opt('8', '9', '10', '16'), tax: taxonomy('Mathematics', 'Time and Work', 'Work and Wages'), status: 'pending_answer' },
  { text: 'Find the odd one out: Mercury, Venus, Moon, Mars', options: opt('Mercury', 'Venus', 'Moon', 'Mars'), tax: taxonomy('Reasoning', 'Classification', 'Odd One Out'), status: 'pending_answer' },
  { text: 'Which vitamin is produced in the human skin in sunlight?', options: opt('Vitamin A', 'Vitamin B12', 'Vitamin C', 'Vitamin D'), tax: taxonomy('Physical Science', 'Biology Basics', 'Vitamins'), status: 'pending_answer' },
  { text: 'In the figure shown, find the value of angle x.', options: opt('30°', '45°', '60°', '90°'), tax: taxonomy('Mathematics', 'Geometry', 'Angles'), status: 'needs_review', flags: ['figure_missing'] }
].map((q) => ({
  uploadedBy: uid,
  origin: 'manual',
  rawText: q.text,
  questionText: q.text,
  questionType: 'single_correct',
  options: q.options,
  correctAnswer: null,
  answerSource: null,
  ...q.tax,
  difficulty: 'medium',
  status: q.status,
  extractionConfidence: 1,
  flags: ['sample_data', ...(q.flags ?? [])],
  contentHash: normalizeForHash(q.text, q.options)
}))
await M.Question.bulkWrite([...sample, ...extra].map((q) => ({ updateOne: { filter: { contentHash: q.contentHash }, update: { $setOnInsert: q }, upsert: true } })) as never)

// A real PDF upload, processed by the same pipeline the app uses (text → parser → answer key → hub).
let pdfQuestions = 0
try {
  const file = await fs.readFile(pdfPath)
  const docId = new Types.ObjectId()
  const storageKey = storageKeyFor(String(uid), String(docId))
  await storage.put(storageKey, file)
  const science = data.subjects.find((s) => s.name === 'Physical Science')!
  await M.UploadedDocument.create({
    _id: docId,
    userId: uid,
    originalName: 'sample-question-paper.pdf',
    storageKey,
    sizeBytes: file.length,
    sha256: sha256(file),
    pageCount: 1,
    intent: { mockType: null, subjectIds: [science.id], subjectNames: [science.name] }
  })
  await processDocument(docId)
  pdfQuestions = await M.Question.countDocuments({ documentId: docId })
} catch (err) {
  console.warn('PDF sample could not be processed:', (err as Error).message)
}

/* ------------------------------------------------------------------ */
/* Mock tests                                                          */
/* ------------------------------------------------------------------ */

async function takeTest(testId: Types.ObjectId, accuracy: number, submittedAt: Date) {
  const { attemptId } = await startAttempt(uid, testId)
  const attempt = (await M.MockTestAttempt.findById(attemptId).lean())!
  await saveAnswers(
    uid,
    attemptId as Types.ObjectId,
    attempt.questions.map((q) => {
      const right = (q.correctAnswer ?? [])[0]
      const wrong = q.options.map((o) => o.label).find((l) => l !== right) ?? right
      return { questionId: String(q.questionId), selected: [rand() < accuracy ? right : wrong], visited: true, timeSpentSeconds: between(20, 70) }
    })
  )
  await submitAttempt(uid, attemptId as Types.ObjectId)
  const minutes = Math.round(attempt.durationSeconds / 60)
  await M.MockTestAttempt.updateOne(
    { _id: attemptId },
    { $set: { startedAt: new Date(submittedAt.getTime() - (minutes - 3) * 60_000), submittedAt, deadlineAt: new Date(submittedAt.getTime() + 3 * 60_000) } }
  )
  await M.ExamMistake.updateMany({ userId: uid, lastAttemptId: attemptId }, { $set: { lastSeenAt: submittedAt } })
}

const ids = Object.fromEntries(data.subjects.map((s) => [s.name, s.id]))
const lastSunday = addDays(weekStartOf(today), -1)
const weeklyTest = await createMockTest(uid, {
  name: 'Weekly mixed test',
  type: 'full_mixed',
  config: configSchema.parse({
    distribution: Object.values(ids).map((subjectId) => ({ subjectId, count: 5 })),
    durationMinutes: 20,
    negativeMarks: 0.25,
    instructions: 'Weekly test after Sunday revision.'
  })
})
await takeTest(weeklyTest.test._id as Types.ObjectId, 0.7, ist(lastSunday, '17:40'))
const mathsTest = await createMockTest(uid, {
  name: 'Mathematics — full subject',
  type: 'subject_full',
  config: configSchema.parse({ subjectIds: [ids['Mathematics']], questionCount: 9, durationMinutes: 12 })
})
await takeTest(mathsTest.test._id as Types.ObjectId, 0.6, ist(addDays(today, -2), '20:30'))
await createMockTest(uid, {
  name: 'Reasoning practice (not taken yet)',
  type: 'subject_full',
  config: configSchema.parse({ subjectIds: [ids['Reasoning']], questionCount: 8, durationMinutes: 10 })
})

/* ------------------------------------------------------------------ */

clock.now = () => new Date()
const counts = {
  sessions: await M.StudySession.countDocuments({ userId: uid }),
  revisionsOpen: await M.RevisionObligation.countDocuments({ userId: uid, status: { $ne: 'completed' } }),
  weeklyThisWeek: await M.RevisionObligation.countDocuments({ userId: uid, type: 'weekly', weekStart: weekStartOf(today) }),
  hub: await M.Question.countDocuments({}),
  mistakes: await M.ExamMistake.countDocuments({ userId: uid })
}
await disconnectDb()

console.log(`
Demo data ready (development only)${RESET_ALL ? ' — the whole database was reset' : ''}
  Login:      ${PHONE} → one-time code (shown on the login screen in development, also at /api/dev/sms)
  Study days: ${start} → ${today} · ${counts.sessions} sessions (${stats.sessions} completed, ${stats.skipped} skipped, ${stats.missed} missed)
  Revisions:  ${stats.revisions} completed (${stats.weekly} weekly) · ${counts.revisionsOpen} open now · ${stats.overrides} emergency overrides
  Sunday:     last week's review done for all subjects · this week: ${counts.weeklyThisWeek} subject(s) building up
  Today:      ${todayDone.length ? 'Mathematics revised and studied; ' : ''}other subjects locked behind their previous-day revision
  Hub:        ${counts.hub} questions (36 ready samples, ${pdfQuestions} from the sample PDF, 3 waiting for AI, 1 needs review)
  Tests:      2 finished (${counts.mistakes} Mistake Bank entries) + 1 ready to take
Run again at any time; the story is rebuilt relative to the current day.`)
