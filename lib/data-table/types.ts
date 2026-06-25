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
  /** Plain value used for CSV/PDF export. Falls back to render() stringified if omitted. */
  exportValue?: (row: T) => string | number
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
