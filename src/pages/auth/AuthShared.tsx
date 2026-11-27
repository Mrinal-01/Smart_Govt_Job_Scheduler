import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Brain, Inbox, Mail } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/http'
import { Button } from '../../components/ui'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const { configError } = useAuth()
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link to="/login" className="auth-brand" aria-label="StudyOS home">
          <span className="brand-mark">
            <Brain size={17} />
          </span>
          <span className="brand-name">StudyOS</span>
        </Link>
        <h1 className="auth-title">{title}</h1>
        {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}
        {configError ? <div className="callout callout--danger" role="alert">{configError}</div> : null}
        {children}
        {footer ? <div className="auth-footer">{footer}</div> : null}
      </div>
    </main>
  )
}

/** Client-side mirror of the server password policy (the server remains authoritative). */
export function passwordProblems(password: string, email = ''): string[] {
  const out: string[] = []
  if (password.length < 10) out.push('At least 10 characters')
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) out.push('At least one letter and one number')
  const local = email.split('@')[0]?.toLowerCase() ?? ''
  if (local.length >= 4 && password.toLowerCase().includes(local)) out.push('Must not contain your email name')
  return out
}

export function PasswordRules({ password, email }: { password: string; email?: string }) {
  if (!password) return <p className="field__hint">10+ characters with at least one letter and one number.</p>
  const problems = passwordProblems(password, email)
  return problems.length ? (
    <ul className="pw-rules">
      {problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  ) : (
    <p className="field__hint text-success">Password meets the policy.</p>
  )
}

/**
 * Development-only helper: with MAIL_DRIVER=console no email is delivered, so
 * the server keeps the links in memory. Hidden unless the server says so.
 */
export function DevMailbox({ tag }: { tag: 'verify-email' | 'reset-password' }) {
  const { config } = useAuth()
  const [messages, setMessages] = useState<Array<{ to: string; subject: string; link?: string; tag: string; sentAt: string }> | null>(null)
  if (!config?.devMailbox) return null
  const load = async () => {
    const r = await api<{ messages: Array<{ to: string; subject: string; link?: string; tag: string; sentAt: string }> }>('/api/dev/mailbox', { auth: false })
    setMessages(r.messages.filter((m) => m.tag === tag))
  }
  return (
    <div className="callout callout--neutral dev-mailbox">
      <Inbox size={14} />
      <div style={{ flex: 1 }}>
        <strong>Development mailbox.</strong> Email delivery is off (MAIL_DRIVER=console), so links are also printed in the API log.
        <div style={{ marginTop: 8 }}>
          <Button size="sm" icon={<Mail size={13} />} onClick={load}>
            Show recent emails
          </Button>
        </div>
        {messages ? (
          messages.length ? (
            <ul className="dev-mailbox__list">
              {messages.slice(0, 5).map((m) => (
                <li key={m.sentAt + m.to}>
                  <span className="mono">{m.to}</span> — {m.link ? <a href={m.link}>open link</a> : m.subject}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ marginTop: 6 }}>No emails yet.</p>
          )
        ) : null}
      </div>
    </div>
  )
}
