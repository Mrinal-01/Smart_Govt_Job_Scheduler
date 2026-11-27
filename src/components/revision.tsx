import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2, Clock, Lock, Play, RotateCcw, ShieldAlert, Timer, Unlock } from 'lucide-react'
import { Badge, Button, Checkbox, Field, Input, LoadingBlock, Modal, Progress, Textarea } from './ui'
import { useNow, useStudy } from '../store/StudyStore'
import { ApiError, errorMessage } from '../lib/http'
import {
  OBLIGATION_LABEL,
  OBLIGATION_STATE_META,
  STATE_META,
  notifyPlanChanged,
  planApi,
  usePlanDay,
  type Obligation,
  type PlanSession,
  type Preparation,
  type RevisionBlock,
  type SessionState
} from '../lib/plan'
import { formatClock, formatDuration } from '../lib/date'
import { cx } from '../lib/utils'

export function SessionStateBadge({ state, size = 'sm' }: { state: SessionState; size?: 'sm' | 'md' }) {
  const meta = STATE_META[state]
  return (
    <Badge tone={meta.tone} size={size} dot>
      {meta.label}
    </Badge>
  )
}

export function ObligationStateBadge({ obligation }: { obligation: Obligation }) {
  const meta = OBLIGATION_STATE_META[obligation.state]
  return (
    <span className="row" style={{ gap: 5 }}>
      <Badge tone={meta.tone} size="sm" dot>
        {meta.label}
      </Badge>
      {obligation.bypassed ? (
        <Badge tone="purple" size="sm">
          bypassed — still required
        </Badge>
      ) : null}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Obligation card                                                     */
/* ------------------------------------------------------------------ */

export function ObligationCard({ obligation, onOpen, compact }: { obligation: Obligation; onOpen: (o: Obligation) => void; compact?: boolean }) {
  const o = obligation
  const source = o.sourceSessions?.[0]
  return (
    <div className={cx('rev-card', 'obligation-card', o.state === 'overdue' && 'rev-card--due', o.status === 'completed' && 'is-done')}>
      <div className="rev-card__main">
        <div className="row row--wrap" style={{ gap: 6, marginBottom: 2 }}>
          <span className="rev-card__title">{o.subjectName}</span>
          <Badge tone={o.type === 'same_day' ? 'accent' : o.type === 'next_day' ? 'warning' : 'info'} size="sm">
            {OBLIGATION_LABEL[o.type]}
          </Badge>
          <ObligationStateBadge obligation={o} />
        </div>
        <div className="rev-card__meta">
          <span>{o.chapters.join(', ') || 'No chapter'}</span>
          <span>·</span>
          <span>due {o.dueDate}</span>
          <span>·</span>
          <span>{formatDuration(o.plannedMinutes)} planned</span>
          {source ? (
            <>
              <span>·</span>
              <span>
                from {source.date === o.dueDate ? '' : `${source.date} `}
                {source.cycleNumber ? `cycle ${source.cycleNumber} ` : ''}
                {source.startTime}
                {o.sourceSessions && o.sourceSessions.length > 1 ? ` +${o.sourceSessions.length - 1} session(s)` : ''}
              </span>
            </>
          ) : null}
        </div>
        {!compact ? (
          <div className="obligation-card__topics">
            {o.topics.map((t) => (
              <span key={t.topicId} className={cx('topic-chip', o.result?.topicsRevised.includes(t.topicId) && 'is-done')}>
                {t.topicName}
              </span>
            ))}
          </div>
        ) : null}
        {o.result ? (
          <div className="row row--wrap" style={{ gap: 8, fontSize: 11.5, marginTop: 4 }}>
            <span className="text-secondary">{o.result.questionsAttempted} questions</span>
            <span className="text-success">{o.result.questionsCorrect} correct</span>
            <span className="text-danger">{o.result.questionsWrong} wrong</span>
            <span className="text-secondary">confidence {o.result.confidence}/5</span>
            <span className="text-tertiary">{formatDuration(o.result.actualMinutes)} actual</span>
          </div>
        ) : null}
      </div>
      <div className="rev-card__actions">
        <Button size="sm" variant={o.status === 'completed' ? 'ghost' : 'primary'} icon={o.status === 'completed' ? <BookOpen size={13} /> : <Play size={13} />} onClick={() => onOpen(o)}>
          {o.status === 'completed' ? 'View' : o.status === 'in_progress' ? 'Continue' : 'Revise'}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Revision Preparation Panel + completion                             */
/* ------------------------------------------------------------------ */

/** Mirrors a server-completed revision into the topic history used by the spaced-revision views. */
function useMirrorRevision() {
  const { logRevision, recordCycleRevision, today } = useStudy()
  return (o: Obligation) => {
    const r = o.result
    if (!r) return
    const accuracy = r.questionsAttempted > 0 ? Math.round((r.questionsCorrect / r.questionsAttempted) * 100) : null
    for (const topicId of r.topicsRevised) {
      if (o.type === 'same_day') recordCycleRevision(topicId, today, accuracy)
      else
        logRevision(topicId, {
          type: o.type === 'next_day' ? 'next-day' : 'weekly',
          source: o.type === 'weekly' ? 'sunday-review' : 'revision-center',
          accuracy,
          confidence: r.confidence,
          notes: r.notes || undefined
        })
    }
  }
}

export function RevisionWorkspace({ obligationId, onClose }: { obligationId: string | null; onClose: () => void }) {
  const { notify } = useStudy()
  const mirror = useMirrorRevision()
  const now = useNow(1000)
  const [prep, setPrep] = useState<Preparation | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [attempted, setAttempted] = useState('0')
  const [correct, setCorrect] = useState('0')
  const [wrong, setWrong] = useState('')
  const [confidence, setConfidence] = useState(3)
  const [notes, setNotes] = useState('')
  const [minutes, setMinutes] = useState('')
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const load = async (id: string) => {
    try {
      setPrep(await planApi.preparation(id))
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  useEffect(() => {
    if (!obligationId) return
    setPrep(null)
    setChecked(new Set())
    setAttempted('0')
    setCorrect('0')
    setWrong('')
    setConfidence(3)
    setNotes('')
    setMinutes('')
    setFormErrors({})
    void load(obligationId)
  }, [obligationId])

  const o = prep?.obligation
  const startedAt = o?.startedAt ? new Date(o.startedAt).getTime() : null
  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0
  const planned = (o?.plannedMinutes ?? 0) * 60
  const topicIds = useMemo(() => prep?.topics.map((t) => t.topicId) ?? [], [prep])
  const topicsTicked = topicIds.filter((id) => checked.has(`topic:${id}`))

  const start = async () => {
    if (!o) return
    setBusy(true)
    try {
      await planApi.startRevision(o.id)
      await load(o.id)
      notifyPlanChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const complete = async () => {
    if (!o) return
    const errs: Record<string, string> = {}
    const a = Number(attempted)
    const c = Number(correct)
    const w = wrong === '' ? Math.max(0, a - c) : Number(wrong)
    if (topicsTicked.length !== topicIds.length) errs.topics = 'Tick every topic once you have actually revised it.'
    if (!Number.isInteger(a) || a < 0) errs.attempted = 'Enter 0 or more.'
    if (o.practiceRequired && a < 1) errs.attempted = 'This revision requires practice questions.'
    if (!Number.isInteger(c) || c < 0) errs.correct = 'Enter 0 or more.'
    if (!Number.isInteger(w) || w < 0) errs.wrong = 'Enter 0 or more.'
    if (c + w > a) errs.correct = 'Correct + wrong cannot exceed attempted.'
    if (minutes !== '' && (!Number.isInteger(Number(minutes)) || Number(minutes) < 1)) errs.minutes = 'Whole minutes, at least 1.'
    setFormErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const r = await planApi.completeRevision(o.id, {
        topicsRevised: topicsTicked,
        questionsAttempted: a,
        questionsCorrect: c,
        questionsWrong: w,
        confidence,
        notes: notes.trim() || undefined,
        actualMinutes: minutes === '' ? undefined : Number(minutes)
      })
      if (!r.alreadyCompleted) mirror(r.obligation)
      notifyPlanChanged()
      notify({ title: `${OBLIGATION_LABEL[o.type]} completed`, message: `${o.subjectName}: ${o.topics.length} topic(s) revised. Revision ≠ mastery — keep practising.`, variant: 'success' })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError && err.issues.length ? err.issues[0].message : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string, v: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (v) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <Modal
      open={Boolean(obligationId)}
      onClose={onClose}
      size="xl"
      title={o ? `${OBLIGATION_LABEL[o.type]} — ${o.subjectName}` : 'Revision'}
      subtitle={o ? `Due ${o.dueDate} · ${formatDuration(o.plannedMinutes)} planned · ${o.topics.length} topic(s)` : undefined}
      footer={
        o ? (
          <>
            <Button onClick={onClose}>Close</Button>
            {o.status === 'pending' ? (
              <Button variant="primary" icon={<Play size={14} />} loading={busy} onClick={start}>
                Start revision
              </Button>
            ) : o.status === 'in_progress' ? (
              <Button variant="primary" icon={<CheckCircle2 size={14} />} loading={busy} onClick={complete}>
                Complete revision
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {error ? (
        <div className="callout callout--danger" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      ) : null}
      {!prep && !error ? <LoadingBlock label="Preparing revision…" /> : null}
      {prep && o ? (
        <div className="stack" style={{ gap: 14 }}>
          {o.bypassed ? (
            <div className="callout callout--warning">
              <ShieldAlert size={14} />
              <span>An emergency override let a session start without this revision. It is still required and counts as pending until you complete it.</span>
            </div>
          ) : null}

          <div className="rev-timer">
            <Timer size={15} />
            {o.status === 'completed' ? (
              <span>
                Completed in <strong>{formatDuration(o.result?.actualMinutes ?? 0)}</strong> of {formatDuration(o.plannedMinutes)} planned
              </span>
            ) : startedAt ? (
              <>
                <span className="mono rev-timer__clock">{formatClock(elapsed)}</span>
                <span className="text-tertiary">/ {formatDuration(o.plannedMinutes)} planned (server clock)</span>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <Progress value={Math.min(100, Math.round((elapsed / Math.max(1, planned)) * 100))} tone={elapsed >= planned ? 'success' : 'accent'} height={5} />
                </div>
              </>
            ) : (
              <span className="text-secondary">Start the revision to run the timer. The server measures the duration.</span>
            )}
          </div>

          <div className="grid grid--2" style={{ gap: 14, alignItems: 'start' }}>
            <div className="stack" style={{ gap: 10 }}>
              <p className="queue-label">Previously studied topics</p>
              {prep.topics.map((t) => (
                <div key={t.topicId} className="muted-box">
                  <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                    {o.status === 'in_progress' ? (
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={checked.has(`topic:${t.topicId}`)}
                        onChange={(e) => toggle(`topic:${t.topicId}`, e.target.checked)}
                        aria-label={`Revised ${t.topicName}`}
                      />
                    ) : o.result?.topicsRevised.includes(t.topicId) ? (
                      <CheckCircle2 size={15} className="text-success" />
                    ) : (
                      <RotateCcw size={14} className="text-tertiary" />
                    )}
                    <span style={{ flex: 1 }}>
                      <strong style={{ fontSize: 12.5 }}>{t.topicName}</strong>
                      <span className="text-tertiary" style={{ fontSize: 11.5 }}>
                        {' '}
                        · {t.chapterName}
                      </span>
                      {t.keyPoints.length ? (
                        <ul className="diff-list text-secondary" style={{ marginTop: 4 }}>
                          {t.keyPoints.map((k) => (
                            <li key={k}>{k}</li>
                          ))}
                        </ul>
                      ) : null}
                      {t.formulas.length ? (
                        <div style={{ marginTop: 4 }}>
                          {t.formulas.map((f) => (
                            <span key={f} className="formula-chip">
                              {f}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {t.notes ? <p className="text-secondary" style={{ fontSize: 11.5, marginTop: 4 }}>Notes: {t.notes}</p> : null}
                    </span>
                  </label>
                </div>
              ))}
              {formErrors.topics ? <p className="field__error">{formErrors.topics}</p> : null}

              {prep.sessionNotes.length ? (
                <>
                  <p className="queue-label">Notes from the learning session</p>
                  {prep.sessionNotes.map((n) => (
                    <div key={n.sessionId} className="muted-box text-secondary" style={{ fontSize: 12 }}>
                      <strong>
                        {n.date} {n.cycleNumber ? `· cycle ${n.cycleNumber}` : ''}
                      </strong>{' '}
                      {n.notes}
                    </div>
                  ))}
                </>
              ) : null}

              {prep.checklist.filter((c) => c.kind === 'formula').length ? (
                <>
                  <p className="queue-label">Formula / concept checklist</p>
                  <div className="checklist">
                    {prep.checklist
                      .filter((c) => c.kind === 'formula')
                      .map((c) => (
                        <label key={c.id} className={cx('checklist__item', checked.has(c.id) && 'is-done')}>
                          <input type="checkbox" className="checkbox" checked={checked.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} disabled={o.status !== 'in_progress'} />
                          <span className="checklist__text">{c.label}</span>
                        </label>
                      ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <p className="queue-label">Practice questions ({prep.practiceQuestions.length})</p>
              {prep.practiceQuestions.length ? (
                <ol className="practice-list">
                  {prep.practiceQuestions.map((q) => (
                    <li key={q.id}>
                      <span>{q.text}</span>
                      {q.options.length ? (
                        <span className="text-tertiary" style={{ display: 'block', fontSize: 11.5 }}>
                          {q.options.map((op) => `${op.label}) ${op.text}`).join('   ')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-tertiary" style={{ fontSize: 12 }}>
                  No verified questions for these topics in your question bank yet.
                </p>
              )}

              <p className="queue-label">Previous mistakes ({prep.mistakes.length})</p>
              {prep.mistakes.length ? (
                <ul className="practice-list">
                  {prep.mistakes.map((m) => (
                    <li key={m.id}>
                      <span>{m.question}</span>
                      <span className="text-tertiary" style={{ display: 'block', fontSize: 11.5 }}>
                        {m.source === 'mock_test' ? 'Mock test' : 'Mistake Bank'}
                        {m.category ? ` · ${m.category}` : ''}
                        {m.occurrences > 1 ? ` · ${m.occurrences}×` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-tertiary" style={{ fontSize: 12 }}>
                  No unresolved mistakes recorded for these topics.
                </p>
              )}

              {o.status === 'in_progress' ? (
                <div className="muted-box stack" style={{ gap: 10 }}>
                  <p className="field__label">Completion record</p>
                  <div className="grid grid--3" style={{ gap: 10 }}>
                    <Field label={o.practiceRequired ? 'Attempted (required)' : 'Questions attempted'} error={formErrors.attempted}>
                      <Input type="number" min={0} value={attempted} onChange={(e) => setAttempted(e.target.value)} />
                    </Field>
                    <Field label="Correct" error={formErrors.correct}>
                      <Input type="number" min={0} value={correct} onChange={(e) => setCorrect(e.target.value)} />
                    </Field>
                    <Field label="Wrong" hint="Blank = attempted − correct" error={formErrors.wrong}>
                      <Input type="number" min={0} value={wrong} onChange={(e) => setWrong(e.target.value)} />
                    </Field>
                  </div>
                  <div className="grid grid--2" style={{ gap: 10 }}>
                    <Field label="Confidence" hint={`${confidence}/5`}>
                      <div className="range-row">
                        <input type="range" min={1} max={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} aria-label="Confidence" />
                        <span className="mono">{confidence}/5</span>
                      </div>
                    </Field>
                    <Field label="Actual minutes" hint={`Server measured ${Math.max(1, Math.ceil(elapsed / 60))} min; you can only report less`} error={formErrors.minutes}>
                      <Input type="number" min={1} value={minutes} placeholder={String(Math.max(1, Math.ceil(elapsed / 60)))} onChange={(e) => setMinutes(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Notes (optional)">
                    <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What still feels shaky?" />
                  </Field>
                  <p className="field__hint">Completing a revision does not mark a topic as mastered — mastery comes from repeated revisions and accuracy.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Locked session panel + emergency override                           */
/* ------------------------------------------------------------------ */

export function LockedSessionModal({ session, onClose, onUnlocked }: { session: PlanSession | null; onClose: () => void; onUnlocked: (s: PlanSession) => void }) {
  const { notify } = useStudy()
  const [openId, setOpenId] = useState<string | null>(null)
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<PlanSession | null>(session)

  const refresh = async (id: string) => {
    const d = await planApi.dependencies(id)
    setObligations(d.dependencies.revisions)
    const fresh = await planApi.session(id)
    setCurrent(fresh.session)
    if (fresh.session.canStart) onUnlocked(fresh.session)
  }

  useEffect(() => {
    setCurrent(session)
    setOverrideOpen(false)
    setReason('')
    setAck(false)
    setError('')
    if (session?.id) void refresh(session.id).catch((err) => setError(errorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id])

  if (!session) return null
  const s = current ?? session
  const open = obligations.filter((o) => o.status !== 'completed')

  const doOverride = async () => {
    if (reason.trim().length < 10) return setError('Give a reason of at least 10 characters.')
    if (!ack) return setError('Confirm that the revision stays pending.')
    setBusy(true)
    try {
      const r = await planApi.overrideSession(s.id!, reason.trim())
      notifyPlanChanged()
      notify({ title: 'Emergency override recorded', message: 'The revision is still pending and is shown in your history and analytics.', variant: 'warning' })
      onUnlocked(r.session)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={Boolean(session) && !openId}
        onClose={onClose}
        size="lg"
        title={
          <span className="row" style={{ gap: 7 }}>
            <Lock size={15} /> {s.subjectName} is locked
          </span>
        }
        subtitle={`${s.label || 'Session'} · ${s.startTime}–${s.endTime}${s.cycleNumber ? ` · cycle ${s.cycleNumber}` : ''}`}
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            {!overrideOpen && s.lockReasons.length ? (
              <Button variant="ghost" icon={<ShieldAlert size={14} />} onClick={() => setOverrideOpen(true)}>
                Emergency override…
              </Button>
            ) : null}
            {overrideOpen ? (
              <Button variant="danger" loading={busy} onClick={doOverride}>
                Record override & unlock
              </Button>
            ) : null}
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="callout callout--warning">
            <Lock size={14} />
            <div>
              <strong>Revision first.</strong> The server keeps this session locked until the revisions below are completed. You can still view the schedule.
            </div>
          </div>
          <ul className="lock-reasons">
            {s.lockReasons.map((r, i) => (
              <li key={`${r.kind}-${i}`}>
                <Badge tone={r.kind === 'next_day' ? 'warning' : r.kind === 'same_day' ? 'accent' : 'neutral'} size="sm">
                  {r.kind === 'next_day' ? 'Carryover' : r.kind === 'same_day' ? 'Same-day' : 'Prerequisite'}
                </Badge>
                <span>{r.message}</span>
              </li>
            ))}
          </ul>
          {open.length ? (
            <div className="rev-list">
              {open.map((o) => (
                <ObligationCard key={o.id} obligation={o} onOpen={(x) => setOpenId(x.id)} />
              ))}
            </div>
          ) : null}
          {overrideOpen ? (
            <div className="callout callout--danger">
              <ShieldAlert size={15} />
              <div className="stack stack--sm" style={{ flex: 1 }}>
                <span>
                  An override lets <strong>only this session</strong> start. It is recorded with your reason, time and the dependencies it bypassed. The revisions stay
                  <strong> pending</strong> and are never completed by finishing this session.
                </span>
                <Field label="Reason (min 10 characters)" required>
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Coaching class moved to this slot today" />
                </Field>
                <Checkbox checked={ack} onChange={setAck} label="I understand the required revision remains pending." />
              </div>
            </div>
          ) : null}
          {error ? <div className="callout callout--danger">{error}</div> : null}
        </div>
      </Modal>
      <RevisionWorkspace
        obligationId={openId}
        onClose={() => {
          setOpenId(null)
          if (s.id) void refresh(s.id).catch(() => undefined)
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Inline "revise before this session" rows                             */
/* ------------------------------------------------------------------ */

export function RevisionBlockRows({ blocks }: { blocks: RevisionBlock[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (!blocks.length) return null
  return (
    <>
      {blocks.map((b) => (
        <div key={b.obligationId} className={cx('revision-block-row', b.status === 'completed' && 'is-done', b.state === 'overdue' && 'is-overdue')}>
          <span className="revision-block-row__time mono">
            {b.windowStart}–{b.windowEnd}
          </span>
          {b.status === 'completed' ? <CheckCircle2 size={14} className="text-success" /> : <RotateCcw size={14} className="text-warning" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>
              {b.type === 'next_day' ? `Revise ${b.subjectName} — previous-day topics` : `Revise ${b.subjectName} — cycle ${b.sourceCycleNumber ?? ''} topics`}
            </strong>
            <span className="text-tertiary truncate" style={{ display: 'block', fontSize: 11.5 }}>
              {b.topics.join(', ')} · {formatDuration(b.plannedMinutes)}
              {b.type === 'next_day' ? ` · from ${b.sourceDate}` : ''}
            </span>
          </div>
          {b.bypassed ? (
            <Badge tone="purple" size="sm">
              bypassed
            </Badge>
          ) : null}
          <Button size="sm" variant={b.status === 'completed' ? 'ghost' : 'primary'} onClick={() => setOpenId(b.obligationId)}>
            {b.status === 'completed' ? 'View' : b.status === 'in_progress' ? 'Continue' : 'Revise'}
          </Button>
        </div>
      ))}
      <RevisionWorkspace obligationId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Daily carryover banner                                              */
/* ------------------------------------------------------------------ */

export function CarryoverBanner() {
  const { data } = usePlanDay('today')
  const [openId, setOpenId] = useState<string | null>(null)
  const carry = data?.carryover
  if (!carry || !carry.obligations.length) return null
  const open = carry.obligations.filter((o) => o.status !== 'completed')
  const done = carry.obligations.length - open.length
  return (
    <div className={cx('carryover-block section', carry.complete && 'is-complete')}>
      <div className="carryover-block__head">
        {carry.complete ? <Unlock size={16} className="text-success" /> : <Lock size={16} className="text-warning" />}
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong>{carry.complete ? 'Previous-day revision complete' : 'Previous-day revision due today'}</strong>
          <div className="text-secondary" style={{ fontSize: 12.5 }}>
            {carry.complete
              ? 'Every subject has revised its previous-day topics.'
              : carry.scope === 'all_subjects'
                ? `Revise the previous study day’s topics before any new learning can start — ${formatDuration(carry.remainingMinutes)} remaining.`
                : `Each subject starts with a revision of its previous-day topics; a subject unlocks as soon as its own revision is done — ${formatDuration(carry.remainingMinutes)} remaining.`}
          </div>
        </div>
        <span className="row" style={{ gap: 6 }}>
          <Clock size={13} className="text-tertiary" />
          <span className="mono">
            {done}/{carry.obligations.length} subjects
          </span>
        </span>
      </div>
      <Progress value={done} max={Math.max(1, carry.obligations.length)} tone={carry.complete ? 'success' : 'warning'} height={4} />
      <div className="carryover-block__items">
        {carry.obligations.map((o) => (
          <button key={o.id} type="button" className={cx('carryover-item', o.status === 'completed' && 'is-done', o.overdue && 'is-overdue')} onClick={() => setOpenId(o.id)}>
            {o.status === 'completed' ? <CheckCircle2 size={13} /> : <RotateCcw size={13} />}
            <span className="carryover-item__subject">{o.subjectName}</span>
            <span className="carryover-item__topics truncate">{o.topics.map((t) => t.topicName).join(', ')}</span>
            {o.overdue ? (
              <Badge tone="danger" size="sm">
                overdue
              </Badge>
            ) : null}
            {o.bypassed ? (
              <Badge tone="purple" size="sm">
                bypassed
              </Badge>
            ) : null}
          </button>
        ))}
      </div>
      <RevisionWorkspace obligationId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}
