import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StudyProvider, draftScheduleOf, hasUnpublishedSchedule, useStudy } from '../store/StudyStore'
import { buildFreshState } from '../data/seed'
import { addDays, dateKey } from '../lib/date'

function setup() {
  const initial = buildFreshState()
  const wrapper = ({ children }: { children: React.ReactNode }) => <StudyProvider initialState={initial}>{children}</StudyProvider>
  return { initial, ...renderHook(() => useStudy(), { wrapper }) }
}

describe('study store', () => {
  it('schedule edits go to an unpublished draft and never touch the active timetable', () => {
    const { result, initial } = setup()
    const before = result.current.state.schedule
    act(() =>
      result.current.addSlot({
        weekday: 1,
        subjectId: initial.subjects[0].id,
        label: 'Extra',
        startTime: '22:00',
        endTime: '22:30',
        durationMinutes: 30,
        requiresRevision: false,
        learningTarget: '',
        practiceTarget: 0,
        reminderEnabled: false,
        breakAfterMinutes: 0
      })
    )
    expect(result.current.state.schedule).toBe(before)
    expect(draftScheduleOf(result.current.state)).toHaveLength(before.length + 1)
    expect(hasUnpublishedSchedule(result.current.state)).toBe(true)
    act(() => result.current.discardScheduleDraft())
    expect(hasUnpublishedSchedule(result.current.state)).toBe(false)
  })

  it('switches the active timetable only when the published version is effective', () => {
    const { result } = setup()
    const slots = result.current.state.schedule
    const v2 = slots.slice(1)
    act(() =>
      result.current.syncScheduleFromServer({
        latest: { version: 2, effectiveFrom: addDays(dateKey(), 1), slots: v2 },
        active: { version: 1, effectiveFrom: dateKey(), slots }
      })
    )
    expect(result.current.state.schedule).toHaveLength(slots.length) // still v1 today
    expect(result.current.state.scheduleGovernance).toMatchObject({ latestVersion: 2, activeVersion: 1 })
    expect(draftScheduleOf(result.current.state)).toHaveLength(v2.length) // editor shows the newest published
    act(() =>
      result.current.syncScheduleFromServer({
        latest: { version: 2, effectiveFrom: dateKey(), slots: v2 },
        active: { version: 2, effectiveFrom: dateKey(), slots: v2 }
      })
    )
    expect(result.current.state.schedule).toHaveLength(v2.length)
  })

  it('registers first learning without counting it as a revision', () => {
    const { result, initial } = setup()
    const topic = initial.chapters[0].topics[0]
    const today = dateKey()
    act(() => result.current.registerLearning(topic.id, today, 4))
    const t = result.current.state.chapters[0].topics[0]
    expect(t.initialLearningDate).toBe(today)
    expect(t.revisions).toHaveLength(0)
    expect(t.nextRevisionDue).toBe(addDays(today, initial.settings.revisionIntervals[0]))

    // a same-day cycle revision is recorded but does not advance spaced intervals
    act(() => result.current.recordCycleRevision(topic.id, today, 80))
    const r = result.current.state.chapters[0].topics[0]
    expect(r.revisions).toHaveLength(1)
    expect(r.revisions[0]).toMatchObject({ type: 'same-day', source: 'cycle', accuracy: 80 })
    expect(r.nextRevisionDue).toBe(t.nextRevisionDue)
    expect(r.intervalIndex).toBe(t.intervalIndex)
  })
})
