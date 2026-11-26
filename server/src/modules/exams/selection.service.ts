import { Types } from 'mongoose'
import { seededRandom, shuffle } from '../../lib/crypto.js'
import { unprocessable } from '../../lib/errors.js'
import { MockTestAttempt, Question } from '../../models/index.js'
import type { Curriculum } from '../workspace/curriculum.service.js'

/*
 * Deterministic question selection. Works only from the student's actual
 * verified question bank; given the same bank and seed it returns the same
 * test. Never returns a short test — insufficient buckets raise a 422 with
 * per-bucket availability so the UI can explain exactly what is missing.
 */

export type MockType = 'full_mixed' | 'sectional' | 'subject_full' | 'chapter' | 'topic' | 'practice'

export interface SelectionConfig {
  subjectIds: string[]
  chapterIds: string[]
  topicIds: string[]
  distribution: Array<{ subjectId: string; count: number }>
  questionCount: number
  selectionMethod: 'random' | 'difficulty' | 'topic'
  difficultyDistribution: { easy: number; medium: number; hard: number }
  avoidRecentDays: number
}

export interface BucketReport {
  key: string
  label: string
  requested: number
  available: number
  detail?: Array<{ level: string; requested: number; available: number }>
}

interface Bucket {
  key: string
  label: string
  filter: Record<string, unknown>
  count: number
}

interface Candidate {
  _id: Types.ObjectId
  difficulty: string
  topicId: string | null
}

export function buildBuckets(type: MockType, cfg: SelectionConfig, cur: Curriculum): Bucket[] {
  const subjectName = (id: string) => cur.subject(id)?.name ?? id
  switch (type) {
    case 'full_mixed':
    case 'sectional': {
      if (!cfg.distribution.length) throw unprocessable('Set how many questions to take from each subject.', 'DISTRIBUTION_REQUIRED')
      if (type === 'sectional' && cfg.distribution.length < 2) throw unprocessable('A sectional test needs at least two subjects.', 'INVALID_CONFIG')
      const ids = new Set<string>()
      return cfg.distribution.map((d) => {
        if (!cur.subject(d.subjectId)) throw unprocessable('Unknown subject in distribution', 'UNKNOWN_SUBJECT')
        if (ids.has(d.subjectId)) throw unprocessable('A subject appears twice in the distribution.', 'INVALID_CONFIG')
        ids.add(d.subjectId)
        return { key: d.subjectId, label: subjectName(d.subjectId), filter: { subjectId: d.subjectId }, count: d.count }
      })
    }
    case 'subject_full': {
      if (cfg.subjectIds.length !== 1 || !cur.subject(cfg.subjectIds[0])) throw unprocessable('Choose exactly one subject.', 'INVALID_CONFIG')
      return [{ key: cfg.subjectIds[0], label: subjectName(cfg.subjectIds[0]), filter: { subjectId: cfg.subjectIds[0] }, count: cfg.questionCount }]
    }
    case 'chapter': {
      if (!cfg.chapterIds.length) throw unprocessable('Choose at least one chapter.', 'INVALID_CONFIG')
      for (const id of cfg.chapterIds) if (!cur.chapter(id)) throw unprocessable('Unknown chapter', 'UNKNOWN_CHAPTER')
      const label = cfg.chapterIds.map((id) => cur.chapter(id)!.name).join(', ')
      return [{ key: 'chapters', label, filter: { chapterId: { $in: cfg.chapterIds } }, count: cfg.questionCount }]
    }
    case 'topic': {
      if (!cfg.topicIds.length) throw unprocessable('Choose at least one topic.', 'INVALID_CONFIG')
      for (const id of cfg.topicIds) if (!cur.topic(id)) throw unprocessable('Unknown topic', 'UNKNOWN_TOPIC')
      const label = cfg.topicIds.map((id) => cur.topic(id)!.name).join(', ')
      return [{ key: 'topics', label, filter: { topicId: { $in: cfg.topicIds } }, count: cfg.questionCount }]
    }
    default:
      throw unprocessable('Unsupported test type for selection', 'INVALID_CONFIG')
  }
}

/** Largest-remainder apportionment of `total` by percentage weights. */
export function apportion(total: number, weights: Record<string, number>) {
  const sumW = Object.values(weights).reduce((a, b) => a + b, 0)
  if (sumW <= 0) return Object.fromEntries(Object.keys(weights).map((k) => [k, 0]))
  const raw = Object.entries(weights).map(([k, w]) => ({ k, exact: (total * w) / sumW }))
  const out: Record<string, number> = Object.fromEntries(raw.map((r) => [r.k, Math.floor(r.exact)]))
  let left = total - Object.values(out).reduce((a, b) => a + b, 0)
  raw.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))
  for (const r of raw) {
    if (left <= 0) break
    out[r.k] += 1
    left -= 1
  }
  return out
}

function pickFromBucket(cands: Candidate[], bucket: Bucket, cfg: SelectionConfig, random: () => number) {
  if (cfg.selectionMethod === 'difficulty') {
    const want = apportion(bucket.count, cfg.difficultyDistribution)
    const detail = (['easy', 'medium', 'hard'] as const).map((level) => ({
      level,
      requested: want[level] ?? 0,
      available: cands.filter((c) => c.difficulty === level).length
    }))
    const ok = detail.every((d) => d.available >= d.requested)
    const picked = ok ? detail.flatMap((d) => shuffle(cands.filter((c) => c.difficulty === d.level), random).slice(0, d.requested)) : []
    return { picked, ok, detail }
  }
  if (cands.length < bucket.count) return { picked: [], ok: false }
  if (cfg.selectionMethod === 'topic') {
    const groups = new Map<string, Candidate[]>()
    for (const c of shuffle(cands, random)) groups.set(c.topicId ?? '_untagged', [...(groups.get(c.topicId ?? '_untagged') ?? []), c])
    const queues = shuffle(Array.from(groups.values()), random)
    const picked: Candidate[] = []
    while (picked.length < bucket.count) {
      for (const q of queues) {
        const next = q.shift()
        if (next && picked.length < bucket.count) picked.push(next)
      }
    }
    return { picked, ok: true }
  }
  return { picked: shuffle(cands, random).slice(0, bucket.count), ok: true }
}

export async function selectQuestions(userId: Types.ObjectId, type: MockType, cfg: SelectionConfig, cur: Curriculum, seed: number) {
  const buckets = buildBuckets(type, cfg, cur)
  if (cfg.selectionMethod === 'difficulty') {
    const d = cfg.difficultyDistribution
    if (d.easy + d.medium + d.hard !== 100) throw unprocessable('Difficulty percentages must add up to 100.', 'INVALID_CONFIG')
  }
  let exclude: Types.ObjectId[] = []
  if (cfg.avoidRecentDays > 0) {
    const since = new Date(Date.now() - cfg.avoidRecentDays * 86_400_000)
    const recent = await MockTestAttempt.find({ userId, startedAt: { $gte: since } }).select('questions.questionId').lean()
    exclude = recent.flatMap((a) => a.questions.map((q) => q.questionId))
  }
  const random = seededRandom(seed)
  const reports: BucketReport[] = []
  const picked: Types.ObjectId[] = []
  for (const bucket of buckets) {
    const cands = (await Question.find({ userId, status: 'verified', _id: { $nin: exclude }, ...bucket.filter })
      .select('_id difficulty topicId')
      .sort({ _id: 1 })
      .lean()) as Candidate[]
    const r = pickFromBucket(cands, bucket, cfg, random)
    reports.push({ key: bucket.key, label: bucket.label, requested: bucket.count, available: cands.length, detail: 'detail' in r ? r.detail : undefined })
    if (r.ok) picked.push(...r.picked.map((c) => c._id))
  }
  const ok = reports.every((r) => r.available >= r.requested && (!r.detail || r.detail.every((d) => d.available >= d.requested)))
  return { ok, questionIds: ok ? picked : [], reports, total: buckets.reduce((a, b) => a + b.count, 0) }
}

export function insufficientError(reports: BucketReport[], avoidRecentDays: number) {
  const short = reports.filter((r) => r.available < r.requested || r.detail?.some((d) => d.available < d.requested))
  const lines = short.map((r) => `${r.label}: ${r.available} verified available, ${r.requested} requested`)
  return unprocessable(
    `Not enough verified questions in your bank. ${lines.join('; ')}.${avoidRecentDays ? ' (Recently attempted questions are excluded.)' : ''}`,
    'INSUFFICIENT_QUESTIONS',
    { buckets: reports }
  )
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31)
export const toOid = (id: string) => new Types.ObjectId(id)
