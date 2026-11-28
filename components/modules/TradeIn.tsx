'use client'
import Link from 'next/link'
import ReactBarcode from 'react-barcode'
import { Suspense, useState, useMemo, useRef, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { loadXlsx } from '@/lib/xlsx-lazy'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import { useAfterSalesStore, useFinanceStore, BuyBack, Donation, ClientExchange, LocationId, LOCATIONS, fmtKes, fmtDate } from '@/lib/store'
import { parseReturnSerialTokens } from '@/lib/tradein-serial-intake'
import { clearFormDraft, loadFormDraft, saveFormDraft } from '@/lib/form-draft'
import { Modal, Field, Input, Select, PanelHeader, SearchPicker, ModuleSkeleton } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { CustomerPickerField } from '@/components/tradein/CustomerPickerField'
import { SerialReturnPicker } from '@/components/tradein/SerialReturnPicker'
import { StatusBadge } from '@/components/erp'
import { Fa, faBox, faCheck, faCreditCard, faMoneyBillWave, faTrash, faUpload } from '@/components/icons'
import { useUrlQueryState, useUrlRecordId, useUrlUiState } from '@/hooks/useUrlRecordId'
import { userCan } from '@/lib/auth/can'
import { financeInvoicePath } from '@/lib/finance-invoice'
import { ExchangeSwapCard } from '@/components/aftersales/ExchangeSwapCard'
import { downloadExchangeNotePdf, exchangeSettlementText } from '@/components/aftersales/exchange-note-pdf'
import { exchangeDocumentView } from '@/lib/after-sales/exchange-document'

// ── Helpers ───────────────────────────────────────────────────────────────────
const DEST_OPTS = (['warehouse', 'shop'] as LocationId[]).map(k => ({ value: k, label: LOCATIONS[k].name }))

const CONDITION_OPTS = [
  { value: 'good',  label: 'Good — sellable as-is' },
  { value: 'fair',  label: 'Fair — needs minor work' },
  { value: 'poor',  label: 'Poor — needs refurbishment' },
]


const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()
const fileCell = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}

async function downloadTemplate(filename: string, sheetName: string, headers: string[], exampleRows: unknown[][]) {
  const XLSX = await loadXlsx()
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
  reader.onload = async e => {
    try {
      const XLSX = await loadXlsx()
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
      <div className="dt-scroll">
        <table data-no-responsive className="erp-table">
          <thead><tr>
            {[...columns, { key: 'status', label: 'Status' }].map(col => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ background: row.error ? 'var(--danger-bg)' : undefined }}>
                {columns.map(col => (
                  <td key={col.key} style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {col.render ? col.render(row) : row[col.key] || <span style={{ color: 'var(--text-4)' }}>—</span>}
                  </td>
                ))}
                <td>
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

// qty / condition / unitPrice start empty ('') on a new line — the user sets them.
type BBLine = { productId: string; productName: string; qty: number | ''; condition: 'good'|'fair'|'poor'|''; unitPrice: number | ''; serialIds: string[]; notes: string }
type DetailTabProps = {
  detailId: string | null
  onOpenDetail: (id: string | null) => void
  /** Open the new-record form at once (from the combined list's buttons). */
  startNew?: boolean
  onStarted?: () => void
}
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

function BuyBackTab({ detailId, onOpenDetail, startNew, onStarted }: DetailTabProps) {
  const { buyBacks, createBuyBack, approveBuyBack, payBuyBack, creditBuyBack, receiveFreeBuyBack, stockBuyBack, deleteBuyBack,
    contacts, products, saleOrders, serials, users, currentUserId, showToast, registerCustomerReturnSerial } = useAfterSalesStore()
  const { invoices } = useFinanceStore()

  const currentUser = users.find(u => u.id === currentUserId)
  const canApprove = userCan(currentUser, 'sales.buyback.approve')

  const [showNew, setShowNew] = useState(false)
  useEffect(() => { if (startNew) { setShowNew(true); onStarted?.() } }, [startNew]) // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useUrlUiState('buybackQ', '')
  const [buybackPageValue, setBuybackPageValue] = useUrlUiState('buybackPage', '1')
  const buybackPage = Math.max(1, Number.parseInt(buybackPageValue, 10) || 1)
  const setBuybackPage = (page: number) => setBuybackPageValue(String(Math.max(1, page)))
  const [customerId, setCustomerId]   = useState('')
  const [customerName, setCustomerName] = useState('')
  const [originalSORef, setOriginalSORef] = useState('')
  // Bought-back machines always go to With Issues; Inventory tests or refurbishes them from there.
  const [destination, setDestination] = useState<LocationId | ''>('shop')
  const [notes, setNotes]             = useState('')
  const [lines, setLines]             = useState<BBLine[]>([])
  const [payModal, setPayModal]       = useState<string | null>(null)
  const [creditModal, setCreditModal] = useState<string | null>(null)
  const [crediting, setCrediting]     = useState(false)
  const [paying, setPaying]           = useState(false)
  const [showBulk, setShowBulk]       = useState(false)
  const [bulkRows, setBulkRows]       = useState<BuyBackBulkRow[]>([])
  const [bulkImporting, setBulkImporting] = useState(false)
  const bulkFileRef = useRef<HTMLInputElement>(null)

  const originalSO = useMemo(() =>
    originalSORef ? saleOrders.find(s => (s.ref ?? '').toLowerCase() === originalSORef.toLowerCase()) : undefined,
    [originalSORef, saleOrders])

  function reset() { setCustomerId(''); setCustomerName(''); setOriginalSORef(''); setDestination('shop'); setNotes(''); setLines([]); clearFormDraft('buyback', currentUserId ?? '') }
  function resetBulk() { setBulkRows([]); if (bulkFileRef.current) bulkFileRef.current.value = '' }

  // A half-filled buy-back survives leaving the page: its machine's serial is
  // registered the moment it is entered, so losing the form strands it.
  type BuyBackDraft = { customerId: string; customerName: string; originalSORef: string; destination: LocationId | ''; notes: string; lines: BBLine[] }
  const draftRestored = useRef(false)
  useEffect(() => {
    if (draftRestored.current || !currentUserId) return
    draftRestored.current = true
    const d = loadFormDraft<BuyBackDraft>('buyback', currentUserId)
    if (!d || (!d.customerId && !(d.lines ?? []).length)) return
    setCustomerId(d.customerId ?? ''); setCustomerName(d.customerName ?? ''); setOriginalSORef(d.originalSORef ?? '')
    setDestination('shop'); setNotes(d.notes ?? ''); setLines(Array.isArray(d.lines) ? d.lines : [])
    setShowNew(true)
    showToast('Your unfinished buy-back was kept — finish it or cancel it', 'info')
  }, [currentUserId, showToast])
  useEffect(() => {
    if (!showNew || !currentUserId) return
    if (!customerId && !lines.length && !notes) return
    saveFormDraft('buyback', currentUserId, { customerId, customerName, originalSORef, destination, notes, lines } satisfies BuyBackDraft)
  }, [showNew, currentUserId, customerId, customerName, originalSORef, destination, notes, lines])

  function cancelNew() {
    const registered = lines.reduce((n, l) => n + l.serialIds.length, 0)
    if (registered > 0 && !window.confirm(`Discard this buy-back? The ${registered} machine serial(s) you entered stay registered as "with customer" until a trade-in is saved for them.`)) return
    setShowNew(false); reset()
  }

  function addLine() {
    setLines(l => [...l, { productId: '', productName: '', qty: '', condition: '', unitPrice: '', serialIds: [], notes: '' }])
  }

  function updLine(i: number, patch: Partial<BBLine>) {
    setLines(l => l.map((x, idx) => idx === i ? { ...x, ...patch } : x))
  }

  function submit() {
    if (!customerId) { showToast('Select a customer', 'error'); return }
    if (!destination) { showToast('Select the destination location', 'error'); return }
    if (!lines.length || lines.some(l => !l.productId)) { showToast('Add product lines', 'error'); return }
    for (const line of lines) {
      const product = products.find(p => p.id === line.productId)
      if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); return }
      if (!line.condition) { showToast(`Select the condition for ${product.name}`, 'error'); return }
      if (line.qty === '' || !Number.isFinite(line.qty) || line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
      if (line.unitPrice === '' || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) { showToast(`Enter the amount we pay (0 or more) for ${product.name}`, 'error'); return }
      if (product.requiresSerial && line.serialIds.length !== line.qty) {
        showToast(`Select ${line.qty} serial number(s) for ${product.name}`, 'error')
        return
      }
    }
    const readyLines = lines.map(l => ({ ...l, qty: Number(l.qty), unitPrice: Number(l.unitPrice), condition: l.condition as 'good'|'fair'|'poor' }))
    createBuyBack(customerId, customerName, readyLines, destination, notes || undefined, originalSO?.id, originalSO?.ref)
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
        // Whatever the sheet says, buy-backs land in With Issues.
        void destinationRaw
        const destination: LocationId = 'shop'
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
    (bb.originalSORef ?? '').toLowerCase().includes(s) ||
    (bb.repairRef ?? '').toLowerCase().includes(s)
  ) : sorted
  const detail = detailId ? buyBacks.find(bb => bb.id === detailId) ?? null : null

  const buyBackColumns: ColumnDef<BuyBack>[] = [
    { key: 'ref', label: 'Ref', priority: 1, width: '110px', render: bb => <span className="text-xs font-bold text-primary-600">{bb.ref}</span>, accessor: bb => bb.ref },
    { key: 'customer', label: 'Customer', priority: 1, width: '1.4fr', render: bb => <span className="text-xs truncate">{bb.customerName}</span>, accessor: bb => bb.customerName },
    { key: 'so', label: 'Source', priority: 2, width: '120px', render: bb => (
      <span className="text-xs text-[var(--text-3)]">
        {bb.repairRef ? `Repair ${bb.repairRef}` : (bb.originalSORef ?? '—')}
      </span>
    ), accessor: bb => bb.repairRef ?? bb.originalSORef ?? '' },
    { key: 'items', label: 'Items', priority: 3, width: '80px', render: bb => <span className="text-xs text-[var(--text-3)]">{bb.lines.length}</span>, accessor: bb => bb.lines.length },
    { key: 'total', label: 'Total', priority: 1, width: '120px', align: 'right', render: bb => <span className="text-xs font-bold">{fmtKes(bb.total)}</span>, accessor: bb => bb.total },
    { key: 'date', label: 'Date', priority: 2, width: '110px', render: bb => <span className="text-xs text-[var(--text-3)]">{fmtDate(bb.date)}</span>, accessor: bb => bb.date },
    { key: 'status', label: 'Status', priority: 1, width: '140px', render: bb => <StatusPill status={bb.status} />, accessor: bb => bb.status },
  ]

  // Rendered in both the list and detail views: the Pay / Add-as-credit buttons live in detail.
  const settleModals = (
    <>
        {payModal && (
          <Modal title="Send to Finance to pay" onClose={() => { if (!paying) setPayModal(null) }}>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              A bill to the customer (6114 Trade-in Purchases) goes to Finance, who pays it like any other bill: how, from which account, and the reference (M-Pesa code or transfer ref).
              This buy-back is marked paid, and can go into stock, once that bill is paid. It can then no longer be added as store credit.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn-secondary text-[11px]" disabled={paying} onClick={() => setPayModal(null)}>Cancel</button>
              <button className="btn-primary text-[11px]" disabled={paying} onClick={async () => {
                setPaying(true)
                try { await payBuyBack(payModal) } finally { setPaying(false) }
                setPayModal(null)
              }}>{paying ? 'Sending…' : 'Send bill to Finance'}</button>
            </div>
          </Modal>
        )}

        {creditModal && (() => {
          const creditBb = buyBacks.find(b => b.id === creditModal)
          return (
            <Modal title="Add as store credit" onClose={() => { if (!crediting) setCreditModal(null) }}>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                Add <strong>{fmtKes(creditBb?.total ?? 0)}</strong> as store credit for <strong>{creditBb?.customerName}</strong>.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
                No cash leaves the till. They can spend it on a later invoice (and top up any balance). This buy-back cannot also be paid out.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button className="btn-secondary text-[11px]" disabled={crediting} onClick={() => setCreditModal(null)}>Cancel</button>
                <button
                  className="btn-primary text-[11px]"
                  disabled={crediting}
                  onClick={async () => {
                    setCrediting(true)
                    try {
                      await creditBuyBack(creditModal)
                      setCreditModal(null)
                    } finally {
                      setCrediting(false)
                    }
                  }}
                >
                  {crediting ? 'Adding…' : 'Add as credit'}
                </button>
              </div>
            </Modal>
          )
        })()}
    </>
  )

  if (detail) {
    const bb = detail
    // The bill sent to Finance for this buy-back, while it is still to be paid.
    const liveBill = bb.billId ? (invoices ?? []).find(i => i.id === bb.billId && i.status !== 'cancelled') : undefined
    const STEPS = ['draft', 'approved', 'paid', 'stocked']
    const si = STEPS.indexOf(bb.status)
    const when = (d?: string) => (d ? fmtDate(d) : '')
    const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', mpesa: 'M-Pesa', store_credit: 'Store credit' }
    const settled = bb.paymentMethod === 'store_credit'
      ? `Store credit ${bb.creditRef ?? ''}`.trim()
      : bb.paymentMethod
        ? `${METHOD[bb.paymentMethod] ?? bb.paymentMethod}${bb.billRef ? ` (bill ${bb.billRef})` : ''}`
        : liveBill ? `Bill ${liveBill.ref} — with Finance` : '—'
    const steps = [
      { key: 'draft', label: 'Valued', sub: when(bb.date) },
      { key: 'approved', label: 'Approved', sub: [when(bb.approvedDate), bb.approvedByName].filter(Boolean).join(' · ') },
      { key: 'paid', label: bb.paymentMethod === 'store_credit' ? 'Credited' : 'Paid', sub: [when(bb.paidDate), bb.paymentReference].filter(Boolean).join(' · ') },
      { key: 'stocked', label: 'Stocked', sub: [when(bb.stockedDate), bb.stockedByName].filter(Boolean).join(' · ') },
    ]
    const next = bb.status === 'draft'
      ? { title: 'Review the valuation', sub: canApprove ? 'Approve it, or cancel it' : 'Waiting for approval' }
      : bb.status === 'approved' && !(bb.total > 0)
        ? { title: 'Receive it at no cost', sub: 'Nothing to pay' }
        : bb.status === 'approved' && liveBill
          ? { title: `Finance pays bill ${liveBill.ref}`, sub: liveBill.amountPaid > 0 ? `${fmtKes(liveBill.amountPaid)} of ${fmtKes(liveBill.total)} paid so far` : 'The buy-back is settled once the bill is paid' }
          : bb.status === 'approved'
            ? { title: `Pay the customer ${fmtKes(bb.total)}`, sub: 'Or add it to their store credit' }
            : bb.status === 'paid'
              ? { title: 'Put it in stock', sub: `Goes to ${LOCATIONS[bb.destinationLocation]?.name ?? 'stock'} for testing` }
              : null
    const history = [
      bb.stockedDate && `${when(bb.stockedDate)} · Stocked${bb.stockedByName ? ` by ${bb.stockedByName}` : ''}`,
      bb.paidDate && (bb.paymentMethod === 'store_credit'
        ? `${when(bb.paidDate)} · ${fmtKes(bb.total)} added to store credit ${bb.creditRef ?? ''}`
        : `${when(bb.paidDate)} · Paid ${fmtKes(bb.total)}${bb.paymentMethod ? ` by ${METHOD[bb.paymentMethod] ?? bb.paymentMethod}` : ''}${bb.paymentReference ? ` ${bb.paymentReference}` : ''}${bb.billRef ? ` · bill ${bb.billRef}` : ''}`),
      bb.approvedDate && `${when(bb.approvedDate)} · Approved${bb.approvedByName ? ` by ${bb.approvedByName}` : ''}`,
      `${when(bb.date)} · Valued and recorded`,
    ].filter(Boolean) as string[]
    return (
      <div className="trd">
        <div className="trd-head">
          <div className="min-w-0">
            <button type="button" className="trd-back" onClick={() => onOpenDetail(null)}>‹ Trade-ins</button>
            <h2>{bb.ref} <span className="tri-kind tri-kind--buybacks">Buy-back</span></h2>
            <p>{[bb.customerName, fmtDate(bb.date), bb.repairRef ? `from repair ${bb.repairRef}` : '', bb.originalSORef ? `original sale ${bb.originalSORef}` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <StatusPill status={bb.status} />
        </div>
        <ol className="trd-steps">
          {steps.map((st, idx) => (
            <li key={st.key} className={idx < si ? 'is-done' : idx === si ? (bb.status === 'stocked' ? 'is-done' : 'is-now') : ''}>
              <b>{st.label}</b><span>{idx <= si ? st.sub || '—' : 'waiting'}</span>
            </li>
          ))}
        </ol>
        <div className="trd-cols">
          <div>
            <p className="trd-sec">Machines bought</p>
            {bb.lines.map(l => (
              <div key={l.id} className="trd-machine">
                <div className="min-w-0">
                  <b>{l.productName}{l.qty > 1 ? ` ×${l.qty}` : ''}</b>
                  <small>Condition <span className={`trd-cond trd-cond--${l.condition}`}>{l.condition}</span>{l.notes ? ` · ${l.notes}` : ''}</small>
                </div>
                <div className="trd-code">
                  {l.serialIds.length === 1 && (() => {
                    const sn = serials.find(x => x.id === l.serialIds[0])?.serial
                    return sn ? <ReactBarcode value={sn} width={1} height={22} displayValue={false} margin={0} background="transparent" /> : null
                  })()}
                  {l.serialIds.slice(0, 3).map(id => {
                    const sn = serials.find(x => x.id === id)?.serial ?? id
                    return <span key={id}>{sn}</span>
                  })}
                  {l.serialIds.length > 3 && <span>+{l.serialIds.length - 3} more</span>}
                </div>
                <span className="trd-amt">{fmtKes(l.unitPrice * l.qty)}</span>
              </div>
            ))}
            {bb.notes && <p className="trd-note">Note: {bb.notes}</p>}
            <p className="trd-sec">History</p>
            <ul className="trd-history">{history.map(h => <li key={h}>{h}</li>)}</ul>
          </div>
          <div>
            <p className="trd-sec">Money</p>
            <dl className="trd-money">
              <dt>Valuation</dt><dd>{fmtKes(bb.total)}</dd>
              <dt>Settled as</dt><dd>{settled}</dd>
              <dt className="is-total">{bb.status === 'paid' || bb.status === 'stocked' ? (bb.paymentMethod === 'store_credit' ? 'Credited to customer' : 'Paid to customer') : 'We pay'}</dt>
              <dd className="is-total">{fmtKes(bb.total)}</dd>
            </dl>
            {bb.paymentMethod === 'store_credit' && bb.creditRef && (
              <p className="trd-note">Store credit {bb.creditRef} — apply it on the customer&apos;s next invoice.</p>
            )}
            <div className="trd-next">
              {next ? <div><span>Next</span><b>{next.title}</b><small>{next.sub}</small></div> : <div><span>Done</span><b>Bought and in stock</b></div>}
              <div className="trd-actions">
            {bb.status === 'draft' && canApprove && (
              <button type="button" className="btn-primary text-[11px] flex items-center gap-1.5" onClick={() => approveBuyBack(bb.id)}>
                <Fa icon={faCheck} aria-hidden="true" /> Approve
              </button>
            )}
            {/* Given for free (KSh 0): nothing to pay or credit. */}
            {bb.status === 'approved' && !(bb.total > 0) && (
              <button type="button" className="btn-primary text-[11px] flex items-center gap-1.5" onClick={() => receiveFreeBuyBack(bb.id)}>
                <Fa icon={faCheck} aria-hidden="true" /> Receive at no cost
              </button>
            )}
            {bb.status === 'approved' && bb.total > 0 && !liveBill && (
              <button type="button" className="btn-primary text-[11px] flex items-center gap-1.5" onClick={() => setPayModal(bb.id)}>
                <Fa icon={faMoneyBillWave} aria-hidden="true" /> Pay
              </button>
            )}
            {bb.status === 'approved' && liveBill && (
              <Link href={financeInvoicePath(liveBill.id)} className="btn-secondary text-[11px] flex items-center gap-1.5">
                <Fa icon={faMoneyBillWave} aria-hidden="true" /> Open bill {liveBill.ref}
              </Link>
            )}
            {/* Same approved state: Add as credit instead of Pay. Choosing one settles the BBK. */}
            {bb.status === 'approved' && bb.total > 0 && !liveBill && (
              <button type="button" className="btn-secondary text-[11px] flex items-center gap-1.5" onClick={() => setCreditModal(bb.id)}>
                <Fa icon={faCreditCard} aria-hidden="true" /> Add as credit
              </button>
            )}
            {bb.status === 'paid' && (
              <button type="button" className="btn-primary text-[11px] flex items-center gap-1.5" onClick={() => stockBuyBack(bb.id)}>
                <Fa icon={faBox} aria-hidden="true" /> Add to Stock
              </button>
            )}
            {/* Cancel before anything is paid or credited. One made from a repair
                frees the repair to be converted again (e.g. to a donation). */}
            {(bb.status === 'draft' || (bb.status === 'approved' && !liveBill && !bb.creditId)) && (
              <button
                type="button"
                className="btn-secondary text-[11px] flex items-center gap-1.5"
                onClick={() => {
                  if (typeof window !== 'undefined' && !window.confirm(`Cancel ${bb.ref}?${bb.repairRef ? ` Repair ${bb.repairRef} can then be converted again.` : ''}`)) return
                  deleteBuyBack(bb.id); onOpenDetail(null)
                }}
              >
                <Fa icon={faTrash} aria-hidden="true" /> Cancel buy-back
              </button>
            )}
              </div>
            </div>
          </div>
        </div>
        {settleModals}
      </div>
    )
  }

  return (
    <div>
      <PanelHeader title="Buy-Backs" count={sorted.length}>
        <button type="button" className="btn-secondary text-[11px] flex items-center gap-1.5" onClick={() => setShowBulk(true)}>
          <Fa icon={faUpload} aria-hidden="true" /> Bulk Upload
        </button>
        <button type="button" className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Buy-Back</button>
      </PanelHeader>

      <DataTable
        tableId="tradein-buybacks"
        columns={buyBackColumns}
        rows={displayed}
        rowKey={bb => bb.id}
        searchValue={search}
        onSearchChange={setSearch}
        clientSearch={false}
        page={buybackPage}
        onPageChange={setBuybackPage}
        searchPlaceholder="Search ref, customer, repair…"
        emptyMessage={search ? 'No results.' : 'No buy-backs yet.'}
        onRowClick={bb => onOpenDetail(bb.id)}
        rowLabel={bb => bb.ref}
      />

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
          onClose={cancelNew}
          footer={(
            <>
              <button className="btn-secondary text-xs" onClick={cancelNew}>Cancel</button>
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
              <Field label="Goes to">
                <p className="text-[12px] text-t2 py-2">With Issues — tested or sent to Refurbishment from there</p>
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
                Total: {fmtKes(lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0), 0))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {settleModals}
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
            onSelect={p => onChange({ productId: p.id, productName: p.name, serialIds: [], unitPrice: line.unitPrice !== '' ? line.unitPrice : (p.salePrice || '') })}
            renderItem={p => (
              <div>
                <p className="font-medium text-xs text-t1">{p.name}</p>
                <p className="text-[10px] text-t3">{p.sku || 'No SKU'}{p.requiresSerial ? ' · serialized' : ''}</p>
              </div>
            )}
          />
        </Field>
        <Field label="Condition *">
          <Select value={line.condition} onChange={v => onChange({ condition: v as BBLine['condition'] })} options={[{ value: '', label: 'Select…' }, ...CONDITION_OPTS.map(c => ({ value: c.value, label: c.value }))]} />
        </Field>
        <Field label="Qty *">
          <Input type="number" value={String(line.qty)} onChange={v => onChange({ qty: v === '' ? '' : Number(v) })} />
        </Field>
        <Field label="We Pay (KSh) *">
          <Input type="number" value={String(line.unitPrice)} onChange={v => onChange({ unitPrice: v === '' ? '' : Number(v) })} />
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

type DonLine = { productId: string; productName: string; qty: number | ''; serialIds: string[] }

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

async function downloadBulkTemplate() {
  const XLSX = await loadXlsx()
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([BULK_TEMPLATE_HEADERS, ...BULK_TEMPLATE_EXAMPLE])
  ws['!cols'] = BULK_TEMPLATE_HEADERS.map(() => ({ wch: 22 }))
  XLSX.utils.book_append_sheet(wb, ws, 'Donations')
  XLSX.writeFile(wb, 'donations_bulk_template.xlsx')
}

function DonationTab({ detailId, onOpenDetail, startNew, onStarted }: DetailTabProps) {
  const { donations, createDonation, confirmDonation, deleteDonation,
    products, serials, showToast } = useAfterSalesStore()

  const [showNew, setShowNew] = useState(false)
  useEffect(() => { if (startNew) { setShowNew(true); onStarted?.() } }, [startNew]) // eslint-disable-line react-hooks/exhaustive-deps
  const [showBulk, setShowBulk] = useState(false)
  const [donType, setDonType] = useState<'in' | 'out' | ''>('')
  const [party, setParty]     = useState('')
  const [location, setLocation] = useState<LocationId | ''>('')
  const [notes, setNotes]     = useState('')
  const [lines, setLines]     = useState<DonLine[]>([])

  // Bulk upload state
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([])
  const [bulkImporting, setBulkImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const sorted = [...donations].sort((a, b) => b.date.localeCompare(a.date))
  const [donSearch, setDonSearch] = useUrlUiState('donationQ', '')
  const [donPageValue, setDonPageValue] = useUrlUiState('donationPage', '1')
  const donPage = Math.max(1, Number.parseInt(donPageValue, 10) || 1)
  const setDonPage = (page: number) => setDonPageValue(String(Math.max(1, page)))
  const ds = donSearch.toLowerCase()
  const displayedDon = ds ? sorted.filter(d =>
    d.ref.toLowerCase().includes(ds) ||
    d.party.toLowerCase().includes(ds) ||
    (d.notes ?? '').toLowerCase().includes(ds)
  ) : sorted
  const detail = detailId ? donations.find(d => d.id === detailId) ?? null : null

  const donationColumns: ColumnDef<Donation>[] = [
    { key: 'ref', label: 'Ref', priority: 1, width: '110px', render: don => <span className="text-xs font-bold text-primary-600">{don.ref}</span>, accessor: don => don.ref },
    { key: 'type', label: 'Type', priority: 1, width: '80px', render: don => (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: don.type === 'in' ? 'var(--primary-light)' : '#FEF9C3', color: don.type === 'in' ? 'var(--info-text)' : '#854D0E' }}>
        {don.type === 'in' ? 'In' : 'Out'}
      </span>
    ), accessor: don => don.type },
    { key: 'party', label: 'Party', priority: 1, width: '1.4fr', render: don => <span className="text-xs truncate">{don.party}</span>, accessor: don => don.party },
    { key: 'items', label: 'Items', priority: 3, width: '80px', render: don => <span className="text-xs text-[var(--text-3)]">{don.lines.length}</span>, accessor: don => don.lines.length },
    { key: 'location', label: 'Location', priority: 2, width: '120px', render: don => <span className="text-xs text-[var(--text-3)]">{LOCATIONS[don.location]?.name ?? don.location}</span>, accessor: don => don.location },
    { key: 'date', label: 'Date', priority: 2, width: '110px', render: don => <span className="text-xs text-[var(--text-3)]">{fmtDate(don.date)}</span>, accessor: don => don.date },
    { key: 'status', label: 'Status', priority: 1, width: '140px', render: don => <StatusPill status={don.status} />, accessor: don => don.status },
  ]

  function reset() { setDonType(''); setParty(''); setLocation(''); setNotes(''); setLines([]) }
  function resetBulk() { setBulkRows([]); if (fileRef.current) fileRef.current.value = '' }

  function submit() {
    if (!donType) { showToast('Select the donation type (In or Out)', 'error'); return }
    if (!party) { showToast('Enter donor / recipient name', 'error'); return }
    if (!location) { showToast(donType === 'in' ? 'Select where to receive the donation into' : 'Select where to take the donation from', 'error'); return }
    if (!lines.length || lines.some(l => !l.productId)) { showToast('Add valid product lines', 'error'); return }
    for (const line of lines) {
      const product = products.find(p => p.id === line.productId)
      if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); return }
      if (line.qty === '' || !Number.isFinite(line.qty) || line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
      if (product.requiresSerial && donType === 'in' && line.serialIds.length !== line.qty) {
        showToast(`Select or register ${line.qty} serial number(s) for donation-in of ${product.name}`, 'error')
        return
      }
      if (product.requiresSerial && donType === 'out' && line.serialIds.length !== line.qty) {
        showToast(`Select ${line.qty} serial number(s) to donate out for ${product.name}`, 'error')
        return
      }
    }
    createDonation(donType, party, location, lines.map(l => ({ ...l, qty: Number(l.qty) })), notes || undefined)
    setShowNew(false); reset()
  }

  function parseBulkFile(file: File) {
    try { guardSpreadsheetFile(file) } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'File too large', 'error'); return
    }
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const XLSX = await loadXlsx()
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
          const serialMode = type === 'in' ? 'customer_return' as const : 'stock_out' as const
          const serialResult = product
            ? parseSerialIds(serialRaw, product, serials, qty, serialMode, loc)
            : { serialIds: [] as string[], errors: [] as string[] }
          if (product?.requiresSerial) errors.push(...serialResult.errors)

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
    const don = detail
    return (
      <div>
        <button onClick={() => onOpenDetail(null)} style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back</button>
        <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>{don.ref}</p>
              <p style={{ fontSize: 12, color: 'var(--text-4)' }}>{don.type === 'in' ? 'Donation In' : 'Donation Out'} · {don.party} · {fmtDate(don.date)}</p>
            </div>
            <StatusPill status={don.status} />
          </div>

          <div className="dt-scroll" style={{ marginBottom: 16 }}>
          <table data-no-responsive className="erp-table">
            <thead><tr>
              {['Product', 'Qty', 'Serials'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {don.lines.map(l => (
                <tr key={l.id} >
                  <td style={{ fontWeight: 600 }}>{l.productName}</td>
                  <td>{l.qty}</td>
                  <td style={{ color: 'var(--text-4)', fontSize: 10 }}>{l.serialIds.length > 0 ? `${l.serialIds.length} serial(s)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {don.notes && <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 12 }}>Note: {don.notes}</p>}
          {don.confirmedByName && <p style={{ fontSize: 10, color: 'var(--text-4)' }}>Confirmed by {don.confirmedByName} on {fmtDate(don.confirmedDate!)}</p>}

          {don.status === 'draft' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-primary text-[11px]" onClick={() => confirmDonation(don.id)}>
                {don.type === 'in' ? 'Receive into Stock' : 'Confirm Donation Out'}
              </button>
              <button type="button" className="btn-secondary text-[11px] flex items-center gap-1.5" onClick={() => { deleteDonation(don.id); onOpenDetail(null) }}><Fa icon={faTrash} aria-hidden="true" /> Delete</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PanelHeader title="Donations" count={sorted.length}>
        <button type="button" className="btn-secondary text-[11px] flex items-center gap-1.5" onClick={() => setShowBulk(true)}><Fa icon={faUpload} aria-hidden="true" /> Bulk Upload</button>
        <button className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Donation</button>
      </PanelHeader>

      <DataTable
        tableId="tradein-donations"
        columns={donationColumns}
        rows={displayedDon}
        rowKey={don => don.id}
        searchValue={donSearch}
        onSearchChange={setDonSearch}
        clientSearch={false}
        page={donPage}
        onPageChange={setDonPage}
        searchPlaceholder="Search ref, party…"
        emptyMessage={donSearch ? 'No results.' : 'No donations recorded.'}
        onRowClick={don => onOpenDetail(don.id)}
        rowLabel={don => don.ref}
      />

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
                <div className="dt-scroll">
                  <table data-no-responsive className="erp-table">
                    <thead>
                      <tr>
                        {['Type', 'Party', 'Location', 'Product', 'Qty', 'Serials', 'Notes', 'Status'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, i) => (
                        <tr key={i} style={{ background: row.error ? 'var(--danger-bg)' : undefined }}>
                          <td>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700, background: row.type === 'in' ? 'var(--primary-light)' : '#FEF9C3', color: row.type === 'in' ? 'var(--info-text)' : '#854D0E' }}>
                              {row.type === 'in' ? 'In' : 'Out'}
                            </span>
                          </td>
                          <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.party || <span style={{ color: 'var(--text-4)' }}>—</span>}</td>
                          <td style={{ color: 'var(--text-4)' }}>{LOCATIONS[row.location]?.name ?? row.location}</td>
                          <td style={{ fontWeight: row.productId ? 600 : 400, color: row.productId ? 'var(--text-1)' : 'var(--danger)' }}>{row.productName || '—'}</td>
                          <td>{row.qty}</td>
                          <td style={{ color: 'var(--text-4)' }}>{row.serialIds.length ? `${row.serialIds.length}` : '—'}</td>
                          <td style={{ color: 'var(--text-4)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '—'}</td>
                          <td>
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
                  {t === 'in' ? 'Donation In (we receive)' : 'Donation Out (we give)'}
                </button>
              ))}
            </div>
            <RowGrid>
              <Field label={donType === 'in' ? 'Donor Name *' : donType === 'out' ? 'Recipient / Beneficiary *' : 'Donor / Recipient Name *'}>
                <Input value={party} onChange={setParty} placeholder={donType === 'in' ? 'e.g. USAID Kenya' : donType === 'out' ? 'e.g. St. Mary School' : ''} />
              </Field>
              <Field label={donType === 'in' ? 'Receive Into *' : donType === 'out' ? 'Take From *' : 'Location *'}>
                <Select value={location} onChange={v => setLocation(v as LocationId | '')} options={[{ value: '', label: 'Select…' }, ...DEST_OPTS]} />
              </Field>
            </RowGrid>
            <Field label="Notes">
              <Input value={notes} onChange={setNotes} placeholder="Optional notes" />
            </Field>

            <div style={{ borderTop: '1px solid var(--border-lt)', paddingTop: 12, marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700 }}>Items</p>
                <button className="btn-secondary text-[10px] py-1" onClick={() => setLines(l => [...l, { productId: '', productName: '', qty: '', serialIds: [] }])}>+ Add</button>
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
  donationType: 'in' | 'out' | ''
  location: LocationId | ''
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
        <Field label="Qty *">
          <Input type="number" value={String(line.qty)} onChange={v => onChange({ qty: v === '' ? '' : Number(v) })} />
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
                location={location || undefined}
              />
            </div>
          )}
        </div>
      )}
      {product?.requiresSerial && donationType === 'in' && line.productId && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowSerials(s => !s)} style={{ fontSize: 10, color: 'var(--accent-cyan)', background: 'none', border: 'none', cursor: 'pointer' }}>
            {showSerials ? '▲' : '▼'} Select / register return serials ({line.serialIds.length}/{line.qty})
          </button>
          {showSerials && (
            <div style={{ marginTop: 6 }}>
              <SerialPicker
                productId={line.productId}
                selectedIds={line.serialIds}
                onAdd={id => onChange({ serialIds: [...line.serialIds, id] })}
                onRemove={id => onChange({ serialIds: line.serialIds.filter(s => s !== id) })}
                mode="customer_return"
                allowIntake
                intakeSource="donation-in"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT EXCHANGES
// ══════════════════════════════════════════════════════════════════════════════

type ELine = { productId: string; productName: string; qty: number | ''; unitPrice: number | ''; serialIds: string[] }
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

function ExchangeTab({ detailId, onOpenDetail, startNew, onStarted }: DetailTabProps) {
  const { clientExchanges, createExchange, approveExchange, completeExchange, cancelExchange,
    contacts, products, saleOrders, serials, users, currentUserId, showToast, registerCustomerReturnSerial, warranties } = useAfterSalesStore()
  const { companySettings, bankAccounts, invoices } = useFinanceStore()

  const currentUser = users.find(u => u.id === currentUserId)
  const canApprove = userCan(currentUser, 'sales.buyback.approve')

  const [showNew, setShowNew] = useState(false)
  useEffect(() => { if (startNew) { setShowNew(true); onStarted?.() } }, [startNew]) // eslint-disable-line react-hooks/exhaustive-deps
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
    originalSORef ? saleOrders.find(s => (s.ref ?? '').toLowerCase() === originalSORef.toLowerCase()) : undefined,
    [originalSORef, saleOrders])

  const sorted = [...clientExchanges].sort((a, b) => b.date.localeCompare(a.date))
  const [excSearch, setExcSearch] = useUrlUiState('exchangeQ', '')
  const [excPageValue, setExcPageValue] = useUrlUiState('exchangePage', '1')
  const excPage = Math.max(1, Number.parseInt(excPageValue, 10) || 1)
  const setExcPage = (page: number) => setExcPageValue(String(Math.max(1, page)))
  const es = excSearch.toLowerCase()
  const displayedExc = es ? sorted.filter(e =>
    e.ref.toLowerCase().includes(es) ||
    e.customerName.toLowerCase().includes(es) ||
    (e.originalSORef ?? '').toLowerCase().includes(es)
  ) : sorted
  const detail = detailId ? clientExchanges.find(e => e.id === detailId) ?? null : null

  const exchangeColumns: ColumnDef<ClientExchange>[] = [
    { key: 'ref', label: 'Ref', priority: 1, width: '110px', render: exc => <span className="text-xs font-bold text-primary-600">{exc.ref}</span>, accessor: exc => exc.ref },
    { key: 'customer', label: 'Customer', priority: 1, width: '1.3fr', render: exc => <span className="text-xs truncate">{exc.customerName}</span>, accessor: exc => exc.customerName },
    { key: 'so', label: 'Original SO', priority: 2, width: '110px', render: exc => <span className="text-xs text-[var(--text-3)]">{exc.originalSORef ?? '—'}</span>, accessor: exc => exc.originalSORef ?? '' },
    { key: 'returnTotal', label: 'Return Value', priority: 2, width: '110px', align: 'right', render: exc => <span className="text-xs">{fmtKes(exc.returnTotal)}</span>, accessor: exc => exc.returnTotal },
    { key: 'newTotal', label: 'New Value', priority: 2, width: '110px', align: 'right', render: exc => <span className="text-xs">{fmtKes(exc.newTotal)}</span>, accessor: exc => exc.newTotal },
    { key: 'diff', label: 'Diff', priority: 1, width: '110px', align: 'right', render: exc => (
      <span className="text-xs font-bold" style={{ color: exc.priceDiff > 0 ? '#854D0E' : exc.priceDiff < 0 ? 'var(--success-text)' : 'var(--text-3)' }}>
        {exc.priceDiff > 0 ? `+${fmtKes(exc.priceDiff)}` : exc.priceDiff < 0 ? `-${fmtKes(Math.abs(exc.priceDiff))}` : '—'}
      </span>
    ), accessor: exc => exc.priceDiff },
    { key: 'date', label: 'Date', priority: 3, width: '110px', render: exc => <span className="text-xs text-[var(--text-3)]">{fmtDate(exc.date)}</span>, accessor: exc => exc.date },
    { key: 'status', label: 'Status', priority: 1, width: '140px', render: exc => <StatusPill status={exc.status} />, accessor: exc => exc.status },
  ]


  function reset() { setCustomerId(''); setCustomerName(''); setOriginalSORef(''); setNotes(''); setReturnLines([]); setNewLines([]); clearFormDraft('exchange', currentUserId ?? '') }

  // A half-filled exchange survives leaving the page (its returned machine's
  // serial is registered the moment it is entered).
  type ExchangeDraft = { customerId: string; customerName: string; originalSORef: string; notes: string; returnLines: ELine[]; newLines: ELine[] }
  const draftRestored = useRef(false)
  useEffect(() => {
    if (draftRestored.current || !currentUserId) return
    draftRestored.current = true
    const d = loadFormDraft<ExchangeDraft>('exchange', currentUserId)
    if (!d || (!d.customerId && !(d.returnLines ?? []).length && !(d.newLines ?? []).length)) return
    setCustomerId(d.customerId ?? ''); setCustomerName(d.customerName ?? ''); setOriginalSORef(d.originalSORef ?? ''); setNotes(d.notes ?? '')
    setReturnLines(Array.isArray(d.returnLines) ? d.returnLines : []); setNewLines(Array.isArray(d.newLines) ? d.newLines : [])
    setShowNew(true)
    showToast('Your unfinished exchange was kept — finish it or cancel it', 'info')
  }, [currentUserId, showToast])
  useEffect(() => {
    if (!showNew || !currentUserId) return
    if (!customerId && !returnLines.length && !newLines.length && !notes) return
    saveFormDraft('exchange', currentUserId, { customerId, customerName, originalSORef, notes, returnLines, newLines } satisfies ExchangeDraft)
  }, [showNew, currentUserId, customerId, customerName, originalSORef, notes, returnLines, newLines])

  function cancelNew() {
    const registered = returnLines.reduce((n, l) => n + l.serialIds.length, 0)
    if (registered > 0 && !window.confirm(`Discard this exchange? The ${registered} returned machine serial(s) you entered stay registered as "with customer" until a trade-in is saved for them.`)) return
    setShowNew(false); reset()
  }
  function resetBulk() { setBulkRows([]); if (bulkFileRef.current) bulkFileRef.current.value = '' }

  function submit() {
    if (!customerId) { showToast('Select a customer', 'error'); return }
    if (!returnLines.length || !newLines.length) { showToast('Add both return and new items', 'error'); return }
    if (returnLines.some(l => !l.productId) || newLines.some(l => !l.productId)) { showToast('All lines need a product', 'error'); return }
    for (const line of returnLines) {
      const product = products.find(p => p.id === line.productId)
      if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); return }
      if (line.unitPrice === '' || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) { showToast(`Enter the price (0 or more) for ${product.name}`, 'error'); return }
      if (line.qty === '' || !Number.isFinite(line.qty) || line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
      if (product.requiresSerial && line.serialIds.length !== line.qty) {
        showToast(`Select ${line.qty} returned serial number(s) for ${product.name}`, 'error')
        return
      }
    }
    for (const line of newLines) {
      const product = products.find(p => p.id === line.productId)
      if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); return }
      if (line.unitPrice === '' || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) { showToast(`Enter the price (0 or more) for ${product.name}`, 'error'); return }
      if (line.qty === '' || !Number.isFinite(line.qty) || line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
      if (product.requiresSerial && line.serialIds.length !== line.qty) {
        showToast(`Select ${line.qty} outgoing serial number(s) for ${product.name}`, 'error')
        return
      }
    }
    const toReady = (l: ELine) => ({ ...l, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })
    createExchange(customerId, customerName, returnLines.map(toReady), newLines.map(toReady), notes || undefined, originalSO?.id, originalSO?.ref)
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

  const returnTotal = returnLines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0), 0)
  const newTotal    = newLines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0), 0)
  const diff        = newTotal - returnTotal

  if (detail) {
    const exc = detail
    const STEPS = ['draft', 'approved', 'completed']
    const si = exc.status === 'cancelled' ? -1 : STEPS.indexOf(exc.status)
    const excView = exchangeDocumentView(exc, serials as Array<{ id: string; serial?: string; specs?: string; unitName?: string }>)
    const balanceInvoice = invoices.find(i => i.type === 'customer_invoice' && (i.lines ?? []).some(l => (l.description || '').startsWith(`Exchange ${exc.ref} `)))
    const printNote = async () => {
      try {
        await downloadExchangeNotePdf({
          view: excView,
          customerName: exc.customerName,
          contact: contacts.find(c => c.id === exc.customerId),
          company: companySettings,
          bankAccounts,
          settlement: exchangeSettlementText(excView, balanceInvoice?.ref, exc.priceDiff < 0 ? `CR/${exc.ref}` : undefined),
        })
      } catch {
        showToast('Exchange note could not be made', 'error')
      }
    }
    const when = (d?: string) => (d ? fmtDate(d) : '')
    const givenIds = exc.newLines.flatMap(l => l.serialIds)
    const carried = (warranties ?? []).filter(w => givenIds.includes(w.serialId) && w.status !== 'cancelled')
    const invoiceDue = balanceInvoice ? Math.max(0, Number(balanceInvoice.total) - Number(balanceInvoice.amountPaid || 0)) : 0
    const invoicePaid = !!balanceInvoice && invoiceDue <= 0.5
    const steps = [
      { label: 'Draft', sub: when(exc.date) },
      { label: 'Approved', sub: [when(exc.approvedDate), exc.approvedByName].filter(Boolean).join(' · ') },
      { label: 'Completed', sub: [when(exc.completedDate), exc.completedByName].filter(Boolean).join(' · ') },
    ]
    const next = exc.status === 'draft'
      ? { title: 'Approve the exchange', sub: canApprove ? 'Then hand over the machine and complete it' : 'Waiting for approval' }
      : exc.status === 'approved'
        ? { title: 'Hand over and complete', sub: 'The returned machine goes to With Issues; the balance is billed or credited' }
        : exc.status === 'completed' && balanceInvoice && !invoicePaid
          ? { title: `Collect ${fmtKes(invoiceDue)}`, sub: `Record the payment on invoice ${balanceInvoice.ref}` }
          : null
    return (
      <div className="trd">
        <div className="trd-head">
          <div className="min-w-0">
            <button type="button" className="trd-back" onClick={() => onOpenDetail(null)}>‹ Trade-ins</button>
            <h2>{exc.ref} <span className="tri-kind tri-kind--exchanges">Exchange</span></h2>
            <p>{[exc.customerName, fmtDate(exc.date), exc.originalSORef ? `original sale ${exc.originalSORef}` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <StatusPill status={exc.status} />
        </div>
        {exc.status !== 'cancelled' && (
          <ol className="trd-steps">
            {steps.map((st, idx) => (
              <li key={st.label} className={idx < si || exc.status === 'completed' ? 'is-done' : idx === si ? 'is-now' : ''}>
                <b>{st.label}</b><span>{idx <= si ? st.sub || '—' : 'waiting'}</span>
              </li>
            ))}
          </ol>
        )}
        <ExchangeSwapCard view={excView} title="Machines swapped" aside={<>Returned {fmtKes(exc.returnTotal)} · Given {fmtKes(exc.newTotal)}</>} />
        <div className="trd-cols" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          <div>
            <p className="trd-sec">Balance</p>
            <dl className="trd-money">
              <dt>Given</dt><dd>{fmtKes(exc.newTotal)}</dd>
              <dt>Less returned</dt><dd>− {fmtKes(exc.returnTotal)}</dd>
              <dt className="is-total">{exc.priceDiff > 0 ? 'Customer pays' : exc.priceDiff < 0 ? 'We owe the customer' : 'Even exchange'}</dt>
              <dd className="is-total">{exc.priceDiff !== 0 ? fmtKes(Math.abs(exc.priceDiff)) : '—'}</dd>
              {balanceInvoice && (<><dt>Invoice</dt><dd><Link className="text-primary-600" href={financeInvoicePath(balanceInvoice.id)}>{balanceInvoice.ref}</Link> <span className={`tri-status ${invoicePaid ? 'tri-status--done' : 'tri-status--todo'}`}>{invoicePaid ? 'Paid' : invoiceDue < Number(balanceInvoice.total) ? `${fmtKes(invoiceDue)} due` : 'Not paid'}</span></dd></>)}
              {exc.status === 'completed' && exc.priceDiff < 0 && (<><dt>Store credit</dt><dd>CR/{exc.ref}</dd></>)}
              {carried.length > 0 && (<><dt>Warranty</dt><dd>{carried.map(w => w.ref).join(', ')} · to {fmtDate(carried[0].endDate)}</dd></>)}
            </dl>
            {exc.notes && <p className="trd-note">Note: {exc.notes}</p>}
          </div>
          <div>
            {exc.status === 'completed' && (
              <>
                <p className="trd-sec">Documents</p>
                <div className="trd-docs">
                  <button type="button" className="trd-doc" onClick={() => { void printNote() }}>Exchange note <span>PDF ⤓</span></button>
                  {balanceInvoice && <Link className="trd-doc" href={financeInvoicePath(balanceInvoice.id)}>Invoice {balanceInvoice.ref} <span>Open ›</span></Link>}
                  {carried.map(w => <span key={w.id} className="trd-doc" style={{ cursor: 'default' }}>Warranty {w.ref} <span>to {fmtDate(w.endDate)}</span></span>)}
                </div>
              </>
            )}
            <div className="trd-next">
              {next ? <div><span>Next</span><b>{next.title}</b><small>{next.sub}</small></div> : <div><span>Done</span><b>{exc.status === 'cancelled' ? 'Cancelled' : 'Nothing left to do'}</b></div>}
              <div className="trd-actions">
                {exc.status === 'draft' && canApprove && <button type="button" className="btn-primary text-[11px]" onClick={() => approveExchange(exc.id)}><Fa icon={faCheck} aria-hidden="true" /> Approve</button>}
                {exc.status === 'approved' && <button type="button" className="btn-primary text-[11px]" onClick={() => completeExchange(exc.id)}>Complete exchange</button>}
                {exc.status === 'completed' && balanceInvoice && !invoicePaid && <Link className="btn-primary text-[11px]" href={financeInvoicePath(balanceInvoice.id)}>Record receipt on {balanceInvoice.ref}</Link>}
                {['draft', 'approved'].includes(exc.status) && <button type="button" className="btn-secondary text-[11px]" onClick={() => { cancelExchange(exc.id); onOpenDetail(null) }}>Cancel exchange</button>}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PanelHeader title="Client Exchanges" count={sorted.length}>
        <button type="button" className="btn-secondary text-[11px] flex items-center gap-1.5" onClick={() => setShowBulk(true)}><Fa icon={faUpload} aria-hidden="true" /> Bulk Upload</button>
        <button className="btn-primary text-[11px]" onClick={() => setShowNew(true)}>+ New Exchange</button>
      </PanelHeader>

      <DataTable
        tableId="tradein-exchanges"
        columns={exchangeColumns}
        rows={displayedExc}
        rowKey={exc => exc.id}
        searchValue={excSearch}
        onSearchChange={setExcSearch}
        clientSearch={false}
        page={excPage}
        onPageChange={setExcPage}
        searchPlaceholder="Search ref, customer…"
        emptyMessage={excSearch ? 'No results.' : 'No exchanges yet.'}
        onRowClick={exc => onOpenDetail(exc.id)}
        rowLabel={exc => exc.ref}
      />

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
        <Modal title="New Client Exchange" subtitle="Record the customer device, assessment and agreed exchange value" variant="workspace" onClose={cancelNew}>
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
                <button className="btn-secondary text-[10px] py-1" onClick={() => setReturnLines(l => [...l, { productId: '', productName: '', qty: '', unitPrice: '', serialIds: [] }])}>+ Add</button>
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
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)' }}>New items for customer</p>
                <button className="btn-secondary text-[10px] py-1" onClick={() => setNewLines(l => [...l, { productId: '', productName: '', qty: '', unitPrice: '', serialIds: [] }])}>+ Add</button>
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
            <button className="btn-secondary text-[11px]" onClick={cancelNew}>Cancel</button>
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
        <Field label="Qty *">
          <Input type="number" value={String(line.qty)} onChange={v => onChange({ qty: v === '' ? '' : Number(v) })} />
        </Field>
        <Field label="Price (KSh) *">
          <Input type="number" value={String(line.unitPrice)} onChange={v => onChange({ unitPrice: v === '' ? '' : Number(v) })} />
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

type TradeTab = 'all' | 'buybacks' | 'donations' | 'exchanges'
const TRADE_TABS: TradeTab[] = ['all', 'buybacks', 'donations', 'exchanges']
type TradeKind = Exclude<TradeTab, 'all'>

type TradeRow = {
  id: string
  ref: string
  kind: TradeKind
  customer: string
  machines: string
  amount: number | null
  amountLabel: string
  status: string
  tone: 'draft' | 'todo' | 'done' | 'off'
  date: string
}

const KIND_LABEL: Record<TradeKind, string> = { buybacks: 'Buy-back', exchanges: 'Exchange', donations: 'Donation' }

/** "HP 840 G5" for one line, "HP 840 G5 +2 more" for several. */
function machinesOf(lines: Array<{ productName: string; qty: number }>): string {
  if (!lines.length) return '—'
  const first = `${lines[0].productName}${lines[0].qty > 1 ? ` ×${lines[0].qty}` : ''}`
  return lines.length > 1 ? `${first} +${lines.length - 1} more` : first
}

/** Every buy-back, exchange and donation as one list, newest first. */
function tradeRows(buyBacks: BuyBack[], exchanges: ClientExchange[], donations: Donation[]): TradeRow[] {
  const rows: TradeRow[] = []
  for (const bb of buyBacks) {
    const status = bb.status === 'draft' ? 'Draft'
      : bb.status === 'approved' ? (bb.total > 0 ? 'Approved · to pay' : 'Approved · to receive')
      : bb.status === 'paid' ? 'Paid · to stock'
      : 'Stocked'
    rows.push({
      id: bb.id, ref: bb.ref, kind: 'buybacks', customer: bb.customerName || '—', machines: machinesOf(bb.lines),
      amount: bb.total, amountLabel: fmtKes(bb.total), status,
      tone: bb.status === 'draft' ? 'draft' : bb.status === 'stocked' ? 'done' : 'todo', date: bb.date,
    })
  }
  for (const ex of exchanges) {
    const status = ex.status === 'draft' ? 'Draft' : ex.status === 'approved' ? 'Approved · to complete' : ex.status === 'completed' ? 'Completed' : 'Cancelled'
    const ret = ex.returnLines[0]?.productName ?? '?'
    const giv = ex.newLines[0]?.productName ?? '?'
    rows.push({
      id: ex.id, ref: ex.ref, kind: 'exchanges', customer: ex.customerName || '—',
      machines: `${ret} → ${giv}${ex.returnLines.length + ex.newLines.length > 2 ? ' …' : ''}`,
      amount: ex.priceDiff,
      amountLabel: ex.priceDiff > 0 ? `+ ${fmtKes(ex.priceDiff)}` : ex.priceDiff < 0 ? `− ${fmtKes(-ex.priceDiff)}` : 'Even',
      status, tone: ex.status === 'draft' ? 'draft' : ex.status === 'approved' ? 'todo' : ex.status === 'completed' ? 'done' : 'off', date: ex.date,
    })
  }
  for (const dn of donations) {
    rows.push({
      id: dn.id, ref: dn.ref, kind: 'donations', customer: dn.party || '—', machines: machinesOf(dn.lines),
      amount: null, amountLabel: dn.type === 'in' ? 'Received' : 'Given',
      status: dn.status === 'confirmed' ? 'Confirmed' : 'Draft', tone: dn.status === 'confirmed' ? 'done' : 'draft', date: dn.date,
    })
  }
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.ref.localeCompare(a.ref))
}

function AllTradeIns({ onOpen }: { onOpen: (kind: TradeKind, id: string) => void }) {
  const { buyBacks, donations, clientExchanges } = useAfterSalesStore()
  const [search, setSearch] = useUrlUiState('tradeQ', '')
  const [pageValue, setPageValue] = useUrlUiState('tradePage', '1')
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1)
  const all = useMemo(() => tradeRows(buyBacks, clientExchanges, donations), [buyBacks, clientExchanges, donations])
  const q = search.trim().toLowerCase()
  const rows = q ? all.filter(r => [r.ref, r.customer, r.machines, KIND_LABEL[r.kind]].some(v => v.toLowerCase().includes(q))) : all
  const columns: ColumnDef<TradeRow>[] = [
    { key: 'ref', label: 'Ref', priority: 1, width: '140px', render: r => <span className="font-mono text-[11px] font-bold">{r.ref}</span>, accessor: r => r.ref },
    { key: 'kind', label: 'Type', priority: 1, width: '100px', render: r => <span className={`tri-kind tri-kind--${r.kind}`}>{KIND_LABEL[r.kind]}</span>, accessor: r => KIND_LABEL[r.kind] },
    { key: 'customer', label: 'Customer', priority: 1, width: '1fr', render: r => <span className="text-xs font-medium erp-truncate" title={r.customer}>{r.customer}</span>, accessor: r => r.customer },
    { key: 'machines', label: 'Machines', priority: 2, width: '1.3fr', render: r => <span className="text-xs text-t2 erp-truncate" title={r.machines}>{r.machines}</span>, accessor: r => r.machines },
    { key: 'amount', label: 'Amount', priority: 1, width: '120px', render: r => <span className="text-xs font-bold whitespace-nowrap">{r.amountLabel}</span>, accessor: r => r.amount ?? 0 },
    { key: 'status', label: 'Status', priority: 1, width: '170px', render: r => <span className={`tri-status tri-status--${r.tone}`}>{r.status}</span>, accessor: r => r.status },
    { key: 'date', label: 'Date', priority: 2, width: '100px', render: r => <span className="text-xs text-t3">{fmtDate(r.date)}</span>, accessor: r => r.date },
  ]
  return (
    <DataTable
      tableId="tradein-all"
      columns={columns}
      rows={rows}
      rowKey={r => `${r.kind}:${r.id}`}
      searchValue={search}
      onSearchChange={v => { setSearch(v); setPageValue('1') }}
      clientSearch={false}
      page={page}
      onPageChange={p => setPageValue(String(p))}
      searchPlaceholder="Search ref, customer, machine…"
      emptyMessage={q ? 'No trade-ins match.' : 'No buy-backs, exchanges or donations yet.'}
      onRowClick={r => onOpen(r.kind, r.id)}
      rowLabel={r => r.ref}
      hideColumnFilters
      renderCard={r => (
        <div className="record-card p-3 rounded-xl border border-[var(--border-lt)]" onClick={() => onOpen(r.kind, r.id)}>
          <div className="flex justify-between gap-2"><span className="font-mono text-[11px] font-bold">{r.ref}</span><span className={`tri-status tri-status--${r.tone}`}>{r.status}</span></div>
          <p className="text-xs font-semibold mt-1">{r.customer} <span className={`tri-kind tri-kind--${r.kind}`}>{KIND_LABEL[r.kind]}</span></p>
          <p className="text-[11px] text-t3">{r.machines} · {r.amountLabel}</p>
        </div>
      )}
    />
  )
}

function TradeInContent() {
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  const { buyBacks, donations, clientExchanges } = useAfterSalesStore()
  const [tabParam] = useUrlQueryState('tab', 'all')
  const tab = TRADE_TABS.includes(tabParam as TradeTab) ? tabParam as TradeTab : 'all'
  const [detailId, setDetailId] = useUrlRecordId({ whenOpen: { tab } })
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [newFor, setNewFor] = useState<TradeKind | null>(null)

  useEffect(() => { setMounted(true) }, [])

  function go(nextTab: TradeTab, id?: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', nextTab === 'all' ? 'trade' : nextTab)
    if (id) params.set('id', id); else params.delete('id')
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  const startNew = (kind: TradeKind) => { setNewFor(kind); go(kind) }

  if (!mounted) {
    return (
      <ModuleSkeleton />
    )
  }

  const awaitingReview = buyBacks.filter(item => item.status === 'draft').length + clientExchanges.filter(e => e.status === 'draft').length
  const approvedBuyBacks = buyBacks.filter(item => item.status === 'approved' && Number(item.total) > 0)
  const totalToPay = approvedBuyBacks.reduce((sum, item) => sum + Number(item.total || 0), 0)
  const toStock = buyBacks.filter(item => item.status === 'paid').length
  const monthKey = new Date().toISOString().slice(0, 7)
  const thisMonth = [
    ...buyBacks.map(item => item.date),
    ...donations.map(item => item.date),
    ...clientExchanges.map(item => item.date),
  ].filter(date => String(date || '').slice(0, 7) === monthKey).length

  const tabs: { id: TradeTab; label: string; count: number }[] = [
    { id: 'all',       label: 'All',        count: buyBacks.length + clientExchanges.length + donations.length },
    { id: 'buybacks',  label: 'Buy-backs',  count: buyBacks.length },
    { id: 'exchanges', label: 'Exchanges',  count: clientExchanges.length },
    { id: 'donations', label: 'Donations',  count: donations.length },
  ]

  return (
    <div className="tradein-workspace tri">
      <section className="tradein-summary" aria-label="Trade-in figures">
        <button type="button" className="tradein-summary__item" onClick={() => go('all')}>
          <span>Awaiting review</span><strong>{awaitingReview}</strong><small>Draft buy-backs and exchanges</small>
        </button>
        <button type="button" className="tradein-summary__item is-warning" onClick={() => go('buybacks')}>
          <span>To pay</span><strong>{fmtKes(totalToPay)}</strong><small>{approvedBuyBacks.length} approved buy-back{approvedBuyBacks.length === 1 ? '' : 's'}</small>
        </button>
        <button type="button" className="tradein-summary__item" onClick={() => go('buybacks')}>
          <span>To stock</span><strong>{toStock}</strong><small>Paid, not yet stocked</small>
        </button>
        <div className="tradein-summary__item">
          <span>This month</span><strong>{thisMonth}</strong><small>Trade-ins recorded</small>
        </div>
      </section>
      {!detailId && (
        <div className="tri-bar">
          <div className="tri-seg" role="tablist" aria-label="Trade-in type">
            {tabs.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
                {t.label} <b>{t.count}</b>
              </button>
            ))}
          </div>
          {tab === 'all' && (
            <div className="tri-new">
              <button type="button" className="btn-secondary text-[11px]" onClick={() => startNew('donations')}>+ Donation</button>
              <button type="button" className="btn-secondary text-[11px]" onClick={() => startNew('exchanges')}>+ Exchange</button>
              <button type="button" className="btn-primary text-[11px]" onClick={() => startNew('buybacks')}>+ Buy-back</button>
            </div>
          )}
        </div>
      )}
      <div className="tradein-content">
        {tab === 'all' && <AllTradeIns onOpen={(kind, id) => go(kind, id)} />}
        {tab === 'buybacks'  && <BuyBackTab detailId={detailId} onOpenDetail={setDetailId} startNew={newFor === 'buybacks'} onStarted={() => setNewFor(null)} />}
        {tab === 'donations' && <DonationTab detailId={detailId} onOpenDetail={setDetailId} startNew={newFor === 'donations'} onStarted={() => setNewFor(null)} />}
        {tab === 'exchanges' && <ExchangeTab detailId={detailId} onOpenDetail={setDetailId} startNew={newFor === 'exchanges'} onStarted={() => setNewFor(null)} />}
      </div>
    </div>
  )
}

export default function TradeIn() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <TradeInContent />
    </Suspense>
  )
}
