import mongoose, { Schema } from 'mongoose'

/* ------------------------------------------------------------------ */
/* StudyWorkspace — the pre-existing client StudyState, now persisted  */
/* per user on the server with optimistic concurrency.                 */
/* ------------------------------------------------------------------ */

const workspaceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Monotonic write counter used for optimistic concurrency (409 on stale writes). */
    revision: { type: Number, default: 1 },
    schemaVersion: { type: Number, required: true },
    origin: { type: String, enum: ['import', 'demo', 'fresh'], required: true },
    data: { type: Schema.Types.Mixed, required: true },
    sizeBytes: { type: Number, default: 0 }
  },
  { timestamps: true, minimize: false }
)
workspaceSchema.index({ userId: 1 }, { unique: true })
export const StudyWorkspace = mongoose.model('StudyWorkspace', workspaceSchema)

/* ------------------------------------------------------------------ */
/* UserSettings — server-enforced preferences                          */
/* ------------------------------------------------------------------ */

const userSettingsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    timezone: { type: String, default: 'Asia/Kolkata' },
    cycle: {
      /** Ordered subject ids that make up one study cycle. Empty = all workspace subjects. */
      subjectIds: { type: [String], default: [] },
      defaultRevisionMinutes: { type: Number, default: 10, min: 0, max: 180 },
      /** Per-subject override of the revision block length (minutes). */
      revisionMinutesBySubject: { type: Map, of: Number, default: {} },
      revisionMinutesPerTopic: { type: Number, default: 3, min: 1, max: 60 },
      maxTopicsPerRevisionBlock: { type: Number, default: 5, min: 1, max: 50 },
      revisionMandatory: { type: Boolean, default: true },
      /** Cycle configuration used by the schedule's cycle generator. */
      cyclesPerDay: { type: Number, default: 2, min: 1, max: 8 },
      sessionMinutes: { type: Number, default: 60, min: 10, max: 300 },
      breakMinutes: { type: Number, default: 10, min: 0, max: 120 }
    },
    /** Scheduled-session revision gates (modules/plan). */
    plan: {
      sameDayRevisionMinutes: { type: Number, default: 15, min: 1, max: 180 },
      nextDayRevisionEnabled: { type: Boolean, default: true },
      nextDayRevisionMinutes: { type: Number, default: 15, min: 1, max: 180 },
      /**
       * per_subject: each subject's carryover revision runs right before that subject's first
       * learning session and gates only that subject. all_subjects: the whole carryover block
       * must be finished before any learning starts.
       */
      carryoverScope: { type: String, enum: ['per_subject', 'all_subjects'], default: 'per_subject' },
      weeklyRevisionMinutes: { type: Number, default: 30, min: 1, max: 300 },
      /** 0 = Sunday. The day the weekly revision obligations fall due. */
      weeklyReviewWeekday: { type: Number, default: 0, min: 0, max: 6 },
      /** Weekdays with no study (rest days). Next-day revision falls due on the next study day. */
      restWeekdays: { type: [Number], default: [] },
      /** Specific YYYY-MM-DD dates with no study (holidays). */
      holidays: { type: [String], default: [] },
      /** When true, completing a same-day / next-day revision needs at least one practice question. */
      requirePracticeInRevision: { type: Boolean, default: false }
    },
    ai: {
      enabled: { type: Boolean, default: true }
    },
    exams: {
      autoAddMistakes: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
)
userSettingsSchema.index({ userId: 1 }, { unique: true })
export const UserSettings = mongoose.model('UserSettings', userSettingsSchema)

/* ------------------------------------------------------------------ */
/* Notification — in-app notices (processing finished, policy events)  */
/* ------------------------------------------------------------------ */

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true, maxlength: 160 },
    message: { type: String, default: '', maxlength: 1000 },
    link: { type: String, default: null },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
)
notificationSchema.index({ userId: 1, createdAt: -1 })
export const Notification = mongoose.model('Notification', notificationSchema)
