import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  GitBranch,
  GripVertical,
  Info,
  Layers,
  ListChecks,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  Trash2,
  TriangleAlert,
  Wand2
} from 'lucide-react'
import type { ScheduleSlot, Weekday } from '../types'
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal, Segmented, Select, Toggle } from '../components/ui'
import { draftScheduleOf, sameSlots, useStudy } from '../store/StudyStore'
import { ScheduleGovernancePanel } from '../components/ScheduleGovernance'
import { CarryoverBanner, LockedSessionModal, ObligationCard, RevisionBlockRows, RevisionWorkspace, SessionStateBadge } from '../components/revision'
import { usePlanToday } from '../components/PlanToday'
import { triggerStartSession } from '../components/sessions'
import { chaptersOf, subjectById } from '../store/selectors'
import { notifyPlanChanged, planApi, SESSION_TYPE_LABEL, type PlanSession, type PlanSessionType, type PlanRevisionPolicy, type SessionDependencies } from '../lib/plan'
import { errorMessage } from '../lib/http'
import { WEEKDAY_LONG, WEEKDAY_SHORT, formatDuration, formatTime, minutesFromTime, timeFromMinutes, weekdayOf } from '../lib/date'
import { cx, sum, uid } from '../lib/utils'

const DAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

const POLICY_LABEL: Record<PlanRevisionPolicy, string> = {
  previous_cycle: 'Revise the previous cycle first',
  all_previous_cycles: 'Revise all earlier cycles today first',
  none: 'No same-day revision'
}

interface DraftSlot {
  id?: string
  weekday: Weekday
  subjectId: string
  label: string
  sessionType: PlanSessionType
  cycleNumber: string // '' = automatic
  chapterId: string
  topicIds: string[]
  startTime: string
  endTime: string
  revisionPolicy: PlanRevisionPolicy
  revisionMinutes: string // '' = default
  prerequisiteSlotIds: string[]
  learningTarget: string
  practiceTarget: number
  reminderEnabled: boolean
  breakAfterMinutes: number
}

const emptyDraft = (weekday: Weekday, subjectId: string, startTime = '06:00'): DraftSlot => ({
  weekday,
  subjectId,
  label: 'Learning Session',
  sessionType: 'learning',
  cycleNumber: '',
  chapterId: '',
  topicIds: [],
  startTime,
  endTime: timeFromMinutes(minutesFromTime(startTime) + 60),
  revisionPolicy: 'previous_cycle',
  revisionMinutes: '',
  prerequisiteSlotIds: [],
  learningTarget: 'New concept build-up + practice set',
  practiceTarget: 15,
  reminderEnabled: true,
  breakAfterMinutes: 15
})

const typeOf = (s: ScheduleSlot): PlanSessionType => s.sessionType ?? 'learning'
const policyOf = (s: ScheduleSlot): PlanRevisionPolicy =>
  typeOf(s) !== 'learning' ? 'none' : (s.revisionPolicy ?? (s.requiresRevision ? 'previous_cycle' : 'none'))

/** Cycle number shown for a slot: explicit, or its ordinal among the subject's learning sessions that day. */
function cycleOf(slot: ScheduleSlot, daySlots: ScheduleSlot[]): number | null {
  if (typeOf(slot) !== 'learning') return slot.cycleNumber ?? null
  if (slot.cycleNumber) return slot.cycleNumber
  const same = daySlots
    .filter((s) => s.subjectId === slot.subjectId && typeOf(s) === 'learning')
    .sort((a, b) => minutesFromTime(a.startTime) - minutesFromTime(b.startTime))
  return same.findIndex((s) => s.id === slot.id) + 1
}

export default function SchedulePage() {
  const { state, today, addSlot, updateSlot, deleteSlot, moveSlot, duplicateSlot, copyDaySchedule, replaceDaySchedule, notify } = useStudy()
  const { day: planToday, loading: planLoading } = usePlanToday()
  const [params, setParams] = useSearchParams()
  const [weekday, setWeekday] = useState<Weekday>(() => weekdayOf(today) as Weekday)
  const [editing, setEditing] = useState<{ slot?: ScheduleSlot } | null>(null)
  const [deleting, setDeleting] = useState<ScheduleSlot | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTargets, setCopyTargets] = useState<Weekday[]>([])
  const [generateOpen, setGenerateOpen] = useState(false)
  const [insight, setInsight] = useState<{ slot: ScheduleSlot; mode: 'details' | 'dependencies' | 'revision' } | null>(null)
  const [reschedule, setReschedule] = useState<PlanSession | null>(null)
  const [locked, setLocked] = useState<PlanSession | null>(null)

  useEffect(() => {
    if (params.get('add') === '1') {
      setEditing({})
      params.delete('add')
      setParams(params, { replace: true })
    }
    if (params.get('day')) {
      setWeekday(Number(params.get('day')) as Weekday)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allDraft = draftScheduleOf(state)
  const slots = useMemo(
    () => allDraft.filter((s) => s.weekday === weekday).sort((a, b) => minutesFromTime(a.startTime) - minutesFromTime(b.startTime) || a.order - b.order),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.scheduleDraft, state.scheduleGovernance, state.schedule, weekday]
  )
  const publishedSlots = state.scheduleGovernance?.latestSlots ?? state.schedule

  /** Live server state only applies to the selected weekday when it is today. */
  const isTodayTab = weekdayOf(today) === weekday && planToday?.date === today
  const serverFor = (slotId: string) => (isTodayTab ? (planToday?.sessions.find((s) => s.slotId === slotId && s.persisted) ?? null) : null)

  const totalMinutes = sum(slots.map((s) => s.durationMinutes))
  const subjectCounts = useMemo(() => {
    const map = new Map<string, number>()
    slots.forEach((s) => map.set(s.subjectId, (map.get(s.subjectId) ?? 0) + 1))
    return map
  }, [slots])

  const overlaps = useMemo(() => {
    const problems: string[] = []
    for (let i = 1; i < slots.length; i += 1) {
      const prev = slots[i - 1]
      const cur = slots[i]
      if (minutesFromTime(cur.startTime) < minutesFromTime(prev.endTime)) {
        problems.push(`${prev.startTime}–${prev.endTime} overlaps ${cur.startTime}–${cur.endTime}`)
      }
    }
    return problems
  }, [slots])

  const isSunday = weekday === 0
  const nameOfSlot = (id: string) => {
    const s = allDraft.find((x) => x.id === id)
    return s ? `${subjectById(state, s.subjectId)?.shortName ?? 'Session'} ${s.startTime}` : 'removed session'
  }

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>My Schedule</h1>
          <p className="page-head__sub">
            Your week in <strong>study cycles</strong>: cycle 1 covers every subject, cycle 2 covers them again after a short revision. Edit, then publish to apply.
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" icon={<Wand2 size={14} />} onClick={() => setGenerateOpen(true)}>
            Generate cycles
          </Button>
          <Button
            variant="secondary"
            icon={<Copy size={14} />}
            onClick={() => {
              setCopyTargets([])
              setCopyOpen(true)
            }}
            disabled={!slots.length}
          >
            Copy this day
          </Button>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({})}>
            Add session
          </Button>
        </div>
      </div>

      <ScheduleGovernancePanel />
      <CarryoverBanner />

      <Card className="section" pad={false}>
        <div style={{ padding: 12 }}>
          <div className="day-tabs">
            {DAY_ORDER.map((d) => {
              const count = allDraft.filter((s) => s.weekday === d).length
              const isToday = weekdayOf(today) === d
              return (
                <button key={d} className={cx('day-tab', weekday === d && 'is-active', isToday && 'is-today')} onClick={() => setWeekday(d)}>
                  <span className="day-tab__name">{d === 0 ? 'Sunday' : WEEKDAY_SHORT[d]}</span>
                  <span className="day-tab__count">
                    {count} {count === 1 ? 'session' : 'sessions'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid--aside">
        <div className="stack">
          <Card>
            <CardHeader
              title={`${WEEKDAY_LONG[weekday]} schedule`}
              subtitle={`${slots.length} sessions · ${formatDuration(totalMinutes)} total${isSunday ? ' · weekly revision + mock test day' : ''}${
                isTodayTab ? ` · live status for today (v${planToday?.scheduleVersion ?? '—'})` : ''
              }`}
              icon={<CalendarDays size={15} />}
              actions={
                <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setEditing({})}>
                  Add
                </Button>
              }
            />

            {isTodayTab && planToday && !planToday.isStudyDay ? (
              <div className="callout callout--neutral" style={{ marginBottom: 12 }}>
                <Info size={14} />
                <span>Today is a {planToday.restReason?.toLowerCase() ?? 'rest day'} in your study calendar — no sessions run and carryover revision moves to the next study day.</span>
              </div>
            ) : null}

            {isTodayTab && planToday?.cycles.length ? (
              <div className="cycle-strip" style={{ marginBottom: 12 }}>
                {planToday.cycles.map((c) => (
                  <div key={c.cycleNumber} className="cycle-pill">
                    <strong>Cycle {c.cycleNumber}</strong>
                    <span className="text-secondary">
                      {c.completed}/{c.total} subjects done
                    </span>
                    <span className="text-tertiary">{c.status.replace('_', ' ')}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {isSunday ? (
              <div className="callout callout--info" style={{ marginBottom: 12 }}>
                <Info size={14} />
                <span>
                  Sunday is dedicated to <strong>weekly revision and chapter-wise mock tests</strong>, not new learning. Weekly revision obligations are tracked separately in Sunday
                  Review.
                </span>
              </div>
            ) : null}

            {overlaps.length ? (
              <div className="callout callout--warning" style={{ marginBottom: 12 }}>
                <TriangleAlert size={14} />
                <div>
                  <strong>
                    {overlaps.length} time overlap{overlaps.length === 1 ? '' : 's'} detected
                  </strong>
                  {overlaps.map((o) => (
                    <div key={o} style={{ fontSize: 11.5, marginTop: 2 }}>
                      {o}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {isTodayTab && planLoading && !planToday ? <LoadingBlock label="Loading today’s session status…" /> : null}

            {slots.length ? (
              <div className="stack" style={{ gap: 8 }}>
                {slots.map((slot, index) => {
                  const subject = subjectById(state, slot.subjectId)
                  const tone = subject ? `var(--s-${subject.tone === 'custom' ? 'math' : subject.tone})` : 'var(--border-strong)'
                  const server = serverFor(slot.id)
                  const published = publishedSlots.find((p) => p.id === slot.id)
                  const draftChanged = !published || !sameSlots([published], [slot])
                  const cycle = cycleOf(slot, slots)
                  const type = typeOf(slot)
                  const policy = policyOf(slot)
                  const chapter = slot.chapterId ? state.chapters.find((c) => c.id === slot.chapterId) : undefined
                  const topicNames = (slot.topicIds ?? []).map((id) => chapter?.topics.find((t) => t.id === id)?.name ?? state.chapters.flatMap((c) => c.topics).find((t) => t.id === id)?.name).filter(Boolean)
                  const terminal = server ? ['completed', 'skipped', 'missed'].includes(server.status) : false
                  return (
                    <Fragment key={slot.id}>
                    <RevisionBlockRows blocks={server?.revisionsBefore ?? []} />
                    <div className={cx('schedule-slot', server?.locked && 'is-locked', server?.status === 'completed' && 'is-done')}>
                      <div className="schedule-slot__time">
                        <span className="schedule-slot__start">{server?.startTime ?? slot.startTime}</span>
                        <span className="schedule-slot__end">to {server?.endTime ?? slot.endTime}</span>
                        <span className="schedule-slot__dur">{formatDuration(server?.plannedMinutes ?? slot.durationMinutes)}</span>
                      </div>
                      <span className="subject-dot" style={{ background: tone, marginTop: 6 }} />
                      <div className="schedule-slot__body">
                        <div className="row row--wrap" style={{ gap: 7, marginBottom: 3 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{subject?.name ?? 'Unknown subject'}</span>
                          {cycle ? (
                            <Badge tone="accent" size="sm">
                              Cycle {cycle}
                            </Badge>
                          ) : (
                            <span className="slot-number">#{slot.sessionNumber}</span>
                          )}
                          {type !== 'learning' ? (
                            <Badge tone={type === 'revision' ? 'warning' : type === 'mock_test' ? 'purple' : 'info'} size="sm">
                              {SESSION_TYPE_LABEL[type]}
                            </Badge>
                          ) : null}
                          {/* The label is shown only when it says something the badges do not. */}
                          {slot.label && !/^cycle \d+ · (learning|revision|practice|mock test)$/i.test(slot.label.trim()) && !/^(learning|revision) session$/i.test(slot.label.trim()) ? (
                            <span className="text-tertiary" style={{ fontSize: 11.5 }}>
                              {slot.label}
                            </span>
                          ) : null}
                          {server ? <SessionStateBadge state={server.state} /> : null}
                          {server?.locked ? (
                            <Badge tone="warning" size="sm">
                              <Lock size={10} /> locked
                            </Badge>
                          ) : null}
                          {isTodayTab && draftChanged ? (
                            <Badge tone="neutral" size="sm">
                              draft change — not live
                            </Badge>
                          ) : null}
                          {!slot.reminderEnabled ? (
                            <Badge tone="neutral" size="sm">
                              no reminder
                            </Badge>
                          ) : null}
                        </div>
                        {chapter || topicNames.length ? (
                          <p className="text-secondary" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                            <BookOpen size={11} style={{ verticalAlign: '-1px' }} /> {chapter?.name ?? 'Topics'}
                            {topicNames.length ? ` — ${topicNames.join(', ')}` : ''}
                          </p>
                        ) : null}
                        {slot.learningTarget ? (
                          <p className="text-secondary" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                            {slot.learningTarget}
                          </p>
                        ) : null}
                        <div className="slot-facts">
                          {type === 'learning' && policy !== 'none' && cycle === 1 ? (
                            <span>
                              <RotateCcw size={11} /> First cycle of the day — needs only the daily carryover
                            </span>
                          ) : type === 'learning' ? (
                            <span>
                              <RotateCcw size={11} /> {POLICY_LABEL[policy]}
                              {policy !== 'none' ? ` · ${slot.revisionMinutes ?? server?.revisionMinutes ?? 'default'}${slot.revisionMinutes || server ? ' min' : ''}` : ''}
                            </span>
                          ) : null}
                          {(slot.prerequisiteSlotIds ?? []).length ? (
                            <span>
                              <GitBranch size={11} /> after {(slot.prerequisiteSlotIds ?? []).map(nameOfSlot).join(', ')}
                            </span>
                          ) : null}
                          <span>{slot.practiceTarget} practice Qs</span>
                          <span>{slot.breakAfterMinutes}m break after</span>
                          {server?.completion ? (
                            <span className="text-success">
                              <CheckCircle2 size={11} /> {server.completion.topics.map((t) => `${t.topicName}${t.completion === 'partial' ? ' (partial)' : ''}`).join(', ') || 'completed'}
                            </span>
                          ) : null}
                        </div>
                        {server && server.revisionStatus !== 'not_required' ? (
                          <div className={cx('slot-lock', server.revisionStatus === 'completed' && 'is-ok', server.revisionStatus === 'bypassed' && 'is-bypassed')}>
                            {server.revisionStatus === 'completed' ? <CheckCircle2 size={12} /> : server.revisionStatus === 'bypassed' ? <ShieldAlert size={12} /> : <Lock size={12} />}
                            <span>
                              {server.revisionStatus === 'completed'
                                ? `Revision completed${server.previousTopics.length ? ` — ${server.previousTopics.join(', ')}` : ''}`
                                : server.revisionStatus === 'bypassed'
                                  ? `Started under an emergency override: ${server.override?.reason ?? ''}. The revision is still pending.`
                                  : server.lockReasons.map((r) => r.message).join(' ') || `Revise first: ${server.previousTopics.join(', ')}`}
                            </span>
                          </div>
                        ) : server?.locked ? (
                          <div className="slot-lock">
                            <Lock size={12} />
                            <span>{server.lockReasons.map((r) => r.message).join(' ')}</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="schedule-slot__actions">
                        <Button size="icon" variant="ghost" onClick={() => moveSlot(slot.id, -1)} disabled={index === 0} aria-label="Move up">
                          <ArrowUp size={13} />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => moveSlot(slot.id, 1)} disabled={index === slots.length - 1} aria-label="Move down">
                          <ArrowDown size={13} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ slot })}>
                          Edit
                        </Button>
                        <ActionMenu
                          items={[
                            server && !terminal && server.status !== 'in_progress'
                              ? {
                                  label: server.locked ? 'Start session (locked — see why)' : 'Start session',
                                  icon: server.locked ? <Lock size={13} /> : <Play size={13} />,
                                  onClick: () => (server.locked ? setLocked(server) : triggerStartSession(`${slot.id}::${server.date}`))
                                }
                              : null,
                            { label: 'View details', icon: <Eye size={13} />, onClick: () => setInsight({ slot, mode: 'details' }) },
                            { label: 'Edit session', icon: <Pencil size={13} />, onClick: () => setEditing({ slot }) },
                            {
                              label: 'Duplicate session',
                              icon: <Layers size={13} />,
                              onClick: () => {
                                duplicateSlot(slot.id)
                                notify({ title: 'Session duplicated', message: 'The copy is in your draft; publish to apply it.', variant: 'info' })
                              }
                            },
                            server && server.status === 'scheduled'
                              ? { label: 'Reschedule today only', icon: <CalendarClock size={13} />, onClick: () => setReschedule(server) }
                              : null,
                            'sep',
                            server ? { label: 'View dependencies', icon: <GitBranch size={13} />, onClick: () => setInsight({ slot, mode: 'dependencies' }) } : null,
                            { label: 'View revision requirements', icon: <ListChecks size={13} />, onClick: () => setInsight({ slot, mode: 'revision' }) },
                            server && ['scheduled', 'in_progress'].includes(server.status)
                              ? {
                                  label: 'Request skip',
                                  icon: <SkipForward size={13} />,
                                  onClick: () => window.dispatchEvent(new CustomEvent('studyos:open-skip', { detail: `${slot.id}::${server.date}` }))
                                }
                              : null,
                            server?.locked ? { label: 'Request exception (emergency override)', icon: <ShieldAlert size={13} />, onClick: () => setLocked(server) } : null,
                            'sep',
                            { label: 'Delete session', icon: <Trash2 size={13} />, danger: true, onClick: () => setDeleting(slot) }
                          ]}
                        />
                      </div>
                    </div>
                    </Fragment>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                icon={<CalendarDays size={20} />}
                title={`No sessions on ${WEEKDAY_LONG[weekday]}`}
                message="Add your first session, generate study cycles, or copy an existing day’s structure and adjust the subjects."
                action={
                  <div className="row" style={{ gap: 7 }}>
                    <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setEditing({})}>
                      Add session
                    </Button>
                    <Button size="sm" icon={<Wand2 size={13} />} onClick={() => setGenerateOpen(true)}>
                      Generate cycles
                    </Button>
                    <Button
                      size="sm"
                      icon={<Copy size={13} />}
                      onClick={() => {
                        setCopyTargets([])
                        setCopyOpen(true)
                      }}
                    >
                      Copy a day
                    </Button>
                  </div>
                }
              />
            )}
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Day summary" icon={<Clock size={15} />} />
            <div className="stack" style={{ gap: 11 }}>
              <div className="row row--between">
                <span className="text-secondary" style={{ fontSize: 12.5 }}>
                  Total planned
                </span>
                <strong className="mono">{formatDuration(totalMinutes)}</strong>
              </div>
              <div className="row row--between">
                <span className="text-secondary" style={{ fontSize: 12.5 }}>
                  Sessions
                </span>
                <strong className="mono">{slots.length}</strong>
              </div>
              <div className="row row--between">
                <span className="text-secondary" style={{ fontSize: 12.5 }}>
                  Study cycles
                </span>
                <strong className="mono">{Math.max(0, ...slots.map((s) => cycleOf(s, slots) ?? 0))}</strong>
              </div>
              {isTodayTab && planToday ? (
                <div className="row row--between">
                  <span className="text-secondary" style={{ fontSize: 12.5 }}>
                    Completed today
                  </span>
                  <strong className="mono">
                    {planToday.summary.completed}/{planToday.summary.sessions}
                  </strong>
                </div>
              ) : null}
              <div className="divider" style={{ margin: '2px 0' }} />
              {state.subjects.map((s) => {
                const count = subjectCounts.get(s.id) ?? 0
                const mins = sum(slots.filter((x) => x.subjectId === s.id).map((x) => x.durationMinutes))
                const tone = `var(--s-${s.tone === 'custom' ? 'math' : s.tone})`
                return (
                  <div key={s.id} className="row row--between" style={{ fontSize: 12.5 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="subject-dot" style={{ background: tone }} />
                      <span className="text-secondary">{s.shortName}</span>
                    </div>
                    <span className="mono">
                      {count} session{count === 1 ? '' : 's'} · {formatDuration(mins)}
                    </span>
                  </div>
                )
              })}
              {totalMinutes > 0 ? (
                <div className={cx('callout', totalMinutes > 600 ? 'callout--warning' : 'callout--neutral')} style={{ marginTop: 4 }}>
                  <Info size={13} />
                  <span style={{ fontSize: 11.5 }}>
                    {totalMinutes > 600
                      ? 'Over 10 hours planned. Sustainable for a full-time aspirant, brutal alongside college or work — consider trimming one session.'
                      : 'Leave 10–15 minutes between sessions. Retention drops sharply without consolidation gaps.'}
                  </span>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="How this works" icon={<Repeat size={15} />} />
            <div className="stack" style={{ gap: 9, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <p>
                <strong style={{ color: 'var(--text)' }}>Study cycles.</strong> One cycle is one round of your subjects. Cycle 2 of a subject stays locked until you revise
                what you completed in cycle 1 — Mathematics revision never unlocks Reasoning.
              </p>
              <p>
                <strong style={{ color: 'var(--text)' }}>Next day.</strong> Before each subject’s first session, you revise what you finished in that subject the
                previous day. Only that subject waits for it.
              </p>
              <p>
                <strong style={{ color: 'var(--text)' }}>Emergency override.</strong> Available with a written reason; it is recorded and the revision stays pending.
              </p>
              <p>
                <strong style={{ color: 'var(--text)' }}>Schedule changes never rewrite history</strong> — edits are a draft until published; completed sessions keep their
                original data.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <SlotEditor
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        weekday={weekday}
        slot={editing?.slot}
        onSave={(draft) => {
          const start = minutesFromTime(draft.startTime)
          const end = minutesFromTime(draft.endTime)
          if (end <= start) {
            notify({ title: 'Invalid time range', message: 'End time must be after start time.', variant: 'error' })
            return
          }
          const learning = draft.sessionType === 'learning'
          const revisionPolicy: PlanRevisionPolicy = learning ? draft.revisionPolicy : 'none'
          const fields = {
            weekday: draft.weekday,
            subjectId: draft.subjectId,
            label: draft.label,
            startTime: draft.startTime,
            endTime: draft.endTime,
            durationMinutes: end - start,
            requiresRevision: revisionPolicy !== 'none',
            learningTarget: draft.learningTarget,
            practiceTarget: draft.practiceTarget,
            reminderEnabled: draft.reminderEnabled,
            breakAfterMinutes: draft.breakAfterMinutes,
            sessionType: draft.sessionType,
            cycleNumber: draft.cycleNumber === '' ? null : Number(draft.cycleNumber),
            chapterId: draft.chapterId || null,
            topicIds: draft.topicIds,
            revisionMinutes: draft.revisionMinutes === '' ? null : Number(draft.revisionMinutes),
            revisionPolicy,
            // Dependencies only make sense on the same day.
            prerequisiteSlotIds: editing?.slot && editing.slot.weekday !== draft.weekday ? [] : draft.prerequisiteSlotIds
          }
          if (editing?.slot) {
            updateSlot(editing.slot.id, fields)
            notify({ title: 'Session updated', message: `${draft.label} saved to your draft for ${WEEKDAY_LONG[draft.weekday]}.` })
          } else {
            addSlot(fields)
            notify({ title: 'Session added', message: `${draft.label} added to your draft for ${WEEKDAY_LONG[draft.weekday]}.` })
          }
          if (draft.weekday !== weekday) setWeekday(draft.weekday)
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this session?"
        message="The deletion is a draft change until you publish. Completed session records and revision history are never deleted."
        confirmLabel="Delete session"
        onConfirm={() => {
          if (deleting) {
            deleteSlot(deleting.id)
            notify({ title: 'Session deleted', message: 'The slot was removed from your draft schedule.', variant: 'info' })
          }
          setDeleting(null)
        }}
      />

      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={`Copy ${WEEKDAY_LONG[weekday]} to other days`}
        subtitle="Existing sessions on the target days are replaced in your draft."
        footer={
          <>
            <Button onClick={() => setCopyOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!copyTargets.length}
              onClick={() => {
                copyDaySchedule(weekday, copyTargets)
                notify({
                  title: 'Schedule copied',
                  message: `${WEEKDAY_LONG[weekday]} copied to ${copyTargets.length} day${copyTargets.length === 1 ? '' : 's'}.`,
                  variant: 'success'
                })
                setCopyOpen(false)
              }}
            >
              Copy to {copyTargets.length || 0} day{copyTargets.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 8 }}>
          {DAY_ORDER.filter((d) => d !== weekday).map((d) => {
            const existing = allDraft.filter((s) => s.weekday === d).length
            const checked = copyTargets.includes(d)
            return (
              <label key={d} className="checklist__item" style={{ border: '1px solid var(--border)', borderRadius: 8, background: checked ? 'var(--accent-soft)' : 'var(--surface)' }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={checked}
                  onChange={(e) => setCopyTargets((prev) => (e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)))}
                />
                <span style={{ flex: 1 }}>
                  <span className="checklist__text" style={{ display: 'block', fontWeight: 550 }}>
                    {WEEKDAY_LONG[d]}
                  </span>
                  <span className="checklist__meta">{existing ? `${existing} session${existing === 1 ? '' : 's'} will be replaced` : 'currently empty'}</span>
                </span>
              </label>
            )
          })}
        </div>
      </Modal>

      <GenerateCyclesModal
        open={generateOpen}
        weekday={weekday}
        existing={slots.length}
        onClose={() => setGenerateOpen(false)}
        onApply={(generated) => {
          replaceDaySchedule(weekday, generated)
          notify({ title: 'Cycles generated', message: `${generated.length} sessions added to your ${WEEKDAY_LONG[weekday]} draft. Review and publish to apply.`, variant: 'success' })
          setGenerateOpen(false)
        }}
      />

      {insight ? <SessionInsightModal slot={insight.slot} mode={insight.mode} server={serverFor(insight.slot.id)} onClose={() => setInsight(null)} /> : null}
      {reschedule ? <RescheduleModal session={reschedule} onClose={() => setReschedule(null)} /> : null}
      <LockedSessionModal
        session={locked}
        onClose={() => setLocked(null)}
        onUnlocked={(s) => {
          setLocked(null)
          if (s.canStart) triggerStartSession(`${s.slotId}::${s.date}`)
        }}
      />
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Action menu                                                         */
/* ------------------------------------------------------------------ */

type MenuItem = { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean } | 'sep' | null

function ActionMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  /** Open upwards when the button is near the bottom of the screen. */
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const visible = items.filter(Boolean).filter((item, i, arr) => item !== 'sep' || (i > 0 && arr[i - 1] !== 'sep' && i < arr.length - 1)) as Exclude<MenuItem, null>[]
  return (
    <div className="action-menu" ref={ref}>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Session actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect()
          if (r) setUp(window.innerHeight - r.bottom < 340 && r.top > window.innerHeight - r.bottom)
          setOpen((o) => !o)
        }}
      >
        <MoreHorizontal size={14} />
      </Button>
      {open ? (
        <div className={cx('action-menu__list', up && 'is-up')} role="menu">
          {visible.map((item, i) =>
            item === 'sep' ? (
              <div key={`sep-${i}`} className="action-menu__sep" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={cx('action-menu__item', item.danger && 'is-danger')}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Details / dependencies / revision requirements                      */
/* ------------------------------------------------------------------ */

function SessionInsightModal({ slot, mode, server, onClose }: { slot: ScheduleSlot; mode: 'details' | 'dependencies' | 'revision'; server: PlanSession | null; onClose: () => void }) {
  const { state } = useStudy()
  const [deps, setDeps] = useState<SessionDependencies | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const subject = subjectById(state, slot.subjectId)
  const policy = policyOf(slot)

  useEffect(() => {
    if (!server?.id) return
    planApi
      .dependencies(server.id)
      .then(setDeps)
      .catch((err) => setError(errorMessage(err)))
  }, [server?.id, openId])

  const title = mode === 'details' ? 'Session details' : mode === 'dependencies' ? 'Dependencies' : 'Revision requirements'
  const prereqNames = (slot.prerequisiteSlotIds ?? []).map((id) => {
    const p = draftScheduleOf(state).find((s) => s.id === id)
    return p ? `${subjectById(state, p.subjectId)?.name ?? ''} · ${p.label} (${p.startTime})` : 'removed session'
  })

  return (
    <>
      <Modal open={!openId} onClose={onClose} size="lg" title={`${title} — ${subject?.name ?? ''}`} subtitle={`${WEEKDAY_LONG[slot.weekday]} ${formatTime(slot.startTime)}–${formatTime(slot.endTime)} · ${slot.label}`}>
        <div className="stack" style={{ gap: 12 }}>
          {error ? <div className="callout callout--danger">{error}</div> : null}
          {mode === 'details' ? (
            <ul className="plain-list">
              <li>
                <span>Session type</span>
                <strong>{SESSION_TYPE_LABEL[typeOf(slot)]}</strong>
              </li>
              <li>
                <span>Cycle</span>
                <strong>{slot.cycleNumber ?? server?.cycleNumber ?? 'automatic'}</strong>
              </li>
              <li>
                <span>Chapter / topics</span>
                <strong>
                  {state.chapters.find((c) => c.id === slot.chapterId)?.name ?? '—'}
                  {(slot.topicIds ?? []).length ? ` · ${(slot.topicIds ?? []).length} topic(s)` : ''}
                </strong>
              </li>
              <li>
                <span>Learning target</span>
                <strong>{slot.learningTarget || '—'}</strong>
              </li>
              <li>
                <span>Practice target</span>
                <strong>{slot.practiceTarget} questions</strong>
              </li>
              <li>
                <span>Revision policy</span>
                <strong>{POLICY_LABEL[policy]}</strong>
              </li>
              {server ? (
                <>
                  <li>
                    <span>Today’s status</span>
                    <SessionStateBadge state={server.state} />
                  </li>
                  {server.startedAt ? (
                    <li>
                      <span>Started</span>
                      <strong>{new Date(server.startedAt).toLocaleTimeString()}</strong>
                    </li>
                  ) : null}
                  {server.completion ? (
                    <li>
                      <span>Completed</span>
                      <strong>
                        {server.completion.topics.map((t) => `${t.topicName}${t.completion === 'partial' ? ' (partial)' : ''}`).join(', ')} · {formatDuration(server.actualMinutes ?? 0)} ·{' '}
                        {server.completion.questionsCorrect}/{server.completion.questionsAttempted} correct
                      </strong>
                    </li>
                  ) : null}
                  {server.skipReason ? (
                    <li>
                      <span>Skip reason</span>
                      <strong>{server.skipReason}</strong>
                    </li>
                  ) : null}
                  {server.rescheduledFrom ? (
                    <li>
                      <span>Rescheduled today</span>
                      <strong>
                        from {server.rescheduledFrom.startTime}–{server.rescheduledFrom.endTime}
                      </strong>
                    </li>
                  ) : null}
                  <li>
                    <span>Schedule version</span>
                    <strong>v{server.scheduleVersion}</strong>
                  </li>
                </>
              ) : (
                <li>
                  <span>Live status</span>
                  <strong className="text-tertiary">Shown for today’s published sessions only</strong>
                </li>
              )}
            </ul>
          ) : null}

          {mode === 'revision' ? (
            <div className="muted-box stack" style={{ gap: 6 }}>
              <span>
                <strong>Policy:</strong> {POLICY_LABEL[policy]}
                {policy !== 'none' ? ` · ${slot.revisionMinutes ?? server?.revisionMinutes ?? 'default'} minutes` : ''}
              </span>
              {typeOf(slot) === 'learning' ? (
                <span className="text-secondary" style={{ fontSize: 12 }}>
                  Every learning session also requires the Daily Carryover Revision (previous study day) to be complete before it starts.
                </span>
              ) : (
                <span className="text-secondary" style={{ fontSize: 12 }}>
                  {SESSION_TYPE_LABEL[typeOf(slot)]} sessions are not gated by revision.
                </span>
              )}
              {server?.previousTopics.length ? (
                <span>
                  <strong>Previous topics to revise:</strong> {server.previousTopics.join(', ')}
                </span>
              ) : null}
            </div>
          ) : null}

          {mode !== 'details' ? (
            server?.id ? (
              !deps ? (
                <LoadingBlock />
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {deps.lockReasons.length ? (
                    <ul className="lock-reasons">
                      {deps.lockReasons.map((r, i) => (
                        <li key={i}>
                          <Lock size={13} className="text-warning" />
                          <span>{r.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="callout callout--success">
                      <CheckCircle2 size={14} />
                      <span>No open dependencies — this session is not locked{deps.override ? ' (an emergency override was used)' : ''}.</span>
                    </div>
                  )}
                  <p className="queue-label">Required revisions ({deps.dependencies.revisions.length})</p>
                  {deps.dependencies.revisions.length ? (
                    <div className="rev-list">
                      {deps.dependencies.revisions.map((o) => (
                        <ObligationCard key={o.id} obligation={o} onOpen={(x) => setOpenId(x.id)} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-tertiary" style={{ fontSize: 12 }}>
                      None today.
                    </p>
                  )}
                  {mode === 'dependencies' ? (
                    <>
                      <p className="queue-label">Prerequisite sessions</p>
                      {deps.dependencies.prerequisites.length ? (
                        <ul className="plain-list">
                          {deps.dependencies.prerequisites.map((p) => (
                            <li key={p.id}>
                              <span>
                                {p.subjectName} · {p.label} ({p.startTime})
                              </span>
                              <Badge tone={p.satisfied ? 'success' : 'warning'} size="sm">
                                {p.satisfied ? 'completed' : p.status}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-tertiary" style={{ fontSize: 12 }}>
                          {prereqNames.length ? prereqNames.join(', ') : 'No explicit prerequisites configured.'}
                        </p>
                      )}
                      {deps.generatedObligations.length ? (
                        <>
                          <p className="queue-label">Revisions created from this session</p>
                          <div className="rev-list">
                            {deps.generatedObligations.map((o) => (
                              <ObligationCard key={o.id} obligation={o} compact onOpen={(x) => setOpenId(x.id)} />
                            ))}
                          </div>
                        </>
                      ) : null}
                      {deps.overrides.length ? (
                        <>
                          <p className="queue-label">Emergency overrides</p>
                          <ul className="plain-list">
                            {deps.overrides.map((o) => (
                              <li key={o.id}>
                                <span>
                                  {new Date(o.createdAt).toLocaleString()} — {o.reason}
                                </span>
                                <Badge tone="purple" size="sm">
                                  bypassed {o.obligationIds.length}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )
            ) : (
              <p className="text-tertiary" style={{ fontSize: 12 }}>
                {prereqNames.length ? `Prerequisites: ${prereqNames.join(', ')}. ` : ''}Live dependency status is available for today’s published sessions.
              </p>
            )
          ) : null}
        </div>
      </Modal>
      <RevisionWorkspace obligationId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function RescheduleModal({ session, onClose }: { session: PlanSession; onClose: () => void }) {
  const { notify } = useStudy()
  const [start, setStart] = useState(session.startTime)
  const [end, setEnd] = useState(session.endTime)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (minutesFromTime(end) <= minutesFromTime(start)) return setError('End time must be after start time.')
    setBusy(true)
    try {
      await planApi.rescheduleSession(session.id!, start, end)
      notifyPlanChanged()
      notify({ title: 'Rescheduled for today', message: 'Your published weekly schedule is unchanged.', variant: 'success' })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Reschedule ${session.subjectName} — today only`}
      subtitle="Moves only today’s session. Cycle order is kept; it does not use a schedule change."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save time
          </Button>
        </>
      }
    >
      <div className="grid grid--2" style={{ gap: 12 }}>
        <Field label="Start">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      {error ? <div className="callout callout--danger" style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Cycle generator                                                     */
/* ------------------------------------------------------------------ */

function GenerateCyclesModal({ open, weekday, existing, onClose, onApply }: { open: boolean; weekday: Weekday; existing: number; onClose: () => void; onApply: (slots: ScheduleSlot[]) => void }) {
  const { state } = useStudy()
  const [startTime, setStartTime] = useState('06:00')
  const [cycles, setCycles] = useState('2')
  const [minutes, setMinutes] = useState('60')
  const [gap, setGap] = useState('10')
  const [subjectIds, setSubjectIds] = useState<string[]>([])
  const [preview, setPreview] = useState<ScheduleSlot[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setPreview(null)
    setError('')
    setSubjectIds(state.subjects.map((s) => s.id))
  }, [open, state.subjects])

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await planApi.cycleTemplate({
        weekday,
        startTime,
        cyclesPerDay: Number(cycles) || undefined,
        sessionMinutes: Number(minutes) || undefined,
        breakMinutes: gap === '' ? undefined : Number(gap),
        subjectIds
      })
      setPreview(r.slots.map((s) => ({ ...(s as unknown as ScheduleSlot), id: uid('slot') })))
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
      size="lg"
      title={`Generate study cycles — ${WEEKDAY_LONG[weekday]}`}
      subtitle="One cycle = one round of the subjects below, in order. Nothing is saved until you apply it to the draft and publish."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {preview ? (
            <Button variant="primary" onClick={() => onApply(preview)}>
              Replace {WEEKDAY_LONG[weekday]} in draft ({preview.length} sessions)
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={!subjectIds.length} onClick={generate}>
              Preview
            </Button>
          )}
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="grid grid--4" style={{ gap: 10 }}>
          <Field label="First session starts">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="Cycles per day">
            <Input type="number" min={1} max={8} value={cycles} onChange={(e) => setCycles(e.target.value)} />
          </Field>
          <Field label="Minutes per session">
            <Input type="number" min={10} max={300} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          <Field label="Break (min)">
            <Input type="number" min={0} max={120} value={gap} onChange={(e) => setGap(e.target.value)} />
          </Field>
        </div>
        <Field label="Subjects in each cycle (in order)" hint="Order follows your subject list; configure the default order in Settings › Study cycle preferences.">
          <div className="pill-row">
            {state.subjects.map((s) => (
              <button
                key={s.id}
                type="button"
                className={cx('chip-filter', subjectIds.includes(s.id) && 'is-active')}
                onClick={() => {
                  setPreview(null)
                  setSubjectIds((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </Field>
        {existing ? (
          <div className="callout callout--warning">
            <TriangleAlert size={14} />
            <span>The {existing} existing session(s) on {WEEKDAY_LONG[weekday]} will be replaced in your draft.</span>
          </div>
        ) : null}
        {error ? <div className="callout callout--danger">{error}</div> : null}
        {preview ? (
          <ul className="diff-list">
            {preview.map((s) => (
              <li key={s.id}>
                <span className="mono">
                  {s.startTime}–{s.endTime}
                </span>{' '}
                Cycle {s.cycleNumber} · {subjectById(state, s.subjectId)?.name}{' '}
                <span className="text-tertiary">· {s.revisionPolicy === 'none' ? 'no same-day revision' : 'revise previous cycle first'}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Add / edit session                                                  */
/* ------------------------------------------------------------------ */

function SlotEditor({ open, onClose, weekday, slot, onSave }: { open: boolean; onClose: () => void; weekday: Weekday; slot?: ScheduleSlot; onSave: (draft: DraftSlot) => void }) {
  const { state } = useStudy()
  const [draft, setDraft] = useState<DraftSlot>(() => emptyDraft(weekday, state.subjects[0]?.id ?? ''))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    if (slot) {
      setDraft({
        id: slot.id,
        weekday: slot.weekday,
        subjectId: slot.subjectId,
        label: slot.label,
        sessionType: typeOf(slot),
        cycleNumber: slot.cycleNumber ? String(slot.cycleNumber) : '',
        chapterId: slot.chapterId ?? '',
        topicIds: slot.topicIds ?? [],
        startTime: slot.startTime,
        endTime: slot.endTime,
        revisionPolicy: policyOf(slot),
        revisionMinutes: slot.revisionMinutes ? String(slot.revisionMinutes) : '',
        prerequisiteSlotIds: slot.prerequisiteSlotIds ?? [],
        learningTarget: slot.learningTarget,
        practiceTarget: slot.practiceTarget,
        reminderEnabled: slot.reminderEnabled,
        breakAfterMinutes: slot.breakAfterMinutes
      })
    } else {
      const daySlots = draftScheduleOf(state).filter((s) => s.weekday === weekday)
      const last = [...daySlots].sort((a, b) => minutesFromTime(b.endTime) - minutesFromTime(a.endTime))[0]
      const start = last ? timeFromMinutes(minutesFromTime(last.endTime) + (last.breakAfterMinutes || 15)) : '06:00'
      const subjectId = state.subjects[0]?.id ?? ''
      const earlier = daySlots.filter((s) => s.subjectId === subjectId && typeOf(s) === 'learning').length
      setDraft({ ...emptyDraft(weekday, subjectId, start), revisionPolicy: earlier ? 'previous_cycle' : 'none' })
    }
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slot, weekday])

  const duration = minutesFromTime(draft.endTime) - minutesFromTime(draft.startTime)
  const chapters = chaptersOf(state, draft.subjectId)
  const chapter = chapters.find((c) => c.id === draft.chapterId)
  const topics = chapter ? chapter.topics : []
  const sameDay = draftScheduleOf(state).filter((s) => s.weekday === draft.weekday && s.id !== draft.id)
  const prereqCandidates = sameDay.filter((s) => minutesFromTime(s.startTime) < minutesFromTime(draft.startTime))
  const learning = draft.sessionType === 'learning'

  const shiftEnd = (newStart: string) => {
    const s = minutesFromTime(newStart)
    setDraft((d) => ({ ...d, startTime: newStart, endTime: timeFromMinutes(s + Math.max(30, duration || 60)) }))
  }

  const submit = () => {
    if (!draft.subjectId) return setError('Choose a subject first.')
    if (minutesFromTime(draft.endTime) <= minutesFromTime(draft.startTime)) return setError('End time must be after the start time.')
    if (!draft.label.trim()) return setError('Give the session a short label.')
    if (draft.cycleNumber !== '' && (!Number.isInteger(Number(draft.cycleNumber)) || Number(draft.cycleNumber) < 1 || Number(draft.cycleNumber) > 20))
      return setError('Cycle number must be a whole number from 1 to 20 (or blank for automatic).')
    if (draft.revisionMinutes !== '' && (!Number.isInteger(Number(draft.revisionMinutes)) || Number(draft.revisionMinutes) < 1 || Number(draft.revisionMinutes) > 180))
      return setError('Revision duration must be 1–180 minutes (or blank for your default).')
    if (draft.practiceTarget < 0 || draft.practiceTarget > 1000) return setError('Practice target must be between 0 and 1000.')
    const invalidPrereq = draft.prerequisiteSlotIds.find((id) => !prereqCandidates.some((s) => s.id === id))
    if (invalidPrereq) return setError('A prerequisite must be an earlier session on the same day.')
    if (learning && draft.cycleNumber !== '') {
      const clash = sameDay.find(
        (s) =>
          s.subjectId === draft.subjectId &&
          typeOf(s) === 'learning' &&
          s.cycleNumber &&
          (minutesFromTime(s.startTime) < minutesFromTime(draft.startTime) ? s.cycleNumber >= Number(draft.cycleNumber) : s.cycleNumber <= Number(draft.cycleNumber))
      )
      if (clash) return setError(`Cycle ${draft.cycleNumber} conflicts with cycle ${clash.cycleNumber} of this subject at ${clash.startTime} — cycles must run in time order.`)
    }
    onSave(draft)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={slot ? 'Edit session' : `Add session — ${WEEKDAY_LONG[weekday]}`}
      subtitle="Saved as a draft until you publish. Revisions are added automatically from what you finish."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {slot ? 'Save changes' : 'Add session'}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 13 }}>
        {error ? (
          <div className="callout callout--danger">
            <TriangleAlert size={14} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="grid grid--3" style={{ gap: 12 }}>
          <Field label="Subject" required>
            <Select value={draft.subjectId} onChange={(e) => setDraft({ ...draft, subjectId: e.target.value, chapterId: '', topicIds: [] })}>
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Session type" required>
            <Select value={draft.sessionType} onChange={(e) => setDraft({ ...draft, sessionType: e.target.value as PlanSessionType })}>
              {(Object.keys(SESSION_TYPE_LABEL) as PlanSessionType[]).map((t) => (
                <option key={t} value={t}>
                  {SESSION_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Session label" required hint="e.g. Morning Learning Session">
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Learning Session" />
          </Field>
        </div>

        <div className="grid grid--2" style={{ gap: 12 }}>
          <Field label="Chapter" hint="From your Subjects & Chapters">
            <Select value={draft.chapterId} onChange={(e) => setDraft({ ...draft, chapterId: e.target.value, topicIds: [] })}>
              <option value="">Choose when you study</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cycle number" hint="Blank = automatic (order of this subject’s sessions that day)">
            <Input type="number" min={1} max={20} value={draft.cycleNumber} onChange={(e) => setDraft({ ...draft, cycleNumber: e.target.value })} placeholder="auto" disabled={!learning} />
          </Field>
        </div>

        {topics.length ? (
          <Field label="Planned topics (optional)">
            <div className="pill-row">
              {topics.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={cx('chip-filter', draft.topicIds.includes(t.id) && 'is-active')}
                  onClick={() => setDraft((d) => ({ ...d, topicIds: d.topicIds.includes(t.id) ? d.topicIds.filter((x) => x !== t.id) : [...d.topicIds, t.id] }))}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </Field>
        ) : null}

        <div className="grid grid--4" style={{ gap: 12 }}>
          <Field label="Day">
            <Select value={String(draft.weekday)} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) as Weekday, prerequisiteSlotIds: [] })}>
              {DAY_ORDER.map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_LONG[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start time">
            <Input type="time" value={draft.startTime} onChange={(e) => shiftEnd(e.target.value)} />
          </Field>
          <Field label="End time">
            <Input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
          </Field>
          <Field label="Duration" hint={duration > 0 ? formatDuration(duration) : 'Invalid range'}>
            <Input value={duration > 0 ? `${duration} min` : '—'} readOnly disabled />
          </Field>
        </div>

        <Field label="Learning target" hint="What exactly should be completed in this block?">
          <Input value={draft.learningTarget} onChange={(e) => setDraft({ ...draft, learningTarget: e.target.value })} placeholder="New chapter concept + 20 solved examples" />
        </Field>

        <div className="grid grid--3" style={{ gap: 12 }}>
          <Field label="Practice target (questions)">
            <Input type="number" min={0} max={1000} value={draft.practiceTarget} onChange={(e) => setDraft({ ...draft, practiceTarget: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Revision duration (min)" hint="Blank = subject / default setting">
            <Input type="number" min={1} max={180} value={draft.revisionMinutes} placeholder="default" disabled={!learning || draft.revisionPolicy === 'none'} onChange={(e) => setDraft({ ...draft, revisionMinutes: e.target.value })} />
          </Field>
          <Field label="Break after (minutes)">
            <Input type="number" min={0} max={120} value={draft.breakAfterMinutes} onChange={(e) => setDraft({ ...draft, breakAfterMinutes: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
        </div>

        {learning ? (
          <Field label="Revision policy" hint="Server-enforced: the session cannot start until this revision is completed">
            <Select value={draft.revisionPolicy} onChange={(e) => setDraft({ ...draft, revisionPolicy: e.target.value as PlanRevisionPolicy })}>
              {(Object.keys(POLICY_LABEL) as PlanRevisionPolicy[]).map((p) => (
                <option key={p} value={p}>
                  {POLICY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Prerequisites" hint="Earlier sessions on the same day that must be completed first">
          {prereqCandidates.length ? (
            <div className="pill-row">
              {prereqCandidates.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cx('chip-filter', draft.prerequisiteSlotIds.includes(s.id) && 'is-active')}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      prerequisiteSlotIds: d.prerequisiteSlotIds.includes(s.id) ? d.prerequisiteSlotIds.filter((x) => x !== s.id) : [...d.prerequisiteSlotIds, s.id]
                    }))
                  }
                >
                  {subjectById(state, s.subjectId)?.shortName ?? 'Session'} {s.startTime}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-tertiary" style={{ fontSize: 12 }}>
              No earlier sessions on this day.
            </p>
          )}
        </Field>

        <div className="muted-box stack" style={{ gap: 0 }}>
          <Toggle
            checked={draft.reminderEnabled}
            onChange={(v) => setDraft({ ...draft, reminderEnabled: v })}
            label="Send accountability reminder"
            description="Foreground alert + looping sound when the session end time passes without an update."
          />
        </div>

        <div className="callout callout--neutral">
          <Info size={13} />
          <span style={{ fontSize: 11.5 }}>
            Every learning session also waits for the Daily Carryover Revision of the previous study day. Same-day revision only uses topics you fully completed.
          </span>
        </div>
      </div>
    </Modal>
  )
}

export { uid, GripVertical, ChevronDown, RotateCcw, Segmented }
