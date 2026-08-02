'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Table, Pagination } from '@/components/ui'
import { exportToExcel, exportToPDF, type ExportRow } from '@/lib/export-utils'
import { useTableBreakpoint } from '@/lib/data-table/use-breakpoint'
import { useTablePreferences } from '@/lib/data-table/use-table-preferences'
import { getColumnValue, type ColumnDef, type ColumnPriority, type SavedView } from '@/lib/data-table/types'
import type {
  ActiveFilterChip,
  ExportMenuOption,
  LayoutViewsConfig,
  OverflowAction,
  PrimaryFilterConfig,
} from '@/lib/data-table/toolbar-types'
import DataTableToolbar from './DataTableToolbar'
import MobileCardView from './MobileCardView'
import AdvancedFilters, { applyFilterRules, type FilterRule } from './AdvancedFilters'

// Breakpoint → max column priority for the *default* visible set.
// Matches lib/data-table/types.ts: 1 always · 2 tablet+ · 3 laptop/desktop.
// Mobile doesn't use this — it renders MobileCardView instead.
// Users can still opt into higher-priority columns via the column picker.
const PRIORITY_CAP: Record<'tablet' | 'laptop' | 'desktop', ColumnPriority> = {
  tablet: 2,
  laptop: 3,
  desktop: 3,
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'a, button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]',
  ))
}

/** Minimum scroll width from *fixed* tracks only. Fluid `fr`/`minmax` columns
 *  absorb leftover space so typical invoice/sales lists fit without page scroll. */
function estimateTableMinWidth(
  columns: Array<{ key: string; width?: string }>,
  options: { selectable?: boolean; hasRowActions?: boolean },
): number {
  let total = options.selectable ? 36 : 0
  let hasFluid = false
  for (const column of columns) {
    if (column.key.toLowerCase().includes('status')) {
      total += 140
      continue
    }
    if (column.width?.endsWith('px')) {
      const parsed = Number.parseInt(column.width, 10)
      total += Number.isFinite(parsed) ? parsed : 96
      continue
    }
    // fr / minmax / rem — contribute a small floor; grid fills the rest.
    hasFluid = true
    total += 96
  }
  if (options.hasRowActions) total += 120
  // With a fluid column, keep the floor modest so the table can shrink to the
  // card width; fixed-only tables keep a stronger scroll floor.
  return Math.max(hasFluid ? 280 : 320, total)
}

export interface DataTableProps<T> {
  tableId: string
  columns: ColumnDef<T>[]
  rows: T[]
  rowKey: (row: T) => string
  isLoading?: boolean
  error?: string | null
  emptyMessage?: string
  emptyAction?: ReactNode

  searchPlaceholder?: string
  /**
   * Suppress DataTable's own search box — pass already-filtered `rows`
   * when the caller has its own bespoke search/filter UI.
   * Prefer `searchValue` + `onSearchChange` with `clientSearch={false}` instead.
   */
  hideSearch?: boolean
  /** Controlled search value (parent owns filtering when `clientSearch` is false). */
  searchValue?: string
  onSearchChange?: (value: string) => void
  /**
   * When true (default), DataTable filters `rows` by search.
   * Set false when the parent already applied search to `rows`.
   */
  clientSearch?: boolean
  perPage?: number

  primaryFilters?: PrimaryFilterConfig[]
  advancedFilters?: ReactNode
  activeFilters?: ActiveFilterChip[]
  onClearFilters?: () => void
  /** Hide the built-in column-condition AdvancedFilters entry point. */
  hideColumnFilters?: boolean
  layoutViews?: LayoutViewsConfig
  showColumns?: boolean
  /** Saved column/search views — off by default; use layoutViews for table/kanban. */
  showSavedViews?: boolean
  overflowActions?: OverflowAction[]
  /** Hide the entire toolbar (rare — prefer configuring it). */
  hideToolbar?: boolean
  /** Hide table/cards/pagination (toolbar-only mode for alternate layouts like kanban). */
  hideBody?: boolean
  exportFormats?: Array<'pdf' | 'excel'>

  onRowClick?: (row: T) => void
  /** Accessible record name used for row activation and selection controls. */
  rowLabel?: (row: T) => string
  rowActions?: (row: T) => ReactNode
  cardAccent?: (row: T) => string
  renderCard?: (row: T) => ReactNode
  /** Per-row inline style override — e.g. a left border colored by status. */
  rowStyle?: (row: T) => CSSProperties
  rowClassName?: (row: T) => string

  selectable?: boolean
  bulkActions?: (ctx: { rows: T[]; clear: () => void }) => ReactNode

  createAction?: ReactNode
  quickStats?: ReactNode
  onRefresh?: () => void
  onImport?: () => void
  exportTitle?: string
  exportFilename?: string
}

export default function DataTable<T>({
  tableId,
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  emptyMessage,
  emptyAction,
  searchPlaceholder,
  hideSearch,
  searchValue,
  onSearchChange,
  clientSearch = true,
  perPage = 20,
  primaryFilters,
  advancedFilters,
  activeFilters,
  onClearFilters,
  hideColumnFilters,
  layoutViews,
  showColumns,
  showSavedViews = false,
  overflowActions,
  hideToolbar,
  hideBody,
  exportFormats = ['pdf', 'excel'],
  onRowClick,
  rowLabel,
  rowActions,
  cardAccent,
  renderCard,
  rowStyle,
  rowClassName,
  selectable,
  bulkActions,
  createAction,
  quickStats,
  onRefresh,
  onImport,
  exportTitle,
  exportFilename,
}: DataTableProps<T>) {
  const tableRootRef = useRef<HTMLDivElement | null>(null)
  const breakpoint = useTableBreakpoint(tableRootRef)
  const { prefs, setVisibleColumnKeys, saveView, deleteView } = useTablePreferences(tableId)

  const [internalSearch, setInternalSearch] = useState('')
  const search = searchValue !== undefined ? searchValue : internalSearch
  const setSearch = (value: string) => {
    if (onSearchChange) onSearchChange(value)
    if (searchValue === undefined) setInternalSearch(value)
  }

  const [filterRules, setFilterRules] = useState<FilterRule[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const pickableColumns = useMemo(
    () => columns.filter(c => c.priority <= 3),
    [columns],
  )

  const eligibleColumns = useMemo(() => {
    if (breakpoint === 'mobile') return columns.filter(c => c.priority === 1)
    const cap = PRIORITY_CAP[breakpoint]
    return columns.filter(c => c.priority <= cap)
  }, [columns, breakpoint])

  // Column picker lists every toggleable column (not only the breakpoint default set).
  const eligibleKeys = useMemo(() => new Set(pickableColumns.map(c => c.key)), [pickableColumns])

  const visibleColumns = useMemo(() => {
    if (!prefs.visibleColumnKeys) return eligibleColumns
    const selected = new Set(prefs.visibleColumnKeys)
    // Honour explicit user picks across breakpoints; always keep priority-1 columns.
    return pickableColumns.filter(c => c.priority === 1 || selected.has(c.key))
  }, [eligibleColumns, pickableColumns, prefs.visibleColumnKeys])

  const visibleKeys = useMemo(() => new Set(visibleColumns.map(c => c.key)), [visibleColumns])

  const tableMinWidth = useMemo(
    () => estimateTableMinWidth(visibleColumns, {
      selectable: Boolean(selectable),
      hasRowActions: Boolean(rowActions),
    }),
    [visibleColumns, selectable, rowActions],
  )

  const filteredRows = useMemo(() => {
    let result = rows
    if (clientSearch && search.trim()) {
      const needle = search.trim().toLowerCase()
      result = result.filter(row =>
        eligibleColumns.some(col => {
          const raw = getColumnValue(col, row, 'search')
          return String(raw ?? '').toLowerCase().includes(needle)
        })
      )
    }
    if (filterRules.length > 0) {
      result = result.filter(row => applyFilterRules(row, columns, filterRules))
    }
    return result
  }, [rows, search, filterRules, eligibleColumns, columns, clientSearch])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / perPage))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageRows = useMemo(() => {
    const start = (page - 1) * perPage
    return filteredRows.slice(start, start + perPage)
  }, [filteredRows, page, perPage])

  function toggleSelected(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedRows = useMemo(
    () => filteredRows.filter(row => selectedKeys.has(rowKey(row))),
    [filteredRows, selectedKeys, rowKey],
  )

  function applyView(view: SavedView) {
    setSearch(view.search)
    setVisibleColumnKeys(view.visibleColumnKeys)
    setPage(1)
  }

  function saveCurrentView(name: string) {
    saveView({
      id: `${Date.now()}`,
      name,
      search,
      visibleColumnKeys: visibleColumns.map(c => c.key),
      density: prefs.density,
    })
  }

  const exportHeaders = exportTitle ? eligibleColumns.map(c => c.label) : undefined
  const exportRows: ExportRow[] | undefined = exportTitle
    ? filteredRows.map(row =>
        eligibleColumns.map(col => {
          const value = getColumnValue(col, row, 'export')
          return typeof value === 'number' || typeof value === 'string' ? value : String(value ?? '')
        }),
      )
    : undefined

  const exportOptions: ExportMenuOption[] | undefined = useMemo(() => {
    if (!exportTitle || !exportHeaders || !exportRows) return undefined
    const filename = exportFilename ?? exportTitle
    const options: ExportMenuOption[] = []
    if (exportFormats.includes('pdf')) {
      options.push({
        id: 'pdf',
        label: 'Export PDF',
        onSelect: () => exportToPDF(exportTitle, exportHeaders, exportRows, filename),
      })
    }
    if (exportFormats.includes('excel')) {
      options.push({
        id: 'excel',
        label: 'Export Excel',
        onSelect: () => exportToExcel(exportTitle, exportHeaders, exportRows, filename),
      })
    }
    return options
  }, [exportTitle, exportHeaders, exportRows, exportFilename, exportFormats])

  const clearFilters = () => {
    setFilterRules([])
    onClearFilters?.()
    setPage(1)
  }

  return (
    <div ref={tableRootRef} className="flex flex-col min-w-0">
      {!hideToolbar && (
        <DataTableToolbar
          columns={pickableColumns}
          eligibleKeys={eligibleKeys}
          visibleKeys={visibleKeys}
          onVisibleKeysChange={setVisibleColumnKeys}
          breakpoint={breakpoint}
          search={search}
          onSearchChange={v => { setSearch(v); setPage(1) }}
          searchPlaceholder={searchPlaceholder}
          hideSearch={hideSearch}
          primaryFilters={primaryFilters}
          advancedFilters={advancedFilters}
          activeFilters={activeFilters}
          onClearFilters={(primaryFilters?.length || activeFilters?.length || filterRules.length) ? clearFilters : undefined}
          activeFilterCount={filterRules.length}
          onOpenColumnFilters={hideColumnFilters ? undefined : () => setFiltersOpen(true)}
          layoutViews={layoutViews}
          showColumns={showColumns ?? columns.length > 4}
          showSavedViews={showSavedViews}
          savedViews={prefs.savedViews}
          onApplyView={applyView}
          onSaveView={saveCurrentView}
          onDeleteView={deleteView}
          onRefresh={onRefresh}
          onImport={onImport}
          exportOptions={exportOptions}
          overflowActions={overflowActions}
          createAction={createAction}
          quickStats={quickStats}
          selectedCount={selectedRows.length}
          onClearSelection={() => setSelectedKeys(new Set())}
          bulkActions={bulkActions ? bulkActions({ rows: selectedRows, clear: () => setSelectedKeys(new Set()) }) : undefined}
          loading={isLoading}
        />
      )}

      {filtersOpen && (
        <AdvancedFilters
          columns={eligibleColumns}
          rules={filterRules}
          onChange={rules => { setFilterRules(rules); setPage(1) }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {!hideBody && (
        <>
          {breakpoint === 'mobile' ? (
            <MobileCardView
              columns={visibleColumns}
              rows={pageRows}
              rowKey={rowKey}
              isLoading={isLoading}
              error={error}
              emptyMessage={emptyMessage}
              emptyAction={emptyAction}
              onRowClick={onRowClick}
              rowActions={rowActions}
              cardAccent={cardAccent}
              renderCard={renderCard}
            />
          ) : (
            <Table
              tableId={tableId}
              minWidth={tableMinWidth}
              cols={[
                ...(selectable ? [{ label: '', width: '36px' }] : []),
                ...visibleColumns.map(c => ({
                  label: c.label,
                  // Status pills need room for labels like "Not paid"; prefer the
                  // column's own width when wider, otherwise a 140px floor.
                  width: c.key.toLowerCase().includes('status')
                    ? (c.width?.endsWith('px') && Number.parseInt(c.width, 10) > 140 ? c.width : '140px')
                    : c.width,
                  minWidth: c.key.toLowerCase().includes('status') ? 140 : undefined,
                  sticky: c.key.toLowerCase().includes('status') ? ('right' as const) : undefined,
                })),
                ...(rowActions ? [{ label: 'Actions', width: '120px', minWidth: 120, sticky: 'right' as const }] : []),
              ]}
              isLoading={isLoading}
              error={error}
              empty={emptyMessage}
              emptyAction={emptyAction}
              hideColumnMenu
            >
              {pageRows.map(row => {
                const key = rowKey(row)
                const accessibleRowLabel = rowLabel?.(row) || key
                return (
                  <div
                    key={key}
                    role="row"
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={onRowClick ? `${accessibleRowLabel}, open record` : undefined}
                    className={`table-row ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(row) : ''}`}
                    style={rowStyle ? rowStyle(row) : undefined}
                    onClick={onRowClick ? event => {
                      if (!isInteractiveTarget(event.target)) onRowClick(row)
                    } : undefined}
                    onKeyDown={onRowClick ? event => {
                      if (event.key === 'Enter' && event.target === event.currentTarget) {
                        event.preventDefault()
                        onRowClick(row)
                      }
                    } : undefined}
                  >
                    {selectable && (
                      <span role="gridcell">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          onChange={() => toggleSelected(key)}
                          aria-label={`Select ${accessibleRowLabel}`}
                          style={{ accentColor: 'var(--primary)' }}
                        />
                      </span>
                    )}
                    {visibleColumns.map(col => (
                      <span
                        role="gridcell"
                        key={col.key}
                        className={[
                          'data-table-cell',
                          `data-table-cell-${col.key.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}`,
                          col.key.toLowerCase().includes('status') ? 'data-table-cell-sticky-right' : '',
                        ].filter(Boolean).join(' ')}
                        style={col.align ? { textAlign: col.align } : undefined}
                      >
                        {col.render(row)}
                      </span>
                    ))}
                    {rowActions && (
                      <span role="gridcell" className="data-table-actions data-table-cell-sticky-right flex items-center justify-end gap-1.5">
                        {rowActions(row)}
                      </span>
                    )}
                  </div>
                )
              })}
            </Table>
          )}

          <Pagination page={page} total={filteredRows.length} perPage={perPage} onChange={setPage} />
        </>
      )}
    </div>
  )
}
