'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useApp } from '@/lib/store'
import { financeInvoicePath } from '@/lib/finance-invoice'
import { invoiceResidual } from '@/lib/odoo-sales-flow'
import { customerDevices, customerWaiting } from '@/lib/customer-360'

/**
 * On a customer's Sales & service tab: what is waiting on them (quotes to
 * approve, devices to collect, invoices to pay) and the devices they own —
 * bought from Deed or brought in for repair.
 */
export default function CustomerSnapshot({ contactId }: { contactId: string }) {
  const app = useApp() as any
  const waiting = useMemo(() => customerWaiting({
    contactId,
    repairs: app.repairs ?? [],
    saleOrders: app.saleOrders ?? [],
    invoices: app.invoices ?? [],
    invoiceHref: id => financeInvoicePath(id),
    residual: inv => invoiceResidual(inv as any),
  }), [contactId, app.repairs, app.saleOrders, app.invoices])
  const devices = useMemo(() => customerDevices({
    contactId,
    saleOrders: app.saleOrders ?? [],
    serials: app.serials ?? [],
    repairs: app.repairs ?? [],
  }), [contactId, app.saleOrders, app.serials, app.repairs])

  if (!waiting.length && !devices.length) return null

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {waiting.length > 0 && (
        <section className="min-w-0 overflow-hidden rounded-xl border border-[var(--border-lt)]" aria-label="Waiting on this customer">
          <p className="m-0 border-b border-[var(--border-lt)] bg-[var(--bg-surface)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-1)]">Waiting on this customer · {waiting.length}</p>
          <ul className="m-0 list-none divide-y divide-[var(--border-lt)] p-0">
            {waiting.map((w, i) => (
              <li key={i}>
                <Link href={w.href} className="flex items-center justify-between gap-3 px-4 py-2 no-underline hover:bg-[var(--bg-muted)]">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold text-[var(--text-1)]">{w.label}</span>
                    <span className="block truncate text-[11px] text-[var(--text-3)]">{w.detail}</span>
                  </span>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${w.tone === 'money' ? 'bg-red-50 text-red-700' : 'bg-[var(--primary-light)] text-[var(--navy)]'}`}>{w.tone === 'money' ? 'Payment' : 'Action'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {devices.length > 0 && (
        <section className="min-w-0 overflow-hidden rounded-xl border border-[var(--border-lt)]" aria-label="Customer devices">
          <p className="m-0 border-b border-[var(--border-lt)] bg-[var(--bg-surface)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-1)]">Devices · {devices.length}</p>
          <ul className="m-0 list-none divide-y divide-[var(--border-lt)] p-0">
            {devices.map(d => (
              <li key={`${d.serial}-${d.how}`}>
                <Link href={d.href} className="flex items-center justify-between gap-3 px-4 py-2 no-underline hover:bg-[var(--bg-muted)]">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold text-[var(--text-1)]">{d.product}</span>
                    <span className="block truncate font-mono text-[11px] text-[var(--text-3)]">{d.serial}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--text-3)]">{d.how}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
