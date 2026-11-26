import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* ------------------------------------------------------------------ */
/* User                                                                */
/* ------------------------------------------------------------------ */

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** Always stored normalized (trimmed + lower-cased). */
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
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
userSchema.index({ email: 1 }, { unique: true })

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>
export const User = mongoose.model('User', userSchema)

/* ------------------------------------------------------------------ */
/* External identity links (Google)                                    */
/* ------------------------------------------------------------------ */

const authAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['google'], required: true },
    providerUserId: { type: String, required: true },
    email: { type: String, default: null },
    emailVerified: { type: Boolean, default: false },
    linkedAt: { type: Date, default: () => new Date() }
  },
  { timestamps: true }
)
authAccountSchema.index({ provider: 1, providerUserId: 1 }, { unique: true })
authAccountSchema.index({ userId: 1, provider: 1 }, { unique: true })
export const AuthAccount = mongoose.model('AuthAccount', authAccountSchema)

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
    lastUsedAt: { type: Date, default: () => new Date() },
    authMethod: { type: String, enum: ['password', 'google'], default: 'password' }
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
