import type { Request, Response } from 'express'
import { asyncHandler, unauthorized } from '../../lib/errors.js'
import { parse } from '../../lib/validate.js'
import { authOf } from '../../middleware/auth.js'
import * as auth from './auth.service.js'
import { REFRESH_COOKIE, clearRefreshCookie, revokeFamily, rotateRefreshToken, setRefreshCookie } from './token.service.js'
import { sha256 } from '../../lib/crypto.js'
import { RefreshSession } from '../../models/index.js'
import * as v from './auth.validators.js'

function sendSession(res: Response, result: { accessToken: string; expiresIn: number; refreshToken: string; user: auth.PublicUser }, status = 200) {
  setRefreshCookie(res, result.refreshToken)
  res.status(status).json({ accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user })
}

export const requestOtp = asyncHandler(async (req, res) => {
  const input = parse(v.otpRequestSchema, req.body)
  res.json({ phone: input.phone, ...(await auth.requestOtp(input.phone, input.purpose)) })
})

export const register = asyncHandler(async (req, res) => {
  const input = parse(v.registerSchema, req.body)
  sendSession(res, await auth.register(input, req), 201)
})

export const login = asyncHandler(async (req, res) => {
  const input = parse(v.loginSchema, req.body)
  sendSession(res, await auth.login(input, req))
})

export const refresh = asyncHandler(async (req: Request, res) => {
  const token = req.cookies?.[REFRESH_COOKIE]
  if (!token) throw unauthorized('No active session', 'NO_SESSION')
  try {
    const rotated = await rotateRefreshToken(token, req)
    const result = await auth.refreshUserTokens(rotated.userId, rotated.familyId)
    setRefreshCookie(res, rotated.token)
    res.json(result)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code !== 'REFRESH_RACE') clearRefreshCookie(res)
    throw err
  }
})

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE]
  if (token) {
    const session = await RefreshSession.findOne({ tokenHash: sha256(token) }).lean()
    if (session) await revokeFamily(session.familyId, 'logout')
  }
  clearRefreshCookie(res)
  res.status(204).end()
})

export const logoutAll = asyncHandler(async (req, res) => {
  await auth.logoutAll(authOf(req).userId)
  clearRefreshCookie(res)
  res.status(204).end()
})

export const me = asyncHandler(async (req, res) => {
  res.json({ user: await auth.toPublicUser(authOf(req).userId) })
})

export const updateMe = asyncHandler(async (req, res) => {
  const { name } = parse(v.updateProfileSchema, req.body)
  res.json({ user: await auth.updateProfile(authOf(req).userId, name) })
})

export const changePassword = asyncHandler(async (req, res) => {
  const input = parse(v.changePasswordSchema, req.body)
  const { userId, sessionId } = authOf(req)
  res.json(await auth.changePassword(userId, sessionId, input.currentPassword, input.newPassword))
})

export const sessions = asyncHandler(async (req, res) => {
  const { userId, sessionId } = authOf(req)
  res.json({ sessions: await auth.listSessions(userId, sessionId) })
})

export const revokeSession = asyncHandler(async (req, res) => {
  const { userId } = authOf(req)
  await auth.revokeSession(userId, String(req.params.id).slice(0, 64))
  res.status(204).end()
})
