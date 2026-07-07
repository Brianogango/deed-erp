'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { PortalRepair, PortalRepairStatus, RepairMessage } from '@/lib/portal-repairs'
import { PortalPageSkeleton } from '@/components/ui'

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  received:          { label: 'Received',           color: '#38BDF8', bg: 'rgba(56,189,248,0.12)',   icon: '📥' },
  assigned:          { label: 'Assigned',            color: '#00B0D7', bg: 'rgba(0,176,215,0.12)',  icon: '🔧' },
  diagnosed:         { label: 'Diagnosed',           color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',   icon: '🔍' },
  awaiting_approval: { label: 'Awaiting Your Approval', color: '#F97316', bg: 'rgba(249,115,22,0.12)', icon: '⏳' },
  approved:          { label: 'Quote Approved',      color: '#10B981', bg: 'rgba(16,185,129,0.12)',   icon: '✅' },
  awaiting_parts:    { label: 'Awaiting Parts',      color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',   icon: '📦' },
  in_repair:         { label: 'In Repair',           color: '#06AED4', bg: 'rgba(6,174,212,0.12)',    icon: '⚙️' },
  qc:                { label: 'Quality Check',       color: '#00B0D7', bg: 'rgba(0,176,215,0.12)',  icon: '🔬' },
  ready:             { label: 'Ready for Collection', color: '#10B981', bg: 'rgba(16,185,129,0.12)', icon: '✔️' },
  invoiced:          { label: 'Invoice Generated',   color: '#10B981', bg: 'rgba(16,185,129,0.12)',   icon: '🧾' },
  delivered:         { label: 'Delivered',           color: '#10B981', bg: 'rgba(16,185,129,0.12)',   icon: '🎉' },
  closed:            { label: 'Closed',              color: '#6B7280', bg: 'rgba(107,114,128,0.12)',  icon: '✔️' },
  declined:          { label: 'Quote Declined',      color: '#F04438', bg: 'rgba(240,68,56,0.12)',    icon: '✗' },
  unrepairable:      { label: 'Cannot be Repaired',  color: '#F04438', bg: 'rgba(240,68,56,0.12)',    icon: '⛔' },
  returned:          { label: 'Returned',            color: '#6B7280', bg: 'rgba(107,114,128,0.12)',  icon: '↩️' },
  cancelled:         { label: 'Cancelled',           color: '#6B7280', bg: 'rgba(107,114,128,0.12)',  icon: '✗' },
}

// Ordered journey steps (normal flow)
const JOURNEY_STEPS: { id: PortalRepairStatus; label: string; icon: string }[] = [
  { id: 'received',          label: 'Received',       icon: '📥' },
  { id: 'assigned',          label: 'Assigned',       icon: '🔧' },
  { id: 'diagnosed',         label: 'Diagnosed',      icon: '🔍' },
  { id: 'awaiting_approval', label: 'Quote Sent',     icon: '📋' },
  { id: 'approved',          label: 'Approved',       icon: '✅' },
  { id: 'in_repair',         label: 'In Repair',      icon: '⚙️' },
  { id: 'qc',                label: 'QC Check',       icon: '🔬' },
  { id: 'ready',             label: 'Ready',          icon: '📲' },
  { id: 'delivered',         label: 'Delivered',      icon: '🎉' },
]

const STEP_ORDER = JOURNEY_STEPS.map(s => s.id)
const TERMINAL_BAD: PortalRepairStatus[] = ['declined', 'unrepairable', 'returned', 'cancelled']

function stepIndex(status: PortalRepairStatus) {
  const idx = STEP_ORDER.indexOf(status)
  // awaiting_parts slots between approved and in_repair
  if (status === 'awaiting_parts') return STEP_ORDER.indexOf('approved') + 0.5
  // invoiced slots between ready and delivered
  if (status === 'invoiced') return STEP_ORDER.indexOf('ready') + 0.5
  if (status === 'closed') return STEP_ORDER.indexOf('delivered')
  return idx
}

const fmt = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const fmtKes = (n: number) =>
  'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 0 })

// ─── Component ────────────────────────────────────────────────────────────────

export default function RepairTrackDetail() {
  const params = useParams()
  const router = useRouter()
  const ref = Array.isArray(params.ref) ? params.ref.join('/') : decodeURIComponent(params.ref as string)

  const [repair, setRepair] = useState<PortalRepair | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Quote approval state
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [actioning, setActioning] = useState(false)
  const [actionDone, setActionDone] = useState<'approved' | 'declined' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Messaging state
  const [messages, setMessages] = useState<RepairMessage[]>([])
  const [msgText, setMsgText] = useState('')
  const [senderName, setSenderName] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const [msgSent, setMsgSent] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchRepair = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}`)
      if (res.status === 404) { setError('Repair not found.'); return }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRepair(data.repair)
    } catch {
      setError('Failed to load repair details. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [ref])

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/messages?by=customer`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages)
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      }
    } catch { /* silent */ }
  }, [ref])

  useEffect(() => { fetchRepair() }, [fetchRepair])
  useEffect(() => { fetchMessages() }, [fetchMessages])
  // Poll for new messages every 20 seconds
  useEffect(() => {
    const id = setInterval(fetchMessages, 20000)
    return () => clearInterval(id)
  }, [fetchMessages])

  const sendMessage = async () => {
    if (!msgText.trim() || !senderName.trim() || sendingMsg) return
    setSendingMsg(true)
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'customer', senderName: senderName.trim(), text: msgText.trim() }),
      })
      if (res.ok) {
        setMsgText('')
        setMsgSent(true)
        setTimeout(() => setMsgSent(false), 4000)
        await fetchMessages()
      }
    } catch { /* silent */ } finally {
      setSendingMsg(false)
    }
  }

  const handleApprove = async () => {
    setActioning(true)
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      })
      if (!res.ok) throw new Error()
      setActionDone('approved')
      setActionError(null)
      await fetchRepair()
    } catch {
      setActionError('Failed to approve. Please try again or call us.')
    } finally {
      setActioning(false)
    }
  }

  const handleDecline = async () => {
    setActioning(true)
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(ref)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false, reason: declineReason || 'Declined by customer' }),
      })
      if (!res.ok) throw new Error()
      setActionDone('declined')
      setShowDeclineModal(false)
      await fetchRepair()
    } catch {
      setActionError('Failed to decline. Please try again or call us.')
    } finally {
      setActioning(false)
    }
  }

  // ── Loading / Error states ─────────────────────────────────────────────────
  if (loading) return (
    <PortalPageSkeleton label="Loading repair details…" />
  )

  if (error || !repair) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#090b12' }}>
      <div className="max-w-sm w-full text-center rounded-2xl p-8" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(240,68,56,0.3)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <h2 className="font-bold text-white mb-2">Not Found</h2>
        <p style={{ color: '#FDA29B', fontSize: 13, marginBottom: 20 }}>{error}</p>
        <button onClick={() => router.push('/track')} style={{ background: 'rgba(6,174,212,0.15)', border: '1px solid rgba(6,174,212,0.3)', color: '#38BDF8', padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
          ← Try another reference
        </button>
      </div>
    </div>
  )

  const meta = STATUS_META[repair.status] ?? STATUS_META.received
  const isBadTerminal = TERMINAL_BAD.includes(repair.status as PortalRepairStatus)
  const currentIdx = stepIndex(repair.status as PortalRepairStatus)
  const isAwaitingApproval = repair.status === 'awaiting_approval'
  const quoteValid = repair.quote && repair.status === 'awaiting_approval'
    ? new Date(repair.quote.validUntil) >= new Date()
    : true

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #090b12 0%, #0d1020 100%)' }}>
      <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-5">

        {/* ── Header bar ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/track')} style={{ color: '#555A73', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            ← Back
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ background: 'linear-gradient(135deg, var(--accent-cyan), #0284C7)' }}>D</div>
            <span style={{ fontSize: 12, color: '#555A73' }}>Deed Technologies</span>
          </div>
        </div>

        {/* ── Status hero card ────────────────────────────────────────── */}
        <div className="rounded-2xl p-6" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--accent-cyan)', fontWeight: 600 }}>{repair.ref}</span>
                <span style={{ fontSize: 18 }}>{meta.icon}</span>
              </div>
              <h1 className="text-xl font-bold text-white mb-0.5">{repair.productName}</h1>
              <p style={{ fontSize: 12, color: '#555A73' }}>S/N: {repair.serialNumber}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33` }}>
                {meta.icon} {meta.label}
              </span>
              {repair.estimatedCompletionDate && !isBadTerminal && repair.status !== 'delivered' && repair.status !== 'closed' && (
                <span style={{ fontSize: 11, color: '#555A73' }}>Est. completion: {fmt(repair.estimatedCompletionDate)}</span>
              )}
            </div>
          </div>

          {/* Customer row */}
          <div className="mt-4 pt-4 flex gap-6 flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: '#9095B0' }}>
            <div><span style={{ color: '#555A73' }}>Customer</span><br /><span className="text-white font-medium">{repair.customerName}</span></div>
            <div><span style={{ color: '#555A73' }}>Booked</span><br /><span className="text-white">{fmt(repair.intakeDate)}</span></div>
            <div><span style={{ color: '#555A73' }}>Channel</span><br /><span className="text-white capitalize">{repair.intakeChannel.replace('_', ' ')}</span></div>
            {repair.assignedTechnicianName && (
              <div><span style={{ color: '#555A73' }}>Technician</span><br /><span className="text-white">{repair.assignedTechnicianName}</span></div>
            )}
          </div>
        </div>

        {/* ── Journey timeline ─────────────────────────────────────────── */}
        {!isBadTerminal ? (
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#555A73', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Repair Journey</p>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${JOURNEY_STEPS.length}, 1fr)`, gap: 0 }}>
              {JOURNEY_STEPS.map((step, i) => {
                const done = currentIdx > i
                const current = Math.floor(currentIdx) === i || (currentIdx % 1 !== 0 && i === Math.floor(currentIdx))
                return (
                  <div key={step.id} className="flex flex-col items-center" style={{ position: 'relative' }}>
                    {/* Connector line left */}
                    {i > 0 && (
                      <div style={{
                        position: 'absolute', top: 15, right: '50%', left: '-50%',
                        height: 2,
                        background: done || current ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.07)',
                        transition: 'background 0.3s',
                      }} />
                    )}
                    {/* Dot */}
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', zIndex: 1, position: 'relative',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                      background: done ? 'rgba(16,185,129,0.2)' : current ? 'rgba(6,174,212,0.2)' : 'rgba(255,255,255,0.04)',
                      border: done ? '2px solid #10B981' : current ? '2px solid var(--accent-cyan)' : '2px solid rgba(255,255,255,0.1)',
                      boxShadow: current ? '0 0 12px rgba(6,174,212,0.4)' : 'none',
                      transition: 'all 0.3s',
                    }}>
                      {done ? '✓' : step.icon}
                    </div>
                    <p style={{
                      fontSize: 9, marginTop: 4, textAlign: 'center',
                      color: done ? '#10B981' : current ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.2)',
                      fontWeight: current ? 700 : 400,
                      lineHeight: 1.2,
                    }}>
                      {step.label}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: 'rgba(240,68,56,0.06)', border: '1px solid rgba(240,68,56,0.2)' }}>
            <div style={{ fontSize: 32 }}>{meta.icon}</div>
            <div>
              <p className="font-semibold text-white">{meta.label}</p>
              <p style={{ fontSize: 12, color: '#FDA29B', marginTop: 2 }}>
                {repair.status === 'declined' && 'You declined the repair quote. Please contact us if you change your mind.'}
                {repair.status === 'unrepairable' && 'Unfortunately your device cannot be repaired. Please arrange collection.'}
                {repair.status === 'returned' && 'Your device has been returned. Thank you for choosing Deed Technologies.'}
                {repair.status === 'cancelled' && 'This repair job was cancelled. Contact us for more information.'}
              </p>
            </div>
          </div>
        )}

        {/* ── Quote approval card ──────────────────────────────────────── */}
        {repair.quote && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              border: isAwaitingApproval
                ? '1.5px solid rgba(249,115,22,0.5)'
                : repair.status === 'declined'
                ? '1px solid rgba(240,68,56,0.2)'
                : '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            {/* Quote header */}
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: isAwaitingApproval ? 'rgba(249,115,22,0.06)' : 'transparent' }}>
              <div>
                <p className="font-semibold text-white text-sm">Repair Quote</p>
                <p style={{ fontSize: 11, color: '#555A73' }}>
                  Sent {fmt(repair.quote.sentDate)} · Valid until {fmt(repair.quote.validUntil)}
                </p>
              </div>
              <div className="text-right">
                {repair.quote.approvedDate && (
                  <span className="px-2 py-1 rounded text-xs font-semibold" style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981', border: '1px solid rgba(16,185,129,0.3)' }}>
                    ✓ Approved {fmt(repair.quote.approvedDate)}
                  </span>
                )}
                {repair.quote.rejectedDate && (
                  <span className="px-2 py-1 rounded text-xs font-semibold" style={{ background: 'rgba(240,68,56,0.15)', color: '#F04438', border: '1px solid rgba(240,68,56,0.3)' }}>
                    ✗ Declined {fmt(repair.quote.rejectedDate)}
                  </span>
                )}
                {isAwaitingApproval && !actionDone && !repair.quote.approvedDate && !repair.quote.rejectedDate && (
                  <span className="px-2 py-1 rounded text-xs font-semibold" style={{ background: 'rgba(249,115,22,0.15)', color: '#F97316', border: '1px solid rgba(249,115,22,0.3)', animation: 'pulse 2s infinite' }}>
                    ⏳ Action Required
                  </span>
                )}
              </div>
            </div>

            {/* Quote lines */}
            <div className="px-6 py-4">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <th style={{ textAlign: 'left', paddingBottom: 8, color: '#555A73', fontWeight: 600 }}>Description</th>
                    <th style={{ textAlign: 'center', paddingBottom: 8, color: '#555A73', fontWeight: 600, width: 40 }}>Qty</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8, color: '#555A73', fontWeight: 600, width: 100 }}>Unit Price</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8, color: '#555A73', fontWeight: 600, width: 100 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {repair.quote.lines.map((line, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '10px 0', color: '#E4E7F0' }}>
                        <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: line.type === 'part' ? '#38BDF8' : line.type === 'labor' ? 'var(--accent-cyan)' : '#F59E0B', marginRight: 6, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>
                          {line.type}
                        </span>
                        {line.description}
                      </td>
                      <td style={{ textAlign: 'center', color: '#9095B0' }}>{line.qty}</td>
                      <td style={{ textAlign: 'right', color: '#9095B0', fontFamily: 'monospace' }}>{fmtKes(line.unitPrice)}</td>
                      <td style={{ textAlign: 'right', color: '#E4E7F0', fontFamily: 'monospace', fontWeight: 500 }}>{fmtKes(line.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="mt-4 pt-4 flex justify-end" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ width: 220 }}>
                  <div className="flex justify-between mb-1" style={{ fontSize: 12, color: '#555A73' }}>
                    <span>Subtotal</span><span style={{ fontFamily: 'monospace' }}>{fmtKes(repair.quote.subtotal)}</span>
                  </div>
                  <div className="flex justify-between mb-2" style={{ fontSize: 12, color: '#555A73' }}>
                    <span>VAT (16%)</span><span style={{ fontFamily: 'monospace' }}>{fmtKes(repair.quote.tax)}</span>
                  </div>
                  <div className="flex justify-between pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 15, fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>
                    <span style={{ fontFamily: 'inherit' }}>TOTAL</span><span>{fmtKes(repair.quote.total)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            {isAwaitingApproval && !actionDone && !repair.quote.approvedDate && !repair.quote.rejectedDate && (
              <div className="px-6 pb-6">
                {!quoteValid && (
                  <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(240,68,56,0.1)', color: '#FDA29B', border: '1px solid rgba(240,68,56,0.2)' }}>
                    ⚠ This quote has expired. Please contact us to request a new quote.
                  </div>
                )}
                <div
                  className="rounded-xl p-4 mb-4"
                  style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.2)' }}
                >
                  <p className="font-semibold text-white mb-1" style={{ fontSize: 13 }}>Your approval is needed</p>
                  <p style={{ fontSize: 12, color: '#9095B0' }}>
                    Review the quote above, then approve to authorise the repair or decline if you&apos;d like to collect your device without repair.
                    Once approved, our technician will begin work immediately.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleApprove}
                    disabled={actioning || !quoteValid}
                    style={{
                      flex: 1, padding: '13px 0', borderRadius: 10, border: 'none', cursor: actioning || !quoteValid ? 'not-allowed' : 'pointer',
                      background: actioning || !quoteValid ? 'rgba(16,185,129,0.3)' : 'linear-gradient(135deg, #10B981, #059669)',
                      color: '#fff', fontWeight: 700, fontSize: 14, transition: 'opacity 0.15s',
                    }}
                  >
                    {actioning ? '…' : '✓ Approve Repair'}
                  </button>
                  <button
                    onClick={() => setShowDeclineModal(true)}
                    disabled={actioning}
                    style={{
                      flex: 1, padding: '13px 0', borderRadius: 10, cursor: actioning ? 'not-allowed' : 'pointer',
                      background: 'rgba(240,68,56,0.08)', border: '1.5px solid rgba(240,68,56,0.4)',
                      color: '#FDA29B', fontWeight: 700, fontSize: 14, transition: 'all 0.15s',
                    }}
                  >
                    ✗ Decline
                  </button>
                </div>
              </div>
            )}

            {/* Action error */}
            {actionError && (
              <div className="mx-6 mb-4 rounded-xl p-3 text-sm" style={{ background: 'rgba(240,68,56,0.1)', border: '1px solid rgba(240,68,56,0.3)', color: '#FDA29B' }}>
                {actionError}
              </div>
            )}

            {/* Post-action success banner */}
            {actionDone === 'approved' && (
              <div className="mx-6 mb-6 rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <span style={{ fontSize: 24 }}>✅</span>
                <div>
                  <p className="font-semibold text-white" style={{ fontSize: 13 }}>Quote Approved — Thank you!</p>
                  <p style={{ fontSize: 12, color: '#6EE7B7' }}>Your technician has been notified and will begin the repair shortly.</p>
                </div>
              </div>
            )}
            {actionDone === 'declined' && (
              <div className="mx-6 mb-6 rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(240,68,56,0.08)', border: '1px solid rgba(240,68,56,0.25)' }}>
                <span style={{ fontSize: 24 }}>📞</span>
                <div>
                  <p className="font-semibold text-white" style={{ fontSize: 13 }}>Quote Declined</p>
                  <p style={{ fontSize: 12, color: '#FDA29B' }}>We&apos;ll prepare your device for collection. We&apos;ll be in touch shortly.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Diagnosis card ───────────────────────────────────────────── */}
        {repair.diagnosis && (
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#555A73', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              🔍 Technician Diagnosis · {fmt(repair.diagnosis.diagnosedDate)}
            </p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <p style={{ fontSize: 10, color: '#555A73', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Findings</p>
                <p style={{ fontSize: 13, color: '#E4E7F0' }}>{repair.diagnosis.findings}</p>
              </div>
              <div>
                <p style={{ fontSize: 10, color: '#555A73', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fault Description</p>
                <p style={{ fontSize: 13, color: '#9095B0' }}>{repair.diagnosis.faultDescription}</p>
              </div>
              <div className="flex gap-6">
                <div>
                  <p style={{ fontSize: 10, color: '#555A73', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended Action</p>
                  <p style={{ fontSize: 13, color: '#E4E7F0' }}>{repair.diagnosis.recommendedAction}</p>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <p style={{ fontSize: 10, color: '#555A73', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Est. Hours</p>
                  <p style={{ fontSize: 13, color: '#E4E7F0', fontWeight: 600 }}>{repair.diagnosis.estimatedHours}h</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Diagnosis Report download (customer-facing) ──────────────── */}
        {repair.diagnosisReportData && (
          <div className="rounded-2xl p-5" style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#FCD34D', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              🔍 Diagnosis Report
            </p>
            <p style={{ fontSize: 12, color: '#9095B0', marginBottom: 14 }}>
              Our technician has completed a full diagnosis of your device. You can download the detailed report below.
            </p>
            <a
              href={repair.diagnosisReportData}
              download={repair.diagnosisReportName ?? 'diagnosis-report.pdf'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 0', borderRadius: 10, textDecoration: 'none',
                background: 'rgba(245,158,11,0.12)', border: '1.5px solid rgba(245,158,11,0.35)',
                color: '#FCD34D', fontWeight: 700, fontSize: 13,
              }}
            >
              ⬇ Download Diagnosis Report
            </a>
          </div>
        )}

        {/* ── QC Report download (customer-facing) ────────────────────── */}
        {(repair.qcReportUrl || repair.qcReportData) && (
          <div className="rounded-2xl p-5" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.2)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#6EE7B7', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              📋 Quality Control Report
            </p>
            <p style={{ fontSize: 12, color: '#9095B0', marginBottom: 14 }}>
              Your device has passed our quality control process. You can download the full QC report below.
            </p>
            <a
              href={repair.qcReportUrl || repair.qcReportData}
              download={repair.qcReportName ?? 'qc-report.pdf'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 0', borderRadius: 10, textDecoration: 'none',
                background: 'rgba(16,185,129,0.12)', border: '1.5px solid rgba(16,185,129,0.35)',
                color: '#6EE7B7', fontWeight: 700, fontSize: 13,
              }}
            >
              ⬇ Download QC Report (PDF)
            </a>
          </div>
        )}

        {/* ── Device & accessories ─────────────────────────────────────── */}
        <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#555A73', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Device Details</p>
          <div className="grid grid-cols-2 gap-y-3 gap-x-6 mb-4" style={{ fontSize: 12 }}>
            <div>
              <p style={{ color: '#555A73', marginBottom: 2 }}>Issue Reported</p>
              <p style={{ color: '#E4E7F0' }}>{repair.issueDescription}</p>
            </div>
            <div>
              <p style={{ color: '#555A73', marginBottom: 2 }}>Condition at Intake</p>
              <p style={{ color: '#E4E7F0', textTransform: 'capitalize' }}>{repair.deviceCondition ?? '—'}</p>
            </div>
          </div>
          {repair.accessories.length > 0 && (
            <>
              <p style={{ fontSize: 10, color: '#555A73', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Accessories Received</p>
              <div className="flex flex-wrap gap-2">
                {repair.accessories.map((a, i) => (
                  <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                    style={{
                      background: a.received ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)',
                      border: `1px solid ${a.received ? 'rgba(16,185,129,0.25)' : 'rgba(107,114,128,0.2)'}`,
                      color: a.received ? '#6EE7B7' : '#9CA3AF',
                    }}>
                    {a.received ? '✓' : '✗'} {a.name}
                    {a.notes && <span style={{ color: '#555A73' }}>({a.notes})</span>}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Status history ───────────────────────────────────────────── */}
        {repair.statusHistory.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#555A73', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Timeline</p>
            <div className="flex flex-col gap-0">
              {[...repair.statusHistory].reverse().map((h, i) => {
                const m = STATUS_META[h.status]
                return (
                  <div key={i} className="flex gap-3 pb-4" style={{ position: 'relative' }}>
                    {/* Vertical line */}
                    {i < repair.statusHistory.length - 1 && (
                      <div style={{ position: 'absolute', left: 11, top: 26, bottom: 0, width: 1, background: 'rgba(255,255,255,0.06)' }} />
                    )}
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: m?.bg ?? 'rgba(255,255,255,0.06)', border: `1.5px solid ${m?.color ?? '#333'}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0, zIndex: 1 }}>
                      {m?.icon ?? '•'}
                    </div>
                    <div>
                      <p style={{ fontSize: 12, color: '#E4E7F0', fontWeight: 500 }}>{m?.label ?? h.status}</p>
                      {h.note && <p style={{ fontSize: 11, color: '#555A73' }}>{h.note}</p>}
                      <p style={{ fontSize: 10, color: '#444A60', marginTop: 1 }}>{fmt(h.date)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Messages ─────────────────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(6,174,212,0.05)' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#E4E7F0' }}>💬 Messages</p>
              <p style={{ fontSize: 11, color: '#555A73' }}>Send a message to our team — we usually reply within 2 hours</p>
            </div>
            <button onClick={fetchMessages} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9095B0', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 11 }}>
              Refresh
            </button>
          </div>

          {/* Thread */}
          <div className="px-5 py-4 flex flex-col gap-3" style={{ minHeight: 120, maxHeight: 400, overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <div className="text-center py-6">
                <p style={{ fontSize: 28, marginBottom: 8 }}>📭</p>
                <p style={{ fontSize: 12, color: '#444A60' }}>No messages yet. Start the conversation below.</p>
              </div>
            ) : messages.map(m => {
              const isStaff = m.sender === 'staff'
              return (
                <div key={m.id} className="flex flex-col gap-1" style={{ alignItems: isStaff ? 'flex-start' : 'flex-end' }}>
                  <div style={{
                    maxWidth: '80%', padding: '10px 14px', borderRadius: isStaff ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
                    background: isStaff ? 'rgba(6,174,212,0.12)' : 'rgba(27,39,98,0.4)',
                    border: isStaff ? '1px solid rgba(6,174,212,0.2)' : '1px solid rgba(100,120,255,0.2)',
                  }}>
                    <p style={{ fontSize: 12, color: '#E4E7F0', lineHeight: 1.5 }}>{m.text}</p>
                  </div>
                  <p style={{ fontSize: 10, color: '#444A60', paddingLeft: isStaff ? 4 : 0, paddingRight: isStaff ? 0 : 4 }}>
                    {isStaff ? `🔧 ${m.senderName}` : `You · ${m.senderName}`} · {new Date(m.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}{' '}
                    {new Date(m.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Compose */}
          <div className="px-5 pb-5 flex flex-col gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
            {msgSent && (
              <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}>
                <span style={{ fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 12, color: '#6EE7B7' }}>Message sent — our team will respond shortly.</span>
              </div>
            )}
            <input
              value={senderName}
              onChange={e => setSenderName(e.target.value)}
              placeholder="Your name"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '9px 12px', color: '#E4E7F0', fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
            />
            <div className="flex gap-2">
              <textarea
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Type your message… (Enter to send)"
                rows={3}
                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '9px 12px', color: '#E4E7F0', fontSize: 12, resize: 'none', outline: 'none', fontFamily: 'inherit' }}
              />
              <button
                onClick={sendMessage}
                disabled={!msgText.trim() || !senderName.trim() || sendingMsg}
                style={{
                  padding: '0 18px', borderRadius: 8, border: 'none', cursor: msgText.trim() && senderName.trim() && !sendingMsg ? 'pointer' : 'not-allowed',
                  background: msgText.trim() && senderName.trim() ? 'linear-gradient(135deg, var(--accent-cyan), #0284C7)' : 'rgba(255,255,255,0.06)',
                  color: msgText.trim() && senderName.trim() ? '#fff' : '#444A60',
                  fontWeight: 600, fontSize: 13, transition: 'all 0.15s',
                }}>
                {sendingMsg ? '…' : '↑'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Contact footer ───────────────────────────────────────────── */}
        <div className="rounded-2xl p-5 text-center" style={{ background: 'rgba(6,174,212,0.04)', border: '1px solid rgba(6,174,212,0.12)' }}>
          <p style={{ fontSize: 12, color: '#9095B0' }}>Prefer to call or email?</p>
          <p className="mt-1" style={{ fontSize: 13 }}>
            <a href="tel:+254700000000" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>+254 700 000 000</a>
            <span style={{ color: '#444A60' }}> · </span>
            <a href="mailto:repairs@deed.co.ke" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>repairs@deed.co.ke</a>
          </p>
          <p style={{ fontSize: 11, color: '#444A60', marginTop: 6 }}>Mon–Sat · 8am–6pm · Westlands, Nairobi</p>
        </div>

      </div>

      {/* ── Decline modal ─────────────────────────────────────────────── */}
      {showDeclineModal && (
        <div
          className="fixed inset-0 flex h-dvh items-end sm:items-center justify-center overflow-y-auto overscroll-contain p-4 z-[9000]"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowDeclineModal(false) }}
        >
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: '#0d1020', border: '1px solid rgba(240,68,56,0.3)' }}>
            <h3 className="font-bold text-white mb-1">Decline Quote?</h3>
            <p style={{ fontSize: 12, color: '#9095B0', marginBottom: 16 }}>
              Your device will not be repaired and will be prepared for collection. This cannot be undone easily — you can still change your mind by calling us.
            </p>
            <label style={{ fontSize: 11, color: '#555A73', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Reason (optional)
            </label>
            <textarea
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="e.g. Cost too high, found repair elsewhere…"
              rows={3}
              style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 12, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowDeclineModal(false)} style={{ flex: 1, padding: '11px 0', borderRadius: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#9095B0', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={handleDecline} disabled={actioning} style={{ flex: 1, padding: '11px 0', borderRadius: 8, background: 'rgba(240,68,56,0.15)', border: '1.5px solid rgba(240,68,56,0.4)', color: '#FDA29B', cursor: actioning ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13 }}>
                {actioning ? '…' : 'Decline Quote'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.7}}`}</style>
    </div>
  )
}
