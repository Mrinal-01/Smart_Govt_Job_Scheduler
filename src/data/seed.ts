import type {
  Chapter,
  DailyLog,
  ID,
  MockAttempt,
  MockTest,
  Question,
  RevisionRecord,
  ScheduleSlot,
  SessionRecord,
  Settings,
  StudyState,
  Subject,
  Topic,
  Weekday
} from '../types'
import { CURRICULUM, type SeedChapter } from './curriculum'
import { QUESTION_BANK } from './questions'
import { addDays, dateKey, diffDays, epochFromIST, minutesFromTime, nowMinutes, weekdayOf } from '../lib/date'
import { clamp, hashString, prng, round } from '../lib/utils'

export const STATE_VERSION = 3
export const STORAGE_KEY = 'studyos.state.v3'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

export const subjectIdFor = (key: string) => `sub_${key}`
export const chapterIdFor = (subjectKey: string, chapterName: string) => `ch_${subjectKey}_${slug(chapterName)}`
export const topicIdFor = (subjectKey: string, chapterName: string, topicName: string) =>
  `tp_${subjectKey}_${slug(chapterName)}_${slug(topicName)}`

/* ------------------------------------------------------------------ */
/* Topic learning plan overrides — crafts a realistic mid-preparation  */
/* journey: mastered chapters, in-progress chapters, pending revisions. */
/* ------------------------------------------------------------------ */

interface TopicPlan {
  learnedDaysAgo?: number
  revisionCount?: number
  practice?: boolean
  pyq?: boolean
  confidence?: number
  accuracy?: number
  mistakes?: number
  notes?: string
}

const PLAN: Record<string, TopicPlan> = {
  /* ---------------- Mathematics ---------------- */
  'Number System::Divisibility Rules & Factors': { learnedDaysAgo: 26, revisionCount: 4, practice: true, pyq: true, confidence: 5, accuracy: 92, mistakes: 1 },
  'Number System::HCF and LCM': { learnedDaysAgo: 25, revisionCount: 4, practice: true, pyq: true, confidence: 4, accuracy: 85, mistakes: 2 },
  'Number System::Unit Digit & Remainder Theorem': { learnedDaysAgo: 22, revisionCount: 3, practice: true, pyq: true, confidence: 4, accuracy: 78, mistakes: 3 },
  'Simplification::BODMAS & Surds': { learnedDaysAgo: 16, revisionCount: 3, practice: true, confidence: 4, accuracy: 84 },
  'Simplification::Approximation Techniques': { learnedDaysAgo: 15, revisionCount: 2, practice: true, confidence: 3, accuracy: 71 },
  'Percentage::Basics of Percentage': { learnedDaysAgo: 9, revisionCount: 3, practice: true, pyq: true, confidence: 5, accuracy: 90 },
  'Percentage::Successive Percentage Change': { learnedDaysAgo: 2, revisionCount: 1, practice: true, confidence: 3, accuracy: 66, mistakes: 2 },
  'Profit & Loss::Cost Price, Selling Price & Profit': { learnedDaysAgo: 6, revisionCount: 1, practice: true, confidence: 4, accuracy: 80 },
  'Profit & Loss::Discount and Marked Price': { learnedDaysAgo: 4, revisionCount: 1, practice: true, confidence: 3, accuracy: 62, mistakes: 2 },
  'Ratio and Proportion::Basics of Ratio': { learnedDaysAgo: 1, revisionCount: 0, practice: true, confidence: 3, accuracy: 70, mistakes: 1 },

  /* ---------------- Physical Science ---------------- */
  'Motion & Force::Newton\'s Laws of Motion': { learnedDaysAgo: 12, revisionCount: 3, practice: true, pyq: true, confidence: 5, accuracy: 91 },
  'Motion & Force::Equations of Motion': { learnedDaysAgo: 10, revisionCount: 2, practice: true, confidence: 4, accuracy: 76, mistakes: 2 },
  'Work, Energy & Power::Work and Energy': { learnedDaysAgo: 8, revisionCount: 2, practice: true, confidence: 4, accuracy: 82 },
  'Work, Energy & Power::Power & Commercial Unit': { learnedDaysAgo: 7, revisionCount: 1, practice: true, confidence: 3, accuracy: 68, mistakes: 1 },
  'Light & Optics::Reflection & Mirrors': { learnedDaysAgo: 1, revisionCount: 0, practice: true, confidence: 3, accuracy: 65, mistakes: 2 },
  'Electricity & Magnetism::Ohm\'s Law & Resistance': { learnedDaysAgo: 18, revisionCount: 3, practice: true, pyq: true, confidence: 4, accuracy: 86 },
  'Electricity & Magnetism::Series & Parallel Circuits': { learnedDaysAgo: 17, revisionCount: 2, practice: true, confidence: 3, accuracy: 58, mistakes: 4 },
  'Matter & Its Nature::States of Matter': { learnedDaysAgo: 20, revisionCount: 3, practice: true, confidence: 4, accuracy: 83 },
  'Heat & Thermodynamics::Heat Transfer & Specific Heat': { learnedDaysAgo: 5, revisionCount: 1, practice: true, confidence: 3, accuracy: 72 },
  'Chemistry in Daily Life::Acids, Bases & Salts': { learnedDaysAgo: 3, revisionCount: 1, practice: true, confidence: 4, accuracy: 88 },

  /* ---------------- Reasoning ---------------- */
  'Series & Analogy::Number Series': { learnedDaysAgo: 14, revisionCount: 3, practice: true, pyq: true, confidence: 4, accuracy: 87 },
  'Series & Analogy::Letter & Symbol Series': { learnedDaysAgo: 13, revisionCount: 2, practice: true, confidence: 4, accuracy: 79 },
  'Series & Analogy::Analogy (Verbal & Number)': { learnedDaysAgo: 13, revisionCount: 2, practice: true, confidence: 5, accuracy: 93 },
  'Coding–Decoding::Letter Shift Coding': { learnedDaysAgo: 2, revisionCount: 1, practice: true, confidence: 4, accuracy: 82 },
  'Blood Relations::Family Tree Diagram Method': { learnedDaysAgo: 9, revisionCount: 2, practice: true, confidence: 4, accuracy: 77 },
  'Syllogism::Venn Diagram Method': { learnedDaysAgo: 5, revisionCount: 1, practice: true, confidence: 3, accuracy: 64, mistakes: 2 },
  'Seating Arrangement::Linear Arrangement': { learnedDaysAgo: 4, revisionCount: 1, practice: true, confidence: 3, accuracy: 61, mistakes: 3 },

  /* ---------------- Current Affairs ---------------- */
  'National Affairs::Government Schemes 2025': { learnedDaysAgo: 7, revisionCount: 2, practice: true, confidence: 4, accuracy: 86 },
  'National Affairs::Union Budget Highlights': { learnedDaysAgo: 1, revisionCount: 0, practice: true, confidence: 3, accuracy: 74 },
  'International Affairs::Summits & Organisations': { learnedDaysAgo: 6, revisionCount: 2, practice: true, confidence: 4, accuracy: 81 },
  'International Affairs::India in Global Indices': { learnedDaysAgo: 6, revisionCount: 1, practice: true, confidence: 3, accuracy: 67 },
  'Static GK — India::States, Capitals & Boundaries': { learnedDaysAgo: 19, revisionCount: 3, practice: true, pyq: true, confidence: 4, accuracy: 84 },
  'Static GK — India::National Parks & Rivers': { learnedDaysAgo: 18, revisionCount: 2, practice: true, confidence: 4, accuracy: 76 },
  'Sports & Awards::National & Civilian Awards': { learnedDaysAgo: 11, revisionCount: 2, practice: true, confidence: 4, accuracy: 89 }
}

const INTERVALS = [1, 3, 7, 15, 30]

function buildRevisionHistory(
  topicId: ID,
  learnedDate: string,
  count: number,
  random: () => number
): RevisionRecord[] {
  const out: RevisionRecord[] = []
  let cursor = learnedDate
  for (let i = 0; i < count; i += 1) {
    const type = i === 0 ? 'same-day' : i === 1 ? 'next-day' : i === 2 ? 'weekly' : 'monthly'
    cursor = addDays(cursor, i === 0 ? 0 : INTERVALS[Math.min(i, INTERVALS.length - 1)])
    out.push({
      id: `rev_${topicId}_${i}`,
      date: cursor,
      type,
      source: i === 0 ? 'session' : 'revision-center',
      accuracy: clamp(Math.round(55 + random() * 40), 40, 100),
      confidence: clamp(2 + Math.floor(random() * 4), 1, 5)
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Weekly schedule — multiple sessions per subject, Mon–Sat            */
/* ------------------------------------------------------------------ */

const WEEK_SESSIONS: Array<{
  subjectKey: 'math' | 'science' | 'reasoning' | 'current'
  label: string
  start: string
  end: string
  learning: string
  practice: number
}> = [
  { subjectKey: 'math', label: 'Morning Learning Session', start: '06:00', end: '07:30', learning: 'New chapter concept build-up + 20 solved examples', practice: 15 },
  { subjectKey: 'science', label: 'Learning Session', start: '08:00', end: '09:30', learning: 'Theory reading + formula notebook update', practice: 12 },
  { subjectKey: 'reasoning', label: 'Learning Session', start: '10:00', end: '11:15', learning: 'Concept + 2 practice sets', practice: 20 },
  { subjectKey: 'science', label: 'Second Session', start: '12:00', end: '13:00', learning: 'Numericals / PYQ set of the previous chapter', practice: 15 },
  { subjectKey: 'current', label: 'Learning Session', start: '14:00', end: '15:00', learning: 'Daily current affairs digest + notes', practice: 10 },
  { subjectKey: 'math', label: 'Second Session', start: '16:00', end: '17:15', learning: 'Practice set on the day’s topic', practice: 25 },
  { subjectKey: 'reasoning', label: 'Second Session', start: '17:30', end: '18:30', learning: 'Timed puzzle practice', practice: 20 },
  { subjectKey: 'current', label: 'Second Session', start: '19:30', end: '20:15', learning: 'Revision of week’s current affairs + quiz', practice: 15 }
]

const SUNDAY_SESSIONS = [
  { subjectKey: 'math' as const, label: 'Weekly Revision — Mathematics', start: '08:00', end: '10:00', learning: 'Revise all Mathematics topics studied this week', practice: 0, revision: true },
  { subjectKey: 'science' as const, label: 'Weekly Revision — Physical Science', start: '10:15', end: '12:00', learning: 'Revise all Science topics studied this week', practice: 0, revision: true },
  { subjectKey: 'reasoning' as const, label: 'Weekly Revision — Reasoning', start: '13:00', end: '14:30', learning: 'Revise all Reasoning topics studied this week', practice: 0, revision: true },
  { subjectKey: 'current' as const, label: 'Weekly Revision — Current Affairs', start: '15:00', end: '16:00', learning: 'Revise the week’s current affairs', practice: 0, revision: true },
  { subjectKey: 'math' as const, label: 'Weekly Mock Test', start: '17:00', end: '18:00', learning: 'Full weekly mock test across all four subjects', practice: 30, revision: false }
]

function buildSchedule(): ScheduleSlot[] {
  const slots: ScheduleSlot[] = []
  const sessionCounter: Record<string, number> = {}

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    if (weekday === 0) {
      SUNDAY_SESSIONS.forEach((s, index) => {
        const duration = minutesFromTime(s.end) - minutesFromTime(s.start)
        slots.push({
          id: `slot_sun_${index}`,
          weekday: 0 as Weekday,
          subjectId: subjectIdFor(s.subjectKey),
          sessionNumber: index + 1,
          label: s.label,
          startTime: s.start,
          endTime: s.end,
          durationMinutes: duration,
          requiresRevision: Boolean(s.revision),
          learningTarget: s.learning,
          practiceTarget: s.practice,
          reminderEnabled: true,
          breakAfterMinutes: index === 4 ? 0 : 15,
          order: index
        })
      })
      continue
    }

    WEEK_SESSIONS.forEach((s, index) => {
      const key = `${weekday}_${s.subjectKey}`
      sessionCounter[key] = (sessionCounter[key] ?? 0) + 1
      const duration = minutesFromTime(s.end) - minutesFromTime(s.start)
      slots.push({
        id: `slot_${weekday}_${index}`,
        weekday: weekday as Weekday,
        subjectId: subjectIdFor(s.subjectKey),
        sessionNumber: sessionCounter[key],
        label: s.label,
        startTime: s.start,
        endTime: s.end,
        durationMinutes: duration,
        requiresRevision: true,
        learningTarget: s.learning,
        practiceTarget: s.practice,
        reminderEnabled: true,
        breakAfterMinutes: 20,
        order: index
      })
    })
  }
  return slots
}

/* ------------------------------------------------------------------ */
/* State builder                                                       */
/* ------------------------------------------------------------------ */

export function buildSeedState(now = new Date()): StudyState {
  const today = dateKey(now)
  const random = prng(hashString(`studyos-${today}`))

  const subjects: Subject[] = CURRICULUM.map((s) => ({
    id: subjectIdFor(s.key),
    name: s.name,
    shortName: s.shortName,
    tone: s.tone,
    icon: s.icon,
    weeklyTargetMinutes: s.weeklyTargetMinutes,
    createdAt: addDays(today, -320)
  }))

  const chapters: Chapter[] = []
  const allTopics: Topic[] = []

  CURRICULUM.forEach((seedSubject) => {
    seedSubject.chapters.forEach((seedChapter, chapterIndex) => {
      const chapterId = chapterIdFor(seedSubject.key, seedChapter.name)
      const topics: Topic[] = seedChapter.topics.map((seedTopic, topicIndex) => {
        const topicId = topicIdFor(seedSubject.key, seedChapter.name, seedTopic.name)
        const plan = PLAN[`${seedChapter.name}::${seedTopic.name}`] ?? {}
        const learnedDate = plan.learnedDaysAgo === undefined ? null : addDays(today, -plan.learnedDaysAgo)
        const revisionCount = plan.revisionCount ?? 0
        const revisions = learnedDate ? buildRevisionHistory(topicId, learnedDate, revisionCount, random) : []
        const lastRevision = revisions.length ? revisions[revisions.length - 1].date : null

        let nextRevisionDue: string | null = null
        if (learnedDate) {
          const interval = INTERVALS[Math.min(revisions.length, INTERVALS.length - 1)]
          nextRevisionDue = addDays(lastRevision ?? learnedDate, interval)
        }

        const attempted = plan.practice ? 20 + Math.floor(random() * 40) : 0
        const accuracy = plan.accuracy ?? (plan.practice ? Math.round(60 + random() * 30) : 0)

        return {
          id: topicId,
          chapterId,
          subjectId: subjectIdFor(seedSubject.key),
          name: seedTopic.name,
          order: topicIndex,
          difficulty: seedTopic.difficulty ?? 'medium',
          estimatedMinutes: seedTopic.minutes ?? 45,
          keyPoints: seedTopic.points ?? ['Core concept overview', 'Exam-oriented shortcut'],
          formulas: seedTopic.formulas ?? [],
          initialLearningDate: learnedDate,
          learningCompleted: Boolean(learnedDate),
          practiceCompleted: Boolean(plan.practice),
          pyqCompleted: Boolean(plan.pyq),
          revisions,
          intervalIndex: revisions.length,
          nextRevisionDue,
          questionsAttempted: attempted,
          questionsCorrect: Math.round((attempted * accuracy) / 100),
          confidence: plan.confidence ?? (learnedDate ? 3 : 0),
          mistakeCount: plan.mistakes ?? 0,
          mockAccuracy: plan.practice ? accuracy : null,
          notes: plan.notes ?? ''
        }
      })

      const chapter: Chapter = {
        id: chapterId,
        subjectId: subjectIdFor(seedSubject.key),
        name: seedChapter.name,
        order: chapterIndex,
        weightage: seedChapter.weightage,
        topics
      }
      chapters.push(chapter)
      allTopics.push(...topics)
    })
  })

  /* ---- Today's sessions derived from the schedule and current time ---- */
  const schedule = buildSchedule()
  const todaySlots = schedule.filter((s) => s.weekday === weekdayOf(today)).sort((a, b) => a.order - b.order)
  const currentMinutes = nowMinutes(now)
  const sessions: Record<ID, SessionRecord> = {}

  const mathTopics = allTopics.filter((t) => t.subjectId === subjectIdFor('math') && t.initialLearningDate)
  const scienceTopics = allTopics.filter((t) => t.subjectId === subjectIdFor('science') && t.initialLearningDate)
  const reasoningTopics = allTopics.filter((t) => t.subjectId === subjectIdFor('reasoning') && t.initialLearningDate)
  const currentTopics = allTopics.filter((t) => t.subjectId === subjectIdFor('current') && t.initialLearningDate)
  const pickBySubject = (subjectId: ID) => {
    const pool =
      subjectId === subjectIdFor('math')
        ? mathTopics
        : subjectId === subjectIdFor('science')
          ? scienceTopics
          : subjectId === subjectIdFor('reasoning')
            ? reasoningTopics
            : currentTopics
    return pool[Math.floor(random() * pool.length)] ?? allTopics[0]
  }

  let activeAssigned = false

  todaySlots.forEach((slot) => {
    const key = `${slot.id}::${today}`
    const startMin = minutesFromTime(slot.startTime)
    const endMin = minutesFromTime(slot.endTime)
    const isPast = endMin < currentMinutes
    const isLive = startMin <= currentMinutes && currentMinutes < endMin

    let status: SessionRecord['status'] = 'upcoming'
    let completion: SessionRecord['completion'] = null
    let revisionMarked = false

    if (isPast) {
      status = 'completed'
      const topic = pickBySubject(slot.subjectId)
      const attempted = slot.practiceTarget || 10
      const correct = clamp(Math.round(attempted * (0.62 + random() * 0.3)), 0, attempted)
      revisionMarked = true
      completion = {
        chapterId: topic.chapterId,
        topicId: topic.id,
        topicName: topic.name,
        learningCompleted: true,
        revisionCompleted: true,
        practiceCompleted: Boolean(slot.practiceTarget),
        questionsAttempted: attempted,
        correctAnswers: correct,
        incorrectAnswers: attempted - correct,
        notes: `Completed ${slot.label.toLowerCase()} on ${topic.name}.`,
        confidence: 3 + Math.round(random()),
        durationMinutes: slot.durationMinutes,
        completedAt: new Date(epochFromIST(today, slot.endTime) + 60_000).toISOString(),
        chapterMastered: false
      }
    } else if (isLive && !activeAssigned) {
      status = 'in-progress'
      activeAssigned = true
      const elapsedMin = currentMinutes - startMin
      sessions[key] = {
        key,
        slotId: slot.id,
        date: today,
        subjectId: slot.subjectId,
        status,
        startedAt: new Date(epochFromIST(today, slot.startTime)).toISOString(),
        accumulatedSeconds: Math.max(30, elapsedMin * 60),
        runningSince: Date.now(),
        revisionMarked: true,
        revisionSkippedReason: null,
        revisionChecklist: [],
        completion: null,
        skipReason: null,
        snoozedUntil: null,
        remindedAt: null,
        graceUntil: null
      }
      return
    } else if (isLive) {
      status = 'revision-pending'
    }

    sessions[key] = {
      key,
      slotId: slot.id,
      date: today,
      subjectId: slot.subjectId,
      status,
      startedAt: isPast ? new Date(epochFromIST(today, slot.startTime)).toISOString() : null,
      accumulatedSeconds: isPast ? slot.durationMinutes * 60 : isLive ? (currentMinutes - startMin) * 60 : 0,
      runningSince: null,
      revisionMarked,
      revisionSkippedReason: null,
      revisionChecklist: [],
      completion,
      skipReason: null,
      snoozedUntil: null,
      remindedAt: null,
      graceUntil: null
    }
  })

  /* ---- Leave one earlier session un-updated so the accountability
     reminder system is demonstrable on first load (real state machine,
     not a mock overlay). ---- */
  const pastKeys = todaySlots
    .filter((slot) => minutesFromTime(slot.endTime) < currentMinutes)
    .map((slot) => `${slot.id}::${today}`)
  const missedKey = pastKeys[pastKeys.length - 1]
  if (missedKey && sessions[missedKey] && sessions[missedKey].status === 'completed') {
    sessions[missedKey] = {
      ...sessions[missedKey],
      status: 'awaiting-completion',
      completion: null,
      revisionChecklist: [],
      revisionMarked: true,
      remindedAt: null,
      graceUntil: new Date(
        epochFromIST(today, todaySlots.find((s2) => `${s2.id}::${today}` === missedKey)!.endTime) +
          10 * 60_000
      ).toISOString()
    } as SessionRecord
  }

  /* ---- 365 days of study history ---- */
  const logs: DailyLog[] = []
  for (let i = 364; i >= 1; i -= 1) {
    const date = addDays(today, -i)
    const wd = weekdayOf(date)
    const dayRandom = prng(hashString(`log-${date}`))
    const isSunday = wd === 0
    const planned = isSunday ? 300 : 450
    const skip = dayRandom() < 0.11
    const efficiency = skip ? 0 : 0.55 + dayRandom() * 0.45
    const actual = Math.round((planned * efficiency) / 5) * 5
    const sessionsPlanned = isSunday ? 5 : 8
    const sessionsCompleted = skip ? 0 : clamp(Math.round(sessionsPlanned * efficiency), 2, sessionsPlanned)
    const subjectMinutes: Record<ID, number> = {
      [subjectIdFor('math')]: Math.round(actual * 0.3),
      [subjectIdFor('science')]: Math.round(actual * 0.28),
      [subjectIdFor('reasoning')]: Math.round(actual * 0.24),
      [subjectIdFor('current')]: Math.round(actual * 0.18)
    }
    logs.push({
      date,
      plannedMinutes: planned,
      actualMinutes: actual,
      sessionsPlanned,
      sessionsCompleted,
      topicsCovered: skip ? 0 : Math.max(1, Math.round(sessionsCompleted * 0.7)),
      revisionsCompleted: skip ? 0 : Math.max(0, Math.round(sessionsCompleted * 0.55)),
      mockTests: isSunday && !skip && dayRandom() > 0.35 ? 1 : 0,
      accuracy: skip ? null : Math.round(58 + dayRandom() * 30),
      subjectMinutes,
      seed: true
    })
  }

  /* ---- Today's log, recomputed live by the store as well ---- */
  const todayCompleted = Object.values(sessions).filter((s) => s.status === 'completed')
  const todayActual = todayCompleted.reduce((acc, s) => acc + (s.completion?.durationMinutes ?? 0), 0)
  logs.push({
    date: today,
    plannedMinutes: todaySlots.reduce((acc, s) => acc + s.durationMinutes, 0),
    actualMinutes: todayActual,
    sessionsPlanned: todaySlots.length,
    sessionsCompleted: todayCompleted.length,
    topicsCovered: todayCompleted.length,
    revisionsCompleted: todayCompleted.filter((s) => s.completion?.revisionCompleted).length,
    mockTests: 0,
    accuracy: todayCompleted.length
      ? Math.round(
          (todayCompleted.reduce((acc, s) => acc + (s.completion?.correctAnswers ?? 0), 0) /
            Math.max(1, todayCompleted.reduce((acc, s) => acc + (s.completion?.questionsAttempted ?? 0), 0))) *
            100
        )
      : null,
    subjectMinutes: {
      [subjectIdFor('math')]: Math.round(todayActual * 0.32),
      [subjectIdFor('science')]: Math.round(todayActual * 0.3),
      [subjectIdFor('reasoning')]: Math.round(todayActual * 0.22),
      [subjectIdFor('current')]: Math.round(todayActual * 0.16)
    },
    seed: true
  })

  /* ---- Question bank & mock tests ---- */
  const questions: Question[] = QUESTION_BANK.map((q) => {
    const chapterId = chapterIdFor(q.subjectKey, q.chapter)
    return {
      id: q.id,
      subjectId: subjectIdFor(q.subjectKey),
      chapterId,
      topicId: topicIdFor(q.subjectKey, q.chapter, q.topic),
      text: q.text,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      difficulty: q.difficulty,
      origin: q.origin ?? 'demo-bank'
    }
  })

  const bySubject = (key: string) => questions.filter((q) => q.subjectId === subjectIdFor(key)).map((q) => q.id)
  const mockTests: MockTest[] = ([
    {
      id: 'mock_weekly_all',
      title: 'Weekly Full-Length Mock',
      type: 'weekly',
      subjectId: 'mixed',
      chapterId: null,
      questionIds: questions.map((q) => q.id),
      durationMinutes: 30,
      createdAt: addDays(today, -7),
      description: 'All four subjects, mixed difficulty. Designed for the Sunday weekly assessment.'
    },
    {
      id: 'mock_math_pl',
      title: 'Mathematics — Profit & Loss',
      type: 'chapter',
      subjectId: subjectIdFor('math'),
      chapterId: chapterIdFor('math', 'Profit & Loss'),
      questionIds: ['q_math_pl_1', 'q_math_pl_2', 'q_math_pct_1', 'q_math_rp_1', 'q_math_avg_1'],
      durationMinutes: 10,
      createdAt: addDays(today, -5),
      description: 'Chapter-wise test focused on Profit & Loss and supporting arithmetic.'
    },
    {
      id: 'mock_science_electricity',
      title: 'Physical Science — Electricity',
      type: 'chapter',
      subjectId: subjectIdFor('science'),
      chapterId: chapterIdFor('science', 'Electricity & Magnetism'),
      questionIds: ['q_sci_elec_1', 'q_sci_elec_2', 'q_sci_nlm_1', 'q_sci_wep_1', 'q_sci_heat_1'],
      durationMinutes: 10,
      createdAt: addDays(today, -3),
      description: 'Numerical-heavy test on circuits, work-energy and heat.'
    },
    {
      id: 'mock_reasoning_mix',
      title: 'Reasoning — Mixed Practice',
      type: 'chapter',
      subjectId: subjectIdFor('reasoning'),
      chapterId: null,
      questionIds: bySubject('reasoning'),
      durationMinutes: 12,
      createdAt: addDays(today, -2),
      description: 'Mixed reasoning set covering series, coding and arrangements.'
    }
  ] as MockTest[]).filter((m) => m.questionIds.length > 0)

  /* ---- Seeded past attempts ---- */
  const attempts: MockAttempt[] = []
  const attemptSeed: Array<{ mockId: string; daysAgo: number; accuracy: number; used: number }> = [
    { mockId: 'mock_weekly_all', daysAgo: 7, accuracy: 0.72, used: 1500 },
    { mockId: 'mock_math_pl', daysAgo: 5, accuracy: 0.6, used: 540 },
    { mockId: 'mock_science_electricity', daysAgo: 3, accuracy: 0.8, used: 505 },
    { mockId: 'mock_reasoning_mix', daysAgo: 2, accuracy: 0.67, used: 650 },
    { mockId: 'mock_weekly_all', daysAgo: 14, accuracy: 0.62, used: 1620 },
    { mockId: 'mock_weekly_all', daysAgo: 21, accuracy: 0.55, used: 1710 }
  ]

  attemptSeed.forEach((seed, index) => {
    const mock = mockTests.find((m) => m.id === seed.mockId)
    if (!mock) return
    const attemptRandom = prng(hashString(`${seed.mockId}-${seed.daysAgo}`))
    const answers: Record<ID, number | null> = {}
    const topicMap = new Map<string, { topicName: string; chapterName: string; correct: number; total: number }>()
    let correct = 0
    let incorrect = 0
    let unattempted = 0

    mock.questionIds.forEach((qid) => {
      const q = questions.find((x) => x.id === qid)!
      const chapter = chapters.find((c) => c.id === q.chapterId)
      const topic = allTopics.find((t) => t.id === q.topicId)
      const roll = attemptRandom()
      let isCorrect = false
      if (roll < 0.06) {
        answers[qid] = null
        unattempted += 1
      } else if (roll < seed.accuracy) {
        answers[qid] = q.correctIndex
        correct += 1
        isCorrect = true
      } else {
        answers[qid] = (q.correctIndex + 1 + Math.floor(attemptRandom() * 3)) % q.options.length
        incorrect += 1
      }
      const tkey = q.topicId
      const entry = topicMap.get(tkey) ?? {
        topicName: topic?.name ?? 'Topic',
        chapterName: chapter?.name ?? 'Chapter',
        correct: 0,
        total: 0
      }
      entry.total += 1
      if (isCorrect) entry.correct += 1
      topicMap.set(tkey, entry)
    })

    const attemptedCount = correct + incorrect
    attempts.push({
      id: `att_seed_${index}`,
      mockId: mock.id,
      title: mock.title,
      subjectId: mock.subjectId,
      startedAt: new Date(epochFromIST(addDays(today, -seed.daysAgo), '17:00')).toISOString(),
      submittedAt: new Date(epochFromIST(addDays(today, -seed.daysAgo), '17:00') + seed.used * 1000).toISOString(),
      durationUsedSeconds: seed.used,
      totalQuestions: mock.questionIds.length,
      correct,
      incorrect,
      unattempted,
      accuracy: attemptedCount ? Math.round((correct / attemptedCount) * 100) : 0,
      marks: correct * 1 - incorrect * 0.33,
      maxMarks: mock.questionIds.length,
      subjectBreakdown: ['math', 'science', 'reasoning', 'current']
        .map((key) => {
          const sid = subjectIdFor(key)
          const qs = mock.questionIds.map((id) => questions.find((q) => q.id === id)!).filter((q) => q.subjectId === sid)
          const c = qs.filter((q) => answers[q.id] === q.correctIndex).length
          return { subjectId: sid, correct: c, total: qs.length }
        })
        .filter((s) => s.total > 0),
      topicBreakdown: Array.from(topicMap.entries()).map(([topicId, v]) => ({
        topicId,
        topicName: v.topicName,
        chapterName: v.chapterName,
        correct: v.correct,
        total: v.total,
        accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0
      })),
      answers,
      markedForReview: [],
      seeded: true
    })
  })

  /* ---- Seeded mistakes from those attempts ---- */
  const mistakes = [] as StudyState['mistakes']
  attempts.slice(0, 4).forEach((attempt, aIndex) => {
    Object.entries(attempt.answers).forEach(([qid, ans], idx) => {
      const q = questions.find((x) => x.id === qid)
      if (!q || ans === null || ans === q.correctIndex) return
      if (idx % 2 !== 0) return
      const chapter = chapters.find((c) => c.id === q.chapterId)
      const topic = allTopics.find((t) => t.id === q.topicId)
      mistakes.push({
        id: `mis_seed_${aIndex}_${idx}`,
        subjectId: q.subjectId,
        chapterId: q.chapterId,
        topicId: q.topicId,
        question: q.text,
        options: q.options,
        userAnswerIndex: ans,
        correctAnswerIndex: q.correctIndex,
        explanation: q.explanation,
        category: (['conceptual', 'calculation', 'formula-forgotten', 'misread', 'guessing'] as const)[idx % 5],
        date: attempt.submittedAt.slice(0, 10),
        status: idx % 3 === 0 ? 'unresolved' : idx % 3 === 1 ? 'reviewed' : 'resolved',
        source: 'mock-test',
        mockAttemptId: attempt.id,
        reviewCount: idx % 3,
        lastReviewedAt: null
      })
      void chapter
      void topic
    })
  })

  const settings: Settings = {
    theme: 'light',
    timezone: 'Asia/Kolkata',
    examTarget: 'RRB Group D 2026',
    dailyTargetMinutes: 450,
    weeklyTargetMinutes: 2700,
    revisionIntervals: INTERVALS,
    reminder: {
      enabled: true,
      graceMinutes: 10,
      repeatMinutes: 5,
      sound: 'chime',
      volume: 0.55,
      browserNotifications: false,
      quietMode: false,
      notifySessionEnd: true,
      notifyRevisionDue: true,
      notifyDailySummary: true
    },
    autoSuggestMistakes: true,
    confirmBeforeSkip: true,
    compactSidebar: false
  }

  return {
    version: STATE_VERSION,
    profile: {
      name: 'Ananya Sharma',
      email: 'ananya.prep@gmail.com',
      targetExam: 'RRB Group D 2026',
      examDate: addDays(today, 64),
      joinedAt: addDays(today, -320)
    },
    settings,
    subjects,
    chapters,
    schedule,
    sessions,
    logs,
    mistakes,
    questions,
    mockTests,
    attempts,
    aiMessages: [],
    seededAt: new Date().toISOString()
  }
}

/* ------------------------------------------------------------------ */
/* Rolling state forward when the calendar day changes                 */
/* ------------------------------------------------------------------ */

export function createSessionsForDate(state: StudyState, date: string): Record<ID, SessionRecord> {
  const slots = state.schedule.filter((s) => s.weekday === weekdayOf(date)).sort((a, b) => a.order - b.order)
  const out: Record<ID, SessionRecord> = { ...state.sessions }
  slots.forEach((slot) => {
    const key = `${slot.id}::${date}`
    if (out[key]) return
    out[key] = {
      key,
      slotId: slot.id,
      date,
      subjectId: slot.subjectId,
      status: 'upcoming',
      startedAt: null,
      accumulatedSeconds: 0,
      runningSince: null,
      revisionMarked: false,
      revisionSkippedReason: null,
      revisionChecklist: [],
      completion: null,
      skipReason: null,
      snoozedUntil: null,
      remindedAt: null,
      graceUntil: null
    }
  })
  return out
}

export function summarizeDay(
  state: StudyState,
  date: string
): {
  plannedMinutes: number
  actualMinutes: number
  sessionsPlanned: number
  sessionsCompleted: number
  topicsCovered: number
  revisionsCompleted: number
  subjectMinutes: Record<ID, number>
  accuracy: number | null
} {
  const slots = state.schedule.filter((s) => s.weekday === weekdayOf(date))
  const records = Object.values(state.sessions).filter((s) => s.date === date)
  const completed = records.filter((s) => s.status === 'completed')
  const actual = completed.reduce((acc, s) => acc + (s.completion?.durationMinutes ?? 0), 0)
  const subjectMinutes: Record<ID, number> = {}
  completed.forEach((s) => {
    subjectMinutes[s.subjectId] = (subjectMinutes[s.subjectId] ?? 0) + (s.completion?.durationMinutes ?? 0)
  })
  const attempted = completed.reduce((acc, s) => acc + (s.completion?.questionsAttempted ?? 0), 0)
  const correct = completed.reduce((acc, s) => acc + (s.completion?.correctAnswers ?? 0), 0)

  return {
    plannedMinutes: slots.reduce((acc, s) => acc + s.durationMinutes, 0),
    actualMinutes: actual,
    sessionsPlanned: slots.length,
    sessionsCompleted: completed.length,
    topicsCovered: new Set(completed.map((s) => s.completion?.topicId).filter(Boolean)).size,
    revisionsCompleted: completed.filter((s) => s.completion?.revisionCompleted).length,
    subjectMinutes,
    accuracy: attempted ? round((correct / attempted) * 100) : null
  }
}

export { diffDays }
