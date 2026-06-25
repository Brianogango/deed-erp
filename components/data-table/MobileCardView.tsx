'use client'

import type { ReactNode } from 'react'
import { RecordCard, StatePanel, StateSkeleton } from '@/components/ui'
import type { ColumnDef } from '@/lib/data-table/types'

interface MobileCardViewProps<T> {
  columns: ColumnDef<T>[]
  rows: T[]
  rowKey: (row: T) => string
  isLoading?: boolean
  error?: string | null
  emptyMessage?: string
  emptyAction?: ReactNode
  onRowClick?: (row: T) => void
  rowActions?: (row: T) => ReactNode
  cardAccent?: (row: T) => string
  /** Full override — if supplied, DataTable hands rendering entirely to the caller. */
  renderCard?: (row: T) => ReactNode
}

// Default card layout: first priority-1 column is the title, the rest of
// priority 1 becomes the meta grid. Most Type B tables will want a bespoke
// `renderCard` (e.g. ref as eyebrow, status top-right) — this default exists
// so a table is usable on mobile from day one even before that's written.
export default function MobileCardView<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  emptyMessage = 'No records found',
  emptyAction,
  onRowClick,
  rowActions,
  cardAccent,
  renderCard,
}: MobileCardViewProps<T>) {
  if (isLoading) {
    return <div className="p-4"><StateSkeleton /></div>
  }
  if (error) {
    return <div className="p-4"><StatePanel tone="error" title="Could not load records" description={error} /></div>
  }
  if (rows.length === 0) {
    return (
      <div className="p-4">
        <StatePanel tone="empty" title={emptyMessage} description="Try adjusting filters or create a new record." action={emptyAction} />
      </div>
    )
  }

  const priority1 = columns.filter(c => c.priority === 1)
  const [titleCol, ...restCols] = priority1

  return (
    <div className="flex flex-col gap-2.5 p-3 sm:p-4">
      {rows.map(row => {
        if (renderCard) {
          return <div key={rowKey(row)}>{renderCard(row)}</div>
        }
        return (
          <RecordCard
            key={rowKey(row)}
            title={titleCol ? titleCol.render(row) : rowKey(row)}
            meta={restCols.map(c => ({ label: c.label, value: c.render(row) }))}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            actions={rowActions ? rowActions(row) : undefined}
            accent={cardAccent ? cardAccent(row) : undefined}
          />
        )
      })}
    </div>
  )
}
