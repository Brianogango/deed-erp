'use client'

import { useState } from 'react'
import { Field, Input, Modal, Select } from '@/components/ui'
import { fmtKes, useApp, type DeliveryJob } from '@/lib/store'

/**
 * The customer paid the rider the delivery charge directly and the rest of
 * the invoice to us. Settles that much of the invoice ("paid to rider") and
 * takes it off the rider's pay for this trip, so neither is counted twice.
 */
export function CustomerPaidRiderModal({ job, onClose }: { job: DeliveryJob; onClose: () => void }) {
  const { recordCustomerPaidRider } = useApp()
  const [amount, setAmount] = useState(String(job.deliveryFee ?? job.riderFee ?? ''))
  const [method, setMethod] = useState<'cash' | 'mpesa'>('mpesa')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const n = Number(amount) || 0
  const net = (Number(job.riderFee) || 0) - n

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
          {job.invoiceRef
            ? <li>{fmtKes(n)} of {job.invoiceRef} is marked paid (“paid to rider”), so the customer is not asked for it again.</li>
            : <li>This trip is not on an invoice, so only the rider’s pay changes.</li>}
          <li>
            {net >= 0
              ? <>Rider pay for this trip becomes {fmtKes(net)} (fee {fmtKes(job.riderFee)} less {fmtKes(n)}).</>
              : <>The customer paid {fmtKes(-net)} more than the rider’s fee: it comes off the rest of the rider’s pay this week.</>}
          </li>
        </ul>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving || !(n > 0)} onClick={() => void save()}>{saving ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
    </Modal>
  )
}
