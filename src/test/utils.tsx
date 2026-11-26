import React from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthContext, type AuthUser, type PublicConfig } from '../auth/AuthContext'
import { SyncContext } from '../workspace/WorkspaceGate'
import { StudyProvider } from '../store/StudyStore'
import { buildFreshState } from '../data/seed'
import type { StudyState } from '../types'

export const testUser: AuthUser = {
  id: 'u1',
  name: 'Test Student',
  email: 'student@example.com',
  emailVerified: true,
  role: 'student',
  hasPassword: true,
  googleLinked: false,
  createdAt: '2026-01-01T00:00:00.000Z'
}

export const testConfig: PublicConfig = {
  googleSignIn: false,
  googleClientId: null,
  ai: { configured: false, provider: null, model: null },
  ocr: { provider: 'none', available: false },
  mail: { driver: 'console', delivers: false },
  requireEmailVerification: true,
  maxUploadMb: 20,
  maxPdfPages: 200,
  schedulePolicy: { maxChanges: 3, windowDays: 7 },
  timezone: 'Asia/Kolkata',
  environment: 'test',
  devMailbox: false
}

type Handler = (url: string, init: { method: string; body?: unknown }) => { status?: number; body?: unknown } | undefined

/** Routes fetch() calls to handlers; unmatched calls fail loudly. Records every call. */
export function mockApi(routes: Record<string, Handler | { status?: number; body?: unknown }>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString()
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = (init.method ?? 'GET').toUpperCase()
    let body: unknown = undefined
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    calls.push({ method, path, body })
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ')
      return m === method && (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path.split('?')[0] === p)
    })
    if (!key) return new Response(JSON.stringify({ error: { code: 'UNMOCKED', message: `Unmocked ${method} ${path}` } }), { status: 500 })
    const route = routes[key]
    const r = typeof route === 'function' ? route(path, { method, body }) : route
    const status = r?.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(r?.body ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

export function renderWithStudy(
  ui: React.ReactElement,
  { route = '/', path = '*', state, config = testConfig }: { route?: string; path?: string; state?: StudyState; config?: PublicConfig } = {}
) {
  const authValue = {
    status: 'authenticated' as const,
    user: testUser,
    config,
    configError: null,
    login: vi.fn(),
    register: vi.fn(),
    googleSignIn: vi.fn(),
    linkGoogle: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
    refreshUser: vi.fn(),
    setUser: vi.fn()
  }
  const sync = { status: 'saved' as const, lastSavedAt: null, flush: vi.fn(async () => undefined), reload: vi.fn() }
  const onChange = vi.fn()
  const utils = render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthContext.Provider value={authValue}>
        <SyncContext.Provider value={sync}>
          <StudyProvider initialState={state ?? buildFreshState({ name: testUser.name, email: testUser.email })} onChange={onChange}>
            <Routes>
              <Route path={path} element={ui} />
              <Route path="*" element={<div data-testid="elsewhere">elsewhere</div>} />
            </Routes>
          </StudyProvider>
        </SyncContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
  return { ...utils, sync, onChange, authValue }
}
