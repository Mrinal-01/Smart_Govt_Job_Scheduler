import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  CircleSlash,
  Clock,
  FileText,
  Flag,
  History,
  Lock,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Timer,
  XCircle
} from 'lucide-react'
import type { ID, SessionCompletion, SessionStatus } from '../types'
import type { SessionView } from '../store/selectors'
import { Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, Modal, Progress, Ring, Select, Textarea } from './ui'
import { useStudy, useNow } from '../store/StudyStore'
import { STATUS_META, chapterById, chaptersOf, elapsedSecondsOf, subjectById, topicMastery, topicsOfChapter } from '../store/selectors'
import { buildRevisionPack } from '../services/revisionPack'
import { useToast } from './ui'
import { formatClock, formatDuration, formatTime, minutesFromTime, nowMinutes } from '../lib/date'
import { clamp, cx, pct } from '../lib/utils'
import { ApiError, errorMessage } from '../lib/http'
import { notifyPlanChanged, planApi, type PlanSession } from '../lib/plan'
import { usePlanSessionFor } from './PlanToday'
import { LockedSessionModal, RevisionBlockRows, SessionStateBadge } from './revision'

/* ------------------------------------------------------------------ */
/* Session card                                                        */
/* ------------------------------------------------------------------ */

export function StatusBadge({ status, size = 'md' }: { status: SessionStatus; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status]
  return (
    <Badge tone={meta.tone as 'neutral' | 'accent' | 'success' | 'warning' | 'danger'} size={size} dot>
      {meta.label}
    </Badge>
  )
}

export function SessionCard({
  view,
  onStart,
  onComplete,
  onSkip,
  compact
}: {
  view: SessionView
  onStart: (key: string) => void
  onComplete: (key: string) => void
  onSkip: (key: string) => void
  compact?: boolean
}) {
  const { slot, record, subject, completion } = view
  const status = record.status
  const tone = `var(--s-${subject.tone === 'custom' ? 'math' : subject.tone})`
  /** Server-authoritative gate state for today's sessions (null for other days). */
  const server = usePlanSessionFor(record.date, slot.id)
  const locked = Boolean(server?.locked)

  return (
    <article className={cx('session-card', `session-card--${status}`)}>
      <span className="session-card__accent" style={{ background: tone }} aria-hidden="true" />
      <div className="session-card__body">
        <div className="session-card__head">
          <div className="session-card__title-row">
            <span className="subject-dot" style={{ background: tone }} />
            <span className="session-card__subject">{subject.name}</span>
            <span className="slot-number">#{slot.sessionNumber}</span>
            <span className="session-card__label truncate">{slot.label}</span>
          </div>
          <span className="row" style={{ gap: 4 }}>
            {/* One badge: the server's state is authoritative while the session is open. */}
            {server && status !== 'completed' && status !== 'skipped' ? <SessionStateBadge state={server.state} /> : <StatusBadge status={status} size="sm" />}
          </span>
        </div>

        <div className="row row--wrap" style={{ gap: 10 }}>
          {server?.cycleNumber ? <span className="session-card__time">Cycle {server.cycleNumber}</span> : null}
          <span className="session-card__time">
            <Clock size={11} />
            {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
          </span>
          <span className="session-card__time">{formatDuration(slot.durationMinutes)}</span>
          {slot.practiceTarget > 0 ? (
            <span className="session-card__time">
              <FileText size={11} />
              {slot.practiceTarget} questions
            </span>
          ) : null}
          {view.overdueMinutes > 0 ? (
            <Badge tone="danger" size="sm" dot>
              {formatDuration(view.overdueMinutes)} overdue
            </Badge>
          ) : null}
        </div>

        {server?.revisionsBefore.length ? <RevisionBlockRows blocks={server.revisionsBefore} /> : null}

        {!compact ? (
          <div className="session-card__topics">
            {server && server.revisionStatus !== 'not_required' ? (
              <div className="session-topic-row">
                {locked ? <Lock size={11} style={{ color: 'var(--warning)' }} /> : <RotateCcw size={11} style={{ color: server.revisionStatus === 'completed' ? 'var(--success)' : 'var(--warning)' }} />}
                <span>
                  Revision:{' '}
                  <b>
                    {server.revisionStatus === 'completed'
                      ? 'Completed'
                      : server.revisionStatus === 'bypassed'
                        ? 'Bypassed by emergency override — still pending'
                        : server.revisionStatus === 'in_progress'
                          ? 'In progress'
                          : `Required first${server.previousTopics.length ? ` — ${server.previousTopics.join(', ')}` : ''}`}
                  </b>
                </span>
              </div>
            ) : null}
            {locked && server?.lockReasons[0] ? (
              <div className="session-topic-row text-warning">
                <Lock size={11} />
                <span className="truncate">{server.lockReasons[0].message}</span>
              </div>
            ) : null}
            <div className="session-topic-row">
              <BookOpen size={11} style={{ color: 'var(--accent)' }} />
              <span>
                New learning: <b className="truncate">{completion?.topicName ?? slot.learningTarget}</b>
              </span>
            </div>
          </div>
        ) : null}

        {completion ? (
          <div className="row row--wrap" style={{ gap: 6, fontSize: 11.5 }}>
            <Badge tone="success" size="sm" dot>
              {completion.correctAnswers}/{completion.questionsAttempted} correct
            </Badge>
            <span className="text-tertiary">{formatDuration(completion.durationMinutes)} logged</span>
            <span className="text-tertiary">· confidence {completion.confidence}/5</span>
          </div>
        ) : null}

        <div className="session-card__foot">
          {status === 'in-progress' || status === 'revision-pending' ? (
            <div className={cx('session-progress-mini')}>
              <Progress value={view.progressPct} tone={view.progressPct >= 100 ? 'success' : 'accent'} height={4} />
              <span className="text-tertiary mono" style={{ fontSize: 10.5 }}>
                {formatClock(view.elapsedSeconds)} elapsed
              </span>
            </div>
          ) : null}

          <div className="session-card__actions">
            {status === 'completed' ? (
              <Button size="sm" variant="ghost" onClick={() => onComplete(view.key)}>
                View log
              </Button>
            ) : status === 'skipped' ? (
              <span className="text-tertiary" style={{ fontSize: 11.5 }}>
                Skipped{record.skipReason ? ` — ${record.skipReason}` : ''}
              </span>
            ) : (
              <>
                <Button
                  size="sm"
                  variant={status === 'in-progress' || status === 'revision-pending' ? 'primary' : 'secondary'}
                  icon={locked ? <Lock size={12} /> : <Play size={12} />}
                  onClick={() => onStart(view.key)}
                >
                  {status === 'in-progress' || status === 'revision-pending' ? 'Resume' : locked ? 'Locked — revise first' : 'Start session'}
                </Button>
                <Button size="sm" variant="quiet" onClick={() => onComplete(view.key)}>
                  Update progress
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onSkip(view.key)} aria-label="Skip session">
                  <CircleSlash size={13} />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Completion modal                                                    */
/* ------------------------------------------------------------------ */

export function CompletionModal({
  sessionKey,
  open,
  onClose
}: {
  sessionKey: string | null
  open: boolean
  onClose: () => void
}) {
  const { state, completeSession, registerLearning, notify } = useStudy()
  const record = sessionKey ? state.sessions[sessionKey] : null
  const server = usePlanSessionFor(record?.date ?? '', record?.slotId ?? '')
  const serverDone = server?.status === 'completed'
  const [alsoTopics, setAlsoTopics] = useState<ID[]>([])
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')
  const slot = record ? state.schedule.find((s) => s.id === record.slotId) : null
  const subject = record ? subjectById(state, record.subjectId) : null

  const elapsedMinutes = record ? Math.max(1, Math.round(elapsedSecondsOf(record) / 60)) : 0

  const [chapterId, setChapterId] = useState<ID>('')
  const [topicId, setTopicId] = useState<ID>('')
  const [learningCompleted, setLearningCompleted] = useState(true)
  const [practiceCompleted, setPracticeCompleted] = useState(true)
  const [attempted, setAttempted] = useState('0')
  const [correct, setCorrect] = useState('0')
  const [notes, setNotes] = useState('')
  const [confidence, setConfidence] = useState(3)
  const [duration, setDuration] = useState('0')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const chapters = useMemo(() => (subject ? chaptersOf(state, subject.id) : []), [state, subject])
  const topics = useMemo(() => {
    if (chapterId) return topicsOfChapter(state, chapterId)
    return chapters.flatMap((c) => c.topics)
  }, [chapterId, chapters, state])

  /* reset when the target session changes */
  useEffect(() => {
    if (!open || !record) return
    const existing = record.completion
    const firstChapter =
      existing?.chapterId ??
      chapters.find((c) => c.topics.some((t) => !t.learningCompleted))?.id ??
      chapters[0]?.id ??
      ''
    const firstTopic =
      existing?.topicId ??
      chapters.find((c) => c.id === firstChapter)?.topics.find((t) => !t.learningCompleted)?.id ??
      chapters.find((c) => c.id === firstChapter)?.topics[0]?.id ??
      ''
    setChapterId(firstChapter)
    setTopicId(firstTopic)
    setLearningCompleted(existing?.learningCompleted ?? true)
    setAlsoTopics([])
    setServerError('')
    setPracticeCompleted(existing?.practiceCompleted ?? true)
    setAttempted(String(existing?.questionsAttempted ?? slot?.practiceTarget ?? 0))
    setCorrect(String(existing?.correctAnswers ?? 0))
    setNotes(existing?.notes ?? '')
    setConfidence(existing?.confidence ?? 3)
    setDuration(String(existing?.durationMinutes ?? elapsedMinutes))
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionKey])

  if (!open || !record || !slot || !subject) return null

  const chapterTopics = chapterId ? topicsOfChapter(state, chapterId) : []
  const chapter = chapterId ? chapterById(state, chapterId) : undefined

  /** Mastery is never granted by a single session. (Plain computation: hooks may not follow the early return below.) */
  const chapterMastered = (() => {
    if (!chapter) return false
    const others = chapter.topics.filter((t) => t.id !== topicId)
    const allLearned = others.every((t) => t.learningCompleted || t.initialLearningDate)
    const allRevised = others.every((t) => t.revisions.length >= 2)
    const allStrong = others.every((t) => topicMastery(t) >= 78)
    return allLearned && allRevised && allStrong && others.length > 0
  })()

  const validate = () => {
    const errs: Record<string, string> = {}
    const a = Number(attempted)
    const c = Number(correct)
    const d = Number(duration)
    if (!chapterId) errs.chapter = 'Pick the chapter you studied.'
    if (!topicId) errs.topic = 'Pick the topic you studied.'
    if (Number.isNaN(a) || a < 0) errs.attempted = 'Enter 0 or more.'
    if (Number.isNaN(c) || c < 0) errs.correct = 'Enter 0 or more.'
    if (c > a) errs.correct = 'Correct answers cannot exceed questions attempted.'
    if (Number.isNaN(d) || d <= 0) errs.duration = 'Duration must be greater than 0.'
    if (d > 600) errs.duration = 'That looks too long for one session.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }


  /**
   * The server validates and records the completion first (it must have been started there,
   * through the revision gate). Only then is the workspace mirror updated for the legacy views.
   * Revisions are never recorded from here — only through revision obligations.
   */
  const submit = async () => {
    if (!validate()) return
    const a = Number(attempted)
    const c = Number(correct)
    const topic = topics.find((t) => t.id === topicId)
    setSaving(true)
    setServerError('')
    try {
      const day = await planApi.day(record.date)
      const target = day.sessions.find((x) => x.slotId === record.slotId && x.persisted)
      if (!target?.id) throw new Error('This session is not part of the published schedule for that day, so it cannot be recorded.')
      const completion = learningCompleted ? 'completed' : 'partial'
      const r = await planApi.completeSession(target.id, {
        topics: [topicId, ...alsoTopics.filter((t) => t !== topicId)].map((id) => ({ topicId: id, completion })),
        questionsAttempted: a,
        questionsCorrect: c,
        confidence,
        notes: notes.trim() || undefined,
        actualMinutes: Number(duration)
      })
      if (r.alreadyCompleted) {
        notify({ title: 'Already completed', message: 'This session was recorded earlier; completed sessions cannot be changed.', variant: 'info' })
        notifyPlanChanged()
        onClose()
        return
      }
      if (learningCompleted) alsoTopics.filter((t) => t !== topicId).forEach((t) => registerLearning(t, record.date, confidence))
      if (r.generated) {
        notify({
          title: 'Same-day revision scheduled',
          message: `${r.generated.subjectName}: revise ${r.generated.topics.map((t) => t.topicName).join(', ')} before the next cycle.`,
          variant: 'info'
        })
      }
      notifyPlanChanged()
      finishLocal(a, c, topic?.name ?? chapter?.name ?? 'Topic')
    } catch (err) {
      setServerError(
        err instanceof ApiError && err.code === 'SESSION_NOT_STARTED' ? 'Start this session first — completion is only accepted for a session the server has started.' : errorMessage(err)
      )
    } finally {
      setSaving(false)
    }
  }

  const finishLocal = (a: number, c: number, topicName: string) => {
    const completion: Omit<SessionCompletion, 'completedAt'> = {
      chapterId,
      topicId,
      topicName,
      learningCompleted,
      revisionCompleted: false,
      practiceCompleted,
      questionsAttempted: a,
      correctAnswers: c,
      incorrectAnswers: Math.max(0, a - c),
      notes: notes.trim(),
      confidence,
      durationMinutes: Number(duration),
      chapterMastered: learningCompleted && chapterMastered
    }
    completeSession(sessionKey!, completion)
    onClose()
  }

  const wrongCount = Math.max(0, Number(attempted) - Number(correct))

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Complete session — ${subject.name}`}
      subtitle={`${slot.label} · ${formatTime(slot.startTime)}–${formatTime(slot.endTime)} · ${formatDuration(slot.durationMinutes)}`}
      footer={
        <>
          <Button onClick={onClose}>{serverDone ? 'Close' : 'Cancel'}</Button>
          {serverDone ? null : (
            <Button variant="primary" icon={<Check size={14} />} loading={saving} onClick={submit}>
              Save session
            </Button>
          )}
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        {serverDone ? (
          <div className="callout callout--success">
            <CheckCircle2 size={14} />
            <span>
              Completed and recorded on the server
              {server?.completion?.topics.length ? `: ${server.completion.topics.map((t) => `${t.topicName}${t.completion === 'partial' ? ' (partial)' : ''}`).join(', ')}` : ''}
              {server?.actualMinutes ? ` · ${formatDuration(server.actualMinutes)}` : ''}. Completed sessions are immutable.
            </span>
          </div>
        ) : null}
        {server?.revisionStatus === 'bypassed' ? (
          <div className="callout callout--warning">
            <AlertTriangle size={14} />
            <span>This session started under an emergency override. Completing it does not complete the bypassed revision — it stays pending in the Revision Center.</span>
          </div>
        ) : null}
        {serverError ? (
          <div className="callout callout--danger">
            <AlertTriangle size={14} />
            <span>{serverError}</span>
          </div>
        ) : null}

        <div className="grid grid--2" style={{ gap: 12 }}>
          <Field label="Chapter" required error={errors.chapter}>
            <Select
              value={chapterId}
              onChange={(e) => {
                setChapterId(e.target.value)
                const next = topicsOfChapter(state, e.target.value)
                setTopicId(next[0]?.id ?? '')
              }}
            >
              <option value="">Select chapter</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Topic studied" required error={errors.topic}>
            <Select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">Select topic</option>
              {chapterTopics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.learningCompleted ? ' (revision)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {chapterTopics.filter((t) => t.id !== topicId).length ? (
          <Field label="Other topics covered in this session (optional)">
            <div className="pill-row">
              {chapterTopics
                .filter((t) => t.id !== topicId)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={cx('chip-filter', alsoTopics.includes(t.id) && 'is-active')}
                    onClick={() => setAlsoTopics((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                  >
                    {t.name}
                  </button>
                ))}
            </div>
          </Field>
        ) : null}

        <div className="muted-box">
          <p className="field__label" style={{ marginBottom: 8 }}>
            What did you complete in this session?
          </p>
          <div className="grid grid--3" style={{ gap: 10 }}>
            <Checkbox
              checked={learningCompleted}
              onChange={setLearningCompleted}
              label="Learning fully completed"
              description="Untick if the topic is only partly done — partial topics are never used for revision"
            />
            <Checkbox checked={practiceCompleted} onChange={setPracticeCompleted} label="Practice completed" />
          </div>
          <p className="field__hint" style={{ marginTop: 8 }}>
            Learning completed, revision completed and topic mastered are tracked separately. Revisions are recorded only through the revision obligations StudyOS creates
            from this learning — never from this form.
          </p>
        </div>

        <div className="grid grid--3" style={{ gap: 12 }}>
          <Field label="Questions attempted" error={errors.attempted}>
            <Input type="number" min={0} value={attempted} onChange={(e) => setAttempted(e.target.value)} />
          </Field>
          <Field label="Correct answers" error={errors.correct}>
            <Input type="number" min={0} value={correct} onChange={(e) => setCorrect(e.target.value)} />
          </Field>
          <Field label="Incorrect" hint={wrongCount > 0 ? `${wrongCount} automatically recorded` : 'Derived from above'}>
            <Input value={wrongCount} readOnly disabled />
          </Field>
        </div>

        <div className="grid grid--2" style={{ gap: 12 }}>
          <Field label="Actual study duration (minutes)" error={errors.duration}>
            <Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
          <Field label="Confidence level" hint={`${confidence}/5 — feeds mastery scoring`}>
            <div className="range-row">
              <input
                type="range"
                min={1}
                max={5}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                aria-label="Confidence level"
              />
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 26 }}>
                {confidence}/5
              </span>
            </div>
          </Field>
        </div>

        <Field label="Notes (optional)" hint="Key formulas, mistakes to avoid, doubts to resolve.">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Forgot to convert km/h to m/s — redo 5 questions." />
        </Field>

        {chapterMastered ? (
          <div className="callout callout--success">
            <Sparkles size={14} />
            <span>
              All topics in <strong>{chapter?.name}</strong> are learnt, revised twice and scoring above 78% — this session can mark the chapter
              <strong> Mastered</strong>.
            </span>
          </div>
        ) : (
          <div className="callout callout--neutral">
            <History size={14} />
            <span>
              Chapter status updates to <strong>Learning</strong> or <strong>Revision in progress</strong>. Mastery needs every topic learnt + at
              least 2 revisions + strong accuracy.
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Global session workflow host                                        */
/* ------------------------------------------------------------------ */

export function SessionWorkflowHost() {
  const { state, startSession, skipSession, notify } = useStudy()
  const [completeKey, setCompleteKey] = useState<string | null>(null)
  const [skipKey, setSkipKey] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [locked, setLocked] = useState<{ key: string; session: PlanSession } | null>(null)

  useEffect(() => {
    const onComplete = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      setCompleteKey(detail)
    }
    const onSkip = (e: Event) => setSkipKey((e as CustomEvent<string>).detail)
    window.addEventListener('studyos:open-complete', onComplete)
    window.addEventListener('studyos:open-skip', onSkip)
    return () => {
      window.removeEventListener('studyos:open-complete', onComplete)
      window.removeEventListener('studyos:open-skip', onSkip)
    }
  }, [])

  const skipRecord = skipKey ? state.sessions[skipKey] : null
  const skipSlot = skipRecord ? state.schedule.find((s) => s.id === skipRecord.slotId) : null

  /** The server's materialized session for a local session record. */
  const serverSessionFor = async (key: string) => {
    const rec = state.sessions[key]
    if (!rec) return null
    const day = await planApi.day(rec.date)
    return day.sessions.find((s) => s.slotId === rec.slotId && s.persisted) ?? null
  }

  /** Asks the server to start; the local timer only starts once the server accepted it. */
  const startOnServer = async (key: string, session: PlanSession) => {
    try {
      await planApi.startSession(session.id!)
      startSession(key, { gateCleared: true })
      notifyPlanChanged()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SESSION_LOCKED') {
        const fresh = await planApi.session(session.id!)
        setLocked({ key, session: fresh.session })
      } else {
        notify({ title: 'Could not start session', message: errorMessage(err), variant: 'error' })
      }
    }
  }

  const handleStart = async (key: string) => {
    setStarting(key)
    try {
      const session = await serverSessionFor(key)
      if (!session?.id) {
        notify({ title: 'Not in the published schedule', message: 'Only sessions of the schedule version in effect today can be started.', variant: 'error' })
        return
      }
      if (session.status === 'in_progress') {
        startSession(key, { gateCleared: true }) // resume the local timer
        return
      }
      if (session.status !== 'scheduled') {
        notify({ title: `Session ${session.status}`, message: 'This session can no longer be started.', variant: 'info' })
        return
      }
      if (!session.canStart) {
        if (session.lockReasons.length) setLocked({ key, session })
        else notify({ title: 'Not available yet', message: `This session is on ${session.date}.`, variant: 'info' })
        return
      }
      await startOnServer(key, session)
    } catch (err) {
      notify({ title: 'Could not start session', message: errorMessage(err), variant: 'error' })
    } finally {
      setStarting(null)
    }
  }

  return (
    <>
      {/* expose a global start handler so pages can trigger the same flow */}
      <SessionStartBridge onStart={(key) => void handleStart(key)} />

      <LockedSessionModal
        session={locked?.session ?? null}
        onClose={() => setLocked(null)}
        onUnlocked={(s) => {
          const key = locked?.key
          setLocked(null)
          if (key && s.canStart) void startOnServer(key, s)
        }}
      />

      <CompletionModal sessionKey={completeKey} open={Boolean(completeKey)} onClose={() => setCompleteKey(null)} />

      <ConfirmDialog
        open={Boolean(skipKey)}
        onClose={() => setSkipKey(null)}
        title="Skip this session?"
        message={`${skipSlot?.label ?? 'This session'} will be marked skipped for today. Skipping never completes or bypasses a required revision — it stays pending.`}
        confirmLabel="Skip session"
        requireReason
        reasonLabel="Reason for skipping"
        reasonPlaceholder="e.g. College exam, family emergency, feeling unwell"
        onConfirm={async (reason) => {
          const key = skipKey
          setSkipKey(null)
          if (!key) return
          try {
            const session = await serverSessionFor(key)
            if (session?.id && ['scheduled', 'in_progress'].includes(session.status)) await planApi.skipSession(session.id, reason)
            skipSession(key, reason)
            notifyPlanChanged()
          } catch (err) {
            notify({ title: 'Could not skip session', message: errorMessage(err), variant: 'error' })
          }
        }}
      />

      {starting ? <div className="sr-only">Starting session…</div> : null}
    </>
  )
}

/** Bridges a window event to the start handler (pages dispatch `studyos:start-session`). */
function SessionStartBridge({ onStart }: { onStart: (key: string) => void }) {
  useEffect(() => {
    const handler = (e: Event) => onStart((e as CustomEvent<string>).detail)
    window.addEventListener('studyos:start-session', handler)
    return () => window.removeEventListener('studyos:start-session', handler)
  }, [onStart])
  return null
}

export function triggerStartSession(key: string) {
  window.dispatchEvent(new CustomEvent('studyos:start-session', { detail: key }))
}

export function openCompletion(key: string) {
  window.dispatchEvent(new CustomEvent('studyos:open-complete', { detail: key }))
}

/* ------------------------------------------------------------------ */
/* Active session card (dashboard)                                     */
/* ------------------------------------------------------------------ */

export function ActiveSessionCard({ view }: { view: SessionView }) {
  const { state, toggleRevisionItem, setRevisionItem, pauseSession, resumeSession, today } = useStudy()
  const now = useNow(1000)
  const record = state.sessions[view.key]
  const pack = useMemo(() => buildRevisionPack(state, view.subject.id, today), [state, view.subject.id, today])
  if (!record) return null

  const elapsed = elapsedSecondsOf(record, now)
  const running = record.runningSince !== null
  const plannedSeconds = view.slot.durationMinutes * 60
  const percent = clamp(Math.round((elapsed / Math.max(1, plannedSeconds)) * 100), 0, 100)
  const checked = new Set(record.revisionChecklist)
  const revisionItems = pack.checklist.slice(0, 5)

  return (
    <Card className="active-session" pad={false}>
      <div className="active-session__head">
        <div>
          <span className="active-session__live">
            <span className="live-dot" />
            {running ? 'Session running' : 'Session paused'}
          </span>
          <p style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.02em', marginTop: 3 }}>{view.subject.name}</p>
          <p className="text-secondary" style={{ fontSize: 12 }}>
            {view.slot.label} · {view.slot.learningTarget}
          </p>
        </div>
        <StatusBadge status={record.status} size="sm" />
      </div>

      <div className="active-session__timer">
        <span className="active-session__clock">{formatClock(elapsed)}</span>
        <span className="active-session__of">/ {formatDuration(view.slot.durationMinutes)} planned</span>
        <div style={{ flex: 1 }} />
        <Ring value={percent} size={54} stroke={5} tone={percent >= 100 ? 'var(--success)' : 'var(--accent)'}>
          <span className="mono" style={{ fontSize: 11 }}>
            {percent}%
          </span>
        </Ring>
      </div>

      <div className="active-session__body">
        <Progress value={percent} tone={percent >= 100 ? 'success' : 'accent'} height={6} />

        <div>
          <p className="field__label" style={{ marginBottom: 6 }}>
            Revision checklist
          </p>
          <div className="checklist">
            {revisionItems.length ? (
              revisionItems.map((item) => (
                <label key={item.id} className={cx('checklist__item', checked.has(item.id) && 'is-done')}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={checked.has(item.id)}
                    onChange={(e) => setRevisionItem(view.key, item.id, e.target.checked)}
                  />
                  <span style={{ flex: 1 }}>
                    <span className="checklist__text" style={{ display: 'block' }}>
                      {item.title}
                    </span>
                    <span className="checklist__meta">{item.meta}</span>
                  </span>
                </label>
              ))
            ) : (
              <div className="checklist__item" style={{ cursor: 'default' }}>
                <span className="checklist__meta">No revision items for this subject yet.</span>
              </div>
            )}
          </div>
        </div>

        <div className="active-session__controls">
          {running ? (
            <Button variant="secondary" icon={<Pause size={14} />} onClick={() => pauseSession(view.key)}>
              Pause
            </Button>
          ) : (
            <Button variant="secondary" icon={<Play size={14} />} onClick={() => resumeSession(view.key)}>
              Resume
            </Button>
          )}
          <Button variant="primary" icon={<Check size={14} />} onClick={() => openCompletion(view.key)}>
            Complete session
          </Button>
          <Button
            variant="ghost"
            onClick={() => toggleRevisionItem(view.key, revisionItems[0]?.id ?? '')}
            disabled={!revisionItems.length}
          >
            Quick-tick top item
          </Button>
        </div>
      </div>
    </Card>
  )
}
