import { toMinutes } from '../../lib/clock.js'
import type { Curriculum } from '../workspace/curriculum.service.js'

export type SessionType = 'learning' | 'revision' | 'practice' | 'mock_test'
export type RevisionPolicy = 'previous_cycle' | 'all_previous_cycles' | 'none'

export interface SlotInput {
  id: string
  weekday: number
  subjectId: string
  sessionNumber: number
  label: string
  startTime: string
  endTime: string
  durationMinutes: number
  requiresRevision: boolean
  learningTarget: string
  practiceTarget: number
  reminderEnabled: boolean
  breakAfterMinutes: number
  order: number
  sessionType: SessionType
  cycleNumber: number | null
  chapterId: string | null
  topicIds: string[]
  revisionMinutes: number | null
  revisionPolicy: RevisionPolicy
  prerequisiteSlotIds: string[]
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Reads a slot from any source (a version published before the study-plan fields existed,
 * the workspace, or validated input) with every field defined. `requiresRevision` is kept
 * in sync with the revision policy for older clients.
 */
export function normalizeSlot(raw: Record<string, unknown>): SlotInput {
  const sessionType = (['learning', 'revision', 'practice', 'mock_test'].includes(String(raw.sessionType)) ? raw.sessionType : 'learning') as SessionType
  const declared = raw.revisionPolicy as RevisionPolicy | null | undefined
  let revisionPolicy: RevisionPolicy =
    declared && ['previous_cycle', 'all_previous_cycles', 'none'].includes(declared) ? declared : raw.requiresRevision === false ? 'none' : 'previous_cycle'
  if (sessionType !== 'learning') revisionPolicy = 'none'
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    id: String(raw.id),
    weekday: num(raw.weekday, 0),
    subjectId: String(raw.subjectId),
    sessionNumber: num(raw.sessionNumber, 1),
    label: String(raw.label ?? ''),
    startTime: String(raw.startTime),
    endTime: String(raw.endTime),
    durationMinutes: num(raw.durationMinutes, toMinutes(String(raw.endTime)) - toMinutes(String(raw.startTime))),
    requiresRevision: revisionPolicy !== 'none',
    learningTarget: String(raw.learningTarget ?? ''),
    practiceTarget: num(raw.practiceTarget, 0),
    reminderEnabled: raw.reminderEnabled !== false,
    breakAfterMinutes: num(raw.breakAfterMinutes, 0),
    order: num(raw.order, 0),
    sessionType,
    cycleNumber: typeof raw.cycleNumber === 'number' ? raw.cycleNumber : null,
    chapterId: typeof raw.chapterId === 'string' && raw.chapterId ? raw.chapterId : null,
    topicIds: Array.isArray(raw.topicIds) ? (raw.topicIds as unknown[]).map(String) : [],
    revisionMinutes: typeof raw.revisionMinutes === 'number' ? raw.revisionMinutes : null,
    revisionPolicy,
    prerequisiteSlotIds: Array.isArray(raw.prerequisiteSlotIds) ? (raw.prerequisiteSlotIds as unknown[]).map(String) : []
  }
}

export interface SlotIssue {
  slotId: string
  message: string
}

/**
 * Structural and dependency validation run on preview and again on publish.
 * Errors block publishing; warnings are shown in the preview.
 */
export function validateSlots(slots: SlotInput[], cur: Curriculum) {
  const errors: SlotIssue[] = []
  const warnings: SlotIssue[] = []
  const byId = new Map(slots.map((s) => [s.id, s]))
  const describe = (s: SlotInput) => `${cur.subject(s.subjectId)?.name ?? 'Unknown subject'} on ${WEEKDAYS[s.weekday]} ${s.startTime}`

  for (const slot of slots) {
    if (!cur.subject(slot.subjectId)) {
      errors.push({ slotId: slot.id, message: `${slot.id} references an unknown subject` })
      continue
    }
    if (slot.chapterId) {
      const chapter = cur.chapter(slot.chapterId)
      if (!chapter) errors.push({ slotId: slot.id, message: `${describe(slot)}: unknown chapter` })
      else if (chapter.subjectId !== slot.subjectId) errors.push({ slotId: slot.id, message: `${describe(slot)}: chapter belongs to another subject` })
    }
    for (const topicId of slot.topicIds) {
      const topic = cur.topic(topicId)
      if (!topic) errors.push({ slotId: slot.id, message: `${describe(slot)}: unknown topic ${topicId}` })
      else if (topic.subjectId !== slot.subjectId) errors.push({ slotId: slot.id, message: `${describe(slot)}: topic ${topic.name} belongs to another subject` })
      else if (slot.chapterId && topic.chapterId !== slot.chapterId) errors.push({ slotId: slot.id, message: `${describe(slot)}: topic ${topic.name} is not in the selected chapter` })
    }
    for (const pre of slot.prerequisiteSlotIds) {
      const dep = byId.get(pre)
      if (pre === slot.id) errors.push({ slotId: slot.id, message: `${describe(slot)} cannot depend on itself` })
      else if (!dep) errors.push({ slotId: slot.id, message: `${describe(slot)} depends on a session that is not in the schedule` })
      else if (dep.weekday !== slot.weekday) errors.push({ slotId: slot.id, message: `${describe(slot)} depends on a session on another day` })
      else if (toMinutes(dep.startTime) >= toMinutes(slot.startTime)) errors.push({ slotId: slot.id, message: `${describe(slot)} depends on ${describe(dep)}, which does not start earlier` })
    }
  }

  // Cycle order per subject per day: learning sessions of a subject must have increasing cycle numbers in time order.
  const groups = new Map<string, SlotInput[]>()
  for (const s of slots) {
    if (s.sessionType !== 'learning') continue
    const key = `${s.weekday}:${s.subjectId}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  for (const list of groups.values()) {
    list.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1]
      const cur2 = list[i]
      if (prev.cycleNumber !== null && cur2.cycleNumber !== null && cur2.cycleNumber <= prev.cycleNumber) {
        errors.push({ slotId: cur2.id, message: `${describe(cur2)}: cycle ${cur2.cycleNumber} must come after cycle ${prev.cycleNumber} of the same subject` })
      }
    }
    const first = list[0]
    if (first && first.cycleNumber !== null && first.cycleNumber > 1 && first.revisionPolicy !== 'none') {
      warnings.push({ slotId: first.id, message: `${describe(first)} is cycle ${first.cycleNumber} but no earlier learning session of this subject exists that day — there is nothing to revise first.` })
    }
  }
  return { errors, warnings }
}
