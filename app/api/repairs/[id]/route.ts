import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { RepairOrder } from '@/lib/store'

const config = { storeKey: 'deed_repairs_v2', allowedWriteRoles: ['admin', 'lead_tech', 'repair_tech'], build: () => '' as unknown as RepairOrder }
export const { PATCH, DELETE } = makeDetailHandlers(config)
