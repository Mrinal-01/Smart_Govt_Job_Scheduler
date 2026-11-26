import { Types } from 'mongoose'
import { env } from '../../config/env.js'
import { addDays, dateKey } from '../../lib/dates.js'
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors.js'
import { CycleSubjectBlock, RevisionLog, RevisionTask, StudyCycle, StudyLog } from '../../models/index.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { getSettings, serializeSettings, type SettingsView } from '../settings/settings.service.js'

/*
 * Study Cycle Engine
 * ------------------
 * A *day* can contain several *cycles*. A cycle is one pass over the student's
 * cycle subjects. Every topic fully completed in an earlier cycle today becomes
 * exactly one topic-specific `cycle` revision task (dedupe key
 * `cycle:<date>:<topicId>`), which is placed in front of that subject's new
 * learning in the next cycle. Partial topics are never eligible. All state
 * transitions happen here; route handlers only validate input.
 */

const TERMINAL_BLOCK = ['completed', 'skipped', 'incomplete']
const OUTCOME_ACCURACY: Record<string, number> = { recalled: 100, partial: 50, forgot: 0 }

type Oid = Types.ObjectId

async function context(userId: Oid) {
  const settings = serializeSettings(await getSettings(userId))
  const tz = settings.timezone || env.APP_TIMEZONE
  return { settings, tz, today: dateKey(new Date(), tz) }
}

function plannedMinutesFor(settings: SettingsView, subjectId: string) {
  const override = settings.cycle.revisionMinutesBySubject[subjectId]
  return typeof override === 'number' ? override : settings.cycle.defaultRevisionMinutes
}

/* ------------------------------------------------------------------ */
/* Revision task generation (deterministic)                            */
/* ------------------------------------------------------------------ */

/**
 * Creates one `cycle` revision task per topic completed today that does not
 * already have one. Idempotent: the unique (userId, dedupeKey) index rejects
 * duplicates even under concurrent calls.
 */
export async function generateCycleRevisionTasks(userId: Oid, date: string) {
  const logs = await StudyLog.find({ userId, date, completion: 'completed' }).sort({ createdAt: -1 }).lean()
  const latestByTopic = new Map<string, (typeof logs)[number]>()
  for (const log of logs) if (!latestByTopic.has(log.topicId)) latestByTopic.set(log.topicId, log)
  if (!latestByTopic.size) return 0

  const existing = await RevisionTask.find({ userId, dedupeKey: { $in: Array.from(latestByTopic.keys()).map((t) => `cycle:${date}:${t}`) } })
    .select('dedupeKey')
    .lean()
  const have = new Set(existing.map((e) => e.dedupeKey))
  const docs = Array.from(latestByTopic.values())
    .filter((log) => !have.has(`cycle:${date}:${log.topicId}`))
    .map((log) => ({
      userId,
      kind: 'cycle',
      date,
      subjectId: log.subjectId,
      subjectName: log.subjectName,
      chapterId: log.chapterId,
      chapterName: log.chapterName,
      topicId: log.topicId,
      topicName: log.topicName,
      sourceStudyLogId: log._id,
      sourceCycleId: log.cycleId,
      sourceCycleNumber: log.cycleNumber,
      status: 'pending',
      dedupeKey: `cycle:${date}:${log.topicId}`
    }))
  if (!docs.length) return 0
  try {
    const inserted = await RevisionTask.insertMany(docs, { ordered: false })
    return inserted.length
  } catch (err) {
    const e = err as { code?: number; insertedDocs?: unknown[]; writeErrors?: Array<{ code?: number; err?: { code?: number } }> }
    const allDup = (e.writeErrors ?? []).every((w) => (w.code ?? w.err?.code) === 11000)
    if (e.code === 11000 || allDup) return e.insertedDocs?.length ?? 0
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* Cycle lifecycle                                                     */
/* ------------------------------------------------------------------ */

async function finalizeCycle(cycleId: Oid, reason: string | null) {
  const cycle = await StudyCycle.findById(cycleId)
  if (!cycle || cycle.status !== 'active') return cycle
  const blocks = await CycleSubjectBlock.find({ cycleId })
  for (const b of blocks) {
    if (!TERMINAL_BLOCK.includes(b.status)) {
      b.status = 'incomplete'
      await b.save()
    }
  }
  // Unfinished revision work is never discarded — it returns to the carry-forward queue.
  await RevisionTask.updateMany(
    { targetCycleId: cycleId, status: 'pending' },
    { $set: { targetCycleId: null, targetBlockId: null } }
  )
  const allDone = blocks.every((b) => b.status === 'completed' || b.status === 'skipped')
  cycle.status = allDone ? 'completed' : 'incomplete'
  cycle.completedAt = new Date()
  cycle.endedReason = reason
  await cycle.save()
  return cycle
}

async function maybeCompleteCycle(cycleId: Oid) {
  const open = await CycleSubjectBlock.countDocuments({ cycleId, status: { $nin: TERMINAL_BLOCK } })
  if (open === 0) await finalizeCycle(cycleId, null)
}

export async function startCycle(userId: Oid, input: { subjectIds?: string[]; force?: boolean }) {
  const { settings, today } = await context(userId)
  const cur = await loadCurriculum(userId)

  const active = await StudyCycle.findOne({ userId, status: 'active' })
  if (active) {
    if (active.date !== today) {
      await finalizeCycle(active._id, 'Day ended')
    } else if (!input.force) {
      throw conflict('Finish or end the current cycle before starting a new one.', 'CYCLE_ACTIVE', { cycleId: String(active._id) })
    } else {
      await finalizeCycle(active._id, 'New cycle started before this one was finished')
    }
  }

  const requested = input.subjectIds?.length ? input.subjectIds : settings.cycle.subjectIds.length ? settings.cycle.subjectIds : cur.subjects.map((s) => s.id)
  const subjectIds = Array.from(new Set(requested)).filter((id) => cur.subject(id))
  if (!subjectIds.length) throw unprocessable('Choose at least one subject for the cycle.', 'NO_SUBJECTS')

  const last = await StudyCycle.findOne({ userId, date: today }).sort({ cycleNumber: -1 }).lean()
  let cycle
  try {
    cycle = await StudyCycle.create({ userId, date: today, cycleNumber: (last?.cycleNumber ?? 0) + 1, subjectIds, status: 'active' })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('A cycle was started at the same time. Reload.', 'CYCLE_RACE')
    throw err
  }

  await generateCycleRevisionTasks(userId, today)

  // Pending (and previously deferred) same-day tasks are assigned to this cycle, oldest first.
  const open = await RevisionTask.find({ userId, date: today, status: { $in: ['pending', 'deferred'] } }).sort({ createdAt: 1 }).lean()
  const bySubject = new Map<string, typeof open>()
  for (const t of open) bySubject.set(t.subjectId, [...(bySubject.get(t.subjectId) ?? []), t])

  for (const [index, subjectId] of subjectIds.entries()) {
    const tasks = bySubject.get(subjectId) ?? []
    const take = tasks.slice(0, settings.cycle.maxTopicsPerRevisionBlock)
    const defer = tasks.slice(settings.cycle.maxTopicsPerRevisionBlock)
    const block = await CycleSubjectBlock.create({
      userId,
      cycleId: cycle._id,
      date: today,
      subjectId,
      subjectName: cur.subject(subjectId)!.name,
      order: index,
      status: 'pending',
      revision: { required: take.length > 0, plannedMinutes: take.length ? plannedMinutesFor(settings, subjectId) : 0 }
    })
    if (take.length) {
      await RevisionTask.updateMany(
        { _id: { $in: take.map((t) => t._id) } },
        { $set: { targetCycleId: cycle._id, targetBlockId: block._id, status: 'pending' } }
      )
    }
    if (defer.length) {
      await RevisionTask.updateMany({ _id: { $in: defer.map((t) => t._id) } }, { $set: { status: 'deferred', targetCycleId: null, targetBlockId: null } })
    }
  }
  return getCycleDetail(userId, cycle._id)
}

export async function endCycle(userId: Oid, cycleId: Oid, reason?: string) {
  const cycle = await StudyCycle.findOne({ _id: cycleId, userId })
  if (!cycle) throw notFound('Cycle')
  if (cycle.status !== 'active') throw conflict('This cycle has already ended.', 'CYCLE_ENDED')
  await finalizeCycle(cycle._id, reason?.trim() || 'Ended by student')
  return getCycleDetail(userId, cycle._id)
}

/* ------------------------------------------------------------------ */
/* Block actions                                                       */
/* ------------------------------------------------------------------ */

async function ownedActiveBlock(userId: Oid, blockId: Oid) {
  const block = await CycleSubjectBlock.findOne({ _id: blockId, userId })
  if (!block) throw notFound('Subject block')
  const cycle = await StudyCycle.findOne({ _id: block.cycleId, userId })
  if (!cycle || cycle.status !== 'active') throw conflict('This cycle is no longer active.', 'CYCLE_ENDED')
  return { block, cycle }
}

async function unresolvedTaskCount(blockId: Oid) {
  return RevisionTask.countDocuments({ targetBlockId: blockId, status: 'pending' })
}

export async function startRevision(userId: Oid, blockId: Oid) {
  const { block } = await ownedActiveBlock(userId, blockId)
  if (!block.revision?.required) throw unprocessable('This subject has no topics due for revision in this cycle.', 'NO_REVISION_DUE')
  if (!['pending', 'revision'].includes(block.status)) throw conflict(`Cannot start revision while the block is ${block.status}.`, 'INVALID_BLOCK_STATE')
  if (!block.revision.startedAt) block.revision.startedAt = new Date()
  block.status = 'revision'
  await block.save()
  return block
}

async function closeRevisionIfResolved(blockId: Oid) {
  const block = await CycleSubjectBlock.findById(blockId)
  if (!block || block.status !== 'revision') return
  if ((await unresolvedTaskCount(blockId)) > 0) return
  const now = new Date()
  block.revision!.completedAt = now
  block.revision!.actualSeconds = block.revision!.startedAt ? Math.round((now.getTime() - block.revision!.startedAt.getTime()) / 1000) : 0
  block.status = 'ready'
  await block.save()
}

export async function completeRevisionTask(
  userId: Oid,
  taskId: Oid,
  input: { outcome: 'recalled' | 'partial' | 'forgot'; questionsAttempted?: number; questionsCorrect?: number; secondsSpent?: number }
) {
  const task = await RevisionTask.findOne({ _id: taskId, userId })
  if (!task) throw notFound('Revision task')
  if (task.status === 'completed' || task.status === 'skipped') throw conflict('This revision task is already resolved.', 'TASK_RESOLVED')

  let maxSeconds = 4 * 3600
  if (task.targetBlockId) {
    const block = await CycleSubjectBlock.findOne({ _id: task.targetBlockId, userId })
    if (block && block.status !== 'revision') {
      throw conflict('Start the revision block before completing its topics.', 'REVISION_NOT_STARTED')
    }
    if (block?.revision?.startedAt) maxSeconds = Math.max(0, Math.round((Date.now() - block.revision.startedAt.getTime()) / 1000))
  }
  const attempted = Math.max(0, input.questionsAttempted ?? 0)
  const correct = Math.min(attempted, Math.max(0, input.questionsCorrect ?? 0))
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : OUTCOME_ACCURACY[input.outcome]
  const seconds = Math.min(maxSeconds, Math.max(0, Math.round(input.secondsSpent ?? 0)))

  const updated = await RevisionTask.findOneAndUpdate(
    { _id: task._id, userId, status: { $in: ['pending', 'deferred'] } },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        outcome: input.outcome,
        questionsAttempted: attempted,
        questionsCorrect: correct,
        accuracy,
        actualSeconds: seconds
      }
    },
    { new: true }
  )
  if (!updated) throw conflict('This revision task is already resolved.', 'TASK_RESOLVED')
  await RevisionLog.create({
    userId,
    taskId: updated._id,
    cycleId: updated.targetCycleId,
    topicId: updated.topicId,
    subjectId: updated.subjectId,
    kind: updated.kind,
    date: updated.date,
    event: 'completed',
    actualSeconds: seconds,
    outcome: input.outcome,
    accuracy
  })
  if (updated.targetBlockId) await closeRevisionIfResolved(updated.targetBlockId)
  return updated
}

export async function skipRevisionTask(userId: Oid, taskId: Oid, reason: string) {
  const task = await RevisionTask.findOneAndUpdate(
    { _id: taskId, userId, status: { $in: ['pending', 'deferred'] } },
    { $set: { status: 'skipped', skipReason: reason, completedAt: new Date() } },
    { new: true }
  )
  if (!task) {
    if (!(await RevisionTask.exists({ _id: taskId, userId }))) throw notFound('Revision task')
    throw conflict('This revision task is already resolved.', 'TASK_RESOLVED')
  }
  await RevisionLog.create({
    userId,
    taskId: task._id,
    cycleId: task.targetCycleId,
    topicId: task.topicId,
    subjectId: task.subjectId,
    kind: task.kind,
    date: task.date,
    event: 'skipped',
    reason
  })
  if (task.targetBlockId) {
    const block = await CycleSubjectBlock.findById(task.targetBlockId)
    if (block && block.status === 'pending') {
      block.status = 'revision'
      block.revision!.startedAt ??= new Date()
      await block.save()
    }
    await closeRevisionIfResolved(task.targetBlockId)
  }
  return task
}

export async function skipBlockRevision(userId: Oid, blockId: Oid, reason: string) {
  const { block } = await ownedActiveBlock(userId, blockId)
  if (!['pending', 'revision'].includes(block.status)) throw conflict(`Cannot skip revision while the block is ${block.status}.`, 'INVALID_BLOCK_STATE')
  const tasks = await RevisionTask.find({ targetBlockId: block._id, status: 'pending' }).select('_id').lean()
  block.status = 'revision'
  block.revision!.startedAt ??= new Date()
  block.revision!.skippedReason = reason
  await block.save()
  for (const t of tasks) await skipRevisionTask(userId, t._id, reason)
  await closeRevisionIfResolved(block._id)
  return CycleSubjectBlock.findById(block._id)
}

export async function startLearning(userId: Oid, blockId: Oid) {
  const { block } = await ownedActiveBlock(userId, blockId)
  if (block.status === 'learning') return block
  if (!['pending', 'revision', 'ready'].includes(block.status)) throw conflict(`Cannot start learning while the block is ${block.status}.`, 'INVALID_BLOCK_STATE')
  const { settings } = await context(userId)
  const unresolved = await unresolvedTaskCount(block._id)
  if (unresolved > 0 && settings.cycle.revisionMandatory) {
    throw new AppError(409, 'REVISION_REQUIRED', `Revise the ${unresolved} due topic(s) for ${block.subjectName} first, or skip them with a reason.`, {
      unresolved
    })
  }
  if (unresolved > 0) {
    // Optional-revision mode: unresolved tasks go back to the carry-forward queue.
    await RevisionTask.updateMany({ targetBlockId: block._id, status: 'pending' }, { $set: { targetBlockId: null, targetCycleId: null } })
  }
  block.status = 'learning'
  block.learning!.startedAt = new Date()
  await block.save()
  return block
}

export interface LearningEntry {
  topicId: string
  completion: 'completed' | 'partial'
  minutes?: number
  confidence?: number
  notes?: string
}

export async function completeLearning(userId: Oid, blockId: Oid, entries: LearningEntry[]) {
  const { block, cycle } = await ownedActiveBlock(userId, blockId)
  if (block.status !== 'learning') throw conflict('Start learning for this subject first.', 'LEARNING_NOT_STARTED')
  const cur = await loadCurriculum(userId)
  const seen = new Set<string>()
  for (const e of entries) {
    const topic = cur.topic(e.topicId)
    if (!topic) throw unprocessable(`Unknown topic ${e.topicId}`, 'UNKNOWN_TOPIC')
    if (topic.subjectId !== block.subjectId) throw unprocessable(`${topic.name} is not a ${block.subjectName} topic.`, 'TOPIC_SUBJECT_MISMATCH')
    if (seen.has(e.topicId)) throw unprocessable(`${topic.name} is listed twice.`, 'DUPLICATE_TOPIC')
    seen.add(e.topicId)
  }
  const now = new Date()
  const elapsedMinutes = block.learning?.startedAt ? Math.max(1, Math.round((now.getTime() - block.learning.startedAt.getTime()) / 60000)) : 0
  const logs = await StudyLog.insertMany(
    entries.map((e) => {
      const topic = cur.topic(e.topicId)!
      const chapter = cur.chapter(topic.chapterId)!
      return {
        userId,
        cycleId: cycle._id,
        blockId: block._id,
        cycleNumber: cycle.cycleNumber,
        date: block.date,
        subjectId: block.subjectId,
        subjectName: block.subjectName,
        chapterId: chapter.id,
        chapterName: chapter.name,
        topicId: topic.id,
        topicName: topic.name,
        completion: e.completion,
        minutes: Math.max(0, Math.round(e.minutes ?? elapsedMinutes / Math.max(1, entries.length))),
        confidence: e.confidence ?? null,
        notes: e.notes ?? ''
      }
    })
  )
  block.status = 'completed'
  block.learning!.completedAt = now
  block.learning!.minutes = elapsedMinutes
  await block.save()
  await maybeCompleteCycle(cycle._id)
  return { block, logs }
}

export async function skipBlock(userId: Oid, blockId: Oid, reason: string) {
  const { block, cycle } = await ownedActiveBlock(userId, blockId)
  if (TERMINAL_BLOCK.includes(block.status)) throw conflict('This subject block is already finished.', 'INVALID_BLOCK_STATE')
  block.status = 'skipped'
  block.skipReason = reason
  await block.save()
  // Skipping a subject never discards its due revision — the tasks are carried forward.
  await RevisionTask.updateMany({ targetBlockId: block._id, status: 'pending' }, { $set: { targetBlockId: null, targetCycleId: null } })
  await maybeCompleteCycle(cycle._id)
  return block
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

function blockStats(block: Record<string, unknown>, tasks: Array<Record<string, unknown>>) {
  const completed = tasks.filter((t) => t.status === 'completed')
  const acc = completed.map((t) => t.accuracy).filter((a): a is number => typeof a === 'number')
  const rev = (block.revision ?? {}) as Record<string, unknown>
  const startedAt = rev.startedAt as Date | null
  const running = block.status === 'revision' && startedAt ? Math.round((Date.now() - new Date(startedAt).getTime()) / 1000) : 0
  return {
    plannedRevisionMinutes: (rev.plannedMinutes as number) ?? 0,
    actualRevisionSeconds: ((rev.actualSeconds as number) || 0) + (rev.completedAt ? 0 : running),
    topicsDue: tasks.length,
    topicsCompleted: completed.length,
    topicsSkipped: tasks.filter((t) => t.status === 'skipped').length,
    revisionAccuracy: acc.length ? Math.round(acc.reduce((a, b) => a + b, 0) / acc.length) : null
  }
}

export async function getCycleDetail(userId: Oid, cycleId: Oid) {
  const cycle = await StudyCycle.findOne({ _id: cycleId, userId }).lean()
  if (!cycle) throw notFound('Cycle')
  const blocks = await CycleSubjectBlock.find({ cycleId }).sort({ order: 1 }).lean()
  const tasks = await RevisionTask.find({ userId, targetCycleId: cycleId }).sort({ createdAt: 1 }).lean()
  // Tasks resolved in this cycle keep their block link; include them too.
  const resolved = await RevisionTask.find({ userId, targetBlockId: { $in: blocks.map((b) => b._id) }, targetCycleId: { $ne: cycleId } }).lean()
  const allTasks = [...tasks, ...resolved]
  const logs = await StudyLog.find({ userId, cycleId }).sort({ createdAt: 1 }).lean()
  const { settings } = await context(userId)
  return {
    ...cycle,
    blocks: blocks.map((b) => {
      const bt = allTasks.filter((t) => String(t.targetBlockId) === String(b._id))
      return { ...b, tasks: bt, logs: logs.filter((l) => String(l.blockId) === String(b._id)), stats: blockStats(b, bt) }
    }),
    revisionPolicy: {
      mandatory: settings.cycle.revisionMandatory,
      perTopicMinutes: settings.cycle.revisionMinutesPerTopic,
      maxTopicsPerBlock: settings.cycle.maxTopicsPerRevisionBlock
    }
  }
}

export async function getToday(userId: Oid) {
  const { today, settings } = await context(userId)
  const stale = await StudyCycle.findOne({ userId, status: 'active', date: { $ne: today } })
  if (stale) await finalizeCycle(stale._id, 'Day ended')
  const cycles = await StudyCycle.find({ userId, date: today }).sort({ cycleNumber: 1 }).lean()
  const details = await Promise.all(cycles.map((c) => getCycleDetail(userId, c._id)))
  const active = details.find((c) => c.status === 'active') ?? null
  // Topics completed today that would be revised if a new cycle started now (preview, no writes).
  const logsToday = await StudyLog.find({ userId, date: today, completion: 'completed' }).lean()
  const tasksToday = await RevisionTask.find({ userId, date: today }).select('topicId').lean()
  const taskTopics = new Set(tasksToday.map((t) => t.topicId))
  const upcoming = Array.from(new Map(logsToday.filter((l) => !taskTopics.has(l.topicId)).map((l) => [l.topicId, l])).values()).map((l) => ({
    topicId: l.topicId,
    topicName: l.topicName,
    subjectId: l.subjectId,
    subjectName: l.subjectName,
    chapterName: l.chapterName
  }))
  return { date: today, cycles: details, active, upcomingRevision: upcoming, settings: settings.cycle, carryForward: await getCarryForward(userId) }
}

export async function getCarryForward(userId: Oid) {
  const { today } = await context(userId)
  const since = addDays(today, -7)
  const pendingTasks = await RevisionTask.find({
    userId,
    status: { $in: ['pending', 'deferred'] },
    targetCycleId: null,
    date: { $gte: since }
  })
    .sort({ date: -1, createdAt: 1 })
    .lean()
  const partialLogs = await StudyLog.find({ userId, completion: 'partial', date: { $gte: since } }).sort({ createdAt: -1 }).lean()
  const partialTopics = []
  const seen = new Set<string>()
  for (const log of partialLogs) {
    if (seen.has(log.topicId)) continue
    seen.add(log.topicId)
    const finished = await StudyLog.exists({ userId, topicId: log.topicId, completion: 'completed', createdAt: { $gt: log.createdAt } })
    if (!finished) partialTopics.push(log)
  }
  const unfinishedBlocks = await CycleSubjectBlock.find({ userId, date: { $gte: since }, status: { $in: ['incomplete', 'skipped'] } })
    .sort({ date: -1, order: 1 })
    .limit(50)
    .lean()
  return {
    pendingTasks: pendingTasks.map((t) => ({ ...t, missed: t.date < today })),
    partialTopics,
    unfinishedBlocks
  }
}

export async function getHistory(userId: Oid, days: number) {
  const { today } = await context(userId)
  const since = addDays(today, -(days - 1))
  const cycles = await StudyCycle.find({ userId, date: { $gte: since } }).sort({ date: -1, cycleNumber: -1 }).lean()
  const blocks = await CycleSubjectBlock.find({ userId, date: { $gte: since } }).lean()
  const tasks = await RevisionTask.find({ userId, date: { $gte: since }, targetBlockId: { $ne: null } }).lean()
  return cycles.map((c) => {
    const cb = blocks.filter((b) => String(b.cycleId) === String(c._id))
    const stats = cb.map((b) => blockStats(b, tasks.filter((t) => String(t.targetBlockId) === String(b._id))))
    return {
      _id: c._id,
      date: c.date,
      cycleNumber: c.cycleNumber,
      status: c.status,
      endedReason: c.endedReason,
      subjects: cb.length,
      completedSubjects: cb.filter((b) => b.status === 'completed').length,
      plannedRevisionMinutes: stats.reduce((a, s) => a + s.plannedRevisionMinutes, 0),
      actualRevisionSeconds: stats.reduce((a, s) => a + s.actualRevisionSeconds, 0),
      topicsDue: stats.reduce((a, s) => a + s.topicsDue, 0),
      topicsCompleted: stats.reduce((a, s) => a + s.topicsCompleted, 0),
      topicsSkipped: stats.reduce((a, s) => a + s.topicsSkipped, 0)
    }
  })
}

export const toObjectId = (id: string) => new Types.ObjectId(id)
