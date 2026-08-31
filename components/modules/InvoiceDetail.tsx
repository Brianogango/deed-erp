'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  faPencil,
  faMoneyBillWave,
  faArrowUp,
  faArrowDown,
  faPlus,
  faTruck,
  faCalendarDay,
  faUser,
  faFileInvoice,
  faCheck,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons'
import { useFinanceStore, useDeliveryStore, fmtKes, fmtDate } from '@/lib/store'
import { canCancelOrResetInvoice, canApplyCustomerCredit } from '@/lib/finance-controls'
import { invoiceDocState, invoicePaymentStatus, isInvoiceOverdue, displayDocRef, INVOICE_DOC_STATE_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/odoo-sales-flow'
import { Modal, Field, Input, Select, Confirm, ModuleSkeleton, useMounted } from '@/components/ui'
import { Breadcrumbs, PrimaryActionButton, RecordHeader, SecondaryActionMenu, StatusBadge } from '@/components/erp'
import Chatter from '@/components/erp/Chatter'
import { Fa } from '@/components/icons'
import { OutboundReleasePanel, OrcStatusBadge } from './OutboundReleasePanel'
import { downloadInvoicePdf, invoicePdfBase64 } from './invoice-pdf'
import PaymentDetailsPicker from '@/components/payment/PaymentDetailsPicker'
import DocumentEmailSendHistory from '@/components/email/DocumentEmailSendHistory'
import { ScheduleInvoiceDeliveryModal } from './ScheduleInvoiceDeliveryModal'
import { canScheduleInvoiceDelivery, findInvoiceDeliveryJob } from '@/lib/invoice-delivery-job'
import { financeInvoiceListPath, parseFinanceListPage } from '@/lib/finance-invoice'
import {
  alignPaymentDetailsToTax,
  documentHasVat,
  normalizeDocumentPaymentDetails,
  paymentDetailsEqual,
} from '@/lib/document-payment-details'
import { fetchMpesaStatus, sendMpesaStk, waitForMpesaStk } from '@/lib/mpesa/client'
import { normalizeMpesaPhone } from '@/lib/mpesa/phone'

const today = () => new Date().toISOString().slice(0, 10)

export default function InvoiceDetail() {
  const mounted = useMounted()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const listPage = parseFinanceListPage(searchParams.get('listPage') ?? searchParams.get('page'))
  const goToDocumentList = (type?: string | null) => {
    const params = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : searchParams
    const livePage = parseFinanceListPage(params.get('listPage') ?? params.get('page'))
    router.push(financeInvoiceListPath(type, { page: livePage }))
  }
  const {
    invoices,
    contacts,
    saleOrders,
    deliveries,
    bankAccounts,
    companySettings,
    outboundReleases,
    initRelease,
    serials,
    registerPayment,
    setInvoicePaymentBlocked,
    resetInvoiceToDraft,
    cancelInvoice,
    applyCustomerCreditToInvoice,
    getCustomerCreditBalance,
    deleteInvoice,
    postInvoice,
    updateInvoice,
    moveInvoiceLine,
    addInvoiceSection,
    showToast,
    users,
    currentUserId,
    getDocumentPaymentDetails,
    setDocumentPaymentDetails,
    scheduleInvoiceDelivery,
  } = useFinanceStore()

  const { deliveryJobs, riders } = useDeliveryStore()

  const currentUser = users.find(u => u.id === currentUserId)
  const canManageFinance = ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')
  const canManageFullFinance = ['director', 'finance_officer'].includes(currentUser?.role ?? '')
  const canCancelOrReset = canCancelOrResetInvoice(currentUser?.role)
  const canApplyCredit = canApplyCustomerCredit(currentUser?.role)
  const invoice = invoices.find(i => i.id === id)

  const [showPayModal, setShowPayModal] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('mpesa')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [payReference, setPayReference] = useState('')
  const [payDate, setPayDate] = useState(today())
  const [payPhone, setPayPhone] = useState('')
  const [darajaReady, setDarajaReady] = useState(false)
  const [stkBusy, setStkBusy] = useState(false)
  const [stkStatus, setStkStatus] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [showResetDraft, setShowResetDraft] = useState(false)
  const [showOrc, setShowOrc] = useState(false)
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  const [sendingInvoice, setSendingInvoice] = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sendCc, setSendCc] = useState('')
  const [sendMessage, setSendMessage] = useState('')
  const [emailHistoryKey, setEmailHistoryKey] = useState(0)
  const [hydratingLines, setHydratingLines] = useState(false)
  const [lookupReady, setLookupReady] = useState(false)
  const [detailTab, setDetailTab] = useState<'payments' | 'notes' | 'activity' | 'instructions'>('payments')
  const hydrateAttempted = useRef<string | null>(null)

  // Wait briefly for store hydration before declaring the invoice missing —
  // a hard refresh can render before deed_invoices is loaded.
  useEffect(() => {
    if (invoice) {
      setLookupReady(true)
      return
    }
    setLookupReady(false)
    const t = window.setTimeout(() => setLookupReady(true), 2000)
    return () => window.clearTimeout(t)
  }, [invoice, id])

  // Heal empty-line drafts from Prisma (e.g. SO→invoice shell overwrite).
  useEffect(() => {
    if (!invoice?.id) return
    if ((invoice.lines || []).length > 0) {
      hydrateAttempted.current = null
      return
    }
    if (hydrateAttempted.current === invoice.id) return
    hydrateAttempted.current = invoice.id
    let cancelled = false
    setHydratingLines(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/invoices/${invoice.id}`)
        if (!res.ok || cancelled) return
        const data = await res.json() as {
          items?: Array<{
            id?: string; description?: string | null; qty?: number; unitPrice?: number
            taxRate?: number; discountPct?: number; lineSubtotal?: number; productId?: string | null
          }>
          subtotal?: number; taxAmount?: number; totalAmount?: number
        }
        const items = Array.isArray(data.items) ? data.items : []
        if (cancelled || items.length === 0) return
        updateInvoice(invoice.id, {
          lines: items.map((item, idx) => {
            const discountPct = Math.min(100, Math.max(0, Number(item.discountPct) || 0))
            const qty = Number(item.qty) || 0
            const unitPrice = Number(item.unitPrice) || 0
            const isSection = !item.productId && qty === 0 && unitPrice === 0
            if (isSection) {
              return {
                id: item.id ?? `line-${idx}`,
                lineType: 'section' as const,
                description: item.description ?? '',
                qty: 0,
                unitPrice: 0,
                taxRate: 0,
                subtotal: 0,
              }
            }
            return {
              id: item.id ?? `line-${idx}`,
              lineType: 'item' as const,
              description: item.description ?? '',
              qty,
              unitPrice,
              taxRate: Number(item.taxRate) || 0,
              ...(discountPct > 0 ? { discountPct } : {}),
              subtotal: Number(item.lineSubtotal) || Math.round(qty * unitPrice * (1 - discountPct / 100)),
              ...(item.productId ? { productId: item.productId } : {}),
            }
          }),
          ...(Number(data.subtotal) ? { subtotal: Number(data.subtotal) } : {}),
          ...(data.taxAmount != null ? { taxTotal: Number(data.taxAmount) || 0 } : {}),
          ...(Number(data.totalAmount) ? { total: Number(data.totalAmount) } : {}),
        })
      } catch {
        // best-effort heal
      } finally {
        if (!cancelled) setHydratingLines(false)
      }
    })()
    return () => { cancelled = true }
  }, [invoice?.id, invoice?.lines?.length, updateInvoice])


  // Keep payment bank aligned: VAT → NCBA; non-VAT → ABSA / I&M
  useEffect(() => {
    if (!invoice || invoice.type !== 'customer_invoice') return
    const current = normalizeDocumentPaymentDetails(getDocumentPaymentDetails(invoice.id))
    const next = alignPaymentDetailsToTax(current, documentHasVat(invoice), bankAccounts)
    if (!paymentDetailsEqual(current, next)) {
      setDocumentPaymentDetails(invoice.id, next)
    }
  }, [
    invoice?.id,
    invoice?.type,
    invoice?.taxTotal,
    invoice?.lines,
    bankAccounts,
    getDocumentPaymentDetails,
    setDocumentPaymentDetails,
  ])

  useEffect(() => {
    void fetchMpesaStatus()
      .then(s => setDarajaReady(s.configured))
      .catch(() => setDarajaReady(false))
  }, [])

  useEffect(() => {
    if (!showPayModal) return
    const contact = contacts.find(c => c.id === invoice?.partnerId)
    const phone = contact?.mobile || contact?.phone || ''
    if (phone) setPayPhone(phone)
  }, [showPayModal, contacts, invoice?.partnerId])

  if (!mounted) return <ModuleSkeleton />

  if (!invoice && !lookupReady) return <ModuleSkeleton />

  if (!invoice) {
    return (
      <div className="mod-page">
        <RecordHeader
          title="Invoice not found"
          onBack={() => goToDocumentList('customer_invoice')}
          backLabel="Back to invoices"
        />
        <div className="mod-body p-12 text-center text-[var(--text-3)] text-sm">Invoice not found.</div>
      </div>
    )
  }

  const docLabel = invoice.type === 'customer_invoice' ? 'Invoice' : 'Bill'
  const documentListPath = financeInvoiceListPath(invoice.type, { page: listPage })
  const balance = Math.max(0, invoice.total - invoice.amountPaid)
  const pct = invoice.total > 0 ? Math.min(100, (invoice.amountPaid / invoice.total) * 100) : 0
  // Odoo semantics: document state + separately computed payment status.
  const docState = invoiceDocState(invoice.status)
  const payState = invoicePaymentStatus(invoice)
  const overdue = isInvoiceOverdue(invoice)
  const badgeStatus = payState === 'paid' ? 'active' : payState === 'blocked' || docState === 'cancelled' ? 'cancelled' : payState === 'partially_paid' || payState === 'in_payment' ? 'warning' : 'pending'
  const existingOrc = outboundReleases?.find(r => r.invoiceId === invoice.id && r.status !== 'voided')
  const serialLines = (invoice.lines || []).filter(l => l.productId)
  const activeBanks = bankAccounts.filter(a => a.active)
  const partnerEmail = contacts.find(c => c.id === invoice.partnerId)?.email
  const partnerContact = contacts.find(c => c.id === invoice.partnerId)
  const availableCredit = invoice.type === 'customer_invoice' ? getCustomerCreditBalance(invoice.partnerId) : 0
  const linkedDeliveryJob = findInvoiceDeliveryJob(deliveryJobs, invoice)
  const showScheduleDelivery = canScheduleInvoiceDelivery(invoice, linkedDeliveryJob)
  const companyPickup = [companySettings.name, companySettings.address, companySettings.city].filter(Boolean).join(', ')
  const linkedSaleOrder = saleOrders.find((order: any) => (
    order.id === (invoice as any).saleOrderId
    || order.id === (invoice as any).salesOrderId
    || order.ref === (invoice as any).saleOrderRef
    || order.ref === (invoice as any).salesOrderRef
    || order.ref === (invoice as any).sourceRef
  ))
  const invoiceWorkflowSteps = (() => {
    const isPosted = docState === 'posted'
    const isPartPaid = isPosted && (payState === 'partially_paid' || payState === 'in_payment')
    const isPaid = isPosted && payState === 'paid'
    return [
      { key: 'draft', label: 'Draft', state: docState === 'draft' ? 'current' : isPosted ? 'done' : 'todo' },
      { key: 'posted', label: 'Posted', state: docState === 'draft' ? 'todo' : isPartPaid || isPaid ? 'done' : isPosted ? 'current' : 'todo' },
      { key: 'part-paid', label: 'Part Paid', state: isPaid ? 'done' : isPartPaid ? 'current' : 'todo' },
      { key: 'paid', label: 'Paid', state: isPaid ? 'current' : 'todo' },
    ] as Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }>
  })()
  const invoiceSmartButtons = [
    { key: 'customer', label: invoice.type === 'customer_invoice' ? 'Customer' : 'Vendor', value: invoice.partnerName || 'Not set' },
    { key: 'payments', label: 'Payments', value: String((invoice.payments || []).length) },
    { key: 'sales-order', label: 'Sales Order', value: linkedSaleOrder ? '1' : '0' },
    { key: 'delivery', label: 'Delivery', value: linkedDeliveryJob ? '1' : '0' },
    { key: 'credit-notes', label: 'Credit Notes', value: '0' },
    { key: 'activities', label: 'Activities', value: '2' },
  ]

  const handlePayment = () => {
    if (!payAmount || Number(payAmount) <= 0) return
    if (balance <= 0) { showToast('Invoice is already fully paid', 'info'); return }
    if (payMethod === 'bank_transfer' && !payBankAccountId) { showToast('Select a bank account for bank transfer payments', 'error'); return }
    registerPayment(invoice.id, Number(payAmount), payMethod, payBankAccountId || undefined, payReference, payDate)
    setShowPayModal(false)
    setPayAmount('')
    setPayReference('')
    setPayDate(today())
    setStkStatus('')
  }

  const handleSendStk = async () => {
    if (!invoice || invoice.type !== 'customer_invoice') return
    const amount = Number(payAmount)
    if (!amount || amount <= 0) { showToast('Enter the amount to collect', 'error'); return }
    const phone = normalizeMpesaPhone(payPhone)
    if (!phone) { showToast('Enter a valid M-Pesa number (07XX …)', 'error'); return }
    setStkBusy(true)
    setStkStatus('Sending M-Pesa prompt…')
    try {
      const pushed = await sendMpesaStk({
        phone,
        amount: Math.min(amount, balance),
        accountReference: displayDocRef(invoice.ref),
        transactionDesc: 'Invoice',
        source: 'invoice',
        invoiceId: invoice.id,
      })
      setStkStatus(pushed.customerMessage || 'Ask the customer to enter their PIN')
      const settled = await waitForMpesaStk(pushed.checkoutRequestId)
      if (settled.status !== 'success') {
        showToast(settled.resultDesc || 'M-Pesa prompt was not completed', 'error')
        setStkStatus(settled.resultDesc || 'Not completed')
        return
      }
      const receipt = settled.mpesaReceipt || settled.checkoutRequestId
      setPayReference(receipt)
      registerPayment(invoice.id, Math.min(amount, balance), 'mpesa', payBankAccountId || undefined, receipt, payDate)
      setShowPayModal(false)
      setPayAmount('')
      setPayReference('')
      setPayDate(today())
      setStkStatus('')
      showToast(`M-Pesa ${receipt} recorded`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'M-Pesa prompt failed', 'error')
      setStkStatus('')
    } finally {
      setStkBusy(false)
    }
  }

  const handlePrepareRelease = () => {
    if (existingOrc) { setShowOrc(true); return }
    const invSerials = (invoice.lines || [])
      .filter(l => l.productId)
      .flatMap(l => {
        const srl = serials?.filter(s => s.productId === l.productId && (s.status === 'assigned' || s.status === 'available')) || []
        return srl.slice(0, l.qty).map(s => ({ serialNumberId: s.id, expectedSerial: s.serial || s.barcode || s.id }))
      })
    initRelease({
      invoiceId: invoice.id,
      clientId: invoice.partnerId || '',
      clientName: invoice.partnerName,
      sourceRef: invoice.ref,
      sourceType: 'invoice',
      serials: invSerials.length ? invSerials : [{ serialNumberId: invoice.id, expectedSerial: `INV-${invoice.ref}` }],
    })
    setShowOrc(true)
  }

  const openSendInvoiceModal = () => {
    setSendTo(partnerEmail || '')
    setSendCc('')
    setSendMessage(`Please find ${docLabel.toLowerCase()} ${invoice.ref} attached.`)
    setShowSendModal(true)
  }

  const handleSendInvoice = async () => {
    if (sendingInvoice) return
    if (!sendTo.trim()) {
      showToast('Enter the recipient email address before sending.', 'error')
      return
    }
    setSendingInvoice(true)
    try {
      // Attach the same Odoo-style PDF the download button produces.
      let attachment: { pdfBase64: string; pdfFilename: string } | undefined
      try {
        attachment = await invoicePdfBase64(
          invoice,
          saleOrders,
          contacts,
          companySettings,
          bankAccounts,
          getDocumentPaymentDetails(invoice.id),
        )
      } catch { /* the email still sends without the attachment */ }
      const res = await fetch(`/api/invoices/${invoice.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: sendTo.trim(),
          cc: sendCc.trim() || undefined,
          message: sendMessage.trim() || undefined,
          ...(attachment ?? {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      setEmailHistoryKey(k => k + 1)
      if (!res.ok || body?.success === false) throw new Error(body?.error || 'Email could not be sent')
      const ccNote = Array.isArray(body?.cc) && body.cc.length ? ` (Cc ${body.cc.join(', ')})` : ''
      showToast(`${docLabel} emailed to ${body.to || sendTo}${ccNote}`, 'success')
      setShowSendModal(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Email could not be sent', 'error')
    } finally {
      setSendingInvoice(false)
    }
  }

  const handleDownloadInvoice = async () => {
    // Downloads are real PDFs (Odoo-style layout), never HTML files.
    try {
      await downloadInvoicePdf(
        invoice,
        saleOrders,
        contacts,
        companySettings,
        bankAccounts,
        getDocumentPaymentDetails(invoice.id),
      )
    } catch {
      showToast('PDF generation failed', 'error')
    }
  }

  const paying = Math.min(Number(payAmount) || 0, balance)
  const willFullyPay = paying >= balance
  const overpay = (Number(payAmount) || 0) > balance
  const invoiceIsVat = documentHasVat(invoice)
  const titleRef = invoice.ref.startsWith('DRAFT/') ? displayDocRef(invoice.ref) : invoice.ref
  const partnerCountry = partnerContact?.country || 'Kenya'
  const dueDays = (() => {
    if (!invoice.dueDate) return null
    const due = new Date(`${invoice.dueDate}T00:00:00`)
    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0)
    return Math.round((due.getTime() - todayDate.getTime()) / 86_400_000)
  })()
  const dueDaysLabel = dueDays == null
    ? ''
    : dueDays < 0
      ? `${Math.abs(dueDays)} day${Math.abs(dueDays) === 1 ? '' : 's'} overdue`
      : dueDays === 0
        ? 'Due today'
        : `${dueDays} day${dueDays === 1 ? '' : 's'}`
  const moreActions = [
    {
      id: 'download',
      label: `Download ${docLabel}`,
      onClick: () => { void handleDownloadInvoice() },
    },
    {
      id: 'email',
      label: sendingInvoice ? 'Sending…' : `Email ${docLabel}`,
      onClick: openSendInvoiceModal,
      disabled: sendingInvoice,
      hidden: !(invoice.type === 'customer_invoice' && invoice.status !== 'draft'),
    },
    {
      id: 'block',
      label: invoice.paymentBlocked ? 'Release payment block' : 'Block payment (dispute)',
      onClick: () => setInvoicePaymentBlocked(invoice.id, !invoice.paymentBlocked),
      hidden: !(docState === 'posted' && payState !== 'paid' && canManageFullFinance),
    },
    {
      id: 'reset',
      label: 'Reset to Draft',
      onClick: () => setShowResetDraft(true),
      hidden: !(invoice.status !== 'draft' && invoice.status !== 'cancelled' && invoice.amountPaid <= 0 && canCancelOrReset),
    },
    {
      id: 'cancel',
      label: `Cancel ${docLabel}`,
      onClick: () => setShowCancel(true),
      danger: true,
      hidden: !(invoice.status !== 'draft' && invoice.status !== 'cancelled' && canCancelOrReset),
    },
    {
      id: 'release',
      label: existingOrc ? 'View release' : 'Prepare release',
      onClick: handlePrepareRelease,
      hidden: !(docState === 'posted' && invoice.type === 'customer_invoice' && serialLines.length > 0 && existingOrc?.status !== 'released'),
    },
    {
      id: 'delivery',
      label: 'Schedule delivery',
      onClick: () => setShowDeliveryModal(true),
      hidden: !(showScheduleDelivery && canManageFinance),
    },
    {
      id: 'credit',
      label: `Apply credit (${fmtKes(Math.min(availableCredit, balance))})`,
      onClick: () => applyCustomerCreditToInvoice(invoice.id),
      hidden: !(invoice.type === 'customer_invoice' && balance > 0 && availableCredit > 0 && invoice.status !== 'draft' && invoice.status !== 'cancelled' && canApplyCredit),
    },
    {
      id: 'edit',
      label: 'Edit',
      onClick: () => router.push(`/finance?tab=${invoice.type === 'customer_invoice' ? 'invoices' : 'bills'}&edit=${invoice.id}`),
      hidden: !(invoice.status === 'draft' && canManageFinance),
    },
    {
      id: 'delete',
      label: 'Delete',
      onClick: () => setShowDelete(true),
      danger: true,
      hidden: !(invoice.status === 'draft' && canManageFinance),
    },
    {
      id: 'confirm',
      label: `Confirm ${docLabel}`,
      onClick: () => postInvoice(invoice.id),
      hidden: !(invoice.status === 'draft' && canManageFinance),
    },
  ]

  return (
    <div className="mod-page invoice-detail finance-workspace finance-invoice-detail">
      <div className="invoice-detail__chrome">
        <Breadcrumbs
          items={[
            { label: invoice.type === 'customer_invoice' ? 'Invoices' : 'Bills', onClick: () => goToDocumentList(invoice.type) },
            { label: titleRef },
          ]}
        />

        <div className="invoice-detail__header">
          <div className="invoice-detail__header-main">
            <div className="invoice-detail__title-row">
              <div className="invoice-detail__identity">
                <h1 className="invoice-detail__title">{invoice.type === 'customer_invoice' ? 'Customer invoice' : 'Vendor bill'}</h1>
                <p className="invoice-detail__ref">{titleRef}</p>
              </div>
              {docState === 'posted' && (
                <StatusBadge status="active" label={INVOICE_DOC_STATE_LABELS[docState]} />
              )}
              {docState === 'draft' && (
                <StatusBadge status="draft" label={INVOICE_DOC_STATE_LABELS[docState]} />
              )}
              {docState === 'cancelled' && (
                <StatusBadge status="cancelled" label={INVOICE_DOC_STATE_LABELS[docState]} />
              )}
              {docState === 'posted' && (
                <StatusBadge
                  status={badgeStatus as string}
                  label={PAYMENT_STATUS_LABELS[payState]}
                />
              )}
              {overdue && <StatusBadge status="cancelled" label="Overdue" />}
            </div>
            <p className="invoice-detail__customer">{invoice.partnerName}</p>
            {invoice.type === 'customer_invoice' && availableCredit > 0 && (
              <p className="invoice-detail__country">Store credit {fmtKes(availableCredit)} — apply from More actions</p>
            )}
            <p className="invoice-detail__country">{partnerCountry}</p>
            <div className="invoice-detail__dates">
              <span className="invoice-detail__date-item">
                <Fa icon={faCalendarDay} aria-hidden="true" />
                <span>Invoice Date: <strong>{fmtDate(invoice.date)}</strong></span>
              </span>
              <span className={`invoice-detail__date-item ${overdue || (dueDays != null && dueDays <= 7) ? 'is-alert' : ''}`}>
                <Fa icon={faCalendarDay} aria-hidden="true" />
                <span>
                  Due Date: <strong>{fmtDate(invoice.dueDate)}</strong>
                  {dueDaysLabel ? <em> ({dueDaysLabel})</em> : null}
                </span>
              </span>
            </div>
          </div>

          <div className="invoice-detail__header-actions">
            {docState === 'draft' && canManageFinance && (
              <>
                <PrimaryActionButton
                  icon={<Fa icon={faCheck} />}
                  onClick={() => postInvoice(invoice.id)}
                  hideLabelOnMobile={false}
                >
                  Confirm {docLabel}
                </PrimaryActionButton>
                <PrimaryActionButton
                  icon={<Fa icon={faPencil} />}
                  variant="secondary"
                  onClick={() => router.push(`/finance?tab=${invoice.type === 'customer_invoice' ? 'invoices' : 'bills'}&edit=${invoice.id}`)}
                  hideLabelOnMobile={false}
                >
                  Edit
                </PrimaryActionButton>
              </>
            )}
            {docState === 'posted' && payState !== 'paid' && payState !== 'blocked' && canManageFinance && (
              <PrimaryActionButton
                icon={<Fa icon={faMoneyBillWave} />}
                onClick={() => { setPayAmount(String(balance)); setShowPayModal(true) }}
                hideLabelOnMobile={false}
              >
                Register payment
              </PrimaryActionButton>
            )}
            <SecondaryActionMenu actions={moreActions} label="More actions" ariaLabel="More actions" />
          </div>
        </div>

        <div className="invoice-detail__workflow" role="list" aria-label="Invoice workflow">
          {invoiceWorkflowSteps.map(step => (
            <span
              key={step.key}
              className="invoice-detail__workflow-step"
              role="listitem"
              data-state={step.state}
              aria-current={step.state === 'current' ? 'step' : undefined}
            >
              {step.label}
            </span>
          ))}
        </div>

        <div className="invoice-detail__smart-row" aria-label="Related invoice records">
          {invoiceSmartButtons.map(item => (
            <button key={item.key} type="button" className="invoice-detail__smart-button">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="mod-body invoice-detail__body">
        <section className={`invoice-detail__summary ${balance > 0 ? 'has-balance' : 'is-settled'}`} aria-label="Invoice financial summary">
          <div className="invoice-detail__summary-primary">
            <div className="invoice-detail__summary-label-row">
              <p className="invoice-detail__summary-label">{balance > 0 ? 'Balance due' : 'Invoice total'}</p>
              <span className={`invoice-detail__summary-status ${balance > 0 ? 'is-due' : 'is-paid'}`}>
                {PAYMENT_STATUS_LABELS[payState]}
              </span>
            </div>
            <p className="invoice-detail__summary-amount">{fmtKes(balance > 0 ? balance : invoice.total)}</p>
            <p className="invoice-detail__summary-context">
              {balance > 0
                ? `Due ${fmtDate(invoice.dueDate)}${dueDaysLabel ? ` · ${dueDaysLabel}` : ''}`
                : `Paid in full · ${fmtKes(invoice.amountPaid)} received`}
            </p>
          </div>

          <dl className="invoice-detail__summary-stats">
            <div>
              <dt>{balance > 0 ? 'Invoice total' : 'Balance'}</dt>
              <dd>{fmtKes(balance > 0 ? invoice.total : balance)}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{fmtKes(invoice.amountPaid)}</dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd className={overdue && balance > 0 ? 'is-overdue' : ''}>{fmtDate(invoice.dueDate)}</dd>
            </div>
          </dl>

          <div className="invoice-detail__summary-progress" aria-label={`${Math.round(pct)}% paid`}>
            <div className="invoice-detail__summary-progress-copy">
              <span>Payment progress</span>
              <strong>{Math.round(pct)}%</strong>
            </div>
            <div className="invoice-detail__summary-track" aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
            </div>
          </div>
        </section>

        <section className="invoice-detail__card" aria-label="Line items">
          <div className="invoice-detail__card-head">
            <h2 className="invoice-detail__card-title">Line Items</h2>
            {invoice.status === 'draft' && canManageFinance && (
              <div className="invoice-detail__card-tools">
                <button type="button" className="invoice-detail__text-btn" onClick={() => addInvoiceSection(invoice.id)}>
                  <Fa icon={faPlus} className="text-[10px]" /> Add a section
                </button>
                <button
                  type="button"
                  className="invoice-detail__text-btn invoice-detail__text-btn--accent"
                  onClick={() => router.push(`/finance?tab=${invoice.type === 'customer_invoice' ? 'invoices' : 'bills'}&edit=${invoice.id}`)}
                >
                  <Fa icon={faPencil} className="text-[10px]" /> Edit lines
                </button>
              </div>
            )}
          </div>

          {(invoice.lines || []).length > 0 || (invoice.status === 'draft' && canManageFinance) ? (
            <div className="invoice-detail__table-wrap">
              <table data-no-responsive className="invoice-detail__table">
                <thead>
                  <tr>
                    <th className="is-num">#</th>
                    <th>Description</th>
                    <th className="is-num">Qty</th>
                    <th className="is-num">Unit price</th>
                    <th className="is-num">Discount</th>
                    <th className="is-num">Tax</th>
                    <th className="is-num">Subtotal</th>
                    {invoice.status === 'draft' && canManageFinance && <th />}
                  </tr>
                </thead>
                <tbody>
                  {(invoice.lines || []).map((line, idx) => {
                    const canReorder = invoice.status === 'draft' && canManageFinance
                    const moveButtons = canReorder ? (
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveInvoiceLine(invoice.id, line.id, -1)}
                          disabled={idx === 0}
                          aria-label="Move line up"
                          className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Fa icon={faArrowUp} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveInvoiceLine(invoice.id, line.id, 1)}
                          disabled={idx === (invoice.lines || []).length - 1}
                          aria-label="Move line down"
                          className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Fa icon={faArrowDown} aria-hidden="true" />
                        </button>
                      </div>
                    ) : null
                    if (line.lineType === 'section') {
                      return (
                        <tr key={line.id || idx} className="invoice-detail__section-row">
                          <td className="is-num">{idx + 1}</td>
                          <td colSpan={5}>
                            {canReorder ? (
                              <input
                                aria-label="Section title"
                                className="form-input text-xs w-full font-bold"
                                value={line.description || ''}
                                placeholder="Section title"
                                onChange={e => {
                                  const title = e.target.value
                                  const lines = (invoice.lines || []).map(l =>
                                    l.id === line.id ? { ...l, description: title } : l,
                                  )
                                  updateInvoice(invoice.id, { lines })
                                }}
                              />
                            ) : (
                              <span className="font-bold">{line.description}</span>
                            )}
                          </td>
                          <td />
                          {canReorder && <td>{moveButtons}</td>}
                        </tr>
                      )
                    }
                    const rawDesc = (line.description || '').trim()
                    const desc = /^delivery charge$/i.test(rawDesc)
                      ? 'Rider delivery'
                      : (rawDesc || '—')
                    return (
                      <tr key={line.id || idx}>
                        <td className="is-num">{idx + 1}</td>
                        <td><span className="invoice-detail__line-desc">{desc}</span></td>
                        <td className="is-num">{line.qty}</td>
                        <td className="is-num">{fmtKes(line.unitPrice)}</td>
                        <td className="is-num">{(line.discountPct ?? 0) > 0 ? `${line.discountPct}%` : '0%'}</td>
                        <td className="is-num">{(line.taxRate ?? 0) > 0 ? `${line.taxRate}%` : '0%'}</td>
                        <td className="is-num is-strong">{fmtKes(line.subtotal)}</td>
                        {canReorder && <td>{moveButtons}</td>}
                      </tr>
                    )
                  })}
                  {(invoice.lines || []).length === 0 && (
                    <tr>
                      <td colSpan={8} className="invoice-detail__empty-cell">No line items yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="invoice-detail__empty">
              {hydratingLines ? 'Loading line items…' : 'No line items on this invoice.'}
            </p>
          )}

          <div className="invoice-detail__totals">
            <div className="invoice-detail__totals-row">
              <span>Subtotal</span>
              <span>{fmtKes(invoice.subtotal)}</span>
            </div>
            <div className="invoice-detail__totals-row">
              <span>Tax ({invoiceIsVat ? `${companySettings.vatRate}%` : '0%'})</span>
              <span>{fmtKes(invoice.taxTotal || 0)}</span>
            </div>
            <div className="invoice-detail__totals-row is-grand">
              <span>Total</span>
              <span>{fmtKes(invoice.total)}</span>
            </div>
          </div>
        </section>

        <details className="invoice-detail__supporting">
          <summary className="invoice-detail__supporting-toggle">
            <span>
              <strong>Supporting details</strong>
              <small>Customer addresses, delivery and accounting setup</small>
            </span>
            <Fa icon={faChevronDown} aria-hidden="true" />
          </summary>
          <section className="invoice-detail__info-grid" aria-label="Invoice information">
          <article className="invoice-detail__info-card">
            <header className="invoice-detail__info-head">
              <span className="invoice-detail__info-icon invoice-detail__info-icon--blue" aria-hidden="true">
                <Fa icon={faUser} />
              </span>
              <h3>Customer &amp; Addresses</h3>
              {invoice.status === 'draft' && canManageFinance && (
                <button
                  type="button"
                  className="invoice-detail__icon-edit"
                  aria-label="Edit customer addresses"
                  onClick={() => router.push(`/finance?tab=${invoice.type === 'customer_invoice' ? 'invoices' : 'bills'}&edit=${invoice.id}`)}
                >
                  <Fa icon={faPencil} />
                </button>
              )}
            </header>
            <p className="invoice-detail__info-strong">{invoice.partnerName}</p>
            <div className="invoice-detail__info-block">
              <p className="invoice-detail__label">Invoice address</p>
              <p className="invoice-detail__address">{invoice.invoiceAddress || partnerCountry || '—'}</p>
            </div>
            <div className="invoice-detail__info-block">
              <p className="invoice-detail__label">Delivery address</p>
              <p className="invoice-detail__address">{invoice.deliveryAddress || invoice.invoiceAddress || partnerCountry || '—'}</p>
            </div>
          </article>

          <article className="invoice-detail__info-card">
            <header className="invoice-detail__info-head">
              <span className="invoice-detail__info-icon invoice-detail__info-icon--green" aria-hidden="true">
                <Fa icon={faTruck} />
              </span>
              <h3>Delivery</h3>
              {linkedDeliveryJob && (
                <span className="invoice-detail__chip">{linkedDeliveryJob.status.replace('_', ' ')}</span>
              )}
            </header>
            {linkedDeliveryJob ? (
              <>
                <p className="invoice-detail__info-strong">{linkedDeliveryJob.ref}</p>
                <p className="invoice-detail__info-muted">
                  {linkedDeliveryJob.riderName || 'Rider TBD'}
                </p>
                <p className="invoice-detail__info-muted">{fmtDate(linkedDeliveryJob.scheduledDate)}</p>
                <p className="invoice-detail__info-muted">
                  Rider fee: {fmtKes(linkedDeliveryJob.riderFee)}
                  {linkedDeliveryJob.deliveryFee ? ` · Charge: ${fmtKes(linkedDeliveryJob.deliveryFee)}` : ''}
                </p>
                <button
                  type="button"
                  className="invoice-detail__link-btn"
                  onClick={() => router.push('/delivery')}
                >
                  View delivery
                </button>
              </>
            ) : showScheduleDelivery && canManageFinance ? (
              <>
                <p className="invoice-detail__info-muted">
                  {invoice.deliveryJobId
                    ? 'Previous rider delivery was cancelled. Schedule a new one.'
                    : 'No rider delivery scheduled.'}
                </p>
                <button
                  type="button"
                  className="invoice-detail__link-btn"
                  onClick={() => setShowDeliveryModal(true)}
                >
                  Schedule delivery
                </button>
              </>
            ) : invoice.deliveryJobId ? (
              <p className="invoice-detail__info-muted">Delivery job linked — loading details…</p>
            ) : (
              <p className="invoice-detail__info-muted">No delivery job linked.</p>
            )}
          </article>

          <article className="invoice-detail__info-card">
            <header className="invoice-detail__info-head">
              <span className="invoice-detail__info-icon invoice-detail__info-icon--navy" aria-hidden="true">
                <Fa icon={faFileInvoice} />
              </span>
              <h3>Invoice Details</h3>
            </header>
            <dl className="invoice-detail__dl">
              <div><dt>Payments</dt><dd>{(invoice.payments || []).length}</dd></div>
              <div><dt>Journal</dt><dd>{invoice.type === 'customer_invoice' ? 'Customer Invoices' : 'Vendor Bills'}</dd></div>
              <div><dt>Tax</dt><dd>{invoiceIsVat ? `VAT ${companySettings.vatRate}%` : 'Non-VAT'}</dd></div>
              <div><dt>Company</dt><dd>{companySettings.name}</dd></div>
              <div><dt>Currency</dt><dd>{companySettings.currency || 'KES'}</dd></div>
            </dl>
            {existingOrc && (
              <div className="mt-2">
                <OrcStatusBadge release={existingOrc} onClick={() => setShowOrc(true)} />
              </div>
            )}
            {existingOrc?.status === 'released' && (
              <p className="invoice-detail__released-inline"><Fa icon={faCheck} /> Released</p>
            )}
          </article>
          </section>
        </details>

        <section className="invoice-detail__tabs-card" aria-label="Notes payments and activity">
          <div className="invoice-detail__tabs" role="tablist">
            {([
              ['payments', 'Payments'],
              ['notes', `Notes`],
              ['activity', 'Activity'],
              ['instructions', 'Payment instructions'],
            ] as const).filter(([id]) => id !== 'instructions' || invoice.type === 'customer_invoice').map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={detailTab === id}
                className={`invoice-detail__tab ${detailTab === id ? 'is-active' : ''}`}
                onClick={() => setDetailTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="invoice-detail__tab-panel" role="tabpanel">
            {detailTab === 'notes' && (
              <div className="invoice-detail__tab-stack">
                <p className="invoice-detail__info-muted">
                  {invoice.notes?.trim() || 'No notes yet. Customer-facing notes can be set when editing the invoice.'}
                </p>
                {invoice.type === 'customer_invoice' && (
                  <DocumentEmailSendHistory
                    documentId={invoice.id}
                    documentType="invoice"
                    refreshKey={emailHistoryKey}
                    title="Invoice email history"
                  />
                )}
              </div>
            )}

            {detailTab === 'payments' && (
              (invoice.payments || []).length > 0 ? (
                <div className="invoice-detail__pay-list">
                  {(invoice.payments || []).map(pay => (
                    <div key={pay.id} className="invoice-detail__pay-row">
                      <div>
                        <p className="invoice-detail__pay-method">{pay.method.replace('_', ' ')}</p>
                        <p className="invoice-detail__pay-meta">
                          {fmtDate(pay.date)} · {pay.recordedBy}{pay.reference ? ` · ${pay.reference}` : ''}
                        </p>
                      </div>
                      <span className="invoice-detail__pay-amount">{fmtKes(pay.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="invoice-detail__info-muted">No payments recorded yet.</p>
              )
            )}

            {detailTab === 'instructions' && invoice.type === 'customer_invoice' && (
              <PaymentDetailsPicker
                className="invoice-detail__pay-settings"
                value={getDocumentPaymentDetails(invoice.id)}
                onChange={next => setDocumentPaymentDetails(invoice.id, next)}
                bankAccounts={bankAccounts}
                isVat={invoiceIsVat}
                readOnly={docState === 'cancelled' || !canManageFinance}
                defaultOpen
                label="Payment instructions printed on this invoice"
              />
            )}

            {detailTab === 'activity' && (
              <Chatter
                model="invoice"
                recordId={invoice.id}
                staffName={currentUser?.name || 'Staff'}
                title="Internal Notes & Activities"
                compact
              />
            )}
          </div>
        </section>
      </div>

      {showSendModal && (
        <Modal title={`Email ${docLabel} ${displayDocRef(invoice.ref)}`} onClose={() => setShowSendModal(false)} width={520}>
          <div className="flex flex-col gap-4">
            <Field label="Recipient Email *">
              <Input value={sendTo} onChange={setSendTo} placeholder="customer@example.com" />
            </Field>
            <Field label="Cc (optional)">
              <Input value={sendCc} onChange={setSendCc} placeholder="colleague@deed.co.ke, accounts@client.com" />
            </Field>
            <Field label="Message (optional)">
              <textarea
                className="form-input text-xs min-h-[90px]"
                value={sendMessage}
                onChange={e => setSendMessage(e.target.value)}
                placeholder="Note included above the invoice summary…"
              />
            </Field>
            <p className="text-[10px] text-[var(--text-4)]">The invoice PDF is attached automatically when available.</p>
            <DocumentEmailSendHistory
              documentId={invoice.id}
              documentType="invoice"
              refreshKey={emailHistoryKey}
              title="Previous sends"
            />
            <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
              <button className="btn-outline text-xs" onClick={() => setShowSendModal(false)}>Cancel</button>
              <button
                className="btn-primary text-xs"
                disabled={!sendTo.trim() || sendingInvoice}
                onClick={() => void handleSendInvoice()}
              >
                {sendingInvoice ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showDeliveryModal && (
        <ScheduleInvoiceDeliveryModal
          invoice={invoice}
          riders={riders}
          companyPickup={companyPickup}
          contactPhone={partnerContact?.phone || partnerContact?.mobile}
          onClose={() => setShowDeliveryModal(false)}
          onConfirm={opts => {
            const job = scheduleInvoiceDelivery(invoice.id, opts)
            if (job) setShowDeliveryModal(false)
          }}
        />
      )}

      {/* ── Register Payment modal ─────────────────────────────────────────── */}
      {showPayModal && (
        <Modal title="Register Payment" onClose={() => setShowPayModal(false)} width={420}>
          <div className="flex flex-col gap-4">
            {/* Invoice summary */}
            <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] flex justify-between">
              <div>
                <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">{docLabel}</p>
                <p className="text-xs font-bold text-[var(--text-1)]">{displayDocRef(invoice.ref)} · {invoice.partnerName}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Balance Due</p>
                <p className="text-xs font-black font-mono invoice-detail__amount--due">{fmtKes(balance)}</p>
              </div>
            </div>

            <Field label="Payment Date">
              <Input type="date" value={payDate} onChange={setPayDate} />
            </Field>

            <Field label={`Amount (max ${fmtKes(balance)})`}>
              <Input type="number" value={payAmount} onChange={setPayAmount} placeholder="0.00" />
              {overpay && (
                <p className="text-[10px] text-amber-600 mt-1 font-bold">Will be capped at {fmtKes(balance)}</p>
              )}
              {willFullyPay && !overpay && Number(payAmount) > 0 && (
                <p className="text-[10px] text-emerald-600 mt-1 font-bold">✓ This fully clears the {docLabel.toLowerCase()}</p>
              )}
              {paying > 0 && paying < balance && (
                <p className="text-[10px] text-[var(--text-4)] mt-1">Remaining after this: {fmtKes(balance - paying)}</p>
              )}
            </Field>

            <Field label="Payment Method">
              <Select
                value={payMethod}
                onChange={setPayMethod}
                options={[
                  { value: 'mpesa', label: 'M-Pesa' },
                  { value: 'bank_transfer', label: 'Bank Transfer' },
                  { value: 'cash', label: 'Cash' },
                  { value: 'card', label: 'Card' },
                  { value: 'cheque', label: 'Cheque' },
                ]}
              />
            </Field>

            {activeBanks.length > 0 && (
              <Field label="Journal — Bank / Cash Account Received To">
                <Select
                  value={payBankAccountId}
                  onChange={setPayBankAccountId}
                  options={activeBanks.map(b => ({ value: b.id, label: b.bankName || b.id }))}
                />
              </Field>
            )}

            <Field label="Memo / Reference">
              <Input
                value={payReference}
                onChange={setPayReference}
                placeholder="M-Pesa code, receipt no., cheque no..."
              />
            </Field>

            {payMethod === 'mpesa' && darajaReady && invoice.type === 'customer_invoice' && (
              <Field label="M-Pesa number">
                <Input value={payPhone} onChange={setPayPhone} placeholder="07XX XXX XXX" />
                {stkStatus && <p className="text-[11px] text-[var(--text-3)] mt-1">{stkStatus}</p>}
              </Field>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-outline" onClick={() => setShowPayModal(false)}>Cancel</button>
              {payMethod === 'mpesa' && darajaReady && invoice.type === 'customer_invoice' && (
                <button
                  className="btn-outline disabled:opacity-40"
                  disabled={!payAmount || Number(payAmount) <= 0 || balance <= 0 || stkBusy}
                  onClick={() => { void handleSendStk() }}
                >
                  {stkBusy ? 'Waiting for PIN…' : 'Send M-Pesa prompt'}
                </button>
              )}
              <button
                className="btn-primary disabled:opacity-40"
                disabled={!payAmount || Number(payAmount) <= 0 || balance <= 0 || stkBusy}
                onClick={handlePayment}
              >
                {willFullyPay || overpay ? 'Mark as Paid' : 'Record Partial Payment'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirmation (draft) */}
      {showDelete && (
        <Confirm
          message={`Delete this ${docLabel.toLowerCase()}? This cannot be undone.`}
          confirmLabel="Delete"
          confirmColor="bg-red-600 hover:bg-red-700"
          onConfirm={() => { deleteInvoice(invoice.id); router.push(documentListPath) }}
          onCancel={() => setShowDelete(false)}
        />
      )}

      {/* Cancel confirmation (posted) */}
      {showCancel && (
        <Confirm
          message={invoice.type === 'customer_invoice' && invoice.amountPaid > 0
            ? `Cancel this paid invoice? A credit note for ${fmtKes(Math.min(invoice.amountPaid, invoice.total))} will be created on ${invoice.partnerName}'s account for future purchases.`
            : `Cancel this ${docLabel.toLowerCase()}? It will be marked as cancelled and no further payments can be registered.`}
          confirmLabel={`Cancel ${docLabel}`}
          confirmColor="bg-orange-600 hover:bg-orange-700"
          onConfirm={() => {
            cancelInvoice(invoice.id)
            setShowCancel(false)
          }}
          onCancel={() => setShowCancel(false)}
        />
      )}

      {/* Reset confirmation */}
      {showResetDraft && (
        <Confirm
          message={`Reset this ${docLabel.toLowerCase()} to draft so it can be edited and saved? Any posting journals will be reversed.`}
          confirmLabel="Reset to Draft"
          confirmColor="bg-amber-600 hover:bg-amber-700"
          onConfirm={() => {
            resetInvoiceToDraft(invoice.id)
            setShowResetDraft(false)
          }}
          onCancel={() => setShowResetDraft(false)}
        />
      )}

      {/* Outbound Release Panel */}
      {showOrc && existingOrc && (
        <OutboundReleasePanel release={existingOrc} onClose={() => setShowOrc(false)} />
      )}
    </div>
  )
}
