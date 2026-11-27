import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  Clock,
  Database,
  Download,
  GraduationCap,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Settings2,
  Sun,
  Timer,
  Trash2,
  Upload,
  User,
  Volume2,
  Bot,
  Repeat,
  ShieldCheck,
  UserCog
} from 'lucide-react'
import type { SoundChoice } from '../types'
import { CustomSoundsManager, useCustomSounds } from '../components/CustomSounds'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Toggle
} from '../components/ui'
import { useStudy } from '../store/StudyStore'
import { useAuth } from '../auth/AuthContext'
import { AccountSection, AiUsageSection, PlanPreferencesSection, RevisionPreferencesSection, SecuritySection } from './settings/AccountSections'
import { reminderAudio, notifySupported, requestNotificationPermission } from '../services/audio'
import { downloadCSV, downloadJSON } from '../lib/utils'
import { formatDuration } from '../lib/date'
import { cx } from '../lib/utils'
import { formatPhone } from '../lib/phone'

type Section = 'account' | 'profile' | 'study' | 'revision' | 'reminders' | 'ai' | 'appearance' | 'data'

const SECTIONS: Array<{ key: Section; label: string; icon: React.ReactNode }> = [
  { key: 'account', label: 'Account & security', icon: <UserCog size={14} /> },
  { key: 'profile', label: 'Profile & exam', icon: <User size={14} /> },
  { key: 'study', label: 'Study targets', icon: <GraduationCap size={14} /> },
  { key: 'revision', label: 'Study cycles & revision', icon: <Repeat size={14} /> },
  { key: 'reminders', label: 'Reminders & sound', icon: <BellRing size={14} /> },
  { key: 'ai', label: 'AI & tests', icon: <Bot size={14} /> },
  { key: 'appearance', label: 'Appearance', icon: <Palette size={14} /> },
  { key: 'data', label: 'Data & backup', icon: <Database size={14} /> }
]

const SOUNDS: Array<{ value: SoundChoice; label: string }> = [
  { value: 'chime', label: 'Chime — rising bell tones' },
  { value: 'bell', label: 'Bell — repeated triangle ping' },
  { value: 'marimba', label: 'Marimba — soft wooden arpeggio' },
  { value: 'ping', label: 'Soft ping — gentle double ping' },
  { value: 'digital', label: 'Digital — watch-style beeps' },
  { value: 'gong', label: 'Gong — one deep resonance' },
  { value: 'pulse', label: 'Pulse — low urgency thump' },
  { value: 'alarm', label: 'Alarm — urgent two-tone' },
  { value: 'none', label: 'Silent — no audio' }
]

export default function SettingsPage() {
  const customSounds = useCustomSounds()
  const {
    state,
    updateProfile,
    updateSettings,
    updateReminder,
    importData,
    simulateOverdue,
    notify
  } = useStudy()

  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const LEGACY: Record<string, Section> = { security: 'account', policy: 'revision', schedule: 'revision' }
  const isSection = (v: string | null): v is Section => SECTIONS.some((x) => x.key === v)
  const sectionFrom = (v: string | null): Section => (isSection(v) ? v : v && LEGACY[v] ? LEGACY[v] : 'account')
  const [section, setSectionState] = useState<Section>(() => sectionFrom(params.get('section')))
  useEffect(() => {
    const p = params.get('section')
    if (p) setSectionState(sectionFrom(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])
  const setSection = (s: Section) => {
    setSectionState(s)
    setParams({ section: s }, { replace: true })
  }
  const [permission, setPermission] = useState<string>(() =>
    notifySupported() ? Notification.permission : 'unsupported'
  )
  const [name, setName] = useState(state.profile.name)
  const email = user?.email ?? state.profile.email
  const phone = user?.phone ? formatPhone(user.phone) : ''
  const fileRef = useRef<HTMLInputElement>(null)

  const s = state.settings
  const r = s.reminder

  const exportAll = () => {
    downloadJSON(`studyos-backup-${new Date().toISOString().slice(0, 10)}.json`, state)
    notify({ title: 'Backup exported', message: 'Full study state saved as JSON.', variant: 'success' })
  }

  const exportSessionsCsv = () => {
    const rows = Object.values(state.sessions).map((rec) => {
      const slot = state.schedule.find((x) => x.id === rec.slotId)
      return {
        date: rec.date,
        subject: state.subjects.find((x) => x.id === rec.subjectId)?.name ?? '',
        session: slot?.label ?? '',
        start: slot?.startTime ?? '',
        end: slot?.endTime ?? '',
        status: rec.status,
        minutes: rec.completion?.durationMinutes ?? 0,
        topic: rec.completion?.topicName ?? '',
        attempted: rec.completion?.questionsAttempted ?? 0,
        correct: rec.completion?.correctAnswers ?? 0,
        confidence: rec.completion?.confidence ?? ''
      }
    })
    downloadCSV(`studyos-sessions-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    notify({ title: 'Sessions exported', message: `${rows.length} session records as CSV.`, variant: 'success' })
  }

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Settings</h1>
          <p className="page-head__sub">
            Your account, study targets, revision rules, reminders and theme. Your data is stored on the server for your account only.
          </p>
        </div>
        <div className="page-head__actions">
          <Badge tone="neutral" dot>
            {s.timezone}
          </Badge>
          <Badge tone="accent" dot>
            {state.profile.targetExam}
          </Badge>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((sec) => (
            <button
              key={sec.key}
              className={cx('settings-nav__item', section === sec.key && 'is-active')}
              onClick={() => setSection(sec.key)}
            >
              {sec.icon}
              {sec.label}
            </button>
          ))}
        </nav>

        <div className="stack">
          {section === 'account' ? (
            <div className="stack">
              <AccountSection />
              <SecuritySection />
            </div>
          ) : null}
          {section === 'revision' ? (
            <div className="stack">
              <RevisionPreferencesSection />
              <PlanPreferencesSection />
            </div>
          ) : null}
          {section === 'ai' ? <AiUsageSection /> : null}
          {section === 'profile' ? (
            <Card>
              <CardHeader title="Profile & examination target" subtitle="Used across the dashboard, reports and the AI assistant context" icon={<User size={15} />} />
              <div className="grid grid--2" style={{ gap: 12 }}>
                <Field label="Full name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Mobile number" hint="Your sign-in number (see Account)">
                  <Input type="tel" value={phone || email} readOnly />
                </Field>
                <Field label="Target examination">
                  <Select value={s.examTarget} onChange={(e) => updateSettings({ examTarget: e.target.value })}>
                    <option>RRB Group D 2026</option>
                    <option>RRB NTPC 2026</option>
                    <option>SSC CGL 2026</option>
                    <option>SSC CHSL 2026</option>
                    <option>State PSC — Combined</option>
                    <option>State Police Constable</option>
                    <option>Bank PO / Clerk</option>
                  </Select>
                </Field>
                <Field label="Exam date" hint="Powers the countdown on the dashboard">
                  <Input
                    type="date"
                    value={state.profile.examDate ?? ''}
                    onChange={(e) => updateProfile({ examDate: e.target.value || null })}
                  />
                </Field>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <Button
                  variant="primary"
                  icon={<Save size={14} />}
                  onClick={() => {
                    if (name.trim().length < 2) {
                      notify({ title: 'Name too short', message: 'Enter at least 2 characters.', variant: 'error' })
                      return
                    }
                    updateProfile({ name: name.trim(), email })
                    notify({ title: 'Profile saved', message: 'Your details were updated.', variant: 'success' })
                  }}
                >
                  Save profile
                </Button>
              </div>
            </Card>
          ) : null}

          {section === 'study' ? (
            <Card>
              <CardHeader title="Study targets" subtitle="Consistency and readiness are measured against these targets" icon={<GraduationCap size={15} />} />
              <div className="settings-row">
                <div>
                  <p className="settings-row__label">Weekly study target</p>
                  <p className="settings-row__hint">Shown in the sidebar progress card. Currently {formatDuration(s.weeklyTargetMinutes)}.</p>
                </div>
                <div className="settings-row__control">
                  <Input
                    type="number"
                    min={300}
                    max={6000}
                    step={60}
                    value={s.weeklyTargetMinutes}
                    onChange={(e) => updateSettings({ weeklyTargetMinutes: Number(e.target.value) || 2700 })}
                  />
                  <span className="text-tertiary" style={{ fontSize: 11.5 }}>min</span>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <p className="settings-row__label">Spaced-repetition intervals</p>
                  <p className="settings-row__hint">
                    Days between revisions. Applied to every new revision: {s.revisionIntervals.join(' → ')} days.
                  </p>
                </div>
                <div className="settings-row__control">
                  <div className="row" style={{ gap: 5 }}>
                    {s.revisionIntervals.map((v, i) => (
                      <Input
                        key={i}
                        type="number"
                        min={1}
                        max={180}
                        value={v}
                        style={{ width: 54, textAlign: 'center' }}
                        onChange={(e) => {
                          const next = [...s.revisionIntervals]
                          next[i] = Math.max(1, Number(e.target.value) || 1)
                          updateSettings({ revisionIntervals: next })
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}


          {section === 'reminders' ? (
            <>
              <Card>
                <CardHeader
                  title="Reminder & accountability"
                  subtitle="Foreground engine: end-of-session detection, grace period, repeat interval, looping sound"
                  icon={<BellRing size={15} />}
                  actions={<Badge tone={r.enabled && !r.quietMode ? 'success' : 'neutral'} dot>{r.enabled ? (r.quietMode ? 'Quiet mode' : 'Active') : 'Disabled'}</Badge>}
                />
                <div className="stack">
                  <Toggle
                    checked={r.enabled}
                    onChange={(v) => updateReminder({ enabled: v })}
                    label="Enable session reminders"
                    description="Alert when a scheduled session reaches its end time without a completion update."
                  />
                  <div className="divider" style={{ margin: 0 }} />
                  <Toggle
                    checked={r.quietMode}
                    onChange={(v) => updateReminder({ quietMode: v })}
                    label="Quiet mode / emergency pause"
                    description="Silences every reminder without deleting reminder history. Sessions still become overdue."
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title="Timing" subtitle="Grace period and repeat cadence" icon={<Timer size={15} />} />
                <div className="settings-row">
                  <div>
                    <p className="settings-row__label">Grace period</p>
                    <p className="settings-row__hint">Minutes after the scheduled end before a session is marked overdue.</p>
                  </div>
                  <div className="settings-row__control">
                    <div className="range-row">
                      <input
                        type="range"
                        min={0}
                        max={45}
                        step={5}
                        value={r.graceMinutes}
                        onChange={(e) => updateReminder({ graceMinutes: Number(e.target.value) })}
                        aria-label="Grace period"
                      />
                      <span className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 34 }}>
                        {r.graceMinutes}m
                      </span>
                    </div>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <p className="settings-row__label">Repeat interval</p>
                    <p className="settings-row__hint">Re-alert cadence while the session stays incomplete. Also used by the Snooze button.</p>
                  </div>
                  <div className="settings-row__control">
                    <div className="range-row">
                      <input
                        type="range"
                        min={1}
                        max={30}
                        value={r.repeatMinutes}
                        onChange={(e) => updateReminder({ repeatMinutes: Number(e.target.value) })}
                        aria-label="Repeat interval"
                      />
                      <span className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 34 }}>
                        {r.repeatMinutes}m
                      </span>
                    </div>
                  </div>
                </div>
                <div className="callout callout--neutral" style={{ marginTop: 10 }}>
                  <AlertTriangle size={13} />
                  <span style={{ fontSize: 11.5 }}>
                    Browser timers only run while this tab is open. Reminders cannot fire when the browser is closed, the tab is discarded, or the device
                    sleeps — that requires server-side scheduling, Web Push and a service worker.
                  </span>
                </div>
              </Card>

              <Card>
                <CardHeader title="Sound & notifications" icon={<Volume2 size={15} />} />
                <div className="settings-row">
                  <div>
                    <p className="settings-row__label">Alert sound</p>
                    <p className="settings-row__hint">Built-in tones play instantly; you can also upload your own below.</p>
                  </div>
                  <div className="settings-row__control" style={{ gap: 6 }}>
                    <Select
                      value={r.sound}
                      onChange={(e) => {
                        const v = e.target.value as SoundChoice
                        updateReminder({ sound: v })
                        reminderAudio.setConfig(v, r.volume)
                        if (v !== 'none') reminderAudio.playOnce(v, r.volume)
                      }}
                      style={{ maxWidth: 210 }}
                    >
                      <optgroup label="Built-in">
                        {SOUNDS.map((so) => (
                          <option key={so.value} value={so.value}>
                            {so.label}
                          </option>
                        ))}
                      </optgroup>
                      {customSounds.sounds.length ? (
                        <optgroup label="Your sounds">
                          {customSounds.sounds.map((cs) => (
                            <option key={cs.id} value={`custom:${cs.id}`}>
                              {cs.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {r.sound.startsWith('custom:') && !customSounds.sounds.some((cs) => r.sound === `custom:${cs.id}`) ? (
                        <option value={r.sound}>Uploaded sound (loading…)</option>
                      ) : null}
                    </Select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        reminderAudio.setConfig(r.sound, r.volume)
                        reminderAudio.playOnce(r.sound, r.volume)
                      }}
                      disabled={r.sound === 'none'}
                    >
                      Test
                    </Button>
                  </div>
                </div>
                <div className="settings-row" style={{ display: 'block' }}>
                  <CustomSoundsManager
                    data={customSounds}
                    selected={r.sound}
                    volume={r.volume}
                    onSelect={(v) => {
                      updateReminder({ sound: v })
                      reminderAudio.setConfig(v, r.volume)
                    }}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <p className="settings-row__label">Volume</p>
                    <p className="settings-row__hint">{Math.round(r.volume * 100)}%</p>
                  </div>
                  <div className="settings-row__control">
                    <div className="range-row">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(r.volume * 100)}
                        onChange={(e) => {
                          const v = Number(e.target.value) / 100
                          updateReminder({ volume: v })
                          reminderAudio.setConfig(r.sound, v)
                        }}
                        aria-label="Volume"
                      />
                      <Volume2 size={14} className="text-tertiary" />
                    </div>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <p className="settings-row__label">Browser notifications</p>
                    <p className="settings-row__hint">
                      Permission: <strong>{permission}</strong>
                      {permission === 'denied' ? ' — enable it in your browser site settings.' : ''}
                    </p>
                  </div>
                  <div className="settings-row__control">
                    <Toggle
                      checked={r.browserNotifications && permission === 'granted'}
                      onChange={async (v) => {
                        if (v) {
                          const p = await requestNotificationPermission()
                          setPermission(p)
                          if (p === 'granted') {
                            updateReminder({ browserNotifications: true })
                            notify({ title: 'Notifications enabled', message: 'You will get a system alert for overdue sessions.', variant: 'success' })
                          } else {
                            updateReminder({ browserNotifications: false })
                            notify({ title: 'Permission not granted', message: 'The in-app overlay and sound still work.', variant: 'warning' })
                          }
                        } else {
                          updateReminder({ browserNotifications: false })
                        }
                      }}
                      label="Enabled"
                      disabled={!notifySupported()}
                    />
                  </div>
                </div>
                <div className="row" style={{ gap: 7, marginTop: 10 }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Bell size={13} />}
                    onClick={async () => {
                      const p = await requestNotificationPermission()
                      setPermission(p)
                      notify({
                        title: 'Permission check',
                        message: p === 'granted' ? 'Browser notifications are allowed.' : `Current permission: ${p}`,
                        variant: p === 'granted' ? 'success' : 'warning'
                      })
                    }}
                  >
                    Request permission
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Volume2 size={13} />}
                    onClick={() => {
                      reminderAudio.setConfig(r.sound, r.volume)
                      reminderAudio.playOnce(r.sound, r.volume)
                    }}
                    disabled={r.sound === 'none'}
                  >
                    Preview loop
                  </Button>
                </div>
                <div className="divider" />
                <div className="row row--between row--wrap" style={{ gap: 10 }}>
                  <div>
                    <p className="settings-row__label">Test the accountability loop</p>
                    <p className="settings-row__hint">
                      Forces the next open session into <strong>overdue</strong> so you can verify the overlay, the looping sound,
                      Snooze and Skip-with-reason — at any hour of the day.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<BellRing size={13} />}
                    onClick={() => {
                      const key = simulateOverdue()
                      if (!key) {
                        notify({ title: 'No session to mark', message: 'Add a session to today’s schedule first.', variant: 'warning' })
                        return
                      }
                      if (r.quietMode) {
                        notify({ title: 'Quiet mode is on', message: 'The session is overdue, but sound is muted. Turn quiet mode off to hear it.', variant: 'warning' })
                        return
                      }
                      reminderAudio.start(r.sound, r.volume)
                      notify({ title: 'Reminder triggered', message: 'Session marked overdue — observe the overlay and sound.', variant: 'info' })
                    }}
                  >
                    Trigger reminder now
                  </Button>
                </div>
              </Card>
            </>
          ) : null}

          {section === 'appearance' ? (
            <Card>
              <CardHeader title="Appearance" subtitle="Light theme is the product default" icon={<Palette size={15} />} />
              <div className="settings-row">
                <div>
                  <p className="settings-row__label">Theme</p>
                  <p className="settings-row__hint">Dark mode respects contrast tokens; “System” follows your OS preference.</p>
                </div>
                <div className="settings-row__control">
                  <div className="segmented">
                    <button className={cx('segmented__item', s.theme === 'light' && 'is-active')} onClick={() => updateSettings({ theme: 'light' })}>
                      <Sun size={13} /> Light
                    </button>
                    <button className={cx('segmented__item', s.theme === 'dark' && 'is-active')} onClick={() => updateSettings({ theme: 'dark' })}>
                      <Moon size={13} /> Dark
                    </button>
                    <button className={cx('segmented__item', s.theme === 'system' && 'is-active')} onClick={() => updateSettings({ theme: 'system' })}>
                      <Settings2 size={13} /> System
                    </button>
                  </div>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <p className="settings-row__label">Compact sidebar</p>
                  <p className="settings-row__hint">Icon-only navigation for narrower screens. Mobile always uses the drawer.</p>
                </div>
                <div className="settings-row__control">
                  <Toggle checked={s.compactSidebar} onChange={(v) => updateSettings({ compactSidebar: v })} label="Compact sidebar" />
                </div>
              </div>
            </Card>
          ) : null}

          {section === 'data' ? (
            <>
              <Card>
                <CardHeader title="Export" subtitle="Your data belongs to you — take it anywhere" icon={<Download size={15} />} />
                <div className="row row--wrap" style={{ gap: 8 }}>
                  <Button variant="secondary" icon={<Download size={14} />} onClick={exportAll}>
                    Export full backup (JSON)
                  </Button>
                  <Button variant="secondary" icon={<Download size={14} />} onClick={exportSessionsCsv}>
                    Export sessions (CSV)
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Download size={14} />}
                    onClick={() => {
                      const rows = state.mistakes.map((m) => ({
                        date: m.date,
                        subject: state.subjects.find((s2) => s2.id === m.subjectId)?.name ?? '',
                        question: m.question,
                        yourAnswer: m.userAnswerIndex !== null ? m.options[m.userAnswerIndex] : '',
                        correctAnswer: m.options[m.correctAnswerIndex],
                        category: m.category,
                        status: m.status
                      }))
                      downloadCSV(`studyos-mistakes-${new Date().toISOString().slice(0, 10)}.csv`, rows)
                      notify({ title: 'Mistakes exported', message: `${rows.length} rows as CSV.`, variant: 'success' })
                    }}
                  >
                    Export mistakes (CSV)
                  </Button>
                </div>
                <div className="divider" />
                <p className="field__label" style={{ marginBottom: 6 }}>Import a backup</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const text = await file.text()
                    importData(text)
                    e.target.value = ''
                  }}
                />
                <Button variant="secondary" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
                  Choose JSON file
                </Button>
              </Card>

            </>
          ) : null}
        </div>
      </div>

    </main>
  )
}

