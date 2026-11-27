import { Types } from 'mongoose'
import { toMinutes, weekdayOfKey } from '../../lib/clock.js'
import { addDays } from '../../lib/dates.js'
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors.js'
import { GateOverride, RevisionObligation, ScheduleVersion, StudySession } from '../../models/index.js'
import { notify } from '../notifications/notification.routes.js'
import { normalizeSlot, type SlotInput } from '../schedule/slots.js'
import { loadCurriculum, type Curriculum } from '../workspace/curriculum.service.js'
import {
  isDuplicateKey,
  isStudyDay,
  planContext,
  restReason,
  revisionMinutesFor,
  weekStartOf,
  type Oid,
  type PlanContext
} from './plan.context.js'
import { ensureNextDay, ensureWeekly, generateSameDay, getCarryover, obligationState, serializeMany, type ObligationView } from './plan.revision.js'

/*
 * Study-plan session engine
 * -------------------------
 * Sessions are materialized per date from the ScheduleVersion that governs that date
 * (unique userId+date+slotId), then never re-snapshotted. Stored status is one of
 * scheduled | in_progress | completed | skipped | missed. Everything else — locked,
 * ready, pending_revision, revision_in_progress, revision_completed, overdue,
 * exception_approved — is derived on every read from the authoritative records, so a
 * refresh can never lose or invent a gate. Only the server evaluates eligibility.
 */

const LOOKBACK_DAYS = 14
const TERMINAL = ['completed', 'skipped', 'missed']

type LeanSession = NonNullable<Awaited<ReturnType<typeof findSessionLean>>>
type LeanOverride = NonNullable<Awaited<ReturnType<typeof findOverrideLean>>>
type LeanObligation = NonNullable<Awaited<ReturnType<typeof findObligationLean>>>
const findSessionLean = (id: Oid) => StudySession.findById(id).lean()
const findOverrideLean = (id: Oid) => GateOverride.findById(id).lean()
const findObligationLean = (id: Oid) => RevisionObligation.findById(id).lean()

/* ------------------------------------------------------------------ */
/* Materialization                                                     */
/* ------------------------------------------------------------------ */

async function versionFor(userId: Oid, date: string) {
  return ScheduleVersion.findOne({ userId, effectiveFrom: { $lte: date } }).sort({ version: -1 }).lean()
}

function slotsForDate(version: { slots?: unknown[] } | null, date: string): SlotInput[] {
  if (!version) return []
  const wd = weekdayOfKey(date)
  const slots = (version.slots ?? []).map((s) => normalizeSlot(s as Record<string, unknown>)).filter((s) => s.weekday === wd)
  slots.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || a.order - b.order)
  // Learning slots without an explicit cycle number get their ordinal within the subject.
  const counters = new Map<string, number>()
  for (const s of slots) {
    if (s.sessionType !== 'learning') continue
    const n = (counters.get(s.subjectId) ?? 0) + 1
    counters.set(s.subjectId, n)
    if (s.cycleNumber === null) s.cycleNumber = n
  }
  return slots
}

function snapshot(ctx: PlanContext, cur: Curriculum, versionNo: number, date: string, slot: SlotInput) {
  const chapter = slot.chapterId ? cur.chapter(slot.chapterId) : undefined
  return {
    userId: ctx.userId,
    date,
    slotId: slot.id,
    scheduleVersion: versionNo,
    subjectId: slot.subjectId,
    subjectName: cur.subject(slot.subjectId)?.name ?? 'Unknown subject',
    chapterId: chapter?.id ?? null,
    chapterName: chapter?.name ?? null,
    plannedTopics: slot.topicIds
      .map((id) => cur.topic(id))
      .filter(Boolean)
      .map((t) => ({ topicId: t!.id, topicName: t!.name, chapterId: t!.chapterId, chapterName: cur.chapter(t!.chapterId)?.name ?? '' })),
    sessionType: slot.sessionType,
    cycleNumber: slot.cycleNumber,
    sessionNumber: slot.sessionNumber,
    label: slot.label,
    startTime: slot.startTime,
    endTime: slot.endTime,
    plannedMinutes: slot.durationMinutes,
    learningTarget: slot.learningTarget,
    practiceTarget: slot.practiceTarget,
    revisionMinutes: revisionMinutesFor(ctx, slot.subjectId, slot.revisionMinutes),
    revisionPolicy: slot.revisionPolicy,
    prerequisiteSlotIds: slot.prerequisiteSlotIds,
    order: slot.order,
    status: 'scheduled'
  }
}

/** Creates any missing sessions for `date` (≤ today). Existing sessions are never touched. */
async function materializeDate(ctx: PlanContext, cur: Curriculum, date: string) {
  if (date > ctx.today || !isStudyDay(ctx, date)) return
  const version = await versionFor(ctx.userId, date)
  const slots = slotsForDate(version, date)
  if (!version || !slots.length) return
  const existing = new Set((await StudySession.find({ userId: ctx.userId, date }).select('slotId').lean()).map((s) => s.slotId))
  const missing = slots.filter((s) => !existing.has(s.id))
  if (!missing.length) return
  try {
    await StudySession.insertMany(
      missing.map((s) => snapshot(ctx, cur, version.version, date, s)),
      { ordered: false }
    )
  } catch (err) {
    // A concurrent request materialized the same day — the unique index kept one copy.
    const e = err as { code?: number; writeErrors?: Array<{ code?: number; err?: { code?: number } }> }
    if (!(isDuplicateKey(e) || (e.writeErrors ?? []).every((w) => (w.code ?? w.err?.code) === 11000))) throw err
  }
}

/** Materializes every day from the last materialized one (bounded) through today and closes past days. */
async function ensureMaterialized(ctx: PlanContext) {
  const first = await ScheduleVersion.findOne({ userId: ctx.userId }).sort({ effectiveFrom: 1 }).select('effectiveFrom').lean()
  if (!first) return
  const last = await StudySession.findOne({ userId: ctx.userId, date: { $lte: ctx.today } }).sort({ date: -1 }).select('date').lean()
  // First use starts today: days before the engine existed are never back-filled as "missed".
  // Afterwards, days the student did not open the app are caught up (bounded) so misses are recorded.
  let from = last ? addDays(ctx.today, -LOOKBACK_DAYS) : ctx.today
  if (last && last.date > from) from = last.date
  if (first.effectiveFrom > from) from = first.effectiveFrom
  if (from <= ctx.today) {
    const cur = await loadCurriculum(ctx.userId)
    for (let d = from; d <= ctx.today; d = addDays(d, 1)) await materializeDate(ctx, cur, d)
  }
  // A scheduled session whose day has passed (in the student's zone) was missed.
  await StudySession.updateMany({ userId: ctx.userId, date: { $lt: ctx.today }, status: 'scheduled' }, { $set: { status: 'missed' } })
}

/** Runs all lazy, idempotent maintenance needed before any read or gate decision. */
async function prepare(userId: Oid) {
  const ctx = await planContext(userId)
  await ensureMaterialized(ctx)
  await ensureNextDay(ctx)
  await ensureWeekly(ctx, weekStartOf(ctx.today))
  return ctx
}

/* ------------------------------------------------------------------ */
/* Gate evaluation                                                     */
/* ------------------------------------------------------------------ */

export type SessionState =
  | 'scheduled'
  | 'locked'
  | 'ready'
  | 'in_progress'
  | 'completed'
  | 'pending_revision'
  | 'revision_in_progress'
  | 'revision_completed'
  | 'overdue'
  | 'missed'
  | 'skipped'
  | 'exception_approved'

export interface LockReason {
  kind: 'next_day' | 'same_day' | 'prerequisite'
  message: string
  obligationId?: string
  sessionId?: string
}

interface DayData {
  sessions: LeanSession[]
  sameDay: LeanObligation[]
  carry: LeanObligation[]
  overrides: LeanOverride[]
}

async function loadDayData(ctx: PlanContext, date: string, sessions?: LeanSession[]): Promise<DayData> {
  const list = sessions ?? (await StudySession.find({ userId: ctx.userId, date }).lean())
  const [sameDay, carry, overrides] = await Promise.all([
    RevisionObligation.find({ userId: ctx.userId, type: 'same_day', sourceDate: date }).lean(),
    ctx.settings.plan.nextDayRevisionEnabled && isStudyDay(ctx, date)
      ? RevisionObligation.find({
          userId: ctx.userId,
          type: 'next_day',
          $or: [{ status: { $ne: 'completed' }, dueDate: { $lte: date } }, { status: 'completed', dueDate: date }]
        }).lean()
      : Promise.resolve([] as LeanObligation[]),
    GateOverride.find({ userId: ctx.userId, sessionDate: date }).sort({ createdAt: -1 }).lean()
  ])
  return { sessions: list, sameDay, carry, overrides }
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function evaluate(ctx: PlanContext, s: LeanSession, day: DayData) {
  const date = s.date
  const isToday = date === ctx.today
  const learning = s.sessionType === 'learning'
  const start = toMinutes(s.startTime)
  const open = (o: LeanObligation) => o.status !== 'completed'

  const relevantSame = learning && s.revisionPolicy !== 'none' ? day.sameDay.filter((o) => o.subjectId === s.subjectId && toMinutes(o.sourceStartTime ?? '00:00') < start) : []
  const perSubject = ctx.settings.plan.carryoverScope !== 'all_subjects'
  // Carryover gates either only this subject's learning (default) or every learning session.
  const relevantCarry = learning ? (perSubject ? day.carry.filter((o) => o.subjectId === s.subjectId) : day.carry) : []
  const prereqs = s.prerequisiteSlotIds.map((slotId) => day.sessions.find((x) => x.slotId === slotId)).filter(Boolean) as LeanSession[]

  const lockReasons: LockReason[] = []
  if (s.status === 'scheduled') {
    for (const o of relevantCarry.filter(open)) {
      lockReasons.push({
        kind: 'next_day',
        obligationId: String(o._id),
        message: perSubject
          ? `Revise ${o.subjectName} topics studied on ${o.sourceDate} (${o.topics.map((t) => t.topicName).join(', ')}) before starting ${o.subjectName} today.`
          : `Daily carryover revision of ${o.subjectName} (${o.topics.map((t) => t.topicName).join(', ')}) from ${o.sourceDate} must be completed before any new learning today.`
      })
    }
    for (const o of relevantSame.filter(open)) {
      lockReasons.push({
        kind: 'same_day',
        obligationId: String(o._id),
        message: `Revise ${o.subjectName} cycle ${o.sourceCycleNumber ?? '?'} topics (${o.topics.map((t) => t.topicName).join(', ')}) before this session.`
      })
    }
    for (const p of prereqs.filter((p) => p.status !== 'completed')) {
      lockReasons.push({ kind: 'prerequisite', sessionId: String(p._id), message: `Complete ${p.subjectName} — ${p.label || 'session'} (${p.startTime}) first.` })
    }
  }
  const blockingObligations = lockReasons.filter((r) => r.obligationId).map((r) => r.obligationId!)
  const blockingSessions = lockReasons.filter((r) => r.sessionId).map((r) => r.sessionId!)
  const override =
    lockReasons.length > 0
      ? day.overrides.find(
          (o) =>
            String(o.sessionId) === String(s._id) &&
            blockingObligations.every((id) => o.obligationIds.map(String).includes(id)) &&
            blockingSessions.every((id) => o.prerequisiteSessionIds.map(String).includes(id))
        ) ?? null
      : s.overrideId
        ? day.overrides.find((o) => String(o._id) === String(s.overrideId)) ?? null
        : null

  const revisionRelevant = [...relevantCarry, ...relevantSame]
  let revisionStatus: 'not_required' | 'pending' | 'in_progress' | 'completed' | 'bypassed' = 'not_required'
  if (revisionRelevant.length) {
    const openOnes = revisionRelevant.filter(open)
    if (!openOnes.length) revisionStatus = 'completed'
    else if (override && s.status !== 'completed') revisionStatus = 'bypassed'
    else if (openOnes.some((o) => o.status === 'in_progress')) revisionStatus = 'in_progress'
    else revisionStatus = 'pending'
  }

  let state: SessionState
  if (s.status === 'completed') state = 'completed'
  else if (s.status === 'skipped') state = 'skipped'
  else if (s.status === 'missed') state = 'missed'
  else if (s.status === 'in_progress') state = 'in_progress'
  else if (lockReasons.length && override) state = 'exception_approved'
  else if (lockReasons.length) {
    const revisionLocks = lockReasons.filter((r) => r.kind !== 'prerequisite')
    if (!revisionLocks.length) state = 'locked'
    else if (revisionRelevant.some((o) => o.status === 'in_progress')) state = 'revision_in_progress'
    else state = 'pending_revision'
  } else if (date > ctx.today) state = 'scheduled'
  else if (date < ctx.today) state = 'missed'
  else if (ctx.nowMinutes > toMinutes(s.endTime)) state = 'overdue'
  else if (revisionStatus === 'completed') state = 'revision_completed'
  else state = 'ready'

  // Topics to revise before this session (pending or already revised), else a preview of the preceding cycle.
  let previousTopics = relevantSame.flatMap((o) => o.topics.map((t) => t.topicName))
  if (!previousTopics.length && learning && s.revisionPolicy !== 'none') {
    const prev = day.sessions
      .filter((x) => x.subjectId === s.subjectId && x.sessionType === 'learning' && x.status === 'completed' && toMinutes(x.startTime) < start)
      .sort((a, b) => toMinutes(b.startTime) - toMinutes(a.startTime))[0]
    previousTopics = (prev?.completion?.topics ?? []).filter((t) => t.completion === 'completed').map((t) => t.topicName)
  }

  // The revision block(s) that sit immediately before this session in the day's timeline:
  // the subject's carryover before its first learning session, and the same-day revision before a later cycle.
  const learningToday = day.sessions.filter((x) => x.sessionType === 'learning').sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
  const anchor = perSubject ? learningToday.find((x) => x.subjectId === s.subjectId) : learningToday[0]
  const carryBefore = learning && anchor && String(anchor._id) === String(s._id) ? relevantCarry : []
  const sameBefore = relevantSame.filter((o) => open(o) || String(o.targetSessionId) === String(s._id))
  const blocks = [...carryBefore, ...sameBefore]
  let cursor = Math.max(0, start - blocks.reduce((a, o) => a + o.plannedMinutes, 0))
  const revisionsBefore = blocks.map((o) => {
    const windowStart = cursor
    cursor += o.plannedMinutes
    return {
      obligationId: String(o._id),
      type: o.type,
      subjectName: o.subjectName,
      sourceDate: o.sourceDate,
      sourceCycleNumber: o.sourceCycleNumber,
      topics: o.topics.map((t) => t.topicName),
      plannedMinutes: o.plannedMinutes,
      status: o.status,
      state: obligationState(o, ctx.today),
      bypassed: o.status !== 'completed' && (o.bypassedBy ?? []).length > 0,
      windowStart: hhmm(windowStart),
      windowEnd: hhmm(Math.min(cursor, start))
    }
  })

  return {
    state,
    revisionStatus,
    revisionsBefore,
    locked: lockReasons.length > 0 && !override,
    lockReasons,
    blockingObligationIds: blockingObligations,
    blockingSessionIds: blockingSessions,
    override: override ? { id: String(override._id), reason: override.reason, createdAt: override.createdAt } : null,
    canStart: isToday && s.status === 'scheduled' && (lockReasons.length === 0 || Boolean(override)),
    previousTopics: Array.from(new Set(previousTopics)),
    relevantObligationIds: revisionRelevant.map((o) => String(o._id))
  }
}

function serializeSession(ctx: PlanContext, s: LeanSession, day: DayData) {
  const ev = evaluate(ctx, s, day)
  return {
    id: String(s._id),
    persisted: true,
    slotId: s.slotId,
    date: s.date,
    scheduleVersion: s.scheduleVersion,
    subjectId: s.subjectId,
    subjectName: s.subjectName,
    chapterId: s.chapterId,
    chapterName: s.chapterName,
    plannedTopics: s.plannedTopics,
    sessionType: s.sessionType,
    cycleNumber: s.cycleNumber,
    sessionNumber: s.sessionNumber,
    label: s.label,
    startTime: s.startTime,
    endTime: s.endTime,
    plannedMinutes: s.plannedMinutes,
    learningTarget: s.learningTarget,
    practiceTarget: s.practiceTarget,
    revisionMinutes: s.revisionMinutes,
    revisionPolicy: s.revisionPolicy,
    prerequisiteSlotIds: s.prerequisiteSlotIds,
    status: s.status,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    actualMinutes: s.actualMinutes,
    completion: s.status === 'completed' ? s.completion : null,
    skipReason: s.skipReason,
    rescheduledFrom: s.rescheduledFrom,
    /** Learning completed ≠ revision completed ≠ topic mastered. Mastery is never set here. */
    learningCompleted: s.sessionType === 'learning' && s.status === 'completed',
    ...ev
  }
}
export type SessionView = ReturnType<typeof serializeSession>

/** Read-only projection of a future date from the version that will govern it. */
async function projectDate(ctx: PlanContext, date: string) {
  const version = await versionFor(ctx.userId, date)
  const slots = isStudyDay(ctx, date) ? slotsForDate(version, date) : []
  if (!version || !slots.length) return { version: version?.version ?? null, sessions: [] }
  const cur = await loadCurriculum(ctx.userId)
  return {
    version: version.version,
    sessions: slots.map((slot) => {
      const snap = snapshot(ctx, cur, version.version, date, slot)
      return {
        ...snap,
        id: null,
        persisted: false,
        userId: undefined,
        status: 'scheduled' as const,
        state: 'scheduled' as SessionState,
        revisionStatus: 'not_required' as const,
        revisionsBefore: [],
        locked: false,
        lockReasons: [] as LockReason[],
        override: null,
        canStart: false,
        previousTopics: [] as string[],
        learningCompleted: false,
        completion: null
      }
    })
  }
}

function cyclesOf(sessions: Array<{ cycleNumber?: number | null; sessionType: string; status: string; state: string; subjectName: string; id: string | null }>) {
  const map = new Map<number, typeof sessions>()
  for (const s of sessions) if (typeof s.cycleNumber === 'number' && s.sessionType === 'learning') map.set(s.cycleNumber, [...(map.get(s.cycleNumber) ?? []), s])
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([cycleNumber, list]) => {
      const completed = list.filter((s) => s.status === 'completed').length
      const closed = list.filter((s) => TERMINAL.includes(s.status)).length
      const started = list.some((s) => s.status !== 'scheduled')
      return {
        cycleNumber,
        total: list.length,
        completed,
        skipped: list.filter((s) => s.status === 'skipped').length,
        missed: list.filter((s) => s.status === 'missed').length,
        inProgress: list.filter((s) => s.status === 'in_progress').length,
        status: closed === list.length ? (completed === list.length ? 'completed' : 'closed') : started ? 'in_progress' : 'not_started',
        subjects: list.map((s) => ({ sessionId: s.id, subjectName: s.subjectName, status: s.status, state: s.state }))
      }
    })
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

export async function getDay(userId: Oid, date: string) {
  const ctx = await prepare(userId)
  const base = { date, today: ctx.today, weekday: weekdayOfKey(date), timezone: ctx.tz, isStudyDay: isStudyDay(ctx, date), restReason: restReason(ctx, date) }
  if (date > ctx.today) {
    const projection = await projectDate(ctx, date)
    return { ...base, projected: true, scheduleVersion: projection.version, sessions: projection.sessions, cycles: cyclesOf(projection.sessions), carryover: null, summary: summarize(projection.sessions) }
  }
  const sessions = await StudySession.find({ userId, date }).lean()
  sessions.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || a.order - b.order)
  const day = await loadDayData(ctx, date, sessions)
  const views = sessions.map((s) => serializeSession(ctx, s, day))
  const carryover = date === ctx.today ? await getCarryover(ctx, date) : null
  return {
    ...base,
    projected: false,
    scheduleVersion: sessions[0]?.scheduleVersion ?? (await versionFor(userId, date))?.version ?? null,
    sessions: views,
    cycles: cyclesOf(views),
    carryover,
    summary: summarize(views)
  }
}

function summarize(views: Array<{ sessionType: string; status: string; plannedMinutes: number; actualMinutes?: number }>) {
  const learning = views.filter((v) => v.sessionType === 'learning')
  return {
    sessions: views.length,
    completed: views.filter((v) => v.status === 'completed').length,
    skipped: views.filter((v) => v.status === 'skipped').length,
    missed: views.filter((v) => v.status === 'missed').length,
    plannedMinutes: views.reduce((a, v) => a + v.plannedMinutes, 0),
    plannedLearningMinutes: learning.reduce((a, v) => a + v.plannedMinutes, 0),
    actualLearningMinutes: learning.reduce((a, v) => a + (v.actualMinutes ?? 0), 0)
  }
}

export async function listSessions(userId: Oid, from: string, to: string, status?: string) {
  const ctx = await prepare(userId)
  const q: Record<string, unknown> = { userId, date: { $gte: from, $lte: to } }
  if (status) q.status = status
  const sessions = await StudySession.find(q).sort({ date: -1, startTime: 1 }).limit(1000).lean()
  const byDate = new Map<string, LeanSession[]>()
  for (const s of sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s])
  const out: SessionView[] = []
  for (const [date, list] of byDate) {
    const day = await loadDayData(ctx, date, status ? undefined : list)
    out.push(...list.map((s) => serializeSession(ctx, s, day)))
  }
  return out
}

async function ownedSession(userId: Oid, id: Oid) {
  const s = await StudySession.findOne({ _id: id, userId }).lean()
  if (!s) throw notFound('Study session')
  return s
}

async function viewOf(ctx: PlanContext, id: Oid) {
  const s = await ownedSession(ctx.userId, id)
  const day = await loadDayData(ctx, s.date)
  return serializeSession(ctx, s, day)
}

export async function getSession(userId: Oid, id: Oid) {
  const ctx = await prepare(userId)
  const session = await viewOf(ctx, id)
  return { session, ...(await dependencyDetails(ctx, session)) }
}

async function dependencyDetails(ctx: PlanContext, session: SessionView) {
  const ids = Array.from(new Set([...session.relevantObligationIds, ...session.blockingObligationIds])).map((id) => new Types.ObjectId(id))
  const [obligations, generated, overrides, prereqs] = await Promise.all([
    RevisionObligation.find({ _id: { $in: ids }, userId: ctx.userId }).lean(),
    session.id ? RevisionObligation.find({ userId: ctx.userId, sourceSessionIds: new Types.ObjectId(session.id) }).lean() : Promise.resolve([] as LeanObligation[]),
    session.id ? GateOverride.find({ userId: ctx.userId, sessionId: new Types.ObjectId(session.id) }).sort({ createdAt: -1 }).lean() : Promise.resolve([] as LeanOverride[]),
    StudySession.find({ userId: ctx.userId, date: session.date, slotId: { $in: session.prerequisiteSlotIds } }).lean()
  ])
  return {
    dependencies: {
      revisions: await serializeMany(obligations, ctx.today),
      prerequisites: prereqs.map((p) => ({ id: String(p._id), subjectName: p.subjectName, label: p.label, startTime: p.startTime, status: p.status, satisfied: p.status === 'completed' }))
    },
    /** Obligations this session's completed learning produced (same-day / next-day / weekly). */
    generatedObligations: await serializeMany(generated, ctx.today),
    overrides: overrides.map(serializeOverride)
  }
}

export async function getDependencies(userId: Oid, id: Oid) {
  const ctx = await prepare(userId)
  const session = await viewOf(ctx, id)
  const details = await dependencyDetails(ctx, session)
  return { sessionId: session.id, state: session.state, locked: session.locked, lockReasons: session.lockReasons, override: session.override, ...details }
}

export async function getEligibility(userId: Oid, id: Oid) {
  const ctx = await prepare(userId)
  const s = await viewOf(ctx, id)
  return { sessionId: s.id, eligible: s.canStart, state: s.state, locked: s.locked, lockReasons: s.lockReasons, override: s.override }
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

function assertToday(ctx: PlanContext, s: { date: string }, action: string) {
  if (s.date > ctx.today) throw conflict(`This session is on ${s.date}; you can only ${action} it on that day.`, 'SESSION_NOT_TODAY')
  if (s.date < ctx.today) throw conflict(`This session's day (${s.date}) has passed.`, 'SESSION_DAY_PASSED')
}

/**
 * Server-side gate: the session must be today's, scheduled, and every revision /
 * prerequisite dependency must be completed or covered by an emergency override.
 * A direct API call gets exactly the same answer as the UI.
 */
export async function startSession(userId: Oid, id: Oid) {
  const ctx = await prepare(userId)
  const s = await ownedSession(userId, id)
  if (s.status === 'in_progress') return { session: await viewOf(ctx, id), alreadyStarted: true }
  if (s.status !== 'scheduled') throw conflict(`This session is ${s.status} and cannot be started.`, 'INVALID_SESSION_STATE', { status: s.status })
  assertToday(ctx, s, 'start')
  const view = await viewOf(ctx, id)
  if (!view.canStart) {
    throw new AppError(409, 'SESSION_LOCKED', view.lockReasons[0]?.message ?? 'This session is locked.', {
      state: view.state,
      lockReasons: view.lockReasons
    })
  }
  const updated = await StudySession.findOneAndUpdate(
    { _id: s._id, userId, status: 'scheduled' },
    { $set: { status: 'in_progress', startedAt: ctx.now, overrideId: view.override ? new Types.ObjectId(view.override.id) : null } },
    { new: true }
  ).lean()
  if (!updated) {
    const again = await ownedSession(userId, id)
    if (again.status !== 'in_progress') throw conflict('This session changed while starting. Reload and try again.', 'SESSION_RACE')
  }
  return { session: await viewOf(ctx, id), alreadyStarted: !updated }
}

export interface CompleteSessionInput {
  topics: Array<{ topicId: string; completion: 'completed' | 'partial' }>
  questionsAttempted?: number
  questionsCorrect?: number
  confidence?: number
  notes?: string
  actualMinutes?: number
}

export async function completeSession(userId: Oid, id: Oid, input: CompleteSessionInput) {
  const ctx = await prepare(userId)
  const s = await ownedSession(userId, id)
  if (s.status === 'completed') return { session: await viewOf(ctx, id), generated: null, alreadyCompleted: true }
  if (s.status !== 'in_progress' || !s.startedAt) throw conflict('Start this session before completing it.', 'SESSION_NOT_STARTED', { status: s.status })

  const cur = await loadCurriculum(userId)
  const seen = new Set<string>()
  const topics = input.topics.map((t) => {
    const topic = cur.topic(t.topicId)
    if (!topic) throw unprocessable(`Unknown topic ${t.topicId}`, 'UNKNOWN_TOPIC')
    if (topic.subjectId !== s.subjectId) throw unprocessable(`${topic.name} is not a ${s.subjectName} topic.`, 'TOPIC_SUBJECT_MISMATCH')
    if (seen.has(topic.id)) throw unprocessable(`${topic.name} is listed twice.`, 'DUPLICATE_TOPIC')
    seen.add(topic.id)
    return { topicId: topic.id, topicName: topic.name, chapterId: topic.chapterId, chapterName: cur.chapter(topic.chapterId)?.name ?? '', completion: t.completion }
  })
  if (s.sessionType === 'learning' && !topics.length) throw unprocessable('Record at least one topic you studied.', 'TOPICS_REQUIRED')
  const attempted = Math.max(0, input.questionsAttempted ?? 0)
  const correct = Math.max(0, input.questionsCorrect ?? 0)
  if (correct > attempted) throw unprocessable('Correct answers cannot exceed questions attempted.', 'INVALID_COUNTS')

  const elapsed = Math.max(1, Math.ceil((ctx.now.getTime() - new Date(s.startedAt).getTime()) / 60000))
  const actualMinutes = Math.min(elapsed, Math.max(1, Math.round(input.actualMinutes ?? elapsed)))
  const updated = await StudySession.findOneAndUpdate(
    { _id: s._id, userId, status: 'in_progress' },
    {
      $set: {
        status: 'completed',
        completedAt: ctx.now,
        actualMinutes,
        completion: { topics, questionsAttempted: attempted, questionsCorrect: correct, confidence: input.confidence ?? null, notes: (input.notes ?? '').trim() }
      }
    },
    { new: true }
  ).lean()
  if (!updated) {
    const again = await ownedSession(userId, id)
    if (again.status === 'completed') return { session: await viewOf(ctx, id), generated: null, alreadyCompleted: true }
    throw conflict('This session changed while saving. Reload and try again.', 'SESSION_RACE')
  }
  const generated = await generateSameDay(ctx, updated)
  if (s.date < ctx.today) await ensureNextDay(ctx)
  return {
    session: await viewOf(ctx, id),
    generated: generated ? (await serializeMany([generated as LeanObligation], ctx.today))[0] : null,
    alreadyCompleted: false
  }
}

/** A normal skip records a reason. It never resolves or bypasses a revision obligation. */
export async function skipSession(userId: Oid, id: Oid, reason: string) {
  const ctx = await prepare(userId)
  const s = await ownedSession(userId, id)
  if (s.status === 'skipped') return { session: await viewOf(ctx, id), alreadySkipped: true }
  if (!['scheduled', 'in_progress'].includes(s.status)) throw conflict(`This session is ${s.status} and cannot be skipped.`, 'INVALID_SESSION_STATE')
  assertToday(ctx, s, 'skip')
  const updated = await StudySession.findOneAndUpdate(
    { _id: s._id, userId, status: { $in: ['scheduled', 'in_progress'] } },
    { $set: { status: 'skipped', skipReason: reason.trim() } },
    { new: true }
  ).lean()
  if (!updated) throw conflict('This session changed while skipping. Reload and try again.', 'SESSION_RACE')
  return { session: await viewOf(ctx, id), alreadySkipped: false }
}

/**
 * Controlled emergency override. Records who/when/which session/which dependencies and the
 * original lock state, then lets the session start. The obligations stay pending (marked
 * bypassed) and are never completed by this or by completing the session.
 */
export async function overrideGate(userId: Oid, id: Oid, reason: string) {
  const ctx = await prepare(userId)
  const s = await ownedSession(userId, id)
  if (s.status !== 'scheduled') throw conflict(`This session is ${s.status}; there is nothing to override.`, 'INVALID_SESSION_STATE')
  assertToday(ctx, s, 'override')
  const view = await viewOf(ctx, id)
  if (!view.lockReasons.length) throw conflict('This session is not locked.', 'SESSION_NOT_LOCKED')
  if (view.override) return { session: view, override: view.override, alreadyOverridden: true }
  const override = await GateOverride.create({
    userId,
    sessionId: s._id,
    sessionDate: s.date,
    subjectId: s.subjectId,
    subjectName: s.subjectName,
    reason: reason.trim(),
    originalState: view.state,
    lockReasons: view.lockReasons,
    obligationIds: view.blockingObligationIds.map((x) => new Types.ObjectId(x)),
    prerequisiteSessionIds: view.blockingSessionIds.map((x) => new Types.ObjectId(x)),
    decision: 'bypassed'
  })
  if (view.blockingObligationIds.length) {
    await RevisionObligation.updateMany(
      { _id: { $in: view.blockingObligationIds.map((x) => new Types.ObjectId(x)) }, userId, status: { $ne: 'completed' } },
      { $addToSet: { bypassedBy: override._id } }
    )
  }
  await notify(userId, {
    type: 'gate_override',
    title: `Emergency override: ${s.subjectName} ${s.startTime}`,
    message: `${reason.trim()} — the required revision stays pending.`,
    link: '/revision'
  })
  return { session: await viewOf(ctx, id), override: serializeOverride(override.toObject() as unknown as LeanOverride), alreadyOverridden: false }
}

/** One-off time change for today's not-yet-started session. The published schedule is not modified. */
export async function rescheduleSession(userId: Oid, id: Oid, input: { startTime: string; endTime: string }) {
  const ctx = await prepare(userId)
  const s = await ownedSession(userId, id)
  if (s.status !== 'scheduled') throw conflict('Only a session that has not started can be rescheduled.', 'INVALID_SESSION_STATE')
  assertToday(ctx, s, 'reschedule')
  const start = toMinutes(input.startTime)
  const end = toMinutes(input.endTime)
  if (end <= start) throw unprocessable('End time must be after start time.', 'INVALID_TIME_RANGE')
  if (end < ctx.nowMinutes) throw unprocessable('The new time has already passed.', 'INVALID_TIME_RANGE')
  if (s.sessionType === 'learning') {
    // Keep cycle order: a later cycle of a subject can never move before an earlier one (it would break same-day revision).
    const siblings = await StudySession.find({ userId, date: s.date, subjectId: s.subjectId, sessionType: 'learning', _id: { $ne: s._id } }).lean()
    for (const o of siblings) {
      const before = (o.cycleNumber ?? 0) < (s.cycleNumber ?? 0)
      if (before && toMinutes(o.startTime) >= start) throw unprocessable(`Cycle ${s.cycleNumber} cannot start before cycle ${o.cycleNumber} of ${s.subjectName}.`, 'CYCLE_ORDER')
      if (!before && toMinutes(o.startTime) <= start) throw unprocessable(`Cycle ${s.cycleNumber} cannot start after cycle ${o.cycleNumber} of ${s.subjectName}.`, 'CYCLE_ORDER')
    }
  }
  const updated = await StudySession.findOneAndUpdate(
    { _id: s._id, userId, status: 'scheduled' },
    {
      $set: {
        startTime: input.startTime,
        endTime: input.endTime,
        plannedMinutes: end - start,
        rescheduledFrom: s.rescheduledFrom ?? { startTime: s.startTime, endTime: s.endTime, at: ctx.now }
      }
    },
    { new: true }
  ).lean()
  if (!updated) throw conflict('This session changed while rescheduling. Reload and try again.', 'SESSION_RACE')
  // Same-day obligations sourced from this session move with it.
  await RevisionObligation.updateMany({ userId, sourceSessionIds: s._id, type: 'same_day' }, { $set: { sourceStartTime: input.startTime } })
  return { session: await viewOf(ctx, id) }
}

/* ------------------------------------------------------------------ */
/* Cycles                                                              */
/* ------------------------------------------------------------------ */

export async function getCycles(userId: Oid, date: string) {
  const day = await getDay(userId, date)
  return { date: day.date, cycles: day.cycles }
}

/**
 * Closes a cycle. When every learning session in it is finished this just confirms it; otherwise
 * a reason is required and the remaining not-started sessions are recorded as skipped. Never
 * touches revision obligations.
 */
export async function completeCycle(userId: Oid, date: string, cycleNumber: number, reason?: string) {
  const ctx = await prepare(userId)
  if (date !== ctx.today) throw conflict('Only today’s cycles can be closed.', 'SESSION_NOT_TODAY')
  const sessions = await StudySession.find({ userId, date, sessionType: 'learning', cycleNumber }).lean()
  if (!sessions.length) throw notFound('Cycle')
  if (sessions.some((s) => s.status === 'in_progress')) throw conflict('Finish or skip the session in progress first.', 'SESSION_IN_PROGRESS')
  const open = sessions.filter((s) => s.status === 'scheduled')
  if (open.length) {
    const why = (reason ?? '').trim()
    if (why.length < 3) throw unprocessable(`${open.length} session(s) in cycle ${cycleNumber} are not done. Give a reason to close the cycle.`, 'REASON_REQUIRED', { open: open.length })
    await StudySession.updateMany(
      { _id: { $in: open.map((s) => s._id) }, userId, status: 'scheduled' },
      { $set: { status: 'skipped', skipReason: `Cycle ${cycleNumber} closed: ${why}` } }
    )
  }
  const result = await getCycles(userId, date)
  return { cycle: result.cycles.find((c) => c.cycleNumber === cycleNumber) ?? null, cycles: result.cycles }
}

/** Generates draft slots for one weekday from the cycle configuration. Never writes anything. */
export async function cycleTemplate(
  userId: Oid,
  input: { weekday: number; startTime: string; cyclesPerDay?: number; subjectIds?: string[]; sessionMinutes?: number; breakMinutes?: number; revisionMinutes?: number | null }
) {
  const ctx = await planContext(userId)
  const cur = await loadCurriculum(userId)
  const cycles = input.cyclesPerDay ?? ctx.settings.cycle.cyclesPerDay
  const minutes = input.sessionMinutes ?? ctx.settings.cycle.sessionMinutes
  // Every session is preceded by its revision block (next-day carryover in cycle 1, same-day in later
  // cycles), so the gap before each session is at least the revision duration.
  const revisionBlock = input.revisionMinutes ?? Math.max(ctx.settings.plan.sameDayRevisionMinutes, ctx.settings.plan.nextDayRevisionMinutes)
  const gap = Math.max(input.breakMinutes ?? ctx.settings.cycle.breakMinutes, revisionBlock)
  const order = input.subjectIds?.length ? input.subjectIds : ctx.settings.cycle.subjectIds.length ? ctx.settings.cycle.subjectIds : cur.subjects.map((s) => s.id)
  const subjects = Array.from(new Set(order)).filter((id) => cur.subject(id))
  if (!subjects.length) throw unprocessable('Choose at least one subject for the cycle.', 'NO_SUBJECTS')
  // `startTime` is when the day begins: the first revision block, then the first session.
  let t = toMinutes(input.startTime) + revisionBlock
  const total = revisionBlock + cycles * subjects.length * minutes + (cycles * subjects.length - 1) * gap
  if (t + total > 24 * 60 - 1) throw unprocessable(`${cycles} cycles of ${subjects.length} subjects do not fit before midnight.`, 'TEMPLATE_TOO_LONG', { totalMinutes: total })
  const slots: SlotInput[] = []
  let order2 = 0
  for (let c = 1; c <= cycles; c += 1) {
    for (const subjectId of subjects) {
      slots.push({
        id: `slot-${new Types.ObjectId().toHexString()}`,
        weekday: input.weekday,
        subjectId,
        sessionNumber: c,
        label: `Cycle ${c} · Learning`,
        startTime: hhmm(t),
        endTime: hhmm(t + minutes),
        durationMinutes: minutes,
        requiresRevision: c > 1,
        learningTarget: '',
        practiceTarget: 0,
        reminderEnabled: true,
        breakAfterMinutes: gap,
        order: order2++,
        sessionType: 'learning',
        cycleNumber: c,
        chapterId: null,
        topicIds: [],
        revisionMinutes: input.revisionMinutes ?? null,
        revisionPolicy: c > 1 ? 'previous_cycle' : 'none',
        prerequisiteSlotIds: []
      })
      t += minutes + gap
    }
  }
  return { slots, cyclesPerDay: cycles, subjects: subjects.map((id) => ({ id, name: cur.subject(id)!.name })) }
}

/* ------------------------------------------------------------------ */
/* Overrides                                                           */
/* ------------------------------------------------------------------ */

function serializeOverride(o: LeanOverride) {
  return {
    id: String(o._id),
    sessionId: String(o.sessionId),
    sessionDate: o.sessionDate,
    subjectId: o.subjectId,
    subjectName: o.subjectName,
    reason: o.reason,
    originalState: o.originalState,
    lockReasons: o.lockReasons,
    obligationIds: o.obligationIds.map(String),
    prerequisiteSessionIds: o.prerequisiteSessionIds.map(String),
    decision: o.decision,
    createdAt: o.createdAt
  }
}

export async function listOverrides(userId: Oid, days: number) {
  const ctx = await planContext(userId)
  const list = await GateOverride.find({ userId, sessionDate: { $gte: addDays(ctx.today, -(days - 1)) } }).sort({ createdAt: -1 }).limit(200).lean()
  return list.map(serializeOverride)
}

export type { ObligationView }
export { prepare }
