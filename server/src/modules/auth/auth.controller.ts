import type { Request, Response } from 'express'
import { asyncHandler, unauthorized } from '../../lib/errors.js'
import { parse } from '../../lib/validate.js'
import { authOf } from '../../middleware/auth.js'
import * as auth from './auth.service.js'
import { REFRESH_COOKIE, clearRefreshCookie, revokeFamily, rotateRefreshToken, setRefreshCookie } from './token.service.js'
import { sha256 } from '../../lib/crypto.js'
import { RefreshSession } from '../../models/index.js'
import * as v from './auth.validators.js'

const GENERIC_EMAIL_RESPONSE = { message: 'If an account matches that email, we have sent instructions to it.' }

function sendSession(res: Response, result: { accessToken: string; expiresIn: number; refreshToken: string; user: auth.PublicUser }, status = 200) {
  setRefreshCookie(res, result.refreshToken)
  res.status(status).json({ accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user })
}

export const register = asyncHandler(async (req, res) => {
  const input = parse(v.registerSchema, req.body)
  const result = await auth.register(input)
  res.status(201).json(result)
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

export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = parse(v.tokenSchema, req.body)
  res.json({ user: await auth.verifyEmail(token), message: 'Email verified. You can now sign in.' })
})

export const resendVerification = asyncHandler(async (req, res) => {
  const { email } = parse(v.emailOnlySchema, req.body)
  await auth.resendVerification(email)
  res.status(202).json(GENERIC_EMAIL_RESPONSE)
})

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = parse(v.emailOnlySchema, req.body)
  await auth.forgotPassword(email)
  res.status(202).json(GENERIC_EMAIL_RESPONSE)
})

export const resetPassword = asyncHandler(async (req, res) => {
  const input = parse(v.resetPasswordSchema, req.body)
  await auth.resetPassword(input.token, input.password)
  clearRefreshCookie(res)
  res.json({ message: 'Password updated. Sign in with your new password.' })
})

export const changePassword = asyncHandler(async (req, res) => {
  const input = parse(v.changePasswordSchema, req.body)
  const { userId, sessionId } = authOf(req)
  res.json(await auth.changePassword(userId, sessionId, input.currentPassword, input.newPassword))
})

export const google = asyncHandler(async (req, res) => {
  const input = parse(v.googleSchema, req.body)
  const result = await auth.googleSignIn(input, req)
  sendSession(res, result, result.kind === 'registered' ? 201 : 200)
})

export const googleLink = asyncHandler(async (req, res) => {
  const input = parse(v.googleLinkSchema, req.body)
  sendSession(res, await auth.linkGoogle(input, req))
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
