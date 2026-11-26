import { Router } from 'express'
import { env } from '../../config/env.js'
import { asyncHandler } from '../../lib/errors.js'
import { devOutbox, mailDriverName } from '../../integrations/mail.js'
import { describeIntegrations } from './system.service.js'

export const systemRouter = Router()

/** Public, non-secret runtime configuration for the client. */
systemRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const i = await describeIntegrations()
    res.json({ ...i, devMailbox: env.NODE_ENV === 'development' && mailDriverName() === 'console' })
  })
)

/**
 * Development-only mailbox: shows the emails the console mail driver would
 * have sent (verification / reset links) so the flows can be completed
 * locally without SMTP. Not mounted in production or test.
 */
if (env.NODE_ENV === 'development') {
  systemRouter.get('/dev/mailbox', (_req, res) => {
    if (mailDriverName() !== 'console') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dev mailbox is only available with MAIL_DRIVER=console' } })
    res.json({ messages: devOutbox.map(({ html: _h, ...m }) => m) })
  })
}
