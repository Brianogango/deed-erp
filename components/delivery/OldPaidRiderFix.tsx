'use client'

import { useState } from 'react'
import { fmtKes, type DeliveryJob } from '@/lib/store'
import { needsOffBooksFix } from '@/lib/delivery/rider-direct-pay'

/**
 * One-time fix for trips recorded with the first version, which settled the
 * delivery charge by a "paid to rider" payment (and delivery expense). It
 * reverses those payments and credits the charge off the invoice instead.
 */
export function OldPaidRiderFix({ jobs, canFix }: { jobs: DeliveryJob[]; canFix: boolean }) {
  const list = jobs.filter(j => needsOffBooksFix(j))
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Array<{ ref: string; ok: boolean; message: string }> | null>(null)
  const [error, setError] = useState('')
  if (!canFix || (!list.length && !results)) return null

  async function fix() {
    setBusy(true); setError('')
    const res = await fetch('/api/delivery-jobs/paid-to-rider-fix', { method: 'POST' }).catch(() => null)
    const out = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) { setError(out.error || 'Could not fix them. Try again.'); return }
    setResults(out.results ?? [])
  }

  return (
    <div className="rounded-lg px-3 py-2.5 text-xs space-y-2" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }} role="status">
      {!results ? (
        <>
          <p className="font-semibold">
            {list.length} trip{list.length === 1 ? '' : 's'} where the customer paid the rider directly {list.length === 1 ? 'was' : 'were'} booked the old way
            ({fmtKes(list.reduce((s, j) => s + (Number(j.customerPaidRider?.amount) || 0), 0))} shown as delivery income and delivery expense).
          </p>
          <p>Fixing reverses each “paid to rider” payment and its expense entry, then takes the delivery charge off the invoice with a credit note — so none of it shows on our books.</p>
          <p className="font-mono text-[11px]">{list.map(j => `${j.ref}${j.customerPaidRider?.invoiceRef ? ` (${j.customerPaidRider.invoiceRef})` : ''}`).join(' · ')}</p>
          {error && <p role="alert" style={{ color: 'var(--danger-text)' }}>{error}</p>}
          <button className="btn-primary" disabled={busy} onClick={() => void fix()}>{busy ? 'Fixing…' : 'Fix them now'}</button>
        </>
      ) : (
        <>
          <ul className="space-y-1">
            {results.map(r => <li key={r.ref} style={{ color: r.ok ? 'var(--success-text)' : 'var(--danger-text)' }}><span className="font-semibold">{r.ref}:</span> {r.message}</li>)}
          </ul>
          <button className="btn-outline" onClick={() => window.location.reload()}>Done — reload</button>
        </>
      )}
    </div>
  )
}
