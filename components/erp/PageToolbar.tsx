'use client'

import type { ReactNode } from 'react'

/**
 * Compact operational toolbar:
 * [ Search | Filters | View ]                    [ Export | More ]
 *
 * On narrow screens the search surface gets the full row while filters,
 * views and actions wrap below it with touch-safe spacing.
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
      className={`erp-page-toolbar flex min-w-0 flex-col gap-2 sm:gap-2.5 lg:flex-row lg:items-center lg:justify-between ${className}`.trim()}
      role="region"
      aria-label={ariaLabel}
    >
      <div className="erp-page-toolbar-left flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {search && <div className="erp-page-toolbar-search min-w-0 w-full sm:flex-1">{search}</div>}
        {filters && <div className="erp-page-toolbar-filters flex min-w-0 flex-wrap items-center gap-2">{filters}</div>}
        {viewOptions && <div className="erp-page-toolbar-views flex min-w-0 flex-wrap items-center gap-2">{viewOptions}</div>}
      </div>
      {(actions || bulkActions) && (
        <div className="erp-page-toolbar-right flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          {bulkActions}
          {actions}
        </div>
      )}
    </div>
  )
}
