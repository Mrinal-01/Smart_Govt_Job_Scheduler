import { env } from '../../config/env.js'
import { getAIProvider } from '../../integrations/ai.js'
import { mailDriverName } from '../../integrations/mail.js'
import { getOcrProvider } from '../documents/extraction/ocr.js'
import { policy } from '../schedule/schedule.service.js'

/** Honest description of which integrations are live — shown in the UI and logged at boot. */
export async function describeIntegrations() {
  const ocr = getOcrProvider()
  return {
    googleSignIn: env.googleEnabled,
    googleClientId: env.GOOGLE_CLIENT_ID ?? null,
    ai: { configured: Boolean(getAIProvider()), provider: getAIProvider()?.name ?? null, model: getAIProvider()?.model ?? null },
    ocr: { provider: ocr.name, available: await ocr.available() },
    mail: { driver: mailDriverName(), delivers: mailDriverName() === 'resend' },
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    maxUploadMb: env.MAX_UPLOAD_MB,
    maxPdfPages: env.MAX_PDF_PAGES,
    schedulePolicy: policy(),
    timezone: env.APP_TIMEZONE,
    environment: env.NODE_ENV
  }
}
