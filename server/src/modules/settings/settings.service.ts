import type { Types } from 'mongoose'
import { UserSettings } from '../../models/index.js'

export async function getSettings(userId: Types.ObjectId) {
  const doc = await UserSettings.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { upsert: true, new: true })
  return doc
}

export function serializeSettings(doc: Awaited<ReturnType<typeof getSettings>>) {
  const byS = doc.cycle?.revisionMinutesBySubject
  return {
    timezone: doc.timezone,
    cycle: {
      subjectIds: doc.cycle?.subjectIds ?? [],
      defaultRevisionMinutes: doc.cycle?.defaultRevisionMinutes ?? 10,
      revisionMinutesBySubject: byS instanceof Map ? Object.fromEntries(byS) : (byS ?? {}),
      revisionMinutesPerTopic: doc.cycle?.revisionMinutesPerTopic ?? 3,
      maxTopicsPerRevisionBlock: doc.cycle?.maxTopicsPerRevisionBlock ?? 5,
      revisionMandatory: doc.cycle?.revisionMandatory ?? true,
      cyclesPerDay: doc.cycle?.cyclesPerDay ?? 2,
      sessionMinutes: doc.cycle?.sessionMinutes ?? 60,
      breakMinutes: doc.cycle?.breakMinutes ?? 10
    },
    plan: {
      sameDayRevisionMinutes: doc.plan?.sameDayRevisionMinutes ?? 15,
      nextDayRevisionEnabled: doc.plan?.nextDayRevisionEnabled ?? true,
      nextDayRevisionMinutes: doc.plan?.nextDayRevisionMinutes ?? 15,
      carryoverScope: (doc.plan?.carryoverScope ?? 'per_subject') as 'per_subject' | 'all_subjects',
      weeklyRevisionMinutes: doc.plan?.weeklyRevisionMinutes ?? 30,
      weeklyReviewWeekday: doc.plan?.weeklyReviewWeekday ?? 0,
      restWeekdays: [...(doc.plan?.restWeekdays ?? [])],
      holidays: [...(doc.plan?.holidays ?? [])],
      requirePracticeInRevision: doc.plan?.requirePracticeInRevision ?? false
    },
    ai: { enabled: doc.ai?.enabled ?? true },
    exams: { autoAddMistakes: doc.exams?.autoAddMistakes ?? true }
  }
}

export type SettingsView = ReturnType<typeof serializeSettings>

export async function updateSettings(
  userId: Types.ObjectId,
  patch: {
    timezone?: string
    cycle?: Partial<SettingsView['cycle']>
    plan?: Partial<SettingsView['plan']>
    ai?: Partial<SettingsView['ai']>
    exams?: Partial<SettingsView['exams']>
  }
) {
  const set: Record<string, unknown> = {}
  if (patch.timezone) set.timezone = patch.timezone
  for (const [group, values] of Object.entries({ cycle: patch.cycle, plan: patch.plan, ai: patch.ai, exams: patch.exams })) {
    if (!values) continue
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) set[`${group}.${key}`] = value
    }
  }
  await getSettings(userId)
  await UserSettings.updateOne({ userId }, { $set: set }, { runValidators: true })
  return serializeSettings(await getSettings(userId))
}
