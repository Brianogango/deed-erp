'use client'

import { useState } from 'react'
import { Field, Input, Modal, Select } from '@/components/ui'
import { fmtKes, useApp, type DeliveryJob } from '@/lib/store'

/**
 * The customer paid the rider the delivery charge directly and the rest of
 * the invoice to us. That money stays off our books: the charge comes off
 * the invoice (credit note once posted) and off the rider's pay.
 */
export function CustomerPaidRiderModal({ job, onClose }: { job: DeliveryJob; onClose: () => void }) {
  const { recordCustomerPaidRider } = useApp()
  const [amount, setAmount] = useState(String(job.deliveryFee ?? job.riderFee ?? ''))
  const [method, setMethod] = useState<'cash' | 'mpesa'>('mpesa')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const n = Number(amount) || 0
  const net = Math.max(0, (Number(job.riderFee) || 0) - n)

  async function save() {
    setSaving(true)
    const ok = await recordCustomerPaidRider(job.id, { amount: n, method, reference })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal title="Customer paid the rider directly" subtitle={`${job.ref} · ${job.riderName ?? 'rider'} · ${job.customerName}`} onClose={onClose} width={460}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount the customer paid the rider" required>
            <Input type="number" value={amount} onChange={setAmount} />
          </Field>
          <Field label="How">
            <Select value={method} onChange={v => setMethod(v as 'cash' | 'mpesa')} options={[{ value: 'mpesa', label: 'M-Pesa to the rider' }, { value: 'cash', label: 'Cash to the rider' }]} />
          </Field>
        </div>
        {method === 'mpesa' && (
          <Field label="M-Pesa code (optional)">
            <Input value={reference} onChange={setReference} placeholder="e.g. SKL4ABC123" />
          </Field>
        )}
        <ul className="text-[11px] text-t2 space-y-1 list-disc pl-4">
          <li>The delivery charge comes off the invoice{job.invoiceRef ? ` (${job.invoiceRef})` : ''}: removed from a draft, or a credit note once posted. It is not our sale or our cost.</li>
          <li>Rider pay for this trip becomes {fmtKes(net)} (fee {fmtKes(job.riderFee)}{n > 0 ? ` less ${fmtKes(Math.min(n, Number(job.riderFee) || 0))}` : ''}){n > (Number(job.riderFee) || 0) ? '. Anything above the fee is the rider’s to keep.' : '.'}</li>
        </ul>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving || !(n > 0)} onClick={() => void save()}>{saving ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
    </Modal>
  )
}
