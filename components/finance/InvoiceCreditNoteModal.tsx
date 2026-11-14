'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal, Field, Input, Textarea } from '@/components/ui'
import { fmtKes } from '@/lib/store'

type Line = { id: string; description: string; lineTotal: number; credited: number; open: number }
export type CreditNoteResult = { ref: string; amount: number; appliedToAr: number; customerCredit: number }

/**
 * Credit note on a posted customer invoice: what was not done (or was
 * overcharged), by line, VAT included. Anything the customer already paid
 * for it becomes their credit, to refund or use later.
 */
export function InvoiceCreditNoteModal({ invoiceId, invoiceRef, partnerName, balance, onClose, onDone }: {
  invoiceId: string
  invoiceRef: string
  partnerName: string
  /** What the customer still owes on the invoice. */
  balance: number
  onClose: () => void
  onDone: (result: CreditNoteResult) => void
}) {
  const [lines, setLines] = useState<Line[] | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/invoices/${invoiceId}/credit-note`, { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as { lines?: Line[]; error?: string } | null
        if (!res.ok) throw new Error(data?.error || `Could not load the invoice lines (${res.status})`)
        if (live) setLines(data?.lines ?? [])
      })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : 'Could not load the invoice lines') })
    return () => { live = false }
  }, [invoiceId])

  const total = useMemo(() => Math.round((lines ?? []).reduce((s, l) => s + Math.min(l.open, Math.max(0, Number(amounts[l.id]) || 0)), 0) * 100) / 100, [lines, amounts])
  const toCredit = Math.max(0, Math.round((total - Math.max(0, balance)) * 100) / 100)
  const tooMuch = (lines ?? []).some(l => (Number(amounts[l.id]) || 0) > l.open + 0.009)

  const submit = async () => {
    if (!reason.trim()) { setError('Say why the credit is given'); return }
    if (!(total > 0)) { setError('Enter the amount to credit on at least one line'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/credit-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          lines: (lines ?? []).filter(l => Number(amounts[l.id]) > 0).map(l => ({ invoiceItemId: l.id, amount: Math.min(l.open, Number(amounts[l.id])) })),
        }),
      })
      const data = await res.json().catch(() => null) as { creditNote?: CreditNoteResult; error?: string } | null
      if (!res.ok || !data?.creditNote) throw new Error(data?.error || `Credit note failed (${res.status})`)
      onDone(data.creditNote)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credit note failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Credit note" subtitle={`${invoiceRef} · ${partnerName}`} onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <p className="text-[11px] text-[var(--text-3)]">
          For work not done or an overcharge. Enter how much to take off each line (VAT included). The sale and its VAT go down by that much.
        </p>
        {lines === null && !error && <p className="text-[11px] text-[var(--text-4)]">Loading lines…</p>}
        {lines && (
          <div className="flex flex-col divide-y rounded-xl border border-[var(--border-lt)]">
            {lines.map(line => (
              <div key={line.id} className="grid grid-cols-[1fr_120px] items-center gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--text-1)]">{line.description}</p>
                  <p className="text-[10px] text-[var(--text-4)]">
                    {fmtKes(line.lineTotal)}{line.credited > 0 ? ` · already credited ${fmtKes(line.credited)}` : ''} · up to {fmtKes(line.open)}
                  </p>
                </div>
                <Input type="number" value={amounts[line.id] ?? ''} onChange={v => setAmounts(a => ({ ...a, [line.id]: v }))} placeholder="0" disabled={line.open <= 0} />
              </div>
            ))}
          </div>
        )}
        <Field label="Reason *">
          <Textarea value={reason} onChange={setReason} rows={2} placeholder="e.g. Keyboard replacement not done — part unavailable" />
        </Field>
        <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3 text-[11px] text-[var(--text-2)]">
          <p>Credit note total: <span className="font-mono font-bold">{fmtKes(total)}</span></p>
          {total > 0 && (toCredit > 0
            ? <p className="mt-1">{fmtKes(Math.min(total, Math.max(0, balance)))} comes off what {partnerName} still owes; <b>{fmtKes(toCredit)}</b> was already paid and becomes their credit — refund it from Finance → Customer credits, or keep it for their next purchase.</p>
            : <p className="mt-1">It comes off what {partnerName} still owes on this invoice.</p>)}
        </div>
        {tooMuch && <p className="text-[11px] text-amber-600">A line can be credited up to what is left on it.</p>}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary disabled:opacity-40" disabled={busy || !(total > 0) || tooMuch} onClick={() => { void submit() }}>
            {busy ? 'Issuing…' : 'Issue credit note'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
