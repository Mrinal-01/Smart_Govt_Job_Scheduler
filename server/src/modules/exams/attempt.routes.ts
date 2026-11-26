import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import * as svc from './attempt.service.js'
import { toOid } from './selection.service.js'

export const attemptRouter = Router()
attemptRouter.use(requireAuth)

const id = (v: unknown) => toOid(parse(objectId, v))

attemptRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ mockTestId: objectId.optional() }), req.query)
    res.json({ attempts: await svc.listAttempts(authOf(req).userId, q.mockTestId ? toOid(q.mockTestId) : undefined) })
  })
)

attemptRouter.get(
  '/performance',
  asyncHandler(async (req, res) => {
    res.json(await svc.performanceSummary(authOf(req).userId))
  })
)

attemptRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ mockTestId: objectId }), req.body)
    const r = await svc.startAttempt(authOf(req).userId, toOid(body.mockTestId))
    res.status(r.resumed ? 200 : 201).json(r)
  })
)

attemptRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ attempt: await svc.getAttempt(authOf(req).userId, id(req.params.id)) })
  })
)

attemptRouter.put(
  '/:id/answers',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        answers: z
          .array(
            z.object({
              questionId: objectId,
              selected: z.array(z.string().max(30)).max(5),
              markedForReview: z.boolean().optional(),
              visited: z.boolean().optional(),
              timeSpentSeconds: z.number().min(0).max(36000).optional()
            })
          )
          .max(300)
      }),
      req.body
    )
    res.json(await svc.saveAnswers(authOf(req).userId, id(req.params.id), body.answers))
  })
)

attemptRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    res.json({ attempt: await svc.submitAttempt(authOf(req).userId, id(req.params.id)) })
  })
)

attemptRouter.post(
  '/:id/retake',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ mode: z.enum(['incorrect', 'unanswered', 'all']) }), req.body)
    res.status(201).json({ test: await svc.createRetake(authOf(req).userId, id(req.params.id), body.mode) })
  })
)

attemptRouter.post(
  '/:id/mistakes',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ questionId: objectId }), req.body)
    res.status(201).json({ mistake: await svc.addMistakeFromAttempt(authOf(req).userId, id(req.params.id), body.questionId) })
  })
)
