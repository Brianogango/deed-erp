'use client'

import type { ReactNode } from 'react'
import { StatusBadge } from './StatusBadge'

/**
 * Consistent record-detail header:
 * Back | title/entity | status | primary action | secondary/More
 * followed by optional workflow progress / blocker context.
 */
export function RecordHeader({
  title,
  entity,
  status,
  statusLabel,
  primaryAction,
  secondaryActions,
  smartButtons,
  workflow,
  blocker,
  breadcrumbs,
  onBack,
  backLabel = 'Back',
}: {
  title: string
  entity?: string
  status?: string
  statusLabel?: string
  primaryAction?: ReactNode
  secondaryActions?: ReactNode
  smartButtons?: ReactNode
  workflow?: ReactNode
  blocker?: ReactNode
  breadcrumbs?: ReactNode
  onBack?: () => void
  backLabel?: string
}) {
  return (
    <header className="erp-record-header">
      {breadcrumbs && <div className="erp-record-breadcrumbs w-full">{breadcrumbs}</div>}
      <div className="erp-record-header-main">
        {onBack && (
          <button type="button" className="btn-ghost erp-action-btn" onClick={onBack} aria-label={backLabel}>
            ← <span className="hidden sm:inline">{backLabel}</span>
          </button>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="erp-record-title">{title}</h2>
            {status && <StatusBadge status={status} label={statusLabel} />}
          </div>
          {entity && <p className="erp-record-entity">{entity}</p>}
        </div>
      </div>
      <div className="erp-record-header__actions section-actions flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
        {primaryAction}
        {secondaryActions}
      </div>
      {blocker && (
        <div className="w-full rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning-text)]" role="status">
          {blocker}
        </div>
      )}
      {workflow && <div className="w-full">{workflow}</div>}
      {smartButtons && <div className="erp-smart-buttons">{smartButtons}</div>}
    </header>
  )
}
