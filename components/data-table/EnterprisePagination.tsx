'use client'

import { useMemo } from 'react'

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50] as const

function normaliseOptions(options: readonly number[], current: number) {
  return Array.from(new Set([...options, current]))
    .map(value => Math.max(1, Math.floor(Number(value) || 1)))
    .sort((a, b) => a - b)
}

export interface EnterprisePaginationProps {
  page: number
  total: number
  perPage: number
  onChange: (page: number) => void
  onPerPageChange?: (perPage: number) => void
  pageSizeOptions?: readonly number[]
  ariaLabel?: string
  itemLabel?: string
  showPageSizeSelector?: boolean
}

/**
 * Shared operational-list pagination. Mirrors the Sales pager but is reusable
 * by DataTable-backed modules (Repair, Accounting, Purchases, Inventory, etc.).
 */
export default function EnterprisePagination({
  page,
  total,
  perPage,
  onChange,
  onPerPageChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  ariaLabel = 'List pagination',
  itemLabel = 'records',
  showPageSizeSelector = true,
}: EnterprisePaginationProps) {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0))
  const safePerPage = Math.max(1, Math.floor(Number(perPage) || 10))
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePerPage))
  const safePage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), totalPages)
  const options = useMemo(
    () => normaliseOptions(pageSizeOptions, safePerPage),
    [pageSizeOptions, safePerPage],
  )
  const smallestOption = Math.min(...options)

  if (safeTotal <= smallestOption) return null

  const from = safeTotal === 0 ? 0 : (safePage - 1) * safePerPage + 1
  const to = Math.min(safeTotal, safePage * safePerPage)
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter(number => {
    if (totalPages <= 7) return true
    if (number === 1 || number === totalPages) return true
    return Math.abs(number - safePage) <= 1
  })

  return (
    <nav
      className="enterprise-pagination flex flex-col gap-2 border-t border-[var(--sp-border,var(--border))] bg-[var(--sp-surface,var(--bg-card))] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
      aria-label={ariaLabel}
    >
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <span className="text-[11px] font-medium text-[var(--sp-text-3,var(--text-3))]">
          {from}–{to} of {safeTotal} {itemLabel}
        </span>
        {showPageSizeSelector && onPerPageChange ? (
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--sp-text-3,var(--text-3))]">
            <span className="hidden xs:inline">Rows</span>
            <select
              className="min-h-9 rounded-md border border-[var(--sp-border,var(--border))] bg-[var(--sp-surface,var(--bg-card))] px-2 text-[11px] font-semibold text-[var(--sp-text-2,var(--text-2))]"
              aria-label="Rows per page"
              value={safePerPage}
              onChange={event => onPerPageChange(Number(event.target.value))}
            >
              {options.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-1 sm:justify-end">
        <button
          type="button"
          className="sp-btn min-h-10 px-3 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={safePage <= 1}
          onClick={() => onChange(safePage - 1)}
          aria-label="Previous page"
        >
          Previous
        </button>

        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-1" aria-label={`Page ${safePage} of ${totalPages}`}>
          {pageNumbers.map((number, index) => {
            const previous = pageNumbers[index - 1]
            const hasGap = Boolean(previous && number - previous > 1)
            return (
              <span key={number} className="flex items-center gap-1">
                {hasGap && <span className="px-1 text-[11px] text-[var(--sp-text-3,var(--text-3))]" aria-hidden="true">…</span>}
                <button
                  type="button"
                  className={`min-h-10 min-w-10 rounded-md border px-2 text-[11px] font-bold transition-colors ${
                    number === safePage
                      ? 'border-[var(--primary,#2563eb)] bg-[var(--primary,#2563eb)] text-white'
                      : 'border-[var(--sp-border,var(--border))] bg-[var(--sp-surface,var(--bg-card))] text-[var(--sp-text-2,var(--text-2))] hover:bg-[var(--sp-grey-bg,var(--bg-muted))]'
                  }`}
                  aria-current={number === safePage ? 'page' : undefined}
                  aria-label={`Go to page ${number}`}
                  onClick={() => onChange(number)}
                >
                  {number}
                </button>
              </span>
            )
          })}
        </div>

        <button
          type="button"
          className="sp-btn min-h-10 px-3 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={safePage >= totalPages}
          onClick={() => onChange(safePage + 1)}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  )
}
