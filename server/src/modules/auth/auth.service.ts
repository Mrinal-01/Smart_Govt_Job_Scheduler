import { hash, verify, Algorithm } from '@node-rs/argon2'
import type { Request } from 'express'
import type { Types } from 'mongoose'
import { env } from '../../config/env.js'
import { randomToken, sha256 } from '../../lib/crypto.js'
import { AppError, conflict, forbidden, notFound, unauthorized, unprocessable } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { EmailVerificationToken, PasswordResetToken, RefreshSession, User } from '../../models/index.js'
import { sendPasswordResetEmail, sendSecurityNotice, sendVerificationEmail } from '../../integrations/mail.js'
import { createRefreshSession, revokeAllForUser, revokeFamily, signAccessToken } from './token.service.js'

/** OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). */
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }
const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15
const VERIFY_TTL_MS = 24 * 3600_000
const RESET_TTL_MS = 3600_000

let dummyHash: string | null = null
async function burnPasswordCheck(password: string) {
  dummyHash ??= await hash('timing-equalizer-password-1', ARGON)
  await verify(dummyHash, password).catch(() => false)
}

export const hashPassword = (password: string) => hash(password, ARGON)

export interface PublicUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: string
  createdAt: string
}

export async function toPublicUser(userId: Types.ObjectId | string): Promise<PublicUser> {
  const user = await User.findById(userId)
  if (!user) throw notFound('User')
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    createdAt: user.createdAt.toISOString()
  }
}

async function issueTokens(user: { _id: Types.ObjectId; tokenVersion: number; role: string }, req: Request) {
  const { token, session } = await createRefreshSession(user._id, req)
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } })
  return {
    accessToken: signAccessToken(user, session.familyId),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: token,
    user: await toPublicUser(user._id)
  }
}

async function createVerification(userId: Types.ObjectId) {
  await EmailVerificationToken.deleteMany({ userId, usedAt: null })
  const token = randomToken(32)
  await EmailVerificationToken.create({ userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) })
  return token
}

/* ------------------------------------------------------------------ */

export async function register(input: { name: string; email: string; password: string }) {
  if (await User.exists({ email: input.email })) {
    throw conflict('An account with this email already exists. Sign in or reset your password.', 'EMAIL_IN_USE')
  }
  let user
  try {
    user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      termsAcceptedAt: new Date(),
      emailVerified: !env.REQUIRE_EMAIL_VERIFICATION
    })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('An account with this email already exists.', 'EMAIL_IN_USE')
    throw err
  }
  if (env.REQUIRE_EMAIL_VERIFICATION) {
    const token = await createVerification(user._id)
    await sendVerificationEmail(user.email, user.name, token)
  }
  return { user: await toPublicUser(user._id), verificationRequired: env.REQUIRE_EMAIL_VERIFICATION }
}

export async function verifyEmail(token: string) {
  const record = await EmailVerificationToken.findOneAndUpdate(
    { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } }
  )
  if (!record) throw unprocessable('This verification link is invalid or has expired. Request a new one.', 'VERIFY_TOKEN_INVALID')
  await User.updateOne({ _id: record.userId }, { $set: { emailVerified: true, emailVerifiedAt: new Date() } })
  return toPublicUser(record.userId)
}

/** Always resolves the same way so the endpoint does not reveal whether an email is registered. */
export async function resendVerification(email: string) {
  const user = await User.findOne({ email })
  if (!user || user.emailVerified) return
  const token = await createVerification(user._id)
  await sendVerificationEmail(user.email, user.name, token)
}

export async function login(input: { email: string; password: string }, req: Request) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash')
  if (!user || !user.passwordHash) {
    await burnPasswordCheck(input.password)
    throw unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS')
  }
  if (user.status !== 'active') throw forbidden('This account is disabled.', 'ACCOUNT_DISABLED')
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}.`, {
      lockedUntil: user.lockedUntil.toISOString()
    })
  }
  const ok = await verify(user.passwordHash, input.password).catch(() => false)
  if (!ok) {
    const failed = user.failedLoginCount + 1
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null
    await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock } })
    throw unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS')
  }
  if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    throw forbidden('Please verify your email before signing in. Check your inbox or request a new link.', 'EMAIL_NOT_VERIFIED')
  }
  return issueTokens(user, req)
}

export async function refreshUserTokens(userId: Types.ObjectId, familyId: string) {
  const user = await User.findById(userId)
  if (!user || user.status !== 'active') {
    await revokeFamily(familyId, 'user_unavailable')
    throw unauthorized('Account not available', 'ACCOUNT_UNAVAILABLE')
  }
  return { accessToken: signAccessToken(user, familyId), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, user: await toPublicUser(user._id) }
}

export async function forgotPassword(email: string) {
  const user = await User.findOne({ email })
  if (!user || user.status !== 'active') return
  await PasswordResetToken.deleteMany({ userId: user._id, usedAt: null })
  const token = randomToken(32)
  await PasswordResetToken.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) })
  await sendPasswordResetEmail(user.email, user.name, token)
}

export async function resetPassword(token: string, password: string) {
  const record = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } }
  )
  if (!record) throw unprocessable('This reset link is invalid or has expired. Request a new one.', 'RESET_TOKEN_INVALID')
  const user = await User.findById(record.userId)
  if (!user) throw unprocessable('This reset link is invalid.', 'RESET_TOKEN_INVALID')
  // Proving inbox control also verifies the email address.
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: await hashPassword(password), emailVerified: true, emailVerifiedAt: user.emailVerifiedAt ?? new Date(), failedLoginCount: 0, lockedUntil: null },
      $inc: { tokenVersion: 1 }
    }
  )
  await revokeAllForUser(user._id, 'password_reset')
  await sendSecurityNotice(user.email, user.name, 'Your StudyOS password was reset and all devices were signed out.').catch((err) =>
    logger.warn({ err }, 'security notice failed')
  )
}

export async function changePassword(userId: Types.ObjectId, currentFamily: string, current: string, next: string) {
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw notFound('User')
  const ok = user.passwordHash ? await verify(user.passwordHash, current).catch(() => false) : false
  if (!ok) throw unauthorized('Current password is incorrect.', 'INVALID_CREDENTIALS')
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(next) }, $inc: { tokenVersion: 1 } })
  await revokeAllForUser(user._id, 'password_changed', currentFamily)
  const fresh = await User.findById(userId)
  return { accessToken: signAccessToken(fresh!, currentFamily), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS }
}

export async function logoutAll(userId: Types.ObjectId) {
  await revokeAllForUser(userId, 'logout_all')
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } })
}

export async function listSessions(userId: Types.ObjectId, currentFamily: string) {
  const sessions = await RefreshSession.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean()
  return sessions.map((s) => ({
    id: s.familyId,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.expiresAt,
    current: s.familyId === currentFamily
  }))
}

export async function revokeSession(userId: Types.ObjectId, familyId: string) {
  const owned = await RefreshSession.exists({ userId, familyId })
  if (!owned) throw notFound('Session')
  await revokeFamily(familyId, 'revoked_by_user')
}

export async function updateProfile(userId: Types.ObjectId, name: string) {
  await User.updateOne({ _id: userId }, { $set: { name } })
  return toPublicUser(userId)
}
