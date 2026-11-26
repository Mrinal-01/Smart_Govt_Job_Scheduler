import mongoose, { Schema } from 'mongoose'

const scheduleSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    currentVersion: { type: Number, default: 0 },
    latestVersionId: { type: Schema.Types.ObjectId, ref: 'ScheduleVersion', default: null }
  },
  { timestamps: true }
)
scheduleSchema.index({ userId: 1 }, { unique: true })
export const Schedule = mongoose.model('Schedule', scheduleSchema)

const slotSchema = new Schema(
  {
    id: { type: String, required: true },
    weekday: { type: Number, min: 0, max: 6, required: true },
    subjectId: { type: String, required: true },
    sessionNumber: { type: Number, default: 1 },
    label: { type: String, default: '' },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    requiresRevision: { type: Boolean, default: false },
    learningTarget: { type: String, default: '' },
    practiceTarget: { type: Number, default: 0 },
    reminderEnabled: { type: Boolean, default: true },
    breakAfterMinutes: { type: Number, default: 0 },
    order: { type: Number, default: 0 }
  },
  { _id: false }
)

/**
 * Immutable published schedule version. Never updated after insert — a change
 * is always a new version, so history can be audited.
 */
const scheduleVersionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scheduleId: { type: Schema.Types.ObjectId, ref: 'Schedule', required: true },
    version: { type: Number, required: true },
    previousVersion: { type: Number, default: null },
    slots: { type: [slotSchema], default: [] },
    changes: {
      added: { type: [String], default: [] },
      removed: { type: [String], default: [] },
      modified: { type: [{ slotId: String, fields: [String] }], default: [] },
      summary: { type: [String], default: [] }
    },
    changedFields: { type: [String], default: [] },
    changeReason: { type: String, default: '' },
    publishedAt: { type: Date, default: () => new Date() },
    effectiveFrom: { type: String, required: true },
    /** Baseline (first) publishes are free; later publishes count against the rolling limit. */
    countsTowardLimit: { type: Boolean, default: true },
    override: { type: Boolean, default: false },
    overrideReason: { type: String, default: null }
  },
  { timestamps: true }
)
scheduleVersionSchema.index({ scheduleId: 1, version: 1 }, { unique: true })
scheduleVersionSchema.index({ userId: 1, publishedAt: -1 })

const immutable = function () {
  throw new Error('ScheduleVersion documents are immutable')
}
scheduleVersionSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], immutable)
scheduleVersionSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('ScheduleVersion documents are immutable'))
  next()
})

export const ScheduleVersion = mongoose.model('ScheduleVersion', scheduleVersionSchema)
