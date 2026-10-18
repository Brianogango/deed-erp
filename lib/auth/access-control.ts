/**
 * Rules for changing who can do what — pure, shared by the user API routes and
 * the Settings screen.
 */
import { ROLE_DEFAULT_MODULES, type ModuleId, type UserRole } from './types'

export interface AccessSnapshot {
  role: string
  modules: string[]
  active: boolean
  actsAsTechnician: boolean
  /** Name of the custom role the person is on, '' for a built-in role. */
  customRole: string
}

export interface AccessDiff {
  changed: boolean
  role?: { from: string; to: string }
  modulesAdded: string[]
  modulesRemoved: string[]
  active?: { from: boolean; to: boolean }
  actsAsTechnician?: { from: boolean; to: boolean }
  customRole?: { from: string; to: string }
}

export const snapshotAccess = (
  user: (Partial<Omit<AccessSnapshot, 'customRole'>> & { accessRole?: { name?: string } | null; customRole?: string }) | null | undefined,
): AccessSnapshot => ({
  role: String(user?.role ?? ''),
  modules: Array.isArray(user?.modules) ? [...user!.modules].map(String).sort() : [],
  active: user?.active !== false,
  actsAsTechnician: user?.actsAsTechnician === true,
  customRole: String(user?.customRole ?? user?.accessRole?.name ?? ''),
})

export function diffAccess(before: AccessSnapshot, after: AccessSnapshot): AccessDiff {
  const had = new Set(before.modules)
  const has = new Set(after.modules)
  const diff: AccessDiff = {
    changed: false,
    modulesAdded: after.modules.filter(m => !had.has(m)),
    modulesRemoved: before.modules.filter(m => !has.has(m)),
  }
  if (before.role !== after.role) diff.role = { from: before.role, to: after.role }
  if (before.active !== after.active) diff.active = { from: before.active, to: after.active }
  if (before.actsAsTechnician !== after.actsAsTechnician) diff.actsAsTechnician = { from: before.actsAsTechnician, to: after.actsAsTechnician }
  if (before.customRole !== after.customRole) diff.customRole = { from: before.customRole, to: after.customRole }
  diff.changed = Boolean(diff.role || diff.active || diff.actsAsTechnician || diff.customRole || diff.modulesAdded.length || diff.modulesRemoved.length)
  return diff
}

const label = (value: string) => value.replace(/_/g, ' ')

/** One line a person can read in a history list. */
export function describeAccessDiff(diff: AccessDiff): string {
  const parts: string[] = []
  if (diff.customRole) {
    parts.push(diff.customRole.to
      ? `moved onto the custom role “${diff.customRole.to}”${diff.customRole.from ? ` (was “${diff.customRole.from}”)` : ''}`
      : `moved off the custom role “${diff.customRole.from}”`)
  } else if (diff.role) {
    parts.push(`role ${label(diff.role.from)} → ${label(diff.role.to)}`)
  }
  if (diff.active) parts.push(diff.active.to ? 'reactivated' : 'deactivated')
  if (diff.modulesAdded.length) parts.push(`gained ${diff.modulesAdded.map(label).join(', ')}`)
  if (diff.modulesRemoved.length) parts.push(`lost ${diff.modulesRemoved.map(label).join(', ')}`)
  if (diff.actsAsTechnician) parts.push(diff.actsAsTechnician.to ? 'can now act as a technician' : 'no longer acts as a technician')
  return parts.join('; ') || 'no change'
}

/** Old role names that still mean Director. */
const isDirectorRole = (role: string) => ['director', 'admin', 'super_admin'].includes(role)

export const LAST_DIRECTOR_MESSAGE =
  'This is the last active Director. Make another user a Director first, otherwise nobody could manage users or settings.'

/**
 * A change must never leave the company without an active Director. Returns the
 * message to refuse with, or null when the change is fine. A company that
 * already has no active Director is not blocked, so it can be repaired.
 */
export function lastDirectorViolation(
  users: Array<{ id: string; role: string; active: boolean }>,
  targetId: string,
  next: { role?: string; active?: boolean; removed?: boolean },
): string | null {
  const activeDirectors = (list: Array<{ id: string; role: string; active: boolean }>) =>
    list.filter(u => u.active && isDirectorRole(u.role)).length
  if (activeDirectors(users) === 0) return null
  const after = users.flatMap(u => {
    if (u.id !== targetId) return [u]
    if (next.removed) return []
    return [{ ...u, role: next.role ?? u.role, active: next.active ?? u.active }]
  })
  return activeDirectors(after) === 0 ? LAST_DIRECTOR_MESSAGE : null
}

const DEFAULT_SELF_SERVICE = new Set<string>(['hr', 'sops', 'sop_documents', 'expenses', 'leave', 'my_documents', 'dashboard'])

/** The modules a role opens with — the baseline "custom" access is measured against. */
export const roleDefaultModules = (role: string): ModuleId[] =>
  ROLE_DEFAULT_MODULES[role as UserRole] ?? []

/**
 * Modules ticked for a user that their role does not normally have. They open
 * the screen, but the role's own rules still decide which actions work, so the
 * form tells the person setting this up before it surprises the user.
 */
export function modulesOutsideRole(role: string, modules: readonly string[]): string[] {
  if (isDirectorRole(role)) return []
  const normal = new Set<string>(roleDefaultModules(role))
  return modules.filter(m => !normal.has(m) && !DEFAULT_SELF_SERVICE.has(m))
}
