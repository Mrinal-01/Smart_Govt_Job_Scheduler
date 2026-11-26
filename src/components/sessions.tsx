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
          <StatusBadge status={status} size="sm" />
        </div>

        <div className="row row--wrap" style={{ gap: 10 }}>
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

        {!compact ? (
          <div className="session-card__topics">
            {slot.requiresRevision ? (
              <div className="session-topic-row">
                <RotateCcw size={11} style={{ color: record.revisionMarked ? 'var(--success)' : 'var(--warning)' }} />
                <span>
                  Revision:{' '}
                  <b>
                    {record.revisionMarked
                      ? 'Marked complete'
                      : record.revisionSkippedReason
                        ? `Skipped — ${record.revisionSkippedReason}`
                        : 'Previously studied topics pending'}
                  </b>
                </span>
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
                View / edit log
              </Button>
            ) : status === 'skipped' ? (
              <Button size="sm" variant="ghost" onClick={() => onStart(view.key)}>
                Restart session
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant={status === 'in-progress' || status === 'revision-pending' ? 'primary' : 'secondary'}
                  icon={<Play size={12} />}
                  onClick={() => onStart(view.key)}
                >
                  {status === 'in-progress' || status === 'revision-pending' ? 'Resume' : 'Start session'}
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
/* Revision preparation panel                                          */
/* ------------------------------------------------------------------ */

export function RevisionPrepPanel({
  subjectId,
  sessionKey,
  onDone
}: {
  subjectId: ID
  sessionKey: string
  onDone: () => void
}) {
  const { state, today, setRevisionItem, skipRevision } = useStudy()
  const record = state.sessions[sessionKey]
  const pack = useMemo(() => buildRevisionPack(state, subjectId, today), [state, subjectId, today])
  const checked = new Set(record?.revisionChecklist ?? [])
  const [skipOpen, setSkipOpen] = useState(false)

  const topicItems = pack.checklist.filter((c) => c.kind === 'topic')
  const doneCount = pack.checklist.filter((c) => checked.has(c.id)).length
  const minRequired = Math.min(1, topicItems.length)
  const canProceed = doneCount >= minRequired

  const markAll = () => {
    pack.checklist.forEach((item) => setRevisionItem(sessionKey, item.id, true))
  }

  return (
    <div className="rev-prep">
      <div className="callout callout--info">
        <ShieldCheck size={15} />
        <div>
          <strong>Revision before new learning.</strong> StudyOS surfaced {pack.totalTopics} previously studied topic
          {pack.totalTopics === 1 ? '' : 's'}
          {pack.mistakes.length ? ` and ${pack.mistakes.length} unresolved mistake${pack.mistakes.length === 1 ? '' : 's'}` : ''} for{' '}
          {pack.subjectName}. Tick what you revised — initial learning never counts as revision.
        </div>
      </div>

      <div className="row row--between">
        <span className="text-secondary" style={{ fontSize: 12 }}>
          {doneCount} of {pack.checklist.length} revision items ticked
        </span>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={markAll}>
            Tick all
          </Button>
        </div>
      </div>
      <Progress value={doneCount} max={Math.max(1, pack.checklist.length)} tone={canProceed ? 'success' : 'accent'} height={5} />

      <div className="rev-prep__step">
        <span className="rev-prep__num">1</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            Due for revision <span className="text-tertiary">({pack.due.length})</span>
          </p>
          {pack.due.length ? (
            <div className="checklist">
              {pack.due.map((item) => (
                <label key={item.id} className={cx('checklist__item', checked.has(item.id) && 'is-done')}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={checked.has(item.id)}
                    onChange={(e) => setRevisionItem(sessionKey, item.id, e.target.checked)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="checklist__text" style={{ display: 'block' }}>
                      {item.title}
                    </span>
                    <span className="checklist__meta">{item.meta}</span>
                  </span>
                  {item.badge ? (
                    <Badge tone={item.badge.includes('overdue') ? 'danger' : 'warning'} size="sm">
                      {item.badge}
                    </Badge>
                  ) : null}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-tertiary" style={{ fontSize: 12 }}>
              Nothing overdue for this subject — good place to be.
            </p>
          )}
        </div>
      </div>

      <div className="rev-prep__step">
        <span className="rev-prep__num">2</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            Previously studied topics <span className="text-tertiary">({pack.previous.length})</span>
          </p>
          {pack.previous.length ? (
            <div className="checklist">
              {pack.previous.map((item) => (
                <label key={item.id} className={cx('checklist__item', checked.has(item.id) && 'is-done')}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={checked.has(item.id)}
                    onChange={(e) => setRevisionItem(sessionKey, item.id, e.target.checked)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="checklist__text" style={{ display: 'block' }}>
                      {item.title}
                    </span>
                    <span className="checklist__meta">{item.meta}</span>
                  </span>
                  <span className="rev-badge-count">{item.badge?.split(' ')[0] ?? 0}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-tertiary" style={{ fontSize: 12 }}>
              This is the first session for this subject — nothing to revise yet.
            </p>
          )}
        </div>
      </div>

      {pack.mistakes.length ? (
        <div className="rev-prep__step">
          <span className="rev-prep__num">3</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
              Wrong questions to review <span className="text-tertiary">({pack.mistakes.length})</span>
            </p>
            <div className="checklist">
              {pack.mistakes.map((item) => (
                <label key={item.id} className={cx('checklist__item', checked.has(item.id) && 'is-done')}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={checked.has(item.id)}
                    onChange={(e) => setRevisionItem(sessionKey, item.id, e.target.checked)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="checklist__text" style={{ display: 'block' }}>
                      {item.title}
                    </span>
                    <span className="checklist__meta">{item.meta}</span>
                  </span>
                  <Badge tone="danger" size="sm">
                    wrong
                  </Badge>
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {pack.formulas.length ? (
        <div className="rev-prep__step">
          <span className="rev-prep__num">{pack.mistakes.length ? 4 : 3}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Important formulas & notes</p>
            <div className="stack" style={{ gap: 8 }}>
              {pack.formulas.map((f) => (
                <div className="muted-box" key={f.topicName}>
                  <p style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>{f.topicName}</p>
                  <div>
                    {f.values.map((v) => (
                      <span className="formula-chip" key={v}>
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="row row--wrap" style={{ gap: 8, paddingTop: 4 }}>
        <Button variant="primary" icon={<ArrowRight size={14} />} onClick={onDone} disabled={!canProceed}>
          Start new learning
        </Button>
        <Button variant="ghost" onClick={() => setSkipOpen(true)}>
          Skip revision with reason
        </Button>
        {!canProceed ? <span className="text-tertiary" style={{ fontSize: 11.5 }}>Tick at least one revision item to continue.</span> : null}
      </div>

      <ConfirmDialog
        open={skipOpen}
        onClose={() => setSkipOpen(false)}
        title="Skip revision?"
        message="Skipping is allowed and never blocks your schedule, but the reason is recorded and the topic stays overdue in the Revision Center."
        confirmLabel="Skip revision"
        requireReason
        reasonLabel="Why are you skipping?"
        reasonPlaceholder="e.g. Running late, will revise during Sunday review"
        onConfirm={(reason) => {
          skipRevision(sessionKey, reason)
          onDone()
        }}
      />
    </div>
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
  const { state, completeSession, notify } = useStudy()
  const record = sessionKey ? state.sessions[sessionKey] : null
  const slot = record ? state.schedule.find((s) => s.id === record.slotId) : null
  const subject = record ? subjectById(state, record.subjectId) : null

  const elapsedMinutes = record ? Math.max(1, Math.round(elapsedSecondsOf(record) / 60)) : 0

  const [chapterId, setChapterId] = useState<ID>('')
  const [topicId, setTopicId] = useState<ID>('')
  const [learningCompleted, setLearningCompleted] = useState(true)
  const [revisionCompleted, setRevisionCompleted] = useState(true)
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
    setRevisionCompleted(existing?.revisionCompleted ?? Boolean(record.revisionMarked))
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

  /** Mastery is never granted by a single session. */
  const chapterMastered = useMemo(() => {
    if (!chapter) return false
    const others = chapter.topics.filter((t) => t.id !== topicId)
    const allLearned = others.every((t) => t.learningCompleted || t.initialLearningDate)
    const allRevised = others.every((t) => t.revisions.length >= 2)
    const allStrong = others.every((t) => topicMastery(t) >= 78)
    return allLearned && allRevised && allStrong && others.length > 0
  }, [chapter, topicId])

  const submit = () => {
    if (!validate()) return
    const a = Number(attempted)
    const c = Number(correct)
    const topic = topics.find((t) => t.id === topicId)
    const completion: Omit<SessionCompletion, 'completedAt'> = {
      chapterId,
      topicId,
      topicName: topic?.name ?? chapter?.name ?? 'Topic',
      learningCompleted,
      revisionCompleted,
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
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Check size={14} />} onClick={submit}>
            Save session
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        {record.revisionSkippedReason ? (
          <div className="callout callout--warning">
            <AlertTriangle size={14} />
            <span>Revision was skipped: {record.revisionSkippedReason}. It stays overdue in the Revision Center.</span>
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

        <div className="muted-box">
          <p className="field__label" style={{ marginBottom: 8 }}>
            What did you complete in this session?
          </p>
          <div className="grid grid--3" style={{ gap: 10 }}>
            <Checkbox checked={learningCompleted} onChange={setLearningCompleted} label="Learning completed" />
            <Checkbox
              checked={revisionCompleted}
              onChange={setRevisionCompleted}
              label="Revision completed"
              description="Records a revision entry"
            />
            <Checkbox checked={practiceCompleted} onChange={setPracticeCompleted} label="Practice completed" />
          </div>
          <p className="field__hint" style={{ marginTop: 8 }}>
            These are tracked separately — a chapter is never marked “mastered” from one completed session.
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
  const [startKey, setStartKey] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

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

  const startRecord = startKey ? state.sessions[startKey] : null
  const startSlot = startRecord ? state.schedule.find((s) => s.id === startRecord.slotId) : null
  const startSubject = startRecord ? subjectById(state, startRecord.subjectId) : null

  const skipRecord = skipKey ? state.sessions[skipKey] : null
  const skipSlot = skipRecord ? state.schedule.find((s) => s.id === skipRecord.slotId) : null

  const handleStart = (key: string) => {
    setStarting(key)
    window.setTimeout(() => {
      const result = startSession(key)
      setStarting(null)
      if (result.needsRevision) {
        setStartKey(key)
        notify({
          title: 'Revision required first',
          message: `${result.topic ?? 'Previous topics'} should be revised before new learning.`,
          variant: 'info'
        })
      }
    }, 260)
  }

  return (
    <>
      {/* expose a global start handler so pages can trigger the same flow */}
      <SessionStartBridge onStart={handleStart} />

      <Modal
        open={Boolean(startKey)}
        onClose={() => setStartKey(null)}
        size="lg"
        title={`Revision preparation — ${startSubject?.name ?? ''}`}
        subtitle={startSlot ? `${startSlot.label} · ${formatTime(startSlot.startTime)}–${formatTime(startSlot.endTime)}` : undefined}
      >
        {startKey ? (
          <RevisionPrepPanel
            subjectId={startRecord!.subjectId}
            sessionKey={startKey}
            onDone={() => {
              setStartKey(null)
              window.dispatchEvent(new CustomEvent('studyos:revision-done', { detail: startKey }))
            }}
          />
        ) : null}
      </Modal>

      <CompletionModal sessionKey={completeKey} open={Boolean(completeKey)} onClose={() => setCompleteKey(null)} />

      <ConfirmDialog
        open={Boolean(skipKey)}
        onClose={() => setSkipKey(null)}
        title="Skip this session?"
        message={`${skipSlot?.label ?? 'This session'} will be marked skipped for today. Your schedule stays intact and it will not count toward daily progress.`}
        confirmLabel="Skip session"
        requireReason
        reasonLabel="Reason for skipping"
        reasonPlaceholder="e.g. College exam, family emergency, feeling unwell"
        onConfirm={(reason) => {
          if (skipKey) skipSession(skipKey, reason)
          setSkipKey(null)
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
