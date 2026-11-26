import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, CheckCircle2, Clock, Flag, History, ListChecks, Play, Plus, Repeat, RotateCcw, SkipForward, Square, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal, Select, StatCard, Textarea } from '../components/ui'
import { useStudy, useNow } from '../store/StudyStore'
import { useWorkspaceSync } from '../workspace/WorkspaceGate'
import { api, errorMessage } from '../lib/http'
import { formatClock } from '../lib/date'
import { chaptersOf } from '../store/selectors'
import { cx } from '../lib/utils'

/* ---------------------------- API shapes ---------------------------- */

interface RevisionTask {
  _id: string
  topicId: string
  topicName: string
  chapterName: string
  subjectId: string
  subjectName: string
  date: string
  status: 'pending' | 'deferred' | 'completed' | 'skipped'
  outcome: 'recalled' | 'partial' | 'forgot' | null
  accuracy: number | null
  skipReason: string | null
  sourceCycleNumber: number | null
  missed?: boolean
}
interface StudyLog {
  _id: string
  topicId: string
  topicName: string
  chapterName: string
  subjectName: string
  completion: 'completed' | 'partial'
  minutes: number
  date: string
  cycleNumber: number | null
}
interface Block {
  _id: string
  subjectId: string
  subjectName: string
  order: number
  status: 'pending' | 'revision' | 'ready' | 'learning' | 'completed' | 'skipped' | 'incomplete'
  revision: { required: boolean; plannedMinutes: number; startedAt: string | null; completedAt: string | null; actualSeconds: number; skippedReason: string | null }
  learning: { startedAt: string | null; completedAt: string | null; minutes: number }
  skipReason: string | null
  tasks: RevisionTask[]
  logs: StudyLog[]
  stats: { plannedRevisionMinutes: number; actualRevisionSeconds: number; topicsDue: number; topicsCompleted: number; topicsSkipped: number; revisionAccuracy: number | null }
}
interface Cycle {
  _id: string
  date: string
  cycleNumber: number
  status: 'active' | 'completed' | 'incomplete'
  endedReason: string | null
  blocks: Block[]
  revisionPolicy: { mandatory: boolean; perTopicMinutes: number; maxTopicsPerBlock: number }
}
interface TodayResponse {
  date: string
  cycles: Cycle[]
  active: Cycle | null
  upcomingRevision: Array<{ topicId: string; topicName: string; subjectName: string; chapterName: string }>
  settings: { subjectIds: string[]; revisionMandatory: boolean; defaultRevisionMinutes: number }
  carryForward: { pendingTasks: RevisionTask[]; partialTopics: StudyLog[]; unfinishedBlocks: Array<Block & { date: string }> }
}
interface HistoryRow {
  _id: string
  date: string
  cycleNumber: number
  status: string
  subjects: number
  completedSubjects: number
  plannedRevisionMinutes: number
  actualRevisionSeconds: number
  topicsDue: number
  topicsCompleted: number
  topicsSkipped: number
}

const BLOCK_STATUS: Record<Block['status'], { label: string; tone: 'neutral' | 'accent' | 'warning' | 'success' | 'danger' | 'info' }> = {
  pending: { label: 'Not started', tone: 'neutral' },
  revision: { label: 'Revising', tone: 'warning' },
  ready: { label: 'Revision done', tone: 'info' },
  learning: { label: 'Learning', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  incomplete: { label: 'Incomplete', tone: 'danger' }
}

const secondsSince = (iso: string | null, now: number) => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000)) : 0)

export default function CyclesPage() {
  const { notify } = useStudy()
  const { flush } = useWorkspaceSync()
  const [data, setData] = useState<TodayResponse | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [confirmForce, setConfirmForce] = useState(false)

  const load = useCallback(async () => {
    try {
      const [today, hist] = await Promise.all([api<TodayResponse>('/api/cycles/today'), api<{ cycles: HistoryRow[] }>('/api/cycles/history?days=7')])
      setData(today)
      setHistory(hist.cycles)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    try {
      await fn()
      if (success) notify({ title: success, variant: 'success' })
      await load()
    } catch (err) {
      notify({ title: 'Action failed', message: errorMessage(err), variant: 'error' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const startCycle = (force = false) =>
    run(async () => {
      await flush() // the server validates topics against the synced curriculum
      await api('/api/cycles/start', { method: 'POST', body: { force } })
    }, 'Cycle started')

  if (error && !data) {
    return (
      <main className="page">
        <div className="callout callout--danger">{error}</div>
      </main>
    )
  }
  if (!data) return <main className="page"><LoadingBlock label="Loading study cycles…" /></main>

  const active = data.active
  const nextNumber = (data.cycles.at(-1)?.cycleNumber ?? 0) + 1
  const allTasks = data.cycles.flatMap((c) => c.blocks.flatMap((b) => b.tasks))
  const plannedRev = data.cycles.reduce((a, c) => a + c.blocks.reduce((x, b) => x + b.stats.plannedRevisionMinutes, 0), 0)
  const actualRev = data.cycles.reduce((a, c) => a + c.blocks.reduce((x, b) => x + b.stats.actualRevisionSeconds, 0), 0)
  const acc = allTasks.filter((t) => t.status === 'completed' && t.accuracy !== null).map((t) => t.accuracy as number)

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Study Cycles</h1>
          <p className="page-head__sub">
            A cycle is one pass through your subjects. From the second cycle of the day, every topic you <strong>fully completed</strong> earlier today is revised
            before new learning in that subject. Partial topics wait until they are finished.
          </p>
        </div>
        <div className="page-head__actions">
          <Link to="/settings?section=revision" className="btn btn--ghost btn--md">
            <span>Revision preferences</span>
          </Link>
          {active ? (
            <>
              <Button icon={<Plus size={14} />} onClick={() => setConfirmForce(true)} disabled={busy}>
                Start cycle {nextNumber}
              </Button>
              <Button variant="danger" icon={<Square size={13} />} onClick={() => setConfirmEnd(true)} disabled={busy}>
                End cycle {active.cycleNumber}
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={<Play size={14} />} loading={busy} onClick={() => startCycle()}>
              Start cycle {nextNumber}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid--4 section">
        <StatCard label="Cycles today" value={data.cycles.length} icon={<Repeat size={15} />} hint={active ? `Cycle ${active.cycleNumber} in progress` : 'No cycle running'} />
        <StatCard label="Revision time" value={`${Math.round(actualRev / 60)}`} unit={`/ ${plannedRev} min`} icon={<Clock size={15} />} hint="Actual vs planned" />
        <StatCard
          label="Revision topics"
          value={`${allTasks.filter((t) => t.status === 'completed').length}/${allTasks.length}`}
          icon={<ListChecks size={15} />}
          hint={`${allTasks.filter((t) => t.status === 'skipped').length} skipped`}
          tone="accent"
        />
        <StatCard label="Revision accuracy" value={acc.length ? `${Math.round(acc.reduce((a, b) => a + b, 0) / acc.length)}%` : '—'} icon={<CheckCircle2 size={15} />} hint="From recall ratings / questions" tone="success" />
      </div>

      <div className="grid grid--aside">
        <div className="stack">
          {active ? (
            <ActiveCycle cycle={active} busy={busy} run={run} />
          ) : (
            <Card>
              <EmptyState
                icon={<Repeat size={20} />}
                title={data.cycles.length ? 'No cycle running' : 'Start your first cycle of the day'}
                message={
                  data.upcomingRevision.length
                    ? `${data.upcomingRevision.length} topic(s) completed today will be revised at the start of cycle ${nextNumber}.`
                    : 'Cycle 1 is pure learning: pick topics for each subject as you study them.'
                }
                action={
                  <Button variant="primary" icon={<Play size={14} />} loading={busy} onClick={() => startCycle()}>
                    Start cycle {nextNumber}
                  </Button>
                }
              />
            </Card>
          )}
          {data.cycles.filter((c) => c.status !== 'active').length ? (
            <Card>
              <CardHeader title="Finished cycles today" icon={<History size={15} />} />
              <div className="stack stack--sm">
                {data.cycles
                  .filter((c) => c.status !== 'active')
                  .map((c) => (
                    <div key={c._id} className="cycle-summary">
                      <strong>Cycle {c.cycleNumber}</strong>
                      <Badge tone={c.status === 'completed' ? 'success' : 'warning'} size="sm">
                        {c.status}
                      </Badge>
                      <span className="text-secondary">
                        {c.blocks.filter((b) => b.status === 'completed').length}/{c.blocks.length} subjects ·{' '}
                        {c.blocks.flatMap((b) => b.logs).filter((l) => l.completion === 'completed').length} topics learnt ·{' '}
                        {c.blocks.flatMap((b) => b.tasks).filter((t) => t.status === 'completed').length} revised
                      </span>
                      {c.endedReason ? <span className="text-tertiary">— {c.endedReason}</span> : null}
                    </div>
                  ))}
              </div>
            </Card>
          ) : null}
          <HistoryCard rows={history} />
        </div>
        <div className="stack">
          <Card>
            <CardHeader title={`Queued for cycle ${active ? active.cycleNumber + 1 : nextNumber}`} subtitle="Completed today, not yet revised" icon={<RotateCcw size={15} />} />
            {data.upcomingRevision.length ? (
              <ul className="plain-list">
                {data.upcomingRevision.map((u) => (
                  <li key={u.topicId}>
                    <strong>{u.topicName}</strong>
                    <span className="text-tertiary">
                      {u.subjectName} · {u.chapterName}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-tertiary">Nothing yet.</p>
            )}
          </Card>
          <CarryForward data={data.carryForward} run={run} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title={`End cycle ${active?.cycleNumber}?`}
        message="Unfinished subjects are marked incomplete and their due revision moves to the carry-forward queue. Nothing is discarded."
        confirmLabel="End cycle"
        requireReason
        reasonLabel="Why are you ending early?"
        onConfirm={(reason) => active && run(() => api(`/api/cycles/${active._id}/end`, { method: 'POST', body: { reason } }), 'Cycle ended')}
      />
      <ConfirmDialog
        open={confirmForce}
        onClose={() => setConfirmForce(false)}
        title={`Start cycle ${nextNumber} now?`}
        message={`Cycle ${active?.cycleNumber} is not finished. It will be closed as incomplete (unfinished revision is carried forward) and cycle ${nextNumber} will start.`}
        confirmLabel="Start new cycle"
        tone="primary"
        onConfirm={() => void startCycle(true)}
      />
    </main>
  )
}

/* ------------------------------------------------------------------ */

function ActiveCycle({ cycle, busy, run }: { cycle: Cycle; busy: boolean; run: (fn: () => Promise<unknown>, success?: string) => Promise<void> }) {
  return (
    <Card>
      <CardHeader
        title={`Cycle ${cycle.cycleNumber}`}
        subtitle={cycle.revisionPolicy.mandatory ? 'Revision is required before new learning in each subject.' : 'Revision is recommended before new learning (optional in your settings).'}
        icon={<Repeat size={15} />}
      />
      <div className="stack">
        {cycle.blocks.map((block, i) => (
          <BlockCard key={block._id} block={block} index={i} cycle={cycle} busy={busy} run={run} />
        ))}
      </div>
    </Card>
  )
}

function BlockCard({ block, index, cycle, busy, run }: { block: Block; index: number; cycle: Cycle; busy: boolean; run: (fn: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const { recordCycleRevision } = useStudy()
  const now = useNow(1000)
  const [learnOpen, setLearnOpen] = useState(false)
  const [skipTask, setSkipTask] = useState<RevisionTask | null>(null)
  const [skipAll, setSkipAll] = useState(false)
  const [skipBlock, setSkipBlock] = useState(false)
  const [rateTask, setRateTask] = useState<RevisionTask | null>(null)
  const meta = BLOCK_STATUS[block.status]
  const unresolved = block.tasks.filter((t) => t.status === 'pending').length
  const revisionRunning = block.status === 'revision' && !block.revision.completedAt
  const revElapsed = revisionRunning ? secondsSince(block.revision.startedAt, now) : block.revision.actualSeconds
  const learnElapsed = block.status === 'learning' ? secondsSince(block.learning.startedAt, now) : 0
  const finished = ['completed', 'skipped', 'incomplete'].includes(block.status)
  const learningLocked = unresolved > 0 && cycle.revisionPolicy.mandatory

  return (
    <section className={cx('cycle-block', `is-${block.status}`)} aria-label={`${block.subjectName} block`}>
      <header className="cycle-block__head">
        <span className="cycle-block__index">{index + 1}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="cycle-block__title">{block.subjectName}</h3>
          <p className="text-tertiary cycle-block__sub">
            {block.revision.required ? `${block.stats.topicsDue} topic(s) to revise · ${block.revision.plannedMinutes} min planned` : 'No eligible topics to revise — straight to learning'}
          </p>
        </div>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
      </header>

      {block.revision.required ? (
        <div className="cycle-phase">
          <div className="row row--between">
            <span className="cycle-phase__label">
              <RotateCcw size={13} /> Revision
            </span>
            <span className={cx('mono', revisionRunning && revElapsed > block.revision.plannedMinutes * 60 && 'text-warning')}>
              {formatClock(revElapsed)} / {block.revision.plannedMinutes}:00
            </span>
          </div>
          <ul className="task-list">
            {block.tasks.map((t) => (
              <li key={t._id} className={cx('task', `is-${t.status}`)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{t.topicName}</strong>
                  <span className="text-tertiary">
                    {' '}
                    · {t.chapterName} {t.sourceCycleNumber ? `· from cycle ${t.sourceCycleNumber}` : ''}
                  </span>
                  {t.status === 'skipped' ? <div className="text-tertiary">Skipped: {t.skipReason}</div> : null}
                </div>
                {t.status === 'completed' ? (
                  <Badge tone="success" size="sm">
                    {t.outcome} · {t.accuracy}%
                  </Badge>
                ) : t.status === 'skipped' ? (
                  <Badge size="sm">skipped</Badge>
                ) : revisionRunning ? (
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="success" onClick={() => setRateTask(t)} disabled={busy}>
                      Done
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSkipTask(t)} disabled={busy}>
                      Skip
                    </Button>
                  </div>
                ) : (
                  <Badge size="sm" tone="warning">
                    due
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          {!finished && (block.status === 'pending' || block.status === 'revision') && unresolved > 0 ? (
            <div className="row row--wrap" style={{ gap: 8 }}>
              {block.status === 'pending' ? (
                <Button variant="primary" size="sm" icon={<Play size={13} />} disabled={busy} onClick={() => run(() => api(`/api/cycles/blocks/${block._id}/start-revision`, { method: 'POST' }))}>
                  Start revision
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" icon={<SkipForward size={13} />} disabled={busy} onClick={() => setSkipAll(true)}>
                Skip revision
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="cycle-phase">
        <div className="row row--between">
          <span className="cycle-phase__label">
            <BookOpen size={13} /> New learning
          </span>
          {block.status === 'learning' ? <span className="mono">{formatClock(learnElapsed)}</span> : null}
          {block.status === 'completed' ? <span className="mono text-tertiary">{block.learning.minutes} min</span> : null}
        </div>
        {block.logs.length ? (
          <ul className="plain-list">
            {block.logs.map((l) => (
              <li key={l._id}>
                <strong>{l.topicName}</strong>
                <span className="text-tertiary">
                  {l.chapterName} · {l.completion === 'completed' ? 'completed' : 'partially studied'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {block.status === 'skipped' ? <p className="text-tertiary">Skipped: {block.skipReason}</p> : null}
        {!finished ? (
          <div className="row row--wrap" style={{ gap: 8 }}>
            {block.status === 'learning' ? (
              <Button variant="primary" size="sm" icon={<Flag size={13} />} onClick={() => setLearnOpen(true)} disabled={busy}>
                Finish & record topics
              </Button>
            ) : (
              <Button
                variant={learningLocked ? 'secondary' : 'primary'}
                size="sm"
                icon={<Play size={13} />}
                disabled={busy || learningLocked}
                title={learningLocked ? 'Finish or skip the revision first' : undefined}
                onClick={() => run(() => api(`/api/cycles/blocks/${block._id}/start-learning`, { method: 'POST' }))}
              >
                Start learning
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setSkipBlock(true)} disabled={busy}>
              Skip subject
            </Button>
            {learningLocked ? <span className="text-tertiary" style={{ fontSize: 12 }}>Revise the due topics first (or skip them with a reason).</span> : null}
          </div>
        ) : null}
      </div>

      <RateTaskModal
        task={rateTask}
        onClose={() => setRateTask(null)}
        onSubmit={(body) =>
          rateTask &&
          run(async () => {
            const r = await api<{ task: RevisionTask }>(`/api/cycles/revision-tasks/${rateTask._id}/complete`, { method: 'POST', body })
            recordCycleRevision(r.task.topicId, r.task.date, r.task.accuracy)
          }, 'Revision recorded')
        }
      />
      <LearningModal block={block} open={learnOpen} onClose={() => setLearnOpen(false)} run={run} />
      <ConfirmDialog
        open={Boolean(skipTask)}
        onClose={() => setSkipTask(null)}
        title={`Skip revising ${skipTask?.topicName}?`}
        message="The skip is recorded with your reason."
        confirmLabel="Skip topic"
        requireReason
        onConfirm={(reason) => skipTask && run(() => api(`/api/cycles/revision-tasks/${skipTask._id}/skip`, { method: 'POST', body: { reason } }))}
      />
      <ConfirmDialog
        open={skipAll}
        onClose={() => setSkipAll(false)}
        title={`Skip ${block.subjectName} revision?`}
        message={`All ${unresolved} remaining topic(s) will be recorded as skipped with this reason.`}
        confirmLabel="Skip revision"
        requireReason
        onConfirm={(reason) => run(() => api(`/api/cycles/blocks/${block._id}/skip-revision`, { method: 'POST', body: { reason } }))}
      />
      <ConfirmDialog
        open={skipBlock}
        onClose={() => setSkipBlock(false)}
        title={`Skip ${block.subjectName} in this cycle?`}
        message="Its due revision is carried forward to your next cycle."
        confirmLabel="Skip subject"
        requireReason
        onConfirm={(reason) => run(() => api(`/api/cycles/blocks/${block._id}/skip`, { method: 'POST', body: { reason } }))}
      />
    </section>
  )
}

function RateTaskModal({
  task,
  onClose,
  onSubmit
}: {
  task: RevisionTask | null
  onClose: () => void
  onSubmit: (body: { outcome: string; questionsAttempted?: number; questionsCorrect?: number }) => void
}) {
  const [outcome, setOutcome] = useState<'recalled' | 'partial' | 'forgot'>('recalled')
  const [attempted, setAttempted] = useState('')
  const [correct, setCorrect] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (task) {
      setOutcome('recalled')
      setAttempted('')
      setCorrect('')
      setError('')
    }
  }, [task])
  const submit = () => {
    const a = attempted ? Number(attempted) : undefined
    const c = correct ? Number(correct) : undefined
    if ((a !== undefined && (!Number.isInteger(a) || a < 0)) || (c !== undefined && (!Number.isInteger(c) || c < 0))) return setError('Use whole numbers.')
    if (a !== undefined && c !== undefined && c > a) return setError('Correct cannot exceed attempted.')
    onSubmit({ outcome, ...(a !== undefined ? { questionsAttempted: a } : {}), ...(c !== undefined ? { questionsCorrect: c } : {}) })
    onClose()
  }
  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      title={`Revised: ${task?.topicName ?? ''}`}
      subtitle="How well did you recall it?"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Save revision
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="segmented" role="radiogroup" aria-label="Recall">
          {(['recalled', 'partial', 'forgot'] as const).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={outcome === o} className={cx('segmented__item', outcome === o && 'is-active')} onClick={() => setOutcome(o)}>
              {o === 'recalled' ? 'Recalled well' : o === 'partial' ? 'Partly' : 'Forgot'}
            </button>
          ))}
        </div>
        <div className="grid grid--2">
          <Field label="Questions attempted" hint="Optional">
            <Input inputMode="numeric" value={attempted} onChange={(e) => setAttempted(e.target.value)} />
          </Field>
          <Field label="Correct" hint="Optional">
            <Input inputMode="numeric" value={correct} onChange={(e) => setCorrect(e.target.value)} />
          </Field>
        </div>
        {error ? <p className="field__error">{error}</p> : null}
      </div>
    </Modal>
  )
}

function LearningModal({ block, open, onClose, run }: { block: Block; open: boolean; onClose: () => void; run: (fn: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const { state, registerLearning } = useStudy()
  const { flush } = useWorkspaceSync()
  const chapters = useMemo(() => chaptersOf(state, block.subjectId), [state, block.subjectId])
  const [rows, setRows] = useState<Array<{ topicId: string; completion: 'completed' | 'partial'; confidence: string; notes: string }>>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setRows([{ topicId: '', completion: 'completed', confidence: '3', notes: '' }])
      setError('')
    }
  }, [open])

  const save = () => {
    const filled = rows.filter((r) => r.topicId)
    if (!filled.length) return setError('Choose at least one topic you studied.')
    if (new Set(filled.map((r) => r.topicId)).size !== filled.length) return setError('Each topic can be listed once.')
    onClose()
    void run(async () => {
      await flush()
      const r = await api<{ logs: StudyLog[] }>(`/api/cycles/blocks/${block._id}/complete-learning`, {
        method: 'POST',
        body: { entries: filled.map((f) => ({ topicId: f.topicId, completion: f.completion, confidence: Number(f.confidence), notes: f.notes || undefined })) }
      })
      // Keep the topic ledger (Revision Center, Subjects) in sync with what was learnt.
      r.logs.filter((l) => l.completion === 'completed').forEach((l) => registerLearning(l.topicId, l.date, Number(filled.find((f) => f.topicId === l.topicId)?.confidence ?? 3)))
    }, `${block.subjectName} recorded`)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`What did you study in ${block.subjectName}?`}
      subtitle="Only fully completed topics become eligible for revision in your next cycle."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Finish subject
          </Button>
        </>
      }
    >
      <div className="stack">
        {rows.map((row, i) => (
          <div key={i} className="learning-row">
            <Field label={`Topic ${i + 1}`}>
              <Select value={row.topicId} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, topicId: e.target.value } : r)))}>
                <option value="">Choose a topic…</option>
                {chapters.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.initialLearningDate ? ' (learnt before)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={row.completion} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, completion: e.target.value as 'completed' | 'partial' } : r)))}>
                <option value="completed">Completed</option>
                <option value="partial">Partially studied</option>
              </Select>
            </Field>
            <Field label="Confidence">
              <Select value={row.confidence} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, confidence: e.target.value } : r)))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}/5
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes" className="learning-row__notes">
              <Textarea rows={1} value={row.notes} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, notes: e.target.value } : r)))} />
            </Field>
          </div>
        ))}
        <div>
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setRows((rs) => [...rs, { topicId: '', completion: 'completed', confidence: '3', notes: '' }])} disabled={rows.length >= 10}>
            Add another topic
          </Button>
        </div>
        {error ? <p className="field__error">{error}</p> : null}
      </div>
    </Modal>
  )
}

function CarryForward({ data, run }: { data: TodayResponse['carryForward']; run: (fn: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const { recordCycleRevision } = useStudy()
  const [skip, setSkip] = useState<RevisionTask | null>(null)
  const total = data.pendingTasks.length + data.partialTopics.length + data.unfinishedBlocks.length
  return (
    <Card>
      <CardHeader title="Carry-forward queue" subtitle="Unfinished work is never discarded" icon={<SkipForward size={15} />} actions={<Badge tone={total ? 'warning' : 'success'}>{total}</Badge>} />
      {!total ? <p className="text-tertiary">All caught up.</p> : null}
      {data.pendingTasks.length ? (
        <>
          <p className="queue-label">Revision waiting ({data.pendingTasks.length})</p>
          <ul className="task-list">
            {data.pendingTasks.map((t) => (
              <li key={t._id} className="task">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{t.topicName}</strong>
                  <span className="text-tertiary">
                    {' '}
                    · {t.subjectName} {t.missed ? `· missed on ${t.date}` : t.status === 'deferred' ? '· deferred (block was full)' : ''}
                  </span>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() =>
                      run(async () => {
                        const r = await api<{ task: RevisionTask }>(`/api/cycles/revision-tasks/${t._id}/complete`, { method: 'POST', body: { outcome: 'recalled' } })
                        recordCycleRevision(r.task.topicId, r.task.date, r.task.accuracy)
                      }, 'Revision recorded')
                    }
                  >
                    Revised
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSkip(t)}>
                    Skip
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {data.partialTopics.length ? (
        <>
          <p className="queue-label">Partially studied — finish these first ({data.partialTopics.length})</p>
          <ul className="plain-list">
            {data.partialTopics.map((l) => (
              <li key={l._id}>
                <strong>{l.topicName}</strong>
                <span className="text-tertiary">
                  {l.subjectName} · {l.date}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {data.unfinishedBlocks.length ? (
        <>
          <p className="queue-label">Missed or incomplete subjects ({data.unfinishedBlocks.length})</p>
          <ul className="plain-list">
            {data.unfinishedBlocks.map((b) => (
              <li key={b._id}>
                <strong>{b.subjectName}</strong>
                <span className="text-tertiary">
                  {b.date} · {b.status}
                  {b.skipReason ? ` — ${b.skipReason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <ConfirmDialog
        open={Boolean(skip)}
        onClose={() => setSkip(null)}
        title={`Skip revising ${skip?.topicName}?`}
        message="The skip is recorded with your reason and the topic leaves the queue."
        confirmLabel="Skip"
        requireReason
        onConfirm={(reason) => skip && run(() => api(`/api/cycles/revision-tasks/${skip._id}/skip`, { method: 'POST', body: { reason } }))}
      />
    </Card>
  )
}

function HistoryCard({ rows }: { rows: HistoryRow[] }) {
  if (!rows.length) return null
  return (
    <Card pad={false}>
      <div style={{ padding: '14px 16px 0' }}>
        <CardHeader title="Last 7 days" icon={<History size={15} />} />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Cycle</th>
              <th>Status</th>
              <th>Subjects</th>
              <th>Revision (actual / planned)</th>
              <th>Topics revised</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td className="mono">{r.date}</td>
                <td>#{r.cycleNumber}</td>
                <td>
                  <Badge size="sm" tone={r.status === 'completed' ? 'success' : r.status === 'active' ? 'accent' : 'warning'}>
                    {r.status}
                  </Badge>
                </td>
                <td>
                  {r.completedSubjects}/{r.subjects}
                </td>
                <td className="mono">
                  {Math.round(r.actualRevisionSeconds / 60)} / {r.plannedRevisionMinutes} min
                </td>
                <td>
                  {r.topicsCompleted}/{r.topicsDue}
                  {r.topicsSkipped ? <span className="text-tertiary"> ({r.topicsSkipped} skipped)</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
