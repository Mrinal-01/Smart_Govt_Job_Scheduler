import { Router } from 'express'
import { env } from '../../config/env.js'
import { asyncHandler } from '../../lib/errors.js'
import { devCodesVisible, devSmsInbox } from '../../integrations/sms.js'
import { describeIntegrations } from './system.service.js'

export const systemRouter = Router()

/** Public, non-secret runtime configuration for the client. */
systemRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const i = await describeIntegrations()
    res.json({ ...i, devSms: devCodesVisible() })
  })
)

/** Development-only SMS inbox: one-time codes the console SMS driver would have sent. */
if (env.NODE_ENV === 'development') {
  systemRouter.get('/dev/sms', (_req, res) => {
    if (!devCodesVisible()) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dev SMS inbox is only available with SMS_DRIVER=console' } })
    res.json({ messages: devSmsInbox })
  })
}
