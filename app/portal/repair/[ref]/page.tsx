'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { PortalRepair } from '@/lib/portal-repairs'
import { PortalPageSkeleton } from '@/components/ui'
import { DiagnosisChargeNotice } from '@/components/portal/DiagnosisChargeNotice'

const STATUS_LABELS: Record<string, string> = {
  received:            'Device Received',
  assigned:            'Being Reviewed',
  diagnosed:           'Diagnosis Complete',
  awaiting_approval:   'Awaiting Your Approval',
  approved:            'Repair Approved',
  awaiting_parts:      'Parts on Order',
  in_repair:           'Repair in Progress',
  qc:                  'Quality Check',
  ready:               'Ready for Collection',
  verified_released:   'Verified for Release',
  invoiced:            'Invoice Issued',
  delivered:           'Device Delivered',
  collected:           'Device Collected',
  closed:              'Job Closed',
  declined:            'Quote Declined',
  unrepairable:        'Device Unrepairable',
  returned:            'Device Returned',
  retained:            'Left with Deed',
  cancelled:           'Cancelled',
}

const STATUS_MESSAGES: Record<string, string> = {
  received:            'We have received your device and it is in our queue for inspection.',
  assigned:            'A technician has been assigned and will begin diagnosing your device shortly.',
  diagnosed:           'Our technician has completed the diagnosis. We will send you a repair quote shortly.',
  awaiting_approval:   'Your repair quote is ready. Please review and approve or decline below.',
  approved:            'You have approved the repair. Our team is preparing to begin work on your device.',
  awaiting_parts:      'We are sourcing the required parts. We will update you once they arrive.',
  in_repair:           'Your device is actively being repaired by our technician.',
  qc:                  'The repair is complete and undergoing our quality assurance checks.',
  ready:               'Great news — your device is repaired and ready for collection!',
  verified_released:   'Your device has passed release verification. Please complete payment before collection.',
  invoiced:            'Your invoice has been issued. Please settle payment to collect your device.',
  delivered:           'Your device has been delivered or collected. Thank you for choosing Deed!',
  collected:           'Your device has been collected. Thank you for choosing Deed!',
  closed:              'This repair job is closed. Thank you for trusting Deed Technologies.',
  declined:            'You declined the repair quote. We will contact you shortly regarding next steps.',
  unrepairable:        'Unfortunately, we are unable to repair this device. We will contact you.',
  returned:            'Your device has been returned to you as requested.',
  retained:            'You left this device with Deed. The repair job is closed.',
  cancelled:           'This repair job has been cancelled.',
}

const STATUS_COLOR: Record<string, string> = {
  received:          '#6B7280', assigned:          '#3B82F6', diagnosed:    '#06B6D4',
  awaiting_approval: '#F59E0B', approved:          '#10B981', awaiting_parts: '#F97316',
  in_repair:         '#8B5CF6', qc:                '#EC4899', ready:        '#10B981',
  verified_released: '#7C3AED', invoiced:          '#F59E0B', delivered:    '#0D9488',
  collected:         '#059669', closed:            '#6B7280',
  declined:          '#DC2626', unrepairable:      '#991B1B', returned:     '#78716C',
  retained:          '#57534E', cancelled:         '#EF4444',
}

const STEPS = [
  { key: 'received',  label: 'Received'  },
  { key: 'diagnosed', label: 'Diagnosed' },
  { key: 'approved',  label: 'Approved'  },
  { key: 'in_repair', label: 'In Repair' },
  { key: 'qc',        label: 'QC Check'  },
  { key: 'ready',     label: 'Ready'     },
  { key: 'collected', label: 'Collected' },
]

const STEP_ORDER    = STEPS.map(s => s.key)
const TERMINAL_PASS = ['ready','invoiced','verified_released','delivered','collected','closed']
const TERMINAL_FAIL = ['declined','unrepairable','returned','cancelled']

function fmtKes(n: number) {
  return 'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2 })
}
function fmtDate(s?: string) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return s }
}
function fmtDateTime(s?: string) {
  if (!s) return '—'
  try {
    const raw = String(s)
    const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`)
    if (Number.isNaN(d.getTime())) return raw
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    }
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return s }
}

export default function RepairPortalPage() {
  const params = useParams()
  const ref    = decodeURIComponent(params.ref as string)

  const [repair,    setRepair]    = useState<PortalRepair | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const [declineReason, setDeclineReason] = useState('')
  const [verifyPhone,   setVerifyPhone]   = useState('')
  const [showDecline,   setShowDecline]   = useState(false)
  const [itemDecisions, setItemDecisions] = useState<Record<string, 'approved' | 'declined'>>({})
  const [acting,        setActing]        = useState(false)
  const [actionDone,    setActionDone]    = useState(false)
  const [actionError,   setActionError]   = useState<string | null>(null)

  const [paymentText, setPaymentText] = useState('')
  const [paymentFile, setPaymentFile] = useState<File | null>(null)
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentDone, setPaymentDone] = useState(false)

  const [messages, setMessages] = useState<{ id: string; sender: string; senderName: string; text: string; timestamp: string }[]>([])
  const [msgText,  setMsgText]  = useState('')
  const [sending,  setSending]  = useState(false)

  const [company, setCompany] = useState({ phone: '', email: 'support@deed.co.ke', name: 'Deed Technologies', mpesaPaybill: '880100', mpesaAccount: '468778' })
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}`)
      if (!res.ok) { setError('Repair not found. Please check your reference number.'); setLoading(false); return }
      const d = await res.json()
      setRepair(d.repair)
    } catch { setError('Could not load repair. Please try again.') }
    setLoading(false)
  }

  async function loadMessages() {
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/messages?by=customer`)
      if (res.ok) { const d = await res.json(); setMessages(d.messages) }
    } catch { /* silent */ }
  }

  useEffect(() => {
    load()
    // Poll so status changes made by staff appear without a manual refresh.
    const id = setInterval(load, 20000)
    return () => clearInterval(id)
  }, [ref])
  useEffect(() => {
    loadMessages()
    const id = setInterval(loadMessages, 5000)
    return () => clearInterval(id)
  }, [ref])
  useEffect(() => {
    fetch('/api/portal/company-info').then(r => { if (r.ok) r.json().then((d: typeof company) => setCompany(d)) }).catch(() => {})
  }, [])

  function qLineKey(line: { id?: string }, index: number) { return line.id ?? String(index) }

  useEffect(() => {
    if (!repair?.quote) return
    const next: Record<string, 'approved' | 'declined'> = {}
    repair.quote.lines.forEach((line, index) => {
      next[qLineKey(line, index)] = line.lineDecision === 'declined' ? 'declined' : 'approved'
    })
    setItemDecisions(next)
  }, [repair?.ref, repair?.quote?.sentDate])

  async function submitQuoteDecisions(decisionsOverride?: Record<string, 'approved' | 'declined'>) {
    if (!repair?.quote) return
    setActing(true)
    try {
      const decisions = decisionsOverride ?? itemDecisions
      const itemDecisionsPayload = repair.quote.lines.map((line, index) => ({ lineId: qLineKey(line, index), decision: decisions[qLineKey(line, index)] ?? 'declined' }))
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemDecisions: itemDecisionsPayload, reason: declineReason || undefined, verifyPhone: verifyPhone.trim() }),
      })
      if (!res.ok) { const d = await res.json(); setActionError(d.error ?? 'Action failed') }
      else { setActionDone(true); setActionError(null); await load() }
    } catch { setActionError('Could not complete action. Please try again.') }
    setActing(false)
  }

  async function submitPaymentConfirmation() {
    if (!repair) return
    if (!paymentText.trim() && !paymentFile) { setPaymentError('Paste the M-PESA confirmation SMS or upload a screenshot.'); return }
    setPaymentSubmitting(true)
    setPaymentError(null)
    try {
      const fd = new FormData()
      fd.append('confirmationText', paymentText.trim())
      fd.append('verifyPhone', verifyPhone.trim())
      if (paymentFile) fd.append('screenshot', paymentFile)
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/payment-confirmation`, { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setPaymentError(d.error ?? 'Payment confirmation failed')
      else { setPaymentDone(true); setPaymentText(''); setPaymentFile(null); await load() }
    } catch { setPaymentError('Could not submit payment confirmation. Please try again.') }
    setPaymentSubmitting(false)
  }

  async function sendMessage() {
    if (!msgText.trim() || sending) return
    setSending(true)
    try {
      await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'customer', senderName: repair?.customerName ?? 'Customer', text: msgText.trim() }),
      })
      setMsgText('')
      await loadMessages()
    } catch { /* silent */ }
    setSending(false)
  }

  /* ── Loading ── */
  if (loading) return (
    <PortalPageSkeleton label="Loading your repair…" />
  )

  /* ── Error ── */
  if (error || !repair) return (
    <div style={{ minHeight: '100vh', background: '#F3F6FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%', background: '#FFFFFF', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 20, padding: 48, textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>⚠</div>
        <h1 style={{ color: '#0F1B44', fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Repair Not Found</h1>
        <p style={{ color: '#667085', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{error ?? 'This reference does not exist in our system.'}</p>
        <p style={{ color: '#667085', fontSize: 12 }}>Need help? <strong style={{ color: 'var(--accent-cyan)' }}>{company.email}</strong></p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const color      = STATUS_COLOR[repair.status] ?? '#6B7280'
  const stepIdx    = STEP_ORDER.indexOf(repair.status === 'awaiting_approval' ? 'approved' : repair.status === 'approved' ? 'approved' : repair.status)
  const isTermPass = TERMINAL_PASS.includes(repair.status)
  const isTermFail = TERMINAL_FAIL.includes(repair.status)
  const canApprove = repair.status === 'awaiting_approval' && !actionDone
  const showDiag   = !!(repair.diagnosis?.faultDescription || repair.diagnosis?.findings || repair.diagnosisHistory?.length)
  const quoteLines = repair.quote?.lines ?? []
  const selectedSubtotal = quoteLines.reduce((sum, line, index) => sum + ((itemDecisions[qLineKey(line, index)] ?? 'approved') === 'approved' ? line.subtotal : 0), 0)
  const quoteTaxRate = repair.quote && repair.quote.subtotal > 0 ? repair.quote.tax / repair.quote.subtotal : 0
  const selectedTax = Math.round(selectedSubtotal * quoteTaxRate * 100) / 100
  const selectedTotal = Math.round((selectedSubtotal + selectedTax) * 100) / 100
  const approvedCount = quoteLines.filter((line, index) => (itemDecisions[qLineKey(line, index)] ?? 'approved') === 'approved').length
  const amountPaid = Number(repair.paymentAmount ?? 0)
  const invoiceOrQuoteTotal = repair.invoiceTotal ?? repair.quote?.approvedTotal ?? repair.quote?.total ?? 0
  // Revised quote awaiting re-approval must never compete with a "Payment confirmed" CTA.
  const awaitingRevisionApproval = repair.status === 'awaiting_approval' && !!repair.quote?.changeSummary?.trim()
  const amountDue = Math.max(0, Math.round((invoiceOrQuoteTotal - amountPaid) * 100) / 100)
  const paymentConfirmed = !awaitingRevisionApproval && (repair.paymentStatus === 'auto_paid' || repair.paymentStatus === 'paid')
  const canPay = !awaitingRevisionApproval && ['ready','verified_released','invoiced','delivered','collected','closed'].includes(repair.status) && amountDue > 0 && !paymentConfirmed
  const showPriorPaymentNotice = awaitingRevisionApproval && amountPaid > 0

  return (
    <div className={['client-repair-portal', (canApprove || canPay || repair.paymentStatus === 'pending_review') ? 'client-repair-portal--action' : 'client-repair-portal--overview'].join(' ')}>
      <header className="client-repair-nav">
        <strong className="client-repair-nav__brand">DEED</strong>
        <strong className="client-repair-nav__title">Track your repair</strong>
        <a className="client-repair-nav__help" href={'mailto:' + company.email}>Need help?</a>
      </header>

      <main className="client-repair-grid">
        <section className="client-repair-card client-repair-hero">
          <div className="client-repair-hero__media">
            {repair.issuePhotos?.[0]?.url ? (
              <img src={repair.issuePhotos[0].url} alt={repair.productName} />
            ) : (
              <span aria-hidden>▱</span>
            )}
          </div>
          <div className="client-repair-hero__copy">
            <div className="client-repair-hero__title-row">
              <h1>{repair.productName}</h1>
              <span className="client-repair-status" style={{ color, borderColor: color, background: color + '16' }}>
                {STATUS_LABELS[repair.status] ?? repair.status}
              </span>
            </div>
            <p className="client-repair-hero__meta">{repair.ref} <span>·</span> {repair.customerName}</p>
            <p className="client-repair-hero__updated">Updated {fmtDateTime(repair.statusHistory[repair.statusHistory.length - 1]?.date || repair.intakeDate)}</p>
          </div>
        </section>

        <div className="client-repair-mobile-actions">
          {repair.quote && canApprove && <button type="button" onClick={() => document.getElementById('repair-quote')?.scrollIntoView({ behavior: 'smooth' })}>Approve quote</button>}
          <a href="#repair-support">Contact us</a>
        </div>

        {!isTermFail && (
          <section className="client-repair-card client-repair-progress">
            <h2>Repair progress</h2>
            <div className="client-repair-steps">
              {STEPS.map((step, index) => {
                const done = isTermPass || index < stepIdx
                const current = !isTermPass && index === stepIdx
                return (
                  <div className={['client-repair-step', done ? 'is-done' : '', current ? 'is-current' : ''].join(' ')} key={step.key}>
                    <span className="client-repair-step__dot">{done ? '✓' : index + 1}</span>
                    <span>{step.label}{done ? ' complete' : ''}</span>
                  </div>
                )
              })}
            </div>
            <div className="client-repair-notice" style={{ borderColor: color + '55', background: color + '0D' }}>
              <span aria-hidden>i</span>
              <p>{STATUS_MESSAGES[repair.status] ?? ''}</p>
            </div>
          </section>
        )}

        <section className="client-repair-card client-repair-latest">
          <h2>Latest update</h2>
          {repair.statusHistory.length > 0 ? (
            <>
              <strong>{fmtDateTime(repair.statusHistory[repair.statusHistory.length - 1].date)}</strong>
              <p>{repair.statusHistory[repair.statusHistory.length - 1].note || STATUS_MESSAGES[repair.status] || 'Your repair record has been updated.'}</p>
            </>
          ) : (
            <p>Your repair has been booked and is awaiting its next update.</p>
          )}
        </section>

        {repair.quote && (
          <section id="repair-quote" className="client-repair-card client-repair-quote">
            <div className="client-repair-card__heading">
              <h2>Repair quote</h2>
              {repair.quote.approvedDate && <span className="client-repair-pill client-repair-pill--success">Approved</span>}
              {repair.quote.rejectedDate && <span className="client-repair-pill client-repair-pill--danger">Declined</span>}
            </div>

            {repair.quote.changeSummary && (
              <div className="client-repair-info-banner">
                <span aria-hidden>i</span>
                <div>
                  <strong>Revised quote — review changes before approving.</strong>
                  <pre>{repair.quote.changeSummary}</pre>
                </div>
              </div>
            )}

            {showPriorPaymentNotice && (
              <div className="client-repair-info-banner">
                <span aria-hidden>i</span>
                <p>
                  Previous payment of {fmtKes(amountPaid)}
                  {repair.paymentReceiptNumber ? ' (' + repair.paymentReceiptNumber + ')' : ''} is already on file.
                  Any balance or credit will be calculated after approval.
                </p>
              </div>
            )}

            <div className="client-repair-quote-lines">
              <div className="client-repair-quote-line client-repair-quote-line--head" aria-hidden>
                <span>Item</span><span>Qty</span><span>Unit price</span><span>Total</span><span>Your decision</span>
              </div>
              {repair.quote.lines.map((line, index) => {
                const key = qLineKey(line, index)
                const decision = itemDecisions[key] ?? line.lineDecision ?? 'approved'
                return (
                  <div className="client-repair-quote-line" key={key}>
                    <div className="client-repair-quote-line__item">
                      <strong>{line.description}</strong>
                      <small>Repair item · Qty {line.qty}</small>
                    </div>
                    <span className="client-repair-quote-line__qty">{line.qty}</span>
                    <span>{fmtKes(line.unitPrice)}</span>
                    <strong>{fmtKes(line.subtotal)}</strong>
                    <div className="client-repair-decision">
                      {canApprove ? (
                        <>
                          <button type="button" className={decision === 'approved' ? 'is-selected' : ''} onClick={() => setItemDecisions(previous => ({ ...previous, [key]: 'approved' }))}>Approved</button>
                          <button type="button" className={decision === 'declined' ? 'is-declined' : ''} onClick={() => setItemDecisions(previous => ({ ...previous, [key]: 'declined' }))}>Declined</button>
                        </>
                      ) : (
                        <span className={line.lineDecision === 'declined' ? 'is-declined' : 'is-selected'}>{line.lineDecision || 'approved'}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="client-repair-totals">
              <div><span>{canApprove ? 'Selected subtotal' : 'Subtotal'}</span><span>{fmtKes(canApprove ? selectedSubtotal : repair.quote.subtotal)}</span></div>
              <div><span>VAT</span><span>{fmtKes(canApprove ? selectedTax : repair.quote.tax)}</span></div>
              <div className="client-repair-totals__grand"><strong>{canApprove ? 'Approved total' : 'Total'}</strong><strong>{fmtKes(canApprove ? selectedTotal : (repair.quote.approvedTotal ?? repair.quote.total))}</strong></div>
            </div>

            {canApprove && (
              <>
                <div className="client-repair-verify">
                  <label htmlFor="repair-verify-phone">Verify phone number</label>
                  <p>Enter the phone number registered on this repair.</p>
                  <input id="repair-verify-phone" value={verifyPhone} onChange={event => setVerifyPhone(event.target.value)} inputMode="tel" placeholder="+254 712 345 678" />
                </div>
                <div className="client-repair-quote-actions">
                  <button type="button" className="client-repair-btn client-repair-btn--primary" disabled={acting || approvedCount === 0} onClick={() => { void submitQuoteDecisions() }}>
                    {acting ? 'Processing…' : 'Approve selected items'}
                  </button>
                  <button type="button" className="client-repair-btn client-repair-btn--outline" onClick={() => setShowDecline(current => !current)}>Decline quote</button>
                </div>
              </>
            )}

            {actionError && <div className="client-repair-alert client-repair-alert--danger">{actionError}</div>}
            {actionDone && <div className="client-repair-alert client-repair-alert--success"><strong>Quote updated successfully.</strong><span>Thank you. We will contact you once your device is ready.</span></div>}

            {canApprove && (
              <div className={['client-repair-decline', showDecline ? 'is-open' : ''].join(' ')}>
                <button type="button" className="client-repair-decline__toggle" onClick={() => setShowDecline(current => !current)}>Decline quote (optional)<span>{showDecline ? '⌃' : '⌄'}</span></button>
                {showDecline && (
                  <div className="client-repair-decline__body">
                    <label htmlFor="decline-reason">Reason for declining</label>
                    <textarea id="decline-reason" rows={4} value={declineReason} onChange={event => setDeclineReason(event.target.value)} placeholder="Please tell us why you are declining this quote." />
                    <div>
                      <button type="button" onClick={() => setShowDecline(false)}>Cancel</button>
                      <button type="button" className="is-danger" disabled={acting} onClick={() => {
                        const allDeclined: Record<string, 'approved' | 'declined'> = {}
                        repair.quote?.lines.forEach((line, index) => { allDeclined[qLineKey(line, index)] = 'declined' })
                        setItemDecisions(allDeclined)
                        submitQuoteDecisions(allDeclined)
                      }}>Confirm decline</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {!awaitingRevisionApproval && (paymentConfirmed || repair.paymentStatus === 'pending_review' || canPay) && (
          <section className="client-repair-card client-repair-payment">
            <h2>Payment</h2>
            <div className="client-repair-payment__summary">
              <div><span>Invoice total</span><strong>{fmtKes(invoiceOrQuoteTotal)}</strong></div>
              <div><span>Paid</span><strong>{fmtKes(amountPaid)}</strong></div>
              <div><span>Balance due</span><strong className={amountDue > 0 ? 'is-due' : ''}>{fmtKes(amountDue)}</strong></div>
            </div>

            {paymentConfirmed ? (
              <div className="client-repair-alert client-repair-alert--success">
                <strong>Payment confirmed</strong>
                <span>{repair.paymentReceiptNumber || 'Your receipt and invoice are ready.'}</span>
              </div>
            ) : repair.paymentStatus === 'pending_review' ? (
              <div className="client-repair-alert client-repair-alert--warning">
                <strong>Payment proof under review</strong>
                <span>Finance is matching your confirmation to the invoice.</span>
              </div>
            ) : (
              <>
                <div className="client-repair-mpesa">
                  <h3>Pay with M-PESA</h3>
                  <div><span>Paybill number</span><strong>{company.mpesaPaybill}</strong><span>Account number</span><strong>{company.mpesaAccount || repair.ref}</strong></div>
                </div>
                <details className="client-repair-payment-proof">
                  <summary><strong>Payment proof status</strong><span>Not submitted ›</span></summary>
                  <div className="client-repair-payment-proof__body">
                    <ol className="client-repair-payment__steps">
                      <li>Complete the payment using the details above.</li>
                      <li>Enter the M-PESA confirmation code or SMS.</li>
                      <li>Upload a screenshot of the payment confirmation.</li>
                    </ol>
                    <label htmlFor="payment-confirmation">M-PESA confirmation code</label>
                    <textarea id="payment-confirmation" rows={3} value={paymentText} onChange={event => setPaymentText(event.target.value)} placeholder="e.g. Q1H2J3K4" />
                    <label className="client-repair-upload">
                      <input type="file" accept="image/*" onChange={event => setPaymentFile(event.target.files?.[0] ?? null)} />
                      <strong>Click to upload or drag and drop</strong>
                      <span>PNG, JPG up to 5MB</span>
                    </label>
                    {!verifyPhone.trim() && <input aria-label="Phone number for payment verification" value={verifyPhone} onChange={event => setVerifyPhone(event.target.value)} inputMode="tel" placeholder="Phone number on this repair" />}
                    <button type="button" className="client-repair-btn client-repair-btn--primary" disabled={paymentSubmitting} onClick={submitPaymentConfirmation}>
                      {paymentSubmitting ? 'Submitting…' : 'Submit payment confirmation'}
                    </button>
                  </div>
                </details>
              </>
            )}
            {paymentError && <div className="client-repair-alert client-repair-alert--danger">{paymentError}</div>}
            {paymentDone && <div className="client-repair-alert client-repair-alert--success">Payment confirmation submitted.</div>}
          </section>
        )}

        <details className="client-repair-card client-repair-disclosure client-repair-device">
          <summary>Device details <span>›</span></summary>
          <div className="client-repair-disclosure__body">
            <dl className="client-repair-details">
              <div><dt>Product</dt><dd>{repair.productName}</dd></div>
              <div><dt>Serial</dt><dd>{repair.serialNumber || '—'}</dd></div>
              <div><dt>Reported issue</dt><dd>{repair.issueDescription || '—'}</dd></div>
              <div><dt>Condition</dt><dd>{repair.deviceCondition || '—'}</dd></div>
              <div><dt>Intake date</dt><dd>{fmtDateTime(repair.intakeDate)}</dd></div>
              {repair.assignedTechnicianName && <div><dt>Technician</dt><dd>{repair.assignedTechnicianName}</dd></div>}
              {repair.intakeChannel && <div><dt>Intake via</dt><dd>{repair.intakeChannel.replace(/_/g, ' ')}</dd></div>}
            </dl>
            {(repair.accessories?.length ?? 0) > 0 && (
              <div className="client-repair-accessories">
                <strong>Accessories submitted</strong>
                {repair.accessories.map((accessory, index) => <span key={index}>{accessory.name}{accessory.received ? ' ✓' : ''}</span>)}
              </div>
            )}
            {repair.underWarranty && <div className="client-repair-alert client-repair-alert--success">This repair is covered by warranty.</div>}
          </div>
        </details>

        {showDiag && (
          <details className="client-repair-card client-repair-disclosure client-repair-diagnosis">
            <summary>Diagnosis summary <span>›</span></summary>
            <div className="client-repair-disclosure__body">
              {repair.diagnosis?.faultDescription && <div className="client-repair-diagnosis-row"><strong>Findings</strong><p>{repair.diagnosis.faultDescription}</p></div>}
              {repair.diagnosis?.findings && <div className="client-repair-diagnosis-row"><strong>Technical findings</strong><p>{repair.diagnosis.findings}</p></div>}
              {repair.diagnosis?.recommendedAction && <div className="client-repair-diagnosis-row"><strong>Recommended action</strong><p>{repair.diagnosis.recommendedAction}</p></div>}
              {(repair.diagnosis?.estimatedHours ?? 0) > 0 && <div className="client-repair-diagnosis-row"><strong>Estimated time</strong><p>{repair.diagnosis?.estimatedHours} hours</p></div>}
              {(repair.diagnosisHistory?.length ?? 0) > 1 && (
                <div className="client-repair-diagnosis-history">
                  <strong>Diagnosis history</strong>
                  {(repair.diagnosisHistory ?? []).slice().reverse().map((diagnosis, index) => (
                    <div key={diagnosis.id ?? diagnosis.diagnosedDate + '-' + index}>
                      <span>Revision {diagnosis.revision ?? ((repair.diagnosisHistory?.length ?? 0) - index)}</span>
                      <span>{fmtDate(diagnosis.diagnosedDate)}</span>
                      <p>{diagnosis.faultDescription}</p>
                      {diagnosis.revisionReason && <small>{diagnosis.revisionReason}</small>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        )}

        <details className="client-repair-card client-repair-disclosure client-repair-photos">
          <summary>Issue photos <span>›</span></summary>
          <div className="client-repair-disclosure__body">
            {(repair.issuePhotos?.length ?? 0) > 0 ? (
              <div className="client-repair-photo-grid">
                {repair.issuePhotos!.map((photo, index) => (
                  <button type="button" key={index} onClick={() => setLightboxSrc(photo.url)}>
                    <img src={photo.url} alt={photo.name} />
                    <span>{photo.name}</span>
                  </button>
                ))}
              </div>
            ) : <p className="client-repair-empty">No photos have been uploaded yet.</p>}
          </div>
        </details>

        <details className="client-repair-card client-repair-disclosure client-repair-documents">
          <summary>Reports & documents <span>›</span></summary>
          <div className="client-repair-disclosure__body client-repair-doc-list">
            {(repair.diagnosisReportUrl || repair.diagnosisReportData) && repair.diagnosisReportName ? (
              <a href={repair.diagnosisReportUrl || repair.diagnosisReportData} download={repair.diagnosisReportName}><span>Diagnosis report</span><strong>Available ↓</strong></a>
            ) : <div><span>Diagnosis report</span><small>Pending</small></div>}
            {(repair.qcReportUrl || repair.qcReportData) && repair.qcReportName ? (
              <a href={repair.qcReportUrl || repair.qcReportData} download={repair.qcReportName}><span>Quality check report</span><strong>Available ↓</strong></a>
            ) : <div><span>Quality check report</span><small>Pending</small></div>}
            {invoiceOrQuoteTotal > 0 ? <a href={'/api/portal/repair/' + encodeURIComponent(ref) + '/invoice-pdf'} download><span>Invoice</span><strong>Available ↓</strong></a> : <div><span>Invoice</span><small>Locked</small></div>}
            {paymentConfirmed ? <a href={'/api/portal/repair/' + encodeURIComponent(ref) + '/receipt-pdf'} download><span>Receipt</span><strong>Available ↓</strong></a> : <div><span>Receipt</span><small>Locked</small></div>}
          </div>
        </details>

        {repair.statusHistory.length > 0 && (
          <details className="client-repair-card client-repair-disclosure client-repair-history">
            <summary>Repair history <span>›</span></summary>
            <div className="client-repair-disclosure__body client-repair-history-list">
              {[...repair.statusHistory].reverse().map((entry, index) => (
                <div key={index}>
                  <span className="client-repair-history-list__dot" style={{ background: STATUS_COLOR[entry.status] ?? '#98A2B3' }} />
                  <div><strong>{STATUS_LABELS[entry.status] ?? entry.status}</strong>{entry.note && <p>{entry.note}</p>}</div>
                  <time>{fmtDateTime(entry.date)}</time>
                </div>
              ))}
            </div>
          </details>
        )}

        <section className="client-repair-card client-repair-charge">
          <DiagnosisChargeNotice repair={repair} />
        </section>

        {repair.delivery && (
          <details className="client-repair-card client-repair-disclosure client-repair-delivery">
            <summary>Delivery information <span>›</span></summary>
            <div className="client-repair-disclosure__body">
              <dl className="client-repair-details">
                <div><dt>Method</dt><dd>{repair.delivery.method.replace(/_/g, ' ')}</dd></div>
                {repair.delivery.scheduledDate && <div><dt>Scheduled</dt><dd>{fmtDate(repair.delivery.scheduledDate)}</dd></div>}
                {repair.delivery.address && <div><dt>Address</dt><dd>{repair.delivery.address}</dd></div>}
              </dl>
            </div>
          </details>
        )}

        <section id="repair-support" className="client-repair-card client-repair-support">
          <h2>Messages & support</h2>
          <div className="client-repair-messages">
            {messages.length === 0 && <p className="client-repair-empty">No messages yet. Ask us anything about your repair.</p>}
            {messages.map(message => (
              <div className={message.sender === 'customer' ? 'is-customer' : ''} key={message.id}>
                <p>{message.text}</p>
                <small>{message.sender === 'customer' ? 'You' : message.senderName} · {fmtDateTime(message.timestamp)}</small>
              </div>
            ))}
          </div>
          <div className="client-repair-message-compose">
            <input value={msgText} onChange={event => setMsgText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') sendMessage() }} placeholder="Write a message…" />
            <button type="button" disabled={!msgText.trim() || sending} onClick={sendMessage}>{sending ? '…' : 'Send'}</button>
          </div>
          <div className="client-repair-support__contacts">
            {company.phone && <a href={'tel:' + company.phone}>{company.phone}</a>}
            <a href={'mailto:' + company.email}>{company.email}</a>
          </div>
        </section>
      </main>

      {lightboxSrc && (
        <div className="client-repair-lightbox" role="dialog" aria-modal="true" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="Device photo full size" />
          <button type="button" aria-label="Close image" onClick={() => setLightboxSrc(null)}>×</button>
        </div>
      )}
    </div>
  )
}
