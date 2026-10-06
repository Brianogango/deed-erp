'use client'

import { useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { DuplicateInvoicePlan } from '@/lib/accounting/duplicate-invoice-journals'

type Result = { invoiceNumber: string; reversed: number; status: 'fixed' | 'failed'; message: string }

/**
 * Finance → Accounting → Integrity controls: invoices whose sales entry is on
 * the ledger more than once (lib/accounting/duplicate-invoice-journals.ts),
 * and the one-click reversal of the extra copies (director).
 */
export default function DuplicateInvoiceJournals({ showToast, canApply }: { showToast: (msg: string, type?: 'error' | 'success' | 'info') => void; canApply: boolean }) {
  const [rows, setRows] = useState<DuplicateInvoicePlan[] | null>(null)
  const [failed, setFailed] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const extras = (rows ?? []).reduce((n, r) => n + r.reverse.length, 0)
  const overstated = (rows ?? []).reduce((s, r) => s + r.reverse.reduce((t, x) => t + x.amount, 0), 0)

  const load = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/duplicate-invoice-journals', { cache: 'no-store' })
      const body = await res.json().catch(() => null) as { rows?: DuplicateInvoicePlan[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      setRows(body?.rows ?? [])
    } catch (err) {
      showToast(`Could not check sales entries: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const fix = async () => {
    if (!rows?.length) return
    if (!window.confirm(`Reverse ${extras} duplicate sales entr${extras === 1 ? 'y' : 'ies'} on ${rows.length} invoice${rows.length === 1 ? '' : 's'}?\n\nOne entry per invoice is kept. Revenue, VAT and receivables go down by ${fmtKes(overstated)} in total. Reversals are dated today and written to the audit log.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/duplicate-invoice-journals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json().catch(() => null) as { results?: Result[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      const results = body?.results ?? []
      const done = results.filter(r => r.status === 'fixed').reduce((n, r) => n + r.reversed, 0)
      setFailed(results.filter(r => r.status === 'failed'))
      showToast(`${done} duplicate entr${done === 1 ? 'y' : 'ies'} reversed`, results.some(r => r.status === 'failed') ? 'error' : 'success')
      await load()
    } catch (err) {
      showToast(`Could not reverse duplicates: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border-lt bg-card p-4 sm:mx-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">Invoices booked more than once</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-3">
            Invoices whose sales entry is on the ledger several times (e.g. a migration import that retried), each copy booking the
            revenue, VAT and receivable again.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void load()}>
            {busy && !rows ? 'Checking…' : rows ? 'Check again' : 'Check sales entries'}
          </button>
          {rows && rows.length > 0 && canApply && (
            <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void fix()}>
              {busy ? 'Reversing…' : `Reverse ${extras} duplicate${extras === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
      {rows && rows.length === 0 && <p className="mt-3 text-xs font-semibold text-emerald-700">Every invoice is booked once.</p>}
      {rows && rows.length > 0 && !canApply && <p className="mt-3 text-xs text-amber-800">A director can apply the correction.</p>}
      {rows && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">Invoice</th>
                <th className="py-1.5 pr-3 font-semibold">Customer</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Invoice total</th>
                <th className="py-1.5 pr-3 font-semibold">Keep</th>
                <th className="py-1.5 font-semibold">Reverse</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-lt)]">
              {rows.map(r => (
                <tr key={r.invoiceId} className="align-top">
                  <td className="py-1.5 pr-3 font-mono">{r.invoiceNumber}</td>
                  <td className="py-1.5 pr-3">{r.customer || '—'}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtKes(r.invoiceTotal)}</td>
                  <td className="py-1.5 pr-3 font-mono">
                    {r.keep.ref}
                    {r.amountMismatch && <span className="block font-sans text-amber-800">{fmtKes(r.keep.amount)} — differs from the invoice, check it</span>}
                  </td>
                  <td className="py-1.5 font-mono text-red-700">{r.reverse.map(x => x.ref).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] font-semibold text-text-2">{extras} extra entries · {fmtKes(overstated)} overstated</p>
        </div>
      )}
      {failed.length > 0 && (
        <p role="alert" className="mt-3 whitespace-pre-line rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {failed.map(f => `${f.invoiceNumber}: ${f.message}`).join('\n')}
        </p>
      )}
    </div>
  )
}
