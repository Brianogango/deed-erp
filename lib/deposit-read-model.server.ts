import 'server-only'

import prisma from '@/lib/prisma'
import { cachedByFingerprint } from '@/lib/read-model-cache'

/**
 * Customer deposits as the screens use them, read from the deposits table
 * (the deed_deposits screen copy is frozen). Every deposit action already
 * goes through /api/deposits, which keeps the totals, status and payments in
 * the table; the copy used to be mirrored back over the table, rebuilding
 * each deposit's payments from it and dropping the ledger links the server
 * had recorded. Deposits only the frozen copy has stay listed.
 */

type Row = Record<string, any>

export function depositToScreen(d: any) {
  return {
    id: d.id,
    ref: d.ref,
    customerId: d.customerId ?? '',
    customerName: d.customerName ?? '',
    customerPhone: d.customerPhone ?? '',
    items: (d.items ?? []).map((x: any) => ({
      id: x.id,
      productId: x.productId ?? '',
      productName: x.productName ?? '',
      sku: x.sku ?? '',
      qty: x.qty,
      unitPrice: Number(x.unitPrice),
      total: Number(x.lineTotal),
    })),
    totalValue: Number(d.totalValue),
    totalPaid: Number(d.totalPaid),
    balance: Number(d.balance),
    status: d.status,
    payments: (d.payments ?? []).map((p: any) => ({
      id: p.id,
      date: p.paidAt.toISOString(),
      amount: Number(p.amount),
      method: p.method,
      ref: p.paymentRef ?? undefined,
      recordedBy: p.recordedBy ?? '',
    })),
    notes: d.notes ?? undefined,
    dueDate: d.dueDate?.toISOString().slice(0,10),
    completedAt: d.completedAt?.toISOString(),
    cancelledAt: d.cancelledAt?.toISOString(),
    cancelReason: d.cancelReason ?? undefined,
    createdAt: d.createdAt.toISOString(),
    createdBy: d.createdBy ?? '',
  }
}


export async function loadScreenDeposits(screenCopy: unknown): Promise<Row[]> {
  const copy = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  return cachedByFingerprint(
    'deposits',
    async () => {
      // Whole-row hashes: these tables are small, and any column change counts.
      const rows = await prisma.$queryRawUnsafe<Array<{ fp: string | null }>>(`
        SELECT concat_ws('|',
          (SELECT count(*) || ':' || md5(coalesce(string_agg(d::text, ',' ORDER BY d.id), '')) FROM deposits d),
          (SELECT count(*) || ':' || md5(coalesce(string_agg(i::text, ',' ORDER BY i.id), '')) FROM deposit_items i),
          (SELECT count(*) || ':' || md5(coalesce(string_agg(p::text, ',' ORDER BY p.id), '')) FROM deposit_payments p)
        ) AS fp`)
      const fp = rows[0]?.fp
      return fp ? `${fp}|copy:${copy.length}:${String(copy[0]?.id ?? '')}:${String(copy[copy.length - 1]?.id ?? '')}` : ''
    },
    () => buildScreenDeposits(copy),
  )
}

async function buildScreenDeposits(screenCopy: Row[]): Promise<Row[]> {
  const rows = await prisma.deposit.findMany({
    include: { items: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { paidAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
  const out: Row[] = rows.map(depositToScreen)
  const known = new Set(rows.flatMap(r => [r.id, r.blobId, r.ref].filter(Boolean) as string[]))
  for (const d of Array.isArray(screenCopy) ? screenCopy as Row[] : []) {
    if (d?.id && !known.has(String(d.id)) && !known.has(String(d.ref ?? ''))) out.push(d)
  }
  return out
}
