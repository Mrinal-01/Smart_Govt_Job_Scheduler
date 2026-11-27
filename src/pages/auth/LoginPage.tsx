import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, MessageSquare } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { ApiError, errorMessage } from '../../lib/http'
import { Button } from '../../components/ui'
import { AuthLayout, DevCode, OtpField, PhoneField, phoneProblem, toE164, useCountdown } from './AuthShared'

/** Phone → one-time code → signed in. */
export default function LoginPage() {
  const { requestOtp, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [resendAt, setResendAt] = useState<number | null>(null)
  const [devOtp, setDevOtp] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<{ phone?: string; otp?: string }>({})
  const [error, setError] = useState<ApiError | null>(null)
  const resendIn = useCountdown(resendAt)

  const send = async () => {
    setError(null)
    const problem = phoneProblem(phone)
    setFieldError({ phone: problem ?? undefined })
    if (problem) return
    setBusy(true)
    try {
      const r = await requestOtp(toE164(phone), 'login')
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
      if (e.issues.length) setFieldError({ phone: e.issues[0].message })
      else setError(e)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (step === 'phone') return void send()
    setError(null)
    if (!/^\d{6}$/.test(otp)) return setFieldError({ otp: 'Enter the 6-digit code.' })
    setFieldError({})
    setBusy(true)
    try {
      await login(toE164(phone), otp)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(errorMessage(err), 0))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Log in"
      subtitle="Use the mobile number you signed up with. We’ll text you a one-time code."
      footer={
        <>
          New to StudyOS? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form className="stack" onSubmit={verify} noValidate>
        <PhoneField
          id="login-phone"
          value={phone}
          disabled={step === 'code'}
          error={fieldError.phone}
          onChange={(v) => {
            setPhone(v)
            setFieldError({})
          }}
        />
        {step === 'code' ? (
          <>
            <p className="auth-step">
              Code sent to <strong>+91 {phone}</strong> ·{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setStep('phone')
                  setOtp('')
                  setError(null)
                }}
              >
                Change number
              </button>
            </p>
            <OtpField id="login-otp" value={otp} onChange={setOtp} error={fieldError.otp} />
            <DevCode code={devOtp} />
          </>
        ) : null}
        {error ? (
          <div className="callout callout--danger" role="alert">
            <div>
              {error.message}
              {error.code === 'PHONE_NOT_REGISTERED' ? (
                <div style={{ marginTop: 6 }}>
                  <Link to="/register" state={{ phone }}>
                    Sign up with this number
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {step === 'phone' ? (
          <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<MessageSquare size={15} />}>
            Send code
          </Button>
        ) : (
          <>
            <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<LogIn size={15} />}>
              Log in
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
