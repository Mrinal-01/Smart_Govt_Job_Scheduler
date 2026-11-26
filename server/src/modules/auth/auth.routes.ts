import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { authLimiter, emailLimiter, refreshLimiter, requireCsrfHeader } from '../../middleware/security.js'
import * as c from './auth.controller.js'

export const authRouter = Router()

authRouter.post('/register', authLimiter, c.register)
authRouter.post('/login', authLimiter, c.login)
authRouter.post('/google', authLimiter, c.google)
authRouter.post('/google/link', authLimiter, c.googleLink)
authRouter.post('/verify-email', authLimiter, c.verifyEmail)
authRouter.post('/resend-verification', emailLimiter, c.resendVerification)
authRouter.post('/forgot-password', emailLimiter, c.forgotPassword)
authRouter.post('/reset-password', authLimiter, c.resetPassword)

// Cookie-authenticated endpoints: CSRF-guarded.
authRouter.post('/refresh', refreshLimiter, requireCsrfHeader, c.refresh)
authRouter.post('/logout', requireCsrfHeader, c.logout)

// Bearer-authenticated endpoints.
authRouter.get('/me', requireAuth, c.me)
authRouter.patch('/me', requireAuth, c.updateMe)
authRouter.post('/logout-all', requireAuth, c.logoutAll)
authRouter.post('/change-password', requireAuth, authLimiter, c.changePassword)
authRouter.get('/sessions', requireAuth, c.sessions)
authRouter.delete('/sessions/:id', requireAuth, c.revokeSession)
