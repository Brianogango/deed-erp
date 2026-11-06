'use client'

import { useMemo, useState } from 'react'
import { Field, Input, Modal, Select } from '@/components/ui'
import { LOCATIONS, useApp, type LocationId } from '@/lib/store'
import { PLACEHOLDER_KINDS, type PlaceholderKind } from '@/lib/refurbishment/unidentified'
import { printLabelsForSerialUnits } from '@/lib/inventory/print-serial-device-label'

type Unit = { cost: string; note: string }

const isSerialized = (p: { requiresSerial?: boolean; trackingMethod?: string }) => Boolean(p.requiresSerial || p.trackingMethod === 'SERIAL')

/**
 * Machines with no readable serial or specs into Refurbishment. Each gets an
 * intake tag (UNK-…) and a sticker; the technician finds the real serial
 * later. Trade-ins are tagged on the trade-in form instead.
 */
export function TaggedIntakeModal({ onClose }: { onClose: () => void }) {
  const { products, bulkStock, serials, intakeTaggedMachines, refreshProductCatalog, showToast } = useApp()
  const [where, setWhere] = useState<'stock' | 'unrecorded'>('stock')
  const [sourceProductId, setSourceProductId] = useState('')
  const [sourceLocation, setSourceLocation] = useState<LocationId | ''>('')
  const [fileAs, setFileAs] = useState<PlaceholderKind | 'known'>('laptop')
  const [knownProductId, setKnownProductId] = useState('')
  const [issue, setIssue] = useState('')
  const [units, setUnits] = useState<Unit[]>([{ cost: '', note: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tags, setTags] = useState<string[] | null>(null)

  // Quantity stock (no serials) of devices that could be machines.
  const stockRows = useMemo(() => bulkStock
    .filter(b => Number(b.qty) > 0)
    .map(b => ({ ...b, product: products.find(p => p.id === b.productId) }))
    .filter(b => b.product && !isSerialized(b.product)), [bulkStock, products])
  const sourceProducts = useMemo(() => {
    const ids = [...new Set(stockRows.map(r => r.productId))]
    return ids.map(id => products.find(p => p.id === id)!).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
  }, [stockRows, products])
  const sourceLocations = stockRows.filter(r => r.productId === sourceProductId)
  const available = sourceLocations.filter(r => r.location === sourceLocation).reduce((s, r) => s + Number(r.qty), 0)
  const serialProducts = useMemo(() => products.filter(p => isSerialized(p) && p.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)), [products])

  const setCount = (raw: string) => {
    const n = Math.max(1, Math.min(50, Math.floor(Number(raw) || 1)))
    setUnits(prev => Array.from({ length: n }, (_, i) => prev[i] ?? { cost: '', note: '' }))
  }
  const patchUnit = (i: number, patch: Partial<Unit>) => setUnits(prev => prev.map((u, j) => (j === i ? { ...u, ...patch } : u)))
  const givenTotal = units.reduce((s, u) => s + (u.cost.trim() ? Math.max(0, Number(u.cost) || 0) : 0), 0)

  async function submit() {
    setError('')
    if (where === 'stock') {
      if (!sourceProductId || !sourceLocation) return setError('Choose the stock they are counted under, and where')
      if (units.length > available) return setError(`Only ${available} at ${LOCATIONS[sourceLocation as LocationId]?.name ?? sourceLocation}`)
    }
    if (fileAs === 'known' && !knownProductId) return setError('Choose the model, or file them as unidentified')
    if (units.some(u => u.cost.trim() && !(Number(u.cost) >= 0))) return setError('Costs must be 0 or more')
    setSaving(true)
    try {
      let productId = knownProductId
      if (fileAs !== 'known') {
        const res = await fetch('/api/refurbishment/placeholders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: fileAs }) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.product?.id) { setError(data.error || 'Could not set up the unidentified product'); return }
        productId = data.product.id
        if (data.created) await refreshProductCatalog().catch(() => 0)
      }
      const made = await intakeTaggedMachines({
        productId,
        units: units.map(u => ({ cost: u.cost.trim() ? Number(u.cost) : null, note: u.note.trim() || undefined, issue: issue.trim() || 'Not identified — dead or too damaged to read' })),
        from: where === 'stock' ? { productId: sourceProductId, location: sourceLocation as LocationId } : undefined,
        reference: `REFURB-IN ${new Date().toISOString().slice(0, 10)}`,
      })
      if (made) setTags(made)
    } finally {
      setSaving(false)
    }
  }

  async function printStickers() {
    if (!tags) return
    const wanted = new Set(tags)
    const rows = serials.filter(s => wanted.has(s.serial))
    if (!rows.length) { showToast('The stickers are not ready yet — try again in a moment', 'info'); return }
    await printLabelsForSerialUnits({ serials: rows, products }).catch(() => showToast('Could not open the label print. Allow pop-ups for this site.', 'error'))
  }

  if (tags) {
    return (
      <Modal title="Machines tagged" onClose={onClose} width={480}>
        <div className="space-y-3">
          <p className="text-xs text-t2">{tags.length} machine{tags.length === 1 ? '' : 's'} queued for refurbishment. Stick each tag on its machine; the technician records the real serial once it boots.</p>
          <div className="flex flex-wrap gap-1.5">{tags.map(t => <span key={t} className="font-mono text-[11px] rounded-md px-2 py-0.5" style={{ background: 'var(--bg-muted)' }}>{t}</span>)}</div>
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={onClose}>Done</button>
            <button className="btn-primary" onClick={() => void printStickers()}>Print stickers</button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add machines without a serial" subtitle="Dead or unreadable machines — each gets a tag until the serial is found" onClose={onClose} width={720}>
      <div className="space-y-4">
        {error && <div role="alert" className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Where are they now?" required>
            <Select value={where} onChange={v => setWhere(v as 'stock' | 'unrecorded')} options={[
              { value: 'stock', label: 'Counted in stock, without serials' },
              { value: 'unrecorded', label: 'Not on record yet' },
            ]} />
          </Field>
          <Field label="File them under" required hint="Unidentified ones move to the right model once the serial is found">
            <Select value={fileAs} onChange={v => setFileAs(v as PlaceholderKind | 'known')} options={[
              ...PLACEHOLDER_KINDS.map(k => ({ value: k.id, label: `${k.label} — unidentified` })),
              { value: 'known', label: 'A model I know…' },
            ]} />
          </Field>
        </div>
        {fileAs === 'known' && (
          <Field label="Model" required>
            <Select value={knownProductId} onChange={setKnownProductId} options={[{ value: '', label: 'Choose a serial-tracked product…' }, ...serialProducts.map(p => ({ value: p.id, label: `${p.name}${p.sku ? ` · ${p.sku}` : ''}` }))]} />
          </Field>
        )}
        {where === 'stock' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Counted under" required hint="Their stock and cost come off this product">
              <Select value={sourceProductId} onChange={v => { setSourceProductId(v); setSourceLocation('') }} options={[{ value: '', label: sourceProducts.length ? 'Choose the stock…' : 'No quantity stock found' }, ...sourceProducts.map(p => ({ value: p.id, label: p.name }))]} />
            </Field>
            <Field label="Location" required hint={sourceLocation ? `${available} there` : undefined}>
              <Select value={sourceLocation} onChange={v => setSourceLocation(v as LocationId)} options={[{ value: '', label: 'Choose…' }, ...sourceLocations.map(r => ({ value: r.location, label: `${LOCATIONS[r.location as LocationId]?.name ?? r.location} (${r.qty})` }))]} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
          <Field label="How many" required>
            <Input type="number" value={String(units.length)} onChange={setCount} />
          </Field>
          <Field label="What's wrong (all of them)">
            <Input value={issue} onChange={setIssue} placeholder="e.g. No power, cracked screen" />
          </Field>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-t2 mb-1">Each machine</p>
          <p className="text-[10px] text-t3 mb-2">
            {where === 'stock'
              ? 'Leave cost blank to share the stock\'s cost equally; enter one where a machine is worth more or less (e.g. complete vs shell).'
              : 'Cost is optional — enter what a machine is worth if you paid for it; blank means no value.'}
          </p>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border-lt divide-y divide-border-lt">
            {units.map((u, i) => (
              <div key={i} className="grid grid-cols-[32px_120px_1fr] items-center gap-2 px-2 py-1.5">
                <span className="text-[10px] text-t4 tabular-nums">{i + 1}</span>
                <Input type="number" value={u.cost} onChange={v => patchUnit(i, { cost: v })} placeholder={where === 'stock' ? 'Share' : 'KES'} />
                <Input value={u.note} onChange={v => patchUnit(i, { note: v })} placeholder="Brand, colour, what's missing…" />
              </div>
            ))}
          </div>
          {givenTotal > 0 && <p className="text-[10px] text-t3 mt-1">Costs entered: KES {givenTotal.toLocaleString('en-KE')}</p>}
        </div>
        <p className="text-[10px] text-t3">Trade-ins: use “Serial unknown — tag it” on the trade-in form; they come here when the trade-in is stocked.</p>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Saving…' : `Tag ${units.length} machine${units.length === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </Modal>
  )
}
