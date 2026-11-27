import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MailCheck, UserPlus } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { ApiError, api, errorMessage } from '../../lib/http'
import { Button, Checkbox, Field, Input } from '../../components/ui'
import { AuthLayout, DevMailbox, PasswordRules, passwordProblems } from './AuthShared'

type Errors = Partial<Record<'name' | 'email' | 'password' | 'confirmPassword' | 'acceptTerms' | 'form', string>>

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', acceptTerms: false })
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ email: string; verificationRequired: boolean } | null>(null)
  const [resent, setResent] = useState(false)

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const validate = (): Errors => {
    const e: Errors = {}
    if (form.name.trim().length < 2) e.name = 'Name must be at least 2 characters'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email address'
    const pw = passwordProblems(form.password, form.email)
    if (pw.length) e.password = pw[0]
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match'
    if (!form.acceptTerms) e.acceptTerms = 'You must accept the terms to create an account'
    return e
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const v = validate()
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      const r = await register({ ...form, name: form.name.trim(), email: form.email.trim() })
      setDone({ email: form.email.trim().toLowerCase(), verificationRequired: r.verificationRequired })
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        const mapped: Errors = {}
        err.issues.forEach((i) => {
          const key = (i.path || 'form') as keyof Errors
          if (!mapped[key]) mapped[key] = i.message
        })
        setErrors(mapped)
      } else setErrors({ form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <AuthLayout title="Check your inbox" subtitle={<>We sent a verification link to <strong>{done.email}</strong>.</>}>
        <div className="stack">
          {done.verificationRequired ? (
            <>
              <div className="callout callout--info">
                <MailCheck size={15} />
                <span>Open the link to activate your account, then sign in. The link expires in 24 hours.</span>
              </div>
              <Button
                onClick={async () => {
                  await api('/api/auth/resend-verification', { method: 'POST', body: { email: done.email }, auth: false }).catch(() => undefined)
                  setResent(true)
                }}
                disabled={resent}
              >
                {resent ? 'Sent — check your inbox' : 'Resend email'}
              </Button>
              <DevMailbox tag="verify-email" />
            </>
          ) : (
            <div className="callout callout--success">Your account is ready.</div>
          )}
          <Button variant="primary" onClick={() => navigate('/login')}>
            Go to sign in
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Plan, revise and test — with your data synced securely to your account."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Full name" htmlFor="reg-name" error={errors.name} required>
          <Input id="reg-name" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="reg-email" error={errors.email} required>
          <Input id="reg-email" type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="reg-password" error={errors.password} required>
          <Input id="reg-password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
        </Field>
        {!errors.password ? <PasswordRules password={form.password} email={form.email} /> : null}
        <Field label="Confirm password" htmlFor="reg-confirm" error={errors.confirmPassword} required>
          <Input id="reg-confirm" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(e) => set('confirmPassword', e.target.value)} />
        </Field>
        <div>
          <Checkbox
            checked={form.acceptTerms}
            onChange={(v) => set('acceptTerms', v)}
            label={
              <>
                I accept the <Link to="/terms" target="_blank">Terms of Use</Link>
              </>
            }
          />
          {errors.acceptTerms ? <p className="field__error">{errors.acceptTerms}</p> : null}
        </div>
        {errors.form ? <div className="callout callout--danger" role="alert">{errors.form}</div> : null}
        <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<UserPlus size={15} />}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
