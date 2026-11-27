import { hash, verify, Algorithm } from '@node-rs/argon2'
import type { Request } from 'express'
import type { Types } from 'mongoose'
import { env } from '../../config/env.js'
import { AppError, conflict, forbidden, notFound, unauthorized, unprocessable } from '../../lib/errors.js'
import { RefreshSession, User } from '../../models/index.js'
import { consumeOtp, issueOtp, type OtpPurpose } from './otp.service.js'
import { createRefreshSession, revokeAllForUser, revokeFamily, signAccessToken } from './token.service.js'

/** OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). */
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }
export const hashPassword = (password: string) => hash(password, ARGON)

export interface PublicUser {
  id: string
  name: string
  phone: string | null
  phoneVerified: boolean
  /** Present only on accounts created before phone sign-up. */
  email: string | null
  emailVerified: boolean
  hasPassword: boolean
  role: string
  createdAt: string
}

export async function toPublicUser(userId: Types.ObjectId | string): Promise<PublicUser> {
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw notFound('User')
  return {
    id: String(user._id),
    name: user.name,
    phone: user.phone ?? null,
    phoneVerified: Boolean(user.phoneVerifiedAt),
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    hasPassword: Boolean(user.passwordHash),
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

/* ------------------------------------------------------------------ */
/* Phone + OTP                                                         */
/* ------------------------------------------------------------------ */

const phoneInUse = () => conflict('This number is already registered — please log in.', 'PHONE_IN_USE')

/**
 * Signup codes are only sent to unregistered numbers and login codes only to registered,
 * active ones. This intentionally reveals whether a number is registered (product decision);
 * the per-IP and per-number limits bound enumeration.
 */
export async function requestOtp(phone: string, purpose: OtpPurpose) {
  const user = await User.findOne({ phone }).select('status').lean()
  if (purpose === 'signup' && user) throw phoneInUse()
  if (purpose === 'login') {
    if (!user) throw new AppError(404, 'PHONE_NOT_REGISTERED', 'No account for this number — sign up first.')
    if (user.status !== 'active') throw forbidden('This account is disabled.', 'ACCOUNT_DISABLED')
  }
  return issueOtp(phone, purpose)
}

export async function register(input: { name: string; phone: string; otp: string }, req: Request) {
  if (await User.exists({ phone: input.phone })) throw phoneInUse()
  await consumeOtp(input.phone, 'signup', input.otp)
  let user
  try {
    user = await User.create({ name: input.name, phone: input.phone, phoneVerifiedAt: new Date(), termsAcceptedAt: new Date() })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw phoneInUse()
    throw err
  }
  return issueTokens(user, req)
}

export async function login(input: { phone: string; otp: string }, req: Request) {
  const user = await User.findOne({ phone: input.phone })
  if (!user) throw new AppError(404, 'PHONE_NOT_REGISTERED', 'No account for this number — sign up first.')
  if (user.status !== 'active') throw forbidden('This account is disabled.', 'ACCOUNT_DISABLED')
  await consumeOtp(input.phone, 'login', input.otp)
  if (!user.phoneVerifiedAt) await User.updateOne({ _id: user._id }, { $set: { phoneVerifiedAt: new Date() } })
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

export async function changePassword(userId: Types.ObjectId, currentFamily: string, current: string, next: string) {
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw notFound('User')
  if (!user.passwordHash) throw unprocessable('This account signs in with a one-time code and has no password.', 'NO_PASSWORD')
  const ok = await verify(user.passwordHash, current).catch(() => false)
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
