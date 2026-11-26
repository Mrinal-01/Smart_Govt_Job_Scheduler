import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app, auth, registerVerified, useTestDb, workspaceData } from './helpers.js'

useTestDb()

describe('workspace persistence (legacy StudyState on the server)', () => {
  it('404 before onboarding, then create, read and save with optimistic concurrency', async () => {
    const { token } = await registerVerified()
    const missing = await request(app).get('/api/workspace').set(auth(token))
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('WORKSPACE_NOT_FOUND')

    await request(app).post('/api/workspace').set(auth(token)).send({ origin: 'import', data: workspaceData() }).expect(201)
    await request(app).post('/api/workspace').set(auth(token)).send({ origin: 'import', data: workspaceData() }).expect(409)

    const ws = await request(app).get('/api/workspace').set(auth(token)).expect(200)
    expect(ws.body.revision).toBe(1)
    expect(ws.body.data.subjects).toHaveLength(4)

    const data = { ...workspaceData(), profile: { ...workspaceData().profile, name: 'Renamed' } }
    const saved = await request(app).put('/api/workspace').set(auth(token)).send({ baseRevision: 1, data }).expect(200)
    expect(saved.body.revision).toBe(2)
    const stale = await request(app).put('/api/workspace').set(auth(token)).send({ baseRevision: 1, data })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('WORKSPACE_CONFLICT')
    expect(stale.body.error.details.currentRevision).toBe(2)
  })

  it('rejects malformed workspaces and operator-injection keys', async () => {
    const { token } = await registerVerified()
    await request(app).post('/api/workspace').set(auth(token)).send({ origin: 'fresh', data: { version: 3 } }).expect(400)
    const inj = await request(app).post('/api/auth/login').send({ email: { $gt: '' }, password: 'x' })
    expect(inj.status).toBe(400)
    expect(inj.body.error.code).toBe('FORBIDDEN_KEYS')
  })
})
