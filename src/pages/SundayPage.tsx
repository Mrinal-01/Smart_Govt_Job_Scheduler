import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BookOpenCheck, CalendarDays, CheckCircle2, ClipboardList, Lock, RotateCcw, Target } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, LoadingBlock, Progress } from '../components/ui'
import { ObligationStateBadge, RevisionWorkspace } from '../components/revision'
import { planApi, usePlanResource, type Obligation, type WeeklyReview } from '../lib/plan'
import { WEEKDAY_SHORT, addDays, dateKey, formatDuration, formatShortDate, weekdayOf } from '../lib/date'
import { cx } from '../lib/utils'

/*
 * Sunday Review — one flow: revise everything you finished this week.
 *
 * The server builds one weekly revision per subject from every topic you FULLY completed on the
 * week's study days before Sunday (Mon–Sat). It opens on the weekly review day (Sunday by default,
 * configurable in Settings) and is tracked separately from same-day and next-day revision.
 */

export default function SundayPage() {
  const navigate = useNavigate()
  const [weekOffset, setWeekOffset] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const { data, error, loading } = usePlanResource(() => planApi.weekly(weekOffset ? addDays(dateKey(), weekOffset * 7) : undefined), [weekOffset])

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Sunday Review</h1>
          <p className="page-head__sub">
            Revise the whole week in one sitting: every topic you finished from Monday to Saturday, subject by subject, then take the weekly test.
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" onClick={() => setWeekOffset((w) => w - 1)}>
            Previous week
          </Button>
          <Button variant="secondary" disabled={weekOffset >= 0} onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}>
            This week
          </Button>
        </div>
      </div>

      {error ? <div className="callout callout--danger section">{error}</div> : null}
      {loading && !data ? <LoadingBlock label="Loading this week…" /> : null}
      {data ? <WeekView data={data} onOpen={setOpenId} onTest={() => navigate('/tests/new')} /> : null}
      <RevisionWorkspace obligationId={openId} onClose={() => setOpenId(null)} />
    </main>
  )
}

function WeekView({ data, onOpen, onTest }: { data: WeeklyReview; onOpen: (id: string) => void; onTest: () => void }) {
  const isDue = data.today >= data.dueDate
  const p = data.progress
  const s = data.summary
  // Topics grouped per subject, then by the day they were learnt.
  const bySubject = useMemo(() => new Map(data.topics.map((t) => [t.subjectId, t])), [data.topics])

  return (
    <>
      <div className="sunday-banner section">
        <CalendarDays size={18} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong>
            Week of {formatShortDate(data.weekStart)} – {formatShortDate(data.dueDate > data.weekStart ? addDays(data.dueDate, -1) : data.weekEnd)}
          </strong>
          <div className="text-secondary" style={{ fontSize: 12.5 }}>
            {isDue
              ? `Review day is ${formatShortDate(data.dueDate)}. ${p.completed}/${p.total} subjects revised · ${p.topicsRevised}/${p.topicsTotal} topics.`
              : `Opens on ${WEEKDAY_SHORT[weekdayOf(data.dueDate)]} ${formatShortDate(data.dueDate)}. Topics are added as you finish them during the week.`}
          </div>
        </div>
        <div style={{ minWidth: 160 }}>
          <Progress value={p.completed} max={Math.max(1, p.total)} tone={p.total && p.completed === p.total ? 'success' : 'accent'} height={6} />
        </div>
      </div>

      <div className="grid grid--aside">
        <div className="stack">
          <Card>
            <CardHeader title="1 · Revise each subject" subtitle="Only topics you fully completed this week" icon={<RotateCcw size={15} />} />
            {data.obligations.length ? (
              <div className="stack" style={{ gap: 10 }}>
                {data.obligations.map((o) => (
                  <SubjectWeek key={o.id} obligation={o} days={bySubject.get(o.subjectId)} isDue={isDue} onOpen={onOpen} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<BookOpenCheck size={20} />}
                title="Nothing to revise yet"
                message="Finish learning sessions on My Schedule during the week — every topic you fully complete is added here automatically."
              />
            )}
          </Card>

          <Card>
            <CardHeader
              title="2 · Weekly test"
              subtitle={data.mockTests.count ? `${data.mockTests.count} test(s) this week${data.mockTests.averageAccuracy !== null ? ` · average ${data.mockTests.averageAccuracy}%` : ''}` : 'Check the week with a mixed test from the question hub'}
              icon={<ClipboardList size={15} />}
              actions={
                <Button size="sm" variant="primary" icon={<Target size={13} />} onClick={onTest}>
                  Build weekly test
                </Button>
              }
            />
            {data.mockTests.tests.length ? (
              <ul className="plain-list">
                {data.mockTests.tests.map((t) => (
                  <li key={t.id}>
                    <span>{t.name}</span>
                    <strong>{t.accuracy !== null ? `${t.accuracy}%` : '—'}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="This week" icon={<CalendarDays size={15} />} />
            <ul className="plain-list">
              <li>
                <span>Learning sessions done</span>
                <strong>
                  {s.learningSessionsCompleted}/{s.learningSessionsPlanned}
                </strong>
              </li>
              <li>
                <span>Missed / skipped</span>
                <strong>
                  {s.missed} / {s.skipped}
                </strong>
              </li>
              <li>
                <span>Learning time</span>
                <strong>{formatDuration(s.learningMinutes)}</strong>
              </li>
              <li>
                <span>Revision time</span>
                <strong>{formatDuration(s.revisionMinutes)}</strong>
              </li>
              <li>
                <span>Revisions (same-day · next-day · weekly)</span>
                <strong>
                  {s.revisionsCompleted.same_day} · {s.revisionsCompleted.next_day} · {s.revisionsCompleted.weekly}
                </strong>
              </li>
            </ul>
          </Card>

          <Card>
            <CardHeader title="Weak spots to look at" subtitle="Low accuracy or repeated mistakes" icon={<AlertTriangle size={15} />} />
            {data.weakTopics.length || data.mistakes.unresolvedMockMistakes.length ? (
              <ul className="plain-list">
                {data.weakTopics.slice(0, 6).map((t) => (
                  <li key={t.topicId}>
                    <span>
                      {t.topicName} <span className="text-tertiary">· {t.chapterName}</span>
                    </span>
                    <strong className="text-danger">{t.accuracy !== null ? `${t.accuracy}%` : `${t.mistakeCount} mistakes`}</strong>
                  </li>
                ))}
                {data.mistakes.unresolvedMockMistakes.slice(0, 4).map((m) => (
                  <li key={m.id}>
                    <span className="truncate">{m.question}</span>
                    <Badge size="sm" tone="danger">
                      {m.occurrences}× wrong
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-tertiary" style={{ fontSize: 12.5 }}>
                No weak spots recorded yet.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

function SubjectWeek({
  obligation: o,
  days,
  isDue,
  onOpen
}: {
  obligation: Obligation
  days: WeeklyReview['topics'][number] | undefined
  isDue: boolean
  onOpen: (id: string) => void
}) {
  // Day → topics learnt that day (Mon … Sat).
  const perDay = new Map<string, string[]>()
  for (const ch of days?.chapters ?? []) for (const t of ch.topics) for (const d of t.dates) perDay.set(d, [...(perDay.get(d) ?? []), t.topicName])
  const dates = Array.from(perDay.keys()).sort()
  const done = o.status === 'completed'
  return (
    <div className={cx('week-subject', done && 'is-done')}>
      <div className="row row--between row--wrap" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          {done ? <CheckCircle2 size={16} className="text-success" /> : <RotateCcw size={15} className="text-tertiary" />}
          <strong>{o.subjectName}</strong>
          <span className="text-tertiary" style={{ fontSize: 12 }}>
            {o.topics.length} topic{o.topics.length === 1 ? '' : 's'} · {formatDuration(o.plannedMinutes)}
          </span>
          <ObligationStateBadge obligation={o} />
        </div>
        {isDue || done ? (
          <Button size="sm" variant={done ? 'ghost' : 'primary'} onClick={() => onOpen(o.id)}>
            {done ? 'View' : o.status === 'in_progress' ? 'Continue' : 'Revise'}
          </Button>
        ) : (
          <span className="row text-tertiary" style={{ gap: 5, fontSize: 12 }}>
            <Lock size={12} /> opens on review day
          </span>
        )}
      </div>
      <div className="week-subject__days">
        {dates.map((d) => (
          <div key={d} className="week-subject__day">
            <span className="week-subject__dayname">
              {WEEKDAY_SHORT[weekdayOf(d)]} {formatShortDate(d)}
            </span>
            <span>{perDay.get(d)!.join(', ')}</span>
          </div>
        ))}
      </div>
      {o.result ? (
        <p className="text-tertiary" style={{ fontSize: 11.5, marginTop: 4 }}>
          {o.result.questionsCorrect}/{o.result.questionsAttempted} correct · confidence {o.result.confidence}/5 · {formatDuration(o.result.actualMinutes)}
        </p>
      ) : null}
    </div>
  )
}
