/**
 * Revenue by customer, from the invoice ledger.
 *
 * The dashboard's own ranking counts fully-invoiced sale orders and till
 * sales, so a customer whose business is repairs, or whose invoice was
 * raised straight in Finance, barely registered. Posted customer invoices
 * are where revenue actually lands, whatever produced them, so this reads
 * them instead.
 *
 * Pure — the route feeds it the rows the viewer may see.
 */
import { invoiceDocState } from '@/lib/odoo-sales-flow'
import { customerRevenue, type CustomerRevenueRow } from '@/lib/dashboard/sales-analytics'

type Row = Record<string, any>

export interface CustomerRevenueResult {
  rows: CustomerRevenueRow[]
  /** Every customer's revenue in the window, including those outside the top. */
  total: number
  shown: number
  others: number
  customers: number
  /** Invoices that carried no customer at all. */
  invoices: number
}

const money = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const monthOf = (value: unknown): string => String(value ?? '').slice(0, 7)

/**
 * What one invoice adds to its customer's revenue. A credit note subtracts,
 * whether it was stored with a negative total or only flagged.
 */
export function invoiceRevenueValue(invoice: Row): number {
  const total = money(invoice.total)
  return invoice.isCreditNote ? -Math.abs(total) : total
}

/** Posted customer invoices only: no drafts, no cancellations, no purchases. */
export function countsAsCustomerRevenue(invoice: Row): boolean {
  if (!invoice || typeof invoice !== 'object') return false
  if (invoice.type === 'vendor_bill') return false
  if (invoiceDocState(invoice.status) !== 'posted') return false
  // A balance carried over from the old system is not a sale.
  if (invoice.isOpeningBalance) return false
  return true
}

export function customerRevenueFromInvoices(
  invoices: unknown,
  opts: { months?: ReadonlySet<string>; limit?: number } = {},
): CustomerRevenueResult {
  const list = Array.isArray(invoices) ? invoices : []
  const sales = []
  for (const invoice of list as Row[]) {
    if (!countsAsCustomerRevenue(invoice)) continue
    if (opts.months && !opts.months.has(monthOf(invoice.date))) continue
    sales.push({
      customerId: invoice.partnerId,
      customerName: invoice.partnerName,
      total: invoiceRevenueValue(invoice),
    })
  }
  const all = customerRevenue(sales)
  const rows = all.slice(0, opts.limit ?? 5)
  const total = all.reduce((sum, row) => sum + row.revenue, 0)
  const shown = rows.reduce((sum, row) => sum + row.revenue, 0)
  return { rows, total, shown, others: total - shown, customers: all.length, invoices: sales.length }
}
