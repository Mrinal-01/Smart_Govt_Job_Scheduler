import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/errors.js'
import { parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import { getSettings, serializeSettings, updateSettings } from './settings.service.js'

export const settingsRouter = Router()
settingsRouter.use(requireAuth)

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const patchSchema = z.object({
  timezone: z.string().max(64).refine(isTimeZone, 'Unknown time zone').optional(),
  cycle: z
    .object({
      subjectIds: z.array(z.string().min(1).max(120)).max(20).optional(),
      defaultRevisionMinutes: z.number().int().min(0).max(180).optional(),
      revisionMinutesBySubject: z.record(z.string().max(120), z.number().int().min(0).max(180)).optional(),
      revisionMinutesPerTopic: z.number().int().min(1).max(60).optional(),
      maxTopicsPerRevisionBlock: z.number().int().min(1).max(50).optional(),
      revisionMandatory: z.boolean().optional()
    })
    .optional(),
  ai: z.object({ enabled: z.boolean().optional() }).optional(),
  exams: z.object({ autoAddMistakes: z.boolean().optional() }).optional()
})

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ settings: serializeSettings(await getSettings(authOf(req).userId)) })
  })
)

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const patch = parse(patchSchema, req.body)
    res.json({ settings: await updateSettings(authOf(req).userId, patch) })
  })
)
