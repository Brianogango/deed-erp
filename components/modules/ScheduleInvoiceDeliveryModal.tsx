'use client'

import { useState } from 'react'
import { Modal, Field, Input } from '@/components/ui'
import { Fa, faTruck } from '@/components/icons'
import type { Invoice, Rider } from '@/lib/store'
import { fmtKes } from '@/lib/store'
import {
  parseRiderFeeInput,
  suggestRiderFeePrefill,
} from '@/lib/delivery-job-fee'

export interface ScheduleInvoiceDeliveryForm {
  deliveryAddress: string
  scheduledDate: string
  riderId: string
  riderFee: string
  deliveryFee: string
  notes: string
}

export function ScheduleInvoiceDeliveryModal({
  invoice,
  riders,
  companyPickup,
  contactPhone,
  onClose,
  onConfirm,
}: {
  invoice: Invoice
  riders: Rider[]
  companyPickup: string
  contactPhone?: string
  onClose: () => void
  onConfirm: (opts: {
    deliveryAddress: string
    scheduledDate: string
    riderFee: number
    deliveryFee?: number
    riderId?: string
    notes?: string
  }) => void
}) {
  const [form, setForm] = useState<ScheduleInvoiceDeliveryForm>({
    deliveryAddress: invoice.deliveryAddress || '',
    // The user picks the delivery date; nothing is assumed.
    scheduledDate: '',
    riderId: '',
    riderFee: '',
    deliveryFee: '',
    notes: '',
  })

  const [formError, setFormError] = useState('')
  const set = (k: keyof ScheduleInvoiceDeliveryForm, v: string) => {
    setForm(p => ({ ...p, [k]: v }))
    if (formError) setFormError('')
  }

  const handleRiderChange = (id: string) => {
    const rider = riders.find(r => r.id === id)
    setForm(p => ({
      ...p,
      riderId: id,
      riderFee: suggestRiderFeePrefill(p.riderFee, rider?.ratePerDelivery),
    }))
    if (formError) setFormError('')
  }

  const riderFee = parseRiderFeeInput(form.riderFee)
  const deliveryFee = form.deliveryFee.trim() === ''
    ? null
    : parseRiderFeeInput(form.deliveryFee)
  const missingFields = [
    !form.deliveryAddress.trim() && 'Delivery address',
    !form.scheduledDate && 'Scheduled date',
    (deliveryFee === null || deliveryFee <= 0) && 'Delivery charge (greater than zero)',
    riderFee === null && 'Rider fee',
  ].filter((v): v is string => Boolean(v))

  return (
    <Modal
      title="Schedule Rider Delivery"
      subtitle={invoice.ref}
      onClose={onClose}
      width={520}
      icon={<Fa icon={faTruck} />}
      accent="#0EA5E9"
    >
      <div className="flex flex-col gap-4">
        <p className="text-[11px] text-[var(--text-3)]">
          Creates a <strong>sales delivery</strong> job for {invoice.partnerName}
          {contactPhone ? ` (${contactPhone})` : ''}. Pickup: {companyPickup || 'Shop'}.
        </p>

        <Field label="Delivery Address *">
          <textarea
            className="form-input text-xs w-full"
            rows={2}
            value={form.deliveryAddress}
            onChange={e => set('deliveryAddress', e.target.value)}
            placeholder="Full delivery address"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Scheduled Date *">
            <Input type="date" value={form.scheduledDate} onChange={v => set('scheduledDate', v)} />
          </Field>
          <Field label="Assign Rider">
            <select
              aria-label="Assign rider"
              className="form-input text-xs w-full"
              value={form.riderId}
              onChange={e => handleRiderChange(e.target.value)}
            >
              <option value="">— Assign later —</option>
              {riders.filter(r => r.active).map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.vehicle}
                  {r.ratePerDelivery > 0 ? ` · default ${fmtKes(r.ratePerDelivery)}` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Delivery charge (customer) KES *">
            <Input
              type="number"
              value={form.deliveryFee}
              onChange={v => set('deliveryFee', v)}
              placeholder="Added as invoice line"
            />
          </Field>
          <Field label="Rider fee (KES) *">
            <Input
              type="number"
              value={form.riderFee}
              onChange={v => set('riderFee', v)}
              placeholder="What rider is paid"
            />
          </Field>
        </div>

        <p className="text-[10px] text-[var(--text-4)] -mt-1">
          Delivery charge is added as an invoice line (draft or posted) and updates the invoice total.
          Rider fee is separate and paid to the rider.
        </p>

        <Field label="Notes">
          <textarea
            className="form-input text-xs w-full"
            rows={2}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Gate code, fragile, call on arrival…"
          />
        </Field>

        {formError && (
          <p role="alert" className="text-[11px] font-semibold text-red-600 -mb-2">{formError}</p>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-lt)]">
          <button type="button" className="btn-outline text-xs" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1.5"
            onClick={() => {
              if (missingFields.length > 0 || riderFee === null || deliveryFee === null || deliveryFee <= 0) {
                setFormError(`Please fill in: ${missingFields.join(', ')}`)
                return
              }
              onConfirm({
                deliveryAddress: form.deliveryAddress.trim(),
                scheduledDate: form.scheduledDate,
                riderFee,
                deliveryFee,
                riderId: form.riderId || undefined,
                notes: form.notes.trim() || undefined,
              })
            }}
          >
            <Fa icon={faTruck} /> Create Delivery Job
          </button>
        </div>
      </div>
    </Modal>
  )
}
