import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle, ArrowRight, BellRing, Check, Clock, Volume2, VolumeX } from 'lucide-react'
import { Header, Sidebar } from './components/AppShell'
import { Badge, Button, ToastStack } from './components/ui'
import { SessionWorkflowHost } from './components/sessions'
import { useStudy } from './store/StudyStore'
import { evaluateReminders } from './services/reminder'
import { reminderAudio, sendBrowserNotification } from './services/audio'
import { dateKey, formatDuration, minutesFromTime, nowMinutes, weekdayOf, formatTime } from './lib/date'
import { cx } from './lib/utils'
import { chapterById, sessionViewsForDate, subjectById, topicById } from './store/selectors'

import DashboardPage from './pages/DashboardPage'
import SchedulePage from './pages/SchedulePage'
import SessionsPage from './pages/SessionsPage'
import SubjectsPage from './pages/SubjectsPage'
import RevisionPage from './pages/RevisionPage'
import MockTestsPage from './pages/MockTestsPage'
import MistakeBankPage from './pages/MistakeBankPage'
import AnalyticsPage from './pages/AnalyticsPage'
import AssistantPage from './pages/AssistantPage'
import SettingsPage from './pages/SettingsPage'
import SundayPage from './pages/SundayPage'
import NotFoundPage from './pages/NotFoundPage'
import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'
import { ForgotPasswordPage, ResetPasswordPage, TermsPage, VerifyEmailPage } from './pages/auth/AccountRecoveryPages'
import CyclesPage from './pages/CyclesPage'
import TestsHomePage from './pages/tests/TestsHomePage'
import CreateTestPage from './pages/tests/CreateTestPage'
import DocumentReviewPage from './pages/tests/DocumentReviewPage'
import QuestionBankPage from './pages/tests/QuestionBankPage'
import LiveTestPage from './pages/tests/LiveTestPage'
import AttemptResultPage from './pages/tests/AttemptResultPage'
import { useAuth } from './auth/AuthContext'
import { WorkspaceGate } from './workspace/WorkspaceGate'

/* ------------------------------------------------------------------ */
/* Reminder engine — runs in the foreground while the tab is alive.    */
/* ------------------------------------------------------------------ */

function ReminderRuntime() {
  const { state, notify, applyReminderUpdates } = useStudy()
  const [overdueKeys, setOverdueKeys] = useState<string[]>([])
  const [muted, setMuted] = useState(false)
  const lastSignature = useRef<string>('')

  useEffect(() => {
    reminderAudio.setConfig(state.settings.reminder.sound, state.settings.reminder.volume)
  }, [state.settings.reminder.sound, state.settings.reminder.volume])

  // Unlock audio on the first user gesture (browser autoplay policy).
  useEffect(() => {
    const unlock = () => {
      void reminderAudio.unlock()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    const tick = () => {
      const { candidates, updates } = evaluateReminders(state, new Date())
      if (updates.length) applyReminderUpdates(updates)
      // An explicit `overdue` status is authoritative even if the clock has
      // not yet crossed the end time (e.g. the reminder test hook).
      const overdue = candidates.filter((c) => c.stage === 'overdue')
      const persistedOverdue = Object.values(state.sessions)
        .filter((r) => r.date === dateKey() && r.status === 'overdue')
        .map((r) => ({ key: r.key, subjectId: r.subjectId, slotId: r.slotId, stage: 'overdue' as const, minutesOverdue: 0 }))
      const merged = [...overdue, ...persistedOverdue.filter((p) => !overdue.some((o) => o.key === p.key))]
      const keys = merged.map((c) => c.key).sort()
      setOverdueKeys((prev) => (prev.join('|') === keys.join('|') ? prev : keys))

      const signature = keys.join('|')
      if (signature && signature !== lastSignature.current) {
        lastSignature.current = signature
        const candidate = merged[0]
        const slot = state.schedule.find((s) => s.id === candidate.slotId)
        const subject = subjectById(state, candidate.subjectId)
        if (slot && subject) {
          reminderAudio.start(state.settings.reminder.sound, state.settings.reminder.volume)
          if (state.settings.reminder.browserNotifications) {
            sendBrowserNotification(
              `${subject.name} session is overdue`,
              `${slot.label} ended ${formatDuration(candidate.minutesOverdue)} ago. Update or skip it.`,
              `studyos-${candidate.key}`
            )
          }
          notify({
            title: `${subject.name} — session overdue`,
            message: `${slot.label} ended ${formatDuration(candidate.minutesOverdue)} ago.`,
            variant: 'warning'
          })
        }
      }
      if (!signature) lastSignature.current = ''
    }

    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [state, notify, applyReminderUpdates])

  useEffect(() => {
    if (!state.settings.reminder.enabled || state.settings.reminder.quietMode) {
      reminderAudio.stop()
      return
    }
    if (overdueKeys.length && !muted) reminderAudio.start(state.settings.reminder.sound, state.settings.reminder.volume)
    else reminderAudio.stop()
  }, [overdueKeys, muted, state.settings.reminder.enabled, state.settings.reminder.quietMode, state.settings.reminder.sound, state.settings.reminder.volume])

  useEffect(() => () => reminderAudio.stop(), [])

  const first = overdueKeys[0]
  if (!first) return null
  const record = state.sessions[first]
  if (!record) return null
  const slot = state.schedule.find((s) => s.id === record.slotId)
  const subject = subjectById(state, record.subjectId)
  if (!slot || !subject) return null

  const overdueCount = overdueKeys.length
  const minutesOverdue = Math.max(0, nowMinutes() - minutesFromTime(slot.endTime))

  return (
    <ReminderOverlay
      sessionKey={first}
      slotLabel={slot.label}
      subjectName={subject.name}
      minutesOverdue={minutesOverdue}
      extraCount={overdueCount - 1}
      muted={muted}
      onToggleMute={() => setMuted((m) => !m)}
      onDismissSound={() => {
        setMuted(true)
        reminderAudio.stop()
      }}
    />
  )
}

function ReminderOverlay({
  sessionKey,
  slotLabel,
  subjectName,
  minutesOverdue,
  extraCount,
  muted,
  onToggleMute,
  onDismissSound
}: {
  sessionKey: string
  slotLabel: string
  subjectName: string
  minutesOverdue: number
  extraCount: number
  muted: boolean
  onToggleMute: () => void
  onDismissSound: () => void
}) {
  const { snoozeSession, state } = useStudy()
  const [snoozeOpen, setSnoozeOpen] = useState(false)

  return (
    <div className="reminder-overlay" role="alertdialog" aria-label="Session overdue reminder">
      <div className="reminder-card">
        <div className="reminder-card__head">
          <span className="reminder-card__pulse">
            <BellRing size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="reminder-card__eyebrow">Session overdue</p>
            <p className="reminder-card__title">{subjectName}</p>
            <p className="reminder-card__sub">{slotLabel}</p>
          </div>
          <button className="icon-btn is-ghost" onClick={onToggleMute} aria-label={muted ? 'Unmute reminder sound' : 'Mute reminder sound'}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>

        <div className="reminder-card__meta">
          <span className="row" style={{ gap: 5 }}>
            <Clock size={13} /> {formatDuration(minutesOverdue)} past the scheduled end
          </span>
          {extraCount > 0 ? <Badge tone="warning" size="sm">+{extraCount} more overdue</Badge> : null}
        </div>

        <div className="reminder-card__actions">
          <Button variant="primary" size="md" icon={<Check size={14} />} onClick={() => window.dispatchEvent(new CustomEvent('studyos:open-complete', { detail: sessionKey }))}>
            Update now
          </Button>
          <Button size="md" onClick={() => { snoozeSession(sessionKey, state.settings.reminder.repeatMinutes); onDismissSound(); }}>
            Snooze {state.settings.reminder.repeatMinutes}m
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('studyos:open-skip', { detail: sessionKey }))
              onDismissSound()
            }}
          >
            Skip with reason
          </Button>
        </div>

        <p className="reminder-card__note">
          Foreground reminders only — they stop when this tab closes. Background delivery needs Push + a service worker.
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Routing: public auth screens, then the authenticated workspace.     */
/* ------------------------------------------------------------------ */

function FullScreenLoading() {
  return (
    <div className="gate-center">
      <div className="loading-block">
        <span className="spin" style={{ display: 'inline-flex' }}>
          <Clock size={16} />
        </span>
        <span>Loading StudyOS…</span>
      </div>
    </div>
  )
}

/** Shown when a signed-in browser cannot reach the server on load. Retries automatically. */
function Reconnecting() {
  const { retrySession } = useAuth()
  const [busy, setBusy] = useState(false)
  return (
    <div className="gate-center">
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center', maxWidth: 380 }}>
        <div className="loading-block">
          <span className="spin" style={{ display: 'inline-flex' }}>
            <Clock size={16} />
          </span>
          <span>Reconnecting to StudyOS…</span>
        </div>
        <p className="text-secondary">The server is not responding right now. You are still signed in — this page will continue as soon as it is back.</p>
        <div className="row" style={{ gap: 8 }}>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              await retrySession().finally(() => setBusy(false))
            }}
          >
            Retry now
          </Button>
          <Link to="/login" className="btn btn--md">Sign in again</Link>
        </div>
      </div>
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullScreenLoading />
  if (status === 'offline') return <Reconnecting />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreenLoading />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <WorkspaceGate>
              <Routes>
                <Route path="/exam/:attemptId" element={<LiveTestPage />} />
                <Route path="/*" element={<StudyApp />} />
              </Routes>
            </WorkspaceGate>
          </RequireAuth>
        }
      />
    </Routes>
  )
}

function StudyApp() {
  const { state, toasts, dismissToast, today } = useStudy()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  /* Apply theme */
  useEffect(() => {
    const theme = state.settings.theme
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme
    document.documentElement.setAttribute('data-theme', resolved)
  }, [state.settings.theme])

  /* Local-time nudge for first paint: nothing blocking, just ensures sessions exist */
  useEffect(() => {
    if (!state.sessions[`${state.schedule[0]?.id}::${dateKey()}`] && state.schedule.length) {
      /* store handles creation on load; this is a safety net only */
    }
  }, [state.sessions, state.schedule])

  useEffect(() => {
    setMenuOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className={cx('app', state.settings.compactSidebar && 'is-compact')}>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      {menuOpen ? <div className="scrim" onClick={() => setMenuOpen(false)} /> : null}
      <div className="main-shell">
        <Header onOpenMenu={() => setMenuOpen(true)} />
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/subjects" element={<SubjectsPage />} />
          <Route path="/subjects/:subjectId" element={<SubjectsPage />} />
          <Route path="/subjects/:subjectId/:chapterId" element={<SubjectsPage />} />
          <Route path="/revision" element={<RevisionPage />} />
          <Route path="/mock-tests" element={<MockTestsPage />} />
          <Route path="/mock-tests/:mockId" element={<MockTestsPage />} />
          <Route path="/mistakes" element={<MistakeBankPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sunday" element={<SundayPage />} />
          <Route path="/cycles" element={<CyclesPage />} />
          <Route path="/tests" element={<TestsHomePage />} />
          <Route path="/tests/new" element={<CreateTestPage />} />
          <Route path="/tests/bank" element={<QuestionBankPage />} />
          <Route path="/tests/documents/:documentId" element={<DocumentReviewPage />} />
          <Route path="/tests/attempts/:attemptId" element={<AttemptResultPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
      <SessionWorkflowHost />
      <ReminderRuntime />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

export { minutesFromTime, weekdayOf, chapterById, topicById, sessionViewsForDate }
