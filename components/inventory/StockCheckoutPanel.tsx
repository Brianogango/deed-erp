'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Field, Input, Modal, Select, Textarea } from '@/components/ui'

type Product = { id: string; name: string; sku: string; serialized: boolean }
type Serial = { id: string; serial: string; productId: string; location: string }
type Checkout = { id: string; ref: string; status: string; productId: string; productName: string; sku: string; qty: number; serialIds: string[]; serialNumbers: string[]; sourceLocation: string; receiverName: string; purpose: string; relatedJob: string; deviceRef: string; deviceSerial: string; expectedReturnDate: string; notes: string; requestedBy: string; requestedByName: string; requestedAt: string; consumedQty: number; returnedQty: number; exceptionQty: number; rejectionReason?: string }
type Data = { products: Product[]; serials: Serial[]; bulk: Array<{ productId: string; location: string; qty: number }>; checkouts: Checkout[]; canApprove: boolean; currentUserId: string }
type Mode = 'request' | 'reject' | 'close'

const EMPTY: Data = { products: [], serials: [], bulk: [], checkouts: [], canApprove: false, currentUserId: '' }
const blank = () => ({ productId: '', qty: '1', serialIds: [] as string[], sourceLocation: 'warehouse', receiverName: '', purpose: 'Refurbishment', relatedJob: '', deviceRef: '', deviceSerial: '', expectedReturnDate: '', notes: '', outcome: 'consumed', reason: '' })
const locations = [{ value: 'warehouse', label: 'Warehouse' }, { value: 'shop', label: 'With Issues' }, { value: 'repair_unit', label: 'Refurbishment' }]
const purposes = ['Refurbishment', 'Repair', 'Testing', 'Internal installation', 'Other'].map(value => ({ value, label: value }))
const statusLabel: Record<string, string> = { pending: 'Pending approval', approved: 'Approved', issued: 'Checked out', partially_closed: 'Partially closed', completed: 'Closed', rejected: 'Rejected' }

export default function StockCheckoutPanel() {
  const [data, setData] = useState<Data>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode | null>(null)
  const [selected, setSelected] = useState<Checkout | null>(null)
  const [form, setForm] = useState(blank)
  const [productSearch, setProductSearch] = useState('')
  const [requestItems, setRequestItems] = useState<Record<string, { qty: string; serialIds: string[] }>>({})

  const load = async () => {
    setLoading(true); setError('')
    try { const res = await fetch('/api/inventory/stock-checkouts', { cache: 'no-store' }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || 'Could not load stock checkouts'); setData({ ...EMPTY, ...body }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load stock checkouts') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const product = data.products.find(p => p.id === form.productId)
  const eligible = useMemo(() => data.serials.filter(s => s.productId === form.productId && s.location === form.sourceLocation), [data.serials, form.productId, form.sourceLocation])
  const outstanding = (r: Checkout) => r.qty - r.consumedQty - r.returnedQty - r.exceptionQty
  const overdue = (r: Checkout) => Boolean(r.expectedReturnDate && !['completed', 'rejected'].includes(r.status) && r.expectedReturnDate < new Date().toISOString().slice(0, 10))
  const patch = (key: keyof ReturnType<typeof blank>, value: string | string[]) => setForm(v => ({ ...v, [key]: value }))
  const toggle = (id: string) => patch('serialIds', form.serialIds.includes(id) ? form.serialIds.filter(x => x !== id) : [...form.serialIds, id])
  const open = (next: Mode, row?: Checkout) => {
    setForm({ ...blank(), qty: row ? String(outstanding(row)) : '1' })
    setProductSearch('')
    setRequestItems({})
    setSelected(row || null)
    setError('')
    setMode(next)
  }
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase()
    if (!query) return data.products
    return data.products.filter(p => `${p.name} ${p.sku}`.toLowerCase().includes(query))
  }, [data.products, productSearch])
  const toggleRequestProduct = (productId: string) => setRequestItems(items => {
    if (items[productId]) {
      const next = { ...items }
      delete next[productId]
      return next
    }
    return { ...items, [productId]: { qty: '1', serialIds: [] } }
  })
  const patchRequestItem = (productId: string, value: Partial<{ qty: string; serialIds: string[] }>) =>
    setRequestItems(items => ({ ...items, [productId]: { ...(items[productId] ?? { qty: '1', serialIds: [] }), ...value } }))

  const send = async (action: string, extra: Record<string, unknown> = {}) => {
    setSaving(true); setError('')
    try { const res = await fetch('/api/inventory/stock-checkouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: selected?.id, ...extra }) }); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || 'Could not update checkout'); setMode(null); setSelected(null); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update checkout') }
    finally { setSaving(false) }
  }
  const submitRequest = async () => {
    const items = Object.entries(requestItems)
    if (!items.length) return setError('Select at least one product')
    for (const [productId, item] of items) {
      const selectedProduct = data.products.find(p => p.id === productId)
      if (selectedProduct?.serialized && !item.serialIds.length) return setError(`Select serial numbers for ${selectedProduct.name}`)
      if (!selectedProduct?.serialized && Number(item.qty) < 1) return setError(`Enter a valid quantity for ${selectedProduct?.name || 'each product'}`)
    }
    if (!form.receiverName.trim()) return setError('Enter the receiving person or holder')
    setSaving(true); setError('')
    try {
      for (const [productId, item] of items) {
        const res = await fetch('/api/inventory/stock-checkouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'request', ...form, productId, qty: item.qty, serialIds: item.serialIds }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Could not submit checkout request')
      }
      setMode(null); setRequestItems({}); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not submit checkout request') }
    finally { setSaving(false) }
  }
  const submitClose = () => send('close', { outcome: form.outcome, qty: form.qty, notes: form.notes, serialIds: form.serialIds })

  const active = data.checkouts.filter(r => ['pending', 'approved', 'issued', 'partially_closed'].includes(r.status)).length
  const checkedOut = data.checkouts.filter(r => ['issued', 'partially_closed'].includes(r.status)).reduce((n, r) => n + outstanding(r), 0)
  const overdueCount = data.checkouts.filter(overdue).length

  return <section className="space-y-4" aria-label="Stock checkout register">
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"><div><h2 className="text-base font-extrabold text-text-1 m-0">Stock checkout</h2><p className="text-xs text-text-3 mt-1 mb-0">Issue parts for internal or external work without creating a sale. Every deduction remains tied to a holder and purpose.</p></div><button className="btn-primary px-4 py-2 text-xs" onClick={() => open('request')}>Checkout stock</button></div>
    {error && !mode && <div role="alert" className="p-3 rounded-lg border border-red-200 text-xs text-red-700">{error}</div>}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[['Open requests', active], ['Units checked out', checkedOut], ['Overdue', overdueCount]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border-lt bg-surface p-4"><p className="text-[10px] uppercase font-bold text-text-3 m-0">{label}</p><p className="text-xl font-extrabold text-text-1 mt-1 mb-0 tabular-nums">{loading ? '—' : Number(value).toLocaleString()}</p></div>)}</div>
    <div className="rounded-xl border border-border-lt bg-surface overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-text-3 border-b border-border-lt"><th className="px-3 py-2.5">Reference</th><th className="px-3 py-2.5">Product</th><th className="px-3 py-2.5">Holder / purpose</th><th className="px-3 py-2.5">Qty</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Actions</th></tr></thead><tbody>
      {data.checkouts.map(r => <tr key={r.id} className="border-b border-border-lt align-top"><td className="px-3 py-3 font-mono font-semibold">{r.ref}<div className="font-sans font-normal text-text-3 mt-1">{r.requestedAt.slice(0, 10)}</div></td><td className="px-3 py-3 font-semibold">{r.productName}<div className="font-normal text-text-3">{r.sku || r.serialNumbers.join(', ') || '—'}</div></td><td className="px-3 py-3">{r.receiverName}<div className="text-text-3">{r.purpose}{r.relatedJob ? ` · ${r.relatedJob}` : ''}</div></td><td className="px-3 py-3 tabular-nums">{outstanding(r)} / {r.qty}<div className="text-text-3">out / total</div></td><td className="px-3 py-3"><span className="font-semibold">{statusLabel[r.status] || r.status}</span>{overdue(r) && <div className="text-red-600 mt-1">Overdue</div>}{r.rejectionReason && <div className="text-text-3 mt-1">{r.rejectionReason}</div>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-1.5">{r.status === 'pending' && data.canApprove && r.requestedBy !== data.currentUserId && <><button className="btn-primary px-2.5 py-1.5 text-[11px]" onClick={() => { setSelected(r); void send('approve', { id: r.id }) }}>Approve</button><button className="btn-secondary px-2.5 py-1.5 text-[11px]" onClick={() => open('reject', r)}>Reject</button></>}{r.status === 'approved' && <button className="btn-primary px-2.5 py-1.5 text-[11px]" onClick={() => { setSelected(r); void send('issue', { id: r.id }) }}>Confirm issue</button>}{['issued', 'partially_closed'].includes(r.status) && <button className="btn-secondary px-2.5 py-1.5 text-[11px]" onClick={() => open('close', r)}>Close stock</button>}</div></td></tr>)}
      {!loading && !data.checkouts.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-text-3">No stock checkouts recorded.</td></tr>}
    </tbody></table></div></div>

    {mode === 'request' && <Modal title="Checkout stock" subtitle="Submit for approval before physical issue" onClose={() => setMode(null)} width={760}><div className="space-y-4">
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Products" required hint={`${Object.keys(requestItems).length} selected`}>
          <div className="custody-product-picker">
            <Input value={productSearch} onChange={setProductSearch} placeholder="Search by product name or SKU…" />
            <div className="custody-product-picker__list">
              {filteredProducts.map(p => <label key={p.id}>
                <input type="checkbox" checked={Boolean(requestItems[p.id])} onChange={() => toggleRequestProduct(p.id)} />
                <span><strong>{p.name}</strong><small>{p.sku || 'No SKU'}{p.serialized ? ' · Serial tracked' : ''}</small></span>
              </label>)}
              {!filteredProducts.length && <p>No matching products.</p>}
            </div>
          </div>
        </Field>
        <Field label="Source" required><Select value={form.sourceLocation} onChange={v => { patch('sourceLocation', v); setRequestItems(items => Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { ...item, serialIds: [] }])) ) }} options={locations} /></Field>
      </div>
      {Object.entries(requestItems).map(([productId, item]) => {
        const rowProduct = data.products.find(p => p.id === productId)
        if (!rowProduct) return null
        const rowSerials = data.serials.filter(s => s.productId === productId && s.location === form.sourceLocation)
        return <div key={productId} className="custody-transfer-row">
          <div><strong>{rowProduct.name}</strong><small>{rowProduct.sku || 'No SKU'}</small></div>
          {rowProduct.serialized ? <div className="custody-transfer-serials">
            {rowSerials.map(serial => <label key={serial.id}><input type="checkbox" checked={item.serialIds.includes(serial.id)} onChange={() => patchRequestItem(productId, { serialIds: item.serialIds.includes(serial.id) ? item.serialIds.filter(id => id !== serial.id) : [...item.serialIds, serial.id] })} /><span>{serial.serial}</span></label>)}
            {!rowSerials.length && <small>No serials available at this source.</small>}
          </div> : <Input type="number" value={item.qty} onChange={qty => patchRequestItem(productId, { qty })} />}
          <button type="button" aria-label={`Remove ${rowProduct.name}`} onClick={() => toggleRequestProduct(productId)}>×</button>
        </div>
      })}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Receiving person / holder" required><Input value={form.receiverName} onChange={v => patch('receiverName', v)} /></Field><Field label="Purpose" required><Select value={form.purpose} onChange={v => patch('purpose', v)} options={purposes} /></Field><Field label="Related job"><Input value={form.relatedJob} onChange={v => patch('relatedJob', v)} /></Field><Field label="Expected return"><Input type="date" value={form.expectedReturnDate} onChange={v => patch('expectedReturnDate', v)} /></Field><Field label="Offline job / device reference"><Input value={form.deviceRef} onChange={v => patch('deviceRef', v)} /></Field><Field label="Device serial"><Input value={form.deviceSerial} onChange={v => patch('deviceSerial', v)} /></Field></div>
      <Field label="Notes"><Textarea value={form.notes} onChange={v => patch('notes', v)} rows={3} /></Field>
      <p className="text-[11px] text-text-3">Each selected product creates its own approval request. Stock is only deducted after issue confirmation.</p>
      <div className="flex justify-end gap-2"><button className="btn-secondary px-4" onClick={() => setMode(null)}>Cancel</button><button className="btn-primary px-5" disabled={saving} onClick={() => void submitRequest()}>{saving ? 'Submitting…' : `Submit ${Object.keys(requestItems).length || ''} request${Object.keys(requestItems).length === 1 ? '' : 's'}`}</button></div>
    </div></Modal>}
        {mode === 'reject' && selected && <Modal title={`Reject ${selected.ref}`} onClose={() => setMode(null)}><div className="space-y-4">{error && <p className="text-xs text-red-700">{error}</p>}<Field label="Reason" required><Textarea value={form.reason} onChange={v => patch('reason', v)} rows={3} /></Field><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setMode(null)}>Cancel</button><button className="btn-primary" disabled={saving || !form.reason.trim()} onClick={() => void send('reject', { reason: form.reason })}>Reject request</button></div></div></Modal>}
    {mode === 'close' && selected && <Modal title={`Close stock · ${selected.ref}`} subtitle={`${outstanding(selected)} unit(s) outstanding`} onClose={() => setMode(null)} width={640}><div className="space-y-4">{error && <p className="text-xs text-red-700">{error}</p>}<div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Outcome" required><Select value={form.outcome} onChange={v => patch('outcome', v)} options={[{ value: 'consumed', label: 'Consumed / installed' }, { value: 'returned', label: 'Returned to source' }, { value: 'exception', label: 'Missing / damaged / exception' }]} /></Field><Field label="Quantity" required><Input type="number" value={form.qty} onChange={v => patch('qty', v)} /></Field></div>{selected.serialIds.length > 0 && <Field label="Serials to close" required hint={`${form.serialIds.length} selected`}><div className="max-h-36 overflow-y-auto rounded-lg border border-border-lt divide-y divide-border-lt">{selected.serialIds.map((id, i) => <label key={id} className="flex items-center gap-3 px-3 py-2"><input type="checkbox" checked={form.serialIds.includes(id)} onChange={() => toggle(id)} />{selected.serialNumbers[i] || id}</label>)}</div></Field>}<Field label="Closure notes"><Textarea value={form.notes} onChange={v => patch('notes', v)} rows={3} /></Field><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setMode(null)}>Cancel</button><button className="btn-primary" disabled={saving} onClick={() => void submitClose()}>{saving ? 'Saving…' : 'Record outcome'}</button></div></div></Modal>}
  </section>
}
