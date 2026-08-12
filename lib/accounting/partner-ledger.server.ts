/**
 * Partner ledger from Prisma invoices (Finance Phase 12).
 * Customer AR: invoices without purchaseOrderId.
 * Vendor AP: invoices linked to a purchase order (vendor bills).
 */

import 'server-only'
import prisma from '@/lib/prisma'

export type PartnerLedgerTxn = {
  id: string
  ref: string
  date: string
  type: string
  total: number
  amountPaid: number
  status: string
  outstanding: number
  movingBalance: number
  source: 'invoice'
}

export async function buildPartnerLedgerFromPrisma(params: {
  partnerId?: string | null
  partnerName?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  kind?: 'ar' | 'ap' | 'all'
}): Promise<{ rows: PartnerLedgerTxn[]; partnerName: string | null }> {
  const partnerId = params.partnerId?.trim() || null
  const partnerName = params.partnerName?.trim() || null
  if (!partnerId && !partnerName) return { rows: [], partnerName: null }

  const kind = params.kind || 'all'
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { notIn: ['draft', 'cancelled', 'voided'] },
      ...(partnerId ? { clientId: partnerId } : {}),
      ...(partnerName && !partnerId
        ? { client: { name: { contains: partnerName, mode: 'insensitive' } } }
        : {}),
      ...(params.dateFrom || params.dateTo
        ? {
            invoiceDate: {
              ...(params.dateFrom ? { gte: new Date(`${params.dateFrom}T00:00:00Z`) } : {}),
              ...(params.dateTo ? { lte: new Date(`${params.dateTo}T23:59:59Z`) } : {}),
            },
          }
        : {}),
      ...(kind === 'ar' ? { purchaseOrderId: null } : {}),
      ...(kind === 'ap' ? { purchaseOrderId: { not: null } } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { invoiceDate: 'asc' },
    take: 500,
  })

  let running = 0
  const rows: PartnerLedgerTxn[] = invoices.map(inv => {
    const total = Number(inv.totalAmount || 0)
    const amountPaid = Number(inv.amountPaid || 0)
      || inv.payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    const type = inv.purchaseOrderId ? 'vendor_bill' : 'customer_invoice'
    const signed = type === 'customer_invoice' ? total : -total
    running += signed
    return {
      id: inv.id,
      ref: inv.invoiceNumber,
      date: inv.invoiceDate.toISOString().slice(0, 10),
      type,
      total,
      amountPaid,
      status: String(inv.status),
      outstanding: Math.max(0, total - amountPaid),
      movingBalance: running,
      source: 'invoice' as const,
    }
  })

  return {
    rows,
    partnerName: invoices[0]?.client?.name || partnerName,
  }
}
