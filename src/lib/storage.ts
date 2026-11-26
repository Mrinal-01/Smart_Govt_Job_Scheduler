import type { StudyState } from '../types'
import { STORAGE_KEY, STATE_VERSION } from '../data/seed'

/*
 * Browser storage is now only:
 *  1. a per-user offline cache of the server workspace (never auth tokens), and
 *  2. the read-only source for migrating the pre-account `studyos.state.v3` data.
 * The legacy key is never deleted automatically.
 */

export const LEGACY_STORAGE_KEY = STORAGE_KEY
const cacheKey = (userId: string) => `studyos.cache.v1::${userId}`

export interface WorkspaceCache {
  revision: number
  /** true = contains edits not yet acknowledged by the server */
  dirty: boolean
  savedAt: string
  data: StudyState
}

function isStudyState(value: unknown): value is StudyState {
  const v = value as Partial<StudyState> | null
  return Boolean(v && Array.isArray(v.subjects) && Array.isArray(v.chapters) && Array.isArray(v.schedule) && v.settings && v.profile)
}

/** The pre-account browser dataset, if this browser has one. */
export function readLegacyBrowserState(): StudyState | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StudyState
    if (!isStudyState(parsed)) return null
    return { ...parsed, version: STATE_VERSION, sessions: parsed.sessions ?? {}, logs: parsed.logs ?? [], mistakes: parsed.mistakes ?? [], questions: parsed.questions ?? [], mockTests: parsed.mockTests ?? [], attempts: parsed.attempts ?? [], aiMessages: parsed.aiMessages ?? [] }
  } catch {
    return null
  }
}

export function readCache(userId: string): WorkspaceCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as WorkspaceCache
    return isStudyState(parsed.data) ? parsed : null
  } catch {
    return null
  }
}

export function writeCache(userId: string, cache: WorkspaceCache): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(cache))
  } catch {
    // Quota exceeded: the server copy is authoritative, so dropping the cache is safe.
    try {
      localStorage.removeItem(cacheKey(userId))
    } catch {
      /* storage unavailable */
    }
  }
}

export function clearCache(userId: string): void {
  try {
    localStorage.removeItem(cacheKey(userId))
  } catch {
    /* storage unavailable */
  }
}

export function exportState(state: StudyState): string {
  return JSON.stringify(state, null, 2)
}

export function parseImportedState(raw: string): StudyState {
  const parsed = JSON.parse(raw) as StudyState
  if (!isStudyState(parsed)) {
    throw new Error('This file is not a valid StudyOS backup.')
  }
  return { ...parsed, version: STATE_VERSION }
}
