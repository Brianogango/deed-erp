import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { PurchaseOrder } from '@/lib/store'

const config = { storeKey: 'deed_purchaseOrders', allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'], build: () => '' as unknown as PurchaseOrder }
export const { PATCH, DELETE } = makeDetailHandlers(config)
