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
    const deliveries = await prisma.deliveryNote.findMany({
      where: { invoice: { is: { saleOrderId } } },
      select: { status: true },
    }).catch(() => [] as { status: string }[])
    const invoices = await prisma.invoice.findMany({
      where: { saleOrderId },
      select: { status: true, amountPaid: true },
    })
    const blockers = saleOrderCancelBlockers({
      status: normalizeSaleStatus(so.status),
      deliveries: deliveries.map(d => ({ status: d.status })),
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
