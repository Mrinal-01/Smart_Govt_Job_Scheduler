import { useMemo, useRef, useState } from 'react'
import { Brain, Database, FileUp, LogOut, Sparkles, Sprout } from 'lucide-react'
import type { StudyState } from '../types'
import { useAuth } from '../auth/AuthContext'
import { api, errorMessage } from '../lib/http'
import { parseImportedState, readLegacyBrowserState } from '../lib/storage'
import { buildFreshState, buildSeedState } from '../data/seed'
import { Badge, Button } from '../components/ui'
import { cx } from '../lib/utils'

type Choice = 'browser' | 'fresh' | 'demo' | 'file'

/**
 * First sign-in for an account: decide where the study workspace comes from.
 * Data stored in this browser before accounts existed can be imported; it is
 * never deleted from the browser.
 */
export default function OnboardingPage({ onCreated }: { onCreated: () => void }) {
  const { user, logout } = useAuth()
  const legacy = useMemo(() => readLegacyBrowserState(), [])
  const [choice, setChoice] = useState<Choice>(legacy ? 'browser' : 'fresh')
  const [fileState, setFileState] = useState<StudyState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setFileState(parseImportedState(await file.text()))
      setChoice('file')
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'This file is not a valid StudyOS backup.'))
    }
  }

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      let data: StudyState
      let origin: 'import' | 'fresh' | 'demo'
      if (choice === 'browser' && legacy) [data, origin] = [legacy, 'import']
      else if (choice === 'file' && fileState) [data, origin] = [fileState, 'import']
      else if (choice === 'demo') [data, origin] = [buildSeedState(), 'demo']
      else [data, origin] = [buildFreshState(), 'fresh']
      // The account is the identity: profile name/email come from it.
      data = { ...data, sessions: data.sessions ?? {}, profile: { ...data.profile, name: user?.name ?? data.profile.name, email: user?.email ?? data.profile.email } }
      await api('/api/workspace', { method: 'POST', body: { origin, data } })
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const options: Array<{ key: Choice; icon: React.ReactNode; title: string; body: React.ReactNode; disabled?: boolean; badge?: string }> = [
    {
      key: 'browser',
      icon: <Database size={18} />,
      title: 'Import data from this browser',
      body: legacy ? (
        <>
          Found an existing StudyOS dataset here: {legacy.subjects.length} subjects, {legacy.chapters.reduce((a, c) => a + c.topics.length, 0)} topics, {legacy.logs.length} daily logs,{' '}
          {legacy.attempts.length} mock attempts. It stays in this browser after import.
        </>
      ) : (
        'No earlier StudyOS data was found in this browser.'
      ),
      disabled: !legacy,
      badge: legacy ? 'Recommended' : undefined
    },
    { key: 'fresh', icon: <Sprout size={18} />, title: 'Start fresh', body: 'The standard curriculum (Mathematics, Physical Science, Reasoning, Current Affairs) and a default weekly timetable — no history.' },
    { key: 'demo', icon: <Sparkles size={18} />, title: 'Explore with demo data', body: 'A generated 365-day history to explore every screen. You can reset it later from Settings.', badge: 'Demo' },
    {
      key: 'file',
      icon: <FileUp size={18} />,
      title: 'Restore a backup file',
      body: fileState ? `Backup loaded: ${fileState.subjects.length} subjects, ${fileState.logs.length} daily logs.` : 'Use a JSON backup exported from Settings → Data & backup.'
    }
  ]

  return (
    <main className="auth-page">
      <div className="auth-card auth-card--wide">
        <div className="auth-brand">
          <span className="brand-mark">
            <Brain size={17} />
          </span>
          <span className="brand-name">StudyOS</span>
        </div>
        <h1 className="auth-title">Welcome, {user?.name.split(' ')[0]}</h1>
        <p className="auth-subtitle">Choose how to set up your study workspace. It is stored on the server and only you can access it.</p>
        <div className="onboard-options" role="radiogroup" aria-label="Workspace source">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={choice === o.key}
              disabled={o.disabled}
              className={cx('onboard-option', choice === o.key && 'is-active')}
              onClick={() => (o.key === 'file' && !fileState ? fileRef.current?.click() : setChoice(o.key))}
            >
              <span className="onboard-option__icon">{o.icon}</span>
              <span className="onboard-option__text">
                <span className="onboard-option__title">
                  {o.title} {o.badge ? <Badge size="sm" tone={o.badge === 'Demo' ? 'purple' : 'success'}>{o.badge}</Badge> : null}
                </span>
                <span className="onboard-option__body">{o.body}</span>
              </span>
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
        {error ? <div className="callout callout--danger" style={{ marginTop: 12 }}>{error}</div> : null}
        <div className="row row--between" style={{ marginTop: 16 }}>
          <Button variant="ghost" icon={<LogOut size={14} />} onClick={() => void logout()}>
            Sign out
          </Button>
          <Button variant="primary" size="lg" loading={busy} onClick={create} disabled={(choice === 'browser' && !legacy) || (choice === 'file' && !fileState)}>
            Continue
          </Button>
        </div>
      </div>
    </main>
  )
}
