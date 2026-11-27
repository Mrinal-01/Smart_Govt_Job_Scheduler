import { Types } from 'mongoose'
import { toMinutes } from '../../lib/clock.js'
import { addDays } from '../../lib/dates.js'
import { conflict, notFound, unprocessable } from '../../lib/errors.js'
import { ExamMistake, Question, RevisionAttempt, RevisionObligation, StudySession, StudyWorkspace, taxonomyKey } from '../../models/index.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { isDuplicateKey, nextStudyDay, planContext, weekStartOf, weeklyDueDate, type Oid, type PlanContext } from './plan.context.js'

/*
 * Revision obligations
 * --------------------
 *   same_day  created when a learning session completes with ≥1 fully completed topic and a
 *             later learning session of the same subject exists that day. It gates every later
 *             learning session of that subject on that day until completed.
 *   next_day  created (lazily, idempotently) for every earlier study day with completed learning,
 *             one per subject. Every next_day obligation due on/before today gates all of today's
 *             learning sessions — the Daily Carryover Revision block.
 *   weekly    one per subject per week from that week's completed learning, due on the weekly
 *             review day. Never gates learning and never satisfies the other two types.
 *
 * Only `completed` topics of `completed` sessions are ever eligible. Skipped, missed or partial
 * learning never becomes revision content. Each type has its own completion record.
 */

type TopicRef = { topicId: string; topicName: string; chapterId: string; chapterName: string }
type LeanSession = Awaited<ReturnType<typeof loadSessionLean>>
type LeanObligation = NonNullable<Awaited<ReturnType<typeof loadObligationLean>>>

const loadSessionLean = (id: Oid) => StudySession.findById(id).lean().orFail()
const loadObligationLean = (id: Oid) => RevisionObligation.findById(id).lean()

function completedTopics(session: { completion?: { topics?: Array<TopicRef & { completion: string }> } | null }): TopicRef[] {
  return (session.completion?.topics ?? [])
    .filter((t) => t.completion === 'completed')
    .map((t) => ({ topicId: t.topicId, topicName: t.topicName, chapterId: t.chapterId, chapterName: t.chapterName }))
}

function mergeTopics(lists: TopicRef[][]): TopicRef[] {
  const map = new Map<string, TopicRef>()
  for (const list of lists) for (const t of list) if (!map.has(t.topicId)) map.set(t.topicId, t)
  return Array.from(map.values())
}

/** Insert-or-return for a dedupe key. Safe under concurrent calls thanks to the unique index. */
async function insertObligation(doc: Record<string, unknown> & { userId: Oid; dedupeKey: string }) {
  try {
    return { obligation: (await RevisionObligation.create(doc)).toObject(), created: true }
  } catch (err) {
    if (!isDuplicateKey(err)) throw err
    const existing = await RevisionObligation.findOne({ userId: doc.userId, dedupeKey: doc.dedupeKey }).lean()
    return { obligation: existing, created: false }
  }
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** Called right after a learning session completes. Idempotent per source session. */
export async function generateSameDay(ctx: PlanContext, session: LeanSession) {
  if (session.sessionType !== 'learning') return null
  const topics = completedTopics(session)
  if (!topics.length) return null
  const later = await StudySession.find({
    userId: ctx.userId,
    date: session.date,
    subjectId: session.subjectId,
    sessionType: 'learning',
    status: { $in: ['scheduled', 'in_progress'] },
    _id: { $ne: session._id }
  }).lean()
  const target = later.filter((s) => toMinutes(s.startTime) > toMinutes(session.startTime)).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))[0]
  if (!target || target.revisionPolicy === 'none') return null

  let revisionTopics = topics
  let sourceIds: Oid[] = [session._id]
  if (target.revisionPolicy === 'all_previous_cycles') {
    const earlier = await StudySession.find({ userId: ctx.userId, date: session.date, subjectId: session.subjectId, sessionType: 'learning', status: 'completed' }).lean()
    const before = earlier.filter((s) => toMinutes(s.startTime) <= toMinutes(session.startTime))
    revisionTopics = mergeTopics(before.map(completedTopics))
    sourceIds = before.map((s) => s._id)
  }
  const { obligation } = await insertObligation({
    userId: ctx.userId,
    type: 'same_day',
    subjectId: session.subjectId,
    subjectName: session.subjectName,
    topics: revisionTopics,
    sourceSessionIds: sourceIds,
    sourceDate: session.date,
    sourceCycleNumber: session.cycleNumber,
    sourceStartTime: session.startTime,
    targetSessionId: target._id,
    dueDate: session.date,
    plannedMinutes: target.revisionMinutes,
    practiceRequired: ctx.settings.plan.requirePracticeInRevision,
    dedupeKey: `same_day:${String(session._id)}`
  })
  return obligation
}

/**
 * Daily carryover: one next_day obligation per (earlier study day, subject) with completed learning.
 * Lazily generated on read, idempotent (unique dedupe key), never from today's own learning.
 */
export async function ensureNextDay(ctx: PlanContext) {
  if (!ctx.settings.plan.nextDayRevisionEnabled) return
  const sessions = await StudySession.find({
    userId: ctx.userId,
    sessionType: 'learning',
    status: 'completed',
    date: { $gte: addDays(ctx.today, -14), $lt: ctx.today }
  }).lean()
  const groups = new Map<string, LeanSession[]>()
  for (const s of sessions) {
    if (!completedTopics(s).length) continue
    const key = `next_day:${s.date}:${s.subjectId}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  if (!groups.size) return
  const existing = new Map(
    (await RevisionObligation.find({ userId: ctx.userId, dedupeKey: { $in: Array.from(groups.keys()) } }).lean()).map((o) => [o.dedupeKey, o])
  )
  for (const [key, list] of groups) {
    list.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
    const topics = mergeTopics(list.map(completedTopics))
    const sourceIds = list.map((s) => s._id)
    const ex = existing.get(key)
    if (ex) {
      // A pending obligation absorbs learning completed late on its source day; a started/completed one is frozen.
      const have = new Set(ex.sourceSessionIds.map(String))
      if (ex.status === 'pending' && sourceIds.some((id) => !have.has(String(id)))) {
        await RevisionObligation.updateOne({ _id: ex._id, status: 'pending' }, { $set: { topics, sourceSessionIds: sourceIds } })
      }
      continue
    }
    const first = list[0]
    await insertObligation({
      userId: ctx.userId,
      type: 'next_day',
      subjectId: first.subjectId,
      subjectName: first.subjectName,
      topics,
      sourceSessionIds: sourceIds,
      sourceDate: first.date,
      sourceCycleNumber: null,
      dueDate: nextStudyDay(ctx, first.date),
      plannedMinutes: ctx.settings.plan.nextDayRevisionMinutes,
      practiceRequired: ctx.settings.plan.requirePracticeInRevision,
      dedupeKey: key
    })
  }
}

/** Weekly obligations for the week starting `weekStart` (Monday), one per subject. */
export async function ensureWeekly(ctx: PlanContext, weekStart: string) {
  const weekEnd = addDays(weekStart, 6)
  // The weekly review covers the study days BEFORE the review day (Mon–Sat when it is Sunday).
  const due = weeklyDueDate(ctx, weekStart)
  const lastDay = due > weekStart ? addDays(due, -1) : weekEnd
  const sessions = await StudySession.find({
    userId: ctx.userId,
    sessionType: 'learning',
    status: 'completed',
    date: { $gte: weekStart, $lte: lastDay < ctx.today ? lastDay : ctx.today }
  }).lean()
  const groups = new Map<string, LeanSession[]>()
  for (const s of sessions) {
    if (!completedTopics(s).length) continue
    groups.set(s.subjectId, [...(groups.get(s.subjectId) ?? []), s])
  }
  for (const [subjectId, list] of groups) {
    const key = `weekly:${weekStart}:${subjectId}`
    const topics = mergeTopics(list.map(completedTopics))
    const sourceIds = list.map((s) => s._id)
    const { obligation, created } = await insertObligation({
      userId: ctx.userId,
      type: 'weekly',
      subjectId,
      subjectName: list[0].subjectName,
      topics,
      sourceSessionIds: sourceIds,
      sourceDate: weekStart,
      weekStart,
      dueDate: due,
      plannedMinutes: ctx.settings.plan.weeklyRevisionMinutes,
      practiceRequired: false,
      dedupeKey: key
    })
    if (!created && obligation && obligation.status === 'pending' && obligation.sourceSessionIds.length !== sourceIds.length) {
      await RevisionObligation.updateOne({ _id: obligation._id, status: 'pending' }, { $set: { topics, sourceSessionIds: sourceIds } })
    }
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export function obligationState(o: { status: string; dueDate: string }, today: string) {
  if (o.status === 'completed') return 'completed'
  if (o.status === 'in_progress') return o.dueDate < today ? 'overdue' : 'in_progress'
  return o.dueDate < today ? 'overdue' : 'pending'
}

export function serializeObligation(o: LeanObligation, today: string, sources?: Map<string, LeanSession>) {
  return {
    id: String(o._id),
    type: o.type,
    subjectId: o.subjectId,
    subjectName: o.subjectName,
    topics: o.topics,
    chapters: Array.from(new Set(o.topics.map((t) => t.chapterName))),
    sourceSessionIds: o.sourceSessionIds.map(String),
    sourceSessions: sources
      ? o.sourceSessionIds
          .map((id) => sources.get(String(id)))
          .filter(Boolean)
          .map((s) => ({ id: String(s!._id), date: s!.date, label: s!.label, cycleNumber: s!.cycleNumber, startTime: s!.startTime, endTime: s!.endTime }))
      : undefined,
    sourceDate: o.sourceDate,
    sourceCycleNumber: o.sourceCycleNumber,
    targetSessionId: o.targetSessionId ? String(o.targetSessionId) : null,
    dueDate: o.dueDate,
    weekStart: o.weekStart,
    plannedMinutes: o.plannedMinutes,
    practiceRequired: o.practiceRequired,
    status: o.status,
    state: obligationState(o, today),
    overdue: o.status !== 'completed' && o.dueDate < today,
    /** Bypassed by an emergency override — still NOT completed. */
    bypassed: o.status !== 'completed' && (o.bypassedBy ?? []).length > 0,
    bypassCount: (o.bypassedBy ?? []).length,
    startedAt: o.startedAt,
    completedAt: o.completedAt,
    result: o.status === 'completed' ? o.result : null
  }
}
export type ObligationView = ReturnType<typeof serializeObligation>

async function sourceMap(obligations: LeanObligation[]) {
  const ids = Array.from(new Set(obligations.flatMap((o) => o.sourceSessionIds.map(String))))
  if (!ids.length) return new Map<string, LeanSession>()
  const sessions = await StudySession.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).lean()
  return new Map(sessions.map((s) => [String(s._id), s]))
}

export async function serializeMany(obligations: LeanObligation[], today: string) {
  const sources = await sourceMap(obligations)
  return obligations.map((o) => serializeObligation(o, today, sources))
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

async function refresh(ctx: PlanContext) {
  await ensureNextDay(ctx)
  await ensureWeekly(ctx, weekStartOf(ctx.today))
}

export interface ListFilter {
  type?: 'same_day' | 'next_day' | 'weekly'
  state?: 'open' | 'pending' | 'in_progress' | 'overdue' | 'completed'
  subjectId?: string
  from?: string
  to?: string
  limit: number
}

export async function listObligations(userId: Oid, filter: ListFilter) {
  const ctx = await planContext(userId)
  await refresh(ctx)
  const q: Record<string, unknown> = { userId }
  if (filter.type) q.type = filter.type
  if (filter.subjectId) q.subjectId = filter.subjectId
  const due: Record<string, string> = {}
  if (filter.from) due.$gte = filter.from
  if (filter.to) due.$lte = filter.to
  switch (filter.state) {
    case 'completed':
      q.status = 'completed'
      break
    case 'pending': // pending and not yet overdue
      q.status = 'pending'
      if (!due.$gte || due.$gte < ctx.today) due.$gte = ctx.today
      break
    case 'in_progress':
      q.status = 'in_progress'
      break
    case 'overdue':
      q.status = { $ne: 'completed' }
      due.$lt = ctx.today
      break
    case 'open':
      q.status = { $ne: 'completed' }
      break
  }
  if (Object.keys(due).length) q.dueDate = due
  const docs = await RevisionObligation.find(q)
    .sort(filter.state === 'completed' ? { completedAt: -1 } : { dueDate: 1, createdAt: 1 })
    .limit(filter.limit)
    .lean()
  const counts = await RevisionObligation.aggregate<{ _id: { type: string; done: boolean; overdue: boolean }; n: number }>([
    { $match: { userId } },
    {
      $group: {
        _id: { type: '$type', done: { $eq: ['$status', 'completed'] }, overdue: { $and: [{ $ne: ['$status', 'completed'] }, { $lt: ['$dueDate', ctx.today] }] } },
        n: { $sum: 1 }
      }
    }
  ])
  const summary = { same_day: { open: 0, completed: 0 }, next_day: { open: 0, completed: 0 }, weekly: { open: 0, completed: 0 }, overdue: 0 }
  for (const c of counts) {
    const bucket = summary[c._id.type as 'same_day' | 'next_day' | 'weekly']
    if (!bucket) continue
    if (c._id.done) bucket.completed += c.n
    else bucket.open += c.n
    if (c._id.overdue) summary.overdue += c.n
  }
  return { today: ctx.today, obligations: await serializeMany(docs, ctx.today), summary }
}

/** The Daily Carryover Revision block for a date (default today). */
export async function getCarryover(ctx: PlanContext, date: string) {
  await ensureNextDay(ctx)
  const docs = await RevisionObligation.find({
    userId: ctx.userId,
    type: 'next_day',
    $or: [{ status: { $ne: 'completed' }, dueDate: { $lte: date } }, { status: 'completed', dueDate: date }]
  })
    .sort({ dueDate: 1, subjectName: 1 })
    .lean()
  const obligations = await serializeMany(docs, ctx.today)
  const open = obligations.filter((o) => o.status !== 'completed')
  return {
    date,
    enabled: ctx.settings.plan.nextDayRevisionEnabled,
    scope: ctx.settings.plan.carryoverScope,
    required: open.length > 0,
    complete: open.length === 0,
    obligations,
    totalMinutes: obligations.reduce((a, o) => a + o.plannedMinutes, 0),
    remainingMinutes: open.reduce((a, o) => a + o.plannedMinutes, 0)
  }
}

async function owned(userId: Oid, id: Oid) {
  const o = await RevisionObligation.findOne({ _id: id, userId }).lean()
  if (!o) throw notFound('Revision obligation')
  return o
}

export async function getObligation(userId: Oid, id: Oid) {
  const ctx = await planContext(userId)
  const o = await owned(userId, id)
  const [view] = await serializeMany([o], ctx.today)
  const attempt = await RevisionAttempt.findOne({ obligationId: o._id }).lean()
  return { obligation: view, attempt }
}

/** Revision Preparation Panel data: what was studied, notes, formulas, questions, previous mistakes. */
export async function getPreparation(userId: Oid, id: Oid) {
  const ctx = await planContext(userId)
  const o = await owned(userId, id)
  const cur = await loadCurriculum(userId)
  const topicIds = o.topics.map((t) => t.topicId)
  const sources = await StudySession.find({ _id: { $in: o.sourceSessionIds } }).lean()
  const ws = await StudyWorkspace.findOne({ userId }).select('data.chapters data.mistakes').lean()
  const wsData = (ws?.data ?? {}) as {
    chapters?: Array<{ topics?: Array<{ id: string; notes?: string }> }>
    mistakes?: Array<{ id: string; topicId: string; question: string; explanation?: string; status: string; category?: string }>
  }
  const topicNotes = new Map((wsData.chapters ?? []).flatMap((c) => (c.topics ?? []).map((t) => [t.id, t.notes ?? ''] as const)))
  const [questions, examMistakes] = await Promise.all([
    // Practice comes from the shared question hub, matched by topic name (hub questions are not tied to one student's ids).
    Question.find({ status: 'ready', topicKey: { $in: o.topics.map((t) => taxonomyKey(t.topicName)).filter(Boolean) } })
      .select('questionText options topicName difficulty')
      .limit(10)
      .lean(),
    ExamMistake.find({ userId, topicId: { $in: topicIds }, status: { $ne: 'resolved' } })
      .select('questionText topicId topicName category explanation status occurrences')
      .limit(10)
      .lean()
  ])
  const legacyMistakes = (wsData.mistakes ?? []).filter((m) => topicIds.includes(m.topicId) && m.status !== 'resolved').slice(0, 10)
  const [view] = await serializeMany([o], ctx.today)
  return {
    obligation: view,
    topics: o.topics.map((t) => {
      const topic = cur.topic(t.topicId)
      return {
        ...t,
        keyPoints: topic?.keyPoints ?? [],
        formulas: topic?.formulas ?? [],
        notes: topicNotes.get(t.topicId) ?? ''
      }
    }),
    sessionNotes: sources
      .filter((s) => s.completion?.notes)
      .map((s) => ({ sessionId: String(s._id), date: s.date, label: s.label, cycleNumber: s.cycleNumber, notes: s.completion!.notes })),
    checklist: [
      ...o.topics.map((t) => ({ id: `topic:${t.topicId}`, kind: 'topic' as const, label: `Revise ${t.topicName}`, topicId: t.topicId })),
      ...o.topics.flatMap((t) => (cur.topic(t.topicId)?.formulas ?? []).slice(0, 5).map((f, i) => ({ id: `formula:${t.topicId}:${i}`, kind: 'formula' as const, label: f, topicId: t.topicId })))
    ],
    practiceQuestions: questions.map((q) => ({ id: String(q._id), topicId: o.topics.find((t) => taxonomyKey(t.topicName) === taxonomyKey(q.topicName))?.topicId ?? '', text: q.questionText, options: q.options, difficulty: q.difficulty })),
    mistakes: [
      ...examMistakes.map((m) => ({ id: String(m._id), source: 'mock_test' as const, topicId: m.topicId, question: m.questionText, explanation: m.explanation, category: m.category, occurrences: m.occurrences })),
      ...legacyMistakes.map((m) => ({ id: m.id, source: 'mistake_bank' as const, topicId: m.topicId, question: m.question, explanation: m.explanation ?? null, category: m.category ?? null, occurrences: 1 }))
    ],
    timer: {
      plannedMinutes: o.plannedMinutes,
      startedAt: o.startedAt,
      elapsedSeconds: o.startedAt ? Math.max(0, Math.round((ctx.now.getTime() - new Date(o.startedAt).getTime()) / 1000)) : 0
    }
  }
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

export async function startObligation(userId: Oid, id: Oid) {
  const ctx = await planContext(userId)
  const o = await owned(userId, id)
  if (o.status === 'completed') throw conflict('This revision is already completed.', 'REVISION_ALREADY_COMPLETED')
  if (o.dueDate > ctx.today) throw conflict(`This revision is due on ${o.dueDate} and cannot be started earlier.`, 'REVISION_NOT_DUE', { dueDate: o.dueDate })
  if (o.status === 'pending') {
    await RevisionObligation.updateOne({ _id: o._id, status: 'pending' }, { $set: { status: 'in_progress', startedAt: ctx.now } })
  }
  return getObligation(userId, id)
}

export interface CompleteRevisionInput {
  topicsRevised: string[]
  questionsAttempted?: number
  questionsCorrect?: number
  questionsWrong?: number
  confidence: number
  notes?: string
  actualMinutes?: number
}

/**
 * Completing a revision is the ONLY way an obligation becomes completed. Atomic
 * `in_progress → completed` transition; a repeated request returns the original
 * result (`alreadyCompleted: true`) and never creates a second attempt record.
 */
export async function completeObligation(userId: Oid, id: Oid, input: CompleteRevisionInput) {
  const ctx = await planContext(userId)
  const o = await owned(userId, id)
  if (o.status === 'completed') {
    const attempt = await ensureAttempt(o, ctx)
    const [view] = await serializeMany([o], ctx.today)
    return { obligation: view, attempt, alreadyCompleted: true }
  }
  if (o.status !== 'in_progress' || !o.startedAt) throw conflict('Start this revision before completing it.', 'REVISION_NOT_STARTED')

  const required = o.topics.map((t) => t.topicId)
  const revised = Array.from(new Set(input.topicsRevised))
  const unknown = revised.filter((t) => !required.includes(t))
  if (unknown.length) throw unprocessable('Some revised topics are not part of this revision.', 'UNKNOWN_REVISION_TOPIC', { unknown })
  const missing = o.topics.filter((t) => !revised.includes(t.topicId))
  if (missing.length) {
    throw unprocessable(`Revise every required topic first: ${missing.map((t) => t.topicName).join(', ')}.`, 'REVISION_INCOMPLETE', {
      missing: missing.map((t) => t.topicId)
    })
  }
  const attempted = Math.max(0, input.questionsAttempted ?? 0)
  const correct = Math.max(0, input.questionsCorrect ?? 0)
  const wrong = input.questionsWrong ?? Math.max(0, attempted - correct)
  if (correct + wrong > attempted) throw unprocessable('Correct plus wrong answers cannot exceed questions attempted.', 'INVALID_COUNTS')
  if (o.practiceRequired && attempted < 1) throw unprocessable('This revision requires practice questions — record how many you attempted.', 'PRACTICE_REQUIRED')

  const elapsedMinutes = Math.max(1, Math.ceil((ctx.now.getTime() - new Date(o.startedAt).getTime()) / 60000))
  const actualMinutes = Math.min(elapsedMinutes, Math.max(1, Math.round(input.actualMinutes ?? elapsedMinutes)))
  const result = {
    topicsRevised: revised,
    questionsAttempted: attempted,
    questionsCorrect: correct,
    questionsWrong: wrong,
    confidence: input.confidence,
    notes: (input.notes ?? '').trim(),
    actualMinutes
  }
  const updated = await RevisionObligation.findOneAndUpdate(
    { _id: o._id, userId, status: 'in_progress' },
    { $set: { status: 'completed', completedAt: ctx.now, result } },
    { new: true }
  ).lean()
  const final = updated ?? (await owned(userId, id))
  if (final.status !== 'completed') throw conflict('This revision changed while saving. Reload and try again.', 'REVISION_RACE')
  const attempt = await ensureAttempt(final, ctx)
  const [view] = await serializeMany([final], ctx.today)
  return { obligation: view, attempt, alreadyCompleted: !updated }
}

/** Creates the immutable attempt record for a completed obligation (repairs a crash between the two writes). */
async function ensureAttempt(o: LeanObligation, ctx: PlanContext) {
  const existing = await RevisionAttempt.findOne({ obligationId: o._id }).lean()
  if (existing) return existing
  const r = o.result ?? { topicsRevised: [], questionsAttempted: 0, questionsCorrect: 0, questionsWrong: 0, confidence: 3, notes: '', actualMinutes: 0 }
  try {
    const created = await RevisionAttempt.create({
      userId: o.userId,
      obligationId: o._id,
      type: o.type,
      subjectId: o.subjectId,
      dueDate: o.dueDate,
      completedDate: ctx.today,
      topicsRevised: r.topicsRevised,
      questionsAttempted: r.questionsAttempted,
      questionsCorrect: r.questionsCorrect,
      questionsWrong: r.questionsWrong,
      confidence: r.confidence ?? 3,
      notes: r.notes,
      plannedMinutes: o.plannedMinutes,
      actualMinutes: r.actualMinutes,
      startedAt: o.startedAt ?? o.completedAt,
      completedAt: o.completedAt
    })
    return created.toObject()
  } catch (err) {
    if (!isDuplicateKey(err)) throw err
    return RevisionAttempt.findOne({ obligationId: o._id }).lean()
  }
}

export async function revisionHistory(userId: Oid, days: number) {
  const ctx = await planContext(userId)
  const attempts = await RevisionAttempt.find({ userId, completedDate: { $gte: addDays(ctx.today, -(days - 1)) } })
    .sort({ completedAt: -1 })
    .limit(500)
    .lean()
  const obligations = await RevisionObligation.find({ _id: { $in: attempts.map((a) => a.obligationId) } }).lean()
  const byId = new Map((await serializeMany(obligations, ctx.today)).map((o) => [o.id, o]))
  return attempts.map((a) => ({ ...a, id: String(a._id), obligation: byId.get(String(a.obligationId)) ?? null }))
}
