let counter = 0

export function uid(prefix = 'id'): string {
  counter += 1
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

export function round(value: number, digits = 0): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** Deterministic 32-bit hash — used for stable seeded demo data. */
export function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(arr: T[], random: () => number): T {
  return arr[Math.floor(random() * arr.length) % arr.length]
}

export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

export function groupBy<T, K extends string | number>(arr: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  arr.forEach((item) => {
    const k = key(item)
    if (!out[k]) out[k] = []
    out[k].push(item)
  })
  return out
}

export function sortBy<T>(arr: T[], key: (item: T) => number | string, dir: 'asc' | 'desc' = 'asc'): T[] {
  return [...arr].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka === kb) return 0
    const cmp = ka < kb ? -1 : 1
    return dir === 'asc' ? cmp : -cmp
  })
}

export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadCSV(filename: string, rows: Array<Record<string, string | number | null>>): void {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const escape = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`
}

export function masteryLabel(score: number): { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' } {
  if (score >= 85) return { label: 'Mastered', tone: 'success' }
  if (score >= 70) return { label: 'Strong', tone: 'info' }
  if (score >= 50) return { label: 'Developing', tone: 'warning' }
  if (score > 0) return { label: 'Weak', tone: 'danger' }
  return { label: 'Not started', tone: 'neutral' }
}
