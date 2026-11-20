'use client'

import type { ReactNode } from 'react'

interface BulkActionsBarProps {
  selectedCount: number
  onClear: () => void
  actions: ReactNode
}

// Appears in place of the normal toolbar row when rows are selected.
// Purely presentational — the caller's `actions` supply real handlers,
// this never assumes what "bulk" means for a given module.
export default function BulkActionsBar({ selectedCount, onClear, actions }: BulkActionsBarProps) {
  if (selectedCount === 0) return null
  return (
    // On a phone: count and Clear on the first line, the actions across the
    // full width below (they were squeezed into a narrow middle column).
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 px-3 py-2">
      <span className="text-[11px] font-bold text-[var(--text-1)] whitespace-nowrap">
        {selectedCount} selected
      </span>
      <div className="order-last flex basis-full flex-wrap items-center gap-2 sm:order-none sm:basis-auto">{actions}</div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-[11px] font-semibold text-[var(--text-3)] hover:text-[var(--text-1)]"
      >
        Clear
      </button>
    </div>
  )
}
