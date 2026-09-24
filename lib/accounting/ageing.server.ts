import 'server-only'
import prisma from '@/lib/prisma'
import { bucketOpenInvoices, type AgeingInvoiceLike, type AgeingReport } from '@/lib/accounting/ageing'
import { roundMoney } from '@/lib/accounting/money'
import { invoicePaidAmount } from '@/lib/accounting/invoice-paid'

const OPEN_STATUSES = new Set([
  'approved', 'invoiced', 'dispatched', 'delivered', 'paid', 'partially_paid', 'pending_approval',
])

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10)
}

export async function buildHistoricalAgeing(opts: {
  kind: 'ar' | 'ap'
  asOf: string
}): Promise<AgeingReport & { kind: 'ar' | 'ap'; asOf: string; source: 'prisma' }> {
  const asOfDate = new Date(`${opts.asOf}T23:59:59Z`)
  const documentType = opts.kind === 'ap' ? 'vendor_bill' : 'customer_invoice'

  const invoices = await prisma.invoice.findMany({
    where: {
      documentType,
      invoiceDate: { lte: asOfDate },
      status: { notIn: ['draft', 'cancelled', 'voided'] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      clientId: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      amountPaid: true,
      status: true,
      client: { select: { name: true } },
      paymentAllocations: {
        where: {
          reversedAt: null,
          applicationDate: { lte: asOfDate },
        },
        select: { amount: true },
      },
    },
  })

  const items: AgeingInvoiceLike[] = invoices
    .filter(inv => OPEN_STATUSES.has(String(inv.status)) || String(inv.status) === 'paid' || String(inv.status) === 'partially_paid')
    .map(inv => {
      // See invoicePaidAmount: allocations are the truth when present, the
      // amountPaid cache covers invoices settled before allocations existed.
      const allocated = invoicePaidAmount(inv)
      return {
        id: inv.id,
        ref: inv.invoiceNumber,
        partnerId: inv.clientId,
        partnerName: inv.client?.name || 'Unknown',
        type: documentType,
        status: String(inv.status),
        date: isoDay(inv.invoiceDate),
        dueDate: inv.dueDate ? isoDay(inv.dueDate) : isoDay(inv.invoiceDate),
        total: roundMoney(inv.totalAmount),
        amountPaid: roundMoney(allocated),
      }
    })

  return {
    ...bucketOpenInvoices(items, opts.asOf),
    kind: opts.kind,
    asOf: opts.asOf,
    source: 'prisma',
  }
}
