import type { NextFunction, Request, Response } from 'express'
import { Types } from 'mongoose'
import { forbidden, unauthorized } from '../lib/errors.js'
import { User } from '../models/index.js'
import { verifyAccessToken } from '../modules/auth/token.service.js'

export interface AuthContext {
  userId: Types.ObjectId
  role: 'student' | 'admin'
  sessionId: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

/**
 * Authenticates the bearer access token, then re-checks the user record so a
 * disabled account or a bumped tokenVersion ("log out everywhere", password
 * change) takes effect immediately rather than at token expiry.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.get('authorization') ?? ''
    const [scheme, token] = header.split(' ')
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized('Authentication required')
    const claims = verifyAccessToken(token)
    if (!Types.ObjectId.isValid(claims.sub)) throw unauthorized('Invalid access token', 'TOKEN_INVALID')
    const user = await User.findById(claims.sub).select('tokenVersion status role').lean()
    if (!user || user.status !== 'active') throw unauthorized('Account not available', 'ACCOUNT_UNAVAILABLE')
    if (user.tokenVersion !== claims.tv) throw unauthorized('Session has been signed out', 'TOKEN_REVOKED')
    req.auth = { userId: user._id, role: user.role as AuthContext['role'], sessionId: claims.sid }
    next()
  } catch (err) {
    next(err)
  }
}

export function requireRole(role: AuthContext['role']) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized())
    if (req.auth.role !== role) return next(forbidden())
    next()
  }
}

/** Convenience accessor for handlers mounted behind requireAuth. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthorized()
  return req.auth
}
