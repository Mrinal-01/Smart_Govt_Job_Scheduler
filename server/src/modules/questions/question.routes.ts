import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import { QUESTION_STATUSES, DIFFICULTIES, QUESTION_TYPES } from '../../models/index.js'
import * as svc from './question.service.js'

/* /api/questions — the central question hub (shared by all students). */
export const questionRouter = Router()
questionRouter.use(requireAuth)

const oid = (v: unknown) => new Types.ObjectId(parse(objectId, v))
const taxonomyId = z.string().min(1).max(240).nullable().optional()

const editSchema = z.object({
  questionText: z.string().trim().min(1).max(8000).optional(),
  questionType: z.enum(QUESTION_TYPES).optional(),
  options: z.array(z.object({ label: z.string().max(4).optional(), text: z.string().max(2000) })).max(5).optional(),
  correctAnswer: z.array(z.string().min(1).max(30)).max(5).nullable().optional(),
  explanation: z.string().max(8000).nullable().optional(),
  subjectId: taxonomyId,
  chapterId: taxonomyId,
  topicId: taxonomyId,
  difficulty: z.enum(DIFFICULTIES).optional()
})

questionRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const f = parse(
      z.object({
        scope: z.enum(['hub', 'mine']).default('hub'),
        status: z.enum(QUESTION_STATUSES).optional(),
        subjectId: z.string().max(120).optional(),
        subjectKey: z.string().max(120).optional(),
        difficulty: z.enum(DIFFICULTIES).optional(),
        origin: z.enum(['pdf', 'manual', 'ai_generated']).optional(),
        documentId: objectId.optional(),
        q: z.string().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25)
      }),
      req.query
    )
    res.json(await svc.listQuestions(authOf(req).userId, f))
  })
)

questionRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json(await svc.questionStats(authOf(req).userId))
  })
)

questionRouter.get(
  '/hub-summary',
  asyncHandler(async (req, res) => {
    res.json(await svc.hubSummary(authOf(req).userId))
  })
)

questionRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(editSchema.extend({ questionText: z.string().trim().min(1).max(8000) }), req.body)
    res.status(201).json({ question: await svc.createManualQuestion(authOf(req).userId, input) })
  })
)

questionRouter.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        ids: z.array(objectId).min(1).max(200),
        action: z.enum(['confirm', 'reject', 'delete', 'assign']),
        assign: editSchema.pick({ subjectId: true, chapterId: true, topicId: true, difficulty: true }).optional()
      }),
      req.body
    )
    const results = await svc.bulkAction(authOf(req).userId, body.ids.map((id) => new Types.ObjectId(id)), body.action, body.assign)
    res.json({ results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length })
  })
)

questionRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ question: await svc.getQuestion(authOf(req).userId, oid(req.params.id)) })
  })
)

questionRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(editSchema, req.body)
    res.json({ question: await svc.updateQuestion(authOf(req).userId, oid(req.params.id), input) })
  })
)

questionRouter.post(
  '/:id/confirm',
  asyncHandler(async (req, res) => {
    res.json({ question: await svc.confirmQuestion(authOf(req).userId, oid(req.params.id)) })
  })
)

questionRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    res.json({ question: await svc.rejectQuestion(authOf(req).userId, oid(req.params.id)) })
  })
)

questionRouter.post(
  '/:id/report',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ reason: z.string().trim().min(3, 'Say briefly what is wrong').max(500) }), req.body)
    res.json(await svc.reportQuestion(authOf(req).userId, oid(req.params.id), body.reason))
  })
)

questionRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await svc.deleteQuestion(authOf(req).userId, oid(req.params.id)))
  })
)
