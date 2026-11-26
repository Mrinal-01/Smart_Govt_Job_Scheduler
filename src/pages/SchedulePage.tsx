import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Clock,
  Copy,
  GripVertical,
  Info,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { ScheduleSlot, Weekday } from '../types'
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, Segmented, Select, Toggle } from '../components/ui'
import { draftScheduleOf, useStudy } from '../store/StudyStore'
import { ScheduleGovernancePanel } from '../components/ScheduleGovernance'
import { subjectById } from '../store/selectors'
import { WEEKDAY_LONG, WEEKDAY_SHORT, formatDuration, formatTime, minutesFromTime, timeFromMinutes, weekdayOf } from '../lib/date'
import { cx, sum, uid } from '../lib/utils'

const DAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

interface DraftSlot {
  id?: string
  subjectId: string
  label: string
  startTime: string
  endTime: string
  requiresRevision: boolean
  learningTarget: string
  practiceTarget: number
  reminderEnabled: boolean
  breakAfterMinutes: number
}

const emptyDraft = (subjectId: string, startTime = '06:00'): DraftSlot => ({
  subjectId,
  label: 'Learning Session',
  startTime,
  endTime: timeFromMinutes(minutesFromTime(startTime) + 60),
  requiresRevision: true,
  learningTarget: 'New concept build-up + practice set',
  practiceTarget: 15,
  reminderEnabled: true,
  breakAfterMinutes: 15
})

export default function SchedulePage() {
  const { state, today, addSlot, updateSlot, deleteSlot, moveSlot, copyDaySchedule, notify } = useStudy()
  const [params, setParams] = useSearchParams()
  const [weekday, setWeekday] = useState<Weekday>(() => weekdayOf(today) as Weekday)
  const [editing, setEditing] = useState<{ slot?: ScheduleSlot } | null>(null)
  const [deleting, setDeleting] = useState<ScheduleSlot | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTargets, setCopyTargets] = useState<Weekday[]>([])

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

  const slots = useMemo(
    () =>
      draftScheduleOf(state)
        .filter((s) => s.weekday === weekday)
        .sort((a, b) => minutesFromTime(a.startTime) - minutesFromTime(b.startTime) || a.order - b.order),
    [state.scheduleDraft, state.scheduleGovernance, state.schedule, weekday]
  )

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

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>My Schedule</h1>
          <p className="page-head__sub">
            Build a Monday–Sunday routine where a subject can appear in <strong>multiple sessions per day</strong>. Every session carries its own
            revision requirement, learning target and practice target.
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" icon={<Copy size={14} />} onClick={() => { setCopyTargets([]); setCopyOpen(true) }} disabled={!slots.length}>
            Copy this day
          </Button>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({})}>
            Add session
          </Button>
        </div>
      </div>

      <ScheduleGovernancePanel />

      <Card className="section" pad={false}>
        <div style={{ padding: 12 }}>
          <div className="day-tabs">
            {DAY_ORDER.map((d) => {
              const count = draftScheduleOf(state).filter((s) => s.weekday === d).length
              const isToday = weekdayOf(today) === d
              return (
                <button
                  key={d}
                  className={cx('day-tab', weekday === d && 'is-active', isToday && 'is-today')}
                  onClick={() => setWeekday(d)}
                >
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
              subtitle={`${slots.length} sessions · ${formatDuration(totalMinutes)} total${isSunday ? ' · weekly revision + mock test day' : ''}`}
              icon={<CalendarDays size={15} />}
              actions={
                <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setEditing({})}>
                  Add
                </Button>
              }
            />

            {isSunday ? (
              <div className="callout callout--info" style={{ marginBottom: 12 }}>
                <Info size={14} />
                <span>
                  Sunday is dedicated to <strong>weekly revision and chapter-wise mock tests</strong>, not new learning. Revision-flagged sessions
                  pull the week’s topics automatically.
                </span>
              </div>
            ) : null}

            {overlaps.length ? (
              <div className="callout callout--warning" style={{ marginBottom: 12 }}>
                <TriangleAlert size={14} />
                <div>
                  <strong>{overlaps.length} time overlap{overlaps.length === 1 ? '' : 's'} detected</strong>
                  {overlaps.map((o) => (
                    <div key={o} style={{ fontSize: 11.5, marginTop: 2 }}>
                      {o}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {slots.length ? (
              <div className="stack" style={{ gap: 8 }}>
                {slots.map((slot, index) => {
                  const subject = subjectById(state, slot.subjectId)
                  const tone = subject ? `var(--s-${subject.tone === 'custom' ? 'math' : subject.tone})` : 'var(--border-strong)'
                  const sessionsOfSubject = slots.filter((s) => s.subjectId === slot.subjectId).length
                  return (
                    <div className="schedule-slot" key={slot.id}>
                      <div className="schedule-slot__time">
                        <span className="schedule-slot__start">{slot.startTime}</span>
                        <span className="schedule-slot__end">to {slot.endTime}</span>
                        <span className="schedule-slot__dur">{formatDuration(slot.durationMinutes)}</span>
                      </div>
                      <span className="subject-dot" style={{ background: tone, marginTop: 6 }} />
                      <div className="schedule-slot__body">
                        <div className="row row--wrap" style={{ gap: 7, marginBottom: 3 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{subject?.name ?? 'Unknown subject'}</span>
                          <span className="slot-number">#{slot.sessionNumber}</span>
                          <span className="text-tertiary" style={{ fontSize: 11.5 }}>
                            {slot.label}
                          </span>
                          {sessionsOfSubject > 1 ? <Badge tone="neutral" size="sm">{sessionsOfSubject}× today</Badge> : null}
                          {slot.requiresRevision ? (
                            <Badge tone="warning" size="sm">
                              revision
                            </Badge>
                          ) : null}
                          {!slot.reminderEnabled ? (
                            <Badge tone="neutral" size="sm">
                              no reminder
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-secondary" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                          {slot.learningTarget}
                        </p>
                        <div className="row" style={{ gap: 10, marginTop: 4, fontSize: 11 }}>
                          <span className="text-tertiary">{slot.practiceTarget} practice Qs</span>
                          <span className="text-tertiary">· {slot.breakAfterMinutes}m break after</span>
                        </div>
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
                        <Button size="icon" variant="ghost" onClick={() => setDeleting(slot)} aria-label="Delete session">
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                icon={<CalendarDays size={20} />}
                title={`No sessions on ${WEEKDAY_LONG[weekday]}`}
                message="Add your first session, or copy an existing day’s structure and adjust the subjects."
                action={
                  <div className="row" style={{ gap: 7 }}>
                    <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setEditing({})}>
                      Add session
                    </Button>
                    <Button size="sm" icon={<Copy size={13} />} onClick={() => { setCopyTargets([]); setCopyOpen(true) }}>
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
                      {count}× · {formatDuration(mins)}
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
                <strong style={{ color: 'var(--text)' }}>Multiple sessions per subject</strong> are supported — Mathematics appears as a morning
                learning block and an evening practice block.
              </p>
              <p>
                <strong style={{ color: 'var(--text)' }}>Revision-flagged sessions</strong> open the Revision Preparation Panel first, pulling the
                previous session’s topics for that subject.
              </p>
              <p>
                <strong style={{ color: 'var(--text)' }}>Copy a day</strong> to reuse a template across weekdays, then tweak individual slots.
              </p>
              <p>
                <strong style={{ color: 'var(--text)' }}>Schedule changes never rewrite history</strong> — completed sessions keep their original
                date and subject.
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
          const duration = end - start
          if (editing?.slot) {
            updateSlot(editing.slot.id, {
              subjectId: draft.subjectId,
              label: draft.label,
              startTime: draft.startTime,
              endTime: draft.endTime,
              durationMinutes: duration,
              requiresRevision: draft.requiresRevision,
              learningTarget: draft.learningTarget,
              practiceTarget: draft.practiceTarget,
              reminderEnabled: draft.reminderEnabled,
              breakAfterMinutes: draft.breakAfterMinutes
            })
            notify({ title: 'Session updated', message: `${draft.label} saved for ${WEEKDAY_LONG[weekday]}.` })
          } else {
            addSlot({
              weekday,
              subjectId: draft.subjectId,
              label: draft.label,
              startTime: draft.startTime,
              endTime: draft.endTime,
              durationMinutes: duration,
              requiresRevision: draft.requiresRevision,
              learningTarget: draft.learningTarget,
              practiceTarget: draft.practiceTarget,
              reminderEnabled: draft.reminderEnabled,
              breakAfterMinutes: draft.breakAfterMinutes
            })
            notify({ title: 'Session added', message: `${draft.label} added to ${WEEKDAY_LONG[weekday]}.` })
          }
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this session?"
        message="Today's session record for this slot is retained in history, but it will no longer appear in future schedules."
        confirmLabel="Delete session"
        onConfirm={() => {
          if (deleting) {
            deleteSlot(deleting.id)
            notify({ title: 'Session deleted', message: 'The slot was removed from the weekly schedule.', variant: 'info' })
          }
          setDeleting(null)
        }}
      />

      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={`Copy ${WEEKDAY_LONG[weekday]} to other days`}
        subtitle="Existing sessions on the target days are replaced."
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
            const existing = draftScheduleOf(state).filter((s) => s.weekday === d).length
            const checked = copyTargets.includes(d)
            return (
              <label
                key={d}
                className="checklist__item"
                style={{ border: '1px solid var(--border)', borderRadius: 8, background: checked ? 'var(--accent-soft)' : 'var(--surface)' }}
              >
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
                  <span className="checklist__meta">
                    {existing ? `${existing} session${existing === 1 ? '' : 's'} will be replaced` : 'currently empty'}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </Modal>
    </main>
  )
}

/* ------------------------------------------------------------------ */

function SlotEditor({
  open,
  onClose,
  weekday,
  slot,
  onSave
}: {
  open: boolean
  onClose: () => void
  weekday: Weekday
  slot?: ScheduleSlot
  onSave: (draft: DraftSlot) => void
}) {
  const { state } = useStudy()
  const [draft, setDraft] = useState<DraftSlot>(() => emptyDraft(state.subjects[0]?.id ?? ''))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    if (slot) {
      setDraft({
        subjectId: slot.subjectId,
        label: slot.label,
        startTime: slot.startTime,
        endTime: slot.endTime,
        requiresRevision: slot.requiresRevision,
        learningTarget: slot.learningTarget,
        practiceTarget: slot.practiceTarget,
        reminderEnabled: slot.reminderEnabled,
        breakAfterMinutes: slot.breakAfterMinutes
      })
    } else {
      const daySlots = draftScheduleOf(state).filter((s) => s.weekday === weekday)
      const last = daySlots.sort((a, b) => minutesFromTime(b.endTime) - minutesFromTime(a.endTime))[0]
      const start = last ? timeFromMinutes(minutesFromTime(last.endTime) + (last.breakAfterMinutes || 15)) : '06:00'
      setDraft(emptyDraft(state.subjects[0]?.id ?? '', start))
    }
    setError('')
  }, [open, slot, weekday, state.scheduleDraft, state.scheduleGovernance, state.schedule, state.subjects])

  const duration = minutesFromTime(draft.endTime) - minutesFromTime(draft.startTime)

  const shiftEnd = (newStart: string) => {
    const s = minutesFromTime(newStart)
    setDraft((d) => ({ ...d, startTime: newStart, endTime: timeFromMinutes(s + Math.max(30, duration || 60)) }))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={slot ? 'Edit session' : `Add session — ${WEEKDAY_LONG[weekday]}`}
      subtitle="Each session has its own revision requirement, learning target and practice target."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!draft.subjectId) {
                setError('Choose a subject first.')
                return
              }
              if (minutesFromTime(draft.endTime) <= minutesFromTime(draft.startTime)) {
                setError('End time must be after the start time.')
                return
              }
              if (!draft.label.trim()) {
                setError('Give the session a short label.')
                return
              }
              onSave(draft)
            }}
          >
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

        <div className="grid grid--2" style={{ gap: 12 }}>
          <Field label="Subject" required>
            <Select value={draft.subjectId} onChange={(e) => setDraft({ ...draft, subjectId: e.target.value })}>
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Session label" required hint="e.g. Morning Learning Session">
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Learning Session" />
          </Field>
        </div>

        <div className="grid grid--3" style={{ gap: 12 }}>
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

        <Field label="New learning target" hint="What exactly should be completed in this block?">
          <Input
            value={draft.learningTarget}
            onChange={(e) => setDraft({ ...draft, learningTarget: e.target.value })}
            placeholder="New chapter concept + 20 solved examples"
          />
        </Field>

        <div className="grid grid--2" style={{ gap: 12 }}>
          <Field label="Practice target (questions)">
            <Input
              type="number"
              min={0}
              max={200}
              value={draft.practiceTarget}
              onChange={(e) => setDraft({ ...draft, practiceTarget: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
          <Field label="Break after this session (minutes)">
            <Input
              type="number"
              min={0}
              max={120}
              value={draft.breakAfterMinutes}
              onChange={(e) => setDraft({ ...draft, breakAfterMinutes: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
        </div>

        <div className="muted-box stack" style={{ gap: 0 }}>
          <Toggle
            checked={draft.requiresRevision}
            onChange={(v) => setDraft({ ...draft, requiresRevision: v })}
            label="Requires revision before new learning"
            description="Opens the Revision Preparation Panel with this subject's previously studied topics."
          />
          <div className="divider" style={{ margin: '0' }} />
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
            The same subject can appear again later the same day — session numbering updates automatically per subject.
          </span>
        </div>
      </div>
    </Modal>
  )
}

export { uid, GripVertical, ChevronDown, RotateCcw, Segmented }
