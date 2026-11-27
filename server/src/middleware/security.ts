import type { NextFunction, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../config/env.js'
import { badRequest, forbidden } from '../lib/errors.js'

function hasOperatorKey(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((v) => hasOperatorKey(v, depth + 1))
  return Object.keys(value as Record<string, unknown>).some(
    (k) => k.startsWith('$') || hasOperatorKey((value as Record<string, unknown>)[k], depth + 1)
  )
}

/** Rejects `$`-prefixed keys anywhere in body/query (NoSQL operator injection). */
export function rejectOperatorKeys(req: Request, _res: Response, next: NextFunction) {
  if (hasOperatorKey(req.query) || hasOperatorKey(req.body)) {
    return next(badRequest('Request contains forbidden keys', undefined, 'FORBIDDEN_KEYS'))
  }
  next()
}

/** True when the Origin points at the host that served this request (same-origin, incl. a dev proxy on any port/IP). */
function isSameHostOrigin(origin: string, req: Request) {
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  if (host === req.get('host')) return true
  return env.TRUST_PROXY && host === req.get('x-forwarded-host')
}

/**
 * CSRF guard for endpoints authenticated by the refresh-token cookie.
 * Requires a custom header (cannot be sent cross-site without a CORS preflight,
 * which our CORS allowlist rejects) and, when present, an Origin that is either
 * allow-listed or the same host the request was sent to.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.get('x-studyos-csrf') !== '1') return next(forbidden('Missing CSRF header', 'CSRF_REJECTED'))
  const origin = req.get('origin')
  if (origin && !env.corsOrigins.includes(origin) && origin !== env.PUBLIC_APP_URL && !isSameHostOrigin(origin, req)) {
    return next(forbidden('Origin not allowed', 'CSRF_REJECTED'))
  }
  next()
}

/** Local development gets 10× headroom so repeated manual testing isn't blocked; production keeps strict limits. */
const scale = (n: number) => (env.NODE_ENV === 'development' ? n * 10 : n)

const limiterOptions = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } })
}

/** Credential endpoints: 10 attempts / 15 min / IP. */
export const authLimiter = rateLimit({ ...limiterOptions, windowMs: 15 * 60_000, limit: scale(10) })
/** OTP SMS requests: 20 / hour / IP (each number is further capped to 5 codes / hour). */
export const otpLimiter = rateLimit({ ...limiterOptions, windowMs: 60 * 60_000, limit: scale(20) })
/** Email-sending endpoints: 5 / hour / IP. */
export const emailLimiter = rateLimit({ ...limiterOptions, windowMs: 60 * 60_000, limit: scale(5) })
/**
 * Token refresh: 600 / 15 min / IP. Every page load and every open tab refreshes,
 * and the endpoint already requires a valid HttpOnly cookie + CSRF header, so it
 * only needs flood protection (credential guessing is limited by authLimiter).
 */
export const refreshLimiter = rateLimit({ ...limiterOptions, windowMs: 15 * 60_000, limit: scale(600) })
/** General API: 600 / 5 min / IP. */
export const apiLimiter = rateLimit({ ...limiterOptions, windowMs: 5 * 60_000, limit: scale(600) })
