'use client'
import { useMemo, useCallback, useState, useEffect } from 'react'
import { useApp, fmtKes, fmtDate, ALL_CATEGORIES, ModuleId } from '@/lib/store'
import { Badge } from '@/components/ui'
import { formatRoleLabel } from '@/lib/auth/access'
import { Fa } from '@/components/icons'
import {
  faMoneyBillWave, faArrowDown, faArrowUp, faFileInvoiceDollar,
  faBoxesStacked, faClipboardList, faScrewdriverWrench, faTriangleExclamation,
  faShieldHalved, faDesktop, faUsers, faMoneyCheckDollar, faArrowsRotate, faCartShopping,
} from '@fortawesome/free-solid-svg-icons'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend,
} from 'recharts'
import { useRouter } from 'next/navigation'

const CATEGORY_COLORS: Record<string, string> = {
  Laptops:              '#1B2762',
  Desktops:             '#00B0D7',
  'Parts & Components': '#2563EB',
  Accessories:          '#0891B2',
  Printers:             '#059669',
  Networking:           '#D97706',
  Services:             '#DC2626',
}

// ── KPI card — top accent bar, bold value ────────────────────────────────────
function KpiCard({
  label, value, sub, color, icon, onClick, isCurrency,
}: {
  label: string; value: string | number; sub: string
  color: string; icon: React.ReactNode; onClick?: () => void; isCurrency?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="card text-left w-full flex flex-col justify-between"
      style={{
        padding: '16px 20px',
        cursor: onClick ? 'pointer' : 'default',
        borderTop: `3px solid ${color}`,
        borderRadius: 14,
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        position: 'relative',
        overflow: 'hidden',
        minHeight: '110px'
      }}
      onMouseOver={e => {
        if (!onClick) return
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = `0 8px 24px ${color}20`
        el.style.transform = 'translateY(-2px)'
      }}
      onMouseOut={e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'
        el.style.transform = 'translateY(0)'
      }}
    >
      <div className="flex items-start justify-between gap-3 w-full mb-3">
        <p className="text-[10px] font-bold tracking-wider uppercase text-gray-500 leading-tight flex-1">{label}</p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color + '15', color }}>
          <span className="text-sm">{icon}</span>
        </div>
      </div>
      <div className="mt-auto w-full">
        <p className={`text-2xl font-extrabold leading-none mb-1.5 truncate ${isCurrency ? 'font-mono tracking-tight' : ''}`} style={{ color }}>
          {isCurrency && typeof value === 'number' ? fmtKes(value) : value}
        </p>
        <p className="text-[11px] text-gray-400 leading-snug line-clamp-2 sm:truncate">{sub}</p>
      </div>
    </button>
  )
}

// ── Card header ───────────────────────────────────────────────────────────────
function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3.5 border-b gap-2 sm:gap-0" style={{ borderColor: '#F3F4F6' }}>
      <div className="min-w-0 pr-2">
        <p className="truncate" style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{title}</p>
        {sub && <p className="truncate" style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>{sub}</p>}
      </div>
      {action && <div className="flex-shrink-0 self-start sm:self-auto">{action}</div>}
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 3, height: 13, background: '#1B2762', borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', color: '#9CA3AF' }}>{label}</p>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const {
    saleOrders, invoices, products, repairs, purchaseOrders,
    warranties, posOrders, contacts, setModule,
    employees, leaveRequests, users,
    expenses, outsourceJobs, refurbishmentJobs,
    currentUserId, profileImages, payrollRuns,
    receipts, stockTransfers, kilimallOrders,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const role        = currentUser?.role ?? 'sales_rep'
  
  const router = useRouter()
  const handleNav = (mod: Parameters<typeof setModule>[0], path: string) => {
    setModule(mod)
    router.push(path)
  }

  // Memoize static role access checks
  const myModules = useMemo(() => new Set(currentUser?.modules ?? []), [currentUser?.modules])
  const has       = useCallback((m: ModuleId) => myModules.has(m), [myModules])

  const isAdmin   = role === 'director' || role === 'admin_officer'
  const isFinance = role === 'director' || role === 'finance_officer'
  const isSales   = role === 'sales_rep'
  const isLead    = role === 'lead_tech'
  const isTech    = role === 'technician'
  const isInventory = role === 'inventory_officer'
  const isKilimall  = role === 'kilimall_officer'

  const avatar   = currentUserId ? (profileImages[currentUserId] ?? null) : null
  const initials = (currentUser?.name ?? '??').slice(0, 2).toUpperCase()

  // ── Optimized Single-Pass Memos ────────────────────────────────────────────

  const { myRepairs, activeRepairs, openRepairs, myActiveJobs, awaitingParts, inQc, myCompleted, urgentRepairs, unassignedRep } = useMemo(() => {
    const myReps: typeof repairs = []
    const actReps: typeof repairs = []
    let myActive = 0, waitParts = 0, qc = 0, myComp = 0
    const urgent: typeof repairs = []
    const unassigned: typeof repairs = []

    for (const r of repairs) {
      const isMine = r.assignedTechnicianId === currentUserId
      if (!isTech || isMine) myReps.push(r)

      const isActive = !['closed','cancelled','delivered','invoiced'].includes(r.status)
      if (isActive && (!isTech || isMine)) actReps.push(r)

      if (isActive && isMine) myActive++
      if (r.status === 'awaiting_parts') waitParts++
      if (r.status === 'qc') qc++
      if (isMine && r.status === 'ready') myComp++

      if (isActive && (r.status === 'diagnosed' || r.status === 'approved')) urgent.push(r)
      if (r.status === 'received' && !r.assignedTechnicianId) unassigned.push(r)
    }
    return { myRepairs: myReps, activeRepairs: actReps, openRepairs: actReps.length, myActiveJobs: myActive, awaitingParts: waitParts, inQc: qc, myCompleted: myComp, urgentRepairs: urgent, unassignedRep: unassigned }
  }, [repairs, isTech, currentUserId])

  const { revenue, outstanding, payables, overdueInv, pendingBills } = useMemo(() => {
    let rev = 0, out = 0, pay = 0
    const overdue: typeof invoices = []
    const pendingB: typeof invoices = []

    for (const i of invoices) {
      if (i.type === 'customer_invoice') {
        if (i.status === 'paid') rev += i.total
        else if (i.status === 'posted' || i.status === 'overdue') {
          out += (i.total - i.amountPaid)
          if (i.status === 'overdue') overdue.push(i)
        }
      } else if (i.type === 'vendor_bill') {
        if (i.status === 'posted' || i.status === 'overdue') {
          pay += (i.total - i.amountPaid)
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
      return { name: cat.length > 14 ? cat.slice(0,13)+'…' : cat, full: cat, count: data.count, value: data.value, stock: data.stock, color: CATEGORY_COLORS[cat] ?? '#6B7280' }
    }).filter(d => d.count > 0)

    const shd = ALL_CATEGORIES.map(cat => {
      const data = healthMap.get(cat)!
      return { name: cat.length > 10 ? cat.slice(0,9)+'…' : cat, onHand: data.onHand, reorder: data.reorder, color: CATEGORY_COLORS[cat] ?? '#6B7280' }
    }).filter(d => d.onHand > 0 || d.reorder > 0)

    return { stockValue: totalStockValue, lowStock: lowStockCount, categoryData: cd, stockHealthData: shd }
  }, [products])

  const { pendingQuotes, myQuotes, myWon, pipeline, maxPipelineValue } = useMemo(() => {
    let pQuotes = 0
    const myQ: typeof saleOrders = []
    const myW: typeof saleOrders = []
    let qCount = 0, qVal = 0, cCount = 0, cVal = 0, dCount = 0, dVal = 0, iCount = 0, iVal = 0

    for (const s of saleOrders) {
      const isMine = s.createdByUserId === currentUserId

      if (s.status === 'quotation') {
        pQuotes++
        if (isMine) myQ.push(s)
      } else if (s.status === 'confirmed') {
        if (isMine) myW.push(s)
      }

      if (s.status === 'cancelled') continue

      if (s.status === 'quotation') { qCount++; qVal += s.total }
      else if (s.status === 'confirmed') { cCount++; cVal += s.total }
      else if (s.status === 'delivered') { dCount++; dVal += s.total }
      else if (s.status === 'invoiced') { iCount++; iVal += s.total }
    }
    
    const p = [
      { stage: 'Quotation', count: qCount, value: qVal, color: '#F59E0B' },
      { stage: 'Confirmed', count: cCount, value: cVal, color: '#3B82F6' },
      { stage: 'Delivered', count: dCount, value: dVal, color: '#8B5CF6' },
      { stage: 'Invoiced',  count: iCount, value: iVal, color: '#10B981' },
    ]

    return { pendingQuotes: pQuotes, myQuotes: myQ, myWon: myW, pipeline: p, maxPipelineValue: Math.max(...p.map(s => s.value), 1) }
  }, [saleOrders, currentUserId])

  const { activeWarranties, expiringWarranties } = useMemo(() => {
    let active = 0, expiring = 0
    for (const w of warranties) {
      if (w.status === 'active') active++
      else if (w.status === 'expiring') expiring++
    }
    return { activeWarranties: active, expiringWarranties: expiring }
  }, [warranties])

  const { myLeaves, pendingLeave, activeEmployees } = useMemo(() => {
    let pLeave = 0, actEmp = 0
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
    let pos = 0, pp = 0
    const rq: typeof refurbishmentJobs = []
    const me: typeof expenses = []

    for (const o of posOrders) pos += o.total
    for (const r of payrollRuns) if (r.status === 'pending_approval') pp++
    for (const j of refurbishmentJobs) {
      if (isTech) {
        if (j.assignedTechnicianId === currentUserId && j.status !== 'transferred') rq.push(j)
      } else {
        if (j.status === 'queued') rq.push(j)
      }
    }
    for (const e of expenses) if (e.submittedByUserId === currentUserId) me.push(e)

    return { posToday: pos, pendingPayroll: pp, refurbQueued: rq, myExpenses: me }
  }, [posOrders, payrollRuns, refurbishmentJobs, expenses, isTech, currentUserId])

  const { pendingGRNs, pendingTransfers, kiliPending, kiliUnreconciled } = useMemo(() => {
    let pGRN = 0, pTrans = 0, kPend = 0, kUnrec = 0
    for (const r of receipts) if (r.status === 'draft') pGRN++
    for (const t of stockTransfers) if (t.status === 'draft') pTrans++
    for (const o of kilimallOrders) {
      if (o.status === 'pending') kPend++
      if (o.status === 'delivered' && !o.settlementId) kUnrec++
    }
    return { pendingGRNs: pGRN, pendingTransfers: pTrans, kiliPending: kPend, kiliUnreconciled: kUnrec }
  }, [receipts, stockTransfers, kilimallOrders])

  // ── Charts data (Memoized) ─────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const data = []
    const today = new Date()
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const day = d.toLocaleDateString('en-KE', { weekday: 'short' })
      
      let sales = 0
      for (const o of saleOrders) {
        if (o.date === dateStr && ['confirmed', 'delivered', 'invoiced'].includes(o.status)) sales += o.total
      }
      for (const p of posOrders) {
        if (p.date === dateStr) sales += p.total
      }

      let purchases = 0
      for (const po of purchaseOrders) {
        if (po.date === dateStr && !['draft', 'cancelled'].includes(po.status)) purchases += po.total
      }
      
      data.push({ day, sales, purchases })
    }
    return data
  }, [saleOrders, posOrders, purchaseOrders])

  // ── Recent activity (Memoized) ─────────────────────────────────────────────
  type ActivityItem = { icon: string; title: string; sub: string; time: string; color: string }
  const activity: ActivityItem[] = useMemo(() => [
    ...(has('sales')     ? saleOrders.slice(0,2).map(so => ({ icon:'💼', title:`${so.ref} — ${so.customerName}`, sub:`${fmtKes(so.total)} · ${so.status}`, time:fmtDate(so.date), color:'#8B5CF6' })) : []),
    ...(has('accounting')? invoices.filter(i=>i.type==='customer_invoice').slice(0,2).map(i=>({ icon:'🧾', title:`${i.ref} — ${i.partnerName}`, sub:`${fmtKes(i.total)} · ${i.status}`, time:fmtDate(i.date), color:'#10B981' })) : []),
    ...(has('repair')    ? myRepairs.slice(0,3).map(r=>({ icon:'🔧', title:`${r.ref} — ${r.productName}`, sub:`${r.customerName} · ${r.status.replace(/_/g,' ')}`, time:fmtDate(r.date), color:'#EF4444' })) : []),
    ...(has('purchase')  ? purchaseOrders.slice(0,1).map(po=>({ icon:'🛒', title:`${po.ref} — ${po.vendorName}`, sub:`${fmtKes(po.total)} · ${po.status}`, time:fmtDate(po.date), color:'#F79009' })) : []),
    ...(has('pos')       ? posOrders.slice(0,1).map(p=>({ icon:'🖥️', title:`POS — ${p.ref}`, sub:`${fmtKes(p.total)} · ${p.payment}`, time:fmtDate(p.date), color:'#EC4899' })) : []),
  ].slice(0, 8), [saleOrders, invoices, myRepairs, purchaseOrders, posOrders, has])

  // ── Customizable KPI Grid Logic ────────────────────────────────────────────
  const [kpiOrder, setKpiOrder] = useState<string[]>([])
  const [isEditingKpis, setIsEditingKpis] = useState(false)
  const [draggedKpi, setDraggedKpi] = useState<string | null>(null)

  const allKpis = useMemo(() => {
    const kpis: { id: string, label: string, value: string | number, isCurrency?: boolean, sub: string, color: string, icon: React.ReactNode, onClick: () => void }[] = []
    if (isAdmin) {
      kpis.push({ id: 'admin_rev', label: 'Revenue Collected', value: revenue, isCurrency: true, sub: 'from paid invoices', color: '#10B981', icon: <Fa icon={faMoneyBillWave} />, onClick: () => handleNav('accounting', '/finance') })
      kpis.push({ id: 'admin_out', label: 'Outstanding', value: outstanding, isCurrency: true, sub: 'receivables due', color: '#F59E0B', icon: <Fa icon={faArrowDown} />, onClick: () => handleNav('accounting', '/finance') })
      kpis.push({ id: 'admin_stock', label: 'Stock Value', value: stockValue, isCurrency: true, sub: 'cost basis on hand', color: '#1B2762', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('inventory', '/operations') })
      kpis.push({ id: 'admin_rep', label: 'Active Repairs', value: openRepairs, sub: 'system-wide', color: '#F97316', icon: <Fa icon={faScrewdriverWrench} />, onClick: () => handleNav('repair', '/repairs') })
    }
    if (isFinance) {
      kpis.push({ id: 'fin_ar', label: 'Outstanding AR', value: outstanding, isCurrency: true, sub: 'receivables due', color: '#F59E0B', icon: <Fa icon={faArrowDown} />, onClick: () => handleNav('accounting', '/finance') })
      kpis.push({ id: 'fin_ap', label: 'Payables AP', value: payables, isCurrency: true, sub: 'to vendors', color: '#EF4444', icon: <Fa icon={faArrowUp} />, onClick: () => handleNav('accounting', '/finance') })
      kpis.push({ id: 'fin_bills', label: 'Pending Bills', value: pendingBills.length, sub: overdueInv.length > 0 ? `${overdueInv.length} overdue!` : 'all current', color: overdueInv.length > 0 ? '#EF4444' : '#1B2762', icon: <Fa icon={faFileInvoiceDollar} />, onClick: () => handleNav('accounting', '/finance') })
      kpis.push({ id: 'fin_pay', label: 'Payroll Pending', value: pendingPayroll, sub: 'awaiting approval', color: '#8B5CF6', icon: <Fa icon={faUsers} />, onClick: () => handleNav('hr', '/hr') })
    }
    if (isSales) {
      kpis.push({ id: 'sales_quotes', label: 'My Open Quotes', value: myQuotes.length, sub: fmtKes(myQuotes.reduce((a, q) => a + q.total, 0)), color: '#3B82F6', icon: <Fa icon={faClipboardList} />, onClick: () => handleNav('sales', '/sales') })
      kpis.push({ id: 'sales_won', label: 'My Won Deals', value: myWon.length, sub: 'confirmed orders', color: '#10B981', icon: <Fa icon={faMoneyBillWave} />, onClick: () => handleNav('sales', '/sales') })
      kpis.push({ id: 'sales_pos', label: 'POS Sales', value: posToday, isCurrency: true, sub: 'today\'s retail', color: '#EC4899', icon: <Fa icon={faDesktop} />, onClick: () => handleNav('pos', '/pos') })
      kpis.push({ id: 'sales_contacts', label: 'Total Contacts', value: contacts.length, sub: 'customers & vendors', color: '#8B5CF6', icon: <Fa icon={faUsers} />, onClick: () => handleNav('contacts', '/contacts') })
    }
    if (isLead || isTech) {
      if (isLead) kpis.push({ id: 'tech_unassigned', label: 'Unassigned Jobs', value: unassignedRep.length, sub: 'action required', color: '#EF4444', icon: <Fa icon={faTriangleExclamation} />, onClick: () => handleNav('repair', '/repairs') })
      else kpis.push({ id: 'tech_completed', label: 'My Completed', value: myCompleted, sub: 'ready for pickup', color: '#10B981', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('repair', '/repairs') })
      kpis.push({ id: 'tech_active', label: isLead ? 'All Active Jobs' : 'My Active Jobs', value: isLead ? openRepairs : myActiveJobs, sub: 'in progress', color: '#F97316', icon: <Fa icon={faScrewdriverWrench} />, onClick: () => handleNav('repair', '/repairs') })
      kpis.push({ id: 'tech_parts', label: 'Awaiting Parts', value: awaitingParts, sub: 'procurement pending', color: '#F59E0B', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('repair', '/repairs') })
      kpis.push({ id: 'tech_qc', label: 'Pending QC', value: inQc, sub: 'quality check', color: '#8B5CF6', icon: <Fa icon={faShieldHalved} />, onClick: () => handleNav('repair', '/repairs') })
    }
    if (isInventory) {
      kpis.push({ id: 'inv_low', label: 'Low Stock', value: lowStock, sub: 'items below minimum', color: '#F59E0B', icon: <Fa icon={faTriangleExclamation} />, onClick: () => handleNav('inventory', '/operations') })
      kpis.push({ id: 'inv_grn', label: 'Pending GRNs', value: pendingGRNs, sub: 'awaiting validation', color: '#3B82F6', icon: <Fa icon={faArrowDown} />, onClick: () => handleNav('purchase', '/purchase') })
      kpis.push({ id: 'inv_transfers', label: 'Pending Transfers', value: pendingTransfers, sub: 'internal movement', color: '#8B5CF6', icon: <Fa icon={faArrowsRotate} />, onClick: () => handleNav('inventory', '/operations') })
      kpis.push({ id: 'inv_products', label: 'Total Products', value: products.filter(p => p.isActive).length, sub: 'active catalog', color: '#10B981', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('inventory', '/operations') })
    }
    if (isKilimall) {
      kpis.push({ id: 'kili_dispatch', label: 'Pending Dispatch', value: kiliPending, sub: 'orders to pack', color: '#F59E0B', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('kilimall', '/kilimall') })
      kpis.push({ id: 'kili_unrec', label: 'Unreconciled', value: kiliUnreconciled, sub: 'delivered, unpaid', color: '#EF4444', icon: <Fa icon={faTriangleExclamation} />, onClick: () => handleNav('kilimall', '/kilimall') })
      kpis.push({ id: 'kili_delivered', label: 'Delivered', value: kilimallOrders.filter(o => o.status === 'delivered').length, sub: 'total fulfilled', color: '#10B981', icon: <Fa icon={faCircleCheck} />, onClick: () => handleNav('kilimall', '/kilimall') })
      kpis.push({ id: 'kili_orders', label: 'Total Orders', value: kilimallOrders.length, sub: 'all time', color: '#1B2762', icon: <Fa icon={faCartShopping} />, onClick: () => handleNav('kilimall', '/kilimall') })
    }
    return Array.from(new Map(kpis.map(item => [item.id, item])).values())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isFinance, isSales, isLead, isTech, isInventory, isKilimall, revenue, outstanding, stockValue, openRepairs, payables, pendingBills.length, overdueInv.length, pendingPayroll, myQuotes.length, myWon.length, posToday, contacts.length, unassignedRep.length, myCompleted, myActiveJobs, awaitingParts, inQc, lowStock, pendingGRNs, pendingTransfers, products, kiliPending, kiliUnreconciled, kilimallOrders])

  useEffect(() => {
    if (!currentUserId) return
    const saved = localStorage.getItem(`deed_kpis_${currentUserId}`)
    const allIds = allKpis.map(k => k.id)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as string[]
        const merged = [...parsed.filter(id => allIds.includes(id)), ...allIds.filter(id => !parsed.includes(id))]
        setKpiOrder(merged)
      } catch { setKpiOrder(allIds) }
    } else {
      setKpiOrder(allIds)
    }
  }, [allKpis, currentUserId])

  const handleDragStart = (e: any, id: string) => {
    setDraggedKpi(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const handleDragOver = (e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const handleDrop = (e: any, targetId: string) => {
    e.preventDefault()
    if (!draggedKpi || draggedKpi === targetId) return
    const newOrder = [...kpiOrder]
    newOrder.splice(newOrder.indexOf(draggedKpi), 1)
    newOrder.splice(newOrder.indexOf(targetId), 0, draggedKpi)
    setKpiOrder(newOrder)
    if (currentUserId) localStorage.setItem(`deed_kpis_${currentUserId}`, JSON.stringify(newOrder))
    setDraggedKpi(null)
  }

  // ── Welcome message ────────────────────────────────────────────────────────
  const welcomeSub = isAdmin   ? `Full system access · ${fmtKes(revenue)} revenue · ${activeEmployees} active employees · ${openRepairs} open repairs`
                   : isFinance ? `Finance view · ${overdueInv.length} overdue invoice(s) · ${pendingBills.length} pending bill(s) · ${pendingPayroll} payroll(s) awaiting approval`
                   : isLead    ? `Lead Technician · ${unassignedRep.length} unassigned job(s) · ${awaitingParts} awaiting parts · ${inQc} pending QC`
                   : isTech    ? `Repair Technician · ${myActiveJobs} active job(s) · ${myCompleted} ready for pickup`
                   : isSales   ? `Sales & CRM · ${myQuotes.length} open quote(s) · ${myWon.length} won deal(s) · ${fmtKes(posToday)} POS sales today`
                   : isInventory ? `Inventory Control · ${lowStock} low stock item(s) · ${pendingGRNs} pending GRN(s)`
                   : isKilimall ? `Kilimall Operations · ${kiliPending} pending dispatch · ${kiliUnreconciled} unreconciled order(s)`
                   : `${myModules.size} module(s) accessible`

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const repairStatusColor = (s: string) => ({
    received: '#F59E0B', assigned: '#3B82F6', diagnosed: '#8B5CF6',
    in_progress: '#F97316', ready: '#10B981', closed: '#9CA3AF',
  }[s] ?? '#9CA3AF')

  return (
    <div className="flex flex-col gap-4 p-1">

      {/* ── Welcome banner ──────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1B2762 0%, #0F1B4D 100%)',
        borderRadius: 16,
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        boxShadow: '0 8px 32px rgba(27,39,98,0.22)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* decorative blobs */}
        <div style={{ position:'absolute', top:-28, right:-28, width:130, height:130, borderRadius:'50%', background:'rgba(0,176,215,0.10)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:-24, right:80, width:90, height:90, borderRadius:'50%', background:'rgba(0,176,215,0.07)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:'50%', right:'30%', transform:'translateY(-50%)', width:1, height:'70%', background:'rgba(255,255,255,0.04)', pointerEvents:'none' }} />

        {/* Avatar */}
        <div style={{ width:50, height:50, borderRadius:'50%', flexShrink:0, background:avatar?'transparent':'linear-gradient(135deg,#00B0D7,#38BDF8)', overflow:'hidden', border:'2.5px solid rgba(0,176,215,0.55)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', zIndex:1 }}>
          {avatar
            ? <img src={avatar} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            : <span style={{ color:'#fff', fontWeight:700, fontSize:17 }}>{initials}</span>}
        </div>

        <div className="flex-1 min-w-0 py-1" style={{ position:'relative', zIndex:1 }}>
          <p className="truncate" style={{ fontSize:15, fontWeight:700, color:'#fff', marginBottom:4 }}>
            {greeting}, {currentUser?.name?.split(' ')[0] ?? 'there'} 👋
          </p>
          <p className="line-clamp-2 sm:truncate" style={{ fontSize:11, color:'rgba(255,255,255,0.60)', lineHeight:1.4 }}>{welcomeSub}</p>
        </div>

        <div className="hidden sm:flex items-center gap-2.5 flex-shrink-0" style={{ position:'relative', zIndex:1 }}>
          <span style={{ fontSize:10, fontWeight:600, padding:'4px 12px', borderRadius:20, background:'rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.92)', border:'1px solid rgba(255,255,255,0.16)' }}>
            {formatRoleLabel(role)}
          </span>
          <span style={{ fontSize:10, color:'rgba(255,255,255,0.42)' }}>
            {new Date().toLocaleDateString('en-KE', { weekday:'short', day:'numeric', month:'short' })}
          </span>
        </div>
      </div>

      {/* ── Role-Specific KPIs ──────────────────────────────────────────────── */}
      
      {allKpis.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3 mt-4">
            <SectionLabel label="My Key Metrics" />
            <div className="flex items-center gap-2">
              {isEditingKpis && (
                <button
                  onClick={() => {
                    if (currentUserId) localStorage.removeItem(`deed_kpis_${currentUserId}`)
                    setKpiOrder(allKpis.map(k => k.id))
                  }}
                  className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border bg-white text-red-500 border-red-200 hover:bg-red-50"
                >
                  ↺ Reset to Default
                </button>
              )}
              <button
                onClick={() => setIsEditingKpis(!isEditingKpis)}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border ${
                  isEditingKpis 
                    ? 'bg-[#1B2762] text-white border-[#1B2762]' 
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {isEditingKpis ? '✓ Done Editing' : '⚙️ Customize Widgets'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            {kpiOrder.map(id => {
              const kpi = allKpis.find(k => k.id === id)
              if (!kpi) return null
              return (
                <div
                  key={id}
                  draggable={isEditingKpis}
                  onDragStart={e => handleDragStart(e, id)}
                  onDragOver={handleDragOver}
                  onDrop={e => handleDrop(e, id)}
                  className={`transition-transform duration-200 ${isEditingKpis ? 'cursor-move' : ''}`}
                  style={{
                    opacity: draggedKpi === id ? 0.5 : 1,
                    transform: isEditingKpis ? 'scale(0.98)' : 'scale(1)',
                    boxShadow: isEditingKpis ? '0 0 0 2px dashed #00B0D7' : 'none',
                    borderRadius: 14,
                  }}
                >
                  <KpiCard label={kpi.label} value={kpi.value} sub={kpi.sub} color={kpi.color} icon={kpi.icon} isCurrency={kpi.isCurrency} onClick={isEditingKpis ? undefined : kpi.onClick} />
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Repair work queue ───────────────────────────────────────────────── */}
      {(isTech || isLead) && has('repair') && (
        <>
          <SectionLabel label={isTech ? 'My Jobs' : 'Repair Queue'} />
          <div className="card overflow-hidden">
            <CardHeader
              title={isTech ? 'My Repair Jobs' : 'Repair Queue'}
              sub={isTech ? `${activeRepairs.length} active job${activeRepairs.length !== 1 ? 's' : ''} assigned to you` : `${unassignedRep.length} unassigned · ${activeRepairs.length} active`}
              action={<button style={{ background:'none', border:'none', color:'#1B2762', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => handleNav('repair', '/repairs')}>View all →</button>}
            />
            {activeRepairs.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2">
                <span style={{ fontSize:28 }}>🎉</span>
                <p style={{ fontSize:12, color:'#9CA3AF' }}>No active repair jobs right now</p>
              </div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1.5fr 1.2fr 0.9fr 0.8fr', minWidth:520, padding:'8px 20px', gap:12, background:'#F9FAFB', borderBottom:'1px solid #F3F4F6' }}>
                  {['REF','DEVICE / CUSTOMER','ISSUE','STATUS','DATE'].map(h => (
                    <span key={h} style={{ fontSize:9, fontWeight:700, letterSpacing:'0.8px', color:'#9CA3AF', textTransform:'uppercase' }}>{h}</span>
                  ))}
                </div>
                {activeRepairs.slice(0, 8).map((r, idx) => (
                  <div key={r.id} style={{ display:'grid', gridTemplateColumns:'1fr 1.5fr 1.2fr 0.9fr 0.8fr', minWidth:520, padding:'11px 20px', gap:12, alignItems:'center', borderBottom:'1px solid #F9FAFB', background: idx % 2 === 0 ? '#fff' : '#FAFAFA', transition:'background 0.1s' }}
                    onMouseOver={e => (e.currentTarget as HTMLElement).style.background = '#F0F4FF'}
                    onMouseOut={e  => (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#fff' : '#FAFAFA'}
                  >
                    <span style={{ fontFamily:'monospace', fontSize:11, color:'#1B2762', fontWeight:700 }}>{r.ref}</span>
                    <span>
                      <p style={{ fontSize:12, fontWeight:600, color:'#111827' }}>{r.productName}</p>
                      <p style={{ fontSize:10, color:'#9CA3AF', marginTop:1 }}>{r.customerName}</p>
                    </span>
                    <span style={{ fontSize:11, color:'#6B7280' }} className="truncate">{r.issueDescription ?? '—'}</span>
                    <span>
                      <span style={{ fontSize:10, fontWeight:600, padding:'3px 9px', borderRadius:20, background:repairStatusColor(r.status)+'16', color:repairStatusColor(r.status), border:`1px solid ${repairStatusColor(r.status)}30` }}>
                        {r.status.replace(/_/g,' ')}
                      </span>
                    </span>
                    <span style={{ fontSize:11, color:'#9CA3AF' }}>{fmtDate(r.date)}</span>
                  </div>
                ))}
                {activeRepairs.length > 8 && (
                  <div style={{ padding:'10px 20px', borderTop:'1px solid #F3F4F6', textAlign:'center' }}>
                    <button style={{ background:'none', border:'none', color:'#1B2762', cursor:'pointer', fontSize:11, fontWeight:600 }} onClick={() => handleNav('repair', '/repairs')}>
                      +{activeRepairs.length - 8} more — view all in Repairs
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Unassigned repairs alert ─────────────────────────────────────────── */}
      {isLead && unassignedRep.length > 0 && (
        <div style={{ background:'linear-gradient(135deg, #FFFBEB, #FEF3C7)', border:'1px solid #FDE68A', borderRadius:14, padding:'14px 18px', display:'flex', alignItems:'flex-start', gap:12, boxShadow:'0 2px 10px rgba(245,158,11,0.10)' }}>
          <div style={{ width:36, height:36, borderRadius:10, background:'#FDE68A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>⚠️</div>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:12, fontWeight:700, color:'#92400E', marginBottom:2 }}>
              {unassignedRep.length} repair{unassignedRep.length !== 1 ? 's' : ''} waiting for technician assignment
            </p>
            <p style={{ fontSize:11, color:'#A16207' }}>
              {unassignedRep.slice(0, 3).map(r => r.productName).join(', ')}{unassignedRep.length > 3 ? ` +${unassignedRep.length - 3} more` : ''}
            </p>
          </div>
          <button style={{ background:'#1B2762', border:'none', borderRadius:8, color:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, padding:'6px 14px', flexShrink:0 }} onClick={() => handleNav('repair', '/repairs')}>
            Assign now →
          </button>
        </div>
      )}

      {/* ── Open quotations (sales rep) ──────────────────────────────────────── */}
      {isSales && has('sales') && pendingQuotes > 0 && (
        <div className="card overflow-hidden">
          <CardHeader
            title="My Open Quotations"
            sub={`${pendingQuotes} quote${pendingQuotes !== 1 ? 's' : ''} awaiting customer response`}
            action={<button style={{ background:'none', border:'none', color:'#1B2762', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => handleNav('sales', '/sales')}>Open Sales →</button>}
          />
          <div>
            {saleOrders.filter(s=>s.status==='quotation').slice(0, 6).map((so, idx) => (
              <div key={so.id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0" style={{ borderColor: '#F9FAFB', background: idx % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div style={{ width:6, height:6, borderRadius:'50%', background:'#F59E0B', flexShrink:0 }} />
                  <div className="min-w-0 truncate">
                    <span style={{ fontFamily:'monospace', color:'#1B2762', fontWeight:700, fontSize:12 }}>{so.ref}</span>
                    <span className="truncate" style={{ color:'#6B7280', marginLeft:8, fontSize:11 }}>{so.customerName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                  <span style={{ fontFamily:'monospace', fontWeight:700, color:'#111827', fontSize:12 }}>{fmtKes(so.total)}</span>
                  <span className="hidden sm:inline" style={{ fontSize:10, color:'#9CA3AF' }}>{fmtDate(so.date)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Overdue invoices (finance) ───────────────────────────────────────── */}
      {isFinance && overdueInv.length > 0 && (
        <div className="card overflow-hidden">
          <CardHeader
            title="Overdue Invoices"
            sub={`${overdueInv.length} invoice${overdueInv.length !== 1 ? 's' : ''} past due date`}
            action={<button style={{ background:'none', border:'none', color:'#EF4444', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => handleNav('accounting', '/finance')}>View all →</button>}
          />
          <div>
            {overdueInv.slice(0, 5).map((inv, idx) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0" style={{ borderColor: '#F9FAFB', background: idx % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div style={{ width:6, height:6, borderRadius:'50%', background:'#EF4444', flexShrink:0 }} />
                  <div className="min-w-0 truncate">
                    <span style={{ fontFamily:'monospace', color:'#EF4444', fontWeight:700, fontSize:12 }}>{inv.ref}</span>
                    <span className="truncate" style={{ color:'#6B7280', marginLeft:8, fontSize:11 }}>{inv.partnerName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                  <span style={{ fontFamily:'monospace', fontWeight:700, color:'#EF4444', fontSize:12 }}>{fmtKes(inv.total - inv.amountPaid)}</span>
                  <span className="hidden sm:inline" style={{ fontSize:10, color:'#9CA3AF' }}>Due {fmtDate(inv.dueDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Role-Specific Charts ────────────────────────────────────────────── */}
      {(isAdmin || isFinance || isSales || isLead) && (
        <>
          <SectionLabel label="Trends & Analytics" />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mb-3">
            
            {/* Area Chart: Admin, Finance, Sales */}
            {(isAdmin || isFinance || isSales) && (
              <div className="card overflow-hidden lg:col-span-3">
                <CardHeader
                  title={(isAdmin || isFinance) ? 'Revenue vs Purchases' : 'Sales Trend'}
                  sub="Weekly performance"
                  action={
                    <div className="flex items-center gap-4" style={{ fontSize:10, color:'#9CA3AF' }}>
                      <span className="flex items-center gap-1.5"><span style={{ width:8, height:8, borderRadius:'50%', background:'#1B2762', display:'inline-block' }} />Sales</span>
                      {(isAdmin || isFinance) && <span className="flex items-center gap-1.5"><span style={{ width:8, height:8, borderRadius:'50%', background:'#EF4444', display:'inline-block' }} />Purchases</span>}
                    </div>
                  }
                />
                <div className="p-4" style={{ height:180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top:4, right:4, left:0, bottom:0 }}>
                      <defs>
                        <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#1B2762" stopOpacity={0.18} />
                          <stop offset="95%" stopColor="#1B2762" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gPurch" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.12} />
                          <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="day" tick={{ fill:'#9CA3AF', fontSize:10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill:'#9CA3AF', fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => v>=1000000?`${(v/1000000).toFixed(1)}M`:`${(v/1000).toFixed(0)}K`} width={42} />
                      <Tooltip contentStyle={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, fontSize:11, boxShadow:'0 4px 14px rgba(0,0,0,0.08)' }} labelStyle={{ color:'#111827', fontWeight:700 }} formatter={(v:number,n:string) => [fmtKes(v), n==='sales'?'Sales':'Purchases']} />
                      <Area type="monotone" dataKey="sales" stroke="#1B2762" strokeWidth={2.5} fill="url(#gSales)" />
                      {(isAdmin || isFinance) && <Area type="monotone" dataKey="purchases" stroke="#EF4444" strokeWidth={1.5} fill="url(#gPurch)" />}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Inventory Donut: Admin, Finance */}
            {(isAdmin || isFinance) && (
              <div className="card overflow-hidden lg:col-span-2">
                <CardHeader title="Inventory by Category" sub={`${products.filter(p=>p.isActive).length} products · ${fmtKes(stockValue)}`} />
                <div style={{ height:180 }} className="p-2">
                  {categoryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={categoryData} dataKey="count" nameKey="name" cx="42%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3}>
                          {categoryData.map((e,i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" iconSize={7} formatter={v => <span style={{ fontSize:10, color:'#374151' }}>{v}</span>} />
                        <Tooltip contentStyle={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, fontSize:11, boxShadow:'0 4px 14px rgba(0,0,0,0.08)' }} formatter={(v:number,_n:string,props:{payload?:{full?:string;stock?:number}}) => [`${v} products · ${props.payload?.stock??0} units`, props.payload?.full??'']} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full" style={{ color:'#9CA3AF', fontSize:12 }}>No products yet</div>
                  )}
                </div>
              </div>
            )}

            {/* Pipeline: Sales Rep */}
            {isSales && (
              <div className="card overflow-hidden lg:col-span-2">
                <CardHeader title="Sales Pipeline" sub={`${saleOrders.length} total orders`} />
                <div className="p-5 flex flex-col gap-4">
                  {pipeline.map(s => (
                    <div key={s.stage}>
                      <div className="flex justify-between mb-1.5" style={{ fontSize:11 }}>
                        <span style={{ color:'#374151', fontWeight:600 }}>{s.stage}</span>
                        <div className="flex gap-4">
                          <span style={{ color:'#9CA3AF' }}>{s.count} orders</span>
                          <span style={{ fontWeight:700, color:s.color }}>{fmtKes(s.value)}</span>
                        </div>
                      </div>
                      <div style={{ height:5, background:'#F3F4F6', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${Math.min(100,(s.value/maxPipelineValue)*100)}%`, background:s.color, borderRadius:3, transition:'width 0.4s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Stock Health: Admin, Lead Tech */}
            {(isAdmin || isLead) && (
              <div className={`card overflow-hidden ${isAdmin ? 'lg:col-span-3' : 'lg:col-span-5'}`}>
                <CardHeader
                  title="Stock On-Hand vs Reorder Level"
                  sub="By category (units)"
                  action={
                    <div className="flex items-center gap-4" style={{ fontSize:10, color:'#9CA3AF' }}>
                      <span className="flex items-center gap-1.5"><span style={{ width:8, height:8, borderRadius:2, background:'#1B2762', display:'inline-block' }} />On Hand</span>
                      <span className="flex items-center gap-1.5"><span style={{ width:8, height:8, borderRadius:2, background:'#FCA5A5', display:'inline-block' }} />Reorder</span>
                    </div>
                  }
                />
                <div className="p-4" style={{ height:170 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stockHealthData} barGap={2} margin={{ top:4, right:4, left:0, bottom:0 }}>
                      <XAxis dataKey="name" tick={{ fill:'#9CA3AF', fontSize:9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill:'#9CA3AF', fontSize:9 }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip contentStyle={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, fontSize:11, boxShadow:'0 4px 14px rgba(0,0,0,0.08)' }} labelStyle={{ color:'#111827', fontWeight:700 }} />
                      <Bar dataKey="onHand" name="On Hand" radius={[4,4,0,0]}>{stockHealthData.map((e,i) => <Cell key={i} fill={e.color} />)}</Bar>
                      <Bar dataKey="reorder" name="Reorder Level" radius={[4,4,0,0]} fill="#FCA5A5" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Pipeline: Admin */}
            {isAdmin && (
              <div className="card overflow-hidden lg:col-span-2">
                <CardHeader title="Sales Pipeline" sub={`${saleOrders.length} total orders`} />
                <div className="p-5 flex flex-col gap-4">
                  {pipeline.map(s => (
                    <div key={s.stage}>
                      <div className="flex justify-between mb-1.5" style={{ fontSize:11 }}>
                        <span style={{ color:'#374151', fontWeight:600 }}>{s.stage}</span>
                        <div className="flex gap-4">
                          <span style={{ color:'#9CA3AF' }}>{s.count} orders</span>
                          <span style={{ fontWeight:700, color:s.color }}>{fmtKes(s.value)}</span>
                        </div>
                      </div>
                      <div style={{ height:5, background:'#F3F4F6', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${Math.min(100,(s.value/maxPipelineValue)*100)}%`, background:s.color, borderRadius:3, transition:'width 0.4s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Activity + Alerts row ────────────────────────────────────────────── */}
      {(activity.length > 0 || isAdmin || isLead || isFinance) && (
        <>
          <SectionLabel label="Activity & Alerts" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {activity.length > 0 && (
              <div className="card overflow-hidden">
                <CardHeader title="Recent Activity" />
                <div>
                  {activity.map((a, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'12px 20px', borderBottom:'1px solid #F9FAFB' }}>
                      <div style={{ width:34, height:34, borderRadius:10, background:a.color+'14', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}>
                        {a.icon}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:12, fontWeight:500, color:'#111827', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.title}</p>
                        <p style={{ fontSize:10, color:'#9CA3AF', marginTop:2 }}>{a.sub}</p>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                        <span style={{ fontSize:10, color:'#9CA3AF' }}>{a.time}</span>
                        <span style={{ width:6, height:6, borderRadius:'50%', background:a.color, display:'inline-block' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {/* Stock alerts */}
              {(isAdmin || isLead || isFinance) && (
                <div className="card overflow-hidden flex-1">
                  <CardHeader
                    title="Stock Alerts"
                  action={<button style={{ background:'none', border:'none', color:'#1B2762', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => handleNav('inventory', '/operations')}>View all →</button>}
                  />
                  {products.filter(p=>p.stockQty<=p.minStock&&p.minStock>0&&p.unit!=='service').slice(0, 4).map((p, idx) => {
                    const isOut = p.stockQty === 0
                    return (
                      <div key={p.id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0" style={{ borderColor: '#F9FAFB', background: isOut ? '#FFF5F5' : '#FFFBF0' }}>
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <span style={{ fontSize:18 }}>{p.image}</span>
                          <div className="min-w-0">
                            <p className="truncate" style={{ fontSize:12, fontWeight:500, color:'#111827' }}>{p.name}</p>
                            <p className="truncate" style={{ fontSize:10, color:'#9CA3AF' }}>{p.category}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                          <span style={{ fontFamily:'monospace', fontSize:10, color:'#6B7280' }}>{p.stockQty}/{p.minStock}</span>
                          <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:20, background: isOut ? '#FEE2E2' : '#FEF3C7', color: isOut ? '#DC2626' : '#92400E', border: `1px solid ${isOut ? '#FECACA' : '#FDE68A'}` }}>
                            {isOut ? 'OUT' : 'LOW'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  {products.filter(p=>p.stockQty<=p.minStock&&p.minStock>0&&p.unit!=='service').length===0 && (
                    <div className="py-6 flex flex-col items-center gap-1">
                      <span style={{ fontSize:22 }}>✅</span>
                      <p style={{ fontSize:11, color:'#9CA3AF' }}>All stock levels healthy</p>
                    </div>
                  )}
                </div>
              )}

              {/* HR snapshot */}
              {has('hr') && (
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <p style={{ fontSize:12, fontWeight:700, color:'#111827' }}>{isAdmin ? 'HR Snapshot' : 'My Leave'}</p>
                    <button style={{ background:'none', border:'none', color:'#1B2762', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => handleNav('hr', '/hr')}>View HR →</button>
                  </div>
                  {isAdmin ? (
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label:'Employees',     value:activeEmployees,                   color:'#0891B2', icon:'👥' },
                        { label:'Leave Pending', value:pendingLeave,                      color:'#F59E0B', icon:'🌴' },
                        { label:'Active Users',  value:users.filter(u=>u.active).length, color:'#10B981', icon:'🔑' },
                      ].map(stat => (
                        <div key={stat.label} style={{ borderRadius:12, padding:'12px 8px', textAlign:'center', background:stat.color+'12', border:`1px solid ${stat.color}22` }}>
                          <p style={{ fontSize:18, marginBottom:4 }}>{stat.icon}</p>
                          <p style={{ fontSize:20, fontWeight:800, color:stat.color, lineHeight:1 }}>{stat.value}</p>
                          <p style={{ fontSize:9, color:'#9CA3AF', marginTop:4, letterSpacing:'0.5px' }}>{stat.label}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {myLeaves.slice(0, 3).map(l => (
                        <div key={l.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingBottom:8, borderBottom:'1px solid #F3F4F6' }}>
                          <span style={{ fontSize:12, textTransform:'capitalize', color:'#374151', fontWeight:500 }}>{l.leaveType.replace(/_/g,' ')}</span>
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize:10, color:'#9CA3AF' }}>{l.days}d</span>
                            <Badge status={l.status==='approved'?'active':l.status==='rejected'?'cancelled':'pending'} label={l.status.replace('_',' ')} />
                          </div>
                        </div>
                      ))}
                      {myLeaves.length === 0 && <p style={{ fontSize:12, color:'#9CA3AF' }}>No leave requests yet</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Inventory value breakdown ────────────────────────────────────────── */}
      {(isAdmin || isFinance || isLead) && (
        <>
          <SectionLabel label="Inventory Value" />
          <div className="card overflow-hidden">
            <CardHeader title="Value Breakdown by Category" sub="Cost-basis stock value across all locations" />
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {ALL_CATEGORIES.map(cat => {
                const prods = products.filter(p => p.category === cat && p.isActive)
                const val   = prods.reduce((a,p) => a + p.costPrice * p.stockQty, 0)
                const qty   = prods.reduce((a,p) => a + p.stockQty, 0)
                const color = CATEGORY_COLORS[cat] ?? '#6B7280'
                return (
                  <div key={cat} style={{ borderRadius:12, padding:'14px 12px', background:`${color}08`, border:`1px solid ${color}22`, display:'flex', flexDirection:'column', gap:4 }}>
                    <p style={{ fontSize:9, textTransform:'uppercase', letterSpacing:'0.7px', fontWeight:700, color }}>{cat.length>12?cat.slice(0,11)+'…':cat}</p>
                    <p style={{ fontSize:14, fontWeight:800, color:'#111827' }}>{fmtKes(val)}</p>
                    <p style={{ fontSize:9, color:'#9CA3AF' }}>{prods.length} products · {qty} units</p>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Business flow (admin) ────────────────────────────────────────────── */}
      {isAdmin && (
        <>
          <SectionLabel label="Business Flow" />
          <div className="card overflow-hidden">
            <CardHeader title="End-to-End Workflow" />
            <div className="p-4 flex items-center gap-2 overflow-x-auto flex-wrap" style={{ scrollbarWidth:'none' }}>
              {([
                { label:'Contacts',   icon:'👥', mod:'contacts'   as const, color:'#2E90FA', path: '/contacts' },
                { label:'→' },
                { label:'Quotation',  icon:'📋', mod:'sales'      as const, color:'#8B5CF6', path: '/sales' },
                { label:'→' },
                { label:'Sale Order', icon:'💼', mod:'sales'      as const, color:'#8B5CF6', path: '/sales' },
                { label:'→' },
                { label:'Delivery',   icon:'📦', mod:'inventory'  as const, color:'#F79009', path: '/delivery' },
                { label:'→' },
                { label:'Warranty',   icon:'🛡️', mod:'repair'     as const, color:'#10B981', path: '/aftersales' },
                { label:'→' },
                { label:'Invoice',    icon:'🧾', mod:'accounting' as const, color:'#10B981', path: '/finance' },
                { label:'→' },
                { label:'Payment',    icon:'💰', mod:'accounting' as const, color:'#10B981', path: '/finance' },
              ] as {label:string;icon?:string;mod?:Parameters<typeof setModule>[0];color?:string;path?:string}[]).map((step, i) =>
                !step.mod ? (
                  <span key={i} style={{ color:'#D1D5DB', fontWeight:700, fontSize:14, userSelect:'none', flexShrink:0 }}>›</span>
                ) : (
                  <button key={i} onClick={() => handleNav(step.mod!, step.path!)}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:10, fontSize:11, fontWeight:600, cursor:'pointer', flexShrink:0, background:`${step.color}12`, border:`1px solid ${step.color}30`, color:step.color, transition:'all 0.15s' }}
                    onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = step.color + '22' }}
                    onMouseOut={e  => { (e.currentTarget as HTMLElement).style.background = step.color + '12' }}
                  >
                    {step.icon && <span style={{ fontSize:13 }}>{step.icon}</span>}
                    {step.label}
                  </button>
                )
              )}
            </div>
            <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:'0.8px', textTransform:'uppercase', color:'#9CA3AF', flexShrink:0 }}>Parallel:</span>
              {([
                { label:'Purchase → Stock', mod:'purchase' as const, color:'#F79009', path: '/purchase' },
                { label:'POS → Accounting', mod:'pos'      as const, color:'#EC4899', path: '/pos' },
                { label:'Repair → Parts',   mod:'repair'   as const, color:'#EF4444', path: '/repairs' },
                { label:'HR → Payroll',     mod:'hr'       as const, color:'#0891B2', path: '/hr' },
              ] as {label:string;mod:Parameters<typeof setModule>[0];color:string;path:string}[]).map(b => (
                <button key={b.label} onClick={() => handleNav(b.mod, b.path)}
                  style={{ padding:'4px 12px', borderRadius:8, fontSize:10, fontWeight:600, cursor:'pointer', background:`${b.color}10`, border:`1px solid ${b.color}25`, color:b.color, transition:'all 0.15s' }}
                  onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = b.color + '20' }}
                  onMouseOut={e  => { (e.currentTarget as HTMLElement).style.background = b.color + '10' }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── No access fallback ───────────────────────────────────────────────── */}
      {myModules.size <= 1 && !isAdmin && (
        <div className="card p-10 flex flex-col items-center gap-4 text-center">
          <div style={{ width:56, height:56, borderRadius:'50%', background:'#F3F4F6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>🔒</div>
          <div>
            <p style={{ fontSize:14, fontWeight:700, color:'#111827', marginBottom:6 }}>Limited Access</p>
            <p style={{ fontSize:12, color:'#6B7280', maxWidth:320, lineHeight:1.6 }}>
              Your account has access to {myModules.size === 0 ? 'no modules' : 'only the Dashboard'}.
              Ask your administrator to grant you access to additional modules.
            </p>
          </div>
        </div>
      )}

    </div>
  )
}
