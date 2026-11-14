'use client'

import { useState } from 'react'
import { Modal, Field, Input } from '@/components/ui'
import { RefurbProductPicker } from '@/components/refurbishment/RefurbProductPicker'
import type { Product, SerialNumber } from '@/lib/store'

/**
 * Move one machine to the product it really is (model or specs). Its count
 * and cost go with it; its serial, asset ID and history stay. Found missing?
 * Create the right product from the picker.
 */
export function MoveSerialProductModal({ unit, products, onClose, onMoved, showToast }: {
  unit: SerialNumber
  products: Product[]
  onClose: () => void
  onMoved: () => void
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const [target, setTarget] = useState<Product | null>(null)
  const [specs, setSpecs] = useState(unit.specs || '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const machines = products.filter(p => p.isActive !== false && p.id !== unit.productId && (p.requiresSerial || p.trackingMethod === 'SERIAL'))

  const submit = async () => {
    if (!target) { showToast('Choose the product it belongs to', 'error'); return }
    if (reason.trim().length < 3) { showToast('Say why it is moving', 'error'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/serials/${encodeURIComponent(unit.id)}/move-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: target.id, reason: reason.trim(), specs: specs.trim() || undefined }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error || `Move failed (${res.status})`)
      showToast(`${unit.serial} moved to ${target.name}`, 'success')
      onMoved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Move failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Move to another product · ${unit.serial}`} onClose={() => !busy && onClose()} width={520}>
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-text-3 leading-relaxed">
          Filed under <strong>{unit.productName}</strong>. It moves with its stock count and cost; its serial, asset ID and history stay the same.
        </p>
        <RefurbProductPicker
          kind="machine"
          label="The right product *"
          placeholder="Search model and specs: HP 840 G6 i5 16GB 512GB…"
          items={machines}
          selected={target ?? undefined}
          onPick={setTarget}
        />
        <Field label="This machine’s specs">
          <Input value={specs} onChange={setSpecs} placeholder="e.g. i5-8365U, 16GB, 512GB SSD" />
        </Field>
        <Field label="Reason" required>
          <Input value={reason} onChange={setReason} placeholder="e.g. Received under the wrong specs" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary text-[11px]" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary text-[11px]" onClick={() => { void submit() }} disabled={busy || !target}>
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
