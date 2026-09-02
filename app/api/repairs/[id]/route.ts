import { makeDetailHandlers } from '@/lib/server-store-crud'
import type { RepairOrder } from '@/lib/store'
import { repairDatesWriteError } from '@/lib/data-validation'
import { canAccessRecord, normalizePermissionRole } from '@/lib/auth/authorization'
import { repairHardDeleteBlocker } from '@/lib/repair-delete'

const config = {
  storeKey: 'deed_repairs_v2',
  allowedWriteRoles: ['director', 'admin_officer', 'technical_lead', 'technician'],
  build: () => '' as unknown as RepairOrder,
  validateWrite: (next: RepairOrder, previous?: RepairOrder) => repairDatesWriteError(next, new Date(), previous),
  validateDelete: (repair: RepairOrder) => repairHardDeleteBlocker(repair as any),
  recordAccess: (user: any, repair: RepairOrder, action: 'patch' | 'delete') => {
    const role = normalizePermissionRole(user.role)
    // Technicians may work only their assigned/self-created records and may
    // never hard-delete a repair. Leads/admins/director retain operational
    // record management according to allowedWriteRoles.
    if (action === 'delete' && role === 'technician') return false
    return canAccessRecord(
      user.role,
      'repair',
      {
        assignedTechnicianId: repair.assignedTechnicianId,
        createdByUserId: repair.createdByUserId,
      },
      user.id,
      { actsAsTechnician: Boolean(user.actsAsTechnician) },
    )
  },
}
export const { PATCH, DELETE } = makeDetailHandlers(config)
