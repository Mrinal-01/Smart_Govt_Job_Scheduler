import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { MessageSquare, UserPlus } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { ApiError, errorMessage } from '../../lib/http'
import { Button, Checkbox, Field, Input } from '../../components/ui'
import { AuthLayout, DevCode, OtpField, PhoneField, phoneProblem, toE164, useCountdown } from './AuthShared'

type Errors = Partial<Record<'name' | 'phone' | 'otp' | 'acceptTerms', string>>

/** Mirrors the server's name rule. */
function nameProblem(name: string): string | null {
  const n = name.trim()
  if (n.length < 2) return 'Name must be at least 2 characters.'
  if (n.length > 80) return 'Name is too long.'
  if (!/^\p{L}[\p{L} .'-]*$/u.test(n)) return 'Use letters, spaces, dots, apostrophes and hyphens only.'
  return null
}

/** Name + phone + terms → one-time code → account created and signed in. */
export default function RegisterPage() {
  const { requestOtp, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState(() => String((location.state as { phone?: string } | null)?.phone ?? ''))
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'details' | 'code'>('details')
  const [resendAt, setResendAt] = useState<number | null>(null)
  const [devOtp, setDevOtp] = useState<string | undefined>()
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const resendIn = useCountdown(resendAt)

  const mapIssues = (e: ApiError) => {
    const mapped: Errors = {}
    e.issues.forEach((i) => {
      const key = i.path as keyof Errors
      if (['name', 'phone', 'otp', 'acceptTerms'].includes(key) && !mapped[key]) mapped[key] = i.message
    })
    return mapped
  }

  const send = async () => {
    setError(null)
    const v: Errors = {}
    const np = nameProblem(name)
    const pp = phoneProblem(phone)
    if (np) v.name = np
    if (pp) v.phone = pp
    if (!acceptTerms) v.acceptTerms = 'You must accept the terms to create an account.'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      const r = await requestOtp(toE164(phone), 'signup')
      setDevOtp(r.devOtp)
      setOtp('')
      setResendAt(Date.now() + r.resendIn * 1000)
      setStep('code')
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(errorMessage(err), 0)
      if (e.code === 'OTP_COOLDOWN') {
        setResendAt(Date.now() + Number((e.details as { retryAfter?: number })?.retryAfter ?? 60) * 1000)
        setStep('code')
      }
      if (e.issues.length) setErrors(mapIssues(e))
      else setError(e)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (step === 'details') return void send()
    setError(null)
    if (!/^\d{6}$/.test(otp)) return setErrors({ otp: 'Enter the 6-digit code.' })
    setErrors({})
    setBusy(true)
    try {
      await register({ name: name.trim(), phone: toE164(phone), otp, acceptTerms })
      navigate('/', { replace: true })
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(errorMessage(err), 0)
      if (e.issues.length) setErrors(mapIssues(e))
      else setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Sign up with your mobile number — no password needed. Your data syncs securely to your account."
      footer={
        <>
          Already registered? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Full name" htmlFor="reg-name" error={errors.name} required>
          <Input id="reg-name" autoComplete="name" maxLength={80} value={name} disabled={step === 'code'} onChange={(e) => setName(e.target.value)} />
        </Field>
        <PhoneField id="reg-phone" value={phone} disabled={step === 'code'} error={errors.phone} onChange={setPhone} />
        {step === 'details' ? (
          <div>
            <Checkbox
              checked={acceptTerms}
              onChange={setAcceptTerms}
              label={
                <>
                  I accept the{' '}
                  <Link to="/terms" target="_blank">
                    Terms of Use
                  </Link>
                </>
              }
            />
            {errors.acceptTerms ? <p className="field__error">{errors.acceptTerms}</p> : null}
          </div>
        ) : (
          <>
            <p className="auth-step">
              Code sent to <strong>+91 {phone}</strong> ·{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setStep('details')
                  setOtp('')
                  setError(null)
                }}
              >
                Change details
              </button>
            </p>
            <OtpField id="reg-otp" value={otp} onChange={setOtp} error={errors.otp} />
            <DevCode code={devOtp} />
          </>
        )}
        {error ? (
          <div className="callout callout--danger" role="alert">
            <div>
              {error.message}
              {error.code === 'PHONE_IN_USE' ? (
                <div style={{ marginTop: 6 }}>
                  <Link to="/login">Log in with this number</Link>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {step === 'details' ? (
          <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<MessageSquare size={15} />}>
            Send code
          </Button>
        ) : (
          <>
            <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<UserPlus size={15} />}>
              Create account
            </Button>
            <Button type="button" variant="ghost" block disabled={busy || resendIn > 0} onClick={send}>
              {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
            </Button>
          </>
        )}
      </form>
    </AuthLayout>
  )
}
