import mongoose, { Schema } from 'mongoose'

/** One row per AI call. Never stores prompts or responses — only metadata for cost control. */
const aiUsageLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    feature: { type: String, required: true },
    provider: { type: String, required: true },
    model: { type: String, default: '' },
    status: { type: String, enum: ['success', 'error'], required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    errorCode: { type: String, default: null }
  },
  { timestamps: true }
)
aiUsageLogSchema.index({ userId: 1, date: 1 })
export const AIUsageLog = mongoose.model('AIUsageLog', aiUsageLogSchema)
