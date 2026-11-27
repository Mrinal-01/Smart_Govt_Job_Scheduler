import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { ApiError, api, errorMessage } from '../../lib/http'
import { Button, Field, Input } from '../../components/ui'
import { AuthLayout } from './AuthShared'

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
    </AuthLayout>
  )
}
