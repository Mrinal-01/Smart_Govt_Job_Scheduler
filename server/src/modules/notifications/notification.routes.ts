import { Router } from 'express'
import type { Types } from 'mongoose'
import { asyncHandler, notFound } from '../../lib/errors.js'
import { parse, objectId } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import { Notification } from '../../models/index.js'

export async function notify(userId: Types.ObjectId, input: { type: string; title: string; message?: string; link?: string }) {
  await Notification.create({ userId, ...input })
}

export const notificationRouter = Router()
notificationRouter.use(requireAuth)

notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = authOf(req)
    const items = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(50).lean()
    const unread = await Notification.countDocuments({ userId, readAt: null })
    res.json({ notifications: items, unread })
  })
)

notificationRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ userId: authOf(req).userId, readAt: null }, { $set: { readAt: new Date() } })
    res.status(204).end()
  })
)

notificationRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const id = parse(objectId, req.params.id)
    const r = await Notification.updateOne({ _id: id, userId: authOf(req).userId }, { $set: { readAt: new Date() } })
    if (!r.matchedCount) throw notFound('Notification')
    res.status(204).end()
  })
)
