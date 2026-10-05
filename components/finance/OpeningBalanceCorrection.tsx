'use client'

import { useState } from 'react'
import { fmtKes } from '@/lib/store'

type Plan = { action: 'ok' | 'post' | 'reclass' | 'review'; reason: string; lines?: Array<{ accountLabel: string; debit: number; credit: number }> }
type ReportRow = {
  id: string; ref: string; type: 'customer_invoice' | 'vendor_bill'; partner: string; date: string
  amount: number; currentJournal: string | null; plan: Plan; correctionDate: string
}
type Result = { ref: string; status: 'posted' | 'skipped' | 'failed'; message: string; journalRef?: string }

const ACTION_LABEL: Record<Plan['action'], string> = {
  post: 'Post opening balance',
  reclass: 'Move to Opening Balance Equity',
  ok: 'Correct',
  review: 'Accountant to review',
}
const ACTION_TONE: Record<Plan['action'], string> = {
  post: 'bg-[var(--primary-light)] text-[var(--navy)]',
  reclass: 'bg-amber-50 text-amber-900',
  ok: 'bg-emerald-50 text-emerald-800',
  review: 'bg-red-50 text-red-700',
}

/**
 * Finance → Data migration: opening balances imported before they posted to
 * 4004 Opening Balance Equity. Shows how each is booked now and the journal
 * that corrects it; posting is a separate, confirmed step.
 */
export default function OpeningBalanceCorrection({ showToast }: { showToast: (msg: string, type?: 'error' | 'success' | 'info') => void }) {
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [results, setResults] = useState<Result[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    setResults(null)
    try {
      const res = await fetch('/api/accounting/opening-balances', { cache: 'no-store' })
      const payload = await res.json().catch(() => null) as { rows?: ReportRow[]; error?: string } | null
      if (!res.ok) throw new Error(payload?.error || `server returned ${res.status}`)
      setRows(payload?.rows ?? [])
    } catch (err) {
      showToast(`Could not check opening balances: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toFix = (rows ?? []).filter(r => r.plan.action === 'post' || r.plan.action === 'reclass')

  const post = async () => {
    if (!toFix.length) return
    if (!window.confirm(`Post ${toFix.length} correcting journal(s)? Each is posted once and appears in the General journal.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/opening-balances', { method: 'POST' })
      const payload = await res.json().catch(() => null) as { results?: Result[]; error?: string } | null
      if (!res.ok) throw new Error(payload?.error || `server returned ${res.status}`)
      const out = payload?.results ?? []
      setResults(out)
      const posted = out.filter(r => r.status === 'posted').length
      const failed = out.filter(r => r.status === 'failed').length
      showToast(`${posted} correction(s) posted${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'success')
      await load()
    } catch (err) {
      showToast(`Could not post corrections: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border-lt bg-card p-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">3. Opening balances already imported</h3>
          <p className="mt-1 text-xs text-text-3">
            Opening balances belong in 4004 Opening Balance Equity, not revenue or expenses. Check how earlier imports were booked and post the corrections.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={load}>
            {busy && !rows ? 'Checking…' : rows ? 'Check again' : 'Check imported opening balances'}
          </button>
          {toFix.length > 0 && (
            <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={post}>
              {busy ? 'Posting…' : `Post ${toFix.length} correction${toFix.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>

      {rows && rows.length === 0 && (
        <p className="mt-3 text-xs text-text-3">No imported opening balances found.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">Document</th>
                <th className="py-1.5 pr-3 font-semibold">Partner</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Amount</th>
                <th className="py-1.5 pr-3 font-semibold">Booked now</th>
                <th className="py-1.5 pr-3 font-semibold">Action</th>
                <th className="py-1.5 font-semibold">Journal date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-lt)]">
              {rows.map(row => (
                <tr key={row.id} className="align-top">
                  <td className="py-1.5 pr-3 font-mono">{row.ref}<span className="ml-1 font-sans text-text-3">{row.type === 'vendor_bill' ? 'bill' : 'invoice'}</span></td>
                  <td className="py-1.5 pr-3">{row.partner}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtKes(row.amount)}</td>
                  <td className="py-1.5 pr-3 text-text-2">{row.currentJournal ?? 'not in the ledger'}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded-md px-1.5 py-0.5 font-bold ${ACTION_TONE[row.plan.action]}`}>{ACTION_LABEL[row.plan.action]}</span>
                    <span className="mt-0.5 block text-text-3">{row.plan.reason}</span>
                  </td>
                  <td className="py-1.5">{row.plan.action === 'post' || row.plan.action === 'reclass' ? row.correctionDate : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results && results.some(r => r.status === 'failed') && (
        <div role="status" className="mt-3 whitespace-pre-line rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {results.filter(r => r.status === 'failed').map(r => `${r.ref}: ${r.message}`).join('\n')}
        </div>
      )}
    </div>
  )
}
