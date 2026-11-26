/**
 * API client abstraction.
 *
 * Today everything is served from localStorage through the local adapter.
 * To connect a real Node.js + Express + MongoDB backend, set
 * `VITE_API_BASE_URL` and flip `USE_REMOTE_API` to true — the method
 * signatures below already match docs/API_CONTRACT.md, so no screen changes.
 */

import type { MockAttempt, StudyState } from '../types'

const USE_REMOTE_API = false
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status = 500, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
  if (!res.ok) {
    let payload: { message?: string; code?: string } = {}
    try {
      payload = await res.json()
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(payload.message ?? `Request failed (${res.status})`, res.status, payload.code)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface ApiTransport {
  getState(): Promise<StudyState>
  putState(state: StudyState): Promise<void>
  submitAttempt(attempt: MockAttempt): Promise<MockAttempt>
}

/** Remote transport — activates once the Express API is live. */
export const remoteTransport: ApiTransport = {
  getState: () => request<StudyState>('/api/v1/state'),
  putState: (state) =>
    request<void>('/api/v1/state', { method: 'PUT', body: JSON.stringify(state) }),
  submitAttempt: (attempt) =>
    request<MockAttempt>('/api/v1/mock-attempts', { method: 'POST', body: JSON.stringify(attempt) })
}

/**
 * Local transport: the prototype's source of truth is the persisted store,
 * so these are intentionally no-ops that keep the async shape identical.
 * Swapping in `remoteTransport` is a one-line change in `useStudy`.
 */
export const localTransport: ApiTransport = {
  getState: async () => {
    throw new ApiError('Local transport reads from the store directly', 400, 'LOCAL_ONLY')
  },
  putState: async () => undefined,
  submitAttempt: async (attempt) => attempt
}

export const api: ApiTransport = USE_REMOTE_API ? remoteTransport : localTransport

/* -------------------------------------------------------------------------- */
/* Future AI endpoints — never called from the browser with a provider key.   */
/* The backend holds OPENAI_API_KEY and proxies the request.                  */
/* -------------------------------------------------------------------------- */

export const aiApi = {
  chat: (payload: { mode: string; message: string; context?: unknown }) =>
    request<{ content: string; suggestions?: string[] }>('/api/v1/ai/chat', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  generateQuiz: (payload: { subjectId: string; topicId: string; difficulty: string; count: number }) =>
    request<{ questions: unknown[] }>('/api/v1/ai/quiz', { method: 'POST', body: JSON.stringify(payload) }),
  weakTopics: () => request<{ topics: unknown[] }>('/api/v1/ai/weak-topics'),
  smartRevision: () => request<{ plan: unknown[] }>('/api/v1/ai/smart-revision'),
  weeklyReport: () => request<{ report: string }>('/api/v1/ai/weekly-report')
}

export { USE_REMOTE_API }
