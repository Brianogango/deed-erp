'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { PortalRepair } from '@/lib/portal-repairs'

const STATUS_LABELS: Record<string, string> = {
  received: 'Device Received',
  assigned: 'Being Reviewed',
  diagnosed: 'Diagnosis Complete',
  awaiting_approval: 'Awaiting Your Approval',
  approved: 'Repair Approved',
  awaiting_parts: 'Parts on Order',
  in_repair: 'Repair in Progress',
  qc: 'Quality Check',
  ready: 'Ready for Collection',
  invoiced: 'Invoice Issued',
  delivered: 'Device Delivered',
  closed: 'Job Closed',
  declined: 'Quote Declined',
  unrepairable: 'Unrepairable',
  returned: 'Device Returned',
  cancelled: 'Cancelled',
}

const STATUS_MESSAGES: Record<string, string> = {
  received: 'We have received your device and it is in our queue for inspection.',
  assigned: 'A technician has been assigned and will begin diagnosing your device shortly.',
  diagnosed: 'We have completed diagnosis. A repair quote will be sent to you for approval.',
  awaiting_approval: 'Your repair quote is ready. Please review and approve or decline below.',
  approved: 'You approved the repair. Our team is preparing to begin work on your device.',
  awaiting_parts: 'We are waiting for required parts to arrive before we can start repairs.',
  in_repair: 'Your device is currently being repaired by our technician.',
  qc: 'The repair is complete and undergoing quality testing.',
  ready: 'Your device is repaired and ready! You can collect it or schedule delivery.',
  invoiced: 'Your invoice has been issued. Please settle payment to collect your device.',
  delivered: 'Your device has been successfully delivered or collected. Thank you!',
  closed: 'This repair job has been closed. Thank you for choosing us!',
  declined: 'You declined the repair quote. We will contact you regarding next steps.',
  unrepairable: 'Unfortunately we are unable to repair your device. We will contact you.',
  returned: 'Your device has been returned to you as requested.',
  cancelled: 'This repair job has been cancelled.',
}

const STATUS_COLOR: Record<string, string> = {
  received: '#6B7280', assigned: '#3B82F6', diagnosed: '#06B6D4',
  awaiting_approval: '#F59E0B', approved: '#10B981', awaiting_parts: '#F97316',
  in_repair: '#8B5CF6', qc: '#EC4899', ready: '#10B981', invoiced: '#F59E0B',
  delivered: '#0D9488', closed: '#6B7280', declined: '#DC2626',
  unrepairable: '#991B1B', returned: '#78716C', cancelled: '#EF4444',
}

const ACTIVE_STEPS = ['received', 'assigned', 'diagnosed', 'awaiting_approval', 'in_repair', 'qc', 'ready', 'delivered', 'closed']

function fmtKes(n: number) {
  return 'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2 })
}

function fmtDate(s: string) {
  try { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return s }
}

export default function RepairPortalPage() {
  const params = useParams()
  const ref = decodeURIComponent(params.ref as string)

  const [repair, setRepair] = useState<PortalRepair | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Quote action state
  const [declineReason, setDeclineReason] = useState('')
  const [showDecline, setShowDecline] = useState(false)
  const [acting, setActing] = useState(false)
  const [actionDone, setActionDone] = useState(false)

  // Messages
  const [messages, setMessages] = useState<{ id: string; sender: string; senderName: string; text: string; timestamp: string }[]>([])
  const [msgText, setMsgText] = useState('')
  const [sending, setSending] = useState(false)

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, reason: approved ? undefined : declineReason }),
      })
      if (!res.ok) { const d = await res.json(); alert(d.error ?? 'Action failed'); }
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'customer', senderName: repair?.customerName ?? 'Customer', text: msgText.trim() }),
      })
      setMsgText('')
      await loadMessages()
    } catch { /* silent */ }
    setSending(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #090b12 0%, #1a1d2e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #00B0D7', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: 14, color: '#9CA3AF' }}>Loading your repair status…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (error || !repair) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #090b12 0%, #1a1d2e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', background: '#0c0e14', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <h1 style={{ color: '#fff', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Repair Not Found</h1>
        <p style={{ color: '#9CA3AF', fontSize: 14, marginBottom: 16 }}>{error}</p>
        <p style={{ color: '#6B7280', fontSize: 12 }}>Contact us if you need help: <strong style={{ color: '#00B0D7' }}>support@deed.co.ke</strong></p>
      </div>
    </div>
  )

  const color = STATUS_COLOR[repair.status] ?? '#6B7280'
  const stepIdx = ACTIVE_STEPS.indexOf(repair.status)
  const canApprove = repair.status === 'awaiting_approval' && !actionDone

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #090b12 0%, #1a1d2e 100%)', padding: '32px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header */}
        <div style={{ background: '#0c0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '24px 28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Deed Technologies</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 2 }}>{repair.ref}</p>
              <p style={{ fontSize: 13, color: '#9CA3AF' }}>{repair.customerName}</p>
            </div>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '5px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5,
              background: color + '22', color, border: `1px solid ${color}55`,
            }}>{STATUS_LABELS[repair.status] ?? repair.status}</span>
          </div>
          <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: color + '11', border: `1px solid ${color}33` }}>
            <p style={{ fontSize: 13, color, lineHeight: 1.5 }}>{STATUS_MESSAGES[repair.status] ?? ''}</p>
          </div>
        </div>

        {/* Progress stepper */}
        {stepIdx >= 0 && (
          <div style={{ background: '#0c0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '20px 24px' }}>
            <p style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Progress</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {ACTIVE_STEPS.map((step, i) => {
                const done = i <= stepIdx
                return (
                  <div key={step} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      {i > 0 && <div style={{ flex: 1, height: 2, background: done ? '#00B0D7' : '#374151' }} />}
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                        background: i === stepIdx ? '#00B0D7' : done ? '#00B0D7' : '#374151',
                        border: i === stepIdx ? '2px solid #7DD3FC' : 'none',
                      }} />
                      {i < ACTIVE_STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: i < stepIdx ? '#00B0D7' : '#374151' }} />}
                    </div>
                    <p style={{ fontSize: 8, color: done ? '#7DD3FC' : '#4B5563', textAlign: 'center', maxWidth: 50, lineHeight: 1.2, textTransform: 'capitalize' }}>
                      {step.replace(/_/g, ' ')}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Device info */}
        <div style={{ background: '#0c0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '20px 24px' }}>
          <p style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Device Details</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
            {[
              ['Device', repair.productName],
              ['Serial', repair.serialNumber || '—'],
              ['Intake Date', fmtDate(repair.intakeDate)],
              ...(repair.estimatedCompletionDate ? [['Est. Ready', fmtDate(repair.estimatedCompletionDate)]] : []),
              ...(repair.assignedTechnicianName ? [['Technician', repair.assignedTechnicianName]] : []),
            ].map(([l, v]) => (
              <div key={l}>
                <p style={{ fontSize: 10, color: '#6B7280', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{l}</p>
                <p style={{ fontSize: 13, color: '#E5E7EB', fontWeight: 500 }}>{v}</p>
              </div>
            ))}
          </div>
          {repair.issueDescription && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <p style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Reported Issue</p>
              <p style={{ fontSize: 13, color: '#D1D5DB', lineHeight: 1.5 }}>{repair.issueDescription}</p>
            </div>
          )}
          {repair.underWarranty && (
            <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#06402A', border: '1px solid #059669', fontSize: 12, color: '#34D399' }}>
              🛡️ This device is under warranty — no charge applies.
            </div>
          )}
        </div>

        {/* Quote + approval */}
        {repair.quote && (
          <div style={{ background: '#0c0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <p style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1 }}>Repair Quote</p>
              {repair.quote.approvedDate && <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#06402A', color: '#34D399', border: '1px solid #059669' }}>✓ Approved</span>}
              {repair.quote.rejectedDate && <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#450A0A', color: '#F87171', border: '1px solid #DC2626' }}>✕ Declined</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {repair.quote.lines.map((line, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: '#D1D5DB' }}>{line.description} ×{line.qty}</span>
                  <span style={{ color: '#E5E7EB', fontWeight: 600 }}>{fmtKes(line.subtotal)}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 10, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>
                  <span>Subtotal</span><span>{fmtKes(repair.quote.subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9CA3AF', marginBottom: 8 }}>
                  <span>VAT (16%)</span><span>{fmtKes(repair.quote.tax)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: '#00B0D7' }}>
                  <span>Total</span><span>{fmtKes(repair.quote.total)}</span>
                </div>
              </div>
            </div>

            {canApprove && !showDecline && (
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  onClick={() => actOnQuote(true)}
                  disabled={acting}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: 'none', cursor: acting ? 'not-allowed' : 'pointer', background: 'linear-gradient(135deg, #059669, #047857)', color: '#fff', fontWeight: 700, fontSize: 14, opacity: acting ? 0.7 : 1 }}>
                  {acting ? 'Processing…' : '✓ Approve Repair'}
                </button>
                <button
                  onClick={() => setShowDecline(true)}
                  disabled={acting}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)', cursor: 'pointer', background: 'transparent', color: '#F87171', fontWeight: 700, fontSize: 14 }}>
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
                  style={{ width: '100%', background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px', color: '#E5E7EB', fontSize: 13, resize: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button onClick={() => setShowDecline(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'transparent', color: '#9CA3AF', fontSize: 13 }}>Back</button>
                  <button
                    onClick={() => actOnQuote(false)}
                    disabled={acting}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: acting ? 'not-allowed' : 'pointer', background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, opacity: acting ? 0.7 : 1 }}>
                    {acting ? 'Processing…' : 'Confirm Decline'}
                  </button>
                </div>
              </div>
            )}

            {actionDone && (
              <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.1)', fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
                Thank you — we will be in touch shortly.
              </div>
            )}
          </div>
        )}

        {/* Status history */}
        {repair.statusHistory.length > 0 && (
          <div style={{ background: '#0c0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '20px 24px' }}>
            <p style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Timeline</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[...repair.statusHistory].reverse().map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00B0D7', marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: 12, color: '#E5E7EB', fontWeight: 600 }}>{STATUS_LABELS[h.status] ?? h.status}</p>
                    {h.note && <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>{h.note}</p>}
                    <p style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{fmtDate(h.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message thread */}
        <div style={{ background: '#0c0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '20px 24px' }}>
          <p style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Messages with Our Team</p>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {messages.length === 0 && <p style={{ fontSize: 12, color: '#4B5563', textAlign: 'center', padding: '16px 0' }}>No messages yet. Feel free to ask us anything.</p>}
            {messages.map(m => {
              const isCust = m.sender === 'customer'
              return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isCust ? 'flex-end' : 'flex-start' }}>
                  <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: isCust ? '12px 3px 12px 12px' : '3px 12px 12px 12px', background: isCust ? '#1e3a4f' : '#1a1d2e', border: `1px solid ${isCust ? '#00B0D755' : 'rgba(255,255,255,0.1)'}` }}>
                    <p style={{ fontSize: 13, color: '#E5E7EB', lineHeight: 1.4 }}>{m.text}</p>
                  </div>
                  <p style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                    {isCust ? 'You' : `📞 ${m.senderName}`} · {new Date(m.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
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
              placeholder="Type a message…"
              style={{ flex: 1, background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px', color: '#E5E7EB', fontSize: 13, outline: 'none' }}
            />
            <button
              onClick={sendMessage}
              disabled={!msgText.trim() || sending}
              style={{ padding: '10px 18px', borderRadius: 8, border: 'none', cursor: !msgText.trim() || sending ? 'not-allowed' : 'pointer', background: '#00B0D7', color: '#fff', fontWeight: 700, fontSize: 13, opacity: !msgText.trim() || sending ? 0.5 : 1 }}>
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>

        <p style={{ fontSize: 11, color: '#4B5563', textAlign: 'center', paddingBottom: 24 }}>
          Need help? Contact us at <strong style={{ color: '#00B0D7' }}>support@deed.co.ke</strong>
        </p>
      </div>
    </div>
  )
}
