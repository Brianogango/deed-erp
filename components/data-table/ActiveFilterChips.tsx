'use client'

import type { ActiveFilterChip } from '@/lib/data-table/toolbar-types'

interface ActiveFilterChipsProps {
  filters: ActiveFilterChip[]
  onClearAll?: () => void
}

export default function ActiveFilterChips({ filters, onClearAll }: ActiveFilterChipsProps) {
  if (filters.length === 0) return null

  return (
    <div className="dt-active-filters" role="list" aria-label="Active filters">
      {filters.map(filter => (
        <span key={filter.key} className="dt-filter-chip" role="listitem">
          <span className="dt-filter-chip-text">
            {filter.label}: {filter.valueLabel}
          </span>
          <button
            type="button"
            className="dt-filter-chip-remove"
            onClick={filter.onRemove}
            aria-label={`Remove ${filter.label} filter`}
          >
            ×
          </button>
        </span>
      ))}
      {onClearAll && (
        <button type="button" className="dt-filter-clear-all" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  )
}
