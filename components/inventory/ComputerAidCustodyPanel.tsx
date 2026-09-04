'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Field, Input, Modal, Select, Textarea } from '@/components/ui'

type Action = 'direct_entry' | 'transfer_in' | 'collection' | 'issue'
type Product = { id: string; name: string; sku: string; requiresSerial: boolean }
type Serial = { id: string; serial: string; productId: string; productName: string; location: string }
type Movement = { id: string; ref: string; action: Action; date: string; productName: string; qty: number; destination?: string; collectorName?: string; exceptionType?: string; project?: string }
type Data = { summary: { inCustody: number; collected: number; exceptions: number }; products: Product[]; serials: Serial[]; custodySerials: Serial[]; custodyBulk: Array<{ productId: string; productName: string; sku: string; location: string; qty: number }>; movements: Movement[] }

const EMPTY: Data = { summary: { inCustody: 0, collected: 0, exceptions: 0 }, products: [], serials: [], custodySerials: [], custodyBulk: [], movements: [] }
const fresh = () => ({ productId: '', qty: '1', serialNumbers: '', serialIds: [] as string[], date: new Date().toISOString().slice(0, 10), project: '', source: '', deliveryRef: '', condition: 'Good', specifications: '', storageBin: '', receivedBy: '', computerAidContact: '', collectorName: '', collectorId: '', collectorPhone: '', vehicleDetails: '', destination: '', releasedBy: '', exceptionType: '', responsiblePerson: '', resolution: '', notes: '', supportingDocumentName: '' })
const TITLES: Record<Action, string> = { direct_entry: 'Add Computer Aid stock', transfer_in: 'Transfer from Warehouse', collection: 'Record Computer Aid collection', issue: 'Report Computer Aid stock issue' }
const LABELS: Record<Action, string> = { direct_entry: 'Add stock', transfer_in: 'Transfer stock', collection: 'Confirm collection', issue: 'Record issue' }
const movementLabel = (a: Action) => ({ direct_entry: 'Direct entry → custody', transfer_in: 'Warehouse → custody', collection: 'Custody → collected', issue: 'Custody → with issues' })[a]

export default function ComputerAidCustodyPanel() {
  const [data, setData] = useState<Data>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState<Action | null>(null)
  const [history, setHistory] = useState(false)
  const [form, setForm] = useState(fresh)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/inventory/computer-aid', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not load Computer Aid stock')
      setData({ ...EMPTY, ...body })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load Computer Aid stock') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const product = data.products.find(p => p.id === form.productId)
  const source = action === 'transfer_in' ? 'warehouse' : 'computer_aid'
  const eligible = useMemo(() => data.serials.filter(s => s.productId === form.productId && s.location === source), [data.serials, form.productId, source])
  const patch = (key: keyof ReturnType<typeof fresh>, value: string | string[]) => setForm(v => ({ ...v, [key]: value }))
  const open = (next: Action) => { setForm(fresh()); setError(''); setAction(next) }
  const toggle = (id: string) => setForm(v => ({ ...v, serialIds: v.serialIds.includes(id) ? v.serialIds.filter(x => x !== id) : [...v.serialIds, id] }))

  const submit = async () => {
    if (!action || !form.productId) return setError('Select a product')
    if (product?.requiresSerial && action === 'direct_entry' && !form.serialNumbers.trim()) return setError('Enter at least one serial number')
    if (product?.requiresSerial && action !== 'direct_entry' && !form.serialIds.length) return setError('Select at least one serial number')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/inventory/computer-aid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...form }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save movement')
      setAction(null); setForm(fresh()); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save movement') }
    finally { setSaving(false) }
  }

  return <section className="space-y-4" aria-label="Computer Aid custody stock">
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
      <div><h2 className="text-base font-extrabold text-text-1 m-0">Computer Aid stock</h2><p className="text-xs text-text-3 mt-1 mb-0">Items held by Deed on behalf of Computer Aid. Reserved and unavailable for sale.</p></div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-[11px] px-3 py-2" onClick={() => open('direct_entry')}>Add stock</button>
        <button className="btn-secondary text-[11px] px-3 py-2" onClick={() => open('transfer_in')}>Transfer from Warehouse</button>
        <button className="btn-primary text-[11px] px-3 py-2" onClick={() => open('collection')}>Record collection</button>
        <button className="btn-secondary text-[11px] px-3 py-2" onClick={() => open('issue')}>Report issue</button>
        <button className="btn-secondary text-[11px] px-3 py-2" onClick={() => setHistory(true)}>Movement history</button>
      </div>
    </div>
    {error && !action && <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700">{error}</div>}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {([['Currently in custody', data.summary.inCustody, 'Physical balance held at Deed'], ['Collected by Computer Aid', data.summary.collected, 'Released with a permanent record'], ['With issues', data.summary.exceptions, 'Computer Aid items under review']] as const).map(([label, value, hint]) => <div key={label} className="rounded-xl border border-border-lt bg-surface p-4"><p className="text-[10px] uppercase font-bold text-text-3 m-0">{label}</p><p className="text-xl font-extrabold text-text-1 my-1 tabular-nums">{loading ? '—' : value.toLocaleString()}</p><p className="text-[11px] text-text-3 m-0">{hint}</p></div>)}
    </div>
    <div className="rounded-xl border border-border-lt bg-surface overflow-hidden"><div className="px-4 py-3 border-b border-border-lt"><h3 className="text-sm font-bold text-text-1 m-0">Current custody balance</h3></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-text-3 border-b border-border-lt"><th className="px-4 py-2.5">Product</th><th className="px-4 py-2.5">SKU / Serial</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Qty</th></tr></thead><tbody>
      {data.custodySerials.filter(s => s.location === 'computer_aid').map(s => <tr key={s.id} className="border-b border-border-lt"><td className="px-4 py-3 font-semibold">{s.productName}</td><td className="px-4 py-3">{s.serial}</td><td className="px-4 py-3">In custody</td><td className="px-4 py-3 text-right">1</td></tr>)}
      {data.custodyBulk.filter(x => x.location === 'computer_aid').map(x => <tr key={x.productId} className="border-b border-border-lt"><td className="px-4 py-3 font-semibold">{x.productName}</td><td className="px-4 py-3">{x.sku || '—'}</td><td className="px-4 py-3">In custody</td><td className="px-4 py-3 text-right">{x.qty}</td></tr>)}
      {!loading && data.summary.inCustody === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-text-3">No Computer Aid stock is currently in custody.</td></tr>}
    </tbody></table></div></div>

    {action && <Modal title={TITLES[action]} subtitle="Computer Aid custody stock" onClose={() => setAction(null)} width={760}><div className="space-y-4">
      {error && <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Product" required><Select value={form.productId} onChange={v => patch('productId', v)} options={[{ value: '', label: 'Select product…' }, ...data.products.map(p => ({ value: p.id, label: `${p.name}${p.sku ? ` · ${p.sku}` : ''}` }))]} /></Field><Field label="Movement date" required><Input type="date" value={form.date} onChange={v => patch('date', v)} /></Field></div>
      {product?.requiresSerial ? action === 'direct_entry' ? <Field label="Serial numbers" required hint="One per line or separated by commas"><Textarea value={form.serialNumbers} onChange={v => patch('serialNumbers', v)} rows={4} /></Field> : <Field label={action === 'transfer_in' ? 'Warehouse serials' : 'Computer Aid serials'} required hint={`${form.serialIds.length} selected`}><div className="max-h-44 overflow-y-auto rounded-lg border border-border-lt divide-y divide-border-lt">{eligible.map(s => <label key={s.id} className="flex items-center gap-3 px-3 py-2"><input type="checkbox" checked={form.serialIds.includes(s.id)} onChange={() => toggle(s.id)} /><span className="font-semibold">{s.serial}</span></label>)}{form.productId && !eligible.length && <p className="p-3 text-xs text-text-3 m-0">No eligible serials at this location.</p>}</div></Field> : <Field label="Quantity" required><Input type="number" min="1" value={form.qty} onChange={v => patch('qty', v)} /></Field>}
      {(action === 'direct_entry' || action === 'transfer_in') && <><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Computer Aid project / programme"><Input value={form.project} onChange={v => patch('project', v)} /></Field><Field label="Supplier / source"><Input value={form.source} onChange={v => patch('source', v)} /></Field><Field label="Delivery note / reference"><Input value={form.deliveryRef} onChange={v => patch('deliveryRef', v)} /></Field><Field label="Condition"><Input value={form.condition} onChange={v => patch('condition', v)} /></Field><Field label="Storage location / bin"><Input value={form.storageBin} onChange={v => patch('storageBin', v)} /></Field><Field label="Received by"><Input value={form.receivedBy} onChange={v => patch('receivedBy', v)} /></Field><Field label="Computer Aid contact"><Input value={form.computerAidContact} onChange={v => patch('computerAidContact', v)} /></Field><Field label="Supporting document"><input type="file" className="form-input w-full" onChange={e => patch('supportingDocumentName', e.target.files?.[0]?.name || '')} /></Field></div><Field label="Specifications"><Textarea value={form.specifications} onChange={v => patch('specifications', v)} rows={2} /></Field></>}
      {action === 'collection' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Collector's name" required><Input value={form.collectorName} onChange={v => patch('collectorName', v)} /></Field><Field label="Collector ID"><Input value={form.collectorId} onChange={v => patch('collectorId', v)} /></Field><Field label="Collector phone"><Input value={form.collectorPhone} onChange={v => patch('collectorPhone', v)} /></Field><Field label="Vehicle / dispatch details"><Input value={form.vehicleDetails} onChange={v => patch('vehicleDetails', v)} /></Field><Field label="Destination / beneficiary project" required><Input value={form.destination} onChange={v => patch('destination', v)} /></Field><Field label="Released by" required><Input value={form.releasedBy} onChange={v => patch('releasedBy', v)} /></Field></div>}
      {action === 'issue' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Exception type" required><Select value={form.exceptionType} onChange={v => patch('exceptionType', v)} options={[{ value: '', label: 'Select exception…' }, { value: 'damaged', label: 'Damaged' }, { value: 'missing', label: 'Missing' }, { value: 'rejected', label: 'Rejected' }, { value: 'wrong_allocation', label: 'Wrong allocation' }, { value: 'other', label: 'Other' }]} /></Field><Field label="Responsible person"><Input value={form.responsiblePerson} onChange={v => patch('responsiblePerson', v)} /></Field><Field label="Resolution / next action"><Input value={form.resolution} onChange={v => patch('resolution', v)} /></Field></div>}
      <Field label="Notes"><Textarea value={form.notes} onChange={v => patch('notes', v)} rows={3} /></Field><p className="text-[11px] text-text-3">This creates a custody movement only—no sale, invoice, revenue or delivery.</p><div className="flex justify-end gap-2"><button className="btn-secondary px-5" onClick={() => setAction(null)}>Cancel</button><button className="btn-primary px-6" disabled={saving} onClick={() => void submit()}>{saving ? 'Saving…' : LABELS[action]}</button></div>
    </div></Modal>}
    {history && <Modal title="Computer Aid movement history" subtitle="Permanent custody trail" onClose={() => setHistory(false)} width={980}><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-border-lt text-left text-text-3"><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Reference</th><th className="px-3 py-2.5">Movement</th><th className="px-3 py-2.5">Product</th><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5">Destination / detail</th></tr></thead><tbody>{data.movements.map(m => <tr key={m.id} className="border-b border-border-lt"><td className="px-3 py-3">{m.date}</td><td className="px-3 py-3 font-mono font-semibold">{m.ref}</td><td className="px-3 py-3">{movementLabel(m.action)}</td><td className="px-3 py-3">{m.productName}</td><td className="px-3 py-3 text-right">{m.qty}</td><td className="px-3 py-3">{m.destination || m.collectorName || m.exceptionType || m.project || '—'}</td></tr>)}{!data.movements.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-text-3">No movements recorded.</td></tr>}</tbody></table></div></Modal>}
  </section>
}
