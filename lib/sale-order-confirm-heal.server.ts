/**
 * Heal Prisma sale-order status when the client already treats the order as
 * confirmed (SO number / confirmedAt / active delivery) but fire-and-forget
 * sync never persisted `status: 'sale'`.
 */
import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import {
  normalizeDeliveryStatus,
  normalizeSaleStatus,
  saleOrderLooksConfirmed,
} from '@/lib/odoo-sales-flow'

async function hasActiveDeliveryForOrder(saleOrderId: string): Promise<boolean> {
  try {
    const state = await loadAppState(['deed_deliveries'])
    const all = state.deed_deliveries
    if (!Array.isArray(all)) return false
    return all.some((d: any) => {
      if (d?.saleOrderId !== saleOrderId) return false
      const status = normalizeDeliveryStatus(d.status)
      return status === 'waiting' || status === 'ready' || status === 'done'
    })
  } catch {
    return false
  }
}

const saleOrderWithRelations = {
  include: { items: true, client: true },
} as const

export async function ensureConfirmedSaleOrderForFulfillment(order: {
  id: string
  status: string
  confirmedAt: Date | null
  orderNumber: string
}) {
  if (normalizeSaleStatus(order.status) === 'cancelled') return null

  if (normalizeSaleStatus(order.status) === 'sale') {
    return prisma.saleOrder.findUnique({
      where: { id: order.id },
      ...saleOrderWithRelations,
    })
  }

  const looksConfirmed =
    saleOrderLooksConfirmed(order) || (await hasActiveDeliveryForOrder(order.id))
  if (!looksConfirmed) return null

  return prisma.saleOrder.update({
    where: { id: order.id },
    data: {
      status: 'sale',
      confirmedAt: order.confirmedAt ?? new Date(),
    },
    ...saleOrderWithRelations,
  })
}
