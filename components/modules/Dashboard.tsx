// @ts-nocheck
'use client'

import { useMemo, useCallback, useState } from 'react'
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
import { dashboardSectionsForRole } from '@/lib/dashboard-priority'
import { buildFinanceAlerts, computeCashbookTotals, cashPositionFromTotals } from '@/lib/finance-alerts'
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
      onClick={onClick}
      className="card text-left w-full flex flex-col justify-between p-4 sm:p-5 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 min-h-[110px] relative overflow-hidden"
      style={{ cursor: onClick ? 'pointer' : 'default', borderTop: `3px solid ${color}` }}
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
          className={`text-xl sm:text-2xl font-extrabold leading-none mb-1.5 truncate ${isCurrency ? 'font-mono tracking-tight' : ''}`}
          style={{ color }}
        >
          {isCurrency && typeof value === 'number' ? fmtKes(value) : value}
        </p>
        <p className="text-[11px] text-[var(--text-4)] leading-snug line-clamp-2 sm:truncate">{sub}</p>
      </div>
    </button>
  )
}

function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[var(--border-lt)] gap-2 sm:gap-0">
      <div className="min-w-0 pr-2">
        <p className="text-xs font-bold text-[var(--text-1)] truncate">{title}</p>
        {sub && <p className="text-[10px] text-[var(--text-3)] mt-0.5 truncate">{sub}</p>}
      </div>
      {action && <div className="flex-shrink-0 self-start sm:self-auto">{action}</div>}
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-2">
      <span className="w-0.5 h-3 bg-primary-500 rounded-full inline-block flex-shrink-0" />
      <p className="text-[9px] font-bold tracking-[1.1px] uppercase text-[var(--text-4)]">{label}</p>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>
        <Fa icon={faCircleCheck} />
      </div>
      <p className="text-xs text-[var(--text-4)]">{message}</p>
    </div>
  )
}

// Progressive disclosure for secondary (P3/P4) content: summary always
// visible, body rendered only when expanded. The choice is remembered per
// section so users who never want the detail never load it.
function CollapsibleSection({ id, title, sub, defaultOpen = false, children }: {
  id: string; title: string; sub?: string; defaultOpen?: boolean; children: ReactNode
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
    <div className="card overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between px-4 sm:px-5 py-3.5 text-left hover:bg-[var(--bg-surface)] transition-colors" aria-expanded={open}>
        <div className="min-w-0 pr-2">
          <p className="text-xs font-bold text-[var(--text-1)] truncate">{title}</p>
          {sub && <p className="text-[10px] text-[var(--text-3)] mt-0.5 truncate">{sub}</p>}
        </div>
        <span className="text-[10px] font-bold text-primary-600 flex-shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="border-t border-[var(--border-lt)]">{children}</div>}
    </div>
  )
}

export function Dashboard() {
  const mounted = useMounted()
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
  const role = currentUser?.role ?? 'sales_rep'
  const myModules = useMemo(() => new Set(currentUser?.modules ?? []), [currentUser?.modules])
  const has = useCallback((m: ModuleId) => myModules.has(m), [myModules])

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
  const sections = useMemo(() => dashboardSectionsForRole(role), [role])
  const canSeeFinance = sections.finance
  const canSeeSales = sections.sales
  const canSeeInventory = sections.inventory
  const canSeeWorkshop = sections.workshop
  const canSeePurchasing = sections.purchasing
  const canSeeKilimall = sections.kilimall
  const canSeeHRAdmin = sections.hrAdmin

  const visibleSalesOrders = useMemo(() => {
    if (isSalesRep) return saleOrders.filter(s => s.createdByUserId === currentUserId)
    if (canSeeSales) return saleOrders
    return []
  }, [saleOrders, currentUserId, isSalesRep, canSeeSales])

  const visibleRepairs = useMemo(() => {
    if (isTechnician) return repairs.filter(r => r.assignedTechnicianId === currentUserId)
    if (canSeeWorkshop) return repairs
    return []
  }, [repairs, currentUserId, isTechnician, canSeeWorkshop])

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
    const pipeline = [
      { stage: 'Quotation', count: 0, value: 0, color: '#F59E0B' },
      { stage: 'Confirmed', count: 0, value: 0, color: '#3B82F6' },
      { stage: 'Delivered', count: 0, value: 0, color: '#8B5CF6' },
      { stage: 'Invoiced', count: 0, value: 0, color: '#10B981' },
    ]
    const myQuotes = visibleSalesOrders.filter(s => s.status === 'quotation')
    const wonOrders = visibleSalesOrders.filter(s => s.status === 'confirmed')

    for (const order of visibleSalesOrders) {
      if (order.status === 'cancelled') continue
      const index = order.status === 'quotation' ? 0 : order.status === 'confirmed' ? 1 : order.status === 'delivered' ? 2 : order.status === 'invoiced' ? 3 : -1
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
      openOrders: visibleSalesOrders.filter(s => ['quotation', 'confirmed', 'delivered'].includes(s.status)).length,
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
    const unassigned = repairs.filter(r => r.status === 'received' && !r.assignedTechnicianId)

    return { active, awaitingParts, inQc, ready, urgent, unassigned }
  }, [visibleRepairs, repairs])

  const techLeadStats = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      return {
        year: d.getFullYear(),
        month: d.getMonth(),
        label: d.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' }),
        revenue: 0,
        count: 0,
      }
    })

    for (const inv of invoices) {
      if (!(inv as any).repairId || inv.status !== 'paid') continue
      const d = new Date(inv.date)
      const slot = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth())
      if (slot) { slot.revenue += inv.total; slot.count++ }
    }

    const repairRevenueThisMonth = months[5].revenue
    const repairRevenueLastMonth = months[4].revenue
    const revenueChange = repairRevenueLastMonth > 0
      ? ((repairRevenueThisMonth - repairRevenueLastMonth) / repairRevenueLastMonth) * 100
      : repairRevenueThisMonth > 0 ? 100 : 0
    const maxMonthlyRevenue = Math.max(...months.map(m => m.revenue), 1)

    return { monthlyRepairRevenue: months, repairRevenueThisMonth, repairRevenueLastMonth, revenueChange, maxMonthlyRevenue }
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
    const pendingLeave = canSeeHRAdmin
      ? leaveRequests.filter(l => l.status === 'pending_hr').length
      : myLeave.filter(l => l.status === 'pending_hr').length
    const myExpenseClaims = expenses.filter(e => e.submittedByUserId === currentUserId)
    const pendingExpenseClaims = expenses.filter(e => e.status === 'submitted')
    const pendingPayroll = payrollRuns.filter(p => p.status === 'pending_approval')

    return { myLeave, pendingLeave, myExpenseClaims, pendingExpenseClaims, pendingPayroll }
  }, [leaveRequests, currentEmployee?.id, canSeeHRAdmin, expenses, currentUserId, payrollRuns])

  const kpis = useMemo<KpiConfig[]>(() => {
    if (isDirector) {
      return [
        { key: 'revenue', label: 'Revenue Paid', value: financeStats.revenue, sub: 'Company-wide collections', color: '#10B981', icon: <Fa icon={faMoneyBillWave} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
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
      const pipelineValue = visibleSalesOrders
        .filter(s => ['quotation', 'confirmed', 'delivered'].includes(s.status))
        .reduce((sum, s) => sum + s.total, 0)
      const invoicedThisMonth = visibleSalesOrders
        .filter(s => s.status === 'invoiced' && new Date(s.date).getMonth() === new Date().getMonth() && new Date(s.date).getFullYear() === new Date().getFullYear())
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
    if (canSeePurchasing) actions.unshift({ key: 'purchase', title: 'Purchase Workflow', desc: 'POs and goods receiving follow-up', module: 'purchase', path: '/purchases', color: '#DC2626', icon: <Fa icon={faArrowDown} /> })

    return actions.filter(a => !a.module || has(a.module)).slice(0, 8)
  }, [canSeeFinance, canSeeSales, canSeeInventory, canSeeKilimall, canSeeWorkshop, canSeePurchasing, isSalesRep, isTechnician, has])

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

    if (canSeeHRAdmin && selfServiceStats.pendingLeave > 0) {
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
      const pendingSignOff = saleOrders.filter(s => s.status === 'pending_approval')
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
    return items.sort((a, b) => (rank[a.tone] ?? 3) - (rank[b.tone] ?? 3)).slice(0, 8)
  }, [canSeeFinance, canSeeHRAdmin, canSeeInventory, isDirector, isInventoryOfficer, isAdminOfficer, isKilimallOfficer, canSeeWorkshop, isTechnicalLead, isSalesRep, financeDeskStats, selfServiceStats, inventoryStats, kilimallStats, repairStats, salesStats, leaveRequests, saleOrders, deposits])

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

    expenses.filter(e => e.submittedByUserId === currentUserId).slice(-3).forEach(e => list.push({ title: `My expense ${e.ref}`, sub: `${fmtKes(e.amount)} · ${e.status}`, date: e.submittedDate, color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} /> }))

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8)
  }, [canSeeFinance, canSeeSales, canSeeInventory, canSeeKilimall, canSeeWorkshop, invoices, visibleSalesOrders, stockTransfers, purchaseOrders, kilimallOrders, visibleRepairs, expenses, currentUserId])

  const primaryAction = quickActions.find(a => a.key !== 'account') ?? quickActions[0]

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-primary-500/10 flex items-center justify-center text-primary-600 text-xl sm:text-2xl font-bold border border-primary-500/20">
            {currentUser?.name?.slice(0, 1).toUpperCase() || '?'}
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-[var(--text-1)]">
              Welcome back, {currentUser?.name?.split(' ')[0] || 'there'}!
            </h1>
            <p className="text-xs text-[var(--text-3)]">
              {formatRoleLabel(role)} dashboard · {new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>
        {primaryAction && (
          <button
            onClick={() => primaryAction.module ? handleNav(primaryAction.module, primaryAction.path) : handleRoute(primaryAction.path)}
            className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold transition-all shadow-lg shadow-primary-500/20 flex items-center justify-center gap-2"
          >
            {primaryAction.icon}
            <span>{primaryAction.title}</span>
          </button>
        )}
      </div>

      {/* ── P1 · Needs attention now ─────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <CardHeader title="Needs Attention" sub="Overdue items, approvals, and blockers — most urgent first" />
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {focusItems.map(item => (
            <button
              key={item.key}
              onClick={item.path ? () => (item.module ? handleNav(item.module, item.path) : handleRoute(item.path)) : undefined}
              className={`p-3 rounded-xl border text-left transition-all ${item.path ? 'hover:shadow-md cursor-pointer' : 'cursor-default'} ${item.tone === 'danger' ? 'bg-red-50 border-red-100' : item.tone === 'warn' ? 'bg-amber-50 border-amber-100' : 'bg-blue-50 border-blue-100'}`}
            >
              <p className="text-xs font-bold text-[var(--text-1)] truncate">{item.title}</p>
              <p className="text-[10px] text-[var(--text-3)] mt-0.5 truncate">{item.sub}</p>
            </button>
          ))}
          {focusItems.length === 0 && (
            <div className="sm:col-span-2"><EmptyState message="Nothing urgent for your role right now" /></div>
          )}
        </div>
      </div>

      {/* ── P2 · Today's workload ────────────────────────────────────────── */}
      <SectionLabel label={`${formatRoleLabel(role)} workload`} />
      <div className="kpi-grid-compact">
        {kpis.map(({ key, ...kpi }) => <KpiCard key={key} {...kpi} />)}
      </div>

      {(canSeeInventory || canSeeWorkshop) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {canSeeInventory && (
            <div className="card overflow-hidden">
              <CardHeader title="Stock Health" sub="Physical-stock alerts only" />
              <div className="p-4 flex flex-col gap-3">
                {inventoryStats.lowStockItems.slice(0, 6).map(p => {
                  const isOut = p.stockQty === 0
                  return (
                    <div key={p.id} className={`flex items-center justify-between p-3 rounded-xl border ${isOut ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white/70 flex items-center justify-center text-[10px] font-bold text-[var(--text-3)]">SKU</div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[var(--text-1)] truncate">{p.name}</p>
                          <p className="text-[10px] text-[var(--text-3)] truncate">{p.category}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[10px] font-mono text-[var(--text-2)]">{p.stockQty}/{p.minStock}</span>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isOut ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}`}>{isOut ? 'OUT' : 'LOW'}</span>
                      </div>
                    </div>
                  )
                })}
                {inventoryStats.lowStockItems.length === 0 && <EmptyState message="All visible stock levels are healthy" />}
              </div>
            </div>
          )}

          {canSeeWorkshop && (
            <div className="card overflow-hidden">
              <CardHeader title={isTechnician ? 'My Repair Queue' : 'Workshop Queue'} sub={isTechnician ? 'Assigned jobs only' : 'Repair oversight'} />
              <div className="p-4 flex flex-col gap-3">
                {visibleRepairs.slice(0, 6).map(r => (
                  <button key={r.id} onClick={() => handleNav('repair', '/repairs')} className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-lt)] hover:bg-[var(--bg-surface)] transition-colors text-left">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--text-1)] truncate">{r.ref} · {r.productName}</p>
                      <p className="text-[10px] text-[var(--text-3)] truncate">{r.customerName}{r.assignedTechnicianName ? ` · ${r.assignedTechnicianName}` : ''}</p>
                    </div>
                    <Badge status={r.status === 'ready' || r.status === 'closed' ? 'active' : r.status === 'cancelled' ? 'cancelled' : 'pending'} label={r.status.replace(/_/g, ' ')} />
                  </button>
                ))}
                {visibleRepairs.length === 0 && <EmptyState message={isTechnician ? 'No jobs assigned to you yet' : 'No repair jobs require attention'} />}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── P3 · Trends & analytics (progressive disclosure) ─────────────── */}
      {(sections.salesAnalytics || sections.inventoryOverview || sections.repairRevenue) && (
        <SectionLabel label="Trends & analytics" />
      )}

      {sections.salesAnalytics && has('sales') && (
        <CollapsibleSection id="sales_analytics" title="Sales Analytics" sub="Revenue trend, pipeline funnel, top products and customers">
          <div className="p-3 sm:p-4"><SalesAnalytics /></div>
        </CollapsibleSection>
      )}

      {sections.salesAnalytics && has('sales') && (
        <CollapsibleSection id="rep_performance" title="Rep Performance" sub="Sales rep leaderboard, targets, and attainment">
          <div className="p-3 sm:p-4"><RepPerformance /></div>
        </CollapsibleSection>
      )}

      {sections.inventoryOverview && (
        <CollapsibleSection id="inventory_overview" title="Inventory Overview" sub={canSeeFinance ? 'Cost-basis stock value by category' : 'Physical stock by category'}>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {ALL_CATEGORIES.map(cat => {
              const prods = products.filter(p => p.category === cat && p.isActive)
              const val = prods.reduce((a, p) => a + p.costPrice * p.stockQty, 0)
              const qty = prods.reduce((a, p) => a + p.stockQty, 0)
              const color = CATEGORY_COLORS[cat] ?? '#6B7280'
              return (
                <div key={cat} className="flex flex-col gap-2 p-4 rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)]">
                  <p className="text-[9px] font-bold uppercase tracking-wider truncate" style={{ color }}>{cat}</p>
                  <p className="text-sm font-extrabold text-[var(--text-1)]">{canSeeFinance ? fmtKes(val) : `${qty} units`}</p>
                  <p className="text-[9px] text-[var(--text-4)]">{prods.length} items · {qty} units</p>
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      )}

      {sections.repairRevenue && (
        <CollapsibleSection id="repair_revenue" title="Monthly Repair Revenue" sub={`Paid repair invoices · last 6 months · MoM ${techLeadStats.revenueChange >= 0 ? '+' : ''}${techLeadStats.revenueChange.toFixed(1)}%`}>
          <div className="p-5 flex flex-col gap-4">
            {techLeadStats.monthlyRepairRevenue.map((m, i) => {
              const isCurrent = i === 5
              return (
                <div key={m.label}>
                  <div className="flex justify-between mb-1.5 text-[11px]">
                    <span className={`font-bold ${isCurrent ? 'text-primary-600' : 'text-[var(--text-2)]'}`}>
                      {m.label}{isCurrent ? ' ·  current' : ''}
                    </span>
                    <div className="flex gap-4">
                      <span className="text-[var(--text-4)]">{m.count} invoice{m.count !== 1 ? 's' : ''}</span>
                      <span className={`font-bold font-mono ${isCurrent ? 'text-primary-600' : 'text-[var(--text-2)]'}`}>{fmtKes(m.revenue)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: `${techLeadStats.maxMonthlyRevenue > 0 ? Math.min(100, (m.revenue / techLeadStats.maxMonthlyRevenue) * 100) : 0}%`,
                        background: isCurrent ? 'var(--navy)' : '#8B5CF6',
                      }}
                    />
                  </div>
                </div>
              )
            })}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1 pt-3 border-t border-[var(--border-lt)]">
              <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-4)]">This Month</p>
                <p className="text-sm font-extrabold text-primary-600 mt-1 font-mono">{fmtKes(techLeadStats.repairRevenueThisMonth)}</p>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-4)]">Last Month</p>
                <p className="text-sm font-extrabold text-[var(--text-1)] mt-1 font-mono">{fmtKes(techLeadStats.repairRevenueLastMonth)}</p>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-4)]">MoM Change</p>
                <p className={`text-sm font-extrabold mt-1 ${techLeadStats.revenueChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {techLeadStats.revenueChange >= 0 ? '+' : ''}{techLeadStats.revenueChange.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* ── P4 · Shortcuts & self-service ────────────────────────────────── */}
      <SectionLabel label="Shortcuts & self-service" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card overflow-hidden lg:col-span-2">
          <CardHeader title="Role Shortcuts" sub="Only actions available to your role are shown here" />
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {quickActions.map(action => (
              <button
                key={action.key}
                onClick={() => action.module ? handleNav(action.module, action.path) : handleRoute(action.path)}
                className="text-left p-4 rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ color: action.color, background: action.color + '15' }}>
                  {action.icon}
                </div>
                <p className="text-xs font-bold text-[var(--text-1)]">{action.title}</p>
                <p className="text-[10px] text-[var(--text-4)] mt-1 leading-snug">{action.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <CardHeader title="My Self-Service" sub="Available to every active user" />
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { label: 'Leave', value: selfServiceStats.myLeave.length, path: '/hr?tab=leave', module: 'hr' as ModuleId },
              { label: 'Payslip', value: 'View', path: '/hr?tab=payroll', module: 'hr' as ModuleId },
              { label: 'Targets', value: 'View', path: '/hr?tab=performance', module: 'hr' as ModuleId },
              { label: 'Expenses', value: selfServiceStats.myExpenseClaims.length, path: '/expenses', module: 'expenses' as ModuleId },
            ].map(item => (
              <button
                key={item.label}
                onClick={() => handleNav(item.module, item.path)}
                className="p-3 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] text-center hover:border-primary-300 transition-colors"
              >
                <p className="text-lg font-extrabold text-primary-600">{item.value}</p>
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-4)]">{item.label}</p>
              </button>
            ))}
            <button
              onClick={() => handleRoute('/account/password-change')}
              className="col-span-2 p-3 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] text-center hover:border-primary-300 transition-colors"
            >
              <p className="text-xs font-bold text-primary-600">Account Settings</p>
              <p className="text-[10px] text-[var(--text-4)]">Update your password</p>
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <CardHeader title="Recent Activity" sub="Limited to records visible to your role" />
        <div className="divide-y divide-[var(--border-lt)]">
          {activity.map((item, index) => (
            <div key={`${item.title}-${index}`} className="flex items-start gap-4 p-4 hover:bg-[var(--bg-surface)] transition-colors">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm flex-shrink-0" style={{ background: item.color + '15', color: item.color }}>
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[var(--text-1)] truncate">{item.title}</p>
                <p className="text-[10px] text-[var(--text-3)] mt-0.5 truncate">{item.sub}</p>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <span className="text-[10px] text-[var(--text-4)]">{fmtDate(item.date)}</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: item.color }} />
              </div>
            </div>
          ))}
          {activity.length === 0 && <EmptyState message="No recent activity is available for your role" />}
        </div>
      </div>
    </div>
  )
}

export default Dashboard
