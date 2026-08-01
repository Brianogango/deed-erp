import { makeDetailHandlers } from '@/lib/server-store-crud'
import { deliveryFulfillmentWriteError } from '@/lib/odoo-sales-flow'
import type { Delivery } from '@/lib/store'

const config = {
  storeKey: 'deed_deliveries',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'inventory_officer', 'technical_lead'],
  build: () => '' as unknown as Delivery,
  validateWrite: (next: Delivery, previous: Delivery | undefined) =>
    deliveryFulfillmentWriteError(next, previous ?? null),
}
export const { PATCH, PUT, DELETE } = makeDetailHandlers(config)
