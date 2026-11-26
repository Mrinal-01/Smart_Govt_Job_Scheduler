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
      revisionMandatory: doc.cycle?.revisionMandatory ?? true
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
    ai?: Partial<SettingsView['ai']>
    exams?: Partial<SettingsView['exams']>
  }
) {
  const set: Record<string, unknown> = {}
  if (patch.timezone) set.timezone = patch.timezone
  for (const [group, values] of Object.entries({ cycle: patch.cycle, ai: patch.ai, exams: patch.exams })) {
    if (!values) continue
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) set[`${group}.${key}`] = value
    }
  }
  await getSettings(userId)
  await UserSettings.updateOne({ userId }, { $set: set }, { runValidators: true })
  return serializeSettings(await getSettings(userId))
}
