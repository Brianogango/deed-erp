'use client'
import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from 'react'
import { useFinanceStore, Receipt, LOCATIONS, LocationId, CATEGORY_CONFIG, CategoryId, fmtKes, fmtDate, POLine, Account, resolveProductAccounts } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Confirm, StatCard, PanelHeader, StatusStepper, SearchPicker, Divider, TabContent, ModuleSkeleton, TabBar, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton, SecondaryActionMenu, StatusBadge } from '@/components/erp'
import {
  Fa, faClipboardCheck, faCartShopping, faBoxesStacked, faCreditCard, faPrint,
  faClipboardList, faPlus, faBarcode, faTriangleExclamation, faFolderOpen,
  faFileLines, faImage, faMagnifyingGlass, faCheck, faXmark,
} from '@/components/icons'
import { printSerialLabels, printProductLabels } from '@/lib/product-label'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import ContactFormModal, { blankCompanyContact } from '@/components/contacts/ContactFormModal'
import { PurchaseProvider } from './purchase/PurchaseContext'
import PurchaseOrdersTab from './purchase/PurchaseOrdersTab'
import PurchaseReceiptsTab from './purchase/PurchaseReceiptsTab'
import PurchaseReceiptDetail from './purchase/PurchaseReceiptDetail'
import PurchaseBillsTab from './purchase/PurchaseBillsTab'
import PurchaseReturnsTab from './purchase/PurchaseReturnsTab'
import POFormView from './purchase/POFormView'
import { readGuardedImageAsDataUrl, validateImageUpload } from '@/lib/client-image-guard'
import { ScanInputRow } from '@/components/BarcodeScanner'
import { parseScanPayload } from '@/lib/barcode-scan'
import { useUrlQueryState, useUrlRecordId, useUrlUiState } from '@/hooks/useUrlRecordId'
import {
  filterPurchaseOrders,
  type PurchaseStatusFilter,
  type PurchaseTypeFilter,
} from '@/lib/purchases-filter'
import { invoiceResidual, isOpenInvoice } from '@/lib/odoo-sales-flow'

type MainView = 'orders' | 'receipts' | 'returns' | 'bills'
type SubView  = 'list' | 'form' | 'receive' | 'receipt'
type RfqDraftLine = { id: string; productId: string; productName: string; description: string; qty: string; unitPrice: string; taxRate: string }

const PURCHASE_TABS: MainView[] = ['orders', 'receipts', 'returns', 'bills']
const PURCHASE_RECORD_QUERY = { tab: 'orders' }

const ACCESSORIES = ['Charger', 'Bag/Case', 'Mouse', 'Box', 'Cable', 'Manual']

const PO_STEPS = ['RFQ', 'RFQ Sent', 'Purchase Order', 'Received', 'Billed']

const LOC_OPTS = (['warehouse', 'shop'] as LocationId[]).map(k => ({ value: k, label: LOCATIONS[k].name }))

const REASON_OPTS = [
  { value: 'damaged',      label: 'Damaged goods' },
  { value: 'wrong_supply', label: 'Wrong supply' },
  { value: 'excess',       label: 'Excess stock' },
  { value: 'other',        label: 'Other' },
]

const STATUS_LABEL: Record<string, string> = {
  draft: 'RFQ', sent: 'RFQ Sent', confirmed: 'Purchase Order',
  partial: 'Partially Received', received: 'Fully Received', cancelled: 'Cancelled',
}
const PO_STEP_IDX: Record<string, number> = {
  draft: 0, sent: 1, confirmed: 2, partial: 3, received: 3,
}

// CSV template columns
const CSV_HEADERS = ['Product Name', 'Quantity', 'Unit Price (KES)', 'Tax Rate (%)', 'Serial Numbers', 'Specifications', 'Notes']
const newRfqLine = (): RfqDraftLine => ({ id: crypto.randomUUID(), productId: '', productName: '', description: '', qty: '1', unitPrice: '0', taxRate: '0' })

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
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <PurchaseContent />
    </Suspense>
  )
}

function PurchaseContent() {
  const {
    purchaseOrders, contacts, products, receipts, invoices, purchaseReturns, serials, users, bankAccounts,
    currentUserId, accounts,
    createPO, updatePO, addPOLine, removePOLine, updatePOLine, bulkAddPOLines,
    sendPO, confirmPO, createReceiptFromPO,
    validateReceipt, deletePO, createBillFromPO, revertPOToDraft,
    postInvoice, registerPayment,
    createPurchaseReturn, addReturnLine, confirmPurchaseReturn, logReturnPickup,
    showToast, companySettings, addContact,
  } = useFinanceStore()

  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  useEffect(() => setMounted(true), [])

  const [queryMainView, setQueryMainView] = useUrlQueryState('tab', 'orders')
  const mainView = PURCHASE_TABS.includes(queryMainView as MainView) ? queryMainView as MainView : 'orders'
  const setMainView = useCallback((nextView: MainView) => {
    setQueryMainView(nextView)
  }, [setQueryMainView])
  const [subView,  setLocalSubView]  = useState<SubView>('list')
  const [urlActiveId, setUrlActiveId] = useUrlRecordId({ whenOpen: PURCHASE_RECORD_QUERY })
  const [activeId, setLocalActiveId] = useState<string | null>(null)
  const setActiveId = useCallback((id: string | null) => {
    setLocalActiveId(id)
    setUrlActiveId(id)
  }, [setUrlActiveId])
  const setSubView = useCallback((nextView: SubView) => {
    setLocalSubView(nextView)
    if (nextView === 'list') setActiveId(null)
  }, [setActiveId])
  const [typeFilterValue, setTypeFilterValue] = useUrlUiState('type', 'all')
  const typeFilter: PurchaseTypeFilter = ['all', 'rfq', 'po'].includes(typeFilterValue)
    ? typeFilterValue as PurchaseTypeFilter
    : 'all'
  const setTypeFilter = useCallback((value: PurchaseTypeFilter) => {
    setTypeFilterValue(value, { queryPatch: { page: null } })
  }, [setTypeFilterValue])

  const [statusFilterValue, setStatusFilterValue] = useUrlUiState('status', 'all')
  const statusFilter: PurchaseStatusFilter = [
    'all', 'draft', 'sent', 'confirmed', 'partial', 'received', 'cancelled',
  ].includes(statusFilterValue)
    ? statusFilterValue as PurchaseStatusFilter
    : 'all'
  const setStatusFilter = useCallback((value: PurchaseStatusFilter) => {
    setStatusFilterValue(value, { queryPatch: { page: null } })
  }, [setStatusFilterValue])

  // ── New RFQ ────────────────────────────────────────────────────────────────
  const [showNewRFQ,    setShowNewRFQ]    = useState(false)
  const [newVendorId,   setNewVendorId]   = useState('')
  const [newVendorName, setNewVendorName] = useState('')
  const [newRfqExpectedDate, setNewRfqExpectedDate] = useState(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
  const [newRfqNotes, setNewRfqNotes] = useState('')
  const [newRfqLines, setNewRfqLines] = useState<RfqDraftLine[]>([newRfqLine()])
  const [showNewVendorModal, setShowNewVendorModal] = useState(false)
  const [newVendorSeed, setNewVendorSeed] = useState('')
  const [vendorFormKey, setVendorFormKey] = useState(0)

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
  const [isValidatingReceipt,  setIsValidatingReceipt]  = useState(false)
  const [showValidateReview,   setShowValidateReview]   = useState(false)
  const [receiptOrigin,        setReceiptOrigin]        = useState<'list' | 'po'>('list')
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
  const [confirmingReturn,   setConfirmingReturn]    = useState(false)
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
  const linkedBill    = useMemo(() => {
    if (!activePO) return null
    const isLiveBill = (bill: typeof vendorBills[number]) =>
      !['cancelled', 'voided', 'void'].includes(String(bill.status))
    const stored = activePO.billId
      ? vendorBills.find(bill => bill.id === activePO.billId && isLiveBill(bill))
      : undefined
    // The relational PO list does not carry the legacy blob-only billId.
    // Recover the relationship from Invoice.purchaseOrderId so a refresh
    // cannot make an existing bill (and all of its next actions) disappear.
    return stored
      ?? vendorBills.find(bill => bill.purchaseOrderId === activePO.id && isLiveBill(bill))
      ?? null
  }, [activePO, vendorBills])

  useEffect(() => {
    if (!urlActiveId) {
      if (activeId) {
        setLocalActiveId(null)
        if (subView === 'form') setLocalSubView('list')
      }
      if (activeReceiptId && subView === 'receipt') {
        setActiveReceiptId(null)
        setLocalSubView('list')
      }
      return
    }

    if (receipts.some(r => r.id === urlActiveId)) {
      if (activeReceiptId !== urlActiveId) setActiveReceiptId(urlActiveId)
      if (subView === 'list') {
        setReceiptOrigin('list')
        setLocalSubView('receipt')
      }
      if (mainView !== 'receipts' && subView !== 'receive') setMainView('receipts')
      return
    }

    if (purchaseOrders.some(po => po.id === urlActiveId)) {
      if (activeId !== urlActiveId) setActiveId(urlActiveId)
      // Deep-link opens the PO form from the list — but do NOT kick the user
      // out of the GRN receive screen (Process GRN sets subView to 'receive')
      // or an open GRN document.
      if (subView === 'list') setLocalSubView('form')
    }
  }, [urlActiveId, purchaseOrders, receipts, activeId, activeReceiptId, subView, mainView, setActiveId, setMainView])

  const filteredPOs = useMemo(
    () => filterPurchaseOrders(purchaseOrders, typeFilter, statusFilter),
    [purchaseOrders, typeFilter, statusFilter],
  )

  const currentUser = useMemo(() => users.find(u => u.id === currentUserId), [users, currentUserId])

  const stats = useMemo(() => ({
    rfqs:        purchaseOrders.filter(p => p.status === 'draft' || p.status === 'sent').length,
    activePOs:   purchaseOrders.filter(p => p.status === 'confirmed' || p.status === 'partial').length,
    pendingGRNs: receipts.filter(r => r.status === 'draft').length,
    unpaid:      vendorBills.filter(isOpenInvoice).reduce((s, b) => s + invoiceResidual(b), 0),
  }), [purchaseOrders, receipts, vendorBills])

  const rfqPreview = useMemo(() => {
    const lines = newRfqLines.map((line, index) => {
      const qty = Number(line.qty)
      const unitPrice = Number(line.unitPrice)
      const normalizedQty = Number.isFinite(qty) && qty > 0 ? qty : 0
      const normalizedPrice = Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0
      const taxRate = Number(line.taxRate) || 0
      const subtotal = normalizedQty * normalizedPrice
      const taxAmount = Math.round(subtotal * taxRate / 100)
      return {
        index,
        productId: line.productId,
        productName: line.productName || line.description.trim(),
        description: line.description.trim(),
        qty: normalizedQty,
        unitPrice: normalizedPrice,
        taxRate,
        subtotal,
        taxAmount,
        total: subtotal + taxAmount,
        valid: !!line.productId && !!line.description.trim() && normalizedQty > 0 && normalizedPrice > 0,
      }
    })
    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
    const taxTotal = lines.reduce((sum, line) => sum + line.taxAmount, 0)
    const invalidLineIndexes = lines.filter(line => !line.valid).map(line => line.index)
    return {
      lines,
      subtotal,
      taxTotal,
      total: subtotal + taxTotal,
      invalidLineIndexes,
      canSave: !!newVendorId && invalidLineIndexes.length === 0 && lines.length > 0,
      blockedReason: !newVendorId
        ? 'Select a vendor before creating the RFQ.'
        : invalidLineIndexes.length > 0
          ? 'Every RFQ line needs a product, description, quantity greater than zero, and price greater than zero.'
          : '',
    }
  }, [newRfqLines, newVendorId])

  const resetRfqForm = () => {
    setShowNewRFQ(false)
    setNewVendorId('')
    setNewVendorName('')
    setNewRfqExpectedDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
    setNewRfqNotes('')
    setNewRfqLines([newRfqLine()])
  }

  // ── Create RFQ ─────────────────────────────────────────────────────────────
  const handleCreateRFQ = async () => {
    if (!rfqPreview.canSave) { showToast(rfqPreview.blockedReason || 'Complete the RFQ before creating it', 'error'); return }
    const lines: POLine[] = rfqPreview.lines.map(line => {
      const product = products.find(p => p.id === line.productId)
      const catCfg = product ? CATEGORY_CONFIG[product.category as CategoryId] ?? { serialRequired: false } : { serialRequired: false }
      return {
        id: crypto.randomUUID(),
        productId: line.productId,
        productName: line.productName,
        qty: line.qty,
        qtyReceived: 0,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        subtotal: line.subtotal,
        requiresSerial: catCfg.serialRequired,
        accountCode: product ? resolveProductAccounts(product).costAccountCode : undefined,
      }
    })
    // createPO awaits doc-ref allocation — must await or po.id is undefined and
    // subView='form' with no activePO renders a blank page.
    const po = await createPO(newVendorId, newVendorName, {
      lines,
      expectedDate: newRfqExpectedDate,
      notes: newRfqNotes.trim(),
    })
    if (!po?.id) return
    resetRfqForm()
    setActiveId(po.id)
    setSubView('form')
  }

  const openNewVendorForm = (seed = '') => {
    setNewVendorSeed(seed.trim())
    setVendorFormKey(k => k + 1)
    setShowNewVendorModal(true)
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
  const hydrateReceive = (draft: Receipt) => {
    const preSpecs: Record<string, string> = {}
    const preLines = draft.lines.map(l => {
      const preSerials = (l.importedSerials ?? []).slice(0, l.qtyExpected)
      return { ...l, qtyReceived: l.qtyReceived || l.qtyExpected, serials: l.serials.length ? l.serials : preSerials }
    })
    draft.lines.forEach(l => {
      if (l.specs && l.importedSerials) {
        l.importedSerials.forEach(s => { preSpecs[s] = l.specs! })
      }
    })
    setActiveReceiptId(draft.id)
    setGrnLines(preLines)
    setDestLocation(draft.destinationLocation)
    setSerialInputs({})
    setSerialSpecs(preSpecs)
    setSubView('receive')
  }

  const openReceiptDetail = (receiptId: string, origin: 'list' | 'po' = 'list') => {
    const rec = receipts.find(r => r.id === receiptId)
    if (!rec) return
    setReceiptOrigin(origin)
    setActiveReceiptId(receiptId)
    setLocalSubView('receipt')
    if (origin === 'list') {
      setLocalActiveId(null)
      setUrlActiveId(receiptId, { queryPatch: { tab: 'receipts' } })
    }
  }

  const closeReceiptDetail = (to: 'list' | 'po' = receiptOrigin) => {
    setActiveReceiptId(null)
    if (to === 'po') {
      setLocalSubView('form')
      return
    }
    setLocalSubView('list')
    setUrlActiveId(null, { queryPatch: { tab: 'receipts' } })
  }

  const startReceive = (receiptId: string) => {
    const rec = receipts.find(r => r.id === receiptId)
    if (!rec) { showToast('Receipt not found', 'error'); return }
    if (rec.status !== 'draft') { showToast('This GRN is already validated', 'info'); return }
    const po = purchaseOrders.find(p => p.id === rec.poId)
    if (!po) { showToast('Purchase order not found for this GRN', 'error'); return }
    setReceiptOrigin(receiptOrigin)
    setActiveId(po.id)
    hydrateReceive(rec)
  }

  const leaveReceive = () => {
    if (receiptOrigin === 'list' && activeReceiptId) {
      setLocalSubView('receipt')
      setLocalActiveId(null)
      setUrlActiveId(activeReceiptId, { queryPatch: { tab: 'receipts' } })
      return
    }
    setSubView('form')
    setActiveReceiptId(null)
  }

  const openReceive = async () => {
    if (!activePO) return
    let draft = receipts.find(r => r.poId === activePO.id && r.status === 'draft') ?? null
    if (!draft) {
      draft = await Promise.resolve(createReceiptFromPO(activePO.id))
    }
    if (!draft) { showToast('No pending receipt found', 'error'); return }
    setReceiptOrigin('po')
    hydrateReceive(draft)
  }

  const addSerial = (lineIdx: number, serial: string) => {
    const parsed = parseScanPayload(serial)
    // At GRN we capture manufacturer serials; prefer SERIAL field from QR, else raw.
    const val = (parsed.serial || parsed.normalized).toUpperCase()
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

  const handleValidateReceipt = async () => {
    if (!activeReceiptId || isValidatingReceipt) return
    for (const line of grnLines) {
      if (line.requiresSerial && line.serials.length < line.qtyReceived) {
        showToast(`Enter all ${line.qtyReceived} serials for ${line.productName} (${line.serials.length} done)`, 'error'); return
      }
    }
    setIsValidatingReceipt(true)
    try {
      const validated = await validateReceipt(activeReceiptId, grnLines, destLocation, serialAccessories, serialAccessoryNotes, serialSpecs, serialIssues)
      if (!validated) return
      setShowValidateReview(false)
      setSerialAccessories({}); setSerialAccessoryNotes({})
      setSerialSpecs({}); setSerialIssues({})
      if (receiptOrigin === 'list') {
        setLocalSubView('receipt')
        setLocalActiveId(null)
        setUrlActiveId(activeReceiptId, { queryPatch: { tab: 'receipts' } })
      } else {
        setSubView('form')
        setActiveReceiptId(null)
      }
    } finally {
      setIsValidatingReceipt(false)
    }
  }

  // ── Return ─────────────────────────────────────────────────────────────────
  const openReturnForPO = () => {
    if (!activePO) return
    const latest = receipts.filter(r => r.poId === activePO.id && r.status === 'validated').pop()
    if (!latest) { showToast('No validated receipt found', 'error'); return }
    setReturnReceiptId(latest.id)
    setReturnLines(latest.lines.filter(l => l.qtyReceived > 0).map(l => ({ productId: l.productId, productName: l.productName, qty: '1', serials: [], requiresSerial: l.requiresSerial })))
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

  const handleConfirmReturn = async () => {
    if (confirmingReturn) return
    const hasItems = returnLines.some(l => l.requiresSerial ? l.serials.length > 0 : Number(l.qty) > 0)
    if (!hasItems) { showToast('Add at least one item to return', 'error'); return }
    const preparedLines = returnLines
      .filter(l => Number(l.qty) > 0 || l.serials.length > 0)
      .map(l => {
        const qty = l.requiresSerial ? l.serials.length : Number(l.qty) || 0
        const serialIds = l.requiresSerial
          ? l.serials.map(s => serials.find(item => item.serial.toUpperCase() === s.toUpperCase())?.id).filter((id): id is string => Boolean(id))
          : []
        return { ...l, qty, serialIds }
      })
    const missingSerialLine = preparedLines.find(l => l.requiresSerial && l.serialIds.length !== l.serials.length)
    if (missingSerialLine) {
      showToast(`Some serials for ${missingSerialLine.productName} were not found in inventory`, 'error')
      return
    }
    setConfirmingReturn(true)
    try {
      const ret = createPurchaseReturn(returnReceiptId, returnReason)
      if (!ret) return
      preparedLines.forEach(l => {
        if (l.qty > 0) addReturnLine(ret.id, l.productId, l.productName, l.qty, l.serialIds, l.requiresSerial)
      })
      const ok = await confirmPurchaseReturn(ret.id)
      if (!ok) return
      if (returnCollectedBy) {
        const u = users.find(x => x.id === returnCollectedBy)
        logReturnPickup(ret.id, returnCollectedBy, u?.name ?? returnCollectedBy, returnCollectedDate, returnPickupNotes || undefined)
      }
      setShowReturnModal(false)
    } finally {
      setConfirmingReturn(false)
    }
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
    try { guardSpreadsheetFile(file) } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'File too large', 'error'); return
    }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const { rows: parsed, headerError } = parseCSV(text)
      if (headerError) { showToast(headerError, 'error'); return }
      if (!parsed.length) { showToast('No data rows found in file', 'error'); return }
      try { guardSpreadsheetRows(parsed) } catch (err) {
        showToast(err instanceof SpreadsheetGuardError ? err.message : 'Too many rows', 'error'); return
      }

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

  const handleConfirmImport = async () => {
    if (!activeId && !importVendorId) { showToast('Select or open a PO first', 'error'); return }

    let targetPoId = activeId
    if (!targetPoId) {
      const po = await createPO(importVendorId, importVendorName)
      if (!po?.id) { showToast('Could not create purchase order', 'error'); return }
      setActiveId(po.id)
      targetPoId = po.id
    }

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

  if (!mounted) return <ModuleSkeleton />

  // ══════════════════════════════════════════════════════════════════════════
  // RECEIVE VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (subView === 'receive' && activePO && activeReceipt) {
    const receivingQty = grnLines.reduce((sum, line) => sum + Math.max(0, Number(line.qtyReceived) || 0), 0)
    const expectedQty = grnLines.reduce((sum, line) => sum + Math.max(0, Number(line.qtyExpected) || 0), 0)
    const remainingQty = Math.max(0, expectedQty - receivingQty)
    const hasSerializedLines = grnLines.some(line => line.requiresSerial && line.qtyReceived > 0)
    const serialsComplete = grnLines.every(line => !line.requiresSerial || line.serials.length === line.qtyReceived)
    const allComplete = receivingQty > 0 && serialsComplete
    const receiveStep = receivingQty === 0 ? 1 : hasSerializedLines && !serialsComplete ? 2 : 3
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn-outline text-[11px] py-1 px-2.5" onClick={leaveReceive}>← {receiptOrigin === 'list' ? 'Back to GRN' : 'Back to Order'}</button>
          <span className="text-xs font-semibold">GRN — {activeReceipt.ref}</span>
          <span className="text-[10px] text-t3">From: {activePO.vendorName}</span>
          <StatusBadge status={activePO.status} label={STATUS_LABEL[activePO.status]} />
        </div>

        <div className="card p-3" aria-label="Receiving progress">
          <div className="grid grid-cols-3 gap-2">
            {[
              ['1', 'Confirm quantities'],
              ['2', hasSerializedLines ? 'Capture serials' : 'Serials not required'],
              ['3', 'Review & receive'],
            ].map(([number, label], index) => {
              const step = index + 1
              const complete = step < receiveStep || (step === 2 && !hasSerializedLines && receivingQty > 0)
              const active = step === receiveStep
              return (
                <div key={number} className="rounded-lg border px-3 py-2" style={{
                  borderColor: active ? 'var(--navy)' : 'var(--border-lt)',
                  background: complete ? 'var(--success-bg)' : 'var(--bg-surface)',
                }}>
                  <p className="text-[9px] uppercase tracking-wider text-t4 mb-0.5">Step {number}</p>
                  <p className="text-[11px] font-semibold text-t1">{complete ? '✓ ' : ''}{label}</p>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div><p className="text-[9px] uppercase text-t4">Expected</p><p className="text-sm font-bold text-t1">{expectedQty}</p></div>
            <div><p className="text-[9px] uppercase text-t4">Receiving now</p><p className="text-sm font-bold text-t1">{receivingQty}</p></div>
            <div><p className="text-[9px] uppercase text-t4">Remaining</p><p className="text-sm font-bold text-t1">{remainingQty}</p></div>
          </div>
        </div>

        <div className="card p-4 flex items-start gap-4 flex-wrap">
          <div>
            <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Destination</p>
            <Select value={destLocation} onChange={v => setDestLocation(v as LocationId)} options={LOC_OPTS} />
          </div>
          <div className="flex-1 p-3 rounded-lg text-xs" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
            <p className="font-semibold mb-1.5 text-t1"><Fa icon={faClipboardList} /> Receiving Instructions</p>
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
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--bg-muted)' }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{prod?.image ?? ''}</span>
                  <div>
                    <p className="text-xs font-semibold text-t1">{line.productName}</p>
                    <p className="text-[10px] text-t3">
                      Expected: {line.qtyExpected}
                      {line.requiresSerial
                        ? <span style={{ color: 'var(--warning)' }}> · <Fa icon={faBarcode} aria-hidden="true" /> Serial tracking required</span>
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
                  <div className="mb-3">
                    <ScanInputRow
                      value={serialInputs[idx] ?? ''}
                      onChange={v => setSerialInputs(p => ({ ...p, [idx]: v.toUpperCase() }))}
                      onSubmit={v => addSerial(idx, v)}
                      onCameraScan={code => addSerial(idx, code)}
                      placeholder="Scan or type serial number…"
                      continuous
                      cameraTitle={`Scan serials — ${line.productName}`}
                      inputRef={el => { serialRefs.current[idx] = el }}
                    />
                  </div>
                  {line.serials.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {line.serials.map(s => {
                        const accs     = serialAccessories[s] ?? []
                        const hasIssue = !!(serialIssues[s]?.trim())
                        const borderColor = hasIssue ? '#FCA5A5' : '#BBF7D0'
                        const bgColor     = hasIssue ? 'var(--danger-bg)' : 'var(--success-bg)'
                        const headerColor = hasIssue ? '#991B1B' : 'var(--success-text)'
                        return (
                          <div key={s} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}`, background: bgColor }}>
                            {/* Serial header row */}
                            <div className="flex items-center justify-between px-3 py-2">
                              <span className="font-mono text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: headerColor }}>
                                <Fa icon={hasIssue ? faTriangleExclamation : faCheck} aria-hidden="true" />{s}
                                {hasIssue && <span className="ml-2 text-[9px] font-sans px-1.5 py-0.5 rounded-full" style={{ background: 'var(--danger-bg)', color: '#991B1B' }}>Refurbishment queue</span>}
                              </span>
                              <button onClick={() => removeSerial(idx, s)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14, lineHeight: 1 }}>×</button>
                            </div>
                            <div className="px-3 pb-2.5 flex flex-col gap-2 border-t" style={{ borderColor }}>
                              {/* Specs */}
                              <div>
                                <p className="text-[9px] uppercase tracking-wider mt-2 mb-1" style={{ color: 'var(--text-4)' }}>Specifications</p>
                                <input className="form-input text-[11px] py-1"
                                  placeholder="e.g. Intel i5-12th Gen, 8GB RAM, 512GB SSD, Silver"
                                  value={serialSpecs[s] ?? ''}
                                  onChange={e => setSerialSpecs(p => ({ ...p, [s]: e.target.value }))} />
                              </div>
                              {/* Accessories */}
                              <div>
                                <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-4)' }}>Accessories received:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {ACCESSORIES.map(acc => {
                                    const on = accs.includes(acc)
                                    return (
                                      <button key={acc} onClick={() => toggleSerialAccessory(s, acc)}
                                        className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
                                        style={{ background: on ? 'var(--navy)' : 'var(--border-lt)', color: on ? '#fff' : 'var(--text-4)', border: 'none', cursor: 'pointer' }}>
                                        {on ? '✓ ' : ''}{acc}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                              {/* Received with issues toggle */}
                              <div className="rounded-lg p-2.5" style={{ background: hasIssue ? 'var(--danger-bg)' : 'var(--bg-muted)', border: `1px solid ${hasIssue ? '#FCA5A5' : 'var(--border-lt)'}` }}>
                                <label className="flex items-center gap-2 cursor-pointer select-none mb-0">
                                  <input type="checkbox" checked={hasIssue}
                                    onChange={e => setSerialIssues(p => ({ ...p, [s]: e.target.checked ? ' ' : '' }))}
                                    style={{ accentColor: 'var(--danger)', width: 13, height: 13 }} />
                                  <span className="text-[11px] font-medium" style={{ color: hasIssue ? '#991B1B' : 'var(--text-4)' }}>
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
                    <p className="text-[10px] mt-2 inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}>
                      <Fa icon={faTriangleExclamation} aria-hidden="true" /> {line.qtyReceived - line.serials.length} more serial(s) needed
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
              ? <span className="inline-flex items-center gap-1" style={{ color: 'var(--success)' }}><Fa icon={faCheck} aria-hidden="true" /> Ready to receive — review and update inventory</span>
              : <span className="inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}><Fa icon={faTriangleExclamation} aria-hidden="true" /> Capture the missing serial numbers to continue</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-outline" onClick={leaveReceive}>Cancel</button>
            <button className="btn-outline text-[11px] py-1.5 px-3"
              style={{ borderColor: 'var(--navy)', color: 'var(--navy)' }}
              disabled={grnLines.every(l => l.serials.length === 0 && l.qtyReceived === 0)}
              onClick={handlePrintReceivedLabels}>
              <Fa icon={faPrint} /> Print Labels
            </button>
            <button className="btn-primary" style={{ background: allComplete ? 'var(--success)' : 'var(--border)', cursor: allComplete && !isValidatingReceipt ? 'pointer' : 'not-allowed' }}
              onClick={() => setShowValidateReview(true)} disabled={!allComplete || isValidatingReceipt} aria-busy={isValidatingReceipt}>
              {isValidatingReceipt ? 'Updating stock and purchase…' : 'Receive Goods & Update Inventory'}
            </button>
          </div>
        </div>

        {showValidateReview && (
          <Modal title="Review goods receipt" subtitle={activeReceipt.ref} onClose={() => setShowValidateReview(false)} width={680}>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="card p-3"><p className="text-[9px] uppercase text-t4">Receiving</p><p className="text-lg font-bold text-t1">{receivingQty}</p></div>
                <div className="card p-3"><p className="text-[9px] uppercase text-t4">Remaining</p><p className="text-lg font-bold text-t1">{remainingQty}</p></div>
                <div className="card p-3"><p className="text-[9px] uppercase text-t4">Destination</p><p className="text-xs font-bold text-t1 mt-1">{LOCATIONS[destLocation].name}</p></div>
              </div>
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-lt)' }}>
                {grnLines.filter(line => line.qtyReceived > 0).map(line => (
                  <div key={line.productId} className="flex justify-between gap-3 px-3 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--border-lt)' }}>
                    <div><p className="text-xs font-semibold text-t1">{line.productName}</p>{line.requiresSerial && <p className="text-[10px] text-t3">{line.serials.length} serial(s) captured</p>}</div>
                    <p className="text-xs font-bold text-t1">{line.qtyReceived}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
                This will update inventory, valuation and the purchase-order balance. The validated receipt cannot be edited directly afterward.
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn-outline" disabled={isValidatingReceipt} onClick={() => setShowValidateReview(false)}>Go back</button>
                <button className="btn-primary" disabled={isValidatingReceipt} aria-busy={isValidatingReceipt} onClick={() => { void handleValidateReceipt() }}>
                  {isValidatingReceipt ? 'Updating stock and purchase…' : 'Confirm & Update Inventory'}
                </button>
              </div>
            </div>
          </Modal>
        )}
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
    sendPO, confirmPO, createReceiptFromPO, validateReceipt, deletePO, createBillFromPO, revertPOToDraft,
    postInvoice, registerPayment, createPurchaseReturn, addReturnLine, confirmPurchaseReturn, logReturnPickup, showToast,
    // View state
    mainView, setMainView, subView, setSubView, activeId, setActiveId,
    typeFilter, setTypeFilter, statusFilter, setStatusFilter,
    // Derived
    vendors, purchasableProds, vendorBills, activePO, activeReceipt, linkedBill, filteredPOs, currentUser, stats,
    // RFQ
    showNewRFQ, setShowNewRFQ, newVendorId, setNewVendorId, newVendorName, setNewVendorName,
    showNewVendorModal, setShowNewVendorModal, openNewVendorForm,
    handleCreateRFQ,
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
    activeReceiptId, setActiveReceiptId, receiptOrigin, openReceiptDetail, closeReceiptDetail, startReceive, openReceive, grnLines, setGrnLines, destLocation, setDestLocation,
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
    {subView === 'receipt' && activeReceipt && <PurchaseReceiptDetail />}

    {/* Guard: form mode without a resolvable PO used to render a blank page
        (e.g. Create RFQ set subView before awaiting createPO). Fall back to list. */}
    {subView === 'form' && !activePO && activeId && (
      <div className="mod-page p-6">
        <p className="text-sm text-[var(--text-3)]">Purchase order not found.</p>
        <button
          type="button"
          className="btn-outline text-xs mt-3"
          onClick={() => { setActiveId(null); setSubView('list') }}
        >
          Back to orders
        </button>
      </div>
    )}
    {subView === 'form' && !activePO && !activeId && (
      <div className="mod-page p-6">
        <p className="text-sm text-[var(--text-3)]">Opening purchase order…</p>
        <button
          type="button"
          className="btn-outline text-xs mt-3"
          onClick={() => setSubView('list')}
        >
          Back to orders
        </button>
      </div>
    )}
    {/* List / receipts / bills view */}
    {subView !== 'form' && subView !== 'receipt' && <div className={`mod-page purchase-workspace purchase-workspace--${mainView}`}>

      <ModuleHeader
        title="Purchases"
        subtitle="Source, receive and pay with control"
        icon={<Fa icon={faClipboardCheck} />}
        color="var(--navy)"
        primaryAction={mainView === 'orders' && ['director', 'admin_officer', 'inventory_officer'].includes(currentUser?.role ?? '') ? (
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => setShowNewRFQ(true)}>
            New RFQ
          </PrimaryActionButton>
        ) : undefined}
        overflowActions={
          <SecondaryActionMenu
            actions={[
              { id: 'import', label: 'Import order lines', onClick: () => setShowImport(true) },
            ]}
          />
        }
      />

      <TabBar
        tabs={[
          { id: 'orders', label: 'Orders' },
          { id: 'receipts', label: 'Receipts' },
          { id: 'returns', label: 'Returns' },
          { id: 'bills', label: 'Bills' },
        ]}
        active={mainView}
        onChange={id => setMainView(id as MainView)}
        maxVisibleMobile={4}
        maxVisibleTablet={4}
        maxVisibleDesktop={4}
        ariaLabel="Purchase sections"
      />

      <div className="mod-body purchase-body">
        <section className="purchase-summary" aria-label="Purchase overview">
          <button type="button" className="purchase-summary__item purchase-summary__item--attention" onClick={() => setMainView('orders')}>
            <span className="purchase-summary__label">Needs action</span>
            <strong className="purchase-summary__value tabular-nums">{(stats.rfqs + stats.pendingGRNs).toLocaleString()}</strong>
            <span className="purchase-summary__hint">RFQs and receipts waiting</span>
          </button>
          <button type="button" className="purchase-summary__item" onClick={() => setMainView('orders')}>
            <span className="purchase-summary__label">Open orders</span>
            <strong className="purchase-summary__value tabular-nums">{stats.activePOs.toLocaleString()}</strong>
            <span className="purchase-summary__hint">Confirmed or partially received</span>
          </button>
          <button type="button" className="purchase-summary__item" onClick={() => setMainView('receipts')}>
            <span className="purchase-summary__label">Awaiting receipt</span>
            <strong className="purchase-summary__value tabular-nums">{stats.pendingGRNs.toLocaleString()}</strong>
            <span className="purchase-summary__hint">Draft GRNs to validate</span>
          </button>
          <button type="button" className="purchase-summary__item purchase-summary__item--money" onClick={() => setMainView('bills')}>
            <span className="purchase-summary__label">Bills due</span>
            <strong className="purchase-summary__value purchase-summary__value--money">{fmtKes(stats.unpaid)}</strong>
            <span className="purchase-summary__hint">Outstanding vendor balance</span>
          </button>
        </section>

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


      </TabContent>

      {/* ── NEW RFQ MODAL ── */}
      {showNewRFQ && (
        <Modal title="New Request for Quotation" subtitle="Create a supplier request with products, quantities and commercial terms" width={980} variant="workspace" onClose={resetRfqForm}>
          <div className="flex flex-col min-h-0">
            <div className="p-4 -mx-6 -mt-6 mb-6 border-b border-[var(--border-lt)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-black text-amber-600">Procurement</p>
                <h3 className="text-sm font-extrabold text-[var(--text-1)] mt-1">Create supplier RFQ</h3>
                <p className="text-[11px] text-[var(--text-4)] mt-0.5">Select a vendor, add requested items, then download or email the RFQ from the detail screen.</p>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${newVendorId ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className={`w-2 h-2 rounded-full ${rfqPreview.invalidLineIndexes.length === 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className={`w-2 h-2 rounded-full ${rfqPreview.total > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="lg:col-span-2">
                  <SearchPicker label="Vendor *" placeholder="Search vendor…" items={vendors}
                    selectedLabel={newVendorName}
                    formatSelected={v => v.name}
                    onSelect={v => { setNewVendorId(v.id); setNewVendorName(v.name) }}
                    renderItem={v => (
                      <div>
                        <p className="font-medium text-xs text-t1">{v.name}</p>
                        <p className="text-[10px] text-t3">{v.email}</p>
                      </div>
                    )} />
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Vendor not in list?</span>
                    <button className="text-[10px] underline cursor-pointer" style={{ color: 'var(--accent)' }} onClick={() => openNewVendorForm()}>+ Create New Vendor</button>
                  </div>
                </div>
                <Field label="Expected Response / Delivery">
                  <input className="form-input text-xs" type="date" value={newRfqExpectedDate} onChange={e => setNewRfqExpectedDate(e.target.value)} />
                </Field>
                <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-4)]">Status</p>
                  <p className="text-xs font-black text-[var(--text-1)] mt-1">Draft RFQ</p>
                  <p className="text-[10px] text-[var(--text-4)] mt-0.5">Send after review.</p>
                </div>
              </div>

              {newVendorId && (() => {
                const v = vendors.find(x => x.id === newVendorId)
                if (!v) return null
                return (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-black text-blue-700">Selected vendor</p>
                      <p className="text-sm font-extrabold text-blue-950 mt-0.5">{v.name}</p>
                      <p className="text-[10px] text-blue-700 mt-0.5">{v.email || v.phone || 'No contact info'}</p>
                    </div>
                    <button type="button" className="text-xs font-bold text-blue-700 hover:text-blue-900 cursor-pointer" onClick={() => { setNewVendorId(''); setNewVendorName('') }}>Clear</button>
                  </div>
                )
              })()}

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-1)]">Requested Items</h4>
                    <p className="text-[10px] text-[var(--text-4)] mt-0.5">Each RFQ line needs a product, quantity, and target unit price.</p>
                  </div>
                  <span className="text-[10px] font-bold text-[var(--text-4)]">{newRfqLines.length} line{newRfqLines.length === 1 ? '' : 's'}</span>
                </div>
                <div className="border border-[var(--border-lt)] rounded-2xl overflow-visible">
                  <div className="dt-scroll">
                    <table data-no-responsive className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Product</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Description</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-24">Qty</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-32">Target Price</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-24">VAT</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-32">Line Total</th>
                          <th className="px-3 py-2.5 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-lt)]">
                        {newRfqLines.map((line, i) => {
                          const previewLine = rfqPreview.lines[i]
                          const isInvalid = rfqPreview.invalidLineIndexes.includes(i)
                          return (
                            <tr key={line.id} className={`transition-colors ${isInvalid ? 'bg-red-50/60' : 'hover:bg-[var(--bg-surface)]/40'}`}>
                              <td className="px-3 py-2">
                                <SearchPicker
                                  label=""
                                  placeholder="Select product..."
                                  items={purchasableProds}
                                  selectedLabel={line.productName}
                                  formatSelected={p => p.name}
                                  onSelect={p => setNewRfqLines(prev => prev.map((x, j) => j === i ? {
                                    ...x,
                                    productId: p.id,
                                    productName: p.name,
                                    description: p.name,
                                    unitPrice: String(p.costPrice || p.salePrice || 0),
                                    taxRate: String(p.taxRate ?? 0),
                                  } : x))}
                                  renderItem={p => (
                                    <div>
                                      <p className="font-medium text-xs text-t1">{p.name}</p>
                                      <p className="text-[10px] text-t3">{p.sku ?? ''} · {fmtKes(p.costPrice || p.salePrice || 0)}</p>
                                    </div>
                                  )}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input className="form-input text-xs w-full" placeholder="Description / specs..." value={line.description} onChange={e => setNewRfqLines(prev => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                              </td>
                              <td className="px-3 py-2">
                                <input type="number" min={1} className="form-input text-xs text-center w-20" value={line.qty} onChange={e => setNewRfqLines(prev => prev.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                                {isInvalid && Number(line.qty) <= 0 && <p className="text-[9px] text-red-600 font-semibold mt-1 text-center">Qty &gt; 0</p>}
                              </td>
                              <td className="px-3 py-2">
                                <input type="number" min={0} className="form-input text-xs text-right w-28" value={line.unitPrice} onChange={e => setNewRfqLines(prev => prev.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} />
                                {isInvalid && Number(line.unitPrice) <= 0 && <p className="text-[9px] text-red-600 font-semibold mt-1 text-right">Price &gt; 0</p>}
                              </td>
                              <td className="px-3 py-2">
                                <select className="form-select text-xs w-20" value={line.taxRate} onChange={e => setNewRfqLines(prev => prev.map((x, j) => j === i ? { ...x, taxRate: e.target.value } : x))}>
                                  <option value="0">0%</option>
                                  <option value={String(companySettings.vatRate ?? 16)}>{companySettings.vatRate ?? 16}%</option>
                                </select>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <p className="text-xs font-black text-[var(--text-1)] font-mono">{fmtKes(previewLine?.total ?? 0)}</p>
                                {previewLine?.taxAmount ? <p className="text-[9px] text-[var(--text-4)] mt-0.5">Tax {fmtKes(previewLine.taxAmount)}</p> : null}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button type="button" onClick={() => setNewRfqLines(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} disabled={newRfqLines.length === 1} className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-4)] hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed">×</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2.5 border-t border-[var(--border-lt)] bg-[var(--bg-surface)]">
                    <button type="button" onClick={() => setNewRfqLines(prev => [...prev, newRfqLine()])} className="flex items-center gap-2 text-xs text-primary-600 hover:underline font-semibold cursor-pointer">+ Add item</button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Vendor notes / terms</label>
                  <textarea className="form-input text-xs" rows={4} placeholder="Delivery terms, warranty request, preferred specs, quote deadline..." value={newRfqNotes} onChange={e => setNewRfqNotes(e.target.value)} />
                </div>
                <div className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-bold text-[var(--text-2)]">RFQ Summary</h4>
                    <Badge status={rfqPreview.canSave ? 'paid' : 'warning'} label={rfqPreview.canSave ? 'Ready' : 'Incomplete'} />
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Subtotal</span><span className="font-bold">{fmtKes(rfqPreview.subtotal)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Tax</span><span className="font-bold">{fmtKes(rfqPreview.taxTotal)}</span></div>
                    <div className="border-t border-[var(--border-lt)] pt-3 flex justify-between text-sm"><span className="font-bold text-[var(--text-1)]">Expected Total</span><span className="font-extrabold text-primary-600">{fmtKes(rfqPreview.total)}</span></div>
                  </div>
                  {rfqPreview.blockedReason && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"><p className="text-[10px] font-bold text-amber-700">{rfqPreview.blockedReason}</p></div>}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-4 border-t border-[var(--border-lt)]">
                <button className="btn-outline text-xs cursor-pointer" onClick={resetRfqForm}>Discard</button>
                <button className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed" disabled={!rfqPreview.canSave} onClick={handleCreateRFQ}>Create RFQ →</button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── NEW VENDOR (full Contacts form) ── */}
      {showNewVendorModal && (
        <ContactFormModal
          key={vendorFormKey}
          forceVendor
          initial={blankCompanyContact({
            name: newVendorSeed,
            isCustomer: false,
            isVendor: true,
          })}
          onClose={() => {
            setShowNewVendorModal(false)
            setNewVendorSeed('')
          }}
          onSaved={(vendor) => {
            setNewVendorId(vendor.id)
            setNewVendorName(vendor.name)
            setShowNewVendorModal(false)
            setNewVendorSeed('')
          }}
        />
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

      </div>{/* mod-body */}
    </div>}

      {/* Return / Import / Scan must live outside subView gates so they open
          above the RFQ/PO detail form (Return to Vendor + Scan are triggered there). */}
      {showReturnModal && (
        <Modal title="Return to Vendor" subtitle="Select products and quantities to return" width={580} onClose={() => setShowReturnModal(false)}>
          <Field label="Return Reason">
            <Select value={returnReason} onChange={v => setReturnReason(v as any)} options={REASON_OPTS} />
          </Field>
          <Divider label="Products to return" />
          {returnLines.map((l, idx) => (
            <div key={idx} className="p-3 rounded-lg mb-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
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
                            style={{ background: 'var(--warning-bg)', border: '1px solid #FDE68A', color: 'var(--warning-text)' }}>
                            <div className="flex items-center gap-1">
                              {s}
                              <button onClick={() => setReturnLines(p => p.map((x, i) => i !== idx ? x : { ...x, serials: x.serials.filter(s2 => s2 !== s) }))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 12 }}>×</button>
                            </div>
                            {sn?.accessories && sn.accessories.length > 0 && (
                              <span className="text-[9px] font-sans" style={{ color: 'var(--warning-text)' }}>
                                {sn.accessories.join(', ')}
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
            <button className="btn-outline" onClick={() => setShowReturnModal(false)} disabled={confirmingReturn}>Cancel</button>
            <button className="btn-primary" style={{ background: 'var(--warning)' }} onClick={handleConfirmReturn} disabled={confirmingReturn}>
              {confirmingReturn ? 'Confirming…' : 'Confirm Return'}
            </button>
          </div>
        </Modal>
      )}

      {showImport && (
        <Modal title="Import PO Lines from CSV" subtitle="Upload a CSV file to bulk-add products to a purchase order" width={720}
          onClose={() => { setShowImport(false); setImportRows([]) }}>

          {/* Step 1 — if no active PO, pick vendor */}
          {!activeId && (
            <div className="p-3 rounded-lg" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
              <p className="text-xs font-semibold text-t1 mb-2">Step 1 — Select vendor for new PO</p>
              <SearchPicker label="Vendor *" placeholder="Search vendor…" items={vendors}
                selectedLabel={importVendorName}
                formatSelected={v => v.name}
                onSelect={v => { setImportVendorId(v.id); setImportVendorName(v.name) }}
                renderItem={v => (
                  <div><p className="text-xs font-medium text-t1">{v.name}</p>
                    <p className="text-[10px] text-t3">{v.email}</p>
                  </div>
                )} />
            </div>
          )}
          {activeId && activePO && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--success-bg)', border: '1px solid #BBF7D0' }}>
              <span style={{ color: 'var(--success)' }}>✓</span>
              <span className="text-t1">Lines will be added to <strong>{activePO.ref}</strong> — {activePO.vendorName}</span>
            </div>
          )}

          {/* Template download */}
          <div className="flex items-center justify-between px-4 py-3 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
            <div>
              <p className="text-xs font-semibold text-t1">Download Import Template</p>
              <p className="text-[10px] text-t3 mt-0.5">CSV format · Opens in Excel, Google Sheets, LibreOffice</p>
            </div>
            <button className="btn-secondary text-[11px]" onClick={downloadTemplate}>⬇ Download Template.csv</button>
          </div>

          {/* Template column guide */}
          <div className="text-[10px] text-t3 px-1">
            <p className="font-medium text-t2 mb-1">Required columns:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[
                ['Product Name', 'Must match a product in the system, or will be added as-is'],
                ['Quantity', 'Positive integer'],
                ['Unit Price (KES)', 'Positive number, no commas'],
                ['Tax Rate (%)', '0–100 (use 16 for standard VAT)'],
                ['Specifications', 'Optional — e.g. "Intel i5, 8GB RAM, 512GB SSD" (use for laptops, desktops, printers)'],
                ['Notes', 'Optional — ignored on import'],
              ].map(([col, hint]) => (
                <div key={col} className="p-2 rounded" style={{ background: 'var(--bg-muted)' }}>
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
              border: `2px dashed ${isDragging ? 'var(--navy)' : 'var(--border)'}`,
              background: isDragging ? '#E8F3FA' : 'var(--bg-surface)',
              padding: '32px 24px',
              minHeight: 120,
            }}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}>
            <span className="text-3xl text-t4" aria-hidden="true"><Fa icon={isDragging ? faFolderOpen : faFileLines} /></span>
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
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--success)' }}><Fa icon={faCheck} aria-hidden="true" /> {importRows.filter(r => r.status === 'ok').length} matched</span>
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}><Fa icon={faTriangleExclamation} aria-hidden="true" /> {importRows.filter(r => r.status === 'warn').length} unmatched</span>
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}><Fa icon={faXmark} aria-hidden="true" /> {importRows.filter(r => r.status === 'error').length} errors</span>
                </div>
              </div>

              <div className="dt-scroll">
              <div className="min-w-[640px] flex flex-col gap-1">
              {/* Preview header */}
              <div className="grid text-[10px] font-medium text-t3 uppercase tracking-wider px-3 py-1.5 rounded"
                style={{ gridTemplateColumns: '24px 1.4fr 50px 100px 50px 1.6fr 100px', background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                <span></span><span>Product</span><span>Qty</span><span>Unit Price</span><span>VAT</span><span>Cost Account</span><span>Status</span>
              </div>

              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {importRows.map((row, i) => {
                  const rowAcct = row.accountCode ? accounts.find(a => a.code === row.accountCode) : null
                  return (
                  <div key={i} className="grid items-center text-xs px-3 py-2 rounded"
                    style={{
                      gridTemplateColumns: '24px 1.4fr 50px 100px 50px 1.6fr 100px',
                      background: row.status === 'error' ? 'var(--danger-bg)' : row.status === 'warn' ? 'var(--warning-bg)' : 'var(--success-bg)',
                      border: `1px solid ${row.status === 'error' ? '#FECACA' : row.status === 'warn' ? '#FDE68A' : '#BBF7D0'}`,
                    }}>
                    <span aria-hidden="true"><Fa icon={row.status === 'ok' ? faCheck : row.status === 'warn' ? faTriangleExclamation : faXmark} /></span>
                    <div className="min-w-0">
                      <p className="font-medium text-t1 truncate" title={row.productName || row.raw['Product Name'] || '—'}>{row.productName || row.raw['Product Name'] || '—'}</p>
                      {row.status !== 'error' && row.requiresSerial && <p className="text-[9px] inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}><Fa icon={faBarcode} aria-hidden="true" /> Serial tracking</p>}
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
                      color: row.status === 'ok' ? 'var(--success)' : row.status === 'warn' ? 'var(--warning)' : 'var(--danger)'
                    }}>{row.message}</span>
                  </div>
                  )
                })}
              </div>
              </div>
              </div>

              {importRows.some(r => r.status === 'warn') && (
                <p className="text-[10px] text-t3 px-1 inline-flex items-center gap-1">
                  <Fa icon={faTriangleExclamation} aria-hidden="true" /> Unmatched products will be added with the name as entered. You can edit them after import.
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

      {showScanModal && (
        <Modal title="Scan Document (AI OCR)" subtitle="Upload a vendor quote or invoice to extract lines" width={480} onClose={() => { setShowScanModal(false); setScanFile(null); setIsScanningScan(false) }}>
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); handleScanFile(e.dataTransfer.files[0] ?? null) }}
            onClick={() => scanFileRef.current?.click()}
            className="mb-4"
            style={{
              border: `2px dashed ${isDragging ? 'var(--navy)' : scanFile ? 'var(--success)' : 'var(--border)'}`,
              borderRadius: 10, padding: '24px 16px', cursor: 'pointer', textAlign: 'center',
              background: isDragging ? '#E8F3FA' : scanFile ? 'var(--success-bg)' : '#FAFAFA',
              transition: 'all 0.15s',
            }}>
            <input ref={scanFileRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={e => handleScanFile(e.target.files?.[0] ?? null)} />
            {isScanningScan ? (
              <div className="flex flex-col items-center justify-center gap-3">
                <svg className="h-8 w-8 animate-spin" style={{ color: 'var(--navy)' }} viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-xs font-bold text-t1">AI is analyzing document...</p>
                <p className="text-[10px] text-t3">Reading supplier, reference, line items, quantities, and prices</p>
              </div>
            ) : scanFile ? (
              <div><div style={{ fontSize: 32 }} className="mb-2 text-t4" aria-hidden="true"><Fa icon={scanFile.type.startsWith('image/') ? faImage : faFileLines} /></div><p className="text-xs font-semibold text-green-700">{scanFile.name}</p></div>
            ) : (
              <div><div style={{ fontSize: 32 }} className="mb-2 text-t4" aria-hidden="true"><Fa icon={faMagnifyingGlass} /></div><p className="text-xs text-t2 font-medium">Drop supplier invoice or quote image here</p><p className="text-[10px] text-t3 mt-1">Supports JPG, PNG, and WebP images — OCR extraction</p></div>
            )}
          </div>
          <div className="flex gap-2 justify-end"><button className="btn-outline" onClick={() => { setShowScanModal(false); setScanFile(null); setIsScanningScan(false) }}>Cancel</button></div>
        </Modal>
      )}
    </PurchaseProvider>
  )
}
