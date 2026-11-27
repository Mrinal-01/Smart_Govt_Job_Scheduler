import mongoose, { Schema } from 'mongoose'

/** A student's own reminder sound. At most MAX_CUSTOM_SOUNDS per user (enforced in sounds.routes). */
const customSoundSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    format: { type: String, enum: ['mp3', 'wav', 'ogg', 'm4a', 'webm'], required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    /** Private storage key — never sent to the client. */
    storageKey: { type: String, required: true }
  },
  { timestamps: true }
)
customSoundSchema.index({ userId: 1, createdAt: 1 })
export const CustomSound = mongoose.model('CustomSound', customSoundSchema)
