'use client'

import { useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { BillPaymentFixPlan } from '@/lib/accounting/bill-payment-fix'

type Result = { billNumber: string; amount: number; status: 'fixed' | 'failed'; message: string }

/**
 * Finance → Accounting → Integrity controls: supplier-bill payments the ledger
 * booked as customer receipts (lib/accounting/bill-payment-fix.ts), and the
 * one-click correction (director).
 */
export default function BillPaymentFix({ showToast, canApply }: { showToast: (msg: string, type?: 'error' | 'success' | 'info') => void; canApply: boolean }) {
  const [rows, setRows] = useState<BillPaymentFixPlan[] | null>(null)
  const [failed, setFailed] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const total = (rows ?? []).reduce((s, r) => s + r.amount, 0)

  const load = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/bill-payment-fix', { cache: 'no-store' })
      const body = await res.json().catch(() => null) as { rows?: BillPaymentFixPlan[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      setRows(body?.rows ?? [])
    } catch (err) {
      showToast(`Could not check bill payments: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const fix = async () => {
    if (!rows?.length) return
    if (!window.confirm(`Correct ${rows.length} bill payment${rows.length === 1 ? '' : 's'} (${fmtKes(total)})?\n\nEach wrong entry is reversed and the supplier payment is booked to Accounts Payable, on the payment's date (today if that period is locked). Your bank balance in the ledger goes down by ${fmtKes(total * 2)}. Every correction is written to the audit log.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/bill-payment-fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json().catch(() => null) as { results?: Result[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      const results = body?.results ?? []
      const done = results.filter(r => r.status === 'fixed').length
      setFailed(results.filter(r => r.status === 'failed'))
      showToast(`${done} bill payment${done === 1 ? '' : 's'} corrected`, results.some(r => r.status === 'failed') ? 'error' : 'success')
      await load()
    } catch (err) {
      showToast(`Could not correct bill payments: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border-lt bg-card p-4 sm:mx-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">Bill payments booked as customer receipts</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-3">
            Paying a supplier bill was booked as money received (bank up, receivables down) instead of money paid out
            (payables down, bank down). Each one overstates the bank by twice the amount paid.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void load()}>
            {busy && !rows ? 'Checking…' : rows ? 'Check again' : 'Check bill payments'}
          </button>
          {rows && rows.length > 0 && canApply && (
            <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void fix()}>
              {busy ? 'Correcting…' : `Correct ${rows.length}`}
            </button>
          )}
        </div>
      </div>
      {rows && rows.length === 0 && <p className="mt-3 text-xs font-semibold text-emerald-700">Every bill payment is booked to Accounts Payable.</p>}
      {rows && rows.length > 0 && !canApply && <p className="mt-3 text-xs text-amber-800">A director can apply the correction.</p>}
      {rows && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">Bill</th>
                <th className="py-1.5 pr-3 font-semibold">Supplier</th>
                <th className="py-1.5 pr-3 font-semibold">Paid</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Amount</th>
                <th className="py-1.5 pr-3 font-semibold">From</th>
                <th className="py-1.5 font-semibold">Correction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-lt)]">
              {rows.map(r => (
                <tr key={r.paymentId}>
                  <td className="py-1.5 pr-3 font-mono">{r.billNumber}</td>
                  <td className="py-1.5 pr-3">{r.supplier || '—'}</td>
                  <td className="py-1.5 pr-3">{r.paidAt}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtKes(r.amount)}</td>
                  <td className="py-1.5 pr-3">{r.cashAccount}</td>
                  <td className="py-1.5 text-text-2">{r.postCorrect ? 'Reverse, book to payables' : 'Reverse the duplicate'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] font-semibold text-text-2">Total {fmtKes(total)}</p>
        </div>
      )}
      {failed.length > 0 && (
        <p role="alert" className="mt-3 whitespace-pre-line rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {failed.map(f => `${f.billNumber}: ${f.message}`).join('\n')}
        </p>
      )}
    </div>
  )
}
