/**
 * Role names — the one place they are translated. Pure and client-safe.
 *
 * Users saved long ago may carry an old role name; every check reads the
 * current name through canonicalRole. Role names are not permissions: decide
 * access with userCan (lib/auth/can.ts), never by comparing names.
 */
import type { UserRole } from './types'

/** Old role name → current role. */
const OLD_ROLE_NAMES: Readonly<Record<string, UserRole>> = {
  super_admin: 'director',
  admin: 'director',
  finance: 'finance_officer',
  inventory: 'inventory_officer',
  kilimall: 'kilimall_officer',
  sales: 'sales_rep',
  lead_tech: 'technical_lead',
  repair_tech: 'technician',
}

/** The current name of a role ('' when there is none). An unknown name is kept as it is. */
export function canonicalRole(role: unknown): string {
  if (typeof role !== 'string' || !role) return ''
  return OLD_ROLE_NAMES[role] ?? role
}

/** canonicalRole as a UserRole, or null when there is no role. */
export function canonicalUserRole(role: unknown): UserRole | null {
  const name = canonicalRole(role)
  return name ? (name as UserRole) : null
}

export const isDirector = (role: unknown) => canonicalRole(role) === 'director'

/**
 * Every name a role may be stored under: the current name plus its old ones.
 * Use it when users are looked up by role in the database, so a user saved
 * under an old name is never left out.
 */
export function storedRoleNames(roles: readonly string[]): string[] {
  const wanted = new Set(roles.map(canonicalRole).filter(Boolean))
  const out = new Set<string>(wanted)
  for (const [old, current] of Object.entries(OLD_ROLE_NAMES)) if (wanted.has(current)) out.add(old)
  return [...out]
}
