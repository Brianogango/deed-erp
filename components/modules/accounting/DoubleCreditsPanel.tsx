'use client'

import { useCallback, useEffect, useState } from 'react'
import { fmtKes } from '@/lib/store'

type Row = {
  invoiceId: string; invoiceRef: string; customerName: string
  creditId: string; creditRef: string; creditAmount: number; creditBalance: number
  alreadyCredited: number; correctAmount: number; extra: number; fixable: boolean; why?: string
}

/**
 * Cancel credits that gave a customer the same money twice: a paid invoice
 * cancelled after a credit note, before the cancel took the note into
 * account. Each row takes the extra back in one step. Shows nothing when
 * there are none.
 */
export default function DoubleCreditsPanel({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/double-credits')
      if (!res.ok) return
      const data = await res.json() as { rows?: Row[] }
      setRows(data.rows ?? [])
    } catch { /* offline: the panel simply stays empty */ }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!rows.length) return null

  const fix = async (r: Row) => {
    if (!window.confirm(`Take back ${fmtKes(r.extra)} on ${r.creditRef} (${r.customerName})?\n\nThe credit drops from ${fmtKes(r.creditAmount)} to ${fmtKes(r.correctAmount)}, and a journal puts back the sale and VAT that were reversed twice.`)) return
    setBusy(r.creditId)
    try {
      const res = await fetch('/api/admin/double-credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creditId: r.creditId }) })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not take the extra credit back')
      showToast(`${fmtKes(r.extra)} taken back on ${r.creditRef}`, 'success')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not take the extra credit back', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-4 mt-3 rounded-xl border p-3" style={{ borderColor: '#FECACA', background: '#FEF2F2' }}>
      <p className="text-[12px] font-bold" style={{ color: '#991B1B' }}>
        {rows.length} cancelled invoice{rows.length === 1 ? '' : 's'} credited twice
      </p>
      <p className="mb-2 text-[11px] text-t2">
        These paid invoices were cancelled after a credit note, and the cancel credited the full payment again. Take the extra back to correct the customer’s credit and the books.
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map(r => (
          <div key={r.creditId} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white px-3 py-2 text-[11px]" style={{ border: '1px solid var(--border-lt)' }}>
            <span className="font-semibold text-t1">{r.invoiceRef}</span>
            <span className="text-t2">{r.customerName}</span>
            <span className="text-t3">Credit {r.creditRef}: {fmtKes(r.creditAmount)} · already credited {fmtKes(r.alreadyCredited)} · should be {fmtKes(r.correctAmount)}</span>
            <span className="font-semibold" style={{ color: '#991B1B' }}>Extra {fmtKes(r.extra)}</span>
            <span className="ml-auto">
              {r.fixable ? (
                <button type="button" className="btn-primary text-[11px] py-1 px-3" disabled={busy === r.creditId} onClick={() => { void fix(r) }}>
                  {busy === r.creditId ? 'Taking back…' : 'Take back extra credit'}
                </button>
              ) : (
                <span className="text-t3">{r.why} — recover it from the customer by hand</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
