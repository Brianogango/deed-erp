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
  // Technical leads / directors keep workshop oversight even when they also
  // take jobs (actsAsTechnician). Treating them as technicians hid the rest
  // of the bench and blocked diagnosis on jobs assigned to someone else.
  if (isRepairAssignerRole(user.role)) return false
  return normalizeClientRole(user.role) === 'technician' || user.actsAsTechnician === true
}

/** Public fields needed to assign a job — never email, credentials, or HR PII. */
export function toAssignableTechnicianPublic(user: TechUser & {
  username?: string
  modules?: string[]
}): TechUser & { username?: string; modules?: string[] } {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    active: user.active !== false,
    employeeId: user.employeeId ?? null,
    actsAsTechnician: user.actsAsTechnician === true,
    username: user.username,
    modules: Array.isArray(user.modules) ? [...user.modules] : [],
  }
}

export function isAssignableTechnician(
  user: TechUser,
  exitedEmployeeIds?: Set<string>,
): boolean {
  const normalizedRole = normalizeClientRole(user.role)
  const roleOk =
    ['technician', 'technical_lead'].includes(normalizedRole) || user.actsAsTechnician === true
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

/** Union a compact technician list into the session users array without dropping the current user. */
export function mergeAssignableTechniciansIntoUsers<T extends { id: string }>(
  current: T[],
  technicians: T[],
): T[] {
  const byId = new Map(current.map(u => [u.id, u]))
  for (const tech of technicians) {
    const prev = byId.get(tech.id)
    byId.set(tech.id, prev ? { ...prev, ...tech } : tech)
  }
  return [...byId.values()]
}
