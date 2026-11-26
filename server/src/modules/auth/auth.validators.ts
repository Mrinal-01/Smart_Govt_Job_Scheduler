import { z } from 'zod'

export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email({ error: 'Enter a valid email address' }))

/**
 * Password policy (NIST 800-63B aligned): 10–128 chars, at least one letter and
 * one number, not trivially derived from the email. No forced symbol rules.
 */
export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain at least one letter and one number')
  .refine((p) => !/^(.)\1+$/.test(p), 'Password cannot be a single repeated character')

const COMMON = new Set(['password123', 'password1234', '1234567890a', 'qwerty12345', 'studyos1234', 'letmein12345', 'iloveyou123'])

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: 'You must accept the terms to create an account' })
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
  .refine((d) => !COMMON.has(d.password.toLowerCase()), { path: ['password'], message: 'This password is too common' })
  .refine((d) => !d.password.toLowerCase().includes(d.email.split('@')[0]) || d.email.split('@')[0].length < 4, {
    path: ['password'],
    message: 'Password must not contain your email name'
  })

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128)
})

export const tokenSchema = z.object({ token: z.string().min(10).max(200) })
export const emailOnlySchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z
  .object({ token: z.string().min(10).max(200), password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

export const googleSchema = z.object({
  credential: z.string().min(20).max(5000),
  acceptTerms: z.boolean().optional()
})

export const googleLinkSchema = z.object({
  linkTicket: z.string().min(20).max(4000),
  password: z.string().min(1).max(128)
})

export const updateProfileSchema = z.object({ name: z.string().trim().min(2).max(80) })
