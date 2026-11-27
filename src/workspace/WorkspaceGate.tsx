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

const SyncContext = createContext<SyncValue | null>(null)
export const useWorkspaceSync = () => {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useWorkspaceSync must be used inside <WorkspaceGate>')
  return ctx
}

const SAVE_DELAY_MS = 1200
const TAB_ID = Math.random().toString(36).slice(2)
const workspaceChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('studyos-workspace') : null

interface SavedMessage {
  type: 'saved'
  userId: string
  tabId: string
  revision: number
  data: StudyState
}

/**
 * Debounced, revision-checked persistence of the workspace document.
 * - One instance per loaded workspace (never recreated by React re-mounts), so
 *   the revision it holds is always the latest this tab knows.
 * - Identical payloads are never re-sent.
 * - Every successful save is broadcast to other open tabs, which adopt it
 *   instead of colliding with it.
 * Local changes are mirrored to a per-user cache so nothing is lost offline.
 */
class WorkspaceSync {
  private timer: number | null = null
  private inflight: Promise<void> | null = null
  private pending: StudyState | null = null
  private lastSavedJson: string
  private disposed = false

  constructor(
    private userId: string,
    private revision: number,
    initial: StudyState,
    private onStatus: (s: SyncStatus, savedAt?: string) => void
  ) {
    this.lastSavedJson = JSON.stringify(initial)
  }

  get currentRevision() {
    return this.revision
  }

  /** True when this tab has no unsaved or in-flight changes. */
  isIdle() {
    return !this.pending && !this.inflight && !this.timer
  }

  /** Another tab saved: adopt its revision (caller adopts the data). */
  adopt(revision: number, data: StudyState) {
    this.revision = revision
    this.lastSavedJson = JSON.stringify(data)
    writeCache(this.userId, { revision, dirty: false, savedAt: new Date().toISOString(), data })
  }

  change(state: StudyState) {
    if (this.disposed) return
    this.pending = state
    writeCache(this.userId, { revision: this.revision, dirty: true, savedAt: new Date().toISOString(), data: state })
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
    const json = JSON.stringify(data)
    if (json === this.lastSavedJson) {
      this.onStatus('saved')
      return
    }
    this.onStatus('saving')
    this.inflight = (async () => {
      try {
        const r = await api<{ revision: number; updatedAt: string }>('/api/workspace', { method: 'PUT', body: { baseRevision: this.revision, data } })
        this.revision = r.revision
        this.lastSavedJson = json
        if (!this.pending) writeCache(this.userId, { revision: r.revision, dirty: false, savedAt: r.updatedAt, data })
        this.onStatus(this.pending ? 'saving' : 'saved', r.updatedAt)
        const msg: SavedMessage = { type: 'saved', userId: this.userId, tabId: TAB_ID, revision: r.revision, data }
        workspaceChannel?.postMessage(msg)
      } catch (err) {
        if (err instanceof ApiError && err.code === 'WORKSPACE_CONFLICT') {
          this.onStatus('conflict')
          return
        }
        // Keep the change queued; it stays in the local cache and is retried.
        this.pending = this.pending ?? data
        this.onStatus(err instanceof ApiError && err.status === 0 ? 'offline' : 'error')
        if (!this.disposed) this.timer = window.setTimeout(() => void this.flush(), 10_000)
      }
    })().finally(() => {
      this.inflight = null
    })
    await this.inflight
  }

  dispose() {
    this.disposed = true
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = null
  }
}

type Phase = { kind: 'loading' } | { kind: 'onboarding' } | { kind: 'error'; message: string } | { kind: 'ready'; data: StudyState; revision: number }

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
      const data = useLocal ? cache!.data : ws.data
      // The saver lives outside React's effect lifecycle so development
      // double-mounting can never create two savers with diverging revisions.
      syncRef.current?.dispose()
      const sync = new WorkspaceSync(userId, ws.revision, ws.data, (s, savedAt) => {
        setStatus(s)
        if (savedAt) setLastSavedAt(savedAt)
      })
      syncRef.current = sync
      if (useLocal) sync.change(data)
      setStatus('saved')
      setLastSavedAt(ws.updatedAt)
      setPhase({ kind: 'ready', data, revision: ws.revision })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WORKSPACE_NOT_FOUND') setPhase({ kind: 'onboarding' })
      else setPhase({ kind: 'error', message: errorMessage(err) })
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load, loadKey])

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void syncRef.current?.flush()
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  // Push pending edits when the gate goes away (sign-out). Only flush, never
  // dispose: React's development double-mount runs this cleanup immediately.
  useEffect(() => () => void syncRef.current?.flush(), [])

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
        <CrossTabSync userId={userId} syncRef={syncRef} onConflictResolved={() => setStatus('saved')} />
        {status === 'conflict' ? <ConflictBanner onReload={() => setLoadKey((k) => k + 1)} /> : null}
        {children}
      </StudyProvider>
    </SyncContext.Provider>
  )
}

/** Adopts saves made in other open tabs so tabs don't overwrite each other. */
function CrossTabSync({
  userId,
  syncRef,
  onConflictResolved
}: {
  userId: string | null
  syncRef: React.MutableRefObject<WorkspaceSync | null>
  onConflictResolved: () => void
}) {
  const { adoptExternalState } = useStudy()
  useEffect(() => {
    if (!workspaceChannel) return
    const onMessage = (e: MessageEvent<SavedMessage>) => {
      const msg = e.data
      const sync = syncRef.current
      if (msg?.type !== 'saved' || msg.userId !== userId || msg.tabId === TAB_ID || !sync) return
      if (msg.revision <= sync.currentRevision) return
      // With unsaved local edits this tab keeps them; the next save reports a conflict.
      if (!sync.isIdle()) return
      sync.adopt(msg.revision, msg.data)
      adoptExternalState(msg.data)
      onConflictResolved()
    }
    workspaceChannel.addEventListener('message', onMessage)
    return () => workspaceChannel.removeEventListener('message', onMessage)
  }, [userId, syncRef, adoptExternalState, onConflictResolved])
  return null
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
