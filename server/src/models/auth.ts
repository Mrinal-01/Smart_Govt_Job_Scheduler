import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* ------------------------------------------------------------------ */
/* User                                                                */
/* ------------------------------------------------------------------ */

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** Optional since phone sign-up. Stored normalized (trimmed + lower-cased) when present. */
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    /** E.164 (e.g. +919876543210). The sign-in identifier for phone/OTP accounts. */
    phone: { type: String, trim: true, maxlength: 16 },
    phoneVerifiedAt: { type: Date, default: null },
    passwordHash: { type: String, select: false, default: null },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    termsAcceptedAt: { type: Date, required: true },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    /** Bumped on "log out everywhere" and password change — invalidates access tokens immediately. */
    tokenVersion: { type: Number, default: 0 },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
)
// Unique only when present, so phone-only accounts (no email) and email-only legacy accounts coexist.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } }, name: 'email_unique_when_present' })
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } }, name: 'phone_unique_when_present' })

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>
export const User = mongoose.model('User', userSchema)

/* ------------------------------------------------------------------ */
/* Refresh sessions — opaque tokens, stored hashed, rotated on use     */
/* ------------------------------------------------------------------ */

const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** All rotations of one login share a family; reuse of a rotated token revokes the family. */
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: '', maxlength: 400 },
    ip: { type: String, default: '' },
    lastUsedAt: { type: Date, default: () => new Date() }
  },
  { timestamps: true }
)
refreshSessionSchema.index({ tokenHash: 1 }, { unique: true })
refreshSessionSchema.index({ userId: 1, revokedAt: 1 })
refreshSessionSchema.index({ familyId: 1 })
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export const RefreshSession = mongoose.model('RefreshSession', refreshSessionSchema)

/* ------------------------------------------------------------------ */
/* One-time tokens                                                     */
/* ------------------------------------------------------------------ */

function oneTimeTokenSchema() {
  const schema = new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      tokenHash: { type: String, required: true },
      expiresAt: { type: Date, required: true },
      usedAt: { type: Date, default: null }
    },
    { timestamps: true }
  )
  schema.index({ tokenHash: 1 }, { unique: true })
  schema.index({ userId: 1 })
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  return schema
}

export const EmailVerificationToken = mongoose.model('EmailVerificationToken', oneTimeTokenSchema())
export const PasswordResetToken = mongoose.model('PasswordResetToken', oneTimeTokenSchema())

/* ------------------------------------------------------------------ */
/* Phone OTP — one active code per (phone, purpose)                    */
/* ------------------------------------------------------------------ */

const phoneOtpSchema = new Schema(
  {
    phone: { type: String, required: true },
    purpose: { type: String, enum: ['signup', 'login'], required: true },
    /** HMAC-SHA256(OTP_SECRET, phone:purpose:code). The code itself is never stored. Null once invalidated. */
    codeHash: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: null },
    /** Rolling send window for the per-number hourly cap. */
    windowStart: { type: Date, required: true },
    sendCount: { type: Number, default: 0 },
    /** Document removal time (TTL): after both the code and the send window have expired. */
    purgeAt: { type: Date, required: true }
  },
  { timestamps: true }
)
phoneOtpSchema.index({ phone: 1, purpose: 1 }, { unique: true })
phoneOtpSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 })
export const PhoneOtp = mongoose.model('PhoneOtp', phoneOtpSchema)
