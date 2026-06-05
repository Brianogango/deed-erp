'use client'
import { useState, useRef, useCallback, useMemo } from 'react'
import { useApp, Receipt, LOCATIONS, LocationId, CATEGORY_CONFIG, CategoryId, fmtKes, fmtDate, POLine, Account } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Confirm, StatCard, PanelHeader, StatusStepper, SearchPicker, Divider, TabContent } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faClipboardCheck, faCartShopping, faBoxesStacked, faCreditCard } from '@fortawesome/free-solid-svg-icons'
import { printSerialLabels, printProductLabels } from '@/lib/product-label'
import TradeIn from './TradeIn'
import { PurchaseProvider } from './purchase/PurchaseContext'
import PurchaseOrdersTab from './purchase/PurchaseOrdersTab'
import PurchaseReceiptsTab from './purchase/PurchaseReceiptsTab'
import PurchaseBillsTab from './purchase/PurchaseBillsTab'
import PurchaseReturnsTab from './purchase/PurchaseReturnsTab'
import POFormView from './purchase/POFormView'
import { readGuardedImageAsDataUrl, validateImageUpload } from '@/lib/client-image-guard'

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
const REQUIRED_CSV_COLS = ['Product Name', 'Quantity', 'Unit Price (KES)']

function parseCSV(text: string): { rows: Record<string, string>[]; headerError?: string } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { rows: [], headerError: 'File has no data rows' }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const missing = REQUIRED_CSV_COLS.filter(c => !headers.includes(c))
  if (missing.length) return { rows: [], headerError: `Missing required columns: ${missing.join(', ')}` }
  const rows = lines.slice(1, 501).map(row => {  // cap at 500 rows
    const vals = row.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  }).filter(r => Object.values(r).some(v => v))
  return { rows }
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
    validateReceipt, deletePO, createBillFromPO, revertPOToDraft,
    postInvoice, registerPayment,
    createPurchaseReturn, addReturnLine, confirmPurchaseReturn, logReturnPickup,
    showToast, companySettings, addContact,
  } = useApp()

  const [mainView, setMainView] = useState<MainView>('orders')
  const [subView,  setSubView]  = useState<SubView>('list')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filter,   setFilter]   = useState('all')

  // ── New RFQ ────────────────────────────────────────────────────────────────
  const [showNewRFQ,    setShowNewRFQ]    = useState(false)
  const [newVendorId,   setNewVendorId]   = useState('')
  const [newVendorName, setNewVendorName] = useState('')
  const [showNewVendorModal, setShowNewVendorModal] = useState(false)
  const [newVendorForm, setNewVendorForm] = useState({ name: '', email: '', phone: '', address: '', vatNumber: '', paymentTermsDays: '30', creditLimit: '' })

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
  
  // ── Document scanning (AI OCR) ─────────────────────────────────────────────
  const [showScanModal, setShowScanModal] = useState(false)
  const [scanFile, setScanFile] = useState<File | null>(null)
  const [isScanningScan, setIsScanningScan] = useState(false)
  const scanFileRef = useRef<HTMLInputElement>(null)

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


  // ── Delete ─────────────────────────────────────────────────────────────────
  const [delId, setDelId] = useState<string | null>(null)

  // ── Derived ────────────────────────────────────────────────────────────────
  const vendors          = useMemo(() => contacts.filter(c => c.isVendor), [contacts])
  const purchasableProds = useMemo(() => products.filter(p => p.canBePurchased && p.isActive), [products])
  const vendorBills      = useMemo(() => invoices.filter(i => i.type === 'vendor_bill').sort((a, b) => b.date.localeCompare(a.date)), [invoices])

  const activePO      = useMemo(() => purchaseOrders.find(p => p.id === activeId) ?? null, [purchaseOrders, activeId])
  const activeReceipt = useMemo(() => receipts.find(r => r.id === activeReceiptId) ?? null, [receipts, activeReceiptId])
  const linkedBill    = useMemo(() => activePO?.billId ? (invoices.find(i => i.id === activePO.billId) ?? null) : null, [activePO, invoices])

  const filteredPOs = useMemo(() => purchaseOrders.filter(po => {
    if (filter === 'rfq') return po.status === 'draft' || po.status === 'sent'
    if (filter === 'po')  return po.status === 'confirmed' || po.status === 'partial' || po.status === 'received'
    return filter === 'all' || po.status === filter
  }), [purchaseOrders, filter])

  const currentUser = useMemo(() => users.find(u => u.id === currentUserId), [users, currentUserId])

  const stats = useMemo(() => ({
    rfqs:        purchaseOrders.filter(p => p.status === 'draft' || p.status === 'sent').length,
    activePOs:   purchaseOrders.filter(p => p.status === 'confirmed' || p.status === 'partial').length,
    pendingGRNs: receipts.filter(r => r.status === 'draft').length,
    unpaid:      vendorBills.filter(b => b.amountPaid < b.total && b.status !== 'cancelled').reduce((s, b) => s + (b.total - b.amountPaid), 0),
  }), [purchaseOrders, receipts, vendorBills])

  // ── Create RFQ ─────────────────────────────────────────────────────────────
  const handleCreateRFQ = () => {
    if (!newVendorId) { showToast('Select a vendor', 'error'); return }
    const po = createPO(newVendorId, newVendorName)
    setShowNewRFQ(false); setNewVendorId(''); setNewVendorName('')
    setActiveId(po.id); setSubView('form')
  }

  const handleCreateVendorForRFQ = async () => {
    if (!newVendorForm.name || !newVendorForm.email || !newVendorForm.phone) {
      showToast('Name, email, and phone are required', 'error'); return
    }
    try {
      const vendor = await addContact({
        type: 'company', name: newVendorForm.name, email: newVendorForm.email,
        phone: newVendorForm.phone, address: newVendorForm.address || '',
        isCustomer: false, isVendor: true, tags: [],
        vatNumber: newVendorForm.vatNumber,
        paymentTermsDays: Number(newVendorForm.paymentTermsDays) || 30,
        creditLimit: Number(newVendorForm.creditLimit) || 0,
      })
      setNewVendorId(vendor.id); setNewVendorName(vendor.name)
      setShowNewVendorModal(false)
      setNewVendorForm({ name: '', email: '', phone: '', address: '', vatNumber: '', paymentTermsDays: '30', creditLimit: '' })
    } catch { /* error shown by addContact */ }
  }

  // ── Add single line ────────────────────────────────────────────────────────
  const handleAddLine = () => {
    if (!addProd || !activeId) return
    addPOLine(activeId, addProd, Number(addQty) || 1, Number(addPrice) || addProd.costPrice, addVAT ? (addProd.taxRate || 16) : 0)
    setShowAddLine(false); setAddProd(null); setAddQty('1'); setAddPrice(''); setAddVAT(false)
  }

  const readFileAsDataUrl = (file: File) => readGuardedImageAsDataUrl(file, { label: 'Purchase document image', maxBytes: 8 * 1024 * 1024 })

  const normaliseMatchText = (value: string) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const findScannedProductMatch = (name: string) => {
    const needle = normaliseMatchText(name)
    if (!needle) return null

    const exact = purchasableProds.find(p => {
      const productName = normaliseMatchText(p.name)
      const sku = normaliseMatchText(p.sku ?? '')
      return productName === needle || (!!sku && sku === needle)
    })
    if (exact) return exact

    const contained = purchasableProds.find(p => {
      const productName = normaliseMatchText(p.name)
      const sku = normaliseMatchText(p.sku ?? '')
      return (needle.length >= 4 && productName.includes(needle)) || (productName.length >= 4 && needle.includes(productName)) || (!!sku && needle.includes(sku))
    })
    if (contained) return contained

    const tokens = needle.split(' ').filter(t => t.length >= 3)
    if (!tokens.length) return null

    let best: typeof purchasableProds[number] | null = null
    let bestScore = 0
    for (const product of purchasableProds) {
      const haystack = normaliseMatchText([product.name, product.sku ?? '', product.category ?? ''].join(' '))
      const score = tokens.filter(token => haystack.includes(token)).length / tokens.length
      if (score > bestScore) { best = product; bestScore = score }
    }

    return bestScore >= 0.6 ? best : null
  }

  async function handleScanFile(file: File | null) {
    if (!file) return
    if (!activeId || !activePO) { showToast('Open a purchase order first', 'error'); return }

    try {
      await validateImageUpload(file, { label: 'Purchase document image', maxBytes: 8 * 1024 * 1024 })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Please upload a valid JPG, PNG, or WebP image', 'error')
      if (scanFileRef.current) scanFileRef.current.value = ''
      return
    }

    setScanFile(file)
    setIsScanningScan(true)

    try {
      const imageBase64 = await readFileAsDataUrl(file)
      const response = await fetch('/api/scan-purchase-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType: file.type }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not scan purchase document')

      const scannedLines = Array.isArray(data.lines) ? data.lines : []
      const mapped = scannedLines.map((line: any) => {
        const match = findScannedProductMatch(String(line.productName ?? ''))
        const catCfg = match ? (CATEGORY_CONFIG[match.category as CategoryId] ?? { serialRequired: false }) : { serialRequired: false }
        return {
          productId: match?.id ?? '',
          productName: match?.name ?? String(line.productName ?? 'Scanned purchase item').slice(0, 120),
          qty: Number(line.qty) > 0 ? Number(line.qty) : 1,
          unitPrice: Number(line.unitPrice) >= 0 ? Number(line.unitPrice) : 0,
          taxRate: Number(line.taxRate) >= 0 && Number(line.taxRate) <= 100 ? Number(line.taxRate) : 0,
          requiresSerial: match ? catCfg.serialRequired : false,
          accountCode: match?.costAccountCode,
        }
      }).filter((line: any) => line.productName && line.qty > 0)

      if (!mapped.length) throw new Error('No purchase line items were extracted')

      bulkAddPOLines(activeId, mapped as any)

      const updates: Record<string, string> = {}
      if (data.date && /^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) updates.date = String(data.date)

      const vendorName = String(data.vendorName ?? '').trim()
      if (vendorName && !activePO.vendorId) {
        const vendorNeedle = normaliseMatchText(vendorName)
        const vendorMatch = vendors.find(v => {
          const vendorHaystack = normaliseMatchText(v.name)
          return vendorHaystack === vendorNeedle || vendorHaystack.includes(vendorNeedle) || vendorNeedle.includes(vendorHaystack)
        })
        if (vendorMatch) {
          updates.vendorId = vendorMatch.id
          updates.vendorName = vendorMatch.name
        }
      }

      const reference = String(data.reference ?? '').trim()
      if (reference && !activePO.notes?.includes(reference)) {
        updates.notes = [activePO.notes, 'Scanned document ref: ' + reference].filter(Boolean).join(' · ')
      }
      if (Object.keys(updates).length > 0) updatePO(activeId, updates as any)

      setShowScanModal(false)
      setScanFile(null)
      showToast('OCR added ' + mapped.length + ' purchase line(s)', 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Purchase document scan failed'
      showToast(msg, 'error')
    } finally {
      setIsScanningScan(false)
    }
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

  const handlePrintReceivedLabels = () => {
    const serialItems: Array<{ serial: string; barcode?: string; productName: string; sku: string; salePrice?: number; category?: string }> = []
    for (const line of grnLines) {
      const prod = products.find(p => p.id === line.productId)
      if (line.requiresSerial) {
        line.serials.forEach(s => serialItems.push({ serial: s, barcode: s, productName: line.productName, sku: prod?.sku ?? '', salePrice: prod?.salePrice, category: prod?.category }))
      } else if (line.qtyReceived > 0 && prod) {
        printProductLabels(prod, line.qtyReceived)
      }
    }
    if (serialItems.length) printSerialLabels(serialItems)
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
      const { rows: parsed, headerError } = parseCSV(text)
      if (headerError) { showToast(headerError, 'error'); return }
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

        // Block if serials provided but count doesn't match qty
        if (importedSerials.length > 0 && importedSerials.length !== qty) {
          const serialWarning = `${importedSerials.length} serial(s) provided for qty ${qty}`
          const errMsg = `Serial count mismatch: ${importedSerials.length} serial(s) for qty ${qty}`
          if (match) return { raw, ...blank, productId: match.id, productName: match.name, qty, unitPrice: price, taxRate: tax, requiresSerial: catCfg.serialRequired, accountCode: match.costAccountCode, status: 'error' as const, message: errMsg, serialWarning }
          return { raw, ...blank, productId: '', productName: name, qty, unitPrice: price, taxRate: tax, requiresSerial, accountCode: undefined, status: 'error' as const, message: errMsg, serialWarning }
        }

        if (match) {
          return { raw, ...blank, productId: match.id, productName: match.name, qty, unitPrice: price, taxRate: tax, requiresSerial: catCfg.serialRequired, accountCode: match.costAccountCode, status: 'ok' as const, message: `Matched: ${match.name}` }
        }
        return { raw, ...blank, productId: '', productName: name, qty, unitPrice: price, taxRate: tax, requiresSerial, accountCode: undefined, status: 'warn' as const, message: 'Product not found in system — will add as-is' }
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
                      onChange={e => {
                        const val = Number(e.target.value) || 0
                        if (val > line.qtyExpected) {
                          showToast(`Cannot receive more than ${line.qtyExpected} units for ${line.productName}`, 'error')
                        }
                        setGrnLines(prev => prev.map((l, i) =>
                          i !== idx ? l : { ...l, qtyReceived: Math.min(val, l.qtyExpected), serials: [] }
                        ))
                      }} />
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

        <div className="flex items-center justify-between p-4 card flex-wrap gap-3">
          <div className="text-xs">
            {allComplete
              ? <span style={{ color: '#10B981' }}>✓ All items ready — validate to update stock</span>
              : <span style={{ color: '#F59E0B' }}>⚠️ Complete all serial numbers before validating</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-outline" onClick={() => { setSubView('form'); setActiveReceiptId(null) }}>Cancel</button>
            <button className="btn-outline text-[11px] py-1.5 px-3"
              style={{ borderColor: '#1B2762', color: '#1B2762' }}
              disabled={grnLines.every(l => l.serials.length === 0 && l.qtyReceived === 0)}
              onClick={handlePrintReceivedLabels}>
              🖨 Print Labels
            </button>
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
  // MAIN LIST VIEW
  // ══════════════════════════════════════════════════════════════════════════

  // Build context value — all state + handlers made available to tab subcomponents
  const purchaseCtxValue = {
    // Store
    purchaseOrders, contacts, products, receipts, invoices, purchaseReturns, serials,
    users, bankAccounts, currentUserId, accounts, companySettings, addContact,
    // Store actions
    createPO, updatePO, addPOLine, removePOLine, updatePOLine, bulkAddPOLines,
    sendPO, confirmPO, validateReceipt, deletePO, createBillFromPO, revertPOToDraft,
    postInvoice, registerPayment, createPurchaseReturn, addReturnLine, confirmPurchaseReturn, logReturnPickup, showToast,
    // View state
    mainView, setMainView, subView, setSubView, activeId, setActiveId, filter, setFilter,
    // Derived
    vendors, purchasableProds, vendorBills, activePO, activeReceipt, linkedBill, filteredPOs, currentUser, stats,
    // RFQ
    showNewRFQ, setShowNewRFQ, newVendorId, setNewVendorId, newVendorName, setNewVendorName,
    showNewVendorModal, setShowNewVendorModal, newVendorForm, setNewVendorForm,
    handleCreateRFQ, handleCreateVendorForRFQ,
    // Add line
    showAddLine, setShowAddLine, addProd, setAddProd, addQty, setAddQty, addPrice, setAddPrice, addVAT, setAddVAT, handleAddLine,
    // Inline edit
    editCell, setEditCell, editVal, setEditVal, commitCell,
    // Import
    showImport, setShowImport, importRows, setImportRows, importVendorId, setImportVendorId,
    importVendorName, setImportVendorName, isDragging, setIsDragging, fileInputRef, setImportRowAccount,
    // Scan
    showScanModal, setShowScanModal, scanFile, setScanFile, isScanningScan, setIsScanningScan, scanFileRef,
    // GRN
    activeReceiptId, setActiveReceiptId, grnLines, setGrnLines, destLocation, setDestLocation,
    serialInputs, setSerialInputs, serialAccessories, setSerialAccessories,
    serialAccessoryNotes, setSerialAccessoryNotes, serialSpecs, setSerialSpecs, serialIssues, setSerialIssues, serialRefs,
    // Return
    showReturnModal, setShowReturnModal, returnReceiptId, setReturnReceiptId, returnReason, setReturnReason,
    returnLines, setReturnLines, returnScanInput, setReturnScanInput, returnCollectedBy, setReturnCollectedBy,
    returnCollectedDate, setReturnCollectedDate, returnPickupNotes, setReturnPickupNotes,
    // Return filters
    retSearchSerial, setRetSearchSerial, retFilterStatus, setRetFilterStatus, retFilterReason, setRetFilterReason,
    retFilterVendor, setRetFilterVendor, retDateFrom, setRetDateFrom, retDateTo, setRetDateTo,
    retExpandedId, setRetExpandedId, showPickupModal, setShowPickupModal, pickupReturnId, setPickupReturnId,
    pickupCollectedBy, setPickupCollectedBy, pickupCollectedDate, setPickupCollectedDate, pickupNotes, setPickupNotes,
    // Delete
    delId, setDelId,
    // Helpers
    fmtKes, fmtDate,
  }

  return (
    <PurchaseProvider initialState={purchaseCtxValue as any}>

    {/* PO Form view — rendered inside PurchaseProvider so usePurchase() works */}
    {subView === 'form' && activePO && <POFormView />}

    {/* List / receipts / bills view */}
    {subView !== 'form' && <div className="mod-page">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#F59E0B15', color: '#F59E0B' }}>
            <Fa icon={faClipboardCheck} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-extrabold text-text-1">Purchasing</h1>
            <p className="text-[10px] text-text-3 mt-0.5">RFQs, orders, receipts &amp; bills</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button className="btn-secondary text-[11px]" onClick={() => setShowImport(true)}>Import CSV</button>
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowNewRFQ(true)}>
            <span>+</span><span className="hidden sm:inline">New RFQ</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="px-4 py-3 stat-grid-4 border-b border-border-lt bg-surface">
        <StatCard label="RFQs"            value={stats.rfqs}           sub="draft &amp; sent"      color="#F59E0B" icon={<Fa icon={faClipboardCheck} />} onClick={() => { setMainView('orders'); setFilter('rfq') }} />
        <StatCard label="Purchase Orders" value={stats.activePOs}      sub="confirmed, in transit"  color="#3B82F6" icon={<Fa icon={faCartShopping} />} onClick={() => { setMainView('orders'); setFilter('po') }} />
        <StatCard label="Pending GRNs"    value={stats.pendingGRNs}    sub="awaiting validation"    color="#F59E0B" icon={<Fa icon={faBoxesStacked} />} onClick={() => setMainView('receipts')} />
        <StatCard label="Unpaid Bills"    value={fmtKes(stats.unpaid)} sub="outstanding payable"    color="#EF4444" icon={<Fa icon={faCreditCard} />} onClick={() => setMainView('bills')} />
      </div>

      {/* Tabs */}
      <div className="mod-tabs">
        {([
          ['orders',   'Orders'],
          ['receipts', 'Receipts'],
          ['returns',  'Returns'],
          ['bills',    'Bills'],
          ['tradein',  'Trade-In'],
        ] as [MainView, string][]).map(([v, label]) => {
          const count = v === 'orders' ? purchaseOrders.length
            : v === 'receipts' ? receipts.length
            : v === 'returns' ? purchaseReturns.length
            : v === 'tradein' ? (buyBacks.length + donations.length + clientExchanges.length)
            : vendorBills.length
          return (
            <button key={v} onClick={() => setMainView(v)} className={`mod-tab ${mainView === v ? 'active' : ''}`}>
              {label}
              {count > 0 && <span className="ml-1.5 badge badge-gray text-[9px]">{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="mod-body">

      <TabContent active={true}>

      {/* ── ORDERS (extracted → purchase/PurchaseOrdersTab.tsx) ── */}
      {mainView === 'orders' && <PurchaseOrdersTab />}

      {/* ── RECEIPTS (extracted → purchase/PurchaseReceiptsTab.tsx) ── */}
      {mainView === 'receipts' && <PurchaseReceiptsTab />}

      {/* ── RETURNS (extracted → purchase/PurchaseReturnsTab.tsx) ── */}
      {mainView === 'returns' && <PurchaseReturnsTab />}


      {/* Refurbishment has moved to Inventory module */}

      {/* ── BILLS (extracted → purchase/PurchaseBillsTab.tsx) ── */}
      {mainView === 'bills' && <PurchaseBillsTab />}

      {mainView === 'tradein' && <TradeIn />}

      </TabContent>

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
          <div className="flex items-center gap-1 -mt-1 mb-1">
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Vendor not in list?</span>
            <button className="text-[10px] underline" style={{ color: 'var(--accent)' }} onClick={() => setShowNewVendorModal(true)}>+ Create New Vendor</button>
          </div>
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

      {/* ── NEW VENDOR MODAL ── */}
      {showNewVendorModal && (
        <Modal title="Add New Vendor" onClose={() => setShowNewVendorModal(false)} width={500}>
          <Field label="Vendor Name" required>
            <Input value={newVendorForm.name} onChange={v => setNewVendorForm(p => ({ ...p, name: v }))} placeholder="Vendor Company Ltd" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" required>
              <Input type="email" value={newVendorForm.email} onChange={v => setNewVendorForm(p => ({ ...p, email: v }))} />
            </Field>
            <Field label="Phone" required>
              <Input value={newVendorForm.phone} onChange={v => setNewVendorForm(p => ({ ...p, phone: v }))} placeholder="+254 7xx xxx xxx" />
            </Field>
            <Field label="KRA PIN">
              <Input value={newVendorForm.vatNumber} onChange={v => setNewVendorForm(p => ({ ...p, vatNumber: v }))} placeholder="P051234567A" />
            </Field>
            <Field label="Payment Terms (days)">
              <Input type="number" value={newVendorForm.paymentTermsDays} onChange={v => setNewVendorForm(p => ({ ...p, paymentTermsDays: v }))} />
            </Field>
            <Field label="Credit Limit (KES)">
              <Input type="number" value={newVendorForm.creditLimit} onChange={v => setNewVendorForm(p => ({ ...p, creditLimit: v }))} placeholder="0" />
            </Field>
            <Field label="Address">
              <Input value={newVendorForm.address} onChange={v => setNewVendorForm(p => ({ ...p, address: v }))} placeholder="Physical address" />
            </Field>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => setShowNewVendorModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleCreateVendorForRFQ}>Create Vendor & Select</button>
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

      {/* Payments are processed in Finance → Accounting module */}

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

      {/* ── DOCUMENT SCAN MODAL (AI OCR) ── */}
      {showScanModal && (
        <Modal title="Scan Document (AI OCR)" subtitle="Upload a vendor quote or invoice to extract lines" width={480} onClose={() => { setShowScanModal(false); setScanFile(null); setIsScanningScan(false) }}>
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); handleScanFile(e.dataTransfer.files[0] ?? null) }}
            onClick={() => scanFileRef.current?.click()}
            className="mb-4"
            style={{
              border: `2px dashed ${isDragging ? '#1B2762' : scanFile ? '#10B981' : '#D1D5DB'}`,
              borderRadius: 10, padding: '24px 16px', cursor: 'pointer', textAlign: 'center',
              background: isDragging ? '#E8F3FA' : scanFile ? '#F0FDF4' : '#FAFAFA',
              transition: 'all 0.15s',
            }}>
            <input ref={scanFileRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={e => handleScanFile(e.target.files?.[0] ?? null)} />
            {isScanningScan ? (
              <div className="flex flex-col items-center justify-center gap-3">
                <svg className="h-8 w-8 animate-spin" style={{ color: '#1B2762' }} viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-xs font-bold text-t1">AI is analyzing document...</p>
                <p className="text-[10px] text-t3">Reading supplier, reference, line items, quantities, and prices</p>
              </div>
            ) : scanFile ? (
              <div><div style={{ fontSize: 32 }} className="mb-2">{scanFile.type.startsWith('image/') ? '🖼️' : '📄'}</div><p className="text-xs font-semibold text-green-700">{scanFile.name}</p></div>
            ) : (
              <div><div style={{ fontSize: 32 }} className="mb-2">🔍</div><p className="text-xs text-t2 font-medium">Drop supplier invoice or quote image here</p><p className="text-[10px] text-t3 mt-1">Supports JPG, PNG, and WebP images — OCR extraction</p></div>
            )}
          </div>
          <div className="flex gap-2 justify-end"><button className="btn-outline" onClick={() => { setShowScanModal(false); setScanFile(null); setIsScanningScan(false) }}>Cancel</button></div>
        </Modal>
      )}
      </div>{/* mod-body */}
    </div>}
    </PurchaseProvider>
  )
}
