import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, configureSession, lastRefreshFailure, refreshSession, setAccessToken, type TokenPayload } from '../lib/http'

export interface AuthUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: string
  createdAt: string
}

export interface PublicConfig {
  ai: { configured: boolean; provider: string | null; model: string | null }
  ocr: { provider: string; available: boolean }
  mail: { driver: string; delivers: boolean }
  requireEmailVerification: boolean
  maxUploadMb: number
  maxPdfPages: number
  schedulePolicy: { maxChanges: number; windowDays: number }
  timezone: string
  environment: string
  devMailbox: boolean
}

/** `offline`: this browser has a session but the server could not be reached to restore it (auto-retries). */
type Status = 'loading' | 'anonymous' | 'authenticated' | 'offline'

interface AuthValue {
  status: Status
  user: AuthUser | null
  config: PublicConfig | null
  configError: string | null
  login: (email: string, password: string) => Promise<void>
  register: (input: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: boolean }) => Promise<{ verificationRequired: boolean }>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
  refreshUser: () => Promise<void>
  retrySession: () => Promise<void>
  setUser: (user: AuthUser) => void
}

const AuthContext = createContext<AuthValue | null>(null)
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('studyos-auth') : null

/*
 * Non-secret hint that this browser holds a refresh cookie (the cookie itself is
 * HttpOnly and unreadable). Avoids a pointless 401 refresh call for visitors who
 * were never signed in. It grants nothing — the server still checks the cookie.
 */
const HINT_KEY = 'studyos.signedIn'
const setHint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HINT_KEY, '1')
    else localStorage.removeItem(HINT_KEY)
  } catch {
    /* storage unavailable */
  }
}
const hasHint = () => {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return true
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUserState] = useState<AuthUser | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status

  const signedOut = useCallback(() => {
    setHint(false)
    setAccessToken(null)
    setUserState(null)
    setStatus('anonymous')
  }, [])

  const acceptSession = useCallback((payload: TokenPayload) => {
    setHint(true)
    setAccessToken(payload.accessToken)
    if (payload.user) setUserState(payload.user as AuthUser)
    setStatus('authenticated')
  }, [])

  /** Restores the session from the refresh cookie. Only a definite "no session" signs the user out. */
  const restore = useCallback(async () => {
    const ok = await refreshSession()
    if (ok) setStatus('authenticated')
    else if (lastRefreshFailure === 'no-session') signedOut()
    else {
      setAccessToken(null)
      setStatus((s) => (s === 'authenticated' ? s : 'offline'))
    }
  }, [signedOut])

  useEffect(() => {
    configureSession({
      onSessionLost: () => {
        if (statusRef.current === 'authenticated') signedOut()
      },
      onTokens: (p) => p.user && setUserState(p.user as AuthUser)
    })
    let cancelled = false
    void (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        try {
          const cfg = await api<PublicConfig>('/api/config', { auth: false })
          if (cancelled) return
          setConfig(cfg)
          setConfigError(null)
          return
        } catch {
          await new Promise((r) => setTimeout(r, 750 * (attempt + 1)))
        }
      }
      if (!cancelled) setConfigError('The StudyOS API is not reachable. Start it with `npm run dev` (or `npm run dev:api`).')
    })()
    if (!hasHint()) signedOut()
    else void restore()
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'logout') signedOut()
    }
    channel?.addEventListener('message', onMessage)
    return () => {
      cancelled = true
      channel?.removeEventListener('message', onMessage)
    }
  }, [signedOut, restore])

  // Server was unreachable on load: keep retrying quietly until it is back.
  useEffect(() => {
    if (status !== 'offline') return
    const id = window.setInterval(() => void restore(), 5000)
    return () => window.clearInterval(id)
  }, [status, restore])

  // Keep the short-lived access token fresh while the app is open.
  useEffect(() => {
    if (status !== 'authenticated') return
    const id = window.setInterval(() => void refreshSession(), 10 * 60_000)
    return () => window.clearInterval(id)
  }, [status])

  const login = useCallback(
    async (email: string, password: string) => {
      acceptSession(await api<TokenPayload>('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }))
    },
    [acceptSession]
  )

  const register = useCallback(async (input: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: boolean }) => {
    return api<{ verificationRequired: boolean }>('/api/auth/register', { method: 'POST', body: input, auth: false })
  }, [])

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST', csrf: true, auth: false }).catch(() => undefined)
    channel?.postMessage('logout')
    signedOut()
  }, [signedOut])

  const logoutAll = useCallback(async () => {
    await api('/api/auth/logout-all', { method: 'POST' })
    channel?.postMessage('logout')
    signedOut()
  }, [signedOut])

  const refreshUser = useCallback(async () => {
    const r = await api<{ user: AuthUser }>('/api/auth/me')
    setUserState(r.user)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({ status, user, config, configError, login, register, logout, logoutAll, refreshUser, retrySession: restore, setUser: setUserState }),
    [status, user, config, configError, login, register, logout, logoutAll, refreshUser, restore]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export { AuthContext }
