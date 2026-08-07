import { makeDetailHandlers } from '@/lib/server-store-crud'
import { deliveryFulfillmentWriteError } from '@/lib/odoo-sales-flow'
import { mirrorDeliveryToPrisma } from '@/lib/delivery-mirror'
import type { Delivery } from '@/lib/store'

const config = {
  storeKey: 'deed_deliveries',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'inventory_officer', 'technical_lead'],
  build: () => '' as unknown as Delivery,
  validateWrite: (next: Delivery, previous: Delivery | undefined) =>
    deliveryFulfillmentWriteError(next, previous ?? null),
  // Concurrent PATCHes to different deliveries otherwise race on the same
  // read-modify-write cycle over the shared deed_deliveries collection.
  lockKey: 'deed_deliveries',
  // Best-effort dual-write into delivery_notes/delivery_note_items — see
  // lib/delivery-mirror.ts. Covers prepare/update; validate has its own
  // explicit call since it does not go through this generic PATCH handler.
  onWritten: async (item: Delivery) => { await mirrorDeliveryToPrisma(item) },
}
export const { PATCH, PUT, DELETE } = makeDetailHandlers(config)
