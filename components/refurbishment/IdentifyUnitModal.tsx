'use client'

import { useMemo, useState } from 'react'
import { Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { useApp, type RefurbishmentJob } from '@/lib/store'
import { isPlaceholderProductName } from '@/lib/refurbishment/unidentified'

const isSerialized = (p: { requiresSerial?: boolean; trackingMethod?: string }) => Boolean(p.requiresSerial || p.trackingMethod === 'SERIAL')

/** The bench found the real serial (sticker or BIOS): record it, the model and specs. */
export function IdentifyUnitModal({ job, onClose }: { job: RefurbishmentJob; onClose: () => void }) {
  const { products, serials, identifyRefurbUnit } = useApp()
  const onPlaceholder = isPlaceholderProductName(job.productName)
  const [serial, setSerial] = useState('')
  const [productId, setProductId] = useState(onPlaceholder ? '' : job.productId)
  const [specs, setSpecs] = useState(job.specs || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const choices = useMemo(() => products
    .filter(p => isSerialized(p) && p.isActive !== false && !isPlaceholderProductName(p.name))
    .sort((a, b) => a.name.localeCompare(b.name)), [products])
  const known = serial.trim() ? serials.find(s => s.id !== job.serialId && s.serial.trim().toLowerCase() === serial.trim().toLowerCase()) : undefined

  async function save() {
    setError('')
    if (serial.trim().length < 3) return setError('Enter the serial number from the machine')
    if (!productId) return setError('Choose the model. If it is not in the catalog, add it in Inventory first.')
    setSaving(true)
    const ok = await identifyRefurbUnit(job.id, { serial: serial.trim(), productId, specs: specs.trim() || undefined })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal title={`Identify ${job.intakeTag || job.serialNumber}`} subtitle="Record the real serial and model once the machine is readable" onClose={onClose} width={520}>
      <div className="space-y-3">
        {error && <div role="alert" className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div>}
        <Field label="Serial number" required hint="From the sticker underneath, the BIOS, or the battery bay">
          <Input value={serial} onChange={setSerial} placeholder="e.g. 5CG1234ABC" autoFocus />
        </Field>
        {known && (
          <p className="rounded-md px-3 py-2 text-[11px]" style={{ background: known.status === 'sold' || known.status === 'written_off' || known.location === 'customer' ? 'var(--info-bg)' : 'var(--danger-bg)', color: known.status === 'sold' || known.status === 'written_off' || known.location === 'customer' ? 'var(--info-text)' : 'var(--danger-text)' }}>
            {known.status === 'sold' || known.status === 'written_off' || known.location === 'customer'
              ? `We had this machine before (${known.productName}, ${known.status}). Saving takes over its record, so its history stays with it.`
              : `${known.serial} is already in stock (${known.status}). Check the serial — one machine cannot be in two places.`}
          </p>
        )}
        <Field label="Model" required hint={onPlaceholder ? `Filed as ${job.productName}; choose what it really is` : undefined}>
          <Select value={productId} onChange={setProductId} options={[{ value: '', label: 'Choose the model…' }, ...choices.map(p => ({ value: p.id, label: `${p.name}${p.sku ? ` · ${p.sku}` : ''}` }))]} />
        </Field>
        <Field label="Specs" hint="As found: CPU, RAM, storage, screen">
          <Textarea value={specs} onChange={setSpecs} rows={2} placeholder="e.g. i5-8350U, 8GB RAM, 256GB SSD, 14in FHD" />
        </Field>
        <p className="text-[10px] text-t3">The tag stays on the machine as its barcode, so the sticker still scans. Reprint the label afterwards.</p>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save identification'}</button>
        </div>
      </div>
    </Modal>
  )
}
