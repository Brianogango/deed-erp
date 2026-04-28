import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { PurchaseOrder } from '@/lib/store'

const config = { storeKey: 'deed_purchaseOrders', allowedWriteRoles: ['admin', 'finance', 'lead_tech'], build: () => '' as unknown as PurchaseOrder }
export const { PATCH, DELETE } = makeDetailHandlers(config)
