'use client'
import JobTrail from '@/components/erp/JobTrail'
import { rememberRecordList } from '@/lib/record-pager'
import { RecordPager } from '@/components/erp/RecordPager'
import { useState, useEffect, useMemo, useRef, Suspense, useCallback, Fragment } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useUrlQueryState, useUrlUiState } from '@/hooks/useUrlRecordId'
import { faClipboardCheck, faCircleCheck, faFileInvoiceDollar, faPlus, faArrowUp, faArrowDown, faDownload, faPrint, faTrash, faCheck, faTruck, faBan, faRotateLeft, faFileAlt, faClockRotateLeft, faThLarge, faListUl, faPencil, faXmark, faSave, faCopy, faCodeBranch } from '@fortawesome/free-solid-svg-icons'
import { downloadDeliveryNotePdf } from '@/lib/delivery-note-pdf'
import { exportToCsv } from '@/lib/export-utils'
import { isSaleOrderDraftEditing } from '@/lib/sale-order-draft-edits'
import { hasModuleAccess } from '@/lib/auth/access'
import { canOverrideCustomerCredit } from '@/lib/customer-credit-gate'
import {
  useSalesStore,
  fmtDate,
  resolveProductAccounts,
} from '@/lib/store'
import { allocateDocNumber } from '@/lib/doc-numbers'
import { Modal, Field, Input, Confirm, SearchPicker, ModuleSkeleton, ModuleHeader, useMounted } from '@/components/ui'
import { Fa } from '@/components/icons'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
import type { CommercialPdfInput } from '@/lib/commercial-pdf'
import {
  DEFAULT_DOCUMENT_PAYMENT_DETAILS,
  alignPaymentDetailsToTax,
  buildPaymentDetailLines,
  documentHasVat,
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
  buildSoWorkflowSteps,
} from '@/components/modules/sales/workbench'
import ContactFormModal, { blankIndividualContact } from '@/components/contacts/ContactFormModal'
import DocumentEmailSendHistory from '@/components/email/DocumentEmailSendHistory'
import { resolveListPrice, BUILTIN_PRICELISTS, pricelistSelectOptions, type PriceListDef } from '@/lib/pricing/pricelist'
import { quoteSalePriceFromCost } from '@/lib/sale-price-calculator'
import {
  quotationPaymentTermsDays,
  serializeQuotationPaymentTerms,
} from '@/lib/sales/quotation-defaults'
import { calcSaleOrderLineMoney } from '@/lib/sales/line-calc'
import { isRepairLinkedSaleOrder } from '@/lib/sales/commission-closer'
import { dedupeRepairSaleOrders } from '@/lib/repair/sale-order-link'
import { SalespersonCloserField } from '@/components/sales/SalespersonCloserField'
import { SaleOrderAgentField } from '@/components/sales/AgentField'
import { allocateDeliveredQtyToOrderLines, pairOrderLinesWithDeliveryLines } from '@/lib/delivery-prepare'
import Chatter from '@/components/erp/Chatter'
import { ConfirmQuotationDialog } from '@/components/modules/sales/ConfirmQuotationDialog'
import { SameDocumentIdentity } from '@/components/modules/sales/SameDocumentIdentity'
import {
  applyConfirmLineSelection,
  canConfirmQuotation,
  canConfirmAndReserve,
  canConfirmWithoutReservation,
  stockShortageLines,
  type ConfirmQuotationMode,
} from '@/lib/sales/confirm-quotation'
import { canApprove, isSalesConfirmGatingApproval } from '@/lib/sales-approvals'
import { finishUxTask, startUxTask, trackUxEvent } from '@/lib/ux-telemetry'
import { SALE_STATUS_LABELS, SO_INVOICE_STATUS_LABELS, SO_FULFILMENT_STATUS_LABELS, INVOICE_POLICY_LABELS, PAYMENT_STATUS_LABELS, isQuotationStage, isQuotationDraft, matchesSalesListFilter, matchesSalesListTab, hasValidatedDeliveryForInvoice, deliveryDeliveredTotal, canGenerateDeliveryNote, reconcileInvoicedQty, saleOrderInvoiceStatus, saleOrderInvoicePrimaryAction, saleOrderFulfilmentStatus, saleOrderIsOperationallyComplete, saleOrderIsAccepted, invoiceableQty, invoicePaymentStatus, isOpenDeliveryStatus, shouldReplaceCancelledDelivery, deliveriesForSaleOrder, saleOrderLooksConfirmed, canReverseConfirmedSale, type SalesListFilter } from '@/lib/odoo-sales-flow'
import { DATE_RANGE_LABELS, DATE_RANGE_PRESETS, isWithinRange, type DateRangePreset } from '@/lib/data-table/date-filter'
import { useUrlDateRange } from '@/hooks/useUrlDateRange'
import { resolveInvoicePolicy } from '@/lib/sales/invoice-policy'
import { isNonStockSaleLine, isDeliveryNoteLine } from '@/lib/sales/non-stock-line'
import { sumUnappliedDownPayments } from '@/lib/sales/down-payment'
import { financeInvoicePath } from '@/lib/finance-invoice'
import { moneyInputValue } from '@/lib/intl-cache'
import { isDirector } from '@/lib/auth/roles'
import { userCan } from '@/lib/auth/can'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
import type { SalesView, SalesOrderView, SalesOrderLineView, DraftLine, OptionalProductDraft } from '@/components/modules/sales/types'
import { uid, salesKes, addDays, normalizeSalesOrderView } from '@/components/modules/sales/helpers'
import { MoreActionsMenu } from '@/components/modules/sales/MoreActionsMenu'
import { MetaDetailsToggle } from '@/components/modules/sales/MetaDetailsToggle'
import { NewQuotationForm } from '@/components/modules/sales/NewQuotationForm'
import { DeliveryNoteView } from '@/components/modules/sales/DeliveryNoteView'

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
    saleOrders, repairs, contacts, products, serials, invoices, deliveries, returnOrders, stockReservations,
    approvalRequests,
    createSaleOrder, updateSaleOrder, confirmSO, ensureWaitingDeliveryForSO, markQuotationSent, setSaleOrderLock,
    addSOLine, removeSOLine, moveSOLine, addSOSection,
    assignSerialsToSOLine, unassignSerialFromSOLine, createInvoiceFromSO, prepareDelivery, validateDelivery, reverseDelivery, markDeliveryNoteGenerated,
    deleteSaleOrder, showToast, getStockByLocation, resetSOToDraft, cancelSO, createNewSOVersion,
    getCustomerCreditStatus, users, currentUserId, systemSettings,
    companySettings, bankAccounts,
    updateDelivery, getDocumentPaymentDetails, setDocumentPaymentDetails,
    issueCreditNoteFromSaleOrder,
    approveRequest,
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
  const isAdmin = isDirector(currentUser?.role)
  const canEditDiscount = isAdmin || !systemSettings.salesDiscountControl
  const canInvoiceFromSO = userCan(currentUser, 'createCustomerInvoiceFromSO')
  // Reversing a confirmed Sales Order (Set to Quotation / Cancel) is
  // Finance / Admin Officer / Director — matches enforceSaleWorkflow / cancelSO.
  const canReverseConfirmedSO = canReverseConfirmedSale(currentUser?.role)
  const canConfirmQuote = canConfirmQuotation(currentUser?.role)
  const canReserveOnConfirm = canConfirmAndReserve(currentUser?.role)
  const canSkipReserveOnConfirm = canConfirmWithoutReservation(currentUser?.role)

  // ── View state ──────────────────────────────────────────────────────────
  const [view, setView] = useState<SalesView>(() => searchParams.get('view') === 'new' ? 'new' : 'list')
  // Phones: a record's secondary details (contact, email, salesperson…) stay
  // folded behind "More details" until asked for.
  const [showAllMeta, setShowAllMeta] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get('id'))
  // Odoo-style menus: Quotations (unconfirmed) vs Orders (confirmed sales).
  // Keep the selected list in the URL so Back/Forward restores the exact queue.
  const [listTabValue, setListTabValue] = useUrlQueryState('tab', 'quotations')
  const listTab: 'quotations' | 'orders' = listTabValue === 'orders' ? 'orders' : 'quotations'
  const [filterValue, setFilterValue] = useUrlUiState('filter', 'all')
  const filter: SalesListFilter = [
    'all', 'my_quotations', 'quotations', 'quotation_sent',
    'sales_orders', 'cancelled', 'to_invoice', 'fully_invoiced',
  ].includes(filterValue)
    ? filterValue as SalesListFilter
    : 'all'
  const [search, setSearchValue] = useUrlUiState('q', '')
  // The period lives in the URL with the search and the status, so a filtered
  // list can be shared and survives a reload.
  const [dateRange, setDateRange] = useUrlDateRange()
  const setFilterAndReset = (v: SalesListFilter) => { setFilterValue(v) }
  const setSearchAndReset = (v: string) => { setSearchValue(v) }
  const setListTabAndReset = (t: 'quotations' | 'orders') => {
    // Tab changes are navigable history; the tab-specific status filter resets
    // atomically so Back restores the previous tab + filter combination.
    setListTabValue(t, { queryPatch: { filter: null } })
  }
  const [listViewModeValue, setListViewModeValue] = useUrlUiState('layout', 'table')
  const listViewMode: 'table' | 'kanban' = listViewModeValue === 'kanban' ? 'kanban' : 'table'
  const setListViewMode = (next: 'table' | 'kanban') => setListViewModeValue(next)

  // ── New Quotation form state ────────────────────────────────────────────
  const [newCustomer, setNewCustomer] = useState<{ id: string; name: string } | null>(null)
  const [newDeliveryDate, setNewDeliveryDate] = useState('')
  const [newValidUntil, setNewValidUntil] = useState('')
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [creditNoteAmount, setCreditNoteAmount] = useState('')
  const [creditNoteReason, setCreditNoteReason] = useState('')
  const [showCreditNoteModal, setShowCreditNoteModal] = useState(false)
  const [, setDraftDirtyTick] = useState(0)
  const [newNotes, setNewNotes] = useState('')
  const [newTermsAndConditions, setNewTermsAndConditions] = useState('')
  const [newOptionalProducts, setNewOptionalProducts] = useState<OptionalProductDraft[]>([])
  const [newQuoteAttachments, setNewQuoteAttachments] = useState<File[]>([])
  const [newCustomerRef, setNewCustomerRef] = useState('')
  /** Set when the quotation is started from a CRM deal; the server links them. */
  const [newOpportunityId, setNewOpportunityId] = useState('')
  const [newInvoiceAddress, setNewInvoiceAddress] = useState('')
  const [newDeliveryAddress, setNewDeliveryAddress] = useState('')
  const [newPaymentDetails, setNewPaymentDetails] = useState<DocumentPaymentDetails>({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
  const [newDraftLines, setNewDraftLines] = useState<DraftLine[]>([])
  const [quoteFieldErrors, setQuoteFieldErrors] = useState<{ customer?: string; validUntil?: string; lines?: string }>({})
  const [newPricelist, setNewPricelist] = useState('')
  const [newSalespersonId, setNewSalespersonId] = useState('')
  const [newSalespersonName, setNewSalespersonName] = useState('')
  const [availablePricelists, setAvailablePricelists] = useState<PriceListDef[]>(BUILTIN_PRICELISTS)
  const draftLoadedRef = useRef(false)
  const draftAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const crmDeepLinkHandledRef = useRef<string | null>(null)
  const savingNewQuoteRef = useRef(false)
  const [savingNewQuote, setSavingNewQuote] = useState(false)
  const quoteDraftKey = currentUserId ? `deed_sales_quote_draft_${currentUserId}` : 'deed_sales_quote_draft'

  useEffect(() => {
    if (view !== 'new') return
    if (newSalespersonId || !currentUser) return
    setNewSalespersonId(currentUser.id)
    setNewSalespersonName(currentUser.name)
  }, [view, newSalespersonId, currentUser])

  // Only fetch when the setting is on — when off, every quotation silently
  // prices from the built-in Retail list, matching the setting's own
  // description ("new quotations always price from the Public list").
  useEffect(() => {
    if (!systemSettings.salesPricelists) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/settings/pricelists')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data.priceLists) && data.priceLists.length) {
          setAvailablePricelists(data.priceLists)
        }
      } catch {
        // Keep built-ins — pricelist selection is a UX nicety, never a blocker.
      }
    })()
    return () => { cancelled = true }
  }, [systemSettings.salesPricelists])

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
  const [showInvoiceWizard, setShowInvoiceWizard] = useState(false)
  const [invoiceWizardMode, setInvoiceWizardMode] = useState<'' | 'regular' | 'down_payment_percent' | 'down_payment_fixed' | 'final'>('')
  const [invoiceWizardPercent, setInvoiceWizardPercent] = useState('')
  const [invoiceWizardAmount, setInvoiceWizardAmount] = useState('')
  const [creatingWizardInvoice, setCreatingWizardInvoice] = useState(false)
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
  const [addLineQty, setAddLineQty] = useState('')
  const [addLineDiscount, setAddLineDiscount] = useState('')
  const [addLineVat, setAddLineVat] = useState(false)
  const [addLineProduct, setAddLineProduct] = useState<(typeof products)[0] | null>(null)
  const [showDnModal, setShowDnModal] = useState(false)
  const [showProformaPreview, setShowProformaPreview] = useState(false)
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
  const allSalesOrderViews = useMemo(
    () => (saleOrders as any[]).map(normalizeSalesOrderView),
    [saleOrders],
  )
  const salesOrderViews = useMemo(
    () => dedupeRepairSaleOrders(allSalesOrderViews, repairs as any[]),
    [allSalesOrderViews, repairs],
  )
  // Keep old deep links auditable even when the duplicate is hidden from lists.
  const activeOrder = allSalesOrderViews.find(s => s.id === activeId) ?? null

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
    const optionalProducts = Array.isArray(so.optionalProducts) ? so.optionalProducts : []
    const merged = {
      title,
      ref: so.ref,
      date: so.date,
      dueLabel: /sales? order/i.test(title) ? 'Delivery date' : 'Valid until',
      dueDate: /sales? order/i.test(title) ? (so.deliveryDate || so.validUntil) : so.validUntil,
      salesperson: so.salespersonName ?? so.createdByName,
      customerName: so.customerName,
      customerAddress: so.invoiceAddress || [contact?.address, contact?.city, contact?.country].filter(Boolean).join(', ') || undefined,
      customerCountry: contact?.country || 'Kenya',
      customerPhone: contact?.phone || contact?.mobile || undefined,
      customerEmail: contact?.email || undefined,
      customerTaxId: contact?.vatNumber || undefined,
      lines: [
        ...so.lines.map(l => {
        // A confirmed/delivered line may already have a serial assigned —
        // show its live specs (e.g. after a reconfiguration) rather than
        // leaving the customer-facing document silent on what's shipping,
        // matching the Delivery Note's Specs column.
        const assignedSerial = l.serialIds?.[0] ? serials.find((s: any) => s.id === l.serialIds![0]) : undefined
        const baseDescription = l.productName ?? l.description ?? 'Item'
        // Quotation/invoice PDFs render a fixed 6-column commercial layout
        // (no room for a dedicated Specs column like the Delivery Note),
        // so the specs line is appended into the description cell instead —
        // still visible to the customer, not silently dropped.
        const description = assignedSerial?.specs
          ? `${baseDescription}\n${assignedSerial.specs}`
          : baseDescription
        return {
          lineType: l.lineType,
          description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate ?? 0,
          discountPct: l.discount ?? l.discountPercent ?? 0,
          subtotal: l.subtotal,
          serial: assignedSerial?.serial,
          specs: assignedSerial?.specs,
        }
        }),
        ...(optionalProducts.length > 0
          ? [
              {
                lineType: 'section' as const,
                description: 'Optional products — not included in quotation total',
                qty: 0,
                unitPrice: 0,
                taxRate: 0,
                discountPct: 0,
                subtotal: 0,
              },
              ...optionalProducts.map(item => ({
                description: item.productName || 'Optional product',
                qty: Number(item.qty) || 0,
                unitPrice: Number(item.unitPrice) || 0,
                taxRate: 0,
                discountPct: 0,
                subtotal: (Number(item.qty) || 0) * (Number(item.unitPrice) || 0),
              })),
            ]
          : []),
      ],
      subtotal: so.subtotal,
      taxTotal: so.taxTotal,
      postTaxDiscountTotal: so.discountAmount,
      total: so.total,
      notes: [so.notes, so.termsAndConditions ? `Terms and conditions\n${so.termsAndConditions}` : ''].filter(Boolean).join('\n\n') || undefined,
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
    // Same commercial document: Quotations = unconfirmed; Orders = confirmed
    // (including cancelled SOs). Never mix SO/… rows into Quotations.
    const tabMatch = matchesSalesListTab({
      status: s.status,
      confirmedAt: s.confirmedAt,
      orderNumber: (s as any).orderNumber,
      ref: s.ref,
    }, listTab)
    const mf = matchesSalesListFilter(
      { status: s.status, createdByUserId: s.createdByUserId, createdById: s.createdById, lines: s.lines },
      filter,
      currentUserId,
    )
    const q = search.toLowerCase()
    const ms = !search
      || s.ref.toLowerCase().includes(q)
      || s.customerName.toLowerCase().includes(q)
      || (s.quotationRef || '').toLowerCase().includes(q)
    return tabMatch && mf && ms && isWithinRange(s.date, dateRange)
  }), [salesOrderViews, listTab, filter, search, currentUserId, dateRange])
  const stats = useMemo(() => ({
    quotations: salesOrderViews.filter(s => s.status === 'quotation').length,
    quotationsSent: salesOrderViews.filter(s => s.status === 'quotation_sent').length,
    orders: salesOrderViews.filter(s => s.status === 'sale').length,
    toInvoice: salesOrderViews.filter(s => {
      const lines = (s.lines ?? []).map((l: any) => {
        const product = products.find(p => p.id === l.productId)
        return {
          qty: Number(l.qty) || 0,
          qtyDelivered: Number(l.qtyDelivered) || 0,
          qtyInvoiced: Number(l.qtyInvoiced) || 0,
          invoicePolicy: resolveInvoicePolicy({
            linePolicy: l.invoicePolicy,
            productPolicy: product?.invoicePolicy,
            productUnit: product?.unit,
            productKind: (product as any)?.productKind,
            productCategory: product?.category,
            trackingMethod: (product as any)?.trackingMethod,
            trackStock: (product as any)?.trackStock,
            productId: l.productId,
            lineType: l.lineType,
            lineUnit: l.unit,
          }),
        }
      })
      return saleOrderInvoiceStatus(s.status, lines) === 'to_invoice'
    }).length,
  }), [salesOrderViews, products])

  // Odoo-style derived statuses for the active order.
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
  const activeLineInvoicePolicy = useCallback((line: { productId?: string; invoicePolicy?: string; lineType?: string; unit?: string }) => {
    const product = products.find(p => p.id === line.productId)
    return resolveInvoicePolicy({
      linePolicy: line.invoicePolicy,
      productPolicy: product?.invoicePolicy,
      productUnit: product?.unit,
      productKind: (product as any)?.productKind,
      productCategory: product?.category,
      trackingMethod: (product as any)?.trackingMethod,
      trackStock: (product as any)?.trackStock,
      productId: line.productId,
      lineType: line.lineType,
      lineUnit: line.unit,
    })
  }, [products])
  const reservedByLineId = useMemo(() => {
    if (!activeOrder) return new Map<string, number>()
    const pool: Record<string, number> = {}
    for (const r of stockReservations ?? []) {
      if (r.referenceId !== activeOrder.id || r.status !== 'reserved') continue
      const remaining = Math.max(0, (Number(r.qty) || 0) - (Number(r.fulfilledQty) || 0))
      if (!r.productId || remaining <= 0) continue
      pool[r.productId] = (pool[r.productId] ?? 0) + remaining
    }
    const allocated = allocateDeliveredQtyToOrderLines(
      (activeOrder.lines ?? []).map((l: any) => ({
        id: l.id,
        productId: l.productId,
        qty: Number(l.qty) || 0,
        qtyDelivered: 0,
        lineType: l.lineType,
      })),
      pool,
      'add',
    )
    return new Map(allocated.map(l => [String((l as any).id), Number((l as any).qtyDelivered) || 0]))
  }, [activeOrder, stockReservations])
  const activeFulfilmentStatus = activeOrder
    ? saleOrderFulfilmentStatus(activeOrder.status, (activeOrder.lines ?? []).map((l: any) => ({
        qty: Number(l.qty) || 0,
        qtyDelivered: Number(l.qtyDelivered) || 0,
        needsDelivery: isDeliveryNoteLine(l),
      })))
    : 'nothing'
  const activeOperationallyComplete = activeOrder
    ? saleOrderIsOperationallyComplete(activeOrder.status, activeOrder.lines.map((l: any) => ({
        qty: Number(l.qty) || 0,
        qtyDelivered: Number(l.qtyDelivered) || 0,
        qtyInvoiced: Number(l.qtyInvoiced) || 0,
        invoicePolicy: activeLineInvoicePolicy(l),
      })))
    : false
  const activeInvoices = useMemo(
    () => activeOrder ? invoices.filter(i => i.saleOrderId === activeOrder.id) : [],
    [invoices, activeOrder],
  )
  /** Non-cancelled invoices already created from this order. */
  const liveInvoices = useMemo(
    () => activeInvoices.filter(i => !['cancelled', 'voided', 'void'].includes(String(i.status))),
    [activeInvoices],
  )
  /**
   * Invoicing progress, ignoring counters that no invoice backs: an attempt
   * that raised qtyInvoiced and then failed used to leave the order "Fully
   * Invoiced" with no invoice, and Create invoice was never offered again.
   */
  const reconciledLines = useMemo(
    () => reconcileInvoicedQty((activeOrder?.lines ?? []) as any[], liveInvoices.length),
    [activeOrder, liveInvoices.length],
  )
  const activeInvoiceStatus = useMemo(() => {
    if (!activeOrder) return 'no' as const
    return saleOrderInvoiceStatus(
      activeOrder.status,
      reconciledLines.map((l: any) => ({
        qty: Number(l.qty) || 0,
        qtyDelivered: Number(l.qtyDelivered) || 0,
        qtyInvoiced: Number(l.qtyInvoiced) || 0,
        invoicePolicy: activeLineInvoicePolicy(l),
      })),
    )
  }, [activeOrder, activeLineInvoicePolicy, reconciledLines])
  /** True when at least one line can be invoiced now (respects ordered vs delivered policy). */
  const canCreateInvoiceNow = useMemo(() => {
    if (!activeOrder || activeOrder.status !== 'sale') return false
    // Deed policy: a Sales Order cannot create a customer invoice before
    // fulfilment is fully delivered. Pro-forma/deposit collection is separate.
    if (saleOrderFulfilmentStatus(activeOrder.status, activeOrder.lines ?? []) !== 'delivered') return false
    return reconciledLines.some((l: any) => {
      if (l.lineType === 'section') return false
      return invoiceableQty({
        qty: Number(l.qty) || 0,
        qtyDelivered: Number(l.qtyDelivered) || 0,
        qtyInvoiced: Number(l.qtyInvoiced) || 0,
        invoicePolicy: activeLineInvoicePolicy(l),
      }) > 0
    })
  }, [activeOrder, activeLineInvoicePolicy, reconciledLines])
  const regularLiveInvoices = useMemo(
    // String(): 'customer_credit' is a legacy/loosely-typed value outside the
    // InvoiceType union; keep excluding it without tripping TS2367.
    () => liveInvoices.filter(i => !i.isDownPayment && String(i.type) !== 'customer_credit' && i.type !== 'vendor_bill'),
    [liveInvoices],
  )
  const regularInvoiceCoverage = useMemo(
    () => regularLiveInvoices.reduce((sum, inv) => sum + Math.max(0, Number(inv.total) || 0), 0),
    [regularLiveInvoices],
  )
  const effectiveActiveInvoiceStatus =
    activeOrder
    && activeInvoiceStatus === 'to_invoice'
    && regularLiveInvoices.length > 0
    && regularInvoiceCoverage + 0.5 >= Math.max(0, Number(activeOrder.total) || 0)
      ? 'invoiced' as const
      : activeInvoiceStatus
  const invoicePrimaryAction = useMemo(
    () => saleOrderInvoicePrimaryAction({
      invoices: liveInvoices,
      orderTotal: Number(activeOrder?.total) || 0,
      canCreateInvoiceNow,
      invoiceStatus: effectiveActiveInvoiceStatus,
    }),
    [liveInvoices, activeOrder?.total, canCreateInvoiceNow, effectiveActiveInvoiceStatus],
  )
  const activePaymentStatus = useMemo(() => {
    if (activeInvoices.length === 0) return 'not_paid' as const
    const statuses = activeInvoices.map(inv => invoicePaymentStatus({
      status: inv.status,
      total: Number(inv.total) || 0,
      amountPaid: Number(inv.amountPaid) || 0,
      payments: (inv.payments ?? []).map((payment: any) => ({
        amount: Number(payment.amount) || 0,
        cleared: payment.cleared,
      })),
      paymentBlocked: inv.paymentBlocked,
    }))
    if (statuses.includes('blocked')) return 'blocked' as const
    if (statuses.includes('partially_paid') || statuses.includes('in_payment')) return 'partially_paid' as const
    if (statuses.every(status => status === 'paid')) return 'paid' as const
    return 'not_paid' as const
  }, [activeInvoices])
  const activeIsRepairBilling = useMemo(
    () => activeOrder ? isRepairLinkedSaleOrder(activeOrder, activeInvoices) : false,
    [activeOrder, activeInvoices],
  )
  const activeReturns = useMemo(
    () => activeOrder ? (returnOrders ?? []).filter((r: any) => r.saleOrderId === activeOrder.id) : [],
    [returnOrders, activeOrder],
  )
  // Smart buttons only appear when the user can open the related records.
  const canSeeReturns = hasModuleAccess(currentUser, 'after_sales')

  // Persist user navigation as real browser history. Canonical redirects still use
  // router.replace elsewhere; opening records, delivery and new forms must PUSH.
  const syncOrderUrl = useCallback((id: string | null, nextView: SalesView = 'form', history: 'push' | 'replace' = 'push') => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('crmTab')
    if (id) {
      params.set('id', id)
      if (nextView === 'delivery') params.set('view', 'delivery')
      else params.delete('view')
    } else {
      params.delete('id')
      if (nextView === 'new') params.set('view', 'new')
      else params.delete('view')
    }
    const qs = params.toString()
    router[history](qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, router, pathname])

  useEffect(() => {
    const urlId = searchParams.get('id')
    const urlView = searchParams.get('view')
    if (!urlId) {
      setActiveId(null)
      setEditingLineId(null)
      // New quotation is also a navigable workspace state.
      setView(urlView === 'new' ? 'new' : 'list')
      return
    }
    const order = saleOrders.find(s => s.id === urlId)
    if (!order) return // wait until store hydrates
    setActiveId(urlId)
    setView(urlView === 'delivery' ? 'delivery' : 'form')
    // Preserve the list tab carried by the URL. For a direct record deep-link
    // without a tab, canonicalize the current entry rather than adding history.
    if (!searchParams.get('tab')) {
      if (isQuotationStage(order.status)) setListTabValue('quotations', { history: 'replace' })
      else if (order.status === 'sale') setListTabValue('orders', { history: 'replace' })
    }
  }, [searchParams, saleOrders]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally omit view

  // ── Navigation ──────────────────────────────────────────────────────────
  const openOrder = (id: string, history: 'push' | 'replace' = 'push') => {
    setActiveId(id)
    setView('form')
    setEditingLineId(null)
    syncOrderUrl(id, 'form', history)
  }
  /** From the list: remember its order for the record pager (‹ ›). */
  const openFromList = (id: string) => {
    rememberRecordList(filtered.map(s => s.id))
    openOrder(id)
  }
  const backToList = () => {
    setView('list')
    setActiveId(null)
    setEditingLineId(null)
    syncOrderUrl(null)
  }
  const openNewForm = () => {
    setNewCustomer(null); setNewDeliveryDate(''); setNewValidUntil('')
    setNewNotes(''); setNewCustomerRef(''); setNewOpportunityId('')
    setNewInvoiceAddress(''); setNewDeliveryAddress('')
    setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
    setNewPricelist('')
    setNewSalespersonId(currentUser?.id || '')
    setNewSalespersonName(currentUser?.name || '')
    setNewDraftLines([]); setView('new')
    syncOrderUrl(null, 'new')
    startUxTask('sales_quote_create', { module: 'sales' })
  }

  // CRM lead convert / opportunity "Create quotation" deep-link:
  // /sales?new=1&customerId=<uuid>&customerName=...
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    const customerId = searchParams.get('customerId') || ''
    const customerName = searchParams.get('customerName') || ''
    const opportunityId = searchParams.get('opportunityId') || ''
    const deepLinkKey = `${customerId}|${opportunityId}|${customerName}`
    if (crmDeepLinkHandledRef.current === deepLinkKey) return
    crmDeepLinkHandledRef.current = deepLinkKey

    const fromContacts = customerId
      ? contacts.find(c => c.id === customerId)
      : undefined
    setNewCustomer(
      customerId
        ? { id: customerId, name: fromContacts?.name || customerName || 'Customer' }
        : null,
    )
    setNewDeliveryDate('')
    setNewValidUntil('')
    // The deal travels as a real link now. It used to be written into the
    // notes and the customer's PO number field, which then printed on the
    // quotation and the invoice.
    setNewNotes('')
    setNewCustomerRef('')
    setNewOpportunityId(opportunityId)
    setNewInvoiceAddress('')
    setNewDeliveryAddress('')
    setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
    setNewPricelist('')
    setNewDraftLines([])
    setActiveId(null)
    setView('new')
    startUxTask('sales_quote_create', { module: 'sales', source: 'crm_convert' })

    const params = new URLSearchParams(searchParams.toString())
    params.delete('new')
    params.delete('customerId')
    params.delete('customerName')
    params.delete('opportunityId')
    params.delete('id')
    params.set('view', 'new')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, contacts, pathname, router]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportFilteredOrdersCsv = () => {
    const rows = filtered.map(s => [
      s.ref,
      s.customerName,
      s.date,
      s.validUntil || '',
      s.status,
      s.salespersonName || '',
      s.total,
    ])
    exportToCsv(
      ['Reference', 'Customer', 'Date', 'Valid until', 'Status', 'Salesperson', 'Total'],
      rows,
      `sales_${listTab}_${new Date().toISOString().slice(0, 10)}`,
    )
  }

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const bulkCancelSelected = () => {
    if (selectedOrderIds.length === 0) return
    let n = 0
    for (const id of selectedOrderIds) {
      const so = saleOrders.find(s => s.id === id)
      if (!so || so.status === 'sale') continue
      cancelSO(id)
      n += 1
    }
    setSelectedOrderIds([])
    if (n > 0) showToast(`Cancelled ${n} quotation${n === 1 ? '' : 's'}`, 'success')
    else showToast('No cancellable quotations selected (confirmed orders need Finance)', 'info')
  }
  /** Clone an existing quotation/sale order's customer + lines into a new draft quotation. */
  const duplicateSaleOrder = (so: SalesOrderView) => {
    setNewCustomer(so.customerId ? { id: so.customerId, name: so.customerName } : null)
    setNewDeliveryDate('')
    setNewValidUntil('')
    setNewNotes(so.notes ?? '')
    setNewCustomerRef(so.customerRef ?? '')
    setNewInvoiceAddress(so.invoiceAddress ?? '')
    setNewDeliveryAddress(so.deliveryAddress ?? '')
    setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
    setNewPricelist(so.pricelist || 'RETAIL')
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
    syncOrderUrl(null, 'new')
    startUxTask('sales_quote_create', { module: 'sales' })
    showToast(`Duplicated ${so.ref} as a new draft quotation`, 'success')
  }

  const handleCreateNewVersion = async (so: SalesOrderView) => {
    setCreatingNewVersion(true)
    try {
      const historyRes = await fetch(`/api/sale-orders/${so.id}/versions`, { cache: 'no-store' })
      const history = await historyRes.json().catch(() => null)
      const rows = Array.isArray(history?.versions) ? history.versions : []
      const latest = rows.find((row: any) => row.isLatest)
      if (latest && latest.id !== so.id) {
        showToast(`Revision ${so.versionNumber ?? 1} is read-only. Open Revision ${latest.versionNumber} to revise the quotation.`, 'error')
        return
      }
      if (rows.some((row: any) => row.status === 'sale')) {
        showToast('This quotation has already become a Sales Order. Use a controlled Sales Order amendment instead.', 'error')
        return
      }
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

  /** Invoiceable lines for the partial-invoice picker: id, label, and max qty capped by policy/invoiced progress. */
  const invoiceableLinesFor = (so: SalesOrderView) =>
    (so.lines ?? [])
      .filter((l: any) => l.lineType !== 'section')
      .map((l: any) => ({
        id: String(l.id),
        label: l.productName || l.description || 'Item',
        maxQty: invoiceableQty({
          qty: Number(l.qty) || 0,
          qtyDelivered: Number(l.qtyDelivered) || 0,
          qtyInvoiced: Number(l.qtyInvoiced) || 0,
          invoicePolicy: activeLineInvoicePolicy(l),
        }),
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
    // Confirmed SO with no open DN (never created, or the only DN was cancelled)
    // — mint a waiting picking instead of reopening a cancelled record.
    let ensured = open[0] ?? (shouldReplaceCancelledDelivery({
      soStatus: activeOrder.status,
      deliveries: activeDeliveries,
    }) ? undefined : visibleDeliveries[0])
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
    const contact = contacts.find(c => c.id === activeOrder.customerId)
    setDnRecipientName(target?.recipientName || activeOrder.customerName || contact?.name || '')
    setDnRecipientPhone(target?.recipientPhone || contact?.phone || contact?.mobile || '')
    setDnRecipientId(target?.recipientIdNumber || contact?.idNumber || '')
    setDnAddress(
      target?.deliveryAddress
      || activeOrder.deliveryAddress
      || [contact?.address, contact?.city].filter(Boolean).join(', ')
      || '',
    )
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

  const runConfirmQuotation = async (mode: ConfirmQuotationMode, qtyByLineId: Record<string, number>) => {
    if (!activeOrder) return
    if (confirmingSO) return
    setConfirmingSO(true)
    try {
      // reserveStock drives server-side At Confirmation reservation.
      // Prepare (pick) only when Confirm and Reserve — Manual mode leaves
      // warehouse to prepare later.
      await Promise.resolve(confirmSO(activeOrder.id, {
        reserveStock: mode === 'reserve',
        qtyByLineId,
      }))
      if (mode === 'reserve' && canReserveOnConfirm) {
        const del = await ensureWaitingDeliveryForSO(activeOrder.id)
        if (del) {
          const kept = applyConfirmLineSelection(activeOrder.lines as any, qtyByLineId).lines
          const qtys: Record<string, number> = {}
          for (const line of kept) {
            if ((line as any).lineType === 'section' || !line.productId) continue
            if (isNonStockSaleLine(line, products.find(p => p.id === line.productId) ?? null)) continue
            qtys[line.productId] = (qtys[line.productId] ?? 0) + (Number(line.qty) || 0)
          }
          prepareDelivery(del.id, qtys)
        }
      }
      setShowConfirmQuoteDialog(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not confirm this quotation — try again', 'error')
    } finally {
      setConfirmingSO(false)
    }
  }

  const quotationStockShortages = useMemo(() => {
    if (!activeOrder || !isQuotationStage(activeOrder.status)) return []
    return stockShortageLines(activeOrder.lines as any, productId => {
      const byLoc = getStockByLocation(productId)
      return (byLoc.warehouse ?? 0) + (byLoc.shop ?? 0)
    }, line => isNonStockSaleLine(line, products.find(p => p.id === line.productId) ?? null))
  }, [activeOrder, getStockByLocation, products])

  // ── Draft line helpers ──────────────────────────────────────────────────
  const addDraftLine = () => setNewDraftLines(p => [...p, { type: 'item', id: uid(), productId: '', productName: '', description: '', qty: '', unitPrice: '', discount: '', taxRate: '' }])
  // The pricelist picker is only rendered when pricelists are enabled and more than one is
  // active; otherwise the single active list applies (not a user choice).
  const pricelistSelectorVisible = !!systemSettings.salesPricelists && availablePricelists.filter(l => l.isActive).length > 1
  const effectiveNewPricelist = newPricelist || (pricelistSelectorVisible ? '' : (pricelistSelectOptions(availablePricelists)[0]?.value ?? 'RETAIL'))
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
    const priced = resolveListPrice({ product, pricelist: effectiveNewPricelist, qty, priceLists: availablePricelists })
    // Unit price on the quote = catalog sales price (via active pricelist). Keep 0 when
    // the catalog price is 0 so the field stays editable instead of looking blank/broken.
    const unitPrice = Number.isFinite(priced.unitPrice) ? Math.max(0, priced.unitPrice) : Math.max(0, Number(product.salePrice) || 0)
    setNewDraftLines(p => p.map(l => l.id === lineId ? {
      ...l, type: 'item', productId: product.id, productName: product.name, description: product.name,
      unitPrice: String(unitPrice), taxRate: String(product.taxRate ?? 0),
    } : l))
  }
  // Single source of truth for line/tax math — shared with the server's
  // authoritative recompute in lib/sales/line-calc.ts so the quotation-draft
  // preview can never silently drift from what actually gets persisted.
  const draftLineMoney = (l: DraftLine) => calcSaleOrderLineMoney({ ...l, lineType: l.type })
  const calcDraftLineTotal = (l: DraftLine) => draftLineMoney(l).lineTotal
  const draftSubtotal = newDraftLines.reduce((a, l) => a + draftLineMoney(l).lineTotal, 0)
  const draftTaxTotal = newDraftLines.reduce((a, l) => a + draftLineMoney(l).lineTax, 0)
  const draftTotal = draftSubtotal + draftTaxTotal
  const validDraftLines = newDraftLines.filter(l => l.type !== 'section' && l.productId && Number(l.qty) > 0)
  const invalidQtyDraftLines = newDraftLines.filter(l => l.type !== 'section' && l.productId && Number(l.qty) <= 0)
  const isBlankOrNotNumber = (v: string) => v.trim() === '' || !Number.isFinite(Number(v))
  const missingPriceDraftLines = newDraftLines.filter(l => l.type !== 'section' && l.productId && isBlankOrNotNumber(l.unitPrice))
  const missingTaxDraftLines = newDraftLines.filter(l => l.type !== 'section' && l.productId && isBlankOrNotNumber(l.taxRate))
  const invalidOptionalProducts = newOptionalProducts.filter(item => item.qty === '' || !(Number(item.qty) > 0))
  // Mirrors the authoritative checks in saveNewQuotation so the Save button reflects
  // real validation state instead of always being enabled.
  const quoteSaveBlockedReason = savingNewQuote
    ? 'Saving quotation…'
    : !newCustomer
    ? 'Select a customer before saving'
    : !newValidUntil
      ? 'Set a valid-until date before saving'
      : pricelistSelectorVisible && !newPricelist
      ? 'Select a pricelist before saving'
      : missingPriceDraftLines.length > 0
      ? 'Enter a unit price for every quoted product'
      : missingTaxDraftLines.length > 0
      ? 'Select a tax rate for every quoted product'
      : invalidOptionalProducts.length > 0
      ? 'Enter a quantity greater than zero for every optional product'
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
        validUntil?: string
        notes: string
        customerRef?: string
        invoiceAddress?: string
        deliveryAddress?: string
        paymentDetails?: Partial<DocumentPaymentDetails>
        termsAndConditions?: string
        optionalProducts?: OptionalProductDraft[]
        lines: DraftLine[]
      }
      if (parsed.customer) setNewCustomer(parsed.customer)
      if (parsed.deliveryDate) setNewDeliveryDate(parsed.deliveryDate)
      if (parsed.validUntil) setNewValidUntil(parsed.validUntil)
      if (parsed.notes) setNewNotes(parsed.notes)
      if (parsed.customerRef) setNewCustomerRef(parsed.customerRef)
      if (parsed.invoiceAddress) setNewInvoiceAddress(parsed.invoiceAddress)
      if (parsed.deliveryAddress) setNewDeliveryAddress(parsed.deliveryAddress)
      if (parsed.paymentDetails) setNewPaymentDetails(normalizeDocumentPaymentDetails(parsed.paymentDetails))
      if (parsed.termsAndConditions) setNewTermsAndConditions(parsed.termsAndConditions)
      if (Array.isArray(parsed.optionalProducts)) setNewOptionalProducts(parsed.optionalProducts)
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

  useEffect(() => {
    if (view !== 'new') return
    if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current)
    draftAutosaveTimerRef.current = setTimeout(() => {
      const payload = {
        customer: newCustomer,
        deliveryDate: newDeliveryDate,
        validUntil: newValidUntil,
        notes: newNotes,
        customerRef: newCustomerRef,
        invoiceAddress: newInvoiceAddress,
        deliveryAddress: newDeliveryAddress,
        paymentDetails: newPaymentDetails,
        termsAndConditions: newTermsAndConditions,
        optionalProducts: newOptionalProducts,
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
  }, [view, quoteDraftKey, newCustomer, newDeliveryDate, newValidUntil, newNotes, newCustomerRef, newInvoiceAddress, newDeliveryAddress, newPaymentDetails, newTermsAndConditions, newOptionalProducts, newDraftLines])

  // Align quote payment bank: VAT → NCBA; non-VAT → ABSA / I&M
  useEffect(() => {
    if (view !== 'new') return
    const isVat = newDraftLines.some(l => Number(l.taxRate) > 0) || draftTaxTotal > 0
    setNewPaymentDetails(prev => {
      const next = alignPaymentDetailsToTax(prev, isVat, bankAccounts)
      const cur = normalizeDocumentPaymentDetails(prev)
      if (
        cur.useCompanyDefault === next.useCompanyDefault
        && cur.includeMpesa === next.includeMpesa
        && (cur.customNote || '') === (next.customNote || '')
        && cur.bankAccountIds.join() === next.bankAccountIds.join()
      ) return prev
      return next
    })
  }, [view, newDraftLines, draftTaxTotal, bankAccounts])

  // ── Save new quotation ──────────────────────────────────────────────────
  const saveNewQuotation = async (after: 'open' | 'another' | 'list' = 'open') => {
    if (savingNewQuoteRef.current) return
    const errors: { customer?: string; validUntil?: string; lines?: string } = {}
    if (!newCustomer) errors.customer = 'Please select a customer'
    if (!newValidUntil) errors.validUntil = 'Please set when this quotation expires'
    if (pricelistSelectorVisible && !newPricelist) {
      showToast('Please select a pricelist', 'error')
      document.getElementById('quote-pricelist')?.focus()
      return
    }
    if (invalidOptionalProducts.length > 0) {
      showToast(`Enter a quantity for optional product(s): ${invalidOptionalProducts.map(item => item.productName).join(', ')}`, 'error')
      return
    }
    if (invalidQtyDraftLines.length > 0) {
      errors.lines = 'Quantity must be greater than zero for every quoted product'
    } else if (missingPriceDraftLines.length > 0) {
      errors.lines = 'Enter a unit price for every quoted product'
    } else if (missingTaxDraftLines.length > 0) {
      errors.lines = 'Select a tax rate for every quoted product'
    } else if (validDraftLines.length === 0) {
      errors.lines = 'Add at least one product with quantity greater than zero'
    }
    if (errors.customer || errors.validUntil || errors.lines) {
      setQuoteFieldErrors(errors)
      showToast('Please fix the highlighted fields', 'error')
      requestAnimationFrame(() => {
        const id = errors.customer ? 'quote-customer' : errors.validUntil ? 'quote-valid-until' : 'quote-lines'
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
    const selectedCustomer = contacts.find(contact => contact.id === newCustomer.id)
    const paymentTermsDays = quotationPaymentTermsDays(selectedCustomer)
    const draftTotalEstimate = newDraftLines.reduce((sum, l) => sum + calcDraftLineTotal(l), 0)
    const creditStatus = getCustomerCreditStatus(newCustomer.id, draftTotalEstimate, { document: 'quote' })
    // Director / Finance may go ahead over the credit limit (they are told).
    if (!creditStatus.ok && !canOverrideCustomerCredit(currentUser?.role)) { showToast(creditStatus.message, 'error'); return }
    if (!creditStatus.ok) showToast(`Overriding: ${creditStatus.message}`, 'info')
    else if (creditStatus.isLocked && creditStatus.message) {
      showToast(creditStatus.message, 'info')
    }
    savingNewQuoteRef.current = true
    setSavingNewQuote(true)
    try {
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
        pricelist: effectiveNewPricelist,
        qty,
        customPrice: Number.isFinite(typedPrice) ? typedPrice : undefined,
        priceLists: availablePricelists,
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
      paymentTerms: serializeQuotationPaymentTerms(paymentTermsDays),
      pricelist: effectiveNewPricelist,
      validUntil: newValidUntil,
      salespersonId: newSalespersonId || currentUser?.id,
      salespersonName: newSalespersonName || currentUser?.name,
      ...(newNotes ? { notes: newNotes } : {}),
      ...(newTermsAndConditions ? { termsAndConditions: newTermsAndConditions.trim() } : {}),
      ...(newOptionalProducts.length ? { optionalProducts: newOptionalProducts.map(item => ({ ...item, qty: Number(item.qty) })) } : {}),
      ...(newCustomerRef ? { customerRef: newCustomerRef } : {}),
      ...(newOpportunityId ? { opportunityId: newOpportunityId } : {}),
      ...(newInvoiceAddress ? { invoiceAddress: newInvoiceAddress } : {}),
      ...(newDeliveryAddress ? { deliveryAddress: newDeliveryAddress } : {}),
    })
    setDocumentPaymentDetails(so.id, newPaymentDetails)
    if (newQuoteAttachments.length > 0) {
      const failed: string[] = []
      for (const file of newQuoteAttachments) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          const response = await fetch(`/api/sale-order-attachments/${so.id}`, { method: 'POST', body: formData })
          if (!response.ok) failed.push(file.name)
        } catch {
          failed.push(file.name)
        }
      }
      if (failed.length) showToast(`Quotation saved, but ${failed.length} attachment${failed.length === 1 ? '' : 's'} could not be uploaded.`, 'error')
    }
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
    setNewValidUntil('')
    setNewNotes('')
    setNewTermsAndConditions('')
    setNewOptionalProducts([])
    setNewQuoteAttachments([])
    setNewCustomerRef('')
    setNewOpportunityId('')
    setNewInvoiceAddress('')
    setNewDeliveryAddress('')
    setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
    setNewDraftLines([])
    showToast('Quotation saved. Continue with another entry.', 'success')
    startUxTask('sales_quote_create', { module: 'sales', chained: true })
    } catch {
      // createSaleOrder already toasted the failure
    } finally {
      savingNewQuoteRef.current = false
      setSavingNewQuote(false)
    }
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
  const saveEditLine = async (lineId: string) => {
    if (!activeOrder) return
    // Prefer live store lines — a stale view snapshot can reintroduce deletes.
    const latest = saleOrders.find(s => s.id === activeOrder.id) ?? activeOrder
    const qty = Math.max(0, Number(editLineQty) || 0)
    const unitPrice = Math.max(0, Number(editLinePrice) || 0)
    const discount = Math.max(0, Math.min(100, Number(editLineDiscount) || 0))
    const taxRate = Math.max(0, Number(editLineTax) || 0)
    const subtotal = Math.round(qty * unitPrice * (1 - discount / 100))
    const updatedLines = latest.lines.map(l => l.id !== lineId ? l : {
      ...l, productName: editLineDesc || l.productName, description: editLineDesc || l.description,
      qty, unitPrice, discount, discountPercent: discount, taxRate, subtotal,
    })
    const sub = updatedLines.reduce((a, l) => a + (Number(l.subtotal) || 0), 0)
    const tax = updatedLines.reduce((a, l) => a + Math.round((Number(l.subtotal) || 0) * (Number(l.taxRate) || 0) / 100), 0)
    setEditingLineId(null)
    const ok = await updateSaleOrder(
      activeOrder.id,
      { lines: updatedLines, subtotal: sub, taxTotal: tax, total: sub + tax },
      { persist: true },
    )
    if (ok !== false) showToast('Line saved', 'success')
  }

  // ── Add line handler ────────────────────────────────────────────────────
  const handleAddLine = () => {
    if (!activeId) return
    const missing: string[] = []
    if (!addLineProduct) missing.push('Product')
    if (addLineQty.trim() === '') missing.push('Quantity')
    if (canEditDiscount && addLineDiscount.trim() === '') missing.push('Discount %')
    if (missing.length) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    if (!addLineProduct) return
    const qty = Number(addLineQty)
    if (!Number.isFinite(qty) || qty <= 0) { showToast('Quantity must be greater than zero', 'error'); return }
    const disc = canEditDiscount ? Number(addLineDiscount) : 0
    if (!Number.isFinite(disc) || disc < 0 || disc > 100) { showToast('Discount % must be between 0 and 100', 'error'); return }
    addSOLine(activeId, addLineProduct, qty, disc, addLineVat ? companySettings.vatRate : 0)
    setShowAddLine(false); setAddLineProduct(null); setAddLineQty(''); setAddLineDiscount(''); setAddLineVat(false)
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

  // Proforma invoices run their own PFI/YYYY/NNNN sequence. The number is
  // assigned the first time a pro-forma is issued for the order and kept on
  // the record, so reprints reuse the same number.
  const downloadProformaInvoice = async (so: SalesOrderView) => {
    let piRef = so.proformaRef
    if (!piRef) {
      // From the server: the browser's own count repeated across browsers.
      const issued = await allocateDocNumber('proforma').catch(() => null)
      if (!issued) { showToast('Could not get a pro-forma number from the server — try again', 'error'); return }
      piRef = issued
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
        <div className="sales-workbench" data-sales-view={view}>
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
                  newValidUntil={newValidUntil}
                  setNewValidUntil={(value) => {
                    setNewValidUntil(value)
                    if (value) setQuoteFieldErrors(prev => ({ ...prev, validUntil: undefined }))
                  }}
                  newNotes={newNotes}
                  setNewNotes={setNewNotes}
                  newTermsAndConditions={newTermsAndConditions}
                  setNewTermsAndConditions={setNewTermsAndConditions}
                  newOptionalProducts={newOptionalProducts}
                  setNewOptionalProducts={setNewOptionalProducts}
                  newQuoteAttachments={newQuoteAttachments}
                  setNewQuoteAttachments={setNewQuoteAttachments}
                  newCustomerRef={newCustomerRef}
                  setNewCustomerRef={setNewCustomerRef}
                  newInvoiceAddress={newInvoiceAddress}
                  setNewInvoiceAddress={setNewInvoiceAddress}
                  newDeliveryAddress={newDeliveryAddress}
                  setNewDeliveryAddress={setNewDeliveryAddress}
                  newPaymentDetails={newPaymentDetails}
                  setNewPaymentDetails={setNewPaymentDetails}
                  newPricelist={newPricelist}
                  setNewPricelist={setNewPricelist}
                  availablePricelists={availablePricelists}
                  salesPricelistsEnabled={!!systemSettings.salesPricelists}
                  newSalespersonId={newSalespersonId}
                  newSalespersonName={newSalespersonName}
                  setNewSalesperson={(id, name) => { setNewSalespersonId(id); setNewSalespersonName(name) }}
                  createdByName={currentUser?.name}
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
                  bankAccounts={bankAccounts}
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
                    // Discard means discard — otherwise the abandoned draft
                    // silently reappears the next time "New quotation" opens.
                    try {
                      localStorage.removeItem(quoteDraftKey)
                    } catch {
                      // ignore storage errors
                    }
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
                  contacts={contacts}
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
                  reverseDelivery={reverseDelivery}
                  markDeliveryNoteGenerated={markDeliveryNoteGenerated}
                  assignSerialsToSOLine={assignSerialsToSOLine}
                  unassignSerialFromSOLine={unassignSerialFromSOLine}
                  updateDelivery={updateDelivery}
                  showToast={showToast}
                  onBack={() => { setFocusDeliveryId(null); setView('form'); if (activeOrder) syncOrderUrl(activeOrder.id, 'form') }}
                  ensureWaitingDeliveryForSO={ensureWaitingDeliveryForSO}
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
                  <div className="sales-proto-page-header sales-list-page-header">
                    <div className="sales-proto-header-copy">
                      <span className="sales-proto-header-icon" aria-hidden="true" />
                      <div>
                        <div className="sales-page-eyebrow">Sales / Customer documents</div>
                        <h1>{listTab === 'quotations' ? 'Quotations' : 'Sales orders'}</h1>
                        <div className="sales-proto-count">{filtered.length} record{filtered.length === 1 ? '' : 's'}</div>
                        <div className="sub">
                          {listTab === 'quotations'
                            ? 'Draft → Sent → Accepted → Confirm becomes SO/…'
                            : 'Reserve → Deliver → Invoice · Payment stays separate'}
                        </div>
                      </div>
                    </div>
                    <div className="sales-proto-actions">
                      <button type="button" className="sp-btn sp-btn-primary" onClick={openNewForm}>
                        <span className="sales-new-quote-label">New quotation</span>
                      </button>
                    </div>
                  </div>
                  <SalesDocTabs
                    className="sp-tabs-command"
                    tabs={['Quotations', 'Sales orders']}
                    active={listTab === 'quotations' ? 'Quotations' : 'Sales orders'}
                    onChange={tab => {
                      if (tab === 'Quotations') setListTabAndReset('quotations')
                      else setListTabAndReset('orders')
                    }}
                    ariaLabel="Sales sections"
                  />
                  <div className="sp-panel">
                  <div className="sp-list-toolbar">
                    <input
                      type="search"
                      className="sp-list-search"
                      aria-label="Search quotations and orders"
                      placeholder="Search"
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
                    <select
                      aria-label="Filter by date"
                      value={dateRange.preset}
                      onChange={e => setDateRange(
                        e.target.value === 'custom'
                          ? { ...dateRange, preset: 'custom' }
                          : { preset: e.target.value as DateRangePreset },
                      )}
                    >
                      {DATE_RANGE_PRESETS.map(preset => (
                        <option key={preset} value={preset}>
                          {preset === 'all' ? 'Any date' : DATE_RANGE_LABELS[preset]}
                        </option>
                      ))}
                    </select>
                    {dateRange.preset === 'custom' && (
                      <>
                        <input
                          type="date"
                          aria-label="From date"
                          value={dateRange.from ?? ''}
                          max={dateRange.to || undefined}
                          onChange={e => setDateRange({ ...dateRange, preset: 'custom', from: e.target.value })}
                        />
                        <input
                          type="date"
                          aria-label="To date"
                          value={dateRange.to ?? ''}
                          min={dateRange.from || undefined}
                          onChange={e => setDateRange({ ...dateRange, preset: 'custom', to: e.target.value })}
                        />
                      </>
                    )}
                    <MoreActionsMenu
                      items={[
                        { label: 'Export CSV', icon: faDownload, onClick: exportFilteredOrdersCsv },
                        ...(selectedOrderIds.length > 0 && listTab === 'quotations'
                          ? [{ label: `Cancel selected (${selectedOrderIds.length})`, icon: faBan, onClick: bulkCancelSelected }]
                          : []),
                        { label: 'Table view', icon: faListUl, onClick: () => setListViewMode('table') },
                        { label: 'Kanban view', icon: faThLarge, onClick: () => setListViewMode('kanban') },
                      ]}
                    />
                  </div>
                  {listViewMode === 'table' && (
                    <div className="sp-table-wrap">
                      <table className="sp-table sp-list-table" data-no-responsive>
                        <thead>
                          <tr>
                            {listTab === 'quotations' && (
                              <th data-col="select" style={{ width: 36 }}>
                                <input
                                  type="checkbox"
                                  aria-label="Select all quotations"
                                  checked={filtered.length > 0 && filtered.every(s => selectedOrderIds.includes(s.id))}
                                  onChange={e => {
                                    if (e.target.checked) setSelectedOrderIds(filtered.map(s => s.id))
                                    else setSelectedOrderIds([])
                                  }}
                                />
                              </th>
                            )}
                            <th data-col="ref">Reference</th>
                            <th data-col="customer">Customer</th>
                            <th data-col="contact">Contact</th>
                            <th data-col="date">Date</th>
                            <th data-col="valid">{listTab === 'quotations' ? 'Valid until' : 'Quotation'}</th>
                            <th data-col="salesperson">Salesperson</th>
                            <th data-col="total" className="num">Total</th>
                            <th data-col="status">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.length === 0 ? (
                            <tr className="sales-list-empty-row">
                              <td className="sales-list-empty-cell" colSpan={listTab === 'quotations' ? 9 : 8} style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--sp-text-3)' }}>
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
                                <tr key={s.id} className="sp-row-click" onClick={() => openFromList(s.id)} style={{ cursor: 'pointer' }}>
                                  {listTab === 'quotations' && (
                                    <td data-col="select" onClick={e => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        aria-label={`Select ${s.ref}`}
                                        checked={selectedOrderIds.includes(s.id)}
                                        onChange={() => toggleSelectOrder(s.id)}
                                      />
                                    </td>
                                  )}
                                  <td data-col="ref">
                                    <button type="button" className="sp-linkish" onClick={e => { e.stopPropagation(); openFromList(s.id) }}>{s.ref}</button>
                                    {listTab === 'orders' && s.quotationRef ? (
                                      <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--sp-text-3)', fontWeight: 500 }}>
                                        was {s.quotationRef}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td data-col="customer" data-label="Customer">{s.customerName}</td>
                                  <td data-col="contact" data-label="Contact">{contactLabel}</td>
                                  <td data-col="date" data-label="Date">{fmtDate(s.date)}</td>
                                  <td data-col="valid" data-label={listTab === 'quotations' ? 'Valid until' : 'Quotation'}>
                                    {listTab === 'quotations'
                                      ? (s.validUntil ? fmtDate(s.validUntil) : '—')
                                      : (s.quotationRef || '—')}
                                  </td>
                                  <td data-col="salesperson" data-label="Salesperson">{(s as any).salespersonName || s.createdByName || '—'}</td>
                                  <td className="num" data-col="total" data-label="Total">{salesKes(s.total)}</td>
                                  <td data-col="status">{statusPill(s)}</td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {listViewMode === 'kanban' && (
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sales-kanban-board">
                      {(['quotation', 'quotation_sent', 'sale', 'cancelled'] as const).map(col => {
                        const colOrders = filtered.filter(s => s.status === col)
                        const colColors: Record<string, string> = { quotation: 'var(--warning)', quotation_sent: 'var(--primary)', sale: 'var(--navy)', cancelled: 'var(--text-4)' }
                        return (
                          <div key={col} className="flex flex-col gap-2 sales-kanban-column">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: colColors[col] }}>{SALE_STATUS_LABELS[col]}</span>
                              <span className="text-[10px] font-semibold text-[var(--sp-text-3)] bg-[var(--sp-grey-bg)] px-2 py-0.5 rounded-full">{colOrders.length}</span>
                            </div>
                            {colOrders.length === 0 && <div className="border border-dashed border-[var(--sp-border)] rounded-[6px] p-4 text-center text-[10px] text-[var(--sp-text-3)]">No orders</div>}
                            {colOrders.map(s => (
                              <div
                                key={s.id}
                                onClick={() => openFromList(s.id)}
                                className={`card p-3 cursor-pointer sales-kanban-card sales-kanban-card--${col}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-bold sp-linkish">{s.ref}</span>
                                  <span className="text-[10px] font-bold text-[var(--sp-text)]">{salesKes(s.total)}</span>
                                </div>
                                {s.quotationRef ? (
                                  <p className="text-[10px] text-[var(--sp-text-3)] truncate m-0">was {s.quotationRef}</p>
                                ) : null}
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
                <div
                  className="sales-record-view"
                  data-document-kind={activeOrder && isQuotationStage(activeOrder.status) ? 'quotation' : 'sales-order'}
                >
                  {activeOrder && (
                    <>
                  <div className="mb-2"><JobTrail start={{ kind: 'sale_order', id: activeOrder.id }} /></div>
                  <div className="sales-proto-page-header">
                    <div className="sales-proto-header-copy">
                      <div className="flex items-center justify-between gap-3">
                        <button type="button" className="sp-btn sp-btn-ghost sales-back-button" aria-label="Back to quotations" onClick={backToList}>
                          <span className="sales-back-button__icon" aria-hidden="true">←</span>
                          <span className="sales-back-button__label">Back</span>
                        </button>
                        <RecordPager currentId={activeOrder.id} onOpen={next => openOrder(next, 'replace')} />
                      </div>
                      <div className="sp-ref-row">
                        <div className="sales-record-title-block">
                          <h1>{isQuotationStage(activeOrder.status) ? 'Quotation' : 'Sales order'}</h1>
                          <span className="sales-record-ref">{activeOrder.ref}</span>
                        </div>
                        <div className="sales-record-statuses" aria-label="Document statuses">
                          {(() => {
                            const pill = saleStatusPill(activeOrder.status)
                            return <SalesDocPill label={pill.label} tone={pill.tone} />
                          })()}
                          {activeOrder.status === 'quotation_sent' && !saleOrderIsAccepted(activeOrder) && (
                            <SalesDocPill label="Sent — edit locked" tone="sent" />
                          )}
                          {saleOrderIsAccepted(activeOrder) && isQuotationStage(activeOrder.status) && (
                            <SalesDocPill label="Accepted — terms locked" tone="success" />
                          )}
                          {activeOrder.status === 'sale' && activeOrder.locked && (
                            <SalesDocPill label="Confirmed — locked" tone="neutral" />
                          )}
                          {activeOrder.status === 'sale' && (
                            <SalesDocPill label={SO_INVOICE_STATUS_LABELS[effectiveActiveInvoiceStatus]} tone={effectiveActiveInvoiceStatus === 'to_invoice' ? 'warning' : 'neutral'} />
                          )}
                          {activeOrder.status === 'sale' && activeInvoices.length > 0 && (
                            <SalesDocPill
                              label={`Payment · ${PAYMENT_STATUS_LABELS[activePaymentStatus]}`}
                              tone={activePaymentStatus === 'paid' ? 'success' : activePaymentStatus === 'not_paid' ? 'warning' : 'info'}
                            />
                          )}
                          {activeOperationallyComplete && (
                            <SalesDocPill label="Complete" tone="success" />
                          )}
                          {activeOrder.status === 'sale' && !activeOperationallyComplete && (
                            <SalesDocPill label={SO_FULFILMENT_STATUS_LABELS[activeFulfilmentStatus]} tone="neutral" />
                          )}
                        </div>
                      </div>
                      <div className="sub">
                        {isQuotationStage(activeOrder.status) ? (
                          <>
                            Customer {activeOrder.customerName}
                            {!activeIsRepairBilling && activeOrder.salespersonName ? ` · Salesperson ${activeOrder.salespersonName}` : ''}
                            {' · '}One commercial document — Confirm renames this reference to SO/…
                          </>
                        ) : (
                          <>
                            Sales Order stage · {activeOrder.customerName}
                            {!activeIsRepairBilling && activeOrder.salespersonName ? ` · Salesperson ${activeOrder.salespersonName}` : ''}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="sales-proto-actions sales-proto-actions--dock sales-record-actions">
                      {isQuotationStage(activeOrder.status) && (<>
                          {isQuotationDraft(activeOrder.status) && !activeOrder.locked && (
                            <button
                              type="button"
                              className={`${isSaleOrderDraftEditing(activeOrder.id) ? 'sp-btn sp-btn-primary' : 'sp-btn'} sales-action-save`}
                              onClick={() => {
                                void (async () => {
                                  // Prefer store row over view snapshot — draft deletes live on saleOrders.
                                  const latest = saleOrders.find(s => s.id === activeOrder.id) ?? activeOrder
                                  let lines = latest.lines
                                  if (editingLineId) {
                                    const qty = Math.max(0, Number(editLineQty) || 0)
                                    const unitPrice = Math.max(0, Number(editLinePrice) || 0)
                                    const discount = Math.max(0, Math.min(100, Number(editLineDiscount) || 0))
                                    const taxRate = Math.max(0, Number(editLineTax) || 0)
                                    const subtotal = Math.round(qty * unitPrice * (1 - discount / 100))
                                    lines = latest.lines.map(l => l.id !== editingLineId ? l : {
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
                                  const headerDisc = Math.max(0, Number(latest.discountAmount) || 0)
                                  const ok = await updateSaleOrder(activeOrder.id, {
                                    lines,
                                    subtotal: sub,
                                    taxTotal: tax,
                                    discountAmount: headerDisc,
                                    total: Math.max(0, sub + tax - headerDisc),
                                    notes: latest.notes,
                                    validUntil: latest.validUntil,
                                    paymentTerms: latest.paymentTerms,
                                    salespersonName: latest.salespersonName,
                                  }, { persist: true })
                                  setDraftDirtyTick(t => t + 1)
                                  if (ok !== false) showToast('Quotation saved', 'success')
                                })()
                              }}
                            >
                              {isSaleOrderDraftEditing(activeOrder.id) ? 'Save · unsaved' : 'Save'}
                            </button>
                          )}
                          {activeOrder.status === 'quotation' && (
                            <button type="button" className="sp-btn sp-btn-primary sales-action-send" disabled={!activeOrder.lines.length || sendingQuoteId === activeOrder.id} onClick={() => openSendQuoteModal(activeOrder)}>
                              <span className="sales-action-label--full">{sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send to customer'}</span>
                              <span className="sales-action-label--compact">{sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send'}</span>
                            </button>
                          )}
                          {activeOrder.status === 'quotation_sent' && (
                            <button type="button" className="sp-btn sales-action-send" disabled={!activeOrder.lines.length || sendingQuoteId === activeOrder.id} onClick={() => openSendQuoteModal(activeOrder)}>
                              <span className="sales-action-label--full">{sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send to customer'}</span>
                              <span className="sales-action-label--compact">{sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send'}</span>
                            </button>
                          )}
                          <MoreActionsMenu
                            className="sales-action-more"
                            items={[
                              ...(activeOrder.status === 'quotation_sent' ? [
                                { label: 'Reset to Draft', icon: faRotateLeft, onClick: () => setShowResetDraftConfirm(true) },
                                ...(!saleOrderIsAccepted(activeOrder) ? [{
                                  label: 'Mark accepted',
                                  icon: faCircleCheck,
                                  onClick: () => {
                                    const acceptedAt = new Date().toISOString()
                                    void updateSaleOrder(activeOrder.id, {
                                      acceptedAt,
                                      acceptedById: currentUserId || undefined,
                                      notes: `${activeOrder.notes || ''}\n[Customer accepted ${acceptedAt.slice(0, 10)}]`.trim(),
                                    }, { persist: true })
                                    showToast('Quotation accepted — commercial terms locked', 'success')
                                  },
                                }] : []),
                                {
                                  label: 'Mark rejected',
                                  icon: faBan,
                                  onClick: () => {
                                    void updateSaleOrder(activeOrder.id, {
                                      notes: `${activeOrder.notes || ''}\n[Customer rejected ${new Date().toISOString().slice(0, 10)}]`.trim(),
                                    }, { persist: true })
                                    showToast('Quotation marked rejected', 'info')
                                  },
                                },
                              ] : []),
                              { label: 'Preview', icon: faFileAlt, disabled: !activeOrder.lines.length, onClick: () => previewSalesDocument(activeOrder, 'Quotation', 'QUOTATION') },
                              { label: 'Print', icon: faPrint, disabled: !activeOrder.lines.length, onClick: () => downloadSalesDocument(activeOrder, 'Quotation', 'QUOTE', 'QUOTATION') },
                              { label: 'Download pro-forma', icon: faDownload, disabled: !activeOrder.lines.length, onClick: () => void downloadProformaInvoice(activeOrder) },
                              { label: 'Duplicate', icon: faCopy, onClick: () => duplicateSaleOrder(activeOrder) },
                              { label: creatingNewVersion ? 'Creating revision…' : 'Revise Quotation', icon: faCodeBranch, disabled: creatingNewVersion, onClick: () => void handleCreateNewVersion(activeOrder) },
                              { label: 'Revision History', icon: faClockRotateLeft, onClick: () => void openVersionHistory(activeOrder) },
                              { label: 'Cancel', icon: faBan, tone: 'danger', onClick: () => setShowCancelConfirm(true) },
                              { label: 'Delete', icon: faTrash, tone: 'danger', onClick: () => setShowDelConfirm(true) },
                            ]}
                          />
                          {canConfirmQuote && (() => {
                            const pendingApprovals = (approvalRequests ?? []).filter(r =>
                              r.documentId === activeOrder.id
                              && isSalesConfirmGatingApproval(r.type, systemSettings)
                              && r.status === 'pending',
                            )
                            const actionableApprovals = pendingApprovals.filter(r =>
                              canApprove(r, currentUser?.id ?? '', currentUser?.role),
                            )
                            const noLines = !activeOrder.lines.filter((l: any) => l.lineType !== 'section').length
                            const confirmBlocked = confirmingSO || noLines || pendingApprovals.length > 0
                            const confirmTitle = noLines
                              ? 'Add at least one product before confirming'
                              : pendingApprovals.length > 0
                                ? `Resolve ${pendingApprovals.length} pending approval(s) first`
                                : 'Confirm renames this quotation to a Sales Order (same document — no second order)'
                            return (
                              <>
                                {actionableApprovals.map(r => (
                                  <button
                                    key={`approve-${r.id}`}
                                    type="button"
                                    className="sp-btn sp-btn-primary"
                                    title={`Approve ${r.type.replace(/_/g, ' ')} for ${activeOrder.ref}`}
                                    onClick={() => approveRequest(r.id, 'approved')}
                                  >
                                    Approve {r.type.replace(/_/g, ' ')}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  className={`${activeOrder.status === 'quotation_sent' || saleOrderIsAccepted(activeOrder) ? 'sp-btn sp-btn-primary' : 'sp-btn'} sales-action-confirm`}
                                  disabled={confirmBlocked}
                                  title={confirmTitle}
                                  onClick={openConfirmQuoteDialog}
                                >
                                  <span className="sales-action-label--full">{confirmingSO ? 'Confirming…' : 'Confirm quotation'}</span>
                                  <span className="sales-action-label--compact">{confirmingSO ? 'Confirming…' : 'Confirm'}</span>
                                </button>
                              </>
                            )
                          })()}
                      </>)}
                      {activeOrder.status === 'sale' && (<>
                        <MoreActionsMenu
                          className="sales-action-more"
                          items={[
                            { label: 'Print', icon: faPrint, onClick: () => previewSalesDocument(activeOrder, 'Sale Order', 'SALES ORDER') },
                            { label: sendingQuoteId === activeOrder.id ? 'Sending…' : 'Send by email', icon: faFileAlt, disabled: sendingQuoteId === activeOrder.id, onClick: () => openSendQuoteModal(activeOrder) },
                            { label: 'Preview', icon: faFileAlt, onClick: () => previewSalesDocument(activeOrder, 'Sale Order', 'SALES ORDER') },
                            // Delivery lives on the primary button for users who cannot
                            // invoice; keep it in the menu only when the primary is invoice.
                            ...(canInvoiceFromSO ? [{ label: visibleDeliveries.length === 0 ? 'Create delivery' : 'Open deliveries', icon: faTruck, onClick: () => void openDeliveryView() }] : []),
                            ...(activeDeliveries.some(d => canGenerateDeliveryNote(d)) ? [{ label: 'Print delivery note', icon: faTruck, onClick: () => { const del = activeDeliveries.find(d => canGenerateDeliveryNote(d)) ?? activeDeliveries[0]; setDnRecipientName(del.recipientName ?? activeOrder.customerName ?? ''); setDnRecipientPhone(del.recipientPhone ?? ''); setDnRecipientId(del.recipientIdNumber ?? ''); setDnAddress(del.deliveryAddress ?? ''); setDnNotes(del.notes ?? ''); setShowDnModal(true) } }] : []),
                            ...(activeOrder.locked && isAdmin ? [{ label: 'Unlock', icon: faRotateLeft, onClick: () => setSaleOrderLock(activeOrder.id, false) }] : []),
                            ...(!activeOrder.locked && systemSettings.salesLockConfirmed && isAdmin ? [{ label: 'Lock', icon: faSave, onClick: () => setSaleOrderLock(activeOrder.id, true) }] : []),
                            { label: 'Duplicate', icon: faCopy, onClick: () => duplicateSaleOrder(activeOrder) },
                            { label: 'Revision History', icon: faClockRotateLeft, onClick: () => void openVersionHistory(activeOrder) },
                            ...(canReverseConfirmedSO ? [
                              { label: 'Set to Quotation', icon: faRotateLeft, onClick: () => resetSOToDraft(activeOrder.id) },
                              { label: 'Cancel', icon: faBan, tone: 'danger' as const, onClick: () => setShowCancelConfirm(true) },
                            ] : []),
                            ...(canReverseConfirmedSO && systemSettings.accCreditNotes && activeInvoices.some(i => i.status === 'posted' || (i.amountPaid ?? 0) > 0) ? [
                              {
                                label: 'Issue credit note…',
                                icon: faFileInvoiceDollar,
                                onClick: () => {
                                  setCreditNoteAmount(moneyInputValue(activeOrder.total))
                                  setCreditNoteReason('')
                                  setShowCreditNoteModal(true)
                                },
                              },
                            ] : []),
                          ]}
                        />
                        {canInvoiceFromSO && activeOrder.status === 'sale' ? (
                          invoicePrimaryAction.kind === 'view' ? (
                            <button
                              type="button"
                              className="sp-btn sp-btn-primary sales-action-primary"
                              onClick={() => router.push(financeInvoicePath(invoicePrimaryAction.invoiceId))}
                            >
                              {invoicePrimaryAction.invoiceState === 'draft' ? 'Open draft invoice' : 'View invoice'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="sp-btn sp-btn-primary sales-action-primary"
                              onClick={() => {
                      if (!canCreateInvoiceNow) {
                        void openDeliveryView()
                        return
                      }
                      setInvoiceWizardMode('')
                      setInvoiceWizardPercent('')
                      setInvoiceWizardAmount('')
                      setShowInvoiceWizard(true)
                    }}
                  >
                    {canCreateInvoiceNow
                      ? 'Create invoice'
                      : visibleDeliveries.length === 0 ? 'Create delivery'
                      : activeFulfilmentStatus === 'delivered' ? 'View delivery'
                      : 'Complete delivery'}
                            </button>
                          )
                        ) : (
                          <button type="button" className="sp-btn sp-btn-primary sales-action-primary" onClick={() => void openDeliveryView()}>
                            {visibleDeliveries.length === 0 ? 'Create delivery' : 'Delivery'}
                          </button>
                        )}
                      </>)}
                      {activeOrder.status === 'cancelled' && (
                        // Confirmed-then-cancelled needs Finance / Admin Officer / Director;
                        // draft/sent cancel can be reset by sales.
                        (activeOrder.confirmedAt ? canReverseConfirmedSO : userCan(currentUser, 'sales.quotes.create')) && (
                          <button type="button" className="sp-btn" onClick={() => resetSOToDraft(activeOrder.id)}>Set to Quotation</button>
                        )
                      )}
                    </div>
                  </div>

                  <section className="sales-record-summary" aria-label="Sales document summary">
                    <div className="sales-record-summary__primary">
                      <span>{isQuotationStage(activeOrder.status) ? 'Quotation total' : 'Order total'}</span>
                      <strong>{salesKes(activeOrder.total)}</strong>
                      <small>
                        {activeOrder.customerName} · {activeOrder.lines.filter(line => line.lineType !== 'section').length} item{activeOrder.lines.filter(line => line.lineType !== 'section').length === 1 ? '' : 's'}
                      </small>
                    </div>
                    <dl className="sales-record-summary__facts">
                      {isQuotationStage(activeOrder.status) ? (
                        <>
                          {/* The stage is already in the badge and the steps below. */}
                          <div>
                            <dt>Quote date</dt>
                            <dd>{fmtDate(activeOrder.date) || 'Not set'}</dd>
                          </div>
                          <div>
                            <dt>Valid until</dt>
                            <dd>{activeOrder.validUntil ? fmtDate(activeOrder.validUntil) : 'Not set'}</dd>
                          </div>
                          <div className="sales-record-summary__fact--secondary">
                            <dt>Salesperson</dt>
                            <dd>{activeOrder.salespersonName || 'Unassigned'}</dd>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <dt>Fulfilment</dt>
                            <dd>{SO_FULFILMENT_STATUS_LABELS[activeFulfilmentStatus]}</dd>
                          </div>
                          <div>
                            <dt>Invoice</dt>
                            <dd>{SO_INVOICE_STATUS_LABELS[effectiveActiveInvoiceStatus]}</dd>
                          </div>
                          <div>
                            <dt>Payment</dt>
                            <dd>{activeInvoices.length > 0 ? PAYMENT_STATUS_LABELS[activePaymentStatus] : 'No invoice'}</dd>
                          </div>
                        </>
                      )}
                    </dl>
                    <div className="sales-record-summary__next">
                      <span>Next action</span>
                      <strong>
                        {isQuotationStage(activeOrder.status)
                          ? activeOrder.approvalStatus === 'pending'
                            ? 'Resolve approval'
                            : activeOrder.status === 'quotation'
                              ? 'Send to customer'
                              : saleOrderIsAccepted(activeOrder)
                                ? 'Confirm quotation'
                                : 'Record customer response'
                          : activeOperationallyComplete
                            ? 'Sales complete — continue in Invoices'
                            : invoicePrimaryAction.kind === 'view'
                              ? invoicePrimaryAction.invoiceState === 'draft'
                                ? 'Review draft in Invoices'
                                : 'View invoice'
                                : visibleDeliveries.length === 0
                                  ? 'Create delivery'
                                  : activeFulfilmentStatus === 'delivered'
                                    ? 'Create invoice'
                                    : 'Complete delivery'}
                      </strong>
                      <small>
                        {isQuotationStage(activeOrder.status)
                          ? `${activeOrder.lines.length} item${activeOrder.lines.length === 1 ? '' : 's'} ready for review`
                          : `${visibleDeliveries.length} delivery record${visibleDeliveries.length === 1 ? '' : 's'}`}
                      </small>
                    </div>
                  </section>

                  {isQuotationStage(activeOrder.status) ? (
                    <SameDocumentIdentity className="sales-document-identity" mode="preview" quotationRef={activeOrder.ref} />
                  ) : activeOrder.quotationRef ? (
                    <SameDocumentIdentity
                      mode="done"
                      className="sales-document-identity"
                      quotationRef={activeOrder.quotationRef}
                      salesOrderRef={activeOrder.ref}
                    />
                  ) : null}

                  {isQuotationStage(activeOrder.status) && (
                    <SalesDocWorkflow
                      steps={[
                        {
                          key: 'quotation',
                          label: 'Quotation',
                          state: activeOrder.status === 'quotation' ? 'current' : 'done',
                        },
                        {
                          key: 'quotation-sent',
                          label: 'Quotation Sent',
                          state: activeOrder.status === 'quotation'
                            ? 'todo'
                            : saleOrderIsAccepted(activeOrder)
                              ? 'done'
                              : 'current',
                        },
                        {
                          key: 'quote-ready',
                          label: 'Quote Ready',
                          state: saleOrderIsAccepted(activeOrder) ? 'current' : 'todo',
                        },
                        {
                          key: 'sales-order',
                          label: 'Sales Order',
                          state: 'todo',
                        },
                      ] as Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }>}
                    />
                  )}

                  {activeOrder.status === 'sale' && (
                    <SalesDocWorkflow
                      steps={buildSoWorkflowSteps({
                        hasDelivery: visibleDeliveries.length > 0,
                        deliveryPrepared: activeDeliveries.some(d => !!d.preparedAt || d.status === 'ready' || d.status === 'done'),
                        deliveryDone: activeDeliveries.some(d => d.status === 'done'),
                        invoiced: effectiveActiveInvoiceStatus === 'invoiced' || activeInvoices.some(i => !i.isDownPayment),
                        paid: activePaymentStatus === 'paid',
                        complete: activeOperationallyComplete,
                      })}
                    />
                  )}

                  {/* Delivery, invoice and payment only exist once the quote is confirmed. */}
                  {!isQuotationStage(activeOrder.status) && <section className="sales-doc-smart-row sales-doc-smart-row--journey" aria-label="Sales Order journey records">
          <button type="button" className="sales-doc-smart-button">
            <span>Customer</span>
            <strong>{activeOrder.customerName || 'Not set'}</strong>
          </button>
          <button type="button" className="sales-doc-smart-button" onClick={() => void openDeliveryView()}>
            <span>Delivery</span>
            <strong>{activeFulfilmentStatus === 'delivered' ? 'Delivered ✓' : visibleDeliveries.length === 0 ? 'Not created' : 'In progress'}</strong>
          </button>
          <button type="button" className="sales-doc-smart-button" onClick={() => { const invoiceId = activeInvoices.find(i => !i.isDownPayment)?.id; if (invoiceId) router.push(financeInvoicePath(invoiceId)) }} disabled={!activeInvoices.some(i => !i.isDownPayment)}>
            <span>Invoice</span>
            <strong>{activeInvoices.some(i => !i.isDownPayment) ? SO_INVOICE_STATUS_LABELS[effectiveActiveInvoiceStatus] : 'Not created'}</strong>
          </button>
          <button type="button" className="sales-doc-smart-button" disabled={activeInvoices.length === 0}>
            <span>Payment</span>
            <strong>{activeInvoices.length > 0 ? PAYMENT_STATUS_LABELS[activePaymentStatus] : 'Awaiting invoice'}</strong>
          </button>
        </section>}


                      {isQuotationStage(activeOrder.status) && (approvalRequests ?? []).some(r =>
                        r.documentId === activeOrder.id
                        && isSalesConfirmGatingApproval(r.type, systemSettings)
                        && r.status === 'pending',
                      ) && (
                        <div className="sp-banner-warn" role="status">
                          <span aria-hidden>!</span>
                          <div className="w-full">
                            <strong>Approval required before confirm</strong>
                            <div>
                              {(approvalRequests ?? [])
                                .filter(r =>
                                  r.documentId === activeOrder.id
                                  && isSalesConfirmGatingApproval(r.type, systemSettings)
                                  && r.status === 'pending',
                                )
                                .map(r => r.type.replace(/_/g, ' '))
                                .join(' · ') || 'Pending sales approval'}
                              {' — Director/Finance must approve, then confirm.'}
                            </div>
                            {(() => {
                              const pending = (approvalRequests ?? []).filter(r =>
                                r.documentId === activeOrder.id
                                && isSalesConfirmGatingApproval(r.type, systemSettings)
                                && r.status === 'pending',
                              )
                              const actionable = pending.filter(r =>
                                canApprove(r, currentUser?.id ?? '', currentUser?.role),
                              )
                              if (actionable.length === 0) {
                                return (
                                  <div className="text-[11px] mt-1 text-[var(--sp-text-3)]">
                                    Waiting on {pending.map(r => r.approvers.find(a => a.level === r.currentLevel)?.role ?? 'approver').join(', ') || 'approver'}.
                                  </div>
                                )
                              }
                              return (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {actionable.map(r => (
                                    <Fragment key={r.id}>
                                      <button
                                        type="button"
                                        className="sp-btn sp-btn-primary"
                                        onClick={() => approveRequest(r.id, 'approved')}
                                      >
                                        Approve {r.type.replace(/_/g, ' ')}
                                      </button>
                                      <button
                                        type="button"
                                        className="sp-btn"
                                        onClick={() => approveRequest(r.id, 'rejected', 'Rejected from quotation screen')}
                                      >
                                        Reject
                                      </button>
                                    </Fragment>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                      )}

                      {isQuotationStage(activeOrder.status) && saleOrderIsAccepted(activeOrder) && (
                        <div className="sp-banner-ok" role="status">
                          <span aria-hidden>✓</span>
                          <div className="w-full">
                            <strong>Customer accepted — commercial terms locked</strong>
                            <div>
                              Accepted{activeOrder.acceptedAt ? ` ${fmtDate(activeOrder.acceptedAt)}` : ''}.
                              Confirm renames this same record to a Sales Order (QUO/… → SO/…), or create a New Version / Reset to Draft to revise terms.
                            </div>
                          </div>
                        </div>
                      )}

                      {isQuotationStage(activeOrder.status) && quotationStockShortages.length > 0 && (
                        <div className="sp-banner-warn" role="status">
                          <span aria-hidden>!</span>
                          <div className="w-full">
                            <strong>Stock warning</strong>
                            <div>
                              {quotationStockShortages
                                .slice(0, 3)
                                .map(s => `${s.productName} needs ${s.qty}, free ${s.available}`)
                                .join(' · ')}
                              {quotationStockShortages.length > 3
                                ? ` · +${quotationStockShortages.length - 3} more`
                                : ''}
                              {' — shortage is checked again at delivery preparation.'}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <button type="button" className="sp-btn" onClick={() => router.push('/inventory')}>
                                View stock
                              </button>
                              <button type="button" className="sp-btn" onClick={() => router.push('/purchasing')}>
                                Create PO
                              </button>
                              {canSkipReserveOnConfirm && (
                                <span className="text-[11px] text-[var(--sp-text-3)] self-center">
                                  Directors may confirm without reservation in the confirm dialog.
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {activeOrder.status === 'sale' && (
                        <div className="sp-banner-ok sales-same-document-banner" role="status">
                          <span aria-hidden>✓</span>
                          <div>
                            <strong>Same document — now in Sales Order stage</strong>
                            <div>
                              {activeOrder.quotationRef
                                ? `Reference renamed from ${activeOrder.quotationRef} to ${activeOrder.ref}`
                                : `Confirmed — this record is now ${activeOrder.ref}`}
                              {activeOrder.confirmedAt
                                ? ` · confirmed ${fmtDate(activeOrder.confirmedAt)}${activeOrder.confirmedByName ? ` by ${activeOrder.confirmedByName}` : ''}`
                                : ''}
                              {visibleDeliveries.length === 0
                                ? ' · create a delivery to allocate stock'
                                : ` · ${visibleDeliveries.length} delivery${visibleDeliveries.length === 1 ? '' : 'ies'}`}
                              {' · payment status stays independent of fulfilment'}
                            </div>
                          </div>
                        </div>
                      )}

                    <div className={`sp-panel sp-panel-pad sales-order-meta-panel sales-order-meta-panel--unified ${showAllMeta ? 'is-expanded' : ''}`}>
                      <div className="sales-order-unified-heading">
                        <strong>{isQuotationStage(activeOrder.status) ? 'Quotation' : 'Sales order'}</strong>
                        <span>Customer, dates, terms and ownership</span>
                      </div>
                      <div className="sp-grid-2 sales-order-meta-grid">
                        <div className="sales-order-meta-column sales-order-meta-column--customer">
                          <SalesDocField label="Customer"><input readOnly value={activeOrder.customerName || ''} /></SalesDocField>
                          {(() => {
                            // The contact repeated the customer's name on most records,
                            // and an empty email took a row to say "—".
                            const contactName = customers.find(x => x.id === activeOrder.customerId)?.name || '—'
                            return <SalesDocField label="Contact" secondary={contactName === '—' || contactName === activeOrder.customerName}><input readOnly value={contactName} /></SalesDocField>
                          })()}
                          <SalesDocField label="Email" secondary><input readOnly value={customers.find(c => c.id === activeOrder.customerId)?.email || '—'} /></SalesDocField>
                          <SalesDocField label="Phone"><input readOnly value={(() => { const c = customers.find(x => x.id === activeOrder.customerId); return c?.phone || c?.mobile || '—' })()} /></SalesDocField>
                        </div>
                        <div className="sales-order-meta-column sales-order-meta-column--commercial">
                          <SalesDocField label="Reference" secondary>
                            <div className="sales-order-reference">
                              <strong>{activeOrder.ref}</strong>
                              {activeOrder.status === 'sale' && activeOrder.quotationRef ? (
                                <span className="sales-order-reference-note">
                                  Renamed from {activeOrder.quotationRef} (same document)
                                </span>
                              ) : isQuotationStage(activeOrder.status) ? (
                                <span className="sales-order-reference-note">
                                  Confirm renames to SO/… on this same record
                                </span>
                              ) : null}
                            </div>
                          </SalesDocField>
                          <SalesDocField label={isQuotationStage(activeOrder.status) ? 'Quote date' : 'Order date'} secondary><input readOnly value={fmtDate(activeOrder.date) || ''} /></SalesDocField>
                          <SalesDocField label={isQuotationStage(activeOrder.status) ? 'Valid until' : 'Expected delivery'}>
                            {isQuotationDraft(activeOrder.status) && !activeOrder.locked ? (
                              <input
                                type="date"
                                aria-label="Valid until"
                                value={activeOrder.validUntil || ''}
                                onChange={e => {
                                  void updateSaleOrder(activeOrder.id, { validUntil: e.target.value || undefined })
                                  setDraftDirtyTick(t => t + 1)
                                }}
                              />
                            ) : (
                              <input readOnly value={fmtDate(isQuotationStage(activeOrder.status) ? (activeOrder.validUntil || '') : (activeOrder.deliveryDate || '')) || '—'} />
                            )}
                          </SalesDocField>
                          {isQuotationStage(activeOrder.status) && (
                            <SalesDocField label="Order discount (KES)" secondary={!(Number(activeOrder.discountAmount) > 0)}>
                              {isQuotationDraft(activeOrder.status) && !activeOrder.locked && canEditDiscount ? (
                                <input
                                  type="number"
                                  min={0}
                                  aria-label="Header discount"
                                  value={String(activeOrder.discountAmount ?? 0)}
                                  onChange={e => {
                                    const discountAmount = Math.max(0, Number(e.target.value) || 0)
                                    const sub = activeOrder.lines.reduce((a, l) => a + (Number(l.subtotal) || 0), 0)
                                    const tax = activeOrder.lines.reduce((a, l) => a + Math.round((Number(l.subtotal) || 0) * (Number(l.taxRate) || 0) / 100), 0)
                                    void updateSaleOrder(activeOrder.id, {
                                      discountAmount,
                                      total: Math.max(0, sub + tax - discountAmount),
                                    })
                                    setDraftDirtyTick(t => t + 1)
                                  }}
                                />
                              ) : (
                                <input readOnly value={salesKes(activeOrder.discountAmount ?? 0)} />
                              )}
                            </SalesDocField>
                          )}
                          {!activeIsRepairBilling && (
                          <div className="sales-secondary-group" style={{ display: 'contents' }}>
                          <SalespersonCloserField
                            valueId={activeOrder.salespersonId}
                            valueName={activeOrder.salespersonName}
                            createdByName={activeOrder.createdByName}
                            disabled={
                              activeOrder.status === 'cancelled'
                              || activeInvoices.some(i => !['draft', 'cancelled', 'voided', 'canceled'].includes(String(i.status)))
                            }
                            onChange={(id, name) => {
                              void updateSaleOrder(activeOrder.id, { salespersonId: id, salespersonName: name })
                            }}
                          />
                          </div>
                          )}
                          {!activeIsRepairBilling && (
                          <div className="sales-secondary-group" style={{ display: 'contents' }}>
                          <SaleOrderAgentField
                            saleOrderId={activeOrder.id}
                            contacts={contacts}
                            onError={msg => showToast(msg, 'error')}
                            disabled={
                              activeOrder.status === 'cancelled'
                              || activeInvoices.some(i => ['paid', 'partial', 'partially_paid'].includes(String(i.status)) || Number(i.amountPaid) > 0)
                            }
                          />
                          </div>
                          )}
                          <SalesDocField label="Payment terms"><input readOnly value={activeOrder.paymentTerms || '—'} /></SalesDocField>
                          <SalesDocField label="Currency" secondary><input readOnly value="KES" /></SalesDocField>
                          {activeOrder.status === 'sale' && (
                            <SalesDocField label="Related">
                              {/* One line each: run together as one sentence they wrapped
                                  mid-list on a phone, the label stranded from its links. */}
                              <div className="flex flex-col gap-1 pt-1 text-[12.5px]">
                                <span className="flex flex-wrap items-baseline gap-x-1.5">
                                  <span className="text-[var(--text-3)]">Deliveries</span>
                                  {visibleDeliveries.length
                                    ? visibleDeliveries.map(d => (
                                        <button key={d.id} type="button" className="sp-linkish" onClick={() => void openDeliveryView(d.id)}>{d.ref}</button>
                                      ))
                                    : <span>—</span>}
                                </span>
                                <span className="flex flex-wrap items-baseline gap-x-1.5">
                                  <span className="text-[var(--text-3)]">Invoices</span>
                                  {activeInvoices.length
                                    ? activeInvoices.map(inv => (
                                        <button key={inv.id} type="button" className="sp-linkish" onClick={() => router.push(financeInvoicePath(inv.id))}>{inv.ref}</button>
                                      ))
                                    : <span>None yet</span>}
                                </span>
                              </div>
                            </SalesDocField>
                          )}
                        </div>
                      </div>
                      <MetaDetailsToggle expanded={showAllMeta} onToggle={() => setShowAllMeta(v => !v)} />
                    </div>

                      {activeOrder.status === 'quotation_sent' && !saleOrderIsAccepted(activeOrder) && (
                        <div className="sp-banner-warn" role="status">
                          <span aria-hidden>!</span>
                          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                            <span>
                              Sent to the customer — commercial lines are frozen. Reset to Draft to edit, or Mark accepted when the customer agrees. Confirm renames this same record QUO/… → SO/… (no second order).
                            </span>
                            <button type="button" className="sp-btn" onClick={() => setShowResetDraftConfirm(true)}>Reset to Draft</button>
                          </div>
                        </div>
                      )}

                      {/* Lines + Summary — prototype tabbed panel */}
                      <div className="sp-panel sales-order-lines-panel" style={{ marginTop: 10 }}>
                        <SalesDocTabs
                          className="sales-order-section-tabs"
                          tabs={isQuotationStage(activeOrder.status)
                            ? ['Order Lines', 'Optional Products', 'Terms and Conditions', 'Notes', 'Attachments', 'History']
                            : ['Order Lines', 'Delivery and Stock', 'Invoices', ...(canSeeReturns ? ['Returns'] : []), 'Notes', 'History']}
                          active={detailTab}
                          onChange={setDetailTab}
                        />
                        {detailTab === 'Order Lines' && (
                          <>
                          <div className="sp-table-wrap">
                            <table className="sp-table sp-line-table sp-line-table--order" data-no-responsive>
                              <thead>
                                <tr>
                                  <th data-col="product">Product</th>
                                  <th data-col="description">Description</th>
                                  <th className="num" data-col="qty">Ordered</th>
                                  <th data-col="unit">Unit</th>
                                  {activeOrder.status === 'sale' && (
                                    <>
                                      <th className="num" data-col="reserved">Reserved</th>
                                      <th className="num" data-col="delivered">Delivered</th>
                                      <th className="num" data-col="invoiced">Invoiced</th>
                                    </>
                                  )}
                                  <th data-col="policy">Bill on</th>
                                  <th className="num" data-col="price">Unit price</th>
                                  <th className="num" data-col="discount">Disc%</th>
                                  <th data-col="tax">Tax</th>
                                  <th className="num" data-col="amount">Amount</th>
                                  <th data-col="actions"><span className="sr-only">Actions</span></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border-lt)]">
                                {activeOrder.lines.map((l, lineIndex) => {
                                  const canEdit = isQuotationDraft(activeOrder.status) && !activeOrder.locked
                                  if (l.lineType === 'section') {
                                    return (
                                      <tr key={l.id} className="bg-slate-50/70">
                                        <td className="px-3 py-2" colSpan={canEdit ? 7 : 8} data-col="product">
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
                                          <td className="px-3 py-2 text-center" data-col="actions">
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
                                  const reservedQty = reservedByLineId.get(String(l.id)) ?? 0
                                  const showDelivered = activeOrder.status === 'sale'
                                  const linePolicy = activeLineInvoicePolicy(l)
                                  return (
                                    <tr key={l.id} className={isEditing ? 'row-editing' : ''}>
                                      <td data-col="product">
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
                                      <td
                                        data-col="description"
                                        data-same={!isEditing && (!l.description || String(l.description).trim() === String(l.productName ?? '').trim()) ? '1' : undefined}
                                      >{l.description || '—'}</td>
                                      <td className="num" data-col="qty">
                                        {isEditing ? <input type="number" aria-label="Line item quantity" min={1} value={editLineQty} onChange={e => setEditLineQty(e.target.value)} className="w-14 text-center" />
                                        : l.qty}
                                      </td>
                                      <td data-col="unit">Unit(s)</td>
                                      {showDelivered && (
                                        <td className="num" data-col="reserved">
                                          <span className={`font-semibold ${reservedQty > 0 ? 'text-sky-600' : 'text-[var(--text-4)]'}`}>{reservedQty}</span>
                                        </td>
                                      )}
                                      {showDelivered && (
                                        <td className="num" data-col="delivered">
                                          <span className={`font-semibold ${(l.qtyDelivered ?? 0) >= l.qty ? 'text-emerald-600' : (l.qtyDelivered ?? 0) > 0 ? 'text-amber-500' : 'text-[var(--text-4)]'}`}>{l.qtyDelivered ?? 0}</span>
                                        </td>
                                      )}
                                      {showDelivered && (
                                        <td className="num" data-col="invoiced">
                                          <span className={`font-semibold ${invoicedQty > 0 ? 'text-violet-600' : 'text-[var(--text-4)]'}`}>{invoicedQty}</span>
                                        </td>
                                      )}
                                      <td data-col="policy">
                                        <span style={{ fontSize: 10, color: 'var(--sp-text-3)' }} title={INVOICE_POLICY_LABELS[linePolicy]}>
                                          {linePolicy === 'delivery' ? 'Delivered' : 'Ordered'}
                                        </span>
                                      </td>
                                      <td className="num" data-col="price">
                                        {isEditing ? <input type="number" aria-label="Line item unit price" min={0} value={editLinePrice} onChange={e => setEditLinePrice(e.target.value)} className="w-20 text-right" />
                                        : salesKes(l.unitPrice)}
                                      </td>
                                      <td className="num" data-col="discount" data-zero={!isEditing && !Number(l.discount ?? l.discountPercent ?? 0) ? '1' : undefined}>
                                        {isEditing ? <input type="number" aria-label="Line item discount percentage" min={0} max={100} value={editLineDiscount} onChange={e => setEditLineDiscount(e.target.value)} className="w-14 text-right" />
                                        : `${l.discount ?? l.discountPercent ?? 0}%`}
                                      </td>
                                      <td data-col="tax">
                                        {isEditing ? (
                                          <select
                                            aria-label="Line item tax percentage"
                                            className="w-20"
                                            value={String(editLineTax)}
                                            onChange={e => setEditLineTax(e.target.value)}
                                          >
                                            <option value="0">0%</option>
                                            <option value={String(companySettings.vatRate)}>{companySettings.vatRate}%</option>
                                          </select>
                                        ) : `${l.taxRate ?? 0}%`}
                                      </td>
                                      <td className="num" data-col="amount">
                                        {isEditing ? (
                                          <span>{salesKes(Math.round(Math.max(0, Number(editLineQty) || 0) * Math.max(0, Number(editLinePrice) || 0) * (1 - Math.max(0, Math.min(100, Number(editLineDiscount) || 0)) / 100)))}</span>
                                        ) : salesKes(l.subtotal)}
                                      </td>
                                      <td data-col="actions">
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
                                    No products added yet.{activeOrder.status === 'quotation' && <button onClick={() => { setAddLineProduct(null); setAddLineQty(''); setAddLineDiscount(''); setAddLineVat(false); setShowAddLine(true) }} className="ml-2 text-primary-600 font-semibold hover:underline">+ Add a product</button>}
                                  </td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          {isQuotationDraft(activeOrder.status) && !activeOrder.locked && (
                            <div className="sp-line-actions">
                              <button type="button" onClick={() => { setAddLineProduct(null); setAddLineQty(''); setAddLineDiscount(''); setAddLineVat(false); setShowAddLine(true) }}>Add a line</button>
                              <button type="button" onClick={() => addSOSection(activeOrder.id)}>Add a section</button>
                              <button type="button" onClick={() => setDetailTab('Notes')}>Add a note</button>
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
                              bankAccounts={bankAccounts}
                              isVat={documentHasVat(activeOrder)}
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
                        {detailTab === 'Optional Products' && (
                          <div className="sp-panel-pad">
                            {Array.isArray((activeOrder as any).optionalProducts) && (activeOrder as any).optionalProducts.length > 0 ? (
                              <div className="flex flex-col gap-2">
                                {(activeOrder as any).optionalProducts.map((item: any) => (
                                  <div key={item.id || item.productId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 rounded-lg border border-[var(--sp-border)] px-3 py-2 text-xs">
                                    <strong className="truncate text-[var(--sp-text)]">{item.productName}</strong>
                                    <span>{item.qty} × {salesKes(item.unitPrice)}</span>
                                    <strong>{salesKes((Number(item.qty) || 0) * (Number(item.unitPrice) || 0))}</strong>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-[var(--sp-text-3)]">No optional products were included.</p>
                            )}
                          </div>
                        )}

                        {detailTab === 'Terms and Conditions' && (
                          <div className="sp-panel-pad">
                            <SalesDocField label="Commercial terms">
                              <textarea
                                rows={8}
                                value={(activeOrder as any).termsAndConditions ?? ''}
                                readOnly={!isQuotationDraft(activeOrder.status) || !!activeOrder.locked}
                                onChange={event => updateSaleOrder(activeOrder.id, { termsAndConditions: event.target.value } as any)}
                                placeholder="No commercial terms recorded."
                              />
                            </SalesDocField>
                          </div>
                        )}
                        {detailTab === 'Attachments' && (
                          <div className="sp-panel-pad flex flex-col gap-3">
                            {isQuotationDraft(activeOrder.status) && !activeOrder.locked && (
                              <label className="btn-outline w-fit cursor-pointer">
                                {uploadingAttachment ? 'Uploading…' : 'Attach file'}
                                <input type="file" className="sr-only" disabled={uploadingAttachment} onChange={event => {
                                  const file = event.target.files?.[0]
                                  if (file) void uploadSoAttachment(file)
                                  event.currentTarget.value = ''
                                }} />
                              </label>
                            )}
                            {soAttachments.length === 0 ? (
                              <p className="text-xs text-[var(--sp-text-3)]">No files attached.</p>
                            ) : (
                              soAttachments.map(file => (
                                <div key={file.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--sp-border)] px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-[var(--sp-text)]">{file.name}</p>
                                    <p className="text-[10px] text-[var(--sp-text-3)]">{Math.max(1, Math.round(file.size / 1024))} KB</p>
                                  </div>
                                  {isQuotationDraft(activeOrder.status) && !activeOrder.locked && (
                                    <button type="button" className="btn-outline" onClick={() => void deleteSoAttachment(file.id)}>Remove</button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                        {detailTab === 'Delivery and Stock' && (
                          <div className="sp-panel-pad">
                            {activeDeliveries.length === 0 ? (
                              <p style={{ color: 'var(--sp-text-3)' }}>No deliveries yet.</p>
                            ) : (
                              <div className="sp-table-wrap sales-subview-table-wrap">
                              <table className="sp-table sales-subview-table" data-no-responsive>
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
                                      <td data-label="Reference">{d.name || d.id}</td>
                                      <td data-label="Status">{d.status}</td>
                                      <td data-label="Scheduled">{d.scheduledDate ? fmtDate(d.scheduledDate) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              </div>
                            )}
                          </div>
                        )}
                        {detailTab === 'Returns' && (
                          <div className="sp-panel-pad">
                            <div className="flex flex-col gap-3 sales-returns-content">
                              <p style={{ color: 'var(--sp-text-2)', margin: 0, fontSize: 13 }}>
                                {activeInvoices.some(i => !i.isDownPayment && (i.status === 'posted' || (i.amountPaid ?? 0) > 0))
                                  ? 'Return after invoice: receive reverses stock, then issue a credit note for invoiced quantities.'
                                  : 'Return before invoice: receive reverses delivered quantities only — no credit note needed.'}
                              </p>
                              {activeReturns.length === 0 ? (
                                <p style={{ color: 'var(--sp-text-3)', margin: 0 }}>No returns linked to this order yet.</p>
                              ) : (
                                <div className="sp-table-wrap sales-subview-table-wrap">
                                <table className="sp-table sales-subview-table" data-no-responsive>
                                  <thead>
                                    <tr>
                                      <th>Reference</th>
                                      <th>Status</th>
                                      <th>Reason</th>
                                      <th>Resolution</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {activeReturns.map((r: any) => (
                                      <tr key={r.id}>
                                        <td data-label="Reference">{r.ref}</td>
                                        <td data-label="Status">{r.status}</td>
                                        <td data-label="Reason">{r.reason || '—'}</td>
                                        <td data-label="Resolution">{r.resolution || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                </div>
                              )}
                              {canSeeReturns && (
                                <div>
                                  <button type="button" className="sp-btn sp-btn-primary" onClick={() => router.push('/aftersales')}>
                                    Open After Sales RMA
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {detailTab === 'Invoices' && (
                          <div className="sp-panel-pad">
                            {activeInvoices.length === 0 ? (
                              <div className="flex flex-col gap-3" style={{ maxWidth: 420 }}>
                                <p style={{ color: 'var(--sp-text-3)', margin: 0 }}>No invoices yet.</p>
                                {canInvoiceFromSO ? (
                                  <>
                                    <p style={{ color: 'var(--sp-text-2)', margin: 0, fontSize: 13 }}>
                                      {canCreateInvoiceNow
                                        ? 'Create a regular invoice, down payment, or final invoice (deducts deposits).'
                                        : invoiceDeliveryReady
                                          ? 'Nothing is eligible under delivered-qty policy yet — you can still raise a down payment.'
                                          : 'Delivered-qty products need a validated delivery. You can still raise a down payment deposit now.'}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        className="sp-btn sp-btn-primary"
                                        onClick={() => {
                                          if (!canCreateInvoiceNow) {
                                            void openDeliveryView()
                                            return
                                          }
                                          setInvoiceWizardMode('')
                                          setInvoiceWizardPercent('')
                                          setInvoiceWizardAmount('')
                                          setShowInvoiceWizard(true)
                                        }}
                                      >
                                        {canCreateInvoiceNow ? 'Create invoice…' : 'Complete delivery'}
                                      </button>
                                      {!canCreateInvoiceNow && (
                                        <button type="button" className="sp-btn" onClick={() => void openDeliveryView()}>
                                          {visibleDeliveries.length === 0 ? 'Create delivery' : 'Go to delivery'}
                                        </button>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <p style={{ color: 'var(--sp-text-3)', margin: 0, fontSize: 13 }}>
                                    Your role cannot create customer invoices.
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className="sp-table-wrap sales-subview-table-wrap">
                              <table className="sp-table sales-subview-table" data-no-responsive>
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
                                      <td data-label="Reference">
                                        {inv.ref || inv.name || inv.number || inv.id}
                                        {inv.isDownPayment ? (
                                          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--sp-text-3)' }}>Down payment</span>
                                        ) : null}
                                      </td>
                                      <td data-label="Status">{inv.status || inv.state}</td>
                                      <td className="num" data-label="Total">{salesKes(inv.total ?? inv.amountTotal ?? 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              </div>
                            )}
                          </div>
                        )}
                        {(detailTab === 'History' || detailTab === 'Activities') && (
                          <div className="sp-panel-pad">
                            {[
                              { label: 'Quotation created', date: activeOrder.date, show: true },
                              { label: `Quotation sent${activeOrder.sentTo ? ` to ${activeOrder.sentTo}` : ''}${activeOrder.sentByName ? ` by ${activeOrder.sentByName}` : ''}`, date: activeOrder.sentAt ?? activeOrder.date, show: !!activeOrder.sentAt },
                              { label: 'Customer accepted — terms locked', date: activeOrder.acceptedAt ?? activeOrder.date, show: saleOrderIsAccepted(activeOrder) },
                              {
                                label: activeOrder.quotationRef
                                  ? `Confirmed — renamed ${activeOrder.quotationRef} → ${activeOrder.ref}${activeOrder.confirmedByName ? ` by ${activeOrder.confirmedByName}` : ''} (same document)`
                                  : `Confirmed — Sales Order stage${activeOrder.confirmedByName ? ` by ${activeOrder.confirmedByName}` : ''} (same document)`,
                                date: activeOrder.confirmedAt ?? activeOrder.date,
                                show: activeOrder.status === 'sale',
                              },
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

      {showProformaPreview && activeOrder && (() => {
        const proformaRef = activeOrder.proformaRef || activeOrder.ref.replace(/^(QUO|QTN|SO)/i, 'PFI')
        const paymentLines = buildPaymentDetailLines({
          details: getDocumentPaymentDetails(activeOrder.id),
          company: companySettings,
          bankAccounts,
          documentRef: proformaRef,
        })
        return (
          <Modal title="Proforma invoice" onClose={() => setShowProformaPreview(false)} width={1100}>
            <div className="sales-proforma-preview">
              <section className="sales-proforma-preview__hero">
                <div>
                  <h2>{proformaRef}</h2>
                  <p>{activeOrder.customerName} · Source {activeOrder.ref}</p>
                </div>
                <div className="sales-proforma-preview__amount">
                  <span>Proforma total</span>
                  <strong>{salesKes(activeOrder.total)}</strong>
                </div>
              </section>

              <div className="sales-proforma-preview__warning" role="note">
                This is a proforma invoice and not a tax invoice.
              </div>

              <section className="sales-proforma-preview__lines" aria-label="Proforma line items">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Unit price</th>
                      <th>VAT</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOrder.lines.filter(line => line.lineType !== 'section').map(line => (
                      <tr key={line.id}>
                        <td><strong>{line.productName || line.description || 'Item'}</strong><br /><small>{line.description || ''}</small></td>
                        <td>{line.qty}</td>
                        <td>Unit(s)</td>
                        <td>{salesKes(line.unitPrice)}</td>
                        <td>{line.taxRate || 0}%</td>
                        <td>{salesKes(line.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <aside className="sales-proforma-preview__source">
                <dl>
                  <div><dt>Issue date</dt><dd>{fmtDate(activeOrder.date)}</dd></div>
                  <div><dt>Valid until</dt><dd>{activeOrder.validUntil ? fmtDate(activeOrder.validUntil) : 'Not set'}</dd></div>
                  <div><dt>Source document</dt><dd>{activeOrder.ref}</dd></div>
                  <div><dt>Payment terms</dt><dd>{activeOrder.paymentTerms || 'Not set'}</dd></div>
                  <div><dt>Salesperson</dt><dd>{activeOrder.salespersonName || activeOrder.createdByName || 'Unassigned'}</dd></div>
                </dl>
              </aside>

              <section className="sales-proforma-preview__payment">
                <h3>Payment instructions</h3>
                {paymentLines.length > 0 ? paymentLines.map((line, idx) => <p key={idx}>{line}</p>) : <p>Payment details have not been configured.</p>}
                <div className="sales-proforma-preview__totals">
                  <div><span>Untaxed amount</span><strong>{salesKes(activeOrder.subtotal)}</strong></div>
                  <div><span>VAT</span><strong>{salesKes(activeOrder.taxTotal)}</strong></div>
                  <div><span>Total</span><strong>{salesKes(activeOrder.total)}</strong></div>
                </div>
              </section>

              <div className="flex flex-wrap justify-end gap-2 col-span-full">
                <button type="button" className="sp-btn" onClick={() => setShowProformaPreview(false)}>Close</button>
                <button type="button" className="sp-btn sp-btn-primary" onClick={() => void downloadProformaInvoice(activeOrder)}>
                  Download proforma PDF
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

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
            <SearchPicker
              label="Product *"
              placeholder="Search product..."
              items={sellableProducts}
              onSelect={setAddLineProduct}
              formatSelected={p => p.name}
              selectedLabel={addLineProduct?.name}
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
              <Field label="Quantity *"><Input type="number" value={addLineQty} onChange={setAddLineQty} /></Field>
              {canEditDiscount && <Field label="Discount % *"><Input type="number" value={addLineDiscount} onChange={setAddLineDiscount} /></Field>}
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={addLineVat} onChange={e => setAddLineVat(e.target.checked)} className="w-4 h-4 rounded accent-primary-600" />
              <span className="text-xs text-[var(--text-2)]">Apply VAT ({companySettings.vatRate}%)</span>
            </label>
            {addLineProduct && (() => {
              const marginQuote = quoteSalePriceFromCost({
                costPrice: addLineProduct.costPrice,
                erpCategory: addLineProduct.category,
                pricingCategoryId: (addLineProduct as any).pricingCategoryId,
                productType: (addLineProduct as any).productType,
                policy: systemSettings.pricingMarginPolicy,
              })
              return (
              <>
              {marginQuote.ok && (
                <div className="p-3 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--navy)_4%,var(--bg-surface))] text-[11px] text-[var(--text-2)] leading-relaxed">
                  <strong className="text-[var(--navy)]">{marginQuote.category.name}</strong>
                  {' '}quote band {salesKes(marginQuote.min.sellExVatRounded)}-{salesKes(marginQuote.max.sellExVatRounded)} ex VAT
                  {' '}(invoice ~{salesKes(Math.round(marginQuote.min.invoiceIncVat))}-{salesKes(Math.round(marginQuote.max.invoiceIncVat))}).
                  Floor GP {marginQuote.approvalMinGrossMarginPct.toFixed(1)}%.
                </div>
              )}
              <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-[var(--text-3)]">Line total preview</p>
                  <p className="text-xs text-[var(--text-4)] mt-0.5">{salesKes(addLineProduct.salePrice)} × {Math.max(1, Number(addLineQty) || 1)}{Number(addLineDiscount) > 0 && ` − ${addLineDiscount}% disc`}{addLineVat && ` + ${companySettings.vatRate}% VAT`}</p>
                </div>
                <p className="text-sm font-extrabold text-primary-600 font-mono">{salesKes((() => { const qty = Math.max(1, Number(addLineQty) || 1); const disc = Number(addLineDiscount) || 0; const sub = Math.round(addLineProduct.salePrice * qty * (1 - disc / 100)); return sub + (addLineVat ? Math.round(sub * (companySettings.vatRate / 100)) : 0) })())}</p>
              </div>
              </>
              )
            })()}
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowAddLine(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddLine}>Add to Order</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Partial invoice — pick which lines/quantities to invoice this round
          instead of the one-click "Create Invoice" which bills everything
          currently invoiceable. Each qty is capped server-side regardless of
          what's typed here. */}
      {showInvoiceWizard && activeOrder && (() => {
        const unappliedDowns = sumUnappliedDownPayments(activeInvoices as any, activeOrder.id)
        const modeHelp =
          invoiceWizardMode === ''
            ? 'Select an invoice type to continue.'
            : invoiceWizardMode === 'regular'
            ? canCreateInvoiceNow
              ? 'Bills invoiceable quantity per product policy (Ordered Quantities vs Delivered Quantities). Does not deduct deposits.'
              : 'No product quantity is eligible yet under the current policy. Use a down payment, or validate delivery for Delivered-policy lines.'
            : invoiceWizardMode === 'down_payment_percent' || invoiceWizardMode === 'down_payment_fixed'
              ? 'Creates a deposit invoice linked to this Sales Order. Does not consume product qty invoiced — final invoice deducts it later.'
              : unappliedDowns > 0
                ? `Bills remaining invoiceable quantities and deducts unapplied down payments (KES ${unappliedDowns.toLocaleString()}).`
                : 'Bills remaining invoiceable quantities. No unapplied down payments to deduct yet.'
        const wizardBlocked =
          (invoiceWizardMode === 'regular' || invoiceWizardMode === 'final') && !canCreateInvoiceNow
        return (
        <Modal title={`Create Invoice — ${activeOrder.ref}`} onClose={() => setShowInvoiceWizard(false)} width={520}>
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--text-3)] m-0">
              Choose how to bill this Sales Order. Down payments are deposits; Final deducts them from the goods invoice.
            </p>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-[var(--text-2)]">Invoice type</span>
              <select
                className="form-input text-xs"
                value={invoiceWizardMode}
                onChange={e => setInvoiceWizardMode(e.target.value as typeof invoiceWizardMode)}
              >
                <option value="" disabled>Select invoice type…</option>
                <option value="regular">Regular invoice (by line policy)</option>
                <option value="down_payment_percent">Down payment — percentage</option>
                <option value="down_payment_fixed">Down payment — fixed amount</option>
                <option value="final">Final invoice (deduct down payments)</option>
              </select>
            </label>
            <p className="text-[11px] text-[var(--text-3)] m-0 rounded-md border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2">
              {modeHelp}
              {unappliedDowns > 0 ? ` · Unapplied deposits: KES ${unappliedDowns.toLocaleString()}` : ''}
            </p>
            {invoiceWizardMode === 'down_payment_percent' && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold text-[var(--text-2)]">Percent of order total</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="form-input text-xs w-28"
                  value={invoiceWizardPercent}
                  onChange={e => setInvoiceWizardPercent(e.target.value)}
                />
              </label>
            )}
            {invoiceWizardMode === 'down_payment_fixed' && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold text-[var(--text-2)]">Amount (KES)</span>
                <input
                  type="number"
                  min={1}
                  className="form-input text-xs w-40"
                  value={invoiceWizardAmount}
                  onChange={e => setInvoiceWizardAmount(e.target.value)}
                />
              </label>
            )}
            {(invoiceWizardMode === 'regular' || invoiceWizardMode === 'final') && invoiceableLinesFor(activeOrder).length > 0 && (
              <button type="button" className="sp-btn self-start" onClick={() => { setShowInvoiceWizard(false); openPartialInvoiceModal(activeOrder) }}>
                Or create partial invoice…
              </button>
            )}
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowInvoiceWizard(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={creatingWizardInvoice || wizardBlocked || !invoiceWizardMode}
                title={wizardBlocked ? 'No invoiceable product quantity yet' : undefined}
                onClick={() => {
                  if (!invoiceWizardMode) { showToast('Select an invoice type', 'error'); return }
                  const wizardMode = invoiceWizardMode
                  let percent: number | undefined
                  let amount: number | undefined
                  if (wizardMode === 'down_payment_percent') {
                    const pct = invoiceWizardPercent.trim() === '' ? NaN : Number(invoiceWizardPercent)
                    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) { showToast('Enter a down payment percent between 1 and 100', 'error'); return }
                    percent = pct
                  }
                  if (wizardMode === 'down_payment_fixed') {
                    const amt = invoiceWizardAmount.trim() === '' ? NaN : Number(invoiceWizardAmount)
                    if (!Number.isFinite(amt) || amt <= 0) { showToast('Enter a down payment amount greater than zero', 'error'); return }
                    amount = amt
                  }
                  void (async () => {
                    setCreatingWizardInvoice(true)
                    try {
                      const soPayment = getDocumentPaymentDetails(activeOrder.id)
                      const inv = await Promise.resolve(createInvoiceFromSO(activeOrder.id, {
                        mode: wizardMode,
                        percent,
                        amount,
                      }))
                      if (inv?.id) {
                        setDocumentPaymentDetails(inv.id, soPayment)
                        setShowInvoiceWizard(false)
                      }
                    } finally {
                      setCreatingWizardInvoice(false)
                    }
                  })()
                }}
              >
                {creatingWizardInvoice ? 'Creating…' : 'Create draft invoice'}
              </button>
            </div>
          </div>
        </Modal>
        )
      })()}

      {showPartialInvoiceModal && activeOrder && (
        <Modal title={`Create Partial Invoice — ${activeOrder.ref}`} onClose={() => setShowPartialInvoiceModal(false)} width={520}>
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--text-3)]">Choose how much of each invoiceable line to bill now (capped by Ordered or Delivered policy). Leave a line at 0 to invoice it later.</p>
            <div className="flex flex-col gap-3">
              {invoiceableLinesFor(activeOrder).map(l => (
                <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] sales-partial-invoice-row">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--text-1)] truncate">{l.label}</p>
                    <p className="text-[10px] text-[var(--text-4)]">Up to {l.maxQty} invoiceable now</p>
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

      {/* Revision history — immutable lineage created through “Revise Quotation”.
          Most quotations have exactly one row here (never versioned). */}
      {showVersionHistory && (
        <Modal title="Revision History" onClose={() => { setShowVersionHistory(false); setVersionHistoryRows([]) }} width={560}>
          <div className="flex flex-col gap-3">
            {loadingVersionHistory ? (
              <p className="text-xs text-[var(--text-3)]">Loading revisions…</p>
            ) : versionHistoryRows.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">No earlier revisions found.</p>
            ) : (
              versionHistoryRows.map((v, idx) => {
                const prev = idx > 0 ? versionHistoryRows[idx - 1] : null
                return (
                  <div key={v.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] sales-version-card">
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
                    <div className="flex items-center gap-2 flex-shrink-0 sales-version-card__actions">
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
              <div className="overflow-x-auto sales-version-compare-wrap">
                <table className="erp-table sales-version-compare-table">
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
          message={
            saleOrderIsAccepted(activeOrder)
              ? `Reset ${activeOrder.ref} to draft? This clears the customer acceptance stamp and unlocks commercial edits. You can send again after saving.`
              : `Reset ${activeOrder.ref} to draft so it can be edited? You can send it again after saving your changes.`
          }
          onConfirm={() => {
            void (async () => {
              const ok = await Promise.resolve(resetSOToDraft(activeOrder.id))
              if (ok !== false) setShowResetDraftConfirm(false)
            })()
          }}
          onCancel={() => setShowResetDraftConfirm(false)}
        />
      )}
      {showCreditNoteModal && activeOrder && (
        <Modal title={`Credit note — ${activeOrder.ref}`} onClose={() => setShowCreditNoteModal(false)} width={440}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--text-3)]">
              Issues a customer credit against the posted invoice for this order. Commission was already earned when the invoice was posted.
            </p>
            <Field label="Amount (KES)">
              <Input value={creditNoteAmount} onChange={setCreditNoteAmount} placeholder="0" />
            </Field>
            <Field label="Reason">
              <Input value={creditNoteReason} onChange={setCreditNoteReason} placeholder="Return / pricing adjustment…" />
            </Field>
            <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
              <button type="button" className="btn-outline text-xs" onClick={() => setShowCreditNoteModal(false)}>Cancel</button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => {
                  void (async () => {
                    const ref = await issueCreditNoteFromSaleOrder(
                      activeOrder.id,
                      Number(creditNoteAmount) || 0,
                      creditNoteReason,
                    )
                    if (ref) setShowCreditNoteModal(false)
                  })()
                }}
              >
                Issue credit note
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showConfirmQuoteDialog && activeOrder && isQuotationStage(activeOrder.status) && (
        <ConfirmQuotationDialog
          orderRef={activeOrder.ref}
          customerName={activeOrder.customerName}
          total={activeOrder.total}
          validUntil={activeOrder.validUntil}
          deliveryDate={activeOrder.deliveryDate}
          lines={activeOrder.lines as any}
          headerDiscount={Number(activeOrder.discountAmount) || 0}
          stockAvailable={productId => {
            const byLoc = getStockByLocation(productId)
            return (byLoc.warehouse ?? 0) + (byLoc.shop ?? 0)
          }}
          isNonStockLine={line => isNonStockSaleLine(line, products.find(p => p.id === line.productId) ?? null)}
          approvalBlockers={(approvalRequests ?? [])
            .filter(r =>
              r.documentId === activeOrder.id
              && isSalesConfirmGatingApproval(r.type, systemSettings)
              && r.status === 'pending',
            )
            .map(r => ({
              type: r.type,
              status: 'pending' as const,
              reason: String((r.details as any)?.reason || `${r.type.replace(/_/g, ' ')} approval pending`),
            }))}
          canReserve={canReserveOnConfirm}
          canSkipReserve={canSkipReserveOnConfirm && canReserveOnConfirm}
          confirming={confirmingSO}
          onClose={() => setShowConfirmQuoteDialog(false)}
          onConfirm={(mode, qtyByLineId) => void runConfirmQuotation(mode, qtyByLineId)}
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
