import fs from 'node:fs/promises'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { createApp } from '../src/app.js'
import { connectDb } from '../src/db.js'
import { env } from '../src/config/env.js'
import { devOutbox } from '../src/integrations/mail.js'

export const app = createApp()
export const CSRF = { 'X-StudyOS-CSRF': '1' }

/** Connect once per test file to a unique database; wipe collections between tests. */
export function useTestDb() {
  beforeAll(async () => {
    await connectDb(env.MONGODB_URI)
  })
  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections()
    await Promise.all(collections.map((c) => c.deleteMany({})))
    devOutbox.length = 0
  })
  afterAll(async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
    await fs.rm(env.storageDir, { recursive: true, force: true })
  })
}

export const PASSWORD = 'Correct-horse-9'

export function lastMailToken(tag: string, to?: string) {
  const mail = devOutbox.find((m) => m.tag === tag && (!to || m.to === to))
  if (!mail?.link) throw new Error(`No ${tag} mail found`)
  return new URL(mail.link).searchParams.get('token')!
}

export function refreshCookie(res: request.Response) {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
  const c = raw.find((x) => x.startsWith('studyos_rt='))
  return c ? c.split(';')[0] : null
}

export async function registerVerified(email = 'student@example.com', name = 'Test Student') {
  await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true })
    .expect(201)
  await request(app).post('/api/auth/verify-email').send({ token: lastMailToken('verify-email', email) }).expect(200)
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)
  return { token: login.body.accessToken as string, cookie: refreshCookie(login)!, user: login.body.user }
}

/** A small but realistic curriculum: 4 subjects × 1–2 chapters × 2–3 topics. */
export function workspaceData() {
  const subjects = [
    { id: 'sub_math', name: 'Mathematics', shortName: 'Maths' },
    { id: 'sub_science', name: 'Physical Science', shortName: 'Science' },
    { id: 'sub_reasoning', name: 'Reasoning', shortName: 'Reasoning' },
    { id: 'sub_current', name: 'Current Affairs', shortName: 'CA' }
  ]
  const topic = (subjectId: string, chapterId: string, id: string, name: string) => ({
    id,
    name,
    subjectId,
    chapterId,
    initialLearningDate: null,
    revisions: [],
    formulas: [],
    keyPoints: [],
    questionsAttempted: 0,
    questionsCorrect: 0
  })
  const chapters = [
    { id: 'ch_math_pct', subjectId: 'sub_math', name: 'Percentage', topics: [topic('sub_math', 'ch_math_pct', 'tp_pct_basics', 'Basics of Percentage'), topic('sub_math', 'ch_math_pct', 'tp_pct_succ', 'Successive Change')] },
    { id: 'ch_math_ratio', subjectId: 'sub_math', name: 'Ratio', topics: [topic('sub_math', 'ch_math_ratio', 'tp_ratio_basics', 'Basics of Ratio')] },
    { id: 'ch_sci_force', subjectId: 'sub_science', name: 'Force and Motion', topics: [topic('sub_science', 'ch_sci_force', 'tp_newton', "Newton's Laws"), topic('sub_science', 'ch_sci_force', 'tp_eqm', 'Equations of Motion')] },
    { id: 'ch_rea_series', subjectId: 'sub_reasoning', name: 'Series', topics: [topic('sub_reasoning', 'ch_rea_series', 'tp_num_series', 'Number Series'), topic('sub_reasoning', 'ch_rea_series', 'tp_letter_series', 'Letter Series')] },
    { id: 'ch_ca_nat', subjectId: 'sub_current', name: 'National', topics: [topic('sub_current', 'ch_ca_nat', 'tp_schemes', 'Government Schemes'), topic('sub_current', 'ch_ca_nat', 'tp_awards', 'Awards')] }
  ]
  return {
    version: 3,
    profile: { name: 'Test Student', email: 'x', targetExam: 'RRB Group D', examDate: null, joinedAt: '2026-01-01' },
    settings: { revisionIntervals: [1, 3, 7, 15, 30], dailyTargetMinutes: 360, weeklyTargetMinutes: 2400 },
    subjects,
    chapters,
    schedule: [],
    sessions: {},
    logs: [],
    mistakes: [],
    questions: [],
    mockTests: [],
    attempts: [],
    aiMessages: [],
    seededAt: new Date().toISOString()
  }
}

export async function withWorkspace(token: string) {
  await request(app).post('/api/workspace').set('Authorization', `Bearer ${token}`).send({ origin: 'fresh', data: workspaceData() }).expect(201)
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
