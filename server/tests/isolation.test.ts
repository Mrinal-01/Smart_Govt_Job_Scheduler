import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { runPendingJobs } from '../src/jobs/queue.js'
import { app, auth, registerVerified, useTestDb, withWorkspace } from './helpers.js'
import { SCIENCE_PAPER, makePdf } from './pdf.js'

useTestDb()

describe('Workflow H: data isolation between users', () => {
  it('user B cannot read or modify any of user A’s data', async () => {
    const a = await registerVerified('a@example.com', 'Alice A')
    const b = await registerVerified('b@example.com', 'Bob B')
    await withWorkspace(a.token)
    await withWorkspace(b.token)

    // A: document, questions, schedule, cycle, test, attempt
    const up = await request(app).post('/api/documents').set(auth(a.token)).field('subjectIds', 'sub_science').attach('file', await makePdf(SCIENCE_PAPER), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(201)
    const docId = up.body.document._id
    await runPendingJobs()
    const qs = (await request(app).get('/api/questions?limit=50').set(auth(a.token))).body.items
    const ids = qs.filter((q: { options: unknown[] }) => q.options.length).map((q: { _id: string }) => q._id)
    await request(app).post('/api/questions/bulk').set(auth(a.token)).send({ ids, action: 'verify' }).expect(200)
    await request(app).post('/api/schedule/publish').set(auth(a.token)).send({ slots: [{ id: 's1', weekday: 1, subjectId: 'sub_math', startTime: '06:00', endTime: '07:00' }] }).expect(201)
    const cycle = (await request(app).post('/api/cycles/start').set(auth(a.token)).send({}).expect(201)).body.cycle
    const test = (await request(app).post('/api/mock-tests').set(auth(a.token)).send({ name: 'A test', type: 'subject_full', config: { subjectIds: ['sub_science'], questionCount: 2, durationMinutes: 5 } }).expect(201)).body.test
    const attempt = (await request(app).post('/api/attempts').set(auth(a.token)).send({ mockTestId: test._id }).expect(201)).body

    const B = auth(b.token)
    // Direct id access → 404 (existence not leaked)
    await request(app).get(`/api/documents/${docId}`).set(B).expect(404)
    await request(app).post(`/api/documents/${docId}/file-url`).set(B).expect(404)
    await request(app).delete(`/api/documents/${docId}`).set(B).expect(404)
    await request(app).get(`/api/questions/${qs[0]._id}`).set(B).expect(404)
    await request(app).patch(`/api/questions/${qs[0]._id}`).set(B).send({ questionText: 'hacked' }).expect(404)
    await request(app).post(`/api/questions/${qs[0]._id}/verify`).set(B).expect(404)
    await request(app).delete(`/api/questions/${qs[0]._id}`).set(B).expect(404)
    await request(app).get(`/api/cycles/${cycle._id}`).set(B).expect(404)
    await request(app).post(`/api/cycles/blocks/${cycle.blocks[0]._id}/start-learning`).set(B).expect(404)
    await request(app).get(`/api/mock-tests/${test._id}`).set(B).expect(404)
    await request(app).post('/api/attempts').set(B).send({ mockTestId: test._id }).expect(404)
    await request(app).get(`/api/attempts/${attempt.attemptId}`).set(B).expect(404)
    await request(app).put(`/api/attempts/${attempt.attemptId}/answers`).set(B).send({ answers: [] }).expect(404)
    await request(app).post(`/api/attempts/${attempt.attemptId}/submit`).set(B).expect(404)

    // Lists and aggregates are scoped
    expect((await request(app).get('/api/documents').set(B)).body.documents).toHaveLength(0)
    expect((await request(app).get('/api/questions').set(B)).body.total).toBe(0)
    expect((await request(app).get('/api/mock-tests').set(B)).body.items).toHaveLength(0)
    expect((await request(app).get('/api/attempts').set(B)).body.attempts).toHaveLength(0)
    expect((await request(app).get('/api/attempts/performance').set(B)).body.attempts).toBe(0)
    expect((await request(app).get('/api/schedule/versions').set(B)).body.versions).toHaveLength(0)
    expect((await request(app).get('/api/cycles/today').set(B)).body.cycles).toHaveLength(0)
    expect((await request(app).get('/api/mistakes').set(B)).body.mistakes).toHaveLength(0)

    // B cannot build a test from A's questions, and B's workspace is untouched
    const bTest = await request(app).post('/api/mock-tests').set(B).send({ name: 'steal', type: 'subject_full', config: { subjectIds: ['sub_science'], questionCount: 1, durationMinutes: 5 } })
    expect(bTest.body.error.code).toBe('INSUFFICIENT_QUESTIONS')

    // A still sees everything
    expect((await request(app).get(`/api/attempts/${attempt.attemptId}`).set(auth(a.token))).status).toBe(200)
  })
})
