import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { authLimiter, otpLimiter, refreshLimiter, requireCsrfHeader } from '../../middleware/security.js'
import * as c from './auth.controller.js'

export const authRouter = Router()

// Phone + one-time code. Email/password sign-up, verification and reset were retired.
authRouter.post('/otp/request', otpLimiter, c.requestOtp)
authRouter.post('/register', authLimiter, c.register)
authRouter.post('/login', authLimiter, c.login)

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
