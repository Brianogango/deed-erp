'use client'

import { useEffect, useMemo, useState } from 'react'
import { Field, Input, Modal, SearchPicker, Textarea } from '@/components/ui'
import { fmtKes } from '@/lib/store'
import { CONSIGNMENT_ACCESSORIES, hasCharger, missingAssetId, normalizeAccessories, summariseConsignments, type ConsignmentStatus } from '@/lib/inventory/consignment'

/**
 * Vendor devices on the floor that Deed has not bought.
 *
 * A vendor leaves laptops to show clients; Deed buys one only when a client
 * agrees, and the vendor collects the rest. These are the vendor's machines, so
 * this panel never touches stock: booking one in, buying it and handing it back
 * are custody records. Buying raises a draft purchase order, and the device
 * becomes stock only when that order is received — the same as any purchase.
 */

type Device = {
  id: string
  vendorId: string
  vendorName: string | null
  assetId: string | null
  serialNumber: string
  productId: string | null
  productName: string | null
  conditionGrade: string | null
  receivedAt: string
  status: ConsignmentStatus
  purchasedAt: string | null
  purchaseOrderId: string | null
  purchaseOrderRef?: string | null
  purchasePrice: number | null
  returnedAt: string | null
  notes: string | null
  accessories?: string[]
}
type Party = { id: string; name: string; isVendor?: boolean }
type Product = { id: string; name: string; sku: string }
type Data = { devices: Device[]; vendors: Party[]; products: Product[] }
type Filter = 'at_shop' | 'purchased' | 'returned' | 'all'

const today = () => new Date().toISOString().slice(0, 10)
const daysSince = (date: string) => {
  const ms = Date.now() - Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null
}
const STATUS: Record<ConsignmentStatus, { label: string; className: string }> = {
  at_shop: { label: 'At shop', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  purchased: { label: 'Purchased', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  returned: { label: 'Collected by vendor', className: 'bg-slate-100 text-slate-600 border-slate-200' },
}

async function call(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.error || 'The server did not accept that.')
  return payload
}

export default function VendorStockPanel() {
  const [data, setData] = useState<Data>({ devices: [], vendors: [], products: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<Filter>('at_shop')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<null | { kind: 'receive' } | { kind: 'purchase'; device: Device } | { kind: 'return'; device: Device }>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ vendorId: '', vendorLabel: '', serialNumber: '', assetId: '', productId: '', productLabel: '', productName: '', conditionGrade: '', date: today(), price: '', notes: '', accessories: [] as string[], otherAccessory: '' })
  const toggleAccessory = (name: string) => setForm(f => ({
    ...f,
    accessories: f.accessories.includes(name) ? f.accessories.filter(a => a !== name) : [...f.accessories, name],
  }))
  const patch = (next: Partial<typeof form>) => setForm(f => ({ ...f, ...next }))

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/inventory/consignments', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not load vendor stock')
      setData({ devices: body.devices ?? [], vendors: body.vendors ?? [], products: body.products ?? [] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load vendor stock')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const summary = useMemo(() => summariseConsignments(data.devices as never), [data.devices])
  const atShop = data.devices.filter(d => d.status === 'at_shop')
  const untagged = atShop.filter(d => missingAssetId(d as never)).length

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.devices
      .filter(d => filter === 'all' || d.status === filter)
      .filter(d => !q || [d.serialNumber, d.assetId, d.productName, d.vendorName, d.purchaseOrderRef].some(v => String(v ?? '').toLowerCase().includes(q)))
  }, [data.devices, filter, search])

  const open = (next: NonNullable<typeof dialog>) => {
    setFormError('')
    setForm({
      vendorId: '', vendorLabel: '', serialNumber: '', assetId: '', productName: '', conditionGrade: '', date: today(), price: '', notes: '', otherAccessory: '',
      // Collecting starts with everything that came in ticked; untick what is
      // not going back and it is written into the record.
      accessories: next.kind === 'return' ? [...(next.device.accessories ?? [])] : [],
      productId: next.kind === 'purchase' ? next.device.productId ?? '' : '',
      // Only a device already linked to a catalogue product starts with one
      // chosen. Showing the free-text model name here looked like a selection
      // and the order was then refused for having no product.
      productLabel: next.kind === 'purchase' && next.device.productId ? next.device.productName ?? '' : '',
    })
    setDialog(next)
  }

  const submit = async () => {
    if (!dialog || saving) return
    setSaving(true); setFormError('')
    try {
      if (dialog.kind === 'receive') {
        await call('/api/inventory/consignments', {
          vendorId: form.vendorId, serialNumber: form.serialNumber, assetId: form.assetId,
          productId: form.productId || undefined, productName: form.productName || undefined,
          conditionGrade: form.conditionGrade, receivedAt: form.date, notes: form.notes,
          accessories: normalizeAccessories([...form.accessories, ...form.otherAccessory.split(',')]),
        })
        setNotice(`${form.serialNumber.toUpperCase()} booked in.`)
      } else if (dialog.kind === 'purchase') {
        const result = await call(`/api/inventory/consignments/${dialog.device.id}`, {
          action: 'purchase', productId: form.productId, price: Number(form.price), date: form.date,
        })
        setNotice(`${dialog.device.serialNumber} purchased — ${result.purchaseOrder?.ref ?? 'a purchase order'} raised as a draft. Confirm it in Purchases, then receive this serial on the GRN to put it into stock.`)
      } else {
        await call(`/api/inventory/consignments/${dialog.device.id}`, { action: 'return', date: form.date, notes: form.notes, accessoriesReturned: form.accessories })
        setNotice(`${dialog.device.serialNumber} checked out — collected by the vendor.`)
      }
      setDialog(null)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[13px] font-black text-[var(--text-1)]">Vendor stock — not yet bought</h3>
          <p className="m-0 mt-0.5 max-w-2xl text-[11px] leading-relaxed text-[var(--text-3)]">
            Machines vendors have left for showing clients. They are the vendor&apos;s, so they are not counted in stock or the accounts.
            Buy one when a client agrees; book it out when the vendor collects.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => open({ kind: 'receive' })}>Book in a device</button>
      </div>

      {notice && (
        <p className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">{notice}</p>
      )}
      {error && (
        <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
          {error}{/relation|does not exist|consignment_devices/i.test(error) ? ' — the vendor-stock table has not been created on this server yet.' : ''}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-2">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--text-4)]">At the shop</span>
          <strong className="text-[13px] font-black tabular-nums">{atShop.length}</strong>
        </div>
        <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-2">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--text-4)]">Vendors</span>
          <strong className="text-[13px] font-black tabular-nums">{summary.length}</strong>
        </div>
        <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-2">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--text-4)]">No asset tag</span>
          <strong className="text-[13px] font-black tabular-nums" style={untagged ? { color: '#D97706' } : undefined}>{untagged}</strong>
        </div>
        <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-2">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--text-4)]">Bought so far</span>
          <strong className="text-[13px] font-black tabular-nums">{data.devices.filter(d => d.status === 'purchased').length}</strong>
        </div>
      </div>

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {summary.map(s => (
            <span key={s.vendorId} className="rounded-full border border-[var(--border-lt)] bg-[var(--bg-surface)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-2)]">
              {s.vendorName ?? 'Vendor'}: {s.atShop} here{s.untagged ? ` · ${s.untagged} untagged` : ''}{s.oldestReceivedAt ? ` · since ${s.oldestReceivedAt}` : ''}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Vendor stock status">
          {([['at_shop', 'At shop'], ['purchased', 'Purchased'], ['returned', 'Collected'], ['all', 'All']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${filter === id ? 'border-[var(--primary)] bg-[var(--primary-light)] text-[var(--navy)]' : 'border-[var(--border-lt)] text-[var(--text-3)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-w-[200px] flex-1">
          <Input value={search} onChange={setSearch} placeholder="Search serial, asset tag, model, vendor or PO…" />
        </div>
      </div>

      {loading ? (
        <p className="m-0 py-6 text-center text-[11px] text-[var(--text-3)]">Loading vendor stock…</p>
      ) : visible.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-[var(--border)] py-6 text-center text-[11px] text-[var(--text-3)]">
          {filter === 'at_shop' ? 'No vendor devices at the shop right now.' : 'Nothing matches.'}
        </p>
      ) : (
        <div className="divide-y divide-[var(--border-lt)] overflow-hidden rounded-lg border border-[var(--border-lt)]">
          {visible.map(d => {
            const held = d.status === 'at_shop' ? daysSince(d.receivedAt) : null
            return (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-card)] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[12px] font-bold text-[var(--text-1)]">
                    <span className="font-mono">{d.serialNumber}</span>
                    {d.productName ? <span className="ml-2 font-semibold text-[var(--text-2)]">{d.productName}</span> : null}
                  </p>
                  <p className="m-0 mt-0.5 text-[11px] text-[var(--text-3)]">
                    {d.vendorName ?? 'Vendor'} · {d.assetId ? <>asset <span className="font-mono">{d.assetId}</span></> : <span className="font-semibold" style={{ color: '#D97706' }}>no asset tag</span>}
                    {' · '}{(d.accessories ?? []).length
                      ? <>with {(d.accessories ?? []).join(', ').toLowerCase()}{hasCharger(d as never) ? '' : <span className="font-semibold" style={{ color: '#D97706' }}> (no charger)</span>}</>
                      : <span className="font-semibold" style={{ color: '#D97706' }}>no charger or accessories</span>}
                    {' · '}in {d.receivedAt}{held !== null ? ` (${held === 0 ? 'today' : `${held} day${held === 1 ? '' : 's'}`})` : ''}
                    {d.status === 'purchased' ? ` · bought ${d.purchasedAt}${d.purchasePrice ? ` for ${fmtKes(d.purchasePrice)}` : ''}${d.purchaseOrderRef ? ` · ${d.purchaseOrderRef}` : ''}` : ''}
                    {d.status === 'returned' ? ` · collected ${d.returnedAt}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS[d.status].className}`}>{STATUS[d.status].label}</span>
                  {d.status === 'at_shop' && (
                    <>
                      <button type="button" className="btn-primary px-3 py-1.5 text-[11px]" onClick={() => open({ kind: 'purchase', device: d })}>Purchase</button>
                      <button type="button" className="btn-secondary px-3 py-1.5 text-[11px]" onClick={() => open({ kind: 'return', device: d })}>Vendor collected</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {dialog && (
        <Modal
          variant="enterprise"
          title={dialog.kind === 'receive' ? 'Book in a vendor device' : dialog.kind === 'purchase' ? 'Purchase from vendor' : 'Vendor collected'}
          subtitle={dialog.kind === 'receive' ? 'Not bought — held for showing clients' : `${dialog.device.serialNumber} · ${dialog.device.vendorName ?? ''}`}
          onClose={() => setDialog(null)}
          width={560}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setDialog(null)} disabled={saving}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : dialog.kind === 'receive' ? 'Book in' : dialog.kind === 'purchase' ? 'Raise purchase order' : 'Book out'}
              </button>
            </div>
          )}
        >
          <div className="flex flex-col gap-3">
            {dialog.kind === 'receive' && (
              <>
                <SearchPicker
                  label="Vendor"
                  placeholder="Search vendors…"
                  items={data.vendors}
                  selectedLabel={form.vendorLabel || undefined}
                  formatSelected={v => v.name}
                  onSelect={v => patch({ vendorId: v.id, vendorLabel: v.name })}
                  renderItem={v => <span className="text-sm">{v.name}{v.isVendor ? '' : <span className="ml-2 text-xs text-slate-400">(will be marked as a vendor)</span>}</span>}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Serial number" required><Input value={form.serialNumber} onChange={v => patch({ serialNumber: v })} placeholder="From the machine's label" /></Field>
                  <Field label="Vendor asset tag" hint="The vendor's own ID — chase it if missing"><Input value={form.assetId} onChange={v => patch({ assetId: v })} /></Field>
                  <Field label="Model" hint="Free text, or pick a product below"><Input value={form.productName} onChange={v => patch({ productName: v })} placeholder="e.g. HP EliteBook 840 G5" /></Field>
                  <Field label="Condition"><Input value={form.conditionGrade} onChange={v => patch({ conditionGrade: v })} placeholder="e.g. A, B, scratches on lid" /></Field>
                  <Field label="Date received" required><Input type="date" value={form.date} onChange={v => patch({ date: v })} /></Field>
                </div>
                <Field label="Came with" hint="Tick everything the vendor left with it — especially the charger">
                  <div className="flex flex-wrap gap-2">
                    {CONSIGNMENT_ACCESSORIES.map(name => (
                      <label key={name} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold ${form.accessories.includes(name) ? 'border-[var(--primary)] bg-[var(--primary-light)]' : 'border-[var(--border)]'}`}>
                        <input type="checkbox" checked={form.accessories.includes(name)} onChange={() => toggleAccessory(name)} />
                        {name}
                      </label>
                    ))}
                  </div>
                  <div className="mt-2">
                    <Input value={form.otherAccessory} onChange={v => patch({ otherAccessory: v })} placeholder="Anything else, e.g. docking station, stylus" />
                  </div>
                </Field>
                <SearchPicker
                  label="Catalogue product (optional)"
                  placeholder="Search products — needed later only if you buy it"
                  items={data.products}
                  selectedLabel={form.productLabel || undefined}
                  formatSelected={p => p.name}
                  onSelect={p => patch({ productId: p.id, productLabel: p.name })}
                  renderItem={p => <span className="text-sm">{p.name}<span className="ml-2 font-mono text-xs text-slate-400">{p.sku}</span></span>}
                />
                <Field label="Notes"><Textarea value={form.notes} onChange={v => patch({ notes: v })} rows={2} /></Field>
              </>
            )}

            {dialog.kind === 'purchase' && (
              <>
                <p className="m-0 text-[11px] leading-relaxed text-[var(--text-2)]">
                  This raises a <strong>draft purchase order</strong> to {dialog.device.vendorName ?? 'the vendor'} for this one machine.
                  It becomes your stock when that order is confirmed and the serial is received on the GRN, the same as any purchase.
                </p>
                <SearchPicker
                  label="Catalogue product"
                  placeholder="Which product is this machine?"
                  items={data.products}
                  selectedLabel={form.productLabel || undefined}
                  formatSelected={p => p.name}
                  onSelect={p => patch({ productId: p.id, productLabel: p.name })}
                  renderItem={p => <span className="text-sm">{p.name}<span className="ml-2 font-mono text-xs text-slate-400">{p.sku}</span></span>}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Price agreed with vendor (KES)" required><Input type="number" value={form.price} onChange={v => patch({ price: v })} /></Field>
                  <Field label="Purchase date" required><Input type="date" value={form.date} onChange={v => patch({ date: v })} /></Field>
                </div>
              </>
            )}

            {dialog.kind === 'return' && (
              <>
                <p className="m-0 text-[11px] leading-relaxed text-[var(--text-2)]">
                  Record that {dialog.device.vendorName ?? 'the vendor'} took {dialog.device.serialNumber} back unsold.
                </p>
                {(dialog.device.accessories ?? []).length > 0 ? (
                  <Field label="Going back with it" hint="Untick anything the vendor did not take — it is noted on the record">
                    <div className="flex flex-wrap gap-2">
                      {(dialog.device.accessories ?? []).map(name => (
                        <label key={name} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold ${form.accessories.includes(name) ? 'border-[var(--primary)] bg-[var(--primary-light)]' : 'border-[var(--border)]'}`}>
                          <input type="checkbox" checked={form.accessories.includes(name)} onChange={() => toggleAccessory(name)} />
                          {name}
                        </label>
                      ))}
                    </div>
                  </Field>
                ) : (
                  <p className="m-0 text-[11px] text-[var(--text-3)]">It came in with no charger or accessories recorded.</p>
                )}
                <Field label="Date collected" required><Input type="date" value={form.date} onChange={v => patch({ date: v })} /></Field>
                <Field label="Notes" hint="Who collected it, condition on handover"><Textarea value={form.notes} onChange={v => patch({ notes: v })} rows={2} /></Field>
              </>
            )}

            {formError && <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{formError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
