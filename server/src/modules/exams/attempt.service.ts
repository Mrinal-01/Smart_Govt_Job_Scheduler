import { Types } from 'mongoose'
import { seededRandom, shuffle } from '../../lib/crypto.js'
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { ExamMistake, MockTest, MockTestAnswer, MockTestAttempt, Question, taxonomyKey } from '../../models/index.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { getSettings } from '../settings/settings.service.js'
import { scoreAttempt, type ScoreResult } from './scoring.js'
import { newSeed } from './selection.service.js'

/*
 * Examination engine. The server clock owns startedAt/deadlineAt. Answers are
 * accepted until the deadline (+ a small network grace); afterwards the attempt
 * is auto-submitted with whatever was saved. Submission is an atomic
 * in_progress → submitted transition, so duplicate submits are harmless.
 *
 * Interruption policy: the timer keeps running while the student is away.
 * Reopening the attempt before the deadline resumes it with saved answers;
 * after the deadline it is already auto-submitted.
 */

type Oid = Types.ObjectId
export const SAVE_GRACE_MS = 5000

export async function startAttempt(userId: Oid, mockTestId: Oid) {
  const test = await MockTest.findOne({ _id: mockTestId, userId, kind: 'test', archivedAt: null }).lean()
  if (!test) throw notFound('Mock test')

  const running = await MockTestAttempt.findOne({ userId, mockTestId, status: 'in_progress' })
  if (running) {
    if (running.deadlineAt.getTime() + SAVE_GRACE_MS > Date.now()) return { attemptId: running._id, resumed: true }
    await finalizeAttempt(running._id, 'timeout')
  }

  // Only questions that are still ready (not reported/retired since the test was built) are used.
  const docs = await Question.find({ _id: { $in: test.questionIds }, status: 'ready' }).lean()
  const cur = await loadCurriculum(userId).catch(() => null)
  const subjectIdFor = (name: string | null | undefined) => cur?.subjects.find((s) => taxonomyKey(s.name) === taxonomyKey(name))?.id ?? taxonomyKey(name)
  const chapterIdFor = (name: string | null | undefined) => cur?.chapters.find((c) => taxonomyKey(c.name) === taxonomyKey(name))?.id ?? taxonomyKey(name)
  const byId = new Map(docs.map((d) => [String(d._id), d]))
  const ordered = test.questionIds.map((id) => byId.get(String(id))).filter((q): q is NonNullable<typeof q> => Boolean(q))
  if (!ordered.length) throw unprocessable('None of this test’s questions exist any more.', 'TEST_EMPTY')

  const random = seededRandom(newSeed())
  const sequence = test.config?.shuffleQuestions ? shuffle(ordered, random) : ordered
  const now = new Date()
  const durationSeconds = Math.round((test.config?.durationMinutes ?? 30) * 60)
  try {
    const attempt = await MockTestAttempt.create({
      userId,
      mockTestId,
      testName: test.name,
      testType: test.type,
      status: 'in_progress',
      startedAt: now,
      deadlineAt: new Date(now.getTime() + durationSeconds * 1000),
      durationSeconds,
      marksPerQuestion: test.config?.marksPerQuestion ?? 1,
      negativeMarks: test.config?.negativeMarks ?? 0,
      instructions: test.config?.instructions ?? '',
      questions: sequence.map((q, order) => ({
        questionId: q._id,
        order,
        questionText: q.questionText,
        questionType: q.questionType,
        // Options keep their original labels as identity; only display order may be shuffled.
        options: test.config?.shuffleOptions && q.questionType !== 'true_false' ? shuffle(q.options, random) : q.options,
        correctAnswer: q.correctAnswer ?? null,
        answerVerified: Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0,
        answerSource: q.answerSource ?? null,
        answerConfidence: q.answerConfidence ?? null,
        answerExplanation: q.answerExplanation ?? null,
        explanation: q.explanation ?? null,
        // Ids from the student's own curriculum so per-subject analytics line up with their subjects.
        subjectId: subjectIdFor(q.subjectName),
        subjectName: q.subjectName,
        chapterId: q.chapterName ? chapterIdFor(q.chapterName) : null,
        chapterName: q.chapterName,
        topicId: q.topicKey,
        topicName: q.topicName,
        difficulty: q.difficulty,
        source: q.source
      }))
    })
    return { attemptId: attempt._id, resumed: false, missingQuestions: test.questionIds.length - ordered.length }
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const existing = await MockTestAttempt.findOne({ userId, mockTestId, status: 'in_progress' }).lean()
      if (existing) return { attemptId: existing._id, resumed: true }
    }
    throw err
  }
}

async function loadAnswers(attemptId: Oid) {
  return MockTestAnswer.find({ attemptId }).lean()
}

export async function finalizeAttempt(attemptId: Oid, type: 'manual' | 'timeout') {
  const attempt = await MockTestAttempt.findById(attemptId).lean()
  if (!attempt) throw notFound('Attempt')
  if (attempt.status !== 'in_progress') return attempt

  const answers = await loadAnswers(attempt._id)
  const answerMap = new Map(answers.map((a) => [String(a.questionId), a.selected]))
  const submittedAt = type === 'timeout' ? attempt.deadlineAt : new Date(Math.min(Date.now(), attempt.deadlineAt.getTime()))
  const result: ScoreResult = scoreAttempt({
    questions: attempt.questions.map((q) => ({
      questionId: String(q.questionId),
      questionType: q.questionType,
      correctAnswer: q.correctAnswer ?? null,
      answerVerified: Boolean(q.answerVerified),
      subjectId: q.subjectId,
      subjectName: q.subjectName,
      chapterId: q.chapterId,
      chapterName: q.chapterName,
      difficulty: q.difficulty
    })),
    answers: answerMap,
    marksPerQuestion: attempt.marksPerQuestion,
    negativeMarks: attempt.negativeMarks,
    timeTakenSeconds: Math.max(0, Math.round((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000))
  })

  const finalized = await MockTestAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'in_progress' },
    { $set: { status: type === 'timeout' ? 'auto_submitted' : 'submitted', submissionType: type, submittedAt, result } },
    { new: true }
  ).lean()
  if (!finalized) return (await MockTestAttempt.findById(attempt._id).lean())!

  // Verified wrong answers flow into the Mistake Bank (one entry per question, ever).
  const settings = await getSettings(attempt.userId)
  if (settings.exams?.autoAddMistakes !== false) {
    const wrong = result.questionResults.filter((r) => r.outcome === 'incorrect')
    for (const w of wrong) {
      const q = attempt.questions.find((x) => String(x.questionId) === w.questionId)!
      await upsertMistake(attempt.userId, attempt._id, q, w.selected, 'auto')
    }
  }
  return finalized
}

export async function upsertMistake(
  userId: Oid,
  attemptId: Oid,
  q: {
    questionId: Oid
    questionText: string
    options: Array<{ label?: string | null; text?: string | null }>
    correctAnswer?: string[] | null
    explanation?: string | null
    subjectId?: string | null
    subjectName?: string | null
    chapterId?: string | null
    chapterName?: string | null
    topicId?: string | null
    topicName?: string | null
  },
  selected: string[],
  source: 'auto' | 'manual'
) {
  await ExamMistake.updateOne(
    { userId, questionId: q.questionId },
    {
      $setOnInsert: {
        userId,
        questionId: q.questionId,
        questionText: q.questionText,
        options: q.options,
        correctAnswer: q.correctAnswer ?? [],
        explanation: q.explanation ?? null,
        subjectId: q.subjectId,
        subjectName: q.subjectName,
        chapterId: q.chapterId,
        chapterName: q.chapterName,
        topicId: q.topicId,
        topicName: q.topicName,
        source
      },
      $set: { lastAttemptId: attemptId, selected, lastSeenAt: new Date(), status: 'unresolved' },
      $inc: { occurrences: 1 }
    },
    { upsert: true }
  )
}

/** Lazily closes an expired attempt so reads never show a stale "running" exam. */
async function ownedAttempt(userId: Oid, id: Oid) {
  let attempt = await MockTestAttempt.findOne({ _id: id, userId }).lean()
  if (!attempt) throw notFound('Attempt')
  if (attempt.status === 'in_progress' && attempt.deadlineAt.getTime() + SAVE_GRACE_MS <= Date.now()) {
    attempt = await finalizeAttempt(attempt._id, 'timeout')
  }
  return attempt
}

export async function getAttempt(userId: Oid, id: Oid) {
  const attempt = await ownedAttempt(userId, id)
  const answers = await loadAnswers(attempt._id)
  const running = attempt.status === 'in_progress'
  const now = Date.now()
  return {
    _id: attempt._id,
    mockTestId: attempt.mockTestId,
    testName: attempt.testName,
    testType: attempt.testType,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt,
    submissionType: attempt.submissionType,
    durationSeconds: attempt.durationSeconds,
    serverNow: new Date(now).toISOString(),
    remainingSeconds: running ? Math.max(0, Math.round((attempt.deadlineAt.getTime() - now) / 1000)) : 0,
    marksPerQuestion: attempt.marksPerQuestion,
    negativeMarks: attempt.negativeMarks,
    instructions: attempt.instructions,
    lastSavedAt: attempt.lastSavedAt,
    // Correct answers and explanations are withheld until the attempt is finished.
    questions: attempt.questions.map((q) => ({
      questionId: q.questionId,
      order: q.order,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options,
      subjectName: q.subjectName,
      chapterName: q.chapterName,
      ...(running
        ? {}
        : {
            correctAnswer: q.correctAnswer,
            answerVerified: q.answerVerified,
            answerSource: q.answerSource ?? null,
            answerConfidence: q.answerConfidence ?? null,
            answerExplanation: q.answerExplanation ?? null,
            explanation: q.explanation,
            topicName: q.topicName,
            difficulty: q.difficulty,
            source: q.source
          })
    })),
    answers: answers.map((a) => ({ questionId: a.questionId, selected: a.selected, markedForReview: a.markedForReview, visited: a.visited })),
    result: running ? null : attempt.result
  }
}

export interface AnswerInput {
  questionId: string
  selected: string[]
  markedForReview?: boolean
  visited?: boolean
  timeSpentSeconds?: number
}

export async function saveAnswers(userId: Oid, id: Oid, inputs: AnswerInput[]) {
  const attempt = await ownedAttempt(userId, id)
  if (attempt.status !== 'in_progress') {
    throw new AppError(409, 'ATTEMPT_CLOSED', 'Time is up — this attempt was submitted with your saved answers.', { status: attempt.status })
  }
  const byId = new Map(attempt.questions.map((q) => [String(q.questionId), q]))
  const ops = inputs.map((a) => {
    const q = byId.get(a.questionId)
    if (!q) throw unprocessable('Answer references a question that is not in this attempt.', 'UNKNOWN_QUESTION')
    let selected = Array.from(new Set(a.selected.map((s) => s.trim()).filter(Boolean)))
    if (q.questionType === 'numeric') {
      if (selected.length > 1 || (selected[0] !== undefined && !Number.isFinite(Number(selected[0])))) {
        throw unprocessable('Numeric answers must be a single number.', 'INVALID_ANSWER')
      }
    } else {
      selected = selected.map((s) => s.toUpperCase())
      if (!selected.every((s) => q.options.some((o) => o.label === s))) throw unprocessable('Selected option does not exist.', 'INVALID_ANSWER')
      if (q.questionType !== 'multiple_correct' && selected.length > 1) throw unprocessable('Only one option can be selected.', 'INVALID_ANSWER')
    }
    return {
      updateOne: {
        filter: { attemptId: attempt._id, questionId: q.questionId },
        update: {
          $set: { selected, markedForReview: Boolean(a.markedForReview), visited: a.visited ?? true, userId },
          $max: { timeSpentSeconds: Math.max(0, Math.round(a.timeSpentSeconds ?? 0)) }
        },
        upsert: true
      }
    }
  })
  if (ops.length) await MockTestAnswer.bulkWrite(ops)
  const savedAt = new Date()
  await MockTestAttempt.updateOne({ _id: attempt._id }, { $set: { lastSavedAt: savedAt } })
  return { savedAt, remainingSeconds: Math.max(0, Math.round((attempt.deadlineAt.getTime() - Date.now()) / 1000)) }
}

export async function submitAttempt(userId: Oid, id: Oid) {
  const attempt = await ownedAttempt(userId, id)
  if (attempt.status === 'in_progress') await finalizeAttempt(attempt._id, 'manual')
  return getAttempt(userId, id)
}

export async function listAttempts(userId: Oid, mockTestId?: Oid) {
  const filter: Record<string, unknown> = { userId }
  if (mockTestId) filter.mockTestId = mockTestId
  const items = await MockTestAttempt.find(filter)
    .select('mockTestId testName testType status startedAt deadlineAt submittedAt durationSeconds result.marks result.maxMarks result.accuracy result.correct result.incorrect result.unanswered result.unscored result.totalQuestions')
    .sort({ startedAt: -1 })
    .limit(100)
    .lean()
  return items
}

export async function createRetake(userId: Oid, id: Oid, mode: 'incorrect' | 'unanswered' | 'all') {
  const attempt = await ownedAttempt(userId, id)
  if (attempt.status === 'in_progress' || !attempt.result) throw conflict('Finish the attempt first.', 'ATTEMPT_RUNNING')
  const result = attempt.result as ScoreResult
  const pick = result.questionResults.filter((r) =>
    mode === 'all' ? true : mode === 'incorrect' ? r.outcome === 'incorrect' : r.outcome === 'unanswered' || (r.outcome === 'unscored' && !r.selected.length)
  )
  if (!pick.length) throw unprocessable(`There are no ${mode} questions to practise.`, 'NOTHING_TO_RETAKE')
  const perQuestion = attempt.durationSeconds / Math.max(1, attempt.questions.length)
  const test = await MockTest.create({
    userId,
    kind: 'test',
    name: `${attempt.testName} — ${mode === 'all' ? 'reattempt' : `${mode} practice`}`,
    type: 'practice',
    config: {
      questionCount: pick.length,
      durationMinutes: Math.max(1, Math.ceil((perQuestion * pick.length) / 60)),
      marksPerQuestion: attempt.marksPerQuestion,
      negativeMarks: attempt.negativeMarks,
      shuffleQuestions: true
    },
    questionIds: pick.map((p) => new Types.ObjectId(p.questionId)),
    sourceAttemptId: attempt._id
  })
  return test.toObject()
}

export async function addMistakeFromAttempt(userId: Oid, attemptId: Oid, questionId: string) {
  const attempt = await ownedAttempt(userId, attemptId)
  if (attempt.status === 'in_progress') throw conflict('Finish the attempt first.', 'ATTEMPT_RUNNING')
  const q = attempt.questions.find((x) => String(x.questionId) === questionId)
  if (!q) throw notFound('Question in attempt')
  const r = (attempt.result as ScoreResult).questionResults.find((x) => x.questionId === questionId)
  if (r?.outcome === 'correct') throw unprocessable('You answered this question correctly.', 'NOT_A_MISTAKE')
  await upsertMistake(userId, attempt._id, q, r?.selected ?? [], 'manual')
  return ExamMistake.findOne({ userId, questionId: q.questionId }).lean()
}

/** Aggregated performance across finished attempts — powers weak-chapter analysis. */
export async function performanceSummary(userId: Oid) {
  const attempts = await MockTestAttempt.find({ userId, status: { $ne: 'in_progress' } }).select('result submittedAt testName').sort({ submittedAt: -1 }).limit(200).lean()
  const agg = (key: 'bySubject' | 'byChapter') => {
    const map = new Map<string, { key: string; name: string; correct: number; incorrect: number; unanswered: number; unscored: number }>()
    for (const a of attempts) {
      for (const b of ((a.result as ScoreResult | null)?.[key] ?? [])) {
        const cur = map.get(b.key) ?? { key: b.key, name: b.name, correct: 0, incorrect: 0, unanswered: 0, unscored: 0 }
        cur.correct += b.correct
        cur.incorrect += b.incorrect
        cur.unanswered += b.unanswered
        cur.unscored += b.unscored
        map.set(b.key, cur)
      }
    }
    return Array.from(map.values()).map((v) => ({
      ...v,
      accuracy: v.correct + v.incorrect ? Math.round((v.correct / (v.correct + v.incorrect)) * 100) : null
    }))
  }
  const chapters = agg('byChapter')
  return {
    attempts: attempts.length,
    trend: attempts
      .slice(0, 20)
      .reverse()
      .map((a) => ({ date: a.submittedAt, name: a.testName, accuracy: (a.result as ScoreResult | null)?.accuracy ?? null })),
    subjects: agg('bySubject'),
    chapters,
    weakChapters: chapters
      .filter((c) => c.key !== 'none' && c.correct + c.incorrect >= 3 && (c.accuracy ?? 100) < 70)
      .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
      .slice(0, 8)
  }
}

let sweeper: NodeJS.Timeout | null = null
export function startAttemptSweeper() {
  sweeper = setInterval(async () => {
    try {
      const expired = await MockTestAttempt.find({ status: 'in_progress', deadlineAt: { $lt: new Date(Date.now() - SAVE_GRACE_MS) } })
        .select('_id')
        .limit(50)
        .lean()
      for (const a of expired) await finalizeAttempt(a._id, 'timeout')
    } catch (err) {
      logger.error({ err }, 'Attempt sweeper failed')
    }
  }, 30_000)
}
export function stopAttemptSweeper() {
  if (sweeper) clearInterval(sweeper)
  sweeper = null
}
