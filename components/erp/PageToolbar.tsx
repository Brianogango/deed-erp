'use client'

import type { ReactNode } from 'react'

/**
 * Operational toolbar with a strict phone hierarchy:
 * 1) full-width search
 * 2) horizontally scrollable filters/views
 * 3) horizontally scrollable bulk/page actions
 * This avoids multi-row wrapped controls and inconsistent padding on phones.
 */
export function PageToolbar({
  search,
  filters,
  viewOptions,
  actions,
  bulkActions,
  className = '',
  ariaLabel = 'Page controls',
}: {
  search?: ReactNode
  filters?: ReactNode
  viewOptions?: ReactNode
  actions?: ReactNode
  /** Rendered only when the parent has selected rows. */
  bulkActions?: ReactNode
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      className={`erp-page-toolbar flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between ${className}`.trim()}
      role="region"
      aria-label={ariaLabel}
    >
      <div className="erp-page-toolbar-left flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center">
        {search && <div className="erp-page-toolbar-search min-w-0 w-full lg:max-w-xl lg:flex-1">{search}</div>}
        {(filters || viewOptions) && (
          <div className="erp-page-toolbar-options flex min-w-0 items-center gap-2">
            {filters && <div className="erp-page-toolbar-filters flex min-w-0 items-center gap-2">{filters}</div>}
            {viewOptions && <div className="erp-page-toolbar-views flex min-w-0 items-center gap-2">{viewOptions}</div>}
          </div>
        )}
      </div>
      {(actions || bulkActions) && (
        <div className="erp-page-toolbar-right flex min-w-0 items-center gap-2 lg:justify-end">
          {bulkActions}
          {actions}
        </div>
      )}
    </div>
  )
}
