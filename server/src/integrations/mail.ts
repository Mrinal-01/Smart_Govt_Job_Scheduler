import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
  /** Machine-readable tag, used by the dev outbox & tests (e.g. 'verify-email'). */
  tag: string
  link?: string
}

export interface MailDriver {
  name: string
  send(message: MailMessage): Promise<void>
}

/** Recent messages kept in memory for development and tests only. */
export const devOutbox: Array<MailMessage & { sentAt: string }> = []

const consoleDriver: MailDriver = {
  name: 'console',
  async send(message) {
    devOutbox.unshift({ ...message, sentAt: new Date().toISOString() })
    devOutbox.splice(50)
    logger.info({ to: message.to, subject: message.subject, link: message.link }, '[mail:console] email not sent — logged for development')
  }
}

/** Resend HTTP API (https://resend.com) — no SDK dependency. */
const resendDriver: MailDriver = {
  name: 'resend',
  async send(message) {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: controller.signal
      })
      if (!res.ok) throw new Error(`Resend responded ${res.status}`)
    } finally {
      clearTimeout(timer)
    }
  }
}

const disabledDriver: MailDriver = {
  name: 'disabled',
  async send(message) {
    logger.warn({ tag: message.tag }, '[mail:disabled] MAIL_DRIVER=disabled — email dropped')
  }
}

let driver: MailDriver = env.MAIL_DRIVER === 'resend' ? resendDriver : env.MAIL_DRIVER === 'disabled' ? disabledDriver : consoleDriver

export function setMailDriver(next: MailDriver) {
  driver = next
}

export const mailDriverName = () => driver.name

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function layout(title: string, body: string, cta?: { label: string; href: string }) {
  return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#f6f7f9;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border:1px solid #e5e7ec;border-radius:12px;padding:24px">
<h2 style="margin:0 0 12px;color:#12141a">${escapeHtml(title)}</h2>
<p style="color:#5b6270;line-height:1.55">${body}</p>
${cta ? `<p><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(cta.label)}</a></p><p style="color:#8a90a0;font-size:12px;word-break:break-all">${escapeHtml(cta.href)}</p>` : ''}
<p style="color:#8a90a0;font-size:12px">If you did not request this, you can ignore this email.</p></div></body></html>`
}

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const link = `${env.PUBLIC_APP_URL}/verify-email?token=${encodeURIComponent(token)}`
  await driver.send({
    to,
    tag: 'verify-email',
    link,
    subject: 'Verify your StudyOS email',
    text: `Hi ${name},\n\nConfirm your email address to activate your StudyOS account:\n${link}\n\nThis link expires in 24 hours.`,
    html: layout('Verify your email', `Hi ${escapeHtml(name)}, confirm your email address to activate your StudyOS account. This link expires in 24 hours.`, {
      label: 'Verify email',
      href: link
    })
  })
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const link = `${env.PUBLIC_APP_URL}/reset-password?token=${encodeURIComponent(token)}`
  await driver.send({
    to,
    tag: 'reset-password',
    link,
    subject: 'Reset your StudyOS password',
    text: `Hi ${name},\n\nReset your StudyOS password using this link (valid for 1 hour):\n${link}`,
    html: layout('Reset your password', `Hi ${escapeHtml(name)}, use the button below to choose a new password. The link is valid for 1 hour and can be used once.`, {
      label: 'Reset password',
      href: link
    })
  })
}

export async function sendSecurityNotice(to: string, name: string, what: string) {
  await driver.send({
    to,
    tag: 'security-notice',
    subject: 'StudyOS security notice',
    text: `Hi ${name},\n\n${what}\n\nIf this was not you, reset your password immediately.`,
    html: layout('Security notice', `Hi ${escapeHtml(name)}, ${escapeHtml(what)} If this was not you, reset your password immediately.`)
  })
}
