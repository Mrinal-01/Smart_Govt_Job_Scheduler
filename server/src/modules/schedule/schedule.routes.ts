import { Router } from 'express'
import { z } from 'zod'
import { isDateKey } from '../../lib/dates.js'
import { asyncHandler } from '../../lib/errors.js'
import { parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import * as svc from './schedule.service.js'
import { normalizeSlot } from './slots.js'

export const scheduleRouter = Router()
scheduleRouter.use(requireAuth)

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm')
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export const slotSchema = z
  .object({
    id: z.string().min(1).max(80),
    weekday: z.number().int().min(0).max(6),
    subjectId: z.string().min(1).max(120),
    sessionNumber: z.number().int().min(1).max(20).default(1),
    label: z.string().max(120).default(''),
    startTime: time,
    endTime: time,
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    requiresRevision: z.boolean().default(false),
    learningTarget: z.string().max(300).default(''),
    practiceTarget: z.number().int().min(0).max(1000).default(0),
    reminderEnabled: z.boolean().default(true),
    breakAfterMinutes: z.number().int().min(0).max(240).default(0),
    order: z.number().int().min(0).max(500).default(0),
    sessionType: z.enum(['learning', 'revision', 'practice', 'mock_test']).default('learning'),
    cycleNumber: z.number().int().min(1).max(20).nullable().default(null),
    chapterId: z.string().min(1).max(160).nullable().default(null),
    topicIds: z.array(z.string().min(1).max(240)).max(20).default([]),
    revisionMinutes: z.number().int().min(1).max(180).nullable().default(null),
    revisionPolicy: z.enum(['previous_cycle', 'all_previous_cycles', 'none']).optional(),
    prerequisiteSlotIds: z.array(z.string().min(1).max(80)).max(10).default([])
  })
  .refine((s) => toMin(s.endTime) > toMin(s.startTime), { message: 'End time must be after start time', path: ['endTime'] })
  // Duration is always derived from the times on the server; policy/flag are kept consistent.
  .transform((s) => normalizeSlot({ ...s, durationMinutes: toMin(s.endTime) - toMin(s.startTime) }))

const slotsSchema = z.array(slotSchema).max(300)

const publishSchema = z.object({
  slots: slotsSchema,
  changeReason: z.string().trim().max(500).default(''),
  effectiveFrom: z.string().refine(isDateKey, 'Invalid date').optional(),
  override: z.boolean().optional(),
  overrideReason: z.string().max(1000).optional()
})

scheduleRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await svc.getStatus(authOf(req).userId))
  })
)

scheduleRouter.get(
  '/versions',
  asyncHandler(async (req, res) => {
    res.json({ versions: await svc.history(authOf(req).userId) })
  })
)

scheduleRouter.get(
  '/versions/:version',
  asyncHandler(async (req, res) => {
    const version = parse(z.coerce.number().int().min(1), req.params.version)
    res.json({ version: await svc.getVersion(authOf(req).userId, version) })
  })
)

scheduleRouter.get(
  '/effective',
  asyncHandler(async (req, res) => {
    const date = parse(z.string().refine(isDateKey, 'Invalid date'), req.query.date)
    res.json({ version: await svc.getEffective(authOf(req).userId, date) })
  })
)

scheduleRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const { slots } = parse(z.object({ slots: slotsSchema }), req.body)
    res.json(await svc.previewPublish(authOf(req).userId, slots))
  })
)

scheduleRouter.post(
  '/publish',
  asyncHandler(async (req, res) => {
    const input = parse(publishSchema, req.body)
    res.status(201).json(await svc.publish(authOf(req).userId, input))
  })
)
