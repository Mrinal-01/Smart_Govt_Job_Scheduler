import type { Types } from 'mongoose'
import { env } from '../../config/env.js'
import { clock } from '../../lib/clock.js'
import { addDays, dateKey, diffDays } from '../../lib/dates.js'
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors.js'
import { Schedule, ScheduleVersion } from '../../models/index.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { getSettings } from '../settings/settings.service.js'
import { notify } from '../notifications/notification.routes.js'
import { normalizeSlot, validateSlots, type SlotInput } from './slots.js'
import { RevisionObligation } from '../../models/index.js'

export type { SlotInput } from './slots.js'

const COMPARED_FIELDS: Array<keyof SlotInput> = [
  'weekday',
  'subjectId',
  'label',
  'startTime',
  'endTime',
  'durationMinutes',
  'requiresRevision',
  'learningTarget',
  'practiceTarget',
  'reminderEnabled',
  'breakAfterMinutes',
  'order',
  'sessionNumber',
  'sessionType',
  'cycleNumber',
  'chapterId',
  'topicIds',
  'revisionMinutes',
  'revisionPolicy',
  'prerequisiteSlotIds'
]
const same = (a: unknown, b: unknown) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : a === b)
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const policy = () => ({ maxChanges: env.SCHEDULE_MAX_CHANGES, windowDays: env.SCHEDULE_WINDOW_DAYS })

export function diffSlots(previousRaw: SlotInput[], nextRaw: SlotInput[], subjectName: (id: string) => string) {
  // Normalize both sides so versions published before the study-plan fields existed do not show phantom changes.
  const previous = previousRaw.map((s) => normalizeSlot(s as unknown as Record<string, unknown>))
  const next = nextRaw.map((s) => normalizeSlot(s as unknown as Record<string, unknown>))
  const before = new Map(previous.map((s) => [s.id, s]))
  const after = new Map(next.map((s) => [s.id, s]))
  const added: string[] = []
  const removed: string[] = []
  const modified: Array<{ slotId: string; fields: string[] }> = []
  const summary: string[] = []
  const describe = (s: SlotInput) => `${subjectName(s.subjectId)} on ${WEEKDAYS[s.weekday]} ${s.startTime}–${s.endTime}`

  for (const [id, slot] of after) {
    const old = before.get(id)
    if (!old) {
      added.push(id)
      summary.push(`Added ${describe(slot)}`)
      continue
    }
    const fields = COMPARED_FIELDS.filter((f) => !same(old[f], slot[f]))
    if (fields.length) {
      modified.push({ slotId: id, fields })
      summary.push(`Changed ${describe(old)}: ${fields.join(', ')}`)
    }
  }
  for (const [id, slot] of before) {
    if (!after.has(id)) {
      removed.push(id)
      summary.push(`Removed ${describe(slot)}`)
    }
  }
  const changedFields = Array.from(new Set(modified.flatMap((m) => m.fields)))
  if (added.length) changedFields.push('slots.added')
  if (removed.length) changedFields.push('slots.removed')
  return { added, removed, modified, summary, changedFields }
}

async function usage(userId: Types.ObjectId, now = clock.now()) {
  const { maxChanges, windowDays } = policy()
  const since = new Date(now.getTime() - windowDays * 86_400_000)
  const counted = await ScheduleVersion.find({ userId, countsTowardLimit: true, publishedAt: { $gte: since } })
    .sort({ publishedAt: 1 })
    .select('publishedAt override')
    .lean()
  const used = counted.length
  const remaining = Math.max(0, maxChanges - used)
  // When the limit is reached, the next change unlocks when the oldest counted publish leaves the window.
  const unlockIndex = used - maxChanges
  const nextAvailableAt =
    remaining > 0 ? null : new Date(counted[Math.max(0, unlockIndex)].publishedAt.getTime() + windowDays * 86_400_000).toISOString()
  const overridesInWindow = counted.filter((c) => c.override).length
  return { used, remaining, limit: maxChanges, windowDays, nextAvailableAt, overridesInWindow }
}

function serializeVersion(v: InstanceType<typeof ScheduleVersion> | Record<string, unknown>) {
  const d = v as Record<string, unknown>
  return {
    id: String(d._id),
    version: d.version,
    previousVersion: d.previousVersion,
    effectiveFrom: d.effectiveFrom,
    publishedAt: d.publishedAt,
    changeReason: d.changeReason,
    changes: d.changes,
    changedFields: d.changedFields,
    countsTowardLimit: d.countsTowardLimit,
    override: d.override,
    overrideReason: d.overrideReason,
    slots: d.slots
  }
}

async function timezoneFor(userId: Types.ObjectId) {
  return (await getSettings(userId)).timezone || env.APP_TIMEZONE
}

/** The version that governs a calendar date: the newest version already effective on that date. */
async function effectiveVersion(userId: Types.ObjectId, date: string) {
  return ScheduleVersion.findOne({ userId, effectiveFrom: { $lte: date } }).sort({ version: -1 }).lean()
}

export async function getStatus(userId: Types.ObjectId) {
  const tz = await timezoneFor(userId)
  const today = dateKey(clock.now(), tz)
  const schedule = await Schedule.findOne({ userId }).lean()
  const latest = schedule ? await ScheduleVersion.findOne({ scheduleId: schedule._id }).sort({ version: -1 }).lean() : null
  const active = await effectiveVersion(userId, today)
  const pending = latest && active && latest.version !== active.version && latest.effectiveFrom > today ? latest : null
  return {
    policy: policy(),
    usage: await usage(userId),
    today,
    currentVersion: schedule?.currentVersion ?? 0,
    latest: latest ? serializeVersion(latest) : null,
    active: active ? serializeVersion(active) : null,
    pending: pending ? serializeVersion(pending) : null
  }
}

export async function history(userId: Types.ObjectId) {
  const versions = await ScheduleVersion.find({ userId }).sort({ version: -1 }).limit(100).lean()
  return versions.map((v) => {
    const s = serializeVersion(v)
    return { ...s, slots: undefined, slotCount: (v.slots ?? []).length }
  })
}

export async function getVersion(userId: Types.ObjectId, version: number) {
  const v = await ScheduleVersion.findOne({ userId, version }).lean()
  if (!v) throw notFound('Schedule version')
  return serializeVersion(v)
}

export async function getEffective(userId: Types.ObjectId, date: string) {
  const v = await effectiveVersion(userId, date)
  return v ? serializeVersion(v) : null
}

/**
 * Pending revision obligations are never discarded by a schedule change — they keep gating
 * by subject, whatever the new timetable looks like. The preview reports them.
 */
async function pendingCarryOver(userId: Types.ObjectId) {
  const pending = await RevisionObligation.find({ userId, status: { $ne: 'completed' } }).select('type subjectName dueDate').lean()
  return {
    pendingObligations: pending.length,
    bySubject: Object.entries(
      pending.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.subjectName]: (acc[o.subjectName] ?? 0) + 1 }), {})
    ).map(([subjectName, count]) => ({ subjectName, count }))
  }
}

export interface PublishInput {
  slots: SlotInput[]
  changeReason: string
  effectiveFrom?: string
  override?: boolean
  overrideReason?: string
}

export async function previewPublish(userId: Types.ObjectId, rawSlots: SlotInput[]) {
  const slots = rawSlots.map((s) => normalizeSlot(s as unknown as Record<string, unknown>))
  const cur = await loadCurriculum(userId)
  const schedule = await Schedule.findOne({ userId }).lean()
  const latest = schedule ? await ScheduleVersion.findOne({ scheduleId: schedule._id }).sort({ version: -1 }).lean() : null
  const name = (id: string) => cur.subject(id)?.name ?? 'Unknown subject'
  const diff = diffSlots((latest?.slots ?? []) as SlotInput[], slots, name)
  return { isBaseline: !latest, diff, validation: validateSlots(slots, cur), carryOver: await pendingCarryOver(userId), usage: await usage(userId), policy: policy() }
}

export async function publish(userId: Types.ObjectId, rawInput: PublishInput) {
  // Callers other than the route (seed/import scripts) may pass legacy slots: normalize here too.
  const input = { ...rawInput, slots: rawInput.slots.map((s) => normalizeSlot(s as unknown as Record<string, unknown>)) }
  const tz = await timezoneFor(userId)
  const today = dateKey(clock.now(), tz)
  const cur = await loadCurriculum(userId)

  for (const slot of input.slots) {
    if (!cur.subject(slot.subjectId)) throw unprocessable(`Slot ${slot.id} references an unknown subject`, 'UNKNOWN_SUBJECT')
  }
  // Future dependencies are revalidated on every publish; invalid dependency graphs are never stored.
  const validation = validateSlots(input.slots, cur)
  if (validation.errors.length) {
    throw unprocessable(validation.errors[0].message, 'INVALID_SCHEDULE_DEPENDENCIES', validation)
  }
  const ids = new Set(input.slots.map((s) => s.id))
  if (ids.size !== input.slots.length) throw unprocessable('Duplicate slot ids in schedule', 'DUPLICATE_SLOT')

  const schedule = await Schedule.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { upsert: true, new: true })
  const latest = await ScheduleVersion.findOne({ scheduleId: schedule._id }).sort({ version: -1 }).lean()
  const subjectName = (id: string) => cur.subject(id)?.name ?? 'Unknown subject'
  const diff = diffSlots((latest?.slots ?? []) as SlotInput[], input.slots, subjectName)
  const isBaseline = !latest

  if (!isBaseline && diff.summary.length === 0) {
    throw unprocessable('The schedule has no changes compared with the published version.', 'NO_CHANGES')
  }

  const effectiveFrom = input.effectiveFrom ?? (isBaseline ? today : addDays(today, 1))
  const lead = diffDays(effectiveFrom, today)
  if (isBaseline ? lead < 0 : lead < 1) {
    throw unprocessable(
      isBaseline ? 'Effective date cannot be in the past.' : 'Changes apply from tomorrow at the earliest so today’s sessions are never altered.',
      'INVALID_EFFECTIVE_DATE'
    )
  }
  if (lead > 60) throw unprocessable('Effective date must be within the next 60 days.', 'INVALID_EFFECTIVE_DATE')

  let override = false
  let overrideReason: string | null = null
  const u = await usage(userId)
  if (!isBaseline && u.remaining === 0) {
    if (!input.override) {
      throw new AppError(429, 'SCHEDULE_CHANGE_LIMIT', `You have used all ${u.limit} schedule changes allowed in ${u.windowDays} days.`, u)
    }
    const reason = (input.overrideReason ?? '').trim()
    if (reason.length < 10) {
      throw unprocessable('An emergency override needs a reason of at least 10 characters.', 'OVERRIDE_REASON_REQUIRED')
    }
    override = true
    overrideReason = reason
  }

  try {
    const version = await ScheduleVersion.create({
      userId,
      scheduleId: schedule._id,
      version: (latest?.version ?? 0) + 1,
      previousVersion: latest?.version ?? null,
      slots: input.slots,
      changes: { added: diff.added, removed: diff.removed, modified: diff.modified, summary: diff.summary },
      changedFields: diff.changedFields,
      changeReason: input.changeReason.trim() || (isBaseline ? 'Initial schedule' : ''),
      publishedAt: clock.now(),
      effectiveFrom,
      countsTowardLimit: !isBaseline,
      override,
      overrideReason
    })
    await Schedule.updateOne({ _id: schedule._id }, { $set: { currentVersion: version.version, latestVersionId: version._id } })
    if (override) {
      await notify(userId, {
        type: 'schedule_override',
        title: `Emergency schedule override (v${version.version})`,
        message: overrideReason ?? '',
        link: '/schedule?tab=history'
      })
    }
    return { version: serializeVersion(version.toObject()), usage: await usage(userId) }
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('Another publish happened at the same time. Reload and try again.', 'SCHEDULE_PUBLISH_RACE')
    throw err
  }
}
