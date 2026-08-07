import { makeCollectionHandlers } from '@/lib/server-store-crud'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { deliveryFulfillmentWriteError } from '@/lib/odoo-sales-flow'
import { ensureConfirmedSaleOrderForFulfillment } from '@/lib/sale-order-confirm-heal.server'
import { mirrorDeliveryToPrisma } from '@/lib/delivery-mirror'
import prisma from '@/lib/prisma'
import type { Delivery } from '@/lib/store'

const config = {
  storeKey: 'deed_deliveries',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'inventory_officer'],
  prepareCreate: async (body: Record<string, unknown>) => {
    if (!body.ref) body.ref = await getNextDocNumber('delivery_note')
    const saleOrderId = typeof body.saleOrderId === 'string' ? body.saleOrderId : ''
    if (saleOrderId) {
      try {
        const order = await prisma.saleOrder.findUnique({
          where: { id: saleOrderId },
          select: { id: true, status: true, confirmedAt: true, orderNumber: true },
        })
        if (order) await ensureConfirmedSaleOrderForFulfillment(order)
      } catch {
        // Best-effort heal — delivery create must still proceed.
      }
    }
    return body
  },
  build: (body: Record<string, unknown>): Delivery | string => {
    if (!body.saleOrderId) return 'saleOrderId is required'
    return { ...body } as unknown as Delivery
  },
  validateWrite: (next: Delivery) => deliveryFulfillmentWriteError(next, null),
  // Best-effort dual-write into delivery_notes/delivery_note_items — see
  // lib/delivery-mirror.ts. The blob write above already succeeded and
  // remains authoritative; this never blocks or fails the request.
  onWritten: async (item: Delivery) => { await mirrorDeliveryToPrisma(item) },
}

export const { GET, POST } = makeCollectionHandlers(config)
