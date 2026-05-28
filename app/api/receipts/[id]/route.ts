import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { Receipt } from '@/lib/store'

const config = {
  storeKey: 'deed_receipts',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'],
  build: () => '' as unknown as Receipt,
}
export const { PATCH, PUT, DELETE } = makeDetailHandlers(config)
