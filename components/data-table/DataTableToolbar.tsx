'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { SearchInput } from '@/components/ui'
import { FilterDrawer } from '@/components/erp'
import {
  Fa,
  faArrowsRotate,
  faEllipsisVertical,
  faFileExport,
  faFilePdf,
  faRotateLeft,
  faTableCells,
} from '@/components/icons'
import { faFilter, faFileExcel, faFileCsv } from '@fortawesome/free-solid-svg-icons'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
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
import { useTableBreakpoint, type TableBreakpoint } from '@/lib/data-table/use-breakpoint'

export interface DataTableToolbarProps<T> {
  columns: ColumnDef<T>[]
  eligibleKeys: Set<string>
  visibleKeys: Set<string>
  onVisibleKeysChange: (keys: string[]) => void
  /** Prefer the parent DataTable's container-measured breakpoint so toolbar and body agree. */
  breakpoint?: TableBreakpoint

  search: string
  onSearchChange: (v: string) => void
  searchPlaceholder?: string
  hideSearch?: boolean

  primaryFilters?: PrimaryFilterConfig[]
  advancedFilters?: ReactNode
  activeFilters?: ActiveFilterChip[]
  onClearFilters?: () => void
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

type SheetAction = {
  id: string
  label: string
  icon?: IconProp
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

function exportIcon(id: string): IconProp {
  if (id === 'pdf') return faFilePdf
  if (id === 'excel') return faFileExcel
  if (id === 'csv') return faFileCsv
  return faFileExport
}

/**
 * Shared ERP table toolbar matching the responsive mock:
 * Desktop: [Search] [Status] [Vendor] [More filters] …… [Columns] [Export▾] [⋯]
 * Tablet:  same left group …… [⋯] with Columns/Export inside More
 * Mobile:  [Search] / [Filters badge] [More] + filter & more sheets
 */
export default function DataTableToolbar<T>(props: DataTableToolbarProps<T>) {
  const measuredBreakpoint = useTableBreakpoint()
  const breakpoint = props.breakpoint ?? measuredBreakpoint
  const isMobile = breakpoint === 'mobile'
  const isTablet = breakpoint === 'tablet'
  const isDesktop = breakpoint === 'laptop' || breakpoint === 'desktop'
  const showInlineColumns = !isMobile && props.showColumns !== false

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [moreSheetOpen, setMoreSheetOpen] = useState(false)
  const [showExtraFilters, setShowExtraFilters] = useState(false)
  const [columnsSheetOpen, setColumnsSheetOpen] = useState(false)

  const primaryFilters = props.primaryFilters ?? []
  const desktopPrimary = primaryFilters.slice(0, 2)
  const secondaryFilters = primaryFilters.slice(2)

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

  const activeFilterTotal = useMemo(() => {
    let count = activeChips.length
    if (props.activeFilterCount) count += props.activeFilterCount
    return count
  }, [activeChips.length, props.activeFilterCount])

  // Desktop already shows up to two primary filters inline — only open the
  // More filters surface when there is something beyond those controls.
  const hasFilterSurface = isMobile
    ? primaryFilters.length > 0 || Boolean(props.advancedFilters) || Boolean(props.onOpenColumnFilters)
    : secondaryFilters.length > 0 || Boolean(props.advancedFilters) || Boolean(props.onOpenColumnFilters)

  const moreSheetActions = useMemo((): SheetAction[] => {
    const actions: SheetAction[] = []

    if (props.showColumns !== false) {
      actions.push({
        id: 'columns',
        label: 'Columns',
        icon: faTableCells,
        onSelect: () => {
          setMoreSheetOpen(false)
          setColumnsSheetOpen(true)
        },
      })
    }

    for (const opt of props.exportOptions ?? []) {
      actions.push({
        id: `export-${opt.id}`,
        label: opt.label,
        icon: exportIcon(String(opt.id)),
        disabled: opt.disabled,
        onSelect: () => { void opt.onSelect() },
      })
    }

    if (props.onClearFilters) {
      actions.push({
        id: 'reset-filters',
        label: 'Reset filters',
        icon: faRotateLeft,
        onSelect: props.onClearFilters,
      })
    }

    if (props.onRefresh) {
      actions.push({
        id: 'refresh',
        label: 'Refresh',
        icon: faArrowsRotate,
        onSelect: props.onRefresh,
      })
    }

    if (props.onImport) {
      actions.push({
        id: 'import',
        label: 'Import',
        icon: faFileExport,
        onSelect: props.onImport,
      })
    }

    for (const action of props.overflowActions ?? []) {
      if (actions.some(a => a.id === action.id)) continue
      actions.push({
        id: action.id,
        label: action.label,
        icon: (action.icon as IconProp | undefined),
        disabled: action.disabled,
        danger: action.danger,
        onSelect: action.onSelect,
      })
    }

    return actions
  }, [
    props.showColumns,
    props.exportOptions,
    props.onClearFilters,
    props.onRefresh,
    props.onImport,
    props.overflowActions,
  ])

  /** Secondary overflow (export / refresh / reset). Columns use the dedicated ⋮ control. */
  const secondaryOverflowActions = useMemo((): OverflowAction[] => {
    const actions: OverflowAction[] = []
    for (const opt of props.exportOptions ?? []) {
      // On desktop ExportMenu is inline; keep exports in overflow for tablet only.
      if (isDesktop) continue
      actions.push({
        id: `export-${opt.id}`,
        label: opt.label,
        disabled: opt.disabled,
        onSelect: () => { void opt.onSelect() },
      })
    }
    for (const action of props.overflowActions ?? []) {
      if (!actions.some(a => a.id === action.id)) actions.push(action)
    }
    if (props.onRefresh && !actions.some(a => a.id === 'refresh')) {
      actions.push({ id: 'refresh', label: 'Refresh', onSelect: props.onRefresh })
    }
    if (props.onImport && !actions.some(a => a.id === 'import')) {
      actions.push({ id: 'import', label: 'Import', onSelect: props.onImport })
    }
    if (props.onClearFilters && !actions.some(a => a.id === 'reset-filters')) {
      actions.push({ id: 'reset-filters', label: 'Reset filters', onSelect: props.onClearFilters })
    }
    return actions
  }, [isDesktop, props.exportOptions, props.overflowActions, props.onRefresh, props.onImport, props.onClearFilters])

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

  const openFilters = () => {
    setShowExtraFilters(false)
    setFiltersOpen(true)
  }

  const filterFields = (
    <div className="flex flex-col gap-3">
      {(isMobile ? primaryFilters : secondaryFilters).map(filter => (
        <label key={filter.key} className="dt-sheet-field">
          <span className="dt-sheet-label">{filter.label}</span>
          <FilterSelect filter={filter} className="w-full" />
        </label>
      ))}

      {isMobile && desktopPrimary.length === 0 && primaryFilters.length === 0 && null}

      {(showExtraFilters || !isMobile) && props.advancedFilters}

      {isMobile && props.advancedFilters && !showExtraFilters && (
        <button
          type="button"
          className="dt-sheet-more-link"
          onClick={() => setShowExtraFilters(true)}
        >
          + More filters
        </button>
      )}

      {props.onOpenColumnFilters && (showExtraFilters || !isMobile) && (
        <button
          type="button"
          className="btn-secondary w-full justify-center"
          onClick={() => {
            setFiltersOpen(false)
            props.onOpenColumnFilters?.()
          }}
        >
          Column conditions{props.activeFilterCount ? ` (${props.activeFilterCount})` : ''}
        </button>
      )}
    </div>
  )

  return (
    <div className={`dt-toolbar ${props.loading ? 'is-loading' : ''}`.trim()}>
      {/* ── Main control row(s) ─────────────────────────────────────────── */}
      <div className={`dt-toolbar-row ${isMobile ? 'dt-toolbar-row-mobile' : ''}`.trim()}>
        {isMobile ? (
          <>
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
            <div className={`dt-toolbar-mobile-actions ${!hasFilterSurface ? 'is-single' : ''}`.trim()}>
              {hasFilterSurface && (
                <button
                  type="button"
                  className="dt-toolbar-btn dt-toolbar-btn-grow"
                  onClick={openFilters}
                  aria-haspopup="dialog"
                  aria-expanded={filtersOpen}
                >
                  <Fa icon={faFilter} className="dt-toolbar-icon" aria-hidden="true" />
                  <span>Filters</span>
                  {activeFilterTotal > 0 && (
                    <span className="dt-toolbar-badge" aria-label={`${activeFilterTotal} active filters`}>
                      {activeFilterTotal}
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                className="dt-toolbar-btn dt-toolbar-btn-grow"
                onClick={() => setMoreSheetOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreSheetOpen}
                aria-label="More actions"
              >
                <Fa icon={faEllipsisVertical} className="dt-toolbar-icon" aria-hidden="true" />
                <span>More</span>
              </button>
            </div>
          </>
        ) : (
          <>
            {/*
              Flat single-row flex (no nested left/right wrap groups).
              A spacer pushes actions to the right while search/filters stay inline.
            */}
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

            {desktopPrimary.map(filter => (
              <FilterSelect key={filter.key} filter={filter} />
            ))}

            {hasFilterSurface && (
              <button
                type="button"
                className="dt-toolbar-btn"
                onClick={openFilters}
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
              >
                <Fa icon={faFilter} className="dt-toolbar-icon" aria-hidden="true" />
                <span>More filters</span>
                {activeFilterTotal > 0 && (
                  <span className="dt-toolbar-badge" aria-label={`${activeFilterTotal} active filters`}>
                    {activeFilterTotal}
                  </span>
                )}
              </button>
            )}

            {props.layoutViews && <ViewSelector views={props.layoutViews} />}

            <div className="dt-toolbar-spacer" aria-hidden="true" />

            {props.quickStats}

            {isDesktop && (props.exportOptions?.length ?? 0) > 0 && props.exportOptions && (
              <ExportMenu options={props.exportOptions} />
            )}

            {props.showSavedViews && isDesktop && (
              <SavedViewsMenu
                views={props.savedViews}
                onApply={props.onApplyView}
                onSaveCurrent={props.onSaveView}
                onDelete={props.onDeleteView}
              />
            )}

            {showInlineColumns && (
              <ColumnVisibilityMenu
                columns={props.columns}
                eligibleKeys={props.eligibleKeys}
                visibleKeys={props.visibleKeys}
                onChange={props.onVisibleKeysChange}
              />
            )}

            {secondaryOverflowActions.length > 0 && (
              <TableOverflowMenu
                actions={secondaryOverflowActions}
                label={isTablet ? 'More' : 'More actions'}
              />
            )}

            {props.createAction}
          </>
        )}
      </div>

      <ActiveFilterChips
        filters={activeChips}
        onClearAll={props.onClearFilters}
        maxVisible={isMobile ? 2 : undefined}
      />

      {/* ── Filters sheet ───────────────────────────────────────────────── */}
      {filtersOpen && (
        <FilterDrawer
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title="Filters"
          fullScreen={isMobile}
          footer={
            <>
              {props.onClearFilters && (
                <button
                  type="button"
                  className="dt-sheet-reset"
                  onClick={props.onClearFilters}
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                className="btn-primary dt-sheet-apply"
                onClick={() => setFiltersOpen(false)}
              >
                Apply filters{activeFilterTotal > 0 ? ` (${activeFilterTotal})` : ''}
              </button>
            </>
          }
        >
          {/* On desktop More filters, also show primary filters for editing convenience */}
          {!isMobile && desktopPrimary.length > 0 && (
            <div className="flex flex-col gap-3 mb-3">
              {desktopPrimary.map(filter => (
                <label key={filter.key} className="dt-sheet-field">
                  <span className="dt-sheet-label">{filter.label}</span>
                  <FilterSelect filter={filter} className="w-full" />
                </label>
              ))}
            </div>
          )}
          {filterFields}
        </FilterDrawer>
      )}

      {/* ── Mobile More sheet ───────────────────────────────────────────── */}
      {moreSheetOpen && (
        <FilterDrawer
          open={moreSheetOpen}
          onClose={() => setMoreSheetOpen(false)}
          title="More"
          fullScreen
        >
          <div className="dt-sheet-action-list" role="menu" aria-label="More actions">
            {moreSheetActions.map(action => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                className={`dt-sheet-action ${action.danger ? 'is-danger' : ''}`.trim()}
                onClick={() => {
                  if (action.disabled) return
                  action.onSelect()
                  if (action.id !== 'columns') setMoreSheetOpen(false)
                }}
              >
                {action.icon && <Fa icon={action.icon} className="dt-sheet-action-icon" aria-hidden="true" />}
                <span>{action.label}</span>
              </button>
            ))}
            {props.showSavedViews && (
              <div className="pt-2 border-t border-[var(--border-lt)]">
                <SavedViewsMenu
                  views={props.savedViews}
                  onApply={view => { props.onApplyView(view); setMoreSheetOpen(false) }}
                  onSaveCurrent={props.onSaveView}
                  onDelete={props.onDeleteView}
                />
              </div>
            )}
          </div>
        </FilterDrawer>
      )}

      {/* ── Columns sheet (tablet/mobile via More) ──────────────────────── */}
      {columnsSheetOpen && (
        <FilterDrawer
          open={columnsSheetOpen}
          onClose={() => setColumnsSheetOpen(false)}
          title="Columns"
          fullScreen={isMobile}
          footer={
            <button
              type="button"
              className="btn-primary dt-sheet-apply"
              onClick={() => setColumnsSheetOpen(false)}
            >
              Done
            </button>
          }
        >
          <div className="flex flex-col gap-1">
            {props.columns.filter(c => props.eligibleKeys.has(c.key)).map(col => {
              const checked = props.visibleKeys.has(col.key)
              const locked = col.priority === 1
              return (
                <label
                  key={col.key}
                  className="flex items-center gap-2 rounded-lg px-2 py-2.5 text-sm text-[var(--text-2)] hover:bg-[var(--bg-surface)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() => {
                      if (locked) return
                      const next = new Set(props.visibleKeys)
                      if (next.has(col.key)) {
                        if (next.size <= 2) return
                        next.delete(col.key)
                      } else {
                        next.add(col.key)
                      }
                      props.onVisibleKeysChange(
                        props.columns
                          .filter(c => props.eligibleKeys.has(c.key) && next.has(c.key))
                          .map(c => c.key),
                      )
                    }}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span className="min-w-0 flex-1">{col.label}</span>
                  {locked && <span className="text-[9px] font-bold text-[var(--text-4)]">Required</span>}
                </label>
              )
            })}
          </div>
        </FilterDrawer>
      )}
    </div>
  )
}

export { DataTableToolbar as TableToolbar }
