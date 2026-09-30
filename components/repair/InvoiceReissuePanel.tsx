'use client'

import { useState } from 'react'
import { useRepairStore } from '@/lib/store'
import { INVOICE_REISSUE_ROLES, reissueBlocker, type InvoiceReissue } from '@/lib/repair/invoice-reissue'

const kes = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE')}`

/**
 * Where a re-quote on an already-invoiced job stands, and Finance's one step:
 * credit the old invoice and free the repair to be billed from the approved
 * quote (lib/repair/invoice-reissue.ts).
 */
export default function InvoiceReissuePanel({ repairId, repairRef, reissue, role }: {
  repairId: string
  repairRef: string
  reissue: InvoiceReissue | null | undefined
  role: string
}) {
  const { updateRepair, showToast } = useRepairStore()
  const [busy, setBusy] = useState(false)
  if (!reissue || reissue.status === 'dropped') return null

  const canReissue = INVOICE_REISSUE_ROLES.includes(role)
  const figures = `${kes(reissue.previousTotal)} → ${kes(reissue.revisedTotal)}`

  const run = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/repairs/${encodeURIComponent(repairId)}/reissue-invoice`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(body.error || 'The invoice could not be reissued', 'error'); return }
      // Mirror the server so a stale local copy cannot relink the old invoice.
      updateRepair(repairId, {
        invoiceReissue: body.reissue,
        invoiceId: undefined,
        linkedInvoiceId: undefined,
        linkedInvoiceRef: undefined,
      } as never)
      showToast(`${reissue.invoiceRef} credited${body.reissue?.creditNoteRef ? ` (${body.reissue.creditNoteRef})` : ''}. Create the new invoice for ${repairRef} as usual.`)
    } finally {
      setBusy(false)
    }
  }

  const tone = reissue.status === 'credited'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : 'border-amber-200 bg-amber-50 text-amber-900'

  return (
    <div className={`mt-2.5 rounded-xl border px-3.5 py-2.5 ${tone}`} role="status">
      <p className="m-0 text-[12px] font-black">
        {reissue.status === 'credited' ? `Invoice ${reissue.invoiceRef} credited` : `Invoice ${reissue.invoiceRef} needs reissuing`}
        <span className="ml-2 font-semibold">{figures}</span>
      </p>
      <p className="m-0 mt-0.5 text-[11px] font-semibold leading-relaxed">
        {reissue.status === 'credited'
          ? <>Credit note {reissue.creditNoteRef || '—'} by {reissue.creditedBy}.{' '}
              {reissue.customerCredit ? <>The client&apos;s {kes(reissue.customerCredit)} paid is held as their credit — apply it to the new invoice once posted. </> : null}
              Create the new invoice from the approved quote as usual.</>
          : reissueBlocker(reissue)}
      </p>
      {reissue.status === 'pending' && (
        canReissue
          ? (
            <button type="button" className="btn-primary mt-2 px-3 py-1.5 text-[11px]" onClick={run} disabled={busy}>
              {busy ? 'Reissuing…' : `Credit ${reissue.invoiceRef} and reissue`}
            </button>
          )
          : <p className="m-0 mt-1 text-[11px]">Finance or a director does this step.</p>
      )}
    </div>
  )
}
