import type { ReactNode } from 'react'

// Column visibility priority — see docs/DATATABLE_REDESIGN_ARCHITECTURE.md §8–10.
// 1 = always visible (mobile card + every breakpoint)
// 2 = desktop + tablet
// 3 = desktop only
// 4 = details drawer only, never in the table/card itself
export type ColumnPriority = 1 | 2 | 3 | 4

export interface ColumnDef<T> {
  key: string
  label: string
  priority: ColumnPriority
  /** Grid track width, passed straight through to the existing Table()'s `cols[].width`. */
  width?: string
  align?: 'left' | 'right' | 'center'
  /** Cell content for the table/grid rendering (desktop + tablet + laptop). */
  render: (row: T) => ReactNode
  /**
   * Raw record value used by search, filters, and export. Prefer this when
   * `render` returns badges, links, or other React elements.
   */
  accessor?: (row: T) => unknown
  /** Search-specific value. Falls back to accessor, exportValue, then render for compatibility. */
  searchValue?: (row: T) => unknown
  /** Plain value used for CSV/PDF export. Falls back to accessor, then render for compatibility. */
  exportValue?: (row: T) => string | number
}

export type ColumnValuePurpose = 'search' | 'filter' | 'export'

/**
 * Keeps data operations independent from cell presentation while retaining
 * the historical render() fallback for existing column definitions.
 */
export function getColumnValue<T>(
  column: ColumnDef<T>,
  row: T,
  purpose: ColumnValuePurpose,
): unknown {
  if (purpose === 'search' && column.searchValue) return column.searchValue(row)
  if (purpose === 'export' && column.exportValue) return column.exportValue(row)
  if (column.accessor) return column.accessor(row)
  if (purpose !== 'export' && column.searchValue) return column.searchValue(row)
  if (column.exportValue) return column.exportValue(row)
  return column.render(row)
}

export type TableType = 'A' | 'B' | 'C'

export interface SavedView {
  id: string
  name: string
  search: string
  visibleColumnKeys: string[]
  density: 'cozy' | 'compact'
}

export interface TablePreferences {
  visibleColumnKeys: string[] | null // null = use priority defaults
  density: 'cozy' | 'compact'
  savedViews: SavedView[]
}
