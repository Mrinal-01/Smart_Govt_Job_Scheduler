import type { Types } from 'mongoose'
import { env } from '../../config/env.js'
import { clock, minutesInZone, weekdayOfKey } from '../../lib/clock.js'
import { addDays, dateKey } from '../../lib/dates.js'
import { getSettings, serializeSettings, type SettingsView } from '../settings/settings.service.js'

export type Oid = Types.ObjectId

export interface PlanContext {
  userId: Oid
  settings: SettingsView
  /** The student's configured IANA time zone — never the server's. */
  tz: string
  now: Date
  /** Today's study date (YYYY-MM-DD) in the student's time zone. */
  today: string
  /** Minutes since local midnight in the student's time zone. */
  nowMinutes: number
}

export async function planContext(userId: Oid): Promise<PlanContext> {
  const settings = serializeSettings(await getSettings(userId))
  const tz = settings.timezone || env.APP_TIMEZONE
  const now = clock.now()
  return { userId, settings, tz, now, today: dateKey(now, tz), nowMinutes: minutesInZone(now, tz) }
}

/** A study day is any date that is neither a configured rest weekday nor a holiday. */
export function isStudyDay(ctx: PlanContext, date: string): boolean {
  return !ctx.settings.plan.restWeekdays.includes(weekdayOfKey(date)) && !ctx.settings.plan.holidays.includes(date)
}

export function restReason(ctx: PlanContext, date: string): string | null {
  if (ctx.settings.plan.holidays.includes(date)) return 'Holiday'
  if (ctx.settings.plan.restWeekdays.includes(weekdayOfKey(date))) return 'Rest day'
  return null
}

/** The first study day strictly after `date` (rest days and holidays are skipped). */
export function nextStudyDay(ctx: PlanContext, date: string): string {
  let d = addDays(date, 1)
  for (let i = 0; i < 31 && !isStudyDay(ctx, d); i += 1) d = addDays(d, 1)
  return d
}

/** Monday of the ISO week containing `date`. */
export function weekStartOf(date: string): string {
  const wd = weekdayOfKey(date) // 0 = Sunday
  return addDays(date, -((wd + 6) % 7))
}

/** The configured weekly review day inside the week that starts on `weekStart` (a Monday). */
export function weeklyDueDate(ctx: PlanContext, weekStart: string): string {
  return addDays(weekStart, (ctx.settings.plan.weeklyReviewWeekday + 6) % 7)
}

export function revisionMinutesFor(ctx: PlanContext, subjectId: string, slotOverride: number | null): number {
  if (typeof slotOverride === 'number') return slotOverride
  const bySubject = ctx.settings.cycle.revisionMinutesBySubject[subjectId]
  if (typeof bySubject === 'number' && bySubject > 0) return bySubject
  return ctx.settings.plan.sameDayRevisionMinutes
}

export const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000
