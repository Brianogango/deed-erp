'use client'
import { useState, useEffect, useMemo, useRef, Suspense, useCallback, type FormEvent } from 'react'
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
  faCopy,
  faCodeBranch,
} from '@fortawesome/free-solid-svg-icons'
import { downloadDeliveryNotePdf } from '@/lib/delivery-note-pdf'
import SerialMultiSelect from '@/components/SerialMultiSelect'
import { hasModuleAccess, canCreateCustomerInvoiceFromSO } from '@/lib/auth/access'
import {
  useSalesStore,
  SaleOrder,
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
} from '@/components/ui'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
import { Fa } from '@/components/icons'
import type { CommercialPdfInput } from '@/lib/commercial-pdf'
import {
  DEFAULT_DOCUMENT_PAYMENT_DETAILS,
  buildPaymentDetailLines,
  normalizeDocumentPaymentDetails,
  type DocumentPaymentDetails,
} from '@/lib/document-payment-details'
import PaymentDetailsPicker from '@/components/payment/PaymentDetailsPicker'
import {
  SalesDocTabs,
  SalesDocTotals,
  SalesDocField,
  SalesDocPill,
  SalesDocWorkflow,
  saleStatusPill,
  deliveryStatusPill,
  buildSoWorkflowSteps,
} from '@/components/modules/sales/workbench'
import ContactFormModal, { blankIndividualContact } from '@/components/contacts/ContactFormModal'
import DocumentEmailSendHistory from '@/components/email/DocumentEmailSendHistory'
import { resolveListPrice } from '@/lib/pricing/pricelist'
import { pairOrderLinesWithDeliveryLines } from '@/lib/delivery-prepare'
import Chatter from '@/components/erp/Chatter'
import { ConfirmQuotationDialog } from '@/components/modules/sales/ConfirmQuotationDialog'
import {
  canConfirmAndReserve,
  canConfirmWithoutReservation,
  stockShortageLines,
  type ConfirmQuotationMode,
} from '@/lib/sales/confirm-quotation'
import { finishUxTask, startUxTask, trackUxEvent } from '@/lib/ux-telemetry'
import {
  SALE_STATUS_BAR,
  SALE_STATUS_LABELS,
  SO_INVOICE_STATUS_LABELS,
  DELIVERY_STATE_LABELS,
  isQuotationStage,
  isQuotationDraft,
  matchesSalesListFilter,
  hasValidatedDeliveryForInvoice,
  effectiveDeliveryLineQty,
  deliveryDeliveredTotal,
  canGenerateDeliveryNote,
  saleOrderInvoiceStatus,
  invoiceableQty,
  isOpenDeliveryStatus,
  deliveriesForSaleOrder,
  remainingUndeliveredByProduct,
  saleOrderLooksConfirmed,
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
/** Prototype-matching currency label (KES …) — global fmtKes uses KSh. */
const salesKes = (n: number | string | null | undefined) => {
  const v = typeof n === 'string' ? Number(n.replace(/,/g, '')) : Number(n ?? 0)
  const safe = Number.isFinite(v) ? v : 0
  return `KES ${safe.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
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

  const looksConfirmed = saleOrderLooksConfirmed({
    status: raw?.status,
    confirmedAt: raw?.confirmedAt,
    orderNumber: raw?.orderNumber ?? raw?.ref,
    ref: raw?.ref ?? raw?.orderNumber,
  })
  const status = looksConfirmed && isQuotationStage(raw?.status) ? 'sale' : raw?.status

  return {
    ...raw,
    status,
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
        className="sp-btn flex items-center gap-2"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span>{label}</span>
        <Fa icon={faChevronDown} className={`text-[10px] transition-transform duration-150 ease-out ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-[8990]" aria-hidden="true" onClick={() => setOpen(false)} />
        <div role="menu" className="absolute right-0 top-full z-[9000] mt-2 min-w-52 rounded-[6px] border border-[var(--sp-border)] bg-[var(--sp-surface)] p-1.5 shadow-md">
          {items.map((item, idx) => (
            <div key={item.label}>
              {idx === firstDanger && firstDanger > 0 && <div className="my-1 border-t border-[var(--sp-border)]" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                className={`flex w-full items-center gap-2.5 rounded-[4px] px-3 py-2 text-left text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${item.tone === 'danger' ? 'text-[var(--sp-danger)] hover:bg-[var(--sp-danger-bg)]' : 'text-[var(--sp-text-2)] hover:bg-[var(--sp-accent-soft)]'}`}
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
    createSaleOrder, updateSaleOrder, confirmSO, ensureWaitingDeliveryForSO, markQuotationSent, setSaleOrderLock,
    addSOLine, removeSOLine, moveSOLine, addSOSection,
    assignSerialsToSOLine, unassignSerialFromSOLine, createInvoiceFromSO, prepareDelivery, validateDelivery, markDeliveryNoteGenerated,
    deleteSaleOrder, showToast, getStockByLocation, resetSOToDraft, cancelSO, createNewSOVersion,
    getCustomerCreditStatus, users, currentUserId, systemSettings,
    companySettings, bankAccounts, confirmDeliveryWithStockDeduction,
    updateDelivery, outboundReleases, initRelease,
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
  // Reversing a confirmed Sales Order (Set to Quotation / Cancel) is Finance/Director-only —
  // matches the server-side check in enforceSaleWorkflow / cancelSO.
  const canReverseConfirmedSO = currentUser?.role === 'director' || currentUser?.role === 'finance_officer'
  const canReserveOnConfirm = canConfirmAndReserve(currentUser?.role)
  const canSkipReserveOnConfirm = canConfirmWithoutReservation(currentUser?.role)

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
  const [quoteFieldErrors, setQuoteFieldErrors] = useState<{ customer?: string; lines?: string }>({})
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
  const [showConfirmQuoteDialog, setShowConfirmQuoteDialog] = useState(false)
  const [detailTab, setDetailTab] = useState('Order Lines')
  const [dnRecipientName, setDnRecipientName] = useState('')
  const [dnRecipientPhone, setDnRecipientPhone] = useState('')
  const [dnRecipientId, setDnRecipientId] = useState('')
  const [dnAddress, setDnAddress] = useState('')
  const [dnNotes, setDnNotes] = useState('')

  // ── Modals ──────────────────────────────────────────────────────────────
  const [showDelConfirm, setShowDelConfirm] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showResetDraftConfirm, setShowResetDraftConfirm] = useState(false)
  const [showPartialInvoiceModal, setShowPartialInvoiceModal] = useState(false)
  const [partialInvoiceQtys, setPartialInvoiceQtys] = useState<Record<string, string>>({})
  const [creatingPartialInvoice, setCreatingPartialInvoice] = useState(false)
  const [creatingNewVersion, setCreatingNewVersion] = useState(false)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [loadingVersionHistory, setLoadingVersionHistory] = useState(false)
  const [versionHistoryRows, setVersionHistoryRows] = useState<Array<{
    id: string; ref: string; versionNumber: number; status: string; total: number
    createdAt: string; createdByName?: string; isLatest: boolean
  }>>([])
  const [compareVersions, setCompareVersions] = useState<{ a: SalesOrderView; b: SalesOrderView } | null>(null)
  const [loadingCompare, setLoadingCompare] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)
  const [addLineQty, setAddLineQty] = useState('1')
  const [addLineDiscount, setAddLineDiscount] = useState('0')
  const [addLineVat, setAddLineVat] = useState(false)
  const [addLineProduct, setAddLineProduct] = useState<(typeof products)[0] | null>(null)
  const [showDnModal, setShowDnModal] = useState(false)
  const [showCreateContact, setShowCreateContact] = useState(false)
  const [newContactQuery, setNewContactQuery] = useState('')
  const [contactFormKey, setContactFormKey] = useState(0)
  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null)
  // Send-by-Email compose dialog (Odoo records recipient + message on the order)
  const [sendModalOrderId, setSendModalOrderId] = useState<string | null>(null)
  const [sendEmailTo, setSendEmailTo] = useState('')
  const [sendEmailCc, setSendEmailCc] = useState('')
  const [sendEmailMessage, setSendEmailMessage] = useState('')
  const [emailHistoryKey, setEmailHistoryKey] = useState(0)
  // Order attachments (Odoo: documents attached to the quotation/order)
  const [soAttachments, setSoAttachments] = useState<Array<{ id: string; name: string; size: number; uploadedAt: string; uploadedBy: string }>>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

  // ── Derived data ────────────────────────────────────────────────────────
  const salesOrderViews = useMemo(() => (saleOrders as any[]).map(normalizeSalesOrderView), [saleOrders])
  const activeOrder = salesOrderViews.find(s => s.id === activeId) ?? null
  // Open the compose dialog (Odoo's Send by Email opens an email composer).
  const openSendQuoteModal = (order: SalesOrderView) => {
    const contact = contacts.find(c => c.id === order.customerId)
    const isUpdate = order.status === 'quotation_sent' || !!order.sentAt
    setSendEmailTo(order.sentTo ?? contact?.email ?? '')
    setSendEmailCc('')
    setSendEmailMessage(
      order.sentMessage
      ?? (isUpdate
        ? `Please find the updated quotation for ${order.customerName} below.\n\nKind regards,\nSales`
        : ''),
    )
    setSendModalOrderId(order.id)
  }

  const emailSalesQuote = async (order: SalesOrderView, email: string, message?: string, ccRaw?: string) => {
    if (sendingQuoteId) return
    const contact = contacts.find(c => c.id === order.customerId)
    if (!email) {
      showToast('Enter the recipient email address before sending.', 'error')
      return
    }
    const kind = (order.status === 'quotation_sent' || !!order.sentAt) ? 'update' : 'initial'
    setSendingQuoteId(order.id)
    try {
      const res = await fetch('/api/integrations/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: order.id,
          channels: ['email'],
          message: message || undefined,
          kind,
          cc: ccRaw || undefined,
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
      setEmailHistoryKey(k => k + 1)
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
      const ccNote = Array.isArray(body?.cc) && body.cc.length ? ` (Cc ${body.cc.join(', ')})` : ''
      showToast(`Quotation emailed to ${email}${ccNote}`, 'success')
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
  /** Clone an existing quotation/sale order's customer + lines into a new draft quotation. */
  const duplicateSaleOrder = (so: SalesOrderView) => {
    setNewCustomer(so.customerId ? { id: so.customerId, name: so.customerName } : null)
    setNewDeliveryDate('')
    setNewPaymentTerms('30')
    setNewNotes(so.notes ?? '')
    setNewCustomerRef(so.customerRef ?? '')
    setNewSalesTeam(so.salesTeam ?? '')
    setNewPricelist(so.pricelist ?? '')
    setNewInvoiceAddress(so.invoiceAddress ?? '')
    setNewDeliveryAddress(so.deliveryAddress ?? '')
    setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
    setNewDraftLines(
      (so.lines ?? [])
        .filter((l: any) => l.lineType !== 'section')
        .map((l: any) => ({
          type: 'item' as const,
          id: uid(),
          productId: l.productId ?? '',
          productName: l.productName ?? l.description ?? '',
          description: l.description ?? l.productName ?? '',
          qty: String(l.qty ?? 1),
          unitPrice: String(l.unitPrice ?? 0),
          discount: String(l.discount ?? 0),
          taxRate: String(l.taxRate ?? 0),
        })),
    )
    setView('new')
    syncOrderUrl(null)
    startUxTask('sales_quote_create', { module: 'sales' })
    showToast(`Duplicated ${so.ref} as a new draft quotation`, 'success')
  }

  const handleCreateNewVersion = async (so: SalesOrderView) => {
    setCreatingNewVersion(true)
    try {
      const created = await createNewSOVersion(so.id)
      if (created?.id) openOrder(created.id)
    } finally {
      setCreatingNewVersion(false)
    }
  }

  const openVersionHistory = async (so: SalesOrderView) => {
    setShowVersionHistory(true)
    setLoadingVersionHistory(true)
    try {
      const res = await fetch(`/api/sale-orders/${so.id}/versions`)
      const data = await res.json().catch(() => null)
      setVersionHistoryRows(Array.isArray(data?.versions) ? data.versions : [])
    } catch {
      setVersionHistoryRows([])
    } finally {
      setLoadingVersionHistory(false)
    }
  }

  /** Fetch two full versions and open the line-by-line diff view. */
  const openCompareVersions = async (idA: string, idB: string) => {
    setLoadingCompare(true)
    try {
      const [resA, resB] = await Promise.all([
        fetch(`/api/sale-orders/${idA}`),
        fetch(`/api/sale-orders/${idB}`),
      ])
      const [a, b] = await Promise.all([resA.json(), resB.json()])
      if (a?.id && b?.id) setCompareVersions({ a: normalizeSalesOrderView(a), b: normalizeSalesOrderView(b) })
      else showToast('Could not load both versions to compare', 'error')
    } catch {
      showToast('Could not load both versions to compare', 'error')
    } finally {
      setLoadingCompare(false)
    }
  }

  /** Invoiceable lines for the partial-invoice picker: id, label, and max qty capped by delivery/invoiced progress. */
  const invoiceableLinesFor = (so: SalesOrderView) =>
    (so.lines ?? [])
      .filter((l: any) => l.lineType !== 'section')
      .map((l: any) => ({
        id: String(l.id),
        label: l.productName || l.description || 'Item',
        maxQty: invoiceableQty({ qty: Number(l.qty) || 0, qtyDelivered: Number(l.qtyDelivered) || 0, qtyInvoiced: Number(l.qtyInvoiced) || 0, invoicePolicy: 'delivery' }),
      }))
      .filter(l => l.maxQty > 0)

  const openPartialInvoiceModal = (so: SalesOrderView) => {
    const lines = invoiceableLinesFor(so)
    setPartialInvoiceQtys(Object.fromEntries(lines.map(l => [l.id, String(l.maxQty)])))
    setShowPartialInvoiceModal(true)
  }

  const submitPartialInvoice = async () => {
    if (!activeOrder) return
    const overrides = Object.entries(partialInvoiceQtys)
      .map(([itemId, qty]) => ({ itemId, qty: Math.max(0, Number(qty) || 0) }))
      .filter(o => o.qty > 0)
    if (overrides.length === 0) {
      showToast('Enter a quantity greater than zero for at least one line', 'error')
      return
    }
    setCreatingPartialInvoice(true)
    try {
      const soPayment = getDocumentPaymentDetails(activeOrder.id)
      const inv = await Promise.resolve(createInvoiceFromSO(activeOrder.id, overrides))
      if (inv?.id) {
        setDocumentPaymentDetails(inv.id, soPayment)
        setShowPartialInvoiceModal(false)
      }
    } finally {
      setCreatingPartialInvoice(false)
    }
  }

  const openDeliveryView = async (deliveryId?: string) => {
    if (!activeOrder) return
    // Heal duplicate open pickings left by concurrent confirm (keep prepared / SO-linked).
    let open = activeDeliveries
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
        open = open.filter(d => d.id === keeper.id || d.preparedAt)
      }
    }
    // Confirmed SO with no DN (confirm/DN sync race) — create one before opening.
    let ensured = open[0] ?? visibleDeliveries[0] ?? activeDeliveries[0]
    if (!deliveryId && !ensured && (activeOrder.status === 'sale' || saleOrderLooksConfirmed(activeOrder))) {
      const created = await ensureWaitingDeliveryForSO(activeOrder.id)
      if (created) ensured = created
    }
    const target =
      (deliveryId ? activeDeliveries.find(d => d.id === deliveryId) : undefined) ??
      ensured
    setFocusDeliveryId(target?.id ?? null)
    const init: Record<string, number> = {}
    for (const { orderLine: l, deliveryLine: delLine } of pairOrderLinesWithDeliveryLines(activeOrder.lines, target?.lines ?? [])) {
      const demand = Math.max(0, Number(delLine?.qty) || Number(l.qty) || 0)
      const serialCount = Array.isArray(l.serialIds) ? l.serialIds.length : 0
      // Always prefer full line qty when serials cover it — never borrow another
      // duplicate product row's DN qty via .find(productId).
      init[l.id] = serialCount > 0 ? Math.min(Number(l.qty) || 0, Math.max(demand, serialCount)) : (Number(l.qty) || demand)
    }
    setDeliveryQtys(init)
    setDnRecipientName(target?.recipientName ?? activeOrder.customerName ?? '')
    setDnRecipientPhone(target?.recipientPhone ?? '')
    setDnRecipientId(target?.recipientIdNumber ?? '')
    setDnAddress(target?.deliveryAddress ?? '')
    setDnNotes(target?.notes ?? '')
    setView('delivery')
    syncOrderUrl(activeOrder.id, 'delivery')
  }

  const openConfirmQuoteDialog = () => {
    if (!activeOrder) return
    if (!activeOrder.lines.filter((l: any) => l.lineType !== 'section').length) {
      showToast('Add at least one product before confirming', 'error')
      return
    }
    if (confirmingSO) return
    setShowConfirmQuoteDialog(true)
  }

  const runConfirmQuotation = async (mode: ConfirmQuotationMode) => {
    if (!activeOrder) return
    if (confirmingSO) return
    setConfirmingSO(true)
    try {
      await Promise.resolve(confirmSO(activeOrder.id))
      if (mode === 'reserve' && canReserveOnConfirm) {
        const del = await ensureWaitingDeliveryForSO(activeOrder.id)
        if (del) {
          const qtys: Record<string, number> = {}
          for (const line of activeOrder.lines) {
            if ((line as any).lineType === 'section' || !line.productId) continue
            qtys[line.productId] = (qtys[line.productId] ?? 0) + (Number(line.qty) || 0)
          }
          prepareDelivery(del.id, qtys)
        }
      }
      setShowConfirmQuoteDialog(false)
    } finally {
      setConfirmingSO(false)
    }
  }

  const quotationStockShortages = useMemo(() => {
    if (!activeOrder || !isQuotationStage(activeOrder.status)) return []
    return stockShortageLines(activeOrder.lines as any, productId => {
      const byLoc = getStockByLocation(productId)
      return (byLoc.warehouse ?? 0) + (byLoc.shop ?? 0)
    })
  }, [activeOrder, getStockByLocation])

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
  // Mirrors the authoritative checks in saveNewQuotation so the Save button reflects
  // real validation state instead of always being enabled.
  const quoteSaveBlockedReason = !newCustomer
    ? 'Select a customer before saving'
    : invalidQtyDraftLines.length > 0
      ? 'Quantity must be greater than zero for every quoted product'
      : validDraftLines.length === 0
        ? 'Add at least one product with quantity greater than zero'
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
  const saveNewQuotation = async (after: 'open' | 'another' | 'list' = 'open') => {
    const errors: { customer?: string; lines?: string } = {}
    if (!newCustomer) errors.customer = 'Please select a customer'
    if (invalidQtyDraftLines.length > 0) {
      errors.lines = 'Quantity must be greater than zero for every quoted product'
    } else if (validDraftLines.length === 0) {
      errors.lines = 'Add at least one product with quantity greater than zero'
    }
    if (errors.customer || errors.lines) {
      setQuoteFieldErrors(errors)
      showToast('Please fix the highlighted fields', 'error')
      requestAnimationFrame(() => {
        const id = errors.customer ? 'quote-customer' : 'quote-lines'
        const el = document.getElementById(id)
        const target = el?.matches('input, select, textarea, button, [tabindex]')
          ? el
          : el?.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]')
        target?.focus?.()
      })
      return
    }
    if (!newCustomer) return
    setQuoteFieldErrors({})
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
    if (after === 'open') {
      openOrder(so.id)
      return
    }
    if (after === 'list') {
      showToast(`Quotation ${so.ref} saved as draft`, 'success')
      backToList()
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
  const handleSaveNewQuotation = () => saveNewQuotation('open')
  const handleSaveAndAddAnotherQuotation = () => saveNewQuotation('another')
  const handleSaveDraftQuotation = () => saveNewQuotation('list')

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
    showToast('Line saved', 'success')
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

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const statusPill = (s: SalesOrderView) => {
    const pill = saleStatusPill(s.status)
    if (isQuotationStage(s.status) && s.validUntil && s.validUntil < todayIso) {
      return <SalesDocPill label="Expired" tone="warning" />
    }
    return <SalesDocPill label={pill.label} tone={pill.tone} />
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
  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page sales-pilot sales-doc">
      {/* ModuleHeader kept for a11y/SSR count but visually hidden via .sales-doc CSS */}
      <ModuleHeader
        title="Sales"
        subtitle="Quotations · orders · deliveries · invoicing"
        icon={<Fa icon={faClipboardCheck} />}
        count={stats.quotations + stats.quotationsSent + stats.orders}
        color="#FFFFFF"
        subtitleMode="visible"
        primaryAction={
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openNewForm}>
            New quotation
          </PrimaryActionButton>
        }
      />

      <div className="mod-body sales-doc-body p-0">
        <div className="sales-workbench">
          <div className="flex flex-col">
              {/* ── NEW QUOTATION FULL-PAGE FORM ──────────────────────────── */}
              {view === 'new' ? (
                <NewQuotationForm
                  customers={customers}
                  products={sellableProducts}
                  newCustomer={newCustomer}
                  setNewCustomer={(c) => {
                    setNewCustomer(c)
                    if (c) setQuoteFieldErrors(prev => ({ ...prev, customer: undefined }))
                  }}
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
                  canSave={!quoteSaveBlockedReason}
                  saveBlockedReason={quoteSaveBlockedReason}
                  fieldErrors={quoteFieldErrors}
                  onSave={handleSaveNewQuotation}
                  onSaveAndAddAnother={handleSaveAndAddAnotherQuotation}
                  onSaveDraft={handleSaveDraftQuotation}
                  onCancel={() => {
                    finishUxTask('abandon', {
                      task: 'sales_quote_create',
                      lines: newDraftLines.length,
                      hasCustomer: !!newCustomer,
                    })
                    backToList()
                  }}
                  onCreateNewCustomer={(q) => {
                    setNewContactQuery(q)
                    setContactFormKey(k => k + 1)
                    setShowCreateContact(true)
                  }}
                />
              ) : view === 'delivery' && activeOrder ? (
                /* ── DELIVERY NOTE VIEW ──────────────────────────────────── */
                <DeliveryNoteView
                  order={activeOrder}
                  deliveries={deliveries}
                  focusDeliveryId={focusDeliveryId}
                  serials={serials}
                  products={products}
                  companySettings={companySettings}
                  bankAccounts={bankAccounts}
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
                  <div className="sales-proto-page-header">
                    <div>
                      <h1>{listTab === 'quotations' ? 'Quotations' : 'Sales orders'}</h1>
                      <div className="sub">
                        {listTab === 'quotations'
                          ? 'Draft → send → accept → convert to sales order'
                          : 'Confirmed → deliver → invoice → paid'}
                      </div>
                    </div>
                    <div className="sales-proto-actions">
                      <button type="button" className="sp-btn sp-btn-primary" onClick={openNewForm}>
                        New quotation
                      </button>
                    </div>
                  </div>
                  <div className="sp-panel">
                  <SalesDocTabs
                    tabs={[
                      `Quotations (${stats.quotations + stats.quotationsSent})`,
                      `Orders (${stats.orders})`,
                    ]}
                    active={
                      listTab === 'quotations'
                        ? `Quotations (${stats.quotations + stats.quotationsSent})`
                        : `Orders (${stats.orders})`
                    }
                    onChange={tab => {
                      if (tab.startsWith('Quotations')) setListTabAndReset('quotations')
                      else setListTabAndReset('orders')
                    }}
                    ariaLabel="Sales sections"
                  />
                  <div className="sp-list-toolbar">
                    <input
                      type="search"
                      className="sp-list-search"
                      aria-label="Search quotations and orders"
                      placeholder="Search reference or customer…"
                      value={search}
                      onChange={e => setSearchAndReset(e.target.value)}
                    />
                    <select
                      aria-label="Filter by status"
                      value={filter}
                      onChange={e => setFilterAndReset(e.target.value as SalesListFilter)}
                    >
                      <option value="all">All statuses</option>
                      {listTab === 'quotations' ? (
                        <>
                          <option value="my_quotations">My quotations</option>
                          <option value="quotations">Quotation</option>
                          <option value="quotation_sent">Quotation Sent</option>
                        </>
                      ) : (
                        <>
                          <option value="sales_orders">Sales Order</option>
                          <option value="to_invoice">To invoice</option>
                          <option value="fully_invoiced">Fully invoiced</option>
                        </>
                      )}
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <div className="sp-list-view-toggle" role="group" aria-label="List layout">
                      <button type="button" className="sp-btn" data-active={listViewMode === 'table' ? 'true' : 'false'} onClick={() => setListViewMode('table')} aria-pressed={listViewMode === 'table'}>
                        <Fa icon={faListUl} className="text-xs" /> Table
                      </button>
                      <button type="button" className="sp-btn" data-active={listViewMode === 'kanban' ? 'true' : 'false'} onClick={() => setListViewMode('kanban')} aria-pressed={listViewMode === 'kanban'}>
                        <Fa icon={faThLarge} className="text-xs" /> Kanban
                      </button>
                    </div>
                  </div>
                  {listViewMode === 'table' && (
                    <div className="sp-table-wrap">
                      <table className="sp-table">
                        <thead>
                          <tr>
                            <th>Reference</th>
                            <th>Customer</th>
                            <th>Contact</th>
                            <th>Date</th>
                            <th>Valid until</th>
                            <th>Salesperson</th>
                            <th className="num">Total</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.length === 0 ? (
                            <tr>
                              <td colSpan={8} style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--sp-text-3)' }}>
                                {listTab === 'quotations' && stats.orders > 0
                                  ? 'No quotations here — switch to Orders to see confirmed sales.'
                                  : salesOrderViews.length === 0
                                    ? 'No sale orders yet'
                                    : 'No orders match your filter'}
                                <div style={{ marginTop: 10 }}>
                                  {listTab === 'quotations' && stats.orders > 0 ? (
                                    <button type="button" className="sp-btn sp-btn-primary" onClick={() => { setListTabAndReset('orders'); setFilterAndReset('sales_orders') }}>
                                      View orders ({stats.orders})
                                    </button>
                                  ) : salesOrderViews.length === 0 ? (
                                    <button type="button" className="sp-btn sp-btn-primary" onClick={openNewForm}>New quotation</button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ) : (
                            filtered.map(s => {
                              const cust = contacts.find(c => c.id === s.customerId)
                              const contactLabel = cust?.type === 'individual' ? (cust.name || '—') : (cust?.email || cust?.name || '—')
                              return (
                                <tr key={s.id} className="sp-row-click" onClick={() => openOrder(s.id)} style={{ cursor: 'pointer' }}>
                                  <td><button type="button" className="sp-linkish" onClick={e => { e.stopPropagation(); openOrder(s.id) }}>{s.ref}</button></td>
                                  <td>{s.customerName}</td>
                                  <td>{contactLabel}</td>
                                  <td>{fmtDate(s.date)}</td>
                                  <td>{s.validUntil ? fmtDate(s.validUntil) : '—'}</td>
                                  <td>{(s as any).salespersonName || s.createdByName || '—'}</td>
                                  <td className="num">{salesKes(s.total)}</td>
                                  <td>{statusPill(s)}</td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {listViewMode === 'kanban' && (
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {(['quotation', 'quotation_sent', 'sale', 'cancelled'] as const).map(col => {
                        const colOrders = filtered.filter(s => s.status === col)
                        const colColors: Record<string, string> = { quotation: 'var(--warning)', quotation_sent: 'var(--primary)', sale: 'var(--navy)', cancelled: 'var(--text-4)' }
                        return (
                          <div key={col} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: colColors[col] }}>{SALE_STATUS_LABELS[col]}</span>
                              <span className="text-[10px] font-semibold text-[var(--sp-text-3)] bg-[var(--sp-grey-bg)] px-2 py-0.5 rounded-full">{colOrders.length}</span>
                            </div>
                            {colOrders.length === 0 && <div className="border border-dashed border-[var(--sp-border)] rounded-[6px] p-4 text-center text-[10px] text-[var(--sp-text-3)]">No orders</div>}
                            {colOrders.map(s => (
                              <div
                                key={s.id}
                                onClick={() => openOrder(s.id)}
                                className={`card p-3 cursor-pointer sales-kanban-card sales-kanban-card--${col}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-bold sp-linkish">{s.ref}</span>
                                  <span className="text-[10px] font-bold text-[var(--sp-text)]">{salesKes(s.total)}</span>
                                </div>
                                <p className="text-[11px] text-[var(--sp-text-2)] truncate">{s.customerName}</p>
                                <p className="text-[10px] text-[var(--sp-text-3)] mt-1">{fmtDate(s.date)} · {s.lines?.length ?? 0} item{(s.lines?.length ?? 0) !== 1 ? 's' : ''}</p>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  </div>
                </>
              ) : view === 'form' && !activeOrder && searchParams.get('id') ? (
                <ModuleSkeleton />
              ) : (
                /* ── ORDER FORM VIEW ─────────────────────────────────────── */
                <div>
                  {activeOrder && (
                    <>
                  <div className="sales-proto-page-header">
                    <div>
                      <button type="button" className="sp-btn sp-btn-ghost" style={{ paddingLeft: 0 }} onClick={backToList}>← Back</button>
                      <div className="sp-ref-row">
                        <h1>{activeOrder.ref}</h1>
                        {(() => {
                          const pill = saleStatusPill(activeOrder.status)
                          return <SalesDocPill label={pill.label} tone={pill.tone} />
                        })()}
                        {activeOrder.locked && <SalesDocPill label="Locked" tone="neutral" />}
                      </div>
                      <div className="sub">
                        {isQuotationStage(activeOrder.status) ? (
                          <>Source customer {activeOrder.customerName}{activeOrder.salespersonName ? ` · Salesperson ${activeOrder.salespersonName}` : ''}</>
                        ) : (
                          <>
                            Source quotation{' '}
                            {activeOrder.quotationRef ? (
                              <span className="sp-linkish">{activeOrder.quotationRef}</span>
                            ) : '—'}
                            {' · '}{activeOrder.customerName}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="sales-proto-actions">
                      {isQuotationStage(activeOrder.status) && (<>
                          {isQuotationDraft(activeOrder.status) && !activeOrder.locked && (
                            <button
                              type="button"
                              className="sp-btn"
                              onClick={() => {
                                let lines = activeOrder.lines
                                if (editingLineId) {
                                  const qty = Math.max(0, Number(editLineQty) || 0)
                                  const unitPrice = Math.max(0, Number(editLinePrice) || 0)
                                  const discount = Math.max(0, Math.min(100, Number(editLineDiscount) || 0))
                                  const taxRate = Math.max(0, Number(editLineTax) || 0)
                                  const subtotal = Math.round(qty * unitPrice * (1 - discount / 100))
                                  lines = activeOrder.lines.map(l => l.id !== editingLineId ? l : {
                                    ...l,
                                    productName: editLineDesc || l.productName,
                                    description: editLineDesc || l.description,
                                    qty,
                                    unitPrice,
                                    discount,
                                    discountPercent: discount,
                                    taxRate,
                                    subtotal,
                                  })
                                  setEditingLineId(null)
                                }
                                const sub = lines.reduce((a, l) => a + (Number(l.subtotal) || 0), 0)
                                const tax = lines.reduce((a, l) => a + Math.round((Number(l.subtotal) || 0) * (Number(l.taxRate) || 0) / 100), 0)
                                updateSaleOrder(activeOrder.id, {
                                  lines,
                                  subtotal: sub,
                                  taxTotal: tax,
                                  total: sub + tax,
                                  notes: activeOrder.notes,
                                  validUntil: activeOrder.validUntil,
                                  paymentTerms: activeOrder.paymentTerms,
                                  salespersonName: activeOrder.salespersonName,
                                })
                                showToast('Quotation saved', 'success')
                              }}
                            >
                              Save
                            </button>
                          )}
                          {activeOrder.status === 'quotation' && (
                            <button type="button" className="sp-btn sp-btn-primary" disabled={!activeOrder.lines.length || sendingQuoteId === activeOrder.id} onClick={() => openSendQuoteModal(activeOrder)}>
                              {sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send to customer'}
                            </button>
                          )}
                          {activeOrder.status === 'quotation_sent' && (
                            <button type="button" className="sp-btn" disabled={!activeOrder.lines.length || sendingQuoteId === activeOrder.id} onClick={() => openSendQuoteModal(activeOrder)}>
                              {sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send to customer'}
                            </button>
                          )}
                          <MoreActionsMenu
                            items={[
                              ...(activeOrder.status === 'quotation_sent' ? [
                                { label: 'Reset to Draft', icon: faRotateLeft, onClick: () => setShowResetDraftConfirm(true) },
                              ] : []),
                              { label: 'Preview', icon: faFileAlt, disabled: !activeOrder.lines.length, onClick: () => previewSalesDocument(activeOrder, 'Quotation', 'QUOTATION') },
                              { label: 'Print', icon: faPrint, disabled: !activeOrder.lines.length, onClick: () => downloadSalesDocument(activeOrder, 'Quotation', 'QUOTE', 'QUOTATION') },
                              { label: 'Pro-forma invoice', icon: faFileInvoiceDollar, disabled: !activeOrder.lines.length, onClick: () => downloadProformaInvoice(activeOrder) },
                              { label: 'Duplicate', icon: faCopy, onClick: () => duplicateSaleOrder(activeOrder) },
                              { label: creatingNewVersion ? 'Creating version…' : 'New Version', icon: faCodeBranch, disabled: creatingNewVersion, onClick: () => void handleCreateNewVersion(activeOrder) },
                              { label: 'Version History', icon: faClockRotateLeft, onClick: () => void openVersionHistory(activeOrder) },
                              { label: 'Cancel', icon: faBan, tone: 'danger', onClick: () => setShowCancelConfirm(true) },
                              { label: 'Delete', icon: faTrash, tone: 'danger', onClick: () => setShowDelConfirm(true) },
                            ]}
                          />
                          <button
                            type="button"
                            className={activeOrder.status === 'quotation_sent' ? 'sp-btn sp-btn-primary' : 'sp-btn'}
                            disabled={confirmingSO}
                            onClick={openConfirmQuoteDialog}
                          >
                            {confirmingSO ? 'Confirming…' : 'Confirm quotation'}
                          </button>
                      </>)}
                      {activeOrder.status === 'sale' && (<>
                        <button type="button" className="sp-btn" onClick={() => previewSalesDocument(activeOrder, 'Sale Order', 'SALES ORDER')}>Print</button>
                        <button type="button" className="sp-btn" disabled={sendingQuoteId === activeOrder.id} onClick={() => openSendQuoteModal(activeOrder)}>
                          {sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send by email'}
                        </button>
                        <MoreActionsMenu
                          items={[
                            { label: 'Preview', icon: faFileAlt, onClick: () => previewSalesDocument(activeOrder, 'Sale Order', 'SALES ORDER') },
                            ...(canInvoiceFromSO && invoiceableLinesFor(activeOrder).length > 0 ? [{ label: 'Create Partial Invoice…', icon: faFileInvoiceDollar, onClick: () => openPartialInvoiceModal(activeOrder) }] : []),
                            ...(activeDeliveries.some(d => canGenerateDeliveryNote(d)) ? [{ label: 'Print delivery note', icon: faTruck, onClick: () => { const del = activeDeliveries.find(d => canGenerateDeliveryNote(d)) ?? activeDeliveries[0]; setDnRecipientName(del.recipientName ?? activeOrder.customerName ?? ''); setDnRecipientPhone(del.recipientPhone ?? ''); setDnRecipientId(del.recipientIdNumber ?? ''); setDnAddress(del.deliveryAddress ?? ''); setDnNotes(del.notes ?? ''); setShowDnModal(true) } }] : []),
                            ...(activeOrder.locked && isAdmin ? [{ label: 'Unlock', icon: faRotateLeft, onClick: () => setSaleOrderLock(activeOrder.id, false) }] : []),
                            ...(!activeOrder.locked && systemSettings.salesLockConfirmed && isAdmin ? [{ label: 'Lock', icon: faSave, onClick: () => setSaleOrderLock(activeOrder.id, true) }] : []),
                            { label: 'Duplicate', icon: faCopy, onClick: () => duplicateSaleOrder(activeOrder) },
                            { label: 'Version History', icon: faClockRotateLeft, onClick: () => void openVersionHistory(activeOrder) },
                            ...(canReverseConfirmedSO ? [
                              { label: 'Set to Quotation', icon: faRotateLeft, onClick: () => resetSOToDraft(activeOrder.id) },
                              { label: 'Cancel', icon: faBan, tone: 'danger' as const, onClick: () => setShowCancelConfirm(true) },
                            ] : []),
                          ]}
                        />
                        {(visibleDeliveries.some(d => isOpenDeliveryStatus(d.status)) || visibleDeliveries.length === 0) ? (
                          <button type="button" className="sp-btn sp-btn-primary" onClick={() => void openDeliveryView()}>
                            {visibleDeliveries.length === 0 ? 'Create delivery' : 'Delivery'}
                          </button>
                        ) : (
                          <button type="button" className="sp-btn" onClick={() => void openDeliveryView()}>Deliveries</button>
                        )}
                        {canInvoiceFromSO && invoiceDeliveryReady && (activeInvoiceStatus === 'to_invoice' || activeInvoiceStatus === 'upselling') ? (
                          <button
                            type="button"
                            className="sp-btn"
                            onClick={async () => {
                              const soPayment = getDocumentPaymentDetails(activeOrder.id)
                              const inv = await Promise.resolve(createInvoiceFromSO(activeOrder.id))
                              if (inv?.id) setDocumentPaymentDetails(inv.id, soPayment)
                            }}
                          >
                            Create invoice
                          </button>
                        ) : null}
                      </>)}
                      {activeOrder.status === 'cancelled' && (
                        <button type="button" className="sp-btn" onClick={() => resetSOToDraft(activeOrder.id)}>Set to Quotation</button>
                      )}
                    </div>
                  </div>

                  {activeOrder.status === 'sale' && (
                    <SalesDocWorkflow
                      steps={buildSoWorkflowSteps({
                        hasDelivery: visibleDeliveries.length > 0,
                        deliveryPrepared: activeDeliveries.some(d => !!d.preparedAt || d.status === 'ready' || d.status === 'done'),
                        deliveryDone: activeDeliveries.some(d => d.status === 'done'),
                        invoiced: activeInvoiceStatus === 'invoiced' || activeInvoices.length > 0,
                        paid: activePayments.length > 0 && activeInvoiceStatus === 'invoiced',
                      })}
                    />
                  )}

                      {isQuotationStage(activeOrder.status) && quotationStockShortages.length > 0 && (
                        <div className="sp-banner-warn" role="status">
                          <span aria-hidden>!</span>
                          <div>
                            <strong>Stock warning</strong>
                            <div>
                              {quotationStockShortages
                                .slice(0, 3)
                                .map(s => `${s.productName} needs ${s.qty}, free ${s.available}`)
                                .join(' · ')}
                              {quotationStockShortages.length > 3
                                ? ` · +${quotationStockShortages.length - 3} more`
                                : ''}
                            </div>
                          </div>
                        </div>
                      )}

                      {activeOrder.status === 'sale' && activeOrder.quotationRef && (
                        <div className="sp-banner-ok" role="status">
                          <span aria-hidden>✓</span>
                          <div>
                            <strong>Confirmed sales order</strong>
                            <div>
                              Source quotation {activeOrder.quotationRef}
                              {activeOrder.confirmedAt
                                ? ` · confirmed ${fmtDate(activeOrder.confirmedAt)}${activeOrder.confirmedByName ? ` by ${activeOrder.confirmedByName}` : ''}`
                                : ''}
                              {visibleDeliveries.length === 0
                                ? ' · create a delivery to allocate stock'
                                : ` · ${visibleDeliveries.length} delivery${visibleDeliveries.length === 1 ? '' : 'ies'}`}
                            </div>
                          </div>
                        </div>
                      )}

                    <div className="sp-panel sp-panel-pad">
                      <div className="sp-grid-2">
                        <div>
                          <SalesDocField label="Customer"><input readOnly value={activeOrder.customerName || ''} /></SalesDocField>
                          <SalesDocField label="Contact"><input readOnly value={(() => { const c = customers.find(x => x.id === activeOrder.customerId); return c?.name || '—' })()} /></SalesDocField>
                          <SalesDocField label="Email"><input readOnly value={customers.find(c => c.id === activeOrder.customerId)?.email || '—'} /></SalesDocField>
                          <SalesDocField label="Phone"><input readOnly value={(() => { const c = customers.find(x => x.id === activeOrder.customerId); return c?.phone || c?.mobile || '—' })()} /></SalesDocField>
                        </div>
                        <div>
                          <SalesDocField label={isQuotationStage(activeOrder.status) ? 'Quote date' : 'Order date'}><input readOnly value={fmtDate(activeOrder.date) || ''} /></SalesDocField>
                          <SalesDocField label={isQuotationStage(activeOrder.status) ? 'Valid until' : 'Expected delivery'}>
                            <input readOnly value={fmtDate(isQuotationStage(activeOrder.status) ? (activeOrder.validUntil || '') : (activeOrder.deliveryDate || '')) || '—'} />
                          </SalesDocField>
                          <SalesDocField label="Salesperson"><input readOnly value={activeOrder.salespersonName || '—'} /></SalesDocField>
                          <SalesDocField label="Payment terms"><input readOnly value={activeOrder.paymentTerms || '—'} /></SalesDocField>
                          <SalesDocField label="Currency"><input readOnly value="KES" /></SalesDocField>
                          {activeOrder.status === 'sale' && (
                            <SalesDocField label="Related">
                              <div style={{ fontSize: 12.5, paddingTop: 4 }}>
                                Deliveries:{' '}
                                {visibleDeliveries.length
                                  ? visibleDeliveries.map(d => (
                                      <button key={d.id} type="button" className="sp-linkish" style={{ marginRight: 6 }} onClick={() => void openDeliveryView(d.id)}>{d.ref}</button>
                                    ))
                                  : '—'}
                                {' · '}Invoices:{' '}
                                {activeInvoices.length
                                  ? activeInvoices.map(inv => (
                                      <button key={inv.id} type="button" className="sp-linkish" style={{ marginRight: 6 }} onClick={() => router.push('/finance?tab=invoices')}>{inv.ref}</button>
                                    ))
                                  : 'None yet'}
                              </div>
                            </SalesDocField>
                          )}
                        </div>
                      </div>
                    </div>

                      {activeOrder.status === 'quotation_sent' && !activeOrder.locked && (
                        <div className="sp-banner-warn" role="status">
                          <span aria-hidden>!</span>
                          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                            <span>This quotation was sent. Reset to draft to make changes, then save.</span>
                            <button type="button" className="sp-btn" onClick={() => setShowResetDraftConfirm(true)}>Reset to Draft</button>
                          </div>
                        </div>
                      )}

                      {/* Lines + Summary — prototype tabbed panel */}
                      <div className="sp-panel" style={{ marginTop: 10 }}>
                        <SalesDocTabs
                          tabs={isQuotationStage(activeOrder.status)
                            ? ['Order Lines', 'Terms and Conditions', 'Notes', 'Activities', 'History']
                            : ['Order Lines', 'Delivery and Stock', 'Invoices', 'Notes', 'History']}
                          active={detailTab}
                          onChange={setDetailTab}
                        />
                        {detailTab === 'Order Lines' && (
                          <>
                          <div className="sp-table-wrap">
                            <table className="sp-table">
                              <thead>
                                <tr>
                                  <th>Product</th>
                                  <th>Description</th>
                                  <th className="num">Qty</th>
                                  <th>Unit</th>
                                  {activeOrder.status === 'sale' && (
                                    <th className="num">Delivered</th>
                                  )}
                                  {(activeInvoices.length > 0 || (activeOrder.status === 'sale' && activeOrder.lines.some((l: any) => (l.qtyInvoiced ?? 0) > 0))) && (
                                    <th className="num">Invoiced</th>
                                  )}
                                  <th className="num">Unit price</th>
                                  <th className="num">Disc%</th>
                                  <th>Tax</th>
                                  <th className="num">Amount</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border-lt)]">
                                {activeOrder.lines.map((l, lineIndex) => {
                                  const canEdit = isQuotationDraft(activeOrder.status) && !activeOrder.locked
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
                                      <td>
                                        {isEditing ? (
                                          <input type="text" aria-label="Line item product" value={editLineDesc} onChange={e => setEditLineDesc(e.target.value)} />
                                        ) : (
                                          <div>
                                            <span>{l.productName ?? 'Item'}</span>
                                            {lineSerials.length > 0 && (
                                              <div style={{ fontSize: 10, color: 'var(--sp-text-3)' }}>
                                                {lineSerials.map((s: any) => s.serial ?? s.serialNumber).join(', ')}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td>{l.description || '—'}</td>
                                      <td className="num">
                                        {isEditing ? <input type="number" aria-label="Line item quantity" min={1} value={editLineQty} onChange={e => setEditLineQty(e.target.value)} className="w-14 text-center" />
                                        : l.qty}
                                      </td>
                                      <td>Unit</td>
                                      {showDelivered && (
                                        <td className="num">
                                          <span className={`font-semibold ${(l.qtyDelivered ?? 0) >= l.qty ? 'text-emerald-600' : (l.qtyDelivered ?? 0) > 0 ? 'text-amber-500' : 'text-[var(--text-4)]'}`}>{l.qtyDelivered ?? 0}</span>
                                        </td>
                                      )}
                                      {showInvoiced && (
                                        <td className="num">
                                          <span className={`font-semibold ${invoicedQty > 0 ? 'text-violet-600' : 'text-[var(--text-4)]'}`}>{invoicedQty}</span>
                                        </td>
                                      )}
                                      <td className="num">
                                        {isEditing ? <input type="number" aria-label="Line item unit price" min={0} value={editLinePrice} onChange={e => setEditLinePrice(e.target.value)} className="w-20 text-right" />
                                        : salesKes(l.unitPrice)}
                                      </td>
                                      <td className="num">
                                        {isEditing ? <input type="number" aria-label="Line item discount percentage" min={0} max={100} value={editLineDiscount} onChange={e => setEditLineDiscount(e.target.value)} className="w-14 text-right" />
                                        : `${l.discount ?? l.discountPercent ?? 0}%`}
                                      </td>
                                      <td>
                                        {isEditing ? <input type="number" aria-label="Line item tax percentage" min={0} max={100} value={editLineTax} onChange={e => setEditLineTax(e.target.value)} className="w-14 text-right" />
                                        : `${l.taxRate ?? 0}%`}
                                      </td>
                                      <td className="num">
                                        {isEditing ? (
                                          <span>{salesKes(Math.round(Math.max(0, Number(editLineQty) || 0) * Math.max(0, Number(editLinePrice) || 0) * (1 - Math.max(0, Math.min(100, Number(editLineDiscount) || 0)) / 100)))}</span>
                                        ) : salesKes(l.subtotal)}
                                      </td>
                                      <td>
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
                          {isQuotationDraft(activeOrder.status) && !activeOrder.locked && (
                            <div className="sp-line-actions">
                              <button type="button" onClick={() => setShowAddLine(true)}>Add a product</button>
                              <button type="button" onClick={() => addSOSection(activeOrder.id)}>Add a section</button>
                            </div>
                          )}
                          <SalesDocTotals
                            sticky
                            rows={[
                              { label: 'Untaxed amount', value: salesKes(activeOrder.subtotal) },
                              { label: 'VAT', value: salesKes(activeOrder.taxTotal) },
                              { label: 'Total', value: salesKes(activeOrder.total), grand: true },
                            ]}
                          />
                          </>
                        )}
                        {detailTab === 'Notes' && (
                          <div className="sp-panel-pad flex flex-col gap-3">
                            <SalesDocField label="Notes">
                              <textarea
                                rows={5}
                                value={activeOrder.notes || ''}
                                readOnly={!isQuotationDraft(activeOrder.status) || !!activeOrder.locked}
                                onChange={e => updateSaleOrder(activeOrder.id, { notes: e.target.value })}
                                placeholder="Customer-facing notes…"
                              />
                            </SalesDocField>
                            <PaymentDetailsPicker
                              value={getDocumentPaymentDetails(activeOrder.id)}
                              onChange={next => setDocumentPaymentDetails(activeOrder.id, next)}
                              readOnly={!isQuotationDraft(activeOrder.status) || !!activeOrder.locked}
                            />
                            <Chatter
                              model="sale_order"
                              recordId={activeOrder.id}
                              staffName={currentUser?.name || 'Staff'}
                              title="Internal Notes"
                              compact
                            />
                          </div>
                        )}
                        {detailTab === 'Terms and Conditions' && (
                          <p className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
                            Terms and conditions content.
                          </p>
                        )}
                        {detailTab === 'Attachments' && (
                          <p className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
                            Attachments are managed after the document is saved.
                          </p>
                        )}
                        {detailTab === 'Delivery and Stock' && (
                          <div className="sp-panel-pad">
                            {activeDeliveries.length === 0 ? (
                              <p style={{ color: 'var(--sp-text-3)' }}>No deliveries yet.</p>
                            ) : (
                              <table className="sp-table">
                                <thead>
                                  <tr>
                                    <th>Reference</th>
                                    <th>Status</th>
                                    <th>Scheduled</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {activeDeliveries.map((d: any) => (
                                    <tr key={d.id}>
                                      <td>{d.name || d.id}</td>
                                      <td>{d.status}</td>
                                      <td>{d.scheduledDate ? fmtDate(d.scheduledDate) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                        {detailTab === 'Invoices' && (
                          <div className="sp-panel-pad">
                            {activeInvoices.length === 0 ? (
                              <p style={{ color: 'var(--sp-text-3)' }}>No invoices yet.</p>
                            ) : (
                              <table className="sp-table">
                                <thead>
                                  <tr>
                                    <th>Reference</th>
                                    <th>Status</th>
                                    <th className="num">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {activeInvoices.map((inv: any) => (
                                    <tr key={inv.id}>
                                      <td>{inv.name || inv.number || inv.id}</td>
                                      <td>{inv.status || inv.state}</td>
                                      <td className="num">{salesKes(inv.total ?? inv.amountTotal ?? 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                        {(detailTab === 'History' || detailTab === 'Activities') && (
                          <div className="sp-panel-pad">
                            {[
                              { label: 'Quotation created', date: activeOrder.date, show: true },
                              { label: `Quotation sent${activeOrder.sentTo ? ` to ${activeOrder.sentTo}` : ''}${activeOrder.sentByName ? ` by ${activeOrder.sentByName}` : ''}`, date: activeOrder.sentAt ?? activeOrder.date, show: !!activeOrder.sentAt },
                              { label: `Confirmed into Sales Order${activeOrder.confirmedByName ? ` by ${activeOrder.confirmedByName}` : ''}`, date: activeOrder.confirmedAt ?? activeOrder.date, show: activeOrder.status === 'sale' },
                              { label: 'Delivery validated', date: activeOrder.date, show: activeDeliveries.some(d => d.status === 'done') },
                              { label: 'Invoice created', date: activeOrder.date, show: activeInvoices.length > 0 },
                            ].filter(e => e.show).map((event, idx) => (
                              <div key={idx} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--sp-border)' }}>
                                <div style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--sp-accent)', marginTop: 4, flexShrink: 0 }} />
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 600 }}>{event.label}</div>
                                  <div style={{ fontSize: 11, color: 'var(--sp-text-3)' }}>{fmtDate(event.date)}</div>
                                </div>
                              </div>
                            ))}
                            <div style={{ marginTop: 12 }}>
                              <DocumentEmailSendHistory
                                documentId={activeOrder.id}
                                documentType="quote"
                                refreshKey={emailHistoryKey}
                                title="Quote email history"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showCreateContact && (
        <ContactFormModal
          key={contactFormKey}
          forceCustomer
          initial={blankIndividualContact({ name: newContactQuery.trim() })}
          onClose={() => {
            setShowCreateContact(false)
            setNewContactQuery('')
          }}
          onSaved={async (contact) => {
            setShowCreateContact(false)
            setNewContactQuery('')
            setNewCustomer({ id: contact.id, name: contact.name })
            if (view !== 'new') {
              const so = await createSaleOrder(contact.id, contact.name)
              openOrder(so.id)
            }
          }}
        />
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
                    <p className="text-[10px] text-[var(--text-4)]">{p.category} · {salesKes(p.salePrice)}{p.stockQty > 0 ? ` · ${p.stockQty} in stock` : ' · out of stock'}</p>
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
                  <p className="text-xs text-[var(--text-4)] mt-0.5">{salesKes(addLineProduct.salePrice)} × {Math.max(1, Number(addLineQty) || 1)}{Number(addLineDiscount) > 0 && ` − ${addLineDiscount}% disc`}{addLineVat && ` + ${companySettings.vatRate}% VAT`}</p>
                </div>
                <p className="text-sm font-extrabold text-primary-600 font-mono">{salesKes((() => { const qty = Math.max(1, Number(addLineQty) || 1); const disc = Number(addLineDiscount) || 0; const sub = Math.round(addLineProduct.salePrice * qty * (1 - disc / 100)); return sub + (addLineVat ? Math.round(sub * (companySettings.vatRate / 100)) : 0) })())}</p>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowAddLine(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddLine} disabled={!addLineProduct || !Number(addLineQty)}>Add to Order</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Partial invoice — pick which lines/quantities to invoice this round
          instead of the one-click "Create Invoice" which bills everything
          currently invoiceable. Each qty is capped server-side regardless of
          what's typed here. */}
      {showPartialInvoiceModal && activeOrder && (
        <Modal title={`Create Partial Invoice — ${activeOrder.ref}`} onClose={() => setShowPartialInvoiceModal(false)} width={520}>
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--text-3)]">Choose how much of each delivered line to invoice now. Leave a line at 0 to invoice it later.</p>
            <div className="flex flex-col gap-3">
              {invoiceableLinesFor(activeOrder).map(l => (
                <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--text-1)] truncate">{l.label}</p>
                    <p className="text-[10px] text-[var(--text-4)]">Up to {l.maxQty} available to invoice</p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={l.maxQty}
                    className="form-input text-xs w-20 text-right"
                    value={partialInvoiceQtys[l.id] ?? ''}
                    onChange={e => {
                      const clamped = Math.max(0, Math.min(l.maxQty, Number(e.target.value) || 0))
                      setPartialInvoiceQtys(prev => ({ ...prev, [l.id]: String(clamped) }))
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowPartialInvoiceModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => void submitPartialInvoice()} disabled={creatingPartialInvoice}>
                {creatingPartialInvoice ? 'Creating…' : 'Create Invoice'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Version history — full lineage for a quotation created via "New Version".
          Most quotations have exactly one row here (never versioned). */}
      {showVersionHistory && (
        <Modal title="Version History" onClose={() => { setShowVersionHistory(false); setVersionHistoryRows([]) }} width={560}>
          <div className="flex flex-col gap-3">
            {loadingVersionHistory ? (
              <p className="text-xs text-[var(--text-3)]">Loading versions…</p>
            ) : versionHistoryRows.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">No version history found.</p>
            ) : (
              versionHistoryRows.map((v, idx) => {
                const prev = idx > 0 ? versionHistoryRows[idx - 1] : null
                return (
                  <div key={v.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-primary-600">{v.ref}</span>
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-4)]">v{v.versionNumber}</span>
                        {v.isLatest && <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-600">Latest</span>}
                        <StatusBadge status={v.status as any} label={SALE_STATUS_LABELS[v.status as keyof typeof SALE_STATUS_LABELS] ?? v.status} size="xs" />
                      </div>
                      <p className="text-[10px] text-[var(--text-4)] mt-1">
                        {salesKes(v.total)} · {fmtDate(v.createdAt)}{v.createdByName ? ` · ${v.createdByName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {prev && (
                        <button
                          type="button"
                          className="btn-outline text-[10px] px-2 py-1"
                          disabled={loadingCompare}
                          onClick={() => void openCompareVersions(prev.id, v.id)}
                        >
                          Compare
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-outline text-[10px] px-2 py-1"
                        onClick={() => { setShowVersionHistory(false); openOrder(v.id) }}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Modal>
      )}

      {/* Compare two versions — line-by-line qty/price/total diff. */}
      {compareVersions && (() => {
        const { a, b } = compareVersions
        const linesA = (a.lines ?? []).filter((l: any) => l.lineType !== 'section')
        const linesB = (b.lines ?? []).filter((l: any) => l.lineType !== 'section')
        const keys = Array.from(new Set([...linesA.map((l: any) => l.productId || l.description), ...linesB.map((l: any) => l.productId || l.description)]))
        const rows = keys.map(key => {
          const la = linesA.find((l: any) => (l.productId || l.description) === key)
          const lb = linesB.find((l: any) => (l.productId || l.description) === key)
          const changed = !la || !lb || Number(la.qty) !== Number(lb.qty) || Number(la.unitPrice) !== Number(lb.unitPrice)
          return { key, la, lb, changed }
        })
        return (
          <Modal title={`Compare ${a.ref} → ${b.ref}`} onClose={() => setCompareVersions(null)} width={640}>
            <div className="flex flex-col gap-3">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-[var(--text-4)] text-left">
                      <th className="pb-2">Product</th>
                      <th className="pb-2 text-right">{a.ref} Qty</th>
                      <th className="pb-2 text-right">{b.ref} Qty</th>
                      <th className="pb-2 text-right">{a.ref} Price</th>
                      <th className="pb-2 text-right">{b.ref} Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.key} className={`border-t border-[var(--border-lt)] ${r.changed ? 'bg-amber-500/5' : ''}`}>
                        <td className="py-2 pr-2 font-semibold text-[var(--text-1)]">{r.la?.productName ?? r.lb?.productName ?? r.la?.description ?? r.lb?.description ?? '—'}</td>
                        <td className="py-2 text-right">{r.la ? r.la.qty : <span className="text-[var(--text-4)]">—</span>}</td>
                        <td className="py-2 text-right">{r.lb ? r.lb.qty : <span className="text-[var(--text-4)]">—</span>}</td>
                        <td className="py-2 text-right">{r.la ? salesKes(r.la.unitPrice) : <span className="text-[var(--text-4)]">—</span>}</td>
                        <td className="py-2 text-right">{r.lb ? salesKes(r.lb.unitPrice) : <span className="text-[var(--text-4)]">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] text-xs font-bold">
                <span>Total</span>
                <span>{salesKes(a.total)} → {salesKes(b.total)}{a.total !== b.total && (
                  <span className={b.total > a.total ? 'text-emerald-600' : 'text-red-600'}> ({b.total > a.total ? '+' : ''}{salesKes(b.total - a.total)})</span>
                )}</span>
              </div>
              <div className="flex justify-end pt-2 border-t border-[var(--border-lt)]">
                <button className="btn-outline" onClick={() => setCompareVersions(null)}>Close</button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Send by Email — compose dialog. The message is recorded on the order
          and the quotation PDF is attached server-side. */}
      {sendModalOrderId && (() => {
        const order = salesOrderViews.find(s => s.id === sendModalOrderId)
        if (!order) return null
        const isUpdate = order.status === 'quotation_sent' || !!order.sentAt
        return (
          <Modal
            title={isUpdate ? `Send updated ${order.ref}` : `Send ${order.ref} by Email`}
            onClose={() => setSendModalOrderId(null)}
            width={520}
          >
            <div className="flex flex-col gap-4">
              <Field label="Recipient Email *">
                <Input value={sendEmailTo} onChange={setSendEmailTo} placeholder="customer@example.com" />
              </Field>
              <Field label="Cc (optional)">
                <Input
                  value={sendEmailCc}
                  onChange={setSendEmailCc}
                  placeholder="colleague@deed.co.ke, manager@client.com"
                />
              </Field>
              <Field label="Message (optional)">
                <textarea
                  className="form-input text-xs min-h-[90px]"
                  value={sendEmailMessage}
                  onChange={e => setSendEmailMessage(e.target.value)}
                  placeholder={isUpdate
                    ? 'Note for this revised quotation…'
                    : 'Personal note included in the email body…'}
                />
              </Field>
              <p className="text-[10px] text-[var(--text-4)]">
                {isUpdate ? 'Updated quotation' : 'Quotation'} PDF ({order.ref}) is attached automatically for download.
              </p>
              <DocumentEmailSendHistory
                documentId={order.id}
                documentType="quote"
                refreshKey={emailHistoryKey}
                title="Previous sends"
              />
              <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
                <button className="btn-outline text-xs" onClick={() => setSendModalOrderId(null)}>Cancel</button>
                <button
                  className="btn-primary text-xs"
                  disabled={!sendEmailTo.trim() || sendingQuoteId === order.id}
                  onClick={() => emailSalesQuote(order, sendEmailTo.trim(), sendEmailMessage.trim() || undefined, sendEmailCc.trim() || undefined)}
                >
                  {sendingQuoteId === order.id ? 'Sending…' : (isUpdate ? 'Send update' : 'Send')}
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
      {showResetDraftConfirm && activeOrder && (
        <Confirm
          title="Reset to Draft"
          message={`Reset ${activeOrder.ref} to draft so it can be edited? You can send it again after saving your changes.`}
          onConfirm={() => { resetSOToDraft(activeOrder.id); setShowResetDraftConfirm(false) }}
          onCancel={() => setShowResetDraftConfirm(false)}
        />
      )}
      {showConfirmQuoteDialog && activeOrder && isQuotationStage(activeOrder.status) && (
        <ConfirmQuotationDialog
          orderRef={activeOrder.ref}
          customerName={activeOrder.customerName}
          total={activeOrder.total}
          validUntil={activeOrder.validUntil}
          deliveryDate={activeOrder.deliveryDate}
          lineCount={activeOrder.lines.filter((l: any) => l.lineType !== 'section').length}
          shortages={quotationStockShortages}
          canReserve={canReserveOnConfirm}
          canSkipReserve={canSkipReserveOnConfirm && canReserveOnConfirm}
          confirming={confirmingSO}
          onClose={() => setShowConfirmQuoteDialog(false)}
          onConfirm={mode => void runConfirmQuotation(mode)}
        />
      )}

      {showDnModal && activeId && (() => {
        const del = deliveries.find(d => d.saleOrderId === activeId && canGenerateDeliveryNote(d))
        if (!del) return null
        return (
          <Modal title={`Delivery Note — ${del.ref}`} onClose={() => setShowDnModal(false)} width={480}>
            <div className="flex flex-col gap-4">
              <p className="text-xs text-[var(--text-3)]">Fill in recipient details before downloading the Delivery Note PDF.</p>
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
                    showToast('Cannot download Delivery Note — delivered quantity is 0', 'error')
                    return
                  }
                  if (dnRecipientName.trim()) updateDelivery(del.id, { recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim() || undefined, recipientIdNumber: dnRecipientId.trim() || undefined, deliveryAddress: dnAddress.trim() || undefined, notes: dnNotes.trim() || undefined })
                  const generated = await downloadDeliveryNotePdf(
                    del,
                    serials,
                    companySettings,
                    bankAccounts,
                    {
                      recipientName: dnRecipientName.trim(),
                      recipientPhone: dnRecipientPhone.trim(),
                      recipientIdNumber: dnRecipientId.trim(),
                      deliveryAddress: dnAddress.trim(),
                      notes: dnNotes.trim(),
                    },
                    products,
                  )
                  if (generated) {
                    const saved = await markDeliveryNoteGenerated(del.id)
                    if (saved) {
                      showToast(`Delivery Note ${del.ref} generated — invoicing is now available`, 'success')
                      setShowDnModal(false)
                    } else {
                      showToast('Delivery Note could not be saved — check delivered quantities', 'error')
                    }
                  }
                }}><Fa icon={faPrint} /> Download PDF</button>
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
  companySettings, canSave, saveBlockedReason, fieldErrors, onSave, onSaveAndAddAnother, onSaveDraft, onCancel, onCreateNewCustomer,
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
  fieldErrors?: { customer?: string; lines?: string }
  onSave: () => void; onSaveAndAddAnother: () => void; onSaveDraft: () => void; onCancel: () => void
  onCreateNewCustomer: (query: string) => void
}) {
  const [productSearch, setProductSearch] = useState<Record<string, string>>({})
  const [createTab, setCreateTab] = useState('Order Lines')
  // The line table lives inside an overflow container that clips absolutely
  // positioned children — the picker renders position:fixed at the trigger's
  // viewport coordinates instead, so it can never disappear under the table.
  const [productDropdownOpen, setProductDropdownOpen] = useState<{ id: string; top: number; left: number; openUp: boolean } | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const selectedCustomer = customers.find(c => c.id === newCustomer?.id)
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
    <div>
      <div className="sales-proto-page-header">
        <div>
          <button type="button" className="sp-btn sp-btn-ghost" onClick={onCancel} style={{ paddingLeft: 0, marginBottom: 2 }}>← Back</button>
          <h1>Create quotation</h1>
          <div className="sub">Customer · lines · terms · send</div>
        </div>
        <div className="sales-proto-actions">
          <button type="button" className="sp-btn" onClick={onCancel}>Discard</button>
          <button type="button" className="sp-btn" onClick={onSaveDraft} disabled={!canSave}>Save as draft</button>
          <button type="button" className="sp-btn sp-btn-primary" onClick={onSave} disabled={!canSave}>Submit</button>
        </div>
      </div>

      <div className="sp-panel sp-panel-pad">
        <div className="sp-grid-2">
          <div>
            <SalesDocField label="Customer" htmlFor="quote-customer">
              <div className="relative" ref={customerRef}>
                <div
                  id="quote-customer"
                  tabIndex={0}
                  role="button"
                  className={`cursor-pointer flex items-center justify-between ${!newCustomer ? 'text-[var(--sp-text-3)]' : ''}`}
                  style={{ border: '1px solid var(--sp-border-strong)', borderRadius: 4, padding: '5px 8px', fontSize: 12.5, background: '#fff', minHeight: 30, lineHeight: 1.25 }}
                  onClick={() => setCustomerDropdownOpen(v => !v)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCustomerDropdownOpen(v => !v) } }}
                >
                  <span className="truncate">{newCustomer ? newCustomer.name : 'Search customer…'}</span>
                  <Fa icon={faChevronDown} className={`text-[10px] flex-shrink-0 transition-transform ${customerDropdownOpen ? 'rotate-180' : ''}`} />
                </div>
                {customerDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 z-[9300] mt-1 bg-white border border-[var(--sp-border)] rounded-[6px] shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-[var(--sp-border)]">
                      <input autoFocus type="text" aria-label="Search customers by name or email" placeholder="Search by name or email…" className="w-full" style={{ border: '1px solid var(--sp-border-strong)', borderRadius: 4, padding: '6px 8px', fontSize: 12.5 }} value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {filteredCustomers.length === 0 ? (
                        <div className="px-3 py-2">
                          <p className="text-[12px] text-[var(--sp-text-3)] mb-2">No customers found</p>
                          <button className="text-[12px] text-[var(--sp-accent)] font-semibold hover:underline" onClick={() => { setCustomerDropdownOpen(false); onCreateNewCustomer(customerSearch) }}>+ Create new contact</button>
                        </div>
                      ) : (
                        filteredCustomers.map(c => (
                          <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-[var(--sp-accent-soft)] transition-colors" onClick={() => { setNewCustomer({ id: c.id, name: c.name }); setCustomerDropdownOpen(false); setCustomerSearch('') }}>
                            <p className="text-[12.5px] font-semibold text-[var(--sp-text)]">{c.name}</p>
                            <p className="text-[11px] text-[var(--sp-text-3)]">{c.email || c.phone || 'No contact info'}</p>
                          </button>
                        ))
                      )}
                    </div>
                    {filteredCustomers.length > 0 && (
                      <div className="p-2 border-t border-[var(--sp-border)]">
                        <button className="text-[12px] text-[var(--sp-accent)] font-semibold hover:underline" onClick={() => { setCustomerDropdownOpen(false); onCreateNewCustomer(customerSearch) }}>+ Create new contact</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SalesDocField>
            {fieldErrors?.customer && (
              <p role="alert" className="text-[11px] text-[var(--sp-danger)] font-semibold" style={{ marginTop: -4, marginBottom: 8 }}>{fieldErrors.customer}</p>
            )}
            <SalesDocField label="Contact">
              <input readOnly value={selectedCustomer?.name || '—'} />
            </SalesDocField>
            <SalesDocField label="Email">
              <input readOnly value={selectedCustomer?.email || '—'} />
            </SalesDocField>
            <SalesDocField label="Phone">
              <input readOnly value={selectedCustomer?.phone || selectedCustomer?.mobile || '—'} />
            </SalesDocField>
          </div>

          <div>
            <SalesDocField label="Quotation date" htmlFor="quote-date">
              <input id="quote-date" type="date" aria-label="Quotation date" value={new Date().toISOString().slice(0, 10)} readOnly />
            </SalesDocField>
            <SalesDocField label="Valid until" htmlFor="quote-valid-until">
              <input
                id="quote-valid-until"
                type="date"
                aria-label="Valid until"
                value={newDeliveryDate || ''}
                onChange={e => setNewDeliveryDate(e.target.value)}
              />
            </SalesDocField>
            <SalesDocField label="Price list" htmlFor="quote-pricelist">
              <select id="quote-pricelist" aria-label="Pricelist" value={newPricelist || 'RETAIL'} onChange={e => setNewPricelist(e.target.value)} disabled={!pricelistsEnabled}>
                <option value="RETAIL">Public · KES</option>
                <option value="WHOLESALE">Wholesale · KES</option>
                <option value="KILIMALL">Kilimall · KES</option>
              </select>
            </SalesDocField>
            <SalesDocField label="Payment terms" htmlFor="quote-payment-terms">
              <select id="quote-payment-terms" aria-label="Payment terms" value={newPaymentTerms} onChange={e => setNewPaymentTerms(e.target.value)}>
                <option value="0">Immediate</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">Net 30</option>
                <option value="45">45 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </SalesDocField>
            <SalesDocField label="Salesperson" htmlFor="quote-sales-team">
              <input id="quote-sales-team" type="text" aria-label="Salesperson" placeholder="Salesperson" value={newSalesTeam} onChange={e => setNewSalesTeam(e.target.value)} />
            </SalesDocField>
          </div>
        </div>
      </div>

      <div className="sp-panel" style={{ marginTop: 10 }}>
        <SalesDocTabs
          tabs={['Order Lines', 'Optional Products', 'Notes', 'Terms and Conditions', 'Attachments']}
          active={createTab}
          onChange={setCreateTab}
        />

        {createTab === 'Order Lines' && (
          <>
            <div className="sp-table-wrap" id="quote-lines" tabIndex={-1}>
              {fieldErrors?.lines && (
                <p id="quote-lines-error" role="alert" className="px-4 pt-3 text-[10px] text-destructive font-semibold">
                  {fieldErrors.lines}
                </p>
              )}
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th>Unit</th>
                    <th className="num">Unit price</th>
                    <th>Taxes</th>
                    <th className="num">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
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
                        <tr key={line.id}>
                          <td className="num">{lineIndex + 1}</td>
                          <td colSpan={6}>
                            <input
                              aria-label="Quote section title"
                              className="w-full font-bold"
                              placeholder="Section title, e.g. Hardware, Services, Accessories"
                              value={line.description}
                              onChange={e => updateDraftLine(line.id, 'description', e.target.value)}
                            />
                          </td>
                          <td className="num text-[10px] font-bold text-[var(--sp-text-3)]">Section</td>
                          <td>
                            <div className="flex items-center justify-end gap-0.5">
                              {moveButtons}
                              <button type="button" onClick={() => removeDraftLine(line.id)} aria-label="Remove section" className="row-action-btn btn-danger"><Fa icon={faTrash} aria-hidden="true" /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    }
                    return (
                      <tr key={line.id} className={hasInvalidQty ? 'bg-red-50/60' : undefined}>
                        <td className="num">{lineIndex + 1}</td>
                        <td>
                          <div className="flex items-center gap-1 cursor-pointer min-w-[140px]" style={{ border: '1px solid var(--sp-border-strong)', borderRadius: 4, padding: '4px 6px', background: '#fff', fontSize: 12 }}
                            onClick={e => (isOpen ? setProductDropdownOpen(null) : openProductDropdown(line.id, e.currentTarget))}>
                            <span className="flex-1 truncate min-w-0" title={line.productName || undefined}>{line.productName || <span className="text-[var(--sp-text-3)]">Select product…</span>}</span>
                            <Fa icon={faChevronDown} className={`text-[9px] text-[var(--sp-text-3)] flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </div>
                          {isOpen && productDropdownOpen && (
                            <div
                              ref={dropdownRef}
                              className="fixed z-[9500] w-72 bg-white border border-[var(--sp-border)] rounded-[6px] shadow-lg overflow-hidden"
                              style={{
                                left: productDropdownOpen.left,
                                ...(productDropdownOpen.openUp
                                  ? { bottom: window.innerHeight - productDropdownOpen.top }
                                  : { top: productDropdownOpen.top }),
                              }}
                            >
                              <div className="p-2 border-b border-[var(--sp-border)]">
                                <input autoFocus type="text" aria-label="Search products" placeholder="Search products…" className="w-full"
                                  value={productSearch[line.id] ?? ''} onChange={e => setProductSearch(prev => ({ ...prev, [line.id]: e.target.value }))} />
                              </div>
                              <div className="max-h-48 overflow-y-auto">
                                {filteredProds.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-[var(--sp-text-3)]">No products found</p>
                                ) : (
                                  filteredProds.map(p => (
                                    <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-[var(--sp-accent-soft)] transition-colors"
                                      onClick={() => { selectProductForDraftLine(line.id, p); setProductSearch(prev => ({ ...prev, [line.id]: '' })); setProductDropdownOpen(null) }}>
                                      <p className="text-xs font-semibold text-[var(--sp-text)]">{p.name}</p>
                                      <p className="text-[10px] text-[var(--sp-text-3)]">{p.category} · {salesKes(p.salePrice)} · {p.stockQty > 0 ? `${p.stockQty} in stock` : 'out of stock'}</p>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td>
                          <input type="text" aria-label="Line item description" className="w-full" placeholder="Description…" value={line.description} onChange={e => updateDraftLine(line.id, 'description', e.target.value)} />
                        </td>
                        <td className="num">
                          <input type="number" aria-label="Line item quantity" min={1} className="text-center w-16" value={line.qty} onChange={e => updateDraftLine(line.id, 'qty', e.target.value)} />
                          {hasInvalidQty && <p className="text-[9px] text-red-600 font-semibold mt-1">Qty &gt; 0</p>}
                        </td>
                        <td>Unit</td>
                        <td className="num">
                          <input
                            type="number"
                            aria-label="Line item unit price"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className="text-right w-28"
                            value={line.unitPrice}
                            onChange={e => updateDraftLine(line.id, 'unitPrice', e.target.value)}
                            onFocus={e => e.currentTarget.select()}
                          />
                        </td>
                        <td>
                          <select aria-label="Line item tax rate" className="w-20" value={line.taxRate} onChange={e => updateDraftLine(line.id, 'taxRate', e.target.value)}>
                            <option value="0">0%</option>
                            <option value={String(companySettings.vatRate)}>{companySettings.vatRate}%</option>
                          </select>
                        </td>
                        <td className="num font-bold">{salesKes(calcDraftLineTotal(line))}</td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            {moveButtons}
                            <button type="button" onClick={() => removeDraftLine(line.id)} aria-label="Remove line" className="row-action-btn btn-danger"><Fa icon={faTrash} aria-hidden="true" /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {newDraftLines.length === 0 && (
                    <tr><td colSpan={9} className="text-center text-[var(--sp-text-3)]" style={{ padding: '16px 10px', fontSize: 12 }}>No products added yet. Click &quot;Add a line&quot; below.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="sp-line-actions">
              <button type="button" onClick={addDraftLine}>Add a line</button>
              <button type="button" onClick={addDraftSection}>Add a section</button>
              <button type="button" onClick={() => setCreateTab('Notes')}>Add a note</button>
            </div>
            <SalesDocTotals
              sticky
              rows={[
                { label: 'Untaxed amount', value: salesKes(draftSubtotal) },
                { label: 'Taxes', value: salesKes(draftTaxTotal) },
                { label: 'Total', value: salesKes(draftTotal), grand: true },
                { label: 'Currency', value: 'KES' },
              ]}
            />
          </>
        )}

        {createTab === 'Optional Products' && (
          <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
            Optional products (prototype placeholder).
          </div>
        )}

        {createTab === 'Notes' && (
          <div className="sp-panel-pad flex flex-col gap-4">
            <SalesDocField label="Notes" htmlFor="quote-notes">
              <textarea
                id="quote-notes"
                aria-label="Notes and payment terms"
                rows={5}
                placeholder="Payment terms, warranty conditions, special instructions…"
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
              />
            </SalesDocField>
            <PaymentDetailsPicker
              value={newPaymentDetails}
              onChange={setNewPaymentDetails}
            />
          </div>
        )}

        {createTab === 'Terms and Conditions' && (
          <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
            Terms and Conditions content (prototype placeholder — demo data only).
          </div>
        )}

        {createTab === 'Attachments' && (
          <div className="sp-panel-pad" style={{ color: 'var(--sp-text-3)' }}>
            Attachments content (prototype placeholder — demo data only).
          </div>
        )}
      </div>

      {saveBlockedReason && <p className="text-[10px] text-amber-600 font-semibold px-1">{saveBlockedReason}</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERY NOTE VIEW
// ═══════════════════════════════════════════════════════════════════════════
function DeliveryNoteView({
  order, deliveries, focusDeliveryId, serials, products, companySettings, bankAccounts, deliveryQtys, setDeliveryQtys, savingDelivery,
  setSavingDelivery, prepareDelivery, validateDelivery, markDeliveryNoteGenerated, assignSerialsToSOLine, unassignSerialFromSOLine,
  updateDelivery, showToast, onBack,
  dnRecipientName, setDnRecipientName, dnRecipientPhone, setDnRecipientPhone,
  dnRecipientId, setDnRecipientId, dnAddress, setDnAddress, dnNotes, setDnNotes,
}: {
  order: SalesOrderView; deliveries: any[]; focusDeliveryId?: string | null
  serials: any[]; products: any[]
  companySettings: any; bankAccounts: any[]
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
  const orderConfirmed = order.status === 'sale' || saleOrderLooksConfirmed(order)
  // Allow re-prepare on Ready so duplicate-product qty mistakes can be corrected.
  const canPrepare = orderConfirmed && !!existingDelivery && isOpenDeliveryStatus(existingDelivery.status) && ['draft', 'waiting', 'ready'].includes(existingDelivery.status)
  const canValidate = orderConfirmed && !!existingDelivery && existingDelivery.status === 'ready' && !!existingDelivery.preparedAt
  const [serialScan, setSerialScan] = useState('')

  const pickingSummary = useMemo(() => {
    const pairs = pairOrderLinesWithDeliveryLines(order.lines, existingDelivery?.lines ?? [])
    let required = 0
    let picked = 0
    for (const { orderLine: l, deliveryLine: delLine } of pairs) {
      if ((l as any).lineType === 'section') continue
      const demand = Math.max(0, Number(l.qty) || 0)
      required += demand
      const serialCount = Array.isArray(l.serialIds) ? l.serialIds.length : 0
      const typed = Math.max(0, Number(deliveryQtys[l.id]) || 0)
      const effective = effectiveDeliveryLineQty({
        qty: Number(delLine?.qty) || demand,
        qtyDone: delLine?.qtyDone,
        serialIds: delLine?.serialIds?.length ? delLine.serialIds : l.serialIds,
      })
      const linePicked = canPrepare
        ? Math.min(demand, Math.max(typed, serialCount, effective))
        : Math.min(demand, Math.max(Number(l.qtyDelivered) || 0, effective, serialCount))
      picked += linePicked
    }
    const remaining = Math.max(0, required - picked)
    const pct = required > 0 ? Math.round((picked / required) * 100) : 0
    return { required, picked, remaining, pct }
  }, [order.lines, existingDelivery, deliveryQtys, canPrepare])

  const handleSerialScan = (e: FormEvent) => {
    e.preventDefault()
    if (!canPrepare) return
    const value = serialScan.trim().toUpperCase()
    if (!value) return
    const match = serials.find((s: any) => {
      const sn = String(s.serial ?? s.serialNumber ?? '').toUpperCase()
      return sn === value &&
        (s.location === 'warehouse' || s.location === 'shop') &&
        s.status === 'available'
    })
    if (!match) {
      showToast(`Invalid or unavailable serial ${value}`, 'error')
      setSerialScan('')
      return
    }
    const targetLine = order.lines.find(l => {
      if ((l as any).lineType === 'section' || l.productId !== match.productId) return false
      const assigned = Array.isArray(l.serialIds) ? l.serialIds.length : 0
      return assigned < l.qty
    })
    if (!targetLine) {
      showToast(`No open line for serial ${value}`, 'error')
      setSerialScan('')
      return
    }
    const assigned = Array.isArray(targetLine.serialIds) ? targetLine.serialIds : []
    if (assigned.includes(match.id)) {
      showToast(`Duplicate scan ${value}`, 'error')
      setSerialScan('')
      return
    }
    assignSerialsToSOLine(order.id, targetLine.id, [match.id])
    showToast(`Scanned ${value}`, 'success')
    setSerialScan('')
  }

  const selectDelivery = (deliveryId: string) => {
    const target = orderDeliveries.find((d: any) => d.id === deliveryId)
    if (!target || target.status === 'cancelled') return
    setSelectedDeliveryId(deliveryId)
    const init: Record<string, number> = {}
    for (const { orderLine: line, deliveryLine: delLine } of pairOrderLinesWithDeliveryLines(order.lines, target.lines ?? [])) {
      init[line.id] = Math.max(0, Number(line.qty) || Number(delLine?.qty) || 0)
    }
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
      if ((line as any).lineType === 'section' || !line.productId) return
      const typed = Math.max(0, deliveryQtys[line.id] ?? 0)
      const serialCount = Array.isArray(line.serialIds) ? line.serialIds.length : 0
      // Fully-serialized lines always ship their full qty — do not let a stale
      // qty input (from duplicate-product .find bugs) under-reserve them.
      const qty = serialCount >= line.qty
        ? line.qty
        : Math.min(line.qty, typed > 0 ? typed : serialCount)
      quantities[line.productId] = (quantities[line.productId] ?? 0) + qty
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
    const lines = pairOrderLinesWithDeliveryLines(order.lines, existingDelivery.lines).map(({ orderLine: l, deliveryLine: delLine }) => {
      const preparedQty = effectiveDeliveryLineQty({
        qty: Number(delLine?.qty) || Number(l.qty) || 0,
        qtyDone: delLine?.qtyDone,
        serialIds: (delLine?.serialIds?.length ? delLine.serialIds : l.serialIds) ?? [],
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
      if (orderConfirmed) {
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
      // Validate with a summed per-product pool (not Object.fromEntries — that
      // keeps only the last duplicate productId row and breaks ThinkPad 1+2+1).
      const qtysByProduct: Record<string, number> = {}
      for (const line of existingDelivery.lines) {
        const qty = effectiveDeliveryLineQty(line)
        if (!line.productId || qty <= 0) continue
        qtysByProduct[line.productId] = (qtysByProduct[line.productId] ?? 0) + qty
      }
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
    import('@/lib/delivery-note-pdf').then(async ({ downloadDeliveryNotePdf }) => {
      const generated = await downloadDeliveryNotePdf(
        existingDelivery,
        serials,
        companySettings,
        bankAccounts,
        {
          recipientName: dnRecipientName.trim(),
          recipientPhone: dnRecipientPhone.trim(),
          recipientIdNumber: dnRecipientId.trim(),
          deliveryAddress: dnAddress.trim(),
          notes: dnNotes.trim(),
        },
        products,
      )
      if (generated) {
        const saved = await markDeliveryNoteGenerated(existingDelivery.id)
        if (saved) showToast(`Delivery Note ${existingDelivery.ref} generated — invoicing is now available`, 'success')
        else showToast('Delivery Note could not be saved — check delivered quantities', 'error')
      }
    })
  }

  const dnPill = deliveryStatusPill(existingDelivery?.status ?? 'waiting')

  return (
    <div className="flex flex-col gap-3">
      <div className="sales-proto-page-header">
        <div>
          <button type="button" className="sp-btn sp-btn-ghost" style={{ paddingLeft: 0 }} onClick={onBack}>← Back to order</button>
          <div className="sp-ref-row">
            <h1>{existingDelivery?.ref ?? 'Delivery'}</h1>
            <SalesDocPill label={dnPill.label} tone={dnPill.tone} />
          </div>
          <div className="sub">Source {order.ref} · {order.customerName}</div>
        </div>
        <div className="sales-proto-actions">
          {canGenerateDeliveryNote(existingDelivery) && (
            <button type="button" className="sp-btn" onClick={handlePrintDN}>Print</button>
          )}
          {canPrepare && (
            <button type="button" className="sp-btn sp-btn-primary" onClick={handlePrepare} disabled={savingDelivery}>
              {savingDelivery ? 'Saving…' : 'Prepare delivery'}
            </button>
          )}
          {canValidate && (
            <button type="button" className="sp-btn sp-btn-primary" onClick={handleValidate} disabled={savingDelivery}>
              {savingDelivery ? 'Saving…' : 'Mark as delivered'}
            </button>
          )}
        </div>
      </div>

      <div className="sp-panel sp-panel-pad">
        <div className="sp-grid-2">
          <SalesDocField label="Customer"><div className="sp-value">{order.customerName}</div></SalesDocField>
          <SalesDocField label="Scheduled / order date"><div className="sp-value">{fmtDate(order.date)}</div></SalesDocField>
          <SalesDocField label="Source order"><div className="sp-value"><span className="sp-linkish">{order.ref}</span></div></SalesDocField>
          <SalesDocField label="Delivery address"><div className="sp-value">{dnAddress || '—'}</div></SalesDocField>
        </div>
      </div>

      <div className="flex flex-col gap-3">

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
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Products to Deliver</h3>
            {canPrepare && (
              <form onSubmit={handleSerialScan} className="flex items-center gap-2 min-w-[220px] flex-1 max-w-md">
                <label className="sr-only" htmlFor="delivery-serial-scan">Barcode / serial</label>
                <input
                  id="delivery-serial-scan"
                  className="sales-pilot-scan"
                  placeholder="Scan or type serial…"
                  value={serialScan}
                  onChange={e => setSerialScan(e.target.value)}
                  autoComplete="off"
                />
                <button type="submit" className="btn-secondary text-xs shrink-0">Assign</button>
              </form>
            )}
          </div>
          <div className="sp-panel">
            <div className="sp-table-wrap">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Demand</th>
                  <th className="num">{canPrepare ? 'Qty to reserve' : canValidate ? 'Reserved' : 'Delivered'}</th>
                  <th>Serial numbers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-lt)]">
                {pairOrderLinesWithDeliveryLines(order.lines, existingDelivery?.lines ?? []).map(({ orderLine: l, deliveryLine: delLine }) => {
                  const serialIdsForDisplay = (Array.isArray(l.serialIds) && l.serialIds.length
                    ? l.serialIds
                    : (delLine?.serialIds ?? [])) as string[]
                  const lineSerials = serials.filter((s: any) => serialIdsForDisplay.includes(s.id))
                  const product = products.find((item: any) => item.id === l.productId)
                  const serialTracked = Boolean(product?.requiresSerial)
                  const assignableSerials = serialTracked
                    ? serials.filter((serial: any) =>
                        serial.productId === l.productId &&
                        (serial.location === 'warehouse' || serial.location === 'shop') &&
                        serial.status === 'available',
                      )
                    : []
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
                    <tr key={l.id}>
                      <td>{l.productName ?? l.description ?? 'Item'}</td>
                      <td className="num">{l.qty}</td>
                      <td className="num">
                        {canPrepare ? (
                          <input type="number" aria-label={`Delivery quantity for ${l.productName ?? l.description ?? 'line item'}`} min={0} max={l.qty} value={deliveryQtys[l.id] ?? 0}
                            onChange={e => setDeliveryQtys({ ...deliveryQtys, [l.id]: Math.min(l.qty, Math.max(0, Number(e.target.value) || 0)) })}
                            className="w-20 text-center" />
                        ) : canValidate ? (
                          <span className="font-semibold text-blue-700">{preparedQty}</span>
                        ) : (
                          <span className={`font-semibold ${isFullyDelivered ? 'text-emerald-600' : isPartial ? 'text-amber-500' : 'text-[var(--text-4)]'}`}>{delivered}</span>
                        )}
                      </td>
                      <td>
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

        <div className="sp-footer-sticky" aria-label="Picking progress">
          <div>
            Required {pickingSummary.required} · Picked {pickingSummary.picked} · Remaining {pickingSummary.remaining}
            {' — '}<span className="pct">{pickingSummary.pct}%</span>
          </div>
          <div className="sales-proto-actions">
            <button type="button" className="sp-btn" onClick={onBack}>Back</button>
            {canPrepare && (
              <button type="button" className="sp-btn sp-btn-primary" onClick={handlePrepare} disabled={savingDelivery}>
                {savingDelivery ? 'Saving…' : 'Complete picking'}
              </button>
            )}
            {canValidate && (
              <button type="button" className="sp-btn sp-btn-success" onClick={handleValidate} disabled={savingDelivery}>
                {savingDelivery ? 'Saving…' : 'Mark as delivered'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
