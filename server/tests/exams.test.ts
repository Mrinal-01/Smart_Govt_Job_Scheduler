import { Types } from 'mongoose'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ExamMistake, MockTestAttempt, Question, User } from '../src/models/index.js'
import { normalizeForHash } from '../src/modules/documents/extraction/questionParser.js'
import { app, auth, registerVerified, useTestDb, withWorkspace } from './helpers.js'

useTestDb()

const TAX: Record<string, { subjectName: string; chapterId: string; chapterName: string; topicId: string; topicName: string }> = {
  sub_math: { subjectName: 'Mathematics', chapterId: 'ch_math_pct', chapterName: 'Percentage', topicId: 'tp_pct_basics', topicName: 'Basics of Percentage' },
  sub_science: { subjectName: 'Physical Science', chapterId: 'ch_sci_force', chapterName: 'Force and Motion', topicId: 'tp_newton', topicName: "Newton's Laws" },
  sub_reasoning: { subjectName: 'Reasoning', chapterId: 'ch_rea_series', chapterName: 'Series', topicId: 'tp_num_series', topicName: 'Number Series' },
  sub_current: { subjectName: 'Current Affairs', chapterId: 'ch_ca_nat', chapterName: 'National', topicId: 'tp_schemes', topicName: 'Government Schemes' }
}

async function seedBank(userId: Types.ObjectId, subjectId: string, n: number, opts: { withAnswer?: boolean; difficulty?: string } = {}) {
  const t = TAX[subjectId]
  const docs = Array.from({ length: n }, (_, i) => {
    const options = ['A', 'B', 'C', 'D'].map((label) => ({ label, text: `${subjectId} option ${label} ${i}` }))
    const text = `${subjectId} question ${i} ${opts.difficulty ?? ''}`
    return {
      userId,
      origin: 'manual',
      questionText: text,
      questionType: 'single_correct',
      options,
      correctAnswer: opts.withAnswer === false ? null : ['B'],
      answerSource: opts.withAnswer === false ? null : 'student',
      subjectId,
      ...t,
      difficulty: opts.difficulty ?? 'medium',
      status: 'verified',
      verifiedAt: new Date(),
      contentHash: normalizeForHash(text, options)
    }
  })
  await Question.insertMany(docs)
}

async function setup() {
  const { token, user } = await registerVerified()
  await withWorkspace(token)
  return { token, userId: new Types.ObjectId(user.id) }
}

const cfg = (extra: Record<string, unknown>) => ({ durationMinutes: 10, marksPerQuestion: 2, negativeMarks: 0.5, ...extra })

describe('mock test builder', () => {
  it('Workflow E: builds mixed, subject-wise, sectional and chapter tests with configured size and duration', async () => {
    const { token, userId } = await setup()
    for (const s of Object.keys(TAX)) await seedBank(userId, s, 12)

    const mixed = await request(app)
      .post('/api/mock-tests')
      .set(auth(token))
      .send({ name: 'Full mock', type: 'full_mixed', config: cfg({ distribution: Object.keys(TAX).map((subjectId) => ({ subjectId, count: 5 })), durationMinutes: 60 }) })
      .expect(201)
    expect(mixed.body.test.questionIds).toHaveLength(20)
    expect(mixed.body.test.config.questionCount).toBe(20)
    expect(mixed.body.test.config.durationMinutes).toBe(60)

    const subject = await request(app).post('/api/mock-tests').set(auth(token)).send({ name: 'Science only', type: 'subject_full', config: cfg({ subjectIds: ['sub_science'], questionCount: 10 }) }).expect(201)
    const picked = await Question.find({ _id: { $in: subject.body.test.questionIds } }).lean()
    expect(picked.every((q) => q.subjectId === 'sub_science')).toBe(true)
    expect(new Set(subject.body.test.questionIds).size).toBe(10)

    const sectional = await request(app)
      .post('/api/mock-tests')
      .set(auth(token))
      .send({ name: 'Maths + Reasoning', type: 'sectional', config: cfg({ distribution: [{ subjectId: 'sub_math', count: 4 }, { subjectId: 'sub_reasoning', count: 6 }] }) })
      .expect(201)
    expect(sectional.body.buckets.map((b: { requested: number }) => b.requested)).toEqual([4, 6])

    await request(app).post('/api/mock-tests').set(auth(token)).send({ name: 'Force', type: 'chapter', config: cfg({ chapterIds: ['ch_sci_force'], questionCount: 5 }) }).expect(201)
    await request(app).post('/api/mock-tests').set(auth(token)).send({ name: 'Pct', type: 'topic', config: cfg({ topicIds: ['tp_pct_basics'], questionCount: 5 }) }).expect(201)
  })

  it('warns instead of producing a short test when the bank is insufficient', async () => {
    const { token, userId } = await setup()
    await seedBank(userId, 'sub_science', 3)
    const preview = await request(app).post('/api/mock-tests/preview').set(auth(token)).send({ type: 'subject_full', config: cfg({ subjectIds: ['sub_science'], questionCount: 20 }) }).expect(200)
    expect(preview.body.ok).toBe(false)
    expect(preview.body.buckets[0]).toMatchObject({ requested: 20, available: 3 })
    const create = await request(app).post('/api/mock-tests').set(auth(token)).send({ name: 'Too big', type: 'subject_full', config: cfg({ subjectIds: ['sub_science'], questionCount: 20 }) })
    expect(create.status).toBe(422)
    expect(create.body.error.code).toBe('INSUFFICIENT_QUESTIONS')
  })

  it('supports difficulty distributions and reusable templates', async () => {
    const { token, userId } = await setup()
    await seedBank(userId, 'sub_math', 4, { difficulty: 'easy' })
    await seedBank(userId, 'sub_math', 4, { difficulty: 'hard' })
    const res = await request(app)
      .post('/api/mock-tests')
      .set(auth(token))
      .send({
        name: 'Balanced',
        type: 'subject_full',
        saveAsTemplate: true,
        config: cfg({ subjectIds: ['sub_math'], questionCount: 6, selectionMethod: 'difficulty', difficultyDistribution: { easy: 50, medium: 0, hard: 50 } })
      })
      .expect(201)
    const picked = await Question.find({ _id: { $in: res.body.test.questionIds } }).lean()
    expect(picked.filter((q) => q.difficulty === 'easy')).toHaveLength(3)
    const templates = await request(app).get('/api/mock-tests?kind=template').set(auth(token)).expect(200)
    expect(templates.body.items).toHaveLength(1)
    await request(app).post(`/api/mock-tests/templates/${templates.body.items[0]._id}/generate`).set(auth(token)).send({}).expect(201)
  })
})

describe('examination engine', () => {
  async function startTest(token: string, userId: Types.ObjectId, withAnswer = true) {
    await seedBank(userId, 'sub_science', 4, { withAnswer: true })
    if (!withAnswer) await seedBank(userId, 'sub_math', 2, { withAnswer: false })
    const test = await request(app)
      .post('/api/mock-tests')
      .set(auth(token))
      .send({
        name: 'Exam',
        type: withAnswer ? 'subject_full' : 'sectional',
        config: withAnswer ? cfg({ subjectIds: ['sub_science'], questionCount: 4 }) : cfg({ distribution: [{ subjectId: 'sub_science', count: 4 }, { subjectId: 'sub_math', count: 2 }] })
      })
      .expect(201)
    const start = await request(app).post('/api/attempts').set(auth(token)).send({ mockTestId: test.body.test._id }).expect(201)
    return { testId: test.body.test._id as string, attemptId: start.body.attemptId as string }
  }

  it('Workflow F: server-owned timer, hidden answers, persistence across reload, idempotent submit', async () => {
    const { token, userId } = await setup()
    const { testId, attemptId } = await startTest(token, userId)
    const view = (await request(app).get(`/api/attempts/${attemptId}`).set(auth(token)).expect(200)).body.attempt
    expect(view.status).toBe('in_progress')
    expect(view.remainingSeconds).toBeGreaterThan(590)
    expect(view.questions[0]).not.toHaveProperty('correctAnswer')
    expect(view.questions[0]).not.toHaveProperty('explanation')

    const [q1, q2, q3] = view.questions
    await request(app)
      .put(`/api/attempts/${attemptId}/answers`)
      .set(auth(token))
      .send({ answers: [{ questionId: q1.questionId, selected: ['B'] }, { questionId: q2.questionId, selected: ['A'], markedForReview: true }] })
      .expect(200)
    expect((await request(app).put(`/api/attempts/${attemptId}/answers`).set(auth(token)).send({ answers: [{ questionId: q3.questionId, selected: ['Z'] }] })).status).toBe(422)

    // "Refresh": starting again resumes the same attempt with saved answers
    const resumed = await request(app).post('/api/attempts').set(auth(token)).send({ mockTestId: testId }).expect(200)
    expect(resumed.body).toMatchObject({ attemptId, resumed: true })
    const reloaded = (await request(app).get(`/api/attempts/${attemptId}`).set(auth(token)).expect(200)).body.attempt
    expect(reloaded.answers).toHaveLength(2)
    expect(reloaded.answers.find((a: { questionId: string }) => a.questionId === q2.questionId).markedForReview).toBe(true)

    const submitted = (await request(app).post(`/api/attempts/${attemptId}/submit`).set(auth(token)).expect(200)).body.attempt
    expect(submitted.status).toBe('submitted')
    expect(submitted.result).toMatchObject({ totalQuestions: 4, attempted: 2, correct: 1, incorrect: 1, unanswered: 2, unscored: 0, marks: 1.5, maxMarks: 8, accuracy: 50 })
    expect(submitted.questions[0]).toHaveProperty('correctAnswer')
    const again = (await request(app).post(`/api/attempts/${attemptId}/submit`).set(auth(token)).expect(200)).body.attempt
    expect(again.submittedAt).toBe(submitted.submittedAt)
    expect((await request(app).put(`/api/attempts/${attemptId}/answers`).set(auth(token)).send({ answers: [] })).body.error.code).toBe('ATTEMPT_CLOSED')

    // Workflow G: verified mistake auto-added once; manual add of an unanswered one; no duplicates on retake
    expect(await ExamMistake.countDocuments({})).toBe(1)
    await request(app).post(`/api/attempts/${attemptId}/mistakes`).set(auth(token)).send({ questionId: q3.questionId }).expect(201)
    expect((await request(app).post(`/api/attempts/${attemptId}/mistakes`).set(auth(token)).send({ questionId: q1.questionId })).body.error.code).toBe('NOT_A_MISTAKE')
    const retake = await request(app).post(`/api/attempts/${attemptId}/retake`).set(auth(token)).send({ mode: 'incorrect' }).expect(201)
    expect(retake.body.test.questionIds).toHaveLength(1)
    const r2 = await request(app).post('/api/attempts').set(auth(token)).send({ mockTestId: retake.body.test._id }).expect(201)
    const v2 = (await request(app).get(`/api/attempts/${r2.body.attemptId}`).set(auth(token))).body.attempt
    await request(app).put(`/api/attempts/${r2.body.attemptId}/answers`).set(auth(token)).send({ answers: [{ questionId: v2.questions[0].questionId, selected: ['C'] }] }).expect(200)
    await request(app).post(`/api/attempts/${r2.body.attemptId}/submit`).set(auth(token)).expect(200)
    const mistake = await ExamMistake.findOne({ questionId: q2.questionId })
    expect(mistake!.occurrences).toBe(2)
    expect(await ExamMistake.countDocuments({})).toBe(2)

    const perf = await request(app).get('/api/attempts/performance').set(auth(token)).expect(200)
    expect(perf.body.attempts).toBe(2)
    expect(perf.body.chapters[0].name).toBe('Force and Motion')
  })

  it('auto-submits at the server deadline and rejects late answers', async () => {
    const { token, userId } = await setup()
    const { attemptId } = await startTest(token, userId)
    const view = (await request(app).get(`/api/attempts/${attemptId}`).set(auth(token))).body.attempt
    await request(app).put(`/api/attempts/${attemptId}/answers`).set(auth(token)).send({ answers: [{ questionId: view.questions[0].questionId, selected: ['B'] }] }).expect(200)
    // Move the deadline into the past (the client clock is irrelevant).
    await MockTestAttempt.updateOne({ _id: attemptId }, { $set: { deadlineAt: new Date(Date.now() - 60_000), startedAt: new Date(Date.now() - 11 * 60_000) } })
    const late = await request(app).put(`/api/attempts/${attemptId}/answers`).set(auth(token)).send({ answers: [{ questionId: view.questions[1].questionId, selected: ['B'] }] })
    expect(late.status).toBe(409)
    expect(late.body.error.code).toBe('ATTEMPT_CLOSED')
    const final = (await request(app).get(`/api/attempts/${attemptId}`).set(auth(token))).body.attempt
    expect(final.status).toBe('auto_submitted')
    expect(final.result.correct).toBe(1)
    expect(final.result.attempted).toBe(1)
    expect(final.result.timeTakenSeconds).toBe(600)
  })

  it('never marks a question wrong when its answer is unknown', async () => {
    const { token, userId } = await setup()
    const { attemptId } = await startTest(token, userId, false)
    const view = (await request(app).get(`/api/attempts/${attemptId}`).set(auth(token))).body.attempt
    const answers = view.questions.map((q: { questionId: string }) => ({ questionId: q.questionId, selected: ['A'] }))
    await request(app).put(`/api/attempts/${attemptId}/answers`).set(auth(token)).send({ answers }).expect(200)
    const result = (await request(app).post(`/api/attempts/${attemptId}/submit`).set(auth(token))).body.attempt.result
    expect(result).toMatchObject({ totalQuestions: 6, unscored: 2, unscoredAttempted: 2, incorrect: 4, scoringComplete: false, maxMarks: 8 })
  })

  it('only one running attempt per test even with concurrent starts', async () => {
    const { token, userId } = await setup()
    await seedBank(userId, 'sub_science', 4)
    const test = await request(app).post('/api/mock-tests').set(auth(token)).send({ name: 'Concurrent', type: 'subject_full', config: cfg({ subjectIds: ['sub_science'], questionCount: 4 }) })
    const [a, b] = await Promise.all([
      request(app).post('/api/attempts').set(auth(token)).send({ mockTestId: test.body.test._id }),
      request(app).post('/api/attempts').set(auth(token)).send({ mockTestId: test.body.test._id })
    ])
    expect(a.body.attemptId).toBe(b.body.attemptId)
    expect(await MockTestAttempt.countDocuments({ status: 'in_progress' })).toBe(1)
    expect(await User.countDocuments({})).toBe(1)
  })
})
