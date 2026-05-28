import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { StockMove } from '@/lib/store'

const config = {
  storeKey: 'deed_stockMoves',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'],
  build: (body: Record<string, unknown>): StockMove | string => {
    if (!body.productId) return 'productId is required'
    return { ...body } as StockMove
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
