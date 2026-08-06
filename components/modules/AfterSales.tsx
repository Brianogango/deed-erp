// @ts-nocheck
'use client'
import { Suspense, useState, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  useAfterSalesStore, fmtKes, fmtDate,
  Warranty, ReturnOrder, RMAResolution, ReturnOrderLine,
} from '@/lib/store'
import { Badge, Modal, ModuleSkeleton, useMounted, ModuleHeader, TabBar } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  Fa, faShield, faRotateLeft, faPlus, faMoneyBillWave, faArrowsRotate, faWrench,
  faFileLines, faCircleXmark, faNoteSticky, faCircleCheck, faBox, faFlagCheckered,
  faThumbtack, faMoneyBill, faMobileScreenButton, faBuildingColumns,
} from '@/components/icons'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import TradeIn from './TradeIn'
import { SerialReturnPicker } from '@/components/tradein/SerialReturnPicker'
import { useUrlQueryState, useUrlRecordId } from '@/hooks/useUrlRecordId'

// ── Helpers ───────────────────────────────────────────────────────────────────

const WARRANTY_STATUS_META: Record<Warranty['status'], { bg: string; color: string; label: string }> = {
  active:   { bg: 'var(--success-bg)', color: 'var(--success-text)', label: 'Active' },
  expiring: { bg: '#FEF9C3', color: '#854D0E', label: 'Expiring Soon' },
  expired:  { bg: 'var(--danger-bg)', color: '#991B1B', label: 'Expired' },
}

const RMA_STATUS_META: Record<ReturnOrder['status'], { bg: string; color: string; label: string; step: number }> = {
  requested: { bg: '#FEF9C3', color: '#854D0E', label: 'Requested',  step: 1 },
  approved:  { bg: 'var(--primary-light)', color: 'var(--primary-dark)', label: 'Approved',   step: 2 },
  received:  { bg: '#EDE9FE', color: '#5B21B6', label: 'Received',   step: 3 },
  processed: { bg: 'var(--success-bg)', color: 'var(--success-text)', label: 'Processed',  step: 4 },
  rejected:  { bg: 'var(--danger-bg)', color: '#991B1B', label: 'Rejected',   step: 0 },
}

const RESOLUTION_META: Record<RMAResolution, { label: string; icon: IconProp }> = {
  refund:      { label: 'Refund',      icon: faMoneyBillWave },
  replacement: { label: 'Replacement', icon: faArrowsRotate },
  repair:      { label: 'Repair',      icon: faWrench },
  credit_note: { label: 'Credit Note', icon: faFileLines },
}
const RESOLUTION_LABELS: Record<RMAResolution, string> = {
  refund: RESOLUTION_META.refund.label,
  replacement: RESOLUTION_META.replacement.label,
  repair: RESOLUTION_META.repair.label,
  credit_note: RESOLUTION_META.credit_note.label,
}

// ── Main Component ─────────────────────────────────────────────────────────────

type Tab = 'warranties' | 'returns' | 'trade'
type ProcessedWarranty = Warranty & { daysLeft: number }
const AFTER_SALES_TABS: Tab[] = ['warranties', 'returns', 'trade']
const TRADE_IN_TABS = ['buybacks', 'donations', 'exchanges']

function AfterSalesContent() {
  const mounted = useMounted()
  const {
    warranties, saleOrders, products, serials, users, currentUserId,
    returnOrders, buyBacks, donations, clientExchanges,
    createReturnOrder, approveReturn, receiveReturn, processReturn, rejectReturn,
    showToast,
  } = useAfterSalesStore()

  const currentUser = users.find(u => u.id === currentUserId)
  const isAdmin     = currentUser?.role === 'director'
  const isFinance   = currentUser?.role === 'finance_officer'
  const canManage   = isAdmin || isFinance

  const [tabParam] = useUrlQueryState('tab', 'warranties')
  const tab: Tab = AFTER_SALES_TABS.includes(tabParam as Tab)
    ? tabParam as Tab
    : TRADE_IN_TABS.includes(tabParam)
      ? 'trade'
      : 'warranties'
  const [detailId, setDetailId] = useUrlRecordId({ whenOpen: { tab } })
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  function selectTab(nextTab: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', nextTab)
    params.delete('id')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // ── Warranty state ──────────────────────────────────────────────────────────
  const [wFilter, setWFilter] = useState<Warranty['status'] | 'all'>('all')
  const [wSearch, setWSearch] = useState('')

  // ── RMA state ───────────────────────────────────────────────────────────────
  const [rmaFilter, setRmaFilter] = useState<ReturnOrder['status'] | 'all'>('all')
  const [rmaSearch, setRmaSearch] = useState('')

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

  const selectedWarranty = tab === 'warranties' && detailId
    ? refreshedWarranties.find(w => w.id === detailId) ?? null
    : null
  const selectedRMA = tab === 'returns' && detailId
    ? returnOrders.find(r => r.id === detailId) ?? null
    : null

  // ── RMA creation helpers ────────────────────────────────────────────────────
  const matchedSO = useMemo(() =>
    saleOrders.find(o => o.ref.toLowerCase() === rmaSORef.toLowerCase().trim()),
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
    for (const line of rmaLines) {
      if (!line.productId) { showToast('Each return line needs a product', 'error'); return }
      const product = products.find(p => p.id === line.productId)
      const qty = Number(line.qty) || 0
      if (qty <= 0) { showToast(`Quantity must be greater than zero for ${line.productName || 'item'}`, 'error'); return }
      if (product?.requiresSerial && line.serialIds.length !== qty) {
        showToast(`Select ${qty} returned serial number(s) for ${product.name}`, 'error')
        return
      }
    }
    const lines = rmaLines.map(l => ({
      productId: l.productId, productName: l.productName,
      qty: Number(l.qty) || 1, serialIds: l.serialIds,
      condition: l.condition, reason: l.reason,
    }))
    try {
      const order = createReturnOrder(
        matchedSO.id, matchedSO.ref,
        matchedSO.customerId, matchedSO.customerName,
        rmaReason, lines
      )
      setShowCreateRMA(false)
      setDetailId(order.id)
    } catch {
      /* store toast */
    }
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
  }

  const tabStyle = (t: Tab): React.CSSProperties => ({
    fontSize: 11, fontWeight: tab === t ? 700 : 400,
    padding: '6px 16px', borderRadius: 8, cursor: 'pointer',
    background: tab === t ? '#E8F3FA' : 'transparent',
    border: `1px solid ${tab === t ? '#A8D4E8' : 'transparent'}`,
    color: tab === t ? 'var(--navy)' : 'var(--text-4)',
    transition: 'all 0.15s',
  })

  if (!mounted) return <ModuleSkeleton />

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
          <button onClick={() => setDetailId(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 20, lineHeight: 1 }}>←</button>
          <div>
            <h2 className="text-sm font-bold text-t1">{w.ref}</h2>
            <p className="text-[11px] text-t3">{w.productName} · {w.serialNumber}</p>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 10, padding: '3px 10px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 700 }}>
            {meta.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4 space-y-3">
            <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider">Warranty Details</p>
            <div className="space-y-2 text-[12px]">
              <div className="flex justify-between"><span className="text-t3">Customer</span><span className="font-medium">{w.customerName}</span></div>
              <div className="flex justify-between"><span className="text-t3">Product</span><span className="font-medium">{w.productName}</span></div>
              <div className="flex justify-between"><span className="text-t3">Serial No</span><span className="font-mono font-semibold">{w.serialNumber}</span></div>
              <div className="flex justify-between"><span className="text-t3">Duration</span><span>{w.months} months</span></div>
              <div className="flex justify-between"><span className="text-t3">Sale Order</span><span className="font-mono">{w.saleOrderRef}</span></div>
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider">Coverage Period</p>
            <div className="space-y-2 text-[12px]">
              <div className="flex justify-between"><span className="text-t3">Start Date</span><span>{fmtDate(w.startDate)}</span></div>
              <div className="flex justify-between"><span className="text-t3">End Date</span><span className={days < 0 ? 'text-red-600 font-semibold' : days <= 30 ? 'text-yellow-700 font-semibold' : ''}>{fmtDate(w.endDate)}</span></div>
              <div className="flex justify-between">
                <span className="text-t3">Days Remaining</span>
                <span style={{ fontWeight: 700, color: days < 0 ? 'var(--danger)' : days <= 30 ? 'var(--warning-text)' : 'var(--success)' }}>
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
                  <div style={{ height: 8, borderRadius: 8, background: 'var(--border-lt)', overflow: 'hidden', marginTop: 8 }}>
                    <div style={{ height: '100%', borderRadius: 8, width: `${pct}%`, background: pct >= 100 ? 'var(--danger)' : pct >= 85 ? 'var(--warning)' : 'var(--success)', transition: 'width 0.4s' }} />
                  </div>
                  <p className="text-[9px] text-t3 mt-1">{pct}% of warranty period used</p>
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
          <button onClick={() => setDetailId(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 20, lineHeight: 1 }}>←</button>
          <div>
            <h2 className="text-sm font-bold text-t1">{rma.ref}</h2>
            <p className="text-[11px] text-t3">{rma.customerName} · {rma.saleOrderRef}</p>
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
                        background: done ? 'var(--navy)' : 'var(--bg-muted)', color: done ? '#fff' : 'var(--text-4)', fontSize: 12, fontWeight: 700,
                        border: curr ? '2px solid var(--accent-cyan)' : 'none',
                      }}>
                        {done && !curr ? '✓' : i + 1}
                      </div>
                      <p style={{ fontSize: 9, fontWeight: curr ? 700 : 400, color: done ? 'var(--navy)' : 'var(--text-4)', whiteSpace: 'nowrap' }}>{s.label}</p>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div style={{ flex: 1, height: 2, background: RMA_STATUS_META[s.status].step < currentStep ? 'var(--navy)' : 'var(--border-lt)', margin: '0 4px', marginBottom: 18 }} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {rma.status === 'rejected' && (
          <div className="card px-4 py-3 flex items-center gap-2" style={{ background: 'var(--danger-bg)', border: '1px solid #FECACA' }}>
            <span aria-hidden="true"><Fa icon={faCircleXmark} /></span>
            <p className="text-xs text-red-700">Return rejected{rma.notes ? ` — ${rma.notes}` : ''}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {/* Details */}
          <div className="card p-4 space-y-2 text-[12px]">
            <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-2">Return Details</p>
            <div className="flex justify-between"><span className="text-t3">Customer</span><span className="font-medium">{rma.customerName}</span></div>
            <div className="flex justify-between"><span className="text-t3">Sale Order</span><span className="font-mono">{rma.saleOrderRef}</span></div>
            <div className="flex justify-between"><span className="text-t3">Request Date</span><span>{fmtDate(rma.requestDate)}</span></div>
            <div><span className="text-t3">Reason:</span><p className="mt-1 text-t1">{rma.reason}</p></div>
            {rma.resolution && (
              <div className="flex justify-between pt-1 border-t" style={{ borderColor: 'var(--bg-muted)' }}>
                <span className="text-t3">Resolution</span>
                <span className="font-semibold">{RESOLUTION_LABELS[rma.resolution]}</span>
              </div>
            )}
            {rma.refundAmount !== undefined && (
              <div className="flex justify-between"><span className="text-t3">Refund Amount</span><span className="font-mono font-semibold" style={{ color: 'var(--success)' }}>{fmtKes(rma.refundAmount)}</span></div>
            )}
          </div>

          {/* Timeline */}
          <div className="card p-4 space-y-2">
            <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-2">Timeline</p>
            <div className="space-y-2 text-[11px]">
              <div className="flex gap-2 items-center"><span style={{ color: 'var(--text-4)' }} aria-hidden="true"><Fa icon={faNoteSticky} /></span><span>Submitted {fmtDate(rma.requestDate)}</span></div>
              {rma.approvedDate && <div className="flex gap-2 items-center"><span style={{ color: 'var(--primary)' }} aria-hidden="true"><Fa icon={faCircleCheck} /></span><span>Approved {fmtDate(rma.approvedDate)} by {rma.approvedByName}</span></div>}
              {rma.receivedDate && <div className="flex gap-2 items-center"><span style={{ color: 'var(--navy)' }} aria-hidden="true"><Fa icon={faBox} /></span><span>Received {fmtDate(rma.receivedDate)}</span></div>}
              {rma.processedDate && <div className="flex gap-2 items-center"><span style={{ color: 'var(--success)' }} aria-hidden="true"><Fa icon={faFlagCheckered} /></span><span>Processed {fmtDate(rma.processedDate)} by {rma.processedByName}</span></div>}
              {rma.notes && <div className="flex gap-2 items-center pt-1 border-t" style={{ borderColor: 'var(--bg-muted)' }}><span aria-hidden="true"><Fa icon={faThumbtack} /></span><span>{rma.notes}</span></div>}
            </div>
          </div>
        </div>

        {/* Lines */}
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b text-[11px] font-semibold text-t2" style={{ borderColor: 'var(--bg-muted)' }}>
            Return Lines
          </div>
          <div className="flex flex-col min-w-0 max-w-full">
              {rma.lines.map(line => (
                <div key={line.id} className="px-4 py-3 border-b flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 text-[12px]" style={{ borderColor: 'var(--bg-surface)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-t1">{line.productName}</p>
                    <p className="text-[10px] text-t3">Qty: {line.qty} · Condition: <span className="font-medium capitalize">{line.condition}</span></p>
                    {line.serialIds.length > 0 && (
                      <p className="text-[10px] font-mono text-t3 break-all">
                        {line.serialIds.map(id => serials.find(s => s.id === id)?.serial ?? id).join(', ')}
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] text-t2 sm:max-w-[40%]">{line.reason}</p>
                </div>
              ))}
          </div>
        </div>

        {/* Actions */}
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            {rma.status === 'requested' && (
              <>
                <button className="btn-primary text-[11px] px-4 py-2" onClick={() => approveReturn(rma.id)}>
                  ✓ Approve Return
                </button>
                <button className="btn-outline text-[11px] px-4 py-2" style={{ color: 'var(--danger)', borderColor: '#FECACA' }}
                  onClick={() => { setRejectTarget(rma); setRejectReason(''); setShowReject(true) }}>
                  ✗ Reject
                </button>
              </>
            )}
            {rma.status === 'approved' && (
              <button className="btn-primary text-[11px] px-4 py-2 flex items-center gap-1.5" onClick={() => receiveReturn(rma.id)}>
                <Fa icon={faBox} aria-hidden="true" /> Mark Items Received
              </button>
            )}
            {rma.status === 'received' && (
              <button className="btn-primary text-[11px] px-4 py-2 flex items-center gap-1.5"
                onClick={() => { setProcessRMA(rma); setResolution('refund'); setRefundAmount(String(saleOrders.find(o => o.id === rma.saleOrderId)?.total ?? '')); setProcessNotes(''); setShowProcess(true) }}>
                <Fa icon={faFlagCheckered} aria-hidden="true" /> Process Return
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── DataTable column configs ──────────────────────────────────────────────
  const warrantyColumns: ColumnDef<ProcessedWarranty>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '100px',
      render: w => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{w.ref}</span>,
    },
    {
      key: 'customer', label: 'Customer', priority: 1, width: '1fr',
      render: w => <span className="text-xs font-medium erp-truncate" title={w.customerName}>{w.customerName}</span>,
      exportValue: w => w.customerName,
    },
    {
      key: 'product', label: 'Product / Serial', priority: 1, width: '1fr',
      render: w => (
        <div className="min-w-0">
          <p className="text-xs erp-truncate" title={w.productName}>{w.productName}</p>
          <p className="text-[10px] font-mono text-t3 erp-truncate" title={w.serialNumber}>{w.serialNumber}</p>
        </div>
      ),
      exportValue: w => w.productName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '120px',
      render: w => {
        const meta = WARRANTY_STATUS_META[w.status]
        return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block' }}>{meta.label}</span>
      },
      exportValue: w => WARRANTY_STATUS_META[w.status].label,
    },
    {
      key: 'duration', label: 'Duration', priority: 2, width: '100px',
      render: w => <span className="text-xs text-t3">{w.months} months</span>,
      exportValue: w => w.months,
    },
    {
      key: 'end', label: 'End / Expires', priority: 2, width: '120px',
      render: w => {
        const days = w.daysLeft
        return (
          <div>
            <p className="text-xs">{fmtDate(w.endDate)}</p>
            <p style={{ fontSize: 9, fontWeight: 600, color: days < 0 ? 'var(--danger)' : days <= 30 ? 'var(--warning-text)' : 'var(--success)' }}>
              {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
            </p>
          </div>
        )
      },
      exportValue: w => w.endDate,
    },
    {
      key: 'start', label: 'Start', priority: 3, width: '100px',
      render: w => <span className="text-xs text-t3">{fmtDate(w.startDate)}</span>,
      exportValue: w => w.startDate,
    },
  ]

  function warrantyCard(w: ProcessedWarranty) {
    const meta = WARRANTY_STATUS_META[w.status]
    const days = w.daysLeft
    return (
      <div key={w.id} className="p-4 cursor-pointer rounded-xl border border-[var(--border-lt)]" onClick={() => setDetailId(w.id)}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--navy)' }}>{w.ref}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{meta.label}</span>
        </div>
        <p className="text-xs font-semibold text-t1">{w.customerName}</p>
        <p className="text-[10px] text-t2 truncate" title={`${w.productName} · ${w.serialNumber}`}>{w.productName} · <span className="font-mono">{w.serialNumber}</span></p>
        <p className="text-[10px] text-t3 mt-0.5">{w.months}mo · {fmtDate(w.startDate)} → {fmtDate(w.endDate)}</p>
        <p style={{ fontSize: 9, fontWeight: 600, color: days < 0 ? 'var(--danger)' : days <= 30 ? 'var(--warning-text)' : 'var(--success)', marginTop: 2 }}>
          {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
        </p>
      </div>
    )
  }

  const rmaColumns: ColumnDef<ReturnOrder>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '100px',
      render: rma => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{rma.ref}</span>,
    },
    {
      key: 'customer', label: 'Customer', priority: 1, width: '1fr',
      render: rma => (
        <div className="min-w-0">
          <p className="text-xs font-medium erp-truncate" title={rma.customerName}>{rma.customerName}</p>
          <p className="text-[10px] text-t3 erp-truncate" title={rma.reason}>{rma.reason}</p>
        </div>
      ),
      exportValue: rma => rma.customerName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: rma => {
        const meta = RMA_STATUS_META[rma.status]
        return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block' }}>{meta.label}</span>
      },
      exportValue: rma => RMA_STATUS_META[rma.status].label,
    },
    {
      key: 'saleOrder', label: 'Sale Order', priority: 2, width: '110px',
      render: rma => <span className="font-mono text-xs">{rma.saleOrderRef}</span>,
      exportValue: rma => rma.saleOrderRef,
    },
    {
      key: 'requestDate', label: 'Request Date', priority: 2, width: '100px',
      render: rma => <span className="text-xs text-t3">{fmtDate(rma.requestDate)}</span>,
      exportValue: rma => rma.requestDate,
    },
    {
      key: 'resolution', label: 'Resolution', priority: 3, width: '110px',
      render: rma => <span className="text-xs text-t3">{rma.resolution ? RESOLUTION_LABELS[rma.resolution] : '—'}</span>,
      exportValue: rma => rma.resolution ? RESOLUTION_LABELS[rma.resolution] : '',
    },
  ]

  function rmaCard(rma: ReturnOrder) {
    const meta = RMA_STATUS_META[rma.status]
    return (
      <div key={rma.id} className="p-4 cursor-pointer rounded-xl border border-[var(--border-lt)]" onClick={() => setDetailId(rma.id)}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--navy)' }}>{rma.ref}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{meta.label}</span>
        </div>
        <p className="text-xs font-semibold text-t1">{rma.customerName}</p>
        <p className="text-[10px] text-t3 truncate">{rma.reason}</p>
        <p className="text-[10px] text-t3 mt-0.5">{fmtDate(rma.requestDate)} · {rma.saleOrderRef}{rma.resolution ? ` · ${RESOLUTION_LABELS[rma.resolution]}` : ''}</p>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN LIST VIEW
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="mod-page">
      <ModuleHeader
        title="After-sales"
        subtitle="Warranty, returns, buy-backs, donations and exchanges"
        icon={<Fa icon={faShield} />}
        count={wStats.total + rmaStats.total + buyBacks.length + donations.length + clientExchanges.length}
        color="var(--success)"
        primaryAction={tab === 'returns' ? (
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openCreateRMA} hideLabelOnMobile={false}>
            New return
          </PrimaryActionButton>
        ) : undefined}
      />

      <TabBar
        tabs={[
          { id: 'warranties', label: `Warranties (${wStats.total})` },
          { id: 'returns', label: `Returns (${rmaStats.total})` },
          { id: 'trade', label: `Trade-in (${buyBacks.length + donations.length + clientExchanges.length})` },
        ]}
        active={tab}
        onChange={id => selectTab(id as Tab)}
        maxVisibleDesktop={6}
        ariaLabel="After-sales sections"
      />

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

      {tab === 'trade' && <TradeIn />}

      {/* ── WARRANTIES TAB ─────────────────────────────────────────────────── */}
      {tab === 'warranties' && (
        <div className="space-y-3">
          {/* Warranty list */}
          <div className="card overflow-hidden">
            <DataTable
              tableId="warranties"
              columns={warrantyColumns}
              rows={filteredWarranties}
              rowKey={w => w.id}
              searchValue={wSearch}
              onSearchChange={setWSearch}
              searchPlaceholder="Search warranties by customer, product, or serial..."
              clientSearch={false}
              primaryFilters={[
                {
                  key: 'status',
                  label: 'Status',
                  placeholder: 'All statuses',
                  value: wFilter,
                  options: [
                    { value: 'all', label: 'All statuses' },
                    { value: 'active', label: 'Active' },
                    { value: 'expiring', label: 'Expiring soon' },
                    { value: 'expired', label: 'Expired' },
                  ],
                  onChange: setWFilter,
                },
              ]}
              onClearFilters={() => { setWFilter('all'); setWSearch('') }}
              hideColumnFilters
              emptyMessage={warranties.length === 0 ? 'No warranties yet — they are created automatically when a delivery is validated.' : 'No warranties match the filter.'}
              onRowClick={w => setDetailId(w.id)}
              renderCard={warrantyCard}
              exportTitle="Warranties List"
              exportFilename="warranties-list"
            />
          </div>
        </div>
      )}

      {/* ── RETURNS / RMA TAB ──────────────────────────────────────────────── */}
      {tab === 'returns' && (
        <div className="space-y-3">
          {/* RMA list */}
          <div className="card overflow-hidden">
            <DataTable
              tableId="rmas"
              columns={rmaColumns}
              rows={filteredRMAs}
              rowKey={rma => rma.id}
              searchValue={rmaSearch}
              onSearchChange={setRmaSearch}
              searchPlaceholder="Search returns by reference, customer, or order..."
              clientSearch={false}
              primaryFilters={[
                {
                  key: 'status',
                  label: 'Status',
                  placeholder: 'All statuses',
                  value: rmaFilter,
                  options: [
                    { value: 'all', label: 'All statuses' },
                    { value: 'requested', label: 'Requested' },
                    { value: 'approved', label: 'Approved' },
                    { value: 'received', label: 'Received' },
                    { value: 'processed', label: 'Processed' },
                    { value: 'rejected', label: 'Rejected' },
                  ],
                  onChange: setRmaFilter,
                },
              ]}
              onClearFilters={() => { setRmaFilter('all'); setRmaSearch('') }}
              hideColumnFilters
              emptyMessage={returnOrders.length === 0 ? 'No return requests yet. Click "+ New Return (RMA)" to create one.' : 'No returns match the filter.'}
              onRowClick={rma => setDetailId(rma.id)}
              renderCard={rmaCard}
              exportTitle="Returns & RMAs"
              exportFilename="returns-rmas"
            />
          </div>
        </div>
      )}

      {/* ── Create RMA Modal ──────────────────────────────────────────────── */}
      {showCreateRMA && (
        <div className="modal-overlay" onClick={() => setShowCreateRMA(false)}>
          <div className="modal-box w-full max-w-lg" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-t1">New Return Request</h3>
              <button onClick={() => setShowCreateRMA(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
            </div>

            <div className="space-y-3">
              {/* Sale Order lookup */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Sale Order Reference *</label>
                <input aria-label="Sale order reference" className="form-input w-full text-[12px]" placeholder="e.g. SO/0045"
                  value={rmaSORef} onChange={e => setRmaSORef(e.target.value)} />
                {rmaSORef && !matchedSO && <p className="text-[10px] text-red-600 mt-1">No sale order found with this reference</p>}
                {matchedSO && (
                  <div className="mt-1 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--success-bg)', border: '1px solid #A7F3D0' }}>
                    ✓ {matchedSO.customerName} · {fmtDate(matchedSO.date)} · {fmtKes(matchedSO.total)}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Return Reason *</label>
                <textarea aria-label="Return reason" className="form-input w-full text-[12px]" rows={2}
                  placeholder="Describe why the customer is returning the item(s)…"
                  value={rmaReason} onChange={e => setRmaReason(e.target.value)} />
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold text-t2">Return Items *</label>
                  {matchedSO && (
                    <button onClick={addRMALine}
                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid #A8D4E8', background: '#E8F3FA', color: 'var(--navy-dark)', cursor: 'pointer' }}>
                      + Add Item
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {rmaLines.map((line, i) => {
                    const product = products.find(p => p.id === line.productId)
                    return (
                    <div key={i} className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-muted)' }}>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-t3 block mb-0.5">Product</label>
                          <select aria-label={`Product for return item ${i + 1}`} className="form-input w-full text-[11px]"
                            value={line.productId}
                            onChange={e => {
                              const p = products.find(p => p.id === e.target.value)
                              setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, productId: e.target.value, productName: p?.name ?? '', serialIds: [] } : l))
                            }}>
                            <option value="">Select product…</option>
                            {(matchedSO?.lines ?? []).map(sl => (
                              <option key={sl.productId} value={sl.productId}>{sl.productName}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-t3 block mb-0.5">Condition</label>
                          <select aria-label={`Condition for return item ${i + 1}`} className="form-input w-full text-[11px]"
                            value={line.condition}
                            onChange={e => setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, condition: e.target.value as ReturnOrderLine['condition'] } : l))}>
                            <option value="good">Good</option>
                            <option value="damaged">Damaged</option>
                            <option value="defective">Defective</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-t3 block mb-0.5">Qty</label>
                          <input
                            aria-label={`Qty for return item ${i + 1}`}
                            className="form-input w-full text-[11px]"
                            type="number"
                            min={1}
                            value={line.qty}
                            onChange={e => setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))}
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-t3 block mb-0.5">Item Reason</label>
                          <input aria-label={`Reason for return item ${i + 1}`} className="form-input w-full text-[11px]" placeholder="e.g. Screen cracked"
                            value={line.reason}
                            onChange={e => setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, reason: e.target.value } : l))} />
                        </div>
                      </div>
                      {product?.requiresSerial && line.productId && (
                        <div>
                          <label className="text-[9px] text-t3 block mb-1">
                            Returned serials ({line.serialIds.length}/{Number(line.qty) || 1})
                          </label>
                          <SerialReturnPicker
                            productId={line.productId}
                            selectedIds={line.serialIds}
                            onAdd={id => setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, serialIds: [...l.serialIds, id] } : l))}
                            onRemove={id => setRmaLines(prev => prev.map((l, j) => j === i ? { ...l, serialIds: l.serialIds.filter(s => s !== id) } : l))}
                            mode="customer_return"
                            allowIntake
                            customerId={matchedSO?.customerId}
                            saleOrderId={matchedSO?.id}
                            intakeSource="rma"
                          />
                        </div>
                      )}
                      <button onClick={() => setRmaLines(prev => prev.filter((_, j) => j !== i))}
                        style={{ fontSize: 10, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Remove
                      </button>
                    </div>
                    )
                  })}
                  {rmaLines.length === 0 && matchedSO && (
                    <p className="text-[11px] text-t3 text-center py-2">Click "+ Add Item" to add return lines</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setShowCreateRMA(false)}>Cancel</button>
              <button className="btn-primary text-[11px] py-2 px-4"
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
              <button onClick={() => setShowProcess(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-2">Resolution *</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['refund', 'replacement', 'repair', 'credit_note'] as const).map(r => (
                    <button key={r} onClick={() => setResolution(r)}
                      style={{
                        padding: '10px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                        border: `1.5px solid ${resolution === r ? 'var(--navy)' : 'var(--border-lt)'}`,
                        background: resolution === r ? '#E8F3FA' : '#FAFAFA',
                        color: resolution === r ? 'var(--navy)' : 'var(--text-4)',
                        fontSize: 11, fontWeight: resolution === r ? 700 : 400,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                      <Fa icon={RESOLUTION_META[r].icon} aria-hidden="true" />
                      {RESOLUTION_META[r].label}
                    </button>
                  ))}
                </div>
              </div>
              {(resolution === 'refund' || resolution === 'credit_note') && (
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Amount (KES)</label>
                  <input type="number" aria-label="Refund or credit amount" className="form-input w-full text-[12px]"
                    value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
                </div>
              )}
              {resolution === 'refund' && (
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Payment Method</label>
                  <div className="flex gap-2">
                    {([['cash','Cash',faMoneyBill],['mpesa','M-Pesa',faMobileScreenButton],['bank_transfer','Bank Transfer',faBuildingColumns]] as const).map(([val, lbl, icon]) => (
                      <button key={val} onClick={() => setRefundPaymentMethod(val)}
                        style={{
                          flex: 1, padding: '8px 6px', borderRadius: 8, cursor: 'pointer', fontSize: 10,
                          border: `1.5px solid ${refundPaymentMethod === val ? 'var(--navy)' : 'var(--border-lt)'}`,
                          background: refundPaymentMethod === val ? '#E8F3FA' : '#FAFAFA',
                          color: refundPaymentMethod === val ? 'var(--navy)' : 'var(--text-4)',
                          fontWeight: refundPaymentMethod === val ? 700 : 400,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        }}>
                        <Fa icon={icon} aria-hidden="true" /> {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Notes (optional)</label>
                <textarea aria-label="Return processing notes" className="form-input w-full text-[12px]" rows={2}
                  value={processNotes} onChange={e => setProcessNotes(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setShowProcess(false)}>Cancel</button>
              <button className="btn-primary text-[11px] py-2 px-4" onClick={handleProcess}>Confirm</button>
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
              <button onClick={() => setShowReject(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
            </div>
            <div className="space-y-3">
              <p className="text-[12px] text-t2">Provide a reason for rejection — this will be visible on the return record.</p>
              <textarea aria-label="Return rejection reason" className="form-input w-full text-[12px]" rows={3} placeholder="e.g. Item is outside warranty period…"
                value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setShowReject(false)}>Cancel</button>
              <button className="text-[11px] py-2 px-4 rounded-lg font-semibold"
                style={{ background: 'var(--danger-bg)', color: '#991B1B', border: '1px solid #FECACA', cursor: 'pointer' }}
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

export default function AfterSales() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <AfterSalesContent />
    </Suspense>
  )
}
