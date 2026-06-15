// @ts-nocheck
'use client'
import { useState, useMemo } from 'react'
import {
  useApp, fmtKes, fmtDate,
  Warranty, ReturnOrder, RMAResolution, ReturnOrderLine,
} from '@/lib/store'
import { Badge, Modal, StatCard, ExportButtons, SearchPicker, useEscapeKey } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faShield, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import TradeIn from './TradeIn'

// ── Helpers ───────────────────────────────────────────────────────────────────

const WARRANTY_STATUS_META: Record<Warranty['status'], { bg: string; color: string; label: string }> = {
  active:   { bg: '#DCFCE7', color: '#166534', label: 'Active' },
  expiring: { bg: '#FEF9C3', color: '#854D0E', label: 'Expiring Soon' },
  expired:  { bg: '#FEE2E2', color: '#991B1B', label: 'Expired' },
}

const RMA_STATUS_META: Record<ReturnOrder['status'], { bg: string; color: string; label: string; step: number }> = {
  requested: { bg: '#FEF9C3', color: '#854D0E', label: 'Requested',  step: 1 },
  approved:  { bg: '#DBEAFE', color: '#1D4ED8', label: 'Approved',   step: 2 },
  received:  { bg: '#EDE9FE', color: '#5B21B6', label: 'Received',   step: 3 },
  processed: { bg: '#DCFCE7', color: '#166534', label: 'Processed',  step: 4 },
  rejected:  { bg: '#FEE2E2', color: '#991B1B', label: 'Rejected',   step: 0 },
}

const RESOLUTION_LABELS: Record<RMAResolution, string> = {
  refund:      '💰 Refund',
  replacement: '🔄 Replacement',
  repair:      '🔧 Repair',
  credit_note: '📄 Credit Note',
}

// ── Main Component ─────────────────────────────────────────────────────────────

type Tab = 'warranties' | 'returns' | 'trade'
type ProcessedWarranty = Warranty & { daysLeft: number }

export default function AfterSales() {
  const {
    warranties, saleOrders, products, serials, users, currentUserId,
    returnOrders, buyBacks, donations, clientExchanges,
    createReturnOrder, approveReturn, receiveReturn, processReturn, rejectReturn,
    showToast,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId)
  const isAdmin     = currentUser?.role === 'director'
  const isFinance   = currentUser?.role === 'finance_officer'
  const canManage   = isAdmin || isFinance

  const [tab, setTab] = useState<Tab>('warranties')

  // ── Warranty state ──────────────────────────────────────────────────────────
  const [wFilter, setWFilter] = useState<Warranty['status'] | 'all'>('all')
  const [wSearch, setWSearch] = useState('')
  const [selectedWarranty, setSelectedWarranty] = useState<ProcessedWarranty | null>(null)

  // ── RMA state ───────────────────────────────────────────────────────────────
  const [rmaFilter, setRmaFilter] = useState<ReturnOrder['status'] | 'all'>('all')
  const [rmaSearch, setRmaSearch] = useState('')
  const [selectedRMA, setSelectedRMA] = useState<ReturnOrder | null>(null)

  // Create RMA modal
  const [showCreateRMA, setShowCreateRMA] = useState(false)
  const [rmaSORef, setRmaSORef]           = useState('')
  const [rmaReason, setRmaReason]         = useState('')
  const [rmaLines, setRmaLines]           = useState<{ productId: string; productName: string; qty: string; serialIds: string[]; condition: ReturnOrderLine['condition']; reason: string }[]>([])

  // Process modal
  const [showProcess, setShowProcess]         = useState(false)
  const [processRMA, setProcessRMA]           = useState<ReturnOrder | null>(null)
  const [resolution, setResolution]           = useState<RMAResolution>('refund')
  const [refundAmount, setRefundAmount]       = useState('')
  const [refundPaymentMethod, setRefundPaymentMethod] = useState<'cash' | 'mpesa' | 'bank_transfer'>('cash')
  const [processNotes, setProcessNotes]       = useState('')

  // Reject modal
  const [showReject, setShowReject]       = useState(false)
  const [rejectTarget, setRejectTarget]   = useState<ReturnOrder | null>(null)
  const [rejectReason, setRejectReason]   = useState('')

  useEscapeKey(() => setShowCreateRMA(false), showCreateRMA)
  useEscapeKey(() => setShowProcess(false), showProcess && !!processRMA)
  useEscapeKey(() => setShowReject(false), showReject && !!rejectTarget)

  // ── Derived warranty data ───────────────────────────────────────────────────
  const refreshedWarranties = useMemo<ProcessedWarranty[]>(() => {
    const now = Date.now()
    return warranties.map(w => {
      const daysLeft = Math.ceil((new Date(w.endDate).getTime() - now) / 86400000)
      const status: Warranty['status'] = daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'active'
      return { ...w, status, daysLeft }
    })
  }, [warranties])

  const filteredWarranties = useMemo(() => {
    const q = wSearch.toLowerCase()
    return refreshedWarranties.filter(w =>
      (wFilter === 'all' || w.status === wFilter) &&
      (!q || w.customerName.toLowerCase().includes(q) || w.productName.toLowerCase().includes(q) || w.serialNumber.toLowerCase().includes(q))
    )
  }, [refreshedWarranties, wFilter, wSearch])

  const wStats = useMemo(() => {
    let active = 0, expiring = 0, expired = 0
    for (const w of refreshedWarranties) {
      if (w.status === 'active') active++
      else if (w.status === 'expiring') expiring++
      else if (w.status === 'expired') expired++
    }
    return { total: refreshedWarranties.length, active, expiring, expired }
  }, [refreshedWarranties])

  // ── Derived RMA data ────────────────────────────────────────────────────────
  const filteredRMAs = useMemo(() => {
    const q = rmaSearch.toLowerCase()
    return returnOrders.filter(r =>
      (rmaFilter === 'all' || r.status === rmaFilter) &&
      (!q || r.ref.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q) || r.saleOrderRef.toLowerCase().includes(q))
    )
  }, [returnOrders, rmaFilter, rmaSearch])

  const rmaStats = useMemo(() => {
    let requested = 0, approved = 0, received = 0, processed = 0
    for (const r of returnOrders) {
      if (r.status === 'requested') requested++
      else if (r.status === 'approved') approved++
      else if (r.status === 'received') received++
      else if (r.status === 'processed') processed++
    }
    return { total: returnOrders.length, requested, approved, received, processed }
  }, [returnOrders])

  // ── Memoized Export Rows ────────────────────────────────────────────────────
  const warrantyExportRows = useMemo(() => 
    filteredWarranties.map(w => [w.ref, w.customerName, w.productName, w.serialNumber, w.months, fmtDate(w.startDate), fmtDate(w.endDate), w.status]),
  [filteredWarranties])

  const rmaExportRows = useMemo(() => 
    filteredRMAs.map(r => [r.ref, r.customerName, r.saleOrderRef, fmtDate(r.requestDate), r.resolution ? RESOLUTION_LABELS[r.resolution] : '—', r.refundAmount || 0, r.status]),
  [filteredRMAs])

  // ── RMA creation helpers ────────────────────────────────────────────────────
  const matchedSO = useMemo(() =>
    saleOrders.find(o => (o.ref ?? '').toLowerCase() === rmaSORef.toLowerCase().trim()),
    [saleOrders, rmaSORef]
  )

  function openCreateRMA() {
    setRmaSORef(''); setRmaReason(''); setRmaLines([])
    setShowCreateRMA(true)
  }

  function addRMALine() {
    if (!matchedSO) return
    const firstLine = matchedSO.lines[0]
    const prod = products.find(p => p.id === firstLine?.productId)
    setRmaLines(prev => [...prev, {
      productId: firstLine?.productId ?? '',
      productName: firstLine?.productName ?? '',
      qty: '1',
      serialIds: [],
      condition: 'good',
      reason: '',
    }])
  }

  function submitRMA() {
    if (!matchedSO || !rmaReason.trim() || rmaLines.length === 0) {
      showToast('Fill in all required fields', 'error'); return
    }
    const lines = rmaLines.map(l => ({
      productId: l.productId, productName: l.productName,
      qty: Number(l.qty) || 1, serialIds: l.serialIds,
      condition: l.condition, reason: l.reason,
    }))
    const order = createReturnOrder(
      matchedSO.id, matchedSO.ref,
      matchedSO.customerId, matchedSO.customerName,
      rmaReason, lines
    )
    setShowCreateRMA(false)
    setSelectedRMA(order)
  }

  function handleProcess() {
    if (!processRMA) return
    processReturn(
      processRMA.id, resolution,
      refundAmount ? Number(refundAmount) : undefined,
      processNotes || undefined,
      resolution === 'refund' ? refundPaymentMethod : undefined,
    )
    setShowProcess(false)
    setProcessRMA(null)
    if (selectedRMA?.id === processRMA.id) {
      setSelectedRMA(prev => prev ? { ...prev, status: 'processed', resolution, refundAmount: refundAmount ? Number(refundAmount) : undefined, processNotes } : prev)
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // WARRANTY DETAIL PANEL
  // ════════════════════════════════════════════════════════════════════════════
  if (selectedWarranty) {
    const w    = selectedWarranty
    const meta = WARRANTY_STATUS_META[w.status]
    const days = w.daysLeft
    return (
      <div className="flex flex-col gap-3 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedWarranty(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 20, lineHeight: 1 }}>←</button>
          <div>
            <h2 className="text-sm font-bold text-t1">{w.ref}</h2>
            <p className="text-11 text-t3">{w.productName} · {w.serialNumber}</p>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 10, padding: '3px 10px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 700 }}>
            {meta.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4 space-y-3">
            <p className="text-10 font-semibold text-t3 uppercase tracking-wider">Warranty Details</p>
            <div className="space-y-2 text-12">
              <div className="flex justify-between"><span className="text-t3">Customer</span><span className="font-medium">{w.customerName}</span></div>
              <div className="flex justify-between"><span className="text-t3">Product</span><span className="font-medium">{w.productName}</span></div>
              <div className="flex justify-between"><span className="text-t3">Serial No</span><span className="font-mono font-semibold">{w.serialNumber}</span></div>
              <div className="flex justify-between"><span className="text-t3">Duration</span><span>{w.months} months</span></div>
              <div className="flex justify-between"><span className="text-t3">Sale Order</span><span className="font-mono">{w.saleOrderRef}</span></div>
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <p className="text-10 font-semibold text-t3 uppercase tracking-wider">Coverage Period</p>
            <div className="space-y-2 text-12">
              <div className="flex justify-between"><span className="text-t3">Start Date</span><span>{fmtDate(w.startDate)}</span></div>
              <div className="flex justify-between"><span className="text-t3">End Date</span><span className={days < 0 ? 'text-red-600 font-semibold' : days <= 30 ? 'text-yellow-700 font-semibold' : ''}>{fmtDate(w.endDate)}</span></div>
              <div className="flex justify-between">
                <span className="text-t3">Days Remaining</span>
                <span style={{ fontWeight: 700, color: days < 0 ? '#DC2626' : days <= 30 ? 'var(--warning)' : '#059669' }}>
                  {days < 0 ? `${Math.abs(days)} days overdue` : `${days} days`}
                </span>
              </div>
            </div>
            {/* Progress bar */}
            {(() => {
              const total = (new Date(w.endDate).getTime() - new Date(w.startDate).getTime()) / 86400000
              const used  = (Date.now() - new Date(w.startDate).getTime()) / 86400000
              const pct   = Math.max(0, Math.min(100, Math.round((used / total) * 100)))
              return (
                <div>
                  <div style={{ height: 8, borderRadius: 8, background: '#E5E7EB', overflow: 'hidden', marginTop: 8 }}>
                    <div style={{ height: '100%', borderRadius: 8, width: `${pct}%`, background: pct >= 100 ? '#DC2626' : pct >= 85 ? '#F59E0B' : '#10B981', transition: 'width 0.4s' }} />
                  </div>
                  <p className="text-9 text-t3 mt-1">{pct}% of warranty period used</p>
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RMA DETAIL PANEL
  // ════════════════════════════════════════════════════════════════════════════
  if (selectedRMA) {
    const rma  = returnOrders.find(r => r.id === selectedRMA.id) ?? selectedRMA
    const meta = RMA_STATUS_META[rma.status]
    const STEPS: { status: ReturnOrder['status']; label: string }[] = [
      { status: 'requested', label: 'Submitted' },
      { status: 'approved',  label: 'Approved' },
      { status: 'received',  label: 'Received' },
      { status: 'processed', label: 'Processed' },
    ]
    const currentStep = rma.status === 'rejected' ? -1 : RMA_STATUS_META[rma.status].step

    return (
      <div className="flex flex-col gap-3 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedRMA(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 20, lineHeight: 1 }}>←</button>
          <div>
            <h2 className="text-sm font-bold text-t1">{rma.ref}</h2>
            <p className="text-11 text-t3">{rma.customerName} · {rma.saleOrderRef}</p>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 10, padding: '3px 10px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 700 }}>
            {meta.label}
          </span>
        </div>

        {/* Progress stepper */}
        {rma.status !== 'rejected' && (
          <div className="card px-6 py-4">
            <div className="flex items-center gap-0">
              {STEPS.map((s, i) => {
                const done = RMA_STATUS_META[s.status].step <= currentStep
                const curr = RMA_STATUS_META[s.status].step === currentStep
                return (
                  <div key={s.status} className="flex items-center flex-1">
                    <div className="flex flex-col items-center gap-1">
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: done ? 'var(--ink-navy)' : '#F3F4F6', color: done ? '#fff' : '#9CA3AF', fontSize: 12, fontWeight: 700,
                        border: curr ? '2px solid #00B0D7' : 'none',
                      }}>
                        {done && !curr ? '✓' : i + 1}
                      </div>
                      <p style={{ fontSize: 9, fontWeight: curr ? 700 : 400, color: done ? 'var(--ink-navy)' : '#9CA3AF', whiteSpace: 'nowrap' }}>{s.label}</p>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div style={{ flex: 1, height: 2, background: RMA_STATUS_META[s.status].step < currentStep ? 'var(--ink-navy)' : '#E5E7EB', margin: '0 4px', marginBottom: 18 }} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {rma.status === 'rejected' && (
          <div className="card px-4 py-3 flex items-center gap-2" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <span>❌</span>
            <p className="text-xs text-red-700">Return rejected{rma.notes ? ` — ${rma.notes}` : ''}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {/* Details */}
          <div className="card p-4 space-y-2 text-12">
            <p className="text-10 font-semibold text-t3 uppercase tracking-wider mb-2">Return Details</p>
            <div className="flex justify-between"><span className="text-t3">Customer</span><span className="font-medium">{rma.customerName}</span></div>
            <div className="flex justify-between"><span className="text-t3">Sale Order</span><span className="font-mono">{rma.saleOrderRef}</span></div>
            <div className="flex justify-between"><span className="text-t3">Request Date</span><span>{fmtDate(rma.requestDate)}</span></div>
            <div><span className="text-t3">Reason:</span><p className="mt-1 text-t1">{rma.reason}</p></div>
            {rma.resolution && (
              <div className="flex justify-between pt-1 border-t" style={{ borderColor: '#F3F4F6' }}>
                <span className="text-t3">Resolution</span>
                <span className="font-semibold">{RESOLUTION_LABELS[rma.resolution]}</span>
              </div>
            )}
            {rma.refundAmount !== undefined && (
              <div className="flex justify-between"><span className="text-t3">Refund Amount</span><span className="font-mono font-semibold" style={{ color: '#059669' }}>{fmtKes(rma.refundAmount)}</span></div>
            )}
          </div>

          {/* Timeline */}
          <div className="card p-4 space-y-2">
            <p className="text-10 font-semibold text-t3 uppercase tracking-wider mb-2">Timeline</p>
            <div className="space-y-2 text-11">
              <div className="flex gap-2"><span style={{ color: '#9CA3AF' }}>📝</span><span>Submitted {fmtDate(rma.requestDate)}</span></div>
              {rma.approvedDate && <div className="flex gap-2"><span style={{ color: '#3B82F6' }}>✅</span><span>Approved {fmtDate(rma.approvedDate)} by {rma.approvedByName}</span></div>}
              {rma.receivedDate && <div className="flex gap-2"><span style={{ color: '#8B5CF6' }}>📦</span><span>Received {fmtDate(rma.receivedDate)}</span></div>}
              {rma.processedDate && <div className="flex gap-2"><span style={{ color: '#059669' }}>🏁</span><span>Processed {fmtDate(rma.processedDate)} by {rma.processedByName}</span></div>}
              {rma.notes && <div className="flex gap-2 pt-1 border-t" style={{ borderColor: '#F3F4F6' }}><span>📌</span><span>{rma.notes}</span></div>}
            </div>
          </div>
        </div>

        {/* Lines */}
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b text-11 font-semibold text-t2" style={{ borderColor: '#F3F4F6' }}>
            Return Lines
          </div>
          <div className="overflow-x-auto w-full">
            <div className="min-w-[500px] flex flex-col">
              {rma.lines.map(line => (
                <div key={line.id} className="px-4 py-3 border-b flex items-start gap-4 text-12" style={{ borderColor: '#F9FAFB' }}>
                  <div className="flex-1">
                    <p className="font-semibold text-t1">{line.productName}</p>
                    <p className="text-10 text-t3">Qty: {line.qty} · Condition: <span className="font-medium capitalize">{line.condition}</span></p>
                    {line.serialIds.length > 0 && <p className="text-10 font-mono text-t3">{line.serialIds.join(', ')}</p>}
                  </div>
                  <p className="text-11 text-t2">{line.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            {rma.status === 'requested' && (
              <>
                <button className="btn-primary text-11 px-4 py-2" onClick={() => approveReturn(rma.id)}>
                  ✓ Approve Return
                </button>
                <button className="btn-outline text-11 px-4 py-2" style={{ color: '#DC2626', borderColor: '#FECACA' }}
                  onClick={() => { setRejectTarget(rma); setRejectReason(''); setShowReject(true) }}>
                  ✗ Reject
                </button>
              </>
            )}
            {rma.status === 'approved' && (
              <button className="btn-primary text-11 px-4 py-2" onClick={() => receiveReturn(rma.id)}>
                📦 Mark Items Received
              </button>
            )}
            {rma.status === 'received' && (
              <button className="btn-primary text-11 px-4 py-2"
                onClick={() => { setProcessRMA(rma); setResolution('refund'); setRefundAmount(String(saleOrders.find(o => o.id === rma.saleOrderId)?.total ?? '')); setProcessNotes(''); setShowProcess(true) }}>
                🏁 Process Return
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN LIST VIEW
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="mod-page">

      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ background: '#05906918', color: '#059669' }}>
            <Fa icon={faShield} style={{ fontSize: 14 }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-extrabold text-text-1">After-Sales</h1>
              <span className="badge badge-gray text-9">{wStats.total + rmaStats.total + buyBacks.length + donations.length + clientExchanges.length}</span>
            </div>
            <p className="text-10 text-text-3 mt-0.5">Warranty, returns, buy-backs, donations and exchanges</p>
          </div>
        </div>
        {tab === 'returns' && (
          <button className="btn-primary text-11" onClick={openCreateRMA}>+ New Return (RMA)</button>
        )}
      </div>

      <div className="mod-tabs">
        <button className={`mod-tab ${tab === 'warranties' ? 'active' : ''}`} onClick={() => setTab('warranties')}>Warranties ({wStats.total})</button>
        <button className={`mod-tab ${tab === 'returns' ? 'active' : ''}`} onClick={() => setTab('returns')}>Returns / RMA ({rmaStats.total})</button>
        <button className={`mod-tab ${tab === 'trade' ? 'active' : ''}`} onClick={() => setTab('trade')}>Trade-In ({buyBacks.length + donations.length + clientExchanges.length})</button>
      </div>

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

      {tab === 'trade' && <TradeIn />}

      {/* ── WARRANTIES TAB ─────────────────────────────────────────────────── */}
      {tab === 'warranties' && (
        <div className="space-y-3">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Warranties', value: wStats.total,    color: 'var(--ink-navy)' },
              { label: 'Active',           value: wStats.active,   color: '#059669' },
              { label: 'Expiring (≤30d)',  value: wStats.expiring, color: '#D97706' },
              { label: 'Expired',          value: wStats.expired,  color: '#DC2626' },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <p className="text-10 text-t3">{s.label}</p>
                <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'active', 'expiring', 'expired'] as const).map(f => (
              <button key={f} onClick={() => setWFilter(f)}
                className="text-10 px-3 py-1 rounded-full cursor-pointer transition-all"
                style={{
                  background: wFilter === f ? 'var(--ink-navy)' : '#F3F4F6',
                  color: wFilter === f ? '#fff' : '#6B7280',
                  border: '1px solid transparent', fontWeight: wFilter === f ? 600 : 400,
                }}>
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <input className="form-input text-11 py-1.5 ml-2" style={{ width: 200 }}
              placeholder="Search customer, product, serial…"
              value={wSearch} onChange={e => setWSearch(e.target.value)} />
            <div className="ml-auto">
              <ExportButtons
                title="Warranties List"
                filename="warranties_list"
                headers={['Ref', 'Customer', 'Product', 'Serial No', 'Duration (Months)', 'Start Date', 'End Date', 'Status']}
                rows={warrantyExportRows}
              />
            </div>
          </div>

          {/* Warranty list */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto w-full">
              <div className="min-w-[800px] flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '90px 1fr 1fr 120px 110px 110px 90px', gap: 12 }}>
              {['Ref', 'Customer', 'Product / Serial', 'Duration', 'Start', 'End / Expires', 'Status'].map(h => <span key={h}>{h}</span>)}
            </div>
            {filteredWarranties.length === 0 ? (
              <div className="py-14 text-center text-t3 text-sm">
                <div style={{ fontSize: 36 }} className="mb-2">🛡️</div>
                {warranties.length === 0 ? 'No warranties yet — they are created automatically when a delivery is validated.' : 'No warranties match the filter.'}
              </div>
            ) : filteredWarranties.map(w => {
              const meta = WARRANTY_STATUS_META[w.status]
              const days = w.daysLeft
              return (
                <div key={w.id} className="table-row cursor-pointer"
                  style={{ gridTemplateColumns: '90px 1fr 1fr 120px 110px 110px 90px', gap: 12 }}
                  onClick={() => setSelectedWarranty(w)}>
                  <span className="font-mono text-11 font-semibold" style={{ color: 'var(--ink-navy)' }}>{w.ref}</span>
                  <span className="text-xs font-medium truncate">{w.customerName}</span>
                  <div>
                    <p className="text-xs truncate">{w.productName}</p>
                    <p className="text-10 font-mono text-t3">{w.serialNumber}</p>
                  </div>
                  <span className="text-xs text-t3">{w.months} months</span>
                  <span className="text-xs text-t3">{fmtDate(w.startDate)}</span>
                  <div>
                    <p className="text-xs">{fmtDate(w.endDate)}</p>
                    <p style={{ fontSize: 9, fontWeight: 600, color: days < 0 ? '#DC2626' : days <= 30 ? 'var(--warning)' : '#059669' }}>
                      {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                    </p>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block' }}>
                    {meta.label}
                  </span>
                </div>
              )
            })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RETURNS / RMA TAB ──────────────────────────────────────────────── */}
      {tab === 'returns' && (
        <div className="space-y-3">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Total',     value: rmaStats.total,     color: 'var(--ink-navy)' },
              { label: 'Requested', value: rmaStats.requested, color: '#D97706' },
              { label: 'Approved',  value: rmaStats.approved,  color: '#3B82F6' },
              { label: 'Received',  value: rmaStats.received,  color: '#8B5CF6' },
              { label: 'Processed', value: rmaStats.processed, color: '#059669' },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <p className="text-10 text-t3">{s.label}</p>
                <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'requested', 'approved', 'received', 'processed', 'rejected'] as const).map(f => (
              <button key={f} onClick={() => setRmaFilter(f)}
                className="text-10 px-3 py-1 rounded-full cursor-pointer transition-all"
                style={{
                  background: rmaFilter === f ? 'var(--ink-navy)' : '#F3F4F6',
                  color: rmaFilter === f ? '#fff' : '#6B7280',
                  border: '1px solid transparent', fontWeight: rmaFilter === f ? 600 : 400,
                }}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <input className="form-input text-11 py-1.5 ml-2" style={{ width: 220 }}
              placeholder="Search ref, customer, order…"
              value={rmaSearch} onChange={e => setRmaSearch(e.target.value)} />
            <div className="ml-auto">
              <ExportButtons
                title="Returns & RMAs"
                filename="returns_rmas"
                headers={['Ref', 'Customer', 'Sale Order', 'Request Date', 'Resolution', 'Refund Amount (KES)', 'Status']}
                rows={rmaExportRows}
              />
            </div>
          </div>

          {/* RMA list */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto w-full">
              <div className="min-w-[800px] flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '100px 1fr 110px 100px 110px 90px', gap: 12 }}>
              {['Ref', 'Customer', 'Sale Order', 'Request Date', 'Resolution', 'Status'].map(h => <span key={h}>{h}</span>)}
            </div>
            {filteredRMAs.length === 0 ? (
              <div className="py-14 text-center text-t3 text-sm">
                <div style={{ fontSize: 36 }} className="mb-2">↩️</div>
                {returnOrders.length === 0 ? 'No return requests yet. Click "+ New Return (RMA)" to create one.' : 'No returns match the filter.'}
              </div>
            ) : filteredRMAs.map(rma => {
              const meta = RMA_STATUS_META[rma.status]
              return (
                <div key={rma.id} className="table-row cursor-pointer"
                  style={{ gridTemplateColumns: '100px 1fr 110px 100px 110px 90px', gap: 12 }}
                  onClick={() => setSelectedRMA(rma)}>
                  <span className="font-mono text-11 font-semibold" style={{ color: 'var(--ink-navy)' }}>{rma.ref}</span>
                  <div>
                    <p className="text-xs font-medium">{rma.customerName}</p>
                    <p className="text-10 text-t3 truncate">{rma.reason}</p>
                  </div>
                  <span className="font-mono text-xs">{rma.saleOrderRef}</span>
                  <span className="text-xs text-t3">{fmtDate(rma.requestDate)}</span>
                  <span className="text-xs text-t3">{rma.resolution ? RESOLUTION_LABELS[rma.resolution] : '—'}</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block' }}>
                    {meta.label}
                  </span>
                </div>
              )
            })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Create RMA Modal ──────────────────────────────────────────────── */}
      {showCreateRMA && (
        <div className="modal-overlay" onClick={() => setShowCreateRMA(false)}>
          <div className="modal-box w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-t1">New Return Request</h3>
              <button onClick={() => setShowCreateRMA(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9CA3AF' }}>×</button>
            </div>

            <div className="space-y-3">
              {/* Sale Order lookup */}
              <div>
                {saleOrders.length > 0 ? (
                  <SearchPicker label="Sale Order Reference *" placeholder="Search by order ref or customer…" items={saleOrders}
                    onSelect={so => setRmaSORef(so.ref ?? '')}
                    renderItem={so => (
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-xs text-t1">{so.ref}</p>
                          <p className="text-10 text-t3">{so.customerName} · {fmtDate(so.date)}</p>
                        </div>
                        <span className="text-11 font-semibold text-t2">{fmtKes(so.total)}</span>
                      </div>
                    )} />
                ) : (
                  <>
                    <label className="text-11 font-semibold text-t2 block mb-1">Sale Order Reference *</label>
                    <input className="form-input w-full text-12" placeholder="e.g. SO/0045"
                      value={rmaSORef} onChange={e => setRmaSORef(e.target.value)} />
                  </>
                )}
                {rmaSORef && !matchedSO && <p className="text-10 text-red-600 mt-1">No sale order found with this reference</p>}
                {matchedSO && (
                  <div className="mt-1 px-3 py-2 rounded-lg text-11" style={{ background: '#F0FDF4', border: '1px solid #A7F3D0' }}>
                    ✓ {matchedSO.customerName} · {fmtDate(matchedSO.date)} · {fmtKes(matchedSO.total)}
                  </div>
                )}
              </div>

              <div>
                <label className="text-11 font-semibold text-t2 block mb-1">Return Reason *</label>
                <textarea className="form-input w-full text-12" rows={2}
                  placeholder="Describe why the customer is returning the item(s)…"
                  value={rmaReason} onChange={e => setRmaReason(e.target.value)} />
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-11 font-semibold text-t2">Return Items *</label>
                  {matchedSO && (
                    <button onClick={addRMALine}
                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid #A8D4E8', background: '#E8F3FA', color: '#14204F', cursor: 'pointer' }}>
                      + Add Item
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {rmaLines.map((line, i) => (
                    <div key={i} className="rounded-lg p-3 space-y-2" style={{ background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-9 text-t3 block mb-0.5">Product</label>
                          <select className="form-input w-full text-11"
                            value={line.productId}
                            onChange={e => {
                              const p = products.find(p => p.id === e.target.value)
                              setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, productId: e.target.value, productName: p?.name ?? '' } : l))
                            }}>
                            <option value="">Select product…</option>
                            {(matchedSO?.lines ?? []).map(sl => (
                              <option key={sl.productId} value={sl.productId}>{sl.productName}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-9 text-t3 block mb-0.5">Condition</label>
                          <select className="form-input w-full text-11"
                            value={line.condition}
                            onChange={e => setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, condition: e.target.value as ReturnOrderLine['condition'] } : l))}>
                            <option value="good">Good</option>
                            <option value="damaged">Damaged</option>
                            <option value="defective">Defective</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-9 text-t3 block mb-0.5">Item Reason</label>
                        <input className="form-input w-full text-11" placeholder="e.g. Screen cracked, Not turning on"
                          value={line.reason}
                          onChange={e => setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, reason: e.target.value } : l))} />
                      </div>
                      <button onClick={() => setRmaLines(prev => prev.filter((_, j) => j !== i))}
                        style={{ fontSize: 10, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Remove
                      </button>
                    </div>
                  ))}
                  {rmaLines.length === 0 && matchedSO && (
                    <p className="text-11 text-t3 text-center py-2">Click "+ Add Item" to add return lines</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-11 py-2 px-4" onClick={() => setShowCreateRMA(false)}>Cancel</button>
              <button className="btn-primary text-11 py-2 px-4"
                disabled={!matchedSO || !rmaReason.trim() || rmaLines.length === 0}
                style={{ opacity: (!matchedSO || !rmaReason.trim() || rmaLines.length === 0) ? 0.5 : 1 }}
                onClick={submitRMA}>
                Submit Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Process Return Modal ──────────────────────────────────────────── */}
      {showProcess && processRMA && (
        <div className="modal-overlay" onClick={() => setShowProcess(false)}>
          <div className="modal-box w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-t1">Process Return — {processRMA.ref}</h3>
              <button onClick={() => setShowProcess(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9CA3AF' }}>×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-11 font-semibold text-t2 block mb-2">Resolution *</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['refund', 'replacement', 'repair', 'credit_note'] as const).map(r => (
                    <button key={r} onClick={() => setResolution(r)}
                      style={{
                        padding: '10px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                        border: `1.5px solid ${resolution === r ? 'var(--ink-navy)' : '#E5E7EB'}`,
                        background: resolution === r ? '#E8F3FA' : '#FAFAFA',
                        color: resolution === r ? 'var(--ink-navy)' : '#6B7280',
                        fontSize: 11, fontWeight: resolution === r ? 700 : 400,
                      }}>
                      {RESOLUTION_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>
              {(resolution === 'refund' || resolution === 'credit_note') && (
                <div>
                  <label className="text-11 font-semibold text-t2 block mb-1">Amount (KES)</label>
                  <input type="number" className="form-input w-full text-12"
                    value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
                </div>
              )}
              {resolution === 'refund' && (
                <div>
                  <label className="text-11 font-semibold text-t2 block mb-1">Payment Method</label>
                  <div className="flex gap-2">
                    {([['cash','💵 Cash'],['mpesa','📱 M-Pesa'],['bank_transfer','🏦 Bank Transfer']] as const).map(([val, lbl]) => (
                      <button key={val} onClick={() => setRefundPaymentMethod(val)}
                        style={{
                          flex: 1, padding: '8px 6px', borderRadius: 8, cursor: 'pointer', fontSize: 10,
                          border: `1.5px solid ${refundPaymentMethod === val ? 'var(--ink-navy)' : '#E5E7EB'}`,
                          background: refundPaymentMethod === val ? '#E8F3FA' : '#FAFAFA',
                          color: refundPaymentMethod === val ? 'var(--ink-navy)' : '#6B7280',
                          fontWeight: refundPaymentMethod === val ? 700 : 400,
                        }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="text-11 font-semibold text-t2 block mb-1">Notes (optional)</label>
                <textarea className="form-input w-full text-12" rows={2}
                  value={processNotes} onChange={e => setProcessNotes(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-11 py-2 px-4" onClick={() => setShowProcess(false)}>Cancel</button>
              <button className="btn-primary text-11 py-2 px-4" onClick={handleProcess}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Modal ─────────────────────────────────────────────────── */}
      {showReject && rejectTarget && (
        <div className="modal-overlay" onClick={() => setShowReject(false)}>
          <div className="modal-box w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-t1">Reject Return</h3>
              <button onClick={() => setShowReject(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9CA3AF' }}>×</button>
            </div>
            <div className="space-y-3">
              <p className="text-12 text-t2">Provide a reason for rejection — this will be visible on the return record.</p>
              <textarea className="form-input w-full text-12" rows={3} placeholder="e.g. Item is outside warranty period…"
                value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-11 py-2 px-4" onClick={() => setShowReject(false)}>Cancel</button>
              <button className="text-11 py-2 px-4 rounded-lg font-semibold"
                style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', cursor: 'pointer' }}
                disabled={!rejectReason.trim()}
                onClick={() => {
                  rejectReturn(rejectTarget.id, rejectReason)
                  setShowReject(false)
                }}>
                Reject Return
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* mod-body */}
    </div>
  )
}
