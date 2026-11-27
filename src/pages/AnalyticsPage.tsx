import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Activity, BarChart3, CalendarDays, Flame, Layers, RotateCcw, Target, TrendingUp } from 'lucide-react'
import { Badge, Button, Card, CardHeader, Progress, Segmented } from '../components/ui'
import { useStudy } from '../store/StudyStore'
import {
  allTopics,
  chapterAccuracy,
  chapterStatus,
  consistencyFor,
  logsInRange,
  streakFor,
  subjectProgress,
  topicMastery
} from '../store/selectors'
import { addDays, dateKey, formatDuration, formatShortDate, MONTH_SHORT, parseDateKey, weekdayOf } from '../lib/date'
import { cx, pct, sum } from '../lib/utils'
import { planApi, usePlanResource } from '../lib/plan'

type RangeKey = '7' | '30' | '90' | '365'

const SUBJECT_COLORS = ['#4f46e5', '#0e9f6e', '#c2740a', '#0369a1', '#7c3aed', '#be185d']

function TooltipBox({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__title">{label}</p>
      {payload.map((p) => (
        <div className="chart-tooltip__row" key={p.name}>
          <span>{p.name}</span>
          <b>{typeof p.value === 'number' ? Math.round(p.value) : p.value}</b>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsPage() {
  const { state, today } = useStudy()
  const [range, setRange] = useState<RangeKey>('30')

  const days = Number(range)
  const from = addDays(today, -(days - 1))
  const logs = useMemo(() => logsInRange(state, from, today), [state, from, today])

  const totalMinutes = sum(logs.map((l) => l.actualMinutes))
  const plannedMinutes = sum(logs.map((l) => l.plannedMinutes))
  const totalSessions = sum(logs.map((l) => l.sessionsCompleted))
  const totalRevisions = sum(logs.map((l) => l.revisionsCompleted))
  const totalTests = sum(logs.map((l) => l.mockTests))
  const avgAccuracy = (() => {
    const withAcc = logs.filter((l) => l.accuracy != null)
    return withAcc.length ? Math.round(sum(withAcc.map((l) => l.accuracy!)) / withAcc.length) : 0
  })()

  const streak = useMemo(() => streakFor(state, today), [state, today])
  const consistency = useMemo(() => consistencyFor(state, days, today), [state, days, today])

  /* ------------------------------ chart data ------------------------------ */
  const dailySeries = useMemo(
    () =>
      logs.map((l) => ({
        label: formatShortDate(l.date),
        planned: Math.round(l.plannedMinutes / 60 * 10) / 10,
        actual: Math.round(l.actualMinutes / 60 * 10) / 10,
        accuracy: l.accuracy ?? null,
        sessions: l.sessionsCompleted
      })),
    [logs]
  )

  const subjectSeries = useMemo(() => {
    return state.subjects.map((s, i) => {
      const minutes = logs.reduce((acc, l) => acc + (l.subjectMinutes[s.id] ?? 0), 0)
      const p = subjectProgress(state, s.id)
      return {
        name: s.shortName,
        hours: Math.round((minutes / 60) * 10) / 10,
        mastery: p.mastery,
        accuracy: p.accuracy,
        revisions: p.revisions,
        color: SUBJECT_COLORS[i % SUBJECT_COLORS.length]
      }
    })
  }, [logs, state])

  const weeklyBuckets = useMemo(() => {
    const buckets: Array<{ label: string; minutes: number; sessions: number; tests: number; revisions: number }> = []
    const totalWeeks = Math.min(12, Math.ceil(logs.length / 7) || 1)
    for (let w = 0; w < totalWeeks; w += 1) {
      const end = addDays(today, -w * 7)
      const start = addDays(end, -6)
      const chunk = logs.filter((l) => l.date >= start && l.date <= end)
      if (!chunk.length) continue
      buckets.unshift({
        label: `${formatShortDate(start)}`,
        minutes: sum(chunk.map((l) => l.actualMinutes)),
        sessions: sum(chunk.map((l) => l.sessionsCompleted)),
        tests: sum(chunk.map((l) => l.mockTests)),
        revisions: sum(chunk.map((l) => l.revisionsCompleted))
      })
    }
    return buckets
  }, [logs, today])

  const monthSeries = useMemo(() => {
    const map = new Map<string, { minutes: number; revisions: number; sessions: number; accSum: number; accCount: number }>()
    logs.forEach((l) => {
      const { y, m } = parseDateKey(l.date)
      const key = `${y}-${m}`
      const e = map.get(key) ?? { minutes: 0, revisions: 0, sessions: 0, accSum: 0, accCount: 0 }
      e.minutes += l.actualMinutes
      e.revisions += l.revisionsCompleted
      e.sessions += l.sessionsCompleted
      if (l.accuracy != null) {
        e.accSum += l.accuracy
        e.accCount += 1
      }
      map.set(key, e)
    })
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, v]) => {
        const [, m] = key.split('-').map(Number)
        return {
          label: `${MONTH_SHORT[m - 1]}`,
          hours: Math.round((v.minutes / 60) * 10) / 10,
          revisions: v.revisions,
          accuracy: v.accCount ? Math.round(v.accSum / v.accCount) : 0,
          sessions: v.sessions
        }
      })
  }, [logs])

  /* -------------------------------- heatmap -------------------------------- */
  const heatmap = useMemo(() => {
    const start = addDays(today, -364)
    const byDate = new Map(state.logs.map((l) => [l.date, l]))
    const cells: Array<{ date: string; level: number; minutes: number; planned: number } | null> = []
    const leadPad = weekdayOf(start)
    for (let i = 0; i < leadPad; i += 1) cells.push(null)
    for (let i = 0; i < 365; i += 1) {
      const d = addDays(start, i)
      const log = byDate.get(d)
      let level = 0
      if (log && log.actualMinutes > 0) {
        const ratio = log.actualMinutes / Math.max(60, log.plannedMinutes)
        level = ratio >= 1 ? 4 : ratio >= 0.7 ? 3 : ratio >= 0.4 ? 2 : 1
      }
      cells.push({ date: d, level, minutes: log?.actualMinutes ?? 0, planned: log?.plannedMinutes ?? 0 })
    }
    const weeks: Array<Array<(typeof cells)[number]>> = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    return weeks
  }, [state.logs, today])

  const chapterSeries = useMemo(() => {
    return state.subjects.map((s, i) => {
      const chapters = state.chapters.filter((c) => c.subjectId === s.id)
      const done = chapters.filter((c) => ['learning-completed', 'revision-in-progress', 'mastered'].includes(chapterStatus(c))).length
      return {
        name: s.shortName,
        completed: done,
        remaining: chapters.length - done,
        color: SUBJECT_COLORS[i % SUBJECT_COLORS.length]
      }
    })
  }, [state.chapters, state.subjects])

  const weakTopics = useMemo(
    () =>
      allTopics(state)
        .filter((t) => t.initialLearningDate)
        .map((t) => ({ topic: t, mastery: topicMastery(t) }))
        .sort((a, b) => a.mastery - b.mastery)
        .slice(0, 6),
    [state]
  )

  const radarData = useMemo(
    () =>
      state.subjects.map((s) => {
        const p = subjectProgress(state, s.id)
        return { subject: s.shortName, mastery: p.mastery, accuracy: p.accuracy }
      }),
    [state]
  )

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Analytics</h1>
          <p className="page-head__sub">
            365 days of study history. Consistency is computed from completed sessions against your configured targets — never from login activity.
          </p>
        </div>
        <div className="page-head__actions">
          <Segmented
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '1 year' }
            ]}
          />
        </div>
      </div>

      <div className="grid grid--6 tight section" style={{ gap: 11 }}>
        <Card>
          <p className="stat__label">Study time</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{formatDuration(totalMinutes)}</p>
          <p className="stat__hint">{pct(totalMinutes, plannedMinutes)}% of plan</p>
        </Card>
        <Card>
          <p className="stat__label">Sessions</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{totalSessions}</p>
          <p className="stat__hint">completed</p>
        </Card>
        <Card>
          <p className="stat__label">Revisions</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{totalRevisions}</p>
          <p className="stat__hint">logged</p>
        </Card>
        <Card>
          <p className="stat__label">Mock tests</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{totalTests}</p>
          <p className="stat__hint">{state.attempts.length} all-time</p>
        </Card>
        <Card>
          <p className="stat__label">Avg. accuracy</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{avgAccuracy}%</p>
          <p className="stat__hint">daily average</p>
        </Card>
        <Card>
          <p className="stat__label">Streak</p>
          <p className="stat__value mono" style={{ marginTop: 3 }}>{streak.current}d</p>
          <p className="stat__hint">best {streak.best}d</p>
        </Card>
      </div>

      {/* -------------------------------- heatmap -------------------------------- */}
      <Card className="section">
        <CardHeader
          title="Study consistency heatmap"
          subtitle={`${consistency}% of the last ${days} days met the study target · ${streak.current}-day current streak`}
          icon={<CalendarDays size={15} />}
          actions={<Badge tone={consistency >= 70 ? 'success' : consistency >= 45 ? 'warning' : 'danger'} dot>{consistency}% consistency</Badge>}
        />
        <div className="heatmap">
          {heatmap.map((week, wi) => (
            <div className="heatmap__week" key={wi}>
              {week.map((cell, ci) =>
                cell ? (
                  <div
                    key={`${wi}-${ci}`}
                    className={cx('heatmap__cell', cell.date === today && 'is-today')}
                    data-level={cell.level}
                    title={`${cell.date} · ${formatDuration(cell.minutes)} of ${formatDuration(cell.planned)}`}
                  />
                ) : (
                  <div key={`${wi}-${ci}`} className="heatmap__cell is-empty" />
                )
              )}
            </div>
          ))}
        </div>
        <div className="row row--between" style={{ marginTop: 10 }}>
          <span className="text-tertiary" style={{ fontSize: 11 }}>{formatShortDate(addDays(today, -364))} → {formatShortDate(today)}</span>
          <div className="heatmap-legend">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className="heatmap__cell" data-level={l} style={{ cursor: 'default' }} />
            ))}
            <span>More</span>
          </div>
        </div>
      </Card>

      {/* ------------------------------ daily chart ------------------------------ */}
      <div className="grid grid--dash section">
        <Card>
          <CardHeader title="Study hours — planned vs actual" subtitle={`Last ${days} days`} icon={<Activity size={15} />} />
          <div className="chart-box" style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySeries} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={Math.max(0, Math.floor(dailySeries.length / 8))} />
                <YAxis tickLine={false} axisLine={false} width={56} unit="h" />
                <Tooltip content={<TooltipBox />} />
                <Area type="monotone" dataKey="planned" name="Planned" stroke="#94a3b8" strokeDasharray="4 3" fill="transparent" strokeWidth={1.4} />
                <Area type="monotone" dataKey="actual" name="Actual" stroke="#4f46e5" fill="url(#actualFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Accuracy trend" subtitle="Daily question accuracy" icon={<TrendingUp size={15} />} />
          <div className="chart-box" style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailySeries} margin={{ top: 4, right: 6, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={Math.max(0, Math.floor(dailySeries.length / 6))} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={56} unit="%" />
                <Tooltip content={<TooltipBox />} />
                <Line type="monotone" dataKey="accuracy" name="Accuracy" stroke="#0e9f6e" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* --------------------------- subject breakdown --------------------------- */}
      <div className="grid grid--2 section">
        <Card>
          <CardHeader title="Subject-wise study time" subtitle={`Hours in the last ${days} days`} icon={<BarChart3 size={15} />} />
          <div className="chart-box" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={subjectSeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={56} unit="h" />
                <Tooltip content={<TooltipBox />} />
                <Bar dataKey="hours" name="Hours" radius={[6, 6, 0, 0]} maxBarSize={46}>
                  {subjectSeries.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Mastery vs accuracy" subtitle="Subject radar" icon={<Target size={15} />} />
          <div className="chart-box" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                <Radar name="Mastery" dataKey="mastery" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.18} strokeWidth={2} />
                <Radar name="Accuracy" dataKey="accuracy" stroke="#0e9f6e" fill="#0e9f6e" fillOpacity={0.12} strokeWidth={1.6} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip content={<TooltipBox />} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ----------------------------- monthly trend ----------------------------- */}
      <div className="grid grid--2 section">
        <Card>
          <CardHeader title="Monthly study & revision volume" subtitle="Hours studied and revisions completed each month" icon={<Layers size={15} />} />
          <div className="chart-box" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthSeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={56} />
                <Tooltip content={<TooltipBox />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="hours" name="Hours" fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={26} />
                <Bar dataKey="revisions" name="Revisions" fill="#c2740a" radius={[5, 5, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Weekly rhythm" subtitle="Last 12 weeks" icon={<Flame size={15} />} />
          <div className="chart-box" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyBuckets} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={Math.max(0, Math.floor(weeklyBuckets.length / 6))} />
                <YAxis tickLine={false} axisLine={false} width={56} unit="h" />
                <Tooltip content={<TooltipBox />} />
                <Bar dataKey="minutes" name="Minutes" fill="#0369a1" radius={[5, 5, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="field__hint" style={{ marginTop: 8 }}>
            Values are minutes — hover a bar to see the exact study time for that week.
          </p>
        </Card>
      </div>

      {/* ------------------------ chapter completion + weak ------------------------ */}
      <div className="grid grid--2">
        <Card>
          <CardHeader title="Chapter completion" subtitle="Completed vs remaining chapters per subject" icon={<Layers size={15} />} />
          <div className="stack" style={{ gap: 11 }}>
            {chapterSeries.map((c) => {
              const total = c.completed + c.remaining
              return (
                <div key={c.name}>
                  <div className="row row--between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{c.name}</span>
                    <span className="mono text-secondary" style={{ fontSize: 11.5 }}>
                      {c.completed}/{total}
                    </span>
                  </div>
                  <Progress value={c.completed} max={Math.max(1, total)} tone="accent" height={5} />
                </div>
              )
            })}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Weakest topics"
            subtitle="Lowest mastery — these drive revision priority"
            icon={<RotateCcw size={15} />}
          />
          <div className="stack" style={{ gap: 6 }}>
            {weakTopics.map(({ topic, mastery }) => {
              const chapter = state.chapters.find((c) => c.id === topic.chapterId)
              const subject = state.subjects.find((s) => s.id === topic.subjectId)
              return (
                <div key={topic.id} className="row row--between" style={{ fontSize: 12.5 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 500 }}>{topic.name}</div>
                    <div className="text-tertiary" style={{ fontSize: 10.5 }}>
                      {subject?.shortName} · {chapter?.name} · {topic.mistakeCount} mistakes
                    </div>
                  </div>
                  <Badge tone={mastery >= 70 ? 'info' : mastery >= 50 ? 'warning' : 'danger'} size="sm">
                    {mastery}
                  </Badge>
                </div>
              )
            })}
            {!weakTopics.length ? <p className="text-tertiary" style={{ fontSize: 12.5 }}>No learned topics yet.</p> : null}
          </div>
        </Card>
      </div>

      {/* Uses the page's range picker; the server keeps at most 180 days of plan analytics. */}
      <PlanAnalyticsSection days={Math.min(180, Number(range))} />
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Learning vs revision (server study-plan analytics)                  */
/* ------------------------------------------------------------------ */

const rate = (v: number | null) => (v === null ? '—' : `${v}%`)

function PlanAnalyticsSection({ days }: { days: number }) {
  const { data, error, loading } = usePlanResource(() => planApi.analytics(days), [days], 0)
  const hasData =
    data && (data.sessions.planned > 0 || data.revisions.same_day.total + data.revisions.next_day.total + data.revisions.weekly.total > 0 || data.overrides.gate > 0)
  const series = (data?.daily ?? []).map((d) => ({ label: formatShortDate(d.date), learning: d.learningMinutes, revision: d.revisionMinutes }))
  return (
    <Card className="section">
      <CardHeader
        title="Learning vs revision"
        subtitle="Time spent learning new topics and time spent revising, counted separately."
        icon={<RotateCcw size={15} />}
      />
      {error ? <div className="callout callout--danger">{error}</div> : null}
      {loading && !data ? <p className="text-tertiary">Loading…</p> : null}
      {data && !hasData ? (
        <p className="text-tertiary" style={{ fontSize: 12.5 }}>
          No scheduled-session data in this range yet. Start and complete sessions from your published schedule to see learning and revision analytics.
        </p>
      ) : null}
      {data && hasData ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="plan-stats">
            <div>
              <span className="stat__label">Learning time</span>
              <strong className="mono">{formatDuration(data.time.actualLearningMinutes)}</strong>
              <span className="stat__hint">of {formatDuration(data.time.plannedLearningMinutes)} planned</span>
            </div>
            <div>
              <span className="stat__label">Revision time</span>
              <strong className="mono">{formatDuration(data.time.actualRevisionMinutes)}</strong>
              <span className="stat__hint">of {formatDuration(data.time.plannedRevisionMinutes)} planned</span>
            </div>
            {(['same_day', 'next_day', 'weekly'] as const).map((k) => {
              const b = data.revisions[k]
              return (
                <div key={k}>
                  <span className="stat__label">{k === 'same_day' ? 'Same-day' : k === 'next_day' ? 'Next-day' : 'Weekly'} revision</span>
                  <strong className="mono">{rate(b.completionRate)}</strong>
                  <span className="stat__hint">
                    {b.completed}/{b.total} done · {b.open} open{b.bypassed ? ` (${b.bypassed} bypassed)` : ''}
                  </span>
                </div>
              )
            })}
            <div>
              <span className="stat__label">Overdue revisions</span>
              <strong className={cx('mono', data.overdueRevisions > 0 && 'text-danger')}>{data.overdueRevisions}</strong>
            </div>
            <div>
              <span className="stat__label">Sessions</span>
              <strong className="mono">{rate(data.sessions.completionRate)}</strong>
              <span className="stat__hint">
                {data.sessions.completed}/{data.sessions.planned} · {data.sessions.skipped} skipped · {data.sessions.missed} missed
              </span>
            </div>
            <div>
              <span className="stat__label">Emergency overrides</span>
              <strong className={cx('mono', data.overrides.gate + data.overrides.schedule > 0 && 'text-danger')}>{data.overrides.gate + data.overrides.schedule}</strong>
              <span className="stat__hint">
                {data.overrides.gate} revision gate · {data.overrides.schedule} schedule
              </span>
            </div>
            <div>
              <span className="stat__label">Accuracy</span>
              <strong className="mono">
                {rate(data.performance.learningAccuracy)} / {rate(data.performance.revisionAccuracy)}
              </strong>
              <span className="stat__hint">
                learning ({data.performance.learningQuestions} Q) / revision ({data.performance.revisionQuestions} Q)
                {data.performance.averageRevisionConfidence !== null ? ` · confidence ${data.performance.averageRevisionConfidence}/5` : ''}
              </span>
            </div>
          </div>

          <div className="chart-box" style={{ height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={Math.max(0, Math.floor(series.length / 8))} />
                <YAxis tickLine={false} axisLine={false} width={56} unit="m" />
                <Tooltip content={<TooltipBox />} />
                <Legend />
                <Bar dataKey="learning" name="Learning (min)" fill="#4f46e5" radius={[3, 3, 0, 0]} />
                <Bar dataKey="revision" name="Revision (min)" fill="#0e9f6e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid--2" style={{ gap: 14, alignItems: 'start' }}>
            <div>
              <p className="queue-label">Subject-wise completion</p>
              <table className="plan-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Sessions</th>
                    <th>Learning</th>
                    <th>Revision</th>
                    <th>Revisions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subjects.map((s) => (
                    <tr key={s.subjectId}>
                      <td>{s.subjectName}</td>
                      <td className="mono">
                        {s.completedSessions}/{s.plannedSessions} ({rate(s.completionRate)})
                      </td>
                      <td className="mono">{formatDuration(s.learningMinutes)}</td>
                      <td className="mono">{formatDuration(s.revisionMinutes)}</td>
                      <td className="mono">
                        {s.revisionsCompleted}/{s.revisionsDue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="queue-label">Chapter-wise progress</p>
              {data.chapters.length ? (
                <div className="stack" style={{ gap: 8 }}>
                  {data.chapters.map((c) => (
                    <div key={c.chapterId}>
                      <div className="row row--between" style={{ fontSize: 12 }}>
                        <span className="truncate">
                          {c.chapterName} <span className="text-tertiary">· {c.subjectName}</span>
                        </span>
                        <span className="mono text-secondary">
                          {c.topicsLearned} learned · {c.topicsRevised} revised / {c.topicsTotal}
                        </span>
                      </div>
                      <Progress value={c.topicsLearned} max={Math.max(1, c.topicsTotal)} height={4} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-tertiary" style={{ fontSize: 12 }}>
                  No chapter progress yet.
                </p>
              )}
            </div>
          </div>

          {data.overrides.recent.length ? (
            <div>
              <p className="queue-label">Recent emergency overrides (revision gate)</p>
              <ul className="practice-list">
                {data.overrides.recent.map((o) => (
                  <li key={o.id}>
                    <strong>{o.date}</strong> {o.subjectName} — {o.reason}{' '}
                    <span className="text-tertiary">
                      · was {o.originalState.replace(/_/g, ' ')} · {o.obligations} revision(s) bypassed, still pending until completed
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

export { dateKey, chapterAccuracy, weekdayOf, Button }
