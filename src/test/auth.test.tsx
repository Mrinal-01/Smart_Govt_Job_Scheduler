import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../lib/http'
import { mockApi, testConfig } from './utils'

function renderApp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

describe('authentication flows', () => {
  it('redirects an anonymous visitor from a protected route to sign-in', async () => {
    mockApi({
      'GET /api/config': { body: testConfig },
      'POST /api/auth/refresh': { status: 401, body: { error: { code: 'NO_SESSION', message: 'No active session' } } }
    })
    renderApp('/cycles')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText(/Google sign-in is not configured/)).toBeInTheDocument()
  })

  it('validates registration on the client, then shows the verify-email step', async () => {
    const api = mockApi({
      'GET /api/config': { body: testConfig },
      'POST /api/auth/refresh': { status: 401, body: { error: { code: 'NO_SESSION', message: 'x' } } },
      'POST /api/auth/register': { status: 201, body: { verificationRequired: true, user: {} } }
    })
    const user = userEvent.setup()
    renderApp('/register')
    await screen.findByRole('heading', { name: 'Create your account' })
    await user.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByText('Name must be at least 2 characters')).toBeInTheDocument()
    expect(screen.getByText('You must accept the terms to create an account')).toBeInTheDocument()
    expect(api.calls.some((c) => c.path === '/api/auth/register')).toBe(false)

    await user.type(screen.getByLabelText(/full name/i), 'Asha Rao')
    await user.type(screen.getByLabelText(/^email/i), 'asha@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'Strong-pass-123')
    await user.type(screen.getByLabelText(/confirm password/i), 'Strong-pass-123')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument()
    const call = api.calls.find((c) => c.path === '/api/auth/register')!
    expect(call.body).toMatchObject({ email: 'asha@example.com', acceptTerms: true })
  })

  it('explains an unverified email on login and offers to resend', async () => {
    const api = mockApi({
      'GET /api/config': { body: testConfig },
      'POST /api/auth/refresh': { status: 401, body: { error: { code: 'NO_SESSION', message: 'x' } } },
      'POST /api/auth/login': { status: 403, body: { error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before signing in.' } } },
      'POST /api/auth/resend-verification': { status: 202, body: {} }
    })
    const user = userEvent.setup()
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    await user.type(screen.getByLabelText(/email/i), 'ravi@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'whatever-123')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText(/verify your email/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /resend verification email/i }))
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/auth/resend-verification')).toBe(true))
  })

  it('signs in, then sends a first-time account to workspace onboarding', async () => {
    const user = userEvent.setup()
    const api = mockApi({
      'GET /api/config': { body: testConfig },
      'POST /api/auth/refresh': { status: 401, body: { error: { code: 'NO_SESSION', message: 'x' } } },
      'POST /api/auth/login': {
        body: {
          accessToken: 'access-1',
          expiresIn: 900,
          user: { id: 'u1', name: 'Asha Rao', email: 'asha@example.com', emailVerified: true, role: 'student', hasPassword: true, googleLinked: false, createdAt: '2026-01-01' }
        }
      },
      'GET /api/workspace': { status: 404, body: { error: { code: 'WORKSPACE_NOT_FOUND', message: 'No workspace yet' } } },
      'POST /api/workspace': { status: 201, body: { revision: 1 } }
    })
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    await user.type(screen.getByLabelText(/email/i), 'asha@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'Strong-pass-123')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByRole('heading', { name: /welcome, asha/i })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /start fresh/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/workspace')).toBe(true))
    const created = api.calls.find((c) => c.method === 'POST' && c.path === '/api/workspace')!.body as { origin: string; data: { profile: { name: string }; logs: unknown[] } }
    expect(created.origin).toBe('fresh')
    expect(created.data.profile.name).toBe('Asha Rao')
    expect(created.data.logs).toHaveLength(0)
    // Access token is sent as a bearer header, never stored in localStorage.
    const wsCall = (api.fn.mock.calls as Array<[string, RequestInit]>).find(([u]) => String(u).endsWith('/api/workspace'))!
    expect((wsCall[1].headers as Record<string, string>).Authorization).toBe('Bearer access-1')
    expect(JSON.stringify(localStorage)).not.toContain('access-1')
  })
})
