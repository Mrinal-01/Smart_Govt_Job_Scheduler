import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart3, BookCopy, FileText, Library, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, LoadingBlock, StatCard, Tabs } from '../../components/ui'
import { useStudy } from '../../store/StudyStore'
import { api, errorMessage } from '../../lib/http'
import { MOCK_TYPE_META, fmtBytes, type MockType, type UploadedDoc } from './shared'

interface TestRow {
  _id: string
  name: string
  type: MockType
  config: { questionCount: number; durationMinutes: number; marksPerQuestion: number; negativeMarks: number }
  questionCount: number
  attempts: number
  inProgressAttemptId: string | null
  lastResult: { marks: number; maxMarks: number; accuracy: number | null } | null
  createdAt: string
}
interface AttemptRow {
  _id: string
  testName: string
  status: string
  startedAt: string
  submittedAt: string | null
  result?: { marks: number; maxMarks: number; accuracy: number | null; correct: number; incorrect: number; unscored: number; totalQuestions: number }
}
interface Performance {
  attempts: number
  subjects: Array<{ key: string; name: string; correct: number; incorrect: number; accuracy: number | null }>
  weakChapters: Array<{ key: string; name: string; correct: number; incorrect: number; accuracy: number | null }>
}

type Tab = 'tests' | 'attempts' | 'documents' | 'templates' | 'performance'

export default function TestsHomePage() {
  const { notify } = useStudy()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('tests')
  const [tests, setTests] = useState<TestRow[] | null>(null)
  const [templates, setTemplates] = useState<TestRow[]>([])
  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  const [docs, setDocs] = useState<UploadedDoc[]>([])
  const [perf, setPerf] = useState<Performance | null>(null)
  const [bank, setBank] = useState<Record<string, number>>({})
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [t, tpl, a, d, p, s] = await Promise.all([
        api<{ items: TestRow[] }>('/api/mock-tests'),
        api<{ items: TestRow[] }>('/api/mock-tests?kind=template'),
        api<{ attempts: AttemptRow[] }>('/api/attempts'),
        api<{ documents: UploadedDoc[] }>('/api/documents'),
        api<Performance>('/api/attempts/performance'),
        api<{ byStatus: Record<string, number> }>('/api/questions/stats')
      ])
      setTests(t.items)
      setTemplates(tpl.items)
      setAttempts(a.attempts)
      setDocs(d.documents)
      setPerf(p)
      setBank(s.byStatus)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const start = async (testId: string) => {
    try {
      const r = await api<{ attemptId: string }>('/api/attempts', { method: 'POST', body: { mockTestId: testId } })
      navigate(`/exam/${r.attemptId}`)
    } catch (err) {
      notify({ title: 'Could not start the test', message: errorMessage(err), variant: 'error' })
    }
  }

  const generate = async (templateId: string) => {
    try {
      await api(`/api/mock-tests/templates/${templateId}/generate`, { method: 'POST', body: {} })
      notify({ title: 'New test generated from template', variant: 'success' })
      setTab('tests')
      await load()
    } catch (err) {
      notify({ title: 'Could not generate', message: errorMessage(err), variant: 'error' })
    }
  }

  const archive = async (id: string) => {
    if (!window.confirm('Delete this test? Past results are kept.')) return
    try {
      await api(`/api/mock-tests/${id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      notify({ title: 'Could not delete', message: errorMessage(err), variant: 'error' })
    }
  }

  if (error && !tests) return <main className="page"><div className="callout callout--danger">{error}</div></main>
  if (!tests) return <main className="page"><LoadingBlock label="Loading tests…" /></main>

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Tests</h1>
          <p className="page-head__sub">
            Upload question papers to the shared question hub, then build timed mock tests from it. Questions without an answer key are answered by AI in the background.
          </p>
        </div>
        <div className="page-head__actions">
          <Link to="/tests/bank" className="btn btn--secondary btn--md">
            <Library size={14} />
            <span>Question hub</span>
          </Link>
          <Link to="/tests/new" className="btn btn--primary btn--md">
            <Plus size={14} />
            <span>Create mock test</span>
          </Link>
        </div>
      </div>

      <div className="grid grid--4 section">
        <StatCard label="Ready questions in the hub" value={bank.ready ?? 0} icon={<Library size={15} />} tone="success" hint="Usable in tests" onClick={() => navigate('/tests/bank')} />
        <StatCard
          label="Waiting for AI answer"
          value={bank.pending_answer ?? 0}
          icon={<FileText size={15} />}
          tone="warning"
          hint={`${bank.needs_review ?? 0} need review`}
          onClick={() => navigate('/tests/bank')}
        />
        <StatCard label="Mock tests" value={tests.length} icon={<BookCopy size={15} />} hint={`${templates.length} template(s)`} />
        <StatCard label="Finished attempts" value={perf?.attempts ?? 0} icon={<BarChart3 size={15} />} tone="accent" />
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="section"
        tabs={[
          { value: 'tests', label: 'My tests', count: tests.length },
          { value: 'attempts', label: 'Results', count: attempts.length },
          { value: 'documents', label: 'PDFs', count: docs.length },
          { value: 'templates', label: 'Templates', count: templates.length },
          { value: 'performance', label: 'Performance' }
        ]}
      />

      {tab === 'tests' ? (
        tests.length ? (
          <Card pad={false}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Type</th>
                    <th>Questions</th>
                    <th>Duration</th>
                    <th>Marking</th>
                    <th>Last result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t._id}>
                      <td>
                        <strong>{t.name}</strong>
                      </td>
                      <td>
                        <Badge size="sm">{MOCK_TYPE_META[t.type].short}</Badge>
                      </td>
                      <td className="mono">{t.questionCount}</td>
                      <td className="mono">{t.config.durationMinutes} min</td>
                      <td className="mono">
                        +{t.config.marksPerQuestion} / −{t.config.negativeMarks}
                      </td>
                      <td className="mono">{t.lastResult ? `${t.lastResult.marks}/${t.lastResult.maxMarks}` : '—'}</td>
                      <td>
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => start(t._id)}>
                            {t.inProgressAttemptId ? 'Resume' : t.attempts ? 'Retake' : 'Start'}
                          </Button>
                          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => archive(t._id)} aria-label={`Delete ${t.name}`} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={<BookCopy size={20} />}
              title="No mock tests yet"
              message="Build a test from the question hub, or upload a question-paper PDF to add to it first."
              action={
                <Link to="/tests/new" className="btn btn--primary btn--md">
                  <span>Create mock test</span>
                </Link>
              }
            />
          </Card>
        )
      ) : null}

      {tab === 'attempts' ? (
        attempts.length ? (
          <Card pad={false}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Accuracy</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a) => (
                    <tr key={a._id}>
                      <td>{a.testName}</td>
                      <td className="mono">{new Date(a.startedAt).toLocaleString()}</td>
                      <td>
                        <Badge size="sm" tone={a.status === 'in_progress' ? 'accent' : a.status === 'auto_submitted' ? 'warning' : 'success'}>
                          {a.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="mono">{a.result ? `${a.result.marks}/${a.result.maxMarks}` : '—'}</td>
                      <td className="mono">
                        {a.result?.accuracy ?? '—'}
                        {a.result?.accuracy != null ? '%' : ''}
                        {a.result?.unscored ? <span className="text-tertiary"> ({a.result.unscored} unscored)</span> : null}
                      </td>
                      <td>
                        <Button size="sm" onClick={() => navigate(a.status === 'in_progress' ? `/exam/${a._id}` : `/tests/attempts/${a._id}`)}>
                          {a.status === 'in_progress' ? 'Resume' : 'View result'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState compact title="No attempts yet" />
          </Card>
        )
      ) : null}

      {tab === 'documents' ? (
        docs.length ? (
          <Card pad={false}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>PDF</th>
                    <th>Pages</th>
                    <th>Status</th>
                    <th>Questions</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d._id}>
                      <td>
                        <strong>{d.originalName}</strong>
                        <div className="text-tertiary" style={{ fontSize: 11.5 }}>
                          {fmtBytes(d.sizeBytes)} · {new Date(d.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="mono">{d.pageCount}</td>
                      <td>
                        <Badge size="sm" tone={d.status === 'completed' ? 'success' : d.status === 'failed' ? 'danger' : 'accent'}>
                          {d.status === 'processing' ? `${d.progress}%` : d.status}
                        </Badge>
                      </td>
                      <td className="mono">
                        {d.stats.inserted} new · {d.stats.needsReview} review
                      </td>
                      <td>
                        <Button size="sm" onClick={() => navigate(`/tests/documents/${d._id}`)}>
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState compact title="No PDFs uploaded" action={<Link to="/tests/new" className="btn btn--primary btn--md"><span>Upload a PDF</span></Link>} />
          </Card>
        )
      ) : null}

      {tab === 'templates' ? (
        templates.length ? (
          <div className="grid grid--3">
            {templates.map((t) => (
              <Card key={t._id}>
                <CardHeader title={t.name} subtitle={`${MOCK_TYPE_META[t.type].short} · ${t.config.questionCount} questions · ${t.config.durationMinutes} min`} />
                <Button icon={<RotateCcw size={13} />} onClick={() => generate(t._id)}>
                  Generate a fresh test
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState compact title="No templates" message="Tick “save as template” when creating a test to reuse its settings." />
          </Card>
        )
      ) : null}

      {tab === 'performance' ? (
        perf && perf.attempts ? (
          <div className="grid grid--2">
            <Card>
              <CardHeader title="Subject accuracy" subtitle="Scored questions only" />
              <ul className="plain-list">
                {perf.subjects.map((s) => (
                  <li key={s.key}>
                    <strong>{s.name}</strong>
                    <span className="mono">
                      {s.accuracy ?? '—'}
                      {s.accuracy != null ? '%' : ''} ({s.correct}/{s.correct + s.incorrect})
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Weak chapters" subtitle="Below 70% with 3+ scored answers" />
              {perf.weakChapters.length ? (
                <ul className="plain-list">
                  {perf.weakChapters.map((c) => (
                    <li key={c.key}>
                      <strong>{c.name}</strong>
                      <span className="mono text-danger">
                        {c.accuracy}% ({c.correct}/{c.correct + c.incorrect})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-tertiary">No weak chapters detected yet.</p>
              )}
            </Card>
          </div>
        ) : (
          <Card>
            <EmptyState compact title="No finished attempts yet" />
          </Card>
        )
      ) : null}
    </main>
  )
}
