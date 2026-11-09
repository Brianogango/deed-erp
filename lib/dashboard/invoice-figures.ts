/**
 * The dashboard's invoice-based figures, worked out on the server so the
 * dashboard no longer downloads the whole invoice list. Each block is the
 * same calculation the dashboard used to run in the browser; dates are
 * Nairobi calendar days (`today` comes from the browser).
 *
 * Pure — the server route feeds it the rows the user may see.
 */
import { invoiceDocState, invoicePaymentStatus } from '@/lib/odoo-sales-flow'
import { findInvoicedNotDelivered } from '@/lib/sales/invoiced-not-delivered'
import { repairsByInvoice } from '@/lib/repair/repair-invoice-index'
import { buildCashbookEntries } from '@/lib/accounting/cashbook-entries'
import { buildFinanceAlerts, cashPositionFromTotals, computeCashbookTotals } from '@/lib/finance-alerts'

type Row = Record<string, any>

export type RepairMonthFigures = {
  revenue: number
  salesRevenue: number
  count: number
  salesCount: number
  repairInvoiced: number
  repairCollected: number
  repairOutstanding: number
}

export type DashboardInvoiceFigures = {
  today: string
  /** Sales intelligence: this month's posted sale-order invoices, and six months of collections. */
  sales: {
    invoicedValue: number
    collectedValue: number
    /** Oldest first; the last entry is this month. */
    monthlyCollected: number[]
    invoicedOrders: number
    paidOrders: number
  }
  /** Repair revenue by month (oldest first) and this month's posted repair invoices. */
  repairs: {
    months: RepairMonthFigures[]
    currentInvoices: Array<{ id: string; total: number; subtotal: number; linkedRepairIds: string[] }>
  }
  /** Paid customer invoices by period. */
  revenue: { today: number; yesterday: number; week: number; month: number; year: number; paidThisWeekCount: number }
  /** Newest invoices and bills, for the activity feed. */
  recent: Array<{ id: string; ref: string; type: string; partnerName: string; total: number; date: string }>
  invoicedNotDelivered: ReturnType<typeof findInvoicedNotDelivered>
  /** Cash position and finance exceptions — only for users who see the finance section. */
  financeDesk: { cashAtBank: number; cashInHand: number; alerts: ReturnType<typeof buildFinanceAlerts> } | null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A stored date as a Nairobi calendar day, or null when it is not a date. */
export function nairobiDay(value: unknown): string | null {
  const s = String(value ?? '').trim()
  if (ISO_DAY.test(s)) return s
  if (!s) return null
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = this month, 1 = last month, … (negative for future months). */
function monthsAgo(day: string, today: string): number {
  const [y, m] = day.split('-').map(Number)
  const [ty, tm] = today.split('-').map(Number)
  return (ty * 12 + tm) - (y * 12 + m)
}

const num = (v: unknown) => Number(v) || 0
const collectedOf = (inv: Row) => Math.min(num(inv.total), Math.max(0, num(inv.amountPaid)))

export function computeDashboardInvoiceFigures(input: {
  today: string
  invoices: Row[]
  /** Sale orders the user's dashboard shows (role-filtered). */
  visibleSaleOrders: Row[]
  /** Every sale order the user may read — for invoiced-not-delivered. */
  saleOrders: Row[]
  /** Repairs the user's dashboard shows (role-filtered). */
  visibleRepairs: Row[]
  deliveries: Row[]
  products: Row[]
  /** Whether to work out invoiced-not-delivered (sales, stock or finance section). */
  withInvoicedNotDelivered: boolean
  /** Cashbook inputs, when the user sees the finance section. */
  finance: null | {
    posOrders: Row[]
    expenses: Row[]
    journalEntries: Row[]
    deposits: Row[]
    bankStatementLines: Row[]
    accounts: Row[]
    bankAccounts: Row[]
    payrollRuns: Row[]
  }
  /** Whether the activity feed lists invoices (finance section). */
  withRecent: boolean
}): DashboardInvoiceFigures {
  const today = ISO_DAY.test(input.today) ? input.today : new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
  const invoices = Array.isArray(input.invoices) ? input.invoices : []

  // ── Sales intelligence (sale-order invoices) ───────────────────────────────
  const visibleOrderIds = new Set(input.visibleSaleOrders.map(o => String(o.id)))
  const monthlyCollected = [0, 0, 0, 0, 0, 0]
  const currentSaleInvoices: Row[] = []
  for (const inv of invoices) {
    if (
      inv.type !== 'customer_invoice'
      || inv.repairId
      || !inv.saleOrderId
      || !visibleOrderIds.has(String(inv.saleOrderId))
      || invoiceDocState(inv.status) !== 'posted'
    ) continue
    const day = nairobiDay(inv.date)
    if (!day) continue
    const ago = monthsAgo(day, today)
    if (ago < 0 || ago > 5) continue
    monthlyCollected[5 - ago] += collectedOf(inv)
    if (ago === 0) currentSaleInvoices.push(inv)
  }
  const sales = {
    invoicedValue: currentSaleInvoices.reduce((s, inv) => s + num(inv.total), 0),
    collectedValue: currentSaleInvoices.reduce((s, inv) => s + collectedOf(inv), 0),
    monthlyCollected,
    invoicedOrders: new Set(currentSaleInvoices.map(inv => inv.saleOrderId).filter(Boolean)).size,
    paidOrders: new Set(currentSaleInvoices.filter(inv => invoicePaymentStatus(inv as never) === 'paid').map(inv => inv.saleOrderId).filter(Boolean)).size,
  }

  // ── Repair revenue ─────────────────────────────────────────────────────────
  const months: RepairMonthFigures[] = Array.from({ length: 6 }, () => ({
    revenue: 0, salesRevenue: 0, count: 0, salesCount: 0, repairInvoiced: 0, repairCollected: 0, repairOutstanding: 0,
  }))
  const currentInvoices: DashboardInvoiceFigures['repairs']['currentInvoices'] = []
  const repairsOnInvoice = repairsByInvoice(input.visibleRepairs as never, invoices as never)
  for (const inv of invoices) {
    if (inv.type === 'vendor_bill') continue
    const day = nairobiDay(inv.date)
    if (!day) continue
    const ago = monthsAgo(day, today)
    if (ago < 0 || ago > 5) continue
    const slot = months[5 - ago]
    const linkedRepairIds = repairsOnInvoice.get(String(inv.id)) ?? []
    const paid = invoicePaymentStatus(inv as never) === 'paid'
    if (linkedRepairIds.length > 0) {
      if (invoiceDocState(inv.status) === 'posted') {
        const total = num(inv.total)
        const collected = collectedOf(inv)
        slot.repairInvoiced += total
        slot.repairCollected += collected
        slot.repairOutstanding += Math.max(0, total - collected)
        if (ago === 0) currentInvoices.push({ id: String(inv.id), total, subtotal: num(inv.subtotal), linkedRepairIds })
      }
      if (paid) {
        slot.revenue += num(inv.total)
        slot.count++
      }
    } else if (paid) {
      slot.salesRevenue += num(inv.total)
      slot.salesCount++
    }
  }

  // ── Paid revenue by period ─────────────────────────────────────────────────
  const yesterday = addDays(today, -1)
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const weekStart = addDays(today, -((dow + 6) % 7))
  const monthStart = `${today.slice(0, 7)}-01`
  const yearStart = `${today.slice(0, 4)}-01-01`
  const revenue = { today: 0, yesterday: 0, week: 0, month: 0, year: 0, paidThisWeekCount: 0 }
  for (const inv of invoices) {
    if (inv.type === 'vendor_bill' || invoicePaymentStatus(inv as never) !== 'paid') continue
    const day = nairobiDay(inv.date)
    if (!day) continue
    const total = num(inv.total)
    if (day >= today) revenue.today += total
    if (day >= yesterday && day < today) revenue.yesterday += total
    if (day >= weekStart) { revenue.week += total; revenue.paidThisWeekCount++ }
    if (day >= monthStart) revenue.month += total
    if (day >= yearStart) revenue.year += total
  }

  // ── Activity feed ──────────────────────────────────────────────────────────
  const time = (v: unknown) => { const t = new Date(String(v || 0)).getTime(); return Number.isFinite(t) ? t : 0 }
  const recent = input.withRecent
    ? [...invoices]
      .sort((a, b) => time(b.date) - time(a.date))
      .slice(0, 5)
      .map(inv => ({ id: String(inv.id), ref: String(inv.ref ?? ''), type: String(inv.type ?? ''), partnerName: String(inv.partnerName ?? ''), total: num(inv.total), date: String(inv.date ?? '') }))
    : []

  // ── Invoiced, not delivered ────────────────────────────────────────────────
  const invoicedNotDelivered = input.withInvoicedNotDelivered
    ? findInvoicedNotDelivered({ saleOrders: input.saleOrders, invoices, deliveries: input.deliveries, products: input.products })
    : []

  // ── Cash position and finance exceptions ───────────────────────────────────
  let financeDesk: DashboardInvoiceFigures['financeDesk'] = null
  if (input.finance) {
    const f = input.finance
    const entries = buildCashbookEntries(
      { invoices, posOrders: f.posOrders, expenses: f.expenses, journalEntries: f.journalEntries, deposits: f.deposits, bankStatementLines: f.bankStatementLines } as never,
      f.accounts as never,
    )
    const cashbookTotals = computeCashbookTotals(f.bankAccounts as never, entries)
    const { cashAtBank, cashInHand } = cashPositionFromTotals(cashbookTotals)
    const alerts = buildFinanceAlerts({ invoices, expenses: f.expenses, payrollRuns: f.payrollRuns, bankStatementLines: f.bankStatementLines, bankAccounts: f.bankAccounts as never, cashbookTotals })
    financeDesk = { cashAtBank, cashInHand, alerts }
  }

  return { today, sales, repairs: { months, currentInvoices }, revenue, recent, invoicedNotDelivered, financeDesk }
}
