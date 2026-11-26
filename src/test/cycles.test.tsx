import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CyclesPage from '../pages/CyclesPage'
import { mockApi, renderWithStudy } from './utils'

afterEach(() => vi.unstubAllGlobals())

const block = (over: Record<string, unknown>) => ({
  _id: 'b1',
  subjectId: 'sub_math',
  subjectName: 'Mathematics',
  order: 0,
  status: 'pending',
  revision: { required: true, plannedMinutes: 10, startedAt: null, completedAt: null, actualSeconds: 0, skippedReason: null },
  learning: { startedAt: null, completedAt: null, minutes: 0 },
  skipReason: null,
  tasks: [
    {
      _id: 't1',
      topicId: 'tp1',
      topicName: 'Basics of Percentage',
      chapterName: 'Percentage',
      subjectId: 'sub_math',
      subjectName: 'Mathematics',
      date: '2026-11-26',
      status: 'pending',
      outcome: null,
      accuracy: null,
      skipReason: null,
      sourceCycleNumber: 1
    }
  ],
  logs: [],
  stats: { plannedRevisionMinutes: 10, actualRevisionSeconds: 0, topicsDue: 1, topicsCompleted: 0, topicsSkipped: 0, revisionAccuracy: null },
  ...over
})

const today = (b: Record<string, unknown>) => ({
  date: '2026-11-26',
  cycles: [{ _id: 'c2', date: '2026-11-26', cycleNumber: 2, status: 'active', endedReason: null, blocks: [b], revisionPolicy: { mandatory: true, perTopicMinutes: 3, maxTopicsPerBlock: 5 } }],
  active: { _id: 'c2', date: '2026-11-26', cycleNumber: 2, status: 'active', endedReason: null, blocks: [b], revisionPolicy: { mandatory: true, perTopicMinutes: 3, maxTopicsPerBlock: 5 } },
  upcomingRevision: [],
  settings: { subjectIds: [], revisionMandatory: true, defaultRevisionMinutes: 10 },
  carryForward: { pendingTasks: [], partialTopics: [], unfinishedBlocks: [] }
})

describe('Study Cycles page — revision before learning', () => {
  it('blocks learning until revision is done, and only completes revision on an explicit action', async () => {
    let current = block({})
    const api = mockApi({
      'GET /api/cycles/today': () => ({ body: today(current) }),
      'GET /api/cycles/history': { body: { cycles: [] } },
      'POST /api/cycles/blocks/b1/start-revision': () => {
        current = block({ status: 'revision', revision: { ...current.revision, startedAt: new Date().toISOString() } })
        return { body: { block: current } }
      },
      'POST /api/cycles/revision-tasks/t1/complete': () => {
        current = block({
          status: 'ready',
          tasks: [{ ...(current.tasks as Array<Record<string, unknown>>)[0], status: 'completed', outcome: 'recalled', accuracy: 100 }]
        })
        return { body: { task: { topicId: 'tp1', date: '2026-11-26', accuracy: 100 } } }
      }
    })
    const user = userEvent.setup()
    renderWithStudy(<CyclesPage />)

    expect(await screen.findByText('Basics of Percentage')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start learning/i })).toBeDisabled()
    expect(screen.getByText(/Revise the due topics first/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /start revision/i }))
    await screen.findByRole('button', { name: /^done$/i })
    // still not complete just because revision was opened
    expect(api.calls.some((c) => c.path.includes('/complete'))).toBe(false)

    await user.click(screen.getByRole('button', { name: /^done$/i }))
    await user.click(await screen.findByRole('button', { name: /save revision/i }))
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/cycles/revision-tasks/t1/complete')).toBe(true))
    const body = api.calls.find((c) => c.path === '/api/cycles/revision-tasks/t1/complete')!.body
    expect(body).toEqual({ outcome: 'recalled' })
    await waitFor(() => expect(screen.getByRole('button', { name: /start learning/i })).toBeEnabled())
  })

  it('requires a reason to skip a subject', async () => {
    const api = mockApi({
      'GET /api/cycles/today': { body: today(block({ revision: { required: false, plannedMinutes: 0, startedAt: null, completedAt: null, actualSeconds: 0, skippedReason: null }, tasks: [] })) },
      'GET /api/cycles/history': { body: { cycles: [] } },
      'POST /api/cycles/blocks/b1/skip': { body: { block: {} } }
    })
    const user = userEvent.setup()
    renderWithStudy(<CyclesPage />)
    await user.click(await screen.findByRole('button', { name: /skip subject/i }))
    const dialogConfirm = () => {
      const all = screen.getAllByRole('button', { name: /^skip subject$/i })
      return all[all.length - 1]
    }
    await user.click(dialogConfirm())
    expect(await screen.findByText(/at least 3 characters/)).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/add a short reason/i), 'Doctor appointment')
    await user.click(dialogConfirm())
    await waitFor(() => expect(api.calls.find((c) => c.path === '/api/cycles/blocks/b1/skip')?.body).toEqual({ reason: 'Doctor appointment' }))
  })
})
