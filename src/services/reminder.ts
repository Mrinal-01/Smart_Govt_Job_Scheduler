import type { ID, SessionRecord, StudyState } from '../types'
import { dateKey, epochFromIST, minutesFromTime, nowMinutes, weekdayOf } from '../lib/date'
import { sessionKey } from '../store/selectors'

export type ReminderStage = 'none' | 'awaiting' | 'overdue'

export interface ReminderCandidate {
  key: ID
  subjectId: ID
  slotId: ID
  stage: ReminderStage
  minutesOverdue: number
}

/**
 * Pure evaluation of the reminder state machine — no side effects, so it can be
 * evaluated against any clock and reused by a future backend cron.
 *
 *   ended  →  awaiting-completion (grace window)
 *   grace  →  overdue              (repeat every `repeatMinutes`)
 */
export function evaluateReminders(state: StudyState, now = new Date()): {
  candidates: ReminderCandidate[]
  updates: Array<{ key: ID; patch: Partial<SessionRecord> }>
} {
  const today = dateKey(now)
  const currentMinutes = nowMinutes(now)
  const grace = state.settings.reminder.graceMinutes
  const repeatMs = state.settings.reminder.repeatMinutes * 60_000
  const candidates: ReminderCandidate[] = []
  const updates: Array<{ key: ID; patch: Partial<SessionRecord> }> = []

  if (!state.settings.reminder.enabled || state.settings.reminder.quietMode) {
    return { candidates, updates }
  }

  const slotsToday = state.schedule.filter((s) => s.weekday === weekdayOf(today))

  slotsToday.forEach((slot) => {
    if (!slot.reminderEnabled) return
    const key = sessionKey(slot.id, today)
    const record = state.sessions[key]
    if (!record) return
    if (['completed', 'skipped'].includes(record.status)) return
    if (record.snoozedUntil && new Date(record.snoozedUntil).getTime() > now.getTime()) return

    const endMinutes = minutesFromTime(slot.endTime)
    if (currentMinutes < endMinutes) return

    const minutesOverdue = currentMinutes - endMinutes
    const endEpoch = epochFromIST(today, slot.endTime)

    if (minutesOverdue < grace) {
      if (record.status !== 'awaiting-completion') {
        candidates.push({ key, subjectId: record.subjectId, slotId: slot.id, stage: 'awaiting', minutesOverdue })
        updates.push({
          key,
          patch: {
            status: 'awaiting-completion',
            graceUntil: new Date(endEpoch + grace * 60_000).toISOString()
          }
        })
      }
      return
    }

    // past grace → overdue, respecting repeat interval
    if (record.remindedAt) {
      const since = now.getTime() - new Date(record.remindedAt).getTime()
      if (since < repeatMs) {
        if (record.status !== 'overdue') {
          updates.push({ key, patch: { status: 'overdue' } })
        }
        return
      }
    }

    candidates.push({ key, subjectId: record.subjectId, slotId: slot.id, stage: 'overdue', minutesOverdue })
    updates.push({
      key,
      patch: { status: 'overdue', remindedAt: now.toISOString(), graceUntil: new Date(endEpoch + grace * 60_000).toISOString() }
    })
  })

  return { candidates, updates }
}

/** Sessions that are actively overdue right now (drives the audio loop + overlay). */
export function activeOverdue(state: StudyState, now = new Date()): ReminderCandidate[] {
  const { candidates } = evaluateReminders(state, now)
  return candidates.filter((c) => c.stage === 'overdue')
}
