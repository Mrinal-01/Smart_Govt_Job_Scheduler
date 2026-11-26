import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { ApiError, api, errorMessage } from '../../lib/http'
import { Button, Checkbox, Field, Input, Modal } from '../../components/ui'
import { AuthLayout, Divider, GoogleButton } from './AuthShared'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [resent, setResent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResent(false)
    if (!email.trim() || !password) {
      setError(new ApiError('Enter your email and password.', 400, 'CLIENT_VALIDATION'))
      return
    }
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(errorMessage(err), 0))
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    await api('/api/auth/resend-verification', { method: 'POST', body: { email: email.trim() }, auth: false }).catch(() => undefined)
    setResent(true)
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Your study ledger is waiting."
      footer={
        <>
          New to StudyOS? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email" htmlFor="login-email">
          <Input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <div className="input-affix">
            <Input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="icon-btn is-ghost" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Field>
        {error ? (
          <div className="callout callout--danger" role="alert">
            <div>
              {error.message}
              {error.code === 'EMAIL_NOT_VERIFIED' ? (
                <div style={{ marginTop: 6 }}>
                  {resent ? 'If the account exists, a new link is on its way.' : <button type="button" className="link-btn" onClick={resend}>Resend verification email</button>}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="row row--between">
          <Link to="/forgot-password" className="text-secondary">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<LogIn size={15} />}>
          Sign in
        </Button>
      </form>
      <Divider />
      <GoogleFlow onDone={() => navigate(from, { replace: true })} />
    </AuthLayout>
  )
}

/** Google sign-in with the two follow-ups the server may require: terms acceptance and account-link confirmation. */
export function GoogleFlow({ onDone, acceptTermsUpfront = false }: { onDone: () => void; acceptTermsUpfront?: boolean }) {
  const { googleSignIn, linkGoogle } = useAuth()
  const [credential, setCredential] = useState<string | null>(null)
  const [need, setNeed] = useState<'terms' | 'link' | null>(null)
  const [ticket, setTicket] = useState<{ linkTicket: string; email: string } | null>(null)
  const [terms, setTerms] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const attempt = async (cred: string, acceptTerms?: boolean) => {
    setError('')
    setBusy(true)
    try {
      await googleSignIn(cred, acceptTerms)
      setNeed(null)
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TERMS_REQUIRED') {
        setCredential(cred)
        setNeed('terms')
      } else if (err instanceof ApiError && err.code === 'ACCOUNT_LINK_REQUIRED') {
        setTicket(err.details as { linkTicket: string; email: string })
        setNeed('link')
      } else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const confirmLink = async () => {
    if (!ticket) return
    setBusy(true)
    setError('')
    try {
      await linkGoogle(ticket.linkTicket, password)
      setNeed(null)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <GoogleButton onCredential={(c) => void attempt(c, acceptTermsUpfront || undefined)} />
      {error && !need ? <div className="callout callout--danger" style={{ marginTop: 10 }}>{error}</div> : null}
      <Modal
        open={need === 'terms'}
        onClose={() => setNeed(null)}
        title="Create your StudyOS account"
        size="sm"
        footer={
          <>
            <Button onClick={() => setNeed(null)}>Cancel</Button>
            <Button variant="primary" disabled={!terms} loading={busy} onClick={() => credential && attempt(credential, true)}>
              Continue
            </Button>
          </>
        }
      >
        <p className="text-secondary" style={{ marginBottom: 12 }}>
          No StudyOS account uses this Google email yet. Accept the terms to create one.
        </p>
        <Checkbox checked={terms} onChange={setTerms} label={<>I accept the <Link to="/terms" target="_blank">Terms of Use</Link></>} />
        {error ? <div className="callout callout--danger" style={{ marginTop: 10 }}>{error}</div> : null}
      </Modal>
      <Modal
        open={need === 'link'}
        onClose={() => setNeed(null)}
        title="Link Google to your account"
        size="sm"
        footer={
          <>
            <Button onClick={() => setNeed(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!password} onClick={confirmLink}>
              Link & sign in
            </Button>
          </>
        }
      >
        <p className="text-secondary" style={{ marginBottom: 12 }}>
          An account for <strong>{ticket?.email}</strong> already exists. For your security we never link accounts automatically — enter that account’s password to confirm.
        </p>
        <Field label="StudyOS password" htmlFor="link-password">
          <Input id="link-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? <div className="callout callout--danger" style={{ marginTop: 10 }}>{error}</div> : null}
      </Modal>
    </>
  )
}
