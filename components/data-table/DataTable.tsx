'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Table, Pagination } from '@/components/ui'
import type { ExportRow } from '@/lib/export-utils'
import { useTableBreakpoint } from '@/lib/data-table/use-breakpoint'
import { useTablePreferences } from '@/lib/data-table/use-table-preferences'
import type { ColumnDef, ColumnPriority, SavedView } from '@/lib/data-table/types'
import DataTableToolbar from './DataTableToolbar'
import MobileCardView from './MobileCardView'
import AdvancedFilters, { applyFilterRules, type FilterRule } from './AdvancedFilters'

// Breakpoint → max column priority allowed in the table view.
// Mobile doesn't use this at all — it renders MobileCardView instead.
const PRIORITY_CAP: Record<'tablet' | 'laptop' | 'desktop', ColumnPriority> = {
  tablet: 1,
  laptop: 2,
  desktop: 3,
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
  /** Suppress DataTable's own search box — pass already-filtered `rows`
   *  when the caller has its own bespoke search/filter UI. */
  hideSearch?: boolean
  perPage?: number

  onRowClick?: (row: T) => void
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
  perPage = 20,
  onRowClick,
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
  const { prefs, setVisibleColumnKeys, setDensity, saveView, deleteView } = useTablePreferences(tableId)

  const [search, setSearch] = useState('')
  const [filterRules, setFilterRules] = useState<FilterRule[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const eligibleColumns = useMemo(() => {
    if (breakpoint === 'mobile') return columns.filter(c => c.priority === 1)
    const cap = PRIORITY_CAP[breakpoint]
    return columns.filter(c => c.priority <= cap)
  }, [columns, breakpoint])

  const eligibleKeys = useMemo(() => new Set(eligibleColumns.map(c => c.key)), [eligibleColumns])

  const visibleColumns = useMemo(() => {
    if (!prefs.visibleColumnKeys) return eligibleColumns
    return eligibleColumns.filter(c => c.priority === 1 || prefs.visibleColumnKeys!.includes(c.key))
  }, [eligibleColumns, prefs.visibleColumnKeys])

  const visibleKeys = useMemo(() => new Set(visibleColumns.map(c => c.key)), [visibleColumns])

  // Filtering: search checks every eligible column's rendered/export value;
  // advanced filter rules are AND-ed on top (see AdvancedFilters.tsx).
  const filteredRows = useMemo(() => {
    let result = rows
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      result = result.filter(row =>
        eligibleColumns.some(col => {
          const raw = col.exportValue ? col.exportValue(row) : col.render(row)
          return String(raw ?? '').toLowerCase().includes(needle)
        })
      )
    }
    if (filterRules.length > 0) {
      result = result.filter(row => applyFilterRules(row, columns, filterRules))
    }
    return result
  }, [rows, search, filterRules, eligibleColumns, columns])

  // Clamp page when the row set shrinks (e.g. an external status filter the
  // caller controls outside this component) so we never render an
  // out-of-range, falsely-empty page.
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
    setDensity(view.density)
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
        eligibleColumns.map(col => (col.exportValue ? col.exportValue(row) : String(col.render(row) ?? ''))),
      )
    : undefined

  const rowPaddingClass = prefs.density === 'compact' ? 'py-1.5' : 'py-3'

  return (
    <div ref={tableRootRef} className="flex flex-col min-w-0">
      <DataTableToolbar
        columns={columns}
        eligibleKeys={eligibleKeys}
        visibleKeys={visibleKeys}
        onVisibleKeysChange={setVisibleColumnKeys}
        search={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder={searchPlaceholder}
        hideSearch={hideSearch}
        activeFilterCount={filterRules.length}
        onOpenFilters={() => setFiltersOpen(true)}
        savedViews={prefs.savedViews}
        onApplyView={applyView}
        onSaveView={saveCurrentView}
        onDeleteView={deleteView}
        density={prefs.density}
        onDensityChange={setDensity}
        onRefresh={onRefresh}
        onImport={onImport}
        exportTitle={exportTitle}
        exportFilename={exportFilename}
        exportHeaders={exportHeaders}
        exportRows={exportRows}
        createAction={createAction}
        quickStats={quickStats}
        selectedCount={selectedRows.length}
        onClearSelection={() => setSelectedKeys(new Set())}
        bulkActions={bulkActions ? bulkActions({ rows: selectedRows, clear: () => setSelectedKeys(new Set()) }) : undefined}
      />

      {filtersOpen && (
        <AdvancedFilters
          columns={eligibleColumns}
          rules={filterRules}
          onChange={rules => { setFilterRules(rules); setPage(1) }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

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
          cols={[
            ...(selectable ? [{ label: '', width: '36px' }] : []),
            ...visibleColumns.map(c => ({ label: c.label, width: c.width })),
            ...(rowActions ? [{ label: '', width: '90px' }] : []),
          ]}
          isLoading={isLoading}
          error={error}
          empty={emptyMessage}
          emptyAction={emptyAction}
        >
          {pageRows.map(row => {
            const key = rowKey(row)
            return (
              <div
                key={key}
                className={`table-row ${rowPaddingClass} ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(row) : ''}`}
                style={rowStyle ? rowStyle(row) : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {selectable && (
                  <span onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(key)}
                      onChange={() => toggleSelected(key)}
                      aria-label="Select row"
                      style={{ accentColor: 'var(--primary)' }}
                    />
                  </span>
                )}
                {visibleColumns.map(col => (
                  <span key={col.key} style={col.align ? { textAlign: col.align } : undefined}>
                    {col.render(row)}
                  </span>
                ))}
                {rowActions && (
                  <span onClick={e => e.stopPropagation()} className="flex items-center justify-end gap-1.5">
                    {rowActions(row)}
                  </span>
                )}
              </div>
            )
          })}
        </Table>
      )}

      <Pagination page={page} total={filteredRows.length} perPage={perPage} onChange={setPage} />
    </div>
  )
}
