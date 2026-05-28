import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { SerialNumber } from '@/lib/store'

const config = {
  storeKey: 'deed_serials',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'],
  build: () => '' as unknown as SerialNumber,
}
export const { PATCH, PUT, DELETE } = makeDetailHandlers(config)
