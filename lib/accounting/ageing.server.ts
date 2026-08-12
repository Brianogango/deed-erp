/**
 * Ageing report from Prisma invoices (Finance Phase 12).
 * AR = customer invoices (no PO). AP = vendor bills (has purchaseOrderId).
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { bucketOpenInvoices, type AgeingInvoiceLike, type AgeingReport } from '@/lib/accounting/ageing'

export async function buildAgeingFromPrisma(params: {
  kind: 'ar' | 'ap'
  asOf?: string | null
}): Promise<AgeingReport> {
  const asOf = params.asOf || new Date().toISOString().slice(0, 10)
  const isAp = params.kind === 'ap'

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { notIn: ['draft', 'cancelled', 'voided'] },
      ...(isAp ? { purchaseOrderId: { not: null } } : { purchaseOrderId: null }),
    },
    include: {
      client: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    take: 2000,
  })

  const likes: AgeingInvoiceLike[] = invoices.map(inv => {
    const paid = Number(inv.amountPaid || 0)
      || inv.payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    return {
      id: inv.id,
      ref: inv.invoiceNumber,
      partnerId: inv.clientId,
      partnerName: inv.client?.name || 'Unknown',
      type: isAp ? 'vendor_bill' : 'customer_invoice',
      status: String(inv.status),
      date: inv.invoiceDate.toISOString().slice(0, 10),
      dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : undefined,
      total: Number(inv.totalAmount || 0),
      amountPaid: paid,
    }
  })

  return bucketOpenInvoices(likes, asOf)
}
