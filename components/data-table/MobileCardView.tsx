'use client'

import { useRef, useState, type ReactNode } from 'react'
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
  /**
   * Rows can be ticked for bulk actions. On a phone the tick boxes stay
   * hidden until the person asks to select ("Select", or holding a card);
   * until then a tap opens the record.
   */
  selection?: { isSelected: (row: T) => boolean; toggle: (row: T) => void; count: number; clear: () => void }
  /**
   * 'lines': a statement or register — one tight line per row (name left,
   * amount right, an optional second line), no boxed cards. For reports
   * (cash flow, ageing) and lists of accounts or journals.
   */
  variant?: 'cards' | 'lines'
  /** Second line of a 'lines' row (defaults to the subtitle column). */
  lineSubtitle?: (row: T) => ReactNode
  /** First line of a 'lines' row (defaults to the first column). */
  lineTitle?: (row: T) => ReactNode
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
  selection,
  variant = 'cards',
  lineSubtitle,
  lineTitle,
}: MobileCardViewProps<T>) {
  const [selecting, setSelecting] = useState(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRow = useRef<string | null>(null)
  const choosing = !!selection && (selecting || selection.count > 0)

  const stopHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null } }
  /** Hold a card for half a second to start selecting with it ticked. */
  const holdHandlers = (row: T, key: string) => selection && !choosing ? {
    onPointerDown: () => {
      stopHold()
      holdTimer.current = setTimeout(() => {
        heldRow.current = key
        setSelecting(true)
        selection.toggle(row)
      }, 450)
    },
    onPointerUp: stopHold,
    onPointerLeave: stopHold,
    onPointerCancel: stopHold,
    onContextMenu: (e: React.MouseEvent) => { if (heldRow.current === key) e.preventDefault() },
    // The click that ends a hold must not also open the record.
    onClickCapture: (e: React.MouseEvent) => {
      if (heldRow.current === key) { e.preventDefault(); e.stopPropagation(); heldRow.current = null }
    },
  } : {}

  const selectBar = selection && rows.length > 0 ? (
    <div className="dt-select-bar">
      {choosing ? (
        <>
          <span>{selection.count === 0 ? 'Tap records to select' : `${selection.count} selected`}</span>
          <button type="button" onClick={() => { selection.clear(); setSelecting(false) }}>Done</button>
        </>
      ) : (
        <button type="button" onClick={() => setSelecting(true)}>Select</button>
      )}
    </div>
  ) : null

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

  // Default record layout (bespoke `renderCard` wins when supplied):
  //   title    → first priority-1 column (reference / name)
  //   status   → first status column, top-right
  //   amount   → first right-aligned (money) column, top-right
  //   subtitle → first remaining left-aligned column (counterparty / description)
  //   meta     → everything else at priority 1, as flat label/value pairs
  const priority1 = columns.filter(c => c.priority === 1)
  const [titleCol, ...others] = priority1
  const isStatus = (c: ColumnDef<T>) => c.key.toLowerCase().includes('status')
  const statusCol = others.find(isStatus)
  const amountCol = others.find(c => c.align === 'right' && c !== statusCol)
  const subtitleCol = others.find(c => c !== statusCol && c !== amountCol && c.align !== 'right')
  const metaCols = others.filter(c => c !== statusCol && c !== amountCol && c !== subtitleCol)
  // A card that opens its record is a summary: two more facts at most, the
  // rest are a tap away. Every extra column used to become another label row,
  // so a phone showed two or three records at a time. A card that cannot be
  // opened keeps all of them — it is the only place they appear.
  const cardMetaCols = onRowClick ? metaCols.slice(0, 2) : metaCols

  if (variant === 'lines') {
    return (
      <ul className="dt-lines">
        {rows.map(row => {
          const sub = lineSubtitle ? lineSubtitle(row) : subtitleCol ? subtitleCol.render(row) : null
          const body = (
            <>
              <span className="dt-line__main">
                <span className="dt-line__title">{lineTitle ? lineTitle(row) : titleCol ? titleCol.render(row) : rowKey(row)}</span>
                {sub ? <span className="dt-line__sub">{sub}</span> : null}
              </span>
              <span className="dt-line__end">
                {amountCol ? <span className="dt-line__amount">{amountCol.render(row)}</span> : null}
                {statusCol ? <span className="dt-line__status">{statusCol.render(row)}</span> : null}
              </span>
            </>
          )
          return (
            <li key={rowKey(row)}>
              {onRowClick ? (
                <button type="button" className="dt-line is-tappable" onClick={() => onRowClick(row)}>{body}</button>
              ) : (
                <div className="dt-line">
                  {body}
                  {rowActions ? <span className="dt-line__actions">{rowActions(row)}</span> : null}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 p-3 sm:p-4">
      {selectBar}
      {rows.map(row => {
        const key = rowKey(row)
        // Selecting: a tap anywhere on the card ticks it (nothing inside
        // opens); the tick sits inside the card's row.
        const withTick = (k: string, card: ReactNode) => {
          if (!selection) return <div key={k}>{card}</div>
          if (!choosing) return <div key={k} className="dt-hold-row" {...holdHandlers(row, k)}>{card}</div>
          const on = selection.isSelected(row)
          return (
            <div
              key={k}
              className={`dt-select-row${on ? ' is-selected' : ''}`}
              onClickCapture={e => { e.preventDefault(); e.stopPropagation(); selection.toggle(row) }}
            >
              <input type="checkbox" className="dt-select-row__tick" checked={on} readOnly tabIndex={-1} aria-label="Select" />
              <div className="min-w-0 flex-1">{card}</div>
            </div>
          )
        }
        if (renderCard) return withTick(key, renderCard(row))
        return withTick(rowKey(row),
          <RecordCard
            key={rowKey(row)}
            title={titleCol ? titleCol.render(row) : rowKey(row)}
            subtitle={subtitleCol ? subtitleCol.render(row) : undefined}
            amount={amountCol ? amountCol.render(row) : undefined}
            status={statusCol ? statusCol.render(row) : undefined}
            meta={cardMetaCols.map(c => ({ label: c.label, value: c.render(row) }))}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            actions={rowActions ? rowActions(row) : undefined}
            accent={cardAccent ? cardAccent(row) : undefined}
          />,
        )
      })}
    </div>
  )
}
