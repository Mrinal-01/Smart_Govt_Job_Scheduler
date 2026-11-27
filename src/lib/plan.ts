/**
 * Client for the server-authoritative study-plan engine (`/api/plan`).
 *
 * Session status, revision gates and revision completion are decided by the
 * server. Nothing here is cached in localStorage; every view re-reads the API,
 * so a refresh can never lose or invent a gate. See
 * docs/API_DOCUMENTATION.md (Schedule & study plan) for the contract.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from './http'

export type PlanSessionType = 'learning' | 'revision' | 'practice' | 'mock_test'
export type PlanRevisionPolicy = 'previous_cycle' | 'all_previous_cycles' | 'none'
export type ObligationType = 'same_day' | 'next_day' | 'weekly'
export type SessionStoredStatus = 'scheduled' | 'in_progress' | 'completed' | 'skipped' | 'missed'
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

export interface TopicRef {
  topicId: string
  topicName: string
  chapterId: string
  chapterName: string
}

export interface LockReason {
  kind: 'next_day' | 'same_day' | 'prerequisite'
  message: string
  obligationId?: string
  sessionId?: string
}

export interface PlanSession {
  id: string | null
  persisted: boolean
  slotId: string
  date: string
  scheduleVersion: number
  subjectId: string
  subjectName: string
  chapterId: string | null
  chapterName: string | null
  plannedTopics: TopicRef[]
  sessionType: PlanSessionType
  cycleNumber: number | null
  sessionNumber: number
  label: string
  startTime: string
  endTime: string
  plannedMinutes: number
  learningTarget: string
  practiceTarget: number
  revisionMinutes: number
  revisionPolicy: PlanRevisionPolicy
  prerequisiteSlotIds: string[]
  status: SessionStoredStatus
  state: SessionState
  revisionStatus: 'not_required' | 'pending' | 'in_progress' | 'completed' | 'bypassed'
  /** Revision blocks that run immediately before this session (carryover before a subject's first session, same-day before later cycles). */
  revisionsBefore: RevisionBlock[]
  locked: boolean
  lockReasons: LockReason[]
  override: { id: string; reason: string; createdAt: string } | null
  canStart: boolean
  previousTopics: string[]
  learningCompleted: boolean
  startedAt?: string | null
  completedAt?: string | null
  actualMinutes?: number
  completion: {
    topics: Array<TopicRef & { completion: 'completed' | 'partial' }>
    questionsAttempted: number
    questionsCorrect: number
    confidence: number | null
    notes: string
  } | null
  skipReason?: string | null
  rescheduledFrom?: { startTime: string; endTime: string; at: string } | null
}

export interface RevisionBlock {
  obligationId: string
  type: ObligationType
  subjectName: string
  sourceDate: string
  sourceCycleNumber: number | null
  topics: string[]
  plannedMinutes: number
  status: 'pending' | 'in_progress' | 'completed'
  state: 'pending' | 'in_progress' | 'overdue' | 'completed'
  bypassed: boolean
  windowStart: string
  windowEnd: string
}

export interface Obligation {
  id: string
  type: ObligationType
  subjectId: string
  subjectName: string
  topics: TopicRef[]
  chapters: string[]
  sourceSessionIds: string[]
  sourceSessions?: Array<{ id: string; date: string; label: string; cycleNumber: number | null; startTime: string; endTime: string }>
  sourceDate: string
  sourceCycleNumber: number | null
  targetSessionId: string | null
  dueDate: string
  weekStart: string | null
  plannedMinutes: number
  practiceRequired: boolean
  status: 'pending' | 'in_progress' | 'completed'
  state: 'pending' | 'in_progress' | 'overdue' | 'completed'
  overdue: boolean
  bypassed: boolean
  bypassCount: number
  startedAt: string | null
  completedAt: string | null
  result: {
    topicsRevised: string[]
    questionsAttempted: number
    questionsCorrect: number
    questionsWrong: number
    confidence: number | null
    notes: string
    actualMinutes: number
  } | null
}

export interface CycleProgress {
  cycleNumber: number
  total: number
  completed: number
  skipped: number
  missed: number
  inProgress: number
  status: 'not_started' | 'in_progress' | 'completed' | 'closed'
  subjects: Array<{ sessionId: string | null; subjectName: string; status: string; state: string }>
}

export interface Carryover {
  date: string
  enabled: boolean
  /** per_subject: each subject's carryover gates only that subject. all_subjects: gates all learning. */
  scope: 'per_subject' | 'all_subjects'
  required: boolean
  complete: boolean
  obligations: Obligation[]
  totalMinutes: number
  remainingMinutes: number
}

export interface PlanDay {
  date: string
  today: string
  weekday: number
  timezone: string
  isStudyDay: boolean
  restReason: string | null
  projected: boolean
  scheduleVersion: number | null
  sessions: PlanSession[]
  cycles: CycleProgress[]
  carryover: Carryover | null
  summary: { sessions: number; completed: number; skipped: number; missed: number; plannedMinutes: number; plannedLearningMinutes: number; actualLearningMinutes: number }
}

export interface Preparation {
  obligation: Obligation
  topics: Array<TopicRef & { keyPoints: string[]; formulas: string[]; notes: string }>
  sessionNotes: Array<{ sessionId: string; date: string; label: string; cycleNumber: number | null; notes: string }>
  checklist: Array<{ id: string; kind: 'topic' | 'formula'; label: string; topicId: string }>
  practiceQuestions: Array<{ id: string; topicId: string; text: string; options: Array<{ label: string; text: string }>; difficulty: string }>
  mistakes: Array<{ id: string; source: 'mock_test' | 'mistake_bank'; topicId: string; question: string; explanation: string | null; category: string | null; occurrences: number }>
  timer: { plannedMinutes: number; startedAt: string | null; elapsedSeconds: number }
}

export interface Override {
  id: string
  sessionId: string
  sessionDate: string
  subjectName: string
  reason: string
  originalState: string
  lockReasons: LockReason[]
  obligationIds: string[]
  decision: 'bypassed'
  createdAt: string
}

export interface SessionDependencies {
  sessionId: string
  state: SessionState
  locked: boolean
  lockReasons: LockReason[]
  override: PlanSession['override']
  dependencies: {
    revisions: Obligation[]
    prerequisites: Array<{ id: string; subjectName: string; label: string; startTime: string; status: string; satisfied: boolean }>
  }
  generatedObligations: Obligation[]
  overrides: Override[]
}

export interface CompleteRevisionBody {
  topicsRevised: string[]
  questionsAttempted?: number
  questionsCorrect?: number
  questionsWrong?: number
  confidence: number
  notes?: string
  actualMinutes?: number
}

export interface CompleteSessionBody {
  topics: Array<{ topicId: string; completion: 'completed' | 'partial' }>
  questionsAttempted?: number
  questionsCorrect?: number
  confidence?: number
  notes?: string
  actualMinutes?: number
}

/* ----------------------------- API calls ----------------------------- */

const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} })

export const planApi = {
  day: (date = 'today') => api<PlanDay>(`/api/plan/days/${date}`),
  session: (id: string) => api<{ session: PlanSession } & Omit<SessionDependencies, 'sessionId' | 'state' | 'locked' | 'lockReasons' | 'override'>>(`/api/plan/sessions/${id}`),
  dependencies: (id: string) => api<SessionDependencies>(`/api/plan/sessions/${id}/dependencies`),
  startSession: (id: string) => post<{ session: PlanSession; alreadyStarted: boolean }>(`/api/plan/sessions/${id}/start`),
  completeSession: (id: string, body: CompleteSessionBody) =>
    post<{ session: PlanSession; generated: Obligation | null; alreadyCompleted: boolean }>(`/api/plan/sessions/${id}/complete`, body),
  skipSession: (id: string, reason: string) => post<{ session: PlanSession }>(`/api/plan/sessions/${id}/skip`, { reason }),
  overrideSession: (id: string, reason: string) => post<{ session: PlanSession; override: Override }>(`/api/plan/sessions/${id}/override`, { reason }),
  rescheduleSession: (id: string, startTime: string, endTime: string) => post<{ session: PlanSession }>(`/api/plan/sessions/${id}/reschedule`, { startTime, endTime }),
  completeCycle: (date: string, cycleNumber: number, reason?: string) => post<{ cycles: CycleProgress[] }>(`/api/plan/days/${date}/cycles/${cycleNumber}/complete`, { reason }),
  cycleTemplate: (body: { weekday: number; startTime: string; cyclesPerDay?: number; subjectIds?: string[]; sessionMinutes?: number; breakMinutes?: number }) =>
    post<{ slots: Array<Record<string, unknown>>; cyclesPerDay: number; subjects: Array<{ id: string; name: string }> }>('/api/plan/cycle-template', body),
  revisions: (query: { type?: ObligationType; state?: 'open' | 'pending' | 'in_progress' | 'overdue' | 'completed'; subjectId?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
    return api<{ today: string; obligations: Obligation[]; summary: { same_day: { open: number; completed: number }; next_day: { open: number; completed: number }; weekly: { open: number; completed: number }; overdue: number } }>(
      `/api/plan/revisions${qs ? `?${qs}` : ''}`
    )
  },
  carryover: () => api<Carryover>('/api/plan/revisions/carryover'),
  preparation: (id: string) => api<Preparation>(`/api/plan/revisions/${id}/preparation`),
  startRevision: (id: string) => post<{ obligation: Obligation }>(`/api/plan/revisions/${id}/start`),
  completeRevision: (id: string, body: CompleteRevisionBody) => post<{ obligation: Obligation; alreadyCompleted: boolean }>(`/api/plan/revisions/${id}/complete`, body),
  weekly: (weekStart?: string) => api<WeeklyReview>(`/api/plan/weekly${weekStart ? `?weekStart=${weekStart}` : ''}`),
  overrides: (days = 30) => api<{ overrides: Override[] }>(`/api/plan/overrides?days=${days}`),
  analytics: (days = 30) => api<PlanAnalytics>(`/api/plan/analytics?days=${days}`)
}

export interface WeeklyReview {
  weekStart: string
  weekEnd: string
  dueDate: string
  today: string
  obligations: Obligation[]
  progress: { total: number; completed: number; inProgress: number; pending: number; topicsTotal: number; topicsRevised: number }
  topics: Array<{ subjectId: string; subjectName: string; chapters: Array<{ chapterId: string; chapterName: string; topics: Array<{ topicId: string; topicName: string; dates: string[] }> }> }>
  mistakes: {
    unresolvedMockMistakes: Array<{ id: string; question: string; topicId: string | null; topicName: string | null; subjectName: string | null; category: string; occurrences: number; inThisWeek: boolean }>
    unresolvedBankCount: number
    weekBankMistakes: Array<{ id: string; topicId: string; question: string; status: string; category?: string }>
  }
  weakTopics: Array<{ topicId: string; topicName: string; chapterName: string; subjectId: string; accuracy: number | null; mistakeCount: number; inThisWeek: boolean }>
  lowConfidenceTopicIds: string[]
  mockTests: { count: number; averageAccuracy: number | null; tests: Array<{ id: string; name: string; submittedAt: string; accuracy: number | null }> }
  summary: {
    learningSessionsPlanned: number
    learningSessionsCompleted: number
    skipped: number
    missed: number
    learningMinutes: number
    revisionMinutes: number
    revisionsCompleted: { same_day: number; next_day: number; weekly: number }
    revisionAccuracy: number | null
  }
}

type RevBucket = { total: number; completed: number; open: number; overdue: number; bypassed: number; completionRate: number | null }
export interface PlanAnalytics {
  range: { from: string; to: string; days: number }
  time: {
    plannedLearningMinutes: number
    actualLearningMinutes: number
    plannedRevisionMinutes: number
    actualRevisionMinutes: number
    practiceMinutes: number
    mockTestMinutes: number
    scheduledRevisionSessionMinutes: number
  }
  revisions: { same_day: RevBucket; next_day: RevBucket; weekly: RevBucket }
  overdueRevisions: number
  sessions: { planned: number; completed: number; skipped: number; missed: number; completionRate: number | null }
  overrides: { gate: number; schedule: number; recent: Array<{ id: string; date: string; subjectName: string; reason: string; originalState: string; obligations: number; createdAt: string }> }
  subjects: Array<{
    subjectId: string
    subjectName: string
    plannedSessions: number
    completedSessions: number
    skipped: number
    missed: number
    learningMinutes: number
    revisionMinutes: number
    revisionsDue: number
    revisionsCompleted: number
    completionRate: number | null
    revisionCompletionRate: number | null
  }>
  chapters: Array<{ chapterId: string; chapterName: string; subjectId: string; subjectName: string; topicsTotal: number; topicsLearned: number; topicsRevised: number }>
  performance: { learningQuestions: number; learningAccuracy: number | null; revisionQuestions: number; revisionAccuracy: number | null; averageRevisionConfidence: number | null }
  daily: Array<{ date: string; learningMinutes: number; revisionMinutes: number }>
}

/* ----------------------------- change bus ---------------------------- */

const PLAN_CHANGED = 'studyos:plan-changed'
/** Every mutation calls this so all mounted plan views re-read the server. */
export const notifyPlanChanged = () => window.dispatchEvent(new CustomEvent(PLAN_CHANGED))

/** Loads a server resource, reloads on plan changes and every `refreshMs` (default 60 s). */
export function usePlanResource<T>(loader: () => Promise<T>, deps: unknown[], refreshMs = 60_000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const reload = useCallback(async () => {
    try {
      const next = await loaderRef.current()
      setData(next)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    setLoading(true)
    void reload()
    const onChange = () => void reload()
    window.addEventListener(PLAN_CHANGED, onChange)
    const id = refreshMs > 0 ? window.setInterval(() => void reload(), refreshMs) : 0
    return () => {
      window.removeEventListener(PLAN_CHANGED, onChange)
      if (id) window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading, reload }
}

export const usePlanDay = (date = 'today') => usePlanResource(() => planApi.day(date), [date])

/* ------------------------------ labels ------------------------------- */

export const SESSION_TYPE_LABEL: Record<PlanSessionType, string> = {
  learning: 'Learning',
  revision: 'Revision',
  practice: 'Practice',
  mock_test: 'Mock test'
}

export const OBLIGATION_LABEL: Record<ObligationType, string> = {
  same_day: 'Same-day revision',
  next_day: 'Next-day carryover',
  weekly: 'Weekly revision'
}

export const STATE_META: Record<SessionState, { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'purple' }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  locked: { label: 'Locked', tone: 'danger' },
  ready: { label: 'Ready', tone: 'accent' },
  in_progress: { label: 'In progress', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  pending_revision: { label: 'Pending revision', tone: 'warning' },
  revision_in_progress: { label: 'Revision in progress', tone: 'info' },
  revision_completed: { label: 'Revision completed', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
  missed: { label: 'Missed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  exception_approved: { label: 'Exception approved', tone: 'purple' }
}

export const OBLIGATION_STATE_META: Record<Obligation['state'], { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' }> = {
  pending: { label: 'Pending', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'danger' },
  completed: { label: 'Completed', tone: 'success' }
}
