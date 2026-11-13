'use client'

import { useMemo, useState } from 'react'
import { Field, Input, Modal, Textarea } from '@/components/ui'
import { useApp, type Product, type RefurbishmentJob } from '@/lib/store'
import { RefurbProductPicker } from '@/components/refurbishment/RefurbProductPicker'
import { isPlaceholderProductName } from '@/lib/refurbishment/unidentified'
import { specDifferences, variantName } from '@/lib/refurbishment/variant'

const isSerialized = (p: { requiresSerial?: boolean; trackingMethod?: string }) => Boolean(p.requiresSerial || p.trackingMethod === 'SERIAL')

/**
 * The bench found the real serial (sticker or BIOS): record it, find the
 * model in inventory and the specs. When the specs differ from the model's
 * (16GB instead of 8GB, a bigger SSD), create a variant "Model - specs" in
 * one click and file the machine under it.
 */
export function IdentifyUnitModal({ job, onClose }: { job: RefurbishmentJob; onClose: () => void }) {
  const { products, serials, identifyRefurbUnit, refreshProductCatalog, showToast } = useApp()
  const onPlaceholder = isPlaceholderProductName(job.productName)
  const [serial, setSerial] = useState('')
  const [productId, setProductId] = useState(onPlaceholder ? '' : job.productId)
  const [specs, setSpecs] = useState(job.specs || '')
  const [variantLabel, setVariantLabel] = useState('')
  const [keepModel, setKeepModel] = useState(false)
  // The variant just created: on screen before the catalog list has it.
  const [createdVariant, setCreatedVariant] = useState<{ id: string; name: string } | null>(null)
  // A model just created from the search: on screen before the list has it.
  const [createdModel, setCreatedModel] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const choices = useMemo(() => products
    .filter(p => isSerialized(p) && p.isActive !== false && !isPlaceholderProductName(p.name))
    .sort((a, b) => a.name.localeCompare(b.name)), [products])
  const chosen = choices.find(p => p.id === productId)
    ?? (createdModel && createdModel.id === productId ? createdModel : undefined)
    ?? (createdVariant && createdVariant.id === productId ? { ...createdVariant, description: '', sku: '', stockQty: 0 } : undefined)
  const onVariant = !!createdVariant && createdVariant.id === productId
  const known = serial.trim() ? serials.find(s => s.id !== job.serialId && s.serial.trim().toLowerCase() === serial.trim().toLowerCase()) : undefined
  const differences = useMemo(
    // A variant made for these specs is not compared again.
    () => (chosen && !onVariant && specs.trim() ? specDifferences(specs, `${chosen.name} ${chosen.description ?? ''}`) : []),
    [chosen, onVariant, specs],
  )
  const suggestedVariant = chosen ? variantName(chosen.name, specs) : ''
  const showVariant = differences.length > 0 && !keepModel

  async function createVariant() {
    if (!chosen) return
    setError('')
    setCreating(true)
    try {
      const res = await fetch('/api/refurbishment/variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseProductId: chosen.id, specs: specs.trim(), name: (variantLabel || suggestedVariant).trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.product?.id) { setError(data.error || 'Could not create the variant'); return }
      setCreatedVariant({ id: data.product.id, name: data.product.name })
      setProductId(data.product.id)
      setKeepModel(false)
      setVariantLabel('')
      void refreshProductCatalog().catch(() => 0)
      showToast(data.created ? `Variant created: ${data.product.name}` : `Using the existing variant ${data.product.name}`)
    } finally {
      setCreating(false)
    }
  }

  async function save() {
    setError('')
    if (serial.trim().length < 3) return setError('Enter the serial number from the machine')
    if (!productId) return setError('Find the model in inventory, or create it from the search.')
    if (showVariant) return setError('The specs differ from the model: create the variant, or choose to keep the model as it is')
    setSaving(true)
    const ok = await identifyRefurbUnit(job.id, { serial: serial.trim(), productId, specs: specs.trim() || undefined })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal title={`Identify ${job.intakeTag || job.serialNumber}`} subtitle="Record the real serial and model once the machine is readable" onClose={onClose} width={560}>
      <div className="space-y-3">
        {error && <div role="alert" className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div>}

        <Field label="1. Serial number" required hint="From the sticker underneath, the BIOS, or the battery bay">
          <Input value={serial} onChange={setSerial} placeholder="e.g. 5CG1234ABC" autoFocus />
        </Field>
        {known && (
          <p className="rounded-md px-3 py-2 text-[11px]" style={{ background: known.status === 'sold' || known.status === 'written_off' || known.location === 'customer' ? 'var(--info-bg)' : 'var(--danger-bg)', color: known.status === 'sold' || known.status === 'written_off' || known.location === 'customer' ? 'var(--info-text)' : 'var(--danger-text)' }}>
            {known.status === 'sold' || known.status === 'written_off' || known.location === 'customer'
              ? `We had this machine before (${known.productName}, ${known.status}). Saving takes over its record, so its history stays with it.`
              : `${known.serial} is already in stock (${known.status}). Check the serial — one machine cannot be in two places.`}
          </p>
        )}

        <div className="space-y-1">
          <RefurbProductPicker
            kind="machine"
            label="2. Model in inventory *"
            placeholder="Search: EliteBook 840 G5, Latitude 5490…"
            items={choices}
            selected={chosen}
            onPick={p => {
              if (p.id === productId) return
              if (!choices.some(c => c.id === p.id)) setCreatedModel(p)
              setProductId(p.id); setKeepModel(false); setVariantLabel('')
            }}
          />
          {onPlaceholder && !chosen && <p className="text-[10px] text-t3">Filed as {job.productName}; choose what it really is.</p>}
          {onVariant && <p className="text-[11px]" style={{ color: 'var(--success-text)' }}>Filed under the new variant {createdVariant!.name}.</p>}
        </div>

        <Field label="3. Specs as found" hint="CPU, RAM, storage, screen">
          <Textarea value={specs} onChange={setSpecs} rows={2} placeholder="e.g. Intel Core i5 8th Gen, 16GB RAM, 512GB SSD, 14in FHD" />
        </Field>

        {chosen && differences.length > 0 && (
          <div className="rounded-lg p-3 space-y-2" style={{ background: keepModel ? 'var(--bg-muted)' : 'var(--warning-bg)', border: `1px solid ${keepModel ? 'var(--border-lt)' : '#FCD34D'}` }}>
            <p className="text-xs font-bold" style={{ color: keepModel ? 'var(--text-2)' : 'var(--warning-text)' }}>
              This machine differs from {chosen.name}
            </p>
            <ul className="text-[11px] space-y-0.5" style={{ color: keepModel ? 'var(--text-3)' : 'var(--warning-text)' }}>
              {differences.map(d => <li key={d.label}>{d.label}: this machine {d.machine}, the product {d.product}</li>)}
            </ul>
            {!keepModel && (
              <>
                <Field label="Variant name" hint="Created as its own product under the same model, priced like it until Inventory changes it">
                  <Input value={variantLabel || suggestedVariant} onChange={setVariantLabel} />
                </Field>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className="btn-outline text-xs" onClick={() => setKeepModel(true)}>Keep {chosen.name}</button>
                  <button type="button" className="btn-primary text-xs" disabled={creating} onClick={() => void createVariant()}>
                    {creating ? 'Creating…' : 'Create variant'}
                  </button>
                </div>
              </>
            )}
            {keepModel && <p className="text-[11px] text-t3">Filed under {chosen.name}; its specs are kept on this machine.</p>}
          </div>
        )}

        <p className="text-[10px] text-t3">The tag stays on the machine as its barcode, so the sticker still scans. Reprint the label afterwards.</p>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving || creating} onClick={() => void save()}>{saving ? 'Saving…' : 'Save identification'}</button>
        </div>
      </div>
    </Modal>
  )
}
