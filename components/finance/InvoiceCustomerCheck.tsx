'use client'

import { useState } from 'react'
import { fmtKes } from '@/lib/store'

type Row = { invoiceId: string; ref: string; date: string; total: number; filedUnder: string; shouldBe: string; source: 'pos' | 'sale_order' | 'repair' }
type Result = { ref: string; status: 'fixed' | 'failed'; message: string }

const SOURCE: Record<Row['source'], string> = { pos: 'Till ticket', sale_order: 'Sale order', repair: 'Repair' }

/**
 * Finance → Accounting → Integrity controls: invoices filed under a customer
 * other than the one on their till ticket, sale order or repair
 * (lib/finance/invoice-customer-check.ts), and the one-click correction.
 */
export default function InvoiceCustomerCheck({ showToast }: { showToast: (msg: string, type?: 'error' | 'success' | 'info') => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  // Untick an invoice that is billed to someone else on purpose (a company paying for its staff's repair).
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const chosen = (rows ?? []).filter(r => !skip.has(r.invoiceId))

  const load = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/invoice-customers', { cache: 'no-store' })
      const body = await res.json().catch(() => null) as { rows?: Row[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      setRows(body?.rows ?? [])
      setSkip(new Set())
    } catch (err) {
      showToast(`Could not check invoices: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const fix = async () => {
    if (!chosen.length) return
    if (!window.confirm(`Move ${chosen.length} invoice${chosen.length === 1 ? '' : 's'} to the customer on their till ticket, repair or sale order?\n\nA repair invoice's sale order moves with it. Amounts, payments and journals do not change. Each change is written to the audit log.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/invoice-customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: chosen.map(r => r.invoiceId) }),
      })
      const body = await res.json().catch(() => null) as { results?: Result[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      const results = body?.results ?? []
      const done = results.filter(r => r.status === 'fixed').length
      setFailed(results.filter(r => r.status === 'failed'))
      showToast(`${done} invoice${done === 1 ? '' : 's'} corrected`, results.some(r => r.status === 'failed') ? 'error' : 'success')
      await load()
    } catch (err) {
      showToast(`Could not correct invoices: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border-lt bg-card p-4 sm:mx-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">Invoices under the wrong customer</h3>
          <p className="mt-1 text-xs text-text-3">Compares each invoice with its till ticket, repair or sale order — the record of who actually bought. Untick any billed to someone else on purpose.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void load()}>
            {busy && !rows ? 'Checking…' : rows ? 'Check again' : 'Check invoices'}
          </button>
          {rows && rows.length > 0 && (
            <button type="button" className="btn-primary text-[11px]" disabled={busy || chosen.length === 0} onClick={() => void fix()}>
              {busy ? 'Correcting…' : `Correct ${chosen.length}`}
            </button>
          )}
        </div>
      </div>
      {rows && rows.length === 0 && <p className="mt-3 text-xs font-semibold text-emerald-700">Every invoice matches its source document.</p>}
      {rows && rows.length > 0 && (
        <p className="mt-3 text-xs font-semibold text-text-2">
          {rows.length} invoice{rows.length === 1 ? '' : 's'} under a different customer, {fmtKes(rows.reduce((t, r) => t + r.total, 0))} in total.
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="erp-table">
            <thead className="text-text-3">
              <tr>
                <th className="py-1.5 pr-2 font-semibold">
                  <input type="checkbox" aria-label="Select all" checked={skip.size === 0}
                    onChange={e => setSkip(e.target.checked ? new Set() : new Set(rows.map(r => r.invoiceId)))} />
                </th>
                <th className="py-1.5 pr-3 font-semibold">Invoice</th>
                <th className="py-1.5 pr-3 font-semibold">Date</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Amount</th>
                <th className="py-1.5 pr-3 font-semibold">Filed under</th>
                <th className="py-1.5 pr-3 font-semibold">Should be</th>
                <th className="py-1.5 font-semibold">According to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-lt)]">
              {rows.map(r => (
                <tr key={r.invoiceId}>
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" aria-label={`Correct ${r.ref}`} checked={!skip.has(r.invoiceId)}
                      onChange={() => setSkip(prev => { const next = new Set(prev); if (next.has(r.invoiceId)) next.delete(r.invoiceId); else next.add(r.invoiceId); return next })} />
                  </td>
                  <td className="py-1.5 pr-3 font-mono">{r.ref}</td>
                  <td className="py-1.5 pr-3">{r.date}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtKes(r.total)}</td>
                  <td className="py-1.5 pr-3 text-red-700">{r.filedUnder}</td>
                  <td className="py-1.5 pr-3 font-semibold text-emerald-800">{r.shouldBe}</td>
                  <td className="py-1.5 text-text-2">{SOURCE[r.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failed.length > 0 && (
        <p role="alert" className="mt-3 whitespace-pre-line rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {failed.map(f => `${f.ref}: ${f.message}`).join('\n')}
        </p>
      )}
    </div>
  )
}
