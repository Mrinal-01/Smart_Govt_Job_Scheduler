import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import * as svc from './mockTest.service.js'
import { toOid } from './selection.service.js'

export const mockTestRouter = Router()
mockTestRouter.use(requireAuth)

const typeSchema = z.enum(['full_mixed', 'sectional', 'subject_full', 'chapter', 'topic'])
const ids = (max: number) => z.array(z.string().min(1).max(240)).max(max).default([])

export const configSchema = z.object({
  subjectIds: ids(20),
  chapterIds: ids(100),
  topicIds: ids(300),
  distribution: z.array(z.object({ subjectId: z.string().min(1).max(120), count: z.number().int().min(0).max(200) })).max(20).default([]),
  questionCount: z.number().int().min(1).max(300).default(10),
  durationMinutes: z.number().int().min(1).max(600),
  marksPerQuestion: z.number().min(0).max(100).default(1),
  negativeMarks: z.number().min(0).max(100).default(0),
  selectionMethod: z.enum(['random', 'difficulty', 'topic']).default('random'),
  difficultyDistribution: z
    .object({ easy: z.number().int().min(0).max(100), medium: z.number().int().min(0).max(100), hard: z.number().int().min(0).max(100) })
    .default({ easy: 0, medium: 0, hard: 0 }),
  avoidRecentDays: z.number().int().min(0).max(365).default(0),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(false),
  instructions: z.string().max(4000).default('')
})

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: typeSchema,
  config: configSchema,
  saveAsTemplate: z.boolean().optional()
})

mockTestRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const kind = parse(z.enum(['test', 'template']).default('test'), req.query.kind)
    res.json({ items: await svc.listMockTests(authOf(req).userId, kind) })
  })
)

mockTestRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ type: typeSchema, config: configSchema }), req.body)
    res.json(await svc.previewSelection(authOf(req).userId, body.type, body.config))
  })
)

mockTestRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body)
    res.status(201).json(await svc.createMockTest(authOf(req).userId, body))
  })
)

mockTestRouter.post(
  '/templates',
  asyncHandler(async (req, res) => {
    const body = parse(createSchema.omit({ saveAsTemplate: true }), req.body)
    res.status(201).json({ template: await svc.createTemplate(authOf(req).userId, body) })
  })
)

mockTestRouter.post(
  '/templates/:id/generate',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(2).max(120).optional() }), req.body ?? {})
    res.status(201).json(await svc.generateFromTemplate(authOf(req).userId, toOid(parse(objectId, req.params.id)), body.name))
  })
)

mockTestRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const test = await svc.getMockTest(authOf(req).userId, toOid(parse(objectId, req.params.id)))
    res.json({ test: { ...test, questionIds: undefined } })
  })
)

mockTestRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await svc.archiveMockTest(authOf(req).userId, toOid(parse(objectId, req.params.id)))
    res.status(204).end()
  })
)
