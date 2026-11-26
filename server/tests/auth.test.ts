import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { setGoogleVerifier } from '../src/integrations/google.js'
import { RefreshSession, User } from '../src/models/index.js'
import { app, auth, CSRF, lastMailToken, PASSWORD, refreshCookie, registerVerified, useTestDb } from './helpers.js'

useTestDb()

const register = (body: Record<string, unknown>) => request(app).post('/api/auth/register').send(body)

describe('registration', () => {
  it('validates input and returns field errors', async () => {
    const res = await register({ name: 'A', email: 'not-an-email', password: 'short', confirmPassword: 'x', acceptTerms: false })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    const paths = res.body.error.details.issues.map((i: { path: string }) => i.path)
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password', 'acceptTerms']))
  })

  it('rejects mismatched confirmation and weak passwords', async () => {
    const mismatch = await register({ name: 'Asha', email: 'a@x.com', password: PASSWORD, confirmPassword: 'Different-9x', acceptTerms: true })
    expect(mismatch.body.error.details.issues[0].path).toBe('confirmPassword')
    const noDigit = await register({ name: 'Asha', email: 'a@x.com', password: 'onlylettersherexx', confirmPassword: 'onlylettersherexx', acceptTerms: true })
    expect(noDigit.status).toBe(400)
  })

  it('hashes with argon2id, normalizes email and blocks duplicates', async () => {
    await register({ name: 'Asha', email: '  Asha@Example.COM ', password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true }).expect(201)
    const user = await User.findOne({ email: 'asha@example.com' }).select('+passwordHash')
    expect(user).toBeTruthy()
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/)
    expect(user!.passwordHash).not.toContain(PASSWORD)
    const dup = await register({ name: 'Other', email: 'ASHA@example.com', password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('EMAIL_IN_USE')
  })
})

describe('email verification and login', () => {
  it('requires verification before password login', async () => {
    await register({ name: 'Ravi', email: 'ravi@example.com', password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true }).expect(201)
    const blocked = await request(app).post('/api/auth/login').send({ email: 'ravi@example.com', password: PASSWORD })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED')

    await request(app).post('/api/auth/resend-verification').send({ email: 'ravi@example.com' }).expect(202)
    const token = lastMailToken('verify-email', 'ravi@example.com')
    await request(app).post('/api/auth/verify-email').send({ token }).expect(200)
    // single use
    await request(app).post('/api/auth/verify-email').send({ token }).expect(422)

    const ok = await request(app).post('/api/auth/login').send({ email: 'RAVI@example.com', password: PASSWORD }).expect(200)
    expect(ok.body.accessToken).toBeTruthy()
    expect(refreshCookie(ok)).toMatch(/^studyos_rt=/)
    const setCookie = ([] as string[]).concat(ok.headers['set-cookie']).join(';')
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Path=\/api\/auth/)
    expect(ok.body).not.toHaveProperty('refreshToken')

    const me = await request(app).get('/api/auth/me').set(auth(ok.body.accessToken)).expect(200)
    expect(me.body.user.email).toBe('ravi@example.com')
  })

  it('returns one generic error for unknown email and wrong password, and locks after repeated failures', async () => {
    await registerVerified('lock@example.com')
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD })
    const wrong = await request(app).post('/api/auth/login').send({ email: 'lock@example.com', password: 'Wrong-pass-123' })
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(unknown.body.error.message).toBe(wrong.body.error.message)
    for (let i = 0; i < 4; i += 1) await request(app).post('/api/auth/login').send({ email: 'lock@example.com', password: 'Wrong-pass-123' })
    const locked = await request(app).post('/api/auth/login').send({ email: 'lock@example.com', password: PASSWORD })
    expect(locked.status).toBe(429)
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED')
  })

  it('rejects requests without or with a bad access token', async () => {
    await request(app).get('/api/auth/me').expect(401)
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer nope').expect(401)
  })
})

describe('refresh token rotation', () => {
  it('rotates, rejects reuse and revokes the whole family', async () => {
    const { cookie } = await registerVerified()
    // CSRF header is required for the cookie endpoint
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(403)

    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set(CSRF).expect(200)
    const rotated = refreshCookie(first)!
    expect(rotated).not.toBe(cookie)
    expect(first.body.accessToken).toBeTruthy()

    // Simulate an attacker replaying the old token after the grace window.
    await RefreshSession.updateMany({ revokedReason: 'rotated' }, { $set: { revokedAt: new Date(Date.now() - 60_000) } })
    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set(CSRF)
    expect(reuse.status).toBe(401)
    expect(reuse.body.error.code).toBe('REFRESH_REUSED')
    // The legitimate (rotated) token is now dead too.
    await request(app).post('/api/auth/refresh').set('Cookie', rotated).set(CSRF).expect(401)
  })

  it('treats a near-simultaneous reuse as a benign race', async () => {
    const { cookie } = await registerVerified()
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).set(CSRF).expect(200)
    const race = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set(CSRF)
    expect(race.status).toBe(409)
    expect(race.body.error.code).toBe('REFRESH_RACE')
  })
})

describe('logout', () => {
  it('logout revokes the refresh session', async () => {
    const { cookie } = await registerVerified()
    await request(app).post('/api/auth/logout').set('Cookie', cookie).set(CSRF).expect(204)
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).set(CSRF).expect(401)
  })

  it('logout-all invalidates access tokens immediately and every device', async () => {
    const a = await registerVerified()
    const second = await request(app).post('/api/auth/login').send({ email: 'student@example.com', password: PASSWORD }).expect(200)
    const sessions = await request(app).get('/api/auth/sessions').set(auth(a.token)).expect(200)
    expect(sessions.body.sessions).toHaveLength(2)
    await request(app).post('/api/auth/logout-all').set(auth(a.token)).expect(204)
    await request(app).get('/api/auth/me').set(auth(a.token)).expect(401)
    await request(app).get('/api/auth/me').set(auth(second.body.accessToken)).expect(401)
    await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie(second)!).set(CSRF).expect(401)
  })

  it('a user can revoke one other session', async () => {
    const a = await registerVerified()
    const second = await request(app).post('/api/auth/login').send({ email: 'student@example.com', password: PASSWORD }).expect(200)
    const list = await request(app).get('/api/auth/sessions').set(auth(a.token)).expect(200)
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current)
    await request(app).delete(`/api/auth/sessions/${other.id}`).set(auth(a.token)).expect(204)
    await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie(second)!).set(CSRF).expect(401)
    await request(app).get('/api/auth/me').set(auth(a.token)).expect(200)
  })
})

describe('password reset', () => {
  it('resets with a single-use token and signs out other sessions', async () => {
    const { cookie } = await registerVerified()
    const generic = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(202)
    const real = await request(app).post('/api/auth/forgot-password').send({ email: 'student@example.com' }).expect(202)
    expect(generic.body).toEqual(real.body)
    const token = lastMailToken('reset-password')
    const newPassword = 'Brand-new-pass-77'
    await request(app).post('/api/auth/reset-password').send({ token, password: newPassword, confirmPassword: newPassword }).expect(200)
    await request(app).post('/api/auth/reset-password').send({ token, password: newPassword, confirmPassword: newPassword }).expect(422)
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).set(CSRF).expect(401)
    await request(app).post('/api/auth/login').send({ email: 'student@example.com', password: PASSWORD }).expect(401)
    await request(app).post('/api/auth/login').send({ email: 'student@example.com', password: newPassword }).expect(200)
  })
})

describe('Google sign-in (verifier mocked — no real credentials)', () => {
  afterEach(() => setGoogleVerifier(null))
  const fake = (identity: { sub: string; email: string | null; emailVerified: boolean; name?: string }) =>
    setGoogleVerifier(async (token) => {
      if (token !== 'valid-google-id-token-xxxxxxxx') throw Object.assign(new Error('bad'), { status: 401 })
      return { name: null, ...identity }
    })
  const google = (body: Record<string, unknown>) => request(app).post('/api/auth/google').send({ credential: 'valid-google-id-token-xxxxxxxx', ...body })

  it('requires terms for first-time Google registration, then signs in', async () => {
    fake({ sub: 'g-1', email: 'new@gmail.com', emailVerified: true, name: 'New Person' })
    const noTerms = await google({})
    expect(noTerms.status).toBe(409)
    expect(noTerms.body.error.code).toBe('TERMS_REQUIRED')
    const created = await google({ acceptTerms: true }).expect(201)
    expect(created.body.user.emailVerified).toBe(true)
    expect(created.body.user.googleLinked).toBe(true)
    const again = await google({}).expect(200)
    expect(again.body.user.id).toBe(created.body.user.id)
  })

  it('never auto-links an existing email account; requires the password', async () => {
    await registerVerified('owner@example.com')
    fake({ sub: 'g-2', email: 'owner@example.com', emailVerified: true })
    const res = await google({ acceptTerms: true })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ACCOUNT_LINK_REQUIRED')
    const ticket = res.body.error.details.linkTicket
    await request(app).post('/api/auth/google/link').send({ linkTicket: ticket, password: 'Wrong-pass-123' }).expect(401)
    const linked = await request(app).post('/api/auth/google/link').send({ linkTicket: ticket, password: PASSWORD }).expect(200)
    expect(linked.body.user.googleLinked).toBe(true)
    await google({}).expect(200)
  })

  it('rejects Google accounts without a verified email', async () => {
    fake({ sub: 'g-3', email: null, emailVerified: false })
    expect((await google({ acceptTerms: true })).body.error.code).toBe('GOOGLE_EMAIL_MISSING')
    fake({ sub: 'g-4', email: 'x@gmail.com', emailVerified: false })
    expect((await google({ acceptTerms: true })).body.error.code).toBe('GOOGLE_EMAIL_UNVERIFIED')
  })

  it('rejects tokens the verifier does not accept', async () => {
    setGoogleVerifier(async () => {
      const { unauthorized } = await import('../src/lib/errors.js')
      throw unauthorized('bad token', 'GOOGLE_TOKEN_INVALID')
    })
    const res = await google({ acceptTerms: true })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('GOOGLE_TOKEN_INVALID')
  })
})
