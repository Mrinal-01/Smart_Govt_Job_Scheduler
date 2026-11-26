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
      revisionMandatory: { type: Boolean, default: true }
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
