import {
  invoicePaymentStatus,
  invoiceResidual,
  isInvoiceOverdue,
  isOpenInvoice,
} from '@/lib/odoo-sales-flow'

/**
 * The five finance numbers the dashboard shows, and nothing else.
 *
 * This is deliberately a pure function over the same predicates the browser
 * uses, so the server and the client cannot drift apart: the server maps
 * database rows into this shape and calls this; the browser passes its own
 * invoices to this and gets an identical answer. That equivalence is what the
 * tests pin.
 *
 * The dashboard previously built two arrays of invoices here — overdue ones
 * and pending bills — but only ever read their lengths, so only the counts
 * survive.
 */

export type StatsInvoiceLike = {
  type?: string
  status?: unknown
  total: number
  amountPaid: number
  date?: string
  dueDate?: string
  paymentBlocked?: boolean
  /**
   * Present for shape-compatibility with the browser's invoices. Nothing in
   * the application has ever written `cleared`, so invoicePaymentStatus can
   * never return 'in_payment' — see the note in computeInvoiceStats.
   */
  payments?: { cleared?: boolean }[]
}

export type InvoiceStats = {
  revenue: number
  outstanding: number
  payables: number
  overdueCount: number
  pendingBillCount: number
}

export function computeInvoiceStats(
  invoices: readonly StatsInvoiceLike[] | null | undefined,
  today?: string,
): InvoiceStats {
  let revenue = 0
  let outstanding = 0
  let payables = 0
  let overdueCount = 0
  let pendingBillCount = 0

  for (const invoice of invoices ?? []) {
    if (invoice.type === 'customer_invoice') {
      // invoicePaymentStatus is called rather than inlined so that if the
      // definition of "paid" ever changes — for instance if payment clearing
      // is actually implemented — both sides change together.
      if (invoicePaymentStatus(invoice as never) === 'paid') revenue += Number(invoice.total) || 0
      if (isOpenInvoice(invoice as never)) {
        outstanding += invoiceResidual(invoice as never)
        if (today ? isInvoiceOverdue(invoice as never, today) : isInvoiceOverdue(invoice as never)) {
          overdueCount += 1
        }
      }
    }
    if (invoice.type === 'vendor_bill' && isOpenInvoice(invoice as never)) {
      payables += invoiceResidual(invoice as never)
      pendingBillCount += 1
    }
  }

  return { revenue, outstanding, payables, overdueCount, pendingBillCount }
}
