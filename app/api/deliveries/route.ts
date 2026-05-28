import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Delivery } from '@/lib/store'

const config = {
  storeKey: 'deed_deliveries',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'inventory_officer'],
  build: (body: Record<string, unknown>): Delivery | string => {
    if (!body.saleOrderId) return 'saleOrderId is required'
    return { ...body } as Delivery
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
