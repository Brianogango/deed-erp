'use client'

import { useMemo, useState } from 'react'
import { Field, Input, Modal, Textarea } from '@/components/ui'
import { useApp, type Product, type RefurbishmentJob } from '@/lib/store'
import { RefurbProductPicker } from '@/components/refurbishment/RefurbProductPicker'

type Row = { productId: string; qty: string; unitValue: string }
const isSerialized = (p: { requiresSerial?: boolean; trackingMethod?: string }) => Boolean(p.requiresSerial || p.trackingMethod === 'SERIAL')
const blank = (): Row => ({ productId: '', qty: '1', unitValue: '' })

/**
 * Not repairable: strip it. The parts kept go into stock and carry part of
 * the machine's cost; the rest of the cost is written off.
 */
export function HarvestPartsModal({ job, onClose, onDone }: { job: RefurbishmentJob; onClose: () => void; onDone: () => void }) {
  const { products, harvestRefurbishmentJob } = useApp()
  const [reason, setReason] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Parts just created from the search: on screen before the list has them.
  const [created, setCreated] = useState<Product[]>([])
  const productOf = (id: string) => products.find(p => p.id === id) ?? created.find(p => p.id === id)
  const partProducts = useMemo(() => products.filter(p => !isSerialized(p) && p.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)), [products])
  const patch = (i: number, v: Partial<Row>) => setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...v } : r)))
  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitValue) || 0), 0)
  const cost = job.intakeCost

  async function save() {
    setError('')
    if (!reason.trim()) return setError('Say why it cannot be repaired')
    const parts = rows.filter(r => r.productId)
    if (!parts.length) return setError('Add at least one part you kept — or write the machine off instead')
    if (parts.some(r => !(Number.isInteger(Number(r.qty)) && Number(r.qty) >= 1))) return setError('Quantities must be whole numbers')
    setSaving(true)
    const ok = await harvestRefurbishmentJob(job.id, reason.trim(), parts.map(r => ({ productId: r.productId, qty: Number(r.qty), unitValue: Math.max(0, Number(r.unitValue) || 0) })))
    setSaving(false)
    if (ok) onDone()
  }

  return (
    <Modal title={`Harvest parts · ${job.serialNumber}`} subtitle="The machine is written off; the parts you keep go to warehouse stock" onClose={onClose} width={640}>
      <div className="space-y-3">
        {error && <div role="alert" className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div>}
        <Field label="Why it cannot be repaired" required>
          <Textarea value={reason} onChange={setReason} rows={2} placeholder="e.g. Motherboard dead, no replacement available" />
        </Field>
        <div>
          <p className="text-[11px] font-semibold text-t2 mb-1">Parts kept</p>
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_120px_28px] gap-2 items-center">
                <RefurbProductPicker
                  kind="part"
                  countedOnly
                  label={`Part ${i + 1}`}
                  labelClassName="sr-only"
                  placeholder="Search the part: RAM 8GB, battery…"
                  items={partProducts}
                  selected={r.productId ? productOf(r.productId) : undefined}
                  onPick={p => {
                    if (!products.some(x => x.id === p.id)) setCreated(prev => [...prev, p])
                    patch(i, { productId: p.id })
                  }}
                />
                <Input type="number" value={r.qty} onChange={v => patch(i, { qty: v })} placeholder="Qty" />
                <Input type="number" value={r.unitValue} onChange={v => patch(i, { unitValue: v })} placeholder="Value each" />
                <button type="button" className="text-t3 hover:text-red-600" aria-label="Remove part" onClick={() => setRows(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : [blank()])}>×</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn-outline text-[11px] mt-2" onClick={() => setRows(prev => [...prev, blank()])}>+ Add part</button>
        </div>
        <p className="text-[10px] text-t3">
          Parts value: KES {total.toLocaleString('en-KE')}{cost ? ` of the machine's KES ${cost.toLocaleString('en-KE')}` : ''}. Together the parts can carry at most what the machine cost; above that their values are scaled down. The rest is booked as a write-off. Serial-tracked parts (e.g. a whole screen with a serial) are added from Inventory instead. Not in the list? Create it from the search.
        </p>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Harvest and write off'}</button>
        </div>
      </div>
    </Modal>
  )
}
