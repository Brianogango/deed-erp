/**
 * When a cheque's money is actually there: banks clear a cheque a number of
 * working days after it is banked (default 2), skipping weekends and public
 * holidays. A cheque dated Friday clears on Tuesday.
 */
export const DEFAULT_CHEQUE_CLEARING_DAYS = 2

/** YYYY-MM-DD + n working days (Mon–Fri, not a public holiday). */
export function addWorkingDays(date: string, days: number, holidays: Iterable<string> = []): string {
  const off = new Set(holidays)
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  let left = Math.max(0, Math.floor(days))
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6 || off.has(d.toISOString().slice(0, 10))) continue
    left -= 1
  }
  return d.toISOString().slice(0, 10)
}

/** The day a cheque dated `chequeDate` clears. */
export function chequeClearsOn(chequeDate: string, clearingDays: number = DEFAULT_CHEQUE_CLEARING_DAYS, holidays: Iterable<string> = []): string {
  return addWorkingDays(chequeDate, Number.isFinite(clearingDays) ? clearingDays : DEFAULT_CHEQUE_CLEARING_DAYS, holidays)
}

export function clearingDaysSetting(settings: unknown): number {
  const v = Number((settings as Record<string, unknown> | null)?.chequeClearingDays)
  return Number.isFinite(v) && v >= 0 && v <= 10 ? Math.floor(v) : DEFAULT_CHEQUE_CLEARING_DAYS
}
