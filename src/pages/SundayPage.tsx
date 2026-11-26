import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock,
  FileText,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
  XCircle
} from 'lucide-react'
import type { Chapter, Subject, Topic } from '../types'
import { Badge, Button, Card, CardHeader, EmptyState, Modal, Progress, Ring, Tabs, Textarea } from '../components/ui'
import { useStudy } from '../store/StudyStore'
import { chapterAccuracy, classifyRevision, logsInRange, subjectProgress, topicMastery } from '../store/selectors'
import { addDays, formatDuration, formatShortDate, startOfWeek, weekdayOf } from '../lib/date'
import { cx, sum } from '../lib/utils'

export default function SundayPage() {
  const { state, today, logRevision, notify } = useStudy()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'revision' | 'tests'>('revision')
  const [active, setActive] = useState<Topic | null>(null)
  const [notes, setNotes] = useState('')

  /* the "current week" is the Monday-based week containing today */
  const weekStart = startOfWeek(today, 1)
  const weekEnd = addDays(weekStart, 6)
  const isSunday = weekdayOf(today) === 0

  /** topics learnt inside this week, grouped by subject */
  const weeklyBySubject = useMemo(() => {
    return state.subjects.map((subject) => {
      const chapters = state.chapters.filter((c) => c.subjectId === subject.id)
      const topics: Array<{ topic: Topic; chapter: Chapter }> = []
      chapters.forEach((chapter) => {
        chapter.topics.forEach((topic) => {
          if (!topic.initialLearningDate) return
          if (topic.initialLearningDate < weekStart || topic.initialLearningDate > weekEnd) return
          topics.push({ topic, chapter })
        })
      })
      topics.sort((a, b) => (a.topic.initialLearningDate! < b.topic.initialLearningDate! ? -1 : 1))
      return { subject, topics }
    })
  }, [state, weekStart, weekEnd])

  const weekLogs = useMemo(() => logsInRange(state, weekStart, weekEnd), [state, weekStart, weekEnd])
  const weekMinutes = sum(weekLogs.map((l) => l.actualMinutes))
  const weekPlanned = sum(weekLogs.map((l) => l.plannedMinutes))
  const weekRevisions = sum(weekLogs.map((l) => l.revisionsCompleted))
  const weekSessions = sum(weekLogs.map((l) => l.sessionsCompleted))
  const weekTests = state.attempts.filter((a) => a.submittedAt.slice(0, 10) >= weekStart && a.submittedAt.slice(0, 10) <= weekEnd)

  const totalWeeklyTopics = sum(weeklyBySubject.map((w) => w.topics.length))
  const revisedThisWeek = weeklyBySubject.reduce(
    (acc, w) => acc + w.topics.filter((t) => t.topic.revisions.some((r) => r.date >= weekStart && r.date <= weekEnd)).length,
    0
  )
  const revisionPercent = totalWeeklyTopics ? Math.round((revisedThisWeek / totalWeeklyTopics) * 100) : 0

  const startReview = (topic: Topic) => {
    setActive(topic)
    setNotes('')
  }

  const subjectQuiz = (subject: Subject, chapter?: Chapter) => {
    const mock = chapter
      ? state.mockTests.find((m) => m.chapterId === chapter.id)
      : state.mockTests.find((m) => m.subjectId === subject.id && m.type === 'chapter')
    if (mock) {
      navigate(`/mock-tests/${mock.id}`)
      return
    }
    /* fall back to the weekly mixed test */
    const weekly = state.mockTests.find((m) => m.type === 'weekly')
    if (weekly) {
      notify({
        title: 'No dedicated test for this chapter yet',
        message: `Opening the ${weekly.title} instead — it includes ${subject.shortName} questions.`,
        variant: 'info'
      })
      navigate(`/mock-tests/${weekly.id}`)
    } else {
      notify({ title: 'No mock test available', message: 'Mock tests are generated from the demo question bank.', variant: 'warning' })
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Sunday — Weekly Revision & Mock Test</h1>
          <p className="page-head__sub">
            Sunday is not a regular learning day. It closes the loop on everything learnt between{' '}
            <strong>{formatShortDate(weekStart)}</strong> and <strong>{formatShortDate(weekEnd)}</strong>: revise each subject’s topics, review
            mistakes, and take a chapter-wise test.
          </p>
        </div>
        <div className="page-head__actions">
          {!isSunday ? (
            <Badge tone="neutral" dot>
              Preview — today is not Sunday
            </Badge>
          ) : (
            <Badge tone="accent" dot>
              Today is Sunday
            </Badge>
          )}
          <Button variant="secondary" icon={<CalendarDays size={14} />} onClick={() => navigate('/schedule?day=0')}>
            Sunday schedule
          </Button>
        </div>
      </div>

      {/* ------------------------------- hero ------------------------------- */}
      <div className="result-hero section">
        <Ring value={revisionPercent} size={92} stroke={9} tone={revisionPercent >= 80 ? 'var(--success)' : 'var(--accent)'}>
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 18, fontWeight: 650, lineHeight: 1 }}>{revisionPercent}%</div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>revised</div>
          </div>
        </Ring>
        <div className="result-grid">
          <div className="result-cell">
            <p className="result-cell__value">{totalWeeklyTopics}</p>
            <p className="result-cell__label">Topics this week</p>
          </div>
          <div className="result-cell">
            <p className="result-cell__value" style={{ color: 'var(--success)' }}>{revisedThisWeek}</p>
            <p className="result-cell__label">Revised</p>
          </div>
          <div className="result-cell">
            <p className="result-cell__value">{formatDuration(weekMinutes)}</p>
            <p className="result-cell__label">Studied</p>
          </div>
          <div className="result-cell">
            <p className="result-cell__value">{weekSessions}</p>
            <p className="result-cell__label">Sessions</p>
          </div>
          <div className="result-cell">
            <p className="result-cell__value">{weekTests.length}</p>
            <p className="result-cell__label">Mock tests</p>
          </div>
        </div>
      </div>

      <div className="row row--between row--wrap section" style={{ gap: 10 }}>
        <Tabs
          value={tab}
          onChange={(v) => setTab(v)}
          tabs={[
            { value: 'revision', label: 'Weekly revision', count: totalWeeklyTopics },
            { value: 'tests', label: 'Weekly tests', count: weekTests.length }
          ]}
        />
        <span className="text-tertiary" style={{ fontSize: 11.5 }}>
          {formatDuration(weekPlanned)} planned · {weekRevisions} revisions logged this week
        </span>
      </div>

      {tab === 'revision' ? (
        <div className="grid grid--2 section">
          {weeklyBySubject.map(({ subject, topics }) => {
            const p = subjectProgress(state, subject.id)
            const revised = topics.filter((t) => t.topic.revisions.some((r) => r.date >= weekStart && r.date <= weekEnd)).length
            const tone = `var(--s-${subject.tone === 'custom' ? 'math' : subject.tone})`
            return (
              <div className="sunday-subject" key={subject.id}>
                <div className="sunday-subject__head">
                  <span className="subject-dot" style={{ background: tone }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 620 }}>{subject.name}</p>
                    <p className="text-tertiary" style={{ fontSize: 11 }}>
                      {topics.length} topics this week · {revised} revised · {p.accuracy}% accuracy
                    </p>
                  </div>
                  <Badge tone={revised === topics.length && topics.length ? 'success' : 'warning'} size="sm">
                    {topics.length ? `${revised}/${topics.length}` : 'no topics'}
                  </Badge>
                  <Button size="sm" variant="secondary" icon={<ClipboardList size={12} />} onClick={() => subjectQuiz(subject)}>
                    Test
                  </Button>
                </div>

                {topics.length ? (
                  <div className="sunday-subject__list">
                    {topics.map(({ topic, chapter }) => {
                      const doneThisWeek = topic.revisions.some((r) => r.date >= weekStart && r.date <= weekEnd)
                      const wrongQs = state.mistakes.filter((m) => m.topicId === topic.id && m.status !== 'resolved').length
                      return (
                        <div key={topic.id} className={cx('week-topic', doneThisWeek && 'is-revised')}>
                          {doneThisWeek ? (
                            <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                          ) : (
                            <Circle size={14} className="text-tertiary" style={{ flexShrink: 0 }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p className="week-topic__name truncate">{topic.name}</p>
                            <div className="week-topic__meta">
                              <span>{chapter.name}</span>
                              <span>·</span>
                              <span>learnt {formatShortDate(topic.initialLearningDate!)}</span>
                              <span>·</span>
                              <span>mastery {topicMastery(topic)}</span>
                              {wrongQs ? (
                                <>
                                  <span>·</span>
                                  <span className="text-danger">{wrongQs} wrong</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={doneThisWeek ? 'ghost' : 'quiet'}
                            onClick={() => startReview(topic)}
                          >
                            {doneThisWeek ? 'Revise again' : 'Mark revised'}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '14px 16px' }}>
                    <p className="text-tertiary" style={{ fontSize: 12 }}>
                      No topics learnt in {subject.shortName} this week — nothing to review.
                    </p>
                    <Button size="sm" variant="secondary" style={{ marginTop: 8 }} onClick={() => subjectQuiz(subject)}>
                      Take a test anyway
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="stack section">
          <Card>
            <CardHeader
              title="Weekly mock tests"
              subtitle="Chapter-wise and full-length tests are the Sunday accountability check"
              icon={<Target size={15} />}
              actions={
                <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={() => navigate('/mock-tests')}>
                  All tests
                </Button>
              }
            />
            <div className="grid grid--3" style={{ gap: 11 }}>
              {state.mockTests.map((mock) => {
                const attempts = weekTests.filter((a) => a.mockId === mock.id)
                return (
                  <div key={mock.id} className="mock-card">
                    <p className="mock-card__title">{mock.title}</p>
                    <p className="mock-card__desc">{mock.description}</p>
                    <div className="mock-card__meta">
                      <Badge tone={mock.type === 'weekly' ? 'accent' : 'neutral'} size="sm">
                        {mock.type === 'weekly' ? 'Weekly' : 'Chapter'}
                      </Badge>
                      <span>{mock.questionIds.length} Qs · {mock.durationMinutes} min</span>
                    </div>
                    {attempts.length ? (
                      <Badge tone="success" size="sm" dot>
                        Taken this week · {Math.max(...attempts.map((a) => a.accuracy))}% best
                      </Badge>
                    ) : (
                      <Badge tone="warning" size="sm">Not attempted this week</Badge>
                    )}
                    <Button variant="primary" size="sm" block icon={<Play size={12} />} onClick={() => navigate(`/mock-tests/${mock.id}`)}>
                      Start
                    </Button>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Chapter-wise test suggestions" subtitle="Weakest chapters this week" icon={<TrendingUp size={15} />} />
            <div className="stack" style={{ gap: 7 }}>
              {state.chapters
                .filter((c) => c.topics.some((t) => t.initialLearningDate && t.initialLearningDate >= weekStart && t.initialLearningDate <= weekEnd))
                .sort((a, b) => chapterAccuracy(a) - chapterAccuracy(b))
                .slice(0, 6)
                .map((chapter) => {
                  const subject = state.subjects.find((s) => s.id === chapter.subjectId)
                  return (
                    <div key={chapter.id} className="row row--between" style={{ gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, fontWeight: 550 }}>{chapter.name}</p>
                        <p className="text-tertiary" style={{ fontSize: 10.5 }}>
                          {subject?.shortName} · accuracy {chapterAccuracy(chapter)}% · {chapter.topics.length} topics
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<FileText size={12} />}
                        onClick={() => subject && subjectQuiz(subject, chapter)}
                      >
                        Test chapter
                      </Button>
                    </div>
                  )
                })}
              {!state.chapters.some((c) => c.topics.some((t) => t.initialLearningDate && t.initialLearningDate >= weekStart && t.initialLearningDate <= weekEnd)) ? (
                <EmptyState compact icon={<BookOpenCheck size={18} />} title="No chapters studied this week" message="Learn a few topics first, then come back for the Sunday test." />
              ) : null}
            </div>
          </Card>

          {weekTests.length ? (
            <Card>
              <CardHeader title="This week’s results" icon={<ClipboardList size={15} />} />
              <div className="stack" style={{ gap: 8 }}>
                {weekTests.map((a) => (
                  <div key={a.id} className="row row--between" style={{ fontSize: 12.5 }}>
                    <div className="row" style={{ gap: 7, minWidth: 0 }}>
                      {a.accuracy >= 70 ? (
                        <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
                      ) : (
                        <XCircle size={13} style={{ color: 'var(--danger)' }} />
                      )}
                      <span className="truncate">{a.title}</span>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="mono text-tertiary" style={{ fontSize: 11 }}>
                        {a.correct}/{a.totalQuestions}
                      </span>
                      <Badge tone={a.accuracy >= 75 ? 'success' : a.accuracy >= 55 ? 'warning' : 'danger'} size="sm">
                        {a.accuracy}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      )}

      <Card>
        <CardHeader title="How Sunday review differs" icon={<Sparkles size={15} />} />
        <div className="grid grid--3" style={{ gap: 14 }}>
          <div>
            <p className="field__label" style={{ marginBottom: 4 }}>No new learning</p>
            <p className="stat__hint">
              Sunday sessions are revision-flagged only. New chapters resume Monday.
            </p>
          </div>
          <div>
            <p className="field__label" style={{ marginBottom: 4 }}>Weekly revision counts separately</p>
            <p className="stat__hint">
              Marking a topic revised here records a <strong>weekly</strong> revision — never confused with same-day or next-day.
            </p>
          </div>
          <div>
            <p className="field__label" style={{ marginBottom: 4 }}>Tests drive next week</p>
            <p className="stat__hint">
              Wrong answers auto-fill the Mistake Bank and re-prioritise the next week’s revision order.
            </p>
          </div>
        </div>
      </Card>

      {/* --------------------------- revision modal --------------------------- */}
      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title="Weekly revision"
        subtitle={active ? `${active.name} · ${classifyRevision(active, today)} revision` : undefined}
        footer={
          <>
            <Button onClick={() => setActive(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={<CheckCircle2 size={14} />}
              onClick={() => {
                if (!active) return
                logRevision(active.id, {
                  type: 'weekly',
                  source: 'sunday-review',
                  notes: notes.trim(),
                  confidence: active.confidence
                })
                notify({ title: 'Weekly revision logged', message: `${active.name} — counted as a weekly revision.`, variant: 'success' })
                setActive(null)
              }}
            >
              Mark revised
            </Button>
          </>
        }
      >
        {active ? (
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid grid--3" style={{ gap: 9 }}>
              <div className="muted-box">
                <p className="kv__label">Learnt</p>
                <p style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3 }}>
                  {active.initialLearningDate ? formatShortDate(active.initialLearningDate) : '—'}
                </p>
              </div>
              <div className="muted-box">
                <p className="kv__label">Revisions</p>
                <p className="mono" style={{ fontSize: 15, fontWeight: 650, marginTop: 2 }}>{active.revisions.length}</p>
              </div>
              <div className="muted-box">
                <p className="kv__label">Mastery</p>
                <p className="mono" style={{ fontSize: 15, fontWeight: 650, marginTop: 2 }}>{topicMastery(active)}</p>
              </div>
            </div>

            {active.keyPoints.length ? (
              <div>
                <p className="field__label" style={{ marginBottom: 5 }}>Recall checklist</p>
                <ul className="stack" style={{ gap: 4 }}>
                  {active.keyPoints.map((k) => (
                    <li key={k} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6 }}>
                      <span className="text-tertiary">•</span>
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {active.formulas.length ? (
              <div>
                <p className="field__label" style={{ marginBottom: 5 }}>Formulas</p>
                <div>
                  {active.formulas.map((f) => (
                    <span key={f} className="formula-chip">{f}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {state.mistakes.filter((m) => m.topicId === active.id && m.status !== 'resolved').length ? (
              <div className="callout callout--warning">
                <Circle size={13} />
                <span style={{ fontSize: 11.5 }}>
                  {state.mistakes.filter((m) => m.topicId === active.id && m.status !== 'resolved').length} unresolved mistake(s) in this topic — resolve
                  them in the Mistake Bank after revising.
                </span>
              </div>
            ) : null}

            <div>
              <p className="field__label" style={{ marginBottom: 5 }}>What still feels shaky?</p>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Carry these into next week’s revision…" />
            </div>

            <Button variant="secondary" block icon={<RotateCcw size={13} />} onClick={() => navigate('/mistakes')}>
              Open Mistake Bank
            </Button>
          </div>
        ) : null}
      </Modal>
    </main>
  )
}

export { Clock, Progress }
