import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, Bookmark, Check, CloudOff, Eraser, Maximize, Minimize, Send, Timer } from 'lucide-react'
import { Badge, Button, LoadingBlock, Modal } from '../../components/ui'
import { ApiError, api, errorMessage } from '../../lib/http'
import { cx } from '../../lib/utils'

interface AttemptQuestion {
  questionId: string
  order: number
  questionText: string
  questionType: 'single_correct' | 'multiple_correct' | 'numeric' | 'true_false' | 'unknown'
  options: Array<{ label: string; text: string }>
  subjectName: string | null
  chapterName: string | null
}
interface AttemptView {
  _id: string
  testName: string
  status: 'in_progress' | 'submitted' | 'auto_submitted'
  deadlineAt: string
  serverNow: string
  durationSeconds: number
  marksPerQuestion: number
  negativeMarks: number
  instructions: string
  questions: AttemptQuestion[]
  answers: Array<{ questionId: string; selected: string[]; markedForReview: boolean; visited: boolean }>
}
interface AnswerState {
  selected: string[]
  markedForReview: boolean
  visited: boolean
}

type SaveState = 'saved' | 'saving' | 'offline' | 'error'
const LETTERS = ['A', 'B', 'C', 'D', 'E']
const backupKey = (id: string) => `studyos.exam.${id}`

function paletteStatus(a: AnswerState | undefined) {
  if (!a || !a.visited) return 'not-visited'
  const answered = a.selected.length > 0
  if (a.markedForReview) return answered ? 'answered-marked' : 'marked'
  return answered ? 'answered' : 'not-answered'
}

export default function LiveTestPage() {
  const { attemptId = '' } = useParams()
  const navigate = useNavigate()
  const [attempt, setAttempt] = useState<AttemptView | null>(null)
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const [index, setIndex] = useState(0)
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const dirty = useRef<Set<string>>(new Set())
  const answersRef = useRef(answers)
  answersRef.current = answers
  const finishing = useRef(false)

  const goToResult = useCallback(() => {
    sessionStorage.removeItem(backupKey(attemptId))
    navigate(`/tests/attempts/${attemptId}`, { replace: true })
  }, [attemptId, navigate])

  /* ------------------------------ load ------------------------------ */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { attempt: a } = await api<{ attempt: AttemptView }>(`/api/attempts/${attemptId}`)
        if (cancelled) return
        if (a.status !== 'in_progress') return goToResult()
        // The server clock is authoritative: measure our offset from it once.
        setOffset(Date.parse(a.serverNow) - Date.now())
        const map: Record<string, AnswerState> = {}
        a.answers.forEach((x) => (map[x.questionId] = { selected: x.selected, markedForReview: x.markedForReview, visited: x.visited }))
        // Recover answers that were made offline in this tab but never reached the server.
        try {
          const backup = JSON.parse(sessionStorage.getItem(backupKey(attemptId)) ?? 'null') as { answers: Record<string, AnswerState>; dirty: string[] } | null
          backup?.dirty.forEach((qid) => {
            if (backup.answers[qid]) {
              map[qid] = backup.answers[qid]
              dirty.current.add(qid)
            }
          })
        } catch {
          /* ignore corrupt backup */
        }
        const first = a.questions[0]?.questionId
        if (first && !map[first]) {
          map[first] = { selected: [], markedForReview: false, visited: true }
          dirty.current.add(first)
        }
        setAnswers(map)
        setAttempt(a)
      } catch (err) {
        setError(errorMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attemptId, goToResult])

  /* ------------------------------ save ------------------------------ */
  const flush = useCallback(async (): Promise<boolean> => {
    if (!dirty.current.size) return true
    const ids = Array.from(dirty.current)
    dirty.current.clear()
    const payload = ids.map((questionId) => ({ questionId, ...answersRef.current[questionId] }))
    setSaveState('saving')
    try {
      await api(`/api/attempts/${attemptId}/answers`, { method: 'PUT', body: { answers: payload } })
      setSaveState('saved')
      setLastSaved(new Date())
      sessionStorage.setItem(backupKey(attemptId), JSON.stringify({ answers: answersRef.current, dirty: Array.from(dirty.current) }))
      return true
    } catch (err) {
      ids.forEach((id) => dirty.current.add(id))
      sessionStorage.setItem(backupKey(attemptId), JSON.stringify({ answers: answersRef.current, dirty: Array.from(dirty.current) }))
      if (err instanceof ApiError && err.code === 'ATTEMPT_CLOSED') {
        goToResult()
        return false
      }
      setSaveState(err instanceof ApiError && err.status === 0 ? 'offline' : 'error')
      return false
    }
  }, [attemptId, goToResult])

  useEffect(() => {
    if (!attempt) return
    const id = window.setInterval(() => void flush(), 4000)
    const onHide = () => document.visibilityState === 'hidden' && void flush()
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [attempt, flush])

  useEffect(() => {
    if (!attempt) return
    const warn = (e: BeforeUnloadEvent) => {
      if (finishing.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [attempt])

  const update = (qid: string, patch: Partial<AnswerState>) => {
    setAnswers((prev) => {
      const base: AnswerState = prev[qid] ?? { selected: [], markedForReview: false, visited: true }
      const next = { ...prev, [qid]: { ...base, visited: true, ...patch } }
      answersRef.current = next
      sessionStorage.setItem(backupKey(attemptId), JSON.stringify({ answers: next, dirty: [...Array.from(dirty.current), qid] }))
      return next
    })
    dirty.current.add(qid)
    setSaveState('saving')
  }

  /* ------------------------------ timer ----------------------------- */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [])
  const remaining = attempt ? Math.max(0, Math.floor((Date.parse(attempt.deadlineAt) - (now + offset)) / 1000)) : 0

  const submit = useCallback(async () => {
    if (finishing.current) return
    finishing.current = true
    setSubmitting(true)
    await flush()
    try {
      await api(`/api/attempts/${attemptId}/submit`, { method: 'POST' })
    } catch (err) {
      // Submission is idempotent server-side; a closed attempt is already submitted.
      if (!(err instanceof ApiError && err.code === 'ATTEMPT_CLOSED')) {
        finishing.current = false
        setSubmitting(false)
        setError(errorMessage(err))
        return
      }
    }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
    goToResult()
  }, [attemptId, flush, goToResult])

  useEffect(() => {
    if (attempt && remaining === 0) void submit()
  }, [attempt, remaining, submit])

  /* ---------------------------- fullscreen -------------------------- */
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  const counts = useMemo(() => {
    const qs = attempt?.questions ?? []
    const st = qs.map((q) => paletteStatus(answers[q.questionId]))
    return {
      answered: st.filter((s) => s === 'answered' || s === 'answered-marked').length,
      marked: st.filter((s) => s === 'marked' || s === 'answered-marked').length,
      notAnswered: st.filter((s) => s === 'not-answered' || s === 'marked').length,
      notVisited: st.filter((s) => s === 'not-visited').length
    }
  }, [attempt, answers])

  if (error && !attempt) {
    return (
      <div className="gate-center">
        <div className="callout callout--danger">
          {error}{' '}
          <button className="link-btn" onClick={() => navigate('/tests')}>
            Back to tests
          </button>
        </div>
      </div>
    )
  }
  if (!attempt) return <div className="gate-center"><LoadingBlock label="Loading your test…" /></div>

  const q = attempt.questions[index]
  const a = answers[q.questionId]
  const go = (i: number) => {
    const target = attempt.questions[i]
    if (!target) return
    if (!answers[target.questionId]?.visited) update(target.questionId, { visited: true })
    setIndex(i)
    void flush()
  }
  const select = (label: string) => {
    const cur = a?.selected ?? []
    const next = q.questionType === 'multiple_correct' ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label].sort()) : [label]
    update(q.questionId, { selected: next })
  }
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const low = remaining <= 60

  return (
    <div className="exam">
      <header className="exam__bar">
        <div className="exam__title">
          <strong>{attempt.testName}</strong>
          <span className="text-tertiary">
            {attempt.questions.length} questions · +{attempt.marksPerQuestion}
            {attempt.negativeMarks ? ` / −${attempt.negativeMarks}` : ''}
          </span>
        </div>
        <div className={cx('exam__timer', low && 'is-low')} role="timer" aria-live={low ? 'assertive' : 'off'} aria-label="Time remaining">
          <Timer size={16} /> <span className="mono">{mm}:{ss}</span>
        </div>
        <div className="exam__actions">
          <span className={cx('exam__save', `is-${saveState}`)}>
            {saveState === 'saved' ? (
              <>
                <Check size={13} /> {lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : 'Saved'}
              </>
            ) : saveState === 'saving' ? (
              'Saving…'
            ) : (
              <>
                <CloudOff size={13} /> {saveState === 'offline' ? 'Offline — answers kept, retrying' : 'Save failed — retrying'}
              </>
            )}
          </span>
          <Button size="sm" variant="ghost" icon={fullscreen ? <Minimize size={14} /> : <Maximize size={14} />} onClick={toggleFullscreen}>
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </Button>
          <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={() => setConfirm(true)} disabled={submitting}>
            Submit
          </Button>
        </div>
      </header>

      <div className="exam__body">
        <main className="exam__question">
          {attempt.instructions && index === 0 ? <div className="callout callout--info" style={{ marginBottom: 14 }}>{attempt.instructions}</div> : null}
          <div className="row row--between" style={{ marginBottom: 10 }}>
            <span className="exam__qnum">
              Question {index + 1} of {attempt.questions.length}
            </span>
            <span className="row" style={{ gap: 6 }}>
              {q.subjectName ? <Badge size="sm">{q.subjectName}</Badge> : null}
              {q.questionType === 'multiple_correct' ? <Badge size="sm" tone="info">Select all that apply</Badge> : null}
            </span>
          </div>
          <p className="exam__text">{q.questionText}</p>

          {q.questionType === 'numeric' ? (
            <label className="field" style={{ maxWidth: 260 }}>
              <span className="field__label">Your answer</span>
              <input
                className="input"
                inputMode="decimal"
                value={a?.selected[0] ?? ''}
                onChange={(e) => update(q.questionId, { selected: e.target.value.trim() && Number.isFinite(Number(e.target.value)) ? [e.target.value.trim()] : [] })}
              />
            </label>
          ) : (
            <div className="exam__options" role={q.questionType === 'multiple_correct' ? 'group' : 'radiogroup'}>
              {q.options.map((o, i) => {
                const on = a?.selected.includes(o.label)
                return (
                  <button
                    key={o.label}
                    type="button"
                    role={q.questionType === 'multiple_correct' ? 'checkbox' : 'radio'}
                    aria-checked={Boolean(on)}
                    className={cx('exam__option', on && 'is-selected')}
                    onClick={() => select(o.label)}
                  >
                    <span className="exam__option-label">{LETTERS[i]}</span>
                    <span>{o.text}</span>
                  </button>
                )
              })}
            </div>
          )}

          <footer className="exam__nav">
            <Button icon={<ArrowLeft size={14} />} disabled={index === 0} onClick={() => go(index - 1)}>
              Previous
            </Button>
            <Button variant="ghost" icon={<Eraser size={14} />} onClick={() => update(q.questionId, { selected: [] })} disabled={!a?.selected.length}>
              Clear response
            </Button>
            <Button variant={a?.markedForReview ? 'secondary' : 'ghost'} icon={<Bookmark size={14} />} onClick={() => update(q.questionId, { markedForReview: !a?.markedForReview })}>
              {a?.markedForReview ? 'Unmark review' : 'Mark for review'}
            </Button>
            <span className="spacer" />
            <Button variant="primary" iconRight={<ArrowRight size={14} />} disabled={index === attempt.questions.length - 1} onClick={() => go(index + 1)}>
              Save & next
            </Button>
          </footer>
        </main>

        <aside className="exam__palette" aria-label="Question palette">
          <div className="palette-legend">
            <span><i className="dot is-answered" /> Answered {counts.answered}</span>
            <span><i className="dot is-not-answered" /> Not answered {counts.notAnswered}</span>
            <span><i className="dot is-marked" /> Marked {counts.marked}</span>
            <span><i className="dot is-not-visited" /> Not visited {counts.notVisited}</span>
          </div>
          <div className="palette-grid">
            {attempt.questions.map((x, i) => (
              <button
                key={x.questionId}
                type="button"
                className={cx('palette-btn', `is-${paletteStatus(answers[x.questionId])}`, i === index && 'is-current')}
                onClick={() => go(i)}
                aria-label={`Question ${i + 1}: ${paletteStatus(answers[x.questionId]).replace('-', ' ')}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </aside>
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Submit the test?"
        size="sm"
        dismissible={!submitting}
        footer={
          <>
            <Button onClick={() => setConfirm(false)} disabled={submitting}>
              Keep going
            </Button>
            <Button variant="primary" loading={submitting} onClick={submit}>
              Submit now
            </Button>
          </>
        }
      >
        <div className="stack stack--sm">
          <p>
            Answered <strong>{counts.answered}</strong> of {attempt.questions.length}. {counts.marked ? `${counts.marked} marked for review. ` : ''}
            {attempt.questions.length - counts.answered ? `${attempt.questions.length - counts.answered} unanswered.` : ''}
          </p>
          <p className="text-tertiary">You cannot change answers after submitting.</p>
          {error ? (
            <div className="callout callout--danger">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
