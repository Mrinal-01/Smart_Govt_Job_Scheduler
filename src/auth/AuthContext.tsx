import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, configureSession, refreshSession, setAccessToken, type TokenPayload } from '../lib/http'

export interface AuthUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: string
  hasPassword: boolean
  googleLinked: boolean
  createdAt: string
}

export interface PublicConfig {
  googleSignIn: boolean
  googleClientId: string | null
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

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthValue {
  status: Status
  user: AuthUser | null
  config: PublicConfig | null
  configError: string | null
  login: (email: string, password: string) => Promise<void>
  register: (input: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: boolean }) => Promise<{ verificationRequired: boolean }>
  googleSignIn: (credential: string, acceptTerms?: boolean) => Promise<void>
  linkGoogle: (linkTicket: string, password: string) => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
  refreshUser: () => Promise<void>
  setUser: (user: AuthUser) => void
}

const AuthContext = createContext<AuthValue | null>(null)
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('studyos-auth') : null

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUserState] = useState<AuthUser | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status

  const signedOut = useCallback(() => {
    setAccessToken(null)
    setUserState(null)
    setStatus('anonymous')
  }, [])

  const acceptSession = useCallback((payload: TokenPayload) => {
    setAccessToken(payload.accessToken)
    if (payload.user) setUserState(payload.user as AuthUser)
    setStatus('authenticated')
  }, [])

  useEffect(() => {
    configureSession({
      onSessionLost: () => {
        if (statusRef.current === 'authenticated') signedOut()
      },
      onTokens: (p) => p.user && setUserState(p.user as AuthUser)
    })
    api<PublicConfig>('/api/config', { auth: false })
      .then(setConfig)
      .catch(() => setConfigError('The StudyOS API is not reachable. Start it with `npm run dev` (or `npm run dev:api`).'))
    refreshSession().then((ok) => {
      if (!ok) signedOut()
      else setStatus('authenticated')
    })
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'logout') signedOut()
    }
    channel?.addEventListener('message', onMessage)
    return () => channel?.removeEventListener('message', onMessage)
  }, [signedOut])

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

  const googleSignIn = useCallback(
    async (credential: string, acceptTerms?: boolean) => {
      acceptSession(await api<TokenPayload>('/api/auth/google', { method: 'POST', body: { credential, acceptTerms }, auth: false }))
    },
    [acceptSession]
  )

  const linkGoogle = useCallback(
    async (linkTicket: string, password: string) => {
      acceptSession(await api<TokenPayload>('/api/auth/google/link', { method: 'POST', body: { linkTicket, password }, auth: false }))
    },
    [acceptSession]
  )

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
    () => ({ status, user, config, configError, login, register, googleSignIn, linkGoogle, logout, logoutAll, refreshUser, setUser: setUserState }),
    [status, user, config, configError, login, register, googleSignIn, linkGoogle, logout, logoutAll, refreshUser]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export { AuthContext }
