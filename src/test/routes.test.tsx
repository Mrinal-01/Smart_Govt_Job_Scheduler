import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../lib/http'
import { buildSeedState } from '../data/seed'
import { dateKey } from '../lib/date'
import { mockApi, testConfig, testUser } from './utils'

// jsdom has no layout engine; Recharts' ResponsiveContainer needs a size.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const demo = buildSeedState()
const scheduleStatus = {
  policy: { maxChanges: 3, windowDays: 7 },
  usage: { used: 0, remaining: 3, limit: 3, windowDays: 7, nextAvailableAt: null, overridesInWindow: 0 },
  today: dateKey(),
  latest: { id: 'v1', version: 1, effectiveFrom: dateKey(), publishedAt: new Date().toISOString(), changeReason: '', changes: { added: [], removed: [], modified: [], summary: [] }, countsTowardLimit: false, override: false, overrideReason: null, slots: demo.schedule },
  active: { id: 'v1', version: 1, effectiveFrom: dateKey(), publishedAt: new Date().toISOString(), changeReason: '', changes: { added: [], removed: [], modified: [], summary: [] }, countsTowardLimit: false, override: false, overrideReason: null, slots: demo.schedule },
  pending: null
}

const ROUTES: Array<[string, RegExp]> = [
  ['/', /on today’s plate|all sessions|session|done for today|plan/i],
  ['/schedule', /my schedule/i],
  ['/sessions', /study sessions/i],
  ['/subjects', /subjects/i],
  ['/revision', /revision/i],
  ['/sunday', /sunday/i],
  ['/mock-tests', /mock tests/i],
  ['/mistakes', /mistake bank/i],
  ['/analytics', /analytics/i],
  ['/assistant', /ai study assistant/i],
  ['/settings', /settings/i],
  ['/cycles', /study cycles/i],
  ['/tests', /pdf test builder/i],
  ['/tests/bank', /question bank/i],
  ['/tests/new', /create a mock test/i]
]

const errors: unknown[][] = []
const origError = console.error
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', RO)
  console.error = (...args: unknown[]) => {
    errors.push(args)
    origError(...args)
  }
})
afterAll(() => {
  console.error = origError
})
afterEach(() => {
  setAccessToken(null)
})

describe('authenticated app shell — every route renders on existing demo data', () => {
  it.each(ROUTES)('%s', async (route, heading) => {
    errors.length = 0
    mockApi({
      'GET /api/config': { body: testConfig },
      'POST /api/auth/refresh': { body: { accessToken: 'tok', expiresIn: 900, user: testUser } },
      'GET /api/workspace': { body: { revision: 4, data: demo, updatedAt: new Date().toISOString() } },
      'PUT /api/workspace': { body: { revision: 5, updatedAt: new Date().toISOString() } },
      'GET /api/schedule': { body: scheduleStatus },
      'GET /api/cycles/today': { body: { date: dateKey(), cycles: [], active: null, upcomingRevision: [], settings: {}, carryForward: { pendingTasks: [], partialTopics: [], unfinishedBlocks: [] } } },
      'GET /api/cycles/history': { body: { cycles: [] } },
      'GET /api/mock-tests': { body: { items: [] } },
      'GET /api/attempts': { body: { attempts: [] } },
      'GET /api/attempts/performance': { body: { attempts: 0, subjects: [], chapters: [], weakChapters: [], trend: [] } },
      'GET /api/documents': { body: { documents: [] } },
      'GET /api/questions/stats': { body: { byStatus: {}, verifiedBreakdown: [] } },
      'GET /api/questions': { body: { items: [], total: 0, page: 1, limit: 20 } },
      'GET /api/auth/me': { body: { user: testUser } }
    })
    render(
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    )
    expect(await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 4000 })).toBeInTheDocument()
    // Sidebar exposes the new sections alongside the original ones.
    expect(screen.getByRole('link', { name: /study cycles/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /mistake bank/i })).toBeInTheDocument()
    expect(errors.filter((e) => !String(e[0]).includes('width(0) and height(0)'))).toEqual([])
  })
})
