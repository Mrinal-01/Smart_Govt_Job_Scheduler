import { useCallback, useEffect, useState } from 'react'
import { Bot, KeyRound, Laptop, LogOut, Repeat, Save, ShieldCheck, Smartphone, User } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, LoadingBlock, Select, Toggle } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { useStudy } from '../../store/StudyStore'
import { ApiError, api, errorMessage, setAccessToken } from '../../lib/http'
import { PasswordRules, passwordProblems } from '../auth/AuthShared'
import { formatPhone } from '../../lib/phone'

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
        <Field label="Mobile number" hint="You sign in with this number and a one-time code. Changing it is not supported yet.">
          <Input value={user.phone ? formatPhone(user.phone) : 'Not set — ask the operator to attach one'} readOnly />
        </Field>
        {user.email ? (
          <Field label="Email (legacy account)">
            <Input value={user.email} readOnly />
          </Field>
        ) : null}
      </div>
      <div className="pill-row" style={{ marginTop: 12 }}>
        <Badge tone={user.phoneVerified ? 'success' : 'warning'} dot>
          {user.phoneVerified ? 'Mobile verified' : 'Mobile not verified yet'}
        </Badge>
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
    const problems = passwordProblems(pw.next, user?.email ?? '')
    if (!pw.current) return setPwError('Enter your current password.')
    if (problems.length) return setPwError(problems[0])
    if (pw.next !== pw.confirm) return setPwError('Passwords do not match.')
    setBusy(true)
    setPwError('')
    try {
      const r = await api<{ accessToken: string }>('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: pw.current, newPassword: pw.next, confirmPassword: pw.confirm }
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
                    Signed in {new Date(s.createdAt).toLocaleString()} · last active {new Date(s.lastUsedAt).toLocaleString()}
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
      {user?.hasPassword ? (
      <Card>
        <CardHeader title="Change password" subtitle="Legacy email accounts only — changing it signs out every other device" icon={<KeyRound size={15} />} />
        <div className="grid grid--3" style={{ gap: 12 }}>
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password">
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
        </div>
        <PasswordRules password={pw.next} email={user?.email ?? ''} />
        {pwError ? <div className="callout callout--danger" style={{ marginTop: 10 }}>{pwError}</div> : null}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <Button variant="primary" loading={busy} onClick={changePassword} disabled={!pw.next}>
            Update password
          </Button>
        </div>
      </Card>
      ) : null}
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

/* ------------------- Study plan: cycles, gates, calendar ------------------- */

interface PlanSettings {
  timezone: string
  cycle: { cyclesPerDay: number; sessionMinutes: number; breakMinutes: number }
  plan: {
    sameDayRevisionMinutes: number
    nextDayRevisionEnabled: boolean
    nextDayRevisionMinutes: number
    carryoverScope: 'per_subject' | 'all_subjects'
    weeklyRevisionMinutes: number
    weeklyReviewWeekday: number
    restWeekdays: number[]
    holidays: string[]
    requirePracticeInRevision: boolean
  }
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC']

function isValidZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function PlanPreferencesSection() {
  const { notify } = useStudy()
  const [cfg, setCfg] = useState<PlanSettings | null>(null)
  const [holiday, setHoliday] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    api<{ settings: PlanSettings }>('/api/settings')
      .then((r) => setCfg({ timezone: r.settings.timezone, cycle: r.settings.cycle, plan: r.settings.plan }))
      .catch((err) => notify({ title: 'Could not load study plan settings', message: errorMessage(err), variant: 'error' }))
  }, [notify])
  if (!cfg) return <Card><LoadingBlock /></Card>

  const num = (v: string) => (v === '' ? NaN : Number(v))
  const setCycle = (k: keyof PlanSettings['cycle'], v: string) => setCfg({ ...cfg, cycle: { ...cfg.cycle, [k]: num(v) } })
  const setPlan = <K extends keyof PlanSettings['plan']>(k: K, v: PlanSettings['plan'][K]) => setCfg({ ...cfg, plan: { ...cfg.plan, [k]: v } })

  const validate = () => {
    const e: Record<string, string> = {}
    const range = (key: string, v: number, min: number, max: number) => {
      if (!Number.isInteger(v) || v < min || v > max) e[key] = `Whole number ${min}–${max}`
    }
    range('cyclesPerDay', cfg.cycle.cyclesPerDay, 1, 8)
    range('sessionMinutes', cfg.cycle.sessionMinutes, 10, 300)
    range('breakMinutes', cfg.cycle.breakMinutes, 0, 120)
    range('sameDay', cfg.plan.sameDayRevisionMinutes, 1, 180)
    range('nextDay', cfg.plan.nextDayRevisionMinutes, 1, 180)
    range('weekly', cfg.plan.weeklyRevisionMinutes, 1, 300)
    if (!isValidZone(cfg.timezone)) e.timezone = 'Unknown time zone'
    if (cfg.plan.restWeekdays.length > 6) e.rest = 'At least one study day is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const save = async () => {
    if (!validate()) return
    setBusy(true)
    try {
      const r = await api<{ settings: PlanSettings }>('/api/settings', { method: 'PATCH', body: {
          timezone: cfg.timezone,
          // Only the fields this section edits — subject order / per-subject minutes belong to the section above.
          cycle: { cyclesPerDay: cfg.cycle.cyclesPerDay, sessionMinutes: cfg.cycle.sessionMinutes, breakMinutes: cfg.cycle.breakMinutes },
          plan: cfg.plan
        } })
      setCfg({ timezone: r.settings.timezone, cycle: r.settings.cycle, plan: r.settings.plan })
      notify({ title: 'Study plan settings saved', variant: 'success' })
    } catch (err) {
      notify({ title: 'Could not save', message: err instanceof ApiError && err.issues.length ? err.issues[0].message : errorMessage(err), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const addHoliday = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) return
    if (!cfg.plan.holidays.includes(holiday)) setPlan('holidays', [...cfg.plan.holidays, holiday].sort())
    setHoliday('')
  }

  const val = (n: number) => (Number.isNaN(n) ? '' : n)

  return (
    <Card>
      <CardHeader
        title="Study cycles & revision gates"
        subtitle="Server-enforced: these rules decide when scheduled learning sessions unlock"
        icon={<Repeat size={15} />}
      />
      <div className="stack">
        <Field
          label="Study-day time zone"
          hint="Defines when your study day starts and ends (midnight) for sessions, next-day carryover and weekly revision."
          error={errors.timezone}
        >
          <Select value={cfg.timezone} onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}>
            {(TIMEZONES.includes(cfg.timezone) ? TIMEZONES : [cfg.timezone, ...TIMEZONES]).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>

        <p className="field__label">Cycle configuration (used by “Generate cycles” on the schedule)</p>
        <div className="grid grid--3">
          <Field label="Cycles per day" error={errors.cyclesPerDay}>
            <Input type="number" min={1} max={8} value={val(cfg.cycle.cyclesPerDay)} onChange={(e) => setCycle('cyclesPerDay', e.target.value)} />
          </Field>
          <Field label="Session length (min)" error={errors.sessionMinutes}>
            <Input type="number" min={10} max={300} value={val(cfg.cycle.sessionMinutes)} onChange={(e) => setCycle('sessionMinutes', e.target.value)} />
          </Field>
          <Field label="Break between sessions (min)" error={errors.breakMinutes}>
            <Input type="number" min={0} max={120} value={val(cfg.cycle.breakMinutes)} onChange={(e) => setCycle('breakMinutes', e.target.value)} />
          </Field>
        </div>
        <p className="field__hint">Subject order and per-subject revision minutes are set in the section above.</p>

        <p className="field__label">Revision durations</p>
        <div className="grid grid--3">
          <Field label="Same-day revision (min)" hint="Default when a session or subject has none" error={errors.sameDay}>
            <Input type="number" min={1} max={180} value={val(cfg.plan.sameDayRevisionMinutes)} onChange={(e) => setPlan('sameDayRevisionMinutes', num(e.target.value))} />
          </Field>
          <Field label="Next-day carryover (min per subject)" error={errors.nextDay}>
            <Input type="number" min={1} max={180} value={val(cfg.plan.nextDayRevisionMinutes)} onChange={(e) => setPlan('nextDayRevisionMinutes', num(e.target.value))} />
          </Field>
          <Field label="Weekly revision (min per subject)" error={errors.weekly}>
            <Input type="number" min={1} max={300} value={val(cfg.plan.weeklyRevisionMinutes)} onChange={(e) => setPlan('weeklyRevisionMinutes', num(e.target.value))} />
          </Field>
        </div>
        <Toggle
          checked={cfg.plan.nextDayRevisionEnabled}
          onChange={(v) => setPlan('nextDayRevisionEnabled', v)}
          label="Require next-day carryover revision"
          description="Topics you fully completed on the previous study day are revised the next day before new learning."
        />
        {cfg.plan.nextDayRevisionEnabled ? (
          <Field label="How the next-day revision gates learning">
            <Select value={cfg.plan.carryoverScope ?? 'per_subject'} onChange={(e) => setPlan('carryoverScope', e.target.value as PlanSettings['plan']['carryoverScope'])}>
              <option value="per_subject">Per subject — each subject revises its own previous-day topics right before it starts</option>
              <option value="all_subjects">All subjects first — the whole carryover block before any learning</option>
            </Select>
          </Field>
        ) : null}
        <Toggle
          checked={cfg.plan.requirePracticeInRevision}
          onChange={(v) => setPlan('requirePracticeInRevision', v)}
          label="Require practice questions in same-day / next-day revision"
          description="A revision can only be completed after recording at least one attempted question."
        />

        <p className="field__label">Study calendar</p>
        <Field label="Weekly review day">
          <Select value={String(cfg.plan.weeklyReviewWeekday)} onChange={(e) => setPlan('weeklyReviewWeekday', Number(e.target.value))}>
            {WEEKDAY_NAMES.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rest days" hint="No sessions are created; carryover revision falls due on the next study day." error={errors.rest}>
          <div className="row row--wrap" style={{ gap: 10 }}>
            {WEEKDAY_NAMES.map((d, i) => (
              <label key={d} className="row" style={{ gap: 5, fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={cfg.plan.restWeekdays.includes(i)}
                  onChange={(e) => setPlan('restWeekdays', e.target.checked ? [...cfg.plan.restWeekdays, i].sort() : cfg.plan.restWeekdays.filter((x) => x !== i))}
                />
                {d.slice(0, 3)}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Holidays" hint="Specific dates with no study.">
          <div className="stack stack--sm">
            <div className="row" style={{ gap: 8 }}>
              <Input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} style={{ maxWidth: 180 }} />
              <Button size="sm" onClick={addHoliday} disabled={!holiday}>
                Add holiday
              </Button>
            </div>
            {cfg.plan.holidays.length ? (
              <div className="row row--wrap" style={{ gap: 6 }}>
                {cfg.plan.holidays.map((h) => (
                  <span key={h} className="holiday-chip">
                    {h}
                    <button type="button" aria-label={`Remove ${h}`} onClick={() => setPlan('holidays', cfg.plan.holidays.filter((x) => x !== h))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-tertiary" style={{ fontSize: 12 }}>
                No holidays set.
              </span>
            )}
          </div>
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Save size={14} />} loading={busy} onClick={save}>
            Save study plan settings
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
