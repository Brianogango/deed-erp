// @ts-nocheck
'use client'

import { useMemo, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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

import { useApp, useStoreHydrated, fmtKes, fmtDate, ALL_CATEGORIES, ModuleId } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Badge, ModuleSkeleton, useMounted } from '@/components/ui'
import { useRouteDataReady } from '@/lib/route-data-ready'
import { formatRoleLabel } from '@/lib/auth/access'
import {
  canShowDashboardKpi,
  dashboardSectionsForUser,
  hasExplicitModuleGrant,
  visibleDashboardRepairs,
  visibleDashboardSalesOrders,
} from '@/lib/dashboard-priority'
import { buildFinanceAlerts, computeCashbookTotals, cashPositionFromTotals } from '@/lib/finance-alerts'
import { saleOrderInvoiceStatus, invoiceDocState, invoicePaymentStatus, isOpenInvoice, invoiceResidual, isInvoiceOverdue } from '@/lib/odoo-sales-flow'
import { onHandQtyAtStockLocations } from '@/lib/business-logic'
import { isStockTracked, inferTrackingMethod } from '@/lib/inventory-identifiers'
import { computeLowStockItems } from '@/lib/kpi-stock'
import { isOpenRepairJob } from '@/lib/repair-progress'
import { buildCashbookEntries } from '@/components/modules/Cashbook'
import { Fa } from '@/components/icons'
import { OnboardingChecklist } from '@/components/erp/OnboardingChecklist'

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
      } as React.CSSProperties}
    >
      <div className="dashboard-stat-layout">
        <div className="dashboard-stat-icon" aria-hidden="true">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="dashboard-stat-label">{label}</p>
          <p
            className={`dashboard-stat-value ${isCurrency ? 'is-currency' : ''}`}
            title={isCurrency && typeof value === 'number' ? fmtKes(value) : String(value)}
          >
            {isCurrency && typeof value === 'number' ? fmtKes(value) : value}
          </p>
          <p className="dashboard-stat-sub">{sub}</p>
        </div>
      </div>
      <span className="dashboard-stat-accent" aria-hidden="true" />
    </button>
  )
}

function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="dashboard-card-header flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-5 py-2.5 sm:py-4 border-b border-[var(--border-lt)] gap-1 sm:gap-0">
      <div className="min-w-0 pr-2">
        <h3 className="text-[13px] sm:text-[15px] font-extrabold text-[var(--text-1)] truncate">{title}</h3>
        {sub && <p className="hidden sm:block text-xs text-[var(--text-3)] mt-0.5 truncate">{sub}</p>}
      </div>
      {action && <div className="flex-shrink-0 self-start sm:self-auto">{action}</div>}
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return <h2 className="dashboard-section-title">{label}</h2>
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-6 flex flex-col items-center justify-center gap-2.5 text-center">
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-base" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>
        <Fa icon={faCircleCheck} />
      </div>
      <p className="text-sm text-[var(--text-4)] leading-relaxed">{message}</p>
    </div>
  )
}

// Progressive disclosure for secondary (P3/P4) content: summary always
// visible, body rendered only when expanded. The choice is remembered per
// section so users who never want the detail never load it.
function CollapsibleSection({ id, title, sub, defaultOpen = false, accent = 'var(--primary)', icon, children }: {
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
      <button type="button" onClick={toggle} className="dashboard-insight-trigger w-full flex items-center justify-between gap-2 sm:gap-3 p-2.5 sm:p-4 text-left" aria-expanded={open}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="dashboard-insight-icon" aria-hidden="true">{icon}</div>
          <div className="min-w-0 pr-1 sm:pr-2">
            <h3 className="text-[13px] sm:text-sm font-extrabold text-[var(--text-1)] truncate">{title}</h3>
            {sub && <p className="hidden sm:block text-xs text-[var(--text-3)] mt-1 truncate">{sub}</p>}
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
  useStoreHydrated()
  const pathname = usePathname()
  const routeReady = useRouteDataReady(pathname || '/')
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
    journalEntries,
    bankAccounts,
    bankStatementLines,
    companySettings,
    serials,
    bulkStock,
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
        if (invoicePaymentStatus(invoice) === 'paid') revenue += invoice.total
        if (isOpenInvoice(invoice)) {
          outstanding += invoiceResidual(invoice)
          if (isInvoiceOverdue(invoice)) overdueInvoices.push(invoice)
        }
      }
      if (invoice.type === 'vendor_bill' && isOpenInvoice(invoice)) {
        payables += invoiceResidual(invoice)
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

  const salesIntelligenceStats = useMemo(() => {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth()
    const startOfToday = new Date(currentYear, currentMonth, now.getDate()).getTime()
    const sevenDaysFromNow = startOfToday + 7 * 86400000
    const sevenDaysAgo = startOfToday - 7 * 86400000
    const visibleOrderIds = new Set(visibleSalesOrders.map(order => order.id))
    const isThisMonth = (value?: string) => {
      const date = new Date(value || '')
      return Number.isFinite(date.getTime()) && date.getFullYear() === currentYear && date.getMonth() === currentMonth
    }
    const currentOrders = visibleSalesOrders.filter(order => isThisMonth(order.date))
    const currentCustomerInvoices = invoices.filter(invoice =>
      invoice.type === 'customer_invoice'
      && !(invoice as any).repairId
      && invoice.saleOrderId
      && visibleOrderIds.has(invoice.saleOrderId)
      && invoiceDocState(invoice.status) === 'posted'
      && isThisMonth(invoice.date),
    )
    const quotedOrders = currentOrders.filter(order => order.status === 'quotation' || order.status === 'quotation_sent')
    const confirmedOrders = currentOrders.filter(order => order.status === 'sale')
    const quotedValue = quotedOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0)
    const confirmedValue = confirmedOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0)
    const invoicedValue = currentCustomerInvoices.reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0)
    const collectedValue = currentCustomerInvoices.reduce((sum, invoice) => {
      return sum + Math.min(Number(invoice.total) || 0, Math.max(0, Number(invoice.amountPaid) || 0))
    }, 0)
    const openPipelineValue = currentOrders
      .filter(order => order.status !== 'cancelled' && !['invoiced', 'upselling'].includes(saleOrderInvoiceStatus(order.status, order.lines || [])))
      .reduce((sum, order) => sum + (Number(order.total) || 0), 0)
    const conversionBase = quotedOrders.length + confirmedOrders.length
    const conversionRate = conversionBase > 0 ? Math.round((confirmedOrders.length / conversionBase) * 100) : 0

    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(currentYear, currentMonth - (5 - index), 1)
      return {
        year: date.getFullYear(),
        month: date.getMonth(),
        label: date.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' }),
        quoted: 0,
        confirmed: 0,
        collected: 0,
      }
    })
    for (const order of visibleSalesOrders) {
      if (order.status === 'cancelled') continue
      const date = new Date(order.date)
      const bucket = months.find(month => month.year === date.getFullYear() && month.month === date.getMonth())
      if (!bucket) continue
      if (order.status === 'quotation' || order.status === 'quotation_sent') bucket.quoted += Number(order.total) || 0
      if (order.status === 'sale') bucket.confirmed += Number(order.total) || 0
    }
    for (const invoice of invoices) {
      if (
        invoice.type !== 'customer_invoice'
        || (invoice as any).repairId
        || !invoice.saleOrderId
        || !visibleOrderIds.has(invoice.saleOrderId)
        || invoiceDocState(invoice.status) !== 'posted'
      ) continue
      const date = new Date(invoice.date)
      const bucket = months.find(month => month.year === date.getFullYear() && month.month === date.getMonth())
      if (!bucket) continue
      bucket.collected += Math.min(Number(invoice.total) || 0, Math.max(0, Number(invoice.amountPaid) || 0))
    }
    const maxTrendValue = Math.max(...months.flatMap(month => [month.quoted, month.confirmed, month.collected]), 1)

    const invoicedOrderIds = new Set(currentCustomerInvoices.map(invoice => invoice.saleOrderId).filter(Boolean))
    const paidOrderIds = new Set(
      currentCustomerInvoices
        .filter(invoice => invoicePaymentStatus(invoice) === 'paid')
        .map(invoice => invoice.saleOrderId)
        .filter(Boolean),
    )
    const funnel = {
      quotations: quotedOrders.length,
      confirmed: confirmedOrders.length,
      invoiced: invoicedOrderIds.size,
      paid: paidOrderIds.size,
    }

    const repMap = new Map<string, { name: string; quotes: number; won: number; revenue: number }>()
    for (const order of currentOrders) {
      if (order.status === 'cancelled') continue
      const id = order.salespersonId || order.createdByUserId || order.salespersonName || order.createdByName || 'unassigned'
      const entry = repMap.get(id) || {
        name: order.salespersonName || order.createdByName || users.find(user => user.id === id)?.name || 'Unassigned',
        quotes: 0,
        won: 0,
        revenue: 0,
      }
      if (order.status === 'quotation' || order.status === 'quotation_sent') entry.quotes++
      if (order.status === 'sale') {
        entry.won++
        entry.revenue += Number(order.total) || 0
      }
      repMap.set(id, entry)
    }
    const repPerformance = [...repMap.values()]
      .map(rep => ({
        ...rep,
        conversion: rep.quotes + rep.won > 0 ? Math.round((rep.won / (rep.quotes + rep.won)) * 100) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    const customerMap = new Map<string, number>()
    for (const order of confirmedOrders) {
      const customer = order.customerName || 'Unnamed customer'
      customerMap.set(customer, (customerMap.get(customer) || 0) + (Number(order.total) || 0))
    }
    const topCustomers = [...customerMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    const quoteActions = {
      expiringSoon: quotedOrders.filter(order => {
        const expiry = new Date(order.validUntil || '').getTime()
        return Number.isFinite(expiry) && expiry >= startOfToday && expiry <= sevenDaysFromNow
      }).length,
      agingDrafts: visibleSalesOrders.filter(order => {
        const date = new Date(order.date || '').getTime()
        return order.status === 'quotation' && Number.isFinite(date) && date < sevenDaysAgo
      }).length,
      approvedNotInvoiced: visibleSalesOrders.filter(order =>
        order.status === 'sale'
        && !['invoiced', 'upselling'].includes(saleOrderInvoiceStatus(order.status, order.lines || [])),
      ).length,
      lostThisMonth: visibleSalesOrders.filter(order => order.status === 'cancelled' && isThisMonth(order.date)).length,
    }

    return {
      quotedValue, confirmedValue, invoicedValue, collectedValue, openPipelineValue, conversionRate,
      months, maxTrendValue, funnel, repPerformance, topCustomers, quoteActions,
    }
  }, [invoices, users, visibleSalesOrders])

  const inventoryStats = useMemo(() => {
    // Same input contract as the Operations/Inventory module: stock-tracked,
    // active products only. Passing the raw catalog counted discontinued and
    // non-stock items as "low stock", so Dashboard and Operations disagreed.
    const stockableProducts = products.filter(p => isStockTracked(inferTrackingMethod({
      trackingMethod: p.trackingMethod,
      category: p.category,
      requiresSerial: p.requiresSerial,
      unit: p.unit,
    })) && p.isActive)
    const lowStockItems = computeLowStockItems(stockableProducts, serials, bulkStock)
    const activeSkus = products.filter(p => p.isActive && p.unit !== 'service')
    const totalUnits = activeSkus.reduce((sum, p) => sum + onHandQtyAtStockLocations(p, serials, bulkStock, p.id), 0)
    const pendingReceipts = purchaseOrders.filter(po => ['sent', 'confirmed', 'partial'].includes(po.status)).length
    const draftTransfers = stockTransfers.filter(t => t.status === 'draft').length
    const stockValue = stockableProducts.reduce((sum, p) => sum + p.costPrice * onHandQtyAtStockLocations(p, serials, bulkStock, p.id), 0)

    return { lowStockItems, activeSkus, totalUnits, pendingReceipts, draftTransfers, stockValue }
  }, [products, serials, bulkStock, purchaseOrders, stockTransfers])

  const repairStats = useMemo(() => {
    const active = visibleRepairs.filter(isOpenRepairJob)
    const awaitingParts = active.filter(r => r.status === 'awaiting_parts')
    const inQc = active.filter(r => r.status === 'qc')
    const ready = visibleRepairs.filter(r => r.status === 'ready')
    const urgent = active.filter(r => r.priority === 'urgent' || r.priority === 'high' || r.status === 'approved' || r.status === 'diagnosed')
    const unassigned = visibleRepairs.filter(r => r.status === 'received' && !r.assignedTechnicianId)
    // Jobs sitting in the workshop pipeline past 7 days from intake.
    const agingCutoff = Date.now() - 7 * 86400000
    const aging = active.filter(r => {
      const intake = new Date((r as any).intakeDate ?? (r as any).createdDate ?? 0).getTime()
      return Number.isFinite(intake) && intake > 0 && intake < agingCutoff
    })

    return { active, awaitingParts, inQc, ready, urgent, unassigned, aging }
  }, [visibleRepairs])

  // Repair intelligence is a read-only dashboard projection. Existing paid
  // revenue remains unchanged; the added fields distinguish posted invoice
  // value, recorded collections, residuals and recorded execution costs.
  const techLeadStats = useMemo(() => {
    const now = new Date()
    const visibleRepairIds = new Set(visibleRepairs.map(repair => repair.id))
    const productCostById = new Map(products.map(product => [product.id, Number(product.costPrice) || 0]))
    const repairById = new Map(visibleRepairs.map(repair => [repair.id, repair]))
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
        repairInvoiced: 0,
        repairCollected: 0,
        repairOutstanding: 0,
      }
    })
    const currentRepairInvoices: any[] = []

    for (const inv of invoices) {
      if (inv.type === 'vendor_bill') continue
      const d = new Date(inv.date)
      const slot = months.find(month => month.year === d.getFullYear() && month.month === d.getMonth())
      if (!slot) continue

      const repairId = String((inv as any).repairId || '')
      const isVisibleRepairInvoice = repairId && visibleRepairIds.has(repairId)
      if (isVisibleRepairInvoice) {
        if (invoiceDocState(inv.status) === 'posted') {
          const total = Number(inv.total) || 0
          const collected = Math.min(total, Math.max(0, Number(inv.amountPaid) || 0))
          slot.repairInvoiced += total
          slot.repairCollected += collected
          slot.repairOutstanding += Math.max(0, total - collected)
          if (slot === months[5]) currentRepairInvoices.push(inv)
        }
        if (invoicePaymentStatus(inv) === 'paid') {
          slot.revenue += Number(inv.total) || 0
          slot.count++
        }
      } else if (invoicePaymentStatus(inv) === 'paid') {
        slot.salesRevenue += Number(inv.total) || 0
        slot.salesCount++
      }
    }

    const repairRevenueThisMonth = months[5].revenue
    const repairRevenueLastMonth = months[4].revenue
    const salesRevenueThisMonth = months[5].salesRevenue
    const repairInvoicedThisMonth = months[5].repairInvoiced
    const repairCollectedThisMonth = months[5].repairCollected
    const repairOutstandingThisMonth = months[5].repairOutstanding
    const revenueChange = repairRevenueLastMonth > 0
      ? ((repairRevenueThisMonth - repairRevenueLastMonth) / repairRevenueLastMonth) * 100
      : repairRevenueThisMonth > 0 ? 100 : 0
    const maxMonthlyRevenue = Math.max(...months.map(month => Math.max(month.repairInvoiced, month.repairCollected)), 1)
    const totalThisMonth = repairRevenueThisMonth + salesRevenueThisMonth
    const repairShareThisMonth = totalThisMonth > 0
      ? Math.round((repairRevenueThisMonth / totalThisMonth) * 100)
      : 0

    const currentRepairRecords = [...new Map(
      currentRepairInvoices
        .map(invoice => repairById.get(String(invoice.repairId)))
        .filter(Boolean)
        .map(repair => [repair.id, repair]),
    ).values()]
    const currentRepairRecordIds = new Set(currentRepairRecords.map(repair => repair.id))
    const recordedCostThisMonth = currentRepairRecords.reduce((sum, repair) => {
      const partsCost = (repair.partsUsed || []).reduce((partsSum, part) => {
        return partsSum + (productCostById.get(part.productId) || 0) * (Number(part.qty) || 0)
      }, 0)
      return sum + partsCost + (Number(repair.laborCost) || 0) + (Number(repair.logisticsCost) || 0)
    }, 0)
    const repairNetRevenueThisMonth = currentRepairInvoices.reduce((sum, invoice) => sum + (Number(invoice.subtotal) || 0), 0)
    const repairGrossProfitThisMonth = repairNetRevenueThisMonth - recordedCostThisMonth

    const serviceTotals = new Map<string, number>()
    for (const repair of currentRepairRecords) {
      for (const line of repair.quote?.lines || []) {
        const label = line.type === 'part' ? 'Parts'
          : line.type === 'labor' ? 'Labour'
          : line.type === 'software' ? 'Software'
          : line.type === 'license' ? 'Licences'
          : line.type === 'logistics' ? 'Logistics'
          : 'Service'
        serviceTotals.set(label, (serviceTotals.get(label) || 0) + (Number(line.subtotal) || 0))
      }
    }
    const serviceRevenue = [...serviceTotals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
    const maxServiceRevenue = Math.max(...serviceRevenue.map(item => item.value), 1)

    const technicianMap = new Map<string, { name: string; jobs: Set<string>; invoiced: number; turnaroundDays: number[] }>()
    for (const invoice of currentRepairInvoices) {
      const repair = repairById.get(String(invoice.repairId))
      if (!repair) continue
      const key = repair.assignedTechnicianId || repair.assignedTechnicianName || 'unassigned'
      const entry = technicianMap.get(key) || {
        name: repair.assignedTechnicianName || 'Unassigned',
        jobs: new Set<string>(),
        invoiced: 0,
        turnaroundDays: [],
      }
      entry.jobs.add(repair.id)
      entry.invoiced += Number(invoice.total) || 0
      if (repair.intakeDate && repair.repairCompletedDate) {
        const start = new Date(repair.intakeDate).getTime()
        const finish = new Date(repair.repairCompletedDate).getTime()
        if (Number.isFinite(start) && Number.isFinite(finish) && finish >= start) {
          entry.turnaroundDays.push((finish - start) / 86400000)
        }
      }
      technicianMap.set(key, entry)
    }
    const technicianPerformance = [...technicianMap.values()]
      .map(entry => ({
        name: entry.name,
        jobs: entry.jobs.size,
        revenue: entry.invoiced,
        turnaround: entry.turnaroundDays.length
          ? entry.turnaroundDays.reduce((sum, days) => sum + days, 0) / entry.turnaroundDays.length
          : null,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    const thisMonthRepairs = visibleRepairs.filter(repair => {
      const date = new Date(repair.intakeDate || repair.createdDate)
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
    })
    const downstreamApprovalStatuses = new Set(['approved', 'awaiting_parts', 'in_repair', 'qc', 'ready', 'verified_released', 'invoiced', 'delivered', 'collected', 'closed'])
    const funnel = {
      quoted: thisMonthRepairs.filter(repair => Boolean(repair.quote)).length,
      approved: thisMonthRepairs.filter(repair => Boolean(repair.quote?.approvedDate) || downstreamApprovalStatuses.has(repair.status)).length,
      invoiced: thisMonthRepairs.filter(repair => Boolean(repair.invoiceId) || currentRepairRecordIds.has(repair.id)).length,
      collected: thisMonthRepairs.filter(repair => ['collected', 'closed', 'delivered'].includes(repair.status)).length,
    }

    return {
      monthlyRepairRevenue: months,
      repairRevenueThisMonth, repairRevenueLastMonth, revenueChange,
      salesRevenueThisMonth, repairShareThisMonth, maxMonthlyRevenue,
      repairInvoicedThisMonth, repairCollectedThisMonth, repairOutstandingThisMonth,
      recordedCostThisMonth, repairGrossProfitThisMonth,
      serviceRevenue, maxServiceRevenue, technicianPerformance, funnel,
    }
  }, [invoices, products, visibleRepairs])

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
      { invoices, posOrders, expenses, journalEntries, deposits },
      accounts,
    )
    const cashbookTotals = computeCashbookTotals(bankAccounts, entries)
    const { cashAtBank, cashInHand } = cashPositionFromTotals(cashbookTotals)
    const alerts = buildFinanceAlerts({ invoices, expenses, payrollRuns, bankStatementLines, bankAccounts, cashbookTotals })
    return { cashAtBank, cashInHand, alerts }
  }, [canSeeFinance, invoices, posOrders, expenses, journalEntries, deposits, accounts, bankAccounts, bankStatementLines, payrollRuns])

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
        { key: 'revenue', label: 'Revenue Paid', value: financeStats.revenue, sub: 'Company-wide collections', color: '#2563EB', icon: <Fa icon={faMoneyBillWave} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'outstanding', label: 'Outstanding', value: financeStats.outstanding, sub: `${financeStats.overdueInvoices.length} overdue invoices`, color: '#2563EB', icon: <Fa icon={faFileInvoiceDollar} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'payables', label: 'Payables', value: financeStats.payables, sub: `${financeStats.pendingBills.length} bills pending`, color: '#8B5CF6', icon: <Fa icon={faMoneyCheckDollar} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=bills') },
        { key: 'open-orders', label: 'Open Sales', value: salesStats.openOrders, sub: `${salesStats.myQuotes.length} quotations active`, color: '#00B0D7', icon: <Fa icon={faCartShopping} />, onClick: () => handleNav('sales', '/sales') },
        { key: 'stock', label: 'Low Stock', value: inventoryStats.lowStockItems.length, sub: `${inventoryStats.totalUnits} units on hand`, color: '#F97316', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('inventory', '/inventory') },
        { key: 'repairs', label: 'Open Repairs', value: repairStats.active.length, sub: `${repairStats.unassigned.length} waiting assignment${repairStats.aging.length > 0 ? ` · ${repairStats.aging.length} aging 7d+` : ''}`, color: '#16A34A', icon: <Fa icon={faScrewdriverWrench} />, onClick: () => handleNav('repair', '/repairs') },
        { key: 'repair-revenue', label: 'Repair Revenue', value: techLeadStats.repairRevenueThisMonth, sub: `This month · actual sales ${fmtKes(techLeadStats.salesRevenueThisMonth)}`, color: '#047857', icon: <Fa icon={faScrewdriverWrench} />, isCurrency: true, onClick: () => handleNav('accounting', '/finance?tab=invoices') },
        { key: 'active-users', label: 'Active Users', value: users.filter(u => u.active).length, sub: `${employees.filter(e => e.status === 'active').length} active employees`, color: '#1B2762', icon: <Fa icon={faUsers} />, onClick: () => handleRoute('/settings?tab=users') },
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
        { key: 'low-stock', label: 'Low Stock', value: inventoryStats.lowStockItems.length, sub: 'Items needing workflow attention', color: '#DC2626', icon: <Fa icon={faTriangleExclamation} />, onClick: () => handleNav('inventory', '/inventory') },
        { key: 'my-expenses', label: 'My Expenses', value: selfServiceStats.myExpenseClaims.length, sub: 'Your reimbursement requests', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('expenses', '/expenses') },
      ]
    }

    if (isInventoryOfficer) {
      return [
        { key: 'skus', label: 'Active SKUs', value: inventoryStats.activeSkus.length, sub: 'Physical stock items', color: '#1B2762', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('inventory', '/inventory') },
        { key: 'units', label: 'Units On Hand', value: inventoryStats.totalUnits, sub: 'Across stock locations', color: '#10B981', icon: <Fa icon={faCircleCheck} />, onClick: () => handleNav('inventory', '/inventory') },
        { key: 'low-stock', label: 'Low Stock', value: inventoryStats.lowStockItems.length, sub: 'Reorder/count attention', color: '#DC2626', icon: <Fa icon={faTriangleExclamation} />, onClick: () => handleNav('inventory', '/inventory') },
        { key: 'receipts', label: 'Goods To Receive', value: inventoryStats.pendingReceipts, sub: 'POs not fully received', color: '#D97706', icon: <Fa icon={faClipboardList} />, onClick: () => handleNav('purchase', '/purchases') },
        { key: 'transfers', label: 'Draft Transfers', value: inventoryStats.draftTransfers, sub: 'Stock movement pending', color: '#8B5CF6', icon: <Fa icon={faArrowsRotate} />, onClick: () => handleNav('inventory', '/inventory?tab=transfers') },
        { key: 'my-expenses', label: 'My Expenses', value: selfServiceStats.myExpenseClaims.length, sub: 'Your reimbursement requests', color: '#0891B2', icon: <Fa icon={faMoneyCheckDollar} />, onClick: () => handleNav('expenses', '/expenses') },
      ]
    }

    if (isKilimallOfficer) {
      return [
        { key: 'pending', label: 'Kilimall Pending', value: kilimallStats.pending.length, sub: 'Orders needing allocation', color: '#F59E0B', icon: <Fa icon={faCartShopping} />, onClick: () => handleNav('kilimall', '/kilimall') },
        { key: 'dispatched', label: 'Dispatched', value: kilimallStats.dispatched.length, sub: 'Awaiting delivery confirmation', color: '#3B82F6', icon: <Fa icon={faCircleCheck} />, onClick: () => handleNav('kilimall', '/kilimall') },
        { key: 'returns', label: 'Returns', value: kilimallStats.returned.length, sub: 'Returned Kilimall orders', color: '#EF4444', icon: <Fa icon={faArrowDown} />, onClick: () => handleNav('kilimall', '/kilimall') },
        { key: 'low-stock', label: 'Low Stock', value: inventoryStats.lowStockItems.length, sub: 'Availability risk before allocation', color: '#DC2626', icon: <Fa icon={faBoxesStacked} />, onClick: () => handleNav('inventory', '/inventory') },
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
    if (canSeeInventory) actions.unshift({ key: 'inventory', title: 'Stock Control', desc: 'Stock levels, transfers, and counts', module: 'inventory', path: '/inventory', color: '#D97706', icon: <Fa icon={faBoxesStacked} /> })
    if (canSeeKilimall) actions.unshift({ key: 'kilimall', title: 'Kilimall Orders', desc: 'Allocate stock and manage returns', module: 'kilimall', path: '/kilimall', color: '#F59E0B', icon: <Fa icon={faCartShopping} /> })

    return actions.filter(a => !a.module || has(a.module)).slice(0, 6)
  }, [canSeeFinance, canSeeSales, canSeeInventory, canSeeKilimall, isSalesRep, has])

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
      const readyDeposits = deposits.filter(d => d.status === 'fully_paid')
      if (readyDeposits.length > 0) {
        items.push({ key: 'deposits-ready', title: `${readyDeposits.length} deposit${readyDeposits.length > 1 ? 's' : ''} ready to collect`, sub: 'Fully paid — arrange customer collection', tone: 'info', module: 'deposits', path: '/deposits' })
      }
    }

    if (canSeeInventory) {
      const outOfStock = inventoryStats.lowStockItems.filter(p => p.onHand === 0)
      if (outOfStock.length > 0) {
        items.push({ key: 'out-of-stock', title: `${outOfStock.length} product${outOfStock.length > 1 ? 's' : ''} out of stock`, sub: outOfStock.slice(0, 3).map(p => p.name).join(', '), tone: 'danger', module: 'inventory', path: '/inventory?tab=warehouse_view' })
      }
      if (isInventoryOfficer || isAdminOfficer) {
        items.push(...inventoryStats.lowStockItems.filter(p => p.onHand > 0).slice(0, 3).map(p => ({ key: `stock-${p.id}`, title: `${p.name} is low`, sub: `${p.onHand}/${p.minStock} units · ${p.category}`, tone: 'warn', module: 'inventory' as ModuleId, path: '/inventory?tab=warehouse_view' })))
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
      .slice(0, 3)
  }, [canSeeFinance, canApproveLeave, canSeeHRAdmin, canSeeInventory, isDirector, isInventoryOfficer, isAdminOfficer, isKilimallOfficer, canSeeWorkshop, isTechnicalLead, isSalesRep, financeDeskStats, selfServiceStats, inventoryStats, kilimallStats, repairStats, salesStats, leaveRequests, saleOrders, deposits, has])

  const executiveSnapshot = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfYesterday = new Date(startOfToday)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)
    const startOfWeek = new Date(startOfToday)
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7))
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfYear = new Date(now.getFullYear(), 0, 1)
    const paidCustomerInvoices = invoices.filter(invoice =>
      invoice.type !== 'vendor_bill' && invoicePaymentStatus(invoice) === 'paid',
    )
    const revenueSince = (start: Date, end?: Date) => paidCustomerInvoices.reduce((sum, invoice) => {
      const date = new Date(invoice.date)
      if (Number.isNaN(date.getTime()) || date < start || (end && date >= end)) return sum
      return sum + (Number(invoice.total) || 0)
    }, 0)
    const invoicesThisWeek = paidCustomerInvoices.filter(invoice => new Date(invoice.date) >= startOfWeek)
    const nonCancelledSales = visibleSalesOrders.filter(order => order.status !== 'cancelled')
    const confirmedSales = nonCancelledSales.filter(order => order.status === 'sale' || Boolean(order.confirmedAt))
    const activeSkus = inventoryStats.activeSkus.length
    const repairPool = repairStats.active.length + repairStats.ready.length

    return {
      paidThisWeek: revenueSince(startOfWeek),
      paidInvoiceCount: invoicesThisWeek.length,
      periods: [
        { label: 'Today', value: revenueSince(startOfToday) },
        { label: 'Yesterday', value: revenueSince(startOfYesterday, startOfToday) },
        { label: 'This week', value: revenueSince(startOfWeek) },
        { label: 'This month', value: revenueSince(startOfMonth) },
        { label: 'This year', value: revenueSince(startOfYear) },
      ],
      performance: [
        {
          label: 'Collection',
          value: financeStats.revenue + financeStats.outstanding > 0
            ? Math.round((financeStats.revenue / (financeStats.revenue + financeStats.outstanding)) * 100)
            : 0,
        },
        {
          label: 'Conversion',
          value: nonCancelledSales.length > 0
            ? Math.round((confirmedSales.length / nonCancelledSales.length) * 100)
            : 0,
        },
        {
          label: 'Stock health',
          value: activeSkus > 0
            ? Math.round(((activeSkus - inventoryStats.lowStockItems.length) / activeSkus) * 100)
            : 0,
        },
        {
          label: 'Repair progress',
          value: repairPool > 0
            ? Math.round((repairStats.ready.length / repairPool) * 100)
            : 0,
        },
      ],
    }
  }, [invoices, visibleSalesOrders, inventoryStats.activeSkus.length, inventoryStats.lowStockItems.length, repairStats.active.length, repairStats.ready.length, financeStats.revenue, financeStats.outstanding])

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

  // Gate on the route store GET, not LAST_SYNC_AT: a prior visit can leave a
  // sync timestamp while this route's collections are still in flight.
  if (!mounted || !routeReady) return <ModuleSkeleton />

  return (
    <div className="dashboard-page">
      <div className="dashboard-executive-grid">
        <div className="dashboard-executive-main">
          <section className="dashboard-week-card">
            <div className="dashboard-week-heading">
              <span className="dashboard-week-icon" aria-hidden="true"><Fa icon={faArrowsRotate} /></span>
              <div>
                <h1>This Week</h1>
                <p>Live company activity from the ERP</p>
              </div>
            </div>
            <p className="dashboard-week-summary">
              {fmtKes(executiveSnapshot.paidThisWeek)} in paid invoice revenue across {executiveSnapshot.paidInvoiceCount} invoice{executiveSnapshot.paidInvoiceCount === 1 ? '' : 's'} this week. {financeStats.overdueInvoices.length} overdue customer invoice{financeStats.overdueInvoices.length === 1 ? '' : 's'} currently need collection.
            </p>
            <div className="dashboard-week-chips">
              <button type="button" onClick={() => handleNav('accounting', '/finance?tab=invoices')}>{executiveSnapshot.paidInvoiceCount} invoices paid this week</button>
              <button type="button" onClick={() => handleNav('sales', '/sales')}>{salesStats.openOrders} open sales</button>
              <button type="button" onClick={() => handleNav('repair', '/repairs')}>{repairStats.active.length} active repairs</button>
            </div>
          </section>

          <div className="dashboard-kpi-grid">
            {kpis
              .filter(({ key }) => canShowDashboardKpi(currentUser, key))
              .slice(0, 6)
              .map(({ key, ...kpi }) => <KpiCard key={key} {...kpi} />)}
          </div>

          <section className="dashboard-period-strip" aria-label="Paid revenue by period">
            {executiveSnapshot.periods.map(period => (
              <div key={period.label}>
                <span>{period.label}</span>
                <strong>{fmtKes(period.value)}</strong>
              </div>
            ))}
          </section>
        </div>

        <aside className="dashboard-executive-side">
          <section className="dashboard-panel overflow-hidden">
            <CardHeader title="Needs attention" sub="Most urgent items first" />
            {focusItems.length > 0 ? (
              <div className="dashboard-alerts-list">
                {focusItems.map(item => (
                  <button
                    type="button"
                    key={item.key}
                    onClick={item.path ? () => (item.module ? handleNav(item.module, item.path) : handleRoute(item.path)) : undefined}
                    className={`dashboard-alert dashboard-alert-${item.tone} ${item.path ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className="dashboard-alert-dot" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold text-[var(--text-1)]">{item.title}</span>
                      <span className="block truncate text-[11px] text-[var(--text-3)]">{item.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="dashboard-compact-clear"><Fa icon={faCircleCheck} /> No urgent items</div>
            )}
          </section>

          <section className="dashboard-panel overflow-hidden">
            <CardHeader title="Performance" sub="Where things stand right now" />
            <div className="dashboard-performance-grid">
              {executiveSnapshot.performance.map(metric => (
                <div key={metric.label} className="dashboard-performance-item">
                  <div
                    className="dashboard-performance-ring"
                    style={{ '--ring-value': `${Math.max(0, Math.min(100, metric.value)) * 3.6}deg` } as React.CSSProperties}
                  >
                    <span>{metric.value}%</span>
                  </div>
                  <strong>{metric.label}</strong>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {(canSeeInventory || canSeeWorkshop) && (
        <>
          <SectionLabel label="Operational overview" />
          <div className="dashboard-workspace-grid">
            {canSeeInventory && (
              <section className="dashboard-panel overflow-hidden">
                <CardHeader
                  title="Stock health"
                  sub="Products below their safe stock level"
                  action={<button type="button" className="dashboard-card-link" onClick={() => handleNav('inventory', '/inventory')}>View all</button>}
                />
                <div className="dashboard-list-rows">
                  {inventoryStats.lowStockItems.slice(0, 4).map(p => {
                    const isOut = p.onHand === 0
                    return (
                      <div key={p.id} className="dashboard-list-row">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <div className={`dashboard-row-symbol ${isOut ? 'is-danger' : 'is-warning'}`}>SKU</div>
                          <div className="min-w-0">
                            <p className="text-[13px] sm:text-sm font-bold text-[var(--text-1)] truncate">{p.name}</p>
                            <p className="text-[11px] sm:text-xs text-[var(--text-3)] truncate">{p.category}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3">
                          <span className="text-[11px] sm:text-xs font-mono text-[var(--text-2)]">{p.onHand}/{p.minStock}</span>
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
                <CardHeader
                  title={isTechnician ? 'My repair queue' : 'Workshop queue'}
                  sub={isTechnician ? 'Jobs currently assigned to you' : 'Active service work and ownership'}
                  action={<button type="button" className="dashboard-card-link" onClick={() => handleNav('repair', '/repairs')}>View all</button>}
                />
                <div className="dashboard-list-rows">
                  {repairStats.active.slice(0, 4).map(r => (
                    <button type="button" key={r.id} onClick={() => handleNav('repair', '/repairs')} className="dashboard-list-row text-left">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div className="dashboard-row-symbol is-repair"><Fa icon={faScrewdriverWrench} /></div>
                        <div className="min-w-0">
                          <p className="text-[13px] sm:text-sm font-bold text-[var(--text-1)] truncate" title={`${r.ref} · ${r.productName}`}>{r.ref} · {r.productName}</p>
                          <p className="text-[11px] sm:text-xs text-[var(--text-3)] truncate">{r.customerName}{r.assignedTechnicianName ? ` · ${r.assignedTechnicianName}` : ''}</p>
                        </div>
                      </div>
                      <Badge status={r.status === 'ready' || r.status === 'closed' ? 'active' : r.status === 'cancelled' ? 'cancelled' : 'pending'} label={r.status.replace(/_/g, ' ')} />
                    </button>
                  ))}
                  {repairStats.active.length === 0 && <EmptyState message={isTechnician ? 'No jobs assigned to you yet' : 'No repair jobs require attention'} />}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      {sections.salesAnalytics && has('sales') && (
        <>
          <SectionLabel label="Sales intelligence" />
          <section className="dashboard-panel overflow-hidden">
            <CardHeader
              title="Sales intelligence"
              sub="Pipeline, revenue and salesperson performance · this month"
              action={<button type="button" className="btn-primary text-[11px]" onClick={() => handleNav('sales', '/sales')}>Open sales</button>}
            />

            <div className="grid grid-cols-2 border-b border-[var(--border-lt)] md:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Quoted value', value: fmtKes(salesIntelligenceStats.quotedValue), note: 'Open quotations', color: '#0EA5E9' },
                { label: 'Confirmed sales', value: fmtKes(salesIntelligenceStats.confirmedValue), note: 'Sales orders', color: '#2563EB' },
                { label: 'Invoiced', value: fmtKes(salesIntelligenceStats.invoicedValue), note: 'Posted sales invoices', color: '#1B2762' },
                { label: 'Collected', value: fmtKes(salesIntelligenceStats.collectedValue), note: 'Recorded collections', color: '#047857' },
                { label: 'Open pipeline', value: fmtKes(salesIntelligenceStats.openPipelineValue), note: 'Not fully invoiced', color: '#D97706' },
                { label: 'Conversion', value: `${salesIntelligenceStats.conversionRate}%`, note: 'Confirmed share', color: '#7C3AED' },
              ].map((metric, index) => (
                <div key={metric.label} className={`border-[var(--border-lt)] p-3 ${index % 2 ? 'border-l' : ''} ${index > 1 ? 'border-t md:border-t-0' : ''} md:border-l md:first:border-l-0`}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-4)]">{metric.label}</p>
                  <p className="mt-1 truncate font-mono text-sm font-extrabold" style={{ color: metric.color }} title={metric.value}>{metric.value}</p>
                  <p className="mt-0.5 truncate text-[10px] text-[var(--text-4)]">{metric.note}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 border-b border-[var(--border-lt)] xl:grid-cols-[1.7fr_1fr]">
              <div className="p-4 xl:border-r xl:border-[var(--border-lt)]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-[var(--text-1)]">Sales pipeline &amp; revenue</h3>
                    <p className="text-[10px] text-[var(--text-4)]">Quotation, confirmed sales and recorded collections · six months</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold text-[var(--text-3)]">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#7DD3FC]" />Quoted</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2563EB]" />Confirmed</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#1B2762]" />Collected</span>
                  </div>
                </div>
                <div className="grid h-44 grid-cols-6 items-end gap-2 sm:gap-4">
                  {salesIntelligenceStats.months.map(month => (
                    <div key={month.label} className="flex h-full min-w-0 flex-col justify-end">
                      <div className="flex flex-1 items-end justify-center gap-0.5 border-b border-[var(--border-lt)]">
                        {[
                          { label: 'Quoted', value: month.quoted, color: '#7DD3FC' },
                          { label: 'Confirmed', value: month.confirmed, color: '#2563EB' },
                          { label: 'Collected', value: month.collected, color: '#1B2762' },
                        ].map(series => (
                          <div
                            key={series.label}
                            className="w-[27%] min-w-[4px] rounded-t-sm"
                            style={{
                              height: `${Math.max(series.value > 0 ? 4 : 0, (series.value / salesIntelligenceStats.maxTrendValue) * 100)}%`,
                              background: series.color,
                            }}
                            title={`${series.label} ${fmtKes(series.value)}`}
                          />
                        ))}
                      </div>
                      <p className="mt-2 truncate text-center text-[9px] font-semibold text-[var(--text-3)]">{month.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[var(--border-lt)] p-4 xl:border-t-0">
                <h3 className="text-xs font-bold text-[var(--text-1)]">Sales funnel</h3>
                <p className="mb-4 text-[10px] text-[var(--text-4)]">Records dated this month</p>
                <div className="space-y-3">
                  {[
                    { label: 'Quotations', value: salesIntelligenceStats.funnel.quotations, color: '#7DD3FC' },
                    { label: 'Confirmed', value: salesIntelligenceStats.funnel.confirmed, color: '#38BDF8' },
                    { label: 'Invoiced', value: salesIntelligenceStats.funnel.invoiced, color: '#2563EB' },
                    { label: 'Paid', value: salesIntelligenceStats.funnel.paid, color: '#1B2762' },
                  ].map(stage => {
                    const base = Math.max(salesIntelligenceStats.funnel.quotations, salesIntelligenceStats.funnel.confirmed, 1)
                    const percentage = Math.min(100, Math.round((stage.value / base) * 100))
                    return (
                      <div key={stage.label} className="grid grid-cols-[70px_1fr_54px] items-center gap-2">
                        <span className="text-[10px] font-semibold text-[var(--text-2)]">{stage.label}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                          <div className="h-full rounded-full" style={{ width: `${percentage}%`, background: stage.color }} />
                        </div>
                        <span className="text-right font-mono text-[10px] font-bold text-[var(--text-1)]">{stage.value} · {percentage}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_.85fr_.85fr]">
              <div className="p-4 xl:border-r xl:border-[var(--border-lt)]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-[var(--text-1)]">Salesperson performance</h3>
                    <p className="text-[10px] text-[var(--text-4)]">Visible quotations and confirmed sales this month</p>
                  </div>
                  <button type="button" className="dashboard-card-link" onClick={() => handleNav('sales', '/sales')}>View sales</button>
                </div>
                <div className="overflow-hidden rounded-lg border border-[var(--border-lt)]">
                  <div className="grid grid-cols-[1fr_42px_38px_82px_64px] gap-2 bg-[var(--bg-surface)] px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-[var(--text-4)]">
                    <span>Salesperson</span><span className="text-right">Quotes</span><span className="text-right">Won</span><span className="text-right">Revenue</span><span className="text-right">Convert</span>
                  </div>
                  {salesIntelligenceStats.repPerformance.map(rep => (
                    <div key={rep.name} className="grid grid-cols-[1fr_42px_38px_82px_64px] gap-2 border-t border-[var(--border-lt)] px-2 py-2 text-[10px]">
                      <span className="truncate font-semibold text-[var(--text-1)]">{rep.name}</span>
                      <span className="text-right font-mono">{rep.quotes}</span>
                      <span className="text-right font-mono">{rep.won}</span>
                      <span className="text-right font-mono font-semibold">{fmtKes(rep.revenue)}</span>
                      <span className="text-right font-mono">{rep.conversion}%</span>
                    </div>
                  ))}
                  {salesIntelligenceStats.repPerformance.length === 0 && <div className="p-3 text-center text-[10px] text-[var(--text-4)]">No salesperson activity this month</div>}
                </div>
              </div>

              <div className="border-t border-[var(--border-lt)] p-4 xl:border-r xl:border-t-0 xl:border-[var(--border-lt)]">
                <h3 className="text-xs font-bold text-[var(--text-1)]">Top customers</h3>
                <p className="mb-2 text-[10px] text-[var(--text-4)]">Confirmed sales value this month</p>
                <div className="divide-y divide-[var(--border-lt)]">
                  {salesIntelligenceStats.topCustomers.map(customer => (
                    <div key={customer.name} className="flex items-center justify-between gap-3 py-2">
                      <span className="truncate text-[10px] font-semibold text-[var(--text-2)]">{customer.name}</span>
                      <span className="shrink-0 font-mono text-[10px] font-bold">{fmtKes(customer.value)}</span>
                    </div>
                  ))}
                  {salesIntelligenceStats.topCustomers.length === 0 && <EmptyState message="No confirmed customer sales this month" />}
                </div>
              </div>

              <div className="border-t border-[var(--border-lt)] p-4 xl:border-t-0">
                <h3 className="text-xs font-bold text-[var(--text-1)]">Quotes requiring action</h3>
                <p className="mb-2 text-[10px] text-[var(--text-4)]">Select an item to continue in Sales</p>
                <div className="divide-y divide-[var(--border-lt)]">
                  {[
                    { label: 'Expiring in 7 days', value: salesIntelligenceStats.quoteActions.expiringSoon, tone: '#D97706' },
                    { label: 'Draft over 7 days', value: salesIntelligenceStats.quoteActions.agingDrafts, tone: '#B91C1C' },
                    { label: 'Approved not invoiced', value: salesIntelligenceStats.quoteActions.approvedNotInvoiced, tone: '#D97706' },
                    { label: 'Lost this month', value: salesIntelligenceStats.quoteActions.lostThisMonth, tone: '#6B7280' },
                  ].map(item => (
                    <button
                      type="button"
                      key={item.label}
                      onClick={() => handleNav('sales', '/sales')}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left"
                    >
                      <span className="text-[11px] font-semibold text-[var(--text-2)]">{item.label}</span>
                      <span className="font-mono text-sm font-extrabold" style={{ color: item.value ? item.tone : '#047857' }}>{item.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {sections.repairRevenue && (
        <>
          <SectionLabel label="Repairs intelligence" />
          <section className="dashboard-panel overflow-hidden">
            <CardHeader
              title="Repairs intelligence"
              sub="Revenue, collections and workshop performance · this month"
              action={<button type="button" className="btn-primary text-[11px]" onClick={() => handleNav('repair', '/repairs')}>Open repairs</button>}
            />

            <div className="grid grid-cols-2 border-b border-[var(--border-lt)] lg:grid-cols-4">
              {[
                { label: 'Invoiced', value: techLeadStats.repairInvoicedThisMonth, note: 'Posted repair invoices', color: '#0EA5E9' },
                { label: 'Collected', value: techLeadStats.repairCollectedThisMonth, note: 'Recorded against invoices', color: '#047857' },
                { label: 'Outstanding', value: techLeadStats.repairOutstandingThisMonth, note: 'Still to collect', color: techLeadStats.repairOutstandingThisMonth > 0 ? '#D97706' : '#047857' },
                { label: 'Gross profit', value: techLeadStats.repairGrossProfitThisMonth, note: 'Pre-tax revenue less recorded costs', color: techLeadStats.repairGrossProfitThisMonth >= 0 ? '#047857' : '#B91C1C' },
              ].map((metric, index) => (
                <div key={metric.label} className={`p-3 sm:p-4 ${index % 2 ? 'border-l' : ''} ${index > 1 ? 'border-t lg:border-t-0' : ''} lg:border-l border-[var(--border-lt)] first:border-l-0`}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-4)]">{metric.label}</p>
                  <p className="mt-1 font-mono text-base font-extrabold" style={{ color: metric.color }}>{fmtKes(metric.value)}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--text-4)]">{metric.note}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 border-b border-[var(--border-lt)] xl:grid-cols-[1.7fr_1fr]">
              <div className="p-4 xl:border-r xl:border-[var(--border-lt)]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-[var(--text-1)]">Repair revenue &amp; collections</h3>
                    <p className="text-[10px] text-[var(--text-4)]">Posted repair invoices versus recorded collections · six months</p>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] font-semibold text-[var(--text-3)]">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#38BDF8]" />Invoiced</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#1B2762]" />Collected</span>
                  </div>
                </div>
                <div className="grid h-44 grid-cols-6 items-end gap-2 sm:gap-4">
                  {techLeadStats.monthlyRepairRevenue.map(month => (
                    <div key={month.label} className="flex h-full min-w-0 flex-col justify-end">
                      <div className="flex flex-1 items-end justify-center gap-1 border-b border-[var(--border-lt)]">
                        <div
                          className="w-[38%] min-w-[5px] rounded-t-sm bg-[#38BDF8]"
                          style={{ height: `${Math.max(month.repairInvoiced > 0 ? 4 : 0, (month.repairInvoiced / techLeadStats.maxMonthlyRevenue) * 100)}%` }}
                          title={`Invoiced ${fmtKes(month.repairInvoiced)}`}
                        />
                        <div
                          className="w-[38%] min-w-[5px] rounded-t-sm bg-[#1B2762]"
                          style={{ height: `${Math.max(month.repairCollected > 0 ? 4 : 0, (month.repairCollected / techLeadStats.maxMonthlyRevenue) * 100)}%` }}
                          title={`Collected ${fmtKes(month.repairCollected)}`}
                        />
                      </div>
                      <p className="mt-2 truncate text-center text-[9px] font-semibold text-[var(--text-3)]">{month.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[var(--border-lt)] p-4 xl:border-t-0">
                <h3 className="text-xs font-bold text-[var(--text-1)]">Repair funnel</h3>
                <p className="mb-4 text-[10px] text-[var(--text-4)]">Jobs received this month</p>
                <div className="space-y-3">
                  {[
                    { label: 'Quoted', value: techLeadStats.funnel.quoted, color: '#7DD3FC' },
                    { label: 'Approved', value: techLeadStats.funnel.approved, color: '#38BDF8' },
                    { label: 'Invoiced', value: techLeadStats.funnel.invoiced, color: '#0EA5E9' },
                    { label: 'Collected', value: techLeadStats.funnel.collected, color: '#1B2762' },
                  ].map(stage => {
                    const base = Math.max(techLeadStats.funnel.quoted, 1)
                    const percentage = Math.min(100, Math.round((stage.value / base) * 100))
                    return (
                      <div key={stage.label} className="grid grid-cols-[64px_1fr_54px] items-center gap-2">
                        <span className="text-[10px] font-semibold text-[var(--text-2)]">{stage.label}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                          <div className="h-full rounded-full" style={{ width: `${percentage}%`, background: stage.color }} />
                        </div>
                        <span className="text-right font-mono text-[10px] font-bold text-[var(--text-1)]">{stage.value} · {percentage}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3">
              <div className="p-4 xl:border-r xl:border-[var(--border-lt)]">
                <h3 className="text-xs font-bold text-[var(--text-1)]">Value by service</h3>
                <p className="mb-3 text-[10px] text-[var(--text-4)]">Quoted line value on this month&apos;s invoiced repairs</p>
                <div className="space-y-3">
                  {techLeadStats.serviceRevenue.map(item => (
                    <div key={item.label} className="grid grid-cols-[64px_1fr_78px] items-center gap-2">
                      <span className="truncate text-[10px] font-semibold text-[var(--text-2)]">{item.label}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                        <div className="h-full rounded-full bg-[#0EA5E9]" style={{ width: `${(item.value / techLeadStats.maxServiceRevenue) * 100}%` }} />
                      </div>
                      <span className="text-right font-mono text-[10px] font-bold">{fmtKes(item.value)}</span>
                    </div>
                  ))}
                  {techLeadStats.serviceRevenue.length === 0 && <EmptyState message="No quoted service lines on this month’s invoiced repairs" />}
                </div>
              </div>

              <div className="border-t border-[var(--border-lt)] p-4 xl:border-r xl:border-t-0 xl:border-[var(--border-lt)]">
                <h3 className="text-xs font-bold text-[var(--text-1)]">Technician performance</h3>
                <p className="mb-3 text-[10px] text-[var(--text-4)]">Invoiced repairs and recorded turnaround</p>
                <div className="overflow-hidden rounded-lg border border-[var(--border-lt)]">
                  <div className="grid grid-cols-[1fr_38px_82px_70px] gap-2 bg-[var(--bg-surface)] px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-[var(--text-4)]">
                    <span>Technician</span><span className="text-right">Jobs</span><span className="text-right">Revenue</span><span className="text-right">Avg days</span>
                  </div>
                  {techLeadStats.technicianPerformance.map(tech => (
                    <div key={tech.name} className="grid grid-cols-[1fr_38px_82px_70px] gap-2 border-t border-[var(--border-lt)] px-2 py-2 text-[10px]">
                      <span className="truncate font-semibold text-[var(--text-1)]">{tech.name}</span>
                      <span className="text-right font-mono">{tech.jobs}</span>
                      <span className="text-right font-mono font-semibold">{fmtKes(tech.revenue)}</span>
                      <span className="text-right font-mono">{tech.turnaround == null ? '—' : tech.turnaround.toFixed(1)}</span>
                    </div>
                  ))}
                  {techLeadStats.technicianPerformance.length === 0 && <div className="p-3 text-center text-[10px] text-[var(--text-4)]">No invoiced technician work this month</div>}
                </div>
              </div>

              <div className="border-t border-[var(--border-lt)] p-4 xl:border-t-0">
                <h3 className="text-xs font-bold text-[var(--text-1)]">Workshop bottlenecks</h3>
                <p className="mb-2 text-[10px] text-[var(--text-4)]">Select an item to continue in Repairs</p>
                <div className="divide-y divide-[var(--border-lt)]">
                  {[
                    { label: 'Awaiting approval', value: repairStats.active.filter(repair => repair.status === 'awaiting_approval').length, path: '/repairs?status=awaiting_approval', tone: '#D97706' },
                    { label: 'Awaiting parts', value: repairStats.awaitingParts.length, path: '/repairs?status=awaiting_parts', tone: '#B91C1C' },
                    { label: 'Aging 7d+', value: repairStats.aging.length, path: '/repairs', tone: '#B91C1C' },
                    { label: 'Ready uncollected', value: repairStats.ready.length, path: '/repairs?status=ready', tone: '#D97706' },
                  ].map(item => (
                    <button
                      type="button"
                      key={item.label}
                      onClick={() => handleNav('repair', item.path)}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left"
                    >
                      <span className="text-[11px] font-semibold text-[var(--text-2)]">{item.label}</span>
                      <span className="font-mono text-sm font-extrabold" style={{ color: item.value ? item.tone : '#047857' }}>{item.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ── P3 · Trends & analytics (progressive disclosure) ─────────────── */}
      {(sections.salesAnalytics || sections.inventoryOverview) && (
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
                    const val = prods.reduce((a, p) => a + p.costPrice * onHandQtyAtStockLocations(p, serials, bulkStock, p.id), 0)
                    const qty = prods.reduce((a, p) => a + onHandQtyAtStockLocations(p, serials, bulkStock, p.id), 0)
                    const color = CATEGORY_COLORS[cat] ?? '#6B7280'
                    return (
                      <div key={cat} className="dashboard-category-card">
                        <p className="text-[11px] font-bold tracking-wide truncate" style={{ color }}>{cat}</p>
                        <p className="text-base font-extrabold text-[var(--text-1)]">{canSeeFinance ? fmtKes(val) : `${qty} units`}</p>
                        <p className="text-[11px] text-[var(--text-4)]">{prods.length} items · {qty} units</p>
                      </div>
                    )
                  })}
                </div>
              </CollapsibleSection>
            )}


          </div>
        </>
      )}

      {/* ── P4 · Shortcuts & activity ────────────────────────────────────── */}
      <SectionLabel label="Work faster" />
      <div className="dashboard-bottom-grid">
        <section className="dashboard-panel dashboard-quick-actions-panel overflow-hidden">
          <CardHeader title="Quick actions" sub="Shortcuts selected for your role and permissions" />
          <div className="dashboard-quick-actions-grid">
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
                  <span className="block text-[12px] sm:text-sm font-bold text-[var(--text-1)] leading-snug line-clamp-2 sm:truncate">{action.title}</span>
                  <span className="hidden sm:block text-xs text-[var(--text-4)] mt-1 leading-snug line-clamp-2">{action.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="dashboard-bottom-side">
          <section className="dashboard-panel overflow-hidden">
            <CardHeader title="My self-service" sub="Your personal workspace" />
            <div className="p-2.5 sm:p-4 grid grid-cols-2 gap-1.5 sm:gap-2.5">
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
                  <span className="text-sm sm:text-lg font-extrabold text-primary-600">{item.value}</span>
                  <span className="text-[10px] sm:text-[11px] font-bold text-[var(--text-4)]">{item.label}</span>
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
                    <p className="text-[13px] font-bold text-[var(--text-1)] truncate">{item.title}</p>
                    <p className="text-[11px] text-[var(--text-3)] mt-0.5 truncate">{item.sub}</p>
                  </div>
                  <span className="text-[11px] text-[var(--text-4)] flex-shrink-0">{fmtDate(item.date)}</span>
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
