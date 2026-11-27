/**
 * Authenticated HTTP client for the StudyOS API.
 *
 * - The short-lived access token lives only in memory (never localStorage).
 * - The refresh token is an HttpOnly cookie the browser sends to /api/auth/*.
 * - A 401 triggers one shared refresh attempt, then the request is retried once.
 */

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(message: string, status: number, code = 'ERROR', details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  get issues(): Array<{ path: string; message: string }> {
    const d = this.details as { issues?: Array<{ path: string; message: string }> } | undefined
    return d?.issues ?? []
  }
}

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const CSRF_HEADER = { 'X-StudyOS-CSRF': '1' }

let accessToken: string | null = null
/** Why the last refresh failed: 'no-session' means signed out for real; anything else is temporary. */
export let lastRefreshFailure: 'no-session' | 'temporary' | null = null
let refreshing: Promise<boolean> | null = null
let onSessionLost: (() => void) | null = null
let onTokens: ((payload: TokenPayload) => void) | null = null

export interface TokenPayload {
  accessToken: string
  expiresIn: number
  user?: unknown
}

export function setAccessToken(token: string | null) {
  accessToken = token
}
export const hasAccessToken = () => Boolean(accessToken)

export function configureSession(handlers: { onSessionLost: () => void; onTokens: (payload: TokenPayload) => void }) {
  onSessionLost = handlers.onSessionLost
  onTokens = handlers.onTokens
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { message?: string; code?: string; details?: unknown } } = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON body */
  }
  const fallback = res.status === 0 ? 'Network error' : `Request failed (${res.status})`
  return new ApiError(body.error?.message ?? fallback, res.status, body.error?.code ?? 'ERROR', body.error?.details)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Backoff between attempts when the server is briefly unavailable (restart, proxy hiccup, rate limit). */
const RETRY_DELAYS_MS = [400, 800, 1500, 2500, 4000]

/**
 * Exchanges the refresh cookie for a new access token. Shared across concurrent callers.
 * 401/403 mean the session is really gone; anything else (network error, 5xx, 429,
 * another tab rotating the cookie) is retried with backoff before giving up.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1])
      const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: CSRF_HEADER }).catch(() => null)
      if (res?.ok) {
        lastRefreshFailure = null
        const payload = (await res.json()) as TokenPayload
        accessToken = payload.accessToken
        onTokens?.(payload)
        return true
      }
      if (res && (res.status === 401 || res.status === 403)) {
        lastRefreshFailure = 'no-session'
        return false
      }
      // Network error, 5xx, 429 or REFRESH_RACE (another tab just rotated the cookie): retry.
    }
    lastRefreshFailure = 'temporary'
    return false
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  auth?: boolean
  csrf?: boolean
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true, csrf = false, headers, ...rest } = options
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(csrf ? CSRF_HEADER : {}),
        ...(headers ?? {})
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
    })

  let res: Response
  try {
    res = await doFetch()
  } catch {
    throw new ApiError('Cannot reach the StudyOS server. Check your connection and that the API is running.', 0, 'NETWORK_ERROR')
  }
  if (res.status === 401 && auth) {
    const err = await parseError(res.clone())
    if (['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHORIZED'].includes(err.code)) {
      if (await refreshSession()) res = await doFetch()
      else if (lastRefreshFailure === 'temporary') {
        // The server is briefly unreachable — keep the user signed in and let them retry.
        throw new ApiError('Cannot reach the StudyOS server right now. Please try again in a moment.', 0, 'NETWORK_ERROR')
      }
    }
    if (res.status === 401) {
      const final = await parseError(res)
      if (final.code !== 'INVALID_CREDENTIALS') onSessionLost?.()
      throw final
    }
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface UploadHandle<T> {
  promise: Promise<T>
  abort: () => void
}

/** Multipart upload with progress and cancellation (fetch cannot report upload progress). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (pct: number) => void): UploadHandle<T> {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<T>((resolve, reject) => {
    const send = (retry: boolean) => {
      xhr.open('POST', `${BASE}${path}`)
      xhr.withCredentials = true
      if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
      xhr.onload = async () => {
        let body: { error?: { message?: string; code?: string; details?: unknown } } & Record<string, unknown> = {}
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          /* ignore */
        }
        if (xhr.status === 401 && retry && (await refreshSession())) return send(false)
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as T)
        else reject(new ApiError(body.error?.message ?? `Upload failed (${xhr.status})`, xhr.status, body.error?.code ?? 'ERROR', body.error?.details))
      }
      xhr.onerror = () => reject(new ApiError('Upload failed — network error.', 0, 'NETWORK_ERROR'))
      xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0, 'ABORTED'))
      xhr.send(form)
    }
    send(true)
  })
  return { promise, abort: () => xhr.abort() }
}

export const errorMessage = (err: unknown, fallback = 'Something went wrong.') =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback
