import crypto from 'node:crypto'
import { env } from '../../config/env.js'
import { clock } from '../../lib/clock.js'
import { hmac, safeEqual } from '../../lib/crypto.js'
import { AppError, unprocessable } from '../../lib/errors.js'
import { PhoneOtp } from '../../models/index.js'
import { devCodesVisible, sendOtpSms } from '../../integrations/sms.js'

/*
 * One-time passwords for phone sign-up and login.
 *   - 6 random digits (crypto.randomInt); only HMAC-SHA256(OTP_SECRET, phone:purpose:code) is stored
 *   - one active code per (phone, purpose); a new request replaces the previous code
 *   - valid 5 minutes, single use, compared in constant time
 *   - 5 wrong attempts invalidate the code (a new one must be requested)
 *   - 60 s resend cooldown; at most 5 codes per number per rolling hour
 * All time logic uses clock.now() so the e2e suite can move time.
 */

export type OtpPurpose = 'signup' | 'login'

export const OTP_TTL_MS = 5 * 60_000
export const OTP_COOLDOWN_MS = 60_000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_SENDS_PER_HOUR = 5
const HOUR_MS = 3600_000

const digest = (phone: string, purpose: OtpPurpose, code: string) => hmac(env.otpSecret, `${phone}:${purpose}:${code}`)
const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000))
const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000

export async function issueOtp(phone: string, purpose: OtpPurpose) {
  const now = clock.now()
  const existing = await PhoneOtp.findOne({ phone, purpose }).lean()

  if (existing?.lastSentAt && now.getTime() - existing.lastSentAt.getTime() < OTP_COOLDOWN_MS) {
    const retryAfter = seconds(OTP_COOLDOWN_MS - (now.getTime() - existing.lastSentAt.getTime()))
    throw new AppError(429, 'OTP_COOLDOWN', `Please wait ${retryAfter} seconds before requesting another code.`, { retryAfter })
  }
  const sameWindow = existing && now.getTime() - existing.windowStart.getTime() < HOUR_MS
  const windowStart = sameWindow ? existing.windowStart : now
  const sendCount = (sameWindow ? existing.sendCount : 0) + 1
  if (sendCount > OTP_MAX_SENDS_PER_HOUR) {
    const retryAfter = seconds(windowStart.getTime() + HOUR_MS - now.getTime())
    throw new AppError(429, 'OTP_SEND_LIMIT', `Too many codes requested for this number. Try again in ${Math.ceil(retryAfter / 60)} minutes.`, { retryAfter })
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS)
  const purgeAt = new Date(Math.max(windowStart.getTime() + HOUR_MS, expiresAt.getTime()))
  const update = {
    $set: { codeHash: digest(phone, purpose, code), expiresAt, attempts: 0, consumedAt: null, lastSentAt: now, windowStart, sendCount, purgeAt }
  }
  try {
    // Optimistic guard: only the request that saw the current lastSentAt may replace the code.
    const filter = existing ? { _id: existing._id, lastSentAt: existing.lastSentAt } : { phone, purpose }
    const saved = await PhoneOtp.findOneAndUpdate(filter, existing ? update : { ...update, $setOnInsert: { phone, purpose } }, { upsert: !existing, new: true })
    if (!saved) throw new AppError(429, 'OTP_COOLDOWN', 'A code was just sent. Please wait before requesting another.', { retryAfter: seconds(OTP_COOLDOWN_MS) })
  } catch (err) {
    if (isDuplicateKey(err)) throw new AppError(429, 'OTP_COOLDOWN', 'A code was just sent. Please wait before requesting another.', { retryAfter: seconds(OTP_COOLDOWN_MS) })
    throw err
  }

  await sendOtpSms(phone, code, purpose)
  return {
    expiresIn: seconds(OTP_TTL_MS),
    resendIn: seconds(OTP_COOLDOWN_MS),
    ...(devCodesVisible() ? { devOtp: code } : {})
  }
}

/** Verifies and consumes a code. Throws 422 with a specific code on any failure. */
export async function consumeOtp(phone: string, purpose: OtpPurpose, code: string) {
  const now = clock.now()
  const doc = await PhoneOtp.findOne({ phone, purpose }).lean()
  if (!doc || !doc.codeHash || doc.consumedAt) {
    if (doc && !doc.codeHash && doc.attempts >= OTP_MAX_ATTEMPTS) {
      throw unprocessable('Too many incorrect attempts. Request a new code.', 'OTP_ATTEMPTS_EXCEEDED')
    }
    throw unprocessable('This code is no longer valid. Request a new code.', 'OTP_INVALID')
  }
  if (doc.expiresAt <= now) throw unprocessable('This code has expired. Request a new code.', 'OTP_EXPIRED')

  if (!safeEqual(digest(phone, purpose, code), doc.codeHash)) {
    const attempts = doc.attempts + 1
    const invalidate = attempts >= OTP_MAX_ATTEMPTS
    await PhoneOtp.updateOne({ _id: doc._id, codeHash: doc.codeHash }, { $set: { attempts, ...(invalidate ? { codeHash: null } : {}) } })
    if (invalidate) throw unprocessable('Too many incorrect attempts. Request a new code.', 'OTP_ATTEMPTS_EXCEEDED')
    throw unprocessable(`Incorrect code. ${OTP_MAX_ATTEMPTS - attempts} attempt(s) left.`, 'OTP_INCORRECT', { attemptsLeft: OTP_MAX_ATTEMPTS - attempts })
  }
  // Single use: only one concurrent request can consume a given code.
  const consumed = await PhoneOtp.findOneAndUpdate({ _id: doc._id, codeHash: doc.codeHash, consumedAt: null }, { $set: { consumedAt: now } })
  if (!consumed) throw unprocessable('This code has already been used. Request a new code.', 'OTP_INVALID')
}
