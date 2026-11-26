import mongoose, { Schema } from 'mongoose'

/* ------------------------------------------------------------------ */
/* StudyCycle — one pass over the student's cycle subjects             */
/* ------------------------------------------------------------------ */

const studyCycleSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD in the user's time zone
    cycleNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['active', 'completed', 'incomplete'], default: 'active' },
    subjectIds: { type: [String], default: [] },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
    endedReason: { type: String, default: null }
  },
  { timestamps: true }
)
studyCycleSchema.index({ userId: 1, date: 1, cycleNumber: 1 }, { unique: true })
/** At most one active cycle per user (enforced by the database, not just code). */
studyCycleSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_cycle' })
export const StudyCycle = mongoose.model('StudyCycle', studyCycleSchema)

/* ------------------------------------------------------------------ */
/* CycleSubjectBlock — revision phase → learning phase for one subject */
/* ------------------------------------------------------------------ */

const blockSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cycleId: { type: Schema.Types.ObjectId, ref: 'StudyCycle', required: true },
    date: { type: String, required: true },
    subjectId: { type: String, required: true },
    subjectName: { type: String, required: true },
    order: { type: Number, required: true },
    status: {
      type: String,
      // pending → revision (if tasks) → ready → learning → completed | skipped | incomplete
      enum: ['pending', 'revision', 'ready', 'learning', 'completed', 'skipped', 'incomplete'],
      default: 'pending'
    },
    revision: {
      required: { type: Boolean, default: false },
      plannedMinutes: { type: Number, default: 0 },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      /** Server-measured (completedAt - startedAt). Never client supplied. */
      actualSeconds: { type: Number, default: 0 },
      skippedReason: { type: String, default: null }
    },
    learning: {
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      minutes: { type: Number, default: 0 }
    },
    skipReason: { type: String, default: null }
  },
  { timestamps: true }
)
blockSchema.index({ cycleId: 1, subjectId: 1 }, { unique: true })
blockSchema.index({ userId: 1, date: 1 })
export const CycleSubjectBlock = mongoose.model('CycleSubjectBlock', blockSchema)

/* ------------------------------------------------------------------ */
/* StudyLog — what was actually learnt (topic-level)                   */
/* ------------------------------------------------------------------ */

const studyLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cycleId: { type: Schema.Types.ObjectId, ref: 'StudyCycle', default: null },
    blockId: { type: Schema.Types.ObjectId, ref: 'CycleSubjectBlock', default: null },
    cycleNumber: { type: Number, default: null },
    date: { type: String, required: true },
    subjectId: { type: String, required: true },
    subjectName: { type: String, required: true },
    chapterId: { type: String, required: true },
    chapterName: { type: String, required: true },
    topicId: { type: String, required: true },
    topicName: { type: String, required: true },
    /** Partial topics are never eligible for revision until completed. */
    completion: { type: String, enum: ['completed', 'partial'], required: true },
    minutes: { type: Number, default: 0, min: 0 },
    confidence: { type: Number, default: null, min: 1, max: 5 },
    notes: { type: String, default: '', maxlength: 2000 }
  },
  { timestamps: true }
)
studyLogSchema.index({ userId: 1, date: 1 })
studyLogSchema.index({ userId: 1, topicId: 1, createdAt: -1 })
export const StudyLog = mongoose.model('StudyLog', studyLogSchema)

/* ------------------------------------------------------------------ */
/* RevisionTask — one topic owed one revision                          */
/* ------------------------------------------------------------------ */

const revisionTaskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** 'cycle' = same-day, revise-before-next-learning. Spaced intervals stay in the workspace revision engine. */
    kind: { type: String, enum: ['cycle'], default: 'cycle' },
    date: { type: String, required: true },
    subjectId: { type: String, required: true },
    subjectName: { type: String, required: true },
    chapterId: { type: String, required: true },
    chapterName: { type: String, required: true },
    topicId: { type: String, required: true },
    topicName: { type: String, required: true },
    sourceStudyLogId: { type: Schema.Types.ObjectId, ref: 'StudyLog', required: true },
    sourceCycleId: { type: Schema.Types.ObjectId, ref: 'StudyCycle', default: null },
    sourceCycleNumber: { type: Number, default: null },
    targetCycleId: { type: Schema.Types.ObjectId, ref: 'StudyCycle', default: null },
    targetBlockId: { type: Schema.Types.ObjectId, ref: 'CycleSubjectBlock', default: null },
    status: { type: String, enum: ['pending', 'deferred', 'completed', 'skipped'], default: 'pending' },
    completedAt: { type: Date, default: null },
    actualSeconds: { type: Number, default: 0 },
    outcome: { type: String, enum: ['recalled', 'partial', 'forgot', null], default: null },
    questionsAttempted: { type: Number, default: 0 },
    questionsCorrect: { type: Number, default: 0 },
    accuracy: { type: Number, default: null },
    skipReason: { type: String, default: null },
    /** `${kind}:${date}:${topicId}` — one cycle revision per topic per day. */
    dedupeKey: { type: String, required: true }
  },
  { timestamps: true }
)
revisionTaskSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true })
revisionTaskSchema.index({ userId: 1, status: 1, date: 1 })
revisionTaskSchema.index({ targetBlockId: 1 })
export const RevisionTask = mongoose.model('RevisionTask', revisionTaskSchema)

/* ------------------------------------------------------------------ */
/* RevisionLog — immutable completion events                           */
/* ------------------------------------------------------------------ */

const revisionLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'RevisionTask', required: true },
    cycleId: { type: Schema.Types.ObjectId, ref: 'StudyCycle', default: null },
    topicId: { type: String, required: true },
    subjectId: { type: String, required: true },
    kind: { type: String, required: true },
    date: { type: String, required: true },
    event: { type: String, enum: ['completed', 'skipped'], required: true },
    actualSeconds: { type: Number, default: 0 },
    outcome: { type: String, default: null },
    accuracy: { type: Number, default: null },
    reason: { type: String, default: null }
  },
  { timestamps: true }
)
revisionLogSchema.index({ userId: 1, date: 1 })
revisionLogSchema.index({ taskId: 1 }, { unique: true })
export const RevisionLog = mongoose.model('RevisionLog', revisionLogSchema)
