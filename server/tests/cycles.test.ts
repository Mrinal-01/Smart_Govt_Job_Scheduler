import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { RevisionTask } from '../src/models/index.js'
import { app, auth, registerVerified, useTestDb, withWorkspace } from './helpers.js'

useTestDb()

const SUBJECTS = ['sub_math', 'sub_science', 'sub_reasoning', 'sub_current']
const FIRST_TOPIC: Record<string, string> = { sub_math: 'tp_pct_basics', sub_science: 'tp_newton', sub_reasoning: 'tp_num_series', sub_current: 'tp_schemes' }

async function setup() {
  const { token } = await registerVerified()
  await withWorkspace(token)
  await request(app).patch('/api/settings').set(auth(token)).send({ cycle: { subjectIds: SUBJECTS } }).expect(200)
  return token
}

const post = (token: string, path: string, body: unknown = {}) => request(app).post(`/api/cycles${path}`).set(auth(token)).send(body as object)

async function learnBlock(token: string, block: { _id: string }, entries: Array<{ topicId: string; completion: 'completed' | 'partial' }>) {
  await post(token, `/blocks/${block._id}/start-learning`).expect(200)
  return post(token, `/blocks/${block._id}/complete-learning`, { entries }).expect(200)
}

describe('study cycle engine', () => {
  it('Workflow B: cycle 1 learning creates topic-specific revision before learning in cycle 2', async () => {
    const token = await setup()

    // ---- Cycle 1: pure learning (nothing to revise yet)
    const c1 = (await post(token, '/start').expect(201)).body.cycle
    expect(c1.cycleNumber).toBe(1)
    expect(c1.blocks.map((b: { subjectId: string }) => b.subjectId)).toEqual(SUBJECTS)
    expect(c1.blocks.every((b: { revision: { required: boolean } }) => !b.revision.required)).toBe(true)

    for (const block of c1.blocks) {
      const entries: Array<{ topicId: string; completion: 'completed' | 'partial' }> = [{ topicId: FIRST_TOPIC[block.subjectId], completion: 'completed' }]
      if (block.subjectId === 'sub_math') entries.push({ topicId: 'tp_pct_succ', completion: 'partial' })
      await learnBlock(token, block, entries)
    }
    const today1 = (await request(app).get('/api/cycles/today').set(auth(token)).expect(200)).body
    expect(today1.cycles[0].status).toBe('completed')
    expect(today1.upcomingRevision.map((u: { topicId: string }) => u.topicId).sort()).toEqual(Object.values(FIRST_TOPIC).sort())

    // ---- Cycle 2: each subject starts with revision of its cycle-1 topics
    const c2 = (await post(token, '/start').expect(201)).body.cycle
    expect(c2.cycleNumber).toBe(2)
    for (const block of c2.blocks) {
      expect(block.revision.required).toBe(true)
      expect(block.revision.plannedMinutes).toBe(10)
      expect(block.tasks.map((t: { topicId: string }) => t.topicId)).toEqual([FIRST_TOPIC[block.subjectId]])
    }
    // Partial topic is NOT eligible for revision
    expect(await RevisionTask.exists({ topicId: 'tp_pct_succ' })).toBeNull()

    const math = c2.blocks.find((b: { subjectId: string }) => b.subjectId === 'sub_math')
    // Learning is blocked until revision is resolved (mandatory by default)
    const blocked = await post(token, `/blocks/${math._id}/start-learning`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('REVISION_REQUIRED')
    // Opening/starting the revision does not complete it
    const task = math.tasks[0]
    const notStarted = await post(token, `/revision-tasks/${task._id}/complete`, { outcome: 'recalled' })
    expect(notStarted.body.error.code).toBe('REVISION_NOT_STARTED')
    await post(token, `/blocks/${math._id}/start-revision`).expect(200)
    let detail = (await request(app).get(`/api/cycles/${c2._id}`).set(auth(token)).expect(200)).body.cycle
    expect(detail.blocks[0].status).toBe('revision')
    expect(detail.blocks[0].stats.topicsCompleted).toBe(0)

    const done = await post(token, `/revision-tasks/${task._id}/complete`, { outcome: 'partial', questionsAttempted: 5, questionsCorrect: 4 }).expect(200)
    expect(done.body.task.accuracy).toBe(80)
    await post(token, `/revision-tasks/${task._id}/complete`, { outcome: 'recalled' }).expect(409) // no double completion

    detail = (await request(app).get(`/api/cycles/${c2._id}`).set(auth(token)).expect(200)).body.cycle
    const mathBlock = detail.blocks.find((b: { subjectId: string }) => b.subjectId === 'sub_math')
    expect(mathBlock.status).toBe('ready')
    expect(mathBlock.stats).toMatchObject({ topicsDue: 1, topicsCompleted: 1, topicsSkipped: 0, revisionAccuracy: 80, plannedRevisionMinutes: 10 })

    // Then new learning continues
    await learnBlock(token, mathBlock, [{ topicId: 'tp_pct_succ', completion: 'completed' }])

    // Science: skip revision with a reason, then learn
    const sci = detail.blocks.find((b: { subjectId: string }) => b.subjectId === 'sub_science')
    await post(token, `/blocks/${sci._id}/skip-revision`, { reason: 'x' }).expect(400)
    await post(token, `/blocks/${sci._id}/skip-revision`, { reason: 'Revised this topic in the morning' }).expect(200)
    await learnBlock(token, sci, [{ topicId: 'tp_eqm', completion: 'completed' }])

    // Reasoning: skip the whole subject — its revision task must carry forward
    const rea = detail.blocks.find((b: { subjectId: string }) => b.subjectId === 'sub_reasoning')
    await post(token, `/blocks/${rea._id}/skip`, { reason: 'Ran out of time' }).expect(200)
    // End the cycle early (Current Affairs never started)
    await post(token, `/${c2._id}/end`, { reason: 'Dinner' }).expect(200)

    const carry = (await request(app).get('/api/cycles/carry-forward').set(auth(token)).expect(200)).body
    expect(carry.pendingTasks.map((t: { topicId: string }) => t.topicId).sort()).toEqual(['tp_num_series', 'tp_schemes'])
    expect(carry.unfinishedBlocks.map((b: { status: string }) => b.status).sort()).toEqual(['incomplete', 'skipped'])

    // ---- Cycle 3: only cycle-2 completions become *new* tasks; no duplicates for cycle-1 topics
    const c3 = (await post(token, '/start').expect(201)).body.cycle
    const c3Math = c3.blocks.find((b: { subjectId: string }) => b.subjectId === 'sub_math')
    expect(c3Math.tasks.map((t: { topicId: string }) => t.topicId)).toEqual(['tp_pct_succ'])
    const c3Sci = c3.blocks.find((b: { subjectId: string }) => b.subjectId === 'sub_science')
    expect(c3Sci.tasks.map((t: { topicId: string }) => t.topicId)).toEqual(['tp_eqm'])
    // carried-forward tasks are re-attached, not duplicated
    const c3Rea = c3.blocks.find((b: { subjectId: string }) => b.subjectId === 'sub_reasoning')
    expect(c3Rea.tasks.map((t: { topicId: string }) => t.topicId)).toEqual(['tp_num_series'])
    expect(await RevisionTask.countDocuments({ topicId: 'tp_pct_basics' })).toBe(1)
    expect(await RevisionTask.countDocuments({})).toBe(6)
  })

  it('does not force revision on a subject with no eligible topics, and enforces one active cycle', async () => {
    const token = await setup()
    const c1 = (await post(token, '/start').expect(201)).body.cycle
    await learnBlock(token, c1.blocks[0], [{ topicId: 'tp_pct_basics', completion: 'completed' }])
    const again = await post(token, '/start')
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('CYCLE_ACTIVE')
    const c2 = (await post(token, '/start', { force: true }).expect(201)).body.cycle
    const sci = c2.blocks.find((b: { subjectId: string }) => b.subjectId === 'sub_science')
    expect(sci.revision.required).toBe(false)
    await post(token, `/blocks/${sci._id}/start-learning`).expect(200)
  })

  it('validates learning entries against the block subject and curriculum', async () => {
    const token = await setup()
    const c1 = (await post(token, '/start').expect(201)).body.cycle
    const math = c1.blocks[0]
    await post(token, `/blocks/${math._id}/start-learning`).expect(200)
    expect((await post(token, `/blocks/${math._id}/complete-learning`, { entries: [{ topicId: 'tp_newton', completion: 'completed' }] })).body.error.code).toBe(
      'TOPIC_SUBJECT_MISMATCH'
    )
    expect((await post(token, `/blocks/${math._id}/complete-learning`, { entries: [{ topicId: 'tp_missing', completion: 'completed' }] })).body.error.code).toBe(
      'UNKNOWN_TOPIC'
    )
    expect((await post(token, `/blocks/${math._id}/complete-learning`, { entries: [] })).status).toBe(400)
  })

  it('respects configurable revision settings (per-subject minutes, max topics, optional revision)', async () => {
    const token = await setup()
    await request(app)
      .patch('/api/settings')
      .set(auth(token))
      .send({ cycle: { revisionMinutesBySubject: { sub_math: 15 }, maxTopicsPerRevisionBlock: 1, revisionMandatory: false } })
      .expect(200)
    const c1 = (await post(token, '/start').expect(201)).body.cycle
    await learnBlock(token, c1.blocks[0], [
      { topicId: 'tp_pct_basics', completion: 'completed' },
      { topicId: 'tp_ratio_basics', completion: 'completed' }
    ])
    const c2 = (await post(token, '/start', { force: true }).expect(201)).body.cycle
    const math = c2.blocks[0]
    expect(math.revision.plannedMinutes).toBe(15)
    expect(math.tasks).toHaveLength(1) // second one deferred
    expect(await RevisionTask.countDocuments({ status: 'deferred' })).toBe(1)
    // optional revision: learning may start; unresolved task returns to carry-forward
    await post(token, `/blocks/${math._id}/start-learning`).expect(200)
    const carry = (await request(app).get('/api/cycles/carry-forward').set(auth(token)).expect(200)).body
    expect(carry.pendingTasks).toHaveLength(2)
  })
})
