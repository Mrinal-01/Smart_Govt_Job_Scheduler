import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, renderWithStudy } from './utils'

/* Upload uses XMLHttpRequest for progress; replace just that function. */
const uploadState: { resolve?: (v: unknown) => void; reject?: (e: unknown) => void; progress?: (p: number) => void; form?: FormData; aborted: boolean } = { aborted: false }
vi.mock('../lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/http')>()
  return {
    ...actual,
    uploadWithProgress: (_path: string, form: FormData, onProgress: (p: number) => void) => {
      uploadState.form = form
      uploadState.progress = onProgress
      uploadState.aborted = false
      const promise = new Promise((resolve, reject) => {
        uploadState.resolve = resolve
        uploadState.reject = reject
      })
      return {
        promise,
        abort: () => {
          uploadState.aborted = true
          uploadState.reject?.(new actual.ApiError('Upload cancelled.', 0, 'ABORTED'))
        }
      }
    }
  }
})

const { default: CreateTestPage } = await import('../pages/tests/CreateTestPage')

afterEach(() => vi.unstubAllGlobals())

const doc = (status: string, progress: number) => ({
  _id: 'd1',
  originalName: 'paper.pdf',
  sizeBytes: 2048,
  pageCount: 4,
  status,
  stage: status === 'completed' ? 'done' : 'extracting page 2/4',
  progress,
  error: null,
  intent: { mockType: 'subject_full', subjectIds: [] },
  pages: [],
  stats: { questionsFound: 25, inserted: 25, duplicates: 0, needsReview: 3, textPages: 4, ocrPages: 0, ocrUnavailablePages: 0, answerKeyFound: true },
  aiUsed: false,
  aiNote: null,
  createdAt: new Date().toISOString()
})

describe('PDF upload workflow', () => {
  it('validates the file, shows upload progress, supports cancel, then tracks server processing', async () => {
    let polls = 0
    mockApi({ 'GET /api/documents/d1': () => ({ body: { document: polls++ > 0 ? doc('completed', 100) : doc('processing', 40) } }) })
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
    globalThis.URL.revokeObjectURL = vi.fn()
    const user = userEvent.setup({ applyAccept: false })
    renderWithStudy(<CreateTestPage />, { route: '/tests/new?type=subject_full' })

    await user.click(screen.getByRole('radio', { name: /subject-wise full mock/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    const input = document.querySelector('input[type=file]') as HTMLInputElement

    await user.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    expect(screen.getByText('Choose a PDF file.')).toBeInTheDocument()

    const pdf = new File(['%PDF-1.4 test'], 'paper.pdf', { type: 'application/pdf' })
    await user.upload(input, pdf)
    expect(screen.getByTitle('PDF preview')).toHaveAttribute('src', 'blob:preview')

    // start, then cancel
    await user.click(screen.getByRole('button', { name: /upload & extract/i }))
    act(() => uploadState.progress?.(35))
    expect(await screen.findByText('35%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel upload/i }))
    expect(await screen.findByText('Upload cancelled.')).toBeInTheDocument()
    expect(uploadState.aborted).toBe(true)

    // start again and finish
    await user.click(screen.getByRole('button', { name: /upload & extract/i }))
    expect(uploadState.form?.get('mockType')).toBe('subject_full')
    await act(async () => uploadState.resolve?.({ document: doc('queued', 0), duplicate: false }))
    expect(await screen.findByText(/4 pages/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/25 questions found/)).toBeInTheDocument(), { timeout: 5000 })
    expect(screen.getByRole('button', { name: /review & verify questions/i })).toBeInTheDocument()
  })
})
