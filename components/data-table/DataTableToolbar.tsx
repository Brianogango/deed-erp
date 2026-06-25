'use client'

import type { ReactNode } from 'react'
import { SearchInput, ExportButtons } from '@/components/ui'
import type { ExportRow } from '@/lib/export-utils'
import ColumnVisibilityMenu from './ColumnVisibilityMenu'
import SavedViewsMenu from './SavedViewsMenu'
import BulkActionsBar from './BulkActionsBar'
import type { ColumnDef, SavedView } from '@/lib/data-table/types'

interface DataTableToolbarProps<T> {
  columns: ColumnDef<T>[]
  eligibleKeys: Set<string>
  visibleKeys: Set<string>
  onVisibleKeysChange: (keys: string[]) => void

  search: string
  onSearchChange: (v: string) => void
  searchPlaceholder?: string
  /** Suppress the built-in search box — for modules whose own bespoke
   *  search/filter bar already covers it (avoids a duplicate search input). */
  hideSearch?: boolean

  activeFilterCount: number
  onOpenFilters?: () => void

  savedViews: SavedView[]
  onApplyView: (view: SavedView) => void
  onSaveView: (name: string) => void
  onDeleteView: (id: string) => void

  density: 'cozy' | 'compact'
  onDensityChange: (d: 'cozy' | 'compact') => void

  onRefresh?: () => void
  exportTitle?: string
  exportFilename?: string
  exportHeaders?: string[]
  exportRows?: ExportRow[]
  onImport?: () => void

  createAction?: ReactNode
  quickStats?: ReactNode

  selectedCount: number
  onClearSelection: () => void
  bulkActions?: ReactNode
}

// Composition root for the per-table toolbar. Every piece either reuses an
// existing components/ui primitive (SearchInput, ExportButtons) or is one
// of the new, small, single-purpose pieces from this same folder — nothing
// here duplicates the global Topbar's search/density/sync controls.
export default function DataTableToolbar<T>(props: DataTableToolbarProps<T>) {
  if (props.selectedCount > 0) {
    return (
      <div className="px-3 sm:px-4 py-2.5 border-b border-[var(--border-lt)] bg-[var(--bg-card)]">
        <BulkActionsBar
          selectedCount={props.selectedCount}
          onClear={props.onClearSelection}
          actions={props.bulkActions}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-[var(--border-lt)] bg-[var(--bg-card)]">
      {!props.hideSearch && (
        <SearchInput
          value={props.search}
          onChange={props.onSearchChange}
          placeholder={props.searchPlaceholder ?? 'Search this table…'}
          className="w-full sm:w-56"
        />
      )}

      {props.onOpenFilters && (
        <button
          type="button"
          onClick={props.onOpenFilters}
          className="btn-secondary text-[11px] px-2.5 py-1.5 flex items-center gap-1.5"
        >
          Filters{props.activeFilterCount > 0 ? ` (${props.activeFilterCount})` : ''}
        </button>
      )}

      <SavedViewsMenu
        views={props.savedViews}
        onApply={props.onApplyView}
        onSaveCurrent={props.onSaveView}
        onDelete={props.onDeleteView}
      />

      <ColumnVisibilityMenu
        columns={props.columns}
        eligibleKeys={props.eligibleKeys}
        visibleKeys={props.visibleKeys}
        onChange={props.onVisibleKeysChange}
      />

      <div className="hidden sm:flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
        <button
          type="button"
          onClick={() => props.onDensityChange('cozy')}
          className={`px-2 py-1.5 text-[10px] font-semibold ${props.density === 'cozy' ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-3)]'}`}
        >
          Cozy
        </button>
        <button
          type="button"
          onClick={() => props.onDensityChange('compact')}
          className={`px-2 py-1.5 text-[10px] font-semibold ${props.density === 'compact' ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-3)]'}`}
        >
          Compact
        </button>
      </div>

      {props.onRefresh && (
        <button
          type="button"
          onClick={props.onRefresh}
          className="btn-secondary text-[11px] px-2.5 py-1.5"
          aria-label="Refresh table"
        >
          ⟲
        </button>
      )}

      {props.onImport && (
        <button type="button" onClick={props.onImport} className="btn-secondary text-[11px] px-2.5 py-1.5">
          Import
        </button>
      )}

      {props.exportTitle && props.exportHeaders && props.exportRows && (
        <ExportButtons
          title={props.exportTitle}
          filename={props.exportFilename ?? props.exportTitle}
          headers={props.exportHeaders}
          rows={props.exportRows}
        />
      )}

      {props.quickStats && <div className="flex items-center gap-2 text-[11px] text-[var(--text-3)]">{props.quickStats}</div>}

      {props.createAction && <div className="ml-auto">{props.createAction}</div>}
    </div>
  )
}
