import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  History,
  NotebookPen,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  TrendingDown
} from 'lucide-react'
import type { ID, Topic } from '../types'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Progress,
  Segmented,
  Select,
  Tabs,
  Textarea
} from '../components/ui'
import { useStudy } from '../store/StudyStore'
import {
  allTopics,
  chapterById,
  classifyRevision,
  dueRevisions,
  subjectById,
  topicById,
  topicMastery
} from '../store/selectors'
import { addDays, diffDays, formatShortDate } from '../lib/date'
import { cx, sum } from '../lib/utils'

type TabKey = 'due' | 'upcoming' | 'history' | 'all'

const REVISION_TYPE_META: Record<string, { label: string; tone: 'accent' | 'success' | 'warning' | 'info' | 'purple' | 'neutral' }> = {
  'same-day': { label: 'Same-day', tone: 'accent' },
  'next-day': { label: 'Next-day', tone: 'info' },
  weekly: { label: 'Weekly', tone: 'warning' },
  monthly: { label: 'Monthly', tone: 'purple' },
  practice: { label: 'Practice', tone: 'neutral' },
  manual: { label: 'Manual', tone: 'neutral' }
}

export default function RevisionPage() {
  const { state, today, logRevision, notify } = useStudy()
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('due')
  const [subjectFilter, setSubjectFilter] = useState<ID | 'all'>('all')
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<Topic | null>(null)
  const [accuracy, setAccuracy] = useState('')
  const [confidence, setConfidence] = useState(3)
  const [notes, setNotes] = useState('')

  const due = useMemo(() => dueRevisions(state, today), [state, today])
  const filteredDue = useMemo(
    () => due.filter((d) => (subjectFilter === 'all' || d.subject.id === subjectFilter) && (!search || d.topic.name.toLowerCase().includes(search.toLowerCase()))),
    [due, subjectFilter, search]
  )

  const upcoming = useMemo(() => {
    return allTopics(state)
      .filter((t) => t.initialLearningDate && t.nextRevisionDue && diffDays(t.nextRevisionDue, today) < 0)
      .filter((t) => subjectFilter === 'all' || t.subjectId === subjectFilter)
      .sort((a, b) => (a.nextRevisionDue! < b.nextRevisionDue! ? -1 : 1))
  }, [state, subjectFilter, today])

  const historyEntries = useMemo(() => {
    const rows: Array<{ topic: Topic; date: string; type: string; accuracy?: number | null; confidence?: number | null }> = []
    allTopics(state).forEach((t) => {
      if (subjectFilter !== 'all' && t.subjectId !== subjectFilter) return
      t.revisions.forEach((r) => rows.push({ topic: t, date: r.date, type: r.type, accuracy: r.accuracy, confidence: r.confidence }))
    })
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 80)
  }, [state, subjectFilter])

  const allFiltered = useMemo(
    () =>
      allTopics(state)
        .filter((t) => t.initialLearningDate)
        .filter((t) => subjectFilter === 'all' || t.subjectId === subjectFilter)
        .filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase())),
    [state, subjectFilter, search]
  )

  /* per-type counts keep the four revision categories visibly separate */
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { 'same-day': 0, 'next-day': 0, weekly: 0, monthly: 0 }
    allTopics(state).forEach((t) => {
      t.revisions.forEach((r) => {
        if (counts[r.type] !== undefined) counts[r.type] += 1
      })
    })
    return counts
  }, [state])

  const startReview = (topic: Topic) => {
    setActive(topic)
    setAccuracy(topic.mockAccuracy ? String(topic.mockAccuracy) : '')
    setConfidence(topic.confidence || 3)
    setNotes('')
  }

  const overdueCount = due.filter((d) => d.daysOverdue > 0).length
  const totalRevisions = sum(allTopics(state).map((t) => t.revisions.length))

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Revision Center</h1>
          <p className="page-head__sub">
            Spaced repetition across 1 · 3 · 7 · 15 · 30 days. Same-day, next-day, weekly and monthly revisions are tracked as separate categories, and
            initial learning is never counted as revision.
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" icon={<Target size={14} />} onClick={() => navigate('/mock-tests')}>
            Test weak areas
          </Button>
          <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => navigate('/sunday')}>
            Sunday review
          </Button>
        </div>
      </div>

      <div className="grid grid--4 section" style={{ gap: 11 }}>
        <Card>
          <p className="stat__label">Due now</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>
            {due.length}
          </p>
          <p className="stat__hint">{overdueCount} overdue · {due.length - overdueCount} today</p>
        </Card>
        <Card>
          <p className="stat__label">Total revisions</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>
            {totalRevisions}
          </p>
          <p className="stat__hint">across {allTopics(state).filter((t) => t.revisions.length).length} topics</p>
        </Card>
        <Card>
          <p className="stat__label">Unresolved mistakes</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>
            {state.mistakes.filter((m) => m.status === 'unresolved').length}
          </p>
          <p className="stat__hint">auto-suggested in sessions</p>
        </Card>
        <Card>
          <p className="stat__label">Weakest topic</p>
          <p style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }} className="truncate">
            {allTopics(state)
              .filter((t) => t.initialLearningDate)
              .sort((a, b) => topicMastery(a) - topicMastery(b))[0]?.name ?? '—'}
          </p>
          <p className="stat__hint">
            mastery{' '}
            {Math.min(...allTopics(state).filter((t) => t.initialLearningDate).map(topicMastery).concat([0])) || 0}/100
          </p>
        </Card>
      </div>

      <Card className="section">
        <div className="row row--between row--wrap" style={{ gap: 10, marginBottom: 12 }}>
          <Tabs
            value={tab}
            onChange={(v) => setTab(v)}
            tabs={[
              { value: 'due', label: 'Due for revision', count: due.length },
              { value: 'upcoming', label: 'Scheduled next', count: upcoming.length },
              { value: 'history', label: 'Revision history' },
              { value: 'all', label: 'All topics', count: allFiltered.length }
            ]}
          />
        </div>

        <div className="row row--wrap" style={{ gap: 8, marginBottom: 14 }}>
          <div className="row" style={{ gap: 5, flex: 1, minWidth: 190 }}>
            <Search size={14} className="text-tertiary" />
            <Input placeholder="Search topic…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="pill-row">
            <button className={cx('chip-filter', subjectFilter === 'all' && 'is-active')} onClick={() => setSubjectFilter('all')}>
              All subjects
            </button>
            {state.subjects.map((s) => (
              <button key={s.id} className={cx('chip-filter', subjectFilter === s.id && 'is-active')} onClick={() => setSubjectFilter(s.id)}>
                {s.shortName}
              </button>
            ))}
          </div>
        </div>

        {tab === 'due' ? (
          filteredDue.length ? (
            <div className="rev-list">
              {filteredDue.map((d) => (
                <div key={d.topic.id} className={cx('rev-card', d.daysOverdue > 0 && 'rev-card--due')}>
                  <div className="rev-card__main">
                    <div className="row row--wrap" style={{ gap: 6, marginBottom: 2 }}>
                      <span className="rev-card__title">{d.topic.name}</span>
                      <Badge tone={REVISION_TYPE_META[d.kind]?.tone ?? 'neutral'} size="sm">
                        {REVISION_TYPE_META[d.kind]?.label ?? d.kind}
                      </Badge>
                      {d.daysOverdue > 0 ? (
                        <Badge tone="danger" size="sm" dot>
                          {d.daysOverdue}d overdue
                        </Badge>
                      ) : (
                        <Badge tone="warning" size="sm">
                          due today
                        </Badge>
                      )}
                    </div>
                    <div className="rev-card__meta">
                      <span>{d.subject.name}</span>
                      <span>·</span>
                      <span>{d.chapter.name}</span>
                      <span>·</span>
                      <span>mastery {topicMastery(d.topic)}/100</span>
                      <span>·</span>
                      <span>{d.topic.revisions.length} revisions</span>
                      {d.topic.mistakeCount ? (
                        <>
                          <span>·</span>
                          <span className="text-danger">{d.topic.mistakeCount} mistakes</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => startReview(d.topic)}>
                    Revise
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<CheckCircle2 size={20} />}
              title="Nothing due for revision"
              message="Excellent — every topic is inside its spaced-repetition window. Next revisions will surface automatically."
            />
          )
        ) : null}

        {tab === 'upcoming' ? (
          upcoming.length ? (
            <div className="rev-list">
              {upcoming.slice(0, 30).map((t) => {
                const chapter = chapterById(state, t.chapterId)
                const subject = subjectById(state, t.subjectId)
                return (
                  <div key={t.id} className="rev-card">
                    <div className="rev-card__main">
                      <p className="rev-card__title">{t.name}</p>
                      <div className="rev-card__meta">
                        <span>{subject?.shortName}</span>
                        <span>·</span>
                        <span>{chapter?.name}</span>
                        <span>·</span>
                        <span>due {formatShortDate(t.nextRevisionDue!)}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => startReview(t)}>
                      Revise early
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState icon={<Clock size={20} />} title="No scheduled revisions ahead" message="Topics appear here once they have a learning date." />
          )
        ) : null}

        {tab === 'history' ? (
          historyEntries.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Topic</th>
                    <th>Type</th>
                    <th>Subject</th>
                    <th style={{ textAlign: 'right' }}>Accuracy</th>
                    <th style={{ textAlign: 'right' }}>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {historyEntries.map((row, i) => {
                    const subject = subjectById(state, row.topic.subjectId)
                    const meta = REVISION_TYPE_META[row.type] ?? REVISION_TYPE_META.manual
                    return (
                      <tr key={`${row.topic.id}-${row.date}-${i}`}>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                          {formatShortDate(row.date)}
                        </td>
                        <td>
                          <div style={{ fontWeight: 550 }}>{row.topic.name}</div>
                          <div className="text-tertiary" style={{ fontSize: 11 }}>
                            {chapterById(state, row.topic.chapterId)?.name}
                          </div>
                        </td>
                        <td>
                          <Badge tone={meta.tone} size="sm">
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="text-secondary">{subject?.shortName}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>
                          {row.accuracy != null ? `${row.accuracy}%` : '—'}
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>
                          {row.confidence != null ? `${row.confidence}/5` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<History size={20} />} title="No revision history yet" message="Complete a revision to start building the record." />
          )
        ) : null}

        {tab === 'all' ? (
          allFiltered.length ? (
            <div className="stack" style={{ gap: 7 }}>
              {allFiltered.map((t) => {
                const chapter = chapterById(state, t.chapterId)
                const subject = subjectById(state, t.subjectId)
                const mastery = topicMastery(t)
                const nextDue = t.nextRevisionDue
                const overdue = nextDue ? diffDays(nextDue, today) < 0 : false
                return (
                  <div className="topic-row" key={t.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row row--wrap" style={{ gap: 6 }}>
                        <span className="topic-row__name">{t.name}</span>
                        <Badge tone="neutral" size="sm">
                          {subject?.shortName}
                        </Badge>
                        {overdue ? (
                          <Badge tone="danger" size="sm" dot>
                            revision due
                          </Badge>
                        ) : null}
                      </div>
                      <div className="topic-row__meta">
                        <span>{chapter?.name}</span>
                        <span>· learnt {t.initialLearningDate ? formatShortDate(t.initialLearningDate) : '—'}</span>
                        <span>· {t.revisions.length} revisions</span>
                        <span>· next {nextDue ? formatShortDate(nextDue) : '—'}</span>
                        <span>· quiz {t.mockAccuracy ?? 0}%</span>
                      </div>
                    </div>
                    <div style={{ width: 70 }}>
                      <Progress value={mastery} tone={mastery >= 75 ? 'success' : mastery >= 50 ? 'accent' : 'warning'} height={4} />
                    </div>
                    <span className="mono text-secondary" style={{ fontSize: 11.5, minWidth: 26, textAlign: 'right' }}>
                      {mastery}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => startReview(t)}>
                      Log revision
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState icon={<RotateCcw size={20} />} title="No learned topics match" message="Clear the search or pick a different subject." />
          )
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Revision categories"
          subtitle="Tracked independently so analytics never conflate first learning with revision"
          icon={<Filter size={15} />}
        />
        <div className="grid grid--4" style={{ gap: 10 }}>
          {(['same-day', 'next-day', 'weekly', 'monthly'] as const).map((k) => (
            <div key={k} className="muted-box">
              <Badge tone={REVISION_TYPE_META[k].tone} size="sm">
                {REVISION_TYPE_META[k].label}
              </Badge>
              <p className="mono" style={{ fontSize: 19, fontWeight: 650, marginTop: 6, letterSpacing: '-0.03em' }}>
                {typeCounts[k]}
              </p>
              <p className="stat__hint">
                {k === 'same-day'
                  ? 'Same session consolidation'
                  : k === 'next-day'
                    ? 'Day-after retention check'
                    : k === 'weekly'
                      ? 'Weekly or Sunday review'
                      : 'Monthly long-term retention'}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* ---------------------------- revision modal ---------------------------- */}
      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title="Log a revision"
        subtitle={
          active
            ? `${active.name} · ${classifyRevision(active, today)} revision · last revised ${
                active.revisions.length ? formatShortDate(active.revisions[active.revisions.length - 1].date) : 'never'
              }`
            : undefined
        }
        footer={
          <>
            <Button onClick={() => setActive(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={<CheckCircle2 size={14} />}
              onClick={() => {
                if (!active) return
                const acc = accuracy === '' ? null : Math.max(0, Math.min(100, Number(accuracy)))
                logRevision(active.id, {
                  accuracy: acc,
                  confidence,
                  notes: notes.trim(),
                  type: classifyRevision(active, today),
                  source: 'revision-center'
                })
                notify({
                  title: 'Revision logged',
                  message: `${active.name} — next revision scheduled.`,
                  variant: 'success'
                })
                setActive(null)
              }}
            >
              Mark revised
            </Button>
          </>
        }
      >
        {active ? (
          <div className="stack" style={{ gap: 13 }}>
            <div className="callout callout--info">
              <RotateCcw size={14} />
              <span>
                This adds a <strong>{classifyRevision(active, today)}</strong> revision entry dated {formatShortDate(today)} and pushes the next due
                date forward using your interval settings ({state.settings.revisionIntervals.join(' · ')} days).
              </span>
            </div>

            {active.keyPoints.length || active.formulas.length ? (
              <div className="muted-box">
                <p className="field__label" style={{ marginBottom: 6 }}>
                  Recall checklist
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[...active.keyPoints, ...active.formulas].map((k) => (
                    <li key={k} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6 }}>
                      <span className="text-tertiary">•</span>
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {active.notes ? (
              <div className="muted-box">
                <p className="field__label" style={{ marginBottom: 4 }}>
                  Your notes
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{active.notes}</p>
              </div>
            ) : null}

            <div className="grid grid--2" style={{ gap: 12 }}>
              <Field label="Quick quiz accuracy (%)" hint="Optional — leave blank if you skipped the quiz">
                <Input type="number" min={0} max={100} value={accuracy} onChange={(e) => setAccuracy(e.target.value)} placeholder="e.g. 80" />
              </Field>
              <Field label="Confidence after revision">
                <div className="range-row">
                  <input type="range" min={1} max={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} aria-label="Confidence" />
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 26 }}>
                    {confidence}/5
                  </span>
                </div>
              </Field>
            </div>

            <Field label="Revision notes" hint="What still felt shaky? This appears in your next revision panel.">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Still confusing discount vs marked price — redo 5 questions." />
            </Field>

            <div className="row row--wrap" style={{ gap: 6 }}>
              <Badge tone="neutral" size="sm">
                <NotebookPen size={10} /> learnt {active.initialLearningDate ? formatShortDate(active.initialLearningDate) : '—'}
              </Badge>
              <Badge tone="neutral" size="sm">
                <TrendingDown size={10} /> mastery {topicMastery(active)}/100
              </Badge>
              <Badge tone="neutral" size="sm">
                <AlertTriangle size={10} /> {active.mistakeCount} mistakes logged
              </Badge>
            </div>
          </div>
        ) : null}
      </Modal>
    </main>
  )
}

export { addDays, topicById, Segmented, Select }
