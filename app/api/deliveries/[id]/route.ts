import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Delivery } from '@/lib/store'

const config = {
  storeKey: 'deed_deliveries',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'inventory_officer'],
  build: () => '' as unknown as Delivery,
}
export const { PATCH, PUT, DELETE } = makeDetailHandlers(config)
