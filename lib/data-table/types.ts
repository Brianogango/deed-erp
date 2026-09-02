import type { TableSortState } from './sort'
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
  /**
   * When true (default), the column header is clickable for client-side sort.
   * Set false for action-only / non-comparable columns.
   */
  sortable?: boolean
  /** Explicit sort value. Falls back to accessor → exportValue → searchValue → row[key]. */
  sortValue?: (row: T) => unknown
  /** Cell content for the table/grid rendering (desktop + tablet + laptop). */
  render: (row: T) => ReactNode
  /**
   * Optional Odoo-style summary for this column. The first argument contains
   * only the current page; the second contains every filtered row.
   */
  footer?: (pageRows: T[], filteredRows: T[]) => ReactNode
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

/** Value used when sorting a column (never falls back to React render output). */
export function getColumnSortValue<T>(column: ColumnDef<T>, row: T): unknown {
  if (column.sortValue) return column.sortValue(row)
  if (column.accessor) return column.accessor(row)
  if (column.exportValue) return column.exportValue(row)
  if (column.searchValue) return column.searchValue(row)
  if (row && typeof row === 'object' && column.key in (row as object)) {
    return (row as Record<string, unknown>)[column.key]
  }
  return ''
}

export function isColumnSortable<T>(column: ColumnDef<T>): boolean {
  if (column.sortable === false) return false
  if (column.sortable === true) return true
  // Default: sortable whenever we can resolve a comparable value.
  return Boolean(
    column.sortValue
    || column.accessor
    || column.exportValue
    || column.searchValue
    || column.key,
  )
}

export type TableType = 'A' | 'B' | 'C'

export interface SavedView {
  id: string
  name: string
  search: string
  visibleColumnKeys: string[]
  density: 'cozy' | 'compact'
  /** Optional for backward compatibility with saved views created before Phase 1. */
  sort?: TableSortState | null
}

export interface TablePreferences {
  visibleColumnKeys: string[] | null // null = use priority defaults
  density: 'cozy' | 'compact'
  savedViews: SavedView[]
  /**
   * undefined = no preference yet, use the table's defaultSort.
   * null = user explicitly cycled back to unsorted.
   */
  sort?: TableSortState | null
}
