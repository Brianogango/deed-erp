import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { StockMove } from '@/lib/store'

const config = {
  storeKey: 'deed_stockMoves',
  writePermission: 'inventory.stock_moves.edit',
  build: (body: Record<string, unknown>): StockMove | string => {
    if (!body.productId) return 'productId is required'
    return { ...body } as unknown as StockMove
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
