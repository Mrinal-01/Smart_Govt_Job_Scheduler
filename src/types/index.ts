/* ============================================================
   StudyOS — Core domain types
   These interfaces intentionally mirror the proposed MongoDB
   documents (see docs/API_CONTRACT.md) so the mock service layer
   can be replaced by a real Node/Express API without UI changes.
   ============================================================ */

export type ID = string
export type ISODate = string // YYYY-MM-DD
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // 0 = Sunday

export type Difficulty = 'easy' | 'medium' | 'hard'

export type ChapterStatus =
  | 'not-started'
  | 'learning'
  | 'learning-completed'
  | 'revision-in-progress'
  | 'mastered'

export type RevisionType = 'same-day' | 'next-day' | 'weekly' | 'monthly' | 'practice' | 'manual'

export type RevisionSource = 'session' | 'revision-center' | 'sunday-review' | 'mistake-practice'

export interface RevisionRecord {
  id: ID
  date: ISODate
  type: RevisionType
  source: RevisionSource
  accuracy?: number | null
  confidence?: number | null
  notes?: string
}

export interface Topic {
  id: ID
  chapterId: ID
  subjectId: ID
  name: string
  order: number
  difficulty: Difficulty
  estimatedMinutes: number
  keyPoints: string[]
  formulas: string[]
  /* learning */
  initialLearningDate: ISODate | null
  learningCompleted: boolean
  practiceCompleted: boolean
  pyqCompleted: boolean
  /* revision */
  revisions: RevisionRecord[]
  intervalIndex: number
  nextRevisionDue: ISODate | null
  /* performance */
  questionsAttempted: number
  questionsCorrect: number
  confidence: number // 0-5
  mistakeCount: number
  mockAccuracy: number | null
  notes: string
}

export interface Chapter {
  id: ID
  subjectId: ID
  name: string
  order: number
  weightage: number // expected marks share
  topics: Topic[]
}

export interface Subject {
  id: ID
  name: string
  shortName: string
  tone: SubjectTone
  icon: SubjectIcon
  weeklyTargetMinutes: number
  createdAt: ISODate
}

export type SubjectTone = 'math' | 'science' | 'reasoning' | 'current' | 'custom'
export type SubjectIcon = 'calculator' | 'flask' | 'brain' | 'newspaper' | 'book'

/* ---------------- Schedule ---------------- */

export interface ScheduleSlot {
  id: ID
  weekday: Weekday
  subjectId: ID
  sessionNumber: number
  label: string // "Morning Learning Session"
  startTime: string // HH:mm (IST)
  endTime: string // HH:mm (IST)
  durationMinutes: number
  requiresRevision: boolean
  learningTarget: string
  practiceTarget: number // questions
  reminderEnabled: boolean
  breakAfterMinutes: number
  order: number
}

export type SessionStatus =
  | 'upcoming'
  | 'in-progress'
  | 'revision-pending'
  | 'awaiting-completion'
  | 'overdue'
  | 'completed'
  | 'skipped'

export interface SessionCompletion {
  chapterId: ID
  topicId: ID
  topicName: string
  learningCompleted: boolean
  revisionCompleted: boolean
  practiceCompleted: boolean
  questionsAttempted: number
  correctAnswers: number
  incorrectAnswers: number
  notes: string
  confidence: number // 1-5
  durationMinutes: number
  completedAt: string // ISO timestamp
  chapterMastered: boolean
  /** Previously-learned topics that were revised during this session. */
  revisedTopicIds?: ID[]
}

/** Runtime state for one scheduled slot on one calendar date. */
export interface SessionRecord {
  key: ID // `${slotId}::${date}`
  slotId: ID
  date: ISODate
  subjectId: ID
  status: SessionStatus
  startedAt: string | null // ISO timestamp
  accumulatedSeconds: number
  runningSince: number | null // epoch ms while the timer runs
  revisionMarked: boolean
  revisionSkippedReason: string | null
  revisionChecklist: ID[] // ids of revision items ticked
  completion: SessionCompletion | null
  skipReason: string | null
  snoozedUntil: string | null // ISO timestamp
  remindedAt: string | null
  graceUntil: string | null
}

/* ---------------- Study logs & analytics ---------------- */

export interface DailyLog {
  date: ISODate
  plannedMinutes: number
  actualMinutes: number
  sessionsPlanned: number
  sessionsCompleted: number
  topicsCovered: number
  revisionsCompleted: number
  mockTests: number
  accuracy: number | null
  subjectMinutes: Record<ID, number>
  seed: boolean // true = generated history, false = produced by real interactions
}

/* ---------------- Mistakes ---------------- */

export type MistakeCategory =
  | 'conceptual'
  | 'calculation'
  | 'formula-forgotten'
  | 'misread'
  | 'guessing'
  | 'time-management'

export type MistakeStatus = 'unresolved' | 'reviewed' | 'resolved'

export interface Mistake {
  id: ID
  subjectId: ID
  chapterId: ID
  topicId: ID
  question: string
  options: string[]
  userAnswerIndex: number | null
  correctAnswerIndex: number
  explanation: string
  category: MistakeCategory
  date: ISODate
  status: MistakeStatus
  source: 'mock-test' | 'practice' | 'manual'
  mockAttemptId?: ID
  reviewCount: number
  lastReviewedAt?: string | null
}

/* ---------------- Mock tests ---------------- */

export interface Question {
  id: ID
  subjectId: ID
  chapterId: ID
  topicId: ID
  text: string
  options: string[]
  correctIndex: number
  explanation: string
  difficulty: Difficulty
  origin: 'demo-bank' | 'ai-generated' | 'unofficial-pyq'
}

export interface MockTest {
  id: ID
  title: string
  type: 'weekly' | 'chapter' | 'full-length'
  subjectId: ID | 'mixed'
  chapterId?: ID | null
  questionIds: ID[]
  durationMinutes: number
  createdAt: ISODate
  description: string
}

export interface TopicScore {
  topicId: ID
  topicName: string
  chapterName: string
  correct: number
  total: number
  accuracy: number
}

export interface MockAttempt {
  id: ID
  mockId: ID
  title: string
  subjectId: ID | 'mixed'
  startedAt: string
  submittedAt: string
  durationUsedSeconds: number
  totalQuestions: number
  correct: number
  incorrect: number
  unattempted: number
  accuracy: number
  marks: number
  maxMarks: number
  subjectBreakdown: { subjectId: ID; correct: number; total: number }[]
  topicBreakdown: TopicScore[]
  answers: Record<ID, number | null>
  markedForReview: ID[]
  seeded: boolean
}

/* ---------------- Settings & profile ---------------- */

export type SoundChoice = 'chime' | 'bell' | 'pulse' | 'none'
export type ThemeChoice = 'light' | 'dark' | 'system'

export interface ReminderSettings {
  enabled: boolean
  graceMinutes: number
  repeatMinutes: number
  sound: SoundChoice
  volume: number
  browserNotifications: boolean
  quietMode: boolean
  notifySessionEnd: boolean
  notifyRevisionDue: boolean
  notifyDailySummary: boolean
}

export interface Settings {
  theme: ThemeChoice
  timezone: string
  examTarget: string
  dailyTargetMinutes: number
  weeklyTargetMinutes: number
  revisionIntervals: number[]
  reminder: ReminderSettings
  autoSuggestMistakes: boolean
  confirmBeforeSkip: boolean
  compactSidebar: boolean
}

export interface Profile {
  name: string
  email: string
  targetExam: string
  examDate: ISODate | null
  joinedAt: ISODate
}

/* ---------------- AI assistant ---------------- */

export type AIMode = 'assistant' | 'quiz' | 'weak-topics' | 'smart-revision' | 'weekly-report'

export interface AIMessage {
  id: ID
  role: 'user' | 'assistant'
  mode: AIMode
  content: string
  createdAt: string
  demo: boolean
  suggestions?: string[]
}

/* ---------------- Root state ---------------- */

export interface StudyState {
  version: number
  profile: Profile
  settings: Settings
  subjects: Subject[]
  chapters: Chapter[]
  schedule: ScheduleSlot[]
  sessions: Record<ID, SessionRecord>
  logs: DailyLog[]
  mistakes: Mistake[]
  questions: Question[]
  mockTests: MockTest[]
  attempts: MockAttempt[]
  aiMessages: AIMessage[]
  seededAt: string
}

export interface Toast {
  id: ID
  title: string
  message?: string
  variant: 'success' | 'error' | 'info' | 'warning'
}
