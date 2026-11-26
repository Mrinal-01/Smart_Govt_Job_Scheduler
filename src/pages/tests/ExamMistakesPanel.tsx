import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, LoadingBlock, Select, Tabs } from '../../components/ui'
import { useStudy } from '../../store/StudyStore'
import { api, errorMessage } from '../../lib/http'
import { cx } from '../../lib/utils'

interface ExamMistake {
  _id: string
  questionId: string
  questionText: string
  options: Array<{ label: string; text: string }>
  selected: string[]
  correctAnswer: string[]
  explanation: string | null
  subjectName: string | null
  chapterName: string | null
  category: string
  status: 'unresolved' | 'reviewed' | 'resolved'
  occurrences: number
  reviewCount: number
  lastSeenAt: string
  source: 'auto' | 'manual'
}

const CATEGORIES = ['conceptual', 'calculation', 'formula-forgotten', 'misread', 'guessing', 'time-management']
const LETTERS = ['A', 'B', 'C', 'D', 'E']

/** Mistakes captured from server-scored PDF mock tests (one entry per question, deduplicated). */
export default function ExamMistakesPanel() {
  const { notify } = useStudy()
  const [items, setItems] = useState<ExamMistake[] | null>(null)
  const [tab, setTab] = useState<'unresolved' | 'reviewed' | 'resolved' | 'all'>('unresolved')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setItems((await api<{ mistakes: ExamMistake[] }>('/api/mistakes')).mistakes)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await load()
    } catch (err) {
      notify({ title: 'Action failed', message: errorMessage(err), variant: 'error' })
    }
  }

  if (error) return <div className="callout callout--danger">{error}</div>
  if (!items) return <LoadingBlock />
  const visible = items.filter((m) => tab === 'all' || m.status === tab)
  const count = (s: string) => items.filter((m) => m.status === s).length

  return (
    <Card className="section">
      <div className="row row--between row--wrap" style={{ gap: 10, marginBottom: 12 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'unresolved', label: 'Unresolved', count: count('unresolved') },
            { value: 'reviewed', label: 'Reviewed', count: count('reviewed') },
            { value: 'resolved', label: 'Resolved', count: count('resolved') },
            { value: 'all', label: 'All', count: items.length }
          ]}
        />
        <span className="text-tertiary" style={{ fontSize: 12 }}>
          Only questions with a verified answer are added automatically.
        </span>
      </div>
      {!visible.length ? (
        <EmptyState compact title={items.length ? 'Nothing in this view' : 'No mistakes from PDF mock tests yet'} message="Wrong answers on verified questions appear here after each test." />
      ) : (
        <div className="stack">
          {visible.map((m) => {
            const show = revealed.has(m._id)
            return (
              <article key={m._id} className="q-card">
                <header className="q-card__head">
                  <Badge size="sm" tone={m.status === 'resolved' ? 'success' : m.status === 'reviewed' ? 'warning' : 'danger'}>
                    {m.status}
                  </Badge>
                  {m.subjectName ? <Badge size="sm">{m.subjectName}</Badge> : null}
                  {m.chapterName ? <span className="text-tertiary" style={{ fontSize: 12 }}>{m.chapterName}</span> : null}
                  {m.occurrences > 1 ? <Badge size="sm" tone="danger">wrong {m.occurrences}×</Badge> : null}
                  <span className="spacer" />
                  <Select
                    value={m.category}
                    aria-label="Mistake category"
                    onChange={(e) => act(() => api(`/api/mistakes/${m._id}`, { method: 'PATCH', body: { category: e.target.value } }))}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace('-', ' ')}
                      </option>
                    ))}
                  </Select>
                </header>
                <p className="q-text">{m.questionText}</p>
                <ol className="q-options">
                  {m.options.map((o, i) => (
                    <li key={o.label} className={cx(show && m.correctAnswer.includes(o.label) && 'is-correct', show && m.selected.includes(o.label) && !m.correctAnswer.includes(o.label) && 'is-wrong')}>
                      <span className="q-options__label">{LETTERS[i]}</span> {o.text}
                      {show && m.selected.includes(o.label) ? <Badge size="sm">your answer</Badge> : null}
                    </li>
                  ))}
                </ol>
                {show && m.explanation ? (
                  <div className="muted-box" style={{ marginTop: 8 }}>
                    {m.explanation}
                  </div>
                ) : null}
                <footer className="q-card__foot">
                  {!show ? (
                    <Button size="sm" onClick={() => setRevealed((s) => new Set(s).add(m._id))}>
                      Try it, then reveal answer
                    </Button>
                  ) : null}
                  {m.status !== 'resolved' ? (
                    <Button size="sm" variant="success" icon={<CheckCircle2 size={13} />} onClick={() => act(() => api(`/api/mistakes/${m._id}/review`, { method: 'POST' }))}>
                      I got it right now ({m.reviewCount}/3)
                    </Button>
                  ) : (
                    <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => act(() => api(`/api/mistakes/${m._id}`, { method: 'PATCH', body: { status: 'unresolved' } }))}>
                      Reopen
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => act(() => api(`/api/mistakes/${m._id}`, { method: 'DELETE' }))}>
                    Remove
                  </Button>
                </footer>
              </article>
            )
          })}
        </div>
      )}
    </Card>
  )
}
