/**
 * Date & time helpers. The product default timezone is Asia/Kolkata
 * (UTC+05:30, no DST), which lets us convert deterministically without
 * pulling a date library into the bundle.
 */
export const TZ = 'Asia/Kolkata'
export const TZ_OFFSET_MIN = 330

const pad = (n: number) => String(n).padStart(2, '0')

/** Current instant shifted into IST wall-clock as a UTC-based Date. */
export function istWallClock(instant: Date = new Date()): Date {
  return new Date(instant.getTime() + TZ_OFFSET_MIN * 60_000)
}

/** YYYY-MM-DD for the given instant, in IST. */
export function dateKey(instant: Date = new Date()): string {
  const d = istWallClock(instant)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Minutes since midnight (IST). */
export function nowMinutes(instant: Date = new Date()): number {
  const d = istWallClock(instant)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

export function nowSeconds(instant: Date = new Date()): number {
  const d = istWallClock(instant)
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
}

export function parseDateKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number)
  return { y, m, d }
}

export function addDays(key: string, delta: number): string {
  const { y, m, d } = parseDateKey(key)
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000
  const dt = new Date(t)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function diffDays(a: string, b: string): number {
  const pa = parseDateKey(a)
  const pb = parseDateKey(b)
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86_400_000)
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(key: string): number {
  const { y, m, d } = parseDateKey(key)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Epoch ms for an IST wall-clock date + HH:mm. */
export function epochFromIST(key: string, time: string): number {
  const { y, m, d } = parseDateKey(key)
  const [h, min] = time.split(':').map(Number)
  return Date.UTC(y, m - 1, d, h, min) - TZ_OFFSET_MIN * 60_000
}

export function minutesFromTime(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function timeFromMinutes(total: number): string {
  const t = ((total % 1440) + 1440) % 1440
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${pad(m)} ${suffix}`
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes)
  const h = Math.floor(Math.abs(m) / 60)
  const rem = Math.abs(m) % 60
  const sign = m < 0 ? '-' : ''
  if (h === 0) return `${sign}${rem}m`
  if (rem === 0) return `${sign}${h}h`
  return `${sign}${h}h ${rem}m`
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatLongDate(key: string): string {
  const { y, m, d } = parseDateKey(key)
  return `${WEEKDAY_LONG[weekdayOf(key)]}, ${d} ${MONTH_SHORT[m - 1]} ${y}`
}

export function formatShortDate(key: string): string {
  const { m, d } = parseDateKey(key)
  return `${d} ${MONTH_SHORT[m - 1]}`
}

export function formatRelativeDay(key: string, today = dateKey()): string {
  const delta = diffDays(key, today)
  if (delta === 0) return 'Today'
  if (delta === -1) return 'Yesterday'
  if (delta === 1) return 'Tomorrow'
  if (delta < 0 && delta >= -6) return WEEKDAY_LONG[weekdayOf(key)]
  return formatShortDate(key)
}

export function greeting(instant = new Date()): string {
  const h = istWallClock(instant).getUTCHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function startOfWeek(key: string, weekStartsOn = 1): string {
  const wd = weekdayOf(key)
  const back = (wd - weekStartsOn + 7) % 7
  return addDays(key, -back)
}

export function isSunday(key: string): boolean {
  return weekdayOf(key) === 0
}

export function rangeDays(startKey: string, endKey: string): string[] {
  const out: string[] = []
  let cur = startKey
  let guard = 0
  while (cur <= endKey && guard < 800) {
    out.push(cur)
    cur = addDays(cur, 1)
    guard += 1
  }
  return out
}

export function relativeTime(isoTimestamp: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(isoTimestamp).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)} hr ago`
  return `${Math.floor(diff / 86_400)} d ago`
}

export function nowTimeLabel(): string {
  return new Date().toLocaleTimeString('en-IN', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}
