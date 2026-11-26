import { useCallback, useEffect, useState } from 'react'
import { Bot, KeyRound, Laptop, LogOut, Repeat, Save, ShieldCheck, Smartphone, User } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, LoadingBlock, Select, Toggle } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { useStudy } from '../../store/StudyStore'
import { ApiError, api, errorMessage, setAccessToken } from '../../lib/http'
import { PasswordRules, passwordProblems } from '../auth/AuthShared'

/* ------------------------------ Account ------------------------------ */

export function AccountSection() {
  const { user, setUser } = useAuth()
  const { updateProfile, notify } = useStudy()
  const [name, setName] = useState(user?.name ?? '')
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const save = async () => {
    if (name.trim().length < 2) return notify({ title: 'Name too short', variant: 'error' })
    setBusy(true)
    try {
      const r = await api<{ user: typeof user }>('/api/auth/me', { method: 'PATCH', body: { name: name.trim() } })
      setUser(r.user)
      updateProfile({ name: r.user.name })
      notify({ title: 'Account updated', variant: 'success' })
    } catch (err) {
      notify({ title: 'Could not update', message: errorMessage(err), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader title="Account" subtitle="Your sign-in identity" icon={<User size={15} />} />
      <div className="grid grid--2" style={{ gap: 12 }}>
        <Field label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" hint="Email changes are not supported yet; contact the operator.">
          <Input value={user.email} readOnly />
        </Field>
      </div>
      <div className="pill-row" style={{ marginTop: 12 }}>
        <Badge tone={user.emailVerified ? 'success' : 'warning'} dot>
          {user.emailVerified ? 'Email verified' : 'Email not verified'}
        </Badge>
        <Badge tone={user.googleLinked ? 'info' : 'neutral'} dot>
          {user.googleLinked ? 'Google linked' : 'Google not linked'}
        </Badge>
        <Badge dot>{user.hasPassword ? 'Password set' : 'Google-only sign-in'}</Badge>
        <Badge dot>Member since {new Date(user.createdAt).toLocaleDateString()}</Badge>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <Button variant="primary" icon={<Save size={14} />} loading={busy} onClick={save} disabled={name.trim() === user.name}>
          Save
        </Button>
      </div>
    </Card>
  )
}

/* -------------------------- Security & sessions ------------------------ */

interface SessionRow {
  id: string
  userAgent: string
  ip: string
  authMethod: string
  createdAt: string
  lastUsedAt: string
  current: boolean
}

function deviceLabel(ua: string) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS'
  return `${browser} on ${os}`
}

export function SecuritySection() {
  const { user, logoutAll } = useAuth()
  const { notify } = useStudy()
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)

  const load = useCallback(async () => {
    try {
      setSessions((await api<{ sessions: SessionRow[] }>('/api/auth/sessions')).sessions)
    } catch (err) {
      notify({ title: 'Could not load sessions', message: errorMessage(err), variant: 'error' })
    }
  }, [notify])
  useEffect(() => {
    void load()
  }, [load])

  const changePassword = async () => {
    const problems = passwordProblems(pw.next, user?.email)
    if (user?.hasPassword && !pw.current) return setPwError('Enter your current password.')
    if (problems.length) return setPwError(problems[0])
    if (pw.next !== pw.confirm) return setPwError('Passwords do not match.')
    setBusy(true)
    setPwError('')
    try {
      const r = await api<{ accessToken: string }>('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: pw.current || 'not-set', newPassword: pw.next, confirmPassword: pw.confirm }
      })
      setAccessToken(r.accessToken)
      setPw({ current: '', next: '', confirm: '' })
      notify({ title: 'Password changed', message: 'Other devices were signed out.', variant: 'success' })
      await load()
    } catch (err) {
      setPwError(err instanceof ApiError && err.issues.length ? err.issues[0].message : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Active sessions" subtitle="Devices currently signed in to your account" icon={<ShieldCheck size={15} />} />
        {!sessions ? (
          <LoadingBlock />
        ) : (
          <div>
            {sessions.map((s) => (
              <div key={s.id} className="session-row">
                {/android|iphone|ipad/i.test(s.userAgent) ? <Smartphone size={16} /> : <Laptop size={16} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{deviceLabel(s.userAgent)}</strong> {s.current ? <Badge tone="success" size="sm">This device</Badge> : null}
                  <div className="text-tertiary" style={{ fontSize: 12 }}>
                    {s.authMethod === 'google' ? 'Google' : 'Password'} · signed in {new Date(s.createdAt).toLocaleString()} · last active {new Date(s.lastUsedAt).toLocaleString()}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </div>
                </div>
                {!s.current ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' })
                        await load()
                      } catch (err) {
                        notify({ title: 'Could not sign out device', message: errorMessage(err), variant: 'error' })
                      }
                    }}
                  >
                    Sign out
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <Button variant="danger" icon={<LogOut size={14} />} onClick={() => setConfirmAll(true)}>
            Sign out everywhere
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={user?.hasPassword ? 'Change password' : 'Set a password'} subtitle="Changing it signs out every other device" icon={<KeyRound size={15} />} />
        <div className="grid grid--3" style={{ gap: 12 }}>
          {user?.hasPassword ? (
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
          ) : null}
          <Field label="New password">
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
        </div>
        <PasswordRules password={pw.next} email={user?.email} />
        {pwError ? <div className="callout callout--danger" style={{ marginTop: 10 }}>{pwError}</div> : null}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <Button variant="primary" loading={busy} onClick={changePassword} disabled={!pw.next}>
            Update password
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Sign out of every device?"
        message="All sessions, including this one, end immediately."
        confirmLabel="Sign out everywhere"
        onConfirm={() => void logoutAll()}
      />
    </>
  )
}

/* ------------------------- Schedule change policy ---------------------- */

export function SchedulePolicySection() {
  const [data, setData] = useState<{ policy: { maxChanges: number; windowDays: number }; usage: { used: number; remaining: number; nextAvailableAt: string | null; overridesInWindow: number } } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<typeof data>('/api/schedule')
      .then(setData)
      .catch((err) => setError(errorMessage(err)))
  }, [])
  return (
    <Card>
      <CardHeader title="Schedule change policy" subtitle="Set by the administrator for discipline — not editable by students" icon={<Repeat size={15} />} />
      {error ? <div className="callout callout--danger">{error}</div> : null}
      {!data ? (
        !error ? <LoadingBlock /> : null
      ) : (
        <div className="stack">
          <ul className="plain-list">
            <li>
              <span>Published changes allowed</span>
              <strong>
                {data.policy.maxChanges} per rolling {data.policy.windowDays} days
              </strong>
            </li>
            <li>
              <span>Used now</span>
              <strong>
                {data.usage.used} ({data.usage.remaining} remaining)
              </strong>
            </li>
            <li>
              <span>Next change available</span>
              <strong>{data.usage.nextAvailableAt ? new Date(data.usage.nextAvailableAt).toLocaleString() : 'Now'}</strong>
            </li>
            <li>
              <span>Emergency overrides in this window</span>
              <strong>{data.usage.overridesInWindow}</strong>
            </li>
          </ul>
          <div className="callout callout--neutral">
            Editing an unpublished draft, completing or skipping sessions never counts. The first publish is free. New versions apply from tomorrow (or a later date you
            choose) so past and current-day sessions are never altered. Emergency overrides are always allowed with a written reason and are recorded in your history.
          </div>
        </div>
      )}
    </Card>
  )
}

/* ------------------------- Revision preferences ------------------------ */

interface CycleSettings {
  subjectIds: string[]
  defaultRevisionMinutes: number
  revisionMinutesBySubject: Record<string, number>
  revisionMinutesPerTopic: number
  maxTopicsPerRevisionBlock: number
  revisionMandatory: boolean
}

export function RevisionPreferencesSection() {
  const { state, notify } = useStudy()
  const [cfg, setCfg] = useState<CycleSettings | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<{ settings: { cycle: CycleSettings } }>('/api/settings')
      .then((r) => setCfg(r.settings.cycle))
      .catch((err) => notify({ title: 'Could not load preferences', message: errorMessage(err), variant: 'error' }))
  }, [notify])
  if (!cfg) return <Card><LoadingBlock /></Card>
  const order = cfg.subjectIds.length ? cfg.subjectIds : state.subjects.map((s) => s.id)
  const save = async () => {
    setBusy(true)
    try {
      const r = await api<{ settings: { cycle: CycleSettings } }>('/api/settings', { method: 'PATCH', body: { cycle: { ...cfg, subjectIds: order } } })
      setCfg(r.settings.cycle)
      notify({ title: 'Revision preferences saved', variant: 'success' })
    } catch (err) {
      notify({ title: 'Could not save', message: errorMessage(err), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const move = (id: string, dir: -1 | 1) => {
    const list = [...order]
    const i = list.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    setCfg({ ...cfg, subjectIds: list })
  }
  return (
    <Card>
      <CardHeader title="Study cycle & revision preferences" subtitle="Used when a new cycle prepares revision before learning" icon={<Repeat size={15} />} />
      <div className="stack">
        <Field label="Cycle subjects (in order)" hint="Untick a subject to leave it out of cycles.">
          <div className="stack stack--sm">
            {state.subjects.map((s) => {
              const included = order.includes(s.id)
              return (
                <div key={s.id} className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={included}
                    aria-label={`Include ${s.name}`}
                    onChange={(e) => setCfg({ ...cfg, subjectIds: e.target.checked ? [...order, s.id] : order.filter((x) => x !== s.id) })}
                  />
                  <span style={{ flex: 1 }}>{s.name}</span>
                  {included ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => move(s.id, -1)} aria-label={`Move ${s.name} up`}>
                        ↑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => move(s.id, 1)} aria-label={`Move ${s.name} down`}>
                        ↓
                      </Button>
                      <Input
                        type="number"
                        min={0}
                        max={180}
                        style={{ width: 90 }}
                        aria-label={`${s.name} revision minutes`}
                        placeholder={`${cfg.defaultRevisionMinutes}`}
                        value={cfg.revisionMinutesBySubject[s.id] ?? ''}
                        onChange={(e) => {
                          const next = { ...cfg.revisionMinutesBySubject }
                          if (e.target.value === '') delete next[s.id]
                          else next[s.id] = Math.max(0, Math.min(180, Number(e.target.value) || 0))
                          setCfg({ ...cfg, revisionMinutesBySubject: next })
                        }}
                      />
                      <span className="text-tertiary" style={{ fontSize: 12 }}>min</span>
                    </>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Field>
        <div className="grid grid--3">
          <Field label="Default revision block (min)">
            <Input type="number" min={0} max={180} value={cfg.defaultRevisionMinutes} onChange={(e) => setCfg({ ...cfg, defaultRevisionMinutes: Math.max(0, Math.min(180, Number(e.target.value) || 0)) })} />
          </Field>
          <Field label="Suggested time per topic (min)">
            <Input type="number" min={1} max={60} value={cfg.revisionMinutesPerTopic} onChange={(e) => setCfg({ ...cfg, revisionMinutesPerTopic: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="Max topics per revision block" hint="Extra topics wait for the next cycle">
            <Input type="number" min={1} max={50} value={cfg.maxTopicsPerRevisionBlock} onChange={(e) => setCfg({ ...cfg, maxTopicsPerRevisionBlock: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
          </Field>
        </div>
        <Toggle
          checked={cfg.revisionMandatory}
          onChange={(v) => setCfg({ ...cfg, revisionMandatory: v })}
          label="Revision is mandatory before new learning"
          description="When off, you may start learning with revision pending; unrevised topics go to the carry-forward queue."
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Save size={14} />} loading={busy} onClick={save}>
            Save preferences
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ------------------------------- AI usage ------------------------------ */

export function AiUsageSection() {
  const { notify } = useStudy()
  const [status, setStatus] = useState<{ configured: boolean; provider: string | null; model: string | null; enabledForUser: boolean; usage: { used: number; limit: number; remaining: number } } | null>(null)
  const [autoMistakes, setAutoMistakes] = useState<boolean | null>(null)
  const load = useCallback(async () => {
    const [s, settings] = await Promise.all([
      api<NonNullable<typeof status>>('/api/ai/status'),
      api<{ settings: { exams: { autoAddMistakes: boolean } } }>('/api/settings')
    ])
    setStatus(s)
    setAutoMistakes(settings.settings.exams.autoAddMistakes)
  }, [])
  useEffect(() => {
    load().catch((err) => notify({ title: 'Could not load AI status', message: errorMessage(err), variant: 'error' }))
  }, [load, notify])
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api('/api/settings', { method: 'PATCH', body })
      await load()
    } catch (err) {
      notify({ title: 'Could not save', message: errorMessage(err), variant: 'error' })
    }
  }
  if (!status) return <Card><LoadingBlock /></Card>
  return (
    <>
      <Card>
        <CardHeader title="AI features" subtitle="All AI calls run on the server; no API key ever reaches the browser" icon={<Bot size={15} />} />
        <div className="stack">
          <ul className="plain-list">
            <li>
              <span>Server AI provider</span>
              <strong>{status.configured ? `${status.provider} · ${status.model}` : 'Not configured'}</strong>
            </li>
            <li>
              <span>Requests used today</span>
              <strong>
                {status.usage.used} / {status.usage.limit}
              </strong>
            </li>
          </ul>
          {!status.configured ? (
            <div className="callout callout--neutral">The operator has not configured an AI provider (AI_PROVIDER + API key), so AI features are unavailable. Rule-based tools keep working.</div>
          ) : null}
          <Toggle
            checked={status.enabledForUser}
            onChange={(v) => void patch({ ai: { enabled: v } })}
            label="Allow AI features for my account"
            description="Covers the AI assistant, PDF structuring help, answer explanations and practice generation. Only the minimum study data needed is sent."
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Mock test results" icon={<Bot size={15} />} />
        {autoMistakes !== null ? (
          <Toggle
            checked={autoMistakes}
            onChange={(v) => void patch({ exams: { autoAddMistakes: v } })}
            label="Add verified wrong answers to the Mistake Bank automatically"
            description="Each question appears once; repeats increase its occurrence count."
          />
        ) : null}
      </Card>
    </>
  )
}

export { Select }
