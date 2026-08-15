'use client'

import { useMemo, useState } from 'react'
import { SearchInput } from '@/components/ui'
import { Fa, faPrint, faReceipt } from '@/components/icons'
import { fmtDate, fmtKes, isPosBankPayment, type POSOrder } from '@/lib/store'

export function ticketWhen(order: POSOrder): string {
  if (order.createdAt) {
    const at = new Date(order.createdAt)
    if (!Number.isNaN(at.getTime())) {
      return at.toLocaleString('en-KE', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }
  return fmtDate(order.date)
}

export function ticketLines(order: POSOrder): string {
  const names = (order.lines ?? []).map(line => line.productName).filter(Boolean)
  if (names.length === 0) return '—'
  if (names.length === 1) return names[0]
  return `${names[0]} +${names.length - 1}`
}

export function payLabel(order: POSOrder): string {
  return isPosBankPayment(order.payment) ? 'Bank' : (order.payment || '—')
}

export function filterPosHistoryOrders(orders: POSOrder[], query: string): POSOrder[] {
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? orders.filter(order => {
        const hay = [
          order.ref,
          order.invoiceRef,
          order.customerName,
          payLabel(order),
          ...(order.lines ?? []).map(line => line.productName),
        ].join(' ').toLowerCase()
        return hay.includes(needle)
      })
    : orders
  return [...filtered].sort((a, b) => {
    const aAt = a.createdAt ? Date.parse(a.createdAt) : 0
    const bAt = b.createdAt ? Date.parse(b.createdAt) : 0
    return bAt - aAt
  })
}

export function PosTransactionHistory({
  orders,
  onReprint,
}: {
  orders: POSOrder[]
  onReprint: (order: POSOrder) => void
}) {
  const [query, setQuery] = useState('')

  const rows = useMemo(() => filterPosHistoryOrders(orders, query), [orders, query])

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search receipt, customer, product…"
        ariaLabel="Search POS receipts"
        clearable
      />

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-t3">No transactions found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(order => (
            <li
              key={order.id}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-mono text-[12px] font-bold text-navy">
                    <Fa icon={faReceipt} className="text-t4" aria-hidden="true" />
                    {order.ref}
                  </p>
                  <p className="mt-0.5 text-[11px] text-t3">
                    {ticketWhen(order)}
                    {order.invoiceRef ? ` · ${order.invoiceRef}` : ''}
                  </p>
                  <p className="mt-1 truncate text-[12px] font-semibold text-t1" title={ticketLines(order)}>
                    {ticketLines(order)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-t3">
                    {order.customerName || 'Walk-in'} · {payLabel(order)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <p className="font-mono text-[13px] font-bold text-[var(--success)]">{fmtKes(order.total)}</p>
                  <button
                    type="button"
                    className="btn-secondary text-[10px] py-1"
                    onClick={() => onReprint(order)}
                  >
                    <Fa icon={faPrint} /> Reprint
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
