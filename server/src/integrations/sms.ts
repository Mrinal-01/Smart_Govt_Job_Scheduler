import { env } from '../config/env.js'
import { unavailable } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { maskPhone } from '../lib/phone.js'

export interface SmsMessage {
  to: string
  body: string
  /** Kept only by the console driver's dev inbox. */
  code?: string
  purpose?: string
}

interface SmsDriver {
  name: 'console' | 'twilio' | 'disabled'
  send(message: SmsMessage): Promise<void>
}

/** Development inbox for the console driver (exposed at GET /api/dev/sms in development only). */
export const devSmsInbox: Array<SmsMessage & { sentAt: string }> = []

const consoleDriver: SmsDriver = {
  name: 'console',
  async send(message) {
    if (env.isProd) throw unavailable('SMS delivery is not configured on this server.', 'SMS_UNAVAILABLE')
    devSmsInbox.unshift({ ...message, sentAt: new Date().toISOString() })
    devSmsInbox.splice(50)
    logger.info({ to: message.to, code: message.code, purpose: message.purpose }, `[dev sms] ${message.body}`)
  }
}

const twilioDriver: SmsDriver = {
  name: 'twilio',
  async send(message) {
    const sid = env.TWILIO_ACCOUNT_SID
    const token = env.TWILIO_AUTH_TOKEN
    const from = env.TWILIO_FROM
    if (!sid || !token || !from) throw unavailable('SMS delivery is not configured on this server.', 'SMS_UNAVAILABLE')
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: message.to, From: from, Body: message.body }),
      signal: AbortSignal.timeout(10_000)
    }).catch((err) => {
      logger.error({ err, to: maskPhone(message.to) }, 'SMS provider unreachable')
      return null
    })
    if (!res || !res.ok) {
      if (res) logger.error({ status: res.status, to: maskPhone(message.to) }, 'SMS provider rejected the message')
      throw unavailable('Could not send the SMS right now. Please try again in a minute.', 'SMS_UNAVAILABLE')
    }
  }
}

const disabledDriver: SmsDriver = {
  name: 'disabled',
  async send() {
    throw unavailable('SMS delivery is disabled on this server.', 'SMS_UNAVAILABLE')
  }
}

const driver: SmsDriver = env.SMS_DRIVER === 'twilio' ? twilioDriver : env.SMS_DRIVER === 'disabled' ? disabledDriver : consoleDriver
if (env.isProd && driver.name === 'console') logger.warn('SMS_DRIVER=console cannot deliver codes in production — OTP requests will fail with 503 until a real driver is configured.')

export const smsDriverName = () => driver.name
/** True only when codes may be revealed to the client: local development with the console driver. */
export const devCodesVisible = () => env.NODE_ENV === 'development' && driver.name === 'console'

export async function sendOtpSms(to: string, code: string, purpose: 'signup' | 'login') {
  await driver.send({
    to,
    code,
    purpose,
    body: `${code} is your StudyOS ${purpose === 'signup' ? 'sign-up' : 'login'} code. It expires in 5 minutes. Do not share it with anyone.`
  })
}
