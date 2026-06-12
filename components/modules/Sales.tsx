'use client'
import { useState, useEffect, useMemo, useRef, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  faClipboardCheck,
  faCircleCheck,
  faFileInvoiceDollar,
  faMoneyBillWave,
  faPlus,
  faSearch,
  faArrowLeft,
  faDownload,
  faPrint,
  faTrash,
  faCheck,
  faTruck,
  faBan,
  faRotateLeft,
  faFileAlt,
  faBoxOpen,
  faFileInvoice,
  faUser,
  faCalendarAlt,
  faStickyNote,
  faClockRotateLeft,
  faThLarge,
  faListUl,
  faPencil,
  faXmark,
  faSave,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons'
import { downloadPdf, printPdf } from '@/lib/pdf'
import type { PdfLine } from '@/lib/pdf'
import { printDeliveryNote } from '@/lib/delivery-note-pdf'
import {
  useApp,
  SaleOrder,
  fmtKes,
  fmtDate,
  LOCATIONS,
  SerialNumber,
} from '@/lib/store'
import {
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Confirm,
  StatCard,
  PanelHeader,
  StatusStepper,
  SearchPicker,
  Divider,
  ModuleSkeleton,
} from '@/components/ui'
import { Fa } from '@/components/icons'
import SalesDashboard from './SalesDashboard'
import RepPerformance from './RepPerformance'
import CRM from './CRM'
import AfterSales from './AfterSales'
import { CO } from '@/lib/company'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
const SO_STEPS = ['quotation', 'pending_approval', 'approved', 'confirmed', 'delivered', 'invoiced']
type SalesMode = 'list' | 'crm' | 'dashboard' | 'reps' | 'after_sales'
type SalesView = 'list' | 'form' | 'new' | 'delivery'

type SalesOrderLineView = {
  id: string
  productId?: string
  productName?: string
  description?: string
  qty: number
  qtyDelivered?: number
  unitPrice: number
  subtotal: number
  taxRate?: number
  discount?: number
  discountPercent?: number
  serials?: SerialNumber[]
  serialIds?: string[]
}
type SalesOrderView = SaleOrder & {
  ref: string
  customerId?: string
  customerName: string
  date: string
  deliveryDate?: string
  subtotal: number
  taxTotal: number
  total: number
  lines: SalesOrderLineView[]
  notes?: string
  validUntil?: string
  createdByName?: string
}
type DraftLine = {
  id: string
  productId: string
  productName: string
  description: string
  qty: string
  unitPrice: string
  discount: string
  taxRate: string
}
const uid = () => crypto.randomUUID()

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════
export default function Sales() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <SalesContent />
    </Suspense>
  )
}

function SalesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const {
    saleOrders, contacts, products, serials, invoices, deliveries,
    createSaleOrder, updateSaleOrder, confirmSO, addSOLine, removeSOLine,
    assignSerialToSOLine, addContact, createInvoiceFromSO, validateDelivery,
    deleteSaleOrder, showToast, getStockByLocation, resetSOToDraft, cancelSO,
    getCustomerCreditStatus, users, currentUserId, systemSettings,
    companySettings, bankAccounts, confirmDeliveryWithStockDeduction,
    updateDelivery, outboundReleases, initRelease,
    approvalRequests, approveRequest,
  } = useApp()

  // ── Mode (tab) ──────────────────────────────────────────────────────────
  const defaultMode: SalesMode = 'dashboard'
  const queryMode = searchParams.get('tab') as SalesMode | null
  const [mode, setLocalMode] = useState<SalesMode>(queryMode ?? defaultMode)
  const setMode = (m: SalesMode) => {
    setLocalMode(m)
    const p = new URLSearchParams(searchParams.toString())
    p.set('tab', m)
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }
  useEffect(() => {
    const m = searchParams.get('tab') as SalesMode | null
    if (m && m !== mode) setLocalMode(m)
  }, [searchParams])

  const currentUser = users.find(u => u.id === currentUserId)
  const isAdmin = currentUser?.role === 'director'
  const canEditDiscount = isAdmin || !systemSettings.salesDiscountControl

  // ── View state ──────────────────────────────────────────────────────────
  const [view, setView] = useState<SalesView>('list')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const setFilterAndReset = (v: string) => { setFilter(v); setPage(1) }
  const setSearchAndReset = (v: string) => { setSearch(v); setPage(1) }
  const PAGE_SIZE = 50
  const [listViewMode, setListViewMode] = useState<'table' | 'kanban'>('table')

  // ── New Quotation form state ────────────────────────────────────────────
  const [newCustomer, setNewCustomer] = useState<{ id: string; name: string } | null>(null)
  const [newDeliveryDate, setNewDeliveryDate] = useState('')
  const [newPaymentTerms, setNewPaymentTerms] = useState('30')
  const [newNotes, setNewNotes] = useState('')
  const [newDraftLines, setNewDraftLines] = useState<DraftLine[]>([])

  // ── Inline editing state ────────────────────────────────────────────────
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [editLineQty, setEditLineQty] = useState('')
  const [editLinePrice, setEditLinePrice] = useState('')
  const [editLineDiscount, setEditLineDiscount] = useState('')
  const [editLineTax, setEditLineTax] = useState('')
  const [editLineDesc, setEditLineDesc] = useState('')

  // ── Delivery view state ─────────────────────────────────────────────────
  const [deliveryQtys, setDeliveryQtys] = useState<Record<string, number>>({})
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [dnRecipientName, setDnRecipientName] = useState('')
  const [dnRecipientPhone, setDnRecipientPhone] = useState('')
  const [dnRecipientId, setDnRecipientId] = useState('')
  const [dnAddress, setDnAddress] = useState('')
  const [dnNotes, setDnNotes] = useState('')

  // ── Modals ──────────────────────────────────────────────────────────────
  const [showDelConfirm, setShowDelConfirm] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)
  const [addLineQty, setAddLineQty] = useState('1')
  const [addLineDiscount, setAddLineDiscount] = useState('0')
  const [addLineVat, setAddLineVat] = useState(false)
  const [addLineProduct, setAddLineProduct] = useState<(typeof products)[0] | null>(null)
  const [showDnModal, setShowDnModal] = useState(false)
  const [showCreateContact, setShowCreateContact] = useState(false)
  const [newContactQuery, setNewContactQuery] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [registeringContact, setRegisteringContact] = useState(false)

  // ── Derived data ────────────────────────────────────────────────────────
  const salesOrderViews = saleOrders as unknown as SalesOrderView[]
  const activeOrder = salesOrderViews.find(s => s.id === activeId) ?? null
  const activeOrderApprovals = activeOrder
    ? approvalRequests.filter((request: any) => request.documentType === 'sales_order' && request.documentId === activeOrder.id)
    : []
  const activePendingApproval = activeOrderApprovals.find((request: any) => request.status === 'pending')
  const currentApprovalLevel = activePendingApproval?.approvers?.find((level: any) => level.level === activePendingApproval.currentLevel)
  const canApproveActiveOrder = !!currentUser && !!currentApprovalLevel?.approverIds?.includes(currentUser.id)

  useEffect(() => {
    if (activeOrder?.status === 'confirmed') {
      const init: Record<string, number> = {}
      activeOrder.lines.forEach(l => { init[l.id] = l.qtyDelivered ?? 0 })
      setDeliveryQtys(init)
    }
  }, [activeId, activeOrder?.status])

  const customers = useMemo(() => contacts.filter(c => c.isCustomer), [contacts])
  const sellableProducts = useMemo(() => products.filter(p => p.canBeSold && p.isActive), [products])
  const filtered = useMemo(() => salesOrderViews.filter(s => {
    const mf = filter === 'all' || s.status === filter
    const ms = !search || s.ref.toLowerCase().includes(search.toLowerCase()) || s.customerName.toLowerCase().includes(search.toLowerCase())
    return mf && ms
  }), [salesOrderViews, filter, search])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])
  const stats = useMemo(() => ({
    quotations: salesOrderViews.filter(s => s.status === 'quotation').length,
    pendingApproval: salesOrderViews.filter(s => s.status === 'pending_approval').length,
    confirmed: salesOrderViews.filter(s => s.status === 'confirmed').length,
    toInvoice: salesOrderViews.filter(s => s.status === 'confirmed' || s.status === 'delivered').length,
    revenue: salesOrderViews.filter(s => s.status === 'invoiced').reduce((a, s) => a + s.total, 0),
  }), [salesOrderViews])

  // ── Navigation ──────────────────────────────────────────────────────────
  const openOrder = (id: string) => { setActiveId(id); setView('form'); setEditingLineId(null) }
  const backToList = () => { setView('list'); setActiveId(null); setEditingLineId(null) }
  const openNewForm = () => {
    setNewCustomer(null); setNewDeliveryDate(''); setNewPaymentTerms('30')
    setNewNotes(''); setNewDraftLines([]); setView('new')
  }
  const openDeliveryView = () => {
    if (!activeOrder) return
    const init: Record<string, number> = {}
    activeOrder.lines.forEach(l => { init[l.id] = l.qtyDelivered ?? 0 })
    setDeliveryQtys(init)
    const del = deliveries.find(d => d.saleOrderId === activeOrder.id)
    setDnRecipientName(del?.recipientName ?? activeOrder.customerName ?? '')
    setDnRecipientPhone(del?.recipientPhone ?? '')
    setDnRecipientId(del?.recipientIdNumber ?? '')
    setDnAddress(del?.deliveryAddress ?? '')
    setDnNotes(del?.notes ?? '')
    setView('delivery')
  }

  // ── Draft line helpers ──────────────────────────────────────────────────
  const addDraftLine = () => setNewDraftLines(p => [...p, { id: uid(), productId: '', productName: '', description: '', qty: '1', unitPrice: '0', discount: '0', taxRate: '0' }])
  const updateDraftLine = (id: string, field: keyof DraftLine, value: string) =>
    setNewDraftLines(p => p.map(l => l.id === id ? { ...l, [field]: value } : l))
  const removeDraftLine = (id: string) => setNewDraftLines(p => p.filter(l => l.id !== id))
  const selectProductForDraftLine = (lineId: string, product: typeof products[0]) => {
    setNewDraftLines(p => p.map(l => l.id === lineId ? {
      ...l, productId: product.id, productName: product.name, description: product.name,
      unitPrice: String(product.salePrice), taxRate: String(product.taxRate ?? 0),
    } : l))
  }
  const calcDraftLineTotal = (l: DraftLine) => {
    const qty = Math.max(0, Number(l.qty) || 0)
    const price = Math.max(0, Number(l.unitPrice) || 0)
    const disc = Math.max(0, Math.min(100, Number(l.discount) || 0))
    return Math.round(qty * price * (1 - disc / 100))
  }
  const draftSubtotal = newDraftLines.reduce((a, l) => a + calcDraftLineTotal(l), 0)
  const draftTaxTotal = newDraftLines.reduce((a, l) => a + Math.round(calcDraftLineTotal(l) * (Number(l.taxRate) || 0) / 100), 0)
  const draftTotal = draftSubtotal + draftTaxTotal
  const validDraftLines = newDraftLines.filter(l => l.productId && Number(l.qty) > 0)
  const invalidQtyDraftLines = newDraftLines.filter(l => l.productId && Number(l.qty) <= 0)
  const canSaveNewQuotation = !!newCustomer && validDraftLines.length > 0 && invalidQtyDraftLines.length === 0
  const newQuotationBlockedReason = !newCustomer
    ? 'Select a customer first.'
    : invalidQtyDraftLines.length > 0
      ? 'Quantity must be greater than zero for every quoted product.'
      : validDraftLines.length === 0
        ? 'Add at least one product with quantity greater than zero.'
        : ''

  // ── Save new quotation ──────────────────────────────────────────────────
  const handleSaveNewQuotation = () => {
    if (!newCustomer) { showToast('Please select a customer', 'error'); return }
    if (invalidQtyDraftLines.length > 0) { showToast('Quantity must be greater than zero for every quoted product', 'error'); return }
    if (validDraftLines.length === 0) { showToast('Add at least one product with quantity greater than zero', 'error'); return }
    const creditStatus = getCustomerCreditStatus(newCustomer.id)
    if (creditStatus.isLocked) { showToast(creditStatus.message, 'error'); return }
    const so = createSaleOrder(newCustomer.id, newCustomer.name)
    validDraftLines.forEach(l => {
      const product = products.find(p => p.id === l.productId)
      if (!product) return
      addSOLine(so.id, product, Number(l.qty) || 1, Number(l.discount) || 0, Number(l.taxRate) || 0)
    })
    if (newDeliveryDate || newNotes) {
      updateSaleOrder(so.id, {
        ...(newDeliveryDate ? { deliveryDate: newDeliveryDate } : {}),
        ...(newNotes ? { notes: newNotes } : {}),
      })
    }
    openOrder(so.id)
  }

  // ── Inline line editing ─────────────────────────────────────────────────
  const startEditLine = (l: SalesOrderLineView) => {
    setEditingLineId(l.id)
    setEditLineQty(String(l.qty))
    setEditLinePrice(String(l.unitPrice))
    setEditLineDiscount(String(l.discount ?? l.discountPercent ?? 0))
    setEditLineTax(String(l.taxRate ?? 0))
    setEditLineDesc(l.productName ?? l.description ?? '')
  }
  const cancelEditLine = () => setEditingLineId(null)
  const saveEditLine = (lineId: string) => {
    if (!activeOrder) return
    const qty = Math.max(0, Number(editLineQty) || 0)
    const unitPrice = Math.max(0, Number(editLinePrice) || 0)
    const discount = Math.max(0, Math.min(100, Number(editLineDiscount) || 0))
    const taxRate = Math.max(0, Number(editLineTax) || 0)
    const subtotal = Math.round(qty * unitPrice * (1 - discount / 100))
    const updatedLines = activeOrder.lines.map(l => l.id !== lineId ? l : {
      ...l, productName: editLineDesc || l.productName, description: editLineDesc || l.description,
      qty, unitPrice, discount, discountPercent: discount, taxRate, subtotal,
    })
    const sub = updatedLines.reduce((a, l) => a + l.subtotal, 0)
    const tax = updatedLines.reduce((a, l) => a + Math.round(l.subtotal * (l.taxRate ?? 0) / 100), 0)
    updateSaleOrder(activeOrder.id, { lines: updatedLines, subtotal: sub, taxTotal: tax, total: sub + tax })
    setEditingLineId(null)
  }

  // ── Add line handler ────────────────────────────────────────────────────
  const handleAddLine = () => {
    if (!addLineProduct || !activeId) return
    const qty = Math.max(0, Number(addLineQty) || 0)
    const disc = Number(addLineDiscount) || 0
    if (qty <= 0) { showToast('Quantity must be greater than zero', 'error'); return }
    if (qty > 0 && addLineProduct.unit !== 'service') {
      const locs = getStockByLocation(addLineProduct.id)
      const available = locs.shop + locs.warehouse
      if (available < qty) { showToast(`Only ${available} units available`, 'error'); return }
    }
    addSOLine(activeId, addLineProduct, qty, disc, addLineVat ? companySettings.vatRate : 0)
    setShowAddLine(false); setAddLineProduct(null); setAddLineQty('1'); setAddLineDiscount('0'); setAddLineVat(false)
  }

  // ── PDF builders ────────────────────────────────────────────────────────
  const buildCommercialPdfLines = (so: SalesOrderView, documentTitle: string, statusLabel = so.status.toUpperCase()): PdfLine[] => {
    const rows: PdfLine[] = so.lines.flatMap((l, i) => ([
      { text: l.productName ?? l.description ?? 'Item', x: 40, y: 682 - i * 18, size: 9 },
      { text: String(l.qty), x: 320, y: 682 - i * 18, size: 9 },
      { text: String(fmtKes(l.unitPrice)), x: 380, y: 682 - i * 18, size: 9 },
      { text: String(fmtKes(l.subtotal)), x: 470, y: 682 - i * 18, size: 9 },
    ]))
    const totalsY = 680 - so.lines.length * 18
    return [
      { text: CO.name.toUpperCase(), x: 40, y: 810, size: 16, bold: true },
      { text: `${CO.address}  ·  ${CO.phone}`, x: 40, y: 792, size: 9 },
      { text: documentTitle, x: 400, y: 810, size: 14, bold: true },
      { text: so.ref, x: 430, y: 792, size: 11, bold: true },
      { text: `Date: ${fmtDate(so.date)}`, x: 430, y: 778, size: 9 },
      { text: 'BILL TO', x: 40, y: 755, size: 10, bold: true },
      { text: so.customerName, x: 40, y: 740, size: 11, bold: true },
      { text: '─────────────────────────────────────────────────────────', x: 40, y: 718, size: 9 },
      { text: 'PRODUCT', x: 40, y: 700, size: 9, bold: true },
      { text: 'QTY', x: 320, y: 700, size: 9, bold: true },
      { text: 'UNIT PRICE', x: 380, y: 700, size: 9, bold: true },
      { text: 'TOTAL', x: 470, y: 700, size: 9, bold: true },
      ...rows,
      { text: '─────────────────────────────────────────────────────────', x: 40, y: totalsY, size: 9 },
      { text: `Subtotal: ${String(fmtKes(so.subtotal))}`, x: 380, y: totalsY - 20, size: 10 },
      { text: `Tax: ${String(fmtKes(so.taxTotal))}`, x: 380, y: totalsY - 36, size: 10 },
      { text: `TOTAL: ${String(fmtKes(so.total))}`, x: 380, y: totalsY - 52, size: 12, bold: true },
      { text: `Status: ${String(statusLabel)}`, x: 40, y: totalsY - 52, size: 10 },
    ]
  }
  const buildSoPdfLines = (so: SalesOrderView) => buildCommercialPdfLines(so, 'SALE ORDER')
  const buildQuotePdfLines = (so: SalesOrderView) => buildCommercialPdfLines(so, 'QUOTATION', 'QUOTATION')
  const buildProformaPdfLines = (so: SalesOrderView) => buildCommercialPdfLines(so, 'PRO-FORMA INVOICE', 'PRO-FORMA')

  // ── Status colors ───────────────────────────────────────────────────────
  const statusColors: Record<string, string> = {
    quotation: 'bg-amber-50 text-amber-700 border border-amber-200',
    pending_approval: 'bg-orange-50 text-orange-700 border border-orange-200',
    approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    confirmed: 'bg-blue-50 text-blue-700 border border-blue-200',
    delivered: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    invoiced: 'bg-violet-50 text-violet-700 border border-violet-200',
    cancelled: 'bg-red-50 text-red-600 border border-red-200',
  }

  const getInvoicedQty = (so: SalesOrderView, lineProductId?: string) => {
    if (!lineProductId) return 0
    const inv = invoices.find(i => i.saleOrderId === so.id)
    if (!inv) return 0
    return inv.lines.find(l => l.productId === lineProductId)?.qty ?? 0
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="mod-page">
      {/* Header */}
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#3B82F615', color: '#3B82F6' }}>
            <Fa icon={faClipboardCheck} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-extrabold text-text-1">Sales &amp; CRM</h1>
              <span className="badge badge-gray text-[9px]">{stats.quotations + stats.pendingApproval + stats.confirmed + stats.toInvoice} active</span>
            </div>
            <p className="text-[10px] text-text-3 mt-0.5">Quotations, orders &amp; customer relations</p>
          </div>
        </div>
        <button onClick={openNewForm} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Fa icon={faPlus} />
          <span className="hidden sm:inline">New Quotation</span>
        </button>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 stat-grid-4 border-b border-border-lt bg-surface">
        <StatCard label="Quotations" value={stats.quotations} sub="Active quotes pending" color="#F59E0B" icon={<Fa icon={faClipboardCheck} />} />
        <StatCard label="Approvals" value={stats.pendingApproval} sub="Waiting internal sign-off" color="#F97316" icon={<Fa icon={faClockRotateLeft} />} />
        <StatCard label="Confirmed" value={stats.confirmed} sub="Orders to be delivered" color="#3B82F6" icon={<Fa icon={faCircleCheck} />} />
        <StatCard label="Revenue" value={fmtKes(stats.revenue)} sub="Invoiced this month" color="#10B981" icon={<Fa icon={faMoneyBillWave} />} />
      </div>

      {/* Tabs */}
      <div className="mod-tabs">
        {([
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'list', label: 'All Orders' },
          { id: 'crm', label: 'CRM' },
          { id: 'reps', label: 'Rep Performance' },
          { id: 'after_sales', label: 'After Sales' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setMode(t.id)} className={`mod-tab ${mode === t.id ? 'active' : ''}`}>{t.label}</button>
        ))}
      </div>

      <div className="mod-body">
        <div className="card overflow-hidden m-3 sm:m-4">
          {mode === 'dashboard' ? <SalesDashboard />
          : mode === 'list' ? (
            <div className="flex flex-col">
              {/* ── NEW QUOTATION FULL-PAGE FORM ──────────────────────────── */}
              {view === 'new' ? (
                <NewQuotationForm
                  customers={customers}
                  products={sellableProducts}
                  newCustomer={newCustomer}
                  setNewCustomer={setNewCustomer}
                  newDeliveryDate={newDeliveryDate}
                  setNewDeliveryDate={setNewDeliveryDate}
                  newPaymentTerms={newPaymentTerms}
                  setNewPaymentTerms={setNewPaymentTerms}
                  newNotes={newNotes}
                  setNewNotes={setNewNotes}
                  newDraftLines={newDraftLines}
                  addDraftLine={addDraftLine}
                  updateDraftLine={updateDraftLine}
                  removeDraftLine={removeDraftLine}
                  selectProductForDraftLine={selectProductForDraftLine}
                  calcDraftLineTotal={calcDraftLineTotal}
                  draftSubtotal={draftSubtotal}
                  draftTaxTotal={draftTaxTotal}
                  draftTotal={draftTotal}
                  canEditDiscount={canEditDiscount}
                  companySettings={companySettings}
                  canSave={canSaveNewQuotation}
                  saveBlockedReason={newQuotationBlockedReason}
                  onSave={handleSaveNewQuotation}
                  onCancel={backToList}
                  onCreateNewCustomer={(q) => { setNewContactQuery(q); setShowCreateContact(true) }}
                />
              ) : view === 'delivery' && activeOrder ? (
                /* ── DELIVERY NOTE VIEW ──────────────────────────────────── */
                <DeliveryNoteView
                  order={activeOrder}
                  deliveries={deliveries}
                  serials={serials}
                  deliveryQtys={deliveryQtys}
                  setDeliveryQtys={setDeliveryQtys}
                  savingDelivery={savingDelivery}
                  setSavingDelivery={setSavingDelivery}
                  validateDelivery={validateDelivery}
                  updateDelivery={updateDelivery}
                  showToast={showToast}
                  onBack={() => setView('form')}
                  dnRecipientName={dnRecipientName}
                  setDnRecipientName={setDnRecipientName}
                  dnRecipientPhone={dnRecipientPhone}
                  setDnRecipientPhone={setDnRecipientPhone}
                  dnRecipientId={dnRecipientId}
                  setDnRecipientId={setDnRecipientId}
                  dnAddress={dnAddress}
                  setDnAddress={setDnAddress}
                  dnNotes={dnNotes}
                  setDnNotes={setDnNotes}
                />
              ) : view === 'list' ? (
                /* ── ORDERS LIST ─────────────────────────────────────────── */
                <>
                  <div className="p-4 border-b border-[var(--border-lt)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-1 max-w-md">
                      <div className="relative flex-1">
                        <input type="text" placeholder="Search orders or customers..." className="form-input pl-9"
                          value={search} onChange={e => setSearchAndReset(e.target.value)} />
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]"><Fa icon={faSearch} /></div>
                      </div>
                      <select className="form-select w-32" value={filter} onChange={e => setFilterAndReset(e.target.value)}>
                        <option value="all">All Status</option>
                        <option value="quotation">Quotation</option>
                        <option value="pending_approval">Pending Approval</option>
                        <option value="approved">Approved</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="delivered">Delivered</option>
                        <option value="invoiced">Invoiced</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1 border border-[var(--border-lt)] rounded-lg p-0.5">
                      <button onClick={() => setListViewMode('table')} className={`p-1.5 rounded-md transition-colors ${listViewMode === 'table' ? 'bg-primary-600 text-white' : 'text-[var(--text-3)] hover:bg-[var(--bg-surface)]'}`} title="Table view"><Fa icon={faListUl} className="text-xs" /></button>
                      <button onClick={() => setListViewMode('kanban')} className={`p-1.5 rounded-md transition-colors ${listViewMode === 'kanban' ? 'bg-primary-600 text-white' : 'text-[var(--text-3)] hover:bg-[var(--bg-surface)]'}`} title="Kanban view"><Fa icon={faThLarge} className="text-xs" /></button>
                    </div>
                  </div>
                  {listViewMode === 'kanban' ? (
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {(['quotation', 'pending_approval', 'approved', 'confirmed', 'delivered', 'invoiced'] as const).map(col => {
                        const colOrders = filtered.filter(s => s.status === col)
                        const colColors: Record<string, string> = { quotation: '#F59E0B', pending_approval: '#F97316', approved: '#22C55E', confirmed: '#3B82F6', delivered: '#10B981', invoiced: '#8B5CF6' }
                        return (
                          <div key={col} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: colColors[col] }}>{col}</span>
                              <span className="text-[10px] font-semibold text-[var(--text-4)] bg-[var(--bg-surface)] px-2 py-0.5 rounded-full">{colOrders.length}</span>
                            </div>
                            {colOrders.length === 0 && <div className="border-2 border-dashed border-[var(--border-lt)] rounded-xl p-4 text-center text-[10px] text-[var(--text-4)]">No orders</div>}
                            {colOrders.map(s => (
                              <div key={s.id} onClick={() => openOrder(s.id)} className="card p-3 cursor-pointer hover:shadow-md transition-shadow border-l-4" style={{ borderLeftColor: colColors[col] }}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-bold text-primary-600">{s.ref}</span>
                                  <span className="text-[10px] font-bold text-[var(--text-1)]">{fmtKes(s.total)}</span>
                                </div>
                                <p className="text-[11px] text-[var(--text-2)] truncate">{s.customerName}</p>
                                <p className="text-[10px] text-[var(--text-4)] mt-1">{fmtDate(s.date)} · {s.lines?.length ?? 0} item{(s.lines?.length ?? 0) !== 1 ? 's' : ''}</p>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                            <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Ref</th>
                            <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Customer</th>
                            <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Date</th>
                            <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center">Items</th>
                            <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right">Total</th>
                            <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-lt)]">
                          {paginated.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-12 text-center">
                              {filtered.length === 0 && salesOrderViews.length === 0 ? (
                                <div className="flex flex-col items-center gap-3">
                                  <div className="w-12 h-12 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center">
                                    <svg className="w-6 h-6 text-[var(--text-4)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold text-[var(--text-2)]">No sale orders yet</p>
                                    <p className="text-[11px] text-[var(--text-4)] mt-0.5">Create your first sale order to start tracking sales</p>
                                  </div>
                                  <button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={openNewForm}>+ New Quotation</button>
                                </div>
                              ) : (
                                <p className="text-xs text-[var(--text-4)]">No orders match your filter</p>
                              )}
                            </td></tr>
                          )}
                          {paginated.map(s => (
                            <tr key={s.id} onClick={() => openOrder(s.id)} className="hover:bg-[var(--bg-surface)] cursor-pointer transition-colors">
                              <td className="px-4 py-3 text-xs font-bold text-primary-600">{s.ref}</td>
                              <td className="px-4 py-3 text-xs text-[var(--text-1)]">{s.customerName}</td>
                              <td className="px-4 py-3 text-xs text-[var(--text-3)]">{fmtDate(s.date)}</td>
                              <td className="px-4 py-3 text-xs text-center text-[var(--text-3)]">{s.lines?.length ?? 0}</td>
                              <td className="px-4 py-3 text-xs font-bold text-[var(--text-1)] text-right">{fmtKes(s.total)}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${statusColors[s.status] ?? 'bg-gray-100 text-gray-600'}`}>{s.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-lt)] text-xs text-[var(--text-3)]">
                      <span>{filtered.length} orders · page {page} of {totalPages}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2.5 py-1 rounded border border-[var(--border-lt)] disabled:opacity-40 hover:bg-[var(--bg-surface)] transition-colors">‹ Prev</button>
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(page - 2, totalPages - 4)) + i
                          return <button key={p} onClick={() => setPage(p)} className={`px-2.5 py-1 rounded border transition-colors ${p === page ? 'bg-primary-600 text-white border-primary-600' : 'border-[var(--border-lt)] hover:bg-[var(--bg-surface)]'}`}>{p}</button>
                        })}
                        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2.5 py-1 rounded border border-[var(--border-lt)] disabled:opacity-40 hover:bg-[var(--bg-surface)] transition-colors">Next ›</button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* ── ORDER FORM VIEW ─────────────────────────────────────── */
                <div className="flex flex-col">
                  {/* Action bar */}
                  <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between flex-wrap gap-3">
                    <button onClick={backToList} className="btn-outline flex items-center gap-2"><Fa icon={faArrowLeft} /><span>Back</span></button>
                    <div className="flex items-center gap-2 flex-wrap">
                      {activeOrder?.status === 'quotation' && (<>
                        <button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => downloadPdf(`QUOTE-${activeOrder.ref}.pdf`, buildQuotePdfLines(activeOrder))} disabled={!activeOrder.lines.length} title={!activeOrder.lines.length ? 'Add at least one product first' : 'Download quotation PDF'}><Fa icon={faDownload} /><span>Quote PDF</span></button>
                        <button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => downloadPdf(`PROFORMA-${activeOrder.ref}.pdf`, buildProformaPdfLines(activeOrder))} disabled={!activeOrder.lines.length}><Fa icon={faFileAlt} /><span>Pro-forma</span></button>
                        <button className="btn-primary flex items-center gap-2 text-xs" onClick={() => { if (!activeOrder.lines.length) { showToast('Add at least one product before confirming', 'error'); return } confirmSO(activeOrder.id) }}><Fa icon={faCheck} /><span>Confirm Order</span></button>
                        <button className="btn-danger flex items-center gap-2 text-xs" onClick={() => setShowCancelConfirm(true)}><Fa icon={faBan} /><span>Cancel</span></button>
                        <button className="btn-danger flex items-center gap-2 text-xs" onClick={() => setShowDelConfirm(true)}><Fa icon={faTrash} /><span>Delete</span></button>
                      </>)}
                      {activeOrder?.status === 'pending_approval' && (<>
                        {canApproveActiveOrder && activePendingApproval && (
                          <>
                            <button className="btn-primary flex items-center gap-2 text-xs" onClick={() => approveRequest(activePendingApproval.id, 'approved', `Approved from ${activeOrder.ref}`)}><Fa icon={faCheck} /><span>Approve</span></button>
                            <button className="btn-danger flex items-center gap-2 text-xs" onClick={() => approveRequest(activePendingApproval.id, 'rejected', `Rejected from ${activeOrder.ref}`)}><Fa icon={faXmark} /><span>Reject</span></button>
                          </>
                        )}
                        <button className="btn-outline flex items-center gap-2 text-xs" onClick={() => resetSOToDraft(activeOrder.id)}><Fa icon={faRotateLeft} /><span>Revise</span></button>
                        <button className="btn-danger flex items-center gap-2 text-xs" onClick={() => setShowCancelConfirm(true)}><Fa icon={faBan} /><span>Cancel</span></button>
                      </>)}
                      {activeOrder?.status === 'approved' && (<>
                        <button className="btn-primary flex items-center gap-2 text-xs" onClick={() => confirmSO(activeOrder.id)}><Fa icon={faCheck} /><span>Confirm Approved Order</span></button>
                        <button className="btn-outline flex items-center gap-2 text-xs" onClick={() => resetSOToDraft(activeOrder.id)}><Fa icon={faRotateLeft} /><span>Reset Draft</span></button>
                        <button className="btn-danger flex items-center gap-2 text-xs" onClick={() => setShowCancelConfirm(true)}><Fa icon={faBan} /><span>Cancel</span></button>
                      </>)}
                      {activeOrder?.status === 'confirmed' && (<>
                        <button className="btn-primary flex items-center gap-2 text-xs" onClick={openDeliveryView}><Fa icon={faTruck} /><span>Delivery Note</span></button>
                        <button className="btn-outline flex items-center gap-2 text-xs" onClick={() => resetSOToDraft(activeOrder.id)}><Fa icon={faRotateLeft} /><span>Reset Draft</span></button>
                        <button className="btn-danger flex items-center gap-2 text-xs" onClick={() => setShowCancelConfirm(true)}><Fa icon={faBan} /><span>Cancel</span></button>
                      </>)}
                      {activeOrder?.status === 'delivered' && (
                        <button className="btn-primary flex items-center gap-2 text-xs" onClick={() => { const inv = createInvoiceFromSO(activeOrder.id); if (inv?.id) showToast(`Invoice ${inv.ref} created`, 'success') }}><Fa icon={faFileInvoiceDollar} /><span>Create Invoice</span></button>
                      )}
                      {activeOrder && ['confirmed', 'delivered', 'invoiced'].includes(activeOrder.status) && deliveries.find(d => d.saleOrderId === activeOrder.id) && (
                        <button className="btn-secondary flex items-center gap-1.5 text-xs" onClick={() => { const del = deliveries.find(d => d.saleOrderId === activeOrder!.id)!; setDnRecipientName(del.recipientName ?? activeOrder?.customerName ?? ''); setDnRecipientPhone(del.recipientPhone ?? ''); setDnRecipientId(del.recipientIdNumber ?? ''); setDnAddress(del.deliveryAddress ?? ''); setDnNotes(del.notes ?? ''); setShowDnModal(true) }}><Fa icon={faFileAlt} /><span className="hidden sm:inline">Print DN</span></button>
                      )}
                      {activeOrder && activeOrder.status !== 'quotation' && activeOrder.status !== 'cancelled' && (<>
                        <button className="btn-secondary" onClick={() => printPdf(`SO-${activeOrder.ref}.pdf`, buildSoPdfLines(activeOrder))}><Fa icon={faPrint} /></button>
                        <button className="btn-secondary" onClick={() => downloadPdf(`SO-${activeOrder.ref}.pdf`, buildSoPdfLines(activeOrder))}><Fa icon={faDownload} /></button>
                      </>)}
                    </div>
                  </div>

                  {/* Order form body */}
                  {activeOrder && (
                    <div className="p-6 flex flex-col gap-6">
                      {/* Header: ref + status + smart buttons */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div>
                          <h2 className="text-xl font-bold text-[var(--text-1)]">{activeOrder.ref}</h2>
                          <p className="text-xs text-[var(--text-3)] mt-0.5">{activeOrder.customerName}</p>
                        </div>
                        <div className="flex flex-col items-end gap-3">
                          <StatusStepper steps={SO_STEPS} current={activeOrder.status} />
                          {/* Smart buttons */}
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            {(() => {
                              const del = deliveries.find(d => d.saleOrderId === activeOrder.id)
                              return del ? (
                                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-100 transition-colors" onClick={openDeliveryView}>
                                  <Fa icon={faBoxOpen} className="text-[10px]" /><span>1 Delivery Note</span>
                                </button>
                              ) : activeOrder.status === 'confirmed' ? (
                                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-semibold hover:bg-blue-100 transition-colors" onClick={openDeliveryView}>
                                  <Fa icon={faTruck} className="text-[10px]" /><span>Record Delivery</span>
                                </button>
                              ) : null
                            })()}
                            {(() => {
                              const inv = invoices.find(i => i.saleOrderId === activeOrder.id)
                              return inv ? (
                                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-[11px] font-semibold hover:bg-violet-100 transition-colors">
                                  <Fa icon={faFileInvoice} className="text-[10px]" /><span>1 Invoice</span>
                                </button>
                              ) : null
                            })()}
                          </div>
                        </div>
                      </div>

                      {/* Order info card */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Customer</span>
                          <span className="text-xs font-semibold text-[var(--text-1)]">{activeOrder.customerName}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Order Date</span>
                          <span className="text-xs text-[var(--text-2)]">{fmtDate(activeOrder.date)}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Items</span>
                          <span className="text-xs text-[var(--text-2)]">{activeOrder.lines.length} product{activeOrder.lines.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Order Total</span>
                          <span className="text-xs font-bold text-primary-600">{fmtKes(activeOrder.total)}</span>
                        </div>
                      </div>

                      {activeOrderApprovals.length > 0 && (
                        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-black text-orange-800 uppercase tracking-wider">Approval Workflow</h3>
                              <p className="text-[11px] text-orange-700 mt-1">
                                {activeOrder.approvalRequiredReason || 'This order requires internal approval before confirmation.'}
                              </p>
                            </div>
                            <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                              activeOrder.approvalStatus === 'approved' ? 'bg-emerald-100 text-emerald-700'
                              : activeOrder.approvalStatus === 'rejected' ? 'bg-red-100 text-red-700'
                              : 'bg-orange-100 text-orange-700'
                            }`}>
                              {activeOrder.approvalStatus || 'pending'}
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                            {activeOrderApprovals.map((request: any) => {
                              const currentLevel = request.approvers?.find((level: any) => level.level === request.currentLevel)
                              return (
                                <div key={request.id} className="rounded-xl bg-white/80 border border-orange-100 p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-bold text-slate-900 capitalize">{String(request.type).replace(/_/g, ' ')}</p>
                                    <span className="text-[10px] font-bold text-orange-700 uppercase">{request.status}</span>
                                  </div>
                                  <p className="text-[11px] text-slate-600 mt-1">{request.details?.reason}</p>
                                  {request.status === 'pending' && currentLevel && (
                                    <p className="text-[10px] text-slate-500 mt-2">
                                      Level {request.currentLevel}/{request.approvers.length} · waiting for {currentLevel.role.replace(/_/g, ' ')}
                                    </p>
                                  )}
                                  {request.approvers?.some((level: any) => level.decision) && (
                                    <div className="mt-2 space-y-1">
                                      {request.approvers.filter((level: any) => level.decision).map((level: any) => (
                                        <p key={level.level} className="text-[10px] text-slate-500">
                                          L{level.level}: {level.decision} by {level.decidedByName || 'Approver'}{level.comments ? ` — ${level.comments}` : ''}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                          {activePendingApproval && !canApproveActiveOrder && (
                            <p className="text-[10px] text-orange-700 mt-3 font-semibold">
                              Waiting for the assigned approver before this order can be confirmed.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Lines + Summary */}
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 flex flex-col gap-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-[var(--text-1)]">Order Lines</h3>
                            {activeOrder.status === 'quotation' && (
                              <button onClick={() => setShowAddLine(true)} className="text-xs font-bold text-primary-600 hover:underline flex items-center gap-1">
                                <Fa icon={faPlus} className="text-[10px]" />Add a product
                              </button>
                            )}
                          </div>
                          <div className="overflow-x-auto border border-[var(--border-lt)] rounded-2xl">
                            <table className="w-full text-left border-collapse min-w-[640px]">
                              <thead>
                                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)]">Product / Description</th>
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-14">Qty</th>
                                  {(activeOrder.status === 'confirmed' || activeOrder.status === 'delivered' || activeOrder.status === 'invoiced') && (
                                    <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-20">Delivered</th>
                                  )}
                                  {(activeOrder.status === 'invoiced' || !!invoices.find(i => i.saleOrderId === activeOrder.id)) && (
                                    <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-20">Invoiced</th>
                                  )}
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-24">Unit Price</th>
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-16">Disc%</th>
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-16">Tax%</th>
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-24">Amount</th>
                                  <th className="px-3 py-2 w-12"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border-lt)]">
                                {activeOrder.lines.map(l => {
                                  const lineSerials = serials.filter((s: any) => l.serialIds?.includes(s.id))
                                  const isEditing = editingLineId === l.id
                                  const canEdit = activeOrder.status === 'quotation'
                                  const invoicedQty = getInvoicedQty(activeOrder, l.productId)
                                  const showInvoiced = activeOrder.status === 'invoiced' || !!invoices.find(i => i.saleOrderId === activeOrder.id)
                                  const showDelivered = ['confirmed', 'delivered', 'invoiced'].includes(activeOrder.status)
                                  return (
                                    <tr key={l.id} className={isEditing ? 'bg-blue-50/40' : 'hover:bg-[var(--bg-surface)]/50'}>
                                      <td className="px-3 py-2 text-xs text-[var(--text-1)]">
                                        {isEditing ? (
                                          <input type="text" value={editLineDesc} onChange={e => setEditLineDesc(e.target.value)} className="w-full border border-blue-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                        ) : (
                                          <div>
                                            <span className="font-medium">{l.productName ?? l.description ?? 'Item'}</span>
                                            {lineSerials.length > 0 && (
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {lineSerials.map((s: any) => (
                                                  <span key={s.id} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-mono border border-blue-100">{s.serial ?? s.serialNumber}</span>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-center">
                                        {isEditing ? <input type="number" min={1} value={editLineQty} onChange={e => setEditLineQty(e.target.value)} className="w-14 text-center border border-blue-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                        : <span className="font-semibold">{l.qty}</span>}
                                      </td>
                                      {showDelivered && (
                                        <td className="px-3 py-2 text-xs text-center">
                                          <span className={`font-semibold ${(l.qtyDelivered ?? 0) >= l.qty ? 'text-emerald-600' : (l.qtyDelivered ?? 0) > 0 ? 'text-amber-500' : 'text-[var(--text-4)]'}`}>{l.qtyDelivered ?? 0}</span>
                                        </td>
                                      )}
                                      {showInvoiced && (
                                        <td className="px-3 py-2 text-xs text-center">
                                          <span className={`font-semibold ${invoicedQty > 0 ? 'text-violet-600' : 'text-[var(--text-4)]'}`}>{invoicedQty}</span>
                                        </td>
                                      )}
                                      <td className="px-3 py-2 text-xs text-right">
                                        {isEditing ? <input type="number" min={0} value={editLinePrice} onChange={e => setEditLinePrice(e.target.value)} className="w-20 text-right border border-blue-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                        : fmtKes(l.unitPrice)}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-right">
                                        {isEditing ? <input type="number" min={0} max={100} value={editLineDiscount} onChange={e => setEditLineDiscount(e.target.value)} className="w-14 text-right border border-blue-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                        : <span className="text-[var(--text-3)]">{l.discount ?? l.discountPercent ?? 0}%</span>}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-right">
                                        {isEditing ? <input type="number" min={0} max={100} value={editLineTax} onChange={e => setEditLineTax(e.target.value)} className="w-14 text-right border border-blue-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                        : <span className="text-[var(--text-3)]">{l.taxRate ?? 0}%</span>}
                                      </td>
                                      <td className="px-3 py-2 text-xs font-bold text-right">
                                        {isEditing ? (
                                          <span className="text-primary-600">{fmtKes(Math.round(Math.max(0, Number(editLineQty) || 0) * Math.max(0, Number(editLinePrice) || 0) * (1 - Math.max(0, Math.min(100, Number(editLineDiscount) || 0)) / 100)))}</span>
                                        ) : fmtKes(l.subtotal)}
                                      </td>
                                      <td className="px-3 py-2 text-center">
                                        {isEditing ? (
                                          <div className="flex items-center gap-1">
                                            <button onClick={() => saveEditLine(l.id)} className="w-6 h-6 rounded flex items-center justify-center bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors" title="Save"><Fa icon={faCheck} className="text-[9px]" /></button>
                                            <button onClick={cancelEditLine} className="w-6 h-6 rounded flex items-center justify-center bg-red-100 text-red-600 hover:bg-red-200 transition-colors" title="Cancel"><Fa icon={faXmark} className="text-[9px]" /></button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1">
                                            {canEdit && <button onClick={() => startEditLine(l)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-4)] hover:bg-[var(--bg-surface)] hover:text-primary-600 transition-colors" title="Edit line"><Fa icon={faPencil} className="text-[9px]" /></button>}
                                            {canEdit && <button onClick={() => removeSOLine(activeOrder.id, l.id)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-4)] hover:bg-red-50 hover:text-red-600 transition-colors" title="Remove"><Fa icon={faTrash} className="text-[9px]" /></button>}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                                {activeOrder.lines.length === 0 && (
                                  <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-[var(--text-4)]">
                                    No products added yet.{activeOrder.status === 'quotation' && <button onClick={() => setShowAddLine(true)} className="ml-2 text-primary-600 font-semibold hover:underline">+ Add a product</button>}
                                  </td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          {activeOrder.status === 'quotation' && (
                            <button onClick={() => setShowAddLine(true)} className="flex items-center gap-2 text-xs text-primary-600 hover:underline font-semibold self-start"><Fa icon={faPlus} className="text-[10px]" />Add a product</button>
                          )}
                        </div>

                        {/* Summary */}
                        <div className="flex flex-col gap-4">
                          <div className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
                            <h3 className="text-sm font-bold text-[var(--text-1)] mb-4">Order Summary</h3>
                            <div className="flex flex-col gap-3">
                              <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Subtotal</span><span className="font-bold">{fmtKes(activeOrder.subtotal)}</span></div>
                              <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Tax Total</span><span className="font-bold">{fmtKes(activeOrder.taxTotal)}</span></div>
                              <Divider />
                              <div className="flex justify-between text-sm"><span className="font-bold text-[var(--text-1)]">Total</span><span className="font-extrabold text-primary-600">{fmtKes(activeOrder.total)}</span></div>
                            </div>
                          </div>
                          {activeOrder.notes && (
                            <div className="card p-4 bg-amber-50 border-amber-200">
                              <div className="flex items-start gap-2">
                                <Fa icon={faStickyNote} className="text-amber-500 text-xs mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-amber-800">{activeOrder.notes}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Activity */}
                      <div className="flex flex-col gap-3">
                        <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2"><Fa icon={faClockRotateLeft} className="text-[var(--text-4)] text-xs" />Activity</h3>
                        <div className="flex flex-col gap-0">
                          {[
                            { label: 'Quotation created', date: activeOrder.date, show: true },
                            { label: 'Approval requested', date: activeOrder.date, show: activeOrderApprovals.length > 0 },
                            { label: 'Order approved', date: activeOrder.date, show: activeOrder.approvalStatus === 'approved' },
                            { label: 'Order confirmed', date: activeOrder.date, show: ['confirmed', 'delivered', 'invoiced'].includes(activeOrder.status) },
                            { label: 'Delivery note issued', date: activeOrder.date, show: ['delivered', 'invoiced'].includes(activeOrder.status) && !!deliveries.find(d => d.saleOrderId === activeOrder.id) },
                            { label: 'Invoice created', date: activeOrder.date, show: activeOrder.status === 'invoiced' || !!invoices.find(i => i.saleOrderId === activeOrder.id) },
                          ].filter(e => e.show).map((event, idx, arr) => (
                            <div key={idx} className="flex items-start gap-3 relative">
                              <div className="flex flex-col items-center">
                                <div className="w-2.5 h-2.5 rounded-full bg-primary-500 mt-0.5 flex-shrink-0" />
                                {idx < arr.length - 1 && <div className="w-px flex-1 bg-[var(--border-lt)] my-0.5" style={{ minHeight: 20 }} />}
                              </div>
                              <div className="pb-3">
                                <p className="text-xs font-semibold text-[var(--text-1)]">{event.label}</p>
                                <p className="text-[10px] text-[var(--text-4)]">{fmtDate(event.date)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : mode === 'crm' ? <CRM />
          : mode === 'reps' ? <RepPerformance />
          : <AfterSales />}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showCreateContact && (
        <Modal title="Quick Register Customer" onClose={() => setShowCreateContact(false)} width={500}>
          <div className="flex flex-col gap-4">
            <Field label="Customer/Company Name" required><Input value={newContactQuery} onChange={setNewContactQuery} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" required><Input type="email" value={newContactEmail} onChange={setNewContactEmail} /></Field>
              <Field label="Phone" required><Input type="tel" value={newContactPhone} onChange={setNewContactPhone} /></Field>
            </div>
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowCreateContact(false)} disabled={registeringContact}>Cancel</button>
              <button className="btn-primary" disabled={registeringContact} onClick={async () => {
                if (!newContactQuery.trim() || !newContactEmail.trim() || !newContactPhone.trim()) { showToast('Please fill in all required fields', 'error'); return }
                setRegisteringContact(true)
                try {
                  const contact = await addContact({ type: 'individual', name: newContactQuery.trim(), email: newContactEmail.trim(), phone: newContactPhone.trim(), address: '', isCustomer: true, isVendor: false, tags: [] })
                  setShowCreateContact(false); setNewContactQuery(''); setNewContactEmail(''); setNewContactPhone('')
                  setNewCustomer({ id: contact.id, name: contact.name })
                  if (view !== 'new') { const so = createSaleOrder(contact.id, contact.name); openOrder(so.id) }
                } catch { /* addContact shows error toast */ } finally { setRegisteringContact(false) }
              }}>{registeringContact ? 'Registering…' : 'Register & Create Quotation'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showAddLine && (
        <Modal title="Add Product" onClose={() => setShowAddLine(false)} width={500}>
          <div className="flex flex-col gap-4">
            <SearchPicker label="Product *" placeholder="Search product..." items={sellableProducts} onSelect={setAddLineProduct}
              renderItem={p => (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center text-[10px] font-bold text-primary-600 flex-shrink-0">{p.name?.slice(0, 2).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-xs truncate">{p.name}</p>
                    <p className="text-[10px] text-[var(--text-4)]">{p.category} · {fmtKes(p.salePrice)}{p.stockQty > 0 ? ` · ${p.stockQty} in stock` : ' · out of stock'}</p>
                  </div>
                </div>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity"><Input type="number" value={addLineQty} onChange={setAddLineQty} /></Field>
              {canEditDiscount && <Field label="Discount %"><Input type="number" value={addLineDiscount} onChange={setAddLineDiscount} /></Field>}
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={addLineVat} onChange={e => setAddLineVat(e.target.checked)} className="w-4 h-4 rounded accent-primary-600" />
              <span className="text-xs text-[var(--text-2)]">Apply VAT ({companySettings.vatRate}%)</span>
            </label>
            {addLineProduct && (
              <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-[var(--text-3)]">Line total preview</p>
                  <p className="text-xs text-[var(--text-4)] mt-0.5">{fmtKes(addLineProduct.salePrice)} × {Math.max(1, Number(addLineQty) || 1)}{Number(addLineDiscount) > 0 && ` − ${addLineDiscount}% disc`}{addLineVat && ` + ${companySettings.vatRate}% VAT`}</p>
                </div>
                <p className="text-sm font-extrabold text-primary-600 font-mono">{fmtKes((() => { const qty = Math.max(1, Number(addLineQty) || 1); const disc = Number(addLineDiscount) || 0; const sub = Math.round(addLineProduct.salePrice * qty * (1 - disc / 100)); return sub + (addLineVat ? Math.round(sub * (companySettings.vatRate / 100)) : 0) })())}</p>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowAddLine(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddLine} disabled={!addLineProduct || !Number(addLineQty)}>Add to Order</button>
            </div>
          </div>
        </Modal>
      )}

      {showDelConfirm && activeOrder && (
        <Confirm title="Delete Sale Order" message={`Are you sure you want to delete ${activeOrder.ref}? This cannot be undone.`}
          onConfirm={() => { deleteSaleOrder(activeOrder.id); backToList(); setShowDelConfirm(false) }}
          onCancel={() => setShowDelConfirm(false)} />
      )}
      {showCancelConfirm && activeOrder && (
        <Confirm title="Cancel Order" message={`Cancel ${activeOrder.ref}? This will mark the order as cancelled.`}
          onConfirm={() => { cancelSO(activeOrder.id); setShowCancelConfirm(false) }}
          onCancel={() => setShowCancelConfirm(false)} />
      )}

      {showDnModal && activeId && (() => {
        const del = deliveries.find(d => d.saleOrderId === activeId)
        if (!del) return null
        return (
          <Modal title={`Delivery Note — ${del.ref}`} onClose={() => setShowDnModal(false)} width={480}>
            <div className="flex flex-col gap-4">
              <p className="text-xs text-[var(--text-3)]">Fill in recipient details before printing.</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Received By (Full Name) *"><Input value={dnRecipientName} onChange={setDnRecipientName} placeholder="e.g. John Kamau" /></Field>
                <Field label="Phone"><Input value={dnRecipientPhone} onChange={setDnRecipientPhone} placeholder="+254…" /></Field>
              </div>
              <Field label="ID / Passport No."><Input value={dnRecipientId} onChange={setDnRecipientId} placeholder="National ID or Passport number" /></Field>
              <Field label="Delivery Address"><Input value={dnAddress} onChange={setDnAddress} placeholder="e.g. Westlands, Nairobi" /></Field>
              <Field label="Notes"><textarea className="form-input" rows={2} placeholder="Accessories included, special instructions…" value={dnNotes} onChange={e => setDnNotes(e.target.value)} /></Field>
              <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
                <button className="btn-outline text-xs" onClick={() => setShowDnModal(false)}>Cancel</button>
                <button className="btn-secondary flex items-center gap-1.5 text-xs" onClick={() => {
                  if (dnRecipientName.trim()) updateDelivery(del.id, { recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim() || undefined, recipientIdNumber: dnRecipientId.trim() || undefined, deliveryAddress: dnAddress.trim() || undefined, notes: dnNotes.trim() || undefined })
                  printDeliveryNote(del, serials, { recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim(), recipientIdNumber: dnRecipientId.trim(), deliveryAddress: dnAddress.trim(), notes: dnNotes.trim() })
                  setShowDnModal(false)
                }}><Fa icon={faPrint} /> Print / Download</button>
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW QUOTATION FULL-PAGE FORM
// ═══════════════════════════════════════════════════════════════════════════
function NewQuotationForm({
  customers, products, newCustomer, setNewCustomer, newDeliveryDate, setNewDeliveryDate,
  newPaymentTerms, setNewPaymentTerms, newNotes, setNewNotes, newDraftLines,
  addDraftLine, updateDraftLine, removeDraftLine, selectProductForDraftLine,
  calcDraftLineTotal, draftSubtotal, draftTaxTotal, draftTotal, canEditDiscount,
  companySettings, canSave, saveBlockedReason, onSave, onCancel, onCreateNewCustomer,
}: {
  customers: any[]; products: any[]; newCustomer: { id: string; name: string } | null
  setNewCustomer: (c: { id: string; name: string } | null) => void
  newDeliveryDate: string; setNewDeliveryDate: (v: string) => void
  newPaymentTerms: string; setNewPaymentTerms: (v: string) => void
  newNotes: string; setNewNotes: (v: string) => void
  newDraftLines: DraftLine[]; addDraftLine: () => void
  updateDraftLine: (id: string, field: keyof DraftLine, value: string) => void
  removeDraftLine: (id: string) => void
  selectProductForDraftLine: (lineId: string, product: any) => void
  calcDraftLineTotal: (l: DraftLine) => number
  draftSubtotal: number; draftTaxTotal: number; draftTotal: number
  canEditDiscount: boolean; companySettings: any
  canSave: boolean; saveBlockedReason: string
  onSave: () => void; onCancel: () => void
  onCreateNewCustomer: (query: string) => void
}) {
  const [productSearch, setProductSearch] = useState<Record<string, string>>({})
  const [productDropdownOpen, setProductDropdownOpen] = useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const customerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLTableDataCellElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) setCustomerDropdownOpen(false)
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setProductDropdownOpen(null)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])

  const filteredCustomers = customers.filter(c =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) || (c.email ?? '').toLowerCase().includes(customerSearch.toLowerCase())
  )
  const getFilteredProducts = (search: string) =>
    products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col min-h-[600px]">
      {/* Form header */}
      <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between bg-[var(--bg-surface)]">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="btn-outline flex items-center gap-2 text-xs"><Fa icon={faArrowLeft} /><span>Discard</span></button>
          <div>
            <h2 className="text-sm font-bold text-[var(--text-1)]">New Quotation</h2>
            <p className="text-[10px] text-[var(--text-4)]">Draft — not yet confirmed</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="btn-outline text-xs">Cancel</button>
          <button onClick={onSave} disabled={!canSave} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"><Fa icon={faSave} /><span>Save Quotation</span></button>
        </div>
      </div>

      {/* Form body */}
      <div className="p-6 flex flex-col gap-6">
        {/* Header fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Customer picker */}
          <div className="sm:col-span-2 flex flex-col gap-1.5 relative" ref={customerRef}>
            <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Customer <span className="text-red-500">*</span></label>
            <div className={`form-input cursor-pointer flex items-center justify-between ${!newCustomer ? 'text-[var(--text-4)]' : 'text-[var(--text-1)]'}`} onClick={() => setCustomerDropdownOpen(v => !v)}>
              <span className="text-xs font-medium truncate">{newCustomer ? newCustomer.name : 'Search customer…'}</span>
              <Fa icon={faChevronDown} className={`text-[10px] text-[var(--text-4)] flex-shrink-0 transition-transform ${customerDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            {customerDropdownOpen && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden">
                <div className="p-2 border-b border-[var(--border-lt)]">
                  <input autoFocus type="text" placeholder="Search by name or email…" className="form-input text-xs w-full" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredCustomers.length === 0 ? (
                    <div className="px-3 py-2">
                      <p className="text-xs text-[var(--text-4)] mb-2">No customers found</p>
                      <button className="text-xs text-primary-600 font-semibold hover:underline" onClick={() => { setCustomerDropdownOpen(false); onCreateNewCustomer(customerSearch) }}>+ Register new customer</button>
                    </div>
                  ) : (
                    filteredCustomers.map(c => (
                      <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] transition-colors" onClick={() => { setNewCustomer({ id: c.id, name: c.name }); setCustomerDropdownOpen(false); setCustomerSearch('') }}>
                        <p className="text-xs font-semibold text-[var(--text-1)]">{c.name}</p>
                        <p className="text-[10px] text-[var(--text-4)]">{c.email || c.phone || 'No contact info'}</p>
                      </button>
                    ))
                  )}
                </div>
                {filteredCustomers.length > 0 && (
                  <div className="p-2 border-t border-[var(--border-lt)]">
                    <button className="text-xs text-primary-600 font-semibold hover:underline" onClick={() => { setCustomerDropdownOpen(false); onCreateNewCustomer(customerSearch) }}>+ Register new customer</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Delivery Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Delivery Date</label>
            <input type="date" className="form-input text-xs" value={newDeliveryDate} onChange={e => setNewDeliveryDate(e.target.value)} />
          </div>

          {/* Payment Terms */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Payment Terms</label>
            <select className="form-select text-xs" value={newPaymentTerms} onChange={e => setNewPaymentTerms(e.target.value)}>
              <option value="0">Immediate</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="45">45 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
        </div>

        {/* Order Lines */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Order Lines</h3>
          <div className="border border-[var(--border-lt)] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Product</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Description</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-16">Qty</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-28">Unit Price</th>
                    {canEditDiscount && <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-20">Disc%</th>}
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-20">Tax%</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-28">Amount</th>
                    <th className="px-3 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {newDraftLines.map(line => {
                    const filteredProds = getFilteredProducts(productSearch[line.id] ?? '')
                    const isOpen = productDropdownOpen === line.id
                    const hasInvalidQty = !!line.productId && Number(line.qty) <= 0
                    return (
                      <tr key={line.id} className={`hover:bg-[var(--bg-surface)]/30 ${hasInvalidQty ? 'bg-red-50/60' : ''}`}>
                        {/* Product picker */}
                        <td className="px-3 py-2 relative" ref={isOpen ? dropdownRef : undefined}>
                          <div className="flex items-center gap-1 cursor-pointer border border-[var(--border-lt)] rounded-lg px-2 py-1.5 hover:border-primary-400 transition-colors bg-[var(--bg-card)] min-w-[140px]"
                            onClick={() => setProductDropdownOpen(isOpen ? null : line.id)}>
                            <span className="text-xs text-[var(--text-1)] flex-1 truncate min-w-0">{line.productName || <span className="text-[var(--text-4)]">Select product…</span>}</span>
                            <Fa icon={faChevronDown} className={`text-[9px] text-[var(--text-4)] flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </div>
                          {isOpen && (
                            <div className="absolute top-full left-0 z-50 mt-1 w-72 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden">
                              <div className="p-2 border-b border-[var(--border-lt)]">
                                <input autoFocus type="text" placeholder="Search products…" className="form-input text-xs w-full"
                                  value={productSearch[line.id] ?? ''} onChange={e => setProductSearch(prev => ({ ...prev, [line.id]: e.target.value }))} />
                              </div>
                              <div className="max-h-48 overflow-y-auto">
                                {filteredProds.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-[var(--text-4)]">No products found</p>
                                ) : (
                                  filteredProds.map(p => (
                                    <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] transition-colors"
                                      onClick={() => { selectProductForDraftLine(line.id, p); setProductSearch(prev => ({ ...prev, [line.id]: '' })) }}>
                                      <p className="text-xs font-semibold text-[var(--text-1)]">{p.name}</p>
                                      <p className="text-[10px] text-[var(--text-4)]">{p.category} · {fmtKes(p.salePrice)} · {p.stockQty > 0 ? `${p.stockQty} in stock` : 'out of stock'}</p>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        {/* Description */}
                        <td className="px-3 py-2">
                          <input type="text" className="form-input text-xs w-full" placeholder="Description…" value={line.description} onChange={e => updateDraftLine(line.id, 'description', e.target.value)} />
                        </td>
                        {/* Qty */}
                        <td className="px-3 py-2">
                          <input type="number" min={1} className="form-input text-xs text-center w-16" value={line.qty} onChange={e => updateDraftLine(line.id, 'qty', e.target.value)} />
                          {hasInvalidQty && <p className="text-[9px] text-red-600 font-semibold mt-1">Qty &gt; 0</p>}
                        </td>
                        {/* Unit Price */}
                        <td className="px-3 py-2">
                          <input type="number" min={0} className="form-input text-xs text-right w-28" value={line.unitPrice} onChange={e => updateDraftLine(line.id, 'unitPrice', e.target.value)} />
                        </td>
                        {/* Discount */}
                        {canEditDiscount && (
                          <td className="px-3 py-2">
                            <input type="number" min={0} max={100} className="form-input text-xs text-right w-20" value={line.discount} onChange={e => updateDraftLine(line.id, 'discount', e.target.value)} />
                          </td>
                        )}
                        {/* Tax */}
                        <td className="px-3 py-2">
                          <select className="form-select text-xs w-20" value={line.taxRate} onChange={e => updateDraftLine(line.id, 'taxRate', e.target.value)}>
                            <option value="0">0%</option>
                            <option value={String(companySettings.vatRate)}>{companySettings.vatRate}% VAT</option>
                          </select>
                        </td>
                        {/* Amount */}
                        <td className="px-3 py-2 text-xs font-bold text-right text-[var(--text-1)]">{fmtKes(calcDraftLineTotal(line))}</td>
                        {/* Remove */}
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => removeDraftLine(line.id)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-4)] hover:bg-red-50 hover:text-red-600 transition-colors"><Fa icon={faTrash} className="text-[9px]" /></button>
                        </td>
                      </tr>
                    )
                  })}
                  {newDraftLines.length === 0 && (
                    <tr><td colSpan={canEditDiscount ? 8 : 7} className="px-4 py-6 text-center text-xs text-[var(--text-4)]">No products added yet. Click "Add a product" below.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2.5 border-t border-[var(--border-lt)] bg-[var(--bg-surface)]">
              <button onClick={addDraftLine} className="flex items-center gap-2 text-xs text-primary-600 hover:underline font-semibold"><Fa icon={faPlus} className="text-[10px]" />Add a product</button>
            </div>
          </div>
        </div>

        {/* Notes + Totals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Notes / Terms</label>
            <textarea className="form-input text-xs" rows={4} placeholder="Internal notes, payment terms, special instructions…" value={newNotes} onChange={e => setNewNotes(e.target.value)} />
          </div>
          <div className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
            <h4 className="text-xs font-bold text-[var(--text-2)] mb-4">Summary</h4>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Subtotal</span><span className="font-bold">{fmtKes(draftSubtotal)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Tax</span><span className="font-bold">{fmtKes(draftTaxTotal)}</span></div>
              <div className="border-t border-[var(--border-lt)] pt-3 flex justify-between text-sm"><span className="font-bold text-[var(--text-1)]">Total</span><span className="font-extrabold text-primary-600">{fmtKes(draftTotal)}</span></div>
            </div>
          </div>
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center justify-between pt-4 border-t border-[var(--border-lt)]">
          <button onClick={onCancel} className="btn-outline text-xs">Discard</button>
          <div className="flex flex-col items-end gap-1">
            {saveBlockedReason && <p className="text-[10px] text-amber-600 font-semibold">{saveBlockedReason}</p>}
            <button onClick={onSave} disabled={!canSave} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"><Fa icon={faSave} /><span>Save as Quotation</span></button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERY NOTE VIEW
// ═══════════════════════════════════════════════════════════════════════════
function DeliveryNoteView({
  order, deliveries, serials, deliveryQtys, setDeliveryQtys, savingDelivery,
  setSavingDelivery, validateDelivery, updateDelivery, showToast, onBack,
  dnRecipientName, setDnRecipientName, dnRecipientPhone, setDnRecipientPhone,
  dnRecipientId, setDnRecipientId, dnAddress, setDnAddress, dnNotes, setDnNotes,
}: {
  order: SalesOrderView; deliveries: any[]; serials: any[]
  deliveryQtys: Record<string, number>; setDeliveryQtys: (v: Record<string, number>) => void
  savingDelivery: boolean; setSavingDelivery: (v: boolean) => void
  validateDelivery: (id: string) => void; updateDelivery: (id: string, p: any) => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void; onBack: () => void
  dnRecipientName: string; setDnRecipientName: (v: string) => void
  dnRecipientPhone: string; setDnRecipientPhone: (v: string) => void
  dnRecipientId: string; setDnRecipientId: (v: string) => void
  dnAddress: string; setDnAddress: (v: string) => void
  dnNotes: string; setDnNotes: (v: string) => void
}) {
  const existingDelivery = deliveries.find((d: any) => d.saleOrderId === order.id)

  const handleValidate = async () => {
    if (!order.lines.length) { showToast('No line items on this order', 'error'); return }
    const lines = order.lines.map(l => ({ id: l.id, qtyDelivered: Math.min(l.qty, Math.max(0, deliveryQtys[l.id] ?? 0)) }))
    if (!lines.some(l => l.qtyDelivered > 0)) { showToast('Enter delivered quantities before validating', 'error'); return }
    setSavingDelivery(true)
    try {
      const res = await fetch(`/api/sale-orders/${order.id}/deliver-lines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error ?? 'Failed to save delivery', 'error'); return }
      if (existingDelivery && dnRecipientName.trim()) {
        updateDelivery(existingDelivery.id, {
          recipientName: dnRecipientName.trim(),
          recipientPhone: dnRecipientPhone.trim() || undefined,
          recipientIdNumber: dnRecipientId.trim() || undefined,
          deliveryAddress: dnAddress.trim() || undefined,
          notes: dnNotes.trim() || undefined,
        })
      }
      if (json.allDelivered) {
        showToast('All items delivered — order marked as Delivered', 'success')
        const delivery = deliveries.find((d: any) => d.saleOrderId === order.id)
        if (delivery) validateDelivery(delivery.id)
      } else {
        showToast('Delivery quantities saved (partial delivery)', 'success')
      }
      onBack()
    } catch { showToast('Network error saving delivery', 'error') }
    finally { setSavingDelivery(false) }
  }

  const handlePrintDN = () => {
    if (!existingDelivery) { showToast('No delivery record found. Validate delivery first.', 'error'); return }
    if (dnRecipientName.trim()) {
      updateDelivery(existingDelivery.id, {
        recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim() || undefined,
        recipientIdNumber: dnRecipientId.trim() || undefined, deliveryAddress: dnAddress.trim() || undefined, notes: dnNotes.trim() || undefined,
      })
    }
    import('@/lib/delivery-note-pdf').then(({ printDeliveryNote }) => {
      printDeliveryNote(existingDelivery, serials, {
        recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim(),
        recipientIdNumber: dnRecipientId.trim(), deliveryAddress: dnAddress.trim(), notes: dnNotes.trim(),
      })
    })
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between flex-wrap gap-3 bg-[var(--bg-surface)]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-outline flex items-center gap-2 text-xs"><Fa icon={faArrowLeft} /><span>Back to Order</span></button>
          <div>
            <h2 className="text-sm font-bold text-[var(--text-1)]">Delivery Note — {existingDelivery?.ref ?? 'New'}</h2>
            <p className="text-[10px] text-[var(--text-4)]">{order.ref} · {order.customerName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {existingDelivery && <button onClick={handlePrintDN} className="btn-secondary flex items-center gap-2 text-xs"><Fa icon={faPrint} /><span>Print Delivery Note</span></button>}
          {order.status === 'confirmed' && (
            <button onClick={handleValidate} disabled={savingDelivery} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
              <Fa icon={faCheck} /><span>{savingDelivery ? 'Saving…' : 'Validate Delivery'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-6 flex flex-col gap-6">
        {/* DN Info card */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
          <div className="flex flex-col gap-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Order Ref</span><span className="text-xs font-semibold text-primary-600">{order.ref}</span></div>
          <div className="flex flex-col gap-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Customer</span><span className="text-xs font-semibold text-[var(--text-1)]">{order.customerName}</span></div>
          <div className="flex flex-col gap-1"><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Order Date</span><span className="text-xs text-[var(--text-2)]">{fmtDate(order.date)}</span></div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Status</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize w-fit ${order.status === 'confirmed' ? 'bg-blue-50 text-blue-700 border border-blue-200' : order.status === 'delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>{order.status}</span>
          </div>
        </div>

        {/* Delivery lines */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Products to Deliver</h3>
          <div className="border border-[var(--border-lt)] rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Product</th>
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-28">Demand (Ordered)</th>
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-32">{order.status === 'confirmed' ? 'Done Qty' : 'Delivered'}</th>
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Serial Numbers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-lt)]">
                {order.lines.map(l => {
                  const lineSerials = serials.filter((s: any) => l.serialIds?.includes(s.id))
                  const delivered = deliveryQtys[l.id] ?? l.qtyDelivered ?? 0
                  const isFullyDelivered = delivered >= l.qty
                  const isPartial = delivered > 0 && delivered < l.qty
                  return (
                    <tr key={l.id} className={isFullyDelivered ? 'bg-emerald-50/30' : ''}>
                      <td className="px-4 py-3 text-xs font-medium text-[var(--text-1)]">{l.productName ?? l.description ?? 'Item'}</td>
                      <td className="px-4 py-3 text-xs text-center font-semibold text-[var(--text-2)]">{l.qty}</td>
                      <td className="px-4 py-3 text-xs text-center">
                        {order.status === 'confirmed' ? (
                          <input type="number" min={0} max={l.qty} value={deliveryQtys[l.id] ?? 0}
                            onChange={e => setDeliveryQtys({ ...deliveryQtys, [l.id]: Math.min(l.qty, Math.max(0, Number(e.target.value) || 0)) })}
                            className="w-20 text-center border border-[var(--border-lt)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                        ) : (
                          <span className={`font-semibold ${isFullyDelivered ? 'text-emerald-600' : isPartial ? 'text-amber-500' : 'text-[var(--text-4)]'}`}>{l.qtyDelivered ?? 0}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {lineSerials.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {lineSerials.map((s: any) => <span key={s.id} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-mono border border-blue-100">{s.serial ?? s.serialNumber}</span>)}
                          </div>
                        ) : <span className="text-[var(--text-4)]">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recipient info */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Recipient Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Received By (Full Name)"><Input value={dnRecipientName} onChange={setDnRecipientName} placeholder="e.g. John Kamau" /></Field>
            <Field label="Phone"><Input value={dnRecipientPhone} onChange={setDnRecipientPhone} placeholder="+254…" /></Field>
            <Field label="ID / Passport No."><Input value={dnRecipientId} onChange={setDnRecipientId} placeholder="National ID or Passport number" /></Field>
            <Field label="Delivery Address"><Input value={dnAddress} onChange={setDnAddress} placeholder="e.g. Westlands, Nairobi" /></Field>
          </div>
          <Field label="Notes"><textarea className="form-input text-xs" rows={2} placeholder="Accessories included, special instructions…" value={dnNotes} onChange={e => setDnNotes(e.target.value)} /></Field>
        </div>

        {/* Bottom action bar */}
        {order.status === 'confirmed' && (
          <div className="flex items-center justify-between pt-4 border-t border-[var(--border-lt)]">
            <button onClick={onBack} className="btn-outline text-xs">Back to Order</button>
            <button onClick={handleValidate} disabled={savingDelivery} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
              <Fa icon={faCheck} /><span>{savingDelivery ? 'Saving…' : 'Validate Delivery'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
