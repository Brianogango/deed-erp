'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useApp } from '@/lib/store'
import { financeInvoicePath } from '@/lib/finance-invoice'
import { buildMyWork } from '@/lib/my-work'

/**
 * Everything waiting for the signed-in person, across modules. Start the day
 * here instead of visiting each module to see what needs doing.
 */
export default function MyWork() {
  const app = useApp() as any
  const user = app.currentUser
  const queues = useMemo(() => buildMyWork({
    role: String(user?.role ?? ''),
    userId: String(user?.id ?? ''),
    now: new Date(),
    repairs: app.repairs ?? [],
    saleOrders: app.saleOrders ?? [],
    invoices: app.invoices ?? [],
    deliveries: app.deliveries ?? [],
    buyBacks: app.buyBacks ?? [],
    stockAdjustments: app.stockAdjustments ?? [],
    serials: app.serials ?? [],
    purchaseOrders: app.purchaseOrders ?? [],
    products: app.products ?? [],
    invoiceHref: id => financeInvoicePath(id),
  }), [user?.role, user?.id, app.repairs, app.saleOrders, app.invoices, app.deliveries, app.buyBacks, app.stockAdjustments, app.serials, app.purchaseOrders, app.products])

  const total = queues.reduce((s, q) => s + q.count, 0)
  const firstName = String(user?.name ?? '').split(/\s+/)[0]

  return (
    <div className="mod-page">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-3 sm:p-5">
        <header>
          <h1 className="m-0 text-[13px] font-black text-[var(--text-1)]">{firstName ? `${firstName}, here is your work` : 'My work'}</h1>
          <p className="m-0 mt-1 text-[12px] text-[var(--text-3)]">
            {total === 0
              ? 'Nothing is waiting for you right now.'
              : `${total} item${total === 1 ? '' : 's'} waiting across ${queues.length} queue${queues.length === 1 ? '' : 's'} — oldest first in each.`}
          </p>
        </header>

        {queues.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] px-4 py-10 text-center text-[13px] text-[var(--text-3)]">
            All clear. New work will appear here as it arrives.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {queues.map(q => (
              <section key={q.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)]" aria-labelledby={`q-${q.id}`}>
                <div className="flex items-start justify-between gap-3 border-b border-[var(--border-lt)] bg-[var(--bg-surface)] px-4 py-3">
                  <div className="min-w-0">
                    <h2 id={`q-${q.id}`} className="m-0 flex items-center gap-2 text-[13px] font-black text-[var(--text-1)]">
                      {q.title}
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold tabular-nums ${q.tone === 'urgent' ? 'bg-red-50 text-red-700' : 'bg-[var(--primary-light)] text-[var(--navy)]'}`}>{q.count}</span>
                    </h2>
                    <p className="m-0 mt-0.5 text-[11px] text-[var(--text-3)]">{q.hint}</p>
                  </div>
                  <Link href={q.href} className="shrink-0 text-[11px] font-bold text-[var(--primary)] no-underline hover:underline">Open all</Link>
                </div>
                <ul className="m-0 list-none divide-y divide-[var(--border-lt)] p-0">
                  {q.items.map(item => (
                    <li key={item.id}>
                      <Link href={item.href} className="flex items-center justify-between gap-3 px-4 py-2.5 no-underline transition hover:bg-[var(--bg-muted)]">
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[12px] font-bold text-[var(--text-1)]">{item.title}</span>
                          <span className="block truncate text-[11px] text-[var(--text-3)]">{item.subtitle}</span>
                        </span>
                        <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${item.ageDays >= 7 ? 'text-red-600' : 'text-[var(--text-3)]'}`}>
                          {item.ageDays === 0 ? 'today' : `${item.ageDays}d`}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {q.count > q.items.length && (
                    <li className="px-4 py-2 text-[11px] text-[var(--text-3)]">…and {q.count - q.items.length} more — <Link href={q.href} className="font-bold text-[var(--primary)]">open all</Link></li>
                  )}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
