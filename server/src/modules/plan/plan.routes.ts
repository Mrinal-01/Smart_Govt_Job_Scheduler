import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { isDateKey } from '../../lib/dates.js'
import { asyncHandler } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import { planContext } from './plan.context.js'
import * as insights from './plan.insights.js'
import * as rev from './plan.revision.js'
import * as svc from './plan.service.js'

/*
 * /api/plan — scheduled sessions, revision gates, revision obligations, weekly review,
 * analytics. Every route requires authentication and is scoped to the caller's own data;
 * another user's id answers 404. See docs/STUDY_CYCLE_AND_REVISION_API.md.
 */
export const planRouter = Router()
planRouter.use(requireAuth)

const id = (v: unknown) => new Types.ObjectId(parse(objectId, v))
const dateKeySchema = z.string().refine(isDateKey, 'Invalid date (YYYY-MM-DD)')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm')
const reason = (min: number) => z.object({ reason: z.string().trim().min(min, `Give a reason of at least ${min} characters`).max(1000) })

async function resolveDate(userId: Types.ObjectId, value: unknown) {
  if (value === undefined || value === 'today') return (await planContext(userId)).today
  return parse(dateKeySchema, value)
}

/* ------------------------------ days & cycles ------------------------------ */

planRouter.get(
  '/days/:date',
  asyncHandler(async (req, res) => {
    const userId = authOf(req).userId
    res.json(await svc.getDay(userId, await resolveDate(userId, req.params.date)))
  })
)

planRouter.get(
  '/days/:date/cycles',
  asyncHandler(async (req, res) => {
    const userId = authOf(req).userId
    res.json(await svc.getCycles(userId, await resolveDate(userId, req.params.date)))
  })
)

planRouter.post(
  '/days/:date/cycles/:cycleNumber/complete',
  asyncHandler(async (req, res) => {
    const userId = authOf(req).userId
    const n = parse(z.coerce.number().int().min(1).max(20), req.params.cycleNumber)
    const body = parse(z.object({ reason: z.string().max(500).optional() }), req.body ?? {})
    res.json(await svc.completeCycle(userId, await resolveDate(userId, req.params.date), n, body.reason))
  })
)

planRouter.post(
  '/cycle-template',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startTime: time,
        cyclesPerDay: z.number().int().min(1).max(8).optional(),
        subjectIds: z.array(z.string().min(1).max(120)).max(20).optional(),
        sessionMinutes: z.number().int().min(10).max(300).optional(),
        breakMinutes: z.number().int().min(0).max(120).optional(),
        revisionMinutes: z.number().int().min(1).max(180).nullable().optional()
      }),
      req.body
    )
    res.json(await svc.cycleTemplate(authOf(req).userId, body))
  })
)

/* --------------------------------- sessions -------------------------------- */

planRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const userId = authOf(req).userId
    const today = (await planContext(userId)).today
    const q = parse(
      z.object({
        from: dateKeySchema.optional(),
        to: dateKeySchema.optional(),
        status: z.enum(['scheduled', 'in_progress', 'completed', 'skipped', 'missed']).optional()
      }),
      req.query
    )
    res.json({ sessions: await svc.listSessions(userId, q.from ?? today, q.to ?? today, q.status) })
  })
)

planRouter.get(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    res.json(await svc.getSession(authOf(req).userId, id(req.params.id)))
  })
)

planRouter.get(
  '/sessions/:id/dependencies',
  asyncHandler(async (req, res) => {
    res.json(await svc.getDependencies(authOf(req).userId, id(req.params.id)))
  })
)

planRouter.get(
  '/sessions/:id/eligibility',
  asyncHandler(async (req, res) => {
    res.json(await svc.getEligibility(authOf(req).userId, id(req.params.id)))
  })
)

planRouter.post(
  '/sessions/:id/start',
  asyncHandler(async (req, res) => {
    res.json(await svc.startSession(authOf(req).userId, id(req.params.id)))
  })
)

planRouter.post(
  '/sessions/:id/complete',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        topics: z.array(z.object({ topicId: z.string().min(1).max(240), completion: z.enum(['completed', 'partial']) })).max(20).default([]),
        questionsAttempted: z.number().int().min(0).max(1000).optional(),
        questionsCorrect: z.number().int().min(0).max(1000).optional(),
        confidence: z.number().int().min(1).max(5).optional(),
        notes: z.string().max(2000).optional(),
        actualMinutes: z.number().int().min(1).max(720).optional()
      }),
      req.body
    )
    res.json(await svc.completeSession(authOf(req).userId, id(req.params.id), body))
  })
)

planRouter.post(
  '/sessions/:id/skip',
  asyncHandler(async (req, res) => {
    const body = parse(reason(3), req.body)
    res.json(await svc.skipSession(authOf(req).userId, id(req.params.id), body.reason))
  })
)

planRouter.post(
  '/sessions/:id/override',
  asyncHandler(async (req, res) => {
    const body = parse(reason(10), req.body)
    res.status(201).json(await svc.overrideGate(authOf(req).userId, id(req.params.id), body.reason))
  })
)

planRouter.post(
  '/sessions/:id/reschedule',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ startTime: time, endTime: time }), req.body)
    res.json(await svc.rescheduleSession(authOf(req).userId, id(req.params.id), body))
  })
)

/* --------------------------------- revisions ------------------------------- */

const revisionList = z.object({
  type: z.enum(['same_day', 'next_day', 'weekly']).optional(),
  state: z.enum(['open', 'pending', 'in_progress', 'overdue', 'completed']).optional(),
  subjectId: z.string().max(120).optional(),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
})

planRouter.get(
  '/revisions',
  asyncHandler(async (req, res) => {
    res.json(await rev.listObligations(authOf(req).userId, parse(revisionList, req.query)))
  })
)

planRouter.get(
  '/revisions/overdue',
  asyncHandler(async (req, res) => {
    res.json(await rev.listObligations(authOf(req).userId, { state: 'overdue', limit: 500 }))
  })
)

planRouter.get(
  '/revisions/carryover',
  asyncHandler(async (req, res) => {
    const userId = authOf(req).userId
    const ctx = await svc.prepare(userId)
    res.json(await rev.getCarryover(ctx, await resolveDate(userId, req.query.date)))
  })
)

planRouter.get(
  '/revisions/history',
  asyncHandler(async (req, res) => {
    const days = parse(z.coerce.number().int().min(1).max(365).default(30), req.query.days)
    res.json({ attempts: await rev.revisionHistory(authOf(req).userId, days) })
  })
)

planRouter.get(
  '/revisions/:id',
  asyncHandler(async (req, res) => {
    res.json(await rev.getObligation(authOf(req).userId, id(req.params.id)))
  })
)

planRouter.get(
  '/revisions/:id/preparation',
  asyncHandler(async (req, res) => {
    res.json(await rev.getPreparation(authOf(req).userId, id(req.params.id)))
  })
)

planRouter.post(
  '/revisions/:id/start',
  asyncHandler(async (req, res) => {
    res.json(await rev.startObligation(authOf(req).userId, id(req.params.id)))
  })
)

planRouter.post(
  '/revisions/:id/complete',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        topicsRevised: z.array(z.string().min(1).max(240)).min(1, 'Tick the topics you revised').max(50),
        questionsAttempted: z.number().int().min(0).max(1000).optional(),
        questionsCorrect: z.number().int().min(0).max(1000).optional(),
        questionsWrong: z.number().int().min(0).max(1000).optional(),
        confidence: z.number().int().min(1).max(5),
        notes: z.string().max(2000).optional(),
        actualMinutes: z.number().int().min(1).max(600).optional()
      }),
      req.body
    )
    res.json(await rev.completeObligation(authOf(req).userId, id(req.params.id), body))
  })
)

/* ------------------------------- weekly review ----------------------------- */

planRouter.get(
  '/weekly',
  asyncHandler(async (req, res) => {
    const weekStart = parse(dateKeySchema.optional(), req.query.weekStart)
    res.json(await insights.getWeekly(authOf(req).userId, weekStart))
  })
)

planRouter.get(
  '/weekly/progress',
  asyncHandler(async (req, res) => {
    const weekStart = parse(dateKeySchema.optional(), req.query.weekStart)
    const w = await insights.getWeekly(authOf(req).userId, weekStart)
    res.json({ weekStart: w.weekStart, weekEnd: w.weekEnd, dueDate: w.dueDate, progress: w.progress, summary: w.summary })
  })
)

/* --------------------------- overrides & analytics -------------------------- */

planRouter.get(
  '/overrides',
  asyncHandler(async (req, res) => {
    const days = parse(z.coerce.number().int().min(1).max(365).default(30), req.query.days)
    res.json({ overrides: await svc.listOverrides(authOf(req).userId, days) })
  })
)

planRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const days = parse(z.coerce.number().int().min(1).max(180).default(30), req.query.days)
    res.json(await insights.getAnalytics(authOf(req).userId, days))
  })
)
