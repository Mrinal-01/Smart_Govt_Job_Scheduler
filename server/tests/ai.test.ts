import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { setAIProvider, type AIProvider } from '../src/integrations/ai.js'
import { runPendingJobs } from '../src/jobs/queue.js'
import { AIUsageLog, Question } from '../src/models/index.js'
import { app, auth, registerVerified, useTestDb, withWorkspace } from './helpers.js'
import { makePdf } from './pdf.js'

useTestDb()

/** A deterministic fake provider — the real Anthropic client is never called in tests. */
function fakeProvider(overrides: Partial<AIProvider> = {}) {
  const calls: Array<{ system: string; prompt: string }> = []
  const provider: AIProvider = {
    name: 'fake',
    model: 'fake-model',
    async generateText(req) {
      calls.push({ system: req.system, prompt: req.messages.at(-1)!.content })
      return { text: 'Focus on Percentage.', usage: { inputTokens: 100, outputTokens: 20 } }
    },
    async generateJson(req) {
      calls.push({ system: req.system, prompt: req.prompt })
      const data = req.validate.parse({
        questions: [
          { questionText: 'If 20% of x is 10, x is?', options: ['20', '50', '40', '60'], correctOption: 'B', explanation: '0.2x = 10', difficulty: 'easy' }
        ]
      })
      return { data, usage: { inputTokens: 50, outputTokens: 40 } }
    },
    ...overrides
  }
  setAIProvider(provider)
  return calls
}

async function setup() {
  const { token } = await registerVerified()
  await withWorkspace(token)
  return token
}

describe('AI assistant', () => {
  afterEach(() => setAIProvider(null))

  it('reports not-configured honestly instead of faking a response', async () => {
    const token = await setup()
    const status = await request(app).get('/api/ai/status').set(auth(token)).expect(200)
    expect(status.body.configured).toBe(false)
    const res = await request(app).post('/api/ai/analyze').set(auth(token)).send({ mode: 'weak_subjects' })
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED')
  })

  it('grounds prompts in the authenticated student data and logs usage without content', async () => {
    const token = await setup()
    const calls = fakeProvider()
    const res = await request(app).post('/api/ai/analyze').set(auth(token)).send({ mode: 'revision_priorities' }).expect(200)
    expect(res.body.content).toBe('Focus on Percentage.')
    expect(calls[0].system).toContain('STUDENT DATA')
    expect(calls[0].system).toContain('Never invent study history')
    expect(calls[0].system).toContain('"subject":"Mathematics"')
    const log = await AIUsageLog.findOne({}).lean()
    expect(log).toMatchObject({ feature: 'assistant:revision_priorities', status: 'success', inputTokens: 100, outputTokens: 20 })
    expect(JSON.stringify(log)).not.toContain('Percentage')
  })

  it('enforces the daily limit and the per-user AI switch', async () => {
    const token = await setup()
    fakeProvider()
    for (let i = 0; i < 5; i += 1) await request(app).post('/api/ai/analyze').set(auth(token)).send({ mode: 'chat', message: 'hi' }).expect(200)
    const limited = await request(app).post('/api/ai/analyze').set(auth(token)).send({ mode: 'chat', message: 'hi' })
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('AI_DAILY_LIMIT')
    await AIUsageLog.deleteMany({})
    await request(app).patch('/api/settings').set(auth(token)).send({ ai: { enabled: false } }).expect(200)
    expect((await request(app).post('/api/ai/analyze').set(auth(token)).send({ mode: 'chat', message: 'hi' })).body.error.code).toBe('AI_DISABLED_BY_USER')
  })

  it('labels generated practice questions as AI-generated and keeps them out of tests until verified', async () => {
    const token = await setup()
    fakeProvider()
    const res = await request(app).post('/api/ai/practice-questions').set(auth(token)).send({ topicId: 'tp_pct_basics', count: 1 }).expect(201)
    const q = res.body.questions[0]
    expect(q).toMatchObject({ origin: 'ai_generated', status: 'needs_review', answerSource: 'ai_generated', subjectId: 'sub_math', topicId: 'tp_pct_basics' })
    expect(q.flags).toEqual(expect.arrayContaining(['ai_generated', 'not_official_pyq']))
    expect(await Question.countDocuments({ status: 'verified' })).toBe(0)
  })

  it('rejects AI structuring that is not grounded in the PDF text and never takes answers from AI', async () => {
    const token = await setup()
    fakeProvider({
      async generateJson(req) {
        const data = req.validate.parse({
          questions: [
            { index: 0, questionText: 'Explain transformer working principle', options: [{ label: 'A', text: 'Invented option' }], questionType: 'single_correct', subjectName: null },
            { index: 1, questionText: 'Ohm is the unit of', options: [{ label: 'A', text: 'Current' }, { label: 'B', text: 'Resistance' }], questionType: 'single_correct', subjectName: 'Physical Science' }
          ]
        })
        return { data, usage: { inputTokens: 1, outputTokens: 1 } }
      }
    })
    const pdf = await makePdf([['1. Explain transformer working principle.', '2. Ohm is the unit of', 'Current Resistance']])
    await request(app).post('/api/documents').set(auth(token)).attach('file', pdf, { filename: 'p.pdf', contentType: 'application/pdf' }).expect(201)
    await runPendingJobs()
    const qs = await Question.find({}).sort({ 'source.questionNumber': 1 }).lean()
    expect(qs[0].flags).toContain('ai_output_rejected_not_grounded')
    expect(qs[0].options).toEqual([])
    expect(qs[1].flags).toContain('ai_structured')
    expect(qs[1].options.map((o) => o.text)).toEqual(['Current', 'Resistance'])
    expect(qs[1].subjectId).toBe('sub_science')
    expect(qs[1].correctAnswer).toBeNull()
    expect(qs[1].status).toBe('needs_review')
  })
})
