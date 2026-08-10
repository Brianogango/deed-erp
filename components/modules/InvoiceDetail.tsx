'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  faBoxOpen,
  faBan,
  faTrash,
  faPencil,
  faDownload,
  faEnvelope,
  faMoneyBillWave,
  faRotateLeft,
  faCoins,
  faHandPaper,
  faUnlock,
  faArrowUp,
  faArrowDown,
  faPlus,
  faTruck,
} from '@fortawesome/free-solid-svg-icons'
import { useFinanceStore, useDeliveryStore, fmtKes, fmtDate } from '@/lib/store'
import { invoiceDocState, invoicePaymentStatus, isInvoiceOverdue, displayDocRef, INVOICE_DOC_STATE_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/odoo-sales-flow'
import { Badge, Modal, Field, Input, Select, Confirm, ModuleSkeleton, useMounted } from '@/components/ui'
import { RecordHeader, PrimaryActionButton } from '@/components/erp'
import Chatter from '@/components/erp/Chatter'
import { Fa } from '@/components/icons'
import { OutboundReleasePanel, OrcStatusBadge } from './OutboundReleasePanel'
import { downloadInvoicePdf, invoicePdfBase64 } from './invoice-pdf'
import PaymentDetailsPicker from '@/components/payment/PaymentDetailsPicker'
import DocumentEmailSendHistory from '@/components/email/DocumentEmailSendHistory'
import { ScheduleInvoiceDeliveryModal } from './ScheduleInvoiceDeliveryModal'
import { canScheduleInvoiceDelivery, findInvoiceDeliveryJob } from '@/lib/invoice-delivery-job'

const today = () => new Date().toISOString().slice(0, 10)

export default function InvoiceDetail() {
  const mounted = useMounted()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
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
  const invoice = invoices.find(i => i.id === id)

  const [showPayModal, setShowPayModal] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('mpesa')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [payReference, setPayReference] = useState('')
  const [payDate, setPayDate] = useState(today())
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

  if (!mounted) return <ModuleSkeleton />

  if (!invoice && !lookupReady) return <ModuleSkeleton />

  if (!invoice) {
    return (
      <div className="mod-page">
        <RecordHeader
          title="Invoice not found"
          onBack={() => router.push('/finance')}
          backLabel="Back to finance"
        />
        <div className="mod-body p-12 text-center text-[var(--text-3)] text-sm">Invoice not found.</div>
      </div>
    )
  }

  const docLabel = invoice.type === 'customer_invoice' ? 'Invoice' : 'Bill'
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

  const handlePayment = () => {
    if (!payAmount || Number(payAmount) <= 0) return
    if (balance <= 0) { showToast('Invoice is already fully paid', 'info'); return }
    if (payMethod === 'bank_transfer' && !payBankAccountId) { showToast('Select a bank account for bank transfer payments', 'error'); return }
    registerPayment(invoice.id, Number(payAmount), payMethod, payBankAccountId || undefined, payReference, payDate)
    setShowPayModal(false)
    setPayAmount('')
    setPayReference('')
    setPayDate(today())
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

  return (
    <div className="mod-page invoice-detail">
      <RecordHeader
        title={invoice.ref.startsWith('DRAFT/') ? displayDocRef(invoice.ref) : `${docLabel} ${invoice.ref}`}
        entity={invoice.partnerName}
        status={docState === 'draft' ? 'draft' : docState === 'cancelled' ? 'cancelled' : 'posted'}
        statusLabel={INVOICE_DOC_STATE_LABELS[docState]}
        onBack={() => router.push('/finance')}
        backLabel="Back to finance"
        primaryAction={docState === 'posted' && payState !== 'paid' && payState !== 'blocked' && canManageFinance ? (
          <PrimaryActionButton
            icon={<Fa icon={faMoneyBillWave} />}
            onClick={() => { setPayAmount(String(balance)); setShowPayModal(true) }}
            hideLabelOnMobile={false}
          >
            {balance > 0 ? `Register payment` : 'Register payment'}
          </PrimaryActionButton>
        ) : undefined}
        secondaryActions={
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {docState === 'posted' && <Badge status={badgeStatus as any} label={PAYMENT_STATUS_LABELS[payState]} />}
            {overdue && <Badge status="cancelled" label="Overdue" />}
            <button
              className="icon-btn w-9 h-9"
              onClick={handleDownloadInvoice}
              title={`Download ${docLabel}`}
              aria-label={`Download ${docLabel}`}
            >
              <Fa icon={faDownload} className="text-[12px]" />
            </button>
            {invoice.type === 'customer_invoice' && invoice.status !== 'draft' && (
              <button
                className="icon-btn w-9 h-9"
                onClick={openSendInvoiceModal}
                disabled={sendingInvoice}
                title={sendingInvoice ? 'Sending…' : `Email ${docLabel}`}
                aria-label={sendingInvoice ? 'Sending email' : `Email ${docLabel}`}
              >
                <Fa icon={faEnvelope} className="text-[12px]" />
              </button>
            )}
            {docState === 'posted' && payState !== 'paid' && canManageFullFinance && (
              <button
                className="icon-btn w-9 h-9"
                onClick={() => setInvoicePaymentBlocked(invoice.id, !invoice.paymentBlocked)}
                title={invoice.paymentBlocked ? 'Release payment block' : 'Block payment (dispute)'}
                aria-label={invoice.paymentBlocked ? 'Release payment block' : 'Block payment'}
              >
                <Fa icon={invoice.paymentBlocked ? faUnlock : faHandPaper} className="text-[12px]" />
              </button>
            )}
            {invoice.status !== 'draft' && invoice.status !== 'cancelled' && invoice.amountPaid <= 0 && canManageFullFinance && (
              <button
                className="icon-btn w-9 h-9"
                onClick={() => setShowResetDraft(true)}
                title="Reset to Draft"
                aria-label="Reset to Draft"
              >
                <Fa icon={faRotateLeft} className="text-[12px]" />
              </button>
            )}
            {invoice.status !== 'draft' && invoice.status !== 'cancelled' && canManageFullFinance && (
              <button
                className="icon-btn w-9 h-9"
                onClick={() => setShowCancel(true)}
                title={`Cancel ${docLabel}`}
                aria-label={`Cancel ${docLabel}`}
              >
                <Fa icon={faBan} className="text-[12px]" />
              </button>
            )}
          </div>
        }
      />

      <div className="mod-body invoice-detail__body">
        <div className="invoice-detail__sheet">
          {/* Money strip — one glance: total / paid / due */}
          {invoice.status !== 'draft' && (
            <section className="invoice-detail__money" aria-label="Payment summary">
              <div className="invoice-detail__money-grid">
                <div>
                  <p className="invoice-detail__label">{docLabel} total</p>
                  <p className="invoice-detail__amount font-mono">{fmtKes(invoice.total)}</p>
                </div>
                <div>
                  <p className="invoice-detail__label">Received</p>
                  <p className="invoice-detail__amount invoice-detail__amount--muted font-mono">{fmtKes(invoice.amountPaid)}</p>
                </div>
                <div className="invoice-detail__money-due">
                  <p className="invoice-detail__label">Balance due</p>
                  <p className={`invoice-detail__amount font-mono ${balance <= 0 ? 'invoice-detail__amount--paid' : 'invoice-detail__amount--due'}`}>{fmtKes(balance)}</p>
                </div>
              </div>
              <div className="invoice-detail__progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Percent paid">
                <div
                  className={`invoice-detail__progress-fill ${pct >= 100 ? 'is-paid' : 'is-open'}`}
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, pct / 100))})` }}
                />
              </div>
              <p className="invoice-detail__progress-caption">{Math.round(pct)}% paid</p>
            </section>
          )}

          <section className="invoice-detail__meta" aria-label="Invoice dates">
            <div>
              <p className="invoice-detail__label">Date</p>
              <p className="invoice-detail__meta-value">{fmtDate(invoice.date)}</p>
            </div>
            <div>
              <p className="invoice-detail__label">Due date</p>
              <p className={`invoice-detail__meta-value ${overdue ? 'invoice-detail__meta-value--alert' : ''}`}>{fmtDate(invoice.dueDate)}</p>
            </div>
            <div>
              <p className="invoice-detail__label">Payments</p>
              <p className="invoice-detail__meta-value tabular-nums">{(invoice.payments || []).length}</p>
            </div>
          </section>

          {(invoice.invoiceAddress || invoice.deliveryAddress) && (
            <section className="invoice-detail__addresses" aria-label="Addresses">
              {invoice.invoiceAddress && (
                <div>
                  <p className="invoice-detail__label">Invoice address</p>
                  <p className="invoice-detail__address">{invoice.invoiceAddress}</p>
                </div>
              )}
              {invoice.deliveryAddress && (
                <div>
                  <p className="invoice-detail__label">Delivery address</p>
                  <p className="invoice-detail__address">{invoice.deliveryAddress}</p>
                </div>
              )}
            </section>
          )}

          {linkedDeliveryJob && (
            <div className="invoice-detail__callout">
              <div className="invoice-detail__callout-icon" aria-hidden="true">
                <Fa icon={faTruck} className="text-[10px]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="invoice-detail__label">Rider delivery</p>
                <p className="invoice-detail__callout-body">
                  {linkedDeliveryJob.ref}
                  {linkedDeliveryJob.riderName ? ` · ${linkedDeliveryJob.riderName}` : ' · Rider TBD'}
                  {` · ${fmtDate(linkedDeliveryJob.scheduledDate)}`}
                  {` · fee ${fmtKes(linkedDeliveryJob.riderFee)}`}
                  {linkedDeliveryJob.deliveryFee ? ` · charge ${fmtKes(linkedDeliveryJob.deliveryFee)}` : ''}
                </p>
              </div>
              <span className="invoice-detail__chip">
                {linkedDeliveryJob.status.replace('_', ' ')}
              </span>
            </div>
          )}

          {/* Invoice Lines */}
          {(invoice.lines || []).length > 0 || (invoice.status === 'draft' && canManageFinance) ? (
            <section className="invoice-detail__section" aria-label="Line items">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="invoice-detail__section-title">Line items</p>
                {invoice.status === 'draft' && canManageFinance && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="invoice-detail__text-btn"
                      onClick={() => addInvoiceSection(invoice.id)}
                    >
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
              <div className="dt-scroll invoice-detail__table-wrap">
                <table data-no-responsive className="w-full text-xs">
                  <thead className="bg-[var(--bg-surface)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-[var(--text-4)]">Description</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Qty</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Unit Price</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Disc%</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Subtotal</th>
                      {invoice.status === 'draft' && canManageFinance && (
                        <th className="px-3 py-2 w-24"></th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-lt)]">
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
                          <tr key={line.id || idx} className="bg-[var(--bg-surface)]/70">
                            <td colSpan={5} className="px-3 py-2">
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
                                <span className="font-bold text-[var(--text-2)]">{line.description}</span>
                              )}
                            </td>
                            {canReorder && <td className="px-3 py-2 text-center">{moveButtons}</td>}
                          </tr>
                        )
                      }
                      return (
                        <tr key={line.id || idx} className="hover:bg-[var(--bg-surface)]">
                          <td className="px-3 py-2 text-[var(--text-1)]">{line.description}</td>
                          <td className="px-3 py-2 text-right text-[var(--text-3)]">{line.qty}</td>
                          <td className="px-3 py-2 text-right text-[var(--text-3)] font-mono">{fmtKes(line.unitPrice)}</td>
                          <td className="px-3 py-2 text-right text-[var(--text-3)] font-mono">{(line.discountPct ?? 0) > 0 ? `${line.discountPct}%` : '—'}</td>
                          <td className="px-3 py-2 text-right font-bold text-[var(--text-1)] font-mono">{fmtKes(line.subtotal)}</td>
                          {canReorder && <td className="px-3 py-2 text-center">{moveButtons}</td>}
                        </tr>
                      )
                    })}
                    {(invoice.lines || []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-xs text-[var(--text-4)]">
                          No line items yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-[var(--bg-surface)] border-t-2 border-[var(--border-lt)]">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Total</td>
                      <td className="px-3 py-2 text-right font-black text-[var(--text-1)] font-mono">{fmtKes(invoice.total)}</td>
                      {invoice.status === 'draft' && canManageFinance && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : (
            <p className="invoice-detail__empty">
              {hydratingLines ? 'Loading line items…' : 'No line items on this invoice.'}
            </p>
          )}

          {invoice.type === 'customer_invoice' && (
            <PaymentDetailsPicker
              value={getDocumentPaymentDetails(invoice.id)}
              onChange={next => setDocumentPaymentDetails(invoice.id, next)}
            />
          )}

          {/* Payment history */}
          {(invoice.payments || []).length > 0 && (
            <section className="invoice-detail__section" aria-label="Payment history">
              <p className="invoice-detail__section-title">Payment history</p>
              <div className="invoice-detail__table-wrap overflow-hidden">
                {(invoice.payments || []).map((pay) => (
                  <div key={pay.id} className="invoice-detail__pay-row">
                    <div>
                      <p className="invoice-detail__pay-method">{pay.method.replace('_', ' ')}</p>
                      <p className="invoice-detail__pay-meta">{fmtDate(pay.date)} · {pay.recordedBy}{pay.reference ? ` · ${pay.reference}` : ''}</p>
                    </div>
                    <span className="invoice-detail__pay-amount">{fmtKes(pay.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ORC badge if release exists */}
          {existingOrc && (
            <div className="flex items-center gap-2">
              <OrcStatusBadge release={existingOrc} onClick={() => setShowOrc(true)} />
            </div>
          )}

          {/* Actions */}
          <div className="invoice-detail__actions">
            {/* Prepare Release — shown for paid/posted invoices with serialised lines */}
            {docState === 'posted' && invoice.type === 'customer_invoice' && serialLines.length > 0 && (
              existingOrc?.status === 'released' ? (
                <div className="invoice-detail__released">
                  <Fa icon={faBoxOpen} /> Released
                </div>
              ) : (
                <button type="button" className="btn-primary invoice-detail__btn" onClick={handlePrepareRelease}>
                  <Fa icon={faBoxOpen} /> Prepare release
                </button>
              )
            )}
            {showScheduleDelivery && canManageFinance && (
              <button
                type="button"
                className="btn-secondary invoice-detail__btn"
                onClick={() => setShowDeliveryModal(true)}
              >
                <Fa icon={faTruck} /> Schedule delivery
              </button>
            )}
            {invoice.type === 'customer_invoice' && balance > 0 && availableCredit > 0 && invoice.status !== 'draft' && invoice.status !== 'cancelled' && canManageFullFinance && (
              <button
                type="button"
                className="btn-secondary invoice-detail__btn"
                onClick={() => applyCustomerCreditToInvoice(invoice.id)}
                title={`Available credit: ${fmtKes(availableCredit)}`}
              >
                <Fa icon={faCoins} /> Apply credit ({fmtKes(Math.min(availableCredit, balance))})
              </button>
            )}
            {invoice.status === 'draft' && canManageFinance && (
              <>
                <button
                  type="button"
                  className="btn-secondary invoice-detail__btn invoice-detail__btn--danger"
                  onClick={() => setShowDelete(true)}
                >
                  <Fa icon={faTrash} /> Delete
                </button>
                <button
                  type="button"
                  className="btn-secondary invoice-detail__btn"
                  onClick={() => router.push(`/finance?tab=${invoice.type === 'customer_invoice' ? 'invoices' : 'bills'}&edit=${invoice.id}`)}
                >
                  <Fa icon={faPencil} /> Edit
                </button>
                <button type="button" className="btn-primary invoice-detail__btn" onClick={() => postInvoice(invoice.id)}>
                  Confirm {docLabel}
                </button>
              </>
            )}
          </div>

          <Chatter
            model="invoice"
            recordId={invoice.id}
            staffName={currentUser?.name || 'Staff'}
            title="Internal Notes & Activities"
            compact
          />

          {invoice.type === 'customer_invoice' && (
            <DocumentEmailSendHistory
              documentId={invoice.id}
              documentType="invoice"
              refreshKey={emailHistoryKey}
              title="Invoice email history"
            />
          )}
        </div>
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

            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-outline" onClick={() => setShowPayModal(false)}>Cancel</button>
              <button
                className="btn-primary disabled:opacity-40"
                disabled={!payAmount || Number(payAmount) <= 0 || balance <= 0}
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
          onConfirm={() => { deleteInvoice(invoice.id); router.push('/finance') }}
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
