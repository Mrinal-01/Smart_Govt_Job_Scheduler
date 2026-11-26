import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarRange, CheckCircle2, CircleSlash, Clock, Filter, History, Play, Timer } from 'lucide-react'
import type { SessionStatus } from '../types'
import { Badge, Button, Card, CardHeader, EmptyState, Progress, Segmented } from '../components/ui'
import { SessionCard, openCompletion, triggerStartSession } from '../components/sessions'
import { useStudy } from '../store/StudyStore'
import { sessionViewsForDate } from '../store/selectors'
import { addDays, formatDuration, formatShortDate, formatTime, weekdayOf } from '../lib/date'
import { cx, sum } from '../lib/utils'
import { WEEKDAY_SHORT } from '../lib/date'

type Range = 'today' | 'yesterday' | 'tomorrow' | 'week'
type FilterKey = 'all' | 'open' | 'completed' | 'missed'

export default function SessionsPage() {
  const { state, today } = useStudy()
  const navigate = useNavigate()
  const [range, setRange] = useState<Range>('today')
  const [filter, setFilter] = useState<FilterKey>('all')

  const dates = useMemo(() => {
    if (range === 'today') return [today]
    if (range === 'yesterday') return [addDays(today, -1)]
    if (range === 'tomorrow') return [addDays(today, 1)]
    return Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i))
  }, [range, today])

  const allViews = useMemo(() => dates.flatMap((d) => sessionViewsForDate(state, d)), [dates, state])

  const views = useMemo(() => {
    if (filter === 'all') return allViews
    if (filter === 'completed') return allViews.filter((v) => v.record.status === 'completed')
    if (filter === 'missed')
      return allViews.filter((v) => ['skipped', 'overdue', 'awaiting-completion'].includes(v.record.status))
    return allViews.filter((v) => !['completed', 'skipped'].includes(v.record.status))
  }, [allViews, filter])

  const counts = {
    all: allViews.length,
    open: allViews.filter((v) => !['completed', 'skipped'].includes(v.record.status)).length,
    completed: allViews.filter((v) => v.record.status === 'completed').length,
    missed: allViews.filter((v) => ['skipped', 'overdue', 'awaiting-completion'].includes(v.record.status)).length
  }

  const planned = sum(allViews.map((v) => v.slot.durationMinutes))
  const actual = sum(allViews.map((v) => v.record.completion?.durationMinutes ?? 0))
  const overdueCount = allViews.filter((v) => v.overdueMinutes > 0).length

  const grouped = useMemo(() => {
    const map = new Map<string, typeof views>()
    views.forEach((v) => {
      if (!map.has(v.record.date)) map.set(v.record.date, [])
      map.get(v.record.date)!.push(v)
    })
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [views])

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Study Sessions</h1>
          <p className="page-head__sub">
            Every session from your schedule with its live status. Start a session to open the revision gate, then log completion to update
            progress, revision history and analytics.
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" icon={<CalendarRange size={14} />} onClick={() => navigate('/schedule')}>
            Manage schedule
          </Button>
          <Button
            variant="primary"
            icon={<Play size={14} />}
            disabled={!allViews.some((v) => ['upcoming', 'revision-pending'].includes(v.record.status))}
            onClick={() => {
              const next = allViews.find((v) => ['upcoming', 'revision-pending'].includes(v.record.status))
              if (next) triggerStartSession(next.key)
            }}
          >
            Start next session
          </Button>
        </div>
      </div>

      <div className="grid grid--4 section" style={{ gap: 11 }}>
        <Card pad={false} className="stat">
          <div style={{ padding: '13px 14px' }}>
            <div className="stat__top">
              <span className="stat__label">Planned</span>
              <span className="stat__icon">
                <Clock size={13} />
              </span>
            </div>
            <div className="stat__value mono">{formatDuration(planned)}</div>
            <div className="stat__hint">{allViews.length} sessions in view</div>
          </div>
        </Card>
        <Card pad={false} className="stat">
          <div style={{ padding: '13px 14px' }}>
            <div className="stat__top">
              <span className="stat__label">Logged</span>
              <span className="stat__icon">
                <Timer size={13} />
              </span>
            </div>
            <div className="stat__value mono">{formatDuration(actual)}</div>
            <div className="stat__hint">{Math.round((actual / Math.max(1, planned)) * 100)}% of planned</div>
          </div>
        </Card>
        <Card pad={false} className="stat stat--success">
          <div style={{ padding: '13px 14px' }}>
            <div className="stat__top">
              <span className="stat__label">Completed</span>
              <span className="stat__icon">
                <CheckCircle2 size={13} />
              </span>
            </div>
            <div className="stat__value mono">{counts.completed}</div>
            <div className="stat__hint">{counts.open} still open</div>
          </div>
        </Card>
        <Card pad={false} className={cx('stat', overdueCount ? 'stat--danger' : 'stat--neutral')}>
          <div style={{ padding: '13px 14px' }}>
            <div className="stat__top">
              <span className="stat__label">Overdue</span>
              <span className="stat__icon">
                <AlertTriangle size={13} />
              </span>
            </div>
            <div className="stat__value mono">{overdueCount}</div>
            <div className="stat__hint">{counts.missed} missed / skipped</div>
          </div>
        </Card>
      </div>

      <Card className="section">
        <div className="row row--between row--wrap" style={{ gap: 10, marginBottom: 14 }}>
          <Segmented
            value={range}
            onChange={(v) => setRange(v as Range)}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: 'Yesterday' },
              { value: 'tomorrow', label: 'Tomorrow' },
              { value: 'week', label: 'Last 7 days' }
            ]}
          />
          <div className="row" style={{ gap: 6 }}>
            <Filter size={13} className="text-tertiary" />
            {(['all', 'open', 'completed', 'missed'] as FilterKey[]).map((f) => (
              <button key={f} className={cx('chip-filter', filter === f && 'is-active')} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'open' ? 'Open' : f === 'completed' ? 'Completed' : 'Missed'}
                <span className="chip-filter__count">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        {grouped.length ? (
          <div className="stack" style={{ gap: 18 }}>
            {grouped.map(([date, dayViews]) => {
              const dayCompleted = dayViews.filter((v) => v.record.status === 'completed').length
              const dayPlanned = sum(dayViews.map((v) => v.slot.durationMinutes))
              return (
                <div key={date}>
                  <div className="row row--between" style={{ marginBottom: 8 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {date === today ? 'Today' : `${WEEKDAY_SHORT[weekdayOf(date)]}, ${formatShortDate(date)}`}
                      </span>
                      <Badge tone="neutral" size="sm">
                        {dayCompleted}/{dayViews.length} done
                      </Badge>
                    </div>
                    <span className="text-tertiary mono" style={{ fontSize: 11 }}>
                      {formatDuration(dayPlanned)}
                    </span>
                  </div>
                  <Progress value={dayCompleted} max={Math.max(1, dayViews.length)} tone="success" height={3} />
                  <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                    {dayViews.map((v) => (
                      <SessionCard
                        key={v.key}
                        view={v}
                        onStart={triggerStartSession}
                        onComplete={openCompletion}
                        onSkip={(key) => window.dispatchEvent(new CustomEvent('studyos:open-skip', { detail: key }))}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={<History size={20} />}
            title="No sessions match this view"
            message="Try a different date range or filter. Sessions appear here from your weekly schedule."
            action={
              <Button size="sm" variant="primary" onClick={() => navigate('/schedule')}>
                Open schedule
              </Button>
            }
          />
        )}
      </Card>
    </main>
  )
}

export { CircleSlash, formatTime, formatDuration }
