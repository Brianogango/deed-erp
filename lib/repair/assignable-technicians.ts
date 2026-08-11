/**
 * Technicians eligible for new repair / refurb assignment.
 * Excludes deactivated system users and HR-exited employees.
 */

type TechUser = {
  id: string
  name: string
  role: string
  active: boolean
  employeeId?: string | null
}

type TechEmployee = {
  id: string
  status: string
}

export function isAssignableTechnician(
  user: TechUser,
  exitedEmployeeIds?: Set<string>,
): boolean {
  if (!['technician', 'technical_lead'].includes(user.role)) return false
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
