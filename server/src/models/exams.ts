import mongoose, { Schema } from 'mongoose'

export const MOCK_TYPES = ['full_mixed', 'sectional', 'subject_full', 'chapter', 'topic', 'practice'] as const

const mockTestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** 'template' = reusable configuration with no frozen questions. */
    kind: { type: String, enum: ['test', 'template'], default: 'test' },
    name: { type: String, required: true, maxlength: 120 },
    type: { type: String, enum: MOCK_TYPES, required: true },
    config: {
      subjectIds: { type: [String], default: [] },
      chapterIds: { type: [String], default: [] },
      topicIds: { type: [String], default: [] },
      distribution: { type: [{ subjectId: String, count: Number, _id: false }], default: [] },
      questionCount: { type: Number, required: true, min: 1, max: 300 },
      durationMinutes: { type: Number, required: true, min: 1, max: 600 },
      marksPerQuestion: { type: Number, default: 1, min: 0 },
      negativeMarks: { type: Number, default: 0, min: 0 },
      selectionMethod: { type: String, enum: ['random', 'difficulty', 'topic'], default: 'random' },
      difficultyDistribution: {
        easy: { type: Number, default: 0 },
        medium: { type: Number, default: 0 },
        hard: { type: Number, default: 0 }
      },
      avoidRecentDays: { type: Number, default: 0, min: 0, max: 365 },
      shuffleQuestions: { type: Boolean, default: true },
      shuffleOptions: { type: Boolean, default: false },
      instructions: { type: String, default: '', maxlength: 4000 }
    },
    questionIds: { type: [Schema.Types.ObjectId], ref: 'Question', default: [] },
    seed: { type: Number, default: 0 },
    templateId: { type: Schema.Types.ObjectId, ref: 'MockTest', default: null },
    sourceAttemptId: { type: Schema.Types.ObjectId, ref: 'MockTestAttempt', default: null },
    archivedAt: { type: Date, default: null }
  },
  { timestamps: true }
)
mockTestSchema.index({ userId: 1, kind: 1, createdAt: -1 })
export const MockTest = mongoose.model('MockTest', mockTestSchema)

/* ------------------------------------------------------------------ */

const snapshotSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    order: { type: Number, required: true },
    questionText: { type: String, required: true },
    questionType: { type: String, required: true },
    options: { type: [{ label: String, text: String, _id: false }], default: [] },
    correctAnswer: { type: [String], default: null },
    answerVerified: { type: Boolean, default: false },
    explanation: { type: String, default: null },
    subjectId: String,
    subjectName: String,
    chapterId: String,
    chapterName: String,
    topicId: String,
    topicName: String,
    difficulty: String,
    source: { documentId: Schema.Types.ObjectId, pageNumber: Number, questionNumber: String }
  },
  { _id: false }
)

const attemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mockTestId: { type: Schema.Types.ObjectId, ref: 'MockTest', required: true },
    testName: { type: String, required: true },
    testType: { type: String, required: true },
    status: { type: String, enum: ['in_progress', 'submitted', 'auto_submitted'], default: 'in_progress' },
    /** Server clock is authoritative for both. */
    startedAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true },
    durationSeconds: { type: Number, required: true },
    submittedAt: { type: Date, default: null },
    submissionType: { type: String, enum: ['manual', 'timeout', null], default: null },
    /** Questions frozen at start — later edits in the bank do not change a running or finished attempt. */
    questions: { type: [snapshotSchema], default: [] },
    marksPerQuestion: { type: Number, default: 1 },
    negativeMarks: { type: Number, default: 0 },
    instructions: { type: String, default: '' },
    lastSavedAt: { type: Date, default: null },
    result: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true, minimize: false }
)
attemptSchema.index({ userId: 1, createdAt: -1 })
attemptSchema.index({ status: 1, deadlineAt: 1 })
/** Only one running attempt per test per user. */
attemptSchema.index(
  { userId: 1, mockTestId: 1 },
  { unique: true, partialFilterExpression: { status: 'in_progress' }, name: 'one_running_attempt_per_test' }
)
export const MockTestAttempt = mongoose.model('MockTestAttempt', attemptSchema)

/* ------------------------------------------------------------------ */

const answerSchema = new Schema(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: 'MockTestAttempt', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    questionId: { type: Schema.Types.ObjectId, required: true },
    selected: { type: [String], default: [] },
    markedForReview: { type: Boolean, default: false },
    visited: { type: Boolean, default: true },
    timeSpentSeconds: { type: Number, default: 0 }
  },
  { timestamps: true }
)
answerSchema.index({ attemptId: 1, questionId: 1 }, { unique: true })
export const MockTestAnswer = mongoose.model('MockTestAnswer', answerSchema)

/* ------------------------------------------------------------------ */
/* ExamMistake — Mistake Bank entries from verified exam answers       */
/* ------------------------------------------------------------------ */

const examMistakeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    lastAttemptId: { type: Schema.Types.ObjectId, ref: 'MockTestAttempt', default: null },
    questionText: { type: String, required: true },
    options: { type: [{ label: String, text: String, _id: false }], default: [] },
    selected: { type: [String], default: [] },
    correctAnswer: { type: [String], default: [] },
    explanation: { type: String, default: null },
    subjectId: String,
    subjectName: String,
    chapterId: String,
    chapterName: String,
    topicId: String,
    topicName: String,
    category: {
      type: String,
      enum: ['conceptual', 'calculation', 'formula-forgotten', 'misread', 'guessing', 'time-management'],
      default: 'conceptual'
    },
    status: { type: String, enum: ['unresolved', 'reviewed', 'resolved'], default: 'unresolved' },
    occurrences: { type: Number, default: 1 },
    reviewCount: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: () => new Date() },
    source: { type: String, enum: ['auto', 'manual'], default: 'auto' }
  },
  { timestamps: true }
)
examMistakeSchema.index({ userId: 1, questionId: 1 }, { unique: true })
examMistakeSchema.index({ userId: 1, status: 1 })
export const ExamMistake = mongoose.model('ExamMistake', examMistakeSchema)
