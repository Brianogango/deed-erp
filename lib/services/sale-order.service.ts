/**
 * Sale-order service — thin Prisma-first wrappers around existing odoo-sales-flow guards.
 * Client store / app_state blobs remain intact; these methods operate on relational rows.
 */
import prisma from '@/lib/prisma'
import {
  normalizeSaleStatus,
  saleOrderCancelBlockers,
  saleTransitionError,
} from '@/lib/odoo-sales-flow'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { loadAppState } from '@/lib/server-store'

/**
 * Deliveries dual-write to Prisma `delivery_notes` (SO-first schema) while
 * `deed_deliveries` remains the read SoT until parity soak — see
 * docs/BLOB_CUTOVER_PLAN.md. Mirrors the
 * lookup in app/api/sale-orders/[id]/route.ts's saleOrderBlockersFor.
 */
async function blobDeliveriesForSaleOrder(saleOrderId: string): Promise<Array<{ status: string }>> {
  try {
    const state = await loadAppState(['deed_deliveries'])
    const all = state.deed_deliveries
    return Array.isArray(all)
      ? all.filter((d: any) => d?.saleOrderId === saleOrderId).map((d: any) => ({ status: String(d.status) }))
      : []
  } catch {
    return []
  }
}

export class SaleOrderService {
  static async confirm(saleOrderId: string, userId: string, userRole: string) {
    const so = await prisma.saleOrder.findUniqueOrThrow({
      where: { id: saleOrderId },
      include: { items: true },
    })
    const error = saleTransitionError(normalizeSaleStatus(so.status), 'sale', userRole)
    if (error) throw new Error(error)

    const updated = await prisma.saleOrder.update({
      where: { id: saleOrderId },
      data: { status: 'sale', confirmedAt: new Date() },
    })

    await writeFinancialAudit({
      userId,
      action: 'confirm_sale_order',
      entityType: 'SaleOrder',
      entityId: saleOrderId,
      oldValues: { status: so.status },
      newValues: { status: 'sale' },
    })

    return updated
  }

  static async cancel(saleOrderId: string, userId: string) {
    const so = await prisma.saleOrder.findUniqueOrThrow({
      where: { id: saleOrderId },
      include: { items: true },
    })
    const deliveries = await blobDeliveriesForSaleOrder(saleOrderId)
    const invoices = await prisma.invoice.findMany({
      where: { saleOrderId },
      select: { status: true, amountPaid: true },
    })
    const blockers = saleOrderCancelBlockers({
      status: normalizeSaleStatus(so.status),
      deliveries,
      invoices: invoices.map(i => ({ status: i.status, amountPaid: Number(i.amountPaid) })),
    })
    if (blockers.length > 0) throw new Error(blockers.join('; '))

    // Release mirrored reservations (status only — never delete history)
    await prisma.stockReservation.updateMany({
      where: { saleOrderId, status: 'reserved' },
      data: { status: 'cancelled', releasedAt: new Date() },
    }).catch(() => {})

    const updated = await prisma.saleOrder.update({
      where: { id: saleOrderId },
      data: { status: 'cancelled' },
    })

    await writeFinancialAudit({
      userId,
      action: 'cancel_sale_order',
      entityType: 'SaleOrder',
      entityId: saleOrderId,
      oldValues: { status: so.status },
      newValues: { status: 'cancelled' },
    })

    return updated
  }
}
