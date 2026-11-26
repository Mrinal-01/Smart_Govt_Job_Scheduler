import type { Types } from 'mongoose'
import { conflict, notFound, unprocessable } from '../../lib/errors.js'
import { MockTest, MockTestAttempt } from '../../models/index.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { insufficientError, newSeed, selectQuestions, type MockType, type SelectionConfig } from './selection.service.js'

type Oid = Types.ObjectId

export interface MockTestConfigInput extends SelectionConfig {
  durationMinutes: number
  marksPerQuestion: number
  negativeMarks: number
  shuffleQuestions: boolean
  shuffleOptions: boolean
  instructions: string
}

function normalize(type: MockType, cfg: MockTestConfigInput): MockTestConfigInput {
  if (type === 'full_mixed' || type === 'sectional') {
    const total = cfg.distribution.reduce((a, d) => a + d.count, 0)
    if (total < 1) throw unprocessable('The distribution must contain at least one question.', 'INVALID_CONFIG')
    return { ...cfg, questionCount: total, subjectIds: cfg.distribution.map((d) => d.subjectId) }
  }
  if (cfg.negativeMarks > cfg.marksPerQuestion) throw unprocessable('Negative marks cannot exceed marks per question.', 'INVALID_CONFIG')
  return cfg
}

export async function previewSelection(userId: Oid, type: MockType, cfg: MockTestConfigInput) {
  const cur = await loadCurriculum(userId)
  const c = normalize(type, cfg)
  const r = await selectQuestions(userId, type, c, cur, newSeed())
  return { ok: r.ok, total: r.total, buckets: r.reports }
}

export async function createMockTest(userId: Oid, input: { name: string; type: MockType; config: MockTestConfigInput; saveAsTemplate?: boolean }) {
  if (input.type === 'practice') throw unprocessable('Practice tests are created from attempt reviews.', 'INVALID_CONFIG')
  const cur = await loadCurriculum(userId)
  const config = normalize(input.type, input.config)
  const seed = newSeed()
  const r = await selectQuestions(userId, input.type, config, cur, seed)
  if (!r.ok) throw insufficientError(r.reports, config.avoidRecentDays)
  let templateId = null
  if (input.saveAsTemplate) {
    const template = await MockTest.create({ userId, kind: 'template', name: input.name, type: input.type, config })
    templateId = template._id
  }
  const test = await MockTest.create({ userId, kind: 'test', name: input.name, type: input.type, config, questionIds: r.questionIds, seed, templateId })
  return { test: test.toObject(), buckets: r.reports }
}

export async function createTemplate(userId: Oid, input: { name: string; type: MockType; config: MockTestConfigInput }) {
  await loadCurriculum(userId)
  const config = normalize(input.type, input.config)
  return (await MockTest.create({ userId, kind: 'template', name: input.name, type: input.type, config })).toObject()
}

export async function generateFromTemplate(userId: Oid, templateId: Oid, name?: string) {
  const template = await MockTest.findOne({ _id: templateId, userId, kind: 'template', archivedAt: null }).lean()
  if (!template) throw notFound('Template')
  const cur = await loadCurriculum(userId)
  const seed = newSeed()
  const config = template.config as unknown as MockTestConfigInput
  const r = await selectQuestions(userId, template.type as MockType, config, cur, seed)
  if (!r.ok) throw insufficientError(r.reports, config.avoidRecentDays)
  const test = await MockTest.create({
    userId,
    kind: 'test',
    name: name ?? `${template.name} — ${new Date().toISOString().slice(0, 10)}`,
    type: template.type,
    config,
    questionIds: r.questionIds,
    seed,
    templateId: template._id
  })
  return { test: test.toObject(), buckets: r.reports }
}

export async function listMockTests(userId: Oid, kind: 'test' | 'template') {
  const tests = await MockTest.find({ userId, kind, archivedAt: null }).sort({ createdAt: -1 }).limit(200).lean()
  if (kind === 'template') return tests
  const attempts = await MockTestAttempt.find({ userId, mockTestId: { $in: tests.map((t) => t._id) } })
    .select('mockTestId status result.marks result.maxMarks result.accuracy submittedAt startedAt deadlineAt')
    .sort({ createdAt: -1 })
    .lean()
  return tests.map((t) => {
    const mine = attempts.filter((a) => String(a.mockTestId) === String(t._id))
    return {
      ...t,
      questionCount: t.questionIds.length,
      questionIds: undefined,
      attempts: mine.length,
      inProgressAttemptId: mine.find((a) => a.status === 'in_progress' && a.deadlineAt > new Date())?._id ?? null,
      lastResult: mine.find((a) => a.status !== 'in_progress')?.result ?? null
    }
  })
}

export async function getMockTest(userId: Oid, id: Oid) {
  const t = await MockTest.findOne({ _id: id, userId, archivedAt: null }).lean()
  if (!t) throw notFound('Mock test')
  return { ...t, questionCount: t.questionIds.length }
}

export async function archiveMockTest(userId: Oid, id: Oid) {
  const running = await MockTestAttempt.exists({ userId, mockTestId: id, status: 'in_progress' })
  if (running) throw conflict('Finish the running attempt before deleting this test.', 'ATTEMPT_RUNNING')
  const r = await MockTest.updateOne({ _id: id, userId, archivedAt: null }, { $set: { archivedAt: new Date() } })
  if (!r.matchedCount) throw notFound('Mock test')
}
