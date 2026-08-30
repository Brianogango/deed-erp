/** Deed’s standard cover for sold / repaired devices. */
export const DEFAULT_WARRANTY_MONTHS = 6

export function resolveWarrantyMonths(
  productMonths?: unknown,
  fallback: number = DEFAULT_WARRANTY_MONTHS,
): number {
  const n = Number(productMonths)
  if (Number.isFinite(n) && n > 0) return Math.round(n)
  const fb = Number(fallback)
  if (Number.isFinite(fb) && fb > 0) return Math.round(fb)
  return DEFAULT_WARRANTY_MONTHS
}

export function addWarrantyMonths(isoDate: string, months: number): string {
  const dt = new Date(isoDate)
  dt.setMonth(dt.getMonth() + months)
  return dt.toISOString().slice(0, 10)
}

export function formatWarrantyDuration(months: unknown): string {
  const n = Number(months)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n} month${n === 1 ? '' : 's'}`
}
