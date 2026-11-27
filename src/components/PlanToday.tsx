import { createContext, useContext } from 'react'
import { usePlanDay, type PlanDay, type PlanSession } from '../lib/plan'

interface PlanTodayValue {
  day: PlanDay | null
  error: string
  loading: boolean
  reload: () => Promise<void>
}

const PlanTodayContext = createContext<PlanTodayValue>({ day: null, error: '', loading: true, reload: async () => undefined })

/**
 * One shared, server-authoritative read of today's plan (sessions, gate states, carryover).
 * It reloads after every plan mutation and once a minute, so cards never show a stale lock.
 */
export function PlanTodayProvider({ children }: { children: React.ReactNode }) {
  const { data, error, loading, reload } = usePlanDay('today')
  return <PlanTodayContext.Provider value={{ day: data, error, loading, reload }}>{children}</PlanTodayContext.Provider>
}

export const usePlanToday = () => useContext(PlanTodayContext)

/** The server session for a scheduled slot on the server's "today", if any. */
export function usePlanSessionFor(date: string, slotId: string): PlanSession | null {
  const { day } = usePlanToday()
  if (!day || day.date !== date) return null
  return day.sessions.find((s) => s.slotId === slotId) ?? null
}
