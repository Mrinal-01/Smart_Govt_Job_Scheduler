import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import * as svc from './cycle.service.js'

export const cycleRouter = Router()
cycleRouter.use(requireAuth)

const reason = z.object({ reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(500) })
const id = (v: unknown) => svc.toObjectId(parse(objectId, v))

cycleRouter.get(
  '/today',
  asyncHandler(async (req, res) => {
    res.json(await svc.getToday(authOf(req).userId))
  })
)

cycleRouter.get(
  '/carry-forward',
  asyncHandler(async (req, res) => {
    res.json(await svc.getCarryForward(authOf(req).userId))
  })
)

cycleRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const days = parse(z.coerce.number().int().min(1).max(90).default(14), req.query.days)
    res.json({ cycles: await svc.getHistory(authOf(req).userId, days) })
  })
)

cycleRouter.post(
  '/start',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ subjectIds: z.array(z.string().min(1).max(120)).max(20).optional(), force: z.boolean().optional() }), req.body ?? {})
    res.status(201).json({ cycle: await svc.startCycle(authOf(req).userId, body) })
  })
)

cycleRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ cycle: await svc.getCycleDetail(authOf(req).userId, id(req.params.id)) })
  })
)

cycleRouter.post(
  '/:id/end',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ reason: z.string().max(500).optional() }), req.body ?? {})
    res.json({ cycle: await svc.endCycle(authOf(req).userId, id(req.params.id), body.reason) })
  })
)

cycleRouter.post(
  '/blocks/:blockId/start-revision',
  asyncHandler(async (req, res) => {
    res.json({ block: await svc.startRevision(authOf(req).userId, id(req.params.blockId)) })
  })
)

cycleRouter.post(
  '/blocks/:blockId/skip-revision',
  asyncHandler(async (req, res) => {
    const body = parse(reason, req.body)
    res.json({ block: await svc.skipBlockRevision(authOf(req).userId, id(req.params.blockId), body.reason) })
  })
)

cycleRouter.post(
  '/blocks/:blockId/start-learning',
  asyncHandler(async (req, res) => {
    res.json({ block: await svc.startLearning(authOf(req).userId, id(req.params.blockId)) })
  })
)

cycleRouter.post(
  '/blocks/:blockId/complete-learning',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        entries: z
          .array(
            z.object({
              topicId: z.string().min(1).max(240),
              completion: z.enum(['completed', 'partial']),
              minutes: z.number().int().min(0).max(600).optional(),
              confidence: z.number().int().min(1).max(5).optional(),
              notes: z.string().max(2000).optional()
            })
          )
          .min(1, 'Record at least one topic you studied')
          .max(20)
      }),
      req.body
    )
    res.json(await svc.completeLearning(authOf(req).userId, id(req.params.blockId), body.entries))
  })
)

cycleRouter.post(
  '/blocks/:blockId/skip',
  asyncHandler(async (req, res) => {
    const body = parse(reason, req.body)
    res.json({ block: await svc.skipBlock(authOf(req).userId, id(req.params.blockId), body.reason) })
  })
)

cycleRouter.post(
  '/revision-tasks/:taskId/complete',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        outcome: z.enum(['recalled', 'partial', 'forgot']),
        questionsAttempted: z.number().int().min(0).max(500).optional(),
        questionsCorrect: z.number().int().min(0).max(500).optional(),
        secondsSpent: z.number().min(0).max(36000).optional()
      }),
      req.body
    )
    res.json({ task: await svc.completeRevisionTask(authOf(req).userId, id(req.params.taskId), body) })
  })
)

cycleRouter.post(
  '/revision-tasks/:taskId/skip',
  asyncHandler(async (req, res) => {
    const body = parse(reason, req.body)
    res.json({ task: await svc.skipRevisionTask(authOf(req).userId, id(req.params.taskId), body.reason) })
  })
)
