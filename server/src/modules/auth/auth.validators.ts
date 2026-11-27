import { z } from 'zod'
import { normalizePhone } from '../../lib/phone.js'

/** Accepts common spellings of a mobile number and outputs E.164; invalid numbers fail validation. */
export const phoneSchema = z
  .string({ error: 'Mobile number is required' })
  .max(32, 'Mobile number is too long')
  .transform((v, ctx) => {
    const r = normalizePhone(v)
    if ('error' in r) {
      ctx.addIssue({ code: 'custom', message: r.error })
      return z.NEVER
    }
    return r.phone
  })

export const otpSchema = z.string({ error: 'Enter the 6-digit code' }).trim().regex(/^\d{6}$/, 'Enter the 6-digit code')

export const nameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name is too long')
  .regex(/^[\p{L}][\p{L} .'-]*$/u, 'Name may only contain letters, spaces, dots, apostrophes and hyphens')

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['signup', 'login'], { error: 'purpose must be signup or login' })
})

export const registerSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  otp: otpSchema,
  acceptTerms: z.literal(true, { error: 'You must accept the terms to create an account' })
})

export const loginSchema = z.object({ phone: phoneSchema, otp: otpSchema })

/**
 * Password policy (NIST 800-63B aligned) — only used by legacy accounts that still have a password.
 */
export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain at least one letter and one number')
  .refine((p) => !/^(.)\1+$/.test(p), 'Password cannot be a single repeated character')

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

export const updateProfileSchema = z.object({ name: nameSchema })
