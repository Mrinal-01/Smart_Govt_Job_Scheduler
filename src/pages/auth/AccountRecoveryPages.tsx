import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, KeyRound, Mail, XCircle } from 'lucide-react'
import { ApiError, api, errorMessage } from '../../lib/http'
import { Button, Field, Input, LoadingBlock } from '../../components/ui'
import { AuthLayout, DevMailbox, PasswordRules, passwordProblems } from './AuthShared'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [state, setState] = useState<'idle' | 'working' | 'ok' | 'failed'>(token ? 'working' : 'idle')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (!token || ran.current) return
    ran.current = true
    api<{ message: string }>('/api/auth/verify-email', { method: 'POST', body: { token }, auth: false })
      .then((r) => {
        setState('ok')
        setMessage(r.message)
      })
      .catch((err) => {
        setState('failed')
        setMessage(errorMessage(err))
      })
  }, [token])

  const resend = async (e: React.FormEvent) => {
    e.preventDefault()
    await api('/api/auth/resend-verification', { method: 'POST', body: { email: email.trim() }, auth: false }).catch(() => undefined)
    setSent(true)
  }

  return (
    <AuthLayout title="Verify your email" footer={<Link to="/login">Back to sign in</Link>}>
      {state === 'working' ? <LoadingBlock label="Verifying…" /> : null}
      {state === 'ok' ? (
        <div className="stack">
          <div className="callout callout--success">
            <CheckCircle2 size={15} />
            <span>{message}</span>
          </div>
          <Link to="/login" className="btn btn--primary btn--lg btn--block">
            <span>Sign in</span>
          </Link>
        </div>
      ) : null}
      {state === 'failed' || state === 'idle' ? (
        <form className="stack" onSubmit={resend}>
          {state === 'failed' ? (
            <div className="callout callout--danger">
              <XCircle size={15} />
              <span>{message}</span>
            </div>
          ) : (
            <p className="text-secondary">Enter your email to receive a new verification link.</p>
          )}
          <Field label="Email" htmlFor="verify-email">
            <Input id="verify-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {sent ? <div className="callout callout--info">If an unverified account matches, a new link is on its way.</div> : null}
          <Button type="submit" variant="primary" disabled={!email.trim() || sent} icon={<Mail size={14} />}>
            Send new link
          </Button>
          <DevMailbox tag="verify-email" />
        </form>
      ) : null}
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address')
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email: email.trim() }, auth: false })
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a single-use link valid for one hour." footer={<Link to="/login">Back to sign in</Link>}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email" htmlFor="forgot-email" error={error || undefined}>
          <Input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {sent ? <div className="callout callout--info">If an account matches that email, we have sent instructions to it.</div> : null}
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={sent} icon={<KeyRound size={15} />}>
          Send reset link
        </Button>
        {sent ? <DevMailbox tag="reset-password" /> : null}
      </form>
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problems = passwordProblems(password)
    if (problems.length) return setError(problems[0])
    if (password !== confirm) return setError('Passwords do not match')
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, password, confirmPassword: confirm }, auth: false })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError && err.issues.length ? err.issues[0].message : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Reset link missing" footer={<Link to="/forgot-password">Request a new link</Link>}>
        <div className="callout callout--warning">This page needs the link from your email.</div>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title="Choose a new password" footer={<Link to="/login">Back to sign in</Link>}>
      {done ? (
        <div className="stack">
          <div className="callout callout--success">Password updated. All devices were signed out.</div>
          <Button variant="primary" onClick={() => navigate('/login')}>
            Sign in
          </Button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="New password" htmlFor="reset-pw">
            <Input id="reset-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <PasswordRules password={password} />
          <Field label="Confirm new password" htmlFor="reset-confirm">
            <Input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error ? <div className="callout callout--danger" role="alert">{error}</div> : null}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function TermsPage() {
  return (
    <AuthLayout title="Terms of Use" footer={<Link to="/register">Back</Link>}>
      <div className="terms">
        <p>StudyOS is a personal study-management tool. By creating an account you agree that:</p>
        <ul>
          <li>You are responsible for the content you upload. Only upload question papers you are allowed to use for personal study.</li>
          <li>Your data is private to your account. We do not share it with other users.</li>
          <li>
            AI features (when enabled by the operator) send the minimum necessary study data to the configured AI provider. AI output can be wrong; answers
            extracted or generated by AI are never shown as verified until you verify them.
          </li>
          <li>Mock tests built from your own uploads are for practice and are not official examinations.</li>
          <li>You can export your data from Settings at any time.</li>
        </ul>
        <p className="text-tertiary">The operator of this StudyOS instance should replace this text with their own legal terms before public launch.</p>
      </div>
    </AuthLayout>
  )
}
