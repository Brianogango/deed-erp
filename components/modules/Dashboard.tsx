'use client'

import { useMemo, useCallback, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Legend,
} from 'recharts'
import {
  faMoneyBillWave,
  faArrowDown,
  faArrowUp,
  faFileInvoiceDollar,
  faBoxesStacked,
  faClipboardList,
  faScrewdriverWrench,
  faTriangleExclamation,
  faShieldHalved,
  faDesktop,
  faUsers,
  faMoneyCheckDollar,
  faArrowsRotate,
  faCartShopping,
  faCircleCheck,
} from '@fortawesome/free-solid-svg-icons'

import { useApp, fmtKes, fmtDate, ALL_CATEGORIES, ModuleId } from '@/lib/store'
import { Badge } from '@/components/ui'
import { formatRoleLabel } from '@/lib/auth/access'
import { Fa } from '@/components/icons'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const CATEGORY_COLORS: Record<string, string> = {
  Laptops: '#1B2762',
  Desktops: '#00B0D7',
  'Parts & Components': '#2563EB',
  Accessories: '#0891B2',
  Printers: '#059669',
  Networking: '#D97706',
  Services: '#DC2626',
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * KPI Card Component
 * Displays a key performance indicator with an icon and trend
 */
function KpiCard({
  label,
  value,
  sub,
  color,
  icon,
  onClick,
  isCurrency,
}: {
  label: string
  value: string | number
  sub: string
  color: string
  icon: React.ReactNode
  onClick?: () => void
  isCurrency?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="
        card text-left w-full flex flex-col justify-between
        p-4 sm:p-5 transition-all duration-200
        hover:shadow-lg hover:-translate-y-0.5
        min-h-[110px] relative overflow-hidden
      "
      style={{
        cursor: onClick ? 'pointer' : 'default',
        borderTop: `3px solid ${color}`,
      }}
    >
      <div className="flex items-start justify-between gap-3 w-full mb-3">
        <p className="text-[10px] font-bold tracking-wider uppercase text-[var(--text-3)] leading-tight flex-1">
          {label}
        </p>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: color + '15', color }}
        >
          <span className="text-sm">{icon}</span>
        </div>
      </div>
      <div className="mt-auto w-full">
        <p
          className={`
            text-xl sm:text-2xl font-extrabold leading-none mb-1.5 truncate
            ${isCurrency ? 'font-mono tracking-tight' : ''}
          `}
          style={{ color }}
        >
          {isCurrency && typeof value === 'number' ? fmtKes(value) : value}
        </p>
        <p className="text-[11px] text-[var(--text-4)] leading-snug line-clamp-2 sm:truncate">
          {sub}
        </p>
      </div>
    </button>
  )
}

/**
 * Card Header Component
 */
function CardHeader({
  title,
  sub,
  action,
}: {
  title: string
  sub?: string
  action?: React.ReactNode
}) {
  return (
    <div className="
      flex flex-col sm:flex-row sm:items-center justify-between
      px-4 sm:px-5 py-3.5 border-b border-[var(--border-lt)]
      gap-2 sm:gap-0
    ">
      <div className="min-w-0 pr-2">
        <p className="text-xs font-bold text-[var(--text-1)] truncate">{title}</p>
        {sub && <p className="text-[10px] text-[var(--text-3)] mt-0.5 truncate">{sub}</p>}
      </div>
      {action && <div className="flex-shrink-0 self-start sm:self-auto">{action}</div>}
    </div>
  )
}

/**
 * Section Label Component
 */
function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-2">
      <span className="w-0.5 h-3 bg-primary-500 rounded-full inline-block flex-shrink-0" />
      <p className="text-[9px] font-bold tracking-[1.1px] uppercase text-[var(--text-4)]">
        {label}
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function Dashboard() {
  const {
    saleOrders,
    invoices,
    products,
    repairs,
    purchaseOrders,
    warranties,
    posOrders,
    contacts,
    setModule,
    employees,
    leaveRequests,
    users,
    expenses,
    outsourceJobs,
    refurbishmentJobs,
    currentUserId,
    profileImages,
    payrollRuns,
    receipts,
    stockTransfers,
    kilimallOrders,
    companySettings,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const role = currentUser?.role ?? 'sales_rep'

  const router = useRouter()
  const handleNav = (mod: Parameters<typeof setModule>[0], path: string) => {
    setModule(mod)
    router.push(path)
  }

  // Memoize static role access checks
  const myModules = useMemo(() => new Set(currentUser?.modules ?? []), [currentUser?.modules])
  const has = useCallback((m: ModuleId) => myModules.has(m), [myModules])

  const isAdmin = role === 'admin'
  const isFinance = role === 'finance'
  const isSales = role === 'sales_rep'
  const isLead = role === 'lead_tech'
  const isTech = role === 'repair_tech'

  // ── Optimized Single-Pass Memos ────────────────────────────────────────────

  const {
    myRepairs,
    activeRepairs,
    openRepairs,
    myActiveJobs,
    awaitingParts,
    inQc,
    myCompleted,
    urgentRepairs,
    unassignedRep,
  } = useMemo(() => {
    const myReps: typeof repairs = []
    const actReps: typeof repairs = []
    let myActive = 0,
      waitParts = 0,
      qc = 0,
      myComp = 0
    const urgent: typeof repairs = []
    const unassigned: typeof repairs = []

    for (const r of repairs) {
      const isMine = r.assignedTechnicianId === currentUserId
      if (!isTech || isMine) myReps.push(r)

      const isActive = !['closed', 'cancelled', 'delivered', 'invoiced'].includes(r.status)
      if (isActive && (!isTech || isMine)) actReps.push(r)

      if (isActive && isMine) myActive++
      if (r.status === 'awaiting_parts') waitParts++
      if (r.status === 'qc') qc++
      if (isMine && r.status === 'ready') myComp++

      if (isActive && (r.status === 'diagnosed' || r.status === 'approved')) urgent.push(r)
      if (r.status === 'received' && !r.assignedTechnicianId) unassigned.push(r)
    }
    return {
      myRepairs: myReps,
      activeRepairs: actReps,
      openRepairs: actReps.length,
      myActiveJobs: myActive,
      awaitingParts: waitParts,
      inQc: qc,
      myCompleted: myComp,
      urgentRepairs: urgent,
      unassignedRep: unassigned,
    }
  }, [repairs, isTech, currentUserId])

  const { revenue, outstanding, payables, overdueInv, pendingBills } = useMemo(() => {
    let rev = 0,
      out = 0,
      pay = 0
    const overdue: typeof invoices = []
    const pendingB: typeof invoices = []

    for (const i of invoices) {
      if (i.type === 'customer_invoice') {
        if (i.status === 'paid') rev += i.total
        else if (i.status === 'posted' || i.status === 'overdue') {
          out += i.total - i.amountPaid
          if (i.status === 'overdue') overdue.push(i)
        }
      } else if (i.type === 'vendor_bill') {
        if (i.status === 'posted' || i.status === 'overdue') {
          pay += i.total - i.amountPaid
          if (i.status === 'posted') pendingB.push(i)
        }
      }
    }
    return { revenue: rev, outstanding: out, payables: pay, overdueInv: overdue, pendingBills: pendingB }
  }, [invoices])

  const { stockValue, lowStock, categoryData, stockHealthData } = useMemo(() => {
    let totalStockValue = 0
    let lowStockCount = 0
    const catMap = new Map<string, { count: number; value: number; stock: number }>()
    const healthMap = new Map<string, { onHand: number; reorder: number }>()

    for (const cat of ALL_CATEGORIES) {
      catMap.set(cat, { count: 0, value: 0, stock: 0 })
      healthMap.set(cat, { onHand: 0, reorder: 0 })
    }

    for (const p of products) {
      totalStockValue += p.costPrice * p.stockQty
      if (p.stockQty <= p.minStock && p.minStock > 0 && p.unit !== 'service') lowStockCount++

      if (!p.isActive) continue
      const c = catMap.get(p.category)
      if (c) {
        c.count++
        c.value += p.costPrice * p.stockQty
        c.stock += p.stockQty
      }

      if (p.unit !== 'service') {
        const h = healthMap.get(p.category)
        if (h) {
          h.onHand += p.stockQty
          h.reorder += p.minStock
        }
      }
    }

    const cd = ALL_CATEGORIES.map(cat => {
      const data = catMap.get(cat)!
      return {
        name: cat.length > 14 ? cat.slice(0, 13) + '…' : cat,
        full: cat,
        count: data.count,
        value: data.value,
        stock: data.stock,
        color: CATEGORY_COLORS[cat] ?? '#6B7280',
      }
    }).filter(d => d.count > 0)

    const shd = ALL_CATEGORIES.map(cat => {
      const data = healthMap.get(cat)!
      return {
        name: cat.length > 10 ? cat.slice(0, 9) + '…' : cat,
        onHand: data.onHand,
        reorder: data.reorder,
        color: CATEGORY_COLORS[cat] ?? '#6B7280',
      }
    }).filter(d => d.onHand > 0 || d.reorder > 0)

    return { stockValue: totalStockValue, lowStock: lowStockCount, categoryData: cd, stockHealthData: shd }
  }, [products])

  const { pendingQuotes, myQuotes, myWon, pipeline, maxPipelineValue } = useMemo(() => {
    let pQuotes = 0
    const myQ: typeof saleOrders = []
    const myW: typeof saleOrders = []
    let qCount = 0,
      qVal = 0,
      cCount = 0,
      cVal = 0,
      dCount = 0,
      dVal = 0,
      iCount = 0,
      iVal = 0

    for (const s of saleOrders) {
      const isMine = s.createdByUserId === currentUserId

      if (s.status === 'quotation') {
        pQuotes++
        if (isMine) myQ.push(s)
      } else if (s.status === 'confirmed') {
        if (isMine) myW.push(s)
      }

      if (s.status === 'cancelled') continue

      if (s.status === 'quotation') {
        qCount++
        qVal += s.total
      } else if (s.status === 'confirmed') {
        cCount++
        cVal += s.total
      } else if (s.status === 'delivered') {
        dCount++
        dVal += s.total
      } else if (s.status === 'invoiced') {
        iCount++
        iVal += s.total
      }
    }

    const p = [
      { stage: 'Quotation', count: qCount, value: qVal, color: '#F59E0B' },
      { stage: 'Confirmed', count: cCount, value: cVal, color: '#3B82F6' },
      { stage: 'Delivered', count: dCount, value: dVal, color: '#8B5CF6' },
      { stage: 'Invoiced', count: iCount, value: iVal, color: '#10B981' },
    ]

    return {
      pendingQuotes: pQuotes,
      myQuotes: myQ,
      myWon: myW,
      pipeline: p,
      maxPipelineValue: Math.max(...p.map(s => s.value), 1),
    }
  }, [saleOrders, currentUserId])

  const { activeWarranties, expiringWarranties } = useMemo(() => {
    let active = 0,
      expiring = 0
    for (const w of warranties) {
      if (w.status === 'active') active++
      else if (w.status === 'expiring') expiring++
    }
    return { activeWarranties: active, expiringWarranties: expiring }
  }, [warranties])

  const { myLeaves, pendingLeave, activeEmployees } = useMemo(() => {
    let pLeave = 0,
      actEmp = 0
    const myLvs: typeof leaveRequests = []

    let myEmpId: string | undefined
    for (const e of employees) {
      if (e.status === 'active') actEmp++
      if (e.userId === currentUserId) myEmpId = e.id
    }

    for (const r of leaveRequests) {
      if (r.employeeId === myEmpId) myLvs.push(r)
      if (isAdmin) {
        if (r.status === 'pending_hr') pLeave++
      } else {
        if (r.employeeId === myEmpId && r.status === 'pending_hr') pLeave++
      }
    }
    return { myLeaves: myLvs, pendingLeave: pLeave, activeEmployees: actEmp }
  }, [leaveRequests, employees, currentUserId, isAdmin])

  const { posToday, pendingPayroll, refurbQueued, myExpenses } = useMemo(() => {
    let pos = 0,
      pp = 0
    const rq: typeof refurbishmentJobs = []
    const me: typeof expenses = []

    for (const o of posOrders) pos += o.total
    for (const r of payrollRuns) if (r.status === 'pending_approval') pp++
    for (const j of refurbishmentJobs) if (j.status === 'queued') rq.push(j)
    for (const e of expenses) if (e.submittedByUserId === currentUserId) me.push(e)

    return { posToday: pos, pendingPayroll: pp, refurbQueued: rq, myExpenses: me }
  }, [posOrders, payrollRuns, refurbishmentJobs, expenses, currentUserId])

  const activity = useMemo(() => {
    const list: { title: string; sub: string; time: string; color: string; icon: string }[] = []
    const now = new Date()

    // Recent Invoices
    invoices
      .filter(i => i.type === 'customer_invoice')
      .slice(-3)
      .forEach(i => {
        list.push({
          title: `Invoice ${i.ref}`,
          sub: `${i.partnerName} · ${fmtKes(i.total)}`,
          time: fmtDate(i.date),
          color: '#10B981',
          icon: '🧾',
        })
      })

    // Recent Repairs
    repairs.slice(-3).forEach(r => {
      list.push({
        title: `Repair ${r.ref}`,
        sub: `${r.customerName} · ${r.productName}`,
        time: fmtDate(r.intakeDate),
        color: '#3B82F6',
        icon: '🔧',
      })
    })

    // Recent Sales
    saleOrders.slice(-3).forEach(s => {
      list.push({
        title: `Order ${s.ref}`,
        sub: `${s.customerName} · ${fmtKes(s.total)}`,
        time: fmtDate(s.date),
        color: '#8B5CF6',
        icon: '💼',
      })
    })

    return list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6)
  }, [invoices, repairs, saleOrders])

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* ── Welcome Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="
            w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-primary-500/10
            flex items-center justify-center text-primary-600
            text-xl sm:text-2xl font-bold border border-primary-500/20
          ">
            {currentUser?.name?.slice(0, 1).toUpperCase() || '?'}
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-[var(--text-1)]">
              Welcome back, {currentUser?.name?.split(' ')[0]}!
            </h1>
            <p className="text-xs text-[var(--text-3)]">
              {formatRoleLabel(role)} · {new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleNav('pos', '/pos')}
            className="
              flex-1 sm:flex-none px-4 py-2 rounded-xl bg-primary-500
              hover:bg-primary-600 text-white text-xs font-bold
              transition-all shadow-lg shadow-primary-500/20
              flex items-center justify-center gap-2
            "
          >
            <Fa icon={faCartShopping} />
            <span>New Sale</span>
          </button>
        </div>
      </div>

      {/* ── KPI Grid ───────────────────────────────────────────────────────── */}
      <SectionLabel label="Key Performance Indicators" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isAdmin || isFinance ? (
          <>
            <KpiCard
              label="Revenue (Paid)"
              value={revenue}
              sub="Total collected this period"
              color="#10B981"
              icon={<Fa icon={faMoneyBillWave} />}
              isCurrency
              onClick={() => handleNav('accounting', '/finance?tab=invoices')}
            />
            <KpiCard
              label="Outstanding"
              value={outstanding}
              sub={`${overdueInv.length} invoices overdue`}
              color="#F59E0B"
              icon={<Fa icon={faArrowDown} />}
              isCurrency
              onClick={() => handleNav('accounting', '/finance?tab=invoices')}
            />
            <KpiCard
              label="Payables"
              value={payables}
              sub={`${pendingBills.length} bills pending`}
              color="#EF4444"
              icon={<Fa icon={faArrowUp} />}
              isCurrency
              onClick={() => handleNav('accounting', '/finance?tab=bills')}
            />
            <KpiCard
              label="POS Today"
              value={posToday}
              sub="Direct counter sales"
              color="#0891B2"
              icon={<Fa icon={faDesktop} />}
              isCurrency
              onClick={() => handleNav('pos', '/pos')}
            />
          </>
        ) : isTech || isLead ? (
          <>
            <KpiCard
              label="My Active Jobs"
              value={myActiveJobs}
              sub="Repairs currently assigned"
              color="#3B82F6"
              icon={<Fa icon={faScrewdriverWrench} />}
              onClick={() => handleNav('repair', '/repairs')}
            />
            <KpiCard
              label="Awaiting Parts"
              value={awaitingParts}
              sub="Pending procurement"
              color="#F59E0B"
              icon={<Fa icon={faBoxesStacked} />}
              onClick={() => handleNav('repair', '/repairs')}
            />
            <KpiCard
              label="In QC"
              value={inQc}
              sub="Ready for final check"
              color="#8B5CF6"
              icon={<Fa icon={faCircleCheck} />}
              onClick={() => handleNav('repair', '/repairs')}
            />
            <KpiCard
              label="My Completed"
              value={myCompleted}
              sub="Ready for delivery"
              color="#10B981"
              icon={<Fa icon={faShieldHalved} />}
              onClick={() => handleNav('repair', '/repairs')}
            />
          </>
        ) : (
          <>
            <KpiCard
              label="My Quotes"
              value={myQuotes.length}
              sub="Active quotations"
              color="#3B82F6"
              icon={<Fa icon={faClipboardList} />}
              onClick={() => handleNav('sales', '/sales')}
            />
            <KpiCard
              label="Won Orders"
              value={myWon.length}
              sub="Confirmed this month"
              color="#10B981"
              icon={<Fa icon={faCircleCheck} />}
              onClick={() => handleNav('sales', '/sales')}
            />
            <KpiCard
              label="Active Repairs"
              value={activeRepairs.length}
              sub="Total in workshop"
              color="#F59E0B"
              icon={<Fa icon={faScrewdriverWrench} />}
              onClick={() => handleNav('repair', '/repairs')}
            />
            <KpiCard
              label="My Expenses"
              value={myExpenses.length}
              sub="Submitted claims"
              color="#0891B2"
              icon={<Fa icon={faMoneyCheckDollar} />}
              onClick={() => handleNav('accounting', '/finance')}
            />
          </>
        )}
      </div>

      {/* ── Charts & Pipeline ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Pipeline */}
        <div className="card overflow-hidden lg:col-span-2">
          <CardHeader title="Sales Pipeline" sub={`${saleOrders.length} total orders`} />
          <div className="p-5 flex flex-col gap-5">
            {pipeline.map(s => (
              <div key={s.stage} className="group">
                <div className="flex justify-between mb-2 text-[11px]">
                  <span className="text-[var(--text-2)] font-bold">{s.stage}</span>
                  <div className="flex gap-4">
                    <span className="text-[var(--text-4)]">{s.count} orders</span>
                    <span className="font-bold" style={{ color: s.color }}>{fmtKes(s.value)}</span>
                  </div>
                </div>
                <div className="h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.min(100, (s.value / maxPipelineValue) * 100)}%`,
                      background: s.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stock Health */}
        <div className="card overflow-hidden">
          <CardHeader title="Stock Health" sub="Low stock alerts" />
          <div className="p-4 flex flex-col gap-3">
            {products
              .filter(p => p.stockQty <= p.minStock && p.minStock > 0 && p.unit !== 'service')
              .slice(0, 5)
              .map(p => {
                const isOut = p.stockQty === 0
                return (
                  <div
                    key={p.id}
                    className={`
                      flex items-center justify-between p-3 rounded-xl border
                      ${isOut ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}
                    `}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl">{p.image || '📦'}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[var(--text-1)] truncate">{p.name}</p>
                        <p className="text-[10px] text-[var(--text-3)] truncate">{p.category}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-mono text-[var(--text-2)]">
                        {p.stockQty}/{p.minStock}
                      </span>
                      <span
                        className={`
                          text-[9px] font-bold px-2 py-0.5 rounded-full
                          ${isOut ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}
                        `}
                      >
                        {isOut ? 'OUT' : 'LOW'}
                      </span>
                    </div>
                  </div>
                )
              })}
            {products.filter(p => p.stockQty <= p.minStock && p.minStock > 0 && p.unit !== 'service').length === 0 && (
              <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xl">
                  <Fa icon={faCircleCheck} />
                </div>
                <div>
                  <p className="text-xs font-bold text-[var(--text-1)]">All Healthy</p>
                  <p className="text-[10px] text-[var(--text-3)]">Stock levels are optimal</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Activity & HR ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="card overflow-hidden">
          <CardHeader title="Recent Activity" />
          <div className="divide-y divide-[var(--border-lt)]">
            {activity.map((a, i) => (
              <div key={i} className="flex items-start gap-4 p-4 hover:bg-[var(--bg-surface)] transition-colors">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: a.color + '15', color: a.color }}
                >
                  {a.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-[var(--text-1)] truncate">{a.title}</p>
                  <p className="text-[10px] text-[var(--text-3)] mt-0.5">{a.sub}</p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className="text-[10px] text-[var(--text-4)]">{a.time}</span>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* HR Snapshot */}
        {has('hr') && (
          <div className="card overflow-hidden">
            <CardHeader
              title={isAdmin ? 'HR Snapshot' : 'My Leave'}
              action={
                <button
                  onClick={() => handleNav('hr', '/hr')}
                  className="text-[10px] font-bold text-primary-600 hover:underline"
                >
                  View HR →
                </button>
              }
            />
            <div className="p-5">
              {isAdmin ? (
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Employees', value: activeEmployees, color: '#0891B2', icon: '👥' },
                    { label: 'Leave Pending', value: pendingLeave, color: '#F59E0B', icon: '🌴' },
                    { label: 'Active Users', value: users.filter(u => u.active).length, color: '#10B981', icon: '🔑' },
                  ].map(stat => (
                    <div
                      key={stat.label}
                      className="flex flex-col items-center p-4 rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)]"
                    >
                      <span className="text-2xl mb-2">{stat.icon}</span>
                      <span className="text-xl font-extrabold" style={{ color: stat.color }}>
                        {stat.value}
                      </span>
                      <span className="text-[9px] font-bold text-[var(--text-4)] uppercase tracking-wider mt-1 text-center">
                        {stat.label}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {myLeaves.slice(0, 4).map(l => (
                    <div
                      key={l.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-lt)]"
                    >
                      <span className="text-xs font-bold text-[var(--text-2)] capitalize">
                        {l.leaveType.replace(/_/g, ' ')}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-[var(--text-4)] font-mono">{l.days} days</span>
                        <Badge
                          status={
                            l.status === 'approved' ? 'active' : l.status === 'rejected' ? 'cancelled' : 'pending'
                          }
                          label={l.status.replace('_', ' ')}
                        />
                      </div>
                    </div>
                  ))}
                  {myLeaves.length === 0 && (
                    <div className="py-10 text-center">
                      <p className="text-xs text-[var(--text-4)]">No leave requests yet</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Inventory Value ────────────────────────────────────────────────── */}
      {(isAdmin || isFinance || isLead) && (
        <div className="card overflow-hidden">
          <CardHeader title="Inventory Value" sub="Cost-basis stock value across all locations" />
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {ALL_CATEGORIES.map(cat => {
              const prods = products.filter(p => p.category === cat && p.isActive)
              const val = prods.reduce((a, p) => a + p.costPrice * p.stockQty, 0)
              const qty = prods.reduce((a, p) => a + p.stockQty, 0)
              const color = CATEGORY_COLORS[cat] ?? '#6B7280'
              return (
                <div
                  key={cat}
                  className="flex flex-col gap-2 p-4 rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)]"
                >
                  <p className="text-[9px] font-bold uppercase tracking-wider truncate" style={{ color }}>
                    {cat}
                  </p>
                  <p className="text-sm font-extrabold text-[var(--text-1)]">{fmtKes(val)}</p>
                  <p className="text-[9px] text-[var(--text-4)]">
                    {prods.length} items · {qty} units
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
