'use client'

import { useEffect, useState } from 'react'
import { fmtDate, fmtKes } from '@/lib/store'
import type { NumberCheck } from '@/lib/accounting/number-check.server'

/**
 * Refunds, POS session closes and returns that the old repeated document
 * numbers may have kept out of the books, and buy-back payouts that never
 * had a bill. Read only: shown to finance to
 * check; nothing is posted from here. Hidden when there is nothing, or the
 * viewer may not see it.
 */
export default function NumberCheckNotice() {
  const [check, setCheck] = useState<NumberCheck | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/accounting/number-check', { credentials: 'include', cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: NumberCheck | null) => { if (!cancelled) setCheck(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!check) return null
  const { refundsNotInLedger, posSessionsNotInLedger, returnsMissingValue, refundRepeats } = check
  const buyBacks = check.buyBackPayoutsNotBooked ?? []
  const total = refundsNotInLedger.length + posSessionsNotInLedger.length + returnsMissingValue.length + refundRepeats.length + buyBacks.length
  if (!total) return null

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mt-2">
      <p className="m-0 text-[11px] font-bold" style={{ color: 'var(--warning-text)' }}>{title}</p>
      <ul className="m-0 mt-0.5 list-none p-0 font-mono text-[11px]" style={{ color: 'var(--warning-text)' }}>{children}</ul>
    </div>
  )

  return (
    <div role="status" className="mx-4 mt-3 rounded-xl px-4 py-3" style={{ background: 'var(--warning-bg)', border: '1px solid var(--border-lt)' }}>
      <p className="m-0 text-[12px] font-extrabold" style={{ color: 'var(--warning-text)' }}>Check these with your accountant</p>
      <p className="m-0 mt-0.5 text-[11px]" style={{ color: 'var(--warning-text)' }}>
        These may be missing from the books (repeated document numbers, or buy-back payouts made before payouts created a bill). Nothing has been posted or changed — this only lists them.
      </p>
      {refundsNotInLedger.length > 0 && (
        <Section title={`Customer refunds not in the ledger (${refundsNotInLedger.length})`}>
          {refundsNotInLedger.map(r => <li key={r.id}>{r.ref} · {r.rmaRef ?? '—'} · {r.customerName ?? ''} · {fmtKes(Number(r.amount ?? 0))}{r.date ? ` · ${fmtDate(r.date)}` : ''}</li>)}
        </Section>
      )}
      {posSessionsNotInLedger.length > 0 && (
        <Section title={`POS session closes that may not be in the ledger (${posSessionsNotInLedger.length})`}>
          {posSessionsNotInLedger.map(s => <li key={s.id}>{s.ref}{s.formerRef ? ` (was ${s.formerRef})` : ''}{s.closedAt ? ` · closed ${fmtDate(s.closedAt)}` : ''}{s.totalSales != null ? ` · sales ${fmtKes(s.totalSales)}` : ''}</li>)}
        </Section>
      )}
      {returnsMissingValue.length > 0 && (
        <Section title={`Customer returns whose stock value may not have posted (${returnsMissingValue.length})`}>
          {returnsMissingValue.map(r => <li key={r.id}>{r.ref}{r.formerRef ? ` (was ${r.formerRef})` : ''} · {r.customerName ?? ''} · {r.products.join(', ')}</li>)}
        </Section>
      )}
      {buyBacks.length > 0 && (
        <Section title={`Buy-back payouts never booked — no bill, no journal (${buyBacks.length})`}>
          {buyBacks.map(b => <li key={b.id}>{b.ref} · {b.customerName ?? ''} · {fmtKes(Number(b.total ?? 0))} · {b.paymentMethod}{b.paidDate ? ` · ${fmtDate(b.paidDate)}` : ''}</li>)}
        </Section>
      )}
      {refundRepeats.length > 0 && (
        <Section title={`Refund numbers used more than once (${refundRepeats.length})`}>
          {refundRepeats.map(g => <li key={g.ref}>{g.ref} × {g.payments.length}: {g.payments.map(p => `${p.rmaRef ?? '—'} ${fmtKes(Number(p.amount ?? 0))}`).join(' · ')}</li>)}
        </Section>
      )}
    </div>
  )
}
