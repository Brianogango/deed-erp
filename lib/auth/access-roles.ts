/**
 * Roles as data. The eight roles the app has always had are built in and
 * read-only; a Director can add custom roles that pick exactly which parts of
 * which modules a person may use. Pure — no database here.
 */
import { MODULE_IDS, ROLE_DEFAULT_MODULES, USER_ROLES, type ModuleId, type UserRole } from './types'
import {
  PERMISSION_BY_KEY,
  PERMISSION_GROUPS,
  builtInPermissions,
  isKnownPermission,
} from './permission-catalog'

export interface AccessRole {
  id: string
  name: string
  description: string
  /**
   * The built-in role that screens and routes not yet converted to individual
   * permissions treat this role as. Never Director.
   */
  baseRole: UserRole
  modules: ModuleId[]
  permissions: string[]
  builtIn: boolean
}

export const BUILT_IN_ROLE_LABELS: Record<UserRole, string> = {
  director: 'Director',
  admin_officer: 'Admin Officer',
  finance_officer: 'Finance Officer',
  inventory_officer: 'Inventory Officer',
  kilimall_officer: 'Kilimall Officer',
  sales_rep: 'Sales Rep',
  technical_lead: 'Technical Lead',
  technician: 'Technician',
}

export const builtInRoleId = (role: UserRole) => `builtin:${role}`

/** The eight original roles, expressed as permission sets so they can be viewed and copied. */
export const BUILT_IN_ROLES: AccessRole[] = USER_ROLES.map(role => ({
  id: builtInRoleId(role),
  name: BUILT_IN_ROLE_LABELS[role],
  description: 'Built in — cannot be changed. Copy it to make a custom role.',
  baseRole: role,
  modules: [...ROLE_DEFAULT_MODULES[role]],
  permissions: builtInPermissions(role, ROLE_DEFAULT_MODULES[role]),
  builtIn: true,
}))

/** Never grantable to a custom role: it lets the holder create users and roles. */
export const DIRECTOR_ONLY_PERMISSIONS = ['manageUsers'] as const

/** Modules that are open to every signed-in user and so need no switch. */
const ALWAYS_OPEN = new Set<string>(['hr', 'sops', 'sop_documents', 'expenses', 'leave', 'my_documents'])

const moduleOfGroup = (groupId: string): ModuleId | null =>
  PERMISSION_GROUPS.find(g => g.id === groupId)?.module ?? null

/**
 * A permission only counts when the module it lives in can be opened. Returns
 * the permissions that count, in catalog order.
 */
export function effectivePermissions(modules: readonly string[], permissions: readonly string[]): string[] {
  const open = new Set([...modules, ...ALWAYS_OPEN])
  const wanted = new Set(permissions)
  return PERMISSION_GROUPS.flatMap(group => group.items)
    .filter(def => wanted.has(def.key))
    .filter(def => {
      const module = moduleOfGroup(def.group)
      return module === null || open.has(module)
    })
    .map(def => def.key)
}

export interface RoleInput {
  name?: unknown
  description?: unknown
  baseRole?: unknown
  modules?: unknown
  permissions?: unknown
}

export type RoleValidation =
  | { ok: true; value: Pick<AccessRole, 'name' | 'description' | 'baseRole' | 'modules' | 'permissions'> }
  | { ok: false; error: string }

const isModuleId = (value: unknown): value is ModuleId => typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value)

/** Checks and cleans what the role editor sends. Unknown names are refused, never guessed. */
export function validateRoleInput(input: RoleInput): RoleValidation {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : ''
  if (name.length < 2) return { ok: false, error: 'Give the role a name (at least 2 characters)' }
  if (name.length > 60) return { ok: false, error: 'The role name is too long (60 characters at most)' }
  if (BUILT_IN_ROLES.some(r => r.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `“${name}” is a built-in role. Choose another name, or copy it under a new name.` }
  }

  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 300) : ''

  const baseRole = input.baseRole
  if (typeof baseRole !== 'string' || !(USER_ROLES as readonly string[]).includes(baseRole)) {
    return { ok: false, error: 'Choose the built-in role this one is based on' }
  }
  if (baseRole === 'director') return { ok: false, error: 'A custom role cannot be based on Director' }

  if (!Array.isArray(input.modules)) return { ok: false, error: 'Choose the modules this role can open' }
  const badModule = input.modules.find(m => !isModuleId(m))
  if (badModule !== undefined) return { ok: false, error: `Unknown module: ${String(badModule)}` }
  const modules = [...new Set(input.modules as ModuleId[])]
  if (!modules.includes('dashboard')) modules.unshift('dashboard')

  if (!Array.isArray(input.permissions)) return { ok: false, error: 'Choose the permissions this role holds' }
  const unknown = input.permissions.find(p => typeof p !== 'string' || !isKnownPermission(p))
  if (unknown !== undefined) return { ok: false, error: `Unknown permission: ${String(unknown)}` }
  const forbidden = (input.permissions as string[]).find(p => (DIRECTOR_ONLY_PERMISSIONS as readonly string[]).includes(p))
  if (forbidden) return { ok: false, error: `“${PERMISSION_BY_KEY[forbidden].label}” can only be held by a Director` }

  return {
    ok: true,
    value: {
      name,
      description,
      baseRole: baseRole as UserRole,
      modules,
      permissions: effectivePermissions(modules, input.permissions as string[]),
    },
  }
}

export interface RoleDiff {
  changed: boolean
  nameChanged?: { from: string; to: string }
  baseRoleChanged?: { from: string; to: string }
  modulesAdded: string[]
  modulesRemoved: string[]
  permissionsAdded: string[]
  permissionsRemoved: string[]
}

type RoleSnapshot = Pick<AccessRole, 'name' | 'baseRole' | 'modules' | 'permissions'>

export function diffRoles(before: RoleSnapshot, after: RoleSnapshot): RoleDiff {
  const b = { m: new Set(before.modules as string[]), p: new Set(before.permissions) }
  const a = { m: new Set(after.modules as string[]), p: new Set(after.permissions) }
  const diff: RoleDiff = {
    changed: false,
    modulesAdded: [...a.m].filter(m => !b.m.has(m)),
    modulesRemoved: [...b.m].filter(m => !a.m.has(m)),
    permissionsAdded: [...a.p].filter(p => !b.p.has(p)),
    permissionsRemoved: [...b.p].filter(p => !a.p.has(p)),
  }
  if (before.name !== after.name) diff.nameChanged = { from: before.name, to: after.name }
  if (before.baseRole !== after.baseRole) diff.baseRoleChanged = { from: before.baseRole, to: after.baseRole }
  diff.changed = Boolean(
    diff.nameChanged || diff.baseRoleChanged || diff.modulesAdded.length || diff.modulesRemoved.length
    || diff.permissionsAdded.length || diff.permissionsRemoved.length,
  )
  return diff
}

const labelOf = (key: string) => PERMISSION_BY_KEY[key]?.label ?? key

export function describeRoleDiff(diff: RoleDiff): string {
  const parts: string[] = []
  if (diff.nameChanged) parts.push(`renamed “${diff.nameChanged.from}” → “${diff.nameChanged.to}”`)
  if (diff.baseRoleChanged) parts.push(`based on ${diff.baseRoleChanged.to.replace(/_/g, ' ')} (was ${diff.baseRoleChanged.from.replace(/_/g, ' ')})`)
  if (diff.modulesAdded.length) parts.push(`can now open ${diff.modulesAdded.join(', ')}`)
  if (diff.modulesRemoved.length) parts.push(`can no longer open ${diff.modulesRemoved.join(', ')}`)
  if (diff.permissionsAdded.length) parts.push(`gained ${diff.permissionsAdded.map(labelOf).join(', ')}`)
  if (diff.permissionsRemoved.length) parts.push(`lost ${diff.permissionsRemoved.map(labelOf).join(', ')}`)
  return parts.join('; ') || 'no change'
}
