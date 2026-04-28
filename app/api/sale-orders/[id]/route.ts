import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { SaleOrder } from '@/lib/store'

const config = { storeKey: 'deed_saleOrders', allowedWriteRoles: ['admin', 'sales_rep'], build: () => '' as unknown as SaleOrder }
export const { PATCH, DELETE } = makeDetailHandlers(config)
