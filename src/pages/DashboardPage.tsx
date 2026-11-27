import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock,
  Flame,
  Hourglass,
  Layers,
  ListChecks,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp
} from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Progress, Ring, StatCard } from '../components/ui'
import { ActiveSessionCard, SessionCard, openCompletion, triggerStartSession } from '../components/sessions'
import { useStudy } from '../store/StudyStore'
import { CarryoverBanner } from '../components/revision'
import {
  consistencyFor,
  dueRevisions,
  logsInRange,
  sessionViewsForDate,
  streakFor,
  subjectProgress,
  topicMastery,
  allTopics
} from '../store/selectors'
import { addDays, formatDuration, formatLongDate, greeting } from '../lib/date'
import { cx, pct, sum } from '../lib/utils'

export default function DashboardPage() {
  const { state, today } = useStudy()
  const navigate = useNavigate()

  const views = useMemo(() => sessionViewsForDate(state, today), [state, today])
  const todayLog = state.logs.find((l) => l.date === today)
  const due = useMemo(() => dueRevisions(state, today), [state, today])
  const streak = useMemo(() => streakFor(state, today), [state, today])
  const consistency = useMemo(() => consistencyFor(state, 7, today), [state, today])

  const completed = views.filter((v) => v.record.status === 'completed')
  const pending = views.filter((v) => !['completed', 'skipped'].includes(v.record.status))
  const activeView = views.find((v) => v.record.status === 'in-progress')
  const nextView = views.find((v) => ['upcoming', 'revision-pending'].includes(v.record.status))

  const plannedMinutes = sum(views.map((v) => v.slot.durationMinutes))
  const actualMinutes = todayLog?.actualMinutes ?? 0
  const revisionsToday = state.chapters
    .flatMap((c) => c.topics)
    .reduce((acc, t) => acc + t.revisions.filter((r) => r.date === today).length, 0)

  const unresolvedMistakes = state.mistakes.filter((m) => m.status !== 'resolved').length
  const dueToday = due.filter((d) => d.daysOverdue === 0)
  const overdueRevisions = due.filter((d) => d.daysOverdue > 0)

  const weekly = logsInRange(state, addDays(today, -6), today)
  const weekMinutes = sum(weekly.map((l) => l.actualMinutes))

  const subjectStats = state.subjects.map((s) => {
    const p = subjectProgress(state, s.id)
    const minutesToday = views
      .filter((v) => v.subject.id === s.id && v.record.status === 'completed')
      .reduce((acc, v) => acc + (v.record.completion?.durationMinutes ?? 0), 0)
    return { subject: s, ...p, minutesToday }
  })

  const totalTopics = allTopics(state).length
  const learnedTopics = allTopics(state).filter((t) => t.initialLearningDate).length

  const dayPercent = pct(actualMinutes, plannedMinutes)
  const sessionPercent = pct(completed.length, views.length)

  return (
    <main className="page">
      <CarryoverBanner />
      {/* ------------------------------ Hero ------------------------------ */}
      <section className="hero" style={{ marginBottom: 18 }}>
        <div className="hero__text">
          <p className="hero__eyebrow">
            {greeting()} · Day {Math.max(1, 320 - 0)} of your {state.settings.examTarget} run
          </p>
          <h1 className="hero__title">
            {pending.length
              ? `${pending.length} session${pending.length === 1 ? '' : 's'} still on today’s plate`
              : 'Today’s schedule is clear — nice work'}
          </h1>
          <p className="hero__sub">
            {formatLongDate(today)} · {due.length} revision{due.length === 1 ? '' : 's'} due · {unresolvedMistakes} unresolved mistake
            {unresolvedMistakes === 1 ? '' : 's'} in the bank.
            {nextView
              ? ` Next up: ${nextView.subject.name} at ${nextView.slot.startTime} (${nextView.slot.label}).`
              : ' Nothing else scheduled — use the time for a chapter-wise mock test.'}
          </p>
          <div className="hero__meta">
            <Badge tone="accent" dot>
              <Flame size={11} /> {streak.current}-day streak
            </Badge>
            <Badge tone="neutral">{consistency}% consistency (7d)</Badge>
            <Badge tone="neutral">
              <BookOpen size={11} /> {learnedTopics}/{totalTopics} topics learnt
            </Badge>
            <Badge tone={overdueRevisions.length ? 'danger' : 'success'} dot>
              {overdueRevisions.length ? `${overdueRevisions.length} revisions overdue` : 'Revisions on track'}
            </Badge>
          </div>
        </div>
        <div className="hero__rings">
          <div className="hero-ring">
            <Ring value={dayPercent} size={72} stroke={7} tone={dayPercent >= 100 ? 'var(--success)' : 'var(--accent)'}>
              <span className="mono">{dayPercent}%</span>
            </Ring>
            <span className="hero-ring__label">Study time</span>
          </div>
          <div className="hero-ring">
            <Ring value={sessionPercent} size={72} stroke={7} tone="var(--success)">
              <span className="mono">{sessionPercent}%</span>
            </Ring>
            <span className="hero-ring__label">Sessions</span>
          </div>
        </div>
      </section>

      {/* ---------------------------- Stat cards ---------------------------- */}
      <section className="grid grid--6 tight section" style={{ gap: 11 }}>
        <StatCard
          label="Planned"
          value={formatDuration(plannedMinutes)}
          icon={<CalendarCheck size={13} />}
          hint={`${views.length} sessions today`}
        />
        <StatCard
          label="Studied"
          value={formatDuration(actualMinutes)}
          icon={<Clock size={13} />}
          tone={actualMinutes >= plannedMinutes && plannedMinutes > 0 ? 'success' : 'accent'}
          hint={`${dayPercent}% of target`}
        />
        <StatCard
          label="Completed"
          value={completed.length}
          unit={`/ ${views.length}`}
          icon={<CheckCircle2 size={13} />}
          tone="success"
          hint={`${sessionPercent}% of sessions`}
        />
        <StatCard
          label="Pending"
          value={pending.length}
          icon={<Hourglass size={13} />}
          tone={pending.length ? 'warning' : 'neutral'}
          hint={pending.length ? `Next at ${nextView?.slot.startTime ?? '—'}` : 'All clear'}
        />
        <StatCard
          label="Revisions"
          value={revisionsToday}
          icon={<RotateCcw size={13} />}
          tone={revisionsToday ? 'accent' : 'neutral'}
          hint={`${due.length} due today`}
        />
        <StatCard
          label="Topics"
          value={learnedTopics}
          unit={`/ ${totalTopics}`}
          icon={<Layers size={13} />}
          hint={`${state.chapters.length} chapters`}
        />
      </section>

      {/* --------------------------- Main columns --------------------------- */}
      <div className="grid grid--dash section">
        {/* left: timeline */}
        <div className="stack">
          <Card>
            <CardHeader
              title="Today’s study schedule"
              subtitle={`${views.length} sessions · ${formatDuration(plannedMinutes)} planned · chronological order`}
              icon={<ListChecks size={15} />}
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={() => navigate('/schedule')} iconRight={<ArrowRight size={13} />}>
                    Edit schedule
                  </Button>
                </>
              }
            />
            {views.length ? (
              <div className="timeline">
                {views.map((view) => (
                  <div key={view.key} className={cx('timeline-item', `timeline-item--${view.record.status}`)}>
                    <span className="timeline-item__dot" />
                    <SessionCard
                      view={view}
                      onStart={triggerStartSession}
                      onComplete={openCompletion}
                      onSkip={(key) => window.dispatchEvent(new CustomEvent('studyos:open-skip', { detail: key }))}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<CalendarCheck size={20} />}
                title="No sessions scheduled for today"
                message="Your schedule for this weekday is empty. Add a session or copy a template from another day."
                action={
                  <Button variant="primary" size="sm" onClick={() => navigate('/schedule')}>
                    Open schedule builder
                  </Button>
                }
              />
            )}
          </Card>

          {/* subject performance */}
          <Card>
            <CardHeader
              title="Today’s performance by subject"
              subtitle="Completed minutes, accuracy and mastery — derived from your session logs"
              icon={<TrendingUp size={15} />}
              actions={
                <Button size="sm" variant="ghost" onClick={() => navigate('/analytics')} iconRight={<ChevronRight size={13} />}>
                  Full analytics
                </Button>
              }
            />
            <div className="stack" style={{ gap: 12 }}>
              {subjectStats.map((s) => {
                const tone = `var(--s-${s.subject.tone === 'custom' ? 'math' : s.subject.tone})`
                return (
                  <div key={s.subject.id}>
                    <div className="row row--between" style={{ marginBottom: 5 }}>
                      <div className="row" style={{ gap: 7 }}>
                        <span className="subject-dot" style={{ background: tone }} />
                        <span style={{ fontSize: 13, fontWeight: 550 }}>{s.subject.name}</span>
                        <span className="text-tertiary" style={{ fontSize: 11 }}>
                          {s.topicsLearned}/{s.topics} topics
                        </span>
                      </div>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="mono text-secondary" style={{ fontSize: 11.5 }}>
                          {formatDuration(s.minutesToday)} today
                        </span>
                        <Badge tone={s.accuracy >= 80 ? 'success' : s.accuracy >= 65 ? 'warning' : 'danger'} size="sm">
                          {s.accuracy}% acc
                        </Badge>
                      </div>
                    </div>
                    <Progress value={s.mastery} tone={s.mastery >= 75 ? 'success' : 'accent'} height={5} />
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        {/* right: active + revision */}
        <div className="stack">
          {activeView ? (
            <ActiveSessionCard view={activeView} />
          ) : (
            <Card>
              <CardHeader title="Active session" subtitle="Nothing running right now" icon={<Play size={15} />} />
              {nextView ? (
                <div className="stack" style={{ gap: 10 }}>
                  <p className="text-secondary" style={{ fontSize: 12.5 }}>
                    Your next session is <strong>{nextView.subject.name}</strong> — {nextView.slot.label} at{' '}
                    {nextView.slot.startTime}.
                  </p>
                  <Button
                    variant="primary"
                    block
                    icon={<Play size={14} />}
                    onClick={() => triggerStartSession(nextView.key)}
                  >
                    Start now
                  </Button>
                </div>
              ) : (
                <EmptyState compact icon={<CheckCircle2 size={18} />} title="Nothing left today" message="Every session is completed or skipped." />
              )}
            </Card>
          )}

          <Card>
            <CardHeader
              title="Revision overview"
              subtitle="Same-day and overdue revisions demand attention first"
              icon={<RotateCcw size={15} />}
              actions={
                <Button size="sm" variant="ghost" onClick={() => navigate('/revision')} iconRight={<ChevronRight size={13} />}>
                  Open
                </Button>
              }
            />
            <div className="grid grid--2" style={{ gap: 9, marginBottom: 13 }}>
              <div className="muted-box">
                <p className="kv__label">Due today</p>
                <p className="mono" style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.03em' }}>
                  {dueToday.length}
                </p>
              </div>
              <div className="muted-box">
                <p className="kv__label">Overdue</p>
                <p className="mono" style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.03em', color: overdueRevisions.length ? 'var(--danger)' : 'var(--text)' }}>
                  {overdueRevisions.length}
                </p>
              </div>
              <div className="muted-box">
                <p className="kv__label">Revised today</p>
                <p className="mono" style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.03em', color: 'var(--success)' }}>
                  {revisionsToday}
                </p>
              </div>
              <div className="muted-box">
                <p className="kv__label">Wrong Qs open</p>
                <p className="mono" style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.03em' }}>
                  {unresolvedMistakes}
                </p>
              </div>
            </div>

            <div className="rev-list">
              {due.slice(0, 4).map((d) => (
                <div key={d.topic.id} className={cx('rev-card', d.daysOverdue > 0 && 'rev-card--due')}>
                  <div className="rev-card__main">
                    <p className="rev-card__title truncate">{d.topic.name}</p>
                    <div className="rev-card__meta">
                      <span>{d.subject.shortName}</span>
                      <span>·</span>
                      <span>{d.chapter.name}</span>
                      <span>·</span>
                      <span>mastery {topicMastery(d.topic)}</span>
                    </div>
                  </div>
                  <Badge tone={d.daysOverdue > 0 ? 'danger' : 'warning'} size="sm">
                    {d.daysOverdue > 0 ? `${d.daysOverdue}d late` : 'today'}
                  </Badge>
                </div>
              ))}
              {!due.length ? (
                <EmptyState compact icon={<CheckCircle2 size={18} />} title="No revisions due" message="Spaced repetition is fully caught up." />
              ) : null}
            </div>

            {due.length ? (
              <Button variant="quiet" block size="sm" style={{ marginTop: 11 }} onClick={() => navigate('/revision')}>
                Open Revision Center ({due.length})
              </Button>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="This week" subtitle="Rolling 7 days" icon={<Activity size={15} />} />
            <div className="stack" style={{ gap: 10 }}>
              <div className="row row--between">
                <span className="text-secondary" style={{ fontSize: 12.5 }}>
                  Study time
                </span>
                <strong className="mono" style={{ fontSize: 13 }}>
                  {formatDuration(weekMinutes)}
                </strong>
              </div>
              <Progress value={weekMinutes} max={state.settings.weeklyTargetMinutes} tone={weekMinutes >= state.settings.weeklyTargetMinutes ? 'success' : 'accent'} height={6} />
              <div className="row row--between" style={{ fontSize: 11.5 }}>
                <span className="text-tertiary">{pct(weekMinutes, state.settings.weeklyTargetMinutes)}% of weekly target</span>
                <span className="text-tertiary">Best streak {streak.best}d</span>
              </div>
              <div className="divider" style={{ margin: '4px 0' }} />
              <div className="row row--between" style={{ fontSize: 12.5 }}>
                <span className="text-secondary">Days on target</span>
                <strong className="mono">
                  {weekly.filter((l) => l.actualMinutes >= l.plannedMinutes * 0.8).length}/{weekly.length}
                </strong>
              </div>
              <div className="row row--between" style={{ fontSize: 12.5 }}>
                <span className="text-secondary">Mock tests taken</span>
                <strong className="mono">{sum(weekly.map((l) => l.mockTests))}</strong>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Quick actions" icon={<Sparkles size={15} />} />
            <div className="stack" style={{ gap: 7 }}>
              <Button block variant="secondary" icon={<BookOpenCheck size={14} />} onClick={() => navigate('/sunday')}>
                Sunday weekly review
              </Button>
              <Button block variant="secondary" icon={<Target size={14} />} onClick={() => navigate('/tests')}>
                Take a mock test
              </Button>
              <Button block variant="secondary" icon={<AlertTriangle size={14} />} onClick={() => navigate('/mistakes')}>
                Review mistake bank
              </Button>
              <Button block variant="ghost" icon={<CircleSlash size={14} />} onClick={() => navigate('/schedule')}>
                Open my schedule
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </main>
  )
}
