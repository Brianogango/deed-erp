'use client'
import { useState, useRef, useCallback } from 'react'
import { useApp, Receipt, LOCATIONS, LocationId, CATEGORY_CONFIG, CategoryId, fmtKes, fmtDate, POLine, Account } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Confirm, StatCard, PanelHeader, StatusStepper, SearchPicker, Divider } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faClipboardCheck, faCartShopping, faBoxesStacked, faCreditCard } from '@fortawesome/free-solid-svg-icons'
import TradeIn from './TradeIn'

type MainView = 'orders' | 'receipts' | 'returns' | 'bills' | 'tradein'
type SubView  = 'list' | 'form' | 'receive'

const ACCESSORIES = ['Charger', 'Bag/Case', 'Mouse', 'Box', 'Cable', 'Manual']

const PO_STEPS = ['RFQ', 'RFQ Sent', 'Purchase Order', 'Received', 'Billed']

const LOC_OPTS = (['warehouse', 'shop'] as LocationId[]).map(k => ({ value: k, label: LOCATIONS[k].name }))

const REASON_OPTS = [
  { value: 'damaged',      label: '🔴 Damaged goods' },
  { value: 'wrong_supply', label: '❌ Wrong supply' },
  { value: 'excess',       label: '📦 Excess stock' },
  { value: 'other',        label: '📝 Other' },
]

const STATUS_LABEL: Record<string, string> = {
  draft: 'RFQ', sent: 'RFQ Sent', confirmed: 'Purchase Order',
  partial: 'Partially Received', received: 'Fully Received', cancelled: 'Cancelled',
}
const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-gray', sent: 'badge-amber', confirmed: 'badge-blue',
  partial: 'badge-amber', received: 'badge-green', cancelled: 'badge-red',
}
const PO_STEP_IDX: Record<string, number> = {
  draft: 0, sent: 1, confirmed: 2, partial: 3, received: 3,
}

// CSV template columns
const CSV_HEADERS = ['Product Name', 'Quantity', 'Unit Price (KES)', 'Tax Rate (%)', 'Serial Numbers', 'Specifications', 'Notes']

// ── CSV parser ──────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(row => {
    const vals = row.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  }).filter(r => Object.values(r).some(v => v))
}

// ── Download helpers ────────────────────────────────────────────────────────
function downloadCSV(filename: string, content: string) {
  const bom = '\uFEFF' // UTF-8 BOM so Excel opens correctly
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

type ImportRow = {
  raw: Record<string, string>
  productId: string
  productName: string
  accountCode?: string
  qty: number
  unitPrice: number
  taxRate: number
  requiresSerial: boolean
  importedSerials: string[]
  specs: string
  status: 'ok' | 'warn' | 'error'
  message: string
  serialWarning?: string   // e.g. count mismatch
}

export default function Purchase() {
  const {
    purchaseOrders, contacts, products, receipts, invoices, purchaseReturns, serials, users, bankAccounts,
    currentUserId, accounts, buyBacks, donations, clientExchanges,
    createPO, updatePO, addPOLine, removePOLine, updatePOLine, bulkAddPOLines,
    sendPO, confirmPO,
    validateReceipt, deletePO, createBillFromPO,
    postInvoice, registerPayment,
    createPurchaseReturn, addReturnLine, confirmPurchaseReturn, logReturnPickup,
    showToast, companySettings,
  } = useApp()

  const [mainView, setMainView] = useState<MainView>('orders')
  const [subView,  setSubView]  = useState<SubView>('list')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filter,   setFilter]   = useState('all')

  // ── New RFQ ────────────────────────────────────────────────────────────────
  const [showNewRFQ,    setShowNewRFQ]    = useState(false)
  const [newVendorId,   setNewVendorId]   = useState('')
  const [newVendorName, setNewVendorName] = useState('')

  // ── Add single line ────────────────────────────────────────────────────────
  const [showAddLine, setShowAddLine] = useState(false)
  const [addProd,     setAddProd]     = useState<typeof products[0] | null>(null)
  const [addQty,      setAddQty]      = useState('1')
  const [addPrice,    setAddPrice]    = useState('')
  const [addVAT,      setAddVAT]      = useState(false)

  // ── Inline edit state ──────────────────────────────────────────────────────
  // editCell: { lineId, field } — the currently focused inline edit cell
  const [editCell, setEditCell] = useState<{ lineId: string; field: 'qty' | 'unitPrice' | 'taxRate' } | null>(null)
  const [editVal,  setEditVal]  = useState('')

  // ── CSV / Excel import ─────────────────────────────────────────────────────
  const [showImport,   setShowImport]   = useState(false)
  const [importRows,   setImportRows]   = useState<ImportRow[]>([])
  const [importVendorId, setImportVendorId] = useState('')
  const [importVendorName, setImportVendorName] = useState('')
  const [isDragging,   setIsDragging]   = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setImportRowAccount = (idx: number, code: string) =>
    setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, accountCode: code || undefined } : r))

  // ── GRN state ──────────────────────────────────────────────────────────────
  const [activeReceiptId,      setActiveReceiptId]      = useState<string | null>(null)
  const [grnLines,             setGrnLines]             = useState<Receipt['lines']>([])
  const [destLocation,         setDestLocation]         = useState<LocationId>('warehouse')
  const [serialInputs,         setSerialInputs]         = useState<Record<number, string>>({})
  // accessories per serial string: { 'SN001': ['Charger','Bag'] }
  const [serialAccessories,    setSerialAccessories]    = useState<Record<string, string[]>>({})
  const [serialAccessoryNotes, setSerialAccessoryNotes] = useState<Record<string, string>>({})
  // specs and issue flags per serial
  const [serialSpecs,   setSerialSpecs]   = useState<Record<string, string>>({})
  const [serialIssues,  setSerialIssues]  = useState<Record<string, string>>({})  // non-empty = has issue
  const serialRefs = useRef<Record<number, HTMLInputElement | null>>({})

  // ── Return ─────────────────────────────────────────────────────────────────
  const [showReturnModal,    setShowReturnModal]    = useState(false)
  const [returnReceiptId,    setReturnReceiptId]    = useState('')
  const [returnReason,       setReturnReason]       = useState<'damaged' | 'wrong_supply' | 'excess' | 'other'>('damaged')
  const [returnLines,        setReturnLines]        = useState<{ productId: string; productName: string; qty: string; serials: string[]; requiresSerial: boolean }[]>([])
  const [returnScanInput,    setReturnScanInput]    = useState<Record<number, string>>({})
  const [returnCollectedBy,  setReturnCollectedBy]  = useState('')
  const [returnCollectedDate,setReturnCollectedDate]= useState(new Date().toISOString().slice(0, 10))
  const [returnPickupNotes,  setReturnPickupNotes]  = useState('')

  // ── Return list filters ────────────────────────────────────────────────────
  const [retSearchSerial,  setRetSearchSerial]  = useState('')
  const [retFilterStatus,  setRetFilterStatus]  = useState('all')
  const [retFilterReason,  setRetFilterReason]  = useState('all')
  const [retFilterVendor,  setRetFilterVendor]  = useState('all')
  const [retDateFrom,      setRetDateFrom]      = useState('')
  const [retDateTo,        setRetDateTo]        = useState('')
  const [retExpandedId,    setRetExpandedId]    = useState<string | null>(null)
  const [showPickupModal,  setShowPickupModal]  = useState(false)
  const [pickupReturnId,   setPickupReturnId]   = useState('')
  const [pickupCollectedBy,  setPickupCollectedBy]  = useState('')
  const [pickupCollectedDate,setPickupCollectedDate]= useState(new Date().toISOString().slice(0, 10))
  const [pickupNotes,        setPickupNotes]        = useState('')


  // ── Payment ────────────────────────────────────────────────────────────────
  const [showPayModal, setShowPayModal] = useState(false)
  const [payInvoiceId, setPayInvoiceId] = useState('')
  const [payAmount,    setPayAmount]    = useState('')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [payMethod, setPayMethod] = useState('bank')
  const [payReference, setPayReference] = useState('')

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [delId, setDelId] = useState<string | null>(null)

  // ── Derived ────────────────────────────────────────────────────────────────
  const vendors          = contacts.filter(c => c.isVendor)
  const purchasableProds = products.filter(p => p.canBePurchased && p.isActive)
  const vendorBills      = invoices.filter(i => i.type === 'vendor_bill').sort((a, b) => b.date.localeCompare(a.date))

  const activePO      = purchaseOrders.find(p => p.id === activeId) ?? null
  const activeReceipt = receipts.find(r => r.id === activeReceiptId) ?? null
  const linkedBill    = activePO?.billId ? (invoices.find(i => i.id === activePO.billId) ?? null) : null

  const filteredPOs = purchaseOrders.filter(po => {
    if (filter === 'rfq') return po.status === 'draft' || po.status === 'sent'
    if (filter === 'po')  return po.status === 'confirmed' || po.status === 'partial' || po.status === 'received'
    return filter === 'all' || po.status === filter
  })

  const currentUser = users.find(u => u.id === currentUserId)

  const stats = {
    rfqs:        purchaseOrders.filter(p => p.status === 'draft' || p.status === 'sent').length,
    activePOs:   purchaseOrders.filter(p => p.status === 'confirmed' || p.status === 'partial').length,
    pendingGRNs: receipts.filter(r => r.status === 'draft').length,
    unpaid:      vendorBills.filter(b => b.amountPaid < b.total && b.status !== 'cancelled').reduce((s, b) => s + (b.total - b.amountPaid), 0),
  }

  // ── Create RFQ ─────────────────────────────────────────────────────────────
  const handleCreateRFQ = () => {
    if (!newVendorId) { showToast('Select a vendor', 'error'); return }
    const po = createPO(newVendorId, newVendorName)
    setShowNewRFQ(false); setNewVendorId(''); setNewVendorName('')
    setActiveId(po.id); setSubView('form')
  }

  // ── Add single line ────────────────────────────────────────────────────────
  const handleAddLine = () => {
    if (!addProd || !activeId) return
    addPOLine(activeId, addProd, Number(addQty) || 1, Number(addPrice) || addProd.costPrice, addVAT ? (addProd.taxRate || 16) : 0)
    setShowAddLine(false); setAddProd(null); setAddQty('1'); setAddPrice(''); setAddVAT(false)
  }

  // ── Inline cell commit ─────────────────────────────────────────────────────
  const commitCell = useCallback((poId: string, lineId: string, field: 'qty' | 'unitPrice' | 'taxRate', raw: string) => {
    const num = parseFloat(raw)
    if (isNaN(num) || num < 0) { setEditCell(null); return }
    if (field === 'qty'       && num <= 0) { showToast('Quantity must be greater than 0', 'error'); setEditCell(null); return }
    if (field === 'unitPrice' && num < 0)  { showToast('Price cannot be negative', 'error');        setEditCell(null); return }
    if (field === 'taxRate'   && (num < 0 || num > 100)) { showToast('Tax rate must be 0–100', 'error'); setEditCell(null); return }
    updatePOLine(poId, lineId, { [field]: num })
    setEditCell(null)
  }, [updatePOLine, showToast])

  // ── GRN ────────────────────────────────────────────────────────────────────
  const openReceive = () => {
    if (!activePO) return
    const draft = receipts.find(r => r.poId === activePO.id && r.status === 'draft')
    if (!draft) { showToast('No pending receipt found', 'error'); return }
    setActiveReceiptId(draft.id)

    // Pre-fill serials and specs from CSV import if available
    const preSpecs: Record<string, string>   = {}
    const preLines = draft.lines.map(l => {
      const preSerials = (l.importedSerials ?? []).slice(0, l.qtyExpected)
      return { ...l, qtyReceived: l.qtyExpected, serials: preSerials }
    })
    // Pre-fill specs state for each imported serial
    draft.lines.forEach(l => {
      if (l.specs && l.importedSerials) {
        l.importedSerials.forEach(s => { preSpecs[s] = l.specs! })
      }
    })

    setGrnLines(preLines)
    setDestLocation(draft.destinationLocation)
    setSerialInputs({})
    setSerialSpecs(preSpecs)
    setSubView('receive')
  }

  const addSerial = (lineIdx: number, serial: string) => {
    const val = serial.trim().toUpperCase()
    if (!val) return
    setGrnLines(prev => prev.map((l, i) => {
      if (i !== lineIdx) return l
      if (l.serials.includes(val))        { showToast(`${val} already added`, 'error'); return l }
      if (l.serials.length >= l.qtyReceived) { showToast('All serials entered for this line', 'error'); return l }
      return { ...l, serials: [...l.serials, val] }
    }))
    setSerialInputs(p => ({ ...p, [lineIdx]: '' }))
    serialRefs.current[lineIdx]?.focus()
  }

  const removeSerial = (lineIdx: number, serial: string) => {
    setGrnLines(prev => prev.map((l, i) => i !== lineIdx ? l : { ...l, serials: l.serials.filter(s => s !== serial) }))
    setSerialAccessories(p => { const n = { ...p }; delete n[serial]; return n })
    setSerialAccessoryNotes(p => { const n = { ...p }; delete n[serial]; return n })
    setSerialSpecs(p => { const n = { ...p }; delete n[serial]; return n })
    setSerialIssues(p => { const n = { ...p }; delete n[serial]; return n })
  }

  const toggleSerialAccessory = (serial: string, acc: string) => {
    setSerialAccessories(prev => {
      const cur = prev[serial] ?? []
      return { ...prev, [serial]: cur.includes(acc) ? cur.filter(a => a !== acc) : [...cur, acc] }
    })
  }

  const handleValidateReceipt = () => {
    if (!activeReceiptId) return
    for (const line of grnLines) {
      if (line.requiresSerial && line.serials.length < line.qtyReceived) {
        showToast(`Enter all ${line.qtyReceived} serials for ${line.productName} (${line.serials.length} done)`, 'error'); return
      }
    }
    validateReceipt(activeReceiptId, grnLines, destLocation, serialAccessories, serialAccessoryNotes, serialSpecs, serialIssues)
    setSubView('form'); setActiveReceiptId(null)
    setSerialAccessories({}); setSerialAccessoryNotes({})
    setSerialSpecs({}); setSerialIssues({})
  }

  // ── Return ─────────────────────────────────────────────────────────────────
  const openReturnForPO = () => {
    if (!activePO) return
    const latest = receipts.filter(r => r.poId === activePO.id && r.status === 'validated').pop()
    if (!latest) { showToast('No validated receipt found', 'error'); return }
    setReturnReceiptId(latest.id)
    setReturnLines(activePO.lines.map(l => ({ productId: l.productId, productName: l.productName, qty: '1', serials: [], requiresSerial: l.requiresSerial })))
    setReturnScanInput({})
    setReturnCollectedBy('')
    setReturnCollectedDate(new Date().toISOString().slice(0, 10))
    setReturnPickupNotes('')
    setShowReturnModal(true)
  }

  const addReturnSerial = (idx: number, serial: string) => {
    const val = serial.trim().toUpperCase()
    if (!val) return
    setReturnLines(prev => prev.map((l, i) => {
      if (i !== idx) return l
      if (l.serials.includes(val)) { showToast('Already added', 'error'); return l }
      return { ...l, serials: [...l.serials, val] }
    }))
    setReturnScanInput(p => ({ ...p, [idx]: '' }))
  }

  const handleConfirmReturn = () => {
    const hasItems = returnLines.some(l => l.requiresSerial ? l.serials.length > 0 : Number(l.qty) > 0)
    if (!hasItems) { showToast('Add at least one item to return', 'error'); return }
    const ret = createPurchaseReturn(returnReceiptId, returnReason)
    returnLines.filter(l => Number(l.qty) > 0 || l.serials.length > 0).forEach(l => {
      const qty = l.requiresSerial ? l.serials.length : Number(l.qty) || 0
      if (qty > 0) addReturnLine(ret.id, l.productId, l.productName, qty, l.serials, l.requiresSerial)
    })
    confirmPurchaseReturn(ret.id)
    if (returnCollectedBy) {
      const u = users.find(x => x.id === returnCollectedBy)
      logReturnPickup(ret.id, returnCollectedBy, u?.name ?? returnCollectedBy, returnCollectedDate, returnPickupNotes || undefined)
    }
    setShowReturnModal(false)
  }

  // ── CSV import ─────────────────────────────────────────────────────────────
  const downloadTemplate = () => {
    const rows = [
      CSV_HEADERS.join(','),
      'HP ProBook 440 G10,5,65000,16,SN-HP001;SN-HP002;SN-HP003;SN-HP004;SN-HP005,"Intel i5-12th Gen, 8GB RAM, 512GB SSD",Standard issue laptops',
      'Dell OptiPlex 7010,3,55000,16,DELL-7010-001;DELL-7010-002;DELL-7010-003,"Intel i7, 16GB RAM, 1TB HDD",Desktop for accounts',
      'HP LaserJet Pro M404dn,2,45000,16,HPLJ-001;HPLJ-002,"A4, 40ppm, Duplex, Network",Office printers',
      'USB-C Cable 2m 100W,20,850,16,,"",Accessories - no serial needed',
      'Canon Toner Cartridge,10,4500,16,,"",Printer consumables - no serial needed',
    ].join('\r\n')
    downloadCSV('deed-erp-po-import-template.csv', rows)
  }

  const processFile = (file: File) => {
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      showToast('Please upload a .csv file', 'error'); return
    }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (!parsed.length) { showToast('No data rows found in file', 'error'); return }

      const rows: ImportRow[] = parsed.map(raw => {
        const name      = (raw['Product Name'] ?? '').trim()
        const qtyRaw    = raw['Quantity'] ?? ''
        const priceRaw  = raw['Unit Price (KES)'] ?? ''
        const taxRaw    = raw['Tax Rate (%)'] ?? '16'
        const serialRaw = (raw['Serial Numbers'] ?? '').trim()
        const specs     = (raw['Specifications'] ?? '').trim()

        // Parse semicolon-separated serial numbers, strip whitespace
        const importedSerials = serialRaw
          ? serialRaw.split(';').map(s => s.trim().toUpperCase()).filter(Boolean)
          : []

        const blank = { importedSerials, specs }

        if (!name) return { raw, ...blank, productId: '', productName: '', qty: 0, unitPrice: 0, taxRate: 0, requiresSerial: false, status: 'error' as const, message: 'Product name is required' }

        const qty   = parseFloat(qtyRaw)
        const price = parseFloat(priceRaw)
        const tax   = parseFloat(taxRaw)

        if (isNaN(qty)   || qty   <= 0) return { raw, ...blank, productId: '', productName: name, qty: 0, unitPrice: 0, taxRate: 0, requiresSerial: false, status: 'error' as const, message: 'Invalid quantity' }
        if (isNaN(price) || price <  0) return { raw, ...blank, productId: '', productName: name, qty, unitPrice: 0, taxRate: 0, requiresSerial: false, status: 'error' as const, message: 'Invalid price' }
        if (isNaN(tax)   || tax   <  0 || tax > 100) return { raw, ...blank, productId: '', productName: name, qty, unitPrice: price, taxRate: 0, requiresSerial: false, status: 'error' as const, message: 'Tax must be 0–100' }

        // Match product
        const match = purchasableProds.find(p =>
          p.name.toLowerCase() === name.toLowerCase() ||
          p.sku?.toLowerCase()  === name.toLowerCase()
        )

        const catCfg = match ? (CATEGORY_CONFIG[match.category as CategoryId] ?? { serialRequired: false }) : { serialRequired: false }
        const requiresSerial = match ? catCfg.serialRequired : importedSerials.length > 0

        // Warn if serials provided but count doesn't match qty
        const serialWarning = importedSerials.length > 0 && importedSerials.length !== qty
          ? `${importedSerials.length} serial(s) provided for qty ${qty}`
          : undefined

        if (match) {
          return { raw, ...blank, productId: match.id, productName: match.name, qty, unitPrice: price, taxRate: tax, requiresSerial: catCfg.serialRequired, accountCode: match.costAccountCode, status: 'ok' as const, message: `Matched: ${match.name}`, serialWarning }
        }
        return { raw, ...blank, productId: '', productName: name, qty, unitPrice: price, taxRate: tax, requiresSerial, accountCode: undefined, status: 'warn' as const, message: 'Product not found in system — will add as-is', serialWarning }
      })

      setImportRows(rows)
    }
    reader.readAsText(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  const handleConfirmImport = () => {
    if (!activeId && !importVendorId) { showToast('Select or open a PO first', 'error'); return }

    const targetPoId = activeId ?? (() => {
      const po = createPO(importVendorId, importVendorName)
      setActiveId(po.id)
      return po.id
    })()

    const valid = importRows.filter(r => r.status !== 'error' && r.qty > 0 && r.unitPrice >= 0)
    if (!valid.length) { showToast('No valid rows to import', 'error'); return }

    bulkAddPOLines(targetPoId, valid.map(r => ({
      productId: r.productId,
      productName: r.productName,
      qty: r.qty,
      unitPrice: r.unitPrice,
      taxRate: r.taxRate,
      requiresSerial: r.requiresSerial,
      importedSerials: r.importedSerials.length ? r.importedSerials : undefined,
      specs: r.specs || undefined,
      accountCode: r.accountCode,
    })))

    showToast(`${valid.length} line(s) imported successfully`)
    setShowImport(false)
    setImportRows([])
    setSubView('form')
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RECEIVE VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (subView === 'receive' && activePO && activeReceipt) {
    const allComplete = grnLines.every(l => !l.requiresSerial || l.serials.length >= l.qtyReceived)
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn-outline text-[11px] py-1 px-2.5" onClick={() => { setSubView('form'); setActiveReceiptId(null) }}>← Back to Order</button>
          <span className="text-xs font-semibold">GRN — {activeReceipt.ref}</span>
          <span className="text-[10px] text-t3">From: {activePO.vendorName}</span>
          <span className={`badge ${STATUS_BADGE[activePO.status]}`}>{STATUS_LABEL[activePO.status]}</span>
        </div>

        <div className="card p-4 flex items-start gap-4 flex-wrap">
          <div>
            <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Destination</p>
            <Select value={destLocation} onChange={v => setDestLocation(v as LocationId)} options={LOC_OPTS} />
          </div>
          <div className="flex-1 p-3 rounded-lg text-xs" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
            <p className="font-semibold mb-1.5 text-t1">📋 Receiving Instructions</p>
            <p className="text-t3">• Serialized products require every serial to be scanned before validation</p>
            <p className="text-t3 mt-0.5">• Serials imported from CSV are pre-filled — verify and correct if needed</p>
            <p className="text-t3 mt-0.5">• Flag units received with issues to route them to the refurbishment queue</p>
            <p className="text-t3 mt-0.5">• Stock only updates after GRN validation</p>
          </div>
        </div>

        {grnLines.map((line, idx) => {
          const prod = products.find(p => p.id === line.productId)
          const isComplete = !line.requiresSerial || line.serials.length >= line.qtyReceived
          return (
            <div key={idx} className="card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#F3F4F6' }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{prod?.image ?? '📦'}</span>
                  <div>
                    <p className="text-xs font-semibold text-t1">{line.productName}</p>
                    <p className="text-[10px] text-t3">
                      Expected: {line.qtyExpected}
                      {line.requiresSerial
                        ? <span style={{ color: '#F59E0B' }}> · 🔖 Serial tracking required</span>
                        : ' · No serial required'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-t3">Qty received:</span>
                    <input className="form-input w-16 text-center text-xs py-1" type="number" min="0"
                      max={line.qtyExpected} value={line.qtyReceived}
                      onChange={e => setGrnLines(prev => prev.map((l, i) =>
                        i !== idx ? l : { ...l, qtyReceived: Math.min(Number(e.target.value) || 0, l.qtyExpected), serials: [] }
                      ))} />
                  </div>
                  <span className={`badge ${isComplete ? 'badge-green' : 'badge-amber'}`}>
                    {line.requiresSerial ? `${line.serials.length}/${line.qtyReceived} serials` : (isComplete ? 'Ready' : 'Enter qty')}
                  </span>
                </div>
              </div>

              {line.requiresSerial && (
                <div className="p-4">
                  <div className="flex gap-2 mb-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm">📷</span>
                      <input ref={el => { serialRefs.current[idx] = el }} className="form-input pl-9 font-mono text-sm"
                        placeholder="Scan or type serial number, press Enter…"
                        style={{ borderColor: '#A8D4E8' }}
                        value={serialInputs[idx] ?? ''}
                        onChange={e => setSerialInputs(p => ({ ...p, [idx]: e.target.value.toUpperCase() }))}
                        onKeyDown={e => { if (e.key === 'Enter') addSerial(idx, serialInputs[idx] ?? '') }} />
                    </div>
                    <button className="btn-primary px-4" onClick={() => addSerial(idx, serialInputs[idx] ?? '')}>Add</button>
                  </div>
                  {line.serials.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {line.serials.map(s => {
                        const accs     = serialAccessories[s] ?? []
                        const hasIssue = !!(serialIssues[s]?.trim())
                        const borderColor = hasIssue ? '#FCA5A5' : '#BBF7D0'
                        const bgColor     = hasIssue ? '#FEF2F2' : '#F0FDF4'
                        const headerColor = hasIssue ? '#991B1B' : '#166534'
                        return (
                          <div key={s} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}`, background: bgColor }}>
                            {/* Serial header row */}
                            <div className="flex items-center justify-between px-3 py-2">
                              <span className="font-mono text-[11px] font-semibold" style={{ color: headerColor }}>
                                {hasIssue ? '⚠ ' : '✓ '}{s}
                                {hasIssue && <span className="ml-2 text-[9px] font-sans px-1.5 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#991B1B' }}>Refurbishment queue</span>}
                              </span>
                              <button onClick={() => removeSerial(idx, s)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 14, lineHeight: 1 }}>×</button>
                            </div>
                            <div className="px-3 pb-2.5 flex flex-col gap-2 border-t" style={{ borderColor }}>
                              {/* Specs */}
                              <div>
                                <p className="text-[9px] uppercase tracking-wider mt-2 mb-1" style={{ color: '#6B7280' }}>Specifications</p>
                                <input className="form-input text-[11px] py-1"
                                  placeholder="e.g. Intel i5-12th Gen, 8GB RAM, 512GB SSD, Silver"
                                  value={serialSpecs[s] ?? ''}
                                  onChange={e => setSerialSpecs(p => ({ ...p, [s]: e.target.value }))} />
                              </div>
                              {/* Accessories */}
                              <div>
                                <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#6B7280' }}>Accessories received:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {ACCESSORIES.map(acc => {
                                    const on = accs.includes(acc)
                                    return (
                                      <button key={acc} onClick={() => toggleSerialAccessory(s, acc)}
                                        className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
                                        style={{ background: on ? '#1B2762' : '#E5E7EB', color: on ? '#fff' : '#6B7280', border: 'none', cursor: 'pointer' }}>
                                        {on ? '✓ ' : ''}{acc}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                              {/* Received with issues toggle */}
                              <div className="rounded-lg p-2.5" style={{ background: hasIssue ? '#FEE2E2' : '#F3F4F6', border: `1px solid ${hasIssue ? '#FCA5A5' : '#E5E7EB'}` }}>
                                <label className="flex items-center gap-2 cursor-pointer select-none mb-0">
                                  <input type="checkbox" checked={hasIssue}
                                    onChange={e => setSerialIssues(p => ({ ...p, [s]: e.target.checked ? ' ' : '' }))}
                                    style={{ accentColor: '#EF4444', width: 13, height: 13 }} />
                                  <span className="text-[11px] font-medium" style={{ color: hasIssue ? '#991B1B' : '#6B7280' }}>
                                    Received with issues (send to refurbishment)
                                  </span>
                                </label>
                                {hasIssue && (
                                  <textarea className="form-input text-[11px] mt-2 w-full" rows={2}
                                    placeholder="Describe issues e.g. keyboard keys missing, battery swollen, cracked hinge, dents on lid…"
                                    value={serialIssues[s] === ' ' ? '' : (serialIssues[s] ?? '')}
                                    onChange={e => setSerialIssues(p => ({ ...p, [s]: e.target.value || ' ' }))}
                                    style={{ resize: 'vertical' }} />
                                )}
                              </div>
                              {/* General notes */}
                              <input className="form-input text-[11px] py-1"
                                placeholder="Other notes e.g. cosmetic scratches on base…"
                                value={serialAccessoryNotes[s] ?? ''}
                                onChange={e => setSerialAccessoryNotes(p => ({ ...p, [s]: e.target.value }))} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-t3">No serials entered yet</p>
                  )}
                  {line.serials.length > 0 && line.serials.length < line.qtyReceived && (
                    <p className="text-[10px] mt-2" style={{ color: '#F59E0B' }}>
                      ⚠️ {line.qtyReceived - line.serials.length} more serial(s) needed
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <div className="flex items-center justify-between p-4 card">
          <div className="text-xs">
            {allComplete
              ? <span style={{ color: '#10B981' }}>✓ All items ready — validate to update stock</span>
              : <span style={{ color: '#F59E0B' }}>⚠️ Complete all serial numbers before validating</span>}
          </div>
          <div className="flex gap-2">
            <button className="btn-outline" onClick={() => { setSubView('form'); setActiveReceiptId(null) }}>Cancel</button>
            <button className="btn-primary" style={{ background: allComplete ? '#10B981' : '#D1D5DB', cursor: allComplete ? 'pointer' : 'not-allowed' }}
              onClick={handleValidateReceipt} disabled={!allComplete}>
              ✓ Validate GRN — Update Inventory
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PO FORM VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (subView === 'form' && activePO) {
    const canEdit        = activePO.status === 'draft' || activePO.status === 'sent'
    const canSend        = activePO.status === 'draft' && activePO.lines.length > 0
    const canConfirm     = activePO.status === 'sent'
    const hasDraftReceipt = receipts.some(r => r.poId === activePO.id && r.status === 'draft')
    const canReceive     = activePO.status === 'confirmed' && hasDraftReceipt
    const canReturn      = (activePO.status === 'received' || activePO.status === 'partial') && receipts.some(r => r.poId === activePO.id && r.status === 'validated')
    const canCreateBill  = (activePO.status === 'received' || activePO.status === 'partial') && !activePO.billId
    const canValidateBill = linkedBill?.status === 'draft'
    const canPay         = (linkedBill?.status === 'posted' || linkedBill?.status === 'overdue') && (linkedBill?.amountPaid ?? 0) < (linkedBill?.total ?? 0)
    const stepIdx        = linkedBill ? 4 : (PO_STEP_IDX[activePO.status] ?? 0)
    const poReceipts     = receipts.filter(r => r.poId === activePO.id)
    const poReturns      = purchaseReturns.filter(r => r.poId === activePO.id)
    const vendor         = contacts.find(c => c.id === activePO.vendorId)

    // Helper: render an inline-editable cell
    const EditableCell = ({ lineId, field, value, formatter }: { lineId: string; field: 'qty' | 'unitPrice' | 'taxRate'; value: number; formatter: (v: number) => string }) => {
      const isEditing = editCell?.lineId === lineId && editCell.field === field
      if (!canEdit) return <span className="font-mono text-xs">{formatter(value)}</span>
      if (isEditing) {
        return (
          <input
            autoFocus
            className="form-input text-xs text-center font-mono py-0.5"
            style={{ width: field === 'taxRate' ? 60 : 90, padding: '2px 6px' }}
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={() => commitCell(activePO.id, lineId, field, editVal)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitCell(activePO.id, lineId, field, editVal)
              if (e.key === 'Escape') setEditCell(null)
            }}
          />
        )
      }
      return (
        <span
          className="font-mono text-xs cursor-pointer rounded px-1 py-0.5 transition-all"
          style={{ background: '#F3F4F6', border: '1px dashed #D1D5DB' }}
          title="Click to edit"
          onClick={() => { setEditCell({ lineId, field }); setEditVal(String(value)) }}>
          {formatter(value)}
        </span>
      )
    }

    return (
      <div className="flex flex-col gap-3">
        {/* ── Header ── */}
        <div className="flex items-center gap-2 flex-wrap" style={{ background: '#FFFFFF', padding: '12px 0', borderBottom: '1px solid #F3F4F6' }}>
          <button className="btn-outline text-[11px] py-1 px-2.5" onClick={() => { setSubView('list'); setActiveId(null) }}>← Orders</button>
          <span className="text-sm font-bold text-t1">{activePO.ref}</span>
          <span className={`badge ${STATUS_BADGE[activePO.status]}`}>{STATUS_LABEL[activePO.status]}</span>
          {canEdit && <span className="text-[10px] text-t3">· Click any value in the table to edit</span>}
          <div className="ml-auto flex gap-2 flex-wrap">
            {canEdit && (
              <>
                <button className="btn-secondary text-[11px]" onClick={() => setShowImport(true)}>📥 Import Lines</button>
                <button className="btn-secondary text-[11px]" onClick={() => setShowAddLine(true)}>+ Add Product</button>
              </>
            )}
            {canSend         && <button className="btn-primary" style={{ background: '#F59E0B' }} onClick={() => sendPO(activePO.id)}>📧 Send RFQ</button>}
            {canConfirm      && <button className="btn-primary" onClick={() => confirmPO(activePO.id)}>✓ Confirm Order</button>}
            {canReceive      && <button className="btn-primary" style={{ background: '#10B981' }} onClick={openReceive}>📦 Process GRN</button>}
            {canCreateBill   && <button className="btn-primary" style={{ background: '#8B5CF6' }} onClick={() => createBillFromPO(activePO.id)}>🧾 Create Bill</button>}
            {canValidateBill && <button className="btn-primary" style={{ background: '#10B981' }} onClick={() => postInvoice(linkedBill!.id)}>✓ Validate Bill</button>}
            {canPay && (
              <button className="btn-primary" style={{ background: '#3B82F6' }}
                onClick={() => { setPayInvoiceId(linkedBill!.id); setPayAmount(String(linkedBill!.total - linkedBill!.amountPaid)); setShowPayModal(true) }}>
                💳 Register Payment
              </button>
            )}
            {canReturn && <button className="btn-outline text-[11px]" style={{ color: '#F59E0B', borderColor: '#FDE68A' }} onClick={openReturnForPO}>↩ Return to Vendor</button>}
            {canEdit   && <button className="btn-outline text-[11px]" style={{ color: '#EF4444', borderColor: '#FCA5A5' }} onClick={() => setDelId(activePO.id)}>Delete</button>}
          </div>
        </div>

        {/* Stepper */}
        <div className="card p-4">
          <StatusStepper steps={PO_STEPS} current={PO_STEPS[stepIdx]} />
        </div>

        <div className="flex flex-col lg:flex-row gap-3">
          {/* ── Left ── */}
          <div className="flex flex-col gap-3 flex-1 min-w-0">

            {/* Order header fields */}
            <div className="card overflow-hidden">
              <PanelHeader title={canEdit ? 'Request for Quotation' : 'Purchase Order'} />
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Vendor">
                  <div className="form-input text-xs text-t1">{activePO.vendorName}</div>
                </Field>
                <Field label="Order Date">
                  {canEdit
                    ? <input className="form-input" type="date" value={activePO.date}
                        onChange={e => updatePO(activePO.id, { date: e.target.value })} />
                    : <div className="form-input text-xs">{fmtDate(activePO.date)}</div>}
                </Field>
                <Field label="Expected Delivery">
                  {canEdit
                    ? <input className="form-input" type="date" value={activePO.expectedDate}
                        onChange={e => updatePO(activePO.id, { expectedDate: e.target.value })} />
                    : <div className="form-input text-xs">{fmtDate(activePO.expectedDate)}</div>}
                </Field>
                <Field label="Notes">
                  {canEdit
                    ? <input className="form-input text-xs" value={activePO.notes} placeholder="Internal notes…"
                        onChange={e => updatePO(activePO.id, { notes: e.target.value })} />
                    : <div className="form-input text-xs">{activePO.notes || '—'}</div>}
                </Field>
              </div>
            </div>

            {/* Products table */}
            <div className="card overflow-hidden">
              <PanelHeader title="Products" count={activePO.lines.length}>
                {canEdit && (
                  <div className="flex gap-1.5">
                    <button className="btn-secondary text-[10px] py-1" onClick={() => setShowImport(true)}>📥 Import CSV</button>
                    <button className="btn-primary text-[11px]" onClick={() => setShowAddLine(true)}>+ Add Product</button>
                  </div>
                )}
              </PanelHeader>

              <div className="overflow-x-auto w-full">
              <div className="min-w-[800px] flex flex-col">
              {/* Table header */}
              <div className="table-head" style={{ gridTemplateColumns: '32px 2fr 70px 110px 80px 90px 60px 80px 32px' }}>
                <span></span>
                <span>Product / Cost Account</span>
                <span>Qty {canEdit && <span className="text-[9px] text-t3 normal-case tracking-normal">(click)</span>}</span>
                <span>Unit Cost {canEdit && <span className="text-[9px] text-t3 normal-case tracking-normal">(click)</span>}</span>
                <span>VAT %</span>
                <span>Subtotal</span>
                <span>Serial?</span>
                <span>Received</span>
                <span></span>
              </div>

              {activePO.lines.length === 0
                ? (
                  <div className="flex flex-col items-center py-10 gap-2">
                    <span className="text-3xl">📦</span>
                    <p className="text-xs text-t3">No products yet</p>
                    {canEdit && (
                      <div className="flex gap-2">
                        <button className="btn-secondary text-[11px]" onClick={() => setShowImport(true)}>📥 Import from CSV</button>
                        <button className="btn-primary text-[11px]" onClick={() => setShowAddLine(true)}>+ Add Product</button>
                      </div>
                    )}
                  </div>
                )
                : activePO.lines.map(l => {
                    const p = products.find(x => x.id === l.productId)
                    const vatOn = l.taxRate > 0
                    const acct = l.accountCode ? accounts.find(a => a.code === l.accountCode) : null
                    const costAccounts = accounts.filter(a => a.type === 'expense' && a.isActive)
                    return (
                      <div key={l.id} className="table-row" style={{ gridTemplateColumns: '32px 2fr 70px 110px 80px 90px 60px 80px 32px' }}>
                        <span className="text-base">{p?.image ?? '📦'}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-xs text-t1 truncate">{l.productName}</p>
                          {canEdit ? (
                            <select
                              className="form-select text-[10px] py-0.5 mt-0.5"
                              style={{ maxWidth: 200 }}
                              value={l.accountCode ?? ''}
                              onChange={e => updatePOLine(activePO.id, l.id, { accountCode: e.target.value || undefined })}
                            >
                              <option value="">— no account —</option>
                              {costAccounts.map(a => (
                                <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-[10px]" style={{ color: acct ? '#6366F1' : '#9CA3AF' }}>
                              {acct ? `${acct.code} · ${acct.name}` : 'No account linked'}
                            </p>
                          )}
                        </div>

                        {/* Qty — inline editable */}
                        <EditableCell lineId={l.id} field="qty" value={l.qty} formatter={v => String(v)} />

                        {/* Unit Price — inline editable */}
                        <EditableCell lineId={l.id} field="unitPrice" value={l.unitPrice} formatter={fmtKes} />

                        {/* VAT — toggle or display */}
                        {canEdit ? (
                          <div className="flex items-center gap-1">
                            <input type="checkbox" checked={vatOn}
                              onChange={e => {
                                const rate = e.target.checked ? 16 : 0
                                updatePOLine(activePO.id, l.id, { taxRate: rate })
                              }}
                              style={{ accentColor: '#1B2762', width: 13, height: 13 }} />
                            <EditableCell lineId={l.id} field="taxRate" value={l.taxRate} formatter={v => `${v}%`} />
                          </div>
                        ) : (
                          <span className="text-[10px] text-t2">{vatOn ? `${l.taxRate}%` : 'No VAT'}</span>
                        )}

                        <span className="font-mono text-xs font-semibold text-t1">{fmtKes(l.subtotal)}</span>

                        <span>
                          {l.requiresSerial
                            ? <span className="text-[10px]" style={{ color: '#F59E0B' }}>🔖 Yes</span>
                            : <span className="text-[10px] text-t3">No</span>}
                        </span>

                        <span className="font-mono text-[11px]"
                          style={{ color: l.qtyReceived >= l.qty ? '#10B981' : l.qtyReceived > 0 ? '#F59E0B' : '#9CA3AF' }}>
                          {l.qtyReceived}/{l.qty}
                        </span>

                        {canEdit ? (
                          <button onClick={() => removePOLine(activePO.id, l.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 18, lineHeight: 1 }}>×</button>
                        ) : <span />}
                      </div>
                    )
                  })
              }

              {activePO.lines.length > 0 && (
                <div className="flex justify-end p-4 border-t" style={{ borderColor: '#F3F4F6' }}>
                  <div className="flex flex-col gap-1.5" style={{ minWidth: 240 }}>
                    <div className="flex justify-between text-xs">
                      <span className="text-t3">Subtotal</span>
                      <span className="font-mono text-t1">{fmtKes(activePO.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-t3">VAT</span>
                      <span className="font-mono text-t2">{activePO.taxTotal > 0 ? fmtKes(activePO.taxTotal) : '—'}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold pt-2 border-t" style={{ borderColor: '#E5E7EB' }}>
                      <span className="text-t1">Total</span>
                      <span className="font-mono" style={{ color: '#1B2762' }}>{fmtKes(activePO.total)}</span>
                    </div>
                  </div>
                </div>
              )}
              </div>
              </div>
            </div>

            {/* GRN history */}
            {poReceipts.length > 0 && (
              <div className="card overflow-hidden">
                <PanelHeader title="Goods Receipts (GRN)" count={poReceipts.length} />
                {poReceipts.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3 border-b text-xs" style={{ borderColor: '#F3F4F6' }}>
                    <div>
                      <p className="font-mono font-semibold" style={{ color: '#1B2762' }}>{r.ref}</p>
                      <p className="text-t3 mt-0.5">
                        {fmtDate(r.date)} · {LOCATIONS[r.destinationLocation].icon} {LOCATIONS[r.destinationLocation].name}
                        {r.status === 'validated' && ` · ${r.lines.reduce((a, l) => a + l.serials.length, 0)} serials`}
                      </p>
                    </div>
                    <Badge status={r.status === 'validated' ? 'active' : 'pending'} label={r.status === 'validated' ? '✓ Validated' : 'Pending'} />
                  </div>
                ))}
              </div>
            )}

            {/* Returns history */}
            {poReturns.length > 0 && (
              <div className="card overflow-hidden">
                <PanelHeader title="Returns" count={poReturns.length} />
                {poReturns.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3 border-b text-xs" style={{ borderColor: '#F3F4F6' }}>
                    <div>
                      <p className="font-mono font-semibold" style={{ color: '#F59E0B' }}>{r.ref}</p>
                      <p className="text-t3 mt-0.5">{fmtDate(r.date)} · {r.reason.replace('_', ' ')}</p>
                    </div>
                    <Badge status={r.status === 'confirmed' ? 'active' : 'pending'} label={r.status} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Right sidebar ── */}
          <div className="flex flex-col gap-3 w-full lg:w-[300px] flex-shrink-0">

            {/* Vendor card */}
            <div className="card overflow-hidden">
              <PanelHeader title="Vendor" />
              <div className="p-4 flex flex-col gap-2">
                {vendor ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                        style={{ background: 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                        {vendor.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-t1">{vendor.name}</p>
                        <p className="text-[10px] text-t3">{vendor.type === 'company' ? 'Company' : 'Individual'}</p>
                      </div>
                    </div>
                    {vendor.email    && <p className="text-[11px] text-t2">✉ {vendor.email}</p>}
                    {vendor.phone    && <p className="text-[11px] text-t2">📞 {vendor.phone}</p>}
                    {vendor.address  && <p className="text-[10px] text-t3">📍 {vendor.address}</p>}
                    {vendor.vatNumber && <p className="text-[10px] text-t3">PIN: {vendor.vatNumber}</p>}
                    <div className="grid grid-cols-2 gap-2 text-[10px] pt-2 border-t" style={{ borderColor: '#F3F4F6' }}>
                      <div>
                        <span className="text-t3">Credit Limit</span><br />
                        <span className="font-mono text-t1">{vendor.creditLimit ? fmtKes(vendor.creditLimit) : 'None'}</span>
                      </div>
                      <div>
                        <span className="text-t3">Terms</span><br />
                        <span className="text-t1">{vendor.paymentTerms || '—'}</span>
                      </div>
                      <div>
                        <span className="text-t3">Rating</span><br />
                        <span className="text-t1">{vendor.vendorRating ? `⭐ ${vendor.vendorRating.toFixed(1)}/5` : '—'}</span>
                      </div>
                    </div>
                    {vendor.bankDetails && (
                      <p className="text-[10px] text-t3 pt-2 border-t" style={{ borderColor: '#F3F4F6' }}>
                        🏦 {vendor.bankDetails}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-t3">{activePO.vendorName}</p>
                )}
              </div>
            </div>

            {/* Vendor bill */}
            <div className="card overflow-hidden">
              <PanelHeader title="Vendor Bill" />
              <div className="p-3">
                {linkedBill ? (
                  <div className="p-3 rounded-lg flex flex-col gap-2" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                    <p className="font-mono font-semibold text-xs" style={{ color: '#1B2762' }}>{linkedBill.ref}</p>
                    <div className="flex justify-between text-xs"><span className="text-t3">Total</span><span className="font-mono text-t1">{fmtKes(linkedBill.total)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-t3">Paid</span><span className="font-mono" style={{ color: '#10B981' }}>{fmtKes(linkedBill.amountPaid)}</span></div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-t1">Outstanding</span>
                      <span className="font-mono" style={{ color: linkedBill.total - linkedBill.amountPaid > 0 ? '#EF4444' : '#10B981' }}>
                        {fmtKes(linkedBill.total - linkedBill.amountPaid)}
                      </span>
                    </div>
                    <Badge status={linkedBill.status} size="xs" />
                  </div>
                ) : (
                  <p className="text-[11px] text-t3 text-center py-3">
                    {activePO.status === 'received' || activePO.status === 'partial'
                      ? 'Click "Create Bill" to generate the vendor invoice'
                      : 'Available after goods are received'}
                  </p>
                )}
              </div>
            </div>

            {/* Serial reminder */}
            {activePO.lines.some(l => l.requiresSerial) && (
              <div className="card p-3 text-xs" style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}>
                <p className="font-semibold mb-1.5" style={{ color: '#F59E0B' }}>🔖 Serial Tracking Required</p>
                {activePO.lines.filter(l => l.requiresSerial).map(l => (
                  <p key={l.id} className="text-t3 mb-0.5">• {l.productName} — {l.qty} unit(s)</p>
                ))}
                <p className="mt-2 text-t3">All serial numbers must be scanned during GRN validation.</p>
              </div>
            )}
          </div>
        </div>

        {/* Add product modal */}
        {showAddLine && (
          <Modal title="Add Product" onClose={() => setShowAddLine(false)} width={500}>
            <SearchPicker label="Product *" placeholder="Search purchasable products…" items={purchasableProds}
              onSelect={p => { setAddProd(p); setAddPrice(String(p.costPrice)) }}
              renderItem={p => (
                <div className="flex items-center gap-2">
                  <span className="text-lg">{p.image}</span>
                  <div>
                    <p className="font-medium text-xs text-t1">{p.name}</p>
                    <p className="text-[10px] text-t3">
                      {p.category} · Cost: {fmtKes(p.costPrice)}
                      {CATEGORY_CONFIG[p.category as CategoryId]?.serialRequired ? ' · 🔖 Serial' : ''}
                    </p>
                  </div>
                </div>
              )} />
            {addProd && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Quantity"><Input value={addQty} onChange={setAddQty} type="number" /></Field>
                  <Field label="Unit Cost (KES)"><Input value={addPrice} onChange={setAddPrice} type="number" /></Field>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
                  <input type="checkbox" checked={addVAT} onChange={e => setAddVAT(e.target.checked)}
                    style={{ accentColor: '#1B2762', width: 14, height: 14 }} />
                <span>Include VAT ({companySettings.vatRate}%)</span>
                  {addVAT && Number(addQty) > 0 && Number(addPrice) > 0 && (
                  <span className="ml-auto font-mono text-t3">+{fmtKes(Math.round(Number(addQty) * Number(addPrice) * (companySettings.vatRate / 100)))} VAT</span>
                  )}
                </label>
              </>
            )}
            {addProd && Number(addQty) > 0 && Number(addPrice) > 0 && (
              <div className="flex justify-between text-xs font-mono rounded px-3 py-2" style={{ background: '#F5F3FF', border: '1px solid #C4B5FD' }}>
                <span className="text-t3">Total incl. VAT</span>
                <span className="font-semibold" style={{ color: '#1B2762' }}>
                  {fmtKes(Number(addQty) * Number(addPrice) * (addVAT ? 1.16 : 1))}
                </span>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setShowAddLine(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddLine} disabled={!addProd}>Add Product</button>
            </div>
          </Modal>
        )}

        {delId && (
          <Confirm
            message={`Delete ${activePO.ref}? This cannot be undone.`}
            onConfirm={() => { deletePO(activePO.id); setDelId(null); setSubView('list'); setActiveId(null) }}
            onCancel={() => setDelId(null)}
          />
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN LIST VIEW
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col gap-3">

      {/* KPIs */}
      <div className="kpi-grid">
        <StatCard label="RFQs"            value={stats.rfqs}           sub="draft & sent"          color="#F59E0B" icon={<Fa icon={faClipboardCheck} />} onClick={() => { setMainView('orders'); setFilter('rfq') }} />
        <StatCard label="Purchase Orders" value={stats.activePOs}      sub="confirmed, in transit"  color="#3B82F6" icon={<Fa icon={faCartShopping} />} onClick={() => { setMainView('orders'); setFilter('po') }} />
        <StatCard label="Pending GRNs"    value={stats.pendingGRNs}    sub="awaiting validation"    color="#F59E0B" icon={<Fa icon={faBoxesStacked} />} onClick={() => setMainView('receipts')} />
        <StatCard label="Unpaid Bills"    value={fmtKes(stats.unpaid)} sub="outstanding payable"    color="#EF4444" icon={<Fa icon={faCreditCard} />} onClick={() => setMainView('bills')} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 items-center">
        {([
          ['orders',        '🛒 Orders'],
          ['receipts',      '📦 Receipts'],
          ['returns',       '↩ Returns'],
          ['bills',         '🧾 Bills'],
          ['tradein',       '🔄 Trade-In'],
        ] as [MainView, string][]).map(([v, label]) => {
          const count = v === 'orders' ? purchaseOrders.length
            : v === 'receipts' ? receipts.length
            : v === 'returns' ? purchaseReturns.length
            : v === 'tradein' ? (buyBacks.length + donations.length + clientExchanges.length)
            : vendorBills.length
          return (
            <button key={v} onClick={() => setMainView(v)}
              style={{
                background: mainView === v ? '#E8F3FA' : 'transparent',
                border: `1px solid ${mainView === v ? '#A8D4E8' : 'transparent'}`,
                borderRadius: 8, cursor: 'pointer',
                color: mainView === v ? '#1B2762' : '#6B7280',
                padding: '7px 14px', fontSize: 11, fontWeight: mainView === v ? 600 : 400,
                display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
              }}>
              {label} <span className="badge badge-gray text-[9px] ml-1">{count}</span>
            </button>
          )
        })}
        {/* Import button accessible from list view too */}
        <div className="ml-auto flex items-center">
          <button className="btn-secondary text-[11px] py-1.5"
            onClick={() => { setShowImport(true) }}>
            📥 Import PO from CSV
          </button>
        </div>
      </div>

      {/* ── ORDERS ── */}
      {mainView === 'orders' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Purchase Orders / RFQs" count={filteredPOs.length}>
            <div className="flex gap-1">
              {[{ v: 'all', label: 'All' }, { v: 'rfq', label: 'RFQs' }, { v: 'po', label: 'POs' }, { v: 'received', label: 'Received' }].map(f => (
                <button key={f.v} onClick={() => setFilter(f.v)}
                  className="px-2.5 py-1 rounded-md text-[10px] cursor-pointer transition-all"
                  style={{ background: filter === f.v ? '#1B2762' : '#F3F4F6', color: filter === f.v ? '#fff' : '#6B7280', border: 'none' }}>
                  {f.label}
                </button>
              ))}
            </div>
            <button className="btn-primary" onClick={() => setShowNewRFQ(true)}>+ New RFQ</button>
          </PanelHeader>
          <div className="overflow-x-auto w-full">
            <div className="min-w-[700px] flex flex-col">
          <div className="table-head" style={{ gridTemplateColumns: '90px 90px 1.6fr 100px 85px 80px 60px' }}>
            <span>Ref</span><span>Type</span><span>Vendor</span><span>Date</span><span>Total</span><span>Status</span><span></span>
          </div>
          {filteredPOs.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No orders found</p>
            : filteredPOs.map(po => {
                const isRFQ = po.status === 'draft' || po.status === 'sent'
                return (
                  <div key={po.id} className="table-row" style={{ gridTemplateColumns: '90px 90px 1.6fr 100px 85px 80px 60px' }}
                    onClick={() => { setActiveId(po.id); setSubView('form') }}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{po.ref}</span>
                    <span className="text-[10px]" style={{ color: isRFQ ? '#F59E0B' : '#3B82F6' }}>{isRFQ ? '📋 RFQ' : '🛒 PO'}</span>
                    <span className="font-medium text-t1">{po.vendorName}</span>
                    <span className="text-[11px] text-t3">{fmtDate(po.date)}</span>
                    <span className="font-mono text-[11px] font-semibold text-t1">{fmtKes(po.total)}</span>
                    <span className={`badge ${STATUS_BADGE[po.status]}`}>{STATUS_LABEL[po.status]}</span>
                    <button className="btn-outline text-[10px] py-0.5 px-2"
                      onClick={e => { e.stopPropagation(); setActiveId(po.id); setSubView('form') }}>Open</button>
                  </div>
                )
              })
          }
            </div>
          </div>
        </div>
      )}

      {/* ── RECEIPTS ── */}
      {mainView === 'receipts' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Goods Receipts (GRN)" count={receipts.length} />
          <div className="overflow-x-auto w-full">
            <div className="min-w-[650px] flex flex-col">
          <div className="table-head" style={{ gridTemplateColumns: '90px 90px 1.6fr 100px 100px 70px' }}>
            <span>Ref</span><span>PO</span><span>Vendor</span><span>Date</span><span>Location</span><span>Status</span>
          </div>
          {receipts.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No GRNs yet</p>
            : [...receipts].reverse().map(r => (
                <div key={r.id} className="table-row" style={{ gridTemplateColumns: '90px 90px 1.6fr 100px 100px 70px' }}>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{r.ref}</span>
                  <span className="font-mono text-[10px] text-t3">{r.poRef}</span>
                  <span className="text-t1">{r.vendorName}</span>
                  <span className="text-[11px] text-t3">{fmtDate(r.date)}</span>
                  <span className="text-[11px] text-t2">{LOCATIONS[r.destinationLocation].icon} {LOCATIONS[r.destinationLocation].name}</span>
                  <Badge status={r.status === 'validated' ? 'active' : 'pending'} label={r.status === 'validated' ? '✓ Done' : 'Pending'} />
                </div>
              ))
          }
            </div>
          </div>
        </div>
      )}

      {/* ── RETURNS ── */}
      {mainView === 'returns' && (() => {
        const uniqueVendors = Array.from(new Map(purchaseReturns.map(r => [r.vendorId, r.vendorName] as [string, string])))
        const filtered = purchaseReturns.filter(r => {
          if (retFilterStatus !== 'all' && r.status !== retFilterStatus) return false
          if (retFilterReason !== 'all' && r.reason !== retFilterReason) return false
          if (retFilterVendor !== 'all' && r.vendorId !== retFilterVendor) return false
          if (retDateFrom && r.date < retDateFrom) return false
          if (retDateTo   && r.date > retDateTo)   return false
          if (retSearchSerial.trim()) {
            const q = retSearchSerial.trim().toUpperCase()
            const hasSerial = r.lines.some(l => l.serialIds.some(sid => {
              const sn = serials.find(s => s.id === sid)
              return sn?.serial.includes(q)
            }))
            if (!hasSerial) return false
          }
          return true
        })
        return (
          <div className="flex flex-col gap-3">
            {/* Filters bar */}
            <div className="card p-3 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
                <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Search by serial</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs">🔍</span>
                  <input className="form-input pl-8 text-xs font-mono" placeholder="e.g. SN001…"
                    value={retSearchSerial} onChange={e => setRetSearchSerial(e.target.value)} />
                </div>
              </div>
              <div>
                <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Status</p>
                <div className="flex gap-1">
                  {[['all','All'],['draft','Draft'],['confirmed','Confirmed']].map(([v,l]) => (
                    <button key={v} onClick={() => setRetFilterStatus(v)}
                      className="px-2.5 py-1 rounded-md text-[10px] transition-all"
                      style={{ background: retFilterStatus === v ? '#1B2762' : '#F3F4F6', color: retFilterStatus === v ? '#fff' : '#6B7280', border: 'none', cursor: 'pointer' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Reason</p>
                <Select value={retFilterReason} onChange={setRetFilterReason}
                  options={[{ value: 'all', label: 'All reasons' }, ...REASON_OPTS.map(r => ({ value: r.value, label: r.label }))]} />
              </div>
              {uniqueVendors.length > 1 && (
                <div>
                  <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Vendor</p>
                  <Select value={retFilterVendor} onChange={setRetFilterVendor}
                    options={[{ value: 'all', label: 'All vendors' }, ...uniqueVendors.map(([id, name]) => ({ value: id, label: name }))]} />
                </div>
              )}
              <div className="flex gap-2">
                <div>
                  <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">From</p>
                  <input className="form-input text-xs py-1.5" type="date" value={retDateFrom} onChange={e => setRetDateFrom(e.target.value)} />
                </div>
                <div>
                  <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">To</p>
                  <input className="form-input text-xs py-1.5" type="date" value={retDateTo} onChange={e => setRetDateTo(e.target.value)} />
                </div>
              </div>
              {(retSearchSerial || retFilterStatus !== 'all' || retFilterReason !== 'all' || retFilterVendor !== 'all' || retDateFrom || retDateTo) && (
                <button className="btn-outline text-[10px] py-1.5 self-end"
                  onClick={() => { setRetSearchSerial(''); setRetFilterStatus('all'); setRetFilterReason('all'); setRetFilterVendor('all'); setRetDateFrom(''); setRetDateTo('') }}>
                  ✕ Clear
                </button>
              )}
            </div>

            <div className="card overflow-hidden">
              <PanelHeader title="Purchase Returns" count={filtered.length}>
                {filtered.length !== purchaseReturns.length && (
                  <span className="text-[10px] text-t3">{purchaseReturns.length - filtered.length} hidden by filters</span>
                )}
              </PanelHeader>
              <div className="overflow-x-auto w-full">
                <div className="min-w-[850px] flex flex-col">
              <div className="table-head" style={{ gridTemplateColumns: '85px 85px 1.2fr 90px 110px 120px 110px 80px' }}>
                <span>Ref</span><span>PO</span><span>Vendor</span><span>Date</span>
                <span>Reason</span><span>Collected By</span><span>Collection Date</span><span>Status</span>
              </div>
              {filtered.length === 0
                ? <p className="py-10 text-center text-xs text-t3">No returns match the filters</p>
                : filtered.map(r => {
                    const isExpanded = retExpandedId === r.id
                    return (
                      <div key={r.id}>
                        <div className="table-row cursor-pointer" style={{ gridTemplateColumns: '85px 85px 1.2fr 90px 110px 120px 110px 80px' }}
                          onClick={() => setRetExpandedId(isExpanded ? null : r.id)}>
                          <span className="font-mono text-[11px] font-semibold" style={{ color: '#F59E0B' }}>{r.ref}</span>
                          <span className="font-mono text-[10px] text-t3">{r.poRef}</span>
                          <span className="text-t1 text-xs">{r.vendorName}</span>
                          <span className="text-[11px] text-t3">{fmtDate(r.date)}</span>
                          <span className="text-[11px] text-t2">{REASON_OPTS.find(x => x.value === r.reason)?.label ?? r.reason}</span>
                          <span className="text-[11px]" style={{ color: r.collectedByName ? '#374151' : '#9CA3AF' }}>
                            {r.collectedByName ?? <span className="italic">Not logged</span>}
                          </span>
                          <span className="text-[11px] text-t3">{r.collectedDate ? fmtDate(r.collectedDate) : '—'}</span>
                          <Badge status={r.status === 'confirmed' ? 'active' : 'pending'} label={r.status} />
                        </div>
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1" style={{ background: '#FAFAFA', borderBottom: '1px solid #F3F4F6' }}>
                            <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 280px' }}>
                              {/* Lines table */}
                              <div>
                                <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-2">Items Returned</p>
                                <div className="flex flex-col gap-1.5">
                                  {r.lines.map((l, li) => {
                                    const lineSerials = l.serialIds.map(sid => serials.find(s => s.id === sid)).filter(Boolean)
                                    return (
                                      <div key={li} className="rounded-lg p-2.5" style={{ background: '#fff', border: '1px solid #E5E7EB' }}>
                                        <div className="flex items-center justify-between mb-1">
                                          <p className="text-xs font-medium text-t1">{l.productName}</p>
                                          <span className="text-[10px] font-mono text-t2">Qty: {l.qty}</span>
                                        </div>
                                        {lineSerials.length > 0 && (
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {lineSerials.map(sn => sn && (
                                              <div key={sn.id} className="flex flex-col gap-0.5 px-2 py-1 rounded"
                                                style={{ background: '#FEF9C3', border: '1px solid #FDE68A' }}>
                                                <span className="font-mono text-[10px] font-semibold" style={{ color: '#92400E' }}>{sn.serial}</span>
                                                {sn.accessories && sn.accessories.length > 0 && (
                                                  <span className="text-[9px]" style={{ color: '#78716C' }}>
                                                    📦 {sn.accessories.join(', ')}
                                                  </span>
                                                )}
                                                {sn.accessoryNotes && (
                                                  <span className="text-[9px] italic" style={{ color: '#9CA3AF' }}>{sn.accessoryNotes}</span>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                              {/* Pickup info */}
                              <div className="rounded-lg p-3" style={{ background: '#fff', border: '1px solid #E5E7EB' }}>
                                <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-2">Pickup / Dispatch</p>
                                {r.collectedByName ? (
                                  <div className="flex flex-col gap-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-t3">Collected by</span>
                                      <span className="font-medium text-t1">{r.collectedByName}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-t3">Collection date</span>
                                      <span className="text-t2">{r.collectedDate ? fmtDate(r.collectedDate) : '—'}</span>
                                    </div>
                                    {r.pickupNotes && (
                                      <div className="mt-1 p-2 rounded text-[10px] text-t2" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                                        {r.pickupNotes}
                                      </div>
                                    )}
                                    <button className="btn-outline text-[10px] py-1 mt-1"
                                      onClick={() => { setPickupReturnId(r.id); setPickupCollectedBy(r.collectedByUserId ?? ''); setPickupCollectedDate(r.collectedDate ?? new Date().toISOString().slice(0,10)); setPickupNotes(r.pickupNotes ?? ''); setShowPickupModal(true) }}>
                                      ✏ Edit Pickup Details
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center py-3 gap-2">
                                    <p className="text-[11px] text-t3 text-center">Pickup not yet logged</p>
                                    <button className="btn-primary text-[11px] py-1.5"
                                      onClick={() => { setPickupReturnId(r.id); setPickupCollectedBy(''); setPickupCollectedDate(new Date().toISOString().slice(0,10)); setPickupNotes(''); setShowPickupModal(true) }}>
                                      + Log Pickup
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
              }
                </div>
              </div>
            </div>
          </div>
        )
      })()}


      {/* Refurbishment has moved to Inventory module */}

      {/* ── BILLS ── */}
      {mainView === 'bills' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Vendor Bills" count={vendorBills.length} />
          <div className="overflow-x-auto w-full">
            <div className="min-w-[800px] flex flex-col">
          <div className="table-head" style={{ gridTemplateColumns: '90px 90px 1.4fr 100px 85px 85px 85px 90px' }}>
            <span>Ref</span><span>PO</span><span>Vendor</span><span>Due Date</span>
            <span>Total</span><span>Paid</span><span>Outstanding</span><span>Actions</span>
          </div>
          {vendorBills.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No vendor bills yet</p>
            : vendorBills.map(b => {
                const outstanding = b.total - b.amountPaid
                const isPaid = outstanding <= 0
                const linkedPORef = b.purchaseOrderId ? (purchaseOrders.find(p => p.id === b.purchaseOrderId)?.ref ?? '—') : '—'
                return (
                  <div key={b.id} className="table-row" style={{ gridTemplateColumns: '90px 90px 1.4fr 100px 85px 85px 85px 90px' }}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{b.ref}</span>
                    <span className="font-mono text-[10px] text-t3">{linkedPORef}</span>
                    <span className="text-t1">{b.partnerName}</span>
                    <span className="text-[11px] text-t3">{fmtDate(b.dueDate)}</span>
                    <span className="font-mono text-[11px] text-t1">{fmtKes(b.total)}</span>
                    <span className="font-mono text-[11px]" style={{ color: '#10B981' }}>{fmtKes(b.amountPaid)}</span>
                    <span className="font-mono text-[11px]" style={{ color: isPaid ? '#10B981' : '#EF4444' }}>{fmtKes(outstanding)}</span>
                    <div className="flex items-center gap-1.5">
                      {b.status === 'draft' && (
                        <button className="btn-primary text-[9px] py-0.5 px-2" style={{ background: '#10B981' }}
                          onClick={e => { e.stopPropagation(); postInvoice(b.id) }}>Validate</button>
                      )}
                      {(b.status === 'posted' || b.status === 'overdue') && outstanding > 0 && (
                        <button className="btn-primary text-[9px] py-0.5 px-2" style={{ background: '#3B82F6' }}
                          onClick={e => { e.stopPropagation(); setPayInvoiceId(b.id); setPayAmount(String(outstanding)); setShowPayModal(true) }}>
                          Pay
                        </button>
                      )}
                      <Badge status={b.status} size="xs" />
                    </div>
                  </div>
                )
              })
          }
            </div>
          </div>
        </div>
      )}

      {mainView === 'tradein' && <TradeIn />}

      {/* ── NEW RFQ MODAL ── */}
      {showNewRFQ && (
        <Modal title="New Request for Quotation"  
          onClose={() => { setShowNewRFQ(false); setNewVendorId(''); setNewVendorName('') }}>
          <SearchPicker label="Vendor *" placeholder="Search vendor…" items={vendors}
            onSelect={v => { setNewVendorId(v.id); setNewVendorName(v.name) }}
            renderItem={v => (
              <div>
                <p className="font-medium text-xs text-t1">{v.name}</p>
                <p className="text-[10px] text-t3">
                  {v.email}
                </p> 
              </div>
            )} />
          {newVendorId && (() => {
            const v = vendors.find(x => x.id === newVendorId)
            if (!v) return null
            return (
              <div className="p-3 rounded-lg text-xs" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                <p className="font-semibold text-t1 mb-2">{v.name}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-t3">
                  <div><strong>Credit Limit</strong><br />{v.creditLimit ? fmtKes(v.creditLimit) : 'None'}</div>
                  <div><strong>Terms</strong><br />{v.paymentTerms || '—'}</div>
                  <div><strong>Rating</strong><br />{v.vendorRating ? `${v.vendorRating.toFixed(1)}/5` : '—'}</div>
                </div>
              </div>
            )
          })()}
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => { setShowNewRFQ(false); setNewVendorId(''); setNewVendorName('') }}>Cancel</button>
            <button className="btn-primary" onClick={handleCreateRFQ}>Create RFQ →</button>
          </div>
        </Modal>
      )}

      {/* ── RETURN MODAL ── */}
      {showReturnModal && (
        <Modal title="Return to Vendor" subtitle="Select products and quantities to return" width={580} onClose={() => setShowReturnModal(false)}>
          <Field label="Return Reason">
            <Select value={returnReason} onChange={v => setReturnReason(v as any)} options={REASON_OPTS} />
          </Field>
          <Divider label="Products to return" />
          {returnLines.map((l, idx) => (
            <div key={idx} className="p-3 rounded-lg mb-2" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-t1">{l.productName}</p>
                {!l.requiresSerial && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-t3">Qty:</span>
                    <input className="form-input w-16 text-center text-xs py-1" type="number" value={l.qty}
                      onChange={e => setReturnLines(p => p.map((x, i) => i !== idx ? x : { ...x, qty: e.target.value }))} />
                  </div>
                )}
              </div>
              {l.requiresSerial && (
                <div>
                  <div className="flex gap-2 mb-2">
                    <input className="form-input flex-1 font-mono text-sm" placeholder="Scan serial to return…"
                      value={returnScanInput[idx] ?? ''}
                      onChange={e => setReturnScanInput(p => ({ ...p, [idx]: e.target.value.toUpperCase() }))}
                      onKeyDown={e => { if (e.key === 'Enter') { addReturnSerial(idx, returnScanInput[idx] ?? ''); setReturnScanInput(p => ({ ...p, [idx]: '' })) } }} />
                    <button className="btn-outline text-[11px]" onClick={() => addReturnSerial(idx, returnScanInput[idx] ?? '')}>Add</button>
                  </div>
                  {l.serials.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {l.serials.map(s => {
                        const sn = serials.find(x => x.serial === s)
                        return (
                          <div key={s} className="flex flex-col gap-0.5 px-2 py-1 rounded-lg text-[11px] font-mono"
                            style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
                            <div className="flex items-center gap-1">
                              {s}
                              <button onClick={() => setReturnLines(p => p.map((x, i) => i !== idx ? x : { ...x, serials: x.serials.filter(s2 => s2 !== s) }))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 12 }}>×</button>
                            </div>
                            {sn?.accessories && sn.accessories.length > 0 && (
                              <span className="text-[9px] font-sans" style={{ color: '#92400E' }}>
                                📦 {sn.accessories.join(', ')}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <Divider label="Pickup / dispatch details" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Collected by (who takes it to vendor)">
              <Select value={returnCollectedBy} onChange={setReturnCollectedBy}
                options={[{ value: '', label: '— Select staff member —' }, ...users.map(u => ({ value: u.id, label: u.name }))]} />
            </Field>
            <Field label="Collection date">
              <input className="form-input" type="date" value={returnCollectedDate} onChange={e => setReturnCollectedDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Pickup notes (optional)">
            <input className="form-input text-xs" value={returnPickupNotes} placeholder="e.g. Handed to vendor reception, got receipt…"
              onChange={e => setReturnPickupNotes(e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => setShowReturnModal(false)}>Cancel</button>
            <button className="btn-primary" style={{ background: '#F59E0B' }} onClick={handleConfirmReturn}>↩ Confirm Return</button>
          </div>
        </Modal>
      )}

      {/* ── LOG PICKUP MODAL ── */}
      {showPickupModal && (
        <Modal title="Log Return Pickup" subtitle="Record who took the goods back to the vendor" width={440}
          onClose={() => setShowPickupModal(false)}>
          <Field label="Collected by *">
            <Select value={pickupCollectedBy} onChange={setPickupCollectedBy}
              options={[{ value: '', label: '— Select staff member —' }, ...users.map(u => ({ value: u.id, label: u.name }))]} />
          </Field>
          <Field label="Collection date *">
            <input className="form-input" type="date" value={pickupCollectedDate} onChange={e => setPickupCollectedDate(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className="form-input text-xs" value={pickupNotes} placeholder="e.g. Handed to reception, received acknowledgement slip…"
              onChange={e => setPickupNotes(e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => setShowPickupModal(false)}>Cancel</button>
            <button className="btn-primary"
              onClick={() => {
                if (!pickupCollectedBy) { showToast('Select who collected the return', 'error'); return }
                const u = users.find(x => x.id === pickupCollectedBy)
                logReturnPickup(pickupReturnId, pickupCollectedBy, u?.name ?? pickupCollectedBy, pickupCollectedDate, pickupNotes || undefined)
                setShowPickupModal(false)
              }}>
              ✓ Save Pickup Details
            </button>
          </div>
        </Modal>
      )}

      {/* ── PAYMENT MODAL ── */}
      {showPayModal && (() => {
        const bill = invoices.find(i => i.id === payInvoiceId)
        if (!bill) return null
        const outstanding = bill.total - bill.amountPaid
        return (
          <Modal title="Register Payment" width={380} onClose={() => { setShowPayModal(false); setPayAmount('') }}>
            <div className="p-3 rounded-lg text-xs mb-3" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
              <p className="font-mono font-semibold text-t1">{bill.ref}</p>
              <p className="text-t3 mt-1">{bill.partnerName}</p>
              <div className="flex justify-between mt-2"><span className="text-t3">Total</span><span className="font-mono text-t1">{fmtKes(bill.total)}</span></div>
              <div className="flex justify-between mt-1"><span className="text-t3">Already Paid</span><span className="font-mono" style={{ color: '#10B981' }}>{fmtKes(bill.amountPaid)}</span></div>
              <div className="flex justify-between mt-1 font-semibold"><span className="text-t1">Outstanding</span><span className="font-mono" style={{ color: '#EF4444' }}>{fmtKes(outstanding)}</span></div>
            </div>
            <Field label="Payment Amount (KES)"><Input value={payAmount} onChange={setPayAmount} type="number" /></Field>
          <Field label="Bank Account">
            <Select value={payBankAccountId} onChange={setPayBankAccountId} options={[
              { value: '', label: '— Select Bank Account —' },
              ...bankAccounts.filter(a => a.active).map(a => ({ value: a.id, label: a.name }))
            ]} />
          </Field>
          <Field label="Payment Method">
            <Select value={payMethod} onChange={setPayMethod} options={[
              { value: 'bank',   label: '🏦 Bank Transfer' },
              { value: 'mpesa',  label: '📱 M-Pesa' },
              { value: 'cash',   label: '💵 Cash' },
              { value: 'cheque', label: '📝 Cheque' },
            ]} />
          </Field>
          {payMethod === 'cheque' && (
            <Field label="Cheque Number"><Input value={payReference} onChange={setPayReference} placeholder="e.g. 000123" /></Field>
          )}
          {payMethod !== 'cheque' && payMethod !== 'cash' && (
            <Field label="Transaction Reference"><Input value={payReference} onChange={setPayReference} placeholder="e.g. MPESA/Bank Ref" /></Field>
          )}
            <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => { setShowPayModal(false); setPayAmount(''); setPayReference(''); setPayBankAccountId('') }}>Cancel</button>
              <button className="btn-primary" style={{ background: '#3B82F6' }}
                onClick={() => {
                  const amt = Number(payAmount)
                  if (!amt || amt <= 0) { showToast('Enter a valid amount', 'error'); return }
                  if (amt > outstanding + 0.01) { showToast(`Exceeds outstanding (${fmtKes(outstanding)})`, 'error'); return }
                registerPayment(payInvoiceId, amt, payMethod, payBankAccountId, payReference)
                setShowPayModal(false); setPayAmount(''); setPayReference(''); setPayBankAccountId('')
                }}>
                💳 Register Payment
              </button>
            </div>
          </Modal>
        )
      })()}

      {/* ── CSV IMPORT MODAL ── */}
      {showImport && (
        <Modal title="Import PO Lines from CSV" subtitle="Upload a CSV file to bulk-add products to a purchase order" width={720}
          onClose={() => { setShowImport(false); setImportRows([]) }}>

          {/* Step 1 — if no active PO, pick vendor */}
          {!activeId && (
            <div className="p-3 rounded-lg" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
              <p className="text-xs font-semibold text-t1 mb-2">Step 1 — Select vendor for new PO</p>
              <SearchPicker label="Vendor *" placeholder="Search vendor…" items={vendors}
                onSelect={v => { setImportVendorId(v.id); setImportVendorName(v.name) }}
                renderItem={v => (
                  <div><p className="text-xs font-medium text-t1">{v.name}</p>
                    <p className="text-[10px] text-t3">{v.email}</p>
                  </div>
                )} />
            </div>
          )}
          {activeId && activePO && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
              <span style={{ color: '#10B981' }}>✓</span>
              <span className="text-t1">Lines will be added to <strong>{activePO.ref}</strong> — {activePO.vendorName}</span>
            </div>
          )}

          {/* Template download */}
          <div className="flex items-center justify-between px-4 py-3 rounded-lg" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
            <div>
              <p className="text-xs font-semibold text-t1">Download Import Template</p>
              <p className="text-[10px] text-t3 mt-0.5">CSV format · Opens in Excel, Google Sheets, LibreOffice</p>
            </div>
            <button className="btn-secondary text-[11px]" onClick={downloadTemplate}>⬇ Download Template.csv</button>
          </div>

          {/* Template column guide */}
          <div className="text-[10px] text-t3 px-1">
            <p className="font-medium text-t2 mb-1">Required columns:</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Product Name', 'Must match a product in the system, or will be added as-is'],
                ['Quantity', 'Positive integer'],
                ['Unit Price (KES)', 'Positive number, no commas'],
                ['Tax Rate (%)', '0–100 (use 16 for standard VAT)'],
                ['Specifications', 'Optional — e.g. "Intel i5, 8GB RAM, 512GB SSD" (use for laptops, desktops, printers)'],
                ['Notes', 'Optional — ignored on import'],
              ].map(([col, hint]) => (
                <div key={col} className="p-2 rounded" style={{ background: '#F3F4F6' }}>
                  <p className="font-semibold text-t1">{col}</p>
                  <p className="text-t3 mt-0.5">{hint}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div
            className="rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
            style={{
              border: `2px dashed ${isDragging ? '#1B2762' : '#D1D5DB'}`,
              background: isDragging ? '#E8F3FA' : '#F9FAFB',
              padding: '32px 24px',
              minHeight: 120,
            }}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}>
            <span className="text-3xl">{isDragging ? '📂' : '📄'}</span>
            <p className="text-sm font-semibold text-t1">
              {isDragging ? 'Drop to upload' : 'Drop CSV file here or click to browse'}
            </p>
            <p className="text-[11px] text-t3">Accepts .csv files — Excel files must be saved as CSV first</p>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileInput} />
          </div>

          {/* Preview table */}
          {importRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-t1">Preview — {importRows.length} row(s)</p>
                <div className="flex gap-3 text-[10px]">
                  <span style={{ color: '#10B981' }}>✓ {importRows.filter(r => r.status === 'ok').length} matched</span>
                  <span style={{ color: '#F59E0B' }}>⚠ {importRows.filter(r => r.status === 'warn').length} unmatched</span>
                  <span style={{ color: '#EF4444' }}>✕ {importRows.filter(r => r.status === 'error').length} errors</span>
                </div>
              </div>

              {/* Preview header */}
              <div className="grid text-[10px] font-medium text-t3 uppercase tracking-wider px-3 py-1.5 rounded"
                style={{ gridTemplateColumns: '24px 1.4fr 50px 100px 50px 1.6fr 100px', background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                <span></span><span>Product</span><span>Qty</span><span>Unit Price</span><span>VAT</span><span>Cost Account</span><span>Status</span>
              </div>

              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {importRows.map((row, i) => {
                  const rowAcct = row.accountCode ? accounts.find(a => a.code === row.accountCode) : null
                  return (
                  <div key={i} className="grid items-center text-xs px-3 py-2 rounded"
                    style={{
                      gridTemplateColumns: '24px 1.4fr 50px 100px 50px 1.6fr 100px',
                      background: row.status === 'error' ? '#FEF2F2' : row.status === 'warn' ? '#FFFBEB' : '#F0FDF4',
                      border: `1px solid ${row.status === 'error' ? '#FECACA' : row.status === 'warn' ? '#FDE68A' : '#BBF7D0'}`,
                    }}>
                    <span>{row.status === 'ok' ? '✓' : row.status === 'warn' ? '⚠' : '✕'}</span>
                    <div className="min-w-0">
                      <p className="font-medium text-t1 truncate">{row.productName || row.raw['Product Name'] || '—'}</p>
                      {row.status !== 'error' && row.requiresSerial && <p className="text-[9px]" style={{ color: '#F59E0B' }}>🔖 Serial tracking</p>}
                    </div>
                    <span className="font-mono">{row.status !== 'error' ? row.qty : '—'}</span>
                    <span className="font-mono">{row.status !== 'error' ? fmtKes(row.unitPrice) : '—'}</span>
                    <span className="text-t2">{row.status !== 'error' ? `${row.taxRate}%` : '—'}</span>
                    {row.status !== 'error' ? (
                      <select
                        className="form-select text-[10px] py-0.5"
                        style={{ maxWidth: '100%' }}
                        value={row.accountCode ?? ''}
                        onChange={e => setImportRowAccount(i, e.target.value)}
                      >
                        <option value="">— no account —</option>
                        {accounts.filter(a => a.type === 'expense' && a.isActive).map(a => (
                          <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                        ))}
                      </select>
                    ) : <span />}
                    <span className="text-[10px]" style={{
                      color: row.status === 'ok' ? '#10B981' : row.status === 'warn' ? '#F59E0B' : '#EF4444'
                    }}>{row.message}</span>
                  </div>
                  )
                })}
              </div>

              {importRows.some(r => r.status === 'warn') && (
                <p className="text-[10px] text-t3 px-1">
                  ⚠ Unmatched products will be added with the name as entered. You can edit them after import.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-between items-center pt-1">
            <button className="btn-outline" onClick={() => { setShowImport(false); setImportRows([]) }}>Cancel</button>
            <div className="flex gap-2">
              {importRows.length > 0 && (
                <button className="btn-outline" onClick={() => setImportRows([])}>Clear</button>
              )}
              <button
                className="btn-primary"
                disabled={!importRows.length || importRows.every(r => r.status === 'error') || (!activeId && !importVendorId)}
                style={{ opacity: (!importRows.length || importRows.every(r => r.status === 'error') || (!activeId && !importVendorId)) ? 0.5 : 1 }}
                onClick={handleConfirmImport}>
                ✓ Import {importRows.filter(r => r.status !== 'error').length} Line(s)
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
