import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Brain, MessageSquareText } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { Field, Input } from '../../components/ui'

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

/* ------------------------------------------------------------------ */
/* Phone + OTP helpers                                                 */
/* ------------------------------------------------------------------ */

/** Client mirror of the server rule for Indian mobiles (the server stays authoritative). */
export function phoneProblem(national: string): string | null {
  if (!national) return 'Enter your 10-digit mobile number.'
  if (!/^\d+$/.test(national)) return 'Use digits only.'
  if (national.length !== 10) return 'A mobile number has exactly 10 digits.'
  if (!/^[6-9]/.test(national)) return 'Indian mobile numbers start with 6, 7, 8 or 9.'
  return null
}

export const toE164 = (national: string) => `+91${national}`

/** Fixed +91 prefix and a 10-digit numeric input. */
export function PhoneField({
  id,
  value,
  onChange,
  error,
  disabled
}: {
  id: string
  value: string
  onChange: (digits: string) => void
  error?: string
  disabled?: boolean
}) {
  return (
    <Field label="Mobile number" htmlFor={id} error={error} required>
      <div className="phone-input">
        <span className="phone-input__cc" aria-hidden="true">
          +91
        </span>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          maxLength={10}
          value={value}
          disabled={disabled}
          aria-label="10-digit mobile number"
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        />
      </div>
    </Field>
  )
}

export function OtpField({ id, value, onChange, error }: { id: string; value: string; onChange: (code: string) => void; error?: string }) {
  return (
    <Field label="6-digit code" htmlFor={id} error={error} required hint="Sent by SMS. It expires in 5 minutes.">
      <Input
        id={id}
        className="otp-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="••••••"
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </Field>
  )
}

/** Seconds left until `until` (epoch ms), ticking once a second. */
export function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [until])
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
}

/** Development only: shows the code the console SMS driver "sent". Never rendered in production. */
export function DevCode({ code }: { code?: string }) {
  const { config } = useAuth()
  if (!code || !config?.devSms) return null
  return (
    <div className="callout callout--neutral">
      <MessageSquareText size={14} />
      <span>
        Development SMS (not sent): your code is <strong className="mono">{code}</strong>. It is also printed in the API log and listed at <span className="mono">/api/dev/sms</span>.
      </span>
    </div>
  )
}
