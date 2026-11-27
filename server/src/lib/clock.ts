/**
 * Single source of "now" for the study-plan engine. Production code always
 * uses the real time; the e2e suite replaces `clock.now` to exercise
 * day boundaries in a student's time zone deterministically.
 */
export const clock = {
  now: (): Date => new Date()
}

/** Minutes since local midnight for an instant in an IANA time zone. */
export function minutesInZone(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  return get('hour') * 60 + get('minute')
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD key (calendar arithmetic, zone-free). */
export function weekdayOfKey(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay()
}

export const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
