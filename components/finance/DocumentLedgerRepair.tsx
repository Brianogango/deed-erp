'use client'

import { useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { ExtraPaymentPlan } from '@/lib/accounting/document-ledger-repair'

type Unbooked = { invoiceId: string; ref: string; kind: 'invoice' | 'bill'; date: string; total: number; paid: number }
type Review = { ref: string; kind: 'invoice' | 'bill'; total: number; paid: number; ledgerPaid: number; reason: string }
type Data = { extraPayments: ExtraPaymentPlan[]; unbooked: Unbooked[]; review: Review[] }
type Result = { ref: string; status: 'fixed' | 'failed'; message: string }

/**
 * Finance → Accounting → Integrity controls: payments booked more than once,
 * confirmed documents with no ledger entry, and what needs a person to look
 * at it (lib/accounting/document-ledger-repair.ts).
 */
export default function DocumentLedgerRepair({ showToast, canApply }: { showToast: (msg: string, type?: 'error' | 'success' | 'info') => void; canApply: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [failed, setFailed] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const copies = (data?.extraPayments ?? []).reduce((n, p) => n + p.reverse.length, 0)
  const copyTotal = (data?.extraPayments ?? []).reduce((s, p) => s + p.reverse.reduce((t, r) => t + r.amount, 0), 0)
  const unbookedTotal = (data?.unbooked ?? []).reduce((s, d) => s + d.total, 0)
  const count = copies + (data?.unbooked.length ?? 0)

  const load = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/document-ledger-repair', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      setData({ extraPayments: body?.extraPayments ?? [], unbooked: body?.unbooked ?? [], review: body?.review ?? [] })
    } catch (err) {
      showToast(`Could not check: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const fix = async () => {
    if (!data || !count) return
    if (!window.confirm(`Reverse ${copies} duplicate payment entr${copies === 1 ? 'y' : 'ies'} (${fmtKes(copyTotal)}) on ${data.extraPayments.length} document${data.extraPayments.length === 1 ? '' : 's'}, and book ${data.unbooked.length} confirmed document${data.unbooked.length === 1 ? '' : 's'} that have no ledger entry (${fmtKes(unbookedTotal)})?\n\nEach recorded payment keeps one entry. Documents are booked on their own date at their current amount. Everything is written to the audit log.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/document-ledger-repair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json().catch(() => null) as { results?: Result[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      const results = body?.results ?? []
      setFailed(results.filter(r => r.status === 'failed'))
      showToast(`${results.filter(r => r.status === 'fixed').length} corrected`, results.some(r => r.status === 'failed') ? 'error' : 'success')
      await load()
    } catch (err) {
      showToast(`Could not correct: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border-lt bg-card p-4 sm:mx-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">Payments booked more than once, documents not booked</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-3">
            One payment on the document but two or more payment entries in the ledger, and confirmed invoices and bills with no
            ledger entry (reset to draft, then approved again).
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void load()}>
            {busy && !data ? 'Checking…' : data ? 'Check again' : 'Check'}
          </button>
          {count > 0 && canApply && (
            <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void fix()}>
              {busy ? 'Correcting…' : `Correct ${count}`}
            </button>
          )}
        </div>
      </div>
      {data && count === 0 && <p className="mt-3 text-xs font-semibold text-emerald-700">Nothing to correct automatically.</p>}
      {data && count > 0 && !canApply && <p className="mt-3 text-xs text-amber-800">A director can apply the correction.</p>}
      {data && data.extraPayments.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-1 text-xs font-bold text-text-2">{copies} duplicate payment entr{copies === 1 ? 'y' : 'ies'} · {fmtKes(copyTotal)}</p>
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3"><tr><th className="py-1 pr-3">Document</th><th className="py-1 pr-3 text-right">Recorded</th><th className="py-1 pr-3 text-right">In ledger</th><th className="py-1">Reversed</th></tr></thead>
            <tbody>
              {data.extraPayments.map(p => (
                <tr key={p.invoiceId} className="border-t border-border-lt">
                  <td className="py-1 pr-3 font-mono">{p.ref}</td>
                  <td className="py-1 pr-3 text-right">{fmtKes(p.recorded)}</td>
                  <td className="py-1 pr-3 text-right">{fmtKes(p.booked)}</td>
                  <td className="py-1 font-mono text-text-3">{p.reverse.map(r => r.ref.split('/').pop()?.slice(0, 8)).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.unbooked.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-1 text-xs font-bold text-text-2">{data.unbooked.length} confirmed document{data.unbooked.length === 1 ? '' : 's'} with no ledger entry · {fmtKes(unbookedTotal)}</p>
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3"><tr><th className="py-1 pr-3">Document</th><th className="py-1 pr-3">Date</th><th className="py-1 pr-3 text-right">Total</th><th className="py-1 text-right">Paid</th></tr></thead>
            <tbody>
              {data.unbooked.map(d => (
                <tr key={d.invoiceId} className="border-t border-border-lt">
                  <td className="py-1 pr-3 font-mono">{d.ref}</td><td className="py-1 pr-3">{d.date}</td>
                  <td className="py-1 pr-3 text-right">{fmtKes(d.total)}</td><td className="py-1 text-right">{fmtKes(d.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.review.length > 0 && (
        <div className="mt-3">
          <button type="button" className="text-xs font-bold text-amber-800 underline" onClick={() => setShowReview(v => !v)}>
            {data.review.length} document{data.review.length === 1 ? '' : 's'} need a person to check (not changed) {showReview ? '▲' : '▼'}
          </button>
          {showReview && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-text-3"><tr><th className="py-1 pr-3">Document</th><th className="py-1 pr-3 text-right">Total</th><th className="py-1 pr-3 text-right">Paid (document)</th><th className="py-1 pr-3 text-right">Paid (ledger)</th><th className="py-1">Why</th></tr></thead>
                <tbody>
                  {data.review.map(r => (
                    <tr key={r.ref} className="border-t border-border-lt">
                      <td className="py-1 pr-3 font-mono">{r.ref}</td><td className="py-1 pr-3 text-right">{fmtKes(r.total)}</td>
                      <td className="py-1 pr-3 text-right">{fmtKes(r.paid)}</td><td className="py-1 pr-3 text-right">{fmtKes(r.ledgerPaid)}</td>
                      <td className="py-1 text-text-3">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-red-700">
          {failed.map((f, i) => <li key={`${f.ref}-${i}`}>{f.ref}: {f.message}</li>)}
        </ul>
      )}
    </div>
  )
}
