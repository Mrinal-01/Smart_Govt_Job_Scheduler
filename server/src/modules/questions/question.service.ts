import { Types } from 'mongoose'
import { conflict, notFound, unprocessable } from '../../lib/errors.js'
import { MockTest, Question } from '../../models/index.js'
import { loadCurriculum, resolveTaxonomy } from '../workspace/curriculum.service.js'
import { normalizeForHash } from '../documents/extraction/questionParser.js'

type Oid = Types.ObjectId
const LABELS = ['A', 'B', 'C', 'D', 'E']

export interface QuestionFilter {
  status?: string
  subjectId?: string
  chapterId?: string
  topicId?: string
  difficulty?: string
  documentId?: string
  origin?: string
  hasAnswer?: boolean
  q?: string
  page: number
  limit: number
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function listQuestions(userId: Oid, f: QuestionFilter) {
  const filter: Record<string, unknown> = { userId }
  if (f.status) filter.status = f.status
  if (f.subjectId) filter.subjectId = f.subjectId
  if (f.chapterId) filter.chapterId = f.chapterId
  if (f.topicId) filter.topicId = f.topicId
  if (f.difficulty) filter.difficulty = f.difficulty
  if (f.origin) filter.origin = f.origin
  if (f.documentId) filter.documentId = new Types.ObjectId(f.documentId)
  if (f.hasAnswer !== undefined) filter.correctAnswer = f.hasAnswer ? { $ne: null } : null
  if (f.q) filter.questionText = { $regex: escapeRegex(f.q.slice(0, 100)), $options: 'i' }
  const [items, total] = await Promise.all([
    Question.find(filter)
      .sort(f.documentId ? { 'source.pageNumber': 1, createdAt: 1 } : { createdAt: -1 })
      .skip((f.page - 1) * f.limit)
      .limit(f.limit)
      .lean(),
    Question.countDocuments(filter)
  ])
  return { items, total, page: f.page, limit: f.limit }
}

export async function questionStats(userId: Oid) {
  const byStatus = await Question.aggregate([{ $match: { userId } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
  const verified = await Question.aggregate([
    { $match: { userId, status: 'verified' } },
    {
      $group: {
        _id: { subjectId: '$subjectId', subjectName: '$subjectName', chapterId: '$chapterId', chapterName: '$chapterName', difficulty: '$difficulty' },
        n: { $sum: 1 },
        withAnswer: { $sum: { $cond: [{ $ne: ['$correctAnswer', null] }, 1, 0] } }
      }
    }
  ])
  return { byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])), verifiedBreakdown: verified.map((v) => ({ ...v._id, count: v.n, withAnswer: v.withAnswer })) }
}

export async function getQuestion(userId: Oid, id: Oid) {
  const q = await Question.findOne({ _id: id, userId })
  if (!q) throw notFound('Question')
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

function checkAnswer(type: string, options: Array<{ label: string }>, answer: string[] | null | undefined) {
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

async function applyTaxonomy(userId: Oid, input: QuestionInput, current: { subjectId?: string | null; chapterId?: string | null; topicId?: string | null }) {
  if (input.subjectId === undefined && input.chapterId === undefined && input.topicId === undefined) return {}
  const cur = await loadCurriculum(userId)
  return resolveTaxonomy(cur, {
    subjectId: input.subjectId !== undefined ? input.subjectId : current.subjectId,
    chapterId: input.chapterId !== undefined ? input.chapterId : input.subjectId !== undefined ? null : current.chapterId,
    topicId: input.topicId !== undefined ? input.topicId : input.subjectId !== undefined || input.chapterId !== undefined ? null : current.topicId
  })
}

export async function createManualQuestion(userId: Oid, input: Required<Pick<QuestionInput, 'questionText'>> & QuestionInput) {
  const options = normalizeOptions(input.options ?? [])
  const type = input.questionType ?? (options.length >= 2 ? 'single_correct' : 'unknown')
  const answer = checkAnswer(type, options, input.correctAnswer)
  const taxonomy = await applyTaxonomy(userId, input, {})
  try {
    return await Question.create({
      userId,
      origin: 'manual',
      rawText: input.questionText,
      questionText: input.questionText.trim(),
      questionType: type,
      options,
      correctAnswer: answer,
      answerSource: answer ? 'student' : null,
      explanation: input.explanation ?? null,
      difficulty: input.difficulty ?? 'unknown',
      status: 'needs_review',
      extractionConfidence: 1,
      ...taxonomy,
      contentHash: normalizeForHash(input.questionText, options)
    })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('This question already exists in your bank.', 'DUPLICATE_QUESTION')
    throw err
  }
}

export async function updateQuestion(userId: Oid, id: Oid, input: QuestionInput) {
  const q = await getQuestion(userId, id)
  if (input.questionText !== undefined) q.questionText = input.questionText.trim()
  if (input.options !== undefined) q.set('options', normalizeOptions(input.options))
  if (input.questionType !== undefined) q.questionType = input.questionType
  if (input.correctAnswer !== undefined) {
    const answer = checkAnswer(q.questionType, q.options, input.correctAnswer)
    q.set('correctAnswer', answer)
    q.answerSource = answer ? 'student' : null
  } else if (input.options !== undefined && q.correctAnswer) {
    // Options changed: drop an answer that no longer points at an option.
    if (!q.correctAnswer.every((a) => q.options.some((o) => o.label === a))) {
      q.set('correctAnswer', null)
      q.answerSource = null
    }
  }
  if (input.explanation !== undefined) q.explanation = input.explanation
  if (input.difficulty !== undefined) q.difficulty = input.difficulty
  Object.assign(q, await applyTaxonomy(userId, input, q))
  q.flags = q.flags.filter((f) => f !== 'needs_subject' || !q.subjectId)
  q.contentHash = normalizeForHash(q.questionText, q.options)
  if (q.status === 'extracted' || q.status === 'rejected') q.status = 'needs_review'
  try {
    await q.save()
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('Another question in your bank already has this exact content.', 'DUPLICATE_QUESTION')
    throw err
  }
  return q
}

/** Verification is an explicit student action; every requirement for a usable bank question is checked here. */
export function verificationProblems(q: { questionText: string; questionType: string; options: Array<{ text: string }>; subjectId?: string | null }) {
  const problems: string[] = []
  if (!q.questionText.trim()) problems.push('Question text is empty.')
  if (q.questionType === 'unknown') problems.push('Choose a question type.')
  if (['single_correct', 'multiple_correct', 'true_false'].includes(q.questionType) && q.options.length < 2) problems.push('Add at least two options.')
  if (q.options.some((o) => !o.text.trim())) problems.push('One or more options are empty.')
  if (!q.subjectId) problems.push('Assign a subject.')
  return problems
}

export async function verifyQuestion(userId: Oid, id: Oid) {
  const q = await getQuestion(userId, id)
  const problems = verificationProblems(q)
  if (problems.length) throw unprocessable(problems[0], 'CANNOT_VERIFY', { problems })
  q.status = 'verified'
  q.verifiedAt = new Date()
  await q.save()
  return q
}

export async function rejectQuestion(userId: Oid, id: Oid) {
  const q = await getQuestion(userId, id)
  q.status = 'rejected'
  q.verifiedAt = null
  await q.save()
  return q
}

export async function deleteQuestion(userId: Oid, id: Oid) {
  const q = await getQuestion(userId, id)
  await MockTest.updateMany({ userId, questionIds: q._id }, { $pull: { questionIds: q._id } })
  await Question.deleteOne({ _id: q._id })
}

export async function bulkAction(
  userId: Oid,
  ids: Oid[],
  action: 'verify' | 'reject' | 'delete' | 'assign',
  assign?: QuestionInput
) {
  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const id of ids) {
    try {
      if (action === 'verify') await verifyQuestion(userId, id)
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
