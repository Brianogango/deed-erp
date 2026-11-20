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
  /** Tick boxes on the cards when the table lets rows be selected (bulk actions). */
  selection?: { isSelected: (row: T) => boolean; toggle: (row: T) => void }
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
      {rows.map(row => {
        // On a phone a table that lets rows be ticked had no tick boxes, so
        // its bulk actions (print labels, delete…) could not be reached.
        const withTick = (key: string, card: ReactNode) => selection ? (
          <div key={key} className="flex items-stretch gap-2">
            <label className="flex w-9 shrink-0 cursor-pointer items-start justify-center pt-4" aria-label="Select">
              <input type="checkbox" className="h-[18px] w-[18px]" checked={selection.isSelected(row)} onChange={() => selection.toggle(row)} />
            </label>
            <div className="min-w-0 flex-1">{card}</div>
          </div>
        ) : <div key={key}>{card}</div>
        if (renderCard) {
          // A list that draws its own rows: the tick box sits inside the row,
          // and the whole row toggles it (its own buttons excepted).
          if (!selection) return <div key={rowKey(row)}>{renderCard(row)}</div>
          const on = selection.isSelected(row)
          return (
            <div
              key={rowKey(row)}
              className={`dt-select-row${on ? ' is-selected' : ''}`}
              onClick={e => {
                if ((e.target as HTMLElement).closest('button, a, input, label, [role="menu"]')) return
                selection.toggle(row)
              }}
            >
              <input type="checkbox" className="dt-select-row__tick" checked={on} onChange={() => selection.toggle(row)} aria-label="Select" />
              <div className="min-w-0 flex-1">{renderCard(row)}</div>
            </div>
          )
        }
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
