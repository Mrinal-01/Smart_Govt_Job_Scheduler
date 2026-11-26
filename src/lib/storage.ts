import type { StudyState } from '../types'
import { STORAGE_KEY, STATE_VERSION, buildSeedState } from '../data/seed'

const MIGRATABLE_KEYS = ['settings', 'profile'] as const

export function loadState(): StudyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return buildSeedState()
    const parsed = JSON.parse(raw) as StudyState
    if (!parsed || parsed.version !== STATE_VERSION) return migrate(parsed)
    if (!parsed.subjects?.length || !parsed.schedule?.length) return buildSeedState()
    return parsed
  } catch {
    return buildSeedState()
  }
}

/** Preserve settings + profile across a schema bump, reseed the rest. */
function migrate(old: Partial<StudyState> | null): StudyState {
  const fresh = buildSeedState()
  if (!old) return fresh
  const merged = { ...fresh }
  MIGRATABLE_KEYS.forEach((key) => {
    if (old[key]) {
      // @ts-expect-error narrowing across unions of the same key
      merged[key] = { ...fresh[key], ...old[key] }
    }
  })
  return merged
}

export function saveState(state: StudyState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (err) {
    // Quota exceeded — trim the oldest logs and retry once.
    try {
      const trimmed: StudyState = { ...state, logs: state.logs.slice(-120) }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch {
      console.warn('StudyOS: unable to persist state', err)
    }
  }
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function exportState(state: StudyState): string {
  return JSON.stringify(state, null, 2)
}

export function parseImportedState(raw: string): StudyState {
  const parsed = JSON.parse(raw) as StudyState
  if (!parsed.subjects || !parsed.schedule || !parsed.settings) {
    throw new Error('This file is not a valid StudyOS backup.')
  }
  return { ...parsed, version: STATE_VERSION }
}
