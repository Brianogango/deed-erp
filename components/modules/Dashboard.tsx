// @ts-nocheck
'use client'

import { useMemo, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
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
  faCartShopping,
  faCircleCheck,
  faArrowsRotate,
} from '@fortawesome/free-solid-svg-icons'

import { useApp, fmtKes, fmtDate, ALL_CATEGORIES, ModuleId } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Badge, ModuleSkeleton, useMounted } from '@/components/ui'
import { formatRoleLabel } from '@/lib/auth/access'
import {
  canShowDashboardKpi,
  dashboardSectionsForUser,
  hasExplicitModuleGrant,
  visibleDashboardRepairs,
  visibleDashboardSalesOrders,
} from '@/lib/dashboard-priority'
import { buildFinanceAlerts, computeCashbookTotals, cashPositionFromTotals } from '@/lib/finance-alerts'
import { saleOrderInvoiceStatus } from '@/lib/odoo-sales-flow'
import { buildCashbookEntries } from '@/components/modules/Cashbook'
import { Fa } from '@/components/icons'

// Full sales analytics and rep performance (Recharts/tables) — loaded only
// when their sections are expanded, so the default dashboard stays light.
const SalesAnalytics = dynamic(() => import('@/components/modules/SalesDashboard'), {
  ssr: false,
  loading: () => <div className="p-6 text-center text-xs text-[var(--text-4)]">Loading analytics…</div>,
})
const RepPerformance = dynamic(() => import('@/components/modules/RepPerformance'), {
  ssr: false,
  loading: () => <div className="p-6 text-center text-xs text-[var(--text-4)]">Loading rep performance…</div>,
})

const CATEGORY_COLORS: Record<string, string> = {
  Laptops: '#1B2762',
  Desktops: '#00B0D7',
  'Parts & Components': '#2563EB',
  Accessories: '#0891B2',
  Printers: '#059669',
  Networking: '#D97706',
  Services: '#DC2626',
}

type KpiConfig = {
  key: string
  label: string
  value: string | number
  sub: string
  color: string
  icon: ReactNode
  onClick?: () => void
  isCurrency?: boolean
}

type QuickAction = {
  key: string
  title: string
  desc: string
  module?: ModuleId
  path: string
  color: string
  icon: ReactNode
}

type ActivityItem = {
  title: string
  sub: string
  date: string
  color: string
  icon: ReactNode
}

function KpiCard({
  label,
  value,
  sub,
  color,
  icon,
  onClick,
  isCurrency,
}: Omit<KpiConfig, 'key'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dashboard-stat-card text-left"
      style={{
        cursor: onClick ? 'pointer' : 'default',
        '--stat-accent': color,
        '--stat-soft': `${color}14`,
      } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-3 w-full">
        <p className="text-[10px] font-bold tracking-[0.04em] text-[var(--text-3)] leading-tight flex-1">
          {label}
        </p>
        <div className="dashboard-stat-icon" style={{ color }}>
          <span className="text-sm">{icon}</span>
        </div>
      </div>
      <div className="mt-5 w-full">
        <p
          className={`text-[1.4rem] sm:text-[1.6rem] font-extrabold leading-none mb-2 truncate text-[var(--text-1)] ${isCurrency ? 'font-mono tracking-tight' : ''}`}
        >
          {isCurrency && typeof value === 'number' ? fmtKes(value) : value}
        </p>
        <p className="text-[11px] text-[var(--text-4)] leading-snug line-clamp-2 sm:truncate">{sub}</p>
      </div>
      <span className="dashboard-stat-accent" aria-hidden="true" />
    </button>
  )
}

function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--border-lt)] gap-2 sm:gap-0">
      <div className="min-w-0 pr-2">
        <h3 className="text-[13px] font-extrabold text-[var(--text-1)] truncate">{title}</h3>
        {sub && <p className="text-[10px] text-[var(--text-3)] mt-0.5 truncate">{sub}</p>}
      </div>
      {action && <div className="flex-shrink-0 self-start sm:self-auto">{action}</div>}
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mt-1">
      <span className="w-6 h-px bg-primary-500 rounded-full inline-block flex-shrink-0" />
      <h2 className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-[var(--text-3)]">{label}</h2>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-6 flex flex-col items-center justify-center gap-2.5 text-center">
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-base" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>
        <Fa icon={faCircleCheck} />
      </div>
      <p className="text-xs text-[var(--text-4)]">{message}</p>
    </div>
  )
}

// Progressive disclosure for secondary (P3/P4) content: summary always
// visible, body rendered only when expanded. The choice is remembered per
// section so users who never want the detail never load it.
function CollapsibleSection({ id, title, sub, defaultOpen = false, accent = '#6366F1', icon, children }: {
  id: string; title: string; sub?: string; defaultOpen?: boolean; accent?: string; icon?: ReactNode; children: ReactNode
}) {
  const storageKey = `deed_dash_section_${id}`
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen
    const stored = window.localStorage.getItem(storageKey)
    return stored === null ? defaultOpen : stored === '1'
  })
  const toggle = () => {
    setOpen(prev => {
      try { window.localStorage.setItem(storageKey, prev ? '0' : '1') } catch { /* ignore */ }
      return !prev
    })
  }
  return (
    <div className={`dashboard-insight-card ${open ? 'is-open' : ''}`} style={{ '--insight-accent': accent } as React.CSSProperties}>
      <button type="button" onClick={toggle} className="w-full flex items-center justify-between gap-3 p-4 text-left" aria-expanded={open}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="dashboard-insight-icon" aria-hidden="true">{icon}</div>
          <div className="min-w-0 pr-2">
            <h3 className="text-xs font-extrabold text-[var(--text-1)] truncate">{title}</h3>
            {sub && <p className="text-[10px] text-[var(--text-3)] mt-1 truncate">{sub}</p>}
          </div>
        </div>
        <span className="dashboard-insight-toggle">{open ? 'Close' : 'Explore'}</span>
      </button>
      {open && <div className="border-t border-[var(--border-lt)]">{children}</div>}
    </div>
  )
}

export function Dashboard() {
  const mounted = useMounted()
  const [dashboardClock, setDashboardClock] = useState({ greeting: 'Welcome', date: '' })
  useEffect(() => {
    const now = new Date()
    setDashboardClock({
      greeting: now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening',
      date: now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' }),
    })
  }, [])
  const {
    saleOrders,
    invoices,
    products,
    repairs,
    purchaseOrders,
    contacts,
    setModule,
    users,
    expenses,
    outsourceJobs,
    refurbishmentJobs,
    currentUserId,
    payrollRuns,
    stockTransfers,
    kilimallOrders,
    posOrders,
    deposits,
    accounts,
    bankAccounts,
    bankStatementLines,
  } = useApp()
  const { employees, leaveRequests } = useHrStore()

  const router = useRouter()
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const currentEmployee = employees.find(e => e.userId === currentUserId) ?? null
  const role = currentUser?.role
  const has = useCallback((m: ModuleId) => hasExplicitModuleGrant(currentUser, m), [currentUser])

  const handleNav = useCallback((mod: ModuleId, path: string) => {
    setModule(mod)
    router.push(path)
  }, [router, setModule])

  const handleRoute = useCallback((path: string) => {
    router.push(path)
  }, [router])

  const isDirector = role === 'director'
  const isAdminOfficer = role === 'admin_officer'
  const isFinanceOfficer = role === 'finance_officer'
  const isInventoryOfficer = role === 'inventory_officer'
  const isKilimallOfficer = role === 'kilimall_officer'
  const isSalesRep = role === 'sales_rep'
  const isTechnicalLead = role === 'technical_lead'
  const isTechnician = role === 'technician'

  // Section visibility comes from one tested matrix (lib/dashboard-priority).
  const sections = useMemo(() => dashboardSectionsForUser(currentUser), [currentUser])
  const canSeeFinance = sections.finance
  const canSeeSales = sections.sales
  const canSeeInventory = sections.inventory
  const canSeeWorkshop = sections.workshop
  const canSeePurchasing = sections.purchasing
  const canSeeKilimall = sections.kilimall
  const canSeeHRAdmin = sections.hrAdmin
  const canApproveLeave = sections.leaveApprovals

  const visibleSalesOrders = useMemo(
    () => visibleDashboardSalesOrders(currentUser, saleOrders),
    [currentUser, saleOrders],
  )

  const visibleRepairs = useMemo(
    () => visibleDashboardRepairs(currentUser, repairs),
    [currentUser, repairs],
  )

  const financeStats = useMemo(() => {
    let revenue = 0
    let outstanding = 0
    let payables = 0
    const overdueInvoices: typeof invoices = []
    const pendingBills: typeof invoices = []

    for (const invoice of invoices) {
      if (invoice.type === 'customer_invoice') {
        if (invoice.status === 'paid') revenue += invoice.total
        if (invoice.status === 'posted' || invoice.status === 'partially_paid' || invoice.status === 'overdue') {
          outstanding += invoice.total - invoice.amountPaid
          if (invoice.status === 'overdue') overdueInvoices.push(invoice)
        }
      }
      if (invoice.type === 'vendor_bill' && (invoice.status === 'posted' || invoice.status === 'partially_paid' || invoice.status === 'overdue')) {
        payables += invoice.total - invoice.amountPaid
        pendingBills.push(invoice)
      }
    }

    return { revenue, outstanding, payables, overdueInvoices, pendingBills }
  }, [invoices])

  const salesStats = useMemo(() => {
    // Odoo stages: Quotation → Quotation Sent → Sales Order, with invoicing
    // progress derived from the per-line invoiced quantities.
    const pipeline = [
      { stage: 'Quotation', count: 0, value: 0, color: '#F59E0B' },
      { stage: 'Quotation Sent', count: 0, value: 0, color: '#3B82F6' },
      { stage: 'Sales Order', count: 0, value: 0, color: '#8B5CF6' },
      { stage: 'Fully Invoiced', count: 0, value: 0, color: '#10B981' },
    ]
    const fullyInvoiced = (s: (typeof visibleSalesOrders)[number]) => {
      const st = saleOrderInvoiceStatus(s.status, s.lines ?? [])
      return st === 'invoiced' || st === 'upselling'
    }
    const myQuotes = visibleSalesOrders.filter(s => s.status === 'quotation' || s.status === 'quotation_sent')
    const wonOrders = visibleSalesOrders.filter(s => s.status === 'sale')

    for (const order of visibleSalesOrders) {
      if (order.status === 'cancelled') continue
      const index = order.status === 'quotation' ? 0
        : order.status === 'quotation_sent' ? 1
        : order.status === 'sale' ? (fullyInvoiced(order) ? 3 : 2)
        : -1
      if (index >= 0) {
        pipeline[index].count += 1
        pipeline[index].value += order.total
      }
    }

    return {
      myQuotes,
      wonOrders,
      pipeline,
      maxPipelineValue: Math.max(...pipeline.map(s => s.value), 1),
      openOrders: visibleSalesOrders.filter(s => s.status !== 'cancelled' && !fullyInvoiced(s)).length,
    }
  }, [visibleSalesOrders])

  const inventoryStats = useMemo(() => {
    const lowStockItems = products.filter(p => p.stockQty <= p.minStock && p.minStock > 0 && p.unit !== 'service')
    const activeSkus = products.filter(p => p.isActive && p.unit !== 'service')
    const totalUnits = activeSkus.reduce((sum, p) => sum + p.stockQty, 0)
    const pendingReceipts = purchaseOrders.filter(po => ['sent', 'confirmed', 'partial'].includes(po.status)).length
    const draftTransfers = stockTransfers.filter(t => t.status === 'draft').length
    const stockValue = products.reduce((sum, p) => sum + p.costPrice * p.stockQty, 0)

    return { lowStockItems, activeSkus, totalUnits, pendingReceipts, draftTransfers, stockValue }
  }, [products, purchaseOrders, stockTransfers])

  const repairStats = useMemo(() => {
    const active = visibleRepairs.filter(r => !['closed', 'cancelled', 'delivered', 'invoiced'].includes(r.status))
    const awaitingParts = active.filter(r => r.status === 'awaiting_parts')
    const inQc = active.filter(r => r.status === 'qc')
    const ready = visibleRepairs.filter(r => r.status === 'ready')
    const urgent = active.filter(r => r.priority === 'urgent' || r.priority === 'high' || r.status === 'approved' || r.status === 'diagnosed')
    const unassigned = visibleRepairs.filter(r => r.status === 'received' && !r.assignedTechnicianId)

    return { active, awaitingParts, inQc, ready, urgent, unassigned }
  }, [visibleRepairs])

  // Six-month paid-revenue trend, split between the repair workshop (invoices
  // linked to a repair job) and actual sales (all other customer invoices).
  const techLeadStats = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      return {
        year: d.getFullYear(),
        month: d.getMonth(),
        label: d.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' }),
        revenue: 0,
        salesRevenue: 0,
        count: 0,
        salesCount: 0,
      }
    })

    for (const inv of invoices) {
      if (inv.type === 'vendor_bill' || inv.status !== 'paid') continue
      const d = new Date(inv.date)
      const slot = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth())
      if (!slot) continue
      if ((inv as any).repairId) { slot.revenue += inv.total; slot.count++ }
      else { slot.salesRevenue += inv.total; slot.salesCount++ }
    }

    const repairRevenueThisMonth = months[5].revenue
    const repairRevenueLastMonth = months[4].revenue
    const salesRevenueThisMonth = months[5].salesRevenue
    const revenueChange = repairRevenueLastMonth > 0
      ? ((repairRevenueThisMonth - repairRevenueLastMonth) / repairRevenueLastMonth) * 100
      : repairRevenueThisMonth > 0 ? 100 : 0
    const maxMonthlyRevenue = Math.max(...months.map(m => Math.max(m.revenue, m.salesRevenue)), 1)
    const totalThisMonth = repairRevenueThisMonth + salesRevenueThisMonth
    const repairShareThisMonth = totalThisMonth > 0
      ? Math.round((repairRevenueThisMonth / totalThisMonth) * 100)
      : 0

    return {
      monthlyRepairRevenue: months,
      repairRevenueThisMonth, repairRevenueLastMonth, revenueChange,
      salesRevenueThisMonth, repairShareThisMonth, maxMonthlyRevenue,
    }
  }, [invoices])

  const kilimallStats = useMemo(() => ({
    pending: kilimallOrders.filter(o => o.status === 'pending'),
    dispatched: kilimallOrders.filter(o => o.status === 'dispatched'),
    returned: kilimallOrders.filter(o => o.status === 'returned'),
    unsettled: kilimallOrders.filter(o => o.status === 'delivered' && !o.settlementId),
  }), [kilimallOrders])

  // Cash position + finance exceptions (finance roles only — the underlying
  // store keys are empty for everyone else). Shared logic with Accounting.
  const financeDeskStats = useMemo(() => {
    if (!canSeeFinance) return null
    const entries = buildCashbookEntries(
      { invoices, posOrders, expenses, payrollRuns, purchaseOrders, deposits },
      accounts,
    )
    const cashbookTotals = computeCashbookTotals(bankAccounts, entries)
    const { cashAtBank, cashInHand } = cashPositionFromTotals(cashbookTotals)
    const alerts = buildFinanceAlerts({ invoices, expenses, payrollRuns, bankStatementLines, bankAccounts, cashbookTotals })
    return { cashAtBank, cashInHand, alerts }
  }, [canSeeFinance, invoices, posOrders, expenses, payrollRuns, purchaseOrders, deposits, accounts, bankAccounts, bankStatementLines])

  const selfServiceStats = useMemo(() => {
    const myLeave = leaveRequests.filter(l => l.employeeId === currentEmployee?.id)
    const pendingLeave = canApproveLeave
      ? leaveRequests.filter(l => l.status === 'pending_hr').length
      : myLeave.filter(l => l.status === 'pending_hr').length
    const myExpenseClaims = expenses.filter(e => e.submittedByUserId === currentUserId)
    const pendingExpenseClaims = expenses.filter(e => e.status === 'submitted')
    const pendingPayroll = payrollRuns.filter(p => p.status === 'pending_approval')

    return { myLeave, pendingLeave, myExpenseClaims, pendingExpenseClaims, pendingPayroll }
  }, [leaveRequests, currentEmployee?.id, canApproveLeave, expenses, currentUserId, payrollRuns])

  const kpis = useMemo<KpiConfig[]>(() => {
    if (isDirector) {
      return [
        { key: 'revenue', label: 'Revenue Paid', value: financeStats.revenue, sub: 'Company-wide collections', color: '#10B981', icon: <Fa icon={faMoneyBillWave} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'repair-revenue', label: 'Repair Revenue', value: techLeadStats.repairRevenueThisMonth, sub: `This month · actual sales ${fmtKes(techLeadStats.salesRevenueThisMonth)}`, color: '#047857', icon: <Fa icon={faScrewdriverWrench} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'outstanding', label: 'Outstanding', value: financeStats.outstanding, sub: `${financeStats.overdueInvoices.length} overdue invoices`, color: '#F59E0B', icon: <Fa icon={faArrowDown} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'payables', label: 'Payables', value: financeStats.payables, sub: `${financeStats.pendingBills.length} bills pending`, color: '#EF4444', icon: <Fa icon={faArrowUp} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=bills') },
        { key: 'active-users', label: 'Active Users', value: users.filter(u => u.active).length, sub: `${employees.filter(e => e.status === 'active').length} active employees`, color: '#1B2762', icon: <Fa icon={faUsers} />, onClick: () => handleRoute('/settings?tab=users') },
        { key: 'open-orders', label: 'Open Sales', value: salesStats.openOrders, sub: `${salesStats.myQuotes.length} quotations active`, color: '#3B82F6', icon: <Fa icon={faClipboardList} />, onClick: () => handleNav('sales', '/sales') },
        { key: 'stock', label: 'Low Stock', value: inventoryStats.lowStockItems.length, sub: `${inventoryStats.totalUnits} units on hand`, color: '#DC2626', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('inventory', '/operations') },
        { key: 'repairs', label: 'Open Repairs', value: repairStats.active.length, sub: `${repairStats.unassigned.length} waiting assignment`, color: '#8B5CF6', icon: <Fa icon={faScrewdriverWrench} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'approvals', label: 'Approvals', value: selfServiceStats.pendingLeave + selfServiceStats.pendingPayroll.length + selfServiceStats.pendingExpenseClaims.length, sub: 'Leave, payroll, and expense queues', color: '#0891B2', icon: <Fa icon={faShieldHalved} />, onClick: () => handleNav('hr', '/hr') },
        { key: 'cash-bank', label: 'Cash at Bank', value: financeDeskStats?.cashAtBank ?? 0, sub: 'Total in bank accounts', color: '#3B82F6', icon: <Fa icon={faMoneyBillWave} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=cash_position') },
        { key: 'cash-hand', label: 'Cash in Hand', value: financeDeskStats?.cashInHand ?? 0, sub: 'Petty cash & M-Pesa', color: '#8B5CF6', icon: <Fa icon={faMoneyCheckDollar} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=cash_position') },
      ]
    }

    if (isFinanceOfficer) {
      return [
        { key: 'revenue', label: 'Revenue Paid', value: financeStats.revenue, sub: 'Collected invoices', color: '#10B981', icon: <Fa icon={faMoneyBillWave} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'outstanding', label: 'Outstanding', value: financeStats.outstanding, sub: `${financeStats.overdueInvoices.length} overdue invoices`, color: '#F59E0B', icon: <Fa icon={faArrowDown} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'payables', label: 'Payables', value: financeStats.payables, sub: `${financeStats.pendingBills.length} supplier bills pending`, color: '#EF4444', icon: <Fa icon={faArrowUp} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=bills') },
        { key: 'expenses', label: 'Expense Claims', value: selfServiceStats.pendingExpenseClaims.length, sub: 'Waiting review or reimbursement', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('expenses', '/expenses') },
        { key: 'payroll', label: 'Payroll Approval', value: selfServiceStats.pendingPayroll.length, sub: 'Runs pending approval', color: '#1B2762', icon: <Fa icon={faFileInvoiceDollar} />, onClick: () => handleNav('hr', '/hr?tab=payroll') },
        { key: 'settlements', label: 'Kilimall Settlement', value: kilimallStats.unsettled.length, sub: 'Delivered orders not settled', color: '#8B5CF6', icon: <Fa icon={faCartShopping} />, onClick: () => handleNav('kilimall', '/kilimall') },
        { key: 'sales', label: 'Commercial Orders', value: salesStats.openOrders, sub: 'Quotation to invoice pipeline', color: '#3B82F6', icon: <Fa icon={faClipboardList} />, onClick: () => handleNav('sales', '/sales') },
        { key: 'purchase', label: 'Purchase Follow-up', value: inventoryStats.pendingReceipts, sub: 'POs awaiting receipt/billing', color: '#D97706', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('purchase', '/purchases') },
        { key: 'cash-bank', label: 'Cash at Bank', value: financeDeskStats?.cashAtBank ?? 0, sub: 'Total in bank accounts', color: '#3B82F6', icon: <Fa icon={faMoneyBillWave} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=cash_position') },
        { key: 'cash-hand', label: 'Cash in Hand', value: financeDeskStats?.cashInHand ?? 0, sub: 'Petty cash & M-Pesa', color: '#8B5CF6', icon: <Fa icon={faMoneyCheckDollar} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=cash_position') },
      ]
    }

    if (isAdminOfficer) {
      return [
        { key: 'quotes', label: 'Quotations', value: salesStats.myQuotes.length, sub: 'Pending customer conversion', color: '#3B82F6', icon: <Fa icon={faClipboardList} />, onClick: () => handleNav('sales', '/sales') },
        { key: 'orders', label: 'Open Sales Orders', value: salesStats.openOrders, sub: 'Commercial workflow queue', color: '#10B981', icon: <Fa icon={faCircleCheck} />, onClick: () => handleNav('sales', '/sales') },
        { key: 'customers', label: 'Customer Records', value: contacts.length, sub: 'CRM and contact records', color: '#1B2762', icon: <Fa icon={faUsers} />, onClick: () => handleNav('contacts', '/contacts') },
        { key: 'purchase', label: 'Purchase Orders', value: inventoryStats.pendingReceipts, sub: 'Sent, confirmed, or partial', color: '#D97706', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('purchase', '/purchases') },
        { key: 'low-stock', label: 'Low Stock', value: inventoryStats.lowStockItems.length, sub: 'Items needing workflow attention', color: '#DC2626', icon: <Fa icon={faTriangleExclamation} />, onClick: () => handleNav('inventory', '/operations') },
        { key: 'my-expenses', label: 'My Expenses', value: selfServiceStats.myExpenseClaims.length, sub: 'Your reimbursement requests', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('expenses', '/expenses') },
      ]
    }

    if (isInventoryOfficer) {
      return [
        { key: 'skus', label: 'Active SKUs', value: inventoryStats.activeSkus.length, sub: 'Physical stock items', color: '#1B2762', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('inventory', '/operations') },
        { key: 'units', label: 'Units On Hand', value: inventoryStats.totalUnits, sub: 'Across stock locations', color: '#10B981', icon: <Fa icon={faCircleCheck} />, onClick: () => handleNav('inventory', '/operations') },
        { key: 'low-stock', label: 'Low Stock', value: inventoryStats.lowStockItems.length, sub: 'Reorder/count attention', color: '#DC2626', icon: <Fa icon={faTriangleExclamation} />, onClick: () => handleNav('inventory', '/operations') },
        { key: 'receipts', label: 'Goods To Receive', value: inventoryStats.pendingReceipts, sub: 'POs not fully received', color: '#D97706', icon: <Fa icon={faClipboardList} />, onClick: () => handleNav('purchase', '/purchases') },
        { key: 'transfers', label: 'Draft Transfers', value: inventoryStats.draftTransfers, sub: 'Stock movement pending', color: '#8B5CF6', icon: <Fa icon={faArrowsRotate} />, onClick: () => handleNav('inventory', '/operations?tab=transfers') },
        { key: 'my-expenses', label: 'My Expenses', value: selfServiceStats.myExpenseClaims.length, sub: 'Your reimbursement requests', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('expenses', '/expenses') },
      ]
    }

    if (isKilimallOfficer) {
      return [
        { key: 'pending', label: 'Kilimall Pending', value: kilimallStats.pending.length, sub: 'Orders needing allocation', color: '#F59E0B', icon: <Fa icon={faCartShopping} />, onClick: () => handleNav('kilimall', '/kilimall') },
        { key: 'dispatched', label: 'Dispatched', value: kilimallStats.dispatched.length, sub: 'Awaiting delivery confirmation', color: '#3B82F6', icon: <Fa icon={faCircleCheck} />, onClick: () => handleNav('kilimall', '/kilimall') },
        { key: 'returns', label: 'Returns', value: kilimallStats.returned.length, sub: 'Returned Kilimall orders', color: '#EF4444', icon: <Fa icon={faArrowDown} />, onClick: () => handleNav('kilimall', '/kilimall') },
        { key: 'low-stock', label: 'Low Stock', value: inventoryStats.lowStockItems.length, sub: 'Availability risk before allocation', color: '#DC2626', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('inventory', '/operations') },
        { key: 'my-expenses', label: 'My Expenses', value: selfServiceStats.myExpenseClaims.length, sub: 'Your reimbursement requests', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('expenses', '/expenses') },
      ]
    }

    if (isTechnicalLead) {
      return [
        { key: 'repair-revenue', label: 'Repair Revenue', value: techLeadStats.repairRevenueThisMonth, sub: `Paid invoices this month${techLeadStats.repairRevenueLastMonth > 0 ? ` · ${techLeadStats.revenueChange >= 0 ? '+' : ''}${techLeadStats.revenueChange.toFixed(0)}% vs last month` : ''}`, color: '#10B981', icon: <Fa icon={faMoneyBillWave} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'active', label: 'Active Repairs', value: repairStats.active.length, sub: 'Workshop jobs in progress', color: '#3B82F6', icon: <Fa icon={faScrewdriverWrench} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'unassigned', label: 'Unassigned', value: repairStats.unassigned.length, sub: 'Jobs waiting allocation', color: '#F59E0B', icon: <Fa icon={faUsers} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'parts', label: 'Awaiting Parts', value: repairStats.awaitingParts.length, sub: 'Parts request follow-up', color: '#D97706', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'qc', label: 'QA Sign-off', value: repairStats.inQc.length, sub: 'Jobs in quality control', color: '#8B5CF6', icon: <Fa icon={faShieldHalved} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'refurb', label: 'Refurb Queue', value: refurbishmentJobs.filter(j => j.status === 'queued').length, sub: 'Machines awaiting refurbishment', color: '#10B981', icon: <Fa icon={faArrowsRotate} />, onClick: () => handleNav('refurbishment', '/refurbishment') },
        { key: 'outsource', label: 'Outsource Open', value: outsourceJobs.filter(j => j.status === 'sent').length, sub: 'Jobs currently outside', color: '#0891B2', icon: <Fa icon={faDesktop} />, onClick: () => handleNav('outsource', '/outsource') },
      ]
    }

    if (isTechnician) {
      return [
        { key: 'my-active', label: 'My Active Jobs', value: repairStats.active.length, sub: 'Repairs assigned to you', color: '#3B82F6', icon: <Fa icon={faScrewdriverWrench} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'my-parts', label: 'Awaiting Parts', value: repairStats.awaitingParts.length, sub: 'Your jobs blocked by parts', color: '#F59E0B', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'my-qc', label: 'In QA', value: repairStats.inQc.length, sub: 'Your work under sign-off', color: '#8B5CF6', icon: <Fa icon={faShieldHalved} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'my-ready', label: 'Completed', value: repairStats.ready.length, sub: 'Ready for customer delivery', color: '#10B981', icon: <Fa icon={faCircleCheck} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'my-expenses', label: 'My Expenses', value: selfServiceStats.myExpenseClaims.length, sub: 'Your reimbursement requests', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('expenses', '/expenses') },
      ]
    }

    if (isSalesRep) {
      const isFullyInvoicedSO = (s: (typeof visibleSalesOrders)[number]) => {
        const st = saleOrderInvoiceStatus(s.status, s.lines ?? [])
        return st === 'invoiced' || st === 'upselling'
      }
      const pipelineValue = visibleSalesOrders
        .filter(s => s.status !== 'cancelled' && !isFullyInvoicedSO(s))
        .reduce((sum, s) => sum + s.total, 0)
      const invoicedThisMonth = visibleSalesOrders
        .filter(s => isFullyInvoicedSO(s) && new Date(s.date).getMonth() === new Date().getMonth() && new Date(s.date).getFullYear() === new Date().getFullYear())
        .reduce((sum, s) => sum + s.total, 0)
      const myCustomers = new Set(visibleSalesOrders.map(s => s.customerName)).size
      return [
        { key: 'my-quotes', label: 'My Quotations', value: salesStats.myQuotes.length, sub: 'Awaiting customer follow-up', color: '#F59E0B', icon: <Fa icon={faClipboardList} />, onClick: () => handleNav('sales', '/sales?tab=list') },
        { key: 'my-orders', label: 'My Open Orders', value: salesStats.openOrders, sub: 'Quotation to delivery', color: '#3B82F6', icon: <Fa icon={faCircleCheck} />, onClick: () => handleNav('sales', '/sales?tab=list') },
        { key: 'my-pipeline', label: 'Pipeline Value', value: pipelineValue, sub: 'Your open orders', color: '#8B5CF6', icon: <Fa icon={faArrowUp} />, isCurrency: true, onClick: () => handleNav('sales', '/sales?tab=list') },
        { key: 'my-invoiced', label: 'Invoiced This Month', value: invoicedThisMonth, sub: 'From your orders', color: '#10B981', icon: <Fa icon={faMoneyBillWave} />, isCurrency: true, onClick: () => handleNav('sales', '/sales?tab=list') },
        { key: 'my-customers', label: 'My Customers', value: myCustomers, sub: 'Customers on your orders', color: '#1B2762', icon: <Fa icon={faUsers} />, onClick: () => handleNav('contacts', '/contacts') },
      ]
    }

    return [
      { key: 'leave', label: 'My Leave', value: selfServiceStats.myLeave.length, sub: `${selfServiceStats.pendingLeave} pending`, color: '#3B82F6', icon: <Fa icon={faUsers} />, onClick: () => handleNav('hr', '/hr?tab=leave') },
      { key: 'expenses', label: 'My Expenses', value: selfServiceStats.myExpenseClaims.length, sub: 'Your reimbursement requests', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('expenses', '/expenses') },
    ]
  }, [
    isDirector, isFinanceOfficer, isAdminOfficer, isInventoryOfficer, isKilimallOfficer, isSalesRep, isTechnicalLead, isTechnician,
    financeStats, users, employees, salesStats, inventoryStats, repairStats, techLeadStats, selfServiceStats, contacts.length,
    kilimallStats, refurbishmentJobs, outsourceJobs, visibleSalesOrders, financeDeskStats, handleNav, handleRoute,
  ])

  const quickActions = useMemo<QuickAction[]>(() => {
    const actions: QuickAction[] = [
      { key: 'leave', title: 'Leave Application', desc: 'Apply and track your leave', module: 'hr', path: '/hr?tab=leave', color: '#3B82F6', icon: <Fa icon={faUsers} /> },
      { key: 'payslip', title: 'Payslip', desc: 'View published payslips', module: 'hr', path: '/hr?tab=payroll', color: '#1B2762', icon: <Fa icon={faFileInvoiceDollar} /> },
      { key: 'performance', title: 'Performance Targets', desc: 'Check your assigned targets', module: 'hr', path: '/hr?tab=performance', color: '#8B5CF6', icon: <Fa icon={faShieldHalved} /> },
      { key: 'expense', title: 'Expense Application', desc: 'Submit reimbursement claims', module: 'expenses', path: '/expenses', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} /> },
      { key: 'account', title: 'Account Settings', desc: 'Password and sign-in settings', path: '/account/password-change', color: '#64748B', icon: <Fa icon={faUsers} /> },
    ]

    if (canSeeFinance) actions.unshift({ key: 'finance', title: 'Finance Desk', desc: 'Invoices, bills, payments, and reports', module: 'accounting', path: '/finance', color: '#10B981', icon: <Fa icon={faMoneyBillWave} /> })
    if (canSeeSales) actions.unshift({ key: 'sales', title: isSalesRep ? 'My Sales Pipeline' : 'Sales Pipeline', desc: 'Quotations, sales orders, and customers', module: 'sales', path: '/sales', color: '#3B82F6', icon: <Fa icon={faClipboardList} /> })
    if (canSeeInventory) actions.unshift({ key: 'inventory', title: 'Stock Control', desc: 'Stock levels, transfers, and counts', module: 'inventory', path: '/operations', color: '#D97706', icon: <Fa icon={faBoxesStacked} /> })
    if (canSeeKilimall) actions.unshift({ key: 'kilimall', title: 'Kilimall Orders', desc: 'Allocate stock and manage returns', module: 'kilimall', path: '/kilimall', color: '#F59E0B', icon: <Fa icon={faCartShopping} /> })
    if (canSeeWorkshop) actions.unshift({ key: 'repairs', title: isTechnician ? 'My Repair Jobs' : 'Repair Workshop', desc: isTechnician ? 'Assigned repairs only' : 'Assignment, QA, and refurbishment', module: 'repair', path: '/repairs', color: '#8B5CF6', icon: <Fa icon={faScrewdriverWrench} /> })

    return actions.filter(a => !a.module || has(a.module)).slice(0, 8)
  }, [canSeeFinance, canSeeSales, canSeeInventory, canSeeKilimall, canSeeWorkshop, isSalesRep, isTechnician, has])

  // P1 — "Needs attention now". Everything here is either overdue, waiting on
  // an approval, or blocking someone. Every entry links to where it is fixed.
  const focusItems = useMemo(() => {
    const items: { key: string; title: string; sub: string; tone: string; module?: ModuleId; path?: string }[] = []

    if (canSeeFinance && financeDeskStats) {
      // Shared finance exceptions: overdue collections/payables, reimbursements
      // due, payroll approvals, reconciliation backlog, negative cash accounts.
      items.push(...financeDeskStats.alerts.map(a => ({ key: a.key, title: a.title, sub: a.sub, tone: a.tone, module: 'accounting' as ModuleId, path: a.path })))
      if (selfServiceStats.pendingExpenseClaims.length > 0) {
        items.push({ key: 'expense-review', title: `${selfServiceStats.pendingExpenseClaims.length} expense claim${selfServiceStats.pendingExpenseClaims.length > 1 ? 's' : ''} awaiting review`, sub: `${fmtKes(selfServiceStats.pendingExpenseClaims.reduce((s, e) => s + (Number(e.amount) || 0), 0))} to approve or reject`, tone: 'warn', module: 'expenses', path: '/expenses?tab=review' })
      }
    }

    if (canApproveLeave && selfServiceStats.pendingLeave > 0) {
      items.push({ key: 'leave-approvals', title: `${selfServiceStats.pendingLeave} leave request${selfServiceStats.pendingLeave > 1 ? 's' : ''} awaiting decision`, sub: 'Approve or decline in HR → Leave', tone: 'warn', module: 'hr', path: '/hr?tab=leave' })
    }

    if (canSeeHRAdmin) {
      const todayStr = new Date().toISOString().slice(0, 10)
      const onLeaveToday = new Set(
        leaveRequests.filter(l => l.status === 'approved' && l.startDate <= todayStr && l.endDate >= todayStr).map(l => l.employeeId),
      ).size
      if (onLeaveToday > 0) {
        items.push({ key: 'on-leave-today', title: `${onLeaveToday} staff member${onLeaveToday > 1 ? 's' : ''} on leave today`, sub: 'Plan cover for approved absences', tone: 'info', module: 'hr', path: '/hr?tab=leave' })
      }
    }

    if (isDirector || isAdminOfficer) {
      const pendingSignOff = saleOrders.filter(s => s.approvalStatus === 'pending')
      if (pendingSignOff.length > 0) {
        items.push({ key: 'sales-sign-off', title: `${pendingSignOff.length} sales order${pendingSignOff.length > 1 ? 's' : ''} awaiting internal sign-off`, sub: 'Approve discounts/terms in Sales', tone: 'warn', module: 'sales', path: '/sales?tab=list' })
      }
      const readyDeposits = deposits.filter(d => d.status === 'fully_paid')
      if (readyDeposits.length > 0) {
        items.push({ key: 'deposits-ready', title: `${readyDeposits.length} deposit${readyDeposits.length > 1 ? 's' : ''} ready to collect`, sub: 'Fully paid — arrange customer collection', tone: 'info', module: 'deposits', path: '/deposits' })
      }
    }

    if (canSeeInventory) {
      const outOfStock = inventoryStats.lowStockItems.filter(p => p.stockQty === 0)
      if (outOfStock.length > 0) {
        items.push({ key: 'out-of-stock', title: `${outOfStock.length} product${outOfStock.length > 1 ? 's' : ''} out of stock`, sub: outOfStock.slice(0, 3).map(p => p.name).join(', '), tone: 'danger', module: 'inventory', path: '/operations?tab=warehouse_view' })
      }
      if (isInventoryOfficer || isAdminOfficer) {
        items.push(...inventoryStats.lowStockItems.filter(p => p.stockQty > 0).slice(0, 3).map(p => ({ key: `stock-${p.id}`, title: `${p.name} is low`, sub: `${p.stockQty}/${p.minStock} units · ${p.category}`, tone: 'warn', module: 'inventory' as ModuleId, path: '/operations?tab=warehouse_view' })))
      }
    }

    if (isKilimallOfficer) {
      items.push(
        ...kilimallStats.pending.slice(0, 3).map(o => ({ key: `kilimall-${o.id}`, title: `Allocate ${o.kilimallRef}`, sub: `${o.productName} · Qty ${o.qty}`, tone: 'warn', module: 'kilimall' as ModuleId, path: '/kilimall' })),
        ...kilimallStats.returned.slice(0, 2).map(o => ({ key: `return-${o.id}`, title: `Returned ${o.kilimallRef}`, sub: o.productName, tone: 'danger', module: 'kilimall' as ModuleId, path: '/kilimall' })),
      )
    }

    if (canSeeWorkshop) {
      if (isTechnicalLead && repairStats.unassigned.length > 0) {
        items.push({ key: 'unassigned-repairs', title: `${repairStats.unassigned.length} repair${repairStats.unassigned.length > 1 ? 's' : ''} waiting for a technician`, sub: 'Assign in the repair workshop', tone: 'danger', module: 'repair', path: '/repairs' })
      }
      items.push(...repairStats.urgent.slice(0, 4).map(r => ({ key: `repair-${r.id}`, title: `${r.ref} requires attention`, sub: `${r.customerName} · ${r.status.replace(/_/g, ' ')}`, tone: r.priority === 'urgent' ? 'danger' : 'warn', module: 'repair' as ModuleId, path: '/repairs' })))
    }

    if (isSalesRep) {
      items.push(...salesStats.myQuotes.slice(0, 4).map(s => ({ key: `quote-${s.id}`, title: `Follow up ${s.ref}`, sub: `${s.customerName} · ${fmtKes(s.total)}`, tone: 'info', module: 'sales' as ModuleId, path: '/sales?tab=list' })))
    }

    if (items.length === 0 && !canSeeFinance && !canSeeWorkshop && !isSalesRep && !isKilimallOfficer && !isInventoryOfficer && !isAdminOfficer) {
      items.push(...selfServiceStats.myLeave.filter(l => l.status === 'pending_hr').slice(0, 4).map(l => ({ key: `leave-${l.id}`, title: `${l.leaveType.replace(/_/g, ' ')} leave pending approval`, sub: `${l.days} days · awaiting HR decision`, tone: 'info', module: 'hr' as ModuleId, path: '/hr?tab=leave' })))
    }

    // danger first, then warnings, then informational — capped to stay readable
    const rank = { danger: 0, warn: 1, info: 2 }
    return items
      .filter(item => !item.module || has(item.module))
      .sort((a, b) => (rank[a.tone] ?? 3) - (rank[b.tone] ?? 3))
      .slice(0, 8)
  }, [canSeeFinance, canApproveLeave, canSeeHRAdmin, canSeeInventory, isDirector, isInventoryOfficer, isAdminOfficer, isKilimallOfficer, canSeeWorkshop, isTechnicalLead, isSalesRep, financeDeskStats, selfServiceStats, inventoryStats, kilimallStats, repairStats, salesStats, leaveRequests, saleOrders, deposits, has])

  const activity = useMemo<ActivityItem[]>(() => {
    const list: ActivityItem[] = []

    if (canSeeFinance) {
      invoices.slice(-5).forEach(i => list.push({ title: `${i.type === 'vendor_bill' ? 'Bill' : 'Invoice'} ${i.ref}`, sub: `${i.partnerName} · ${fmtKes(i.total)}`, date: i.date, color: '#10B981', icon: <Fa icon={faFileInvoiceDollar} /> }))
    }

    if (canSeeSales) {
      visibleSalesOrders.slice(-5).forEach(s => list.push({ title: `Order ${s.ref}`, sub: `${s.customerName} · ${s.status.replace(/_/g, ' ')}`, date: s.date, color: '#3B82F6', icon: <Fa icon={faClipboardList} /> }))
    }

    if (canSeeInventory) {
      stockTransfers.slice(-4).forEach(t => list.push({ title: `Transfer ${t.ref}`, sub: `${t.fromLocation} → ${t.toLocation} · ${t.status}`, date: t.date, color: '#D97706', icon: <Fa icon={faArrowsRotate} /> }))
      purchaseOrders.slice(-4).forEach(po => list.push({ title: `PO ${po.ref}`, sub: `${po.vendorName} · ${po.status}`, date: po.date, color: '#F59E0B', icon: <Fa icon={faBoxesStacked} /> }))
    }

    if (canSeeKilimall) {
      kilimallOrders.slice(-5).forEach(o => list.push({ title: `Kilimall ${o.kilimallRef}`, sub: `${o.productName} · ${o.status}`, date: o.orderDate, color: '#F59E0B', icon: <Fa icon={faCartShopping} /> }))
    }

    if (canSeeWorkshop) {
      visibleRepairs.slice(-5).forEach(r => list.push({ title: `Repair ${r.ref}`, sub: `${r.customerName} · ${r.status.replace(/_/g, ' ')}`, date: r.intakeDate, color: '#8B5CF6', icon: <Fa icon={faScrewdriverWrench} /> }))
    }

    if (has('expenses')) {
      expenses.filter(e => e.submittedByUserId === currentUserId).slice(-3).forEach(e => list.push({ title: `My expense ${e.ref}`, sub: `${fmtKes(e.amount)} · ${e.status}`, date: e.submittedDate, color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} /> }))
    }

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8)
  }, [canSeeFinance, canSeeSales, canSeeInventory, canSeeKilimall, canSeeWorkshop, invoices, visibleSalesOrders, stockTransfers, purchaseOrders, kilimallOrders, visibleRepairs, expenses, currentUserId, has])

  const primaryAction = quickActions.find(a => a.key !== 'account') ?? quickActions[0]

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <span className="dashboard-hero-orb dashboard-hero-orb-one" aria-hidden="true" />
        <span className="dashboard-hero-orb dashboard-hero-orb-two" aria-hidden="true" />
        <div className="relative z-[1] flex items-center gap-4 min-w-0">
          <div className="dashboard-avatar">
            {currentUser?.name?.slice(0, 1).toUpperCase() || '?'}
          </div>
          <div className="min-w-0">
            <p className="dashboard-eyebrow">Your workspace</p>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--text-1)] truncate">
              {dashboardClock.greeting}, {currentUser?.name?.split(' ')[0] || 'there'}
            </h2>
            <p className="text-xs text-[var(--text-3)] mt-1">
              Here&apos;s what needs your attention today.
            </p>
          </div>
        </div>
        <div className="relative z-[1] flex flex-col sm:items-end gap-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-3)]">
            <span className="dashboard-role-pill">{formatRoleLabel(role)}</span>
            <span>{dashboardClock.date}</span>
          </div>
          {primaryAction && (
            <button
              type="button"
              onClick={() => primaryAction.module ? handleNav(primaryAction.module, primaryAction.path) : handleRoute(primaryAction.path)}
              className="dashboard-primary-action"
            >
              {primaryAction.icon}
              <span>{primaryAction.title}</span>
            </button>
          )}
        </div>
      </section>

      {/* ── P1 · Needs attention now ─────────────────────────────────────── */}
      {focusItems.length > 0 ? (
        <section className="dashboard-panel overflow-hidden">
          <CardHeader title="Needs attention" sub="Overdue items, approvals, and blockers — most urgent first" />
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {focusItems.map(item => (
              <button
                type="button"
                key={item.key}
                onClick={item.path ? () => (item.module ? handleNav(item.module, item.path) : handleRoute(item.path)) : undefined}
                className={`dashboard-alert dashboard-alert-${item.tone} ${item.path ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span className="dashboard-alert-dot" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[var(--text-1)] truncate">{item.title}</span>
                  <span className="block text-[10px] text-[var(--text-3)] mt-1 truncate">{item.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="dashboard-all-clear">
          <div className="dashboard-all-clear-icon"><Fa icon={faCircleCheck} /></div>
          <div>
            <p className="text-xs font-extrabold text-[var(--text-1)]">You&apos;re all caught up</p>
            <p className="text-[10px] text-[var(--text-3)] mt-0.5">No overdue approvals, blockers, or urgent exceptions for your role.</p>
          </div>
        </div>
      )}

      {/* ── P2 · Today's workload ────────────────────────────────────────── */}
      <SectionLabel label={`${formatRoleLabel(role)} overview`} />
      <div className="dashboard-kpi-grid">
        {kpis.map(({ key, ...kpi }) => (
          canShowDashboardKpi(currentUser, key) ? <KpiCard key={key} {...kpi} /> : null
        ))}
      </div>

      {(canSeeInventory || canSeeWorkshop) && (
        <>
          <SectionLabel label="Operational overview" />
          <div className="dashboard-workspace-grid">
            {canSeeInventory && (
              <section className="dashboard-panel overflow-hidden">
                <CardHeader title="Stock health" sub="Products below their safe stock level" />
                <div className="p-4 flex flex-col gap-2.5">
                  {inventoryStats.lowStockItems.slice(0, 6).map(p => {
                    const isOut = p.stockQty === 0
                    return (
                      <div key={p.id} className="dashboard-list-row">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`dashboard-row-symbol ${isOut ? 'is-danger' : 'is-warning'}`}>SKU</div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[var(--text-1)] truncate">{p.name}</p>
                            <p className="text-[10px] text-[var(--text-3)] truncate">{p.category}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-[var(--text-2)]">{p.stockQty}/{p.minStock}</span>
                          <Badge status={isOut ? 'cancelled' : 'pending'} label={isOut ? 'Out' : 'Low'} />
                        </div>
                      </div>
                    )
                  })}
                  {inventoryStats.lowStockItems.length === 0 && <EmptyState message="All visible stock levels are healthy" />}
                </div>
              </section>
            )}

            {canSeeWorkshop && (
              <section className="dashboard-panel overflow-hidden">
                <CardHeader title={isTechnician ? 'My repair queue' : 'Workshop queue'} sub={isTechnician ? 'Jobs currently assigned to you' : 'Active service work and ownership'} />
                <div className="p-4 flex flex-col gap-2.5">
                  {visibleRepairs.slice(0, 6).map(r => (
                    <button type="button" key={r.id} onClick={() => handleNav('repair', '/repairs')} className="dashboard-list-row text-left">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="dashboard-row-symbol is-repair"><Fa icon={faScrewdriverWrench} /></div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[var(--text-1)] truncate">{r.ref} · {r.productName}</p>
                          <p className="text-[10px] text-[var(--text-3)] truncate">{r.customerName}{r.assignedTechnicianName ? ` · ${r.assignedTechnicianName}` : ''}</p>
                        </div>
                      </div>
                      <Badge status={r.status === 'ready' || r.status === 'closed' ? 'active' : r.status === 'cancelled' ? 'cancelled' : 'pending'} label={r.status.replace(/_/g, ' ')} />
                    </button>
                  ))}
                  {visibleRepairs.length === 0 && <EmptyState message={isTechnician ? 'No jobs assigned to you yet' : 'No repair jobs require attention'} />}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      {/* ── P3 · Trends & analytics (progressive disclosure) ─────────────── */}
      {(sections.salesAnalytics || sections.inventoryOverview || sections.repairRevenue) && (
        <>
          <SectionLabel label="Trends & analytics" />
          <div className="dashboard-analytics-grid">
            {sections.salesAnalytics && has('sales') && (
              <CollapsibleSection id="sales_analytics" title="Sales analytics" sub="Revenue, pipeline, products and customers" accent="#6366F1" icon={<Fa icon={faClipboardList} />}>
                <div className="p-3 sm:p-4"><SalesAnalytics /></div>
              </CollapsibleSection>
            )}

            {sections.salesAnalytics && has('sales') && (
              <CollapsibleSection id="rep_performance" title="Rep performance" sub="Targets, attainment and leaderboard" accent="#A855F7" icon={<Fa icon={faUsers} />}>
                <div className="p-3 sm:p-4"><RepPerformance /></div>
              </CollapsibleSection>
            )}

            {sections.inventoryOverview && (
              <CollapsibleSection id="inventory_overview" title="Inventory overview" sub={canSeeFinance ? 'Cost-basis stock value by category' : 'Physical stock by category'} accent="#F59E0B" icon={<Fa icon={faBoxesStacked} />}>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  {ALL_CATEGORIES.map(cat => {
                    const prods = products.filter(p => p.category === cat && p.isActive)
                    const val = prods.reduce((a, p) => a + p.costPrice * p.stockQty, 0)
                    const qty = prods.reduce((a, p) => a + p.stockQty, 0)
                    const color = CATEGORY_COLORS[cat] ?? '#6B7280'
                    return (
                      <div key={cat} className="dashboard-category-card">
                        <p className="text-[9px] font-bold tracking-wide truncate" style={{ color }}>{cat}</p>
                        <p className="text-sm font-extrabold text-[var(--text-1)]">{canSeeFinance ? fmtKes(val) : `${qty} units`}</p>
                        <p className="text-[9px] text-[var(--text-4)]">{prods.length} items · {qty} units</p>
                      </div>
                    )
                  })}
                </div>
              </CollapsibleSection>
            )}

            {sections.repairRevenue && (
              <CollapsibleSection id="repair_revenue" title="Revenue split · Sales vs repairs" sub={`Paid invoices, last 6 months · Repair MoM ${techLeadStats.revenueChange >= 0 ? '+' : ''}${techLeadStats.revenueChange.toFixed(1)}%`} accent="#047857" icon={<Fa icon={faMoneyBillWave} />}>
                <div className="p-5 flex flex-col gap-4">
                  {/* High-contrast legend: deep blue for sales, deep green for repairs */}
                  <div className="flex items-center gap-5 flex-wrap">
                    {[
                      { label: 'Actual sales', color: '#1D4ED8' },
                      { label: 'Repair revenue', color: '#047857' },
                    ].map(item => (
                      <span key={item.label} className="flex items-center gap-2 text-[11px] font-bold text-[var(--text-1)]">
                        <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: item.color }} />
                        {item.label}
                      </span>
                    ))}
                  </div>
                  {techLeadStats.monthlyRepairRevenue.map((m, i) => {
                    const isCurrent = i === 5
                    const rows = [
                      { key: 'sales', value: m.salesRevenue, count: m.salesCount, color: isCurrent ? '#1E40AF' : '#1D4ED8' },
                      { key: 'repair', value: m.revenue, count: m.count, color: isCurrent ? '#065F46' : '#047857' },
                    ]
                    return (
                      <div key={m.label}>
                        <div className="flex justify-between mb-1.5 text-[11px]">
                          <span className="font-extrabold text-[var(--text-1)]">
                            {m.label}{isCurrent ? ' · current' : ''}
                          </span>
                          <span className="font-bold font-mono text-[var(--text-1)]">{fmtKes(m.salesRevenue + m.revenue)}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          {rows.map(row => (
                            <div key={row.key} className="flex items-center gap-2">
                              <div className="h-2.5 flex-1 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                                  style={{
                                    width: `${Math.min(100, (row.value / techLeadStats.maxMonthlyRevenue) * 100)}%`,
                                    background: row.color,
                                  }}
                                />
                              </div>
                              <span className="w-28 text-right font-mono text-[11px] font-bold" style={{ color: row.color }}>{fmtKes(row.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-1 pt-3 border-t border-[var(--border-lt)]">
                    {[
                      { label: 'Sales this month', value: fmtKes(techLeadStats.salesRevenueThisMonth), color: '#1D4ED8' },
                      { label: 'Repairs this month', value: fmtKes(techLeadStats.repairRevenueThisMonth), color: '#047857' },
                      { label: 'Repair share', value: `${techLeadStats.repairShareThisMonth}%`, color: 'var(--text-1)' },
                      { label: 'Repair MoM', value: `${techLeadStats.revenueChange >= 0 ? '+' : ''}${techLeadStats.revenueChange.toFixed(1)}%`, color: techLeadStats.revenueChange >= 0 ? '#047857' : '#B91C1C' },
                    ].map(item => (
                      <div key={item.label} className="dashboard-category-card">
                        <p className="text-[9px] font-bold text-[var(--text-3)] uppercase tracking-wide">{item.label}</p>
                        <p className="text-sm font-extrabold mt-1" style={{ color: item.color }}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}
          </div>
        </>
      )}

      {/* ── P4 · Shortcuts & activity ────────────────────────────────────── */}
      <SectionLabel label="Work faster" />
      <div className="dashboard-bottom-grid">
        <section className="dashboard-panel overflow-hidden lg:col-span-8">
          <CardHeader title="Quick actions" sub="Shortcuts selected for your role and permissions" />
          <div className="p-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
            {quickActions.map(action => (
              <button
                type="button"
                key={action.key}
                onClick={() => action.module ? handleNav(action.module, action.path) : handleRoute(action.path)}
                className="dashboard-quick-action"
              >
                <div className="dashboard-quick-icon" style={{ color: action.color, background: action.color + '12' }}>
                  {action.icon}
                </div>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[var(--text-1)] truncate">{action.title}</span>
                  <span className="block text-[10px] text-[var(--text-4)] mt-1 leading-snug line-clamp-2">{action.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="lg:col-span-4 flex flex-col gap-5">
          <section className="dashboard-panel overflow-hidden">
            <CardHeader title="My self-service" sub="Your personal workspace" />
            <div className="p-4 grid grid-cols-2 gap-2.5">
              {[
                { label: 'Leave', value: selfServiceStats.myLeave.length, path: '/hr?tab=leave', module: 'hr' as ModuleId },
                { label: 'Payslip', value: 'View', path: '/hr?tab=payroll', module: 'hr' as ModuleId },
                { label: 'Targets', value: 'View', path: '/hr?tab=performance', module: 'hr' as ModuleId },
                { label: 'Expenses', value: selfServiceStats.myExpenseClaims.length, path: '/expenses', module: 'expenses' as ModuleId },
              ].filter(item => has(item.module)).map(item => (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => handleNav(item.module, item.path)}
                  className="dashboard-self-service"
                >
                  <span className="text-base font-extrabold text-primary-600">{item.value}</span>
                  <span className="text-[9px] font-bold text-[var(--text-4)]">{item.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="dashboard-panel overflow-hidden flex-1">
            <CardHeader title="Recent activity" sub="Records visible to your role" />
            <div className="divide-y divide-[var(--border-lt)]">
              {activity.slice(0, 5).map(item => (
                <div key={`${item.title}-${item.date}`} className="dashboard-activity-row">
                  <div className="dashboard-activity-icon" style={{ background: item.color + '12', color: item.color }}>
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-[var(--text-1)] truncate">{item.title}</p>
                    <p className="text-[9px] text-[var(--text-3)] mt-0.5 truncate">{item.sub}</p>
                  </div>
                  <span className="text-[9px] text-[var(--text-4)] flex-shrink-0">{fmtDate(item.date)}</span>
                </div>
              ))}
              {activity.length === 0 && <EmptyState message="No recent activity is available for your role" />}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
