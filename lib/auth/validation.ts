import { MODULE_IDS, USER_ROLES, ROLE_DEFAULT_MODULES } from './types'
import type { CreateUserInput, ModuleId, UpdateUserInput, UserRole } from './types'
import { MIN_PASSWORD_LENGTH } from './password-policy'

const isModuleId = (value: string): value is ModuleId => MODULE_IDS.includes(value as ModuleId)
const isUserRole = (value: string): value is UserRole => USER_ROLES.includes(value as UserRole)

const uniqueModules = (modules: string[]) => Array.from(new Set(modules.filter(isModuleId)))

export const normalizeCreateUserInput = (body: unknown): CreateUserInput => {
  const payload = body as Record<string, unknown>

  const employeeId = typeof payload.employeeId === 'string' ? payload.employeeId.trim() : ''
  const username = typeof payload.username === 'string' ? payload.username.trim() : ''
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const role = typeof payload.role === 'string' && isUserRole(payload.role) ? payload.role : null
  const active = typeof payload.active === 'boolean' ? payload.active : true
  const password = typeof payload.password === 'string' ? payload.password : ''
  const email = typeof payload.email === 'string' ? payload.email.trim() : null
  const modules = Array.isArray(payload.modules)
    ? uniqueModules(payload.modules.filter((value): value is string => typeof value === 'string'))
    : []

  if (!role) throw Object.assign(new Error('A valid role is required'), { status: 400 })

  const normalizedModules = modules.length > 0 ? modules : ROLE_DEFAULT_MODULES[role]
  return { employeeId, username, name, role, modules: normalizedModules, active, password, email }
}

export const normalizeUpdateUserInput = (body: unknown): UpdateUserInput => {
  const payload = body as Record<string, unknown>
  const update: UpdateUserInput = {}

  if ('username' in payload) {
    if (typeof payload.username !== 'string' || !payload.username.trim()) {
      throw Object.assign(new Error('Username must be a non-empty string'), { status: 400 })
    }
    update.username = payload.username.trim()
  }

  if ('name' in payload) {
    if (typeof payload.name !== 'string' || !payload.name.trim()) {
      throw Object.assign(new Error('Name must be a non-empty string'), { status: 400 })
    }
    update.name = payload.name.trim()
  }

  if ('role' in payload) {
    if (typeof payload.role !== 'string' || !isUserRole(payload.role)) {
      throw Object.assign(new Error('Role is invalid'), { status: 400 })
    }
    update.role = payload.role
  }

  if ('active' in payload) {
    if (typeof payload.active !== 'boolean') {
      throw Object.assign(new Error('Active must be a boolean'), { status: 400 })
    }
    update.active = payload.active
  }

  if ('modules' in payload) {
    if (!Array.isArray(payload.modules)) {
      throw Object.assign(new Error('Modules must be an array'), { status: 400 })
    }
    const modules = uniqueModules(payload.modules.filter((value): value is string => typeof value === 'string'))
    if (modules.length === 0) {
      throw Object.assign(new Error('At least one module is required'), { status: 400 })
    }
    update.modules = modules
  }

  if ('password' in payload) {
    if (typeof payload.password !== 'string' || payload.password.length < MIN_PASSWORD_LENGTH) {
      throw Object.assign(
        new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
        { status: 400 },
      )
    }
    update.password = payload.password
  }

  if ('unlock' in payload) {
    update.unlock = Boolean(payload.unlock)
  }

  if ('mustChangePassword' in payload) {
    update.mustChangePassword = Boolean(payload.mustChangePassword)
  }

  if ('employeeId' in payload) {
    update.employeeId = typeof payload.employeeId === 'string' && payload.employeeId.trim() ? payload.employeeId.trim() : null
  }

  if ('email' in payload) {
    update.email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : null
  }

  if (Object.keys(update).length === 0) {
    throw Object.assign(new Error('No valid user fields were provided'), { status: 400 })
  }

  return update
}
