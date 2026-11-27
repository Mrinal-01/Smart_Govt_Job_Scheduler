import fs from 'node:fs'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { apiLimiter, rejectOperatorKeys } from './middleware/security.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { workspaceRouter } from './modules/workspace/workspace.routes.js'
import { settingsRouter } from './modules/settings/settings.routes.js'
import { scheduleRouter } from './modules/schedule/schedule.routes.js'
import { planRouter } from './modules/plan/plan.routes.js'
import { soundRouter } from './modules/sounds/sounds.routes.js'
import { documentRouter, fileRouter } from './modules/documents/document.routes.js'
import { questionRouter } from './modules/questions/question.routes.js'
import { mockTestRouter } from './modules/exams/mockTest.routes.js'
import { attemptRouter } from './modules/exams/attempt.routes.js'
import { mistakeRouter } from './modules/exams/mistake.routes.js'
import { aiRouter } from './modules/ai/ai.routes.js'
import { notificationRouter } from './modules/notifications/notification.routes.js'
import { systemRouter } from './modules/system/system.routes.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  if (env.TRUST_PROXY) app.set('trust proxy', 1)

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          // Uploaded reminder sounds are fetched with auth and played from an in-memory blob URL.
          mediaSrc: ["'self'", 'blob:'],
          frameSrc: ["'self'", 'blob:'],
          frameAncestors: ["'self'"],
          objectSrc: ["'none'"],
          // Only force HTTPS sub-resources when the deployment is HTTPS (COOKIE_SECURE).
          upgradeInsecureRequests: env.cookieSecure ? [] : null
        }
      }
    })
  )
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-StudyOS-CSRF'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    })
  )
  app.use(cookieParser())
  app.use((req, res, next) => {
    const started = Date.now()
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        logger.debug({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }, 'request')
      }
    })
    next()
  })

  // The legacy workspace document (365 days of history) can exceed the default body limit.
  app.use('/api/workspace', express.json({ limit: '8mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use('/api', rejectOperatorKeys)
  app.use('/api', apiLimiter)

  app.get('/api/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1 ? 'up' : 'down'
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db, time: new Date().toISOString() })
  })

  app.use('/api', systemRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/workspace', workspaceRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/schedule', scheduleRouter)
  app.use('/api/plan', planRouter)
  app.use('/api/sounds', soundRouter)
  app.use('/api/documents', documentRouter)
  app.use('/api/files', fileRouter)
  app.use('/api/questions', questionRouter)
  app.use('/api/mock-tests', mockTestRouter)
  app.use('/api/attempts', attemptRouter)
  app.use('/api/mistakes', mistakeRouter)
  app.use('/api/ai', aiRouter)
  app.use('/api/notifications', notificationRouter)
  app.use('/api', notFoundHandler)

  if (env.SERVE_CLIENT_DIST) {
    const dist = path.resolve(env.SERVE_CLIENT_DIST)
    if (fs.existsSync(path.join(dist, 'index.html'))) {
      app.use(express.static(dist, { index: false, maxAge: '1h' }))
      app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
    } else {
      logger.warn({ dist }, 'SERVE_CLIENT_DIST set but index.html not found — run `npm run build` at the project root')
    }
  }

  app.use(errorHandler)
  return app
}
