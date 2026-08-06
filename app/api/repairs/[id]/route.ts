import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { RepairOrder } from '@/lib/store'
import { repairDatesWriteError } from '@/lib/data-validation'

const config = {
  storeKey: 'deed_repairs_v2',
  allowedWriteRoles: ['director', 'admin_officer', 'technical_lead', 'technician'],
  build: () => '' as unknown as RepairOrder,
  validateWrite: (next: RepairOrder) => repairDatesWriteError(next),
}
export const { PATCH, DELETE } = makeDetailHandlers(config)
