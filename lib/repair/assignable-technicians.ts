/**
 * Technicians eligible for new repair / refurb assignment.
 * Excludes deactivated system users and HR-exited employees.
 * Includes users with the per-user actsAsTechnician flag (e.g. a chosen Kilimall officer).
 */

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
