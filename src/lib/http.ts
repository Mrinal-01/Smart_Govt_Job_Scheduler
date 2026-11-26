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

/** Exchanges the refresh cookie for a new access token. Shared across concurrent callers. */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: CSRF_HEADER }).catch(() => null)
      if (!res) return false
      if (res.ok) {
        const payload = (await res.json()) as TokenPayload
        accessToken = payload.accessToken
        onTokens?.(payload)
        return true
      }
      const err = await parseError(res)
      // Another tab rotated the cookie a moment ago — the browser now holds the new one.
      if (err.code === 'REFRESH_RACE') {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
        continue
      }
      return false
    }
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
    if (['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHORIZED'].includes(err.code) && (await refreshSession())) {
      res = await doFetch()
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
