'use client'

import { useMemo, useState } from 'react'
import { SearchInput } from '@/components/ui'
import { Fa, faPrint, faReceipt } from '@/components/icons'
import { fmtKes, type POSOrder } from '@/lib/store'
import {
  filterPosHistoryOrders,
  payLabel,
  ticketLines,
  ticketWhen,
} from '@/lib/pos-transaction-history'

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
