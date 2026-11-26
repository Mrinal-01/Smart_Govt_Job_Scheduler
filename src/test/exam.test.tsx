import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LiveTestPage from '../pages/tests/LiveTestPage'
import AttemptResultPage from '../pages/tests/AttemptResultPage'
import { mockApi, renderWithStudy } from './utils'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  sessionStorage.clear()
})

const questions = [
  { questionId: 'q1', order: 0, questionText: 'What is the SI unit of force?', questionType: 'single_correct', options: [{ label: 'A', text: 'Joule' }, { label: 'B', text: 'Newton' }], subjectName: 'Physical Science', chapterName: 'Force' },
  { questionId: 'q2', order: 1, questionText: 'Ohm is the unit of', questionType: 'single_correct', options: [{ label: 'A', text: 'Current' }, { label: 'B', text: 'Resistance' }], subjectName: 'Physical Science', chapterName: 'Electricity' }
]

function attempt(deadlineInSeconds: number, serverSkewSeconds = 0) {
  const serverNow = Date.now() + serverSkewSeconds * 1000
  return {
    _id: 'a1',
    testName: 'Science mock',
    status: 'in_progress',
    deadlineAt: new Date(serverNow + deadlineInSeconds * 1000).toISOString(),
    serverNow: new Date(serverNow).toISOString(),
    durationSeconds: 600,
    marksPerQuestion: 1,
    negativeMarks: 0,
    instructions: '',
    questions,
    answers: [{ questionId: 'q2', selected: ['A'], markedForReview: true, visited: true }]
  }
}

describe('live exam', () => {
  it('uses the server deadline, restores saved answers, autosaves and submits once', async () => {
    const api = mockApi({
      'GET /api/attempts/a1': { body: { attempt: attempt(125, 3600) } }, // client clock 1h behind the server — irrelevant
      'PUT /api/attempts/a1/answers': { body: { savedAt: new Date().toISOString(), remainingSeconds: 100 } },
      'POST /api/attempts/a1/submit': { body: { attempt: { status: 'submitted' } } }
    })
    const user = userEvent.setup()
    renderWithStudy(<LiveTestPage />, { route: '/exam/a1', path: '/exam/:attemptId' })

    expect(await screen.findByText('What is the SI unit of force?')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent(/02:0[45]/)
    // q2 restored from the server as marked for review with an answer
    expect(screen.getByRole('button', { name: /question 2: answered marked/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /newton/i }))
    expect(screen.getByRole('radio', { name: /newton/i })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: /save & next/i }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true))
    const saved = api.calls.filter((c) => c.method === 'PUT').flatMap((c) => (c.body as { answers: Array<{ questionId: string; selected: string[] }> }).answers)
    expect(saved.find((a) => a.questionId === 'q1')?.selected).toEqual(['B'])

    await user.click(screen.getByRole('button', { name: /^submit$/i }))
    expect(within(screen.getByRole('dialog')).getByText(/of 2/)).toHaveTextContent('Answered 2 of 2')
    const submit = screen.getByRole('button', { name: /submit now/i })
    await user.click(submit)
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toBeInTheDocument())
    expect(api.calls.filter((c) => c.path === '/api/attempts/a1/submit')).toHaveLength(1)
  })

  it('auto-submits when the server deadline passes', async () => {
    const api = mockApi({
      'GET /api/attempts/a1': { body: { attempt: attempt(1) } },
      'PUT /api/attempts/a1/answers': { body: { savedAt: new Date().toISOString(), remainingSeconds: 0 } },
      'POST /api/attempts/a1/submit': { body: { attempt: { status: 'auto_submitted' } } }
    })
    renderWithStudy(<LiveTestPage />, { route: '/exam/a1', path: '/exam/:attemptId' })
    await screen.findByText('What is the SI unit of force?')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700))
    })
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/attempts/a1/submit')).toBe(true))
  })

  it('goes straight to the result when the attempt is already closed', async () => {
    mockApi({ 'GET /api/attempts/a1': { body: { attempt: { ...attempt(0), status: 'auto_submitted' } } } })
    renderWithStudy(<LiveTestPage />, { route: '/exam/a1', path: '/exam/:attemptId' })
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument()
  })
})

describe('result page', () => {
  it('shows scores, flags incomplete scoring, and never shows unverified answers as correct', async () => {
    const result = {
      totalQuestions: 2,
      attempted: 2,
      correct: 1,
      incorrect: 0,
      unanswered: 0,
      unscored: 1,
      unscoredAttempted: 1,
      marks: 1,
      maxMarks: 1,
      accuracy: 100,
      scoringComplete: false,
      timeTakenSeconds: 75,
      bySubject: [{ key: 's', name: 'Physical Science', total: 2, scored: 1, correct: 1, incorrect: 0, unanswered: 0, unscored: 1, accuracy: 100 }],
      byChapter: [],
      byDifficulty: [],
      questionResults: [
        { questionId: 'q1', outcome: 'correct', selected: ['B'] },
        { questionId: 'q2', outcome: 'unscored', selected: ['A'] }
      ]
    }
    const api = mockApi({
      'GET /api/attempts/a1': {
        body: {
          attempt: {
            _id: 'a1',
            testName: 'Science mock',
            status: 'submitted',
            submissionType: 'manual',
            startedAt: new Date().toISOString(),
            submittedAt: new Date().toISOString(),
            durationSeconds: 600,
            marksPerQuestion: 1,
            negativeMarks: 0,
            questions: [
              { ...questions[0], correctAnswer: ['B'], answerVerified: true, explanation: 'F = ma', topicName: null, difficulty: 'easy', source: null },
              { ...questions[1], correctAnswer: null, answerVerified: false, explanation: null, topicName: null, difficulty: 'unknown', source: null }
            ],
            result
          }
        }
      },
      'GET /api/mistakes': { body: { mistakes: [] } },
      'POST /api/attempts/a1/mistakes': { status: 201, body: { mistake: {} } }
    })
    const user = userEvent.setup()
    renderWithStudy(<AttemptResultPage />, { route: '/tests/attempts/a1', path: '/tests/attempts/:attemptId' })
    expect(await screen.findByText(/Scoring is incomplete: 1 question/)).toBeInTheDocument()
    expect(screen.getByText('Unscored — answer not verified')).toBeInTheDocument()
    expect(screen.getAllByText('verified answer')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /add to mistake bank/i }))
    await waitFor(() => expect(api.calls.find((c) => c.path === '/api/attempts/a1/mistakes')?.body).toEqual({ questionId: 'q2' }))
    expect(await screen.findByText('In Mistake Bank')).toBeInTheDocument()
  })
})
