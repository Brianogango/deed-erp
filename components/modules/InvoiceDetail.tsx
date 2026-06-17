'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  faArrowLeft,
  faBoxOpen,
  faBan,
  faTrash,
  faPencil,
  faDownload,
  faRotateLeft,
  faCoins,
} from '@fortawesome/free-solid-svg-icons'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Confirm, ModuleSkeleton, useMounted } from '@/components/ui'
import { Fa } from '@/components/icons'
import { OutboundReleasePanel, OrcStatusBadge } from './OutboundReleasePanel'
import { generateInvoicesHtml } from './invoice-pdf'

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
    resetInvoiceToDraft,
    cancelInvoice,
    applyCustomerCreditToInvoice,
    getCustomerCreditBalance,
    deleteInvoice,
    postInvoice,
    showToast,
    users,
    currentUserId,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId)
  const canManageFinance = ['director', 'finance_officer'].includes(currentUser?.role ?? '')
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
  const [sendingInvoice, setSendingInvoice] = useState(false)

  if (!mounted) return <ModuleSkeleton />

  if (!invoice) {
    return (
      <div className="mod-page">
        <div className="mod-header">
          <button className="btn-secondary flex items-center gap-2" onClick={() => router.push('/finance')}>
            <Fa icon={faArrowLeft} /> Back to Finance
          </button>
        </div>
        <div className="mod-body p-12 text-center text-[var(--text-3)] text-sm">Invoice not found.</div>
      </div>
    )
  }

  const docLabel = invoice.type === 'customer_invoice' ? 'Invoice' : 'Bill'
  const balance = Math.max(0, invoice.total - invoice.amountPaid)
  const pct = invoice.total > 0 ? Math.min(100, (invoice.amountPaid / invoice.total) * 100) : 0
  const badgeStatus = invoice.status === 'paid' ? 'active' : invoice.status === 'overdue' ? 'cancelled' : invoice.status === 'partially_paid' ? 'warning' : 'pending'
  const existingOrc = outboundReleases?.find(r => r.invoiceId === invoice.id && r.status !== 'voided')
  const serialLines = (invoice.lines || []).filter(l => l.productId)
  const activeBanks = bankAccounts.filter(a => a.active)
  const partnerEmail = contacts.find(c => c.id === invoice.partnerId)?.email
  const availableCredit = invoice.type === 'customer_invoice' ? getCustomerCreditBalance(invoice.partnerId) : 0

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

  const handleSendInvoice = async () => {
    if (sendingInvoice) return
    setSendingInvoice(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: partnerEmail || undefined,
          message: `Please find ${docLabel.toLowerCase()} ${invoice.ref} below.`,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.success === false) throw new Error(body?.error || 'Email could not be sent')
      showToast(`${docLabel} emailed to ${body.to || partnerEmail || invoice.partnerName}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Email could not be sent', 'error')
    } finally {
      setSendingInvoice(false)
    }
  }

  const handleDownloadInvoice = () => {
    const html = generateInvoicesHtml([invoice], saleOrders, deliveries, serials, companySettings, bankAccounts)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${invoice.ref}-${docLabel.toLowerCase()}.html`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const paying = Math.min(Number(payAmount) || 0, balance)
  const willFullyPay = paying >= balance
  const overpay = (Number(payAmount) || 0) > balance

  return (
    <div className="mod-page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border border-[var(--border-lt)] hover:bg-[var(--bg-surface)] transition-colors"
            onClick={() => router.push('/finance')}
          >
            <Fa icon={faArrowLeft} />
          </button>
          <div className="min-w-0">
            <h1 className="text-sm font-extrabold text-text-1">{docLabel} {invoice.ref}</h1>
            <p className="text-[10px] text-text-3 mt-0.5">{invoice.partnerName}</p>
          </div>
        </div>
        <Badge status={badgeStatus as any} label={invoice.status === 'partially_paid' ? 'Partial' : invoice.status} />
      </div>

      <div className="mod-body">
        <div className="card m-3 sm:m-4 p-5 max-w-3xl mx-auto flex flex-col gap-5">
          {/* Payment progress */}
          {invoice.status !== 'draft' && (
            <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
              <div className="flex justify-between items-end mb-2">
                <div>
                  <p className="text-[10px] text-[var(--text-4)] uppercase font-bold mb-0.5">{docLabel} Total</p>
                  <p className="text-base font-black text-[var(--text-1)] font-mono">{fmtKes(invoice.total)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-[var(--text-4)] uppercase font-bold mb-0.5">Balance Due</p>
                  <p className={`text-base font-black font-mono ${balance <= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtKes(balance)}</p>
                </div>
              </div>
              <div className="w-full h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: pct >= 100 ? '#10B981' : '#F59E0B' }} />
              </div>
              <p className="text-[10px] text-[var(--text-4)] mt-1.5 text-right">{Math.round(pct)}% paid · {fmtKes(invoice.amountPaid)} received</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Date</p>
              <p className="text-xs font-bold text-[var(--text-1)]">{fmtDate(invoice.date)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Due Date</p>
              <p className="text-xs font-bold text-[var(--text-1)]">{fmtDate(invoice.dueDate)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Payments Made</p>
              <p className="text-xs font-bold text-[var(--text-1)]">{(invoice.payments || []).length}</p>
            </div>
          </div>

          {/* Invoice Lines */}
          {(invoice.lines || []).length > 0 && (
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold mb-2">Line Items</p>
              <div className="rounded-xl border border-[var(--border-lt)] overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--bg-surface)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-[var(--text-4)]">Description</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Qty</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Unit Price</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-lt)]">
                    {(invoice.lines || []).map((line, idx) => (
                      <tr key={line.id || idx} className="hover:bg-[var(--bg-surface)]">
                        <td className="px-3 py-2 text-[var(--text-1)]">{line.description}</td>
                        <td className="px-3 py-2 text-right text-[var(--text-3)]">{line.qty}</td>
                        <td className="px-3 py-2 text-right text-[var(--text-3)] font-mono">{fmtKes(line.unitPrice)}</td>
                        <td className="px-3 py-2 text-right font-bold text-[var(--text-1)] font-mono">{fmtKes(line.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[var(--bg-surface)] border-t-2 border-[var(--border-lt)]">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right text-[10px] font-bold uppercase text-[var(--text-4)]">Total</td>
                      <td className="px-3 py-2 text-right font-black text-[var(--text-1)] font-mono">{fmtKes(invoice.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Payment history */}
          {(invoice.payments || []).length > 0 && (
            <div>
              <p className="text-[10px] text-[var(--text-4)] uppercase font-bold mb-2">Payment History</p>
              <div className="rounded-xl border border-[var(--border-lt)] overflow-hidden">
                {(invoice.payments || []).map((pay, idx) => (
                  <div key={pay.id} className={`flex items-center justify-between px-4 py-2.5 ${idx > 0 ? 'border-t border-[var(--border-lt)]' : ''} hover:bg-[var(--bg-surface)]`}>
                    <div>
                      <p className="text-xs font-bold text-[var(--text-1)] capitalize">{pay.method.replace('_', ' ')}</p>
                      <p className="text-[10px] text-[var(--text-4)]">{fmtDate(pay.date)} · {pay.recordedBy}{pay.reference ? ` · ${pay.reference}` : ''}</p>
                    </div>
                    <span className="text-xs font-black text-emerald-600 font-mono">{fmtKes(pay.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ORC badge if release exists */}
          {existingOrc && (
            <div className="flex items-center gap-2">
              <OrcStatusBadge release={existingOrc} onClick={() => setShowOrc(true)} />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)] flex-wrap">
            <button className="btn-secondary flex items-center gap-1.5 text-xs" onClick={handleDownloadInvoice}>
              <Fa icon={faDownload} className="text-[11px]" /> Download
            </button>
            {/* Prepare Release — shown for paid/posted invoices with serialised lines */}
            {(invoice.status === 'paid' || invoice.status === 'posted') && invoice.type === 'customer_invoice' && serialLines.length > 0 && (
              existingOrc?.status === 'released' ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold">
                  <Fa icon={faBoxOpen} /> Released ✓
                </div>
              ) : (
                <button className="btn-primary flex items-center gap-1.5 text-xs" style={{ background: '#7C3AED' }} onClick={handlePrepareRelease}>
                  <Fa icon={faBoxOpen} /> Prepare Release
                </button>
              )
            )}
            {invoice.type === 'customer_invoice' && invoice.status !== 'draft' && (
              <button className="btn-secondary" onClick={handleSendInvoice} disabled={sendingInvoice}>
                {sendingInvoice ? 'Sending…' : 'Email Invoice'}
              </button>
            )}
            {invoice.type === 'customer_invoice' && balance > 0 && availableCredit > 0 && invoice.status !== 'draft' && invoice.status !== 'cancelled' && canManageFinance && (
              <button
                className="btn-secondary flex items-center gap-1.5 text-emerald-700 hover:bg-emerald-50 border-emerald-200 text-xs"
                onClick={() => applyCustomerCreditToInvoice(invoice.id)}
                title={`Available credit: ${fmtKes(availableCredit)}`}
              >
                <Fa icon={faCoins} className="text-[11px]" /> Apply Credit ({fmtKes(Math.min(availableCredit, balance))})
              </button>
            )}
            {invoice.status === 'draft' && canManageFinance && (
              <>
                <button
                  className="btn-secondary flex items-center gap-1.5 text-red-500 hover:bg-red-50 border-red-200"
                  onClick={() => setShowDelete(true)}
                >
                  <Fa icon={faTrash} className="text-[11px]" /> Delete
                </button>
                <button
                  className="btn-secondary flex items-center gap-1.5"
                  onClick={() => router.push(`/finance?tab=${invoice.type === 'customer_invoice' ? 'invoices' : 'bills'}&edit=${invoice.id}`)}
                >
                  <Fa icon={faPencil} className="text-[11px]" /> Edit
                </button>
                <button className="btn-primary" onClick={() => postInvoice(invoice.id)}>
                  Confirm {docLabel}
                </button>
              </>
            )}
            {invoice.status !== 'draft' && invoice.status !== 'cancelled' && invoice.amountPaid <= 0 && canManageFinance && (
              <button
                className="btn-secondary flex items-center gap-1.5 text-amber-700 hover:bg-amber-50 border-amber-200"
                onClick={() => setShowResetDraft(true)}
              >
                <Fa icon={faRotateLeft} className="text-[11px]" /> Reset to Draft
              </button>
            )}
            {invoice.status !== 'draft' && invoice.status !== 'cancelled' && canManageFinance && (
              <button
                className="btn-secondary flex items-center gap-1.5 text-red-500 hover:bg-red-50 border-red-200"
                onClick={() => setShowCancel(true)}
              >
                <Fa icon={faBan} className="text-[11px]" /> Cancel {docLabel}
              </button>
            )}
            {invoice.status !== 'paid' && invoice.status !== 'cancelled' && invoice.status !== 'draft' && canManageFinance && (
              <button className="btn-primary" onClick={() => { setPayAmount(String(balance)); setShowPayModal(true) }}>
                {balance > 0 ? `Register Payment (${fmtKes(balance)} due)` : 'Register Payment'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Register Payment modal ─────────────────────────────────────────── */}
      {showPayModal && (
        <Modal title="Register Payment" onClose={() => setShowPayModal(false)} width={420}>
          <div className="flex flex-col gap-4">
            {/* Invoice summary */}
            <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] flex justify-between">
              <div>
                <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">{docLabel}</p>
                <p className="text-xs font-bold text-[var(--text-1)]">{invoice.ref} · {invoice.partnerName}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Balance Due</p>
                <p className="text-xs font-black text-red-500 font-mono">{fmtKes(balance)}</p>
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
              <Field label="Bank / Account Received To">
                <Select
                  value={payBankAccountId}
                  onChange={setPayBankAccountId}
                  options={activeBanks.map(b => ({ value: b.id, label: b.bankName || b.id }))}
                />
              </Field>
            )}

            <Field label="Reference / Transaction ID">
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
          message={`Reset this ${docLabel.toLowerCase()} to draft so it can be edited? Any posting journals will be reversed.`}
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
