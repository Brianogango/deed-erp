'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { PortalRepair } from '@/lib/portal-repairs'
import { PortalPageSkeleton } from '@/components/ui'
import { DiagnosisChargeNotice } from '@/components/portal/DiagnosisChargeNotice'
import { startVisiblePoll } from '@/lib/visible-poll'

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
  try { return new Date(s).toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return s }
}
function fmtDateTime(s?: string) {
  if (!s) return '—'
  try {
    const raw = String(s)
    const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`)
    if (Number.isNaN(d.getTime())) return raw
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return d.toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' })
    }
    return d.toLocaleString('en-GB', {
      timeZone: 'Africa/Nairobi',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return s }
}

function Card({ children, accent, delay = 0, style: sx }: { children: React.ReactNode; accent?: string; delay?: number; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--portal-card)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderLeft: accent ? `4px solid ${accent}` : undefined,
      borderRadius: 16,
      overflow: 'hidden',
      animation: 'cardUp 0.55s ease both',
      animationDelay: `${delay}ms`,
      ...sx,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>
      {children}
    </p>
  )
}

export default function RepairPortalPage() {
  const params = useParams()
  const rawRef = params.ref
  const ref    = Array.isArray(rawRef)
    ? rawRef.map(part => decodeURIComponent(part)).join('/')
    : decodeURIComponent(rawRef as string)

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

  useEffect(() => startVisiblePoll(() => { void load() }), [ref])
  useEffect(() => startVisiblePoll(() => { void loadMessages() }), [ref])
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

  async function submitQuoteDecisions() {
    if (!repair?.quote) return
    setActing(true)
    try {
      const itemDecisionsPayload = repair.quote.lines.map((line, index) => ({ lineId: qLineKey(line, index), decision: itemDecisions[qLineKey(line, index)] ?? 'declined' }))
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
    <div style={{ height: '100vh', overflowY: 'auto', background: 'linear-gradient(160deg, #06070d 0%, #0e1220 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%', background: 'var(--portal-card)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 20, padding: 48, textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>⚠</div>
        <h1 style={{ color: '#F9FAFB', fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Repair Not Found</h1>
        <p style={{ color: '#9CA3AF', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{error ?? 'This reference does not exist in our system.'}</p>
        <p style={{ color: '#4B5563', fontSize: 12 }}>Need help? <strong style={{ color: 'var(--accent-cyan)' }}>{company.email}</strong></p>
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
    <div style={{ height: '100vh', overflowY: 'auto', background: 'linear-gradient(160deg, #06070d 0%, #0e1220 100%)', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @keyframes spin      { to { transform: rotate(360deg) } }
        @keyframes cardUp    { from { opacity: 0; transform: translateY(22px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes dotPulse  {
          0%, 100% { box-shadow: 0 0 0 4px rgba(0,176,215,0.25), 0 0 0 8px rgba(0,176,215,0.08) }
          50%       { box-shadow: 0 0 0 6px rgba(0,176,215,0.15), 0 0 18px rgba(0,176,215,0.2) }
        }
        @keyframes stepGlow  { 0%, 100% { opacity: 1 } 50% { opacity: 0.45 } }
        @keyframes nowBlink  { 0%, 100% { opacity: 1 } 50% { opacity: 0.6 } }
        * { box-sizing: border-box; margin: 0; padding: 0 }
        ::-webkit-scrollbar { width: 4px }
        ::-webkit-scrollbar-track { background: transparent }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px }
        textarea, input { font-family: inherit }
      `}</style>

      {/* ── Top nav ── */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(6,7,13,0.92)', backdropFilter: 'blur(12px)', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent-cyan), var(--primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: '#fff' }}>D</div>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#E5E7EB', letterSpacing: 0.5 }}>Deed Technologies</span>
        </div>
        <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>Repair Tracking Portal</span>
      </div>

      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px 56px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Status Hero ── */}
        <Card delay={0}>
          <div style={{ padding: '24px 24px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: 11, color: '#4B5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Job Reference</p>
                <p style={{ fontSize: 26, fontWeight: 900, color: '#F9FAFB', letterSpacing: '-0.5px', fontFamily: 'monospace' }}>{repair.ref}</p>
                <p style={{ fontSize: 14, color: '#9CA3AF', fontWeight: 500, marginTop: 4 }}>{repair.customerName}</p>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 800, padding: '6px 14px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.08em',
                background: color + '22', color, border: `1.5px solid ${color}55`, whiteSpace: 'nowrap',
              }}>{STATUS_LABELS[repair.status] ?? repair.status}</span>
            </div>
          </div>
          <DiagnosisChargeNotice repair={repair} style={{ margin: '20px 24px 0' }} />
          <div style={{ margin: '20px 24px 24px', padding: '14px 16px', borderRadius: 12, background: color + '14', border: `1px solid ${color}30` }}>
            <p style={{ fontSize: 13, color: '#E5E7EB', lineHeight: 1.65, fontWeight: 500 }}>{STATUS_MESSAGES[repair.status] ?? ''}</p>
          </div>
        </Card>

        {/* ── Progress Tracker ── */}
        {!isTermFail && (
          <Card delay={100}>
            <div style={{ padding: '20px 24px 24px' }}>
              <SectionLabel>Repair Progress</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                {STEPS.map((step, i) => {
                  const done    = isTermPass ? true : i <= stepIdx
                  const current = !isTermPass && i === stepIdx
                  return (
                    <div key={step.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        {i > 0 && (
                          <div style={{
                            flex: 1, height: 2, borderRadius: 2,
                            background: done && i <= stepIdx ? 'linear-gradient(to right, var(--accent-cyan), var(--primary))' : '#1E2D3D',
                            boxShadow: done && i <= stepIdx ? '0 0 6px rgba(0,176,215,0.35)' : 'none',
                            transition: 'background 0.4s, box-shadow 0.4s',
                          }} />
                        )}
                        <div style={{
                          width: current ? 16 : done ? 12 : 10,
                          height: current ? 16 : done ? 12 : 10,
                          borderRadius: '50%', flexShrink: 0, transition: 'all 0.35s',
                          background: done ? (current ? 'var(--accent-cyan)' : 'linear-gradient(135deg, var(--accent-cyan), var(--primary))') : '#1E2D3D',
                          boxShadow: current ? '0 0 0 4px rgba(0,176,215,0.25), 0 0 0 8px rgba(0,176,215,0.08)' : 'none',
                          border: current ? '2px solid #7DD3FC' : 'none',
                          animation: current ? 'dotPulse 2s ease-in-out infinite' : 'none',
                        }} />
                        {i < STEPS.length - 1 && (
                          <div style={{
                            flex: 1, height: 2, borderRadius: 2,
                            background: done && i < stepIdx ? 'linear-gradient(to right, var(--accent-cyan), var(--primary))' : '#1E2D3D',
                            boxShadow: done && i < stepIdx ? '0 0 6px rgba(0,176,215,0.35)' : 'none',
                            transition: 'background 0.4s, box-shadow 0.4s',
                          }} />
                        )}
                      </div>
                      <p style={{ fontSize: 9, color: done ? '#7DD3FC' : '#374151', textAlign: 'center', fontWeight: done ? 700 : 500, lineHeight: 1.3, maxWidth: 52, transition: 'color 0.3s' }}>
                        {step.label}
                      </p>
                      {current && (
                        <span style={{ fontSize: 8, fontWeight: 900, color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '0.08em', animation: 'nowBlink 2s ease-in-out infinite' }}>
                          Now
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              {repair.estimatedCompletionDate && !isTermPass && (
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(0,176,215,0.08)', border: '1px solid rgba(0,176,215,0.2)' }}>
                  <p style={{ fontSize: 11, color: '#7DD3FC', fontWeight: 600 }}>
                    Estimated completion: <strong>{fmtDate(repair.estimatedCompletionDate)}</strong>
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ── Diagnosis Findings ── */}
        {showDiag && (
          <Card accent="#06B6D4" delay={200}>
            <div style={{ padding: '20px 24px' }}>
              <SectionLabel>What Our Technician Found</SectionLabel>

              {repair.diagnosis?.faultDescription && (
                <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)', marginBottom: 14 }}>
                  <p style={{ fontSize: 11, color: '#67E8F9', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Issue Identified</p>
                  <p style={{ fontSize: 14, color: '#F0F9FF', fontWeight: 700, lineHeight: 1.5 }}>{repair.diagnosis.faultDescription}</p>
                </div>
              )}

              {repair.diagnosis?.findings && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 10, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Technical Findings</p>
                  <p style={{ fontSize: 13, color: '#D1D5DB', lineHeight: 1.65 }}>{repair.diagnosis.findings}</p>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {repair.diagnosis?.recommendedAction && (
                  <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <p style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Action Plan</p>
                    <p style={{ fontSize: 12, color: '#E5E7EB', fontWeight: 500, lineHeight: 1.4 }}>{repair.diagnosis.recommendedAction}</p>
                  </div>
                )}
                {(repair.diagnosis?.estimatedHours ?? 0) > 0 && (
                  <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <p style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Est. Labour</p>
                    <p style={{ fontSize: 22, color: '#67E8F9', fontWeight: 900, lineHeight: 1 }}>{repair.diagnosis?.estimatedHours}<span style={{ fontSize: 11, fontWeight: 600, marginLeft: 3 }}>hrs</span></p>
                  </div>
                )}
              </div>

              {(repair.diagnosisHistory?.length ?? 0) > 1 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <p style={{ fontSize: 10, color: '#6B7280', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Diagnosis History</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(repair.diagnosisHistory ?? []).slice().reverse().map((d, idx) => (
                      <div key={d.id ?? `${d.diagnosedDate}-${idx}`} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <p style={{ fontSize: 10, color: '#E5E7EB', fontWeight: 800 }}>Revision {d.revision ?? ((repair.diagnosisHistory?.length ?? 0) - idx)}</p>
                          <p style={{ fontSize: 9, color: '#6B7280', fontWeight: 700 }}>{fmtDate(d.diagnosedDate)}</p>
                        </div>
                        <p style={{ fontSize: 11, color: '#D1D5DB', fontWeight: 700, lineHeight: 1.4 }}>{d.faultDescription}</p>
                        {d.revisionReason && <p style={{ fontSize: 10, color: '#67E8F9', lineHeight: 1.45, marginTop: 4 }}>Reason: {d.revisionReason}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(repair.diagnosisReportUrl || repair.diagnosisReportData) && repair.diagnosisReportName && (
                <a href={repair.diagnosisReportUrl || repair.diagnosisReportData} download={repair.diagnosisReportName}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(0,176,215,0.08)', border: '1px solid rgba(0,176,215,0.2)', cursor: 'pointer', textDecoration: 'none' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 11, color: '#7DD3FC', fontWeight: 700 }}>Diagnosis Report</p>
                    <p style={{ fontSize: 10, color: '#4B5563' }}>{repair.diagnosisReportName}</p>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 700 }}>Download ↓</span>
                </a>
              )}
            </div>
          </Card>
        )}

        {/* ── Quote & Approval ── */}
        {repair.quote && (
          <Card accent={canApprove ? '#F59E0B' : repair.quote.approvedDate ? '#10B981' : repair.quote.rejectedDate ? '#EF4444' : '#6B7280'} delay={300}>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <SectionLabel>Repair Quote</SectionLabel>
                {repair.quote.approvedDate && <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 99, background: 'rgba(16,185,129,0.15)', color: '#34D399', border: '1px solid rgba(16,185,129,0.3)' }}>Approved</span>}
                {repair.quote.rejectedDate  && <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 99, background: 'rgba(239,68,68,0.1)',   color: '#F87171', border: '1px solid rgba(239,68,68,0.3)'  }}>Declined</span>}
                {canApprove && (
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 99, background: 'rgba(245,158,11,0.15)', color: '#FCD34D', border: '1px solid rgba(245,158,11,0.3)', animation: 'nowBlink 1.5s ease-in-out infinite' }}>
                    Action Needed
                  </span>
                )}
              </div>

              {/* Line items */}
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', marginBottom: 14 }}>
                {repair.quote.lines.map((line, i) => {
                  const key = qLineKey(line, i)
                  const decision = itemDecisions[key] ?? line.lineDecision ?? 'approved'
                  return (
                    <div key={key} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                      padding: '12px 16px', fontSize: 13, opacity: line.lineDecision === 'declined' ? 0.65 : 1,
                      background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                      borderBottom: i < repair.quote!.lines.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ color: '#E5E7EB', fontWeight: 500 }}>{line.description}</span>
                        <span style={{ color: '#6B7280', fontSize: 11, marginLeft: 6 }}>×{line.qty}</span>
                        {line.lineDecision && (
                          <span style={{ display: 'inline-block', marginLeft: 8, fontSize: 9, fontWeight: 900, textTransform: 'uppercase', color: line.lineDecision === 'approved' ? '#34D399' : '#F87171' }}>
                            {line.lineDecision}
                          </span>
                        )}
                        {canApprove && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <button onClick={() => setItemDecisions(prev => ({ ...prev, [key]: 'approved' }))}
                              style={{ padding: '5px 9px', borderRadius: 8, border: decision === 'approved' ? '1px solid rgba(16,185,129,0.7)' : '1px solid rgba(255,255,255,0.12)', background: decision === 'approved' ? 'rgba(16,185,129,0.14)' : 'transparent', color: decision === 'approved' ? '#34D399' : '#9CA3AF', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>Approve</button>
                            <button onClick={() => setItemDecisions(prev => ({ ...prev, [key]: 'declined' }))}
                              style={{ padding: '5px 9px', borderRadius: 8, border: decision === 'declined' ? '1px solid rgba(239,68,68,0.7)' : '1px solid rgba(255,255,255,0.12)', background: decision === 'declined' ? 'rgba(239,68,68,0.12)' : 'transparent', color: decision === 'declined' ? '#F87171' : '#9CA3AF', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>Decline</button>
                          </div>
                        )}
                      </div>
                      <span style={{ color: '#F9FAFB', fontWeight: 700, fontFamily: 'monospace' }}>{fmtKes(line.subtotal)}</span>
                    </div>
                  )
                })}
              </div>

              {/* Change summary (revision diff) */}
              {repair.quote.changeSummary && (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: 4 }}>
                  <p style={{ fontSize: 10, fontWeight: 900, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>What changed in this revision</p>
                  <pre style={{ fontSize: 11, color: '#D1D5DB', whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.7, margin: 0 }}>{repair.quote.changeSummary}</pre>
                </div>
              )}

              {showPriorPaymentNotice && (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', marginBottom: 4 }}>
                  <p style={{ fontSize: 10, fontWeight: 900, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Previous payment on file</p>
                  <p style={{ fontSize: 13, color: '#D1D5DB', lineHeight: 1.6, margin: 0 }}>
                    We already recorded {fmtKes(amountPaid)}
                    {repair.paymentReceiptNumber ? ` (receipt ${repair.paymentReceiptNumber})` : ''}.
                    {' '}Approve this revision and any difference will be settled as residual due or credit.
                  </p>
                </div>
              )}

              {/* Totals */}
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280', marginBottom: 6 }}>
                  <span>{canApprove ? 'Selected subtotal' : 'Subtotal'}</span><span style={{ fontFamily: 'monospace' }}>{fmtKes(canApprove ? selectedSubtotal : repair.quote.subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>VAT (16%)</span><span style={{ fontFamily: 'monospace' }}>{fmtKes(canApprove ? selectedTax : repair.quote.tax)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, color: '#9CA3AF', fontWeight: 700 }}>{canApprove ? 'Approved Amount' : repair.quote.approvedTotal ? 'Approved Amount' : 'Total Amount'}</span>
                  <div style={{ textAlign: 'right' }}>
                    {repair.quote.prevTotal !== undefined && repair.quote.prevTotal !== repair.quote.total && (
                      <div style={{ fontSize: 12, color: '#6B7280', textDecoration: 'line-through', fontFamily: 'monospace' }}>{fmtKes(repair.quote.prevTotal)}</div>
                    )}
                    <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>{fmtKes(canApprove ? selectedTotal : (repair.quote.approvedTotal ?? repair.quote.total))}</span>
                  </div>
                </div>
              </div>

              {repair.quote.validUntil && !repair.quote.approvedDate && !repair.quote.rejectedDate && (
                <p style={{ fontSize: 11, color: '#6B7280', marginTop: 10, textAlign: 'center' }}>
                  Quote valid until <strong style={{ color: '#9CA3AF' }}>{fmtDate(repair.quote.validUntil)}</strong>
                </p>
              )}

              {canApprove && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 8 }}>Approve the items you want us to repair. Declined items are kept on the audit record and will not proceed.</p>
                  <textarea
                    value={declineReason}
                    onChange={e => setDeclineReason(e.target.value)}
                    placeholder="Optional note for declined items…"
                    rows={2}
                    style={{ width: '100%', background: 'var(--portal-bg)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#E5E7EB', fontSize: 13, resize: 'none', outline: 'none' }}
                  />
                  <input
                    value={verifyPhone}
                    onChange={e => setVerifyPhone(e.target.value)}
                    placeholder="Phone number on this repair (required to confirm it's you)"
                    inputMode="tel"
                    style={{ width: '100%', marginTop: 10, background: 'var(--portal-bg)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#E5E7EB', fontSize: 13, outline: 'none' }}
                  />
                  <button onClick={submitQuoteDecisions} disabled={acting}
                    style={{ width: '100%', marginTop: 10, padding: '14px 0', borderRadius: 12, border: 'none', cursor: acting ? 'not-allowed' : 'pointer', background: approvedCount > 0 ? 'linear-gradient(135deg, #059669, #047857)' : '#DC2626', color: '#fff', fontWeight: 800, fontSize: 14, opacity: acting ? 0.7 : 1 }}>
                    {acting ? 'Processing…' : approvedCount > 0 ? `Submit Approval (${approvedCount} item${approvedCount !== 1 ? 's' : ''})` : 'Decline Entire Quote'}
                  </button>
                </div>
              )}

              {actionError && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', fontSize: 13, color: '#F87171', textAlign: 'center' }}>
                  {actionError}
                </div>
              )}
              {actionDone && (
                <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
                  Thank you — we will be in touch shortly.
                </div>
              )}
            </div>
          </Card>
        )}


        {/* ── Payment Confirmation (hidden while revised quote awaits re-approval) ── */}
        {!awaitingRevisionApproval && (paymentConfirmed || repair.paymentStatus === 'pending_review' || (!paymentConfirmed && canPay)) && (
          <Card accent={paymentConfirmed ? '#10B981' : repair.paymentStatus === 'pending_review' ? '#F59E0B' : '#00B0D7'} delay={320}>
            <div style={{ padding: '20px 24px' }}>
              <SectionLabel>{paymentConfirmed ? 'Payment Receipt' : 'Pay Now'}</SectionLabel>
              {paymentConfirmed ? (
                <div style={{ padding: 16, borderRadius: 12, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.28)' }}>
                  <p style={{ color: '#D1FAE5', fontSize: 13, lineHeight: 1.6 }}>Payment confirmed. Thank you — your receipt and invoice are ready to download below.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12, marginBottom: 16 }}>
                    <div><p style={{ fontSize: 9, color: '#6B7280', fontWeight: 800, textTransform: 'uppercase' }}>Receipt No.</p><p style={{ color: '#F9FAFB', fontFamily: 'monospace', fontWeight: 800 }}>{repair.paymentReceiptNumber ?? 'Confirmed'}</p></div>
                    <div><p style={{ fontSize: 9, color: '#6B7280', fontWeight: 800, textTransform: 'uppercase' }}>Amount Paid</p><p style={{ color: '#F9FAFB', fontFamily: 'monospace', fontWeight: 800 }}>{fmtKes(amountPaid > 0 ? amountPaid : invoiceOrQuoteTotal)}</p></div>
                  </div>
                  <a
                    href={`/api/portal/repair/${encodeURIComponent(ref)}/receipt-pdf?phone=${encodeURIComponent(verifyPhone.trim())}`}
                    download
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
                      background: 'linear-gradient(135deg, #059669, #047857)', color: '#fff',
                      fontWeight: 800, fontSize: 14, textDecoration: 'none', marginBottom: 8,
                    }}
                  >
                    Download Receipt PDF
                  </a>
                  <a
                    href={`/api/portal/repair/${encodeURIComponent(ref)}/invoice-pdf?phone=${encodeURIComponent(verifyPhone.trim())}`}
                    download
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
                      background: 'linear-gradient(135deg, #10B981, #059669)',
                      color: '#fff', fontWeight: 800, fontSize: 14, textDecoration: 'none',
                      cursor: 'pointer', boxSizing: 'border-box',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download Invoice PDF
                  </a>
                </div>
              ) : repair.paymentStatus === 'pending_review' ? (
                <div style={{ padding: 14, borderRadius: 12, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.28)', color: '#FCD34D', fontSize: 13, lineHeight: 1.6 }}>
                  We received your payment confirmation and finance is reviewing it against the invoice.
                </div>
              ) : (
                <>
                  <div style={{ padding: 16, borderRadius: 12, background: 'rgba(0,176,215,0.08)', border: '1px solid rgba(0,176,215,0.25)', marginBottom: 14 }}>
                    <p style={{ color: '#E5E7EB', fontSize: 13, lineHeight: 1.7, marginBottom: 10 }}>Pay the repair invoice, then paste the M-PESA confirmation SMS or upload a screenshot so our finance team can confirm it.</p>
                    {amountPaid > 0 && (
                      <p style={{ color: '#9CA3AF', fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
                        Prior payment of {fmtKes(amountPaid)} already applied. Balance due below.
                      </p>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div><p style={{ fontSize: 9, color: '#6B7280', fontWeight: 800, textTransform: 'uppercase' }}>Paybill</p><p style={{ color: '#67E8F9', fontFamily: 'monospace', fontWeight: 900 }}>{company.mpesaPaybill}</p></div>
                      <div><p style={{ fontSize: 9, color: '#6B7280', fontWeight: 800, textTransform: 'uppercase' }}>Account</p><p style={{ color: '#67E8F9', fontFamily: 'monospace', fontWeight: 900 }}>{company.mpesaAccount || repair.ref}</p></div>
                      <div><p style={{ fontSize: 9, color: '#6B7280', fontWeight: 800, textTransform: 'uppercase' }}>Amount Due</p><p style={{ color: '#F9FAFB', fontFamily: 'monospace', fontWeight: 900 }}>{fmtKes(amountDue)}</p></div>
                    </div>
                    <a href={`/api/portal/repair/${encodeURIComponent(ref)}/invoice-pdf?phone=${encodeURIComponent(verifyPhone.trim())}`} download style={{ display: 'block', marginTop: 12, textAlign: 'center', padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#E5E7EB', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}>Download Invoice Before Paying</a>
                  </div>
                  <textarea value={paymentText} onChange={e => setPaymentText(e.target.value)} placeholder="Paste M-PESA confirmation message here…" rows={4} style={{ width: '100%', background: 'var(--portal-bg)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#E5E7EB', fontSize: 13, resize: 'vertical', outline: 'none', marginBottom: 10 }} />
                  <input type="file" accept="image/*" onChange={e => setPaymentFile(e.target.files?.[0] ?? null)} style={{ width: '100%', color: '#9CA3AF', fontSize: 12, marginBottom: 10 }} />
                  <input value={verifyPhone} onChange={e => setVerifyPhone(e.target.value)} placeholder="Phone number on this repair (required to confirm it's you)" inputMode="tel" style={{ width: '100%', background: 'var(--portal-bg)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#E5E7EB', fontSize: 13, outline: 'none', marginBottom: 10 }} />
                  <button onClick={submitPaymentConfirmation} disabled={paymentSubmitting} style={{ width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, var(--accent-cyan), var(--primary))', color: '#fff', fontWeight: 800, fontSize: 14, cursor: paymentSubmitting ? 'not-allowed' : 'pointer', opacity: paymentSubmitting ? 0.7 : 1 }}>{paymentSubmitting ? 'Submitting…' : 'Submit Payment Confirmation'}</button>
                  {paymentError && <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', fontSize: 13, color: '#F87171', textAlign: 'center' }}>{paymentError}</div>}
                  {paymentDone && <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', fontSize: 13, color: '#34D399', textAlign: 'center' }}>Payment confirmation submitted.</div>}
                </>
              )}
            </div>
          </Card>
        )}

        {/* ── Device Photos ── */}
        <Card accent="#7C3AED" delay={250}>
            <div style={{ padding: '20px 24px' }}>
              <SectionLabel>Device Photos</SectionLabel>
              {(repair.issuePhotos?.length ?? 0) > 0 ? (
                <>
                  <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 14, lineHeight: 1.5 }}>
                    Photos of your device taken by our team. Tap any photo to view full size.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {repair.issuePhotos!.map((photo, i) => (
                      <button key={i} onClick={() => setLightboxSrc(photo.url)}
                        style={{ all: 'unset', cursor: 'pointer', borderRadius: 10, overflow: 'hidden', aspectRatio: '1', display: 'block', position: 'relative', border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.08)' }}>
                        <img src={photo.url} alt={photo.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.25s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLImageElement).style.transform = 'scale(1.05)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLImageElement).style.transform = 'scale(1)' }}
                        />
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'all 0.2s' }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(0,0,0,0.35)' }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.background = 'rgba(0,0,0,0)' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: 10, color: '#4B5563', marginTop: 12, textAlign: 'center' }}>
                    {repair.issuePhotos!.length} photo{repair.issuePhotos!.length !== 1 ? 's' : ''} on file
                  </p>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px 0', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <p style={{ fontSize: 12, color: '#4B5563' }}>No photos have been uploaded for this repair yet.</p>
                </div>
              )}
            </div>
          </Card>
        {/* ── Device & Accessories ── */}
        <Card delay={400}>
          <div style={{ padding: '20px 24px' }}>
            <SectionLabel>Device & Accessories</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: (repair.accessories?.length ?? 0) > 0 ? 16 : 0 }}>
              {([
                ['Device',      repair.productName],
                ['Serial No.',  repair.serialNumber || '—'],
                ['Condition',   repair.deviceCondition ? repair.deviceCondition.charAt(0).toUpperCase() + repair.deviceCondition.slice(1) : '—'],
                ['Booked', fmtDateTime(repair.intakeDate)],
                ...(repair.assignedTechnicianName ? [['Technician', repair.assignedTechnicianName]] : []),
                ...(repair.intakeChannel         ? [['Intake via',  repair.intakeChannel.replace(/_/g,' ')]] : []),
              ] as [string, string][]).map(([l, v]) => (
                <div key={l}>
                  <p style={{ fontSize: 9, color: '#4B5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{l}</p>
                  <p style={{ fontSize: 13, color: '#E5E7EB', fontWeight: 500 }}>{v}</p>
                </div>
              ))}
            </div>

            {(repair.accessories?.length ?? 0) > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 14 }}>
                <p style={{ fontSize: 9, color: '#4B5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Accessories Submitted</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {repair.accessories.map((acc, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
                        background: acc.received ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
                        border: `1px solid ${acc.received ? 'rgba(16,185,129,0.35)' : 'rgba(107,114,128,0.25)'}`,
                        color: acc.received ? '#34D399' : '#6B7280',
                      }}>
                        {acc.received ? '✓' : '—'}
                      </div>
                      <div>
                        <span style={{ fontSize: 12, color: acc.received ? '#D1D5DB' : '#6B7280', fontWeight: 500 }}>{acc.name}</span>
                        {acc.notes && <span style={{ fontSize: 10, color: '#4B5563', marginLeft: 6 }}>· {acc.notes}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {repair.issueDescription && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 14, marginTop: 14 }}>
                <p style={{ fontSize: 9, color: '#4B5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Issue You Reported</p>
                <p style={{ fontSize: 13, color: '#D1D5DB', lineHeight: 1.6 }}>{repair.issueDescription}</p>
              </div>
            )}

            {repair.underWarranty && (
              <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(5,150,105,0.12)', border: '1px solid rgba(5,150,105,0.3)', fontSize: 12, color: '#34D399', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🛡</span> This device is under warranty — no repair charge applies.
              </div>
            )}
          </div>
        </Card>

        {/* ── QC Report ── */}
        {(repair.qcReportUrl || repair.qcReportData) && repair.qcReportName && (
          <Card accent="#10B981" delay={500}>
            <div style={{ padding: '20px 24px' }}>
              <SectionLabel>Quality Assurance Report</SectionLabel>
              <a href={repair.qcReportUrl || repair.qcReportData} download={repair.qcReportName}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', cursor: 'pointer', textDecoration: 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>✅</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, color: '#34D399', fontWeight: 700 }}>QC Report Available</p>
                  <p style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{repair.qcReportName}</p>
                  {repair.qcReportUploadedAt && <p style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Uploaded {new Date(repair.qcReportUploadedAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
                </div>
                <span style={{ fontSize: 12, color: '#10B981', fontWeight: 700, whiteSpace: 'nowrap' }}>Download ↓</span>
              </a>
            </div>
          </Card>
        )}

        {/* ── Delivery Info ── */}
        {repair.delivery && (
          <Card accent="#0D9488" delay={500}>
            <div style={{ padding: '20px 24px' }}>
              <SectionLabel>Delivery Information</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                <div>
                  <p style={{ fontSize: 9, color: '#4B5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Method</p>
                  <p style={{ fontSize: 13, color: '#E5E7EB', fontWeight: 500, textTransform: 'capitalize' }}>{repair.delivery.method.replace(/_/g,' ')}</p>
                </div>
                {repair.delivery.scheduledDate && (
                  <div>
                    <p style={{ fontSize: 9, color: '#4B5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Scheduled</p>
                    <p style={{ fontSize: 13, color: '#E5E7EB', fontWeight: 500 }}>{fmtDate(repair.delivery.scheduledDate)}</p>
                  </div>
                )}
                {repair.delivery.address && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <p style={{ fontSize: 9, color: '#4B5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Delivery Address</p>
                    <p style={{ fontSize: 13, color: '#E5E7EB', fontWeight: 500 }}>{repair.delivery.address}</p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* ── Timeline ── */}
        {repair.statusHistory.length > 0 && (
          <Card delay={600}>
            <div style={{ padding: '20px 24px' }}>
              <SectionLabel>Repair Timeline</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {[...repair.statusHistory].reverse().map((h, i, arr) => {
                  const entryColor = STATUS_COLOR[h.status] ?? '#374151'
                  return (
                    <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', paddingBottom: i < arr.length - 1 ? 18 : 0, animation: 'cardUp 0.4s ease both', animationDelay: `${700 + i * 60}ms` }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{
                          width: i === 0 ? 12 : 8, height: i === 0 ? 12 : 8, borderRadius: '50%',
                          background: i === 0 ? entryColor : '#1E2D3D',
                          border: i === 0 ? `2px solid ${entryColor}99` : 'none',
                          boxShadow: i === 0 ? `0 0 0 3px ${entryColor}22, 0 0 10px ${entryColor}30` : 'none',
                          flexShrink: 0,
                        }} />
                        {i < arr.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 14, background: 'rgba(255,255,255,0.06)', marginTop: 4 }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 12, color: i === 0 ? '#E5E7EB' : '#9CA3AF', fontWeight: i === 0 ? 700 : 500, lineHeight: 1.4 }}>
                          {STATUS_LABELS[h.status] ?? h.status}
                        </p>
                        {h.note && <p style={{ fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 1.4 }}>{h.note}</p>}
                        <p style={{ fontSize: 10, color: '#374151', marginTop: 3, fontWeight: 500 }}>{fmtDate(h.date)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Card>
        )}

        {/* ── Messages ── */}
        <Card delay={700}>
          <div style={{ padding: '20px 24px' }}>
            <SectionLabel>Messages with Our Team</SectionLabel>
            <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, paddingRight: 4 }}>
              {messages.length === 0 && (
                <p style={{ fontSize: 12, color: '#4B5563', textAlign: 'center', padding: '20px 0', lineHeight: 1.5 }}>
                  No messages yet.<br />Feel free to ask us anything about your repair.
                </p>
              )}
              {messages.map(m => {
                const isCust = m.sender === 'customer'
                return (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isCust ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '82%', padding: '9px 13px',
                      borderRadius: isCust ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                      background: isCust ? 'rgba(0,98,255,0.18)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${isCust ? 'rgba(0,176,215,0.35)' : 'rgba(255,255,255,0.1)'}`,
                    }}>
                      <p style={{ fontSize: 13, color: '#E5E7EB', lineHeight: 1.5 }}>{m.text}</p>
                    </div>
                    <p style={{ fontSize: 10, color: '#374151', marginTop: 3, fontWeight: 500 }}>
                      {isCust ? 'You' : m.senderName} · {new Date(m.timestamp).toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendMessage() }}
                placeholder="Ask us about your repair…"
                style={{ flex: 1, background: 'var(--portal-bg)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', color: '#E5E7EB', fontSize: 13, outline: 'none', transition: 'border 0.2s' }}
                onFocus={e => { (e.target as HTMLInputElement).style.border = '1px solid rgba(0,176,215,0.5)' }}
                onBlur={e  => { (e.target as HTMLInputElement).style.border = '1px solid rgba(255,255,255,0.1)' }}
              />
              <button
                onClick={sendMessage}
                disabled={!msgText.trim() || sending}
                style={{ padding: '11px 20px', borderRadius: 10, border: 'none', cursor: !msgText.trim() || sending ? 'not-allowed' : 'pointer', background: 'var(--accent-cyan)', color: '#fff', fontWeight: 700, fontSize: 13, opacity: !msgText.trim() || sending ? 0.45 : 1, transition: 'opacity 0.2s', whiteSpace: 'nowrap' }}>
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </Card>

        {/* ── Footer ── */}
        {lightboxSrc && (
          <div onClick={() => setLightboxSrc(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <img src={lightboxSrc} alt="Device photo full size"
              style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 12, objectFit: 'contain', boxShadow: '0 0 60px rgba(0,0,0,0.8)' }} />
            <button onClick={() => setLightboxSrc(null)}
              style={{ position: 'absolute', top: 20, right: 20, all: 'unset', cursor: 'pointer', width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18 }}>✕</button>
          </div>
        )}
        <div style={{ textAlign: 'center', paddingTop: 8, animation: 'cardUp 0.5s ease both', animationDelay: '800ms' }}>
          <p style={{ fontSize: 11, color: '#374151', lineHeight: 1.7 }}>
            Questions? Reach us at{' '}
            <a href={`mailto:${company.email}`} style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{company.email}</a>
            {company.phone && <>{' '}or call{' '}<a href={`tel:${company.phone}`} style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{company.phone}</a></>}
          </p>
          <p style={{ fontSize: 10, color: '#1F2937', marginTop: 6 }}>© 2026 Deed Technologies · Nairobi, Kenya</p>
        </div>
      </div>
    </div>
  )
}
