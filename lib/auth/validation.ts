import { MODULE_IDS, USER_ROLES, ROLE_DEFAULT_MODULES } from './types'
import type { CreateUserInput, ModuleId, UserRole } from './types'

const isModuleId = (value: string): value is ModuleId => MODULE_IDS.includes(value as ModuleId)
const isUserRole = (value: string): value is UserRole => USER_ROLES.includes(value as UserRole)

const uniqueModules = (modules: string[]) => Array.from(new Set(modules.filter(isModuleId)))

export const normalizeCreateUserInput = (body: unknown): CreateUserInput => {
  const payload = body as Record<string, unknown>

  const employeeId = typeof payload.employeeId === 'string' ? payload.employeeId.trim() : ''
  const username = typeof payload.username === 'string' ? payload.username.trim() : ''
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const accessRoleId = typeof payload.accessRoleId === 'string' && payload.accessRoleId.trim() ? payload.accessRoleId.trim() : null
  // On a custom role the role's own base role is used, so none needs to be sent.
  const role = typeof payload.role === 'string' && isUserRole(payload.role) ? payload.role : accessRoleId ? ('technician' as UserRole) : null
  const active = typeof payload.active === 'boolean' ? payload.active : true
  const password = typeof payload.password === 'string' ? payload.password : ''
  const email = typeof payload.email === 'string' ? payload.email.trim() : null
  const actsAsTechnician = typeof payload.actsAsTechnician === 'boolean' ? payload.actsAsTechnician : false
  const modules = Array.isArray(payload.modules)
    ? uniqueModules(payload.modules.filter((value): value is string => typeof value === 'string'))
    : []

  if (!role) throw Object.assign(new Error('A valid role is required'), { status: 400 })

  const normalizedModules = modules.length > 0 ? modules : ROLE_DEFAULT_MODULES[role]
  return { employeeId, username, name, role, modules: normalizedModules, active, password, email, actsAsTechnician, ...(accessRoleId ? { accessRoleId } : {}) }
}

