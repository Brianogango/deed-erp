'use client'

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui'
import { fmtKes } from '@/lib/store'
import {
  consolidationCandidates,
  type ConsolidatableRepair,
} from '@/lib/repair/consolidated-invoice'
import { planRepairConsolidation } from '@/lib/repair/consolidation-plan'

type Repair = ConsolidatableRepair & { id: string; ref: string; productName?: string; serialNumber?: string; customerName?: string }

/**
 * Pick several of one client's finished repairs and bill them on one invoice.
 *
 * The preview is the plan itself, not a separate estimate: what is shown here
 * is exactly the sale order that will be written, so the totals cannot drift
 * from what the customer is billed.
 */
export default function ConsolidatedBillingModal({
  anchor,
  repairs,
  onConfirm,
  onClose,
}: {
  anchor: Repair
  repairs: Repair[]
  onConfirm: (repairIds: string[]) => Promise<unknown>
  onClose: () => void
}) {
  const candidates = useMemo(() => consolidationCandidates(repairs, anchor), [repairs, anchor])
  const [picked, setPicked] = useState<string[]>(() => [anchor.id])
  const [busy, setBusy] = useState(false)

  const selected = useMemo(
    () => picked.map(id => repairs.find(r => r.id === id)).filter((r): r is Repair => !!r),
    [picked, repairs],
  )
  const plan = useMemo(() => planRepairConsolidation({ repairs: selected }), [selected])

  const toggle = (id: string) => setPicked(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const confirm = async () => {
    if (!plan.ok || busy) return
    setBusy(true)
    try {
      const invoice = await onConfirm(plan.repairIds)
      if (invoice) onClose()
    } finally {
      setBusy(false)
    }
  }

  const selectable = candidates.filter(c => c.blocker === null).length

  return (
    <Modal
      variant="enterprise"
      title="Bill repairs together"
      subtitle={anchor.customerName || anchor.ref}
      onClose={onClose}
      width={560}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={confirm} disabled={!plan.ok || busy}>
            {busy ? 'Creating invoice…' : plan.ok ? `Create one invoice for ${plan.repairIds.length} repairs` : 'Create invoice'}
          </button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[11px] leading-relaxed text-[var(--text-2)]">
          The selected repairs are merged into one sale order and invoiced as a draft for Finance review.
          Each repair is charged exactly what it would be on its own. Their separate sale orders are cancelled.
        </p>

        {selectable < 2 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
            This client has no other finished, unbilled repair to add. Use Create invoice for this one.
          </p>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--text-4)]">
            Repairs for this client
          </legend>
          {candidates.map(({ repair, blocker }) => {
            const checked = picked.includes(repair.id)
            const disabled = blocker !== null && !checked
            return (
              <label
                key={repair.id}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${checked ? 'border-sky-400 bg-sky-50/60' : 'border-[var(--border)]'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(repair.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold text-[var(--text-1)]">
                    {repair.ref}{repair.productName ? ` — ${repair.productName}` : ''}
                  </span>
                  {repair.serialNumber && (
                    <span className="block text-[10px] text-[var(--text-3)]">S/N {repair.serialNumber}</span>
                  )}
                  {blocker && (
                    <span className="block text-[10px] font-semibold text-amber-700">{blocker}</span>
                  )}
                </span>
              </label>
            )
          })}
        </fieldset>

        {plan.ok ? (
          <div className="rounded-lg border border-[var(--border)]">
            <table className="w-full text-[11px]">
              <tbody>
                {plan.lines.map((line, i) => line.lineType === 'section' ? (
                  <tr key={i} className="bg-[var(--bg-surface)]">
                    <td colSpan={2} className="px-3 py-1.5 font-black text-[var(--text-1)]">{line.description}</td>
                  </tr>
                ) : (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="px-3 py-1.5 text-[var(--text-2)]">
                      {line.description.replace(/^[^·]+· /, '')}
                      {line.qty !== 1 ? ` × ${line.qty}` : ''}
                      {line.taxRate > 0 ? <span className="ml-1 text-[var(--text-4)]">(VAT {line.taxRate}%)</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-1)]">{fmtKes(line.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-[var(--border)]">
                <tr><td className="px-3 pt-2 text-[var(--text-3)]">Subtotal</td><td className="px-3 pt-2 text-right tabular-nums">{fmtKes(plan.subtotal)}</td></tr>
                <tr><td className="px-3 text-[var(--text-3)]">VAT</td><td className="px-3 text-right tabular-nums">{fmtKes(plan.taxTotal)}</td></tr>
                <tr><td className="px-3 pb-2 font-black text-[var(--text-1)]">Total</td><td className="px-3 pb-2 text-right font-black tabular-nums">{fmtKes(plan.total)}</td></tr>
              </tfoot>
            </table>
            {plan.mixedVat && (
              <p className="border-t border-[var(--border)] px-3 py-2 text-[10px] font-semibold text-amber-700">
                Some repairs were quoted with VAT and some without. Each line keeps its own quote&apos;s rate — check before posting.
              </p>
            )}
          </div>
        ) : picked.length >= 2 ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{plan.reason}</p>
        ) : null}
      </div>
    </Modal>
  )
}
