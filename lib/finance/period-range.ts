/**
 * Report periods a person picks with one tap: Today, This week, This month,
 * Last month, This year. Dates are the local calendar (Nairobi when the
 * browser is), as YYYY-MM-DD — toISOString() is UTC and gave yesterday's
 * date between midnight and 3am.
 *
 * Pure.
 */

export type PeriodId = 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_year'

export const PERIODS: Array<{ id: PeriodId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
]

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function periodRange(id: PeriodId, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (id) {
    case 'today':
      return { from: ymd(today), to: ymd(today) }
    case 'this_week': {
      const monday = new Date(today)
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
      return { from: ymd(monday), to: ymd(today) }
    }
    case 'this_month':
      return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) }
    case 'last_month':
      return {
        from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)),
      }
    case 'this_year':
      return { from: ymd(new Date(today.getFullYear(), 0, 1)), to: ymd(today) }
  }
}

/** Which period a From/To pair is, if any (to show it selected). */
export function periodOf(from: string, to: string, now: Date = new Date()): PeriodId | null {
  if (!from || !to) return null
  for (const p of PERIODS) {
    const r = periodRange(p.id, now)
    if (r.from === from && r.to === to) return p.id
  }
  return null
}
