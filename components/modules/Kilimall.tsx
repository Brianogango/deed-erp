'use client'
import { useState, useRef, useEffect } from 'react'
import {
  useApp, KilimallOrder, KilimallOrderStatus, KilimallSettlement,
  KilimallSettlementLine, fmtKes, fmtDate,
} from '@/lib/store'
import { useRouter } from 'next/navigation'
import { Badge, StatCard, PanelHeader, Field, Input, Select, Modal, Textarea, ModuleSkeleton } from '@/components/ui'
import * as XLSX from 'xlsx'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'

type Tab = 'dashboard' | 'orders' | 'dispatch' | 'settlements' | 'reconciliation' | 'returns' | 'reports' | 'settings'

const STATUS_COLOR: Record<KilimallOrderStatus, string> = {
  pending: '#F59E0B', dispatched: '#3B82F6', delivered: '#10B981',
  returned: '#EF4444', cancelled: '#6B7280',
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '7px 14px', fontSize: 11, borderRadius: 8, cursor: 'pointer', border: 'none',
  background: active ? '#E8F3FA' : 'transparent',
  color: active ? '#1B2762' : '#6B7280',
  fontWeight: active ? 600 : 400,
})

export default function Kilimall() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const {
    kilimallOrders, kilimallDispatches, kilimallSettlements,
    createKilimallOrder, updateKilimallOrder,
    confirmKilimallDispatch, createKilimallSettlement,
    updateKilimallSettlement, reconcileKilimallSettlement,
    products, serials, setModule, showToast, currentUserId, users,
  } = useApp()

  const [tab, setTab] = useState<Tab>('dashboard')
  const router = useRouter()

  // ── Orders ────────────────────────────────────────────────────────────────────
  const [orderSearch, setOrderSearch] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState<KilimallOrderStatus | 'all'>('all')
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [viewOrder, setViewOrder] = useState<KilimallOrder | null>(null)
  const [newOrder, setNewOrder] = useState({
    kilimallRef: '', orderDate: new Date().toISOString().slice(0, 10),
    customerName: '', productId: '', productName: '', qty: '1',
    unitPrice: '', notes: '',
  })

  // ── Dispatch ──────────────────────────────────────────────────────────────────
  const [dispatchOrderId, setDispatchOrderId] = useState<string | null>(null)
  const [dispatchSerial, setDispatchSerial] = useState('')

  // ── Settlements ───────────────────────────────────────────────────────────────
  const [showNewSettlement, setShowNewSettlement] = useState(false)
  const [viewSettlement, setViewSettlement] = useState<KilimallSettlement | null>(null)
  const [settlForm, setSettlForm] = useState({
    weekPeriod: '', weekStart: '', weekEnd: '',
    grossAmount: '', deductions: '', netPaid: '',
    paymentDate: '', paymentRef: '', paymentMethod: 'mpesa' as 'mpesa' | 'bank',
  })
  const [settlLines, setSettlLines] = useState<{ kilimallRef: string; amount: string }[]>([
    { kilimallRef: '', amount: '' },
  ])
  const settlFileRef = useRef<HTMLInputElement>(null)

  // ── Reports ───────────────────────────────────────────────────────────────────
  const [reportTab, setReportTab] = useState<'ops' | 'financial' | 'control'>('ops')

  // ─────────────────────────────────────────────────────────────────────────────
  // Derived stats
  // ─────────────────────────────────────────────────────────────────────────────
  const totalOrders        = kilimallOrders.length
  const pendingDispatch    = kilimallOrders.filter(o => o.status === 'pending').length
  const delivered          = kilimallOrders.filter(o => o.status === 'delivered').length
  const returned           = kilimallOrders.filter(o => o.status === 'returned').length
  const grossRevenue       = kilimallOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0)
  const lastSettlement     = kilimallSettlements[0]
  const netReceived        = kilimallSettlements.reduce((s, x) => s + x.netPaid, 0)
  const unreconciled       = kilimallOrders.filter(o => o.status === 'delivered' && !o.settlementId).length
  const returnsRate        = totalOrders > 0 ? ((returned / totalOrders) * 100).toFixed(1) : '0'

  // Filtered orders
  const filteredOrders = kilimallOrders.filter(o => {
    const q = orderSearch.toLowerCase()
    const matchStatus = orderStatusFilter === 'all' || o.status === orderStatusFilter
    const matchSearch = !q || o.ref.toLowerCase().includes(q) || o.kilimallRef.toLowerCase().includes(q)
      || o.productName.toLowerCase().includes(q) || (o.customerName ?? '').toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  // Available serials for dispatch
  const pendingOrders = kilimallOrders.filter(o => o.status === 'pending')
  const dispatchOrder = pendingOrders.find(o => o.id === dispatchOrderId)
  const availableSerials = dispatchOrder
    ? serials.filter(s => s.status === 'available' && s.productId === dispatchOrder.productId)
    : []

  // ─────────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  const handleCreateOrder = () => {
    if (!newOrder.kilimallRef || !newOrder.productId || !newOrder.unitPrice) {
      showToast('Kilimall Ref, product, and unit price are required', 'error'); return
    }
    const qty = Number(newOrder.qty) || 1
    const unitPrice = Number(newOrder.unitPrice)
    createKilimallOrder({
      kilimallRef: newOrder.kilimallRef.trim(),
      orderDate: newOrder.orderDate,
      customerName: newOrder.customerName || undefined,
      productId: newOrder.productId,
      productName: newOrder.productName,
      qty, unitPrice, total: qty * unitPrice,
      notes: newOrder.notes || undefined,
    })
    setShowNewOrder(false)
    setNewOrder({ kilimallRef: '', orderDate: new Date().toISOString().slice(0, 10), customerName: '', productId: '', productName: '', qty: '1', unitPrice: '', notes: '' })
  }

  const handleDispatch = () => {
    if (!dispatchOrderId || !dispatchSerial) {
      showToast('Select an order and enter/select a serial number', 'error'); return
    }
    const serial = serials.find(s => s.serial === dispatchSerial.trim() || s.id === dispatchSerial.trim())
    if (!serial) { showToast('Serial not found in inventory', 'error'); return }
    const result = confirmKilimallDispatch(dispatchOrderId, serial.id, serial.serial)
    if (result) { setDispatchOrderId(null); setDispatchSerial('') }
  }

  const handleSettlementUpload = (file: File) => {
    try { guardSpreadsheetFile(file) } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'File too large', 'error'); return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<{ 'Order ID'?: string; 'Amount'?: number; 'Status'?: string }>(ws)
        guardSpreadsheetRows(rows)
        const lines = rows
          .filter(r => r['Order ID'])
          .map(r => ({ kilimallRef: String(r['Order ID'] ?? ''), amount: String(r['Amount'] ?? '0') }))
        setSettlLines(lines.length > 0 ? lines : [{ kilimallRef: '', amount: '' }])
        showToast(`Loaded ${lines.length} lines from Excel`)
      } catch (err) { showToast(err instanceof SpreadsheetGuardError ? err.message : 'Failed to parse Excel file', 'error') }
    }
    reader.readAsBinaryString(file)
  }

  const handleCreateSettlement = () => {
    if (!settlForm.weekPeriod || !settlForm.grossAmount) {
      showToast('Week period and gross amount are required', 'error'); return
    }
    const lines: KilimallSettlementLine[] = settlLines
      .filter(l => l.kilimallRef && l.amount)
      .map(l => ({ id: Math.random().toString(36).slice(2), kilimallRef: l.kilimallRef, amount: Number(l.amount), status: 'unmatched' as const }))
    createKilimallSettlement({
      weekPeriod: settlForm.weekPeriod,
      weekStart: settlForm.weekStart,
      weekEnd: settlForm.weekEnd,
      totalOrders: lines.length,
      grossAmount: Number(settlForm.grossAmount),
      deductions: Number(settlForm.deductions) || 0,
      netPaid: Number(settlForm.netPaid) || Number(settlForm.grossAmount) - (Number(settlForm.deductions) || 0),
      paymentDate: settlForm.paymentDate || undefined,
      paymentRef: settlForm.paymentRef || undefined,
      paymentMethod: settlForm.paymentMethod,
      lines,
    })
    setShowNewSettlement(false)
    setSettlForm({ weekPeriod: '', weekStart: '', weekEnd: '', grossAmount: '', deductions: '', netPaid: '', paymentDate: '', paymentRef: '', paymentMethod: 'mpesa' })
    setSettlLines([{ kilimallRef: '', amount: '' }])
  }

  if (!mounted) return <ModuleSkeleton />

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="mod-page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#F59E0B15', color: '#F59E0B' }}>
            <span className="text-base">🛒</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-extrabold text-text-1">Kilimall</h1>
              <span className="badge badge-gray text-[9px]">{totalOrders} orders</span>
            </div>
            <p className="text-[10px] text-text-3 mt-0.5">Orders, dispatch, settlements &amp; reconciliation</p>
          </div>
        </div>
        <button className="btn-primary flex items-center gap-2 flex-shrink-0" onClick={() => setShowNewOrder(true)}>
          <span>+</span><span className="hidden sm:inline">New Order</span>
        </button>
      </div>

      {/* ── Stat cards ── */}
      <div className="px-4 py-3 stat-grid-4 border-b border-border-lt bg-surface">
        <StatCard label="Total Orders"     value={totalOrders}       sub="all time"            color="#1B2762" />
        <StatCard label="Pending Dispatch" value={pendingDispatch}   sub="awaiting dispatch"   color="#F59E0B" onClick={() => setTab('dispatch')} />
        <StatCard label="Delivered"        value={delivered}         sub="fulfilled"           color="#10B981" />
        <StatCard label="Unreconciled"     value={unreconciled}      sub="delivered, unpaid"   color="#DC2626" onClick={() => setTab('reconciliation')} />
      </div>

      {/* ── Tab bar ── */}
      <div className="mod-tabs">
        {([
          ['dashboard','Dashboard'], ['orders','Orders'], ['dispatch','Dispatch'],
          ['settlements','Settlements'], ['reconciliation','Reconciliation'],
          ['returns','Returns'], ['reports','Reports'], ['settings','Settings'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`mod-tab ${tab === t ? 'active' : ''}`}>{label}</button>
        ))}
      </div>

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

      {/* ════════════════════════════════════════════════════════════════════════
          DASHBOARD
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'dashboard' && (
        <div className="grid grid-cols-2 gap-4">
          {/* Orders by status */}
          <div className="card p-4">
            <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Order Status Breakdown</p>
            {(['pending','dispatched','delivered','returned','cancelled'] as KilimallOrderStatus[]).map(s => {
              const count = kilimallOrders.filter(o => o.status === s).length
              const pct = totalOrders > 0 ? (count / totalOrders) * 100 : 0
              return (
                <div key={s} className="mb-2">
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="capitalize font-medium">{s}</span>
                    <span className="text-t3">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="rounded-full overflow-hidden" style={{ height: 6, background: '#F3F4F6' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: STATUS_COLOR[s], borderRadius: 4, transition: 'width 0.4s' }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Recent settlements */}
          <div className="card p-4">
            <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Recent Settlements</p>
            {kilimallSettlements.length === 0
              ? <p className="text-xs text-t3 py-4 text-center">No settlements yet</p>
              : kilimallSettlements.slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b" style={{ borderColor: '#F3F4F6' }}>
                  <div>
                    <p className="text-[11px] font-semibold">{s.ref}</p>
                    <p className="text-[10px] text-t3">{s.weekPeriod}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-mono font-semibold">{fmtKes(s.netPaid)}</p>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: s.status === 'reconciled' ? '#DCFCE7' : '#FEF9C3', color: s.status === 'reconciled' ? '#059669' : '#92400E' }}>
                      {s.status}
                    </span>
                  </div>
                </div>
              ))
            }
          </div>

          {/* Recent orders */}
          <div className="card p-4 col-span-2">
            <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Recent Orders</p>
            <div className="overflow-x-auto w-full">
              <div className="min-w-[700px] flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '90px 110px 1.4fr 80px 90px 100px 80px' }}>
              <span>Ref</span><span>Kilimall Ref</span><span>Product</span><span>Qty</span><span>Total</span><span>Date</span><span>Status</span>
            </div>
            {kilimallOrders.slice(0, 8).map(o => (
              <div key={o.id} className="table-row" style={{ gridTemplateColumns: '90px 110px 1.4fr 80px 90px 100px 80px' }}
                onClick={() => { setViewOrder(o); setTab('orders') }}>
                <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{o.ref}</span>
                <span className="font-mono text-[10px] text-t3">{o.kilimallRef}</span>
                <span className="text-[11px]">{o.productName}</span>
                <span className="text-[11px]">{o.qty}</span>
                <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>
                <span className="text-[11px] text-t3">{fmtDate(o.orderDate)}</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-medium capitalize"
                  style={{ background: STATUS_COLOR[o.status] + '20', color: STATUS_COLOR[o.status] }}>{o.status}</span>
              </div>
            ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          ORDERS
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'orders' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Kilimall Orders" count={filteredOrders.length}>
            <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
              placeholder="Search ref, product, customer…"
              value={orderSearch} onChange={e => setOrderSearch(e.target.value)} />
            <select className="form-select text-[11px] py-1.5" style={{ width: 130 }}
              value={orderStatusFilter} onChange={e => setOrderStatusFilter(e.target.value as any)}>
              <option value="all">All statuses</option>
              {(['pending','dispatched','delivered','returned','cancelled'] as KilimallOrderStatus[]).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button className="btn-primary text-[11px]" onClick={() => setShowNewOrder(true)}>+ New Order</button>
          </PanelHeader>

          <div className="overflow-x-auto w-full">
            <div className="min-w-[900px] flex flex-col">
          <div className="table-head" style={{ gridTemplateColumns: '90px 120px 1.4fr 60px 100px 100px 90px 80px' }}>
            <span>Ref</span><span>Kilimall Ref</span><span>Product</span><span>Qty</span>
            <span>Total</span><span>Date</span><span>Serial</span><span>Status</span>
          </div>
          {filteredOrders.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No orders found</p>
            : filteredOrders.map(o => (
              <div key={o.id} className="table-row" style={{ gridTemplateColumns: '90px 120px 1.4fr 60px 100px 100px 90px 80px' }}
                onClick={() => setViewOrder(o)}>
                <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{o.ref}</span>
                <span className="font-mono text-[10px] text-t3">{o.kilimallRef}</span>
                <span className="text-[11px]">{o.productName}</span>
                <span className="text-[11px]">{o.qty}</span>
                <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>
                <span className="text-[11px] text-t3">{fmtDate(o.orderDate)}</span>
                <span className="font-mono text-[10px] text-t3">{o.serialNumber || '—'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-medium capitalize"
                  style={{ background: STATUS_COLOR[o.status] + '20', color: STATUS_COLOR[o.status] }}>{o.status}</span>
              </div>
            ))
          }
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          DISPATCH
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'dispatch' && (
        <div className="grid grid-cols-2 gap-4">
          {/* Pending dispatch queue */}
          <div className="card overflow-hidden">
            <PanelHeader title="Pending Dispatch" count={pendingOrders.length} />
            {pendingOrders.length === 0
              ? <p className="py-10 text-center text-xs text-t3">No orders awaiting dispatch</p>
              : pendingOrders.map(o => (
                <div key={o.id} className="table-row flex items-center justify-between px-4 py-3"
                  style={{ background: dispatchOrderId === o.id ? '#EFF6FF' : undefined, cursor: 'pointer' }}
                  onClick={() => setDispatchOrderId(o.id)}>
                  <div>
                    <p className="text-[11px] font-semibold">{o.ref} <span className="font-normal text-t3">· {o.kilimallRef}</span></p>
                    <p className="text-[10px] text-t3">{o.productName} · {fmtDate(o.orderDate)}</p>
                  </div>
                  <span className="text-[11px] font-mono font-semibold">{fmtKes(o.total)}</span>
                </div>
              ))
            }
          </div>

          {/* Dispatch form */}
          <div className="card p-4 flex flex-col gap-3">
            <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider">Confirm Dispatch</p>
            {dispatchOrder ? (
              <>
                <div className="rounded-lg p-3" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                  <p className="text-[11px] font-semibold">{dispatchOrder.ref} — {dispatchOrder.kilimallRef}</p>
                  <p className="text-[10px] text-t3">{dispatchOrder.productName} · Qty {dispatchOrder.qty}</p>
                  <p className="text-[10px] text-t3">{fmtKes(dispatchOrder.total)}</p>
                </div>
                <Field label="Serial Number" required hint={`${availableSerials.length} available in stock`}>
                  <div className="relative">
                    <input className="form-input w-full" value={dispatchSerial}
                      onChange={e => setDispatchSerial(e.target.value)}
                      placeholder="Type or select serial…" list="dispatch-serials" />
                    <datalist id="dispatch-serials">
                      {availableSerials.map(s => <option key={s.id} value={s.serial} />)}
                    </datalist>
                  </div>
                  {availableSerials.length === 0 && (
                    <p className="text-[10px] mt-1" style={{ color: '#DC2626' }}>
                      ⚠ No available stock for this product. <button className="underline" onClick={() => setModule('inventory')}>Check Inventory</button>
                    </p>
                  )}
                </Field>
                <button className="btn-primary" onClick={handleDispatch}
                  disabled={!dispatchSerial || availableSerials.length === 0}>
                  ✓ Confirm Dispatch
                </button>
                <button className="btn-outline text-[11px]" onClick={() => { setDispatchOrderId(null); setDispatchSerial('') }}>
                  Cancel
                </button>
              </>
            ) : (
              <p className="text-[11px] text-t3 py-8 text-center">Select an order from the queue to dispatch</p>
            )}
          </div>

          {/* Recent dispatches */}
          <div className="card overflow-hidden col-span-2">
            <PanelHeader title="Dispatch History" count={kilimallDispatches.length} />
            <div className="overflow-x-auto w-full">
              <div className="min-w-[800px] flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '90px 100px 120px 1.4fr 140px 100px 90px' }}>
              <span>Dispatch Ref</span><span>Order Ref</span><span>Kilimall Ref</span><span>Product</span><span>Serial</span><span>Date</span><span>Status</span>
            </div>
            {kilimallDispatches.length === 0
              ? <p className="py-8 text-center text-xs text-t3">No dispatches yet</p>
              : kilimallDispatches.map(d => (
                <div key={d.id} className="table-row" style={{ gridTemplateColumns: '90px 100px 120px 1.4fr 140px 100px 90px' }}>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{d.ref}</span>
                  <span className="font-mono text-[10px]">{d.orderRef}</span>
                  <span className="font-mono text-[10px] text-t3">{d.kilimallRef}</span>
                  <span className="text-[11px]">{d.productName}</span>
                  <span className="font-mono text-[10px]">{d.serialNumber}</span>
                  <span className="text-[11px] text-t3">{fmtDate(d.date)}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-medium"
                    style={{ background: d.status === 'dispatched' ? '#DBEAFE' : '#DCFCE7', color: d.status === 'dispatched' ? '#1D4ED8' : '#059669' }}>
                    {d.status}
                  </span>
                </div>
              ))
            }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SETTLEMENTS
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'settlements' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Weekly Settlements" count={kilimallSettlements.length}>
            <button className="btn-primary text-[11px]" onClick={() => setShowNewSettlement(true)}>+ New Settlement</button>
          </PanelHeader>
          <div className="overflow-x-auto w-full">
            <div className="min-w-[900px] flex flex-col">
          <div className="table-head" style={{ gridTemplateColumns: '90px 160px 70px 110px 90px 110px 100px 100px' }}>
            <span>Ref</span><span>Week Period</span><span>Orders</span><span>Gross</span><span>Deductions</span>
            <span>Net Paid</span><span>Payment Date</span><span>Status</span>
          </div>
          {kilimallSettlements.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No settlements recorded</p>
            : kilimallSettlements.map(s => (
              <div key={s.id} className="table-row" style={{ gridTemplateColumns: '90px 160px 70px 110px 90px 110px 100px 100px' }}
                onClick={() => setViewSettlement(s)}>
                <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{s.ref}</span>
                <span className="text-[11px]">{s.weekPeriod}</span>
                <span className="text-[11px]">{s.totalOrders}</span>
                <span className="font-mono text-[11px]">{fmtKes(s.grossAmount)}</span>
                <span className="font-mono text-[11px]" style={{ color: '#EF4444' }}>−{fmtKes(s.deductions)}</span>
                <span className="font-mono text-[11px] font-semibold" style={{ color: '#10B981' }}>{fmtKes(s.netPaid)}</span>
                <span className="text-[11px] text-t3">{s.paymentDate ? fmtDate(s.paymentDate) : '—'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-medium capitalize"
                  style={{ background: s.status === 'reconciled' ? '#DCFCE7' : s.status === 'posted' ? '#DBEAFE' : '#F3F4F6', color: s.status === 'reconciled' ? '#059669' : s.status === 'posted' ? '#1D4ED8' : '#6B7280' }}>
                  {s.status}
                </span>
              </div>
            ))
          }
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          RECONCILIATION
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'reconciliation' && (
        <div className="flex flex-col gap-4">
          {/* Unreconciled delivered orders */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider">
                Delivered but Unsettled Orders
                <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: unreconciled > 0 ? '#FEE2E2' : '#DCFCE7', color: unreconciled > 0 ? '#DC2626' : '#059669' }}>
                  {unreconciled}
                </span>
              </p>
            </div>
            <div className="table-head" style={{ gridTemplateColumns: '90px 120px 1.4fr 100px 100px 110px' }}>
              <span>Ref</span><span>Kilimall Ref</span><span>Product</span><span>Total</span><span>Dispatch Date</span><span>Days Outstanding</span>
            </div>
            {kilimallOrders.filter(o => o.status === 'delivered' && !o.settlementId).map(o => {
              const dispatch = kilimallDispatches.find(d => d.id === o.dispatchId)
              const days = dispatch ? Math.floor((Date.now() - new Date(dispatch.date).getTime()) / 86400000) : '?'
              return (
                <div key={o.id} className="table-row" style={{ gridTemplateColumns: '90px 120px 1.4fr 100px 100px 110px' }}>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{o.ref}</span>
                  <span className="font-mono text-[10px] text-t3">{o.kilimallRef}</span>
                  <span className="text-[11px]">{o.productName}</span>
                  <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>
                  <span className="text-[11px] text-t3">{dispatch ? fmtDate(dispatch.date) : '—'}</span>
                  <span className="text-[11px] font-semibold" style={{ color: Number(days) > 14 ? '#DC2626' : '#F59E0B' }}>{days} days</span>
                </div>
              )
            })}
            {unreconciled === 0 && <p className="py-6 text-center text-xs text-t3">✓ All delivered orders are settled</p>}
          </div>

          {/* Settlement reconciliation results */}
          {kilimallSettlements.map(settlement => (
            <div key={settlement.id} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[12px] font-semibold">{settlement.ref} — {settlement.weekPeriod}</p>
                  <p className="text-[10px] text-t3">{settlement.lines.length} lines · Gross {fmtKes(settlement.grossAmount)} · Net {fmtKes(settlement.netPaid)}</p>
                </div>
                {settlement.status !== 'reconciled' && (
                  <button className="btn-primary text-[11px]" onClick={() => reconcileKilimallSettlement(settlement.id)}>
                    🔄 Run Reconciliation
                  </button>
                )}
                {settlement.status === 'reconciled' && (
                  <span className="text-[10px] px-2 py-1 rounded font-semibold" style={{ background: '#DCFCE7', color: '#059669' }}>✓ Reconciled</span>
                )}
              </div>

              {settlement.lines.length > 0 && (
                <>
                  <div className="table-head" style={{ gridTemplateColumns: '140px 110px 110px 110px 80px' }}>
                    <span>Kilimall Ref</span><span>Settlement Amt</span><span>ERP Amt</span><span>Difference</span><span>Result</span>
                  </div>
                  {settlement.lines.map(line => {
                    const diff = line.erpAmount != null ? line.amount - line.erpAmount : null
                    const resultColor = { matched: '#059669', unmatched: '#DC2626', returned: '#F59E0B', mismatch: '#F97316' }[line.status]
                    const resultBg   = { matched: '#DCFCE7', unmatched: '#FEE2E2', returned: '#FEF9C3', mismatch: '#FFF7ED' }[line.status]
                    return (
                      <div key={line.id} className="table-row" style={{ gridTemplateColumns: '140px 110px 110px 110px 80px' }}>
                        <span className="font-mono text-[10px]">{line.kilimallRef}</span>
                        <span className="font-mono text-[11px]">{fmtKes(line.amount)}</span>
                        <span className="font-mono text-[11px]">{line.erpAmount != null ? fmtKes(line.erpAmount) : '—'}</span>
                        <span className="font-mono text-[11px]" style={{ color: diff && diff !== 0 ? '#DC2626' : '#10B981' }}>
                          {diff != null ? (diff === 0 ? '—' : fmtKes(Math.abs(diff))) : '—'}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ background: resultBg, color: resultColor }}>
                          {line.status === 'matched' ? '✔ OK' : line.status === 'unmatched' ? '⚠ Missing' : line.status === 'mismatch' ? '❗ Mismatch' : '↩ Returned'}
                        </span>
                      </div>
                    )
                  })}
                  <div className="flex gap-6 px-3 py-2 text-[10px] text-t2" style={{ background: '#F9FAFB', borderTop: '1px solid #F3F4F6' }}>
                    <span>✔ Matched: <b>{settlement.lines.filter(l => l.status === 'matched').length}</b></span>
                    <span style={{ color: '#DC2626' }}>⚠ Unmatched: <b>{settlement.lines.filter(l => l.status === 'unmatched').length}</b></span>
                    <span style={{ color: '#F97316' }}>❗ Mismatch: <b>{settlement.lines.filter(l => l.status === 'mismatch').length}</b></span>
                    <span style={{ color: '#F59E0B' }}>↩ Returned: <b>{settlement.lines.filter(l => l.status === 'returned').length}</b></span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          RETURNS
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'returns' && (
        <div className="card p-6 flex flex-col items-center gap-4">
          <span style={{ fontSize: 40 }}>↩️</span>
          <p className="text-sm font-semibold text-t1">Kilimall Returns → RMA</p>
          <p className="text-[11px] text-t3 text-center max-w-sm">
            All Kilimall returns must be processed through the After-Sales RMA module.
            Mark the order as returned here, then create an RMA for exchange or refund processing.
          </p>
          <div className="flex gap-3">
            <button className="btn-primary" onClick={() => { setModule('after_sales'); router.push('/after_sales'); }}>Open After-Sales →</button>
          </div>
          <div className="card w-full p-4 mt-2">
            <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-2">Returned Orders</p>
            <div className="overflow-x-auto w-full">
              <div className="min-w-[650px] flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '90px 120px 1.4fr 100px 100px' }}>
              <span>Ref</span><span>Kilimall Ref</span><span>Product</span><span>Total</span><span>RMA Linked</span>
            </div>
            {kilimallOrders.filter(o => o.status === 'returned').map(o => (
              <div key={o.id} className="table-row" style={{ gridTemplateColumns: '90px 120px 1.4fr 100px 100px' }}>
                <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{o.ref}</span>
                <span className="font-mono text-[10px] text-t3">{o.kilimallRef}</span>
                <span className="text-[11px]">{o.productName}</span>
                <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>
                <span className="text-[10px]" style={{ color: o.rmaId ? '#059669' : '#DC2626' }}>
                  {o.rmaId ? `✓ ${o.rmaId}` : 'No RMA'}
                </span>
              </div>
            ))}
            {kilimallOrders.filter(o => o.status === 'returned').length === 0 && (
              <p className="py-6 text-center text-xs text-t3">No returned orders</p>
            )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          REPORTS
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'reports' && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-1">
            {([['ops','📋 Operational'],['financial','💰 Financial'],['control','🔍 Control']] as const).map(([t,l]) => (
              <button key={t} onClick={() => setReportTab(t)} style={tabBtn(reportTab === t)}>{l}</button>
            ))}
          </div>

          {reportTab === 'ops' && (
            <div className="card p-4">
              <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Orders by Status</p>
              <div className="overflow-x-auto w-full">
                <div className="min-w-[500px] flex flex-col">
              <div className="table-head" style={{ gridTemplateColumns: '120px 80px 110px 110px' }}>
                <span>Status</span><span>Count</span><span>Total Value</span><span>% of Orders</span>
              </div>
              {(['pending','dispatched','delivered','returned','cancelled'] as KilimallOrderStatus[]).map(s => {
                const orders = kilimallOrders.filter(o => o.status === s)
                return (
                  <div key={s} className="table-row" style={{ gridTemplateColumns: '120px 80px 110px 110px' }}>
                    <span className="capitalize text-[11px] font-medium">{s}</span>
                    <span className="text-[11px]">{orders.length}</span>
                    <span className="font-mono text-[11px]">{fmtKes(orders.reduce((s, o) => s + o.total, 0))}</span>
                    <span className="text-[11px] text-t3">{totalOrders > 0 ? ((orders.length / totalOrders) * 100).toFixed(1) : 0}%</span>
                  </div>
                )
              })}
                </div>
              </div>
            </div>
          )}

          {reportTab === 'financial' && (
            <div className="card p-4">
              <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Gross vs Net — All Settlements</p>
              <div className="overflow-x-auto w-full">
                <div className="min-w-[700px] flex flex-col">
              <div className="table-head" style={{ gridTemplateColumns: '90px 160px 110px 90px 110px 100px' }}>
                <span>Ref</span><span>Period</span><span>Gross</span><span>Deductions</span><span>Net Paid</span><span>Status</span>
              </div>
              {kilimallSettlements.map(s => (
                <div key={s.id} className="table-row" style={{ gridTemplateColumns: '90px 160px 110px 90px 110px 100px' }}>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{s.ref}</span>
                  <span className="text-[11px]">{s.weekPeriod}</span>
                  <span className="font-mono text-[11px]">{fmtKes(s.grossAmount)}</span>
                  <span className="font-mono text-[11px]" style={{ color: '#EF4444' }}>−{fmtKes(s.deductions)}</span>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#10B981' }}>{fmtKes(s.netPaid)}</span>
                  <span className="text-[10px] capitalize">{s.status}</span>
                </div>
              ))}
              {kilimallSettlements.length === 0 && <p className="py-6 text-center text-xs text-t3">No settlements yet</p>}
              <div className="flex gap-8 px-3 py-3 text-[11px] font-semibold" style={{ background: '#F9FAFB', borderTop: '1px solid #F3F4F6' }}>
                <span>Gross: {fmtKes(kilimallSettlements.reduce((s, x) => s + x.grossAmount, 0))}</span>
                <span style={{ color: '#EF4444' }}>Deductions: −{fmtKes(kilimallSettlements.reduce((s, x) => s + x.deductions, 0))}</span>
                <span style={{ color: '#10B981' }}>Net: {fmtKes(kilimallSettlements.reduce((s, x) => s + x.netPaid, 0))}</span>
              </div>
                </div>
              </div>
            </div>
          )}

          {reportTab === 'control' && (
            <div className="flex flex-col gap-4">
              <div className="card p-4">
                <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Missing / Unmatched Orders</p>
                {kilimallSettlements.flatMap(s => s.lines.filter(l => l.status === 'unmatched').map(l => ({ ...l, settlement: s }))).length === 0
                  ? <p className="text-xs text-t3 py-4 text-center">✓ No unmatched settlement lines</p>
                  : kilimallSettlements.flatMap(s =>
                    s.lines.filter(l => l.status === 'unmatched').map(l => (
                      <div key={l.id} className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#FEE2E2', background: '#FFF5F5' }}>
                        <span className="font-mono text-[11px]">{l.kilimallRef}</span>
                        <span className="text-[11px]">{fmtKes(l.amount)}</span>
                        <span className="text-[10px] text-t3">{s.weekPeriod}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: '#FEE2E2', color: '#DC2626' }}>⚠ No ERP Record</span>
                      </div>
                    ))
                  )
                }
              </div>
              <div className="card p-4">
                <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Orders Not Settled</p>
                {kilimallOrders.filter(o => o.status === 'delivered' && !o.settlementId).map(o => (
                  <div key={o.id} className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#F3F4F6' }}>
                    <span className="font-mono text-[11px] font-semibold">{o.ref}</span>
                    <span className="text-[11px]">{o.productName}</span>
                    <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>
                    <span className="text-[10px]" style={{ color: '#DC2626' }}>Unpaid</span>
                  </div>
                ))}
                {kilimallOrders.filter(o => o.status === 'delivered' && !o.settlementId).length === 0 && (
                  <p className="text-xs text-t3 py-4 text-center">✓ All delivered orders are settled</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SETTINGS
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'settings' && (
        <div className="card p-6 max-w-lg flex flex-col gap-4">
          <p className="text-sm font-semibold text-t1">Kilimall Channel Settings</p>
          <div className="rounded-lg p-3" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
            <div className="flex justify-between text-[11px] py-1.5"><span className="text-t3">Sales Channel</span><span className="font-semibold">Kilimall Marketplace</span></div>
            <div className="flex justify-between text-[11px] py-1.5"><span className="text-t3">Default Customer</span><span className="font-semibold">Kilimall Marketplace</span></div>
            <div className="flex justify-between text-[11px] py-1.5"><span className="text-t3">Payment Terms</span><span className="font-semibold">Weekly Settlement</span></div>
            <div className="flex justify-between text-[11px] py-1.5"><span className="text-t3">Serial at Dispatch</span><span className="font-semibold text-green-600">Required</span></div>
            <div className="flex justify-between text-[11px] py-1.5"><span className="text-t3">Returns Flow</span><span className="font-semibold">Must go through RMA</span></div>
            <div className="flex justify-between text-[11px] py-1.5"><span className="text-t3">Order Deletion</span><span className="font-semibold text-red-500">Not Allowed</span></div>
          </div>
          <p className="text-[10px] text-t3">These are fixed system controls and cannot be changed.</p>
        </div>
      )}

      </div>{/* mod-body */}

      {/* ════════════════════════════════════════════════════════════════════════
          MODALS
      ════════════════════════════════════════════════════════════════════════ */}

      {/* New Order */}
      {showNewOrder && (
        <Modal title="New Kilimall Order" onClose={() => setShowNewOrder(false)} width={520}>
          <Field label="Kilimall Order ID" required>
            <Input value={newOrder.kilimallRef} onChange={v => setNewOrder(p => ({ ...p, kilimallRef: v }))} placeholder="e.g. KLM-20240419-001" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Order Date" required>
              <Input value={newOrder.orderDate} onChange={v => setNewOrder(p => ({ ...p, orderDate: v }))} type="date" />
            </Field>
            <Field label="Customer Name" hint="Optional">
              <Input value={newOrder.customerName} onChange={v => setNewOrder(p => ({ ...p, customerName: v }))} placeholder="Kilimall buyer name" />
            </Field>
          </div>
          <Field label="Product" required>
            <div className="relative">
              <input className="form-input w-full" value={newOrder.productName}
                onChange={e => {
                  const v = e.target.value
                  setNewOrder(p => ({ ...p, productName: v }))
                  const m = products.find(pr => pr.name.toLowerCase().startsWith(v.toLowerCase()))
                  if (m) setNewOrder(p => ({ ...p, productId: m.id, unitPrice: String(m.salePrice ?? 0) }))
                }}
                placeholder="Search product…" list="ko-products" />
              <datalist id="ko-products">
                {products.filter(p => p.canBeSold && p.isActive).map(p => <option key={p.id} value={p.name} />)}
              </datalist>
            </div>
          </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Quantity" required>
              <Input value={newOrder.qty} onChange={v => setNewOrder(p => ({ ...p, qty: v }))} type="number" />
            </Field>
            <Field label="Unit Price (KES)" required>
              <Input value={newOrder.unitPrice} onChange={v => setNewOrder(p => ({ ...p, unitPrice: v }))} type="number" />
            </Field>
          </div>
          <Field label="Notes" hint="Optional">
            <Textarea value={newOrder.notes} onChange={v => setNewOrder(p => ({ ...p, notes: v }))} rows={2} />
          </Field>
          {newOrder.unitPrice && newOrder.qty && (
            <div className="text-right text-[11px] font-semibold" style={{ color: '#1B2762' }}>
              Total: {fmtKes(Number(newOrder.qty) * Number(newOrder.unitPrice))}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => setShowNewOrder(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleCreateOrder}>Create Order</button>
          </div>
        </Modal>
      )}

      {/* Order detail */}
      {viewOrder && (
        <Modal title={viewOrder.ref} subtitle={`Kilimall Ref: ${viewOrder.kilimallRef}`} onClose={() => setViewOrder(null)} width={500}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              ['Product', viewOrder.productName], ['Quantity', String(viewOrder.qty)],
              ['Unit Price', fmtKes(viewOrder.unitPrice)], ['Total', fmtKes(viewOrder.total)],
              ['Order Date', fmtDate(viewOrder.orderDate)], ['Customer', viewOrder.customerName || '—'],
              ['Serial', viewOrder.serialNumber || '—'], ['Settlement', viewOrder.settlementRef || '—'],
            ].map(([k, v]) => (
              <div key={k} className="p-2.5 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                <p className="text-[10px] text-t3 mb-0.5">{k}</p>
                <p className="font-medium">{v}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] px-2.5 py-1 rounded font-semibold capitalize"
              style={{ background: STATUS_COLOR[viewOrder.status] + '20', color: STATUS_COLOR[viewOrder.status] }}>
              {viewOrder.status}
            </span>
            {viewOrder.status === 'dispatched' && (
              <button className="btn-primary text-[11px]" onClick={() => {
                updateKilimallOrder(viewOrder.id, { status: 'delivered' })
                setViewOrder(p => p ? { ...p, status: 'delivered' } : null)
                showToast('Order marked as delivered')
              }}>Mark Delivered</button>
            )}
            {viewOrder.status === 'delivered' && (
              <button className="btn-outline text-[11px]" style={{ borderColor: '#EF4444', color: '#EF4444' }}
                onClick={() => {
                  updateKilimallOrder(viewOrder.id, { status: 'returned' })
                  setViewOrder(p => p ? { ...p, status: 'returned' } : null)
                  showToast('Order marked as returned — create RMA in After-Sales')
                }}>Mark Returned</button>
            )}
          </div>
        </Modal>
      )}

      {/* New Settlement */}
      {showNewSettlement && (
        <Modal title="New Weekly Settlement" onClose={() => setShowNewSettlement(false)} width={600}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Week Period" required hint='e.g. "1–7 Apr 2026"'>
              <Input value={settlForm.weekPeriod} onChange={v => setSettlForm(p => ({ ...p, weekPeriod: v }))} placeholder="1–7 Apr 2026" />
            </Field>
            <Field label="Payment Method">
              <Select value={settlForm.paymentMethod} onChange={v => setSettlForm(p => ({ ...p, paymentMethod: v as any }))}
                options={[{ value: 'mpesa', label: 'M-Pesa' }, { value: 'bank', label: 'Bank Transfer' }]} />
            </Field>
            <Field label="Week Start"><Input value={settlForm.weekStart} onChange={v => setSettlForm(p => ({ ...p, weekStart: v }))} type="date" /></Field>
            <Field label="Week End"><Input value={settlForm.weekEnd} onChange={v => setSettlForm(p => ({ ...p, weekEnd: v }))} type="date" /></Field>
            <Field label="Gross Amount (KES)" required><Input value={settlForm.grossAmount} onChange={v => setSettlForm(p => ({ ...p, grossAmount: v }))} type="number" /></Field>
            <Field label="Deductions (KES)"><Input value={settlForm.deductions} onChange={v => setSettlForm(p => ({ ...p, deductions: v }))} type="number" placeholder="0" /></Field>
            <Field label="Net Paid (KES)">
              <Input value={settlForm.netPaid || String(Number(settlForm.grossAmount || 0) - Number(settlForm.deductions || 0))}
                onChange={v => setSettlForm(p => ({ ...p, netPaid: v }))} type="number" />
            </Field>
            <Field label="Payment Date"><Input value={settlForm.paymentDate} onChange={v => setSettlForm(p => ({ ...p, paymentDate: v }))} type="date" /></Field>
            <Field label="Payment Reference" hint="Bank/M-Pesa ref">
              <Input value={settlForm.paymentRef} onChange={v => setSettlForm(p => ({ ...p, paymentRef: v }))} placeholder="e.g. MPESA REF or TXN ID" />
            </Field>
          </div>

          {/* Order lines */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-t2">Settlement Lines (Order IDs)</p>
              <div className="flex gap-2">
                <button className="text-[10px] px-2 py-1 rounded border text-t2" style={{ borderColor: '#E5E7EB' }}
                  onClick={() => settlFileRef.current?.click()}>📤 Import Excel</button>
                <input ref={settlFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleSettlementUpload(e.target.files[0]) }} />
                <button className="text-[10px] px-2 py-1 rounded border text-t2" style={{ borderColor: '#E5E7EB' }}
                  onClick={() => setSettlLines(p => [...p, { kilimallRef: '', amount: '' }])}>+ Add Row</button>
              </div>
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #E5E7EB', maxHeight: 200, overflowY: 'auto' }}>
              <div className="table-head" style={{ gridTemplateColumns: '1.5fr 120px 36px' }}>
                <span>Kilimall Order ID</span><span>Amount (KES)</span><span></span>
              </div>
              {settlLines.map((l, i) => (
                <div key={i} className="grid items-center px-3 py-1.5 gap-2" style={{ gridTemplateColumns: '1.5fr 120px 36px', borderBottom: '1px solid #F3F4F6' }}>
                  <input className="form-input text-[11px] py-1" value={l.kilimallRef}
                    onChange={e => setSettlLines(p => p.map((x, j) => j === i ? { ...x, kilimallRef: e.target.value } : x))}
                    placeholder="KLM-..." />
                  <input className="form-input text-[11px] py-1" value={l.amount} type="number"
                    onChange={e => setSettlLines(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                  <button className="text-[10px] text-red-400 hover:text-red-600"
                    onClick={() => setSettlLines(p => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <button className="btn-outline" onClick={() => setShowNewSettlement(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleCreateSettlement}>Create Settlement</button>
          </div>
        </Modal>
      )}

      {/* Settlement detail */}
      {viewSettlement && (
        <Modal title={viewSettlement.ref} subtitle={viewSettlement.weekPeriod} onClose={() => setViewSettlement(null)} width={560}>
          <div className="grid grid-cols-3 gap-3 text-xs mb-3">
            {[['Gross Amount', fmtKes(viewSettlement.grossAmount)], ['Deductions', fmtKes(viewSettlement.deductions)], ['Net Paid', fmtKes(viewSettlement.netPaid)]].map(([k, v]) => (
              <div key={k} className="p-2.5 rounded-lg text-center" style={{ background: 'var(--bg-surface)' }}>
                <p className="text-[10px] text-t3 mb-0.5">{k}</p>
                <p className="font-semibold">{v}</p>
              </div>
            ))}
          </div>
          <div className="table-head" style={{ gridTemplateColumns: '140px 100px 80px' }}>
            <span>Kilimall Ref</span><span>Amount</span><span>Status</span>
          </div>
          {viewSettlement.lines.map(l => (
            <div key={l.id} className="table-row" style={{ gridTemplateColumns: '140px 100px 80px' }}>
              <span className="font-mono text-[10px]">{l.kilimallRef}</span>
              <span className="font-mono text-[11px]">{fmtKes(l.amount)}</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded capitalize"
                style={{ background: l.status === 'matched' ? '#DCFCE7' : '#FEE2E2', color: l.status === 'matched' ? '#059669' : '#DC2626' }}>
                {l.status}
              </span>
            </div>
          ))}
          <div className="flex gap-2 justify-end mt-3">
            {viewSettlement.status !== 'reconciled' && (
              <button className="btn-primary text-[11px]" onClick={() => {
                reconcileKilimallSettlement(viewSettlement.id)
                setViewSettlement(null)
              }}>🔄 Run Reconciliation</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
