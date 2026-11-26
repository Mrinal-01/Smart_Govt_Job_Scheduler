import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, ShieldAlert, Upload, Undo2 } from 'lucide-react'
import type { ScheduleSlot } from '../types'
import { Badge, Button, Checkbox, ConfirmDialog, Field, Input, LoadingBlock, Modal, Textarea } from './ui'
import { draftScheduleOf, hasUnpublishedSchedule, useStudy, type ServerScheduleStatus } from '../store/StudyStore'
import { useWorkspaceSync } from '../workspace/WorkspaceGate'
import { ApiError, api, errorMessage } from '../lib/http'
import { WEEKDAY_LONG, addDays, formatTime } from '../lib/date'
import { cx } from '../lib/utils'

interface Usage {
  used: number
  remaining: number
  limit: number
  windowDays: number
  nextAvailableAt: string | null
  overridesInWindow: number
}
interface VersionSummary {
  id: string
  version: number
  effectiveFrom: string
  publishedAt: string
  changeReason: string
  changes: { added: string[]; removed: string[]; modified: Array<{ slotId: string; fields: string[] }>; summary: string[] }
  countsTowardLimit: boolean
  override: boolean
  overrideReason: string | null
  slotCount?: number
}
interface Status extends ServerScheduleStatus {
  policy: { maxChanges: number; windowDays: number }
  usage: Usage
  today: string
  latest: (VersionSummary & { slots: ScheduleSlot[] }) | null
  active: (VersionSummary & { slots: ScheduleSlot[] }) | null
  pending: (VersionSummary & { slots: ScheduleSlot[] }) | null
}
interface Preview {
  isBaseline: boolean
  diff: { added: string[]; removed: string[]; modified: Array<{ slotId: string; fields: string[] }>; summary: string[] }
  usage: Usage
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function UsageMeter({ usage }: { usage: Usage }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="usage-meter" aria-label={`${usage.used} of ${usage.limit} changes used`}>
        {Array.from({ length: usage.limit }, (_, i) => (
          <span key={i} className={cx(i < usage.used && 'is-used')} />
        ))}
      </span>
      <span className="text-secondary">
        {usage.used}/{usage.limit} changes used in {usage.windowDays} days
      </span>
    </span>
  )
}

/**
 * Publish bar for the Schedule page: draft vs published, change budget,
 * publish dialog with diff, and version history. All rules are enforced by
 * the server; this component explains them.
 */
export function ScheduleGovernancePanel() {
  const { state, syncScheduleFromServer, discardScheduleDraft, notify } = useStudy()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const unpublished = hasUnpublishedSchedule(state)

  const load = useCallback(async () => {
    try {
      const s = await api<Status>('/api/schedule')
      setStatus(s)
      setError('')
      return s
    } catch (err) {
      setError(errorMessage(err))
      return null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, state.scheduleGovernance?.latestVersion])

  const subjectName = (id: string) => state.subjects.find((s) => s.id === id)?.name ?? 'Unknown'

  return (
    <>
      <div className={cx('publish-bar section', !unpublished && 'is-clean')} role="status">
        {unpublished ? <AlertTriangle size={16} className="text-warning" /> : <ShieldAlert size={16} className="text-tertiary" />}
        <div style={{ flex: 1, minWidth: 220 }}>
          {unpublished ? (
            <strong>You have unpublished schedule changes.</strong>
          ) : (
            <strong>{status?.latest ? `Published schedule v${status.latest.version}` : 'Schedule not published yet'}</strong>
          )}
          <div className="text-secondary" style={{ fontSize: 12.5 }}>
            {unpublished
              ? 'Edits are a draft: they do not affect any session until you publish them. Editing a draft never uses a change.'
              : status?.pending
                ? `Version ${status.pending.version} takes effect on ${status.pending.effectiveFrom}. Today runs on v${status.active?.version}.`
                : status?.active
                  ? `Active since ${status.active.effectiveFrom}. Completing or skipping sessions never counts as a change.`
                  : error || 'Loading…'}
          </div>
        </div>
        {status ? <UsageMeter usage={status.usage} /> : null}
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" icon={<History size={13} />} onClick={() => setHistoryOpen(true)}>
            History
          </Button>
          {unpublished ? (
            <>
              <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => setDiscardOpen(true)}>
                Discard draft
              </Button>
              <Button size="sm" variant="primary" icon={<Upload size={13} />} onClick={() => setPublishOpen(true)}>
                Review & publish
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {publishOpen && status ? (
        <PublishModal
          status={status}
          subjectName={subjectName}
          onClose={() => setPublishOpen(false)}
          onPublished={async (version) => {
            const fresh = await load()
            if (fresh) syncScheduleFromServer(fresh)
            notify({ title: `Schedule v${version.version} published`, message: `Effective from ${version.effectiveFrom}.`, variant: 'success' })
            setPublishOpen(false)
          }}
        />
      ) : null}
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard unpublished changes?"
        message="The editor goes back to your latest published schedule."
        confirmLabel="Discard"
        onConfirm={() => discardScheduleDraft()}
      />
    </>
  )
}

function SlotLine({ slot, subjectName }: { slot: ScheduleSlot; subjectName: (id: string) => string }) {
  return (
    <li>
      <span className="mono">
        {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
      </span>{' '}
      {subjectName(slot.subjectId)} <span className="text-tertiary">· {slot.label}</span>
    </li>
  )
}

function PublishModal({
  status,
  subjectName,
  onClose,
  onPublished
}: {
  status: Status
  subjectName: (id: string) => string
  onClose: () => void
  onPublished: (v: VersionSummary) => Promise<void>
}) {
  const { state } = useStudy()
  const { flush } = useWorkspaceSync()
  const draft = draftScheduleOf(state)
  const current = status.latest?.slots ?? state.schedule
  const [preview, setPreview] = useState<Preview | null>(null)
  const [reason, setReason] = useState('')
  const tomorrow = addDays(status.today, 1)
  const [effectiveFrom, setEffectiveFrom] = useState(tomorrow)
  const [override, setOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Preview>('/api/schedule/preview', { method: 'POST', body: { slots: draft } })
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiError && err.issues.length ? `${err.issues[0].path}: ${err.issues[0].message}` : errorMessage(err)))
  }, [draft])

  const limitReached = preview ? !preview.isBaseline && preview.usage.remaining === 0 : false
  const changedDays = useMemo(
    () => DAY_ORDER.filter((d) => JSON.stringify(current.filter((s) => s.weekday === d)) !== JSON.stringify(draft.filter((s) => s.weekday === d))),
    [current, draft]
  )

  const publish = async () => {
    if (!preview) return
    if (!preview.isBaseline && reason.trim().length < 3) return setError('Give a short reason for this change.')
    if (limitReached && (!override || overrideReason.trim().length < 10)) return setError('An emergency override needs a reason of at least 10 characters.')
    setBusy(true)
    setError('')
    try {
      await flush()
      const r = await api<{ version: VersionSummary }>('/api/schedule/publish', {
        method: 'POST',
        body: {
          slots: draft,
          changeReason: reason.trim(),
          effectiveFrom: preview.isBaseline ? undefined : effectiveFrom,
          ...(limitReached ? { override: true, overrideReason: overrideReason.trim() } : {})
        }
      })
      await onPublished(r.version)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Publish schedule changes"
      subtitle="Review the difference between your published schedule and this draft."
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={limitReached ? 'danger' : 'primary'} loading={busy} disabled={!preview || (limitReached && !override)} onClick={publish}>
            {limitReached ? 'Publish with emergency override' : 'Confirm & publish'}
          </Button>
        </>
      }
    >
      {!preview && !error ? <LoadingBlock label="Comparing…" /> : null}
      {preview ? (
        <div className="stack">
          <div className="row row--between row--wrap">
            <UsageMeter usage={preview.usage} />
            <Badge tone={preview.isBaseline ? 'info' : preview.usage.remaining ? 'accent' : 'danger'}>
              {preview.isBaseline ? 'First publish — free' : `${preview.usage.remaining} change(s) remaining · this publish uses 1`}
            </Badge>
          </div>
          <div className="muted-box">
            <strong>Changes</strong>
            {preview.diff.summary.length ? (
              <ul className="diff-list">
                {preview.diff.summary.map((line) => (
                  <li key={line} className={cx(line.startsWith('Added') && 'is-added', line.startsWith('Removed') && 'is-removed')}>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-tertiary">No differences from the published version.</p>
            )}
          </div>
          {changedDays.length ? (
            <div className="grid grid--2">
              <div>
                <p className="queue-label">Current (published)</p>
                {changedDays.map((d) => (
                  <div key={d} style={{ marginBottom: 8 }}>
                    <strong>{WEEKDAY_LONG[d]}</strong>
                    <ul className="diff-list">
                      {current
                        .filter((s) => s.weekday === d)
                        .map((s) => (
                          <SlotLine key={s.id} slot={s} subjectName={subjectName} />
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div>
                <p className="queue-label">Proposed</p>
                {changedDays.map((d) => (
                  <div key={d} style={{ marginBottom: 8 }}>
                    <strong>{WEEKDAY_LONG[d]}</strong>
                    <ul className="diff-list">
                      {draft
                        .filter((s) => s.weekday === d)
                        .map((s) => (
                          <SlotLine key={s.id} slot={s} subjectName={subjectName} />
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!preview.isBaseline ? (
            <div className="grid grid--2">
              <Field label="Reason for the change" required>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. College timings changed" />
              </Field>
              <Field label="Effective from" hint="Today’s sessions are never changed; the earliest is tomorrow.">
                <Input type="date" min={tomorrow} max={addDays(status.today, 60)} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </Field>
            </div>
          ) : (
            <p className="text-secondary">This becomes version 1 and applies from today.</p>
          )}

          {limitReached ? (
            <div className="callout callout--danger">
              <ShieldAlert size={15} />
              <div className="stack stack--sm" style={{ flex: 1 }}>
                <span>
                  You have used all {preview.usage.limit} schedule changes allowed in {preview.usage.windowDays} days. The next regular change is available on{' '}
                  <strong>{preview.usage.nextAvailableAt ? new Date(preview.usage.nextAvailableAt).toLocaleString() : '—'}</strong>.
                </span>
                <Checkbox checked={override} onChange={setOverride} label="This is an emergency — publish anyway (recorded in your history)" />
                {override ? (
                  <Field label="Emergency reason (min 10 characters)">
                    <Textarea rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                  </Field>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="callout callout--danger" style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  )
}

function HistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    api<{ versions: VersionSummary[] }>('/api/schedule/versions')
      .then((r) => setVersions(r.versions))
      .catch((err) => setError(errorMessage(err)))
  }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Schedule history" subtitle="Every published version is kept and cannot be edited." size="lg">
      {error ? <div className="callout callout--danger">{error}</div> : null}
      {!versions ? (
        <LoadingBlock />
      ) : (
        <div>
          {versions.map((v) => (
            <div key={v.id} className="version-row">
              <span className="version-row__v">v{v.version}</span>
              <div style={{ flex: 1 }}>
                <div className="row row--wrap" style={{ gap: 6 }}>
                  <span className="mono">{new Date(v.publishedAt).toLocaleString()}</span>
                  <span className="text-tertiary">· effective {v.effectiveFrom}</span>
                  {v.override ? <Badge tone="danger" size="sm">Emergency override</Badge> : null}
                  {!v.countsTowardLimit ? <Badge size="sm">baseline</Badge> : null}
                </div>
                {v.changeReason ? <div>{v.changeReason}</div> : null}
                {v.overrideReason ? <div className="text-danger">Override reason: {v.overrideReason}</div> : null}
                {v.changes.summary.length ? (
                  <ul className="diff-list text-secondary">
                    {v.changes.summary.slice(0, 6).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                    {v.changes.summary.length > 6 ? <li>…and {v.changes.summary.length - 6} more</li> : null}
                  </ul>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
