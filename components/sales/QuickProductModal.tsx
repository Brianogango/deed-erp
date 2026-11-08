'use client'

import { useState } from 'react'
import { Field, Input, Modal, Select } from '@/components/ui'
import { ALL_CATEGORIES, CATEGORY_CONFIG, useApp, type CategoryId, type Product } from '@/lib/store'

/**
 * Create a product without leaving the quote: the few details a quote needs.
 * Cost, SKU and stock levels are finished later in Inventory.
 */
export function QuickProductModal({ initialName, onCreated, onClose }: { initialName: string; onCreated: (p: Product) => void; onClose: () => void }) {
  const { addProduct, companySettings } = useApp()
  const vat = Number(companySettings?.vatRate) || 16
  const [name, setName] = useState(initialName.trim())
  const [category, setCategory] = useState<CategoryId>('Laptops')
  const [condition, setCondition] = useState<'refurbished' | 'new'>('refurbished')
  const [price, setPrice] = useState('')
  const [taxRate, setTaxRate] = useState(String(vat))
  const [serial, setSerial] = useState(CATEGORY_CONFIG.Laptops.serialRequired)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const pickCategory = (c: CategoryId) => { setCategory(c); setSerial(Boolean(CATEGORY_CONFIG[c]?.serialRequired)) }

  async function save() {
    setError('')
    if (name.trim().length < 3) return setError('Give the product a name (3 letters or more)')
    if (!(Number(price) >= 0) || price.trim() === '') return setError('Enter the selling price (0 or more)')
    setSaving(true)
    try {
      const trackStock = category !== 'Services' && CATEGORY_CONFIG[category]?.trackStock !== false
      const created = await Promise.resolve(addProduct({
        name: name.trim(), sku: '', barcode: '', category,
        salePrice: Number(price), costPrice: 0, taxRate: Number(taxRate) || 0,
        stockQty: 0, minStock: 0, unit: '', description: description.trim(),
        canBeSold: true, canBePurchased: true, image: '', isActive: true, warrantyMonths: 0,
        requiresSerial: serial,
        trackingMethod: serial ? 'SERIAL' : trackStock ? 'QUANTITY' : 'NONE',
        productKind: trackStock ? 'storable' : 'service',
        productType: condition,
      } as unknown as Omit<Product, 'id'>))
      if (created) { onCreated(created as Product); onClose() }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Create product" subtitle="Cost and stock can be finished later in Inventory" onClose={onClose} width={520}>
      <div className="space-y-3">
        {error && <div role="alert" className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div>}
        <Field label="Product name" required>
          <Input value={name} onChange={setName} placeholder="e.g. HP ProBook 450 G9 i5 8GB 256GB" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" required>
            <Select value={category} onChange={v => pickCategory(v as CategoryId)} options={ALL_CATEGORIES.map(c => ({ value: c, label: c }))} />
          </Field>
          <Field label="Condition">
            <Select value={condition} onChange={v => setCondition(v as 'refurbished' | 'new')} options={[{ value: 'refurbished', label: 'Refurbished' }, { value: 'new', label: 'New' }]} />
          </Field>
          <Field label="Selling price (KES)" required>
            <Input type="number" value={price} onChange={setPrice} placeholder="0" />
          </Field>
          <Field label="VAT">
            <Select value={taxRate} onChange={setTaxRate} options={[{ value: String(vat), label: `${vat}%` }, { value: '0', label: '0%' }]} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={serial} onChange={e => setSerial(e.target.checked)} />
          Each unit has its own serial number
        </label>
        <Field label="Description (optional)">
          <Input value={description} onChange={setDescription} placeholder="Specs or notes shown on the quote" />
        </Field>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Creating…' : 'Create and add to quote'}</button>
        </div>
      </div>
    </Modal>
  )
}
