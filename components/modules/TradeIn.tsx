// @ts-nocheck
'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import {
  useAfterSalesStore, BuyBack, BuyBackLine, Donation, DonationLine, ClientExchange, ExchangeLine,
  LocationId, LOCATIONS, fmtKes, fmtDate,
} from '@/lib/store'
import { parseReturnSerialTokens } from '@/lib/tradein-serial-intake'
import { Badge, Modal, Field, Input, Select, PanelHeader, SearchPicker, ModuleSkeleton, ModuleHeader, TabBar } from '@/components/ui'
import { CustomerPickerField } from '@/components/tradein/CustomerPickerField'
import { SerialReturnPicker } from '@/components/tradein/SerialReturnPicker'
import { StatusBadge } from '@/components/erp'

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

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()
const fileCell = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function downloadTemplate(filename: string, sheetName: string, headers: string[], exampleRows: unknown[][]) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows])
  ws['!cols'] = headers.map(() => ({ wch: 22 }))
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

function readBulkRows(file: File, onRows: (rows: Record<string, unknown>[]) => void, onError: (message: string) => void) {
  try { guardSpreadsheetFile(file) } catch (err) {
    onError(err instanceof SpreadsheetGuardError ? err.message : 'File too large')
    return
  }
  const reader = new FileReader()
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target!.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      guardSpreadsheetRows(rows)
      onRows(rows)
    } catch (err) {
      onError(err instanceof SpreadsheetGuardError ? err.message : 'Could not parse file — use the provided template')
    }
  }
  reader.readAsArrayBuffer(file)
}

function findProduct(products: ReturnType<typeof useAfterSalesStore>['products'], raw: string) {
  const key = norm(raw)
  return products.find(p => norm(p.name) === key || norm(p.sku) === key)
}

function findContact(contacts: ReturnType<typeof useAfterSalesStore>['contacts'], raw: string) {
  const key = norm(raw)
  return contacts.find(c => norm(c.name) === key || norm((c as any).phone) === key || norm((c as any).email) === key)
}

function findSaleOrder(saleOrders: ReturnType<typeof useAfterSalesStore>['saleOrders'], raw: string) {
  const key = norm(raw)
  return key ? saleOrders.find(s => norm(s.ref) === key || norm(s.orderNumber) === key) : undefined
}

function parseSerialIds(
  raw: string,
  product: any,
  serials: ReturnType<typeof useAfterSalesStore>['serials'],
  qty: number,
  mode: 'customer_return' | 'stock_out',
  location?: LocationId,
  allowIntake = false,
) {
  if (!product) return { serialIds: [] as string[], pendingIntake: [] as string[], errors: [] as string[] }
  return parseReturnSerialTokens({
    raw,
    productId: product.id,
    productName: product.name,
    requiresSerial: !!product.requiresSerial,
    qty,
    serials,
    mode,
    location,
    allowIntake,
  })
}

function resolveIntakeSerials(
  serialIds: string[],
  pendingIntake: string[],
  productId: string,
  register: (productId: string, serialText: string, opts?: { source?: string }) => { id: string } | null,
  source: string,
) {
  const ids = [...serialIds]
  for (const token of pendingIntake) {
    const created = register(productId, token, { source })
    if (!created) return null
    ids.push(created.id)
  }
  return ids
}

function BulkDropzone({ fileRef, onFile }: { fileRef: React.RefObject<HTMLInputElement>, onFile: (file: File) => void }) {
  return (
    <div style={{ border: '2px dashed var(--border)', borderRadius: 10, padding: '20px', textAlign: 'center', marginBottom: 14, cursor: 'pointer', background: '#FAFAFA' }}
      onClick={() => fileRef.current?.click()}
      onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#00B0D7' }}
      onDragLeave={e => { e.currentTarget.style.borderColor = '#D1D5DB' }}
      onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#D1D5DB'; const f = e.dataTransfer.files[0]; if (f) onFile(f) }}>
      <p style={{ fontSize: 13, color: 'var(--text-4)', marginBottom: 4 }}>📂 Click or drag &amp; drop file here</p>
      <p style={{ fontSize: 10, color: 'var(--text-4)' }}>Accepts .xlsx, .xls, .csv</p>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </div>
  )
}

function BulkPreview({ rows, columns }: {
  rows: Array<Record<string, any> & { error?: string }>
  columns: { key: string; label: string; render?: (row: any) => React.ReactNode }[]
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>Preview — {rows.length} row(s)</p>
        <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ {rows.filter(r => !r.error).length} valid</span>
          {rows.some(r => r.error) && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>✕ {rows.filter(r => r.error).length} errors</span>}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ background: 'var(--bg-surface)' }}>
            {[...columns, { key: 'status', label: 'Status' }].map(col => (
              <th key={col.key} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-4)', fontWeight: 600, fontSize: 10, whiteSpace: 'nowrap' }}>{col.label}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--bg-muted)', background: row.error ? '#FFF7F7' : 'transparent' }}>
                {columns.map(col => (
                  <td key={col.key} style={{ padding: '7px 10px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {col.render ? col.render(row) : row[col.key] || <span style={{ color: 'var(--text-4)' }}>—</span>}
                  </td>
                ))}
                <td style={{ padding: '7px 10px' }}>
                  {row.error
                    ? <span title={row.error} style={{ color: 'var(--danger)', fontSize: 10, fontWeight: 700, cursor: 'help' }}>✕ {row.error}</span>
                    : <span style={{ color: 'var(--success)', fontSize: 10, fontWeight: 700 }}>✓ OK</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  return <StatusBadge status={status} label={status.replace(/_/g, ' ')} />
}

function RowGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">{children}</div>
}

// ── Serial picker ─────────────────────────────────────────────────────────────
function SerialPicker({ productId, selectedIds, onAdd, onRemove, mode = 'customer_return', location, allowIntake = false, customerId, saleOrderId, intakeSource }: {
  productId: string
  selectedIds: string[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  mode?: 'customer_return' | 'stock_out'
  location?: LocationId
  allowIntake?: boolean
  customerId?: string
  saleOrderId?: string
  intakeSource?: string
}) {
  return (
    <SerialReturnPicker
      productId={productId}
      selectedIds={selectedIds}
      onAdd={onAdd}
      onRemove={onRemove}
      mode={mode}
      location={location}
      allowIntake={allowIntake}
      customerId={customerId}
      saleOrderId={saleOrderId}
      intakeSource={intakeSource}
    />
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// BUY-BACKS
// ══════════════════════════════════════════════════════════════════════════════

type BBLine = { productId: string; productName: string; qty: number; condition: 'good'|'fair'|'poor'; unitPrice: number; serialIds: string[]; notes: string }
type BuyBackBulkRow = {
  batchRef: string; customerId: string; customerName: string; originalSORef: string
  destination: LocationId; productId: string; productName: string; qty: number
  condition: 'good'|'fair'|'poor'; unitPrice: number; serialIds: string[]; pendingIntake: string[]
  notes: string; lineNotes: string; error?: string
}

const BUYBACK_BULK_HEADERS = ['batch_ref', 'customer_name', 'original_so_ref', 'destination', 'product_name', 'qty', 'condition', 'unit_price', 'serials', 'notes', 'line_notes']
const BUYBACK_BULK_EXAMPLE = [
  ['BBK-BATCH-001', 'Jane Mwangi', 'SO/0087', 'warehouse', 'HP ProBook 450 G9', '1', 'good', '35000', 'SN12345', 'Customer upgrading', 'Clean unit'],
  ['BBK-BATCH-002', 'John Otieno', '', 'shop', 'Logitech Mouse', '5', 'fair', '450', '', 'Bulk accessories', 'Mixed condition'],
]

function downloadBuyBackBulkTemplate() {
  downloadTemplate('buybacks_bulk_template.xlsx', 'BuyBacks', BUYBACK_BULK_HEADERS, BUYBACK_BULK_EXAMPLE)
}

function BuyBackTab() {
  const { buyBacks, createBuyBack, approveBuyBack, payBuyBack, stockBuyBack, deleteBuyBack,
    contacts, products, saleOrders, serials, users, currentUserId, showToast, registerCustomerReturnSerial } = useAfterSalesStore()

  const currentRole = users.find(u => u.id === currentUserId)?.role
  const canApprove = currentRole === 'director' || currentRole === 'finance_officer'

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
  const [showBulk, setShowBulk]       = useState(false)
  const [bulkRows, setBulkRows]       = useState<BuyBackBulkRow[]>([])
  const [bulkImporting, setBulkImporting] = useState(false)
  const bulkFileRef = useRef<HTMLInputElement>(null)

  const originalSO = useMemo(() =>
    originalSORef ? saleOrders.find(s => s.ref.toLowerCase() === originalSORef.toLowerCase()) : undefined,
    [originalSORef, saleOrders])

  function reset() { setCustomerId(''); setCustomerName(''); setOriginalSORef(''); setDestination('warehouse'); setNotes(''); setLines([]) }
  function resetBulk() { setBulkRows([]); if (bulkFileRef.current) bulkFileRef.current.value = '' }

  function addLine() {
    setLines(l => [...l, { productId: '', productName: '', qty: 1, condition: 'good', unitPrice: 0, serialIds: [], notes: '' }])
  }

  function updLine(i: number, patch: Partial<BBLine>) {
    setLines(l => l.map((x, idx) => idx === i ? { ...x, ...patch } : x))
  }

  function submit() {
    if (!customerId) { showToast('Select a customer', 'error'); return }
    if (!lines.length || lines.some(l => !l.productId)) { showToast('Add product lines', 'error'); return }
    for (const line of lines) {
      const product = products.find(p => p.id === line.productId)
      if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); return }
      if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
      if (product.requiresSerial && line.serialIds.length !== line.qty) {
        showToast(`Select ${line.qty} serial number(s) for ${product.name}`, 'error')
        return
      }
    }
    createBuyBack(customerId, customerName, lines, destination, notes || undefined, originalSO?.id, originalSO?.ref)
    setShowNew(false); reset()
  }

  function parseBulkFile(file: File) {
    readBulkRows(file, raw => {
      const parsed = raw.map((row): BuyBackBulkRow => {
        const batchRef = fileCell(row, 'batch_ref', 'Batch Ref', 'batch')
        const customerRaw = fileCell(row, 'customer_name', 'Customer Name', 'customer')
        const originalSORefRaw = fileCell(row, 'original_so_ref', 'Original SO Ref', 'original_so')
        const destinationRaw = norm(fileCell(row, 'destination', 'Destination')) || 'warehouse'
        const productRaw = fileCell(row, 'product_name', 'Product Name', 'product', 'sku')
        const qty = Number(fileCell(row, 'qty', 'Qty', 'quantity')) || 0
        const conditionRaw = norm(fileCell(row, 'condition', 'Condition')) || 'good'
        const unitPrice = Number(fileCell(row, 'unit_price', 'Unit Price', 'we_pay')) || 0
        const serialRaw = fileCell(row, 'serials', 'Serials', 'serial_numbers')
        const notes = fileCell(row, 'notes', 'Notes')
        const lineNotes = fileCell(row, 'line_notes', 'Line Notes')
        const customer = findContact(contacts, customerRaw)
        const product = findProduct(products, productRaw)
        const originalSO = findSaleOrder(saleOrders, originalSORefRaw)
        const destination = (['warehouse', 'shop'] as LocationId[]).includes(destinationRaw as LocationId) ? destinationRaw as LocationId : 'warehouse'
        const condition = (['good', 'fair', 'poor'].includes(conditionRaw) ? conditionRaw : 'good') as 'good'|'fair'|'poor'
        const serialResult = product ? parseSerialIds(serialRaw, product, serials, qty, 'customer_return', undefined, true) : { serialIds: [], pendingIntake: [], errors: [] }
        const errors: string[] = []
        if (!customerRaw) errors.push('customer_name is required')
        if (!customer) errors.push(`customer "${customerRaw}" not found`)
        if (originalSORefRaw && !originalSO) errors.push(`original SO "${originalSORefRaw}" not found`)
        if (!product) errors.push(`product "${productRaw}" not found`)
        if (qty <= 0) errors.push('qty must be > 0')
        if (unitPrice < 0) errors.push('unit_price cannot be negative')
        if (!['good', 'fair', 'poor'].includes(conditionRaw)) errors.push('condition must be good, fair or poor')
        errors.push(...serialResult.errors)
        return {
          batchRef, customerId: customer?.id ?? '', customerName: customer?.name ?? customerRaw,
          originalSORef: originalSO?.ref ?? originalSORefRaw, destination,
          productId: product?.id ?? '', productName: product?.name ?? productRaw,
          qty, condition, unitPrice, serialIds: serialResult.serialIds, pendingIntake: serialResult.pendingIntake,
          notes, lineNotes,
          error: errors.length ? errors.join('; ') : undefined,
        }
      })
      setBulkRows(parsed)
    }, message => showToast(message, 'error'))
  }

  function importBulk() {
    const valid = bulkRows.filter(r => !r.error)
    if (!valid.length) { showToast('No valid buy-back rows to import', 'error'); return }
    setBulkImporting(true)
    const groups = new Map<string, BuyBackBulkRow[]>()
    valid.forEach((row, index) => {
      const key = row.batchRef || `row-${index}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    })
    let count = 0
    try {
      groups.forEach(rows => {
        const first = rows[0]
        const originalSO = findSaleOrder(saleOrders, first.originalSORef)
        const lines = rows.map(row => {
          const serialIds = resolveIntakeSerials(row.serialIds, row.pendingIntake, row.productId, registerCustomerReturnSerial, 'buyback-bulk')
          if (serialIds === null) throw new Error(`Could not register intake serials for ${row.productName}`)
          return { productId: row.productId, productName: row.productName, qty: row.qty, condition: row.condition, unitPrice: row.unitPrice, serialIds, notes: row.lineNotes }
        })
        createBuyBack(
          first.customerId,
          first.customerName,
          lines,
          first.destination,
          first.notes || undefined,
          originalSO?.id,
          first.originalSORef || undefined,
        )
        count++
      })
      setShowBulk(false); resetBulk()
      showToast(`${count} buy-back${count !== 1 ? 's' : ''} imported`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Buy-back import failed', 'error')
    } finally {
      setBulkImporting(false)
    }
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
        <button onClick={() => setDetail(null)} style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back</button>
        <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>{bb.ref}</p>
              <p style={{ fontSize: 12, color: 'var(--text-4)' }}>{bb.customerName} · {fmtDate(bb.date)}</p>
              {bb.originalSORef && <p style={{ fontSize: 11, color: 'var(--text-4)' }}>Original sale: {bb.originalSORef}</p>}
            </div>
            <StatusPill status={bb.status} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {STEPS.map((s, i) => (
              <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: 3, borderRadius: 2, background: i <= si ? 'var(--navy)' : 'var(--border-lt)', marginBottom: 4 }} />
                <span style={{ fontSize: 11, color: i <= si ? 'var(--navy)' : 'var(--text-4)', fontWeight: i === si ? 700 : 400, textTransform: 'capitalize' }}>{s}</span>
              </div>
            ))}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
            <thead><tr style={{ background: 'var(--bg-surface)' }}>
              {['Product', 'Condition', 'Qty', 'Serials', 'Unit Price', 'Total'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-4)', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {bb.lines.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--bg-muted)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{l.productName}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700, background: l.condition === 'good' ? 'var(--success-bg)' : l.condition === 'fair' ? '#FEF9C3' : 'var(--danger-bg)', color: l.condition === 'good' ? 'var(--success-text)' : l.condition === 'fair' ? '#854D0E' : '#991B1B' }}>{l.condition}</span>
                  </td>
                  <td style={{ padding: '8px 10px' }}>{l.qty}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--text-4)' }}>{l.serialIds.length > 0 ? `${l.serialIds.length} serial(s)` : '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{fmtKes(l.unitPrice)}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{fmtKes(l.unitPrice * l.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ textAlign: 'right', marginBottom: 16, fontSize: 14, fontWeight: 700 }}>Total We Pay: {fmtKes(bb.total)}</div>
          {bb.notes && <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 12 }}>Note: {bb.notes}</p>}
          {bb.approvedByName && <p style={{ fontSize: 10, color: 'var(--text-4)' }}>Approved by {bb.approvedByName} on {fmtDate(bb.approvedDate!)}</p>}
          {bb.stockedByName && <p style={{ fontSize: 10, color: 'var(--text-4)' }}>Stocked by {bb.stockedByName} on {fmtDate(bb.stockedDate!)}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {bb.status === 'draft' && canApprove && <button className="btn-primary text-[11px]" onClick={() => approveBuyBack(bb.id)}>✓ Approve</button>}
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
        <input aria-label="Search buy-backs" className="form-input text-[11px] py-1.5" style={{ width: 200 }}
          placeholder="Search ref, customer…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn-secondary text-[11px]" onClick={() => setShowBulk(true)}>📤 Bulk Upload</button>
        <button className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Buy-Back</button>
      </PanelHeader>

      {displayed.length === 0
        ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-4)', fontSize: 12 }}>{search ? 'No results.' : 'No buy-backs yet.'}</div>
        : (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[700px] flex flex-col">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: 'var(--bg-surface)' }}>
              {['Ref', 'Customer', 'Original SO', 'Items', 'Total', 'Date', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-4)', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {displayed.map(bb => (
                <tr key={bb.id} style={{ borderBottom: '1px solid var(--bg-muted)', cursor: 'pointer' }}
                  onClick={() => setDetail(bb)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F0F9FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--navy)' }}>{bb.ref}</td>
                  <td style={{ padding: '10px 12px' }}>{bb.customerName}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-4)' }}>{bb.originalSORef ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{bb.lines.length} item(s)</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{fmtKes(bb.total)}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-4)' }}>{fmtDate(bb.date)}</td>
                  <td style={{ padding: '10px 12px' }}><StatusPill status={bb.status} /></td>
                  <td style={{ padding: '10px 12px', color: 'var(--accent-cyan)' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          </div>
        )}

      {showBulk && (
        <Modal title="Bulk Upload Buy-Backs" subtitle="Upload CSV or Excel rows; use batch_ref to group multiple item rows into one buy-back"
          onClose={() => { setShowBulk(false); resetBulk() }}>
          <div style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: 2 }}>
            <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#0369A1' }}>1. Download the template</p>
                <p style={{ fontSize: 11, color: '#0284C7', marginTop: 2 }}>Required: customer_name, product_name, qty, condition, unit_price</p>
              </div>
              <button className="btn-secondary text-[11px]" onClick={downloadBuyBackBulkTemplate}>⬇ Template</button>
            </div>
            <BulkDropzone fileRef={bulkFileRef} onFile={parseBulkFile} />
            {bulkRows.length > 0 && (
              <BulkPreview rows={bulkRows} columns={[
                { key: 'batchRef', label: 'Batch' },
                { key: 'customerName', label: 'Customer' },
                { key: 'productName', label: 'Product' },
                { key: 'qty', label: 'Qty' },
                { key: 'condition', label: 'Condition' },
                { key: 'unitPrice', label: 'We Pay', render: row => fmtKes(row.unitPrice) },
                { key: 'serialIds', label: 'Serials', render: row => row.serialIds?.length ? `${row.serialIds.length}` : '—' },
              ]} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn-secondary text-[11px]" onClick={() => { setShowBulk(false); resetBulk() }}>Cancel</button>
            {bulkRows.filter(r => !r.error).length > 0 && (
              <button className="btn-primary text-[11px]" onClick={importBulk} disabled={bulkImporting}>
                {bulkImporting ? 'Importing…' : `Import ${bulkRows.filter(r => !r.error).length} Valid Row${bulkRows.filter(r => !r.error).length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </Modal>
      )}

      {showNew && (
        <Modal
          title="New Buy-Back"
          width={720}
          onClose={() => { setShowNew(false); reset() }}
          footer={(
            <>
              <button className="btn-secondary text-xs" onClick={() => { setShowNew(false); reset() }}>Cancel</button>
              <button className="btn-primary text-xs" onClick={submit}>Create Buy-Back</button>
            </>
          )}
        >
          <div>
            <RowGrid>
              <Field label="Customer *">
                <CustomerPickerField
                  customerId={customerId}
                  customerName={customerName}
                  onSelect={(id, name) => { setCustomerId(id); setCustomerName(name) }}
                  onClear={() => { setCustomerId(''); setCustomerName('') }}
                />
              </Field>
              <Field label="Original Sale Ref (optional)">
                <Input value={originalSORef} onChange={setOriginalSORef} placeholder="e.g. SO/0087" />
                {originalSO && <p style={{ fontSize: 10, color: 'var(--success)', marginTop: 2 }}>✓ {originalSO.ref} · {originalSO.customerName}</p>}
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

            <div style={{ borderTop: '1px solid var(--border-lt)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>Items Being Bought Back</p>
                <button className="btn-secondary text-[10px] py-1" onClick={addLine}>+ Add Line</button>
              </div>
              {lines.map((line, i) => (
                <BBLineEditor key={i} line={line} products={products}
                  customerId={customerId}
                  saleOrderId={originalSO?.id}
                  onChange={p => updLine(i, p)}
                  onRemove={() => setLines(l => l.filter((_, idx) => idx !== i))} />
              ))}
              {!lines.length && <p style={{ fontSize: 11, color: 'var(--text-4)', textAlign: 'center', padding: 16 }}>No lines added.</p>}
            </div>

            {lines.length > 0 && (
              <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, marginTop: 8 }}>
                Total: {fmtKes(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0))}
              </div>
            )}
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

function BBLineEditor({ line, onChange, onRemove, products, customerId, saleOrderId }: {
  line: BBLine
  onChange: (patch: Partial<BBLine>) => void
  onRemove: () => void
  products: ReturnType<typeof useAfterSalesStore>['products']
  customerId?: string
  saleOrderId?: string
}) {
  const [showSerials, setShowSerials] = useState(false)
  const prod = products.find(p => p.id === line.productId)
  const productItems = useMemo(() => products.map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    salePrice: p.salePrice,
    requiresSerial: p.requiresSerial,
  })), [products])
  return (
    <div style={{ border: '1px solid var(--border-lt)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,2fr)_minmax(120px,1fr)_80px_minmax(120px,1fr)_40px] gap-2 sm:gap-3 items-end">
        <Field label="Product">
          <SearchPicker
            label=""
            placeholder="Search product or SKU…"
            items={productItems}
            selectedLabel={line.productName || undefined}
            formatSelected={p => p.name}
            onSelect={p => onChange({ productId: p.id, productName: p.name, serialIds: [], unitPrice: line.unitPrice || p.salePrice || 0 })}
            renderItem={p => (
              <div>
                <p className="font-medium text-xs text-t1">{p.name}</p>
                <p className="text-[10px] text-t3">{p.sku || 'No SKU'}{p.requiresSerial ? ' · serialized' : ''}</p>
              </div>
            )}
          />
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
        <button onClick={onRemove} style={{ fontSize: 14, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 4 }}>✕</button>
      </div>
      {prod?.requiresSerial && line.productId && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowSerials(s => !s)} style={{ fontSize: 10, color: 'var(--accent-cyan)', background: 'none', border: 'none', cursor: 'pointer' }}>
            {showSerials ? '▲' : '▼'} Serials ({line.serialIds.length}/{line.qty})
          </button>
          {showSerials && (
            <div style={{ marginTop: 6 }}>
              <SerialPicker productId={line.productId} selectedIds={line.serialIds}
                onAdd={id => onChange({ serialIds: [...line.serialIds, id] })}
                onRemove={id => onChange({ serialIds: line.serialIds.filter(s => s !== id) })}
                mode="customer_return"
                allowIntake
                customerId={customerId}
                saleOrderId={saleOrderId}
                intakeSource="buyback" />
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
  serialIds: string[]
  notes: string
  error?: string
}

const BULK_TEMPLATE_HEADERS = ['type', 'party', 'location', 'product_name', 'qty', 'serials', 'notes']
const BULK_TEMPLATE_EXAMPLE = [
  ['in',  'USAID Kenya',     'warehouse', 'Accessories Bag',    '10', '', 'Grant 2024'],
  ['out', 'St. Mary School', 'warehouse', 'Laptop HP ProBook',   '1',  'SN12345', ''],
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
    products, serials, users, currentUserId, showToast } = useAfterSalesStore()

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
    for (const line of lines) {
      const product = products.find(p => p.id === line.productId)
      if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); return }
      if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
      if (product.requiresSerial && donType === 'in') {
        showToast(`Serialized donation-in for ${product.name} needs serial capture first. Use opening stock/receipt intake for serialized donated devices.`, 'error')
        return
      }
      if (product.requiresSerial && donType === 'out' && line.serialIds.length !== line.qty) {
        showToast(`Select ${line.qty} serial number(s) to donate out for ${product.name}`, 'error')
        return
      }
    }
    createDonation(donType, party, location, lines, notes || undefined)
    setShowNew(false); reset()
  }

  function parseBulkFile(file: File) {
    try { guardSpreadsheetFile(file) } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'File too large', 'error'); return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        guardSpreadsheetRows(raw)

        const parsed: BulkRow[] = raw.map((row, i) => {
          const type = String(row['type'] ?? row['Type'] ?? '').trim().toLowerCase()
          const party = String(row['party'] ?? row['Party'] ?? '').trim()
          const locRaw = String(row['location'] ?? row['Location'] ?? 'warehouse').trim().toLowerCase()
          const productRaw = String(row['product_name'] ?? row['Product Name'] ?? row['product'] ?? '').trim()
          const qty = Number(row['qty'] ?? row['Qty'] ?? row['quantity'] ?? 0)
          const serialRaw = String(row['serials'] ?? row['Serials'] ?? row['serial_numbers'] ?? '').trim()
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
          if (product?.requiresSerial && type === 'in') errors.push('serialized donation-in needs stock intake/opening stock serial capture')
          const serialResult = product ? parseSerialIds(serialRaw, product, serials, qty, 'stock_out', loc) : { serialIds: [], errors: [] }
          if (product?.requiresSerial && type === 'out') errors.push(...serialResult.errors)

          return {
            type: (type === 'out' ? 'out' : 'in') as 'in' | 'out',
            party,
            location: loc,
            productId: product?.id ?? '',
            productName: product?.name ?? productRaw,
            qty,
            serialIds: serialResult.serialIds,
            notes,
            error: errors.length ? errors.join('; ') : undefined,
          }
        })
        setBulkRows(parsed)
      } catch (err) {
        showToast(err instanceof SpreadsheetGuardError ? err.message : 'Could not parse file — use the provided template', 'error')
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
        [{ productId: row.productId, productName: row.productName, qty: row.qty, serialIds: row.serialIds }],
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
        <button onClick={() => setDetail(null)} style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back</button>
        <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>{don.ref}</p>
              <p style={{ fontSize: 12, color: 'var(--text-4)' }}>{don.type === 'in' ? '📥 Donation In' : '📤 Donation Out'} · {don.party} · {fmtDate(don.date)}</p>
            </div>
            <StatusPill status={don.status} />
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
            <thead><tr style={{ background: 'var(--bg-surface)' }}>
              {['Product', 'Qty', 'Serials'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-4)', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {don.lines.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--bg-muted)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{l.productName}</td>
                  <td style={{ padding: '8px 10px' }}>{l.qty}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--text-4)', fontSize: 10 }}>{l.serialIds.length > 0 ? `${l.serialIds.length} serial(s)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {don.notes && <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 12 }}>Note: {don.notes}</p>}
          {don.confirmedByName && <p style={{ fontSize: 10, color: 'var(--text-4)' }}>Confirmed by {don.confirmedByName} on {fmtDate(don.confirmedDate!)}</p>}

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
        <input aria-label="Search donations" className="form-input text-[11px] py-1.5" style={{ width: 180 }}
          placeholder="Search ref, party…" value={donSearch} onChange={e => setDonSearch(e.target.value)} />
        <button className="btn-secondary text-[11px]" onClick={() => setShowBulk(true)}>📤 Bulk Upload</button>
        <button className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Donation</button>
      </PanelHeader>

      {displayedDon.length === 0
        ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-4)', fontSize: 12 }}>{donSearch ? 'No results.' : 'No donations recorded.'}</div>
        : (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[700px] flex flex-col">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: 'var(--bg-surface)' }}>
              {['Ref', 'Type', 'Party', 'Items', 'Location', 'Date', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-4)', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {displayedDon.map(don => (
                <tr key={don.id} style={{ borderBottom: '1px solid var(--bg-muted)', cursor: 'pointer' }}
                  onClick={() => setDetail(don)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F0F9FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--navy)' }}>{don.ref}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700, background: don.type === 'in' ? 'var(--primary-light)' : '#FEF9C3', color: don.type === 'in' ? 'var(--info-text)' : '#854D0E' }}>
                      {don.type === 'in' ? '📥 In' : '📤 Out'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{don.party}</td>
                  <td style={{ padding: '10px 12px' }}>{don.lines.length} item(s)</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-4)' }}>{LOCATIONS[don.location]?.name ?? don.location}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-4)' }}>{fmtDate(don.date)}</td>
                  <td style={{ padding: '10px 12px' }}><StatusPill status={don.status} /></td>
                  <td style={{ padding: '10px 12px', color: 'var(--accent-cyan)' }}>›</td>
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
                <p style={{ fontSize: 11, color: '#0284C7', marginTop: 2 }}>Fill in columns: type, party, location, product_name, qty, serials, notes</p>
              </div>
              <button className="btn-secondary text-[11px]" onClick={downloadBulkTemplate}>⬇ Template</button>
            </div>

            {/* Step 2 — file picker */}
            <div style={{ border: '2px dashed var(--border)', borderRadius: 10, padding: '20px', textAlign: 'center', marginBottom: 14, cursor: 'pointer', background: '#FAFAFA' }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#00B0D7' }}
              onDragLeave={e => { e.currentTarget.style.borderColor = '#D1D5DB' }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#D1D5DB'; const f = e.dataTransfer.files[0]; if (f) parseBulkFile(f) }}>
              <p style={{ fontSize: 13, color: 'var(--text-4)', marginBottom: 4 }}>📂 Click or drag &amp; drop file here</p>
              <p style={{ fontSize: 10, color: 'var(--text-4)' }}>Accepts .xlsx, .xls, .csv</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) parseBulkFile(f) }} />
            </div>

            {/* Step 3 — preview */}
            {bulkRows.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>Preview — {bulkRows.length} row(s)</p>
                  <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ {bulkRows.filter(r => !r.error).length} valid</span>
                    {bulkRows.some(r => r.error) && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>✕ {bulkRows.filter(r => r.error).length} errors</span>}
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-surface)' }}>
                        {['Type', 'Party', 'Location', 'Product', 'Qty', 'Serials', 'Notes', 'Status'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-4)', fontWeight: 600, fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--bg-muted)', background: row.error ? '#FFF7F7' : 'transparent' }}>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700, background: row.type === 'in' ? 'var(--primary-light)' : '#FEF9C3', color: row.type === 'in' ? 'var(--info-text)' : '#854D0E' }}>
                              {row.type === 'in' ? '📥 In' : '📤 Out'}
                            </span>
                          </td>
                          <td style={{ padding: '7px 10px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.party || <span style={{ color: 'var(--text-4)' }}>—</span>}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--text-4)' }}>{LOCATIONS[row.location]?.name ?? row.location}</td>
                          <td style={{ padding: '7px 10px', fontWeight: row.productId ? 600 : 400, color: row.productId ? 'var(--text-1)' : 'var(--danger)' }}>{row.productName || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{row.qty}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--text-4)' }}>{row.serialIds.length ? `${row.serialIds.length}` : '—'}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--text-4)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>
                            {row.error
                              ? <span title={row.error} style={{ color: 'var(--danger)', fontSize: 10, fontWeight: 700, cursor: 'help' }}>✕ {row.error}</span>
                              : <span style={{ color: 'var(--success)', fontSize: 10, fontWeight: 700 }}>✓ OK</span>}
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
                  style={{ fontSize: 11, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', border: 'none', background: donType === t ? 'var(--navy)' : 'var(--bg-muted)', color: donType === t ? '#fff' : 'var(--text-4)', fontWeight: donType === t ? 700 : 400 }}>
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

            <div style={{ borderTop: '1px solid var(--border-lt)', paddingTop: 12, marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700 }}>Items</p>
                <button className="btn-secondary text-[10px] py-1" onClick={() => setLines(l => [...l, { productId: '', productName: '', qty: 1, serialIds: [] }])}>+ Add</button>
              </div>
              {lines.map((line, i) => (
                <DonationLineEditor
                  key={i}
                  line={line}
                  products={products}
                  donationType={donType}
                  location={location}
                  onChange={patch => setLines(l => l.map((x, idx) => idx === i ? { ...x, ...patch } : x))}
                  onRemove={() => setLines(l => l.filter((_, idx) => idx !== i))}
                />
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

function DonationLineEditor({ line, products, donationType, location, onChange, onRemove }: {
  line: DonLine
  products: ReturnType<typeof useAfterSalesStore>['products']
  donationType: 'in' | 'out'
  location: LocationId
  onChange: (patch: Partial<DonLine>) => void
  onRemove: () => void
}) {
  const [showSerials, setShowSerials] = useState(false)
  const product = products.find(p => p.id === line.productId)
  return (
    <div style={{ border: '1px solid var(--border-lt)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, alignItems: 'end' }}>
        <Field label="Product">
          <select value={line.productId} onChange={e => {
            const p = products.find(x => x.id === e.target.value)
            onChange({ productId: e.target.value, productName: p?.name ?? '', serialIds: [] })
          }} className="form-select w-full">
            <option value="">— Select —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Qty">
          <Input type="number" value={String(line.qty)} onChange={v => onChange({ qty: Number(v) })} />
        </Field>
        <button onClick={onRemove} style={{ fontSize: 14, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 4 }}>✕</button>
      </div>
      {product?.requiresSerial && donationType === 'out' && line.productId && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowSerials(s => !s)} style={{ fontSize: 10, color: 'var(--accent-cyan)', background: 'none', border: 'none', cursor: 'pointer' }}>
            {showSerials ? '▲' : '▼'} Select stock serials ({line.serialIds.length}/{line.qty})
          </button>
          {showSerials && (
            <div style={{ marginTop: 6 }}>
              <SerialPicker
                productId={line.productId}
                selectedIds={line.serialIds}
                onAdd={id => onChange({ serialIds: [...line.serialIds, id] })}
                onRemove={id => onChange({ serialIds: line.serialIds.filter(s => s !== id) })}
                mode="stock_out"
                location={location}
              />
            </div>
          )}
        </div>
      )}
      {product?.requiresSerial && donationType === 'in' && (
        <p style={{ fontSize: 10, color: '#B45309', marginTop: 6 }}>
          Serialized donation-in requires serial capture through stock intake/opening stock before confirmation.
        </p>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT EXCHANGES
// ══════════════════════════════════════════════════════════════════════════════

type ELine = { productId: string; productName: string; qty: number; unitPrice: number; serialIds: string[] }
type ExchangeBulkRow = {
  batchRef: string; customerId: string; customerName: string; originalSORef: string
  returnProductId: string; returnProductName: string; returnQty: number; returnUnitPrice: number; returnSerialIds: string[]; returnPendingIntake: string[]
  newProductId: string; newProductName: string; newQty: number; newUnitPrice: number; newSerialIds: string[]
  notes: string; error?: string
}

const EXCHANGE_BULK_HEADERS = ['batch_ref', 'customer_name', 'original_so_ref', 'return_product', 'return_qty', 'return_unit_price', 'return_serials', 'new_product', 'new_qty', 'new_unit_price', 'new_serials', 'notes']
const EXCHANGE_BULK_EXAMPLE = [
  ['EXC-BATCH-001', 'Jane Mwangi', 'SO/0087', 'HP ProBook 450 G8', '1', '30000', 'OLD-SN123', 'HP ProBook 450 G9', '1', '85000', 'NEW-SN456', 'Customer upgrade'],
  ['EXC-BATCH-002', 'John Otieno', '', 'Logitech Mouse', '2', '600', '', 'Logitech Mouse', '2', '900', '', 'Like-for-like exchange'],
]

function downloadExchangeBulkTemplate() {
  downloadTemplate('trade_in_exchanges_bulk_template.xlsx', 'TradeIns', EXCHANGE_BULK_HEADERS, EXCHANGE_BULK_EXAMPLE)
}

function ExchangeTab() {
  const { clientExchanges, createExchange, approveExchange, completeExchange, cancelExchange,
    contacts, products, saleOrders, serials, users, currentUserId, showToast, registerCustomerReturnSerial } = useAfterSalesStore()

  const currentRole = users.find(u => u.id === currentUserId)?.role
  const canApprove = currentRole === 'director' || currentRole === 'finance_officer'

  const [detail, setDetail]   = useState<ClientExchange | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [customerId, setCustomerId]   = useState('')
  const [customerName, setCustomerName] = useState('')
  const [originalSORef, setOriginalSORef] = useState('')
  const [notes, setNotes]     = useState('')
  const [returnLines, setReturnLines] = useState<ELine[]>([])
  const [newLines, setNewLines]       = useState<ELine[]>([])
  const [showBulk, setShowBulk] = useState(false)
  const [bulkRows, setBulkRows] = useState<ExchangeBulkRow[]>([])
  const [bulkImporting, setBulkImporting] = useState(false)
  const bulkFileRef = useRef<HTMLInputElement>(null)

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
  function resetBulk() { setBulkRows([]); if (bulkFileRef.current) bulkFileRef.current.value = '' }

  function submit() {
    if (!customerId) { showToast('Select a customer', 'error'); return }
    if (!returnLines.length || !newLines.length) { showToast('Add both return and new items', 'error'); return }
    if (returnLines.some(l => !l.productId) || newLines.some(l => !l.productId)) { showToast('All lines need a product', 'error'); return }
    for (const line of returnLines) {
      const product = products.find(p => p.id === line.productId)
      if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); return }
      if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
      if (product.requiresSerial && line.serialIds.length !== line.qty) {
        showToast(`Select ${line.qty} returned serial number(s) for ${product.name}`, 'error')
        return
      }
    }
    for (const line of newLines) {
      const product = products.find(p => p.id === line.productId)
      if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); return }
      if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
      if (product.requiresSerial && line.serialIds.length !== line.qty) {
        showToast(`Select ${line.qty} outgoing serial number(s) for ${product.name}`, 'error')
        return
      }
    }
    createExchange(customerId, customerName, returnLines, newLines, notes || undefined, originalSO?.id, originalSO?.ref)
    setShowNew(false); reset()
  }

  function parseBulkFile(file: File) {
    readBulkRows(file, raw => {
      const parsed = raw.map((row): ExchangeBulkRow => {
        const batchRef = fileCell(row, 'batch_ref', 'Batch Ref', 'batch')
        const customerRaw = fileCell(row, 'customer_name', 'Customer Name', 'customer')
        const originalSORefRaw = fileCell(row, 'original_so_ref', 'Original SO Ref', 'original_so')
        const returnProductRaw = fileCell(row, 'return_product', 'Return Product', 'returned_product')
        const returnQty = Number(fileCell(row, 'return_qty', 'Return Qty', 'returned_qty')) || 0
        const returnUnitPrice = Number(fileCell(row, 'return_unit_price', 'Return Unit Price', 'return_price')) || 0
        const returnSerialRaw = fileCell(row, 'return_serials', 'Return Serials', 'returned_serials')
        const newProductRaw = fileCell(row, 'new_product', 'New Product', 'issue_product')
        const newQty = Number(fileCell(row, 'new_qty', 'New Qty', 'issue_qty')) || 0
        const newUnitPrice = Number(fileCell(row, 'new_unit_price', 'New Unit Price', 'new_price')) || 0
        const newSerialRaw = fileCell(row, 'new_serials', 'New Serials', 'issue_serials')
        const notes = fileCell(row, 'notes', 'Notes')
        const customer = findContact(contacts, customerRaw)
        const originalSO = findSaleOrder(saleOrders, originalSORefRaw)
        const returnProduct = findProduct(products, returnProductRaw)
        const newProduct = findProduct(products, newProductRaw)
        const returnSerialResult = returnProduct ? parseSerialIds(returnSerialRaw, returnProduct, serials, returnQty, 'customer_return', undefined, true) : { serialIds: [], pendingIntake: [], errors: [] }
        const newSerialResult = newProduct ? parseSerialIds(newSerialRaw, newProduct, serials, newQty, 'stock_out', 'warehouse') : { serialIds: [], pendingIntake: [], errors: [] }
        const errors: string[] = []
        if (!customerRaw) errors.push('customer_name is required')
        if (!customer) errors.push(`customer "${customerRaw}" not found`)
        if (originalSORefRaw && !originalSO) errors.push(`original SO "${originalSORefRaw}" not found`)
        if (!returnProduct) errors.push(`return_product "${returnProductRaw}" not found`)
        if (!newProduct) errors.push(`new_product "${newProductRaw}" not found`)
        if (returnQty <= 0) errors.push('return_qty must be > 0')
        if (newQty <= 0) errors.push('new_qty must be > 0')
        if (returnUnitPrice < 0 || newUnitPrice < 0) errors.push('unit prices cannot be negative')
        errors.push(...returnSerialResult.errors, ...newSerialResult.errors)
        return {
          batchRef, customerId: customer?.id ?? '', customerName: customer?.name ?? customerRaw,
          originalSORef: originalSO?.ref ?? originalSORefRaw,
          returnProductId: returnProduct?.id ?? '', returnProductName: returnProduct?.name ?? returnProductRaw,
          returnQty, returnUnitPrice, returnSerialIds: returnSerialResult.serialIds, returnPendingIntake: returnSerialResult.pendingIntake,
          newProductId: newProduct?.id ?? '', newProductName: newProduct?.name ?? newProductRaw,
          newQty, newUnitPrice, newSerialIds: newSerialResult.serialIds,
          notes, error: errors.length ? errors.join('; ') : undefined,
        }
      })
      setBulkRows(parsed)
    }, message => showToast(message, 'error'))
  }

  function importBulk() {
    const valid = bulkRows.filter(r => !r.error)
    if (!valid.length) { showToast('No valid trade-in rows to import', 'error'); return }
    setBulkImporting(true)
    const groups = new Map<string, ExchangeBulkRow[]>()
    valid.forEach((row, index) => {
      const key = row.batchRef || `row-${index}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    })
    let count = 0
    try {
      groups.forEach(rows => {
        const first = rows[0]
        const originalSO = findSaleOrder(saleOrders, first.originalSORef)
        const returnLines = rows.map(row => {
          const serialIds = resolveIntakeSerials(row.returnSerialIds, row.returnPendingIntake, row.returnProductId, registerCustomerReturnSerial, 'exchange-bulk')
          if (serialIds === null) throw new Error(`Could not register return serials for ${row.returnProductName}`)
          return { productId: row.returnProductId, productName: row.returnProductName, qty: row.returnQty, unitPrice: row.returnUnitPrice, serialIds }
        })
        createExchange(
          first.customerId,
          first.customerName,
          returnLines,
          rows.map(row => ({ productId: row.newProductId, productName: row.newProductName, qty: row.newQty, unitPrice: row.newUnitPrice, serialIds: row.newSerialIds })),
          first.notes || undefined,
          originalSO?.id,
          first.originalSORef || undefined,
        )
        count++
      })
      setShowBulk(false); resetBulk()
      showToast(`${count} trade-in exchange${count !== 1 ? 's' : ''} imported`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Exchange import failed', 'error')
    } finally {
      setBulkImporting(false)
    }
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
        <button onClick={() => setDetail(null)} style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back</button>
        <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>{exc.ref}</p>
              <p style={{ fontSize: 12, color: 'var(--text-4)' }}>{exc.customerName} · {fmtDate(exc.date)}</p>
              {exc.originalSORef && <p style={{ fontSize: 11, color: 'var(--text-4)' }}>Original SO: {exc.originalSORef}</p>}
            </div>
            <StatusPill status={exc.status} />
          </div>

          {exc.status !== 'cancelled' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {STEPS.map((s, i) => (
                <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: 3, borderRadius: 2, background: i <= si ? 'var(--navy)' : 'var(--border-lt)', marginBottom: 4 }} />
                  <span style={{ fontSize: 11, color: i <= si ? 'var(--navy)' : 'var(--text-4)', fontWeight: i === si ? 700 : 400, textTransform: 'capitalize' }}>{s}</span>
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
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)', marginBottom: 8 }}>📦 New Items for Customer</p>
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

          <div style={{ background: exc.priceDiff > 0 ? '#FEF9C3' : exc.priceDiff < 0 ? 'var(--success-bg)' : 'var(--bg-muted)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
            <span>{exc.priceDiff > 0 ? 'Customer pays additional' : exc.priceDiff < 0 ? 'We owe customer' : 'Even exchange'}</span>
            <span style={{ color: exc.priceDiff > 0 ? '#854D0E' : exc.priceDiff < 0 ? 'var(--success-text)' : 'var(--text-3)' }}>
              {exc.priceDiff !== 0 ? fmtKes(Math.abs(exc.priceDiff)) : '—'}
            </span>
          </div>

          {exc.notes && <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 12 }}>Note: {exc.notes}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            {exc.status === 'draft' && canApprove && <button className="btn-primary text-[11px]" onClick={() => approveExchange(exc.id)}>✓ Approve</button>}
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
        <input aria-label="Search client exchanges" className="form-input text-[11px] py-1.5" style={{ width: 200 }}
          placeholder="Search ref, customer…" value={excSearch} onChange={e => setExcSearch(e.target.value)} />
        <button className="btn-secondary text-[11px]" onClick={() => setShowBulk(true)}>📤 Bulk Upload</button>
        <button className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Exchange</button>
      </PanelHeader>

      {displayedExc.length === 0
        ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-4)', fontSize: 12 }}>{excSearch ? 'No results.' : 'No exchanges yet.'}</div>
        : (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[800px] flex flex-col">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: 'var(--bg-surface)' }}>
              {['Ref', 'Customer', 'Original SO', 'Return Value', 'New Value', 'Diff', 'Date', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-4)', fontWeight: 600, fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {displayedExc.map(exc => (
                <tr key={exc.id} style={{ borderBottom: '1px solid var(--bg-muted)', cursor: 'pointer' }}
                  onClick={() => setDetail(exc)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F0F9FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--navy)' }}>{exc.ref}</td>
                  <td style={{ padding: '10px 12px' }}>{exc.customerName}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-4)' }}>{exc.originalSORef ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{fmtKes(exc.returnTotal)}</td>
                  <td style={{ padding: '10px 12px' }}>{fmtKes(exc.newTotal)}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: exc.priceDiff > 0 ? '#854D0E' : exc.priceDiff < 0 ? 'var(--success-text)' : 'var(--text-3)' }}>
                    {exc.priceDiff > 0 ? `+${fmtKes(exc.priceDiff)}` : exc.priceDiff < 0 ? `-${fmtKes(Math.abs(exc.priceDiff))}` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-4)' }}>{fmtDate(exc.date)}</td>
                  <td style={{ padding: '10px 12px' }}><StatusPill status={exc.status} /></td>
                  <td style={{ padding: '10px 12px', color: 'var(--accent-cyan)' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          </div>
        )}

      {showBulk && (
        <Modal title="Bulk Upload Trade-Ins" subtitle="Upload exchange rows; use batch_ref to group multiple lines into one trade-in"
          onClose={() => { setShowBulk(false); resetBulk() }}>
          <div style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: 2 }}>
            <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#0369A1' }}>1. Download the template</p>
                <p style={{ fontSize: 11, color: '#0284C7', marginTop: 2 }}>Required return_* and new_* columns must be present on each row</p>
              </div>
              <button className="btn-secondary text-[11px]" onClick={downloadExchangeBulkTemplate}>⬇ Template</button>
            </div>
            <BulkDropzone fileRef={bulkFileRef} onFile={parseBulkFile} />
            {bulkRows.length > 0 && (
              <BulkPreview rows={bulkRows} columns={[
                { key: 'batchRef', label: 'Batch' },
                { key: 'customerName', label: 'Customer' },
                { key: 'returnProductName', label: 'Return Product' },
                { key: 'returnQty', label: 'Return Qty' },
                { key: 'newProductName', label: 'New Product' },
                { key: 'newQty', label: 'New Qty' },
                { key: 'diff', label: 'Diff', render: row => fmtKes((row.newQty * row.newUnitPrice) - (row.returnQty * row.returnUnitPrice)) },
              ]} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn-secondary text-[11px]" onClick={() => { setShowBulk(false); resetBulk() }}>Cancel</button>
            {bulkRows.filter(r => !r.error).length > 0 && (
              <button className="btn-primary text-[11px]" onClick={importBulk} disabled={bulkImporting}>
                {bulkImporting ? 'Importing…' : `Import ${bulkRows.filter(r => !r.error).length} Valid Row${bulkRows.filter(r => !r.error).length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </Modal>
      )}

      {showNew && (
        <Modal title="New Client Exchange" onClose={() => { setShowNew(false); reset() }}>
          <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 2 }}>
            <RowGrid>
              <Field label="Customer *">
                <CustomerPickerField
                  customerId={customerId}
                  customerName={customerName}
                  onSelect={(id, name) => { setCustomerId(id); setCustomerName(name) }}
                  onClear={() => { setCustomerId(''); setCustomerName('') }}
                />
              </Field>
              <Field label="Original Sale Ref (optional)">
                <Input value={originalSORef} onChange={setOriginalSORef} placeholder="e.g. SO/0087" />
                {originalSO && <p style={{ fontSize: 10, color: 'var(--success)', marginTop: 2 }}>✓ {originalSO.ref}</p>}
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
                  customerId={customerId}
                  saleOrderId={originalSO?.id}
                  onChange={p => setReturnLines(l => l.map((x, idx) => idx === i ? { ...x, ...p } : x))}
                  onRemove={() => setReturnLines(l => l.filter((_, idx) => idx !== i))}
                  mode="customer_return" />
              ))}
              {!returnLines.length && <p style={{ fontSize: 10, color: 'var(--text-4)' }}>No return lines.</p>}
              {returnLines.length > 0 && <p style={{ fontSize: 11, fontWeight: 700, textAlign: 'right', marginTop: 6 }}>Credit: {fmtKes(returnTotal)}</p>}
            </div>

            <div style={{ border: '1px solid #DCFCE7', borderRadius: 10, padding: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)' }}>📦 New Items for Customer</p>
                <button className="btn-secondary text-[10px] py-1" onClick={() => setNewLines(l => [...l, { productId: '', productName: '', qty: 1, unitPrice: 0, serialIds: [] }])}>+ Add</button>
              </div>
              {newLines.map((line, i) => (
                <ELineEditor key={i} line={line} products={products}
                  onChange={p => setNewLines(l => l.map((x, idx) => idx === i ? { ...x, ...p } : x))}
                  onRemove={() => setNewLines(l => l.filter((_, idx) => idx !== i))}
                  mode="stock_out"
                  location="warehouse" />
              ))}
              {!newLines.length && <p style={{ fontSize: 10, color: 'var(--text-4)' }}>No new lines.</p>}
              {newLines.length > 0 && <p style={{ fontSize: 11, fontWeight: 700, textAlign: 'right', marginTop: 6 }}>Total: {fmtKes(newTotal)}</p>}
            </div>

            {(returnLines.length > 0 || newLines.length > 0) && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: diff > 0 ? '#FEF9C3' : diff < 0 ? 'var(--success-bg)' : 'var(--bg-muted)', borderRadius: 8, fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
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

function ELineEditor({ line, onChange, onRemove, products, mode = 'customer_return', location, customerId, saleOrderId }: {
  line: ELine
  onChange: (patch: Partial<ELine>) => void
  onRemove: () => void
  products: ReturnType<typeof useAfterSalesStore>['products']
  mode?: 'customer_return' | 'stock_out'
  location?: LocationId
  customerId?: string
  saleOrderId?: string
}) {
  const [showSerials, setShowSerials] = useState(false)
  const product = products.find(p => p.id === line.productId)
  const productItems = useMemo(() => products.map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    salePrice: p.salePrice,
    requiresSerial: p.requiresSerial,
  })), [products])
  return (
    <div style={{ border: '1px solid var(--border-lt)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-2 sm:gap-3 items-end">
        <Field label="Product">
          <SearchPicker
            label=""
            placeholder="Search product or SKU…"
            items={productItems}
            selectedLabel={line.productName || undefined}
            formatSelected={p => p.name}
            onSelect={p => onChange({ productId: p.id, productName: p.name, unitPrice: p.salePrice ?? 0, serialIds: [] })}
            renderItem={p => (
              <div>
                <p className="font-medium text-xs text-t1">{p.name}</p>
                <p className="text-[10px] text-t3">{p.sku || 'No SKU'}{p.requiresSerial ? ' · serialized' : ''}</p>
              </div>
            )}
          />
        </Field>
        <Field label="Qty">
          <Input type="number" value={String(line.qty)} onChange={v => onChange({ qty: Number(v) })} />
        </Field>
        <Field label="Price (KSh)">
          <Input type="number" value={String(line.unitPrice)} onChange={v => onChange({ unitPrice: Number(v) })} />
        </Field>
        <button onClick={onRemove} style={{ fontSize: 14, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 4 }}>✕</button>
      </div>
      {product?.requiresSerial && line.productId && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowSerials(s => !s)} style={{ fontSize: 10, color: 'var(--accent-cyan)', background: 'none', border: 'none', cursor: 'pointer' }}>
            {showSerials ? '▲' : '▼'} Serials ({line.serialIds.length}/{line.qty})
          </button>
          {showSerials && (
            <div style={{ marginTop: 6 }}>
              <SerialPicker
                productId={line.productId}
                selectedIds={line.serialIds}
                onAdd={id => onChange({ serialIds: [...line.serialIds, id] })}
                onRemove={id => onChange({ serialIds: line.serialIds.filter(s => s !== id) })}
                mode={mode}
                location={location}
                allowIntake={mode === 'customer_return'}
                customerId={customerId}
                saleOrderId={saleOrderId}
                intakeSource="exchange"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT
// ══════════════════════════════════════════════════════════════════════════════

type TradeTab = 'buybacks' | 'donations' | 'exchanges'

export default function TradeIn() {
  const [mounted, setMounted] = useState(false)
  const { buyBacks, donations, clientExchanges } = useAfterSalesStore()
  const [tab, setTab] = useState<TradeTab>('buybacks')

  useEffect(() => { setMounted(true) }, [])

  if (!mounted) {
    return (
      <ModuleSkeleton />
    )
  }

  const tabs: { id: TradeTab; label: string; count: number }[] = [
    { id: 'buybacks',  label: 'Buy-backs',  count: buyBacks.length },
    { id: 'donations', label: 'Donations',  count: donations.length },
    { id: 'exchanges', label: 'Exchanges',  count: clientExchanges.length },
  ]

  return (
    <div className="mod-page">
      <ModuleHeader
        title="Trade-in"
        subtitle="Buy-backs, donations and exchanges"
        count={buyBacks.length + donations.length + clientExchanges.length}
        color="var(--navy)"
      />
      <TabBar
        tabs={tabs.map(t => ({
          id: t.id,
          label: t.count > 0 ? `${t.label} (${t.count})` : t.label,
        }))}
        active={tab}
        onChange={id => setTab(id as TradeTab)}
        maxVisibleDesktop={6}
        ariaLabel="Trade-in sections"
      />
      <div className="mod-body p-3 sm:p-4">
        {tab === 'buybacks'  && <BuyBackTab />}
        {tab === 'donations' && <DonationTab />}
        {tab === 'exchanges' && <ExchangeTab />}
      </div>
    </div>
  )
}
