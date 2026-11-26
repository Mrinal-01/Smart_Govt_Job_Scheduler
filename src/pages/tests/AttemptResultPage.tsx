import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BookmarkPlus, CheckCircle2, CircleHelp, Clock, RotateCcw, Sparkles, Target, XCircle } from 'lucide-react'
import { Badge, Button, Card, CardHeader, LoadingBlock, Modal, StatCard, Tabs } from '../../components/ui'
import { useStudy } from '../../store/StudyStore'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/http'
import { cx } from '../../lib/utils'
import { SourcePageButton, fmtDuration } from './shared'

type Outcome = 'correct' | 'incorrect' | 'unanswered' | 'unscored'
interface Breakdown {
  key: string
  name: string
  total: number
  scored: number
  correct: number
  incorrect: number
  unanswered: number
  unscored: number
  accuracy: number | null
}
interface Result {
  totalQuestions: number
  attempted: number
  correct: number
  incorrect: number
  unanswered: number
  unscored: number
  unscoredAttempted: number
  marks: number
  maxMarks: number
  accuracy: number | null
  scoringComplete: boolean
  timeTakenSeconds: number
  bySubject: Breakdown[]
  byChapter: Breakdown[]
  byDifficulty: Breakdown[]
  questionResults: Array<{ questionId: string; outcome: Outcome; selected: string[] }>
}
interface ReviewQuestion {
  questionId: string
  questionText: string
  questionType: string
  options: Array<{ label: string; text: string }>
  correctAnswer: string[] | null
  answerVerified: boolean
  explanation: string | null
  subjectName: string | null
  chapterName: string | null
  topicName: string | null
  difficulty: string | null
  source: { documentId: string | null; pageNumber: number | null; questionNumber: string | null } | null
}
interface AttemptDetail {
  _id: string
  testName: string
  status: string
  submissionType: 'manual' | 'timeout' | null
  startedAt: string
  submittedAt: string
  durationSeconds: number
  marksPerQuestion: number
  negativeMarks: number
  questions: ReviewQuestion[]
  result: Result
}

const LETTERS = ['A', 'B', 'C', 'D', 'E']
const OUTCOME_META: Record<Outcome, { label: string; tone: 'success' | 'danger' | 'neutral' | 'warning' }> = {
  correct: { label: 'Correct', tone: 'success' },
  incorrect: { label: 'Incorrect', tone: 'danger' },
  unanswered: { label: 'Unanswered', tone: 'neutral' },
  unscored: { label: 'Unscored — answer not verified', tone: 'warning' }
}

export default function AttemptResultPage() {
  const { attemptId } = useParams()
  const navigate = useNavigate()
  const { notify } = useStudy()
  const { config } = useAuth()
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | Outcome>('all')
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [explain, setExplain] = useState<{ questionId: string; content: string | null; error?: string } | null>(null)

  useEffect(() => {
    api<{ attempt: AttemptDetail }>(`/api/attempts/${attemptId}`)
      .then(({ attempt: a }) => {
        if (a.status === 'in_progress') navigate(`/exam/${attemptId}`, { replace: true })
        else setAttempt(a)
      })
      .catch((err) => setError(errorMessage(err)))
    api<{ mistakes: Array<{ questionId: string }> }>('/api/mistakes')
      .then((r) => setAdded(new Set(r.mistakes.map((m) => m.questionId))))
      .catch(() => undefined)
  }, [attemptId, navigate])

  const outcomes = useMemo(() => new Map(attempt?.result.questionResults.map((r) => [r.questionId, r]) ?? []), [attempt])

  if (error) return <main className="page"><div className="callout callout--danger">{error}</div></main>
  if (!attempt) return <main className="page"><LoadingBlock label="Loading result…" /></main>
  const r = attempt.result

  const retake = async (mode: 'incorrect' | 'unanswered' | 'all') => {
    try {
      const t = await api<{ test: { _id: string } }>(`/api/attempts/${attempt._id}/retake`, { method: 'POST', body: { mode } })
      const a = await api<{ attemptId: string }>('/api/attempts', { method: 'POST', body: { mockTestId: t.test._id } })
      navigate(`/exam/${a.attemptId}`)
    } catch (err) {
      notify({ title: 'Could not create the practice set', message: errorMessage(err), variant: 'error' })
    }
  }

  const addMistake = async (questionId: string) => {
    try {
      await api(`/api/attempts/${attempt._id}/mistakes`, { method: 'POST', body: { questionId } })
      setAdded((s) => new Set(s).add(questionId))
      notify({ title: 'Added to Mistake Bank', variant: 'info' })
    } catch (err) {
      notify({ title: 'Could not add', message: errorMessage(err), variant: 'error' })
    }
  }

  const askAI = async (questionId: string) => {
    setExplain({ questionId, content: null })
    try {
      const res = await api<{ content: string }>('/api/ai/explain-answer', { method: 'POST', body: { attemptId: attempt._id, questionId } })
      setExplain({ questionId, content: res.content })
    } catch (err) {
      setExplain({ questionId, content: null, error: errorMessage(err) })
    }
  }

  const visible = attempt.questions.filter((q) => filter === 'all' || outcomes.get(q.questionId)?.outcome === filter)
  const weakChapters = r.byChapter.filter((c) => c.accuracy !== null && c.accuracy < 70).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <Link to="/tests" className="back-link">
            <ArrowLeft size={13} /> Test builder
          </Link>
          <h1>{attempt.testName} — result</h1>
          <p className="page-head__sub">
            Submitted {new Date(attempt.submittedAt).toLocaleString()} {attempt.submissionType === 'timeout' ? '· auto-submitted when time ran out' : ''}
          </p>
        </div>
        <div className="page-head__actions">
          <Button icon={<RotateCcw size={14} />} disabled={!r.incorrect} onClick={() => retake('incorrect')}>
            Reattempt incorrect
          </Button>
          <Button icon={<CircleHelp size={14} />} disabled={!r.unanswered} onClick={() => retake('unanswered')}>
            Practise unanswered
          </Button>
          <Button variant="primary" icon={<RotateCcw size={14} />} onClick={() => retake('all')}>
            Reattempt all
          </Button>
        </div>
      </div>

      {!r.scoringComplete ? (
        <div className="callout callout--warning section">
          <AlertTriangle size={14} />
          <span>
            Scoring is incomplete: {r.unscored} question(s) have no verified correct answer, so they are excluded from marks and accuracy (not counted as wrong).
            Verify their answers in the question bank to score them next time.
          </span>
        </div>
      ) : null}

      <div className="grid grid--4 section">
        <StatCard label="Score" value={`${r.marks}`} unit={`/ ${r.maxMarks}`} icon={<Target size={15} />} tone="accent" hint={`+${attempt.marksPerQuestion} / −${attempt.negativeMarks}`} />
        <StatCard label="Accuracy" value={r.accuracy !== null ? `${r.accuracy}%` : '—'} icon={<CheckCircle2 size={15} />} tone="success" hint={`${r.correct} correct · ${r.incorrect} incorrect`} />
        <StatCard label="Attempted" value={`${r.attempted}/${r.totalQuestions}`} icon={<XCircle size={15} />} hint={`${r.unanswered} unanswered · ${r.unscored} unscored`} />
        <StatCard label="Time taken" value={fmtDuration(r.timeTakenSeconds)} icon={<Clock size={15} />} hint={`of ${fmtDuration(attempt.durationSeconds)}`} />
      </div>

      <div className="grid grid--3 section">
        <BreakdownCard title="Subject-wise" rows={r.bySubject} />
        <BreakdownCard title="Chapter-wise" rows={r.byChapter} />
        <BreakdownCard title="Difficulty-wise" rows={r.byDifficulty} />
      </div>
      {weakChapters.length ? (
        <div className="callout callout--danger section">
          <AlertTriangle size={14} />
          <span>Weak chapters in this test: {weakChapters.map((c) => `${c.name} (${c.accuracy}%)`).join(', ')}.</span>
        </div>
      ) : null}

      <Card pad={false}>
        <div className="review-toolbar">
          <Tabs<'all' | Outcome>
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'all', label: 'All', count: r.totalQuestions },
              { value: 'incorrect', label: 'Incorrect', count: r.incorrect },
              { value: 'unanswered', label: 'Unanswered', count: r.unanswered },
              { value: 'unscored', label: 'Unscored', count: r.unscored },
              { value: 'correct', label: 'Correct', count: r.correct }
            ]}
          />
        </div>
        <div className="review-list">
          {visible.map((q) => {
            const res = outcomes.get(q.questionId)!
            const meta = OUTCOME_META[res.outcome]
            const n = attempt.questions.indexOf(q) + 1
            return (
              <article key={q.questionId} className={cx('q-card', `is-${res.outcome}`)}>
                <header className="q-card__head">
                  <span className="q-card__num">Q{n}</span>
                  <Badge tone={meta.tone} size="sm" dot>
                    {meta.label}
                  </Badge>
                  {q.subjectName ? <Badge size="sm">{q.subjectName}</Badge> : null}
                  {q.chapterName ? <span className="text-tertiary" style={{ fontSize: 12 }}>{q.chapterName}</span> : null}
                  <span className="spacer" />
                  <SourcePageButton documentId={q.source?.documentId ?? null} page={q.source?.pageNumber ?? null} />
                </header>
                <p className="q-text">{q.questionText}</p>
                {q.questionType === 'numeric' ? (
                  <p>
                    Your answer: <strong>{res.selected[0] ?? '—'}</strong>
                    {q.answerVerified ? (
                      <>
                        {' '}
                        · Correct: <strong>{q.correctAnswer?.[0]}</strong>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <ol className="q-options">
                    {q.options.map((o, i) => {
                      const mine = res.selected.includes(o.label)
                      const right = q.answerVerified && q.correctAnswer?.includes(o.label)
                      return (
                        <li key={o.label} className={cx(right && 'is-correct', mine && !right && q.answerVerified && 'is-wrong', mine && 'is-mine')}>
                          <span className="q-options__label">{LETTERS[i]}</span> {o.text}
                          {mine ? <Badge size="sm" tone={right ? 'success' : q.answerVerified ? 'danger' : 'neutral'}>your answer</Badge> : null}
                          {right ? <Badge size="sm" tone="success">verified answer</Badge> : null}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {!q.answerVerified ? <p className="text-tertiary" style={{ fontSize: 12 }}>No verified answer for this question.</p> : null}
                {q.explanation ? (
                  <div className="muted-box" style={{ marginTop: 8 }}>
                    <strong>Explanation:</strong> {q.explanation}
                  </div>
                ) : null}
                <footer className="q-card__foot">
                  {res.outcome !== 'correct' ? (
                    added.has(q.questionId) ? (
                      <Badge tone="info">In Mistake Bank</Badge>
                    ) : (
                      <Button size="sm" icon={<BookmarkPlus size={13} />} onClick={() => addMistake(q.questionId)}>
                        Add to Mistake Bank
                      </Button>
                    )
                  ) : null}
                  {config?.ai.configured && res.outcome !== 'correct' ? (
                    <Button size="sm" variant="ghost" icon={<Sparkles size={13} />} onClick={() => askAI(q.questionId)}>
                      Explain with AI
                    </Button>
                  ) : null}
                </footer>
              </article>
            )
          })}
        </div>
      </Card>

      <Modal open={Boolean(explain)} onClose={() => setExplain(null)} title="AI explanation" subtitle="AI-generated — check it against your study material." size="lg">
        {explain?.error ? <div className="callout callout--danger">{explain.error}</div> : explain?.content ? <div className="ai-text">{explain.content}</div> : <LoadingBlock label="Asking the AI…" />}
      </Modal>
    </main>
  )
}

function BreakdownCard({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="plain-list">
        {rows.map((b) => (
          <li key={b.key}>
            <strong className="truncate">{b.name}</strong>
            <span className="mono">
              {b.correct}/{b.scored}
              {b.accuracy !== null ? ` · ${b.accuracy}%` : ''}
              {b.unscored ? <span className="text-tertiary"> · {b.unscored} unscored</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
