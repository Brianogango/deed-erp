'use client'

import { useState } from 'react'
import type { ActiveFilterChip } from '@/lib/data-table/toolbar-types'

interface ActiveFilterChipsProps {
  filters: ActiveFilterChip[]
  onClearAll?: () => void
  /** Collapse chips beyond this count (mobile-friendly). */
  maxVisible?: number
}

export default function ActiveFilterChips({
  filters,
  onClearAll,
  maxVisible,
}: ActiveFilterChipsProps) {
  const [expanded, setExpanded] = useState(false)
  if (filters.length === 0) return null

  const limit = maxVisible && !expanded ? maxVisible : filters.length
  const visible = filters.slice(0, limit)
  const hiddenCount = filters.length - visible.length

  return (
    <div className="dt-active-filters" role="list" aria-label="Active filters">
      {visible.map(filter => (
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
      {hiddenCount > 0 && (
        <button
          type="button"
          className="dt-filter-chip dt-filter-chip-more"
          onClick={() => setExpanded(true)}
          aria-label={`Show ${hiddenCount} more active filters`}
        >
          +{hiddenCount} more ▾
        </button>
      )}
      {expanded && maxVisible && filters.length > maxVisible && (
        <button
          type="button"
          className="dt-filter-clear-all"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
      {onClearAll && (
        <button type="button" className="dt-filter-clear-all" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  )
}
