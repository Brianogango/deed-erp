import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { SerialNumber } from '@/lib/store'

const config = {
  storeKey: 'deed_serials',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'],
  build: (body: Record<string, unknown>): SerialNumber | string => {
    if (!body.productId) return 'productId is required'
    return { ...body } as unknown as SerialNumber
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
