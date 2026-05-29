// @ts-nocheck
'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  useApp, BuyBack, BuyBackLine, Donation, DonationLine, ClientExchange, ExchangeLine,
  LocationId, LOCATIONS, fmtKes, fmtDate,
} from '@/lib/store'
import { Badge, Modal, Field, Input, Select, PanelHeader, SearchPicker, ModuleSkeleton } from '@/components/ui'

// ── Helpers ───────────────────────────────────────────────────────────────────
const DEST_OPTS = (['warehouse', 'shop'] as LocationId[]).map(k => ({ value: k, label: LOCATIONS[k].name }))

const CONDITION_OPTS = [
  { value: 'good',  label: '🟢 Good — sellable as-is' },
  { value: 'fair',  label: '🟡 Fair — needs minor work' },
  { value: 'poor',  label: '🔴 Poor — needs refurbishment' },
]

const PAY_OPTS = [
  { value: 'cash',          label: '💵 Cash' },
  { value: 'bank_transfer', label: '🏦 Bank Transfer' },
  { value: 'mpesa',         label: '📱 M-Pesa' },
]

const STATUS_COLOR: Record<string, string> = {
  draft: '#6B7280', approved: '#3B82F6', paid: '#F59E0B',
  stocked: '#10B981', confirmed: '#10B981', completed: '#10B981',
  cancelled: '#EF4444',
}

function StatusPill({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase',
      background: (STATUS_COLOR[status] ?? '#6B7280') + '22',
      color: STATUS_COLOR[status] ?? '#6B7280',
    }}>{status}</span>
  )
}

function RowGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">{children}</div>
}

// ── Serial picker ─────────────────────────────────────────────────────────────
function SerialPicker({ productId, selectedIds, onAdd, onRemove }: {
  productId: string
  selectedIds: string[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { serials } = useApp()
  const available = serials.filter(s =>
    s.productId === productId && ['sold', 'available', 'assigned'].includes(s.status)
  )
  const [q, setQ] = useState('')
  const filtered = available.filter(s => s.serial.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <Input value={q} onChange={setQ} placeholder="Search serial…" />
      <div style={{ maxHeight: 110, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8, marginTop: 4 }}>
        {filtered.length === 0 && <p style={{ fontSize: 11, color: '#9CA3AF', padding: '6px 12px' }}>No serials found</p>}
        {filtered.map(s => {
          const sel = selectedIds.includes(s.id)
          return (
            <div key={s.id} onClick={() => sel ? onRemove(s.id) : onAdd(s.id)}
              style={{ display: 'flex', gap: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 11, background: sel ? '#E8F3FA' : 'transparent', borderBottom: '1px solid #F3F4F6' }}>
              <span style={{ flex: 1, fontFamily: 'monospace', color: '#1B2762' }}>{s.serial}</span>
              <span style={{ fontSize: 9, color: '#6B7280' }}>{s.status} · {s.location}</span>
              {sel && <span style={{ color: '#00B0D7', fontWeight: 700 }}>✓</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// BUY-BACKS
// ══════════════════════════════════════════════════════════════════════════════

type BBLine = { productId: string; productName: string; qty: number; condition: 'good'|'fair'|'poor'; unitPrice: number; serialIds: string[]; notes: string }

function BuyBackTab() {
  const { buyBacks, createBuyBack, approveBuyBack, payBuyBack, stockBuyBack, deleteBuyBack,
    contacts, products, saleOrders, users, currentUserId, showToast } = useApp()

  const isAdmin = users.find(u => u.id === currentUserId)?.role === 'director'

  const [detail, setDetail] = useState<BuyBack | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')
  const [customerId, setCustomerId]   = useState('')
  const [customerName, setCustomerName] = useState('')
  const [originalSORef, setOriginalSORef] = useState('')
  const [destination, setDestination] = useState<LocationId>('warehouse')
  const [notes, setNotes]             = useState('')
  const [lines, setLines]             = useState<BBLine[]>([])
  const [payModal, setPayModal]       = useState<string | null>(null)
  const [payMethod, setPayMethod]     = useState('cash')

  const originalSO = useMemo(() =>
    originalSORef ? saleOrders.find(s => s.ref.toLowerCase() === originalSORef.toLowerCase()) : undefined,
    [originalSORef, saleOrders])

  function reset() { setCustomerId(''); setCustomerName(''); setOriginalSORef(''); setDestination('warehouse'); setNotes(''); setLines([]) }

  function addLine() {
    setLines(l => [...l, { productId: '', productName: '', qty: 1, condition: 'good', unitPrice: 0, serialIds: [], notes: '' }])
  }

  function updLine(i: number, patch: Partial<BBLine>) {
    setLines(l => l.map((x, idx) => idx === i ? { ...x, ...patch } : x))
  }

  function submit() {
    if (!customerId) { showToast('Select a customer', 'error'); return }
    if (!lines.length || lines.some(l => !l.productId)) { showToast('Add product lines', 'error'); return }
    createBuyBack(customerId, customerName, lines, destination, notes || undefined, originalSO?.id, originalSO?.ref)
    setShowNew(false); reset()
  }

  const sorted = [...buyBacks].sort((a, b) => b.date.localeCompare(a.date))
  const s = search.toLowerCase()
  const displayed = s ? sorted.filter(bb =>
    bb.ref.toLowerCase().includes(s) ||
    bb.customerName.toLowerCase().includes(s) ||
    (bb.originalSORef ?? '').toLowerCase().includes(s)
  ) : sorted

  if (detail) {
    const bb = buyBacks.find(b => b.id === detail.id) ?? detail
    const STEPS = ['draft', 'approved', 'paid', 'stocked']
    const si = STEPS.indexOf(bb.status)
    return (
      <div>
        <button onClick={() => setDetail(null)} style={{ fontSize: 11, color: '#00B0D7', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back</button>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{bb.ref}</p>
              <p style={{ fontSize: 12, color: '#6B7280' }}>{bb.customerName} · {fmtDate(bb.date)}</p>
              {bb.originalSORef && <p style={{ fontSize: 11, color: '#9CA3AF' }}>Original sale: {bb.originalSORef}</p>}
            </div>
            <StatusPill status={bb.status} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {STEPS.map((s, i) => (
              <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: 3, borderRadius: 2, background: i <= si ? '#1B2762' : '#E5E7EB', marginBottom: 4 }} />
                <span style={{ fontSize: 9, color: i <= si ? '#1B2762' : '#9CA3AF', fontWeight: i === si ? 700 : 400, textTransform: 'capitalize' }}>{s}</span>
              </div>
            ))}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
            <thead><tr style={{ background: '#F9FAFB' }}>
              {['Product', 'Condition', 'Qty', 'Serials', 'Unit Price', 'Total'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#6B7280', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {bb.lines.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{l.productName}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700, background: l.condition === 'good' ? '#DCFCE7' : l.condition === 'fair' ? '#FEF9C3' : '#FEE2E2', color: l.condition === 'good' ? '#166534' : l.condition === 'fair' ? '#854D0E' : '#991B1B' }}>{l.condition}</span>
                  </td>
                  <td style={{ padding: '8px 10px' }}>{l.qty}</td>
                  <td style={{ padding: '8px 10px', color: '#6B7280' }}>{l.serialIds.length > 0 ? `${l.serialIds.length} serial(s)` : '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{fmtKes(l.unitPrice)}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{fmtKes(l.unitPrice * l.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ textAlign: 'right', marginBottom: 16, fontSize: 14, fontWeight: 700 }}>Total We Pay: {fmtKes(bb.total)}</div>
          {bb.notes && <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 12 }}>Note: {bb.notes}</p>}
          {bb.approvedByName && <p style={{ fontSize: 10, color: '#9CA3AF' }}>Approved by {bb.approvedByName} on {fmtDate(bb.approvedDate!)}</p>}
          {bb.stockedByName && <p style={{ fontSize: 10, color: '#9CA3AF' }}>Stocked by {bb.stockedByName} on {fmtDate(bb.stockedDate!)}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {bb.status === 'draft' && isAdmin && <button className="btn-primary text-[11px]" onClick={() => approveBuyBack(bb.id)}>✓ Approve</button>}
            {bb.status === 'approved' && <button className="btn-primary text-[11px]" onClick={() => setPayModal(bb.id)}>💰 Record Payment</button>}
            {bb.status === 'paid' && <button className="btn-primary text-[11px]" onClick={() => stockBuyBack(bb.id)}>📦 Add to Stock</button>}
            {bb.status === 'draft' && <button className="btn-secondary text-[11px]" onClick={() => { deleteBuyBack(bb.id); setDetail(null) }}>🗑 Delete</button>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PanelHeader title="Buy-Backs" count={displayed.length}>
        <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
          placeholder="Search ref, customer…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Buy-Back</button>
      </PanelHeader>

      {displayed.length === 0
        ? <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>{search ? 'No results.' : 'No buy-backs yet.'}</div>
        : (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[700px] flex flex-col">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: '#F9FAFB' }}>
              {['Ref', 'Customer', 'Original SO', 'Items', 'Total', 'Date', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6B7280', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {displayed.map(bb => (
                <tr key={bb.id} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}
                  onClick={() => setDetail(bb)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F0F9FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1B2762' }}>{bb.ref}</td>
                  <td style={{ padding: '10px 12px' }}>{bb.customerName}</td>
                  <td style={{ padding: '10px 12px', color: '#9CA3AF' }}>{bb.originalSORef ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{bb.lines.length} item(s)</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{fmtKes(bb.total)}</td>
                  <td style={{ padding: '10px 12px', color: '#6B7280' }}>{fmtDate(bb.date)}</td>
                  <td style={{ padding: '10px 12px' }}><StatusPill status={bb.status} /></td>
                  <td style={{ padding: '10px 12px', color: '#00B0D7' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          </div>
        )}

      {showNew && (
        <Modal title="New Buy-Back" onClose={() => { setShowNew(false); reset() }}>
          <div style={{ maxHeight: '68vh', overflowY: 'auto', paddingRight: 2 }}>
            <RowGrid>
              <Field label="Customer *">
                <SearchPicker label="" placeholder="Search customer…"
                  items={contacts.map(c => ({ id: c.id, name: c.name }))}
                  onSelect={(c: { id: string; name: string }) => { setCustomerId(c.id); setCustomerName(c.name) }}
                  renderItem={(c: { id: string; name: string }) => c.name} />
              </Field>
              <Field label="Original Sale Ref (optional)">
                <Input value={originalSORef} onChange={setOriginalSORef} placeholder="e.g. SO/0087" />
                {originalSO && <p style={{ fontSize: 10, color: '#10B981', marginTop: 2 }}>✓ {originalSO.ref} · {originalSO.customerName}</p>}
              </Field>
            </RowGrid>
            <RowGrid>
              <Field label="Destination Location">
                <Select value={destination} onChange={v => setDestination(v as LocationId)} options={DEST_OPTS} />
              </Field>
              <Field label="Notes">
                <Input value={notes} onChange={setNotes} placeholder="Optional notes" />
              </Field>
            </RowGrid>

            <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>Items Being Bought Back</p>
                <button className="btn-secondary text-[10px] py-1" onClick={addLine}>+ Add Line</button>
              </div>
              {lines.map((line, i) => (
                <BBLineEditor key={i} line={line} products={products}
                  onChange={p => updLine(i, p)}
                  onRemove={() => setLines(l => l.filter((_, idx) => idx !== i))} />
              ))}
              {!lines.length && <p style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', padding: 16 }}>No lines added.</p>}
            </div>

            {lines.length > 0 && (
              <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, marginTop: 8 }}>
                Total: {fmtKes(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn-secondary text-[11px]" onClick={() => { setShowNew(false); reset() }}>Cancel</button>
            <button className="btn-primary text-[11px]" onClick={submit}>Create Buy-Back</button>
          </div>
        </Modal>
      )}

      {payModal && (
        <Modal title="Record Payment to Customer" onClose={() => setPayModal(null)}>
          <Field label="Payment Method">
            <Select value={payMethod} onChange={setPayMethod} options={PAY_OPTS} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn-secondary text-[11px]" onClick={() => setPayModal(null)}>Cancel</button>
            <button className="btn-primary text-[11px]" onClick={() => { payBuyBack(payModal, payMethod as BuyBack['paymentMethod']); setPayModal(null) }}>Confirm Payment</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BBLineEditor({ line, onChange, onRemove, products }: {
  line: BBLine
  onChange: (patch: Partial<BBLine>) => void
  onRemove: () => void
  products: ReturnType<typeof useApp>['products']
}) {
  const [showSerials, setShowSerials] = useState(false)
  const prod = products.find(p => p.id === line.productId)
  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 12, marginBottom: 8 }}>
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 sm:gap-3 items-end">
        <Field label="Product">
          <select value={line.productId} onChange={e => {
            const p = products.find(x => x.id === e.target.value)
            onChange({ productId: e.target.value, productName: p?.name ?? '', serialIds: [] })
          }} className="form-select w-full">
            <option value="">— Select —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Condition">
          <Select value={line.condition} onChange={v => onChange({ condition: v as 'good'|'fair'|'poor' })} options={CONDITION_OPTS.map(c => ({ value: c.value, label: c.value }))} />
        </Field>
        <Field label="Qty">
          <Input type="number" value={String(line.qty)} onChange={v => onChange({ qty: Number(v) })} />
        </Field>
        <Field label="We Pay (KSh)">
          <Input type="number" value={String(line.unitPrice)} onChange={v => onChange({ unitPrice: Number(v) })} />
        </Field>
        <button onClick={onRemove} style={{ fontSize: 14, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 4 }}>✕</button>
      </div>
      {prod?.requiresSerial && line.productId && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowSerials(s => !s)} style={{ fontSize: 10, color: '#00B0D7', background: 'none', border: 'none', cursor: 'pointer' }}>
            {showSerials ? '▲' : '▼'} Serials ({line.serialIds.length} selected)
          </button>
          {showSerials && (
            <div style={{ marginTop: 6 }}>
              <SerialPicker productId={line.productId} selectedIds={line.serialIds}
                onAdd={id => onChange({ serialIds: [...line.serialIds, id] })}
                onRemove={id => onChange({ serialIds: line.serialIds.filter(s => s !== id) })} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// DONATIONS
// ══════════════════════════════════════════════════════════════════════════════

type DonLine = { productId: string; productName: string; qty: number; serialIds: string[] }

// ── Bulk upload row (parsed from CSV/XLSX) ───────────────────────────────────
type BulkRow = {
  type: 'in' | 'out'
  party: string
  location: LocationId
  productId: string
  productName: string
  qty: number
  notes: string
  error?: string
}

const BULK_TEMPLATE_HEADERS = ['type', 'party', 'location', 'product_name', 'qty', 'notes']
const BULK_TEMPLATE_EXAMPLE = [
  ['in',  'USAID Kenya',     'warehouse', 'Laptop HP ProBook',  '10', 'Grant 2024'],
  ['out', 'St. Mary School', 'warehouse', 'Accessories Bag',    '5',  ''],
]

function downloadBulkTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([BULK_TEMPLATE_HEADERS, ...BULK_TEMPLATE_EXAMPLE])
  ws['!cols'] = BULK_TEMPLATE_HEADERS.map(() => ({ wch: 22 }))
  XLSX.utils.book_append_sheet(wb, ws, 'Donations')
  XLSX.writeFile(wb, 'donations_bulk_template.xlsx')
}

function DonationTab() {
  const { donations, createDonation, confirmDonation, deleteDonation,
    products, users, currentUserId, showToast } = useApp()

  const [detail, setDetail]   = useState<Donation | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [donType, setDonType] = useState<'in' | 'out'>('in')
  const [party, setParty]     = useState('')
  const [location, setLocation] = useState<LocationId>('warehouse')
  const [notes, setNotes]     = useState('')
  const [lines, setLines]     = useState<DonLine[]>([])

  // Bulk upload state
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([])
  const [bulkImporting, setBulkImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const sorted = [...donations].sort((a, b) => b.date.localeCompare(a.date))
  const [donSearch, setDonSearch] = useState('')
  const ds = donSearch.toLowerCase()
  const displayedDon = ds ? sorted.filter(d =>
    d.ref.toLowerCase().includes(ds) ||
    d.party.toLowerCase().includes(ds) ||
    (d.notes ?? '').toLowerCase().includes(ds)
  ) : sorted

  function reset() { setParty(''); setLocation('warehouse'); setNotes(''); setLines([]) }
  function resetBulk() { setBulkRows([]); if (fileRef.current) fileRef.current.value = '' }

  function submit() {
    if (!party) { showToast('Enter donor / recipient name', 'error'); return }
    if (!lines.length || lines.some(l => !l.productId)) { showToast('Add valid product lines', 'error'); return }
    createDonation(donType, party, location, lines, notes || undefined)
    setShowNew(false); reset()
  }

  function parseBulkFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

        const parsed: BulkRow[] = raw.map((row, i) => {
          const type = String(row['type'] ?? row['Type'] ?? '').trim().toLowerCase()
          const party = String(row['party'] ?? row['Party'] ?? '').trim()
          const locRaw = String(row['location'] ?? row['Location'] ?? 'warehouse').trim().toLowerCase()
          const productRaw = String(row['product_name'] ?? row['Product Name'] ?? row['product'] ?? '').trim()
          const qty = Number(row['qty'] ?? row['Qty'] ?? row['quantity'] ?? 0)
          const notes = String(row['notes'] ?? row['Notes'] ?? '').trim()

          const loc: LocationId = (['warehouse', 'shop', 'repair_unit'] as LocationId[]).includes(locRaw as LocationId)
            ? locRaw as LocationId : 'warehouse'

          const product = products.find(p =>
            p.name.toLowerCase() === productRaw.toLowerCase() ||
            p.sku.toLowerCase() === productRaw.toLowerCase()
          )

          const errors: string[] = []
          if (type !== 'in' && type !== 'out') errors.push('type must be "in" or "out"')
          if (!party) errors.push('party is required')
          if (!product) errors.push(`product "${productRaw}" not found`)
          if (!qty || qty <= 0) errors.push('qty must be > 0')

          return {
            type: (type === 'out' ? 'out' : 'in') as 'in' | 'out',
            party,
            location: loc,
            productId: product?.id ?? '',
            productName: product?.name ?? productRaw,
            qty,
            notes,
            error: errors.length ? errors.join('; ') : undefined,
          }
        })
        setBulkRows(parsed)
      } catch {
        showToast('Could not parse file — use the provided template', 'error')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function importBulk() {
    const valid = bulkRows.filter(r => !r.error)
    if (!valid.length) { showToast('No valid rows to import', 'error'); return }
    setBulkImporting(true)
    let count = 0
    for (const row of valid) {
      createDonation(
        row.type,
        row.party,
        row.location,
        [{ productId: row.productId, productName: row.productName, qty: row.qty, serialIds: [] }],
        row.notes || undefined,
      )
      count++
    }
    setBulkImporting(false)
    setShowBulk(false)
    resetBulk()
    showToast(`${count} donation${count !== 1 ? 's' : ''} imported`, 'success')
  }

  if (detail) {
    const don = donations.find(d => d.id === detail.id) ?? detail
    return (
      <div>
        <button onClick={() => setDetail(null)} style={{ fontSize: 11, color: '#00B0D7', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back</button>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{don.ref}</p>
              <p style={{ fontSize: 12, color: '#6B7280' }}>{don.type === 'in' ? '📥 Donation In' : '📤 Donation Out'} · {don.party} · {fmtDate(don.date)}</p>
            </div>
            <StatusPill status={don.status} />
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
            <thead><tr style={{ background: '#F9FAFB' }}>
              {['Product', 'Qty', 'Serials'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#6B7280', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {don.lines.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{l.productName}</td>
                  <td style={{ padding: '8px 10px' }}>{l.qty}</td>
                  <td style={{ padding: '8px 10px', color: '#6B7280', fontSize: 10 }}>{l.serialIds.length > 0 ? `${l.serialIds.length} serial(s)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {don.notes && <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 12 }}>Note: {don.notes}</p>}
          {don.confirmedByName && <p style={{ fontSize: 10, color: '#9CA3AF' }}>Confirmed by {don.confirmedByName} on {fmtDate(don.confirmedDate!)}</p>}

          {don.status === 'draft' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-primary text-[11px]" onClick={() => confirmDonation(don.id)}>
                {don.type === 'in' ? '📥 Receive into Stock' : '📤 Confirm Donation Out'}
              </button>
              <button className="btn-secondary text-[11px]" onClick={() => { deleteDonation(don.id); setDetail(null) }}>🗑 Delete</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PanelHeader title="Donations" count={displayedDon.length}>
        <input className="form-input text-[11px] py-1.5" style={{ width: 180 }}
          placeholder="Search ref, party…" value={donSearch} onChange={e => setDonSearch(e.target.value)} />
        <button className="btn-secondary text-[11px]" onClick={() => setShowBulk(true)}>📤 Bulk Upload</button>
        <button className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Donation</button>
      </PanelHeader>

      {displayedDon.length === 0
        ? <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>{donSearch ? 'No results.' : 'No donations recorded.'}</div>
        : (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[700px] flex flex-col">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: '#F9FAFB' }}>
              {['Ref', 'Type', 'Party', 'Items', 'Location', 'Date', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6B7280', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {displayedDon.map(don => (
                <tr key={don.id} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}
                  onClick={() => setDetail(don)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F0F9FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1B2762' }}>{don.ref}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700, background: don.type === 'in' ? '#DBEAFE' : '#FEF9C3', color: don.type === 'in' ? '#1E40AF' : '#854D0E' }}>
                      {don.type === 'in' ? '📥 In' : '📤 Out'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{don.party}</td>
                  <td style={{ padding: '10px 12px' }}>{don.lines.length} item(s)</td>
                  <td style={{ padding: '10px 12px', color: '#6B7280' }}>{LOCATIONS[don.location]?.name ?? don.location}</td>
                  <td style={{ padding: '10px 12px', color: '#6B7280' }}>{fmtDate(don.date)}</td>
                  <td style={{ padding: '10px 12px' }}><StatusPill status={don.status} /></td>
                  <td style={{ padding: '10px 12px', color: '#00B0D7' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          </div>
        )}

      {showBulk && (
        <Modal title="Bulk Upload Donations" subtitle="Upload a CSV or Excel file to create multiple donations at once"
          onClose={() => { setShowBulk(false); resetBulk() }}>
          <div style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: 2 }}>
            {/* Step 1 — template */}
            <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#0369A1' }}>1. Download the template</p>
                <p style={{ fontSize: 11, color: '#0284C7', marginTop: 2 }}>Fill in columns: type, party, location, product_name, qty, notes</p>
              </div>
              <button className="btn-secondary text-[11px]" onClick={downloadBulkTemplate}>⬇ Template</button>
            </div>

            {/* Step 2 — file picker */}
            <div style={{ border: '2px dashed #D1D5DB', borderRadius: 10, padding: '20px', textAlign: 'center', marginBottom: 14, cursor: 'pointer', background: '#FAFAFA' }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#00B0D7' }}
              onDragLeave={e => { e.currentTarget.style.borderColor = '#D1D5DB' }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#D1D5DB'; const f = e.dataTransfer.files[0]; if (f) parseBulkFile(f) }}>
              <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 4 }}>📂 Click or drag &amp; drop file here</p>
              <p style={{ fontSize: 10, color: '#9CA3AF' }}>Accepts .xlsx, .xls, .csv</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) parseBulkFile(f) }} />
            </div>

            {/* Step 3 — preview */}
            {bulkRows.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>Preview — {bulkRows.length} row(s)</p>
                  <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>✓ {bulkRows.filter(r => !r.error).length} valid</span>
                    {bulkRows.some(r => r.error) && <span style={{ color: '#EF4444', fontWeight: 600 }}>✕ {bulkRows.filter(r => r.error).length} errors</span>}
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#F9FAFB' }}>
                        {['Type', 'Party', 'Location', 'Product', 'Qty', 'Notes', 'Status'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#6B7280', fontWeight: 600, fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #F3F4F6', background: row.error ? '#FFF7F7' : 'transparent' }}>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700, background: row.type === 'in' ? '#DBEAFE' : '#FEF9C3', color: row.type === 'in' ? '#1E40AF' : '#854D0E' }}>
                              {row.type === 'in' ? '📥 In' : '📤 Out'}
                            </span>
                          </td>
                          <td style={{ padding: '7px 10px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.party || <span style={{ color: '#9CA3AF' }}>—</span>}</td>
                          <td style={{ padding: '7px 10px', color: '#6B7280' }}>{LOCATIONS[row.location]?.name ?? row.location}</td>
                          <td style={{ padding: '7px 10px', fontWeight: row.productId ? 600 : 400, color: row.productId ? '#111827' : '#EF4444' }}>{row.productName || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{row.qty}</td>
                          <td style={{ padding: '7px 10px', color: '#6B7280', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>
                            {row.error
                              ? <span title={row.error} style={{ color: '#EF4444', fontSize: 10, fontWeight: 700, cursor: 'help' }}>✕ {row.error}</span>
                              : <span style={{ color: '#10B981', fontSize: 10, fontWeight: 700 }}>✓ OK</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn-secondary text-[11px]" onClick={() => { setShowBulk(false); resetBulk() }}>Cancel</button>
            {bulkRows.filter(r => !r.error).length > 0 && (
              <button className="btn-primary text-[11px]" onClick={importBulk} disabled={bulkImporting}>
                {bulkImporting ? 'Importing…' : `Import ${bulkRows.filter(r => !r.error).length} Donation${bulkRows.filter(r => !r.error).length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </Modal>
      )}

      {showNew && (
        <Modal title="Record Donation" onClose={() => { setShowNew(false); reset() }}>
          <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 2 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {(['in', 'out'] as const).map(t => (
                <button key={t} onClick={() => setDonType(t)}
                  style={{ fontSize: 11, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', border: 'none', background: donType === t ? '#1B2762' : '#F3F4F6', color: donType === t ? '#fff' : '#6B7280', fontWeight: donType === t ? 700 : 400 }}>
                  {t === 'in' ? '📥 Donation In (we receive)' : '📤 Donation Out (we give)'}
                </button>
              ))}
            </div>
            <RowGrid>
              <Field label={donType === 'in' ? 'Donor Name *' : 'Recipient / Beneficiary *'}>
                <Input value={party} onChange={setParty} placeholder={donType === 'in' ? 'e.g. USAID Kenya' : 'e.g. St. Mary School'} />
              </Field>
              <Field label={donType === 'in' ? 'Receive Into' : 'Take From'}>
                <Select value={location} onChange={v => setLocation(v as LocationId)} options={DEST_OPTS} />
              </Field>
            </RowGrid>
            <Field label="Notes">
              <Input value={notes} onChange={setNotes} placeholder="Optional notes" />
            </Field>

            <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 12, marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700 }}>Items</p>
                <button className="btn-secondary text-[10px] py-1" onClick={() => setLines(l => [...l, { productId: '', productName: '', qty: 1, serialIds: [] }])}>+ Add</button>
              </div>
              {lines.map((line, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                  <Field label="Product">
                    <select value={line.productId} onChange={e => {
                      const p = products.find(x => x.id === e.target.value)
                      setLines(l => l.map((x, idx) => idx === i ? { ...x, productId: e.target.value, productName: p?.name ?? '' } : x))
                    }} className="form-select w-full">
                      <option value="">— Select —</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Qty">
                    <Input type="number" value={String(line.qty)} onChange={v => setLines(l => l.map((x, idx) => idx === i ? { ...x, qty: Number(v) } : x))} />
                  </Field>
                  <button onClick={() => setLines(l => l.filter((_, idx) => idx !== i))} style={{ fontSize: 14, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 4 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn-secondary text-[11px]" onClick={() => { setShowNew(false); reset() }}>Cancel</button>
            <button className="btn-primary text-[11px]" onClick={submit}>Save Donation</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT EXCHANGES
// ══════════════════════════════════════════════════════════════════════════════

type ELine = { productId: string; productName: string; qty: number; unitPrice: number; serialIds: string[] }

function ExchangeTab() {
  const { clientExchanges, createExchange, approveExchange, completeExchange, cancelExchange,
    contacts, products, saleOrders, users, currentUserId, showToast } = useApp()

  const isAdmin = users.find(u => u.id === currentUserId)?.role === 'director'

  const [detail, setDetail]   = useState<ClientExchange | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [customerId, setCustomerId]   = useState('')
  const [customerName, setCustomerName] = useState('')
  const [originalSORef, setOriginalSORef] = useState('')
  const [notes, setNotes]     = useState('')
  const [returnLines, setReturnLines] = useState<ELine[]>([])
  const [newLines, setNewLines]       = useState<ELine[]>([])

  const originalSO = useMemo(() =>
    originalSORef ? saleOrders.find(s => s.ref.toLowerCase() === originalSORef.toLowerCase()) : undefined,
    [originalSORef, saleOrders])

  const sorted = [...clientExchanges].sort((a, b) => b.date.localeCompare(a.date))
  const [excSearch, setExcSearch] = useState('')
  const es = excSearch.toLowerCase()
  const displayedExc = es ? sorted.filter(e =>
    e.ref.toLowerCase().includes(es) ||
    e.customerName.toLowerCase().includes(es) ||
    (e.originalSORef ?? '').toLowerCase().includes(es)
  ) : sorted

  function reset() { setCustomerId(''); setCustomerName(''); setOriginalSORef(''); setNotes(''); setReturnLines([]); setNewLines([]) }

  function submit() {
    if (!customerId) { showToast('Select a customer', 'error'); return }
    if (!returnLines.length || !newLines.length) { showToast('Add both return and new items', 'error'); return }
    if (returnLines.some(l => !l.productId) || newLines.some(l => !l.productId)) { showToast('All lines need a product', 'error'); return }
    createExchange(customerId, customerName, returnLines, newLines, notes || undefined, originalSO?.id, originalSO?.ref)
    setShowNew(false); reset()
  }

  const returnTotal = returnLines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const newTotal    = newLines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const diff        = newTotal - returnTotal

  if (detail) {
    const exc = clientExchanges.find(e => e.id === detail.id) ?? detail
    const STEPS = ['draft', 'approved', 'completed']
    const si = exc.status === 'cancelled' ? -1 : STEPS.indexOf(exc.status)
    return (
      <div>
        <button onClick={() => setDetail(null)} style={{ fontSize: 11, color: '#00B0D7', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back</button>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{exc.ref}</p>
              <p style={{ fontSize: 12, color: '#6B7280' }}>{exc.customerName} · {fmtDate(exc.date)}</p>
              {exc.originalSORef && <p style={{ fontSize: 11, color: '#9CA3AF' }}>Original SO: {exc.originalSORef}</p>}
            </div>
            <StatusPill status={exc.status} />
          </div>

          {exc.status !== 'cancelled' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {STEPS.map((s, i) => (
                <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: 3, borderRadius: 2, background: i <= si ? '#1B2762' : '#E5E7EB', marginBottom: 4 }} />
                  <span style={{ fontSize: 9, color: i <= si ? '#1B2762' : '#9CA3AF', fontWeight: i === si ? 700 : 400, textTransform: 'capitalize' }}>{s}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ border: '1px solid #FEE2E2', borderRadius: 10, padding: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#991B1B', marginBottom: 8 }}>↩ Returned by Customer</p>
              {exc.returnLines.map(l => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                  <span>{l.productName} ×{l.qty}</span><span style={{ fontWeight: 600 }}>{fmtKes(l.unitPrice * l.qty)}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #FEE2E2', marginTop: 8, paddingTop: 6, fontWeight: 700, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span>Credit Value</span><span>{fmtKes(exc.returnTotal)}</span>
              </div>
            </div>
            <div style={{ border: '1px solid #DCFCE7', borderRadius: 10, padding: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#166534', marginBottom: 8 }}>📦 New Items for Customer</p>
              {exc.newLines.map(l => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                  <span>{l.productName} ×{l.qty}</span><span style={{ fontWeight: 600 }}>{fmtKes(l.unitPrice * l.qty)}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #DCFCE7', marginTop: 8, paddingTop: 6, fontWeight: 700, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span>Total Value</span><span>{fmtKes(exc.newTotal)}</span>
              </div>
            </div>
          </div>

          <div style={{ background: exc.priceDiff > 0 ? '#FEF9C3' : exc.priceDiff < 0 ? '#DCFCE7' : '#F3F4F6', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
            <span>{exc.priceDiff > 0 ? 'Customer pays additional' : exc.priceDiff < 0 ? 'We owe customer' : 'Even exchange'}</span>
            <span style={{ color: exc.priceDiff > 0 ? '#854D0E' : exc.priceDiff < 0 ? '#166534' : '#374151' }}>
              {exc.priceDiff !== 0 ? fmtKes(Math.abs(exc.priceDiff)) : '—'}
            </span>
          </div>

          {exc.notes && <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 12 }}>Note: {exc.notes}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            {exc.status === 'draft' && isAdmin && <button className="btn-primary text-[11px]" onClick={() => approveExchange(exc.id)}>✓ Approve</button>}
            {exc.status === 'approved' && <button className="btn-primary text-[11px]" onClick={() => completeExchange(exc.id)}>✅ Complete Exchange</button>}
            {['draft', 'approved'].includes(exc.status) && <button className="btn-secondary text-[11px]" onClick={() => { cancelExchange(exc.id); setDetail(null) }}>✕ Cancel</button>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PanelHeader title="Client Exchanges" count={displayedExc.length}>
        <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
          placeholder="Search ref, customer…" value={excSearch} onChange={e => setExcSearch(e.target.value)} />
        <button className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Exchange</button>
      </PanelHeader>

      {displayedExc.length === 0
        ? <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>{excSearch ? 'No results.' : 'No exchanges yet.'}</div>
        : (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[800px] flex flex-col">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: '#F9FAFB' }}>
              {['Ref', 'Customer', 'Original SO', 'Return Value', 'New Value', 'Diff', 'Date', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6B7280', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {displayedExc.map(exc => (
                <tr key={exc.id} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}
                  onClick={() => setDetail(exc)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F0F9FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1B2762' }}>{exc.ref}</td>
                  <td style={{ padding: '10px 12px' }}>{exc.customerName}</td>
                  <td style={{ padding: '10px 12px', color: '#9CA3AF' }}>{exc.originalSORef ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{fmtKes(exc.returnTotal)}</td>
                  <td style={{ padding: '10px 12px' }}>{fmtKes(exc.newTotal)}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: exc.priceDiff > 0 ? '#854D0E' : exc.priceDiff < 0 ? '#166534' : '#374151' }}>
                    {exc.priceDiff > 0 ? `+${fmtKes(exc.priceDiff)}` : exc.priceDiff < 0 ? `-${fmtKes(Math.abs(exc.priceDiff))}` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#6B7280' }}>{fmtDate(exc.date)}</td>
                  <td style={{ padding: '10px 12px' }}><StatusPill status={exc.status} /></td>
                  <td style={{ padding: '10px 12px', color: '#00B0D7' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          </div>
        )}

      {showNew && (
        <Modal title="New Client Exchange" onClose={() => { setShowNew(false); reset() }}>
          <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 2 }}>
            <RowGrid>
              <Field label="Customer *">
                <SearchPicker label="" placeholder="Search customer…"
                  items={contacts.map(c => ({ id: c.id, name: c.name }))}
                  onSelect={(c: { id: string; name: string }) => { setCustomerId(c.id); setCustomerName(c.name) }}
                  renderItem={(c: { id: string; name: string }) => c.name} />
              </Field>
              <Field label="Original Sale Ref (optional)">
                <Input value={originalSORef} onChange={setOriginalSORef} placeholder="e.g. SO/0087" />
                {originalSO && <p style={{ fontSize: 10, color: '#10B981', marginTop: 2 }}>✓ {originalSO.ref}</p>}
              </Field>
            </RowGrid>
            <Field label="Notes">
              <Input value={notes} onChange={setNotes} placeholder="Reason for exchange…" />
            </Field>

            <div style={{ border: '1px solid #FEE2E2', borderRadius: 10, padding: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#991B1B' }}>↩ Items Customer Returns</p>
                <button className="btn-secondary text-[10px] py-1" onClick={() => setReturnLines(l => [...l, { productId: '', productName: '', qty: 1, unitPrice: 0, serialIds: [] }])}>+ Add</button>
              </div>
              {returnLines.map((line, i) => (
                <ELineEditor key={i} line={line} products={products}
                  onChange={p => setReturnLines(l => l.map((x, idx) => idx === i ? { ...x, ...p } : x))}
                  onRemove={() => setReturnLines(l => l.filter((_, idx) => idx !== i))} />
              ))}
              {!returnLines.length && <p style={{ fontSize: 10, color: '#9CA3AF' }}>No return lines.</p>}
              {returnLines.length > 0 && <p style={{ fontSize: 11, fontWeight: 700, textAlign: 'right', marginTop: 6 }}>Credit: {fmtKes(returnTotal)}</p>}
            </div>

            <div style={{ border: '1px solid #DCFCE7', borderRadius: 10, padding: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>📦 New Items for Customer</p>
                <button className="btn-secondary text-[10px] py-1" onClick={() => setNewLines(l => [...l, { productId: '', productName: '', qty: 1, unitPrice: 0, serialIds: [] }])}>+ Add</button>
              </div>
              {newLines.map((line, i) => (
                <ELineEditor key={i} line={line} products={products}
                  onChange={p => setNewLines(l => l.map((x, idx) => idx === i ? { ...x, ...p } : x))}
                  onRemove={() => setNewLines(l => l.filter((_, idx) => idx !== i))} />
              ))}
              {!newLines.length && <p style={{ fontSize: 10, color: '#9CA3AF' }}>No new lines.</p>}
              {newLines.length > 0 && <p style={{ fontSize: 11, fontWeight: 700, textAlign: 'right', marginTop: 6 }}>Total: {fmtKes(newTotal)}</p>}
            </div>

            {(returnLines.length > 0 || newLines.length > 0) && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: diff > 0 ? '#FEF9C3' : diff < 0 ? '#DCFCE7' : '#F3F4F6', borderRadius: 8, fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                <span>{diff > 0 ? 'Customer pays additional' : diff < 0 ? 'We owe customer' : 'Even exchange'}</span>
                <span>{diff !== 0 ? fmtKes(Math.abs(diff)) : '—'}</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn-secondary text-[11px]" onClick={() => { setShowNew(false); reset() }}>Cancel</button>
            <button className="btn-primary text-[11px]" onClick={submit}>Create Exchange</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ELineEditor({ line, onChange, onRemove, products }: {
  line: ELine
  onChange: (patch: Partial<ELine>) => void
  onRemove: () => void
  products: ReturnType<typeof useApp>['products']
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-2 sm:gap-3 mb-2 items-end">
      <Field label="Product">
        <select value={line.productId} onChange={e => {
          const p = products.find(x => x.id === e.target.value)
          onChange({ productId: e.target.value, productName: p?.name ?? '', unitPrice: p?.salePrice ?? 0 })
        }} className="form-select w-full">
          <option value="">— Select —</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Qty">
        <Input type="number" value={String(line.qty)} onChange={v => onChange({ qty: Number(v) })} />
      </Field>
      <Field label="Price (KSh)">
        <Input type="number" value={String(line.unitPrice)} onChange={v => onChange({ unitPrice: Number(v) })} />
      </Field>
      <button onClick={onRemove} style={{ fontSize: 14, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 4 }}>✕</button>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT
// ══════════════════════════════════════════════════════════════════════════════

type TradeTab = 'buybacks' | 'donations' | 'exchanges'

export default function TradeIn() {
  const [mounted, setMounted] = useState(false)
  const { buyBacks, donations, clientExchanges } = useApp()
  const [tab, setTab] = useState<TradeTab>('buybacks')

  useEffect(() => { setMounted(true) }, [])

  if (!mounted) {
    return (
      <ModuleSkeleton />
    )
  }

  const tabs: { id: TradeTab; label: string; count: number }[] = [
    { id: 'buybacks',  label: 'Buy-Backs',  count: buyBacks.length },
    { id: 'donations', label: 'Donations',   count: donations.length },
    { id: 'exchanges', label: 'Exchanges',   count: clientExchanges.length },
  ]

  return (
    <div className="mod-page">
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ background: '#1B276218', color: '#1B2762' }}>
            <span className="text-sm font-bold">T</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-extrabold text-text-1">Trade-In</h1>
              <span className="badge badge-gray text-[9px]">{buyBacks.length + donations.length + clientExchanges.length}</span>
            </div>
            <p className="text-[10px] text-text-3 mt-0.5">Buy-backs, donations and exchanges</p>
          </div>
        </div>
      </div>
      <div className="mod-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`mod-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count > 0 && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: tab === t.id ? 'rgba(255,255,255,0.25)' : 'var(--bg-surface)', color: tab === t.id ? '#fff' : 'var(--text-2)' }}>{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="mod-body p-3 sm:p-4">
        {tab === 'buybacks'  && <BuyBackTab />}
        {tab === 'donations' && <DonationTab />}
        {tab === 'exchanges' && <ExchangeTab />}
      </div>
    </div>
  )
}
