import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/errors.js'
import { parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import * as ws from './workspace.service.js'

export const workspaceRouter = Router()
workspaceRouter.use(requireAuth)

workspaceRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await ws.getWorkspace(authOf(req).userId))
  })
)

workspaceRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ origin: z.enum(['import', 'demo', 'fresh']), data: ws.workspaceDataSchema }), req.body)
    res.status(201).json(await ws.createWorkspace(authOf(req).userId, body.origin, body.data))
  })
)

workspaceRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ baseRevision: z.number().int().min(1), data: ws.workspaceDataSchema }), req.body)
    res.json(await ws.saveWorkspace(authOf(req).userId, body.baseRevision, body.data))
  })
)
