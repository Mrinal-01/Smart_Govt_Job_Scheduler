import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Flag,
  History,
  Play,
  Send,
  Target,
  Timer,
  TrendingUp,
  XCircle
} from 'lucide-react'
import type { ID, MockAttempt, MockTest, Mistake, Question } from '../types'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
  Progress,
  Ring,
  Segmented,
  Tabs
} from '../components/ui'
import { useStudy, useNow } from '../store/StudyStore'
import { subjectById, topicById, chapterById } from '../store/selectors'
import { formatClock, formatDuration, formatShortDate } from '../lib/date'
import { clamp, cx, sum, uid } from '../lib/utils'

export default function MockTestsPage() {
  const { mockId } = useParams()
  const navigate = useNavigate()
  const { state } = useStudy()

  if (mockId) {
    const mock = state.mockTests.find((m) => m.id === mockId)
    if (mock) return <TestRunner mock={mock} onExit={() => navigate('/mock-tests')} />
  }

  return <MockTestsHome />
}

/* ------------------------------------------------------------------ */

function MockTestsHome() {
  const { state } = useStudy()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'available' | 'history'>('available')
  const [detail, setDetail] = useState<MockAttempt | null>(null)

  const attempts = useMemo(
    () => [...state.attempts].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)),
    [state.attempts]
  )

  const avgAccuracy = attempts.length ? Math.round(sum(attempts.map((a) => a.accuracy)) / attempts.length) : 0
  const bestAccuracy = attempts.length ? Math.max(...attempts.map((a) => a.accuracy)) : 0

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Mock Tests</h1>
          <p className="page-head__sub">
            Chapter-wise and weekly tests with a real countdown, question palette and mark-for-review. Wrong answers can be pushed straight into the
            Mistake Bank.
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" onClick={() => navigate('/sunday')} icon={<BookmarkCheck size={14} />}>
            Sunday review
          </Button>
        </div>
      </div>

      <div className="grid grid--4 section" style={{ gap: 11 }}>
        <Card>
          <p className="stat__label">Tests taken</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{attempts.length}</p>
          <p className="stat__hint">{state.mockTests.length} available</p>
        </Card>
        <Card>
          <p className="stat__label">Average accuracy</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{avgAccuracy}%</p>
          <Progress value={avgAccuracy} tone={avgAccuracy >= 75 ? 'success' : 'accent'} height={4} />
        </Card>
        <Card>
          <p className="stat__label">Best score</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{bestAccuracy}%</p>
          <p className="stat__hint">personal best</p>
        </Card>
        <Card>
          <p className="stat__label">Questions attempted</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>
            {sum(attempts.map((a) => a.correct + a.incorrect))}
          </p>
          <p className="stat__hint">{sum(attempts.map((a) => a.correct))} correct</p>
        </Card>
      </div>

      <Card>
        <div className="row row--between row--wrap" style={{ marginBottom: 14, gap: 10 }}>
          <Tabs
            value={tab}
            onChange={(v) => setTab(v)}
            tabs={[
              { value: 'available', label: 'Available tests', count: state.mockTests.length },
              { value: 'history', label: 'Test history', count: attempts.length }
            ]}
          />
        </div>

        {tab === 'available' ? (
          <div className="grid grid--3" style={{ gap: 12 }}>
            {state.mockTests.map((mock) => {
              const subject = mock.subjectId === 'mixed' ? null : subjectById(state, mock.subjectId)
              const mockAttempts = attempts.filter((a) => a.mockId === mock.id)
              const best = mockAttempts.length ? Math.max(...mockAttempts.map((a) => a.accuracy)) : null
              return (
                <div className="mock-card" key={mock.id}>
                  <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <p className="mock-card__title">{mock.title}</p>
                      <p className="mock-card__meta" style={{ marginTop: 3 }}>
                        <Badge tone={mock.type === 'weekly' ? 'accent' : 'neutral'} size="sm">
                          {mock.type === 'weekly' ? 'Weekly' : 'Chapter-wise'}
                        </Badge>
                        <span>{subject?.shortName ?? 'All subjects'}</span>
                      </p>
                    </div>
                    {best !== null ? (
                      <Ring value={best} size={40} stroke={4} tone={best >= 75 ? 'var(--success)' : 'var(--accent)'}>
                        <span className="mono" style={{ fontSize: 10 }}>{best}</span>
                      </Ring>
                    ) : null}
                  </div>
                  <p className="mock-card__desc">{mock.description}</p>
                  <div className="mock-card__meta">
                    <span className="row" style={{ gap: 4 }}>
                      <ClipboardList size={11} /> {mock.questionIds.length} Qs
                    </span>
                    <span className="row" style={{ gap: 4 }}>
                      <Timer size={11} /> {mock.durationMinutes} min
                    </span>
                    {mockAttempts.length ? <span>· tried {mockAttempts.length}×</span> : <span>· not attempted</span>}
                  </div>
                  <Button variant="primary" block icon={<Play size={13} />} onClick={() => navigate(`/mock-tests/${mock.id}`)}>
                    Start test
                  </Button>
                </div>
              )
            })}
          </div>
        ) : attempts.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Test</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                  <th style={{ textAlign: 'right' }}>Accuracy</th>
                  <th style={{ textAlign: 'right' }}>Time</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatShortDate(a.submittedAt.slice(0, 10))}</td>
                    <td>
                      <div style={{ fontWeight: 550 }}>{a.title}</div>
                      <div className="text-tertiary" style={{ fontSize: 11 }}>
                        {a.subjectId === 'mixed' ? 'All subjects' : subjectById(state, a.subjectId)?.name} · {a.totalQuestions} questions
                      </div>
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {a.correct}/{a.totalQuestions}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Badge tone={a.accuracy >= 75 ? 'success' : a.accuracy >= 55 ? 'warning' : 'danger'} size="sm">
                        {a.accuracy}%
                      </Badge>
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatClock(a.durationUsedSeconds)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button size="sm" variant="ghost" onClick={() => setDetail(a)} iconRight={<ChevronRight size={12} />}>
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<History size={20} />} title="No test history yet" message="Complete a mock test and the full result breakdown appears here." />
        )}
      </Card>

      <AttemptReviewModal attempt={detail} onClose={() => setDetail(null)} />
    </main>
  )
}

/* ------------------------------------------------------------------ */

function AttemptReviewModal({ attempt, onClose }: { attempt: MockAttempt | null; onClose: () => void }) {
  const { state } = useStudy()
  if (!attempt) return null

  return (
    <Modal open onClose={onClose} size="lg" title={attempt.title} subtitle={`Submitted ${formatShortDate(attempt.submittedAt.slice(0, 10))} · ${attempt.totalQuestions} questions`}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="grid grid--4" style={{ gap: 9 }}>
          <div className="result-cell">
            <p className="result-cell__value" style={{ color: 'var(--success)' }}>{attempt.correct}</p>
            <p className="result-cell__label">Correct</p>
          </div>
          <div className="result-cell">
            <p className="result-cell__value" style={{ color: 'var(--danger)' }}>{attempt.incorrect}</p>
            <p className="result-cell__label">Incorrect</p>
          </div>
          <div className="result-cell">
            <p className="result-cell__value">{attempt.unattempted}</p>
            <p className="result-cell__label">Skipped</p>
          </div>
          <div className="result-cell">
            <p className="result-cell__value">{attempt.accuracy}%</p>
            <p className="result-cell__label">Accuracy</p>
          </div>
        </div>

        <div>
          <p className="field__label" style={{ marginBottom: 7 }}>Subject breakdown</p>
          <div className="stack" style={{ gap: 8 }}>
            {attempt.subjectBreakdown.map((s) => {
              const subject = subjectById(state, s.subjectId)
              const p = Math.round((s.correct / Math.max(1, s.total)) * 100)
              return (
                <div key={s.subjectId}>
                  <div className="row row--between" style={{ marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{subject?.name}</span>
                    <span className="mono text-secondary" style={{ fontSize: 11.5 }}>
                      {s.correct}/{s.total} · {p}%
                    </span>
                  </div>
                  <Progress value={p} tone={p >= 75 ? 'success' : p >= 55 ? 'accent' : 'danger'} height={4} />
                </div>
              )
            })}
          </div>
        </div>

        {attempt.topicBreakdown.length ? (
          <div>
            <p className="field__label" style={{ marginBottom: 7 }}>Topic-wise weak areas</p>
            <div className="stack" style={{ gap: 5 }}>
              {[...attempt.topicBreakdown]
                .sort((a, b) => a.accuracy - b.accuracy)
                .slice(0, 8)
                .map((t) => (
                  <div key={t.topicId} className="row row--between" style={{ fontSize: 12 }}>
                    <span className="text-secondary truncate">
                      {t.topicName} <span className="text-tertiary">· {t.chapterName}</span>
                    </span>
                    <Badge tone={t.accuracy >= 75 ? 'success' : t.accuracy >= 50 ? 'warning' : 'danger'} size="sm">
                      {t.correct}/{t.total}
                    </Badge>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        <div className="callout callout--neutral">
          <AlertTriangle size={13} />
          <span style={{ fontSize: 11.5 }}>
            Demo question bank — practice-style MCQs written for this prototype, never labelled as official previous-year papers.
          </span>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Test runner                                                         */
/* ------------------------------------------------------------------ */

function TestRunner({ mock, onExit }: { mock: MockTest; onExit: () => void }) {
  const { state, submitAttempt, notify } = useStudy()
  const now = useNow(1000)
  const [started, setStarted] = useState(false)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<ID, number | null>>({})
  const [marked, setMarked] = useState<ID[]>([])
  const [startedAt, setStartedAt] = useState<number>(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [finished, setFinished] = useState<MockAttempt | null>(null)

  const questions = useMemo(
    () => mock.questionIds.map((id) => state.questions.find((q) => q.id === id)).filter((q): q is Question => Boolean(q)),
    [mock.questionIds, state.questions]
  )

  const remaining = started ? Math.max(0, mock.durationMinutes * 60 - Math.floor((now - startedAt) / 1000)) : mock.durationMinutes * 60
  const critical = remaining <= 60

  const current = questions[index]
  const answeredCount = Object.values(answers).filter((a) => a !== null && a !== undefined).length

  useEffect(() => {
    if (started && remaining === 0 && !finished) {
      notify({ title: 'Time up', message: 'Your test was submitted automatically.', variant: 'warning' })
      finish(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, started, finished])

  const finish = (auto = false) => {
    const used = Math.min(mock.durationMinutes * 60, Math.floor((Date.now() - startedAt) / 1000))
    let correct = 0
    let incorrect = 0
    let unattempted = 0
    const topicMap = new Map<string, { topicName: string; chapterName: string; correct: number; total: number }>()

    const newMistakes: Mistake[] = []

    questions.forEach((q) => {
      const ans = answers[q.id] ?? null
      const isCorrect = ans === q.correctIndex
      if (ans === null || ans === undefined) unattempted += 1
      else if (isCorrect) correct += 1
      else {
        incorrect += 1
        const topic = topicById(state, q.topicId)
        const chapter = chapterById(state, q.chapterId)
        newMistakes.push({
          id: uid('mis'),
          subjectId: q.subjectId,
          chapterId: q.chapterId,
          topicId: q.topicId,
          question: q.text,
          options: q.options,
          userAnswerIndex: ans,
          correctAnswerIndex: q.correctIndex,
          explanation: q.explanation,
          category: 'conceptual',
          date: new Date().toISOString().slice(0, 10),
          status: 'unresolved',
          source: 'mock-test',
          reviewCount: 0,
          lastReviewedAt: null
        })
        void topic
        void chapter
      }
      const entry = topicMap.get(q.topicId) ?? {
        topicName: topicById(state, q.topicId)?.name ?? 'Topic',
        chapterName: chapterById(state, q.chapterId)?.name ?? 'Chapter',
        correct: 0,
        total: 0
      }
      entry.total += 1
      if (isCorrect) entry.correct += 1
      topicMap.set(q.topicId, entry)
    })

    const attemptedCount = correct + incorrect
    const attempt: MockAttempt = {
      id: uid('att'),
      mockId: mock.id,
      title: mock.title,
      subjectId: mock.subjectId,
      startedAt: new Date(startedAt).toISOString(),
      submittedAt: new Date().toISOString(),
      durationUsedSeconds: used || 1,
      totalQuestions: questions.length,
      correct,
      incorrect,
      unattempted,
      accuracy: attemptedCount ? Math.round((correct / attemptedCount) * 100) : 0,
      marks: Math.round((correct - incorrect * 0.33) * 100) / 100,
      maxMarks: questions.length,
      subjectBreakdown: state.subjects
        .map((s) => {
          const qs = questions.filter((q) => q.subjectId === s.id)
          return {
            subjectId: s.id,
            correct: qs.filter((q) => answers[q.id] === q.correctIndex).length,
            total: qs.length
          }
        })
        .filter((s) => s.total > 0),
      topicBreakdown: Array.from(topicMap.entries()).map(([topicId, v]) => ({
        topicId,
        topicName: v.topicName,
        chapterName: v.chapterName,
        correct: v.correct,
        total: v.total,
        accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0
      })),
      answers: { ...answers },
      markedForReview: marked,
      seeded: false
    }

    submitAttempt(attempt, newMistakes)
    setFinished(attempt)
    setConfirmOpen(false)
    void auto
  }

  /* --------------------------- result screen --------------------------- */
  if (finished) {
    const p = finished.accuracy
    return (
      <main className="page">
        <div className="page-head">
          <div className="page-head__text">
            <h1>Test completed</h1>
            <p className="page-head__sub">
              {finished.title} · submitted in {formatClock(finished.durationUsedSeconds)} · {finished.totalQuestions} questions
            </p>
          </div>
          <div className="page-head__actions">
            <Button variant="secondary" onClick={onExit}>Back to tests</Button>
            <Button variant="primary" icon={<Target size={14} />} onClick={() => window.location.reload()}>Retake test</Button>
          </div>
        </div>

        <div className="result-hero section">
          <Ring value={p} size={96} stroke={9} tone={p >= 75 ? 'var(--success)' : p >= 55 ? 'var(--accent)' : 'var(--danger)'}>
            <div style={{ textAlign: 'center' }}>
              <div className="mono" style={{ fontSize: 19, fontWeight: 650, lineHeight: 1 }}>{p}%</div>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>accuracy</div>
            </div>
          </Ring>
          <div className="result-grid">
            <div className="result-cell">
              <p className="result-cell__value">{finished.marks}<span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>/{finished.maxMarks}</span></p>
              <p className="result-cell__label">Marks</p>
            </div>
            <div className="result-cell">
              <p className="result-cell__value" style={{ color: 'var(--success)' }}>{finished.correct}</p>
              <p className="result-cell__label">Correct</p>
            </div>
            <div className="result-cell">
              <p className="result-cell__value" style={{ color: 'var(--danger)' }}>{finished.incorrect}</p>
              <p className="result-cell__label">Incorrect</p>
            </div>
            <div className="result-cell">
              <p className="result-cell__value">{finished.unattempted}</p>
              <p className="result-cell__label">Unattempted</p>
            </div>
            <div className="result-cell">
              <p className="result-cell__value">{formatClock(finished.durationUsedSeconds)}</p>
              <p className="result-cell__label">Time taken</p>
            </div>
          </div>
        </div>

        <div className="grid grid--2 section" style={{ gap: 14 }}>
          <Card>
            <CardHeader title="Subject performance" icon={<TrendingUp size={15} />} />
            <div className="stack" style={{ gap: 10 }}>
              {finished.subjectBreakdown.map((s) => {
                const subj = subjectById(state, s.subjectId)
                const sp = Math.round((s.correct / Math.max(1, s.total)) * 100)
                return (
                  <div key={s.subjectId}>
                    <div className="row row--between" style={{ marginBottom: 3 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{subj?.name}</span>
                      <span className="mono text-secondary" style={{ fontSize: 11.5 }}>
                        {s.correct}/{s.total}
                      </span>
                    </div>
                    <Progress value={sp} tone={sp >= 75 ? 'success' : sp >= 55 ? 'accent' : 'danger'} height={5} />
                  </div>
                )
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Weak topics" subtitle="Lowest accuracy first" icon={<AlertTriangle size={15} />} />
            <div className="stack" style={{ gap: 6 }}>
              {[...finished.topicBreakdown]
                .sort((a, b) => a.accuracy - b.accuracy)
                .slice(0, 6)
                .map((t) => (
                  <div key={t.topicId} className="row row--between" style={{ fontSize: 12 }}>
                    <span className="text-secondary truncate">{t.topicName}</span>
                    <Badge tone={t.accuracy >= 75 ? 'success' : t.accuracy >= 50 ? 'warning' : 'danger'} size="sm">
                      {t.correct}/{t.total}
                    </Badge>
                  </div>
                ))}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Answer review"
            subtitle={`${finished.incorrect} incorrect answers were saved to the Mistake Bank`}
            icon={<ClipboardList size={15} />}
            actions={<Button size="sm" variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('studyos:noop'))} >Mistake Bank</Button>}
          />
          <div className="stack" style={{ gap: 10 }}>
            {questions.map((q, i) => {
              const ans = finished.answers[q.id]
              const isCorrect = ans === q.correctIndex
              const skipped = ans === null || ans === undefined
              return (
                <div key={q.id} className="muted-box">
                  <div className="row" style={{ gap: 7, marginBottom: 5, alignItems: 'flex-start' }}>
                    <span className="slot-number">{i + 1}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1, lineHeight: 1.5 }}>{q.text}</span>
                    {skipped ? (
                      <Badge tone="neutral" size="sm">skipped</Badge>
                    ) : isCorrect ? (
                      <Badge tone="success" size="sm" dot>correct</Badge>
                    ) : (
                      <Badge tone="danger" size="sm" dot>wrong</Badge>
                    )}
                  </div>
                  <div className="stack" style={{ gap: 3, paddingLeft: 26 }}>
                    {q.options.map((opt, oi) => (
                      <div
                        key={oi}
                        style={{
                          fontSize: 11.5,
                          padding: '3px 7px',
                          borderRadius: 5,
                          background:
                            oi === q.correctIndex ? 'var(--success-soft)' : oi === ans ? 'var(--danger-soft)' : 'transparent',
                          color: oi === q.correctIndex ? 'var(--success)' : oi === ans ? 'var(--danger)' : 'var(--text-secondary)'
                        }}
                      >
                        {String.fromCharCode(65 + oi)}. {opt}
                      </div>
                    ))}
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3, lineHeight: 1.5 }}>
                      <strong>Why:</strong> {q.explanation}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </main>
    )
  }

  /* --------------------------- instructions --------------------------- */
  if (!started) {
    return (
      <main className="page">
        <button className="btn btn--ghost btn--sm" onClick={onExit} style={{ marginBottom: 12 }}>
          <ArrowLeft size={13} /> All tests
        </button>
        <div className="page-head">
          <div className="page-head__text">
            <h1>{mock.title}</h1>
            <p className="page-head__sub">{mock.description}</p>
          </div>
        </div>

        <Card>
          <div className="grid grid--4" style={{ gap: 10, marginBottom: 14 }}>
            <div className="muted-box">
              <p className="kv__label">Questions</p>
              <p className="mono" style={{ fontSize: 18, fontWeight: 650 }}>{questions.length}</p>
            </div>
            <div className="muted-box">
              <p className="kv__label">Duration</p>
              <p className="mono" style={{ fontSize: 18, fontWeight: 650 }}>{mock.durationMinutes} min</p>
            </div>
            <div className="muted-box">
              <p className="kv__label">Marking</p>
              <p className="mono" style={{ fontSize: 18, fontWeight: 650 }}>+1 / −0.33</p>
            </div>
            <div className="muted-box">
              <p className="kv__label">Scope</p>
              <p style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
                {mock.subjectId === 'mixed' ? 'All subjects' : subjectById(state, mock.subjectId)?.name}
              </p>
            </div>
          </div>

          <div className="callout callout--info" style={{ marginBottom: 12 }}>
            <AlertTriangle size={14} />
            <div>
              <strong>Before you start</strong>
              <div style={{ marginTop: 4, lineHeight: 1.6 }}>
                • The timer starts immediately and cannot be paused.<br />
                • Navigate freely; answers are saved as you go.<br />
                • Mark questions for review and revisit them before submitting.<br />
                • The test auto-submits when the timer hits zero.
              </div>
            </div>
          </div>

          <Button
            variant="primary"
            size="lg"
            icon={<Play size={14} />}
            onClick={() => {
              setStarted(true)
              setStartedAt(Date.now())
            }}
          >
            Start {mock.title}
          </Button>
        </Card>
      </main>
    )
  }

  /* ----------------------------- running ----------------------------- */
  return (
    <div className="test-shell">
      <div className="test-topbar">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{mock.title}</span>
          <Badge tone="neutral" size="sm">Question {index + 1} of {questions.length}</Badge>
        </div>
        <div style={{ flex: 1 }} />
        <span className="text-tertiary" style={{ fontSize: 11.5 }}>
          {answeredCount}/{questions.length} answered · {marked.length} marked
        </span>
        <div className={cx('test-timer', critical && 'is-critical')}>
          <Timer size={13} /> {formatClock(remaining)}
        </div>
        <Button variant="primary" size="sm" icon={<Send size={12} />} onClick={() => setConfirmOpen(true)}>
          Submit test
        </Button>
      </div>

      <div className="test-body">
        <div className="stack">
          {current ? (
            <div className="question-card">
              <div className="question-card__meta">
                <span className="slot-number">{index + 1}</span>
                <Badge tone="neutral" size="sm">{subjectById(state, current.subjectId)?.shortName}</Badge>
                <Badge tone="neutral" size="sm">{chapterById(state, current.chapterId)?.name}</Badge>
                <Badge tone={current.difficulty === 'hard' ? 'danger' : current.difficulty === 'medium' ? 'warning' : 'success'} size="sm">
                  {current.difficulty}
                </Badge>
                {current.origin !== 'demo-bank' ? (
                  <Badge tone="purple" size="sm">{current.origin === 'ai-generated' ? 'AI-generated' : 'unofficial PYQ'}</Badge>
                ) : null}
                <div style={{ flex: 1 }} />
                <Button
                  size="sm"
                  variant={marked.includes(current.id) ? 'quiet' : 'ghost'}
                  icon={<Flag size={12} />}
                  onClick={() =>
                    setMarked((prev) => (prev.includes(current.id) ? prev.filter((m) => m !== current.id) : [...prev, current.id]))
                  }
                >
                  {marked.includes(current.id) ? 'Marked' : 'Mark for review'}
                </Button>
              </div>

              <QuestionText text={current.text} />

              <div>
                {current.options.map((opt, oi) => (
                  <button
                    key={oi}
                    className={cx('option', answers[current.id] === oi && 'is-selected')}
                    onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: prev[current.id] === oi ? null : oi }))}
                  >
                    <span className="option__key">{String.fromCharCode(65 + oi)}</span>
                    <span>{opt}</span>
                  </button>
                ))}
              </div>

              <div className="row row--between" style={{ marginTop: 14 }}>
                <Button
                  variant="secondary"
                  icon={<ArrowLeft size={13} />}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                >
                  Previous
                </Button>
                <div className="row" style={{ gap: 6 }}>
                  <Button variant="ghost" size="sm" onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: null }))}>
                    Clear
                  </Button>
                  <Button
                    variant="primary"
                    iconRight={<ArrowRight size={13} />}
                    onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
                    disabled={index === questions.length - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title="No questions in this test" message="This mock test has no question IDs available." />
          )}
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Question palette" />
            <div className="palette">
              {questions.map((q, i) => {
                const isAnswered = answers[q.id] !== null && answers[q.id] !== undefined
                return (
                  <button
                    key={q.id}
                    className={cx(
                      'palette__btn',
                      isAnswered && 'is-answered',
                      marked.includes(q.id) && 'is-review',
                      i === index && 'is-current'
                    )}
                    onClick={() => setIndex(i)}
                    aria-label={`Go to question ${i + 1}`}
                  >
                    {i + 1}
                  </button>
                )
              })}
            </div>
            <div className="palette-legend" style={{ marginTop: 12 }}>
              <div className="palette-legend__row">
                <span className="palette-swatch" style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }} /> Answered
              </div>
              <div className="palette-legend__row">
                <span className="palette-swatch" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning-border)' }} /> Marked for review
              </div>
              <div className="palette-legend__row">
                <span className="palette-swatch" /> Not answered
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Progress" />
            <Progress value={answeredCount} max={questions.length} tone="accent" height={6} label="Answered" showValue />
            <div className="divider" />
            <Button variant="danger" block icon={<Send size={13} />} onClick={() => setConfirmOpen(true)}>
              Submit test
            </Button>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Submit the test?"
        message={`You answered ${answeredCount} of ${questions.length} questions. ${questions.length - answeredCount} unanswered question${
          questions.length - answeredCount === 1 ? '' : 's'
        } will be marked unattempted.`}
        confirmLabel="Submit now"
        tone="primary"
        onConfirm={() => finish(false)}
      />
    </div>
  )
}

function QuestionText({ text }: { text: string }) {
  return <p className="question-card__text">{text}</p>
}

export { formatDuration, clamp, Segmented, MockTest }
