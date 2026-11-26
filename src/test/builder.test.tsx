import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CreateTestPage from '../pages/tests/CreateTestPage'
import { QuestionEditor, type BankQuestion } from '../pages/tests/shared'
import { ScheduleGovernancePanel } from '../components/ScheduleGovernance'
import SchedulePage from '../pages/SchedulePage'
import { buildFreshState } from '../data/seed'
import { dateKey } from '../lib/date'
import { mockApi, renderWithStudy } from './utils'

afterEach(() => vi.unstubAllGlobals())

describe('mock test configuration', () => {
  it('shows bank availability and refuses to create a short test', async () => {
    const api = mockApi({
      'POST /api/mock-tests/preview': (_p, init) => {
        const cfg = (init.body as { config: { questionCount: number } }).config
        const available = 12
        return { body: { ok: cfg.questionCount <= available, total: cfg.questionCount, buckets: [{ key: 's', label: 'Mathematics', requested: cfg.questionCount, available }] } }
      },
      'POST /api/mock-tests': { status: 201, body: { test: { _id: 't1' } } }
    })
    const user = userEvent.setup()
    const state = buildFreshState()
    renderWithStudy(<CreateTestPage />, { route: '/tests/new?step=configure&type=subject_full', state })
    await user.click(await screen.findByRole('button', { name: 'Mathematics' }))
    await user.click(screen.getByRole('button', { name: '20' }))
    expect(await screen.findByText('12 available / 20 needed')).toBeInTheDocument()
    expect(screen.getByText(/a short test is never created silently/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save test/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '10' }))
    expect(await screen.findByText(/Ready: 10 questions/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save test/i }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/mock-tests')).toBe(true))
    const body = api.calls.find((c) => c.method === 'POST' && c.path === '/api/mock-tests')!.body as { type: string; config: { subjectIds: string[]; questionCount: number; durationMinutes: number } }
    expect(body.type).toBe('subject_full')
    expect(body.config).toMatchObject({ subjectIds: [state.subjects[0].id], questionCount: 10, durationMinutes: 15 })
  })
})

describe('extracted question review', () => {
  const question: BankQuestion = {
    _id: 'q1',
    origin: 'pdf',
    documentId: 'd1',
    source: { documentId: 'd1', pageNumber: 3, questionNumber: '12' },
    rawText: '12. What is the SI unit of force? (a) Joule (b) Newton',
    questionText: 'What is the SI unit of force?',
    questionType: 'single_correct',
    options: [
      { label: 'A', text: 'Joule' },
      { label: 'B', text: 'Newton' }
    ],
    correctAnswer: null,
    answerSource: null,
    explanation: null,
    subjectId: null,
    subjectName: null,
    chapterId: null,
    chapterName: null,
    topicId: null,
    topicName: null,
    difficulty: 'unknown',
    status: 'needs_review',
    extractionConfidence: 0.85,
    flags: ['fewer_than_4_options', 'needs_subject'],
    createdAt: new Date().toISOString()
  }

  it('lets the student fix the extraction, mark the answer and verify', async () => {
    const state = buildFreshState()
    const api = mockApi({
      'PATCH /api/questions/q1': (_p, init) => ({ body: { question: { ...question, ...(init.body as object) } } }),
      'POST /api/questions/q1/verify': { body: { question: { ...question, status: 'verified' } } }
    })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    renderWithStudy(<QuestionEditor question={question} onSaved={onSaved} />, { state })
    expect(screen.getByText('Fewer than 4 options')).toBeInTheDocument()
    expect(screen.getByText('Original extracted text')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /mark option b correct/i }))
    await user.selectOptions(screen.getByLabelText('Subject'), state.subjects[1].id)
    await user.click(screen.getByRole('button', { name: /save & verify/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const patch = api.calls.find((c) => c.method === 'PATCH')!.body as { correctAnswer: string[]; subjectId: string }
    expect(patch.correctAnswer).toEqual(['B'])
    expect(patch.subjectId).toBe(state.subjects[1].id)
    expect(api.calls.map((c) => c.path)).toEqual(['/api/questions/q1', '/api/questions/q1/verify'])
    expect(onSaved.mock.calls[0][0].status).toBe('verified')
  })
})

describe('schedule change governance', () => {
  const statusBody = (used: number) => ({
    policy: { maxChanges: 3, windowDays: 7 },
    usage: { used, remaining: 3 - used, limit: 3, windowDays: 7, nextAvailableAt: used >= 3 ? new Date(Date.now() + 86400000).toISOString() : null, overridesInWindow: 0 },
    today: dateKey(),
    latest: { id: 'v1', version: 1, effectiveFrom: dateKey(), publishedAt: new Date().toISOString(), changeReason: 'Initial schedule', changes: { added: [], removed: [], modified: [], summary: [] }, countsTowardLimit: false, override: false, overrideReason: null, slots: [] },
    active: null,
    pending: null
  })

  it('edits create a draft; publishing shows the diff and remaining changes, and requires a reason', async () => {
    const state = buildFreshState()
    const slots = state.schedule
    const api = mockApi({
      'GET /api/schedule': () => {
        const s = statusBody(1)
        return { body: { ...s, latest: { ...s.latest, slots }, active: { ...s.latest, slots } } }
      },
      'POST /api/schedule/preview': { body: { isBaseline: false, diff: { added: ['x'], removed: [], modified: [], summary: ['Added Mathematics on Monday 22:00–22:30'] }, usage: statusBody(1).usage } },
      'POST /api/schedule/publish': { status: 201, body: { version: { version: 2, effectiveFrom: '2026-11-27' } } }
    })
    const user = userEvent.setup()
    renderWithStudy(<SchedulePage />, { state: { ...state, scheduleGovernance: { latestVersion: 1, latestEffectiveFrom: dateKey(), latestSlots: slots, activeVersion: 1 } } })
    expect(await screen.findByText(/Published schedule v1/)).toBeInTheDocument()
    expect(screen.getByText('1/3 changes used in 7 days')).toBeInTheDocument()

    // delete one slot → draft
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i })
    await user.click(deleteButtons[0])
    const confirm = screen.getAllByRole('button', { name: /delete/i })
    await user.click(confirm[confirm.length - 1])
    expect(await screen.findByText(/unpublished schedule changes/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /review & publish/i }))
    expect(await screen.findByText('Added Mathematics on Monday 22:00–22:30')).toBeInTheDocument()
    expect(screen.getByText(/2 change\(s\) remaining · this publish uses 1/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /confirm & publish/i }))
    expect(await screen.findByText(/Give a short reason/)).toBeInTheDocument()
    expect(api.calls.some((c) => c.path === '/api/schedule/publish')).toBe(false)
    await user.type(screen.getByPlaceholderText(/College timings changed/), 'Coaching moved to evenings')
    await user.click(screen.getByRole('button', { name: /confirm & publish/i }))
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/schedule/publish')).toBe(true))
    const body = api.calls.find((c) => c.path === '/api/schedule/publish')!.body as { changeReason: string; slots: unknown[]; effectiveFrom: string }
    expect(body.changeReason).toBe('Coaching moved to evenings')
    expect(body.slots).toHaveLength(slots.length - 1)
    expect(body.effectiveFrom > dateKey()).toBe(true)
  })

  it('explains the limit and requires an emergency reason when no changes remain', async () => {
    const state = buildFreshState()
    mockApi({
      'GET /api/schedule': { body: statusBody(3) },
      'POST /api/schedule/preview': { body: { isBaseline: false, diff: { added: [], removed: ['s'], modified: [], summary: ['Removed Reasoning on Monday 06:00–07:00'] }, usage: statusBody(3).usage } }
    })
    const user = userEvent.setup()
    renderWithStudy(<ScheduleGovernancePanel />, { state: { ...state, scheduleDraft: state.schedule.slice(1) } })
    await user.click(await screen.findByRole('button', { name: /review & publish/i }))
    expect(await screen.findByText(/You have used all 3 schedule changes allowed in 7 days/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish with emergency override/i })).toBeDisabled()
  })
})
