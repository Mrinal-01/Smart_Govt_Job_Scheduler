import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AIMessage,
  Chapter,
  ID,
  MockAttempt,
  Mistake,
  MistakeCategory,
  Profile,
  ReminderSettings,
  RevisionRecord,
  RevisionSource,
  RevisionType,
  ScheduleGovernance,
  ScheduleSlot,
  SessionCompletion,
  SessionRecord,
  Settings,
  StudyState,
  Subject,
  Topic,
  Weekday
} from '../types'
import { buildSeedState, createSessionsForDate, summarizeDay } from '../data/seed'
import { parseImportedState } from '../lib/storage'
import { dateKey, diffDays, minutesFromTime, nowMinutes, weekdayOf } from '../lib/date'
import { clamp, sum, uid } from '../lib/utils'
import { addDays, epochFromIST } from '../lib/date'
import { applyRevision, classifyRevision, elapsedSecondsOf, sessionKey, topicById, chapterById } from './selectors'

interface ToastInput {
  title: string
  message?: string
  variant?: 'success' | 'error' | 'info' | 'warning'
}

export interface ToastItem extends ToastInput {
  id: string
  variant: 'success' | 'error' | 'info' | 'warning'
}

export interface SessionActionResult {
  needsRevision: boolean
  topic: string | null
}

interface StudyContextValue {
  state: StudyState
  today: string
  toasts: ToastItem[]
  notify: (t: ToastInput) => void
  dismissToast: (id: string) => void

  /* profile & settings */
  updateProfile: (patch: Partial<Profile>) => void
  updateSettings: (patch: Partial<Settings>) => void
  updateReminder: (patch: Partial<ReminderSettings>) => void

  /* curriculum */
  addSubject: (input: { name: string; shortName?: string }) => Subject
  updateSubject: (id: ID, patch: Partial<Subject>) => void
  deleteSubject: (id: ID) => void
  addChapter: (subjectId: ID, name: string, weightage?: number) => Chapter | null
  updateChapter: (chapterId: ID, patch: Partial<Pick<Chapter, 'name' | 'weightage'>>) => void
  deleteChapter: (chapterId: ID) => void
  addTopic: (chapterId: ID, name: string, difficulty?: Topic['difficulty']) => void
  updateTopic: (topicId: ID, patch: Partial<Topic>) => void
  deleteTopic: (topicId: ID) => void

  /* schedule */
  addSlot: (input: Omit<ScheduleSlot, 'id' | 'order' | 'sessionNumber'> & { sessionNumber?: number }) => void
  duplicateSlot: (id: ID) => void
  updateSlot: (id: ID, patch: Partial<ScheduleSlot>) => void
  deleteSlot: (id: ID) => void
  moveSlot: (id: ID, dir: -1 | 1) => void
  copyDaySchedule: (from: Weekday, to: Weekday[]) => void
  replaceDaySchedule: (weekday: Weekday, slots: ScheduleSlot[]) => void

  /* sessions */
  ensureToday: () => void
  startSession: (key: string, opts?: { gateCleared?: boolean }) => SessionActionResult
  pauseSession: (key: string) => void
  resumeSession: (key: string) => void
  toggleRevisionItem: (key: string, itemId: string) => void
  setRevisionItem: (key: string, itemId: string, checked: boolean) => void
  skipRevision: (key: string, reason: string) => void
  completeSession: (key: string, completion: Omit<SessionCompletion, 'completedAt'>) => void
  skipSession: (key: string, reason: string) => void
  snoozeSession: (key: string, minutes: number) => void
  markReminded: (key: string) => void
  applyReminderUpdates: (updates: Array<{ key: string; patch: Partial<SessionRecord> }>) => void
  simulateOverdue: () => string | null
  reopenSession: (key: string) => void

  /* revision center */
  logRevision: (
    topicId: ID,
    payload: {
      accuracy?: number | null
      confidence?: number | null
      notes?: string
      type?: RevisionType
      source?: RevisionSource
    }
  ) => void

  /* mistakes */
  addMistake: (input: Omit<Mistake, 'id' | 'date' | 'status' | 'reviewCount' | 'lastReviewedAt'>) => void
  setMistakeStatus: (id: ID, status: Mistake['status']) => void
  setMistakeCategory: (id: ID, category: MistakeCategory) => void
  reviewMistake: (id: ID) => void

  /* mock tests */
  submitAttempt: (attempt: MockAttempt, newMistakes: Mistake[]) => void

  /* ai */
  appendAIMessage: (message: Omit<AIMessage, 'id' | 'createdAt'>) => void
  clearAIMessages: () => void

  /* study cycles (server engine) → keep the topic ledger in sync */
  registerLearning: (topicId: ID, date: string, confidence?: number | null) => void
  recordCycleRevision: (topicId: ID, date: string, accuracy: number | null) => void

  /* replace state with a newer copy saved by another tab (not re-saved) */
  adoptExternalState: (next: StudyState) => void

  /* schedule governance */
  syncScheduleFromServer: (status: ServerScheduleStatus) => void
  discardScheduleDraft: () => void

  /* data */
  resetDemoData: () => void
  importData: (raw: string) => void
}

export interface ServerScheduleVersion {
  version: number
  effectiveFrom: string
  slots: ScheduleSlot[]
}

export interface ServerScheduleStatus {
  latest: ServerScheduleVersion | null
  active: ServerScheduleVersion | null
}

const slotKey = (slots: ScheduleSlot[]) =>
  JSON.stringify(
    [...slots]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => [
        s.id,
        s.weekday,
        s.subjectId,
        s.label,
        s.startTime,
        s.endTime,
        s.requiresRevision,
        s.learningTarget,
        s.practiceTarget,
        s.reminderEnabled,
        s.breakAfterMinutes,
        s.order,
        s.sessionNumber,
        s.sessionType ?? 'learning',
        s.cycleNumber ?? null,
        s.chapterId ?? null,
        s.topicIds ?? [],
        s.revisionMinutes ?? null,
        s.revisionPolicy ?? null,
        s.prerequisiteSlotIds ?? []
      ])
  )

export const sameSlots = (a: ScheduleSlot[], b: ScheduleSlot[]) => slotKey(a) === slotKey(b)

/** The slots the Schedule page edits: unpublished draft → latest published → active. */
export const draftScheduleOf = (state: StudyState): ScheduleSlot[] =>
  state.scheduleDraft ?? state.scheduleGovernance?.latestSlots ?? state.schedule

export const hasUnpublishedSchedule = (state: StudyState): boolean => {
  if (!state.scheduleDraft) return false
  const published = state.scheduleGovernance?.latestSlots ?? state.schedule
  return !sameSlots(state.scheduleDraft, published)
}

/** Switch the active timetable when a published version becomes effective. Past sessions are untouched. */
function applyGovernance(state: StudyState, today: string): StudyState {
  const g = state.scheduleGovernance
  if (!g || g.activeVersion === g.latestVersion || g.latestEffectiveFrom > today) return state
  const next: StudyState = { ...state, schedule: g.latestSlots, scheduleGovernance: { ...g, activeVersion: g.latestVersion } }
  return { ...next, sessions: createSessionsForDate(next, today) }
}

const StudyContext = createContext<StudyContextValue | null>(null)

/* -------------------------------------------------------------------- */
/* Helpers                                                              */
/* -------------------------------------------------------------------- */

function recomputeLog(state: StudyState, date: string): StudyState {
  const summary = summarizeDay(state, date)
  const attempts = state.attempts.filter((a) => a.submittedAt.slice(0, 10) === date)
  const logIndex = state.logs.findIndex((l) => l.date === date)
  const mockAccuracy = attempts.length
    ? Math.round(sum(attempts.map((a) => a.accuracy)) / attempts.length)
    : summary.accuracy

  /* Derived from topic history so manual / Sunday revisions are counted too. */
  const flatTopics = state.chapters.flatMap((c) => c.topics)
  const revisionsToday = flatTopics.reduce((acc, t) => acc + t.revisions.filter((r) => r.date === date).length, 0)
  const newTopicsToday = flatTopics.filter((t) => t.initialLearningDate === date).length

  const entry = {
    date,
    plannedMinutes: summary.plannedMinutes,
    actualMinutes: summary.actualMinutes,
    sessionsPlanned: summary.sessionsPlanned,
    sessionsCompleted: summary.sessionsCompleted,
    topicsCovered: Math.max(summary.topicsCovered, newTopicsToday),
    revisionsCompleted: Math.max(summary.revisionsCompleted, revisionsToday),
    mockTests: attempts.length,
    accuracy: mockAccuracy,
    subjectMinutes: summary.subjectMinutes,
    seed: false
  }
  const logs = logIndex >= 0 ? state.logs.map((l, i) => (i === logIndex ? entry : l)) : [...state.logs, entry]
  return { ...state, logs: logs.sort((a, b) => (a.date < b.date ? -1 : 1)) }
}

function registerFirstLearning(topic: Topic, date: string, intervals: number[], confidence?: number | null): Topic {
  return {
    ...topic,
    initialLearningDate: date,
    learningCompleted: true,
    intervalIndex: 0,
    nextRevisionDue: addDays(date, intervals[0] ?? 1),
    confidence: confidence ?? topic.confidence
  }
}

function syncTopicOnCompletion(
  state: StudyState,
  completion: SessionCompletion,
  sessionDate: string,
  revisionCompleted: boolean,
  intervals: number[]
): StudyState {
  const subject = state.subjects.find((s) => s.id === state.chapters.find((c) => c.id === completion.chapterId)?.subjectId)
  void subject
  let changed = false
  const chapters = state.chapters.map((chapter) => {
    if (chapter.id !== completion.chapterId) return chapter
    const topics = chapter.topics.map((topic) => {
      let next: Topic = topic
      // If the completed topic is brand new, register the learning date.
      if (topic.id === completion.topicId && completion.learningCompleted) {
        if (!topic.initialLearningDate) {
          // First learning is not a revision: register it and schedule the first interval.
          next = registerFirstLearning(next, sessionDate, intervals, completion.confidence)
        } else if (revisionCompleted) {
          next = applyRevision(
            next,
            {
              date: sessionDate,
              type: classifyRevision(topic, sessionDate),
              source: 'session',
              confidence: completion.confidence
            },
            intervals
          )
        }
      }
      if (topic.id === completion.topicId) {
        next = {
          ...next,
          questionsAttempted: next.questionsAttempted + completion.questionsAttempted,
          questionsCorrect: next.questionsCorrect + completion.correctAnswers,
          practiceCompleted: next.practiceCompleted || completion.practiceCompleted,
          confidence: completion.confidence || next.confidence,
          notes: completion.notes || next.notes
        }
      }
      if (next !== topic) changed = true
      return next
    })
    return { ...chapter, topics }
  })
  if (!changed) return state
  return { ...state, chapters }
}

/* -------------------------------------------------------------------- */
/* Provider                                                             */
/* -------------------------------------------------------------------- */

export function StudyProvider({
  children,
  initialState,
  onChange
}: {
  children: React.ReactNode
  initialState: StudyState
  /** Called after every state change (debounced persistence lives in the workspace sync layer). */
  onChange?: (state: StudyState) => void
}) {
  const [state, setState] = useState<StudyState>(() => {
    const today = dateKey()
    const governed = applyGovernance(initialState, today)
    return { ...governed, sessions: createSessionsForDate(governed, today) }
  })
  const [today, setToday] = useState<string>(() => dateKey())
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const stateRef = useRef(state)
  stateRef.current = state

  /* persistence */
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Persist only states that differ from what was loaded or adopted.
  const skipState = useRef<StudyState | null>(null)
  const loadedState = useRef<StudyState>(state)
  useEffect(() => {
    if (state === loadedState.current || state === skipState.current) return
    onChangeRef.current?.(state)
  }, [state])

  const adoptExternalState = useCallback((next: StudyState) => {
    const todayKey = dateKey()
    const governed = applyGovernance(next, todayKey)
    const adopted = { ...governed, sessions: createSessionsForDate(governed, todayKey) }
    skipState.current = adopted
    setState(adopted)
  }, [])

  /* midnight rollover */
  useEffect(() => {
    const tick = () => {
      const key = dateKey()
      if (key !== today) {
        setToday(key)
        setState((prev) => {
          const governed = applyGovernance(prev, key)
          return { ...governed, sessions: createSessionsForDate(governed, key) }
        })
      }
    }
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [today])

  const notify = useCallback((t: ToastInput) => {
    const item: ToastItem = { ...t, id: uid('toast'), variant: t.variant ?? 'success' }
    setToasts((prev) => [...prev.slice(-3), item])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== item.id))
    }, 4200)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  /* ------------------------------ profile ------------------------------ */
  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setState((prev) => ({ ...prev, profile: { ...prev.profile, ...patch } }))
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }))
  }, [])

  const updateReminder = useCallback((patch: Partial<ReminderSettings>) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, reminder: { ...prev.settings.reminder, ...patch } }
    }))
  }, [])

  /* ---------------------------- curriculum ---------------------------- */
  const addSubject = useCallback((input: { name: string; shortName?: string }) => {
    const subject: Subject = {
      id: uid('sub'),
      name: input.name.trim(),
      shortName: (input.shortName || input.name).trim().slice(0, 14),
      tone: 'custom',
      icon: 'book',
      weeklyTargetMinutes: 300,
      createdAt: dateKey()
    }
    setState((prev) => ({ ...prev, subjects: [...prev.subjects, subject] }))
    return subject
  }, [])

  const updateSubject = useCallback((id: ID, patch: Partial<Subject>) => {
    setState((prev) => ({
      ...prev,
      subjects: prev.subjects.map((s) => (s.id === id ? { ...s, ...patch } : s))
    }))
  }, [])

  const deleteSubject = useCallback((id: ID) => {
    setState((prev) => ({
      ...prev,
      subjects: prev.subjects.filter((s) => s.id !== id),
      chapters: prev.chapters.filter((c) => c.subjectId !== id),
      schedule: prev.schedule.filter((s) => s.subjectId !== id)
    }))
  }, [])

  const addChapter = useCallback((subjectId: ID, name: string, weightage = 5): Chapter | null => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const chapter: Chapter = {
      id: uid('ch'),
      subjectId,
      name: trimmed,
      order: 999,
      weightage,
      topics: []
    }
    setState((prev) => ({
      ...prev,
      chapters: [...prev.chapters, { ...chapter, order: prev.chapters.filter((c) => c.subjectId === subjectId).length }]
    }))
    return chapter
  }, [])

  const updateChapter = useCallback((chapterId: ID, patch: Partial<Pick<Chapter, 'name' | 'weightage'>>) => {
    setState((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, ...patch } : c))
    }))
  }, [])

  const deleteChapter = useCallback((chapterId: ID) => {
    setState((prev) => ({ ...prev, chapters: prev.chapters.filter((c) => c.id !== chapterId) }))
  }, [])

  const addTopic = useCallback((chapterId: ID, name: string, difficulty: Topic['difficulty'] = 'medium') => {
    setState((prev) => {
      const chapter = prev.chapters.find((c) => c.id === chapterId)
      if (!chapter) return prev
      const topic: Topic = {
        id: uid('tp'),
        chapterId,
        subjectId: chapter.subjectId,
        name: name.trim(),
        order: chapter.topics.length,
        difficulty,
        estimatedMinutes: 45,
        keyPoints: [],
        formulas: [],
        initialLearningDate: null,
        learningCompleted: false,
        practiceCompleted: false,
        pyqCompleted: false,
        revisions: [],
        intervalIndex: 0,
        nextRevisionDue: null,
        questionsAttempted: 0,
        questionsCorrect: 0,
        confidence: 0,
        mistakeCount: 0,
        mockAccuracy: null,
        notes: ''
      }
      return {
        ...prev,
        chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, topics: [...c.topics, topic] } : c))
      }
    })
  }, [])

  const updateTopic = useCallback((topicId: ID, patch: Partial<Topic>) => {
    setState((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) => ({
        ...c,
        topics: c.topics.map((t) => (t.id === topicId ? { ...t, ...patch } : t))
      }))
    }))
  }, [])

  const deleteTopic = useCallback((topicId: ID) => {
    setState((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) => ({ ...c, topics: c.topics.filter((t) => t.id !== topicId) }))
    }))
  }, [])

  /* ----------------------------- schedule ----------------------------- */
  /*
   * Edits go to an unpublished draft. They never touch today's sessions; the
   * draft becomes the timetable only after it is published (server-governed)
   * and its effective date arrives.
   */
  const editDraft = useCallback((fn: (draft: ScheduleSlot[]) => ScheduleSlot[]) => {
    setState((prev) => ({ ...prev, scheduleDraft: fn(draftScheduleOf(prev)) }))
  }, [])

  const addSlot = useCallback(
    (input: Omit<ScheduleSlot, 'id' | 'order' | 'sessionNumber'> & { sessionNumber?: number }) => {
      editDraft((draft) => {
        const sameDay = draft.filter((s) => s.weekday === input.weekday)
        const sameSubject = sameDay.filter((s) => s.subjectId === input.subjectId)
        const slot: ScheduleSlot = {
          ...input,
          id: uid('slot'),
          order: sameDay.length,
          sessionNumber: input.sessionNumber ?? sameSubject.length + 1
        }
        return [...draft, slot]
      })
    },
    [editDraft]
  )

  const updateSlot = useCallback(
    (id: ID, patch: Partial<ScheduleSlot>) => {
      editDraft((draft) => draft.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    },
    [editDraft]
  )

  const deleteSlot = useCallback(
    (id: ID) => {
      // Dependencies on the removed session are dropped with it.
      editDraft((draft) =>
        draft
          .filter((s) => s.id !== id)
          .map((s) => (s.prerequisiteSlotIds?.includes(id) ? { ...s, prerequisiteSlotIds: s.prerequisiteSlotIds.filter((x) => x !== id) } : s))
      )
    },
    [editDraft]
  )

  /** Copies a session to the same day; its cycle number is re-derived and dependencies are not copied. */
  const duplicateSlot = useCallback(
    (id: ID) => {
      editDraft((draft) => {
        const slot = draft.find((s) => s.id === id)
        if (!slot) return draft
        const sameSubject = draft.filter((s) => s.weekday === slot.weekday && s.subjectId === slot.subjectId)
        const copy: ScheduleSlot = {
          ...slot,
          id: uid('slot'),
          order: slot.order + 1,
          sessionNumber: sameSubject.length + 1,
          cycleNumber: null,
          prerequisiteSlotIds: []
        }
        return [...draft.map((s) => (s.weekday === slot.weekday && s.order > slot.order ? { ...s, order: s.order + 1 } : s)), copy]
      })
    },
    [editDraft]
  )

  const moveSlot = useCallback(
    (id: ID, dir: -1 | 1) => {
      editDraft((draft) => {
        const slot = draft.find((s) => s.id === id)
        if (!slot) return draft
        const daySlots = draft.filter((s) => s.weekday === slot.weekday).sort((a, b) => a.order - b.order)
        const index = daySlots.findIndex((s) => s.id === id)
        const target = index + dir
        if (target < 0 || target >= daySlots.length) return draft
        const swapped = [...daySlots]
        ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]
        const orderMap = new Map(swapped.map((s, i) => [s.id, i]))
        return draft.map((s) => (orderMap.has(s.id) ? { ...s, order: orderMap.get(s.id)! } : s))
      })
    },
    [editDraft]
  )

  const copyDaySchedule = useCallback(
    (from: Weekday, to: Weekday[]) => {
      editDraft((draft) => {
        const source = draft.filter((s) => s.weekday === from).sort((a, b) => a.order - b.order)
        let schedule = [...draft]
        to.forEach((weekday) => {
          if (weekday === from) return
          schedule = schedule.filter((s) => s.weekday !== weekday)
          // New ids per copy; prerequisites are re-pointed to the copied sessions of the same day.
          const ids = new Map(source.map((s) => [s.id, uid('slot')]))
          schedule = [
            ...schedule,
            ...source.map((s, index) => ({
              ...s,
              id: ids.get(s.id)!,
              weekday,
              order: index,
              prerequisiteSlotIds: (s.prerequisiteSlotIds ?? []).map((p) => ids.get(p)).filter((p): p is string => Boolean(p))
            }))
          ]
        })
        return schedule.sort((a, b) => a.weekday - b.weekday || a.order - b.order)
      })
    },
    [editDraft]
  )

  const replaceDaySchedule = useCallback(
    (weekday: Weekday, slots: ScheduleSlot[]) => {
      editDraft((draft) => [...draft.filter((s) => s.weekday !== weekday), ...slots.map((s, i) => ({ ...s, weekday, order: i }))])
    },
    [editDraft]
  )

  const discardScheduleDraft = useCallback(() => {
    setState((prev) => ({ ...prev, scheduleDraft: null }))
  }, [])

  /** Reconcile with the server's published versions (the server is authoritative). */
  const syncScheduleFromServer = useCallback((status: ServerScheduleStatus) => {
    setState((prev) => {
      if (!status.latest) return prev
      const todayKey = dateKey()
      const active = status.active ?? status.latest
      const governance: ScheduleGovernance = {
        latestVersion: status.latest.version,
        latestEffectiveFrom: status.latest.effectiveFrom,
        latestSlots: status.latest.slots,
        activeVersion: active.version
      }
      const switchActive = prev.scheduleGovernance?.activeVersion !== active.version || !sameSlots(prev.schedule, active.slots)
      let next: StudyState = { ...prev, scheduleGovernance: governance }
      if (switchActive) next = { ...next, schedule: active.slots }
      if (next.scheduleDraft && sameSlots(next.scheduleDraft, governance.latestSlots)) next = { ...next, scheduleDraft: null }
      next = applyGovernance(next, todayKey)
      return switchActive ? { ...next, sessions: createSessionsForDate(next, todayKey) } : next
    })
  }, [])

  /* ----------------------------- sessions ----------------------------- */
  const ensureToday = useCallback(() => {
    setState((prev) => {
      const key = dateKey()
      const next = createSessionsForDate(prev, key)
      return Object.keys(next).length === Object.keys(prev.sessions).length ? prev : { ...prev, sessions: next }
    })
  }, [])

  const patchSession = useCallback((key: string, patch: Partial<SessionRecord>) => {
    setState((prev) => {
      const record = prev.sessions[key]
      if (!record) return prev
      return { ...prev, sessions: { ...prev.sessions, [key]: { ...record, ...patch } } }
    })
  }, [])

  /**
   * Starts the local timer. `gateCleared` means the server already validated every revision
   * prerequisite (modules/plan), so the legacy client-side revision checklist is not re-applied.
   */
  const startSession = useCallback((key: string, opts?: { gateCleared?: boolean }): SessionActionResult => {
    const current = stateRef.current
    const record = current.sessions[key]
    const cleared = Boolean(opts?.gateCleared)
    if (!record) return { needsRevision: false, topic: null }
    const slot = current.schedule.find((s) => s.id === record.slotId)
    const now = new Date()
    const nowMin = nowMinutes(now)
    const startMin = slot ? minutesFromTime(slot.startTime) : nowMin
    const topic =
      current.chapters
        .flatMap((c) => c.topics)
        .filter((t) => t.subjectId === record.subjectId && t.initialLearningDate)
        .sort((a, b) => (a.initialLearningDate! < b.initialLearningDate! ? 1 : -1))[0]?.name ?? null

    setState((prev) => {
      const rec = prev.sessions[key]
      if (!rec) return prev
      const alreadyStarted = Boolean(rec.startedAt)
      const lateStart = Math.max(0, nowMin - startMin)
      const gated = !cleared && slot?.requiresRevision && !rec.revisionMarked
      const next: SessionRecord = {
        ...rec,
        status: gated ? 'revision-pending' : 'in-progress',
        startedAt: rec.startedAt ?? now.toISOString(),
        runningSince: gated ? null : Date.now(),
        accumulatedSeconds: alreadyStarted ? rec.accumulatedSeconds : lateStart * 60
      }
      return { ...prev, sessions: { ...prev.sessions, [key]: next } }
    })
    return { needsRevision: !cleared && Boolean(slot?.requiresRevision) && !record.revisionMarked, topic }
  }, [])

  const pauseSession = useCallback(
    (key: string) => {
      const record = stateRef.current.sessions[key]
      if (!record) return
      const elapsed = elapsedSecondsOf(record)
      patchSession(key, { accumulatedSeconds: elapsed, runningSince: null })
    },
    [patchSession]
  )

  const resumeSession = useCallback((key: string) => {
    patchSession(key, { runningSince: Date.now(), status: 'in-progress' })
  }, [patchSession])

  const toggleRevisionItem = useCallback((key: string, itemId: string) => {
    setState((prev) => {
      const record = prev.sessions[key]
      if (!record) return prev
      const has = record.revisionChecklist.includes(itemId)
      const checklist = has
        ? record.revisionChecklist.filter((i) => i !== itemId)
        : [...record.revisionChecklist, itemId]
      return { ...prev, sessions: { ...prev.sessions, [key]: { ...record, revisionChecklist: checklist } } }
    })
  }, [])

  const setRevisionItem = useCallback((key: string, itemId: string, checked: boolean) => {
    setState((prev) => {
      const record = prev.sessions[key]
      if (!record) return prev
      const set = new Set(record.revisionChecklist)
      if (checked) set.add(itemId)
      else set.delete(itemId)
      const checklist = Array.from(set)
      const next: SessionRecord = {
        ...record,
        revisionChecklist: checklist,
        revisionMarked: checklist.length > 0 ? record.revisionMarked : record.revisionMarked
      }
      return { ...prev, sessions: { ...prev.sessions, [key]: next } }
    })
  }, [])

  const skipRevision = useCallback(
    (key: string, reason: string) => {
      const record = stateRef.current.sessions[key]
      if (!record) return
      patchSession(key, {
        revisionSkippedReason: reason,
        revisionMarked: true,
        status: record.status === 'revision-pending' ? 'in-progress' : record.status,
        runningSince: record.runningSince ?? Date.now()
      })
      notify({ title: 'Revision skipped', message: 'Reason saved. You can revisit it any time from the Revision Center.', variant: 'warning' })
    },
    [notify, patchSession]
  )

  const completeSession = useCallback(
    (key: string, completion: Omit<SessionCompletion, 'completedAt'>) => {
      const record = stateRef.current.sessions[key]
      if (!record) return
      const slot = stateRef.current.schedule.find((s) => s.id === record.slotId)
      const elapsed = Math.floor(elapsedSecondsOf(record) / 60)
      const finalMinutes = completion.durationMinutes || slot?.durationMinutes || elapsed
      const full: SessionCompletion = { ...completion, completedAt: new Date().toISOString() }

      setState((prev) => {
        const rec = prev.sessions[key]
        if (!rec) return prev
        const updatedSessions = {
          ...prev.sessions,
          [key]: {
            ...rec,
            status: 'completed' as const,
            runningSince: null,
            accumulatedSeconds: finalMinutes * 60,
            revisionMarked: completion.revisionCompleted || rec.revisionMarked,
            completion: full,
            snoozedUntil: null,
            remindedAt: null,
            graceUntil: null
          }
        }
        const withTopic = syncTopicOnCompletion(
          { ...prev, sessions: updatedSessions },
          full,
          record.date,
          completion.revisionCompleted,
          prev.settings.revisionIntervals
        )
        return recomputeLog(withTopic, record.date)
      })
      notify({
        title: 'Session completed',
        message: `${completion.topicName} — ${completion.correctAnswers}/${completion.questionsAttempted} correct`,
        variant: 'success'
      })
    },
    [notify]
  )

  const skipSession = useCallback(
    (key: string, reason: string) => {
      const record = stateRef.current.sessions[key]
      if (!record) return
      patchSession(key, { status: 'skipped', skipReason: reason, runningSince: null })
      setState((prev) => recomputeLog(prev, record.date))
      notify({ title: 'Session skipped', message: reason, variant: 'warning' })
    },
    [notify, patchSession]
  )

  const snoozeSession = useCallback((key: string, minutes: number) => {
    patchSession(key, { snoozedUntil: new Date(Date.now() + minutes * 60_000).toISOString(), remindedAt: null })
  }, [patchSession])

  const markReminded = useCallback((key: string) => {
    patchSession(key, { remindedAt: new Date().toISOString() })
  }, [patchSession])

  /**
   * Persists the reminder state machine transitions computed by
   * services/reminder.ts (ended -> awaiting-completion -> overdue).
   * Batched into one state write so the 15s tick never causes a render storm.
   */
  const applyReminderUpdates = useCallback(
    (updates: Array<{ key: string; patch: Partial<SessionRecord> }>) => {
      if (!updates.length) return
      setState((prev) => {
        let changed = false
        const sessions = { ...prev.sessions }
        updates.forEach(({ key, patch }) => {
          const record = sessions[key]
          if (!record) return
          const next = { ...record, ...patch }
          // skip no-op writes so we don't recreate objects every tick
          if (JSON.stringify(next) === JSON.stringify(record)) return
          sessions[key] = next
          changed = true
        })
        return changed ? { ...prev, sessions } : prev
      })
    },
    []
  )

  /**
   * Test hook: force the next open session into the `overdue` state so the
   * accountability reminder (overlay + looping Web Audio) can be verified at
   * any hour. It mutates the real state machine, not a mock overlay.
   */
  const simulateOverdue = useCallback((): string | null => {
    const current = stateRef.current
    const todayKey = dateKey()
    const open = Object.values(current.sessions)
      .filter((r) => r.date === todayKey && !['completed', 'skipped', 'overdue'].includes(r.status))
      .sort((a, b) => {
        const sa = current.schedule.find((x) => x.id === a.slotId)
        const sb = current.schedule.find((x) => x.id === b.slotId)
        return (sa?.startTime ?? '').localeCompare(sb?.startTime ?? '')
      })
    const target = open[0] ?? Object.values(current.sessions).find((r) => r.date === todayKey)
    if (!target) return null
    setState((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        [target.key]: { ...prev.sessions[target.key], status: 'overdue', remindedAt: null, snoozedUntil: null }
      }
    }))
    return target.key
  }, [])

  const reopenSession = useCallback((key: string) => {
    patchSession(key, { status: 'in-progress', completion: null, skipReason: null, runningSince: Date.now() })
  }, [patchSession])

  /* ----------------------------- revision ----------------------------- */
  const logRevision = useCallback(
    (
      topicId: ID,
      payload: {
        accuracy?: number | null
        confidence?: number | null
        notes?: string
        type?: RevisionType
        source?: RevisionSource
      }
    ) => {
      setState((prev) => {
        const todayKey = dateKey()
        let found = false
        const chapters = prev.chapters.map((chapter) => {
          const topics = chapter.topics.map((topic) => {
            if (topic.id !== topicId) return topic
            found = true
            const updated = applyRevision(
              topic,
              {
                date: todayKey,
                type: payload.type ?? classifyRevision(topic, todayKey),
                source: payload.source ?? 'revision-center',
                accuracy: payload.accuracy ?? null,
                confidence: payload.confidence ?? topic.confidence,
                notes: payload.notes
              },
              prev.settings.revisionIntervals
            )
            return {
              ...updated,
              confidence: payload.confidence ?? updated.confidence,
              notes: payload.notes ?? updated.notes
            }
          })
          return { ...chapter, topics }
        })
        if (!found) return prev
        return recomputeLog({ ...prev, chapters }, todayKey)
      })
    },
    []
  )

  /* ---------------------- study cycle integration ---------------------- */
  const registerLearning = useCallback((topicId: ID, date: string, confidence?: number | null) => {
    setState((prev) => {
      let changed = false
      const chapters = prev.chapters.map((c) => ({
        ...c,
        topics: c.topics.map((t) => {
          if (t.id !== topicId || t.initialLearningDate) return t
          changed = true
          return registerFirstLearning(t, date, prev.settings.revisionIntervals, confidence)
        })
      }))
      return changed ? recomputeLog({ ...prev, chapters }, date) : prev
    })
  }, [])

  /**
   * A same-day cycle revision is recorded in the topic's history but does not
   * advance the spaced (next-day / weekly / monthly) interval schedule.
   */
  const recordCycleRevision = useCallback((topicId: ID, date: string, accuracy: number | null) => {
    setState((prev) => {
      let changed = false
      const chapters = prev.chapters.map((c) => ({
        ...c,
        topics: c.topics.map((t) => {
          if (t.id !== topicId) return t
          changed = true
          const record: RevisionRecord = { id: uid('rev'), date, type: 'same-day', source: 'cycle', accuracy }
          return { ...t, revisions: [...t.revisions, record] }
        })
      }))
      return changed ? recomputeLog({ ...prev, chapters }, date) : prev
    })
  }, [])

  /* ----------------------------- mistakes ----------------------------- */
  const addMistake = useCallback(
    (input: Omit<Mistake, 'id' | 'date' | 'status' | 'reviewCount' | 'lastReviewedAt'>) => {
      const mistake: Mistake = {
        ...input,
        id: uid('mis'),
        date: dateKey(),
        status: 'unresolved',
        reviewCount: 0,
        lastReviewedAt: null
      }
      setState((prev) => ({
        ...prev,
        mistakes: [mistake, ...prev.mistakes],
        chapters: prev.chapters.map((c) => ({
          ...c,
          topics: c.topics.map((t) => (t.id === input.topicId ? { ...t, mistakeCount: t.mistakeCount + 1 } : t))
        }))
      }))
      notify({ title: 'Saved to Mistake Bank', message: 'It will appear in your next revision session.', variant: 'info' })
    },
    [notify]
  )

  const setMistakeStatus = useCallback((id: ID, status: Mistake['status']) => {
    setState((prev) => ({
      ...prev,
      mistakes: prev.mistakes.map((m) => (m.id === id ? { ...m, status } : m))
    }))
  }, [])

  const setMistakeCategory = useCallback((id: ID, category: MistakeCategory) => {
    setState((prev) => ({
      ...prev,
      mistakes: prev.mistakes.map((m) => (m.id === id ? { ...m, category } : m))
    }))
  }, [])

  const reviewMistake = useCallback((id: ID) => {
    setState((prev) => ({
      ...prev,
      mistakes: prev.mistakes.map((m) =>
        m.id === id
          ? { ...m, reviewCount: m.reviewCount + 1, lastReviewedAt: new Date().toISOString(), status: m.reviewCount + 1 >= 3 ? 'resolved' : 'reviewed' }
          : m
      )
    }))
  }, [])

  /* ----------------------------- attempts ----------------------------- */
  const submitAttempt = useCallback(
    (attempt: MockAttempt, newMistakes: Mistake[]) => {
      setState((prev) => {
        const date = attempt.submittedAt.slice(0, 10)
        const chapters = prev.chapters.map((chapter) => ({
          ...chapter,
          topics: chapter.topics.map((topic) => {
            const score = attempt.topicBreakdown.find((t) => t.topicId === topic.id)
            if (!score) return topic
            const attempted = topic.questionsAttempted + score.total
            const correct = topic.questionsCorrect + score.correct
            return {
              ...topic,
              questionsAttempted: attempted,
              questionsCorrect: correct,
              mockAccuracy: Math.round((correct / Math.max(1, attempted)) * 100),
              mistakeCount: topic.mistakeCount + newMistakes.filter((m) => m.topicId === topic.id).length
            }
          })
        }))
        const next: StudyState = {
          ...prev,
          attempts: [attempt, ...prev.attempts],
          mistakes: [...newMistakes, ...prev.mistakes],
          chapters
        }
        return recomputeLog(next, date)
      })
      notify({
        title: 'Mock test submitted',
        message: `${attempt.correct}/${attempt.totalQuestions} correct · ${attempt.accuracy}% accuracy`,
        variant: 'success'
      })
    },
    [notify]
  )

  /* --------------------------------- ai -------------------------------- */
  const appendAIMessage = useCallback((message: Omit<AIMessage, 'id' | 'createdAt'>) => {
    setState((prev) => ({
      ...prev,
      aiMessages: [
        ...prev.aiMessages,
        { ...message, id: uid('msg'), createdAt: new Date().toISOString() }
      ]
    }))
  }, [])

  const clearAIMessages = useCallback(() => {
    setState((prev) => ({ ...prev, aiMessages: [] }))
  }, [])

  /* -------------------------------- data ------------------------------- */
  /** Replacing data never bypasses schedule governance: the published timetable stays active and the new one becomes a draft. */
  const keepGovernance = (prev: StudyState, incoming: StudyState): StudyState => {
    const g = prev.scheduleGovernance
    if (!g) return incoming
    const active = prev.schedule
    return {
      ...incoming,
      profile: { ...incoming.profile, name: prev.profile.name, email: prev.profile.email },
      scheduleGovernance: g,
      schedule: active,
      scheduleDraft: sameSlots(incoming.schedule, g.latestSlots) ? null : incoming.schedule
    }
  }

  const resetDemoData = useCallback(() => {
    const fresh = keepGovernance(stateRef.current, buildSeedState())
    setState({ ...fresh, sessions: createSessionsForDate(fresh, dateKey()) })
    setToday(dateKey())
    notify({ title: 'Demo data restored', message: 'A fresh 365-day dataset has been generated.', variant: 'success' })
  }, [notify])

  const importData = useCallback(
    (raw: string) => {
      try {
        const parsed = keepGovernance(stateRef.current, parseImportedState(raw))
        setState({ ...parsed, sessions: createSessionsForDate(parsed, dateKey()) })
        notify({ title: 'Backup imported', message: 'Your study data was restored.', variant: 'success' })
      } catch (err) {
        notify({
          title: 'Import failed',
          message: err instanceof Error ? err.message : 'The file could not be read.',
          variant: 'error'
        })
      }
    },
    [notify]
  )

  const value = useMemo<StudyContextValue>(
    () => ({
      state,
      today,
      toasts,
      notify,
      dismissToast,
      updateProfile,
      updateSettings,
      updateReminder,
      addSubject,
      updateSubject,
      deleteSubject,
      addChapter,
      updateChapter,
      deleteChapter,
      addTopic,
      updateTopic,
      deleteTopic,
      addSlot,
      duplicateSlot,
      updateSlot,
      deleteSlot,
      moveSlot,
      copyDaySchedule,
      replaceDaySchedule,
      ensureToday,
      startSession,
      pauseSession,
      resumeSession,
      toggleRevisionItem,
      setRevisionItem,
      skipRevision,
      completeSession,
      skipSession,
      snoozeSession,
      markReminded,
      applyReminderUpdates,
      simulateOverdue,
      reopenSession,
      logRevision,
      addMistake,
      setMistakeStatus,
      setMistakeCategory,
      reviewMistake,
      submitAttempt,
      appendAIMessage,
      clearAIMessages,
      registerLearning,
      recordCycleRevision,
      adoptExternalState,
      syncScheduleFromServer,
      discardScheduleDraft,
      resetDemoData,
      importData
    }),
    [
      state,
      today,
      toasts,
      notify,
      dismissToast,
      updateProfile,
      updateSettings,
      updateReminder,
      addSubject,
      updateSubject,
      deleteSubject,
      addChapter,
      updateChapter,
      deleteChapter,
      addTopic,
      updateTopic,
      deleteTopic,
      addSlot,
      duplicateSlot,
      updateSlot,
      deleteSlot,
      moveSlot,
      copyDaySchedule,
      replaceDaySchedule,
      ensureToday,
      startSession,
      pauseSession,
      resumeSession,
      toggleRevisionItem,
      setRevisionItem,
      skipRevision,
      completeSession,
      skipSession,
      snoozeSession,
      markReminded,
      applyReminderUpdates,
      simulateOverdue,
      reopenSession,
      logRevision,
      addMistake,
      setMistakeStatus,
      setMistakeCategory,
      reviewMistake,
      submitAttempt,
      appendAIMessage,
      clearAIMessages,
      registerLearning,
      recordCycleRevision,
      adoptExternalState,
      syncScheduleFromServer,
      discardScheduleDraft,
      resetDemoData,
      importData
    ]
  )

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>
}

export function useStudy(): StudyContextValue {
  const ctx = useContext(StudyContext)
  if (!ctx) throw new Error('useStudy must be used inside <StudyProvider>')
  return ctx
}

/** Re-render at a fixed cadence — used by timers and reminder checks. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export { topicById, chapterById, diffDays, epochFromIST, addDays, weekdayOf, nowMinutes }
