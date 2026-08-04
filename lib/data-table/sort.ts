/**
 * Shared DataTable sort helpers — used by every DataTable instance.
 */

export type SortDirection = 'asc' | 'desc'

export type TableSortState = {
  key: string
  direction: SortDirection
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    // Avoid treating plain ISO dates as numbers (e.g. 2026-08-04).
    if (/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null
    return Number(value)
  }
  return null
}

function asTime(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime()
  if (typeof value === 'string' || typeof value === 'number') {
    const raw = String(value).trim()
    if (!raw) return null
    // Prefer ISO / date-like strings so intake dates sort chronologically.
    if (/^\d{4}-\d{2}-\d{2}/.test(raw) || value instanceof Date) {
      const t = new Date(raw).getTime()
      return Number.isNaN(t) ? null : t
    }
  }
  return null
}

/** Compare two cell values for table sorting (nulls last in both directions). */
export function compareSortValues(a: unknown, b: unknown): number {
  const aBlank = isBlank(a)
  const bBlank = isBlank(b)
  if (aBlank && bBlank) return 0
  if (aBlank) return 1
  if (bBlank) return -1

  const aTime = asTime(a)
  const bTime = asTime(b)
  if (aTime !== null && bTime !== null) return aTime - bTime

  const aNum = asNumber(a)
  const bNum = asNumber(b)
  if (aNum !== null && bNum !== null) return aNum - bNum

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function nextSortState(
  current: TableSortState | null,
  key: string,
): TableSortState | null {
  if (!current || current.key !== key) return { key, direction: 'asc' }
  if (current.direction === 'asc') return { key, direction: 'desc' }
  return null
}
