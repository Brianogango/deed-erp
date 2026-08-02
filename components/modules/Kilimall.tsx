'use client'
import { useState, useRef, useEffect } from 'react'
import {
  useCommerceStore, KilimallOrder, KilimallOrderStatus, KilimallSettlement,
  KilimallSettlementLine, KilimallDispatch, fmtKes, fmtDate,
} from '@/lib/store'
import { useRouter } from 'next/navigation'
import { Badge, PanelHeader, Field, Input, Select, Modal, Textarea, ModuleSkeleton, TabBar, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { loadXlsx } from '@/lib/xlsx-lazy'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import {
  Fa, faCartShopping, faPlus, faRotateLeft, faClipboardList,
  faMoneyBillWave, faMagnifyingGlass, faFileImport, faArrowsRotate,
  faTriangleExclamation, faCheck, faCircleExclamation,
} from '@/components/icons'

type Tab = 'orders' | 'dispatch' | 'settlements' | 'reconciliation' | 'returns' | 'reports' | 'settings'

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
  } = useCommerceStore()

  // Lands directly on the operational order queue — module analytics moved to
  // the central dashboard; the KPI strip and Reports tab cover the summaries.
  const [tab, setTab] = useState<Tab>('orders')
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

  const kilimallOrderPrimaryFilters: PrimaryFilterConfig[] = [
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All statuses',
      value: orderStatusFilter,
      options: [
        { value: 'all', label: 'All statuses' },
        ...(['pending','dispatched','delivered','returned','cancelled'] as KilimallOrderStatus[]).map(status => ({
          value: status,
          label: status.charAt(0).toUpperCase() + status.slice(1),
        })),
      ],
      onChange: value => setOrderStatusFilter(value as KilimallOrderStatus | 'all'),
    },
  ]

  const orderColumns: ColumnDef<KilimallOrder>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: o => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{o.ref}</span>,
      accessor: o => o.ref,
      exportValue: o => o.ref,
    },
    {
      key: 'kilimallRef', label: 'Kilimall ref', priority: 2, width: '120px',
      render: o => <span className="font-mono text-[10px] text-t3">{o.kilimallRef}</span>,
      exportValue: o => o.kilimallRef,
    },
    {
      key: 'product', label: 'Product', priority: 1, width: '1.4fr',
      render: o => <span className="text-[11px] erp-truncate" title={o.productName}>{o.productName}</span>,
      exportValue: o => o.productName,
    },
    {
      key: 'qty', label: 'Qty', priority: 3, width: '60px',
      render: o => <span className="text-[11px]">{o.qty}</span>,
      exportValue: o => o.qty,
    },
    {
      key: 'total', label: 'Total', priority: 1, width: '100px',
      render: o => <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>,
      exportValue: o => o.total,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: o => <span className="text-[11px] text-t3">{fmtDate(o.orderDate)}</span>,
      exportValue: o => o.orderDate,
    },
    {
      key: 'serial', label: 'Serial', priority: 3, width: '90px',
      render: o => <span className="font-mono text-[10px] text-t3">{o.serialNumber || '—'}</span>,
      exportValue: o => o.serialNumber || '',
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '80px',
      render: o => (
        <span className="text-[10px] px-2 py-0.5 rounded font-medium capitalize"
          style={{ background: STATUS_COLOR[o.status] + '20', color: STATUS_COLOR[o.status] }}>{o.status}</span>
      ),
      accessor: o => o.status,
      exportValue: o => o.status,
    },
  ]

  const dispatchColumns: ColumnDef<KilimallDispatch>[] = [
    {
      key: 'ref', label: 'Dispatch ref', priority: 1, width: '90px',
      render: d => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{d.ref}</span>,
      accessor: d => d.ref,
      exportValue: d => d.ref,
    },
    {
      key: 'orderRef', label: 'Order ref', priority: 2, width: '100px',
      render: d => <span className="font-mono text-[10px]">{d.orderRef}</span>,
      exportValue: d => d.orderRef,
    },
    {
      key: 'kilimallRef', label: 'Kilimall ref', priority: 2, width: '120px',
      render: d => <span className="font-mono text-[10px] text-t3">{d.kilimallRef}</span>,
      exportValue: d => d.kilimallRef,
    },
    {
      key: 'product', label: 'Product', priority: 1, width: '1.4fr',
      render: d => <span className="text-[11px]">{d.productName}</span>,
      exportValue: d => d.productName,
    },
    {
      key: 'serial', label: 'Serial', priority: 1, width: '140px',
      render: d => <span className="font-mono text-[10px]">{d.serialNumber}</span>,
      exportValue: d => d.serialNumber,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: d => <span className="text-[11px] text-t3">{fmtDate(d.date)}</span>,
      exportValue: d => d.date,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '90px',
      render: d => (
        <span className="text-[10px] px-2 py-0.5 rounded font-medium"
          style={{ background: d.status === 'dispatched' ? 'var(--primary-light)' : 'var(--success-bg)', color: d.status === 'dispatched' ? 'var(--primary-dark)' : 'var(--success)' }}>
          {d.status}
        </span>
      ),
      accessor: d => d.status,
      exportValue: d => d.status,
    },
  ]

  const settlementColumns: ColumnDef<KilimallSettlement>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: s => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{s.ref}</span>,
      accessor: s => s.ref,
      exportValue: s => s.ref,
    },
    {
      key: 'week', label: 'Week period', priority: 1, width: '160px',
      render: s => <span className="text-[11px]">{s.weekPeriod}</span>,
      exportValue: s => s.weekPeriod,
    },
    {
      key: 'orders', label: 'Orders', priority: 3, width: '70px',
      render: s => <span className="text-[11px]">{s.totalOrders}</span>,
      exportValue: s => s.totalOrders,
    },
    {
      key: 'gross', label: 'Gross', priority: 2, width: '110px',
      render: s => <span className="font-mono text-[11px]">{fmtKes(s.grossAmount)}</span>,
      exportValue: s => s.grossAmount,
    },
    {
      key: 'deductions', label: 'Deductions', priority: 3, width: '90px',
      render: s => <span className="font-mono text-[11px]" style={{ color: 'var(--danger)' }}>−{fmtKes(s.deductions)}</span>,
      exportValue: s => s.deductions,
    },
    {
      key: 'net', label: 'Net paid', priority: 1, width: '110px',
      render: s => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--success)' }}>{fmtKes(s.netPaid)}</span>,
      exportValue: s => s.netPaid,
    },
    {
      key: 'paymentDate', label: 'Payment date', priority: 2, width: '100px',
      render: s => <span className="text-[11px] text-t3">{s.paymentDate ? fmtDate(s.paymentDate) : '—'}</span>,
      exportValue: s => s.paymentDate || '',
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '100px',
      render: s => (
        <span className="text-[10px] px-2 py-0.5 rounded font-medium capitalize"
          style={{ background: s.status === 'reconciled' ? 'var(--success-bg)' : s.status === 'posted' ? 'var(--primary-light)' : 'var(--bg-muted)', color: s.status === 'reconciled' ? 'var(--success)' : s.status === 'posted' ? 'var(--primary-dark)' : 'var(--text-4)' }}>
          {s.status}
        </span>
      ),
      accessor: s => s.status,
      exportValue: s => s.status,
    },
  ]

  type UnsettledRow = KilimallOrder & { dispatchDate: string; daysOutstanding: number | string }
  const unsettledOrders: UnsettledRow[] = kilimallOrders
    .filter(o => o.status === 'delivered' && !o.settlementId)
    .map(o => {
      const dispatch = kilimallDispatches.find(d => d.id === o.dispatchId)
      const days = dispatch ? Math.floor((Date.now() - new Date(dispatch.date).getTime()) / 86400000) : '?'
      return { ...o, dispatchDate: dispatch?.date || '', daysOutstanding: days }
    })

  const unsettledColumns: ColumnDef<UnsettledRow>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: o => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{o.ref}</span>,
      exportValue: o => o.ref,
    },
    {
      key: 'kilimallRef', label: 'Kilimall ref', priority: 2, width: '120px',
      render: o => <span className="font-mono text-[10px] text-t3">{o.kilimallRef}</span>,
      exportValue: o => o.kilimallRef,
    },
    {
      key: 'product', label: 'Product', priority: 1, width: '1.4fr',
      render: o => <span className="text-[11px]">{o.productName}</span>,
      exportValue: o => o.productName,
    },
    {
      key: 'total', label: 'Total', priority: 1, width: '100px',
      render: o => <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>,
      exportValue: o => o.total,
    },
    {
      key: 'dispatchDate', label: 'Dispatch date', priority: 2, width: '100px',
      render: o => <span className="text-[11px] text-t3">{o.dispatchDate ? fmtDate(o.dispatchDate) : '—'}</span>,
      exportValue: o => o.dispatchDate,
    },
    {
      key: 'days', label: 'Days outstanding', priority: 1, width: '110px',
      render: o => (
        <span className="text-[11px] font-semibold" style={{ color: Number(o.daysOutstanding) > 14 ? 'var(--danger)' : 'var(--warning)' }}>
          {o.daysOutstanding} days
        </span>
      ),
      exportValue: o => o.daysOutstanding,
    },
  ]

  const returnedOrders = kilimallOrders.filter(o => o.status === 'returned')
  const returnedColumns: ColumnDef<KilimallOrder>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: o => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{o.ref}</span>,
      exportValue: o => o.ref,
    },
    {
      key: 'kilimallRef', label: 'Kilimall ref', priority: 2, width: '120px',
      render: o => <span className="font-mono text-[10px] text-t3">{o.kilimallRef}</span>,
      exportValue: o => o.kilimallRef,
    },
    {
      key: 'product', label: 'Product', priority: 1, width: '1.4fr',
      render: o => <span className="text-[11px]">{o.productName}</span>,
      exportValue: o => o.productName,
    },
    {
      key: 'total', label: 'Total', priority: 1, width: '100px',
      render: o => <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>,
      exportValue: o => o.total,
    },
    {
      key: 'rma', label: 'RMA linked', priority: 1, width: '100px',
      render: o => (
        <span className="text-[10px]" style={{ color: o.rmaId ? 'var(--success)' : 'var(--danger)' }}>
          {o.rmaId ? `✓ ${o.rmaId}` : 'No RMA'}
        </span>
      ),
      exportValue: o => o.rmaId || '',
    },
  ]

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
    reader.onload = async (e) => {
      try {
        const XLSX = await loadXlsx()
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
      <ModuleHeader
        title="Kilimall"
        subtitle="Orders, dispatch, settlements and reconciliation"
        icon={<Fa icon={faCartShopping} />}
        count={totalOrders}
        color="var(--warning)"
        primaryAction={
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => setShowNewOrder(true)}>
            New order
          </PrimaryActionButton>
        }
      />

      <TabBar
        tabs={[
          { id: 'orders', label: 'Orders' },
          { id: 'dispatch', label: 'Dispatch' },
          { id: 'settlements', label: 'Settlements' },
          { id: 'reconciliation', label: 'Reconciliation' },
          { id: 'returns', label: 'Returns' },
          { id: 'reports', label: 'Reports' },
          { id: 'settings', label: 'Settings' },
        ]}
        active={tab}
        onChange={id => setTab(id as Tab)}
        maxVisibleMobile={4}
        maxVisibleTablet={6}
        maxVisibleDesktop={7}
        ariaLabel="Kilimall sections"
      />

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

      {/* ════════════════════════════════════════════════════════════════════════
          ORDERS
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'orders' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Kilimall Orders" count={filteredOrders.length} />

          <DataTable
            tableId="kilimall-orders"
            columns={orderColumns}
            rows={filteredOrders}
            rowKey={o => o.id}
            searchValue={orderSearch}
            onSearchChange={setOrderSearch}
            searchPlaceholder="Search Kilimall orders by ref, product, or customer..."
            clientSearch={false}
            primaryFilters={kilimallOrderPrimaryFilters}
            onClearFilters={() => { setOrderSearch(''); setOrderStatusFilter('all') }}
            hideColumnFilters
            emptyMessage="No orders found"
            onRowClick={o => setViewOrder(o)}
            exportTitle="Kilimall Orders"
            exportFilename="kilimall-orders"
          />
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
                  style={{ background: dispatchOrderId === o.id ? 'var(--info-bg)' : undefined, cursor: 'pointer' }}
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
                <div className="rounded-lg p-3" style={{ background: 'var(--info-bg)', border: '1px solid #BFDBFE' }}>
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
                    <p className="text-[10px] mt-1 inline-flex items-center gap-1 flex-wrap" style={{ color: 'var(--danger)' }}>
                      <Fa icon={faTriangleExclamation} aria-hidden="true" /> No available stock for this product. <button type="button" className="underline" onClick={() => setModule('inventory')}>Check Inventory</button>
                    </p>
                  )}
                </Field>
                <button className="btn-primary inline-flex items-center gap-1.5" onClick={handleDispatch}
                  disabled={!dispatchSerial || availableSerials.length === 0}>
                  <Fa icon={faCheck} aria-hidden="true" /> Confirm Dispatch
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
            <DataTable
              tableId="kilimall-dispatches"
              columns={dispatchColumns}
              rows={kilimallDispatches}
              rowKey={d => d.id}
              searchPlaceholder="Search dispatches…"
              emptyMessage="No dispatches yet"
              exportTitle="Kilimall Dispatches"
              exportFilename="kilimall-dispatches"
            />
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
          <DataTable
            tableId="kilimall-settlements"
            columns={settlementColumns}
            rows={kilimallSettlements}
            rowKey={s => s.id}
            searchPlaceholder="Search settlements…"
            emptyMessage="No settlements recorded"
            onRowClick={s => setViewSettlement(s)}
            exportTitle="Kilimall Settlements"
            exportFilename="kilimall-settlements"
          />
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
                <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: unreconciled > 0 ? 'var(--danger-bg)' : 'var(--success-bg)', color: unreconciled > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {unreconciled}
                </span>
              </p>
            </div>
            <DataTable
              tableId="kilimall-unsettled"
              columns={unsettledColumns}
              rows={unsettledOrders}
              rowKey={o => o.id}
              hideSearch
              emptyMessage="✓ All delivered orders are settled"
              exportTitle="Unsettled Orders"
              exportFilename="kilimall-unsettled"
            />
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
                  <button className="btn-primary text-[11px] inline-flex items-center gap-1.5" onClick={() => reconcileKilimallSettlement(settlement.id)}>
                    <Fa icon={faArrowsRotate} aria-hidden="true" /> Run Reconciliation
                  </button>
                )}
                {settlement.status === 'reconciled' && (
                  <span className="text-[10px] px-2 py-1 rounded font-semibold inline-flex items-center gap-1" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}><Fa icon={faCheck} aria-hidden="true" /> Reconciled</span>
                )}
              </div>

              {settlement.lines.length > 0 && (
                <>
                  <DataTable
                    tableId={`kilimall-recon-lines-${settlement.id}`}
                    columns={[
                      {
                        key: 'kilimallRef', label: 'Kilimall ref', priority: 1, width: '140px',
                        render: (line: KilimallSettlementLine) => <span className="font-mono text-[10px]">{line.kilimallRef}</span>,
                        exportValue: (line: KilimallSettlementLine) => line.kilimallRef,
                      },
                      {
                        key: 'amount', label: 'Settlement amt', priority: 1, width: '110px',
                        render: (line: KilimallSettlementLine) => <span className="font-mono text-[11px]">{fmtKes(line.amount)}</span>,
                        exportValue: (line: KilimallSettlementLine) => line.amount,
                      },
                      {
                        key: 'erp', label: 'ERP amt', priority: 2, width: '110px',
                        render: (line: KilimallSettlementLine) => <span className="font-mono text-[11px]">{line.erpAmount != null ? fmtKes(line.erpAmount) : '—'}</span>,
                        exportValue: (line: KilimallSettlementLine) => line.erpAmount ?? '',
                      },
                      {
                        key: 'diff', label: 'Difference', priority: 2, width: '110px',
                        render: (line: KilimallSettlementLine) => {
                          const diff = line.erpAmount != null ? line.amount - line.erpAmount : null
                          return (
                            <span className="font-mono text-[11px]" style={{ color: diff && diff !== 0 ? 'var(--danger)' : 'var(--success)' }}>
                              {diff != null ? (diff === 0 ? '—' : fmtKes(Math.abs(diff))) : '—'}
                            </span>
                          )
                        },
                        exportValue: (line: KilimallSettlementLine) => line.erpAmount != null ? line.amount - line.erpAmount : '',
                      },
                      {
                        key: 'result', label: 'Result', priority: 1, width: '80px',
                        render: (line: KilimallSettlementLine) => {
                          const resultColor = { matched: '#059669', unmatched: '#DC2626', returned: '#F59E0B', mismatch: '#F97316' }[line.status]
                          const resultBg   = { matched: '#DCFCE7', unmatched: '#FEE2E2', returned: '#FEF9C3', mismatch: '#FFF7ED' }[line.status]
                          const resultLabel = line.status === 'matched' ? 'OK' : line.status === 'unmatched' ? 'Missing' : line.status === 'mismatch' ? 'Mismatch' : 'Returned'
                          return (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ background: resultBg, color: resultColor }}>
                              {resultLabel}
                            </span>
                          )
                        },
                        accessor: (line: KilimallSettlementLine) => line.status,
                        exportValue: (line: KilimallSettlementLine) => line.status,
                      },
                    ] as ColumnDef<KilimallSettlementLine>[]}
                    rows={settlement.lines}
                    rowKey={l => l.id}
                    hideSearch
                    emptyMessage="No settlement lines"
                    perPage={50}
                  />
                  <div className="flex gap-6 px-3 py-2 text-[10px] text-t2" style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--bg-muted)' }}>
                    <span className="inline-flex items-center gap-1"><Fa icon={faCheck} aria-hidden="true" /> Matched: <b>{settlement.lines.filter(l => l.status === 'matched').length}</b></span>
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}><Fa icon={faTriangleExclamation} aria-hidden="true" /> Unmatched: <b>{settlement.lines.filter(l => l.status === 'unmatched').length}</b></span>
                    <span className="inline-flex items-center gap-1" style={{ color: '#F97316' }}><Fa icon={faCircleExclamation} aria-hidden="true" /> Mismatch: <b>{settlement.lines.filter(l => l.status === 'mismatch').length}</b></span>
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}><Fa icon={faRotateLeft} aria-hidden="true" /> Returned: <b>{settlement.lines.filter(l => l.status === 'returned').length}</b></span>
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
          <span style={{ fontSize: 40, color: 'var(--text-4)' }} aria-hidden="true"><Fa icon={faRotateLeft} /></span>
          <p className="text-sm font-semibold text-t1">Kilimall Returns → RMA</p>
          <p className="text-[11px] text-t3 text-center max-w-sm">
            All Kilimall returns must be processed through the After-Sales RMA module.
            Mark the order as returned here, then create an RMA for exchange or refund processing.
          </p>
          <div className="flex gap-3">
            <button className="btn-primary" onClick={() => { setModule('after_sales'); router.push('/after_sales'); }}>Open After-Sales →</button>
          </div>
          <div className="card w-full p-4 mt-2 overflow-hidden">
            <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-2">Returned Orders</p>
            <DataTable
              tableId="kilimall-returns"
              columns={returnedColumns}
              rows={returnedOrders}
              rowKey={o => o.id}
              hideSearch
              emptyMessage="No returned orders"
              exportTitle="Kilimall Returns"
              exportFilename="kilimall-returns"
            />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          REPORTS
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === 'reports' && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-1">
            {([['ops','Operational',faClipboardList],['financial','Financial',faMoneyBillWave],['control','Control',faMagnifyingGlass]] as const).map(([t, l, icon]) => (
              <button key={t} onClick={() => setReportTab(t)} style={{ ...tabBtn(reportTab === t), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Fa icon={icon} aria-hidden="true" /> {l}
              </button>
            ))}
          </div>

          {reportTab === 'ops' && (() => {
            type StatusRow = { status: KilimallOrderStatus; count: number; total: number; pct: string }
            const statusRows: StatusRow[] = (['pending','dispatched','delivered','returned','cancelled'] as KilimallOrderStatus[]).map(s => {
              const orders = kilimallOrders.filter(o => o.status === s)
              return {
                status: s,
                count: orders.length,
                total: orders.reduce((sum, o) => sum + o.total, 0),
                pct: totalOrders > 0 ? ((orders.length / totalOrders) * 100).toFixed(1) : '0',
              }
            })
            return (
              <div className="card p-4 overflow-hidden">
                <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Orders by Status</p>
                <DataTable
                  tableId="kilimall-report-ops"
                  columns={[
                    { key: 'status', label: 'Status', priority: 1, width: '120px', render: (r: StatusRow) => <span className="capitalize text-[11px] font-medium">{r.status}</span>, exportValue: (r: StatusRow) => r.status },
                    { key: 'count', label: 'Count', priority: 1, width: '80px', render: (r: StatusRow) => <span className="text-[11px]">{r.count}</span>, exportValue: (r: StatusRow) => r.count },
                    { key: 'total', label: 'Total value', priority: 1, width: '110px', render: (r: StatusRow) => <span className="font-mono text-[11px]">{fmtKes(r.total)}</span>, exportValue: (r: StatusRow) => r.total },
                    { key: 'pct', label: '% of orders', priority: 2, width: '110px', render: (r: StatusRow) => <span className="text-[11px] text-t3">{r.pct}%</span>, exportValue: (r: StatusRow) => r.pct },
                  ] as ColumnDef<StatusRow>[]}
                  rows={statusRows}
                  rowKey={r => r.status}
                  hideSearch
                  emptyMessage="No orders"
                  perPage={10}
                />
              </div>
            )
          })()}

          {reportTab === 'financial' && (
            <div className="card p-4 overflow-hidden">
              <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Gross vs Net — All Settlements</p>
              <DataTable
                tableId="kilimall-report-financial"
                columns={[
                  { key: 'ref', label: 'Ref', priority: 1, width: '90px', render: (s: KilimallSettlement) => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{s.ref}</span>, exportValue: (s: KilimallSettlement) => s.ref },
                  { key: 'period', label: 'Period', priority: 1, width: '160px', render: (s: KilimallSettlement) => <span className="text-[11px]">{s.weekPeriod}</span>, exportValue: (s: KilimallSettlement) => s.weekPeriod },
                  { key: 'gross', label: 'Gross', priority: 1, width: '110px', render: (s: KilimallSettlement) => <span className="font-mono text-[11px]">{fmtKes(s.grossAmount)}</span>, exportValue: (s: KilimallSettlement) => s.grossAmount },
                  { key: 'deductions', label: 'Deductions', priority: 2, width: '90px', render: (s: KilimallSettlement) => <span className="font-mono text-[11px]" style={{ color: 'var(--danger)' }}>−{fmtKes(s.deductions)}</span>, exportValue: (s: KilimallSettlement) => s.deductions },
                  { key: 'net', label: 'Net paid', priority: 1, width: '110px', render: (s: KilimallSettlement) => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--success)' }}>{fmtKes(s.netPaid)}</span>, exportValue: (s: KilimallSettlement) => s.netPaid },
                  { key: 'status', label: 'Status', priority: 2, width: '100px', render: (s: KilimallSettlement) => <span className="text-[10px] capitalize">{s.status}</span>, exportValue: (s: KilimallSettlement) => s.status },
                ] as ColumnDef<KilimallSettlement>[]}
                rows={kilimallSettlements}
                rowKey={s => s.id}
                hideSearch
                emptyMessage="No settlements yet"
              />
              <div className="flex gap-8 px-3 py-3 text-[11px] font-semibold" style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--bg-muted)' }}>
                <span>Gross: {fmtKes(kilimallSettlements.reduce((s, x) => s + x.grossAmount, 0))}</span>
                <span style={{ color: 'var(--danger)' }}>Deductions: −{fmtKes(kilimallSettlements.reduce((s, x) => s + x.deductions, 0))}</span>
                <span style={{ color: 'var(--success)' }}>Net: {fmtKes(kilimallSettlements.reduce((s, x) => s + x.netPaid, 0))}</span>
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
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded inline-flex items-center gap-1" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><Fa icon={faTriangleExclamation} aria-hidden="true" /> No ERP Record</span>
                      </div>
                    ))
                  )
                }
              </div>
              <div className="card p-4">
                <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider mb-3">Orders Not Settled</p>
                {kilimallOrders.filter(o => o.status === 'delivered' && !o.settlementId).map(o => (
                  <div key={o.id} className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--bg-muted)' }}>
                    <span className="font-mono text-[11px] font-semibold">{o.ref}</span>
                    <span className="text-[11px]">{o.productName}</span>
                    <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>
                    <span className="text-[10px]" style={{ color: 'var(--danger)' }}>Unpaid</span>
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
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
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
            <div className="text-right text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>
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
              <button className="btn-outline text-[11px]" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
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
                <button className="text-[10px] px-2 py-1 rounded border text-t2 inline-flex items-center gap-1" style={{ borderColor: 'var(--border-lt)' }}
                  onClick={() => settlFileRef.current?.click()}><Fa icon={faFileImport} aria-hidden="true" /> Import Excel</button>
                <input ref={settlFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleSettlementUpload(e.target.files[0]) }} />
                <button className="text-[10px] px-2 py-1 rounded border text-t2" style={{ borderColor: 'var(--border-lt)' }}
                  onClick={() => setSettlLines(p => [...p, { kilimallRef: '', amount: '' }])}>+ Add Row</button>
              </div>
            </div>
            <div className="dt-scroll rounded-lg" style={{ border: '1px solid var(--border-lt)', maxHeight: 200 }}>
              <div className="min-w-[320px]">
              <div className="table-head" style={{ gridTemplateColumns: '1.5fr 120px 36px' }}>
                <span>Kilimall Order ID</span><span>Amount (KES)</span><span></span>
              </div>
              {settlLines.map((l, i) => (
                <div key={i} className="grid items-center px-3 py-1.5 gap-2" style={{ gridTemplateColumns: '1.5fr 120px 36px', borderBottom: '1px solid var(--bg-muted)' }}>
                  <input className="form-input text-[11px] py-1" value={l.kilimallRef}
                    onChange={e => setSettlLines(p => p.map((x, j) => j === i ? { ...x, kilimallRef: e.target.value } : x))}
                    placeholder="KLM-..." />
                  <input className="form-input text-[11px] py-1" value={l.amount} type="number"
                    onChange={e => setSettlLines(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                  <button type="button" className="text-[10px] text-red-400 hover:text-red-600 cursor-pointer"
                    onClick={() => setSettlLines(p => p.filter((_, j) => j !== i))} aria-label="Remove settlement line">✕</button>
                </div>
              ))}
              </div>
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
          <DataTable
            tableId="kilimall-settlement-lines"
            columns={[
              {
                key: 'kilimallRef', label: 'Kilimall Ref', priority: 1, width: '140px',
                render: (l: KilimallSettlementLine) => <span className="font-mono text-[10px]">{l.kilimallRef}</span>,
                exportValue: (l: KilimallSettlementLine) => l.kilimallRef,
              },
              {
                key: 'amount', label: 'Amount', priority: 1, width: '100px', align: 'right',
                render: (l: KilimallSettlementLine) => <span className="font-mono text-[11px]">{fmtKes(l.amount)}</span>,
                exportValue: (l: KilimallSettlementLine) => l.amount,
              },
              {
                key: 'status', label: 'Status', priority: 1, width: '80px',
                render: (l: KilimallSettlementLine) => (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded capitalize"
                    style={{
                      background: l.status === 'matched' ? 'var(--success-bg)' : 'var(--danger-bg)',
                      color: l.status === 'matched' ? 'var(--success)' : 'var(--danger)',
                    }}>
                    {l.status}
                  </span>
                ),
                exportValue: (l: KilimallSettlementLine) => l.status,
              },
            ] as ColumnDef<KilimallSettlementLine>[]}
            rows={viewSettlement.lines}
            rowKey={l => l.id}
            hideSearch
            emptyMessage="No settlement lines"
            perPage={50}
          />
          <div className="flex gap-2 justify-end mt-3">
            {viewSettlement.status !== 'reconciled' && (
              <button className="btn-primary text-[11px] inline-flex items-center gap-1.5" onClick={() => {
                reconcileKilimallSettlement(viewSettlement.id)
                setViewSettlement(null)
              }}><Fa icon={faArrowsRotate} aria-hidden="true" /> Run Reconciliation</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
