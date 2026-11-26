import { useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Filter,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react'
import type { Mistake, MistakeCategory, MistakeStatus } from '../types'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  Progress,
  Segmented,
  Select,
  Tabs
} from '../components/ui'
import ExamMistakesPanel from './tests/ExamMistakesPanel'
import { useStudy } from '../store/StudyStore'
import { chapterById, subjectById, topicById } from '../store/selectors'
import { formatShortDate } from '../lib/date'
import { cx } from '../lib/utils'

const CATEGORY_META: Record<MistakeCategory, { label: string; tone: 'danger' | 'warning' | 'info' | 'purple' | 'neutral' | 'accent' }> = {
  conceptual: { label: 'Conceptual', tone: 'danger' },
  calculation: { label: 'Calculation', tone: 'warning' },
  'formula-forgotten': { label: 'Formula forgotten', tone: 'purple' },
  misread: { label: 'Misread question', tone: 'info' },
  guessing: { label: 'Guessing error', tone: 'accent' },
  'time-management': { label: 'Time management', tone: 'neutral' }
}

const STATUS_META: Record<MistakeStatus, { label: string; tone: 'danger' | 'warning' | 'success' }> = {
  unresolved: { label: 'Unresolved', tone: 'danger' },
  reviewed: { label: 'Reviewed', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' }
}

export default function MistakeBankPage() {
  const { state, setMistakeStatus, setMistakeCategory, reviewMistake, notify } = useStudy()
  const [tab, setTab] = useState<'open' | 'reviewed' | 'resolved' | 'all'>('open')
  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<Mistake | null>(null)
  const [practice, setPractice] = useState<Mistake | null>(null)
  const [choice, setChoice] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [source, setSource] = useState<'practice' | 'exams'>('practice')
  const sourceSwitch = (
    <Segmented
      value={source}
      onChange={setSource}
      options={[
        { value: 'practice', label: 'Sessions & demo tests' },
        { value: 'exams', label: 'PDF mock tests' }
      ]}
    />
  )

  const filtered = useMemo(() => {
    let list = state.mistakes
    if (tab === 'open') list = list.filter((m) => m.status === 'unresolved')
    if (tab === 'reviewed') list = list.filter((m) => m.status === 'reviewed')
    if (tab === 'resolved') list = list.filter((m) => m.status === 'resolved')
    if (subjectFilter !== 'all') list = list.filter((m) => m.subjectId === subjectFilter)
    if (categoryFilter !== 'all') list = list.filter((m) => m.category === categoryFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((m) => m.question.toLowerCase().includes(q) || topicById(state, m.topicId)?.name.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [state, tab, subjectFilter, categoryFilter, search])

  const counts = {
    open: state.mistakes.filter((m) => m.status === 'unresolved').length,
    reviewed: state.mistakes.filter((m) => m.status === 'reviewed').length,
    resolved: state.mistakes.filter((m) => m.status === 'resolved').length,
    all: state.mistakes.length
  }

  const byCategory = useMemo(() => {
    const map = new Map<MistakeCategory, number>()
    state.mistakes.forEach((m) => map.set(m.category, (map.get(m.category) ?? 0) + 1))
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [state.mistakes])

  const topCategory = byCategory[0]

  const startPractice = (mistake: Mistake) => {
    setPractice(mistake)
    setChoice(null)
    setRevealed(false)
  }

  if (source === 'exams') {
    return (
      <main className="page">
        <div className="page-head">
          <div className="page-head__text">
            <h1>Mistake Bank</h1>
            <p className="page-head__sub">Wrong answers on verified questions from your PDF mock tests. Each question is stored once; repeats raise its count.</p>
          </div>
          <div className="page-head__actions">{sourceSwitch}</div>
        </div>
        <ExamMistakesPanel />
      </main>
    )
  }

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Mistake Bank</h1>
          <p className="page-head__sub">
            Every wrong answer from practice and mock tests lands here with its explanation and a mistake category. Unresolved entries are
            auto-suggested inside future revision panels.
          </p>
        </div>
        <div className="page-head__actions">
          {sourceSwitch}
          <Button
            variant="primary"
            icon={<RotateCcw size={14} />}
            disabled={!state.mistakes.some((m) => m.status !== 'resolved')}
            onClick={() => {
              const target = state.mistakes.find((m) => m.status === 'unresolved')
              if (target) startPractice(target)
            }}
          >
            Practice again
          </Button>
        </div>
      </div>

      <div className="grid grid--4 section" style={{ gap: 11 }}>
        <Card>
          <p className="stat__label">Unresolved</p>
          <p className="stat__value mono" style={{ marginTop: 3, color: 'var(--danger)' }}>{counts.open}</p>
          <p className="stat__hint">need a re-attempt</p>
        </Card>
        <Card>
          <p className="stat__label">Reviewed</p>
          <p className="stat__value mono" style={{ marginTop: 3, color: 'var(--warning)' }}>{counts.reviewed}</p>
          <p className="stat__hint">1–2 re-attempts done</p>
        </Card>
        <Card>
          <p className="stat__label">Resolved</p>
          <p className="stat__value mono" style={{ marginTop: 3, color: 'var(--success)' }}>{counts.resolved}</p>
          <p className="stat__hint">3 clean re-attempts</p>
        </Card>
        <Card>
          <p className="stat__label">Top pattern</p>
          <p style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6 }}>{topCategory ? CATEGORY_META[topCategory[0]].label : '—'}</p>
          <p className="stat__hint">{topCategory ? `${topCategory[1]} of ${counts.all} mistakes` : 'no mistakes yet'}</p>
        </Card>
      </div>

      <Card className="section">
        <div className="row row--between row--wrap" style={{ gap: 10, marginBottom: 12 }}>
          <Tabs
            value={tab}
            onChange={(v) => setTab(v)}
            tabs={[
              { value: 'open', label: 'Unresolved', count: counts.open },
              { value: 'reviewed', label: 'Reviewed', count: counts.reviewed },
              { value: 'resolved', label: 'Resolved', count: counts.resolved },
              { value: 'all', label: 'All', count: counts.all }
            ]}
          />
        </div>

        <div className="row row--wrap" style={{ gap: 8, marginBottom: 14 }}>
          <div className="row" style={{ gap: 5, flex: 1, minWidth: 190 }}>
            <Search size={14} className="text-tertiary" />
            <Input placeholder="Search question or topic…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div style={{ minWidth: 150 }}>
            <Select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} aria-label="Filter by subject">
              <option value="all">All subjects</option>
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
          <div style={{ minWidth: 170 }}>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
              <option value="all">All categories</option>
              {Object.entries(CATEGORY_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          </div>
        </div>

        {filtered.length ? (
          <div className="stack" style={{ gap: 9 }}>
            {filtered.map((m) => {
              const subject = subjectById(state, m.subjectId)
              const chapter = chapterById(state, m.chapterId)
              const topic = topicById(state, m.topicId)
              const cat = CATEGORY_META[m.category]
              const st = STATUS_META[m.status]
              return (
                <div key={m.id} className="muted-box" style={{ background: 'var(--surface)' }}>
                  <div className="row row--between row--wrap" style={{ gap: 8, marginBottom: 6 }}>
                    <div className="row row--wrap" style={{ gap: 6 }}>
                      <Badge tone={cat.tone} size="sm">{cat.label}</Badge>
                      <Badge tone={st.tone} size="sm" dot>{st.label}</Badge>
                      <span className="text-tertiary" style={{ fontSize: 11 }}>
                        {subject?.shortName} · {chapter?.name} · {topic?.name}
                      </span>
                    </div>
                    <span className="text-tertiary mono" style={{ fontSize: 11 }}>
                      {formatShortDate(m.date)} · {m.reviewCount} re-attempts
                    </span>
                  </div>
                  <p style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.55, marginBottom: 7 }}>{m.question}</p>
                  <div className="row row--wrap" style={{ gap: 8, marginBottom: 9 }}>
                    <span className="row" style={{ gap: 4, fontSize: 11.5, color: 'var(--danger)' }}>
                      <XCircle size={12} /> Your answer: {m.userAnswerIndex !== null ? m.options[m.userAnswerIndex] : 'skipped'}
                    </span>
                    <span className="row" style={{ gap: 4, fontSize: 11.5, color: 'var(--success)' }}>
                      <CheckCircle2 size={12} /> Correct: {m.options[m.correctAnswerIndex]}
                    </span>
                  </div>
                  <div className="row row--wrap" style={{ gap: 6 }}>
                    <Button size="sm" variant="primary" onClick={() => startPractice(m)} icon={<RotateCcw size={12} />}>
                      Practice again
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setActive(m)}>
                      Explanation
                    </Button>
                    {m.status !== 'resolved' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMistakeStatus(m.id, 'resolved')
                          notify({ title: 'Marked resolved', message: 'It will stop appearing in revision suggestions.', variant: 'success' })
                        }}
                      >
                        Mark resolved
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setMistakeStatus(m.id, 'unresolved')}>
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={<ShieldCheck size={20} />}
            title="Nothing in this bucket"
            message="Wrong answers from practice and mock tests are saved automatically. Use Practice Again to work through them."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Mistake patterns" subtitle="Where your errors cluster — this is what to fix, not just what to redo" icon={<Brain size={15} />} />
        <div className="stack" style={{ gap: 10 }}>
          {byCategory.length ? (
            byCategory.map(([cat, count]) => {
              const meta = CATEGORY_META[cat]
              return (
                <div key={cat}>
                  <div className="row row--between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{meta.label}</span>
                    <span className="mono text-secondary" style={{ fontSize: 11.5 }}>{count}</span>
                  </div>
                  <Progress value={count} max={Math.max(1, counts.all)} tone={cat === 'conceptual' ? 'danger' : cat === 'calculation' ? 'warning' : 'accent'} height={4} />
                </div>
              )
            })
          ) : (
            <p className="text-tertiary" style={{ fontSize: 12.5 }}>No mistakes recorded yet.</p>
          )}
        </div>
        {byCategory.length ? (
          <div className="callout callout--neutral" style={{ marginTop: 12 }}>
            <Sparkles size={13} />
            <span style={{ fontSize: 11.5 }}>
              {byCategory[0][0] === 'conceptual'
                ? 'Most errors are conceptual — re-read theory and do worked examples before timed practice.'
                : byCategory[0][0] === 'calculation'
                  ? 'Most errors are calculation slips — add a 60-second answer-check ritual to every practice set.'
                  : 'Your errors cluster in one category. Fix the process, and accuracy follows.'}
            </span>
          </div>
        ) : null}
      </Card>

      {/* explanation modal */}
      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title="Mistake detail"
        subtitle={active ? `${subjectById(state, active.subjectId)?.name} · ${topicById(state, active.topicId)?.name}` : undefined}
        footer={
          <>
            <Button onClick={() => setActive(null)}>Close</Button>
            {active ? (
              <Button variant="primary" onClick={() => { startPractice(active); setActive(null) }}>
                Practice again
              </Button>
            ) : null}
          </>
        }
      >
        {active ? (
          <div className="stack" style={{ gap: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.6 }}>{active.question}</p>
            <div className="stack" style={{ gap: 5 }}>
              {active.options.map((opt, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: i === active.correctAnswerIndex ? 'var(--success-soft)' : i === active.userAnswerIndex ? 'var(--danger-soft)' : 'var(--surface)',
                    color: i === active.correctAnswerIndex ? 'var(--success)' : i === active.userAnswerIndex ? 'var(--danger)' : 'var(--text-secondary)'
                  }}
                >
                  {String.fromCharCode(65 + i)}. {opt}
                  {i === active.correctAnswerIndex ? '  ✓ correct' : i === active.userAnswerIndex ? '  ✗ your answer' : ''}
                </div>
              ))}
            </div>
            <div className="muted-box">
              <p className="field__label" style={{ marginBottom: 4 }}>Explanation</p>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{active.explanation}</p>
            </div>
            <div className="grid grid--2" style={{ gap: 12 }}>
              <div>
                <p className="field__label" style={{ marginBottom: 4 }}>Mistake category</p>
                <Select value={active.category} onChange={(e) => { setMistakeCategory(active.id, e.target.value as MistakeCategory); setActive({ ...active, category: e.target.value as MistakeCategory }) }}>
                  {Object.entries(CATEGORY_META).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <p className="field__label" style={{ marginBottom: 4 }}>Status</p>
                <Select value={active.status} onChange={(e) => { setMistakeStatus(active.id, e.target.value as MistakeStatus); setActive({ ...active, status: e.target.value as MistakeStatus }) }}>
                  <option value="unresolved">Unresolved</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="resolved">Resolved</option>
                </Select>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* practice modal */}
      <Modal
        open={Boolean(practice)}
        onClose={() => setPractice(null)}
        title="Practice again"
        subtitle={practice ? `${subjectById(state, practice.subjectId)?.name} · ${topicById(state, practice.topicId)?.name}` : undefined}
        footer={
          <>
            <Button onClick={() => setPractice(null)}>Close</Button>
            {!revealed ? (
              <Button variant="primary" disabled={choice === null} onClick={() => { setRevealed(true); if (practice) reviewMistake(practice.id) }}>
                Check answer
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  if (!practice) return
                  const nextUnresolved = state.mistakes.find((m) => m.status === 'unresolved' && m.id !== practice.id)
                  if (nextUnresolved) startPractice(nextUnresolved)
                  else {
                    setPractice(null)
                    notify({ title: 'No more unresolved mistakes', message: 'Nice — the bank is clear for now.', variant: 'success' })
                  }
                }}
              >
                Next mistake
              </Button>
            )}
          </>
        }
      >
        {practice ? (
          <div className="stack" style={{ gap: 12 }}>
            <p style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.6 }}>{practice.question}</p>
            <div>
              {practice.options.map((opt, i) => {
                const isChoice = choice === i
                const isCorrect = i === practice.correctAnswerIndex
                return (
                  <button
                    key={i}
                    className={cx('option', isChoice && !revealed && 'is-selected', revealed && isCorrect && 'is-correct', revealed && isChoice && !isCorrect && 'is-wrong')}
                    onClick={() => !revealed && setChoice(i)}
                   
                  >
                    <span className="option__key">{String.fromCharCode(65 + i)}</span>
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>
            {revealed ? (
              <div className={cx('callout', choice === practice.correctAnswerIndex ? 'callout--success' : 'callout--danger')}>
                {choice === practice.correctAnswerIndex ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <div>
                  <strong>{choice === practice.correctAnswerIndex ? 'Correct this time' : 'Still incorrect'}</strong>
                  <div style={{ marginTop: 3, lineHeight: 1.6 }}>{practice.explanation}</div>
                  <div style={{ marginTop: 5, fontSize: 11 }}>
                    Re-attempt {practice.reviewCount + 1} recorded · 3 clean attempts resolve the entry.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </main>
  )
}

export { Filter, ChevronDown, AlertTriangle }
