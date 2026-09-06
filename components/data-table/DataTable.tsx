'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Table } from '@/components/ui'
import { exportToExcel, exportToPDF, type ExportRow } from '@/lib/export-utils'
import { useTableBreakpoint } from '@/lib/data-table/use-breakpoint'
import { useTablePreferences } from '@/lib/data-table/use-table-preferences'
import { getColumnSortValue, getColumnValue, isColumnSortable, type ColumnDef, type ColumnPriority, type SavedView } from '@/lib/data-table/types'
import { compareSortValues, nextSortState, type TableSortState } from '@/lib/data-table/sort'
import type {
  ActiveFilterChip,
  ExportMenuOption,
  LayoutViewsConfig,
  OverflowAction,
  PrimaryFilterConfig,
} from '@/lib/data-table/toolbar-types'
import DataTableToolbar from './DataTableToolbar'
import MobileCardView from './MobileCardView'
import EnterprisePagination, { DEFAULT_PAGE_SIZE_OPTIONS } from './EnterprisePagination'
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

function isInteractiveTarget(target: EventTarget | null, currentTarget?: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const match = target.closest('a, button, input, select, textarea, label, [contenteditable="true"]')
  if (!match) return false
  if (currentTarget instanceof Node && (match === currentTarget || !currentTarget.contains(match))) {
    return false
  }
  return true
}

/** Tables fill the card — no artificial scroll floor. */
function estimateTableMinWidth(
  _columns: Array<{ key: string; width?: string }>,
  _options: { selectable?: boolean; hasRowActions?: boolean },
): number {
  return 0
}

function operationalPageSize(requested: number) {
  const safe = Math.max(1, Math.floor(Number(requested) || 10))
  // Preserve intentionally small dashboard widgets and large analytical pages.
  if (safe < 10 || safe > 50) return safe
  // Large operational lists now follow the Sales contract by default.
  if (!DEFAULT_PAGE_SIZE_OPTIONS.includes(safe as (typeof DEFAULT_PAGE_SIZE_OPTIONS)[number])) return 10
  return safe
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
  /** Initial rows per page. Operational values between 10 and 50 normalize to the Sales defaults. */
  perPage?: number
  pageSizeOptions?: readonly number[]
  showPageSizeSelector?: boolean
  /**
   * Controlled 1-based page. Omit to keep page in local state.
   * Pair with `onPageChange` so a parent can persist page in the URL.
   */
  page?: number
  onPageChange?: (page: number) => void

  primaryFilters?: PrimaryFilterConfig[]
  advancedFilters?: ReactNode
  activeFilters?: ActiveFilterChip[]
  onClearFilters?: () => void
  /** Hide the built-in column-condition AdvancedFilters entry point. */
  hideColumnFilters?: boolean
  layoutViews?: LayoutViewsConfig
  showColumns?: boolean
  /** Initial visible desktop/tablet columns before the user saves a preference. */
  defaultVisibleColumnKeys?: string[]
  /** Optional horizontal layout floor for wide business tables. */
  minTableWidth?: number
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
  /** Desktop/tablet width reserved for the Actions column. Mobile cards ignore it. */
  rowActionsWidth?: number
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
  /**
   * Initial sort. Click column headers to change.
   * Example: `{ key: 'intakeDate', direction: 'desc' }` for newest-first repairs.
   */
  defaultSort?: TableSortState | null
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
  perPage = 10,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  showPageSizeSelector = true,
  page: pageProp,
  onPageChange,
  primaryFilters,
  advancedFilters,
  activeFilters,
  onClearFilters,
  hideColumnFilters,
  layoutViews,
  showColumns,
  defaultVisibleColumnKeys,
  minTableWidth,
  showSavedViews = false,
  overflowActions,
  hideToolbar,
  hideBody,
  exportFormats = ['pdf', 'excel'],
  onRowClick,
  rowLabel,
  rowActions,
  rowActionsWidth = 120,
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
  defaultSort = null,
}: DataTableProps<T>) {
  const tableRootRef = useRef<HTMLDivElement | null>(null)
  const breakpoint = useTableBreakpoint(tableRootRef)
  const { prefs, hydrated: prefsHydrated, setVisibleColumnKeys, setSort: persistSort, saveView, deleteView } = useTablePreferences(tableId)

  const [internalSearch, setInternalSearch] = useState('')
  const search = searchValue !== undefined ? searchValue : internalSearch
  const setSearch = (value: string) => {
    if (onSearchChange) onSearchChange(value)
    if (searchValue === undefined) setInternalSearch(value)
  }

  const [filterRules, setFilterRules] = useState<FilterRule[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [internalPage, setInternalPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => operationalPageSize(perPage))
  const page = pageProp ?? internalPage
  const goToPage = (next: number) => {
    const nextPage = Math.max(1, Math.floor(Number(next)) || 1)
    if (pageProp === undefined) setInternalPage(nextPage)
    onPageChange?.(nextPage)
  }
  const changePageSize = (next: number) => {
    setPageSize(Math.max(1, Math.floor(Number(next)) || 10))
    goToPage(1)
  }

  useEffect(() => {
    const next = operationalPageSize(perPage)
    setPageSize(current => current === next ? current : next)
  }, [perPage])

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const selectPageRef = useRef<HTMLInputElement | null>(null)
  const [sort, setSort] = useState<TableSortState | null>(defaultSort)

  // Sort is part of list context too. Persist it per table so an explicit
  // record route (or a module remount) returns to the same ordering.
  useEffect(() => {
    if (!prefsHydrated) return
    const next = prefs.sort === undefined ? defaultSort : prefs.sort
    setSort(prev => (
      prev?.key === next?.key && prev?.direction === next?.direction ? prev : next
    ))
  }, [prefsHydrated, prefs.sort, defaultSort, tableId])

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
    if (!prefs.visibleColumnKeys) {
      if (!defaultVisibleColumnKeys?.length) return eligibleColumns
      const defaults = new Set(defaultVisibleColumnKeys)
      return pickableColumns.filter(column => column.priority === 1 || defaults.has(column.key))
    }
    const selected = new Set(prefs.visibleColumnKeys)
    // Honour explicit user picks across breakpoints; always keep priority-1 columns.
    return pickableColumns.filter(c => c.priority === 1 || selected.has(c.key))
  }, [defaultVisibleColumnKeys, eligibleColumns, pickableColumns, prefs.visibleColumnKeys])

  const visibleKeys = useMemo(() => new Set(visibleColumns.map(c => c.key)), [visibleColumns])

  const tableMinWidth = useMemo(
    () => Math.max(minTableWidth ?? 0, estimateTableMinWidth(visibleColumns, {
      selectable: Boolean(selectable),
      hasRowActions: Boolean(rowActions),
    })),
    [minTableWidth, visibleColumns, selectable, rowActions],
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
    if (sort) {
      const column = columns.find(c => c.key === sort.key)
      if (column && isColumnSortable(column)) {
        const direction = sort.direction === 'asc' ? 1 : -1
        result = [...result].sort((left, right) =>
          direction * compareSortValues(
            getColumnSortValue(column, left),
            getColumnSortValue(column, right),
          ),
        )
      }
    }
    return result
  }, [rows, search, filterRules, eligibleColumns, columns, clientSearch, sort])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  useEffect(() => {
    if (page <= totalPages) return
    // Controlled restore (e.g. /finance?tab=invoices&page=3) can mount before
    // rows hydrate. Clamping to 1 here would wipe the URL page.
    if (filteredRows.length === 0 && pageProp != null) return
    goToPage(totalPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, totalPages, filteredRows.length, pageProp])

  // Reset to page 1 when the user changes sort — not on mount, and not when
  // React Strict Mode re-runs the same effect (that was wiping a restored page).
  const sortKey = `${sort?.key ?? ''}:${sort?.direction ?? ''}`
  const prevSortKey = useRef(sortKey)
  useEffect(() => {
    if (prevSortKey.current === sortKey) return
    prevSortKey.current = sortKey
    goToPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRows.slice(start, start + pageSize)
  }, [filteredRows, page, pageSize])

  const pageKeys = useMemo(() => pageRows.map(rowKey), [pageRows, rowKey])
  const selectedOnPage = pageKeys.filter(key => selectedKeys.has(key)).length
  const allPageRowsSelected = pageKeys.length > 0 && selectedOnPage === pageKeys.length
  const somePageRowsSelected = selectedOnPage > 0 && !allPageRowsSelected
  const hasFooter = visibleColumns.some(column => column.footer)

  useEffect(() => {
    if (selectPageRef.current) selectPageRef.current.indeterminate = somePageRowsSelected
  }, [somePageRowsSelected])

  function togglePageSelection() {
    setSelectedKeys(previous => {
      const next = new Set(previous)
      if (allPageRowsSelected) pageKeys.forEach(key => next.delete(key))
      else pageKeys.forEach(key => next.add(key))
      return next
    })
  }

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
    if (view.sort !== undefined) {
      setSort(view.sort)
      persistSort(view.sort)
    }
    goToPage(1)
  }

  function saveCurrentView(name: string) {
    saveView({
      id: `${Date.now()}`,
      name,
      search,
      visibleColumnKeys: visibleColumns.map(c => c.key),
      density: prefs.density,
      sort,
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
        onSelect: () => { void exportToExcel(exportTitle, exportHeaders, exportRows, filename) },
      })
    }
    return options
  }, [exportTitle, exportHeaders, exportRows, exportFilename, exportFormats])

  const clearFilters = () => {
    setFilterRules([])
    onClearFilters?.()
    goToPage(1)
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
          onSearchChange={v => { setSearch(v); goToPage(1) }}
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
          onChange={rules => { setFilterRules(rules); goToPage(1) }}
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
                ...(selectable ? [{
                  label: 'Select',
                  width: '36px',
                  header: (
                    <input
                      ref={selectPageRef}
                      type="checkbox"
                      checked={allPageRowsSelected}
                      disabled={pageRows.length === 0}
                      onChange={togglePageSelection}
                      aria-label={allPageRowsSelected ? 'Clear selection on this page' : 'Select all rows on this page'}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                  ),
                }] : []),
                ...visibleColumns.map(c => ({
                  label: c.label,
                  // Status pills need room for labels like "Not paid"; prefer the
                  // column's own width when wider, otherwise a 140px floor.
                  width: c.key.toLowerCase().includes('status')
                    ? (c.width?.endsWith('px') && Number.parseInt(c.width, 10) > 140 ? c.width : '140px')
                    : c.width,
                  minWidth: c.key.toLowerCase().includes('status') ? 140 : undefined,
                  sticky: c.key.toLowerCase().includes('status') ? ('right' as const) : undefined,
                  sortable: isColumnSortable(c),
                  sortDirection: sort?.key === c.key ? sort.direction : null,
                  onSortClick: isColumnSortable(c)
                    ? () => {
                        const next = nextSortState(sort, c.key, defaultSort)
                        setSort(next)
                        persistSort(next)
                      }
                    : undefined,
                })),
                ...(rowActions ? [{ label: 'Actions', width: `${rowActionsWidth}px`, minWidth: rowActionsWidth, sticky: 'right' as const }] : []),
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
                      if (!isInteractiveTarget(event.target, event.currentTarget)) onRowClick(row)
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
              {hasFooter && pageRows.length > 0 && (
                <div className="table-row data-table-summary-row" role="row" aria-label="Current page totals">
                  {selectable && <span role="gridcell" />}
                  {visibleColumns.map((column, index) => (
                    <span
                      role="gridcell"
                      key={column.key}
                      className={`data-table-cell data-table-cell-${column.key.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}`}
                      style={column.align ? { textAlign: column.align } : undefined}
                    >
                      {column.footer
                        ? column.footer(pageRows, filteredRows)
                        : index === 0
                          ? <span className="data-table-summary-label">Page total</span>
                          : null}
                    </span>
                  ))}
                  {rowActions && <span role="gridcell" className="data-table-actions" />}
                </div>
              )}
            </Table>
          )}

          <EnterprisePagination
            page={page}
            total={filteredRows.length}
            perPage={pageSize}
            onChange={goToPage}
            onPerPageChange={changePageSize}
            pageSizeOptions={pageSizeOptions}
            showPageSizeSelector={showPageSizeSelector && pageSize <= 50}
            ariaLabel={`${tableId.replace(/[-_]+/g, ' ')} pagination`}
          />
        </>
      )}
    </div>
  )
}
