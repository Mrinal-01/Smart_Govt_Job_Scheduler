import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import { toOid } from '../exams/selection.service.js'
import * as svc from './assistant.service.js'

export const aiRouter = Router()
aiRouter.use(requireAuth)

/** Burst protection on top of the per-user daily limit. */
const aiBurst = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.auth?.userId ?? req.ip),
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many AI requests — wait a minute.' } })
})

aiRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json(await svc.aiStatus(authOf(req).userId))
  })
)

aiRouter.post(
  '/explain-answer',
  aiBurst,
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ attemptId: objectId, questionId: objectId }), req.body)
    res.json(await svc.explainWrongAnswer(authOf(req).userId, toOid(body.attemptId), body.questionId))
  })
)

aiRouter.post(
  '/explain-topic',
  aiBurst,
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ topicId: z.string().min(1).max(240), focus: z.string().max(500).optional() }), req.body)
    res.json(await svc.explainTopic(authOf(req).userId, body.topicId, body.focus))
  })
)

aiRouter.post(
  '/practice-questions',
  aiBurst,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({ topicId: z.string().min(1).max(240), count: z.number().int().min(1).max(10), difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed') }),
      req.body
    )
    res.status(201).json(await svc.generatePractice(authOf(req).userId, body))
  })
)
