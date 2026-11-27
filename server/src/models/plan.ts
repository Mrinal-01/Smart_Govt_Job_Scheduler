import mongoose, { Schema } from 'mongoose'

/*
 * Study-plan engine collections (server-authoritative).
 *
 *   StudySession        one scheduled slot on one calendar date, materialized from the
 *                       ScheduleVersion that governs that date. Its slot snapshot never
 *                       changes after creation, so later schedule versions cannot rewrite it.
 *   RevisionObligation  a required revision of previously *completed* learning
 *                       (same_day | next_day | weekly), tracked independently.
 *   RevisionAttempt     the immutable completion record of one obligation.
 *   GateOverride        an audited emergency bypass of a revision/prerequisite gate.
 *
 * See docs/API_DOCUMENTATION.md (Schedule & study plan) for the state machine and consistency strategy.
 */

export const SESSION_TYPES = ['learning', 'revision', 'practice', 'mock_test'] as const
export const REVISION_POLICIES = ['previous_cycle', 'all_previous_cycles', 'none'] as const
export const OBLIGATION_TYPES = ['same_day', 'next_day', 'weekly'] as const

const topicRefSchema = new Schema(
  {
    topicId: { type: String, required: true },
    topicName: { type: String, required: true },
    chapterId: { type: String, required: true },
    chapterName: { type: String, required: true }
  },
  { _id: false }
)

/* ------------------------------------------------------------------ */
/* StudySession                                                        */
/* ------------------------------------------------------------------ */

const completedTopicSchema = new Schema(
  {
    topicId: { type: String, required: true },
    topicName: { type: String, required: true },
    chapterId: { type: String, required: true },
    chapterName: { type: String, required: true },
    /** Only `completed` topics ever become revision obligations. */
    completion: { type: String, enum: ['completed', 'partial'], required: true }
  },
  { _id: false }
)

const studySessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD in the student's time zone
    slotId: { type: String, required: true },
    scheduleVersion: { type: Number, required: true },
    /* ---- slot snapshot (frozen at materialization) ---- */
    subjectId: { type: String, required: true },
    subjectName: { type: String, required: true },
    chapterId: { type: String, default: null },
    chapterName: { type: String, default: null },
    plannedTopics: { type: [topicRefSchema], default: [] },
    sessionType: { type: String, enum: SESSION_TYPES, default: 'learning' },
    cycleNumber: { type: Number, default: null },
    sessionNumber: { type: Number, default: 1 },
    label: { type: String, default: '' },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    plannedMinutes: { type: Number, required: true },
    learningTarget: { type: String, default: '' },
    practiceTarget: { type: Number, default: 0 },
    revisionMinutes: { type: Number, default: 15 },
    revisionPolicy: { type: String, enum: REVISION_POLICIES, default: 'previous_cycle' },
    prerequisiteSlotIds: { type: [String], default: [] },
    order: { type: Number, default: 0 },
    /* ---- runtime ---- */
    status: { type: String, enum: ['scheduled', 'in_progress', 'completed', 'skipped', 'missed'], default: 'scheduled' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    /** Server-measured, capped by elapsed time. Never trusted from the client alone. */
    actualMinutes: { type: Number, default: 0 },
    completion: {
      topics: { type: [completedTopicSchema], default: [] },
      questionsAttempted: { type: Number, default: 0 },
      questionsCorrect: { type: Number, default: 0 },
      confidence: { type: Number, default: null },
      notes: { type: String, default: '' }
    },
    skipReason: { type: String, default: null },
    overrideId: { type: Schema.Types.ObjectId, ref: 'GateOverride', default: null },
    rescheduledFrom: { type: { startTime: String, endTime: String, at: Date, _id: false }, default: null }
  },
  { timestamps: true }
)
studySessionSchema.index({ userId: 1, date: 1, slotId: 1 }, { unique: true })
studySessionSchema.index({ userId: 1, status: 1, date: 1 })
studySessionSchema.index({ userId: 1, sessionType: 1, status: 1, date: 1 })

/**
 * Completed historical sessions are immutable: every update query is narrowed to
 * documents that are not yet completed, so no code path can rewrite one.
 */
studySessionSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function () {
  this.and([{ status: { $ne: 'completed' } }])
})
studySessionSchema.pre(['replaceOne', 'findOneAndReplace'], function () {
  throw new Error('StudySession documents cannot be replaced')
})

export const StudySession = mongoose.model('StudySession', studySessionSchema)

/* ------------------------------------------------------------------ */
/* RevisionObligation                                                  */
/* ------------------------------------------------------------------ */

const revisionObligationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: OBLIGATION_TYPES, required: true },
    subjectId: { type: String, required: true },
    subjectName: { type: String, required: true },
    topics: { type: [topicRefSchema], default: [] },
    /** Learning sessions whose completed topics produced this obligation. */
    sourceSessionIds: { type: [Schema.Types.ObjectId], ref: 'StudySession', default: [] },
    sourceDate: { type: String, required: true },
    sourceCycleNumber: { type: Number, default: null },
    /** Start time of the source session — same-day gates apply to later sessions of the subject. */
    sourceStartTime: { type: String, default: null },
    /** Same-day only: the dependent learning session this revision unlocks. */
    targetSessionId: { type: Schema.Types.ObjectId, ref: 'StudySession', default: null },
    /** The study day this revision is due (YYYY-MM-DD, student time zone). */
    dueDate: { type: String, required: true },
    weekStart: { type: String, default: null },
    plannedMinutes: { type: Number, default: 15 },
    practiceRequired: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    result: {
      topicsRevised: { type: [String], default: [] },
      questionsAttempted: { type: Number, default: 0 },
      questionsCorrect: { type: Number, default: 0 },
      questionsWrong: { type: Number, default: 0 },
      confidence: { type: Number, default: null },
      notes: { type: String, default: '' },
      actualMinutes: { type: Number, default: 0 }
    },
    /** Emergency overrides that bypassed this obligation. Bypassed ≠ completed: status stays pending. */
    bypassedBy: { type: [Schema.Types.ObjectId], ref: 'GateOverride', default: [] },
    /** `same_day:<sourceSessionId>` · `next_day:<sourceDate>:<subjectId>` · `weekly:<weekStart>:<subjectId>` */
    dedupeKey: { type: String, required: true }
  },
  { timestamps: true }
)
revisionObligationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true })
revisionObligationSchema.index({ userId: 1, type: 1, status: 1, dueDate: 1 })
revisionObligationSchema.index({ userId: 1, subjectId: 1, type: 1, dueDate: 1 })
export const RevisionObligation = mongoose.model('RevisionObligation', revisionObligationSchema)

/* ------------------------------------------------------------------ */
/* RevisionAttempt — immutable                                         */
/* ------------------------------------------------------------------ */

const revisionAttemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    obligationId: { type: Schema.Types.ObjectId, ref: 'RevisionObligation', required: true },
    type: { type: String, enum: OBLIGATION_TYPES, required: true },
    subjectId: { type: String, required: true },
    dueDate: { type: String, required: true },
    completedDate: { type: String, required: true },
    topicsRevised: { type: [String], default: [] },
    questionsAttempted: { type: Number, default: 0 },
    questionsCorrect: { type: Number, default: 0 },
    questionsWrong: { type: Number, default: 0 },
    confidence: { type: Number, required: true },
    notes: { type: String, default: '' },
    plannedMinutes: { type: Number, default: 0 },
    actualMinutes: { type: Number, default: 0 },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true }
  },
  { timestamps: true }
)
/** One completion record per obligation — duplicate completion requests cannot create a second one. */
revisionAttemptSchema.index({ obligationId: 1 }, { unique: true })
revisionAttemptSchema.index({ userId: 1, completedDate: -1 })

const immutable = (what: string) =>
  function () {
    throw new Error(`${what} documents are immutable`)
  }
revisionAttemptSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], immutable('RevisionAttempt'))
export const RevisionAttempt = mongoose.model('RevisionAttempt', revisionAttemptSchema)

/* ------------------------------------------------------------------ */
/* GateOverride — immutable audit log of emergency bypasses            */
/* ------------------------------------------------------------------ */

const gateOverrideSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'StudySession', required: true },
    sessionDate: { type: String, required: true },
    subjectId: { type: String, required: true },
    subjectName: { type: String, required: true },
    reason: { type: String, required: true, minlength: 10, maxlength: 1000 },
    /** The derived session state and lock reasons at the moment of the override. */
    originalState: { type: String, required: true },
    lockReasons: { type: [{ kind: String, message: String, obligationId: String, sessionId: String, _id: false }], default: [] },
    obligationIds: { type: [Schema.Types.ObjectId], ref: 'RevisionObligation', default: [] },
    prerequisiteSessionIds: { type: [Schema.Types.ObjectId], ref: 'StudySession', default: [] },
    decision: { type: String, enum: ['bypassed'], default: 'bypassed' }
  },
  { timestamps: true }
)
gateOverrideSchema.index({ userId: 1, createdAt: -1 })
gateOverrideSchema.index({ sessionId: 1 })
gateOverrideSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], immutable('GateOverride'))
gateOverrideSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('GateOverride documents are immutable'))
  next()
})
export const GateOverride = mongoose.model('GateOverride', gateOverrideSchema)
