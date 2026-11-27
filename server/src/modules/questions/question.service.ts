import { Types } from 'mongoose'
import { env } from '../../config/env.js'
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js'
import { MockTest, MockTestAttempt, Question, taxonomyKey } from '../../models/index.js'
import { loadCurriculum, resolveTaxonomy, type Curriculum } from '../workspace/curriculum.service.js'
import { normalizeForHash } from '../documents/extraction/questionParser.js'
import { enqueueAnswering } from './answer.service.js'

/*
 * Central question hub. Every student can browse it and build tests from `ready` questions;
 * only a question's uploader may edit, confirm, reject or delete it. Anyone who took a
 * question in a finished test may report its answer as wrong.
 */

type Oid = Types.ObjectId
const LABELS = ['A', 'B', 'C', 'D', 'E']
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type LeanQuestion = NonNullable<Awaited<ReturnType<typeof findLean>>>
const findLean = (id: Oid) => Question.findById(id).lean()

/**
 * What a student sees. Answers of other students' questions stay hidden in the hub list so
 * the hub cannot be used to read answers before a test; they appear in test results.
 */
export function serializeQuestion(q: LeanQuestion, viewer: Oid, opts: { revealAnswer?: boolean } = {}) {
  const mine = q.uploadedBy ? String(q.uploadedBy) === String(viewer) : false
  const reveal = mine || Boolean(opts.revealAnswer)
  return {
    _id: q._id,
    origin: q.origin,
    documentId: q.documentId,
    source: q.source,
    questionText: q.questionText,
    rawText: mine ? q.rawText : undefined,
    questionType: q.questionType,
    options: q.options,
    correctAnswer: reveal ? q.correctAnswer : undefined,
    hasAnswer: Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0,
    answerSource: q.answerSource,
    answerConfidence: q.answerConfidence,
    answerExplanation: reveal ? q.answerExplanation : undefined,
    explanation: reveal ? q.explanation : undefined,
    subjectName: q.subjectName,
    chapterName: q.chapterName,
    topicName: q.topicName,
    difficulty: q.difficulty,
    status: q.status,
    extractionConfidence: q.extractionConfidence,
    flags: q.flags,
    aiCheck: { state: q.aiCheck?.state ?? null, note: mine ? (q.aiCheck?.note ?? null) : null },
    reportCount: (q.reports ?? []).length,
    mine,
    createdAt: (q as { createdAt?: Date }).createdAt
  }
}

export interface QuestionFilter {
  scope: 'hub' | 'mine'
  status?: string
  subjectId?: string
  subjectKey?: string
  difficulty?: string
  documentId?: string
  origin?: string
  q?: string
  page: number
  limit: number
}

async function subjectKeyOf(userId: Oid, f: Pick<QuestionFilter, 'subjectId' | 'subjectKey'>) {
  if (f.subjectKey) return taxonomyKey(f.subjectKey)
  if (!f.subjectId) return null
  const cur = await loadCurriculum(userId)
  return taxonomyKey(cur.subject(f.subjectId)?.name ?? f.subjectId)
}

export async function listQuestions(userId: Oid, f: QuestionFilter) {
  const filter: Record<string, unknown> = {}
  if (f.documentId) {
    const doc = new Types.ObjectId(f.documentId)
    filter.$or = [{ documentId: doc }, { alsoInDocuments: doc }]
  } else if (f.scope === 'mine') filter.uploadedBy = userId
  if (f.status) filter.status = f.status
  const key = await subjectKeyOf(userId, f)
  if (key) filter.subjectKey = key
  if (f.difficulty) filter.difficulty = f.difficulty
  if (f.origin) filter.origin = f.origin
  if (f.q) filter.questionText = { $regex: escapeRegex(f.q.slice(0, 100)), $options: 'i' }
  const [items, total] = await Promise.all([
    Question.find(filter)
      .sort(f.documentId ? { 'source.pageNumber': 1, createdAt: 1 } : { createdAt: -1 })
      .skip((f.page - 1) * f.limit)
      .limit(f.limit)
      .lean(),
    Question.countDocuments(filter)
  ])
  return { items: items.map((q) => serializeQuestion(q, userId)), total, page: f.page, limit: f.limit }
}

/** Hub-wide counts per subject and status, plus the viewer's own uploads. */
export async function questionStats(userId: Oid) {
  const [byStatus, bySubject, mine] = await Promise.all([
    Question.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Question.aggregate([
      { $group: { _id: { key: '$subjectKey', status: '$status' }, name: { $first: '$subjectName' }, n: { $sum: 1 } } },
      { $sort: { name: 1 } }
    ]),
    Question.aggregate([{ $match: { uploadedBy: userId } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
  ])
  const subjects = new Map<string, { subjectKey: string | null; subjectName: string; ready: number; pending_answer: number; needs_review: number; rejected: number }>()
  for (const row of bySubject) {
    const k = row._id.key ?? '_none'
    const entry = subjects.get(k) ?? { subjectKey: row._id.key, subjectName: row.name ?? 'No subject', ready: 0, pending_answer: 0, needs_review: 0, rejected: 0 }
    entry[row._id.status as 'ready'] = row.n
    subjects.set(k, entry)
  }
  return {
    byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
    mine: Object.fromEntries(mine.map((s) => [s._id, s.n])),
    subjects: Array.from(subjects.values()),
    ai: { configured: env.aiEnabled }
  }
}

/** Ready-question availability for each subject of the student's curriculum (test builder). */
export async function hubSummary(userId: Oid) {
  const cur = await loadCurriculum(userId)
  const keys = cur.subjects.map((s) => taxonomyKey(s.name))
  const rows = await Question.aggregate([
    { $match: { subjectKey: { $in: keys } } },
    { $group: { _id: { key: '$subjectKey', status: '$status' }, n: { $sum: 1 } } }
  ])
  const count = (key: string | null, status: string) => rows.find((r) => r._id.key === key && r._id.status === status)?.n ?? 0
  return {
    ai: { configured: env.aiEnabled },
    subjects: cur.subjects.map((s) => {
      const key = taxonomyKey(s.name)
      return { subjectId: s.id, subjectName: s.name, subjectKey: key, ready: count(key, 'ready'), pendingAnswer: count(key, 'pending_answer'), needsReview: count(key, 'needs_review') }
    })
  }
}

export async function getQuestion(userId: Oid, id: Oid) {
  const q = await Question.findById(id).lean()
  if (!q) throw notFound('Question')
  return serializeQuestion(q, userId)
}

async function ownQuestion(userId: Oid, id: Oid) {
  const q = await Question.findById(id)
  if (!q) throw notFound('Question')
  if (!q.uploadedBy || String(q.uploadedBy) !== String(userId)) throw forbidden('Only the student who uploaded this question can change it. You can report a wrong answer from your test results.')
  return q
}

export interface QuestionInput {
  questionText?: string
  questionType?: 'single_correct' | 'multiple_correct' | 'numeric' | 'true_false' | 'unknown'
  options?: Array<{ label?: string; text: string }>
  correctAnswer?: string[] | null
  explanation?: string | null
  subjectId?: string | null
  chapterId?: string | null
  topicId?: string | null
  difficulty?: 'easy' | 'medium' | 'hard' | 'unknown'
}

function normalizeOptions(options: Array<{ label?: string; text: string }>) {
  if (options.length > LABELS.length) throw unprocessable(`At most ${LABELS.length} options are supported.`, 'TOO_MANY_OPTIONS')
  return options.map((o, i) => ({ label: LABELS[i], text: o.text.trim() }))
}

export function checkAnswer(type: string, options: Array<{ label: string }>, answer: string[] | null | undefined) {
  if (!answer || !answer.length) return null
  if (type === 'numeric') {
    if (answer.length !== 1 || !Number.isFinite(Number(answer[0]))) throw unprocessable('A numeric answer must be a single number.', 'INVALID_ANSWER')
    return [String(Number(answer[0]))]
  }
  const labels = Array.from(new Set(answer.map((a) => a.toUpperCase())))
  if (!labels.every((l) => options.some((o) => o.label === l))) throw unprocessable('The answer must be one of the options.', 'INVALID_ANSWER')
  if (type !== 'multiple_correct' && labels.length > 1) throw unprocessable('This question type allows only one correct option.', 'INVALID_ANSWER')
  return labels.sort()
}

/** Everything a question needs before it can be used in a test (answer aside). */
export function usabilityProblems(q: { questionText: string; questionType: string; options: Array<{ text: string }>; subjectKey?: string | null }) {
  const problems: string[] = []
  if (!q.questionText.trim()) problems.push('Question text is empty.')
  if (q.questionType === 'unknown') problems.push('Choose a question type.')
  if (['single_correct', 'multiple_correct', 'true_false'].includes(q.questionType) && q.options.length < 2) problems.push('Add at least two options.')
  if (q.options.some((o) => !o.text.trim())) problems.push('One or more options are empty.')
  if (!q.subjectKey) problems.push('Assign a subject.')
  return problems
}

/** Curriculum ids → hub names/keys (the hub never stores per-student ids). */
function taxonomyFields(cur: Curriculum, input: { subjectId?: string | null; chapterId?: string | null; topicId?: string | null }) {
  const t = resolveTaxonomy(cur, input)
  return {
    subjectName: t.subjectName,
    subjectKey: taxonomyKey(t.subjectName),
    chapterName: t.chapterName,
    chapterKey: taxonomyKey(t.chapterName),
    topicName: t.topicName,
    topicKey: taxonomyKey(t.topicName)
  }
}

export async function createManualQuestion(userId: Oid, input: Required<Pick<QuestionInput, 'questionText'>> & QuestionInput) {
  const options = normalizeOptions(input.options ?? [])
  const type = input.questionType ?? (options.length >= 2 ? 'single_correct' : 'unknown')
  const answer = checkAnswer(type, options, input.correctAnswer)
  const cur = await loadCurriculum(userId)
  const tax = taxonomyFields(cur, input)
  const draft = { questionText: input.questionText.trim(), questionType: type, options, subjectKey: tax.subjectKey }
  const problems = usabilityProblems(draft)
  const status = problems.length ? 'needs_review' : answer ? 'ready' : 'pending_answer'
  let q
  try {
    q = await Question.create({
      uploadedBy: userId,
      origin: 'manual',
      rawText: input.questionText,
      ...draft,
      correctAnswer: answer,
      answerSource: answer ? 'student' : null,
      answeredAt: answer ? new Date() : null,
      explanation: input.explanation ?? null,
      difficulty: input.difficulty ?? 'unknown',
      status,
      extractionConfidence: 1,
      flags: problems.length ? ['incomplete'] : [],
      ...tax,
      contentHash: normalizeForHash(input.questionText, options)
    })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('This question is already in the question hub.', 'DUPLICATE_QUESTION')
    throw err
  }
  if (status === 'pending_answer') await enqueueAnswering([q._id])
  return serializeQuestion(q.toObject() as unknown as LeanQuestion, userId)
}

/**
 * Uploader edits. Setting an answer makes it a student answer (ready when usable); clearing it
 * sends the question back to AI answering. Content changes invalidate an AI answer.
 */
export async function updateQuestion(userId: Oid, id: Oid, input: QuestionInput) {
  const q = await ownQuestion(userId, id)
  const contentChanged = input.questionText !== undefined || input.options !== undefined || input.questionType !== undefined
  if (input.questionText !== undefined) q.questionText = input.questionText.trim()
  if (input.options !== undefined) q.set('options', normalizeOptions(input.options))
  if (input.questionType !== undefined) q.questionType = input.questionType
  if (input.correctAnswer !== undefined) {
    const answer = checkAnswer(q.questionType, q.options, input.correctAnswer)
    q.set('correctAnswer', answer)
    q.set({ answerSource: answer ? 'student' : null, answerConfidence: null, answerModel: null, answeredAt: answer ? new Date() : null, answerExplanation: answer ? q.answerExplanation : null })
  } else if (contentChanged && q.correctAnswer) {
    const stillValid = q.answerSource !== 'ai' && (q.questionType === 'numeric' || q.correctAnswer.every((a) => q.options.some((o) => o.label === a)))
    if (!stillValid) q.set({ correctAnswer: null, answerSource: null, answerConfidence: null, answerModel: null, answeredAt: null, answerExplanation: null })
  }
  if (input.explanation !== undefined) q.explanation = input.explanation
  if (input.difficulty !== undefined) q.difficulty = input.difficulty
  if (input.subjectId !== undefined || input.chapterId !== undefined || input.topicId !== undefined) {
    const cur = await loadCurriculum(userId)
    q.set(
      taxonomyFields(cur, {
        subjectId: input.subjectId ?? cur.subjects.find((s) => taxonomyKey(s.name) === q.subjectKey)?.id ?? null,
        chapterId: input.chapterId ?? null,
        topicId: input.topicId ?? null
      })
    )
  }
  q.contentHash = normalizeForHash(q.questionText, q.options)
  q.flags = q.flags.filter((f) => !['needs_subject', 'incomplete', 'reported', 'recheck_disagrees'].includes(f) || (f === 'needs_subject' && !q.subjectKey))
  const problems = usabilityProblems(q)
  const hasAnswer = Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0
  if (q.status !== 'rejected') q.status = problems.length ? 'needs_review' : hasAnswer ? 'ready' : 'pending_answer'
  q.set({ reports: hasAnswer && input.correctAnswer !== undefined ? [] : q.reports, 'aiCheck.state': null, 'aiCheck.recheck': false })
  try {
    await q.save()
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('Another question in the hub already has this exact content.', 'DUPLICATE_QUESTION')
    throw err
  }
  if (q.status === 'pending_answer') await enqueueAnswering([q._id])
  return serializeQuestion(q.toObject() as unknown as LeanQuestion, userId)
}

/** Uploader confirms a question that has an answer (e.g. a low-confidence extraction they checked). */
export async function confirmQuestion(userId: Oid, id: Oid) {
  const q = await ownQuestion(userId, id)
  const problems = usabilityProblems(q)
  if (problems.length) throw unprocessable(problems[0], 'CANNOT_CONFIRM', { problems })
  const hasAnswer = Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0
  q.status = hasAnswer ? 'ready' : 'pending_answer'
  q.flags = q.flags.filter((f) => !['incomplete', 'low_confidence'].includes(f))
  await q.save()
  if (!hasAnswer) await enqueueAnswering([q._id])
  return serializeQuestion(q.toObject() as unknown as LeanQuestion, userId)
}

export async function rejectQuestion(userId: Oid, id: Oid) {
  const q = await ownQuestion(userId, id)
  q.status = 'rejected'
  await q.save()
  return serializeQuestion(q.toObject() as unknown as LeanQuestion, userId)
}

/** Deleting a question other students already use in their tests only retires it. */
export async function deleteQuestion(userId: Oid, id: Oid) {
  const q = await ownQuestion(userId, id)
  const usedByOthers = await MockTest.exists({ userId: { $ne: userId }, questionIds: q._id })
  if (usedByOthers) {
    q.status = 'rejected'
    await q.save()
    return { retired: true }
  }
  await MockTest.updateMany({ userId, questionIds: q._id }, { $pull: { questionIds: q._id } })
  await Question.deleteOne({ _id: q._id })
  return { retired: false }
}

/**
 * "This answer is wrong." Only students who answered the question in a finished test may
 * report. The question leaves tests immediately and is re-checked by AI at higher effort.
 */
export async function reportQuestion(userId: Oid, id: Oid, reason: string) {
  const took = await MockTestAttempt.exists({ userId, status: { $ne: 'in_progress' }, 'questions.questionId': id })
  if (!took) throw forbidden('You can report a question after answering it in a finished test.')
  const q = await Question.findById(id)
  if (!q) throw notFound('Question')
  if ((q.reports ?? []).some((r) => String(r.userId) === String(userId))) return { alreadyReported: true, status: q.status }
  const wasUsable = q.status === 'ready'
  await Question.updateOne(
    { _id: q._id },
    {
      $push: { reports: { userId, reason: reason.trim().slice(0, 500), at: new Date() } },
      $addToSet: { flags: 'reported' },
      ...(wasUsable ? { $set: { status: 'needs_review', 'aiCheck.recheck': true, 'aiCheck.state': null } } : {})
    }
  )
  if (wasUsable && q.correctAnswer?.length) await enqueueAnswering([q._id], true)
  return { alreadyReported: false, status: wasUsable ? 'needs_review' : q.status }
}

export async function bulkAction(userId: Oid, ids: Oid[], action: 'confirm' | 'reject' | 'delete' | 'assign', assign?: QuestionInput) {
  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const id of ids) {
    try {
      if (action === 'confirm') await confirmQuestion(userId, id)
      else if (action === 'reject') await rejectQuestion(userId, id)
      else if (action === 'delete') await deleteQuestion(userId, id)
      else await updateQuestion(userId, id, assign ?? {})
      results.push({ id: String(id), ok: true })
    } catch (err) {
      results.push({ id: String(id), ok: false, error: err instanceof Error ? err.message : 'Failed' })
    }
  }
  return results
}
