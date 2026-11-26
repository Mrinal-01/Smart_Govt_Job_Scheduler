import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ScheduleVersion } from '../src/models/index.js'
import { addDays, dateKey } from '../src/lib/dates.js'
import { app, auth, registerVerified, useTestDb, withWorkspace } from './helpers.js'

useTestDb()

const slot = (id: string, weekday: number, subjectId: string, start: string, end: string) => ({
  id,
  weekday,
  subjectId,
  label: 'Learning',
  startTime: start,
  endTime: end,
  requiresRevision: true,
  learningTarget: '',
  practiceTarget: 10,
  reminderEnabled: true,
  breakAfterMinutes: 10,
  order: 0,
  sessionNumber: 1
})

async function setup() {
  const { token } = await registerVerified()
  await withWorkspace(token)
  return token
}

const publish = (token: string, body: Record<string, unknown>) => request(app).post('/api/schedule/publish').set(auth(token)).send(body)

describe('schedule versioning & change governance', () => {
  it('first publish is a free baseline effective today; derived duration is server-computed', async () => {
    const token = await setup()
    const res = await publish(token, { slots: [slot('s1', 1, 'sub_math', '06:00', '07:30')], changeReason: '' }).expect(201)
    expect(res.body.version.version).toBe(1)
    expect(res.body.version.countsTowardLimit).toBe(false)
    expect(res.body.version.effectiveFrom).toBe(dateKey())
    expect(res.body.version.slots[0].durationMinutes).toBe(90)
    expect(res.body.usage).toMatchObject({ used: 0, remaining: 3, limit: 3 })
  })

  it('counts published changes, blocks the 4th within 7 days and explains when the next is available', async () => {
    const token = await setup()
    await publish(token, { slots: [slot('s1', 1, 'sub_math', '06:00', '07:00')] }).expect(201)
    for (let i = 1; i <= 3; i += 1) {
      const r = await publish(token, { slots: [slot('s1', 1, 'sub_math', `${String(6 + i).padStart(2, '0')}:00`, `${String(7 + i).padStart(2, '0')}:00`)], changeReason: `change ${i}` }).expect(201)
      expect(r.body.usage.remaining).toBe(3 - i)
      expect(r.body.version.effectiveFrom).toBe(addDays(dateKey(), 1))
    }
    const blocked = await publish(token, { slots: [slot('s1', 1, 'sub_math', '11:00', '12:00')], changeReason: 'one more' })
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('SCHEDULE_CHANGE_LIMIT')
    expect(blocked.body.error.details.nextAvailableAt).toBeTruthy()
    expect(new Date(blocked.body.error.details.nextAvailableAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000)

    // Emergency override requires a reason and is audited.
    const noReason = await publish(token, { slots: [slot('s1', 1, 'sub_math', '11:00', '12:00')], override: true, overrideReason: 'short' })
    expect(noReason.body.error.code).toBe('OVERRIDE_REASON_REQUIRED')
    const ok = await publish(token, {
      slots: [slot('s1', 1, 'sub_math', '11:00', '12:00')],
      override: true,
      overrideReason: 'Hospital visit changes my mornings for two weeks'
    }).expect(201)
    expect(ok.body.version.override).toBe(true)
    const notes = await request(app).get('/api/notifications').set(auth(token)).expect(200)
    expect(notes.body.notifications[0].type).toBe('schedule_override')
  })

  it('rejects no-op publishes, past/today effective dates and unknown subjects', async () => {
    const token = await setup()
    const slots = [slot('s1', 2, 'sub_science', '06:00', '07:00')]
    await publish(token, { slots }).expect(201)
    expect((await publish(token, { slots })).body.error.code).toBe('NO_CHANGES')
    const today = await publish(token, { slots: [slot('s1', 2, 'sub_science', '08:00', '09:00')], effectiveFrom: dateKey() })
    expect(today.body.error.code).toBe('INVALID_EFFECTIVE_DATE')
    const bad = await publish(token, { slots: [slot('s2', 2, 'sub_nope', '08:00', '09:00')] })
    expect(bad.body.error.code).toBe('UNKNOWN_SUBJECT')
    const inverted = await publish(token, { slots: [slot('s3', 2, 'sub_math', '09:00', '08:00')] })
    expect(inverted.status).toBe(400)
  })

  it('keeps immutable history with diffs and resolves the effective version per date', async () => {
    const token = await setup()
    await publish(token, { slots: [slot('s1', 1, 'sub_math', '06:00', '07:00')] }).expect(201)
    await publish(token, { slots: [slot('s1', 1, 'sub_math', '06:00', '07:00'), slot('s2', 1, 'sub_current', '20:00', '20:30')], changeReason: 'Add CA' }).expect(201)
    const history = await request(app).get('/api/schedule/versions').set(auth(token)).expect(200)
    expect(history.body.versions).toHaveLength(2)
    expect(history.body.versions[0].changes.added).toEqual(['s2'])
    expect(history.body.versions[0].changeReason).toBe('Add CA')

    const todayV = await request(app).get(`/api/schedule/effective?date=${dateKey()}`).set(auth(token)).expect(200)
    expect(todayV.body.version.version).toBe(1)
    const tomorrowV = await request(app).get(`/api/schedule/effective?date=${addDays(dateKey(), 1)}`).set(auth(token)).expect(200)
    expect(tomorrowV.body.version.version).toBe(2)
    const status = await request(app).get('/api/schedule').set(auth(token)).expect(200)
    expect(status.body.pending.version).toBe(2)
    expect(status.body.active.version).toBe(1)

    await expect(ScheduleVersion.updateOne({ version: 1 }, { $set: { changeReason: 'tamper' } })).rejects.toThrow(/immutable/)
  })
})
