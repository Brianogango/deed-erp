'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useApp } from '@/lib/store'
import { financeInvoicePath } from '@/lib/finance-invoice'
import { buildJobTrail, type TrailStart } from '@/lib/job-trail'
import { rememberRecentRecord } from '@/lib/recent-records'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'

const TRAIL_KEYS = ['deed_repairs_v2', 'deed_saleOrders', 'deed_invoices']

/**
 * One customer job across modules — Repair → Quote → Sale order → Invoice →
 * Payment → Delivery — with links, and the one thing to do next.
 */
export default function JobTrail({ start }: { start: TrailStart }) {
  const { repairs, saleOrders, quotes, invoices, deliveries, currentUserId } = useApp() as any
  // Screens that load repairs, sale orders and invoices (Sales, Repairs) build
  // the trail here; others (Finance) ask the server, which has the lists.
  const pathname = usePathname() || '/'
  const local = useMemo(() => {
    const keys = appStateKeysForRoute(pathname)
    return TRAIL_KEYS.every(key => keys.includes(key))
  }, [pathname])
  const localTrail = useMemo(() => local ? buildJobTrail(start, {
    repairs: repairs ?? [],
    saleOrders: saleOrders ?? [],
    quotes: quotes ?? [],
    invoices: invoices ?? [],
    deliveries: deliveries ?? [],
    invoiceHref: id => financeInvoicePath(id),
  }) : null, [local, start.kind, start.id, repairs, saleOrders, quotes, invoices, deliveries]) // eslint-disable-line react-hooks/exhaustive-deps
  const [serverTrail, setServerTrail] = useState<ReturnType<typeof buildJobTrail> | null>(null)
  // A payment or posting on this invoice asks the server again.
  const startInvoice = start.kind === 'invoice' ? (invoices ?? []).find((i: any) => i.id === start.id) : null
  const refreshKey = startInvoice ? `${startInvoice.status}:${startInvoice.amountPaid}` : ''
  useEffect(() => {
    if (local) return
    let cancelled = false
    fetch(`/api/job-trail?kind=${encodeURIComponent(start.kind)}&id=${encodeURIComponent(start.id)}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data && Array.isArray(data.steps)) setServerTrail(data) })
      .catch(() => { /* no trail shown */ })
    return () => { cancelled = true }
  }, [local, start.kind, start.id, refreshKey])
  const trail = localTrail ?? serverTrail ?? { steps: [], next: null }

  // The record this trail sits on goes into the sidebar's Recent list.
  const KIND_FOR: Record<TrailStart['kind'], string> = { repair: 'repair', sale_order: 'sale_order', invoice: 'invoice', delivery: 'delivery' }
  const own = trail.steps.find(step => step.kind === KIND_FOR[start.kind])
  useEffect(() => {
    if (own?.ref) rememberRecentRecord(currentUserId, { href: own.href, label: `${own.label} ${own.ref}`, kind: own.kind })
  }, [currentUserId, own?.href, own?.ref])

  if (trail.steps.length < 2 && !trail.next) return null

  return (
    <nav aria-label="Job trail" className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-2">
      {trail.steps.map((step, i) => (
        <span key={`${step.kind}-${step.ref}-${i}`} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" className="text-[11px] text-[var(--text-4)]">→</span>}
          <Link
            href={step.href}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold no-underline transition hover:bg-[var(--bg-muted)] ${step.state === 'done'
              ? 'border-emerald-200 text-emerald-800'
              : 'border-[var(--primary)]/40 text-[var(--navy)]'}`}
            title={`${step.label} ${step.ref} — ${step.status}`}
          >
            <span className="text-[var(--text-3)]">{step.label}</span>
            <span className="font-mono">{step.ref}</span>
            <span className="text-[10px] font-medium capitalize text-[var(--text-3)]">{step.status}</span>
          </Link>
        </span>
      ))}
      {trail.next && (
        <Link
          href={trail.next.href}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold no-underline ${trail.next.tone === 'action'
            ? 'bg-[var(--primary)] text-white'
            : trail.next.tone === 'waiting'
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}
        >
          {trail.next.tone === 'action' ? 'Next: ' : ''}{trail.next.label}
        </Link>
      )}
    </nav>
  )
}
