import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, notFound } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import { ExamMistake } from '../../models/index.js'

export const mistakeRouter = Router()
mistakeRouter.use(requireAuth)

const CATEGORIES = ['conceptual', 'calculation', 'formula-forgotten', 'misread', 'guessing', 'time-management'] as const

mistakeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ status: z.enum(['unresolved', 'reviewed', 'resolved']).optional(), subjectId: z.string().max(120).optional() }), req.query)
    const filter: Record<string, unknown> = { userId: authOf(req).userId }
    if (q.status) filter.status = q.status
    if (q.subjectId) filter.subjectId = q.subjectId
    res.json({ mistakes: await ExamMistake.find(filter).sort({ lastSeenAt: -1 }).limit(500).lean() })
  })
)

mistakeRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ status: z.enum(['unresolved', 'reviewed', 'resolved']).optional(), category: z.enum(CATEGORIES).optional() }), req.body)
    const m = await ExamMistake.findOneAndUpdate({ _id: parse(objectId, req.params.id), userId: authOf(req).userId }, { $set: body }, { new: true }).lean()
    if (!m) throw notFound('Mistake')
    res.json({ mistake: m })
  })
)

/** Counts a deliberate practice of the mistake; three reviews resolve it (same rule as the existing Mistake Bank). */
mistakeRouter.post(
  '/:id/review',
  asyncHandler(async (req, res) => {
    const m = await ExamMistake.findOne({ _id: parse(objectId, req.params.id), userId: authOf(req).userId })
    if (!m) throw notFound('Mistake')
    m.reviewCount += 1
    m.status = m.reviewCount >= 3 ? 'resolved' : 'reviewed'
    await m.save()
    res.json({ mistake: m })
  })
)

mistakeRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const r = await ExamMistake.deleteOne({ _id: parse(objectId, req.params.id), userId: authOf(req).userId })
    if (!r.deletedCount) throw notFound('Mistake')
    res.status(204).end()
  })
)
