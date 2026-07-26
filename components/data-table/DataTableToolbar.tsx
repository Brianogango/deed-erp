'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { SearchInput } from '@/components/ui'
import { FilterDrawer } from '@/components/erp'
import ColumnVisibilityMenu from './ColumnVisibilityMenu'
import SavedViewsMenu from './SavedViewsMenu'
import BulkActionsBar from './BulkActionsBar'
import ExportMenu from './ExportMenu'
import FilterSelect from './FilterSelect'
import ActiveFilterChips from './ActiveFilterChips'
import TableOverflowMenu from './TableOverflowMenu'
import ViewSelector from './ViewSelector'
import type { ColumnDef, SavedView } from '@/lib/data-table/types'
import type {
  ActiveFilterChip,
  ExportMenuOption,
  LayoutViewsConfig,
  OverflowAction,
  PrimaryFilterConfig,
} from '@/lib/data-table/toolbar-types'
import { useTableBreakpoint } from '@/lib/data-table/use-breakpoint'

export interface DataTableToolbarProps<T> {
  columns: ColumnDef<T>[]
  eligibleKeys: Set<string>
  visibleKeys: Set<string>
  onVisibleKeysChange: (keys: string[]) => void

  search: string
  onSearchChange: (v: string) => void
  searchPlaceholder?: string
  hideSearch?: boolean

  primaryFilters?: PrimaryFilterConfig[]
  /** Extra fields rendered inside More filters (desktop drawer / mobile sheet). */
  advancedFilters?: ReactNode
  activeFilters?: ActiveFilterChip[]
  onClearFilters?: () => void
  /** Built-in column-rule filter count (AdvancedFilters). */
  activeFilterCount?: number
  onOpenColumnFilters?: () => void

  layoutViews?: LayoutViewsConfig
  showColumns?: boolean
  showSavedViews?: boolean

  savedViews: SavedView[]
  onApplyView: (view: SavedView) => void
  onSaveView: (name: string) => void
  onDeleteView: (id: string) => void

  onRefresh?: () => void
  exportOptions?: ExportMenuOption[]
  onImport?: () => void
  overflowActions?: OverflowAction[]

  createAction?: ReactNode
  quickStats?: ReactNode

  selectedCount: number
  onClearSelection: () => void
  bulkActions?: ReactNode

  loading?: boolean
}

/**
 * Shared ERP table toolbar.
 * Desktop: [Search] [Status] [Context] [More filters] …… [Columns] [Export▾] [⋯]
 * Mobile:  [Search] / [Filters] ………………………… [More ⋯]
 */
export default function DataTableToolbar<T>(props: DataTableToolbarProps<T>) {
  const breakpoint = useTableBreakpoint()
  const isMobile = breakpoint === 'mobile'
  const isNarrow = breakpoint === 'mobile' || breakpoint === 'tablet'
  const [moreOpen, setMoreOpen] = useState(false)

  const primaryFilters = props.primaryFilters ?? []
  const desktopPrimary = primaryFilters.slice(0, 2)
  const drawerFilters = isMobile ? primaryFilters : primaryFilters.slice(2)

  const activeChips = useMemo(() => {
    if (props.activeFilters) return props.activeFilters
    return primaryFilters
      .filter(f => f.value !== (f.allValue ?? 'all') && f.value !== '')
      .map(f => ({
        key: f.key,
        label: f.label,
        valueLabel: f.options.find(o => o.value === f.value)?.label ?? f.value,
        onRemove: () => f.onChange(f.allValue ?? 'all'),
      }))
  }, [props.activeFilters, primaryFilters])

  const moreFiltersCount = useMemo(() => {
    let count = props.activeFilterCount ?? 0
    for (const f of drawerFilters) {
      if (f.value !== (f.allValue ?? 'all') && f.value !== '') count += 1
    }
    return count
  }, [props.activeFilterCount, drawerFilters])

  const showColumnsInline = props.showColumns !== false && !isNarrow
  const showExportInline = !isMobile && (props.exportOptions?.length ?? 0) > 0

  const overflowActions = useMemo(() => {
    const actions: OverflowAction[] = [...(props.overflowActions ?? [])]
    if (props.onRefresh && !actions.some(a => a.id === 'refresh')) {
      actions.push({ id: 'refresh', label: 'Refresh', onSelect: props.onRefresh })
    }
    if (props.onImport && !actions.some(a => a.id === 'import')) {
      actions.push({ id: 'import', label: 'Import', onSelect: props.onImport })
    }
    if (isMobile && (props.exportOptions?.length ?? 0) > 0) {
      for (const opt of props.exportOptions ?? []) {
        if (actions.some(a => a.id === `export-${opt.id}`)) continue
        actions.push({
          id: `export-${opt.id}`,
          label: opt.label,
          onSelect: () => { void opt.onSelect() },
          disabled: opt.disabled,
        })
      }
    }
    return actions
  }, [props.overflowActions, props.onRefresh, props.onImport, props.exportOptions, isMobile])

  const hasMoreFilters =
    Boolean(props.advancedFilters) ||
    Boolean(props.onOpenColumnFilters) ||
    drawerFilters.length > 0 ||
    (isMobile && desktopPrimary.length > 0) ||
    (isNarrow && props.showColumns !== false)

  if (props.selectedCount > 0) {
    return (
      <div className="dt-toolbar dt-toolbar-bulk">
        <BulkActionsBar
          selectedCount={props.selectedCount}
          onClear={props.onClearSelection}
          actions={props.bulkActions}
        />
      </div>
    )
  }

  return (
    <div className={`dt-toolbar ${props.loading ? 'is-loading' : ''}`.trim()}>
      <div className="dt-toolbar-row">
        <div className="dt-toolbar-left">
          {!props.hideSearch && (
            <SearchInput
              value={props.search}
              onChange={props.onSearchChange}
              placeholder={props.searchPlaceholder ?? 'Search records…'}
              ariaLabel="Search table records"
              clearable
              className="dt-toolbar-search"
            />
          )}

          {!isMobile && desktopPrimary.map(filter => (
            <FilterSelect key={filter.key} filter={filter} />
          ))}

          {hasMoreFilters && (
            <button
              type="button"
              className="dt-toolbar-btn"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
            >
              {isMobile ? 'Filters' : 'More filters'}
              {moreFiltersCount > 0 ? ` (${moreFiltersCount})` : ''}
            </button>
          )}

          {!isMobile && props.layoutViews && <ViewSelector views={props.layoutViews} />}
        </div>

        <div className="dt-toolbar-right">
          {props.quickStats}

          {showColumnsInline && (
            <ColumnVisibilityMenu
              columns={props.columns}
              eligibleKeys={props.eligibleKeys}
              visibleKeys={props.visibleKeys}
              onChange={props.onVisibleKeysChange}
            />
          )}

          {showExportInline && props.exportOptions && (
            <ExportMenu options={props.exportOptions} />
          )}

          {props.showSavedViews && !isMobile && (
            <SavedViewsMenu
              views={props.savedViews}
              onApply={props.onApplyView}
              onSaveCurrent={props.onSaveView}
              onDelete={props.onDeleteView}
            />
          )}

          {overflowActions.length > 0 && (
            <TableOverflowMenu actions={overflowActions} />
          )}

          {props.createAction}
        </div>
      </div>

      <ActiveFilterChips filters={activeChips} onClearAll={props.onClearFilters} />

      {moreOpen && (
        <FilterDrawer
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          title="Filters"
          footer={
            <>
              {props.onClearFilters && (
                <button type="button" className="btn-secondary" onClick={props.onClearFilters}>
                  Reset
                </button>
              )}
              <button type="button" className="btn-primary" onClick={() => setMoreOpen(false)}>
                Apply filters
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {(isMobile ? primaryFilters : drawerFilters).map(filter => (
              <label key={filter.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[var(--text-3)]">{filter.label}</span>
                <FilterSelect filter={filter} className="w-full" />
              </label>
            ))}
            {props.advancedFilters}
            {props.onOpenColumnFilters && (
              <button
                type="button"
                className="btn-secondary w-full justify-center"
                onClick={() => {
                  setMoreOpen(false)
                  props.onOpenColumnFilters?.()
                }}
              >
                Column conditions{props.activeFilterCount ? ` (${props.activeFilterCount})` : ''}
              </button>
            )}
            {isNarrow && props.showColumns !== false && (
              <div className="pt-1 border-t border-[var(--border-lt)]">
                <p className="text-xs font-medium text-[var(--text-3)] mb-2">Columns</p>
                <ColumnVisibilityMenu
                  columns={props.columns}
                  eligibleKeys={props.eligibleKeys}
                  visibleKeys={props.visibleKeys}
                  onChange={props.onVisibleKeysChange}
                />
              </div>
            )}
          </div>
        </FilterDrawer>
      )}
    </div>
  )
}

/** Public alias matching the ERP architecture name. */
export { DataTableToolbar as TableToolbar }
