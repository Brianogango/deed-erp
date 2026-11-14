import { userCan } from '@/lib/auth/can'
import { isDirector } from '@/lib/auth/roles'

/** Stages at which a repair can be (re)assigned to a technician. */
export const ASSIGNABLE_REPAIR_STATUSES = ['received', 'assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc', 'ready']

/**
 * Who may assign a repair, and when. One rule for the job page and the list.
 * A Director assigns when "Admin assigns jobs" is on; others need
 * repair.assign. Never once the job is finished, nor while the device is at
 * an outsource vendor.
 */
export function canAssignRepair(params: {
  user: Parameters<typeof userCan>[0]
  status: string
  outsourced: boolean
  adminAssignsJobs?: boolean
}): boolean {
  const allowed = isDirector(params.user?.role) ? Boolean(params.adminAssignsJobs) : userCan(params.user, 'repair.assign')
  return allowed && ASSIGNABLE_REPAIR_STATUSES.includes(params.status) && !params.outsourced
}
