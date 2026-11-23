'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PurchaseOrder } from '@/lib/store'
import { useFinanceStore, fmtKes } from '@/lib/store'
import { Modal, Field, Input, Select } from '@/components/ui'
import { bankChoiceLabel } from '@/lib/finance/bank-choice-label'

type Advance = { id: string; amount: number; applied: number; refunded: number; open: number; paidAt: string; method: string; reference: string | null }

const METHODS = [
  { value: 'bank_transfer', label: 'Bank' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
] as const
const methodLabel = (m: string) => METHODS.find(x => x.value === m)?.label ?? m.replace(/_/g, ' ')
const today = () => new Date().toISOString().slice(0, 10)
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * Money paid to the supplier before the goods arrive, on this order
 * (lib/purchase/vendor-advance-core.ts): what was paid, what of it is still
 * to be used on a bill, "Pay in advance" and "Refund".
 */
export default function PoAdvancePanel({ po, canPay, payOpen, onPayClose, onTotals, showToast }: {
  po: PurchaseOrder
  canPay: boolean
  payOpen: boolean
  onPayClose: () => void
  onTotals?: (t: { paid: number; open: number }) => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const { bankAccounts } = useFinanceStore()
  const activeBanks = (bankAccounts ?? []).filter(b => b.active)
  const [advances, setAdvances] = useState<Advance[]>([])
  const [refundFor, setRefundFor] = useState<Advance | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ amount: '', method: 'bank_transfer', bankAccountId: '', reference: '', date: today() })

  const paid = advances.reduce((s, a) => s + a.amount - a.refunded, 0)
  const open = advances.reduce((s, a) => s + a.open, 0)
  const room = Math.max(0, Math.round((Number(po.total) - paid) * 100) / 100)

  const load = useCallback(async () => {
    if (!canPay) return
    try {
      const r = await fetch(`/api/purchase-orders/${po.id}/advances`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (r.ok && Array.isArray(d.advances)) setAdvances(d.advances)
    } catch { /* offline: keep what is shown */ }
  }, [po.id, canPay])
  useEffect(() => { void load() }, [load, po.advancePaid, po.advanceOpen])
  useEffect(() => { onTotals?.({ paid, open }) }, [paid, open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (payOpen) setForm(f => ({ ...f, amount: room ? String(room) : '', reference: '', date: today() }))
  }, [payOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (kind: 'pay' | 'refund') => {
    const amount = Number(form.amount)
    if (!(amount > 0)) { showToast('Enter the amount', 'error'); return }
    if (form.method === 'bank_transfer' && activeBanks.length && !form.bankAccountId) { showToast('Pick the bank account', 'error'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/purchase-orders/${po.id}/advances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: kind, amount, method: form.method, bankAccountId: form.bankAccountId || undefined,
          reference: form.reference.trim() || undefined, date: form.date, ...(kind === 'refund' ? { advanceId: refundFor?.id } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || d.message || 'Could not record it')
      showToast(kind === 'pay' ? `${fmtKes(amount)} paid in advance on ${po.ref}` : `${fmtKes(amount)} refund recorded`, 'success')
      if (kind === 'pay') onPayClose(); else setRefundFor(null)
      void load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not record it', 'error')
    } finally {
      setBusy(false)
    }
  }

  const moneyFields = (
    <>
      <Field label="Amount (KES) *"><Input type="number" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: String(v) }))} placeholder="0" /></Field>
      <Field label="Date"><Input type="date" value={form.date} onChange={v => setForm(f => ({ ...f, date: String(v) }))} /></Field>
      <div className="po-advance__methods" role="radiogroup" aria-label="Paid by">
        {METHODS.map(m => (
          <button key={m.value} type="button" role="radio" aria-checked={form.method === m.value}
            className={form.method === m.value ? 'is-active' : ''} onClick={() => setForm(f => ({ ...f, method: m.value }))}>{m.label}</button>
        ))}
      </div>
      {activeBanks.length > 0 && (
        <Field label="Bank / cash account">
          <Select value={form.bankAccountId} onChange={v => setForm(f => ({ ...f, bankAccountId: String(v) }))}
            options={[{ value: '', label: 'Select account…' }, ...activeBanks.map(b => ({ value: b.id, label: bankChoiceLabel(b) }))]} />
        </Field>
      )}
      <Field label="Reference"><Input value={form.reference} onChange={v => setForm(f => ({ ...f, reference: String(v) }))} placeholder="e.g. M-Pesa code or transfer ref" /></Field>
    </>
  )

  return (
    <>
      {advances.length > 0 && (
        <section className="po-advance" aria-label="Paid in advance">
          <div className="po-advance__head">
            <div>
              <strong>{paid > 0 ? `Paid in advance ${fmtKes(paid)}` : 'Advance refunded'}</strong>
              <span>{open > 0 ? `${fmtKes(open)} not yet used on a bill — it settles the bill when it is confirmed` : paid > 0 ? 'All used on bills' : 'The supplier paid it back'}</span>
            </div>
          </div>
          <ul>
            {advances.map(a => (
              <li key={a.id}>
                <span>{fmtDay(a.paidAt)} · {methodLabel(a.method)}{a.reference ? ` · ${a.reference}` : ''}</span>
                <b>{fmtKes(a.amount)}</b>
                {a.refunded > 0 && <small>refunded {fmtKes(a.refunded)}</small>}
                {a.open > 0 && canPay && (
                  <button type="button" onClick={() => { setForm(f => ({ ...f, amount: String(a.open), reference: '', date: today() })); setRefundFor(a) }}>Refund</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {payOpen && (
        <Modal title="Pay in advance" subtitle={`${po.ref} · ${po.vendorName}`} width={480} variant="enterprise" onClose={() => { if (!busy) onPayClose() }}
          footer={(
            <>
              <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={onPayClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={() => void submit('pay')} disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</button>
            </>
          )}>
          <div className="po-advance__form">
            <p className="po-advance__note">
              For paying before the goods arrive. It is kept as an advance to {po.vendorName} and settles their bill when you confirm it.
              {room < Number(po.total) ? ` ${fmtKes(Number(po.total) - room)} is already paid; up to ${fmtKes(room)} more.` : ''}
            </p>
            {moneyFields}
          </div>
        </Modal>
      )}

      {refundFor && (
        <Modal title="Supplier refunded the advance" subtitle={`${po.ref} · up to ${fmtKes(refundFor.open)}`} width={480} variant="enterprise" onClose={() => { if (!busy) setRefundFor(null) }}
          footer={(
            <>
              <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => setRefundFor(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={() => void submit('refund')} disabled={busy}>{busy ? 'Recording…' : 'Record refund'}</button>
            </>
          )}>
          <div className="po-advance__form">
            <p className="po-advance__note">Money the supplier paid back because the goods will not come. It goes into the account you pick.</p>
            {moneyFields}
          </div>
        </Modal>
      )}
    </>
  )
}
