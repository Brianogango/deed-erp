import { normalizeClientRole } from '@/lib/auth/access'

/**
 * Technicians eligible for new repair / refurb assignment.
 * Excludes deactivated system users and HR-exited employees.
 * Includes users with the per-user actsAsTechnician flag (e.g. a chosen Kilimall officer).
 */

/**
 * Roles allowed to assign a technician to a repair job.
 *
 * The role is normalized first so legacy aliases resolve to their canonical
 * role — critically `lead_tech` → `technical_lead`, so a Technical Lead stored
 * under either value can assign jobs. Checking the raw role skipped `lead_tech`
 * users and silently blocked them from assigning.
 */
export function isRepairAssignerRole(role: string | null | undefined): boolean {
  return ['technical_lead', 'director'].includes(normalizeClientRole(role))
}

type TechUser = {
  id: string
  name: string
  role: string
  active: boolean
  employeeId?: string | null
  actsAsTechnician?: boolean
}

type TechEmployee = {
  id: string
  status: string
}

/** True when this user should follow technician firewall rules (assigned jobs only). */
export function isRepairTechActor(user: {
  role: string
  actsAsTechnician?: boolean
}): boolean {
  return user.role === 'technician' || user.actsAsTechnician === true
}

export function isAssignableTechnician(
  user: TechUser,
  exitedEmployeeIds?: Set<string>,
): boolean {
  const roleOk =
    ['technician', 'technical_lead'].includes(user.role) || user.actsAsTechnician === true
  if (!roleOk) return false
  if (user.active === false) return false
  if (user.employeeId && exitedEmployeeIds?.has(user.employeeId)) return false
  return true
}

export function assignableTechnicians(
  users: TechUser[],
  employees: TechEmployee[] = [],
): TechUser[] {
  const exitedEmployeeIds = new Set(
    employees.filter(e => e.status === 'exited').map(e => e.id),
  )
  return users.filter(u => isAssignableTechnician(u, exitedEmployeeIds))
}
