'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const
const DEFAULT_PAGE_SIZE = 10

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function listContextKey(searchParams: URLSearchParams) {
  return [
    searchParams.get('tab') ?? 'quotations',
    searchParams.get('filter') ?? 'all',
    searchParams.get('q') ?? '',
    searchParams.get('layout') ?? 'table',
  ].join('|')
}

/**
 * Pagination for the legacy Sales workbench list.
 *
 * Sales.tsx still owns filtering, search, row selection and navigation. This
 * component only pages the already-filtered table rows and keeps the page in
 * the URL so browser Back/Forward restores the user's exact list position.
 * It can be removed once the Sales list migrates to the shared DataTable.
 */
export default function SalesListPagination() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [rowCount, setRowCount] = useState(0)
  const contextRef = useRef('')

  const page = positiveInt(searchParams.get('page'), 1)
  const pageSizeRaw = positiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE)
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeRaw as (typeof PAGE_SIZE_OPTIONS)[number])
    ? pageSizeRaw
    : DEFAULT_PAGE_SIZE
  const contextKey = useMemo(() => listContextKey(searchParams), [searchParams])

  const updateQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key)
      else next.set(key, value)
    })
    const query = next.toString()
    router.replace(query ? `/sales?${query}` : '/sales', { scroll: false })
  }

  // Search/filter/tab/layout changes always restart from page 1. This prevents
  // an old page number from making a newly-filtered result set look empty.
  useEffect(() => {
    if (!contextRef.current) {
      contextRef.current = contextKey
      return
    }
    if (contextRef.current === contextKey) return
    contextRef.current = contextKey
    if (page !== 1) updateQuery({ page: null })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey])

  useEffect(() => {
    let observer: MutationObserver | null = null
    let frame = 0
    let currentHost: HTMLElement | null = null

    const sync = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const workbench = document.querySelector<HTMLElement>('.sales-workbench[data-sales-view="list"]')
        const panel = workbench?.querySelector<HTMLElement>('.sp-panel') ?? null
        const tbody = workbench?.querySelector<HTMLTableSectionElement>('.sp-list-table tbody') ?? null

        if (!workbench || !panel || !tbody) {
          if (currentHost?.isConnected) currentHost.remove()
          currentHost = null
          setHost(null)
          setRowCount(0)
          return
        }

        const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr')).filter(
          row => !row.classList.contains('sales-list-empty-row'),
        )
        setRowCount(rows.length)

        const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
        const safePage = Math.min(page, totalPages)
        const start = (safePage - 1) * pageSize
        const end = start + pageSize

        rows.forEach((row, index) => {
          const visible = index >= start && index < end
          row.hidden = !visible
          row.setAttribute('aria-hidden', visible ? 'false' : 'true')
        })

        if (page > totalPages) {
          updateQuery({ page: totalPages > 1 ? String(totalPages) : null })
        }

        if (!currentHost || !currentHost.isConnected || currentHost.parentElement !== panel) {
          currentHost?.remove()
          currentHost = document.createElement('div')
          currentHost.className = 'sales-pagination-host'
          panel.appendChild(currentHost)
          setHost(currentHost)
        }
      })
    }

    sync()
    observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', sync)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', sync)
      window.cancelAnimationFrame(frame)
      document.querySelectorAll('.sp-list-table tbody tr[aria-hidden]').forEach(row => {
        const el = row as HTMLTableRowElement
        el.hidden = false
        el.removeAttribute('aria-hidden')
      })
      currentHost?.remove()
    }
  // Intentionally re-run when page/pageSize/list context changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, contextKey])

  if (!host || rowCount <= PAGE_SIZE_OPTIONS[0]) return null

  const totalPages = Math.max(1, Math.ceil(rowCount / pageSize))
  const safePage = Math.min(page, totalPages)
  const from = rowCount === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(rowCount, safePage * pageSize)

  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter(number => {
    if (totalPages <= 7) return true
    if (number === 1 || number === totalPages) return true
    return Math.abs(number - safePage) <= 1
  })

  return createPortal(
    <nav
      className="sales-list-pagination flex flex-col gap-2 border-t border-[var(--sp-border)] bg-[var(--sp-surface)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
      aria-label="Sales list pagination"
    >
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <span className="text-[11px] font-medium text-[var(--sp-text-3)]">
          {from}–{to} of {rowCount}
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--sp-text-3)]">
          <span className="hidden xs:inline">Rows</span>
          <select
            className="min-h-9 rounded-md border border-[var(--sp-border)] bg-[var(--sp-surface)] px-2 text-[11px] font-semibold text-[var(--sp-text-2)]"
            aria-label="Rows per page"
            value={pageSize}
            onChange={event => updateQuery({ pageSize: event.target.value, page: null })}
          >
            {PAGE_SIZE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-1 sm:justify-end">
        <button
          type="button"
          className="sp-btn min-h-10 px-3 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={safePage <= 1}
          onClick={() => updateQuery({ page: safePage - 1 <= 1 ? null : String(safePage - 1) })}
          aria-label="Previous sales page"
        >
          Previous
        </button>

        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-1" aria-label={`Page ${safePage} of ${totalPages}`}>
          {pageNumbers.map((number, index) => {
            const previous = pageNumbers[index - 1]
            const hasGap = previous && number - previous > 1
            return (
              <span key={number} className="flex items-center gap-1">
                {hasGap && <span className="px-1 text-[11px] text-[var(--sp-text-3)]" aria-hidden="true">…</span>}
                <button
                  type="button"
                  className={`min-h-10 min-w-10 rounded-md border px-2 text-[11px] font-bold transition-colors ${
                    number === safePage
                      ? 'border-[var(--sales-blue,#2563eb)] bg-[var(--sales-blue,#2563eb)] text-white'
                      : 'border-[var(--sp-border)] bg-[var(--sp-surface)] text-[var(--sp-text-2)] hover:bg-[var(--sp-grey-bg)]'
                  }`}
                  aria-current={number === safePage ? 'page' : undefined}
                  aria-label={`Go to sales page ${number}`}
                  onClick={() => updateQuery({ page: number === 1 ? null : String(number) })}
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
          onClick={() => updateQuery({ page: String(safePage + 1) })}
          aria-label="Next sales page"
        >
          Next
        </button>
      </div>
    </nav>,
    host,
  )
}
