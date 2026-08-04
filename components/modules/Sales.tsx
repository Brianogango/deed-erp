'use client'
import { useState, useEffect, useMemo, useRef, Suspense, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  faClipboardCheck,
  faCircleCheck,
  faFileInvoiceDollar,
  faMoneyBillWave,
  faPlus,
  faArrowUp,
  faArrowDown,
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
import { printDeliveryNote } from '@/lib/delivery-note-pdf'
import SerialMultiSelect from '@/components/SerialMultiSelect'
import { hasModuleAccess, canCreateCustomerInvoiceFromSO } from '@/lib/auth/access'
import {
  useSalesStore,
  SaleOrder,
  fmtKes,
  fmtDate,
  LOCATIONS,
  SerialNumber,
  docSeq,
  resolveProductAccounts,
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
  ModuleHeader,
  TabBar,
  useMounted,
  RecordCard,
} from '@/components/ui'
import { PrimaryActionButton, OperationalSummary, TablePageLayout, StatusBadge } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import type { CommercialPdfInput } from '@/lib/commercial-pdf'
import {
  DEFAULT_DOCUMENT_PAYMENT_DETAILS,
  buildPaymentDetailLines,
  normalizeDocumentPaymentDetails,
  type DocumentPaymentDetails,
} from '@/lib/document-payment-details'
import PaymentDetailsPicker from '@/components/payment/PaymentDetailsPicker'
import { resolveListPrice } from '@/lib/pricing/pricelist'
import Chatter from '@/components/erp/Chatter'
import { SalesRecordHeader } from '@/components/modules/sales/SalesRecordHeader'
import { finishUxTask, startUxTask, trackUxEvent } from '@/lib/ux-telemetry'
import {
  SALE_STATUS_BAR,
  SALE_STATUS_LABELS,
  SO_INVOICE_STATUS_LABELS,
  DELIVERY_STATE_LABELS,
  isQuotationStage,
  matchesSalesListFilter,
  hasValidatedDeliveryForInvoice,
  effectiveDeliveryLineQty,
  deliveryDeliveredTotal,
  canGenerateDeliveryNote,
  saleOrderInvoiceStatus,
  isOpenDeliveryStatus,
  deliveriesForSaleOrder,
  remainingUndeliveredByProduct,
  type SalesListFilter,
} from '@/lib/odoo-sales-flow'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
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
  paymentTerms?: string
  createdByName?: string
}
type DraftLine = {
  type: 'item' | 'section'
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
const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const toDateStr = (value: unknown): string => {
  if (!value) return ''
  const d = new Date(value as string)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}
const addDays = (value: string, days: number) => {
  const d = new Date(value)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function normalizeSalesOrderView(raw: any): SalesOrderView {
  const rawLines = Array.isArray(raw?.lines)
    ? raw.lines
    : Array.isArray(raw?.items)
      ? raw.items
      : []
  const lines: SalesOrderLineView[] = rawLines.map((line: any) => {
    const qty = num(line.qty)
    const unitPrice = num(line.unitPrice)
    const discount = num(line.discount ?? line.discountPercent)
    const taxRate = num(line.taxRate)
    const subtotal = num(line.subtotal ?? line.lineTotal, Math.round(qty * unitPrice * (1 - discount / 100)))
    const serialIds = Array.isArray(line.serialIds)
      ? line.serialIds
      : line.serialNumberId
        ? [line.serialNumberId]
        : []

    return {
      ...line,
      id: String(line.id ?? uid()),
      productId: line.productId ?? '',
      productName: line.productName ?? line.description ?? 'Item',
      description: line.description ?? line.productName ?? 'Item',
      qty,
      qtyDelivered: num(line.qtyDelivered),
      unitPrice,
      subtotal,
      taxRate,
      discount,
      discountPercent: num(line.discountPercent ?? discount),
      serialIds,
    }
  })
  const subtotal = num(raw?.subtotal, lines.reduce((sum, line) => sum + line.subtotal, 0))
  const taxTotal = num(raw?.taxTotal ?? raw?.taxAmount, lines.reduce((sum, line) => sum + Math.round(line.subtotal * (line.taxRate ?? 0) / 100), 0))
  const total = num(raw?.total ?? raw?.totalAmount, subtotal + taxTotal)

  return {
    ...raw,
    ref: raw?.ref ?? raw?.orderNumber ?? raw?.id ?? '',
    customerId: raw?.customerId ?? raw?.clientId ?? '',
    customerName: raw?.customerName ?? raw?.client?.name ?? 'Customer',
    date: raw?.date ?? toDateStr(raw?.orderDate),
    deliveryDate: raw?.deliveryDate ? (toDateStr(raw.deliveryDate) || raw.deliveryDate) : raw?.deliveryDate,
    paymentTerms: raw?.paymentTerms,
    subtotal,
    taxTotal,
    total,
    lines,
  } as SalesOrderView
}

// ═══════════════════════════════════════════════════════════════════════════
// MORE-ACTIONS MENU — keeps record action bars down to one primary button
// ═══════════════════════════════════════════════════════════════════════════
type MoreAction = {
  label: string
  icon?: any
  onClick: () => void
  disabled?: boolean
  title?: string
  tone?: 'default' | 'danger'
}

function MoreActionsMenu({ items, label = 'More' }: { items: MoreAction[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const firstDanger = items.findIndex(i => i.tone === 'danger')
  return (
    <div className="relative">
      <button
        type="button"
        className="btn-secondary flex items-center gap-2 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span>{label}</span>
        <Fa icon={faChevronDown} className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-[8990]" aria-hidden="true" onClick={() => setOpen(false)} />
        <div role="menu" className="absolute right-0 top-full z-[9000] mt-2 min-w-52 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-1.5 shadow-xl">
          {items.map((item, idx) => (
            <div key={item.label}>
              {idx === firstDanger && firstDanger > 0 && <div className="my-1 border-t border-[var(--border-lt)]" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${item.tone === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-[var(--text-2)] hover:bg-[var(--bg-surface)]'}`}
                onClick={() => { setOpen(false); item.onClick() }}
              >
                {item.icon && <Fa icon={item.icon} className="w-3.5 text-[11px]" />}
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      </>)}
    </div>
  )
}

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
  const mounted = useMounted()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const {
    saleOrders, contacts, products, serials, invoices, deliveries, returnOrders,
    createSaleOrder, updateSaleOrder, confirmSO, markQuotationSent, setSaleOrderLock,
    addSOLine, removeSOLine, moveSOLine, addSOSection,
    assignSerialsToSOLine, unassignSerialFromSOLine, addContact, createInvoiceFromSO, prepareDelivery, validateDelivery, markDeliveryNoteGenerated,
    deleteSaleOrder, showToast, getStockByLocation, resetSOToDraft, cancelSO,
    getCustomerCreditStatus, users, currentUserId, systemSettings,
    companySettings, bankAccounts, confirmDeliveryWithStockDeduction,
    updateDelivery, outboundReleases, initRelease,
    approvalRequests, approveRequest,
    getDocumentPaymentDetails, setDocumentPaymentDetails,
  } = useSalesStore()

  // The module lands directly on the operational order list. The old
  // module-level dashboard moved to the central dashboard (Analytics section),
  // After Sales lives at /aftersales, and CRM lives exclusively at /crm —
  // legacy deep links are redirected below.
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'after_sales') {
      router.replace('/aftersales')
    } else if (tab === 'crm') {
      const crmTab = searchParams.get('crmTab')
      router.replace(crmTab ? `/crm?crmTab=${crmTab}` : '/crm')
    }
  }, [searchParams, router])

  const currentUser = users.find(u => u.id === currentUserId)
  const isAdmin = currentUser?.role === 'director'
  const canEditDiscount = isAdmin || !systemSettings.salesDiscountControl
  const canInvoiceFromSO = canCreateCustomerInvoiceFromSO(currentUser?.role)

  // ── View state ──────────────────────────────────────────────────────────
  const [view, setView] = useState<SalesView>('list')
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get('id'))
  // Odoo-style menus: Quotations (unconfirmed) vs Orders (confirmed sales).
  const [listTab, setListTab] = useState<'quotations' | 'orders'>('quotations')
  const [filter, setFilter] = useState<SalesListFilter>('all')
  const [search, setSearch] = useState('')
  const setFilterAndReset = (v: SalesListFilter) => { setFilter(v) }
  const setSearchAndReset = (v: string) => { setSearch(v) }
  const setListTabAndReset = (t: 'quotations' | 'orders') => { setListTab(t); setFilter('all') }
  const [listViewMode, setListViewMode] = useState<'table' | 'kanban'>('table')

  // ── New Quotation form state ────────────────────────────────────────────
  const [newCustomer, setNewCustomer] = useState<{ id: string; name: string } | null>(null)
  const [newDeliveryDate, setNewDeliveryDate] = useState('')
  const [newPaymentTerms, setNewPaymentTerms] = useState('30')
  const [newNotes, setNewNotes] = useState('')
  const [newCustomerRef, setNewCustomerRef] = useState('')
  const [newSalesTeam, setNewSalesTeam] = useState('')
  const [newPricelist, setNewPricelist] = useState('RETAIL')
  const [newInvoiceAddress, setNewInvoiceAddress] = useState('')
  const [newDeliveryAddress, setNewDeliveryAddress] = useState('')
  const [newPaymentDetails, setNewPaymentDetails] = useState<DocumentPaymentDetails>({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
  const [newDraftLines, setNewDraftLines] = useState<DraftLine[]>([])
  const draftLoadedRef = useRef(false)
  const draftAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quoteDraftKey = currentUserId ? `deed_sales_quote_draft_${currentUserId}` : 'deed_sales_quote_draft'

  // ── Inline editing state ────────────────────────────────────────────────
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [editLineQty, setEditLineQty] = useState('')
  const [editLinePrice, setEditLinePrice] = useState('')
  const [editLineDiscount, setEditLineDiscount] = useState('')
  const [editLineTax, setEditLineTax] = useState('')
  const [editLineDesc, setEditLineDesc] = useState('')

  // ── Delivery view state ─────────────────────────────────────────────────
  const [deliveryQtys, setDeliveryQtys] = useState<Record<string, number>>({})
  const [focusDeliveryId, setFocusDeliveryId] = useState<string | null>(null)
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [confirmingSO, setConfirmingSO] = useState(false)
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
  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null)
  // Send-by-Email compose dialog (Odoo records recipient + message on the order)
  const [sendModalOrderId, setSendModalOrderId] = useState<string | null>(null)
  const [sendEmailTo, setSendEmailTo] = useState('')
  const [sendEmailMessage, setSendEmailMessage] = useState('')
  // Order attachments (Odoo: documents attached to the quotation/order)
  const [soAttachments, setSoAttachments] = useState<Array<{ id: string; name: string; size: number; uploadedAt: string; uploadedBy: string }>>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

  // ── Derived data ────────────────────────────────────────────────────────
  const salesOrderViews = useMemo(() => (saleOrders as any[]).map(normalizeSalesOrderView), [saleOrders])
  const activeOrder = salesOrderViews.find(s => s.id === activeId) ?? null
  const activeOrderApprovals = activeOrder
    ? approvalRequests.filter((request: any) => request.documentType === 'sales_order' && request.documentId === activeOrder.id)
    : []
  const activePendingApproval = activeOrderApprovals.find((request: any) => request.status === 'pending')
  const currentApprovalLevel = activePendingApproval?.approvers?.find((level: any) => level.level === activePendingApproval.currentLevel)
  const canApproveActiveOrder = !!currentUser && !!currentApprovalLevel?.approverIds?.includes(currentUser.id)

  // Open the compose dialog (Odoo's Send by Email opens an email composer).
  const openSendQuoteModal = (order: SalesOrderView) => {
    const contact = contacts.find(c => c.id === order.customerId)
    setSendEmailTo(order.sentTo ?? contact?.email ?? '')
    setSendEmailMessage(order.sentMessage ?? '')
    setSendModalOrderId(order.id)
  }

  const emailSalesQuote = async (order: SalesOrderView, email: string, message?: string) => {
    if (sendingQuoteId) return
    const contact = contacts.find(c => c.id === order.customerId)
    if (!email) {
      showToast('Enter the recipient email address before sending.', 'error')
      return
    }
    setSendingQuoteId(order.id)
    try {
      const res = await fetch('/api/integrations/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: order.id,
          channels: ['email'],
          message: message || undefined,
          quote: {
            ref: order.ref,
            companyName: order.customerName,
            contactPersonName: order.customerName,
            contactEmail: email,
            contactPhone: contact?.phone ?? '',
            date: order.date,
            subtotal: order.subtotal,
            taxTotal: order.taxTotal,
            total: order.total,
            validUntil: order.validUntil ?? addDays(order.date, 30),
            ownerName: order.createdByName ?? currentUser?.name ?? 'Sales',
            paymentTerms: order.paymentTerms,
            notes: order.notes,
            lines: order.lines
              .filter(line => line.lineType !== 'section')
              .map(line => ({ productName: line.productName, qty: line.qty, unitPrice: line.unitPrice, lineTotal: line.lineTotal })),
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.success === false) {
        const detail =
          body?.message
          || body?.results?.email?.error
          || body?.error
          || 'Quote email failed'
        throw new Error(detail)
      }
      // Odoo: sending the quotation moves it to Quotation Sent (same record,
      // sender/recipient/date/message recorded — no new document is created).
      markQuotationSent(order.id, email, message)
      setSendModalOrderId(null)
      showToast(`Quotation emailed to ${email}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Quote email failed', 'error')
    } finally {
      setSendingQuoteId(null)
    }
  }

  // Shared mapping onto the Odoo-style PDF document.
  const salesDocumentPdfInput = (so: SalesOrderView, title: string, overrides: Partial<CommercialPdfInput> = {}): CommercialPdfInput => {
    const contact = contacts.find(c => c.id === so.customerId)
    const merged = {
      title,
      ref: so.ref,
      date: so.date,
      dueLabel: 'Expiration',
      dueDate: so.validUntil,
      salesperson: so.salespersonName ?? so.createdByName,
      customerName: so.customerName,
      customerAddress: so.invoiceAddress || [contact?.address, contact?.city, contact?.country].filter(Boolean).join(', ') || undefined,
      customerCountry: contact?.country || 'Kenya',
      customerTaxId: contact?.vatNumber || undefined,
      lines: so.lines.map(l => ({
        lineType: l.lineType,
        description: l.productName ?? l.description ?? 'Item',
        qty: l.qty,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate ?? 0,
        subtotal: l.subtotal,
      })),
      subtotal: so.subtotal,
      taxTotal: so.taxTotal,
      total: so.total,
      notes: so.notes,
      currency: so.currencyCode || companySettings.currency || 'KES',
      ...overrides,
    }
    if (!merged.paymentDetailLines) {
      merged.paymentDetailLines = buildPaymentDetailLines({
        details: getDocumentPaymentDetails(so.id),
        company: companySettings,
        bankAccounts,
        documentRef: merged.ref,
      })
    }
    return merged
  }

  // Customer preview / print: the PDF opened in a new tab.
  const previewSalesDocument = async (so: SalesOrderView, title: string, _statusLabel?: string) => {
    const { openCommercialPdf } = await import('@/lib/commercial-pdf')
    const opened = await openCommercialPdf(salesDocumentPdfInput(so, title), companySettings, bankAccounts)
    if (!opened) showToast('Allow pop-ups to preview the document', 'error')
  }

  useEffect(() => {
    if (activeOrder?.status === 'sale') {
      const init: Record<string, number> = {}
      activeOrder.lines.forEach(l => {
        const serialCount = Array.isArray(l.serialIds) ? l.serialIds.length : 0
        init[l.id] = Math.max(Number(l.qtyDelivered) || 0, serialCount)
      })
      setDeliveryQtys(init)
    }
  }, [activeId, activeOrder?.status])

  // Load the order's attachment list whenever a different order is opened.
  useEffect(() => {
    setSoAttachments([])
    if (!activeId) return
    let cancelled = false
    fetch(`/api/sale-order-attachments/${activeId}`)
      .then(res => (res.ok ? res.json() : { attachments: [] }))
      .then(body => { if (!cancelled) setSoAttachments(body.attachments ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeId])

  const uploadSoAttachment = async (file: File) => {
    if (!activeId) return
    setUploadingAttachment(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/sale-order-attachments/${activeId}`, { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Upload failed')
      setSoAttachments(prev => [...prev, body.attachment])
      showToast(`${file.name} attached`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Attachment upload failed', 'error')
    } finally {
      setUploadingAttachment(false)
    }
  }

  const deleteSoAttachment = async (fileId: string) => {
    if (!activeId) return
    try {
      const res = await fetch(`/api/sale-order-attachments/${activeId}?file=${encodeURIComponent(fileId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setSoAttachments(prev => prev.filter(a => a.id !== fileId))
    } catch {
      showToast('Could not remove attachment', 'error')
    }
  }

  const customers = useMemo(() => contacts.filter(c => c.isCustomer), [contacts])
  const sellableProducts = useMemo(() => products.filter(p => p.canBeSold && p.isActive), [products])
  const filtered = useMemo(() => salesOrderViews.filter(s => {
    const tabMatch = listTab === 'quotations'
      ? (isQuotationStage(s.status) || (s.status === 'cancelled' && !s.confirmedAt))
      : (s.status === 'sale' || (s.status === 'cancelled' && !!s.confirmedAt))
    const mf = matchesSalesListFilter(
      { status: s.status, createdByUserId: s.createdByUserId, createdById: s.createdById, lines: s.lines },
      filter,
      currentUserId,
    )
    const ms = !search || s.ref.toLowerCase().includes(search.toLowerCase()) || s.customerName.toLowerCase().includes(search.toLowerCase())
    return tabMatch && mf && ms
  }), [salesOrderViews, listTab, filter, search, currentUserId])
  const stats = useMemo(() => ({
    quotations: salesOrderViews.filter(s => s.status === 'quotation').length,
    quotationsSent: salesOrderViews.filter(s => s.status === 'quotation_sent').length,
    pendingApproval: salesOrderViews.filter(s => isQuotationStage(s.status) && s.approvalStatus === 'pending').length,
    orders: salesOrderViews.filter(s => s.status === 'sale').length,
    toInvoice: salesOrderViews.filter(s =>
      saleOrderInvoiceStatus(s.status, s.lines) === 'to_invoice' &&
      hasValidatedDeliveryForInvoice(deliveries, s.id)
    ).length,
  }), [salesOrderViews, deliveries])

  // Odoo-style derived statuses for the active order.
  const activeInvoiceStatus = activeOrder ? saleOrderInvoiceStatus(activeOrder.status, activeOrder.lines) : 'no'
  const activeDeliveries = useMemo(
    () => activeOrder ? deliveriesForSaleOrder(deliveries, activeOrder.id, { includeCancelled: true }) : [],
    [deliveries, activeOrder],
  )
  const visibleDeliveries = useMemo(
    () => activeDeliveries.filter(d => d.status !== 'cancelled'),
    [activeDeliveries],
  )
  const invoiceDeliveryReady = activeOrder
    ? hasValidatedDeliveryForInvoice(activeDeliveries, activeOrder.id)
    : false
  const activeInvoices = useMemo(
    () => activeOrder ? invoices.filter(i => i.saleOrderId === activeOrder.id) : [],
    [invoices, activeOrder],
  )
  const activePayments = useMemo(
    () => activeInvoices.flatMap(i => i.payments ?? []),
    [activeInvoices],
  )
  const activeReturns = useMemo(
    () => activeOrder ? (returnOrders ?? []).filter((r: any) => r.saleOrderId === activeOrder.id) : [],
    [returnOrders, activeOrder],
  )
  // Smart buttons only appear when the user can open the related records.
  const canSeeFinanceRecords = hasModuleAccess(currentUser, 'accounting')
  const canSeeReturns = hasModuleAccess(currentUser, 'after_sales')

  // Persist the open quotation/order in the URL so refresh keeps the same page.
  const syncOrderUrl = useCallback((id: string | null, nextView: SalesView = 'form') => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('tab')
    params.delete('crmTab')
    if (id) {
      params.set('id', id)
      if (nextView === 'delivery') params.set('view', 'delivery')
      else params.delete('view')
    } else {
      params.delete('id')
      params.delete('view')
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, router, pathname])

  useEffect(() => {
    const urlId = searchParams.get('id')
    if (!urlId) {
      // Browser back/forward cleared ?id= — leave the list, not a stale form.
      if (view === 'form' || view === 'delivery') {
        setActiveId(null)
        setView('list')
        setEditingLineId(null)
      }
      return
    }
    const order = saleOrders.find(s => s.id === urlId)
    if (!order) return // wait until store hydrates
    setActiveId(urlId)
    const urlView = searchParams.get('view')
    setView(urlView === 'delivery' ? 'delivery' : 'form')
    if (isQuotationStage(order.status)) setListTab('quotations')
    else if (order.status === 'sale') setListTab('orders')
  }, [searchParams, saleOrders]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally omit view

  // ── Navigation ──────────────────────────────────────────────────────────
  const openOrder = (id: string) => {
    setActiveId(id)
    setView('form')
    setEditingLineId(null)
    syncOrderUrl(id, 'form')
  }
  const backToList = () => {
    setView('list')
    setActiveId(null)
    setEditingLineId(null)
    syncOrderUrl(null)
  }
  const openNewForm = () => {
    setNewCustomer(null); setNewDeliveryDate(''); setNewPaymentTerms('30')
    setNewNotes(''); setNewCustomerRef(''); setNewSalesTeam(''); setNewPricelist('')
    setNewInvoiceAddress(''); setNewDeliveryAddress('')
    setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
    setNewDraftLines([]); setView('new')
    syncOrderUrl(null)
    startUxTask('sales_quote_create', { module: 'sales' })
  }
  const openDeliveryView = (deliveryId?: string) => {
    if (!activeOrder) return
    // Heal duplicate open pickings left by concurrent confirm (keep prepared / SO-linked).
    const open = activeDeliveries
      .filter(d => isOpenDeliveryStatus(d.status))
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.ref).localeCompare(String(b.ref)))
    if (open.length > 1) {
      const keeper =
        open.find(d => d.preparedAt) ??
        open.find(d => d.id === activeOrder.deliveryId) ??
        open[0]
      let cancelled = 0
      open.forEach(d => {
        if (d.id !== keeper.id && !d.preparedAt) {
          updateDelivery(d.id, { status: 'cancelled' })
          cancelled += 1
        }
      })
      if (cancelled > 0) {
        showToast(`Removed ${cancelled} duplicate open delivery for ${activeOrder.ref}`, 'info')
      }
    }
    const target =
      (deliveryId ? activeDeliveries.find(d => d.id === deliveryId) : undefined) ??
      open[0] ??
      visibleDeliveries[0] ??
      activeDeliveries[0]
    setFocusDeliveryId(target?.id ?? null)
    const remaining = remainingUndeliveredByProduct(activeOrder.lines)
    const init: Record<string, number> = {}
    activeOrder.lines.forEach(l => {
      if ((l as any).lineType === 'section') return
      const delLine = target?.lines?.find((line: any) => line.productId === l.productId)
      const demand = Math.max(0, Number(delLine?.qty) || remaining[l.productId ?? ''] || Number(l.qty) || 0)
      const serialCount = Array.isArray(l.serialIds) ? l.serialIds.length : 0
      init[l.id] = serialCount > 0 ? Math.min(demand, serialCount) : demand
    })
    setDeliveryQtys(init)
    setDnRecipientName(target?.recipientName ?? activeOrder.customerName ?? '')
    setDnRecipientPhone(target?.recipientPhone ?? '')
    setDnRecipientId(target?.recipientIdNumber ?? '')
    setDnAddress(target?.deliveryAddress ?? '')
    setDnNotes(target?.notes ?? '')
    setView('delivery')
    syncOrderUrl(activeOrder.id, 'delivery')
  }

  // ── Draft line helpers ──────────────────────────────────────────────────
  const addDraftLine = () => setNewDraftLines(p => [...p, { type: 'item', id: uid(), productId: '', productName: '', description: '', qty: '1', unitPrice: '0', discount: '0', taxRate: '0' }])
  const addDraftSection = () => setNewDraftLines(p => [...p, { type: 'section', id: uid(), productId: '', productName: '', description: '', qty: '0', unitPrice: '0', discount: '0', taxRate: '0' }])
  const updateDraftLine = (id: string, field: keyof DraftLine, value: string) =>
    setNewDraftLines(p => p.map(l => l.id === id ? { ...l, [field]: value } : l))
  const removeDraftLine = (id: string) => setNewDraftLines(p => p.filter(l => l.id !== id))
  const moveDraftLine = (id: string, direction: -1 | 1) =>
    setNewDraftLines(p => {
      const index = p.findIndex(l => l.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= p.length) return p
      const next = [...p]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  const selectProductForDraftLine = (lineId: string, product: typeof products[0]) => {
    const qty = 1
    const priced = resolveListPrice({ product, pricelist: newPricelist || 'RETAIL', qty })
    // Unit price on the quote = catalog sales price (via active pricelist). Keep 0 when
    // the catalog price is 0 so the field stays editable instead of looking blank/broken.
    const unitPrice = Number.isFinite(priced.unitPrice) ? Math.max(0, priced.unitPrice) : Math.max(0, Number(product.salePrice) || 0)
    setNewDraftLines(p => p.map(l => l.id === lineId ? {
      ...l, type: 'item', productId: product.id, productName: product.name, description: product.name,
      unitPrice: String(unitPrice), taxRate: String(product.taxRate ?? 0),
    } : l))
  }
  const calcDraftLineTotal = (l: DraftLine) => {
    if (l.type === 'section') return 0
    const qty = Math.max(0, Number(l.qty) || 0)
    const price = Math.max(0, Number(l.unitPrice) || 0)
    const disc = Math.max(0, Math.min(100, Number(l.discount) || 0))
    return Math.round(qty * price * (1 - disc / 100))
  }
  const draftSubtotal = newDraftLines.reduce((a, l) => a + calcDraftLineTotal(l), 0)
  const draftTaxTotal = newDraftLines.reduce((a, l) => a + Math.round(calcDraftLineTotal(l) * (Number(l.taxRate) || 0) / 100), 0)
  const draftTotal = draftSubtotal + draftTaxTotal
  const validDraftLines = newDraftLines.filter(l => l.type !== 'section' && l.productId && Number(l.qty) > 0)
  const invalidQtyDraftLines = newDraftLines.filter(l => l.type !== 'section' && l.productId && Number(l.qty) <= 0)
  const canSaveNewQuotation = !!newCustomer && validDraftLines.length > 0 && invalidQtyDraftLines.length === 0
  const newQuotationBlockedReason = !newCustomer
    ? 'Select a customer first.'
    : invalidQtyDraftLines.length > 0
      ? 'Quantity must be greater than zero for every quoted product.'
      : validDraftLines.length === 0
        ? 'Add at least one product with quantity greater than zero.'
        : ''

  useEffect(() => {
    if (view !== 'new' || draftLoadedRef.current) return
    try {
      const raw = localStorage.getItem(quoteDraftKey)
      if (!raw) {
        draftLoadedRef.current = true
        return
      }
      const parsed = JSON.parse(raw) as {
        customer: { id: string; name: string } | null
        deliveryDate: string
        paymentTerms: string
        notes: string
        customerRef?: string
        salesTeam?: string
        pricelist?: string
        invoiceAddress?: string
        deliveryAddress?: string
        paymentDetails?: Partial<DocumentPaymentDetails>
        lines: DraftLine[]
      }
      if (parsed.customer) setNewCustomer(parsed.customer)
      if (parsed.deliveryDate) setNewDeliveryDate(parsed.deliveryDate)
      if (parsed.paymentTerms) setNewPaymentTerms(parsed.paymentTerms)
      if (parsed.notes) setNewNotes(parsed.notes)
      if (parsed.customerRef) setNewCustomerRef(parsed.customerRef)
      if (parsed.salesTeam) setNewSalesTeam(parsed.salesTeam)
      if (parsed.pricelist) setNewPricelist(parsed.pricelist)
      if (parsed.invoiceAddress) setNewInvoiceAddress(parsed.invoiceAddress)
      if (parsed.deliveryAddress) setNewDeliveryAddress(parsed.deliveryAddress)
      if (parsed.paymentDetails) setNewPaymentDetails(normalizeDocumentPaymentDetails(parsed.paymentDetails))
      if (Array.isArray(parsed.lines) && parsed.lines.length > 0) {
        setNewDraftLines(parsed.lines.map(line => ({
          ...line,
          type: line.type === 'section' ? 'section' : 'item',
        })))
      }
      draftLoadedRef.current = true
    } catch {
      draftLoadedRef.current = true
    }
  }, [view, quoteDraftKey])

  // Re-seed line unit prices only when the pricelist itself changes — never when
  // the products array refreshes, or manual unit-price edits get wiped mid-typing.
  useEffect(() => {
    if (view !== 'new' || !systemSettings.salesPricelists) return
    setNewDraftLines(prev => prev.map(line => {
      if (line.type === 'section' || !line.productId) return line
      const product = products.find(p => p.id === line.productId)
      if (!product) return line
      const qty = Math.max(1, Number(line.qty) || 1)
      const priced = resolveListPrice({ product, pricelist: newPricelist || 'RETAIL', qty })
      const unitPrice = Number.isFinite(priced.unitPrice) ? Math.max(0, priced.unitPrice) : Math.max(0, Number(product.salePrice) || 0)
      return { ...line, unitPrice: String(unitPrice) }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only react to pricelist switches
  }, [newPricelist])

  useEffect(() => {
    if (view !== 'new') return
    if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current)
    draftAutosaveTimerRef.current = setTimeout(() => {
      const payload = {
        customer: newCustomer,
        deliveryDate: newDeliveryDate,
        paymentTerms: newPaymentTerms,
        notes: newNotes,
        customerRef: newCustomerRef,
        salesTeam: newSalesTeam,
        pricelist: newPricelist,
        invoiceAddress: newInvoiceAddress,
        deliveryAddress: newDeliveryAddress,
        paymentDetails: newPaymentDetails,
        lines: newDraftLines,
      }
      try {
        localStorage.setItem(quoteDraftKey, JSON.stringify(payload))
      } catch {
        // ignore storage errors
      }
      trackUxEvent('form_autosave', { form: 'sales_quote', lines: newDraftLines.length })
    }, 550)
    return () => {
      if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current)
    }
  }, [view, quoteDraftKey, newCustomer, newDeliveryDate, newPaymentTerms, newNotes, newCustomerRef, newSalesTeam, newPricelist, newInvoiceAddress, newDeliveryAddress, newPaymentDetails, newDraftLines])

  // ── Save new quotation ──────────────────────────────────────────────────
  const saveNewQuotation = async (openCreatedOrder: boolean) => {
    if (!newCustomer) { showToast('Please select a customer', 'error'); return }
    if (invalidQtyDraftLines.length > 0) { showToast('Quantity must be greater than zero for every quoted product', 'error'); return }
    if (validDraftLines.length === 0) { showToast('Add at least one product with quantity greater than zero', 'error'); return }
    const creditStatus = getCustomerCreditStatus(newCustomer.id)
    if (creditStatus.isLocked) { showToast(creditStatus.message, 'error'); return }
    const builtLines = []
    for (const l of newDraftLines) {
      if (l.type === 'section') {
        if (!l.description.trim()) continue
        builtLines.push({
          id: uid(),
          lineType: 'section',
          productId: '',
          productName: l.description.trim(),
          description: l.description.trim(),
          qty: 0,
          unitPrice: 0,
          discount: 0,
          taxRate: 0,
          subtotal: 0,
          serialIds: [],
          accountCode: undefined,
        })
        continue
      }
      if (!l.productId || Number(l.qty) <= 0) continue
      const product = products.find(p => p.id === l.productId)
      if (!product) { showToast(`Product not found for ${l.productName || l.description}`, 'error'); return }
      const qty = Number(l.qty) || 1
      // A quotation records commercial demand; it does not reserve stock.
      // Availability is enforced later when the confirmed SO is prepared for delivery.
      // Preserve typed unit price including 0 — `Number(x) || undefined` would drop 0.
      const typedPrice = Number(l.unitPrice)
      const priced = resolveListPrice({
        product,
        pricelist: newPricelist || 'RETAIL',
        qty,
        customPrice: Number.isFinite(typedPrice) ? typedPrice : undefined,
      })
      const unitPrice = Math.max(0, priced.unitPrice)
      const discount = Number(l.discount) || 0
      const subtotal = Math.round(unitPrice * qty * (1 - discount / 100))
      builtLines.push({
        id: uid(),
        lineType: 'item',
        productId: product.id,
        productName: product.name,
        qty,
        unitPrice,
        discount,
        taxRate: Number(l.taxRate) || 0,
        subtotal,
        serialIds: [],
        accountCode: product ? resolveProductAccounts(product).saleAccountCode : undefined,
      })
    }
    const so = await createSaleOrder(newCustomer.id, newCustomer.name, {
      lines: builtLines as any,
      ...(newDeliveryDate ? { deliveryDate: newDeliveryDate } : {}),
      paymentTerms: newPaymentTerms === '0' ? 'Immediate' : `${newPaymentTerms} days`,
      validUntil: addDays(new Date().toISOString().slice(0, 10), Number(newPaymentTerms) || 0),
      ...(newNotes ? { notes: newNotes } : {}),
      ...(newCustomerRef ? { customerRef: newCustomerRef } : {}),
      ...(newSalesTeam ? { salesTeam: newSalesTeam } : {}),
      ...(newPricelist ? { pricelist: newPricelist } : {}),
      ...(newInvoiceAddress ? { invoiceAddress: newInvoiceAddress } : {}),
      ...(newDeliveryAddress ? { deliveryAddress: newDeliveryAddress } : {}),
    })
    setDocumentPaymentDetails(so.id, newPaymentDetails)
    try {
      localStorage.removeItem(quoteDraftKey)
    } catch {
      // ignore
    }
    finishUxTask('success', { task: 'sales_quote_create', lines: builtLines.length, total: so.total })
    if (openCreatedOrder) {
      openOrder(so.id)
      return
    }
    setNewCustomer(null)
    setNewDeliveryDate('')
    setNewPaymentTerms('30')
    setNewNotes('')
    setNewCustomerRef('')
    setNewSalesTeam('')
    setNewPricelist('')
    setNewInvoiceAddress('')
    setNewDeliveryAddress('')
    setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
    setNewDraftLines([])
    showToast('Quotation saved. Continue with another entry.', 'success')
    startUxTask('sales_quote_create', { module: 'sales', chained: true })
  }
  const handleSaveNewQuotation = () => saveNewQuotation(true)
  const handleSaveAndAddAnotherQuotation = () => saveNewQuotation(false)

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
    addSOLine(activeId, addLineProduct, qty, disc, addLineVat ? companySettings.vatRate : 0)
    setShowAddLine(false); setAddLineProduct(null); setAddLineQty('1'); setAddLineDiscount('0'); setAddLineVat(false)
  }

  // ── Commercial document builders (real PDF downloads) ───────────────────
  const downloadSalesDocument = async (so: SalesOrderView, title: string, _filePrefix?: string, _statusLabel?: string) => {
    try {
      const { downloadCommercialPdf } = await import('@/lib/commercial-pdf')
      await downloadCommercialPdf(salesDocumentPdfInput(so, title), companySettings, bankAccounts, `${title} - ${so.ref}.pdf`)
    } catch {
      showToast('PDF generation failed', 'error')
    }
  }

  // Pro-forma invoices run their own PI/YYYY/NNNN sequence. The number is
  // assigned the first time a pro-forma is issued for the order and kept on
  // the record, so reprints reuse the same number.
  const downloadProformaInvoice = async (so: SalesOrderView) => {
    let piRef = so.proformaRef
    if (!piRef) {
      piRef = docSeq('PI')
      updateSaleOrder(so.id, { proformaRef: piRef })
    }
    try {
      const { downloadCommercialPdf } = await import('@/lib/commercial-pdf')
      await downloadCommercialPdf(
        salesDocumentPdfInput(so, 'Pro-forma Invoice', { ref: piRef, sourceRef: so.ref }),
        companySettings,
        bankAccounts,
        `Pro-forma Invoice - ${piRef}.pdf`,
      )
    } catch {
      showToast('PDF generation failed', 'error')
    }
  }

  const statusPill = (s: SalesOrderView) => (
    <StatusBadge status={s.status} label={SALE_STATUS_LABELS[s.status] ?? s.status} size="xs" />
  )

  const salesListColumns: ColumnDef<SalesOrderView>[] = useMemo(() => [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '110px',
      render: s => <span className="text-xs font-bold text-primary-600">{s.ref}</span>,
      accessor: s => s.ref,
    },
    {
      key: 'customer', label: 'Customer', priority: 1, width: '1.6fr',
      render: s => <span className="text-xs text-[var(--text-1)] truncate">{s.customerName}</span>,
      accessor: s => s.customerName,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '120px',
      render: s => <span className="text-xs text-[var(--text-3)]">{fmtDate(s.date)}</span>,
      accessor: s => s.date,
      exportValue: s => s.date,
    },
    {
      key: 'items', label: 'Items', priority: 3, width: '90px', align: 'center',
      render: s => <span className="text-xs text-[var(--text-3)]">{s.lines?.length ?? 0}</span>,
      accessor: s => s.lines?.length ?? 0,
    },
    {
      key: 'total', label: 'Total', priority: 1, width: '140px', align: 'right',
      render: s => <span className="text-xs font-bold text-[var(--text-1)]">{fmtKes(s.total)}</span>,
      accessor: s => s.total,
      exportValue: s => s.total,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '160px', align: 'center',
      render: s => (
        <span className="inline-flex flex-col items-center gap-0.5">
          {statusPill(s)}
          {s.status === 'sale' && saleOrderInvoiceStatus(s.status, s.lines) === 'to_invoice' && (
            <span className="text-[9px] font-semibold text-amber-600">To invoice</span>
          )}
        </span>
      ),
      accessor: s => SALE_STATUS_LABELS[s.status] ?? s.status,
      exportValue: s => SALE_STATUS_LABELS[s.status] ?? s.status,
    },
  ], [])

  const getInvoicedQty = (so: SalesOrderView, lineProductId?: string) => {
    if (!lineProductId) return 0
    const inv = invoices.find(i => i.saleOrderId === so.id)
    if (!inv) return 0
    return inv.lines.find(l => l.productId === lineProductId)?.qty ?? 0
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page">
      <ModuleHeader
        title="Sales"
        subtitle="Quotations, orders and deliveries"
        icon={<Fa icon={faClipboardCheck} />}
        count={stats.quotations + stats.quotationsSent + stats.orders}
        color="var(--primary)"
        primaryAction={
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openNewForm}>
            New quotation
          </PrimaryActionButton>
        }
      />

      {view === 'list' && (
        <TabBar
          tabs={[
            { id: 'quotations', label: `Quotations (${stats.quotations + stats.quotationsSent})` },
            { id: 'orders', label: `Orders (${stats.orders})` },
          ]}
          active={listTab}
          onChange={id => setListTabAndReset(id as 'quotations' | 'orders')}
          maxVisibleDesktop={6}
          ariaLabel="Sales sections"
        />
      )}

      <div className="mod-body">
        <div className="card overflow-hidden">
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
                  newCustomerRef={newCustomerRef}
                  setNewCustomerRef={setNewCustomerRef}
                  newSalesTeam={newSalesTeam}
                  setNewSalesTeam={setNewSalesTeam}
                  newPricelist={newPricelist}
                  setNewPricelist={setNewPricelist}
                  newInvoiceAddress={newInvoiceAddress}
                  setNewInvoiceAddress={setNewInvoiceAddress}
                  newDeliveryAddress={newDeliveryAddress}
                  setNewDeliveryAddress={setNewDeliveryAddress}
                  newPaymentDetails={newPaymentDetails}
                  setNewPaymentDetails={setNewPaymentDetails}
                  pricelistsEnabled={systemSettings.salesPricelists}
                  newDraftLines={newDraftLines}
                  addDraftLine={addDraftLine}
                  addDraftSection={addDraftSection}
                  updateDraftLine={updateDraftLine}
                  removeDraftLine={removeDraftLine}
                  moveDraftLine={moveDraftLine}
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
                  onSaveAndAddAnother={handleSaveAndAddAnotherQuotation}
                  onCancel={() => {
                    finishUxTask('abandon', {
                      task: 'sales_quote_create',
                      lines: newDraftLines.length,
                      hasCustomer: !!newCustomer,
                    })
                    backToList()
                  }}
                  onCreateNewCustomer={(q) => { setNewContactQuery(q); setShowCreateContact(true) }}
                />
              ) : view === 'delivery' && activeOrder ? (
                /* ── DELIVERY NOTE VIEW ──────────────────────────────────── */
                <DeliveryNoteView
                  order={activeOrder}
                  deliveries={deliveries}
                  focusDeliveryId={focusDeliveryId}
                  serials={serials}
                  products={products}
                  deliveryQtys={deliveryQtys}
                  setDeliveryQtys={setDeliveryQtys}
                  savingDelivery={savingDelivery}
                  setSavingDelivery={setSavingDelivery}
                  prepareDelivery={prepareDelivery}
                  validateDelivery={validateDelivery}
                  markDeliveryNoteGenerated={markDeliveryNoteGenerated}
                  assignSerialsToSOLine={assignSerialsToSOLine}
                  unassignSerialFromSOLine={unassignSerialFromSOLine}
                  updateDelivery={updateDelivery}
                  showToast={showToast}
                  onBack={() => { setFocusDeliveryId(null); setView('form'); if (activeOrder) syncOrderUrl(activeOrder.id, 'form') }}
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
                  <TablePageLayout
                    title={listTab === 'quotations' ? 'Quotations' : 'Sales orders'}
                    summary={
                      <OperationalSummary
                        items={[
                          { id: 'quotations', label: 'quotations', value: stats.quotations + stats.quotationsSent },
                          { id: 'orders', label: 'sales orders', value: stats.orders },
                          ...(stats.toInvoice ? [{ id: 'to_invoice', label: 'ready to invoice', value: stats.toInvoice, tone: 'warning' as const, onClick: () => { setListTabAndReset('orders'); setFilterAndReset('to_invoice') } }] : []),
                        ]}
                      />
                    }
                  >
                  <DataTable
                    tableId="sales-order-list"
                    columns={salesListColumns}
                    rows={filtered}
                    rowKey={s => s.id}
                    searchValue={search}
                    onSearchChange={setSearchAndReset}
                    clientSearch={false}
                    searchPlaceholder="Search order number or customer…"
                    primaryFilters={[
                      {
                        key: 'status',
                        label: 'Status',
                        value: filter,
                        allValue: 'all',
                        options: [
                          { value: 'all', label: 'All statuses' },
                          ...(listTab === 'quotations'
                            ? [
                                { value: 'my_quotations', label: 'My quotations' },
                                { value: 'quotations', label: 'Quotation' },
                                { value: 'quotation_sent', label: 'Quotation Sent' },
                              ]
                            : [
                                { value: 'sales_orders', label: 'Sales Order' },
                                { value: 'to_invoice', label: 'To invoice' },
                                { value: 'fully_invoiced', label: 'Fully invoiced' },
                              ]),
                          { value: 'cancelled', label: 'Cancelled' },
                        ],
                        onChange: v => setFilterAndReset(v as SalesListFilter),
                      },
                    ]}
                    onClearFilters={() => {
                      setSearchAndReset('')
                      setFilterAndReset('all')
                    }}
                    layoutViews={{
                      value: listViewMode,
                      options: [
                        { id: 'table', label: 'Table view', icon: <Fa icon={faListUl} className="text-xs" /> },
                        { id: 'kanban', label: 'Kanban view', icon: <Fa icon={faThLarge} className="text-xs" /> },
                      ],
                      onChange: id => setListViewMode(id as 'table' | 'kanban'),
                    }}
                    hideColumnFilters
                    hideBody={listViewMode === 'kanban'}
                    perPage={50}
                    emptyMessage={filtered.length === 0 && salesOrderViews.length === 0 ? 'No sale orders yet' : 'No orders match your filter'}
                    emptyAction={filtered.length === 0 && salesOrderViews.length === 0 ? (
                      <button type="button" className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={openNewForm}>New quotation</button>
                    ) : undefined}
                    onRowClick={s => openOrder(s.id)}
                    rowLabel={s => `${s.ref} ${s.customerName}`}
                    cardAccent={s => s.status === 'quotation' ? 'var(--warning)' : s.status === 'quotation_sent' ? 'var(--primary)' : 'var(--success)'}
                    renderCard={s => (
                      <RecordCard
                        eyebrow={s.ref}
                        title={s.customerName}
                        subtitle={`${fmtDate(s.date)} · ${s.lines?.length ?? 0} item${(s.lines?.length ?? 0) !== 1 ? 's' : ''}`}
                        amount={fmtKes(s.total)}
                        status={statusPill(s)}
                        accent={s.status === 'quotation' ? 'var(--warning)' : s.status === 'quotation_sent' ? 'var(--primary)' : 'var(--success)'}
                        meta={[
                          { label: 'Status', value: SALE_STATUS_LABELS[s.status] ?? s.status },
                          ...(s.status === 'sale' ? [{ label: 'Invoice status', value: SO_INVOICE_STATUS_LABELS[saleOrderInvoiceStatus(s.status, s.lines)] }] : []),
                          { label: 'Items', value: s.lines?.length ?? 0 },
                        ]}
                        onClick={() => openOrder(s.id)}
                      />
                    )}
                    exportTitle="Sales orders"
                    exportFilename="sales-orders"
                  />
                  {listViewMode === 'kanban' && (
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {(['quotation', 'quotation_sent', 'sale', 'cancelled'] as const).map(col => {
                        const colOrders = filtered.filter(s => s.status === col)
                        const colColors: Record<string, string> = { quotation: 'var(--warning)', quotation_sent: 'var(--primary)', sale: 'var(--success)', cancelled: '#9CA3AF' }
                        return (
                          <div key={col} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: colColors[col] }}>{SALE_STATUS_LABELS[col]}</span>
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
                  )}
                  </TablePageLayout>
                </>
              ) : view === 'form' && !activeOrder && searchParams.get('id') ? (
                <ModuleSkeleton />
              ) : (
                /* ── ORDER FORM VIEW ─────────────────────────────────────── */
                <div className="flex flex-col">
                  {/* Action bar */}
                  <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between flex-wrap gap-3">
                    <button onClick={backToList} className="btn-outline flex items-center gap-2"><Fa icon={faArrowLeft} /><span>Back</span></button>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* ── Quotation / Quotation Sent (Odoo button visibility) ── */}
                      {activeOrder && isQuotationStage(activeOrder.status) && (<>
                        {activeOrder.approvalStatus === 'pending' ? (<>
                          {canApproveActiveOrder && activePendingApproval && (<>
                            <button className="btn-primary flex items-center gap-2 text-xs" onClick={() => approveRequest(activePendingApproval.id, 'approved', `Approved from ${activeOrder.ref}`)}><Fa icon={faCheck} /><span>Approve</span></button>
                            <button className="btn-danger flex items-center gap-2 text-xs" onClick={() => approveRequest(activePendingApproval.id, 'rejected', `Rejected from ${activeOrder.ref}`)}><Fa icon={faXmark} /><span>Reject</span></button>
                          </>)}
                          <MoreActionsMenu
                            items={[
                              { label: 'Preview', icon: faFileAlt, disabled: !activeOrder.lines.length, onClick: () => previewSalesDocument(activeOrder, 'Quotation', 'QUOTATION') },
                              { label: 'Print', icon: faPrint, disabled: !activeOrder.lines.length, onClick: () => downloadSalesDocument(activeOrder, 'Quotation', 'QUOTE', 'QUOTATION') },
                              { label: 'Cancel', icon: faBan, tone: 'danger', onClick: () => setShowCancelConfirm(true) },
                            ]}
                          />
                        </>) : (<>
                          {activeOrder.status === 'quotation' && (
                            <button className="btn-primary flex items-center gap-2 text-xs" disabled={!activeOrder.lines.length || sendingQuoteId === activeOrder.id} title={!activeOrder.lines.length ? 'Add at least one product first' : undefined} onClick={() => openSendQuoteModal(activeOrder)}>
                              <Fa icon={faFileInvoice} /><span>{sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send by Email'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-primary flex items-center gap-2 text-xs"
                            disabled={confirmingSO}
                            onClick={async () => {
                              if (!activeOrder.lines.length) { showToast('Add at least one product before confirming', 'error'); return }
                              setConfirmingSO(true)
                              try { await Promise.resolve(confirmSO(activeOrder.id)) }
                              finally { setConfirmingSO(false) }
                            }}
                          >
                            <Fa icon={faCheck} aria-hidden="true" /><span>{confirmingSO ? 'Confirming…' : 'Confirm'}</span>
                          </button>
                          <MoreActionsMenu
                            items={[
                              ...(activeOrder.status === 'quotation_sent' ? [{ label: sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send by Email', icon: faFileInvoice, disabled: !activeOrder.lines.length || sendingQuoteId === activeOrder.id, onClick: () => openSendQuoteModal(activeOrder) }] : []),
                              { label: 'Preview', icon: faFileAlt, disabled: !activeOrder.lines.length, onClick: () => previewSalesDocument(activeOrder, 'Quotation', 'QUOTATION') },
                              { label: 'Print', icon: faPrint, disabled: !activeOrder.lines.length, onClick: () => downloadSalesDocument(activeOrder, 'Quotation', 'QUOTE', 'QUOTATION') },
                              { label: 'Pro-forma invoice', icon: faFileInvoiceDollar, disabled: !activeOrder.lines.length, onClick: () => downloadProformaInvoice(activeOrder) },
                              { label: 'Cancel', icon: faBan, tone: 'danger', onClick: () => setShowCancelConfirm(true) },
                              { label: 'Delete', icon: faTrash, tone: 'danger', onClick: () => setShowDelConfirm(true) },
                            ]}
                          />
                        </>)}
                      </>)}
                      {/* ── Sales Order ── */}
                      {activeOrder?.status === 'sale' && (<>
                        {canInvoiceFromSO && invoiceDeliveryReady && (activeInvoiceStatus === 'to_invoice' || activeInvoiceStatus === 'upselling') ? (
                          <button
                            className="btn-primary flex items-center gap-2 text-xs"
                            onClick={async () => {
                              const soPayment = getDocumentPaymentDetails(activeOrder.id)
                              const inv = await Promise.resolve(createInvoiceFromSO(activeOrder.id))
                              if (inv?.id) setDocumentPaymentDetails(inv.id, soPayment)
                            }}
                          >
                            <Fa icon={faFileInvoiceDollar} /><span>Create Invoice</span>
                          </button>
                        ) : canInvoiceFromSO && activeInvoices.length === 0 && !invoiceDeliveryReady ? (
                          <button className="btn-secondary flex items-center gap-2 text-xs opacity-60 cursor-not-allowed" disabled title="Validate the delivery first">
                            <Fa icon={faFileInvoiceDollar} /><span>Invoice after Delivery</span>
                          </button>
                        ) : null}
                        {visibleDeliveries.some(d => isOpenDeliveryStatus(d.status)) ? (
                          <button className={`${activeInvoiceStatus === 'to_invoice' ? 'btn-secondary' : 'btn-primary'} flex items-center gap-2 text-xs`} onClick={() => openDeliveryView()}><Fa icon={faTruck} /><span>Delivery</span></button>
                        ) : visibleDeliveries.length > 0 ? (
                          <button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => openDeliveryView()}><Fa icon={faTruck} /><span>Deliveries</span></button>
                        ) : null}
                        <MoreActionsMenu
                          items={[
                            { label: sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send by Email', icon: faFileInvoice, disabled: sendingQuoteId === activeOrder.id, onClick: () => openSendQuoteModal(activeOrder) },
                            { label: 'Preview', icon: faFileAlt, onClick: () => previewSalesDocument(activeOrder, 'Sale Order', 'SALES ORDER') },
                            { label: 'Print', icon: faPrint, onClick: () => downloadSalesDocument(activeOrder, 'Sale Order', 'SO') },
                            ...(activeDeliveries.some(d => canGenerateDeliveryNote(d)) ? [{ label: 'Print delivery note', icon: faTruck, onClick: () => { const del = activeDeliveries.find(d => canGenerateDeliveryNote(d)) ?? activeDeliveries[0]; setDnRecipientName(del.recipientName ?? activeOrder.customerName ?? ''); setDnRecipientPhone(del.recipientPhone ?? ''); setDnRecipientId(del.recipientIdNumber ?? ''); setDnAddress(del.deliveryAddress ?? ''); setDnNotes(del.notes ?? ''); setShowDnModal(true) } }] : []),
                            ...(activeOrder.locked && isAdmin ? [{ label: 'Unlock', icon: faRotateLeft, onClick: () => setSaleOrderLock(activeOrder.id, false) }] : []),
                            ...(!activeOrder.locked && systemSettings.salesLockConfirmed && isAdmin ? [{ label: 'Lock', icon: faSave, onClick: () => setSaleOrderLock(activeOrder.id, true) }] : []),
                            { label: 'Set to Quotation', icon: faRotateLeft, onClick: () => resetSOToDraft(activeOrder.id) },
                            { label: 'Cancel', icon: faBan, tone: 'danger', onClick: () => setShowCancelConfirm(true) },
                          ]}
                        />
                      </>)}
                      {/* ── Cancelled (exception state) ── */}
                      {activeOrder?.status === 'cancelled' && (
                        <button className="btn-outline flex items-center gap-2 text-xs" onClick={() => resetSOToDraft(activeOrder.id)}><Fa icon={faRotateLeft} /><span>Set to Quotation</span></button>
                      )}
                    </div>
                  </div>

                  {/* Order form body */}
                  {activeOrder && (
                    <div className="p-6 flex flex-col gap-6">
                      <SalesRecordHeader
                        order={activeOrder}
                        invoiceStatus={activeInvoiceStatus}
                        deliveriesCount={visibleDeliveries.length}
                        invoicesCount={activeInvoices.length}
                        paymentsCount={activePayments.length}
                        returnsCount={activeReturns.length}
                        canSeeFinance={canSeeFinanceRecords}
                        canSeeReturns={canSeeReturns}
                        onBackToList={backToList}
                        onOpenDelivery={() => openDeliveryView()}
                        onOpenInvoices={() => router.push('/finance?tab=invoices')}
                        onOpenReturns={() => router.push('/aftersales?tab=returns')}
                        onPreview={() => previewSalesDocument(
                          activeOrder,
                          isQuotationStage(activeOrder.status) ? 'Quotation' : 'Sale Order',
                          isQuotationStage(activeOrder.status) ? 'QUOTATION' : 'SALES ORDER',
                        )}
                        onSendQuote={() => openSendQuoteModal(activeOrder)}
                        onConfirm={() => {
                          if (!activeOrder.lines.length) {
                            showToast('Add at least one product before confirming', 'error')
                            return
                          }
                          if (confirmingSO) return
                          setConfirmingSO(true)
                          Promise.resolve(confirmSO(activeOrder.id)).finally(() => setConfirmingSO(false))
                        }}
                        onStepBlocked={msg => showToast(msg, 'error')}
                      />

                      {activeOrder.status === 'sale' && activeDeliveries.length > 0 && (
                        <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-4 flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                              Deliveries for {activeOrder.ref}
                            </span>
                            <span className="text-[10px] text-[var(--text-4)]">
                              {visibleDeliveries.length} active · click to open
                            </span>
                          </div>
                          <div className="flex flex-col gap-1">
                            {activeDeliveries.map(d => {
                              const cancelled = d.status === 'cancelled'
                              const units = (d.lines ?? []).reduce((sum: number, line: any) => sum + (Number(line.qty) || 0), 0)
                              const done = deliveryDeliveredTotal(d)
                              return (
                                <button
                                  key={d.id}
                                  type="button"
                                  disabled={cancelled}
                                  onClick={() => openDeliveryView(d.id)}
                                  className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                                    cancelled
                                      ? 'opacity-50 cursor-not-allowed'
                                      : 'hover:bg-[var(--bg-muted)] border border-transparent hover:border-[var(--border-lt)]'
                                  }`}
                                >
                                  <span className="font-semibold text-[var(--text-1)]">
                                    {d.ref}
                                    {d.backorderOfRef ? (
                                      <span className="ml-1 font-normal text-[var(--text-4)]">(backorder of {d.backorderOfRef})</span>
                                    ) : null}
                                  </span>
                                  <span className="flex items-center gap-2 shrink-0">
                                    <span className="text-[var(--text-3)]">{done}/{units} qty</span>
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                      d.status === 'done' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : d.status === 'ready' ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                          : d.status === 'waiting' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                            : 'bg-gray-50 text-gray-600 border border-gray-200'
                                    }`}>
                                      {DELIVERY_STATE_LABELS[d.status as keyof typeof DELIVERY_STATE_LABELS] ?? d.status}
                                    </span>
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Order info card — editable through Quotation and
                          Quotation Sent (Odoo keeps sent quotations editable,
                          subject to permissions). */}
                      {isQuotationStage(activeOrder.status) && !activeOrder.locked ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                          <div className="xl:col-span-2">
                            <SearchPicker
                              label="Customer"
                              placeholder="Change customer..."
                              items={customers}
                              onSelect={customer => updateSaleOrder(activeOrder.id, { customerId: customer.id, customerName: customer.name })}
                              renderItem={customer => `${customer.name}${customer.email ? ` · ${customer.email}` : ''}`}
                            />
                            <p className="text-[10px] text-[var(--text-4)] mt-1">Current: <strong>{activeOrder.customerName}</strong></p>
                          </div>
                          <Field label="Quotation Date">
                            <Input type="date" value={activeOrder.date || ''} onChange={value => updateSaleOrder(activeOrder.id, { date: value })} />
                          </Field>
                          <Field label="Expiration">
                            <Input type="date" value={activeOrder.validUntil || ''} onChange={value => updateSaleOrder(activeOrder.id, { validUntil: value })} />
                          </Field>
                          <Field label="Delivery Date">
                            <Input type="date" value={activeOrder.deliveryDate || ''} onChange={value => updateSaleOrder(activeOrder.id, { deliveryDate: value || undefined })} />
                          </Field>
                          <Field label="Payment Terms">
                            <Input value={activeOrder.paymentTerms || ''} onChange={value => updateSaleOrder(activeOrder.id, { paymentTerms: value })} placeholder="30 days" />
                          </Field>
                          <Field label="Customer Reference">
                            <Input value={activeOrder.customerRef || ''} onChange={value => updateSaleOrder(activeOrder.id, { customerRef: value || undefined })} placeholder="Customer PO / LPO no." />
                          </Field>
                          <Field label="Salesperson">
                            <Select
                              value={activeOrder.salespersonId || activeOrder.createdByUserId || ''}
                              onChange={value => {
                                const person = users.find((u: any) => u.id === value)
                                updateSaleOrder(activeOrder.id, { salespersonId: value || undefined, salespersonName: person?.name })
                              }}
                              options={[{ value: '', label: '—' }, ...users.filter((u: any) => ['director', 'sales_rep', 'admin_officer'].includes(u.role)).map((u: any) => ({ value: u.id, label: u.name }))]}
                            />
                          </Field>
                          <Field label="Sales Team">
                            <Input value={activeOrder.salesTeam || ''} onChange={value => updateSaleOrder(activeOrder.id, { salesTeam: value || undefined })} placeholder="e.g. Direct Sales" />
                          </Field>
                          {systemSettings.salesPricelists && (
                            <Field label="Pricelist">
                              <Select
                                value={activeOrder.pricelist || 'RETAIL'}
                                onChange={value => updateSaleOrder(activeOrder.id, { pricelist: value || 'RETAIL' })}
                                options={[
                                  { value: 'RETAIL', label: 'Retail' },
                                  { value: 'WHOLESALE', label: 'Wholesale' },
                                  { value: 'KILIMALL', label: 'Kilimall' },
                                ]}
                              />
                            </Field>
                          )}
                          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-3">
                            <Field label="Invoice Address">
                              <Input value={activeOrder.invoiceAddress || ''} onChange={value => updateSaleOrder(activeOrder.id, { invoiceAddress: value || undefined })} placeholder="Billing address" />
                            </Field>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-3">
                            <Field label="Delivery Address">
                              <Input value={activeOrder.deliveryAddress || ''} onChange={value => updateSaleOrder(activeOrder.id, { deliveryAddress: value || undefined })} placeholder="Shipping address" />
                            </Field>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6">
                            <Field label="Notes / Terms & Conditions">
                              <textarea
                                className="form-input text-xs min-h-[76px]"
                                value={activeOrder.notes || ''}
                                onChange={event => updateSaleOrder(activeOrder.id, { notes: event.target.value })}
                                placeholder="Payment terms, delivery notes, or customer instructions..."
                              />
                            </Field>
                          </div>
                        </div>
                      ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Customer</span>
                          <span className="text-xs font-semibold text-[var(--text-1)]">{activeOrder.customerName}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Order Date</span>
                          <span className="text-xs text-[var(--text-2)]">{fmtDate(activeOrder.date)}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Valid Until</span>
                          <span className="text-xs text-[var(--text-2)]">{activeOrder.validUntil ? fmtDate(activeOrder.validUntil) : '—'}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Delivery Date</span>
                          <span className="text-xs text-[var(--text-2)]">{activeOrder.deliveryDate ? fmtDate(activeOrder.deliveryDate) : '—'}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Payment Terms</span>
                          <span className="text-xs text-[var(--text-2)]">{activeOrder.paymentTerms ?? '—'}</span>
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
                      )}

                      {/* Attachments */}
                      <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Attachments{soAttachments.length ? ` (${soAttachments.length})` : ''}</h3>
                          <label className={`btn-outline px-2.5 py-1 text-[10px] cursor-pointer ${uploadingAttachment ? 'opacity-50 pointer-events-none' : ''}`}>
                            {uploadingAttachment ? 'Uploading…' : 'Attach file'}
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"
                              onChange={e => { const f = e.target.files?.[0]; if (f) uploadSoAttachment(f); e.target.value = '' }}
                            />
                          </label>
                        </div>
                        {soAttachments.length === 0 ? (
                          <p className="text-[11px] text-[var(--text-4)]">No documents attached.</p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {soAttachments.map(a => (
                              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-white border border-[var(--border-lt)] px-3 py-1.5">
                                <a
                                  className="text-xs text-[var(--primary)] font-semibold truncate hover:underline"
                                  href={`/api/sale-order-attachments/${activeOrder.id}?file=${encodeURIComponent(a.id)}`}
                                >
                                  {a.name}
                                </a>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[10px] text-[var(--text-4)]">{Math.max(1, Math.round(a.size / 1024))} KB · {a.uploadedBy}</span>
                                  <button
                                    type="button"
                                    className="text-[11px] text-[var(--text-4)] hover:text-red-600"
                                    title="Remove attachment"
                                    onClick={() => deleteSoAttachment(a.id)}
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
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
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-[var(--text-1)]">Order Lines</h3>
                            {isQuotationStage(activeOrder.status) && !activeOrder.locked && (
                              <div className="flex items-center gap-3">
                                <button type="button" onClick={() => setShowAddLine(true)} className="text-xs font-bold text-primary-600 hover:underline flex items-center gap-1">
                                  <Fa icon={faPlus} className="text-[10px]" />Add a product
                                </button>
                                <button type="button" onClick={() => addSOSection(activeOrder.id)} className="text-xs font-bold text-slate-600 hover:underline flex items-center gap-1">
                                  <Fa icon={faPlus} className="text-[10px]" />Add a section
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="dt-scroll border border-[var(--border-lt)] rounded-2xl">
                            <table data-no-responsive className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)]">Product / Description</th>
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-14">Qty</th>
                                  {activeOrder.status === 'sale' && (
                                    <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-20">Delivered</th>
                                  )}
                                  {(activeInvoices.length > 0 || (activeOrder.status === 'sale' && activeOrder.lines.some((l: any) => (l.qtyInvoiced ?? 0) > 0))) && (
                                    <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-20">Invoiced</th>
                                  )}
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-24">Unit Price</th>
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-16">Disc%</th>
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-16">Tax%</th>
                                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-24">Amount</th>
                                  <th className="px-3 py-2 w-24"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border-lt)]">
                                {activeOrder.lines.map((l, lineIndex) => {
                                  const canEdit = isQuotationStage(activeOrder.status) && !activeOrder.locked
                                  if (l.lineType === 'section') {
                                    return (
                                      <tr key={l.id} className="bg-slate-50/70">
                                        <td className="px-3 py-2" colSpan={canEdit ? 7 : 8}>
                                          {canEdit ? (
                                            <input
                                              aria-label="Section title"
                                              className="form-input text-xs w-full font-bold"
                                              value={l.description || l.productName || ''}
                                              placeholder="Section title"
                                              onChange={e => {
                                                const title = e.target.value
                                                const lines = activeOrder.lines.map((line: any) =>
                                                  line.id === l.id
                                                    ? { ...line, description: title, productName: title }
                                                    : line,
                                                )
                                                updateSaleOrder(activeOrder.id, { lines })
                                              }}
                                            />
                                          ) : (
                                            <span className="text-xs font-black text-[var(--text-2)]">{l.description || l.productName || 'Section'}</span>
                                          )}
                                        </td>
                                        {canEdit && (
                                          <td className="px-3 py-2 text-center">
                                            <div className="flex items-center justify-end gap-0.5">
                                              <button type="button" onClick={() => moveSOLine(activeOrder.id, l.id, -1)} disabled={lineIndex === 0} aria-label="Move section up" className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed">
                                                <Fa icon={faArrowUp} aria-hidden="true" />
                                              </button>
                                              <button type="button" onClick={() => moveSOLine(activeOrder.id, l.id, 1)} disabled={lineIndex === activeOrder.lines.length - 1} aria-label="Move section down" className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed">
                                                <Fa icon={faArrowDown} aria-hidden="true" />
                                              </button>
                                              <button type="button" onClick={() => removeSOLine(activeOrder.id, l.id)} className="row-action-btn btn-danger" aria-label="Remove section"><Fa icon={faTrash} aria-hidden="true" /></button>
                                            </div>
                                          </td>
                                        )}
                                      </tr>
                                    )
                                  }
                                  const lineSerials = serials.filter((s: any) => l.serialIds?.includes(s.id))
                                  const isEditing = editingLineId === l.id
                                  const invoicedQty = (Number(l.qtyInvoiced) || 0) || getInvoicedQty(activeOrder, l.productId)
                                  const showInvoiced = activeInvoices.length > 0 || (activeOrder.status === 'sale' && activeOrder.lines.some((x: any) => (x.qtyInvoiced ?? 0) > 0))
                                  const showDelivered = activeOrder.status === 'sale'
                                  return (
                                    <tr key={l.id} className={isEditing ? 'row-editing' : ''}>
                                      <td className="px-3 py-2 text-xs text-[var(--text-1)]">
                                        {isEditing ? (
                                          <input type="text" aria-label="Line item description" value={editLineDesc} onChange={e => setEditLineDesc(e.target.value)} className="form-input w-full py-1 text-xs" />
                                        ) : (
                                          <div>
                                            <span className="font-medium">{l.productName ?? l.description ?? 'Item'}</span>
                                            {lineSerials.length > 0 && (
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {lineSerials.map((s: any) => (
                                                  <span key={s.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-mono border border-blue-100">
                                                    {s.serial ?? s.serialNumber}
                                                    {s.barcode ? <span className="opacity-70">({s.barcode})</span> : null}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-center">
                                        {isEditing ? <input type="number" aria-label="Line item quantity" min={1} value={editLineQty} onChange={e => setEditLineQty(e.target.value)} className="w-14 text-center border border-blue-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
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
                                        {isEditing ? <input type="number" aria-label="Line item unit price" min={0} value={editLinePrice} onChange={e => setEditLinePrice(e.target.value)} className="w-20 text-right border border-blue-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                        : fmtKes(l.unitPrice)}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-right">
                                        {isEditing ? <input type="number" aria-label="Line item discount percentage" min={0} max={100} value={editLineDiscount} onChange={e => setEditLineDiscount(e.target.value)} className="w-14 text-right border border-blue-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                        : <span className="text-[var(--text-3)]">{l.discount ?? l.discountPercent ?? 0}%</span>}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-right">
                                        {isEditing ? <input type="number" aria-label="Line item tax percentage" min={0} max={100} value={editLineTax} onChange={e => setEditLineTax(e.target.value)} className="w-14 text-right border border-blue-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
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
                                            <button type="button" onClick={() => saveEditLine(l.id)} className="row-action-btn btn-success" aria-label="Save line"><Fa icon={faCheck} aria-hidden="true" /></button>
                                            <button type="button" onClick={cancelEditLine} className="row-action-btn btn-danger" aria-label="Cancel edit"><Fa icon={faXmark} aria-hidden="true" /></button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center justify-end gap-0.5">
                                            {canEdit && (
                                              <>
                                                <button type="button" onClick={() => moveSOLine(activeOrder.id, l.id, -1)} disabled={lineIndex === 0} aria-label="Move line up" className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed">
                                                  <Fa icon={faArrowUp} aria-hidden="true" />
                                                </button>
                                                <button type="button" onClick={() => moveSOLine(activeOrder.id, l.id, 1)} disabled={lineIndex === activeOrder.lines.length - 1} aria-label="Move line down" className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed">
                                                  <Fa icon={faArrowDown} aria-hidden="true" />
                                                </button>
                                                <button type="button" onClick={() => startEditLine(l)} className="row-action-btn btn-edit" aria-label="Edit line"><Fa icon={faPencil} aria-hidden="true" /></button>
                                                <button type="button" onClick={() => removeSOLine(activeOrder.id, l.id)} className="row-action-btn btn-danger" aria-label="Remove line"><Fa icon={faTrash} aria-hidden="true" /></button>
                                              </>
                                            )}
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
                          {isQuotationStage(activeOrder.status) && !activeOrder.locked && (
                            <div className="flex flex-wrap items-center gap-4">
                              <button onClick={() => setShowAddLine(true)} className="flex items-center gap-2 text-xs text-primary-600 hover:underline font-semibold self-start"><Fa icon={faPlus} className="text-[10px]" />Add a product</button>
                              <button onClick={() => addSOSection(activeOrder.id)} className="flex items-center gap-2 text-xs text-slate-600 hover:underline font-semibold self-start"><Fa icon={faPlus} className="text-[10px]" />Add a section</button>
                            </div>
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

                      <PaymentDetailsPicker
                        value={getDocumentPaymentDetails(activeOrder.id)}
                        onChange={next => setDocumentPaymentDetails(activeOrder.id, next)}
                      />

                      <Chatter
                        model="sale_order"
                        recordId={activeOrder.id}
                        staffName={currentUser?.name || 'Staff'}
                        title="Internal Notes"
                        compact
                      />

                      {/* Activity */}
                      <div className="flex flex-col gap-3">
                        <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2"><Fa icon={faClockRotateLeft} className="text-[var(--text-4)] text-xs" />Activity</h3>
                        <div className="flex flex-col gap-0">
                          {[
                            { label: 'Quotation created', date: activeOrder.date, show: true },
                            { label: `Quotation sent${activeOrder.sentTo ? ` to ${activeOrder.sentTo}` : ''}${activeOrder.sentByName ? ` by ${activeOrder.sentByName}` : ''}`, date: activeOrder.sentAt ?? activeOrder.date, show: !!activeOrder.sentAt },
                            { label: 'Approval requested', date: activeOrder.date, show: activeOrderApprovals.length > 0 },
                            { label: 'Order approved', date: activeOrder.date, show: activeOrder.approvalStatus === 'approved' },
                            { label: `Confirmed into Sales Order${activeOrder.confirmedByName ? ` by ${activeOrder.confirmedByName}` : ''}`, date: activeOrder.confirmedAt ?? activeOrder.date, show: activeOrder.status === 'sale' },
                            { label: 'Delivery validated', date: activeOrder.date, show: activeDeliveries.some(d => d.status === 'done') },
                            { label: 'Invoice created', date: activeOrder.date, show: activeInvoices.length > 0 },
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
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showCreateContact && (
        <Modal title="Quick Register Customer" onClose={() => setShowCreateContact(false)} width={500}>
          <div className="flex flex-col gap-4">
            <Field label="Customer/Company Name" required><Input value={newContactQuery} onChange={setNewContactQuery} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Email"><Input type="email" value={newContactEmail} onChange={setNewContactEmail} /></Field>
              <Field label="Phone" required><Input type="tel" value={newContactPhone} onChange={setNewContactPhone} /></Field>
            </div>
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowCreateContact(false)} disabled={registeringContact}>Cancel</button>
              <button className="btn-primary" disabled={registeringContact} onClick={async () => {
                if (!newContactQuery.trim() || !newContactPhone.trim()) { showToast('Customer name and phone are required', 'error'); return }
                setRegisteringContact(true)
                try {
                  const contact = await addContact({ type: 'individual', name: newContactQuery.trim(), email: newContactEmail.trim(), phone: newContactPhone.trim(), address: '', isCustomer: true, isVendor: false, tags: [] })
                  setShowCreateContact(false); setNewContactQuery(''); setNewContactEmail(''); setNewContactPhone('')
                  setNewCustomer({ id: contact.id, name: contact.name })
                  if (view !== 'new') { const so = await createSaleOrder(contact.id, contact.name); openOrder(so.id) }
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      {/* Send by Email — compose dialog. The message is recorded on the order
          and the quotation PDF is attached server-side. */}
      {sendModalOrderId && (() => {
        const order = salesOrderViews.find(s => s.id === sendModalOrderId)
        if (!order) return null
        return (
          <Modal title={`Send ${order.ref} by Email`} onClose={() => setSendModalOrderId(null)} width={460}>
            <div className="flex flex-col gap-4">
              <Field label="Recipient Email *">
                <Input value={sendEmailTo} onChange={setSendEmailTo} placeholder="customer@example.com" />
              </Field>
              <Field label="Message (optional)">
                <textarea
                  className="form-input text-xs min-h-[90px]"
                  value={sendEmailMessage}
                  onChange={e => setSendEmailMessage(e.target.value)}
                  placeholder="Personal note included in the email body…"
                />
              </Field>
              <p className="text-[10px] text-[var(--text-4)]">The quotation PDF ({order.ref}) is attached automatically.</p>
              <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
                <button className="btn-outline text-xs" onClick={() => setSendModalOrderId(null)}>Cancel</button>
                <button
                  className="btn-primary text-xs"
                  disabled={!sendEmailTo.trim() || sendingQuoteId === order.id}
                  onClick={() => emailSalesQuote(order, sendEmailTo.trim(), sendEmailMessage.trim() || undefined)}
                >
                  {sendingQuoteId === order.id ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

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
        const del = deliveries.find(d => d.saleOrderId === activeId && canGenerateDeliveryNote(d))
        if (!del) return null
        return (
          <Modal title={`Delivery Note — ${del.ref}`} onClose={() => setShowDnModal(false)} width={480}>
            <div className="flex flex-col gap-4">
              <p className="text-xs text-[var(--text-3)]">Fill in recipient details before printing.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Received By (Full Name) *"><Input value={dnRecipientName} onChange={setDnRecipientName} placeholder="e.g. John Kamau" /></Field>
                <Field label="Phone"><Input value={dnRecipientPhone} onChange={setDnRecipientPhone} placeholder="+254…" /></Field>
              </div>
              <Field label="ID / Passport No."><Input value={dnRecipientId} onChange={setDnRecipientId} placeholder="National ID or Passport number" /></Field>
              <Field label="Delivery Address"><Input value={dnAddress} onChange={setDnAddress} placeholder="e.g. Westlands, Nairobi" /></Field>
              <Field label="Notes"><textarea className="form-input" rows={2} placeholder="Accessories included, special instructions…" value={dnNotes} onChange={e => setDnNotes(e.target.value)} /></Field>
              <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
                <button className="btn-outline text-xs" onClick={() => setShowDnModal(false)}>Cancel</button>
                <button className="btn-secondary flex items-center gap-1.5 text-xs" onClick={async () => {
                  if (deliveryDeliveredTotal(del) <= 0) {
                    showToast('Cannot print Delivery Note — delivered quantity is 0', 'error')
                    return
                  }
                  if (dnRecipientName.trim()) updateDelivery(del.id, { recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim() || undefined, recipientIdNumber: dnRecipientId.trim() || undefined, deliveryAddress: dnAddress.trim() || undefined, notes: dnNotes.trim() || undefined })
                  const generated = printDeliveryNote(del, serials, { recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim(), recipientIdNumber: dnRecipientId.trim(), deliveryAddress: dnAddress.trim(), notes: dnNotes.trim() })
                  if (generated) {
                    const saved = await markDeliveryNoteGenerated(del.id)
                    if (saved) {
                      showToast(`Delivery Note ${del.ref} generated — invoicing is now available`, 'success')
                      setShowDnModal(false)
                    } else {
                      showToast('Delivery Note could not be saved — check delivered quantities', 'error')
                    }
                  }
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
  newPaymentTerms, setNewPaymentTerms, newNotes, setNewNotes,
  newCustomerRef, setNewCustomerRef, newSalesTeam, setNewSalesTeam,
  newPricelist, setNewPricelist, newInvoiceAddress, setNewInvoiceAddress,
  newDeliveryAddress, setNewDeliveryAddress, newPaymentDetails, setNewPaymentDetails,
  pricelistsEnabled, newDraftLines,
  addDraftLine, addDraftSection, updateDraftLine, removeDraftLine, moveDraftLine, selectProductForDraftLine,
  calcDraftLineTotal, draftSubtotal, draftTaxTotal, draftTotal, canEditDiscount,
  companySettings, canSave, saveBlockedReason, onSave, onSaveAndAddAnother, onCancel, onCreateNewCustomer,
}: {
  customers: any[]; products: any[]; newCustomer: { id: string; name: string } | null
  setNewCustomer: (c: { id: string; name: string } | null) => void
  newDeliveryDate: string; setNewDeliveryDate: (v: string) => void
  newPaymentTerms: string; setNewPaymentTerms: (v: string) => void
  newNotes: string; setNewNotes: (v: string) => void
  newCustomerRef: string; setNewCustomerRef: (v: string) => void
  newSalesTeam: string; setNewSalesTeam: (v: string) => void
  newPricelist: string; setNewPricelist: (v: string) => void
  newInvoiceAddress: string; setNewInvoiceAddress: (v: string) => void
  newDeliveryAddress: string; setNewDeliveryAddress: (v: string) => void
  newPaymentDetails: DocumentPaymentDetails
  setNewPaymentDetails: (v: DocumentPaymentDetails) => void
  pricelistsEnabled: boolean
  newDraftLines: DraftLine[]; addDraftLine: () => void; addDraftSection: () => void
  updateDraftLine: (id: string, field: keyof DraftLine, value: string) => void
  removeDraftLine: (id: string) => void
  moveDraftLine: (id: string, direction: -1 | 1) => void
  selectProductForDraftLine: (lineId: string, product: any) => void
  calcDraftLineTotal: (l: DraftLine) => number
  draftSubtotal: number; draftTaxTotal: number; draftTotal: number
  canEditDiscount: boolean; companySettings: any
  canSave: boolean; saveBlockedReason: string
  onSave: () => void; onSaveAndAddAnother: () => void; onCancel: () => void
  onCreateNewCustomer: (query: string) => void
}) {
  const [productSearch, setProductSearch] = useState<Record<string, string>>({})
  // The line table lives inside an overflow container that clips absolutely
  // positioned children — the picker renders position:fixed at the trigger's
  // viewport coordinates instead, so it can never disappear under the table.
  const [productDropdownOpen, setProductDropdownOpen] = useState<{ id: string; top: number; left: number; openUp: boolean } | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const customerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const openProductDropdown = (lineId: string, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect()
    const openUp = rect.bottom + 320 > window.innerHeight && rect.top > 340
    setProductDropdownOpen({
      id: lineId,
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
      openUp,
    })
  }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) setCustomerDropdownOpen(false)
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setProductDropdownOpen(null)
    }
    // A fixed-position dropdown would drift on scroll/resize — close it instead
    // (scrolling within the dropdown's own list keeps it open).
    const closeDropdown = (e: Event) => {
      if (dropdownRef.current && e.target instanceof Node && dropdownRef.current.contains(e.target)) return
      setProductDropdownOpen(prev => (prev ? null : prev))
    }
    window.addEventListener('mousedown', h)
    window.addEventListener('scroll', closeDropdown, true)
    window.addEventListener('resize', closeDropdown)
    return () => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('scroll', closeDropdown, true)
      window.removeEventListener('resize', closeDropdown)
    }
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
          <button type="button" onClick={onCancel} className="btn-outline flex items-center gap-2 text-xs"><Fa icon={faArrowLeft} /><span>Discard</span></button>
          <div>
            <h2 className="text-sm font-bold text-[var(--text-1)]">New Quotation</h2>
            <p className="text-[10px] text-[var(--text-4)]">Draft — not yet confirmed</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="btn-outline text-xs">Cancel</button>
          <button type="button" onClick={onSave} disabled={!canSave} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"><Fa icon={faSave} /><span>Save Quotation</span></button>
        </div>
      </div>

      {/* Form body */}
      <div className="p-6 flex flex-col gap-6">
        {/* Header fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Customer picker */}
          <div className="sm:col-span-2 flex flex-col gap-1.5 relative" ref={customerRef}>
            <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Customer <span className="text-red-500">*</span></label>
            <div className={`form-input cursor-pointer flex items-center justify-between ${!newCustomer ? 'text-[var(--text-4)]' : 'text-[var(--text-1)]'}`} onClick={() => setCustomerDropdownOpen(v => !v)}>
              <span className="text-xs font-medium truncate">{newCustomer ? newCustomer.name : 'Search customer…'}</span>
              <Fa icon={faChevronDown} className={`text-[10px] text-[var(--text-4)] flex-shrink-0 transition-transform ${customerDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            {customerDropdownOpen && (
              <div className="absolute top-full left-0 right-0 z-[9300] mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden">
                <div className="p-2 border-b border-[var(--border-lt)]">
                  <input autoFocus type="text" aria-label="Search customers by name or email" placeholder="Search by name or email…" className="form-input text-xs w-full" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
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
        </div>

        <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3">
          <button
            className="w-full flex items-center justify-between text-left"
            onClick={() => setShowAdvanced(v => !v)}
          >
            <div>
              <p className="text-xs font-bold text-[var(--text-2)]">Advanced details</p>
              <p className="text-[10px] text-[var(--text-4)]">Delivery date, payment terms, addresses, customer reference{pricelistsEnabled ? ', pricelist' : ''} and sales team</p>
            </div>
            <Fa icon={faChevronDown} className={`text-[10px] text-[var(--text-4)] transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Delivery Date</label>
                <input type="date" aria-label="Delivery date" className="form-input text-xs" value={newDeliveryDate} onChange={e => setNewDeliveryDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Payment Terms</label>
                <select aria-label="Payment terms" className="form-select text-xs" value={newPaymentTerms} onChange={e => setNewPaymentTerms(e.target.value)}>
                  <option value="0">Immediate</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="45">45 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Customer Reference</label>
                <input type="text" aria-label="Customer reference" className="form-input text-xs" placeholder="Customer PO / LPO no." value={newCustomerRef} onChange={e => setNewCustomerRef(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Sales Team</label>
                <input type="text" aria-label="Sales team" className="form-input text-xs" placeholder="e.g. Direct Sales" value={newSalesTeam} onChange={e => setNewSalesTeam(e.target.value)} />
              </div>
              {pricelistsEnabled && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Pricelist</label>
                  <select
                    aria-label="Pricelist"
                    className="form-input text-xs"
                    value={newPricelist || 'RETAIL'}
                    onChange={e => setNewPricelist(e.target.value)}
                  >
                    <option value="RETAIL">Retail</option>
                    <option value="WHOLESALE">Wholesale</option>
                    <option value="KILIMALL">Kilimall</option>
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Invoice Address</label>
                <input type="text" aria-label="Invoice address" className="form-input text-xs" placeholder="Billing address" value={newInvoiceAddress} onChange={e => setNewInvoiceAddress(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Delivery Address</label>
                <input type="text" aria-label="Delivery address" className="form-input text-xs" placeholder="Shipping address" value={newDeliveryAddress} onChange={e => setNewDeliveryAddress(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* Order Lines */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Order Lines</h3>
          <p className="text-[10px] text-[var(--text-4)]">
            Tax and discount changes affect posted revenue and margin. Review line-level values before saving.
          </p>
          <div className="border border-[var(--border-lt)] rounded-2xl overflow-hidden">
            <div className="dt-scroll">
              <table data-no-responsive className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Product</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Description</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-16">Qty</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-28">Unit Price</th>
                    {canEditDiscount && <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-20">Disc%</th>}
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-20">Tax%</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-28">Amount</th>
                    <th className="px-3 py-2.5 w-24"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {newDraftLines.map((line, lineIndex) => {
                    const filteredProds = getFilteredProducts(productSearch[line.id] ?? '')
                    const isOpen = productDropdownOpen?.id === line.id
                    const hasInvalidQty = !!line.productId && Number(line.qty) <= 0
                    const moveButtons = (
                      <>
                        <button type="button" onClick={() => moveDraftLine(line.id, -1)} disabled={lineIndex === 0} aria-label="Move line up"
                          className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed">
                          <Fa icon={faArrowUp} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => moveDraftLine(line.id, 1)} disabled={lineIndex === newDraftLines.length - 1} aria-label="Move line down"
                          className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed">
                          <Fa icon={faArrowDown} aria-hidden="true" />
                        </button>
                      </>
                    )
                    if (line.type === 'section') {
                      return (
                        <tr key={line.id} className="bg-slate-50/70">
                          <td className="px-3 py-2" colSpan={canEditDiscount ? 6 : 5}>
                            <input
                              aria-label="Quote section title"
                              className="form-input text-xs w-full font-bold"
                              placeholder="Section title, e.g. Hardware, Services, Accessories"
                              value={line.description}
                              onChange={e => updateDraftLine(line.id, 'description', e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-[10px] font-bold text-[var(--text-4)]">Section</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-0.5">
                              {moveButtons}
                              <button type="button" onClick={() => removeDraftLine(line.id)} aria-label="Remove section" className="row-action-btn btn-danger"><Fa icon={faTrash} aria-hidden="true" /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    }
                    return (
                      <tr key={line.id} className={`hover:bg-[var(--bg-surface)]/30 ${hasInvalidQty ? 'bg-red-50/60' : ''}`}>
                        {/* Product picker */}
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 cursor-pointer border border-[var(--border-lt)] rounded-lg px-2 py-1.5 hover:border-primary-400 transition-colors bg-[var(--bg-card)] min-w-[140px]"
                            onClick={e => (isOpen ? setProductDropdownOpen(null) : openProductDropdown(line.id, e.currentTarget))}>
                            <span className="text-xs text-[var(--text-1)] flex-1 truncate min-w-0">{line.productName || <span className="text-[var(--text-4)]">Select product…</span>}</span>
                            <Fa icon={faChevronDown} className={`text-[9px] text-[var(--text-4)] flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </div>
                          {isOpen && productDropdownOpen && (
                            <div
                              ref={dropdownRef}
                              className="fixed z-[9500] w-72 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden"
                              style={{
                                left: productDropdownOpen.left,
                                ...(productDropdownOpen.openUp
                                  ? { bottom: window.innerHeight - productDropdownOpen.top }
                                  : { top: productDropdownOpen.top }),
                              }}
                            >
                              <div className="p-2 border-b border-[var(--border-lt)]">
                                <input autoFocus type="text" aria-label="Search products" placeholder="Search products…" className="form-input text-xs w-full"
                                  value={productSearch[line.id] ?? ''} onChange={e => setProductSearch(prev => ({ ...prev, [line.id]: e.target.value }))} />
                              </div>
                              <div className="max-h-48 overflow-y-auto">
                                {filteredProds.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-[var(--text-4)]">No products found</p>
                                ) : (
                                  filteredProds.map(p => (
                                    <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] transition-colors"
                                      onClick={() => { selectProductForDraftLine(line.id, p); setProductSearch(prev => ({ ...prev, [line.id]: '' })); setProductDropdownOpen(null) }}>
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
                          <input type="text" aria-label="Line item description" className="form-input text-xs w-full" placeholder="Description…" value={line.description} onChange={e => updateDraftLine(line.id, 'description', e.target.value)} />
                        </td>
                        {/* Qty */}
                        <td className="px-3 py-2">
                          <input type="number" aria-label="Line item quantity" min={1} className="form-input text-xs text-center w-16" value={line.qty} onChange={e => updateDraftLine(line.id, 'qty', e.target.value)} />
                          {hasInvalidQty && <p className="text-[9px] text-red-600 font-semibold mt-1">Qty &gt; 0</p>}
                        </td>
                        {/* Unit Price */}
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            aria-label="Line item unit price"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className="form-input text-xs text-right w-28"
                            value={line.unitPrice}
                            onChange={e => updateDraftLine(line.id, 'unitPrice', e.target.value)}
                            onFocus={e => e.currentTarget.select()}
                          />
                        </td>
                        {/* Discount */}
                        {canEditDiscount && (
                          <td className="px-3 py-2">
                            <input type="number" aria-label="Line item discount percentage" min={0} max={100} className="form-input text-xs text-right w-20" value={line.discount} onChange={e => updateDraftLine(line.id, 'discount', e.target.value)} />
                          </td>
                        )}
                        {/* Tax */}
                        <td className="px-3 py-2">
                          <select aria-label="Line item tax rate" className="form-select text-xs w-20" value={line.taxRate} onChange={e => updateDraftLine(line.id, 'taxRate', e.target.value)}>
                            <option value="0">0%</option>
                            <option value={String(companySettings.vatRate)}>{companySettings.vatRate}% VAT</option>
                          </select>
                        </td>
                        {/* Amount */}
                        <td className="px-3 py-2 text-xs font-bold text-right text-[var(--text-1)]">{fmtKes(calcDraftLineTotal(line))}</td>
                        {/* Reorder + remove */}
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-0.5">
                            {moveButtons}
                            <button type="button" onClick={() => removeDraftLine(line.id)} aria-label="Remove line" className="row-action-btn btn-danger"><Fa icon={faTrash} aria-hidden="true" /></button>
                          </div>
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
              <div className="flex flex-wrap items-center gap-4">
                <button onClick={addDraftLine} className="flex items-center gap-2 text-xs text-primary-600 hover:underline font-semibold"><Fa icon={faPlus} className="text-[10px]" />Add a product</button>
                <button onClick={addDraftSection} className="flex items-center gap-2 text-xs text-slate-600 hover:underline font-semibold"><Fa icon={faPlus} className="text-[10px]" />Add a section</button>
              </div>
            </div>
          </div>
        </div>

        {/* Notes + Totals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Notes / Terms</label>
              <textarea
                aria-label="Notes and payment terms"
                className="form-input text-xs flex-1 min-h-[110px]"
                rows={5}
                placeholder="Payment terms, warranty conditions, special instructions…"
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
              />
              <p className="text-[10px] text-[var(--text-4)]">Shown on the quotation document below the line items.</p>
            </div>
            <PaymentDetailsPicker
              value={newPaymentDetails}
              onChange={setNewPaymentDetails}
            />
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
          <button type="button" onClick={onCancel} className="btn-outline text-xs">Discard</button>
          <div className="flex flex-col items-end gap-1">
            {saveBlockedReason && <p className="text-[10px] text-amber-600 font-semibold">{saveBlockedReason}</p>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onSaveAndAddAnother} disabled={!canSave} className="btn-outline flex items-center gap-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                <Fa icon={faSave} />
                <span>Create &amp; add another</span>
              </button>
              <button type="button" onClick={onSave} disabled={!canSave} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"><Fa icon={faSave} /><span>Save as Quotation</span></button>
            </div>
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
  order, deliveries, focusDeliveryId, serials, products, deliveryQtys, setDeliveryQtys, savingDelivery,
  setSavingDelivery, prepareDelivery, validateDelivery, markDeliveryNoteGenerated, assignSerialsToSOLine, unassignSerialFromSOLine,
  updateDelivery, showToast, onBack,
  dnRecipientName, setDnRecipientName, dnRecipientPhone, setDnRecipientPhone,
  dnRecipientId, setDnRecipientId, dnAddress, setDnAddress, dnNotes, setDnNotes,
}: {
  order: SalesOrderView; deliveries: any[]; focusDeliveryId?: string | null
  serials: any[]; products: any[]
  deliveryQtys: Record<string, number>; setDeliveryQtys: (v: Record<string, number>) => void
  savingDelivery: boolean; setSavingDelivery: (v: boolean) => void
  prepareDelivery: (id: string, qtysDone?: Record<string, number>) => boolean
  validateDelivery: (id: string, qtysDone?: Record<string, number>) => void
  markDeliveryNoteGenerated: (id: string) => Promise<boolean>
  assignSerialsToSOLine: (orderId: string, lineId: string, serialIds: string[]) => void
  unassignSerialFromSOLine: (orderId: string, lineId: string, serialId: string) => void
  updateDelivery: (id: string, p: any) => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void; onBack: () => void
  dnRecipientName: string; setDnRecipientName: (v: string) => void
  dnRecipientPhone: string; setDnRecipientPhone: (v: string) => void
  dnRecipientId: string; setDnRecipientId: (v: string) => void
  dnAddress: string; setDnAddress: (v: string) => void
  dnNotes: string; setDnNotes: (v: string) => void
}) {
  const orderDeliveries = deliveriesForSaleOrder(deliveries, order.id, { includeCancelled: true })
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(
    focusDeliveryId ?? null,
  )
  useEffect(() => {
    if (focusDeliveryId) setSelectedDeliveryId(focusDeliveryId)
  }, [focusDeliveryId])

  const pendingDelivery = orderDeliveries.find((d: any) => isOpenDeliveryStatus(d.status))
  const selectedDelivery =
    orderDeliveries.find((d: any) => d.id === selectedDeliveryId) ??
    pendingDelivery ??
    orderDeliveries.find((d: any) => d.status !== 'cancelled') ??
    orderDeliveries[0]
  const existingDelivery = selectedDelivery
  const canPrepare = order.status === 'sale' && !!existingDelivery && isOpenDeliveryStatus(existingDelivery.status) && ['draft', 'waiting'].includes(existingDelivery.status)
  const canValidate = order.status === 'sale' && !!existingDelivery && existingDelivery.status === 'ready' && !!existingDelivery.preparedAt

  const selectDelivery = (deliveryId: string) => {
    const target = orderDeliveries.find((d: any) => d.id === deliveryId)
    if (!target || target.status === 'cancelled') return
    setSelectedDeliveryId(deliveryId)
    const remaining = remainingUndeliveredByProduct(order.lines)
    const init: Record<string, number> = {}
    order.lines.forEach(line => {
      if ((line as any).lineType === 'section') return
      const delLine = target.lines?.find((l: any) => l.productId === line.productId)
      const demand = Math.max(0, Number(delLine?.qty) || remaining[line.productId ?? ''] || Number(line.qty) || 0)
      init[line.id] = demand
    })
    setDeliveryQtys(init)
    setDnRecipientName(target.recipientName ?? order.customerName ?? '')
    setDnRecipientPhone(target.recipientPhone ?? '')
    setDnRecipientId(target.recipientIdNumber ?? '')
    setDnAddress(target.deliveryAddress ?? '')
    setDnNotes(target.notes ?? '')
  }

  const requestedByProduct = () => {
    const quantities: Record<string, number> = {}
    order.lines.forEach(line => {
      const typed = Math.max(0, deliveryQtys[line.id] ?? 0)
      const serialCount = Array.isArray(line.serialIds) ? line.serialIds.length : 0
      // Prefer typed qty; if left at 0 but serials are assigned, ship those.
      const qty = Math.min(line.qty, typed > 0 ? typed : serialCount)
      if (line.productId) quantities[line.productId] = (quantities[line.productId] ?? 0) + qty
    })
    return quantities
  }

  const handlePrepare = () => {
    if (!existingDelivery || !isOpenDeliveryStatus(existingDelivery.status)) {
      showToast('No pending delivery to prepare', 'error'); return
    }
    prepareDelivery(existingDelivery.id, requestedByProduct())
  }

  const handleValidate = async () => {
    if (!order.lines.length) { showToast('No line items on this order', 'error'); return }
    if (!existingDelivery || existingDelivery.status !== 'ready') {
      showToast('No pending delivery to validate', 'error'); return
    }
    const lines = order.lines.map(l => {
      const delLine = existingDelivery.lines.find((line: any) => line.productId === l.productId)
      const preparedQty = effectiveDeliveryLineQty({
        qty: Number(delLine?.qty) || Number(l.qty) || 0,
        qtyDone: delLine?.qtyDone,
        serialIds: delLine?.serialIds?.length ? delLine.serialIds : l.serialIds,
      })
      return {
        id: l.id,
        qtyDelivered: Math.min(l.qty, (Number(l.qtyDelivered) || 0) + preparedQty),
      }
    })
    if (!lines.some(l => l.qtyDelivered > 0)) { showToast('Enter delivered quantities before validating', 'error'); return }
    setSavingDelivery(true)
    try {
      // Heal Prisma if confirm sync drifted (UI shows sale, DB still quotation).
      if (order.status === 'sale') {
        await fetch(`/api/sale-orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'sale',
            confirmedAt: order.confirmedAt ?? new Date().toISOString(),
            orderNumber: order.orderNumber ?? order.ref,
            quotationRef: order.quotationRef,
            locked: order.locked,
            confirmedById: order.confirmedById,
          }),
        }).catch(() => {})
      }
      // Persist per-line delivered quantities on the sale order.
      const res = await fetch(`/api/sale-orders/${order.id}/deliver-lines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error ?? 'Failed to save delivery', 'error'); return }
      if (dnRecipientName.trim()) {
        updateDelivery(existingDelivery.id, {
          recipientName: dnRecipientName.trim(),
          recipientPhone: dnRecipientPhone.trim() || undefined,
          recipientIdNumber: dnRecipientId.trim() || undefined,
          deliveryAddress: dnAddress.trim() || undefined,
          notes: dnNotes.trim() || undefined,
        })
      }
      // Validate the picking with the quantities actually done. Stock is
      // deducted for those quantities only; any remainder automatically
      // becomes a backorder delivery (Odoo behaviour).
      const qtysByProduct = Object.fromEntries(
        existingDelivery.lines.map((line: any) => [
          line.productId,
          effectiveDeliveryLineQty(line),
        ]),
      )
      validateDelivery(existingDelivery.id, qtysByProduct)
      onBack()
    } catch { showToast('Network error saving delivery', 'error') }
    finally { setSavingDelivery(false) }
  }

  const handlePrintDN = () => {
    if (!existingDelivery) { showToast('No delivery record found. Validate delivery first.', 'error'); return }
    if (existingDelivery.status !== 'done') {
      showToast('Validate the delivery before generating the final Delivery Note', 'error')
      return
    }
    if (deliveryDeliveredTotal(existingDelivery) <= 0) {
      showToast('Cannot generate Delivery Note — delivered quantity is 0. Assign serials or enter quantities first.', 'error')
      return
    }
    if (dnRecipientName.trim()) {
      updateDelivery(existingDelivery.id, {
        recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim() || undefined,
        recipientIdNumber: dnRecipientId.trim() || undefined, deliveryAddress: dnAddress.trim() || undefined, notes: dnNotes.trim() || undefined,
      })
    }
    import('@/lib/delivery-note-pdf').then(async ({ printDeliveryNote }) => {
      const generated = printDeliveryNote(existingDelivery, serials, {
        recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim(),
        recipientIdNumber: dnRecipientId.trim(), deliveryAddress: dnAddress.trim(), notes: dnNotes.trim(),
      })
      if (generated) {
        const saved = await markDeliveryNoteGenerated(existingDelivery.id)
        if (saved) showToast(`Delivery Note ${existingDelivery.ref} generated — invoicing is now available`, 'success')
        else showToast('Delivery Note could not be saved — check delivered quantities', 'error')
      }
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
          {canGenerateDeliveryNote(existingDelivery) && <button onClick={handlePrintDN} className="btn-secondary flex items-center gap-2 text-xs"><Fa icon={faPrint} /><span>Generate Delivery Note</span></button>}
          {canPrepare && (
            <button onClick={handlePrepare} disabled={savingDelivery} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
              <Fa icon={faBoxOpen} /><span>Prepare Delivery</span>
            </button>
          )}
          {canValidate && (
            <button onClick={handleValidate} disabled={savingDelivery} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
              <Fa icon={faCheck} /><span>{savingDelivery ? 'Saving…' : 'Validate'}</span>
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
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Delivery Status</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold w-fit ${existingDelivery?.status === 'ready' ? 'bg-blue-50 text-blue-700 border border-blue-200' : existingDelivery?.status === 'done' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : existingDelivery?.status === 'waiting' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
              {existingDelivery ? (DELIVERY_STATE_LABELS[existingDelivery.status as keyof typeof DELIVERY_STATE_LABELS] ?? existingDelivery.status) : 'No delivery yet'}
            </span>
            {existingDelivery?.backorderOfRef && (
              <span className="text-[9px] text-[var(--text-4)]">Backorder of {existingDelivery.backorderOfRef}</span>
            )}
          </div>
        </div>

        {orderDeliveries.length > 0 && (
          <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3 flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
              All deliveries for {order.ref} — select one to work on
            </span>
            {orderDeliveries.map((d: any) => {
              const selected = existingDelivery?.id === d.id
              const cancelled = d.status === 'cancelled'
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={cancelled}
                  onClick={() => selectDelivery(d.id)}
                  className={`flex items-center justify-between text-xs rounded-lg px-2 py-1.5 text-left transition-colors ${
                    cancelled ? 'opacity-40 cursor-not-allowed'
                      : selected
                        ? 'bg-primary-50 border border-primary-200 text-primary-800'
                        : 'hover:bg-[var(--bg-muted)] border border-transparent'
                  }`}
                >
                  <span className="font-semibold">
                    {d.ref}{d.backorderOfRef ? ` (backorder of ${d.backorderOfRef})` : ''}
                    {selected ? ' · viewing' : ''}
                  </span>
                  <span className="text-[10px] font-bold">
                    {DELIVERY_STATE_LABELS[d.status as keyof typeof DELIVERY_STATE_LABELS] ?? d.status}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Delivery lines */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Products to Deliver</h3>
          <div className="border border-[var(--border-lt)] rounded-2xl overflow-hidden">
            <div className="dt-scroll">
            <table data-no-responsive className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Product</th>
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-28">Demand (Ordered)</th>
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-32">{canPrepare ? 'Qty to Reserve' : canValidate ? 'Reserved Qty' : 'Delivered'}</th>
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Serial Numbers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-lt)]">
                {order.lines.map(l => {
                  const lineSerials = serials.filter((s: any) => l.serialIds?.includes(s.id))
                  const product = products.find((item: any) => item.id === l.productId)
                  const serialTracked = Boolean(product?.requiresSerial)
                  const assignableSerials = serialTracked
                    ? serials.filter((serial: any) =>
                        serial.productId === l.productId &&
                        (serial.location === 'warehouse' || serial.location === 'shop') &&
                        serial.status === 'available',
                      )
                    : []
                  const delLine = (existingDelivery?.lines ?? []).find((line: any) => line.productId === l.productId)
                  const effectiveDone = effectiveDeliveryLineQty({
                    qty: Number(delLine?.qty) || Number(l.qty) || 0,
                    qtyDone: delLine?.qtyDone,
                    serialIds: delLine?.serialIds?.length ? delLine.serialIds : l.serialIds,
                  })
                  const delivered = Math.max(
                    Number(deliveryQtys[l.id]) || 0,
                    Number(l.qtyDelivered) || 0,
                    effectiveDone,
                  )
                  const preparedQty = effectiveDone
                  const isFullyDelivered = delivered >= l.qty
                  const isPartial = delivered > 0 && delivered < l.qty
                  return (
                    <tr key={l.id} className={isFullyDelivered ? 'bg-emerald-50/30' : ''}>
                      <td className="px-4 py-3 text-xs font-medium text-[var(--text-1)]">{l.productName ?? l.description ?? 'Item'}</td>
                      <td className="px-4 py-3 text-xs text-center font-semibold text-[var(--text-2)]">{l.qty}</td>
                      <td className="px-4 py-3 text-xs text-center">
                        {canPrepare ? (
                          <input type="number" aria-label={`Delivery quantity for ${l.productName ?? l.description ?? 'line item'}`} min={0} max={l.qty} value={deliveryQtys[l.id] ?? 0}
                            onChange={e => setDeliveryQtys({ ...deliveryQtys, [l.id]: Math.min(l.qty, Math.max(0, Number(e.target.value) || 0)) })}
                            className="w-20 text-center border border-[var(--border-lt)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                        ) : canValidate ? (
                          <span className="font-semibold text-blue-700">{preparedQty}</span>
                        ) : (
                          <span className={`font-semibold ${isFullyDelivered ? 'text-emerald-600' : isPartial ? 'text-amber-500' : 'text-[var(--text-4)]'}`}>{delivered}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {lineSerials.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {lineSerials.map((s: any) => (
                              <span key={s.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-mono border border-blue-100">
                                {s.serial ?? s.serialNumber}
                                {canPrepare && (
                                  <button type="button" onClick={() => unassignSerialFromSOLine(order.id, l.id, s.id)} className="text-blue-700 hover:text-red-600" aria-label={`Unassign ${s.serial ?? s.id}`}>×</button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        {canPrepare && serialTracked && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className={`text-[10px] font-semibold ${lineSerials.length >= l.qty ? 'text-emerald-600' : 'text-amber-600'}`}>{lineSerials.length}/{l.qty}</span>
                            <SerialMultiSelect
                              options={assignableSerials.map((serial: any) => ({
                                id: serial.id,
                                label: serial.serial ?? serial.serialNumber ?? serial.id,
                                sublabel: [serial.barcode, LOCATIONS[serial.location as keyof typeof LOCATIONS]?.name ?? serial.location].filter(Boolean).join(' · '),
                              }))}
                              maxSelectable={Math.max(0, l.qty - lineSerials.length)}
                              onAssign={ids => assignSerialsToSOLine(order.id, l.id, ids)}
                            />
                          </div>
                        )}
                        {!lineSerials.length && !(canPrepare && serialTracked) && <span className="text-[var(--text-4)]">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
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
        {(canPrepare || canValidate) && (
          <div className="flex items-center justify-between pt-4 border-t border-[var(--border-lt)]">
            <button onClick={onBack} className="btn-outline text-xs">Back to Order</button>
            {canPrepare ? (
              <button onClick={handlePrepare} disabled={savingDelivery} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
                <Fa icon={faBoxOpen} /><span>Prepare Delivery</span>
              </button>
            ) : (
              <button onClick={handleValidate} disabled={savingDelivery} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
                <Fa icon={faCheck} /><span>{savingDelivery ? 'Saving…' : 'Validate'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
