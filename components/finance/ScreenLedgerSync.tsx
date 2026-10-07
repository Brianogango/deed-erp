'use client'

import { useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { MissingDocPlan, UnbookedPaymentPlan } from '@/lib/accounting/screen-ledger-sync'

type Result = { ref: string; status: 'fixed' | 'failed' | 'skipped'; message: string }
type Gaps = { missing: MissingDocPlan[]; payments: UnbookedPaymentPlan[] }

/**
 * Finance → Accounting → Integrity controls: documents and payments on the
 * screens that never reached the ledger (lib/accounting/screen-ledger-sync.ts),
 * booked through the normal invoice / payment routes (director).
 */
export default function ScreenLedgerSync({ showToast, canApply }: { showToast: (msg: string, type?: 'error' | 'success' | 'info') => void; canApply: boolean }) {
  const [gaps, setGaps] = useState<Gaps | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const bookable = gaps ? gaps.missing.filter(m => !m.problem).length + gaps.payments.reduce((n, p) => n + p.book.length, 0) : 0
  const empty = gaps && gaps.missing.length === 0 && gaps.payments.length === 0

  const load = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/screen-ledger-sync', { cache: 'no-store' })
      const body = await res.json().catch(() => null) as (Gaps & { error?: string }) | null
      if (!res.ok || !body) throw new Error(body?.error || `server returned ${res.status}`)
      setGaps({ missing: body.missing, payments: body.payments })
    } catch (err) {
      showToast(`Could not check: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!bookable) return
    if (!window.confirm(`Book ${bookable} item${bookable === 1 ? '' : 's'} into the ledger?\n\nDocuments are booked with their normal entries; payments are booked as already received (no message is sent to the customer). Each is recorded in the audit log.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/screen-ledger-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json().catch(() => null) as { results?: Result[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      const out = body?.results ?? []
      setResults(out.filter(r => r.status !== 'fixed'))
      const done = out.filter(r => r.status === 'fixed').length
      showToast(`${done} item${done === 1 ? '' : 's'} booked`, out.some(r => r.status === 'failed') ? 'error' : 'success')
      await load()
    } catch (err) {
      showToast(`Could not book: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border-lt bg-card p-4 sm:mx-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">On the screens but not in the ledger</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-3">
            Bills, invoices and payments that show in Finance but never reached the ledger, so they are missing from every report.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void load()}>
            {busy && !gaps ? 'Checking…' : gaps ? 'Check again' : 'Check'}
          </button>
          {bookable > 0 && canApply && (
            <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void apply()}>
              {busy ? 'Booking…' : `Book ${bookable}`}
            </button>
          )}
        </div>
      </div>
      {empty && <p className="mt-3 text-xs font-semibold text-emerald-700">Everything on the screens is in the ledger.</p>}
      {gaps && !empty && !canApply && <p className="mt-3 text-xs text-amber-800">A director can book these.</p>}
      {gaps && gaps.missing.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-1 text-[11px] font-bold text-text-2">Documents</p>
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">Document</th>
                <th className="py-1.5 pr-3 font-semibold">Partner</th>
                <th className="py-1.5 pr-3 font-semibold">Date</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Total</th>
                <th className="py-1.5 font-semibold">Will</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-lt)]">
              {gaps.missing.map(m => (
                <tr key={m.id}>
                  <td className="py-1.5 pr-3 font-mono">{m.ref}<span className="block font-sans text-text-3">{m.type === 'vendor_bill' ? 'Bill' : 'Invoice'}</span></td>
                  <td className="py-1.5 pr-3">{m.partner || '—'}</td>
                  <td className="py-1.5 pr-3">{m.date || '—'}{m.fixedDates && <span className="block text-amber-800">corrected from a spreadsheet number</span>}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtKes(m.total)}</td>
                  <td className="py-1.5">{m.problem ? <span className="text-amber-800">{m.problem}</span> : 'Book it'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gaps && gaps.payments.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-1 text-[11px] font-bold text-text-2">Payments</p>
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">Document</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Paid on screen</th>
                <th className="py-1.5 pr-3 text-right font-semibold">In ledger</th>
                <th className="py-1.5 font-semibold">Will</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-lt)]">
              {gaps.payments.map(p => (
                <tr key={p.invoiceId}>
                  <td className="py-1.5 pr-3 font-mono">{p.ref}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtKes(p.screenPaid)}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtKes(p.ledgerPaid)}</td>
                  <td className="py-1.5">
                    {p.manual
                      ? <span className="text-amber-800">No payment details on screen — register it on the document</span>
                      : p.book.map(b => `Book ${fmtKes(b.amount)} ${b.method.replace('_', ' ')}${b.date ? ` of ${b.date}` : ''}`).join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {results.length > 0 && (
        <p role="alert" className="mt-3 whitespace-pre-line rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {results.map(r => `${r.ref}: ${r.message}`).join('\n')}
        </p>
      )}
    </div>
  )
}
