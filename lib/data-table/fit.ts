import type { ColumnDef } from './types'

/** Nominal width of a bare `1fr` column — keep in step with the grid builder in components/ui. */
const FR_BASIS_PX = 160
const MIN_COLUMN_PX = 80
/** A column is "comfortable" at this share of its declared width (never below its floor). */
const COMFORT_RATIO = 0.75
const GRID_COLUMN_GAP_PX = 12
const GRID_PADDING_PX = 24 + 2

function remToPx(rem: number) {
  return rem * 16
}

/** Parse a declared grid width into the nominal width it stands for and the floor it may shrink to. */
export function parseColumnWidth(width: string | undefined, minWidth?: number): { nominal: number; floor: number } {
  let nominal = FR_BASIS_PX
  let floor = MIN_COLUMN_PX
  const w = (width ?? '1fr').trim()
  let m: RegExpMatchArray | null
  if ((m = w.match(/^(\d+(?:\.\d+)?)px$/))) {
    nominal = Number(m[1])
    floor = Math.min(nominal, MIN_COLUMN_PX)
  } else if ((m = w.match(/^(\d+(?:\.\d+)?)fr$/))) {
    nominal = Number(m[1]) * FR_BASIS_PX
    floor = 88
  } else if ((m = w.match(/^minmax\(\s*([\d.]+)(px|rem)\s*,\s*([\d.]+)fr\s*\)$/))) {
    nominal = Number(m[3]) * FR_BASIS_PX
    floor = Math.min(m[2] === 'rem' ? remToPx(Number(m[1])) : Number(m[1]), remToPx(10))
  }
  if (minWidth) floor = minWidth
  return { nominal: Math.max(nominal, floor), floor }
}

/**
 * Smallest width a column may shrink to. Status pills keep room for their label
 * and right-aligned figures keep room for a seven-digit amount, so neither is
 * ever truncated by sharing slack with its neighbours.
 */
export function columnFloor<T>(column: ColumnDef<T>): number | undefined {
  if (column.key.toLowerCase().includes('status')) return Math.max(140, column.minWidth ?? 0)
  if (column.minWidth) return column.minWidth
  if (column.align === 'right') {
    const declared = parseColumnWidth(column.width).nominal
    return Math.min(88, declared)
  }
  return undefined
}

function comfortableWidth<T>(column: ColumnDef<T>): number {
  const { nominal, floor } = parseColumnWidth(column.width, columnFloor(column))
  return Math.max(floor, Math.round(nominal * COMFORT_RATIO))
}

/**
 * Progressive disclosure for the *default* column set: while the comfortable
 * widths do not fit `available`, drop the least important column (highest
 * priority number, rightmost first). Priority-1 columns are never dropped, and
 * the original order is preserved. Pure so it can be unit-tested.
 *
 * @param extras width already spoken for outside the data columns
 *               (selection checkbox, row-action column).
 */
export function fitColumnsToWidth<T>(columns: ColumnDef<T>[], available: number, extras = 0): ColumnDef<T>[] {
  if (!Number.isFinite(available) || available <= 0) return columns
  const kept = [...columns]
  const total = () =>
    kept.reduce((sum, c) => sum + comfortableWidth(c), 0)
    + Math.max(0, kept.length - 1 + (extras > 0 ? 1 : 0)) * GRID_COLUMN_GAP_PX
    + extras
    + GRID_PADDING_PX
  while (total() > available) {
    let dropAt = -1
    let dropPriority = 1
    kept.forEach((c, index) => {
      if (c.priority >= dropPriority && c.priority > 1) {
        dropPriority = c.priority
        dropAt = index
      }
    })
    if (dropAt < 0) break
    kept.splice(dropAt, 1)
  }
  return kept
}
