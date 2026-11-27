import { env } from '../config/env.js'

/**
 * Normalizes a phone number to E.164 (`+<country><national>`), or returns an error message.
 * Accepted input: optional "+", spaces, dashes, dots and brackets. For India (+91) a bare
 * 10-digit number or "91" + 10 digits is accepted; the national number must be 10 digits
 * starting with 6–9. Only country codes in PHONE_ALLOWED_COUNTRY_CODES are allowed.
 */
export function normalizePhone(input: string, allowed: string[] = env.phoneCountryCodes): { phone: string } | { error: string } {
  const raw = String(input ?? '').trim()
  if (!raw) return { error: 'Enter your mobile number.' }
  if (!/^\+?[\d\s\-().]+$/.test(raw)) return { error: 'A mobile number may only contain digits.' }
  const plus = raw.startsWith('+')
  let digits = raw.replace(/\D/g, '')
  if (!plus) {
    // Bare national number for India.
    if (allowed.includes('91') && digits.length === 10) digits = `91${digits}`
    else if (allowed.includes('91') && digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`
  }
  const cc = [...allowed].sort((a, b) => b.length - a.length).find((c) => digits.startsWith(c))
  if (!cc) {
    return { error: `Only ${allowed.map((c) => `+${c}`).join(', ')} mobile numbers are supported.` }
  }
  const national = digits.slice(cc.length)
  if (cc === '91') {
    if (!/^[6-9]\d{9}$/.test(national)) return { error: 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.' }
  } else if (digits.length < 8 || digits.length > 15 || national.length < 4) {
    return { error: 'Enter a valid mobile number with its country code.' }
  }
  return { phone: `+${digits}` }
}

/** "+919876543210" → "+91 98765 43210" (display only). */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164)
  return m ? `+91 ${m[1]} ${m[2]}` : e164
}

/** "+91•••••43210" for logs. */
export const maskPhone = (e164: string) => `${e164.slice(0, 3)}${'•'.repeat(Math.max(0, e164.length - 8))}${e164.slice(-5)}`
