import 'server-only'
import prisma from '@/lib/prisma'
import { invoicePaidAmount } from '@/lib/accounting/invoice-paid'
import {
  computeInvoiceStats,
  type InvoiceStats,
  type StatsInvoiceLike,
} from '@/lib/accounting/invoice-stats'

/**
 * The dashboard's finance tiles, computed in Postgres.
 *
 * The browser used to derive these by looping the whole deed_invoices blob,
 * and only five numbers ever came out of it. This reads the same invoices
 * from the table and hands them to the SAME computeInvoiceStats the browser
 * calls — the server is not a second implementation, so the two answers
 * cannot disagree.
 *
 * One difference, and it is an improvement: `amountPaid` comes from
 * invoicePaidAmount, which prefers the itemised payment allocations and falls
 * back to the cached amount only for invoices settled before allocations
 * existed. The blob carries the cache alone.
 */

const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')

/** Nairobi "today", matching isInvoiceOverdue's own default. */
export function nairobiToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
}

export async function buildInvoiceStats(
  today: string = nairobiToday(),
): Promise<InvoiceStats & { source: 'prisma' }> {
  const rows = await prisma.invoice.findMany({
    // Drafts are excluded by isOpenInvoice and invoicePaymentStatus anyway;
    // filtering here keeps the row set small rather than changing the answer.
    where: { status: { notIn: ['draft'] } },
    select: {
      documentType: true,
      status: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      amountPaid: true,
      paymentBlocked: true,
      paymentAllocations: {
        where: { reversedAt: null },
        select: { amount: true },
      },
    },
  })

  const invoices: StatsInvoiceLike[] = rows.map(row => ({
    type: String(row.documentType),
    status: String(row.status),
    total: Number(row.totalAmount) || 0,
    amountPaid: invoicePaidAmount(row),
    date: isoDay(row.invoiceDate),
    dueDate: isoDay(row.dueDate) || isoDay(row.invoiceDate),
    paymentBlocked: row.paymentBlocked === true,
  }))

  const stats = computeInvoiceStats(invoices, today)
  const round = (n: number) => Math.round(n * 100) / 100

  return {
    revenue: round(stats.revenue),
    outstanding: round(stats.outstanding),
    payables: round(stats.payables),
    overdueCount: stats.overdueCount,
    pendingBillCount: stats.pendingBillCount,
    source: 'prisma',
  }
}
