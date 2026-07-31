import { makeCollectionHandlers } from '@/lib/server-store-crud'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import type { Delivery } from '@/lib/store'

const config = {
  storeKey: 'deed_deliveries',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'inventory_officer'],
  prepareCreate: async (body: Record<string, unknown>) => {
    if (!body.ref) body.ref = await getNextDocNumber('delivery_note')
    return body
  },
  build: (body: Record<string, unknown>): Delivery | string => {
    if (!body.saleOrderId) return 'saleOrderId is required'
    return { ...body } as unknown as Delivery
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
