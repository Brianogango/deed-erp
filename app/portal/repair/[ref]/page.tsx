'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { PortalRepair } from '@/lib/portal-repairs'

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
  invoiced:            'Invoice Issued',
  delivered:           'Device Delivered',
  closed:              'Job Closed',
  declined:            'Quote Declined',
  unrepairable:        'Device Unrepairable',
  returned:            'Device Returned',
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
  invoiced:            'Your invoice has been issued. Please settle payment to collect your device.',
  delivered:           'Your device has been delivered or collected. Thank you for choosing Deed!',
  closed:              'This repair job is closed. Thank you for trusting Deed Technologies.',
  declined:            'You declined the repair quote. We will contact you shortly regarding next steps.',
  unrepairable:        'Unfortunately, we are unable to repair this device. We will contact you.',
  returned:            'Your device has been returned to you as requested.',
  cancelled:           'This repair job has been cancelled.',
}

const STATUS_COLOR: Record<string, string> = {
  received:          '#6B7280', assigned:          '#3B82F6', diagnosed:    '#06B6D4',
  awaiting_approval: '#F59E0B', approved:          '#10B981', awaiting_parts: '#F97316',
  in_repair:         '#8B5CF6', qc:                '#EC4899', ready:        '#10B981',
  invoiced:          '#F59E0B', delivered:         '#0D9488', closed:       '#6B7280',
  declined:          '#DC2626', unrepairable:      '#991B1B', returned:     '#78716C',
  cancelled:         '#EF4444',
}

const STEPS = [
  { key: 'received',  label: 'Received'  },
  { key: 'diagnosed', label: 'Diagnosed' },
  { key: 'approved',  label: 'Approved'  },
  { key: 'in_repair', label: 'In Repair' },
  { key: 'qc',        label: 'QC Check'  },
  { key: 'ready',     label: 'Ready'     },
  { key: 'delivered', label: 'Delivered' },
]

const STEP_ORDER    = STEPS.map(s => s.key)
const TERMINAL_PASS = ['ready','invoiced','delivered','closed']
const TERMINAL_FAIL = ['declined','unrepairable','returned','cancelled']

function fmtKes(n: number) {
  return 'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2 })
}
function fmtDate(s?: string) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return s }
}

function Card({ children, accent, delay = 0, style: sx }: { children: React.ReactNode; accent?: string; delay?: number; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#0d0f17',
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
  const ref    = decodeURIComponent(params.ref as string)

  const [repair,    setRepair]    = useState<PortalRepair | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const [declineReason, setDeclineReason] = useState('')
  const [showDecline,   setShowDecline]   = useState(false)
  const [acting,        setActing]        = useState(false)
  const [actionDone,    setActionDone]    = useState(false)

  const [messages, setMessages] = useState<{ id: string; sender: string; senderName: string; text: string; timestamp: string }[]>([])
  const [msgText,  setMsgText]  = useState('')
  const [sending,  setSending]  = useState(false)

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

  useEffect(() => { load() }, [ref])
  useEffect(() => {
    loadMessages()
    const id = setInterval(loadMessages, 5000)
    return () => clearInterval(id)
  }, [ref])

  async function actOnQuote(approved: boolean) {
    if (!repair) return
    if (!approved && !declineReason.trim()) return
    setActing(true)
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, reason: approved ? undefined : declineReason }),
      })
      if (!res.ok) { const d = await res.json(); alert(d.error ?? 'Action failed') }
      else { setActionDone(true); await load() }
    } catch { alert('Could not complete action. Please try again.') }
    setActing(false)
    setShowDecline(false)
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
    <div style={{ height: '100vh', overflowY: 'auto', background: 'linear-gradient(160deg, #06070d 0%, #0e1220 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, border: '3px solid #00B0D7', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: 13, color: '#6B7280', fontWeight: 500 }}>Loading your repair…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  /* ── Error ── */
  if (error || !repair) return (
    <div style={{ height: '100vh', overflowY: 'auto', background: 'linear-gradient(160deg, #06070d 0%, #0e1220 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%', background: '#0d0f17', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 20, padding: 48, textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>⚠</div>
        <h1 style={{ color: '#F9FAFB', fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Repair Not Found</h1>
        <p style={{ color: '#9CA3AF', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{error ?? 'This reference does not exist in our system.'}</p>
        <p style={{ color: '#4B5563', fontSize: 12 }}>Need help? <strong style={{ color: '#00B0D7' }}>support@deed.co.ke</strong></p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const color      = STATUS_COLOR[repair.status] ?? '#6B7280'
  const stepIdx    = STEP_ORDER.indexOf(repair.status === 'awaiting_approval' ? 'approved' : repair.status === 'approved' ? 'approved' : repair.status)
  const isTermPass = TERMINAL_PASS.includes(repair.status)
  const isTermFail = TERMINAL_FAIL.includes(repair.status)
  const canApprove = repair.status === 'awaiting_approval' && !actionDone
  const showDiag   = !!(repair.diagnosis?.faultDescription || repair.diagnosis?.findings)

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
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #00B0D7, #0062FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: '#fff' }}>D</div>
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
                            background: done && i <= stepIdx ? 'linear-gradient(to right, #00B0D7, #0062FF)' : '#1E2D3D',
                            boxShadow: done && i <= stepIdx ? '0 0 6px rgba(0,176,215,0.35)' : 'none',
                            transition: 'background 0.4s, box-shadow 0.4s',
                          }} />
                        )}
                        <div style={{
                          width: current ? 16 : done ? 12 : 10,
                          height: current ? 16 : done ? 12 : 10,
                          borderRadius: '50%', flexShrink: 0, transition: 'all 0.35s',
                          background: done ? (current ? '#00B0D7' : 'linear-gradient(135deg, #00B0D7, #0062FF)') : '#1E2D3D',
                          boxShadow: current ? '0 0 0 4px rgba(0,176,215,0.25), 0 0 0 8px rgba(0,176,215,0.08)' : 'none',
                          border: current ? '2px solid #7DD3FC' : 'none',
                          animation: current ? 'dotPulse 2s ease-in-out infinite' : 'none',
                        }} />
                        {i < STEPS.length - 1 && (
                          <div style={{
                            flex: 1, height: 2, borderRadius: 2,
                            background: done && i < stepIdx ? 'linear-gradient(to right, #00B0D7, #0062FF)' : '#1E2D3D',
                            boxShadow: done && i < stepIdx ? '0 0 6px rgba(0,176,215,0.35)' : 'none',
                            transition: 'background 0.4s, box-shadow 0.4s',
                          }} />
                        )}
                      </div>
                      <p style={{ fontSize: 9, color: done ? '#7DD3FC' : '#374151', textAlign: 'center', fontWeight: done ? 700 : 500, lineHeight: 1.3, maxWidth: 52, transition: 'color 0.3s' }}>
                        {step.label}
                      </p>
                      {current && (
                        <span style={{ fontSize: 8, fontWeight: 900, color: '#00B0D7', textTransform: 'uppercase', letterSpacing: '0.08em', animation: 'nowBlink 2s ease-in-out infinite' }}>
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

              {repair.diagnosisReportData && repair.diagnosisReportName && (
                <a href={repair.diagnosisReportData} download={repair.diagnosisReportName}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(0,176,215,0.08)', border: '1px solid rgba(0,176,215,0.2)', cursor: 'pointer', textDecoration: 'none' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 11, color: '#7DD3FC', fontWeight: 700 }}>Diagnosis Report</p>
                    <p style={{ fontSize: 10, color: '#4B5563' }}>{repair.diagnosisReportName}</p>
                  </div>
                  <span style={{ fontSize: 11, color: '#00B0D7', fontWeight: 700 }}>Download ↓</span>
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
                {repair.quote.approvedDate && <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 99, background: 'rgba(16,185,129,0.15)', color: '#34D399', border: '1px solid rgba(16,185,129,0.3)' }}>✓ Approved</span>}
                {repair.quote.rejectedDate  && <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 99, background: 'rgba(239,68,68,0.1)',   color: '#F87171', border: '1px solid rgba(239,68,68,0.3)'  }}>✕ Declined</span>}
                {canApprove && (
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 99, background: 'rgba(245,158,11,0.15)', color: '#FCD34D', border: '1px solid rgba(245,158,11,0.3)', animation: 'nowBlink 1.5s ease-in-out infinite' }}>
                    Action Needed
                  </span>
                )}
              </div>

              {/* Line items */}
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', marginBottom: 14 }}>
                {repair.quote.lines.map((line, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 16px', fontSize: 13,
                    background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                    borderBottom: i < repair.quote!.lines.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  }}>
                    <div>
                      <span style={{ color: '#E5E7EB', fontWeight: 500 }}>{line.description}</span>
                      <span style={{ color: '#6B7280', fontSize: 11, marginLeft: 6 }}>×{line.qty}</span>
                    </div>
                    <span style={{ color: '#F9FAFB', fontWeight: 700, fontFamily: 'monospace' }}>{fmtKes(line.subtotal)}</span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280', marginBottom: 6 }}>
                  <span>Subtotal</span><span style={{ fontFamily: 'monospace' }}>{fmtKes(repair.quote.subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>VAT (16%)</span><span style={{ fontFamily: 'monospace' }}>{fmtKes(repair.quote.tax)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, color: '#9CA3AF', fontWeight: 700 }}>Total Amount</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: '#00B0D7', fontFamily: 'monospace' }}>{fmtKes(repair.quote.total)}</span>
                </div>
              </div>

              {repair.quote.validUntil && !repair.quote.approvedDate && !repair.quote.rejectedDate && (
                <p style={{ fontSize: 11, color: '#6B7280', marginTop: 10, textAlign: 'center' }}>
                  Quote valid until <strong style={{ color: '#9CA3AF' }}>{fmtDate(repair.quote.validUntil)}</strong>
                </p>
              )}

              {canApprove && !showDecline && (
                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                  <button onClick={() => actOnQuote(true)} disabled={acting}
                    style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: 'none', cursor: acting ? 'not-allowed' : 'pointer', background: 'linear-gradient(135deg, #059669, #047857)', color: '#fff', fontWeight: 800, fontSize: 14, opacity: acting ? 0.7 : 1, transition: 'opacity 0.2s' }}>
                    {acting ? 'Processing…' : '✓ Approve Repair'}
                  </button>
                  <button onClick={() => setShowDecline(true)} disabled={acting}
                    style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: '1.5px solid rgba(239,68,68,0.35)', cursor: 'pointer', background: 'transparent', color: '#F87171', fontWeight: 700, fontSize: 14 }}>
                    ✕ Decline
                  </button>
                </div>
              )}

              {canApprove && showDecline && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 8 }}>Please tell us why you are declining (optional):</p>
                  <textarea
                    value={declineReason}
                    onChange={e => setDeclineReason(e.target.value)}
                    placeholder="Reason for declining…"
                    rows={3}
                    style={{ width: '100%', background: '#151720', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#E5E7EB', fontSize: 13, resize: 'none', outline: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button onClick={() => setShowDecline(false)} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'transparent', color: '#9CA3AF', fontSize: 13 }}>Back</button>
                    <button onClick={() => actOnQuote(false)} disabled={acting}
                      style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', cursor: acting ? 'not-allowed' : 'pointer', background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, opacity: acting ? 0.7 : 1 }}>
                      {acting ? 'Processing…' : 'Confirm Decline'}
                    </button>
                  </div>
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

        {/* ── Device & Accessories ── */}
        <Card delay={400}>
          <div style={{ padding: '20px 24px' }}>
            <SectionLabel>Device & Accessories</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: (repair.accessories?.length ?? 0) > 0 ? 16 : 0 }}>
              {([
                ['Device',      repair.productName],
                ['Serial No.',  repair.serialNumber || '—'],
                ['Condition',   repair.deviceCondition ? repair.deviceCondition.charAt(0).toUpperCase() + repair.deviceCondition.slice(1) : '—'],
                ['Intake Date', fmtDate(repair.intakeDate)],
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
        {repair.qcReportData && repair.qcReportName && (
          <Card accent="#10B981" delay={500}>
            <div style={{ padding: '20px 24px' }}>
              <SectionLabel>Quality Assurance Report</SectionLabel>
              <a href={repair.qcReportData} download={repair.qcReportName}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', cursor: 'pointer', textDecoration: 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>✅</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, color: '#34D399', fontWeight: 700 }}>QC Report Available</p>
                  <p style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{repair.qcReportName}</p>
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
                      {isCust ? 'You' : m.senderName} · {new Date(m.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
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
                style={{ flex: 1, background: '#151720', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', color: '#E5E7EB', fontSize: 13, outline: 'none', transition: 'border 0.2s' }}
                onFocus={e => { (e.target as HTMLInputElement).style.border = '1px solid rgba(0,176,215,0.5)' }}
                onBlur={e  => { (e.target as HTMLInputElement).style.border = '1px solid rgba(255,255,255,0.1)' }}
              />
              <button
                onClick={sendMessage}
                disabled={!msgText.trim() || sending}
                style={{ padding: '11px 20px', borderRadius: 10, border: 'none', cursor: !msgText.trim() || sending ? 'not-allowed' : 'pointer', background: '#00B0D7', color: '#fff', fontWeight: 700, fontSize: 13, opacity: !msgText.trim() || sending ? 0.45 : 1, transition: 'opacity 0.2s', whiteSpace: 'nowrap' }}>
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </Card>

        {/* ── Footer ── */}
        <div style={{ textAlign: 'center', paddingTop: 8, animation: 'cardUp 0.5s ease both', animationDelay: '800ms' }}>
          <p style={{ fontSize: 11, color: '#374151', lineHeight: 1.7 }}>
            Questions? Reach us at{' '}
            <a href="mailto:support@deed.co.ke" style={{ color: '#00B0D7', fontWeight: 600 }}>support@deed.co.ke</a>
            {' '}or call{' '}
            <a href="tel:+254XXXXXXXXX" style={{ color: '#00B0D7', fontWeight: 600 }}>+254 XXX XXX XXX</a>
          </p>
          <p style={{ fontSize: 10, color: '#1F2937', marginTop: 6 }}>© 2026 Deed Technologies · Nairobi, Kenya</p>
        </div>
      </div>
    </div>
  )
}
