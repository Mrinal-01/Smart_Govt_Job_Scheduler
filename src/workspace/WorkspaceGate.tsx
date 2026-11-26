import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { StudyState } from '../types'
import { useAuth } from '../auth/AuthContext'
import { ApiError, api, errorMessage } from '../lib/http'
import { readCache, writeCache } from '../lib/storage'
import { Button, LoadingBlock } from '../components/ui'
import { StudyProvider, useStudy, type ServerScheduleStatus } from '../store/StudyStore'
import OnboardingPage from './OnboardingPage'

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'conflict' | 'error'

interface SyncValue {
  status: SyncStatus
  lastSavedAt: string | null
  /** Resolves once every local change has reached the server. */
  flush: () => Promise<void>
  reload: () => void
}

export const SyncContext = createContext<SyncValue | null>(null)
export const useWorkspaceSync = () => {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useWorkspaceSync must be used inside <WorkspaceGate>')
  return ctx
}

const SAVE_DELAY_MS = 1200

/**
 * Debounced, revision-checked persistence of the workspace document.
 * Local changes are mirrored to a per-user cache immediately so nothing is lost
 * if the network or the tab goes away before the server acknowledges them.
 */
class WorkspaceSync {
  private timer: number | null = null
  private inflight: Promise<void> | null = null
  private pending: StudyState | null = null

  constructor(
    private userId: string,
    private revision: number,
    private onStatus: (s: SyncStatus, savedAt?: string) => void
  ) {}

  change(state: StudyState) {
    this.pending = state
    writeCache(this.userId, { revision: this.revision, dirty: true, savedAt: new Date().toISOString(), data: state })
    this.onStatus('saving')
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    if (this.inflight) await this.inflight
    if (!this.pending) return
    const data = this.pending
    this.pending = null
    this.inflight = (async () => {
      try {
        const r = await api<{ revision: number; updatedAt: string }>('/api/workspace', { method: 'PUT', body: { baseRevision: this.revision, data } })
        this.revision = r.revision
        if (!this.pending) writeCache(this.userId, { revision: r.revision, dirty: false, savedAt: r.updatedAt, data })
        this.onStatus(this.pending ? 'saving' : 'saved', r.updatedAt)
      } catch (err) {
        if (err instanceof ApiError && err.code === 'WORKSPACE_CONFLICT') {
          this.onStatus('conflict')
          return
        }
        // Keep the change queued; it stays in the local cache and is retried.
        this.pending = this.pending ?? data
        this.onStatus(err instanceof ApiError && err.status === 0 ? 'offline' : 'error')
        this.timer = window.setTimeout(() => void this.flush(), 10_000)
      }
    })().finally(() => {
      this.inflight = null
    })
    await this.inflight
  }

  dispose() {
    if (this.timer) window.clearTimeout(this.timer)
  }
}

type Phase = { kind: 'loading' } | { kind: 'onboarding' } | { kind: 'error'; message: string } | { kind: 'ready'; data: StudyState; revision: number; pushLocal: boolean }

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [status, setStatus] = useState<SyncStatus>('saved')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [loadKey, setLoadKey] = useState(0)
  const syncRef = useRef<WorkspaceSync | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    setPhase({ kind: 'loading' })
    try {
      const ws = await api<{ revision: number; data: StudyState; updatedAt: string }>('/api/workspace')
      const cache = readCache(userId)
      // Unsynced local edits made on top of the current server revision win (e.g. tab closed while offline).
      const useLocal = Boolean(cache?.dirty && cache.revision === ws.revision)
      setLastSavedAt(ws.updatedAt)
      setPhase({ kind: 'ready', data: useLocal ? cache!.data : ws.data, revision: ws.revision, pushLocal: useLocal })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WORKSPACE_NOT_FOUND') setPhase({ kind: 'onboarding' })
      else setPhase({ kind: 'error', message: errorMessage(err) })
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load, loadKey])

  useEffect(() => {
    if (phase.kind !== 'ready' || !userId) return
    const sync = new WorkspaceSync(userId, phase.revision, (s, savedAt) => {
      setStatus(s)
      if (savedAt) setLastSavedAt(savedAt)
    })
    syncRef.current = sync
    setStatus('saved')
    if (phase.pushLocal) sync.change(phase.data)
    const onHide = () => document.visibilityState === 'hidden' && void sync.flush()
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      void sync.flush()
      sync.dispose()
    }
  }, [phase, userId])

  const onChange = useCallback((state: StudyState) => syncRef.current?.change(state), [])
  const value = useMemo<SyncValue>(
    () => ({ status, lastSavedAt, flush: () => syncRef.current?.flush() ?? Promise.resolve(), reload: () => setLoadKey((k) => k + 1) }),
    [status, lastSavedAt]
  )

  if (phase.kind === 'loading') return <div className="gate-center"><LoadingBlock label="Loading your workspace…" /></div>
  if (phase.kind === 'error') {
    return (
      <div className="gate-center">
        <div className="callout callout--danger" style={{ maxWidth: 520 }}>
          <AlertTriangle size={15} />
          <div>
            <strong>Could not load your study data.</strong> {phase.message}
            <div style={{ marginTop: 8 }}>
              <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => setLoadKey((k) => k + 1)}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }
  if (phase.kind === 'onboarding') return <OnboardingPage onCreated={() => setLoadKey((k) => k + 1)} />

  return (
    <SyncContext.Provider value={value}>
      <StudyProvider key={`${userId}:${loadKey}`} initialState={phase.data} onChange={onChange}>
        <ScheduleGovernanceBootstrap />
        {status === 'conflict' ? <ConflictBanner onReload={() => setLoadKey((k) => k + 1)} /> : null}
        {children}
      </StudyProvider>
    </SyncContext.Provider>
  )
}

function ConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div className="conflict-banner" role="alert">
      <AlertTriangle size={15} />
      <span>Your data was changed in another tab or device. Reload to continue with the latest version (unsynced edits from this tab will be discarded).</span>
      <Button size="sm" variant="primary" onClick={onReload}>
        Reload
      </Button>
    </div>
  )
}

/**
 * On load, reconcile the timetable with the server's published schedule
 * versions. A workspace without any published version publishes its current
 * timetable as the free baseline (v1) so governance starts from what the
 * student already has.
 */
function ScheduleGovernanceBootstrap() {
  const { state, syncScheduleFromServer, notify } = useStudy()
  const { flush } = useWorkspaceSync()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    ;(async () => {
      try {
        let status = await api<ServerScheduleStatus>('/api/schedule')
        if (!status.latest && state.schedule.length) {
          await flush()
          await api('/api/schedule/publish', { method: 'POST', body: { slots: state.schedule, changeReason: 'Initial schedule' } })
          status = await api<ServerScheduleStatus>('/api/schedule')
        }
        syncScheduleFromServer(status)
      } catch (err) {
        notify({ title: 'Schedule sync failed', message: errorMessage(err), variant: 'warning' })
      }
    })()
  }, [state.schedule, syncScheduleFromServer, notify, flush])
  return null
}
