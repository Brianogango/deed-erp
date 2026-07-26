'use client'

import type { ReactNode } from 'react'
import { StatusBadge } from './StatusBadge'

/**
 * Consistent record-detail header:
 * title · entity · status · primary action · overflow
 */
export function RecordHeader({
  title,
  entity,
  status,
  statusLabel,
  primaryAction,
  secondaryActions,
  smartButtons,
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
  onBack?: () => void
  backLabel?: string
}) {
  return (
    <header className="erp-record-header">
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
      <div className="section-actions flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
        {primaryAction}
        {secondaryActions}
      </div>
      {smartButtons && <div className="erp-smart-buttons">{smartButtons}</div>}
    </header>
  )
}
