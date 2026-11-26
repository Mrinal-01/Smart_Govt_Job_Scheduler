import type {
  Chapter,
  ChapterStatus,
  ID,
  RevisionRecord,
  ScheduleSlot,
  SessionRecord,
  SessionStatus,
  StudyState,
  Subject,
  Topic
} from '../types'
import { addDays, dateKey, diffDays, minutesFromTime, nowMinutes, weekdayOf } from '../lib/date'
import { clamp, round, sum } from '../lib/utils'

/* ------------------------------ lookups ------------------------------ */

export const subjectById = (state: StudyState, id: ID): Subject | undefined =>
  state.subjects.find((s) => s.id === id)

export const chapterById = (state: StudyState, id: ID): Chapter | undefined =>
  state.chapters.find((c) => c.id === id)

export const topicById = (state: StudyState, id: ID): Topic | undefined => {
  for (const c of state.chapters) {
    const t = c.topics.find((x) => x.id === id)
    if (t) return t
  }
  return undefined
}

export const chaptersOf = (state: StudyState, subjectId: ID): Chapter[] =>
  state.chapters.filter((c) => c.subjectId === subjectId).sort((a, b) => a.order - b.order)

export const allTopics = (state: StudyState): Topic[] => state.chapters.flatMap((c) => c.topics)

export const topicsOfChapter = (state: StudyState, chapterId: ID): Topic[] =>
  chapterById(state, chapterId)?.topics ?? []

export const slotById = (state: StudyState, id: ID): ScheduleSlot | undefined =>
  state.schedule.find((s) => s.id === id)

export const sessionKey = (slotId: ID, date: string): string => `${slotId}::${date}`

export interface SessionView {
  key: string
  slot: ScheduleSlot
  record: SessionRecord
  subject: Subject
  chapter?: Chapter
  topic?: Topic
  startMinutes: number
  endMinutes: number
  plannedMinutes: number
  elapsedSeconds: number
  progressPct: number
  overdueMinutes: number
  completion: SessionRecord['completion']
}

export function elapsedSecondsOf(record: SessionRecord, now = Date.now()): number {
  const running = record.runningSince ? Math.max(0, (now - record.runningSince) / 1000) : 0
  return Math.floor(record.accumulatedSeconds + running)
}

export function sessionViewsForDate(state: StudyState, date: string, now = Date.now()): SessionView[] {
  const weekday = weekdayOf(date)
  const slots = state.schedule
    .filter((s) => s.weekday === weekday)
    .sort((a, b) => minutesFromTime(a.startTime) - minutesFromTime(b.startTime) || a.order - b.order)

  const views: SessionView[] = []

  slots.forEach((slot) => {
      const key = sessionKey(slot.id, date)
      const record = state.sessions[key]
      if (!record) return
      const subject = subjectById(state, slot.subjectId)
      if (!subject) return
      const completion = record.completion
      const chapter = completion ? chapterById(state, completion.chapterId) : undefined
      const topic = completion ? topicById(state, completion.topicId) : undefined
      const startMinutes = minutesFromTime(slot.startTime)
      const endMinutes = minutesFromTime(slot.endTime)
      const elapsed = elapsedSecondsOf(record, now)
      const nowMin = nowMinutes(new Date(now))
      const overdue =
        record.status === 'overdue' || record.status === 'awaiting-completion'
          ? Math.max(0, nowMin - endMinutes)
          : 0
      views.push({
        key,
        slot,
        record,
        subject,
        chapter,
        topic,
        completion,
        startMinutes,
        endMinutes,
        plannedMinutes: slot.durationMinutes,
        elapsedSeconds: elapsed,
        progressPct: clamp(Math.round((elapsed / Math.max(1, slot.durationMinutes * 60)) * 100), 0, 100),
        overdueMinutes: overdue
      })
  })

  return views
}

export const STATUS_META: Record<SessionStatus, { label: string; tone: string }> = {
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  'in-progress': { label: 'In progress', tone: 'accent' },
  'revision-pending': { label: 'Revision pending', tone: 'warning' },
  'awaiting-completion': { label: 'Awaiting update', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  completed: { label: 'Completed', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' }
}

/* --------------------------- revision engine --------------------------- */

export interface DueRevision {
  topic: Topic
  chapter: Chapter
  subject: Subject
  dueDate: string
  daysOverdue: number
  kind: 'same-day' | 'next-day' | 'weekly' | 'monthly'
}

/** Classify the revision that a topic is currently owed. */
export function classifyRevision(topic: Topic, today: string): 'same-day' | 'next-day' | 'weekly' | 'monthly' {
  if (!topic.initialLearningDate) return 'weekly'
  const sinceLearning = diffDays(today, topic.initialLearningDate)
  if (sinceLearning === 0) return 'same-day'
  if (sinceLearning === 1) return 'next-day'
  if (sinceLearning <= 9) return 'weekly'
  return 'monthly'
}

export function dueRevisions(state: StudyState, today = dateKey(), subjectId?: ID): DueRevision[] {
  const out: DueRevision[] = []
  state.chapters.forEach((chapter) => {
    const subject = subjectById(state, chapter.subjectId)
    if (!subject) return
    if (subjectId && chapter.subjectId !== subjectId) return
    chapter.topics.forEach((topic) => {
      if (!topic.initialLearningDate) return
      if (!topic.nextRevisionDue) return
      if (diffDays(topic.nextRevisionDue, today) > 0) return
      out.push({
        topic,
        chapter,
        subject,
        dueDate: topic.nextRevisionDue,
        daysOverdue: Math.max(0, diffDays(today, topic.nextRevisionDue)),
        kind: classifyRevision(topic, today)
      })
    })
  })
  return out.sort((a, b) => b.daysOverdue - a.daysOverdue || a.subject.name.localeCompare(b.subject.name))
}

/** Topics learned within the last N days for a subject — powers the revision panel. */
export function recentTopics(state: StudyState, subjectId: ID, withinDays = 3, today = dateKey()): Topic[] {
  return allTopics(state)
    .filter((t) => t.subjectId === subjectId && t.initialLearningDate)
    .filter((t) => diffDays(today, t.initialLearningDate!) <= withinDays)
    .sort((a, b) => (a.initialLearningDate! < b.initialLearningDate! ? 1 : -1))
}

export function applyRevision(
  topic: Topic,
  record: Omit<RevisionRecord, 'id'>,
  intervals: number[]
): Topic {
  const revs = [...topic.revisions, { ...record, id: `rev_${topic.id}_${topic.revisions.length}_${Date.now()}` }]
  const idx = topic.intervalIndex + 1
  const interval = intervals[Math.min(idx, intervals.length - 1)] ?? 7
  return {
    ...topic,
    revisions: revs,
    intervalIndex: idx,
    nextRevisionDue: addDays(record.date, interval),
    confidence: record.confidence ?? topic.confidence,
    mockAccuracy: record.accuracy ?? topic.mockAccuracy
  }
}

/* ------------------------------ progress ------------------------------ */

export function topicMastery(topic: Topic): number {
  if (!topic.initialLearningDate) return 0
  const accuracy = topic.questionsAttempted ? (topic.questionsCorrect / topic.questionsAttempted) * 100 : 0
  const revisionScore = clamp(topic.revisions.length * 12, 0, 36)
  const confidenceScore = clamp(topic.confidence * 8, 0, 40)
  const accuracyScore = clamp(accuracy * 0.4, 0, 40)
  const practiceBonus = (topic.practiceCompleted ? 6 : 0) + (topic.pyqCompleted ? 8 : 0)
  const mistakePenalty = clamp(topic.mistakeCount * 4, 0, 20)
  return clamp(round(accuracyScore + confidenceScore * 0.6 + revisionScore * 0.5 + practiceBonus - mistakePenalty, 0), 0, 100)
}

export function chapterStatus(chapter: Chapter): ChapterStatus {
  const topics = chapter.topics
  if (!topics.length) return 'not-started'
  const learned = topics.filter((t) => t.initialLearningDate)
  if (!learned.length) return 'not-started'
  const allLearned = learned.length === topics.length
  const anyRevision = topics.some((t) => t.revisions.length > 0)
  const allMastered = topics.every((t) => topicMastery(t) >= 78 && t.revisions.length >= 2)
  if (allMastered) return 'mastered'
  if (allLearned && anyRevision) return 'revision-in-progress'
  if (allLearned) return 'learning-completed'
  return 'learning'
}

export const CHAPTER_STATUS_META: Record<ChapterStatus, { label: string; tone: string }> = {
  'not-started': { label: 'Not started', tone: 'neutral' },
  learning: { label: 'Learning', tone: 'accent' },
  'learning-completed': { label: 'Learning completed', tone: 'info' },
  'revision-in-progress': { label: 'Revision in progress', tone: 'warning' },
  mastered: { label: 'Mastered', tone: 'success' }
}

export function chapterAccuracy(chapter: Chapter): number {
  const attempted = sum(chapter.topics.map((t) => t.questionsAttempted))
  const correct = sum(chapter.topics.map((t) => t.questionsCorrect))
  return attempted ? Math.round((correct / attempted) * 100) : 0
}

export function chapterRevisions(chapter: Chapter): number {
  return sum(chapter.topics.map((t) => t.revisions.length))
}

export function chapterProgress(chapter: Chapter): number {
  const topics = chapter.topics
  if (!topics.length) return 0
  const total = sum(
    topics.map((t) => {
      if (!t.initialLearningDate) return 0
      const learning = 40
      const practice = t.practiceCompleted ? 15 : 0
      const pyq = t.pyqCompleted ? 10 : 0
      const revision = clamp(t.revisions.length * 8, 0, 24)
      const accuracy = t.questionsAttempted ? clamp((t.questionsCorrect / t.questionsAttempted) * 11, 0, 11) : 0
      return learning + practice + pyq + revision + accuracy
    })
  )
  return clamp(Math.round(total / topics.length), 0, 100)
}

export function subjectProgress(state: StudyState, subjectId: ID): {
  chapters: number
  chaptersCompleted: number
  topics: number
  topicsLearned: number
  accuracy: number
  revisions: number
  mastery: number
  weakChapters: Chapter[]
} {
  const chapters = chaptersOf(state, subjectId)
  const topics = chapters.flatMap((c) => c.topics)
  const learned = topics.filter((t) => t.initialLearningDate)
  const attempted = sum(topics.map((t) => t.questionsAttempted))
  const correct = sum(topics.map((t) => t.questionsCorrect))
  const mastery = topics.length ? Math.round(sum(topics.map(topicMastery)) / topics.length) : 0
  return {
    chapters: chapters.length,
    chaptersCompleted: chapters.filter((c) => ['learning-completed', 'revision-in-progress', 'mastered'].includes(chapterStatus(c))).length,
    topics: topics.length,
    topicsLearned: learned.length,
    accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
    revisions: sum(topics.map((t) => t.revisions.length)),
    mastery,
    weakChapters: chapters
      .filter((c) => {
        const st = chapterStatus(c)
        return st !== 'not-started' && (chapterAccuracy(c) < 70 || c.topics.some((t) => t.mistakeCount > 2))
      })
      .sort((a, b) => chapterAccuracy(a) - chapterAccuracy(b))
  }
}

/* ------------------------------ analytics ------------------------------ */

export function logFor(state: StudyState, date: string) {
  return state.logs.find((l) => l.date === date)
}

export function logsInRange(state: StudyState, from: string, to: string) {
  return state.logs.filter((l) => l.date >= from && l.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1))
}

export function streakFor(state: StudyState, today = dateKey()): { current: number; best: number } {
  const byDate = new Map(state.logs.map((l) => [l.date, l]))
  let current = 0
  for (let i = 0; i < 400; i += 1) {
    const d = addDays(today, -i)
    const log = byDate.get(d)
    const hit = log && log.actualMinutes >= Math.max(60, log.plannedMinutes * 0.5)
    if (hit) current += 1
    else if (i === 0) continue
    else break
  }
  let best = 0
  let run = 0
  const sorted = [...state.logs].sort((a, b) => (a.date < b.date ? -1 : 1))
  sorted.forEach((l) => {
    if (l.actualMinutes >= Math.max(60, l.plannedMinutes * 0.5)) {
      run += 1
      best = Math.max(best, run)
    } else run = 0
  })
  return { current, best: Math.max(best, current) }
}

export function consistencyFor(state: StudyState, days: number, today = dateKey()): number {
  const from = addDays(today, -(days - 1))
  const range = state.logs.filter((l) => l.date >= from && l.date <= today)
  if (!range.length) return 0
  const hits = range.filter((l) => l.actualMinutes >= Math.max(45, l.plannedMinutes * 0.4)).length
  return Math.round((hits / range.length) * 100)
}
