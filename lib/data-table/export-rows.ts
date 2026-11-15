import { getColumnValue, type ColumnDef } from './types'
import type { ExportRow } from '@/lib/export-utils-base'

/**
 * The value matrix an export writes: one row per record, one cell per column.
 *
 * Build it when a format is picked, never on render. A column with no accessor
 * falls back to render(), so building this up front created a React element
 * for every record and every column — on every keystroke in a table's search
 * box, over the whole filtered list, to feed a menu usually never opened.
 */
export function buildExportRows<T>(rows: T[], columns: ColumnDef<T>[]): ExportRow[] {
  return rows.map(row => columns.map(column => {
    const value = getColumnValue(column, row, 'export')
    return typeof value === 'number' || typeof value === 'string' ? value : String(value ?? '')
  }))
}
