'use client'

import type { ReactNode } from 'react'

/**
 * Compact operational toolbar:
 * [ Search | Filters | View ]                    [ Export | More ]
 *
 * Advanced filters belong in a drawer / popover, not always-visible rows.
 */
export function PageToolbar({
  search,
  filters,
  viewOptions,
  actions,
  bulkActions,
  className = '',
}: {
  search?: ReactNode
  filters?: ReactNode
  viewOptions?: ReactNode
  actions?: ReactNode
  /** Rendered only when the parent has selected rows. */
  bulkActions?: ReactNode
  className?: string
}) {
  return (
    <div className={`erp-page-toolbar ${className}`.trim()}>
      <div className="erp-page-toolbar-left">
        {search && <div className="erp-page-toolbar-search">{search}</div>}
        {filters && <div className="erp-page-toolbar-filters">{filters}</div>}
        {viewOptions && <div className="erp-page-toolbar-views">{viewOptions}</div>}
      </div>
      {(actions || bulkActions) && (
        <div className="erp-page-toolbar-right">
          {bulkActions}
          {actions}
        </div>
      )}
    </div>
  )
}
