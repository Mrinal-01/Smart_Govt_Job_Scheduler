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

/**
 * CSRF guard for endpoints authenticated by the refresh-token cookie.
 * Requires a custom header (cannot be sent cross-site without a CORS preflight,
 * which our CORS allowlist rejects) and, when present, an allow-listed Origin.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.get('x-studyos-csrf') !== '1') return next(forbidden('Missing CSRF header', 'CSRF_REJECTED'))
  const origin = req.get('origin')
  if (origin && !env.corsOrigins.includes(origin) && origin !== env.PUBLIC_APP_URL) {
    return next(forbidden('Origin not allowed', 'CSRF_REJECTED'))
  }
  next()
}

const limiterOptions = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  skip: () => env.isTest && process.env.STUDYOS_TEST_RATE_LIMIT !== '1',
  handler: (_req: Request, res: Response) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } })
}

/** Credential endpoints: 10 attempts / 15 min / IP. */
export const authLimiter = rateLimit({ ...limiterOptions, windowMs: 15 * 60_000, limit: 10 })
/** Email-sending endpoints: 5 / hour / IP. */
export const emailLimiter = rateLimit({ ...limiterOptions, windowMs: 60 * 60_000, limit: 5 })
/** Token refresh: 60 / 15 min / IP. */
export const refreshLimiter = rateLimit({ ...limiterOptions, windowMs: 15 * 60_000, limit: 60 })
/** General API: 600 / 5 min / IP. */
export const apiLimiter = rateLimit({ ...limiterOptions, windowMs: 5 * 60_000, limit: 600 })
