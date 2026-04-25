'use client'

import { useState } from 'react'
import { Modal, Field, Input, Select, Textarea } from '@/components/ui'

type ItemType = 'part' | 'software' | 'license'

interface RequestItem {
  type: ItemType
  name: string
  partNumber: string      // part: part/model number; software: version; license: license key (if known)
  description: string
  supplier: string        // part: supplier; software/license: vendor/publisher
  qty: string
  estimatedCost: string
  // software-specific
  platform: string
  // license-specific
  licenseType: string
}

const BLANK_ITEM = (): RequestItem => ({
  type: 'part', name: '', partNumber: '', description: '',
  supplier: '', qty: '1', estimatedCost: '0', platform: '', licenseType: 'perpetual',
})

const TYPE_META: Record<ItemType, { label: string; icon: string; color: string; bg: string }> = {
  part:     { label: 'Part / Component', icon: '🔩', color: '#F97316', bg: 'rgba(249,115,22,0.08)' },
  software: { label: 'Software',         icon: '💿', color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)' },
  license:  { label: 'License / Key',    icon: '🔑', color: '#0EA5E9', bg: 'rgba(14,165,233,0.08)' },
}

interface Props {
  repairRef: string
  onSubmit: (items: any[], urgency: string, notes: string) => void
  onClose: () => void
}

export default function ProcurementRequest({ repairRef, onSubmit, onClose }: Props) {
  const [items, setItems] = useState<RequestItem[]>([BLANK_ITEM()])
  const [urgency, setUrgency] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [notes, setNotes] = useState('')

  const addItem = () => setItems(p => [...p, BLANK_ITEM()])
  const removeItem = (i: number) => setItems(p => p.filter((_, idx) => idx !== i))
  const updateItem = (i: number, patch: Partial<RequestItem>) =>
    setItems(p => p.map((item, idx) => idx === i ? { ...item, ...patch } : item))

  const handleSubmit = () => {
    if (!items.some(it => it.name.trim() && it.qty)) {
      alert('Add at least one item with a name and quantity.')
      return
    }
    onSubmit(items.map(it => ({
      ...it,
      productName: it.name,
      qty: parseInt(it.qty) || 1,
      estimatedCost: parseFloat(it.estimatedCost) || 0,
    })), urgency, notes)
  }

  const urgencyMeta = {
    low:    { color: '#6B7280', label: 'Not urgent' },
    normal: { color: '#2E90FA', label: 'Standard' },
    high:   { color: '#F59E0B', label: 'Priority' },
    urgent: { color: '#EF4444', label: 'Critical' },
  }

  return (
    <Modal title="Request Parts, Software & Licenses" onClose={onClose} width={920}>
      {/* Banner */}
      <div className="rounded-lg p-4 mb-6 flex items-start gap-3"
        style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
        <span className="text-2xl">📋</span>
        <div>
          <p className="font-semibold text-sm" style={{ color: '#1B2762' }}>Procurement Request — {repairRef}</p>
          <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
            This repair will be set to <strong>Awaiting Parts</strong>. Lead tech and procurement team will be notified. You'll be notified when items arrive.
          </p>
        </div>
      </div>

      {/* Item type selector row */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold" style={{ color: '#fff' }}>Requested Items</p>
        <button onClick={addItem} className="text-sm" style={{ color: '#875BF7' }}>+ Add Item</button>
      </div>

      <div className="space-y-4 mb-6">
        {items.map((item, i) => {
          const meta = TYPE_META[item.type]
          return (
            <div key={i} className="rounded-xl p-4" style={{ background: '#0c0e14', border: '1px solid rgba(255,255,255,0.08)' }}>
              {/* Item header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-base">{meta.icon}</span>
                  <span className="text-sm font-semibold text-white">Item {i + 1}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33` }}>
                    {meta.label}
                  </span>
                </div>
                {items.length > 1 && (
                  <button onClick={() => removeItem(i)} className="text-xs" style={{ color: '#F87171' }}>Remove</button>
                )}
              </div>

              {/* Type toggle */}
              <div className="flex flex-wrap gap-2 mb-4">
                {(Object.keys(TYPE_META) as ItemType[]).map(t => (
                  <button key={t} onClick={() => updateItem(i, { type: t })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      background: item.type === t ? TYPE_META[t].bg : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${item.type === t ? TYPE_META[t].color : 'rgba(255,255,255,0.1)'}`,
                      color: item.type === t ? TYPE_META[t].color : '#9CA3AF',
                    }}>
                    {TYPE_META[t].icon} {TYPE_META[t].label}
                  </button>
                ))}
              </div>

              {/* Fields — vary by type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {item.type === 'part' && <>
                  <Field label="Part Name" required>
                    <Input value={item.name} onChange={v => updateItem(i, { name: v })} placeholder="e.g. LCD Screen, Battery, Keyboard" />
                  </Field>
                  <Field label="Part / Model Number">
                    <Input value={item.partNumber} onChange={v => updateItem(i, { partNumber: v })} placeholder="e.g. A1502-LCD-2015" />
                  </Field>
                  <Field label="Description / Spec">
                    <Input value={item.description} onChange={v => updateItem(i, { description: v })} placeholder="Specifications or compatibility notes" />
                  </Field>
                  <Field label="Preferred Supplier">
                    <Input value={item.supplier} onChange={v => updateItem(i, { supplier: v })} placeholder="e.g. Apple, Samsung, Local Vendor" />
                  </Field>
                  <Field label="Qty" required>
                    <Input type="number" value={item.qty} onChange={v => updateItem(i, { qty: v })} />
                  </Field>
                  <Field label="Est. Unit Cost (KES)">
                    <Input type="number" value={item.estimatedCost} onChange={v => updateItem(i, { estimatedCost: v })} placeholder="0" />
                  </Field>
                </>}

                {item.type === 'software' && <>
                  <Field label="Software Name" required>
                    <Input value={item.name} onChange={v => updateItem(i, { name: v })} placeholder="e.g. Microsoft Office, Adobe Photoshop" />
                  </Field>
                  <Field label="Version">
                    <Input value={item.partNumber} onChange={v => updateItem(i, { partNumber: v })} placeholder="e.g. 2024, v10.5" />
                  </Field>
                  <Field label="Publisher / Vendor">
                    <Input value={item.supplier} onChange={v => updateItem(i, { supplier: v })} placeholder="e.g. Microsoft, Adobe, Autodesk" />
                  </Field>
                  <Field label="Platform">
                    <Select value={item.platform} onChange={v => updateItem(i, { platform: v })}
                      options={[
                        { value: '', label: 'Select platform' },
                        { value: 'windows', label: 'Windows' },
                        { value: 'macos', label: 'macOS' },
                        { value: 'linux', label: 'Linux' },
                        { value: 'cross_platform', label: 'Cross-platform' },
                        { value: 'web', label: 'Web / SaaS' },
                      ]} />
                  </Field>
                  <Field label="No. of Installs" required>
                    <Input type="number" value={item.qty} onChange={v => updateItem(i, { qty: v })} />
                  </Field>
                  <Field label="Est. Cost (KES)">
                    <Input type="number" value={item.estimatedCost} onChange={v => updateItem(i, { estimatedCost: v })} placeholder="0" />
                  </Field>
                  <div className="col-span-1 sm:col-span-2"><Field label="Notes / Download Source">
                    <Input value={item.description} onChange={v => updateItem(i, { description: v })} placeholder="e.g. ISO needed, download from vendor portal" />
                  </Field></div>
                </>}

                {item.type === 'license' && <>
                  <Field label="Software / Product Name" required>
                    <Input value={item.name} onChange={v => updateItem(i, { name: v })} placeholder="e.g. Windows 11 Pro, AutoCAD 2024" />
                  </Field>
                  <Field label="License Type">
                    <Select value={item.licenseType} onChange={v => updateItem(i, { licenseType: v })}
                      options={[
                        { value: 'perpetual', label: 'Perpetual' },
                        { value: 'subscription', label: 'Subscription (monthly/annual)' },
                        { value: 'volume', label: 'Volume License' },
                        { value: 'oem', label: 'OEM' },
                        { value: 'education', label: 'Education / NFR' },
                      ]} />
                  </Field>
                  <Field label="Vendor / Reseller">
                    <Input value={item.supplier} onChange={v => updateItem(i, { supplier: v })} placeholder="e.g. Microsoft, Jumia, Local Reseller" />
                  </Field>
                  <Field label="Known Key / Reference">
                    <Input value={item.partNumber} onChange={v => updateItem(i, { partNumber: v })} placeholder="Existing key or order ref (if any)" />
                  </Field>
                  <Field label="No. of Licenses" required>
                    <Input type="number" value={item.qty} onChange={v => updateItem(i, { qty: v })} />
                  </Field>
                  <Field label="Est. Cost (KES)">
                    <Input type="number" value={item.estimatedCost} onChange={v => updateItem(i, { estimatedCost: v })} placeholder="0" />
                  </Field>
                  <div className="col-span-1 sm:col-span-2"><Field label="Notes">
                    <Input value={item.description} onChange={v => updateItem(i, { description: v })} placeholder="Activation method, device binding, expiry, etc." />
                  </Field></div>
                </>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Urgency */}
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#9CA3AF' }}>Urgency</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.keys(urgencyMeta) as Array<keyof typeof urgencyMeta>).map(level => (
            <button key={level} onClick={() => setUrgency(level)}
              className="p-3 rounded-lg transition-all text-left"
              style={{
                border: urgency === level ? `2px solid ${urgencyMeta[level].color}` : '2px solid rgba(255,255,255,0.08)',
                background: urgency === level ? `${urgencyMeta[level].color}14` : '#0c0e14',
              }}>
              <p className="font-semibold text-sm capitalize" style={{ color: urgency === level ? urgencyMeta[level].color : '#9CA3AF' }}>
                {level}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>{urgencyMeta[level].label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#9CA3AF' }}>Notes to Procurement (optional)</p>
        <Textarea value={notes} onChange={setNotes} rows={3}
          placeholder="Special instructions, compatibility requirements, or deadline..." />
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        <button onClick={handleSubmit} className="btn btn-primary">Submit Request</button>
      </div>
    </Modal>
  )
}
