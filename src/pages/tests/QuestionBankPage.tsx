import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Search, Sparkles } from 'lucide-react'
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Select, Textarea } from '../../components/ui'
import { useStudy } from '../../store/StudyStore'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/http'
import { chaptersOf } from '../../store/selectors'
import { QuestionEditor, TaxonomyFields, type BankQuestion } from './shared'

interface Filters {
  status: string
  subjectId: string
  chapterId: string
  difficulty: string
  origin: string
  hasAnswer: string
  q: string
}

const EMPTY: Filters = { status: '', subjectId: '', chapterId: '', difficulty: '', origin: '', hasAnswer: '', q: '' }

export default function QuestionBankPage() {
  const { state } = useStudy()
  const { config } = useAuth()
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: BankQuestion[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const limit = 20

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v))
    try {
      setData(await api<{ items: BankQuestion[]; total: number }>(`/api/questions?${params}`))
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [filters, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = window.setTimeout(() => {
      setPage(1)
      setFilters((f) => ({ ...f, q: query.trim() }))
    }, 350)
    return () => window.clearTimeout(t)
  }, [query])

  const set = (k: keyof Filters, v: string) => {
    setPage(1)
    setFilters((f) => ({ ...f, [k]: v, ...(k === 'subjectId' ? { chapterId: '' } : {}) }))
  }
  const chapters = filters.subjectId ? chaptersOf(state, filters.subjectId) : []
  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <Link to="/tests" className="back-link">
            <ArrowLeft size={13} /> Test builder
          </Link>
          <h1>Question Bank</h1>
          <p className="page-head__sub">Your personal, reusable questions. Verified questions can be used in any number of mock tests.</p>
        </div>
        <div className="page-head__actions">
          <Button icon={<Sparkles size={14} />} onClick={() => setGenerating(true)} disabled={!config?.ai.configured} title={config?.ai.configured ? undefined : 'AI is not configured on the server'}>
            Generate practice (AI)
          </Button>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            Add question
          </Button>
        </div>
      </div>

      <Card className="section">
        <div className="filter-grid">
          <Field label="Search">
            <div className="input-affix">
              <Search size={14} className="input-affix__icon" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Question text…" />
            </div>
          </Field>
          <Field label="Status">
            <Select value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Any</option>
              <option value="verified">Verified</option>
              <option value="needs_review">Needs review</option>
              <option value="extracted">Extracted</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          <Field label="Subject">
            <Select value={filters.subjectId} onChange={(e) => set('subjectId', e.target.value)}>
              <option value="">Any</option>
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Chapter">
            <Select value={filters.chapterId} disabled={!filters.subjectId} onChange={(e) => set('chapterId', e.target.value)}>
              <option value="">Any</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Difficulty">
            <Select value={filters.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
              <option value="">Any</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="unknown">Unknown</option>
            </Select>
          </Field>
          <Field label="Source">
            <Select value={filters.origin} onChange={(e) => set('origin', e.target.value)}>
              <option value="">Any</option>
              <option value="pdf">From PDF</option>
              <option value="manual">Manual</option>
              <option value="ai_generated">AI-generated</option>
            </Select>
          </Field>
          <Field label="Answer">
            <Select value={filters.hasAnswer} onChange={(e) => set('hasAnswer', e.target.value)}>
              <option value="">Any</option>
              <option value="true">Has answer</option>
              <option value="false">No answer</option>
            </Select>
          </Field>
        </div>
      </Card>

      {error ? <div className="callout callout--danger">{error}</div> : null}
      {!data ? (
        <LoadingBlock />
      ) : data.items.length ? (
        <>
          <div className="stack">
            {data.items.map((q) => (
              <QuestionEditor
                key={q._id}
                question={q}
                onSaved={(nq) => setData((d) => (d ? { ...d, items: d.items.map((x) => (x._id === nq._id ? nq : x)) } : d))}
                onDeleted={(id) => setData((d) => (d ? { total: d.total - 1, items: d.items.filter((x) => x._id !== id) } : d))}
              />
            ))}
          </div>
          <div className="pager">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-secondary">
              Page {page} of {pages} · {data.total} questions
            </span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </>
      ) : (
        <Card>
          <EmptyState
            title={Object.values(filters).some(Boolean) ? 'No questions match these filters' : 'Your question bank is empty'}
            message="Upload a question-paper PDF in the Test Builder, or add questions manually."
            action={
              <Link to="/tests/new" className="btn btn--primary btn--md">
                <span>Upload a PDF</span>
              </Link>
            }
          />
        </Card>
      )}
      <AddQuestionModal open={adding} onClose={() => setAdding(false)} onCreated={() => void load()} />
      <GeneratePracticeModal open={generating} onClose={() => setGenerating(false)} onCreated={() => void load()} />
    </main>
  )
}

function AddQuestionModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [text, setText] = useState('')
  const [options, setOptions] = useState(['', '', '', ''])
  const [tax, setTax] = useState<{ subjectId: string | null; chapterId: string | null; topicId: string | null }>({ subjectId: null, chapterId: null, topicId: null })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setText('')
      setOptions(['', '', '', ''])
      setError('')
    }
  }, [open])
  const create = async () => {
    const opts = options.map((o) => o.trim()).filter(Boolean)
    if (!text.trim()) return setError('Enter the question text.')
    if (opts.length < 2) return setError('Add at least two options.')
    setBusy(true)
    try {
      await api('/api/questions', { method: 'POST', body: { questionText: text.trim(), questionType: 'single_correct', options: opts.map((t) => ({ text: t })), ...tax } })
      onCreated()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a question"
      subtitle="Set the correct answer and verify it from the bank afterwards."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={create}>
            Add to bank
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Question">
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {options.map((o, i) => (
          <Field key={i} label={`Option ${'ABCD'[i]}`}>
            <Input value={o} onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? e.target.value : x)))} />
          </Field>
        ))}
        <TaxonomyFields value={tax} onChange={setTax} />
        {error ? <p className="field__error">{error}</p> : null}
      </div>
    </Modal>
  )
}

function GeneratePracticeModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { state } = useStudy()
  const [topicId, setTopicId] = useState('')
  const [count, setCount] = useState('5')
  const [difficulty, setDifficulty] = useState('mixed')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ questions: unknown[]; duplicates: number }>('/api/ai/practice-questions', { method: 'POST', body: { topicId, count: Number(count), difficulty } })
      setResult(`${r.questions.length} AI-generated question(s) added for review${r.duplicates ? ` (${r.duplicates} duplicate skipped)` : ''}.`)
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={() => {
        setResult('')
        onClose()
      }}
      title="Generate practice questions with AI"
      subtitle="Original questions — clearly labelled as AI-generated, never presented as official PYQs. Review and verify before using them in tests."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={busy} disabled={!topicId} onClick={generate}>
            Generate
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Topic">
          <Select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">Choose a topic…</option>
            {state.subjects.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {chaptersOf(state, s.id).flatMap((c) =>
                  c.topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {c.name} — {t.name}
                    </option>
                  ))
                )}
              </optgroup>
            ))}
          </Select>
        </Field>
        <div className="grid grid--2">
          <Field label="How many">
            <Select value={count} onChange={(e) => setCount(e.target.value)}>
              {[3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Difficulty">
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="mixed">Mixed</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
        </div>
        {result ? <div className="callout callout--success">{result}</div> : null}
        {error ? <div className="callout callout--danger">{error}</div> : null}
      </div>
    </Modal>
  )
}
