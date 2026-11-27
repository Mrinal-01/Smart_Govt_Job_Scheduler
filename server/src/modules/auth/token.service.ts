import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { Types } from 'mongoose'
import { env } from '../../config/env.js'
import { randomToken, sha256 } from '../../lib/crypto.js'
import { AppError, unauthorized } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { RefreshSession } from '../../models/index.js'

export const REFRESH_COOKIE = 'studyos_rt'
const ISSUER = 'studyos'
const AUDIENCE = 'studyos-api'
/** Parallel tabs may refresh with the same cookie; a just-rotated token gets a short grace window. */
const ROTATION_GRACE_MS = 15_000

export interface AccessClaims {
  sub: string
  tv: number
  role: string
  sid: string
}

export function signAccessToken(user: { _id: Types.ObjectId | string; tokenVersion: number; role: string }, sessionFamilyId: string) {
  const claims: AccessClaims = { sub: String(user._id), tv: user.tokenVersion, role: user.role, sid: sessionFamilyId }
  return jwt.sign(claims, env.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE
  })
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE }) as AccessClaims
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw unauthorized('Access token expired', 'TOKEN_EXPIRED')
    throw unauthorized('Invalid access token', 'TOKEN_INVALID')
  }
}

const clientMeta = (req: Request) => ({
  userAgent: (req.get('user-agent') ?? '').slice(0, 400),
  ip: req.ip ?? ''
})

export async function createRefreshSession(
  userId: Types.ObjectId,
  req: Request,
  familyId: string = crypto.randomUUID()
) {
  const token = randomToken(48)
  const session = await RefreshSession.create({
    userId,
    familyId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    ...clientMeta(req)
  })
  return { token, session }
}

/**
 * Rotates a refresh token. Presenting an already-rotated token outside the
 * grace window is treated as theft: the whole session family is revoked.
 */
export async function rotateRefreshToken(token: string, req: Request) {
  const tokenHash = sha256(token)
  const now = new Date()
  const current = await RefreshSession.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, revokedReason: 'rotated', lastUsedAt: now } },
    { new: false }
  )
  if (!current) {
    const existing = await RefreshSession.findOne({ tokenHash })
    if (!existing) throw unauthorized('Session not found. Please sign in again.', 'REFRESH_INVALID')
    if (existing.expiresAt <= now) throw unauthorized('Session expired. Please sign in again.', 'REFRESH_EXPIRED')
    if (existing.revokedReason === 'rotated' && existing.revokedAt && now.getTime() - existing.revokedAt.getTime() < ROTATION_GRACE_MS) {
      throw new AppError(409, 'REFRESH_RACE', 'Session was just refreshed in another tab. Retry.')
    }
    if (existing.revokedReason === 'rotated') {
      await revokeFamily(existing.familyId, 'reuse_detected')
      logger.warn({ userId: String(existing.userId) }, 'Refresh token reuse detected — session family revoked')
      throw unauthorized('Session ended for security reasons. Please sign in again.', 'REFRESH_REUSED')
    }
    throw unauthorized('Session ended. Please sign in again.', 'REFRESH_REVOKED')
  }
  const next = await createRefreshSession(current.userId, req, current.familyId)
  await RefreshSession.updateOne({ _id: current._id }, { $set: { replacedByHash: next.session.tokenHash } })
  return { userId: current.userId, familyId: current.familyId, ...next }
}

export async function revokeFamily(familyId: string, reason: string) {
  await RefreshSession.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } })
}

export async function revokeAllForUser(userId: Types.ObjectId | string, reason: string, exceptFamilyId?: string) {
  const filter: Record<string, unknown> = { userId, revokedAt: null }
  if (exceptFamilyId) filter.familyId = { $ne: exceptFamilyId }
  await RefreshSession.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } })
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000
  })
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.cookieSecure, sameSite: env.COOKIE_SAMESITE, path: '/api/auth' })
}
