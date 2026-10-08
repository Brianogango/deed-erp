'use client'

import { useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { ReconcileRow } from '@/lib/inventory/stock-reconcile'

/**
 * Finance → Accounting → Integrity controls: quantity stock where the screens
 * and the database disagree; both take the lower number
 * (lib/inventory/stock-reconcile.ts). Serial-tracked items are not touched.
 */
export default function StockReconcile({ showToast, canApply }: { showToast: (msg: string, type?: 'error' | 'success' | 'info') => void; canApply: boolean }) {
  const [rows, setRows] = useState<ReconcileRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const value = (rows ?? []).reduce((s, r) => s + (Math.max(r.copyQty, r.tableQty) - r.target) * r.unitCost, 0)

  const load = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/inventory/stock-reconcile', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      setRows(body?.rows ?? [])
    } catch (err) {
      showToast(`Could not check: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!rows?.length) return
    if (!window.confirm(`Set ${rows.length} item${rows.length === 1 ? '' : 's'} to the lower of the two counts?\n\nUnits removed are recorded as stock moves and in the audit log. No ledger entry is made — the value at cost (${fmtKes(value)}) is for the accountant.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/inventory/stock-reconcile', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      showToast(`${body?.rows?.length ?? 0} item${body?.rows?.length === 1 ? '' : 's'} reconciled (${body?.ref ?? ''})`, 'success')
      await load()
    } catch (err) {
      showToast(`Could not reconcile: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border-lt bg-card p-4 sm:mx-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">Stock counts that disagree</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-3">
            Items counted by quantity (not serial) where the screens and the database hold different counts.
            Both are set to the lower number.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void load()}>
            {busy && !rows ? 'Checking…' : rows ? 'Check again' : 'Check'}
          </button>
          {!!rows?.length && canApply && (
            <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void apply()}>
              {busy ? 'Correcting…' : `Correct ${rows.length}`}
            </button>
          )}
        </div>
      </div>
      {rows && rows.length === 0 && <p className="mt-3 text-xs font-semibold text-emerald-700">Every count agrees.</p>}
      {!!rows?.length && !canApply && <p className="mt-3 text-xs text-amber-800">A director can apply the correction.</p>}
      {!!rows?.length && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3">
              <tr><th className="py-1 pr-3">Item</th><th className="py-1 pr-3 text-right">Screens</th><th className="py-1 pr-3 text-right">Database</th><th className="py-1 pr-3 text-right">Set to</th><th className="py-1 text-right">Value removed</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.productId} className="border-t border-border-lt">
                  <td className="py-1 pr-3">{r.product}</td>
                  <td className="py-1 pr-3 text-right">{r.copyQty}</td>
                  <td className="py-1 pr-3 text-right">{r.tableQty}</td>
                  <td className="py-1 pr-3 text-right font-bold">{r.target}</td>
                  <td className="py-1 text-right">{fmtKes((Math.max(r.copyQty, r.tableQty) - r.target) * r.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-text-3">Value at cost of the units removed: {fmtKes(value)}. No ledger entry is made.</p>
        </div>
      )}
    </div>
  )
}
