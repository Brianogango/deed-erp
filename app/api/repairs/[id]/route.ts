import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { RepairOrder } from '@/lib/store'

const config = { storeKey: 'deed_repairs_v2', allowedWriteRoles: ['director', 'admin_officer', 'lead_tech', 'technician'], build: () => '' as unknown as RepairOrder }
export const { PATCH, DELETE } = makeDetailHandlers(config)
