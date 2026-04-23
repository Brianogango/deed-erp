import 'server-only'

import { MODULE_IDS, USER_ROLES } from './types'
import type { CreateUserInput, ModuleId, UpdateUserInput, UserRole } from './types'

const isModuleId = (value: string): value is ModuleId => MODULE_IDS.includes(value as ModuleId)
const isUserRole = (value: string): value is UserRole => USER_ROLES.includes(value as UserRole)

const uniqueModules = (modules: string[]) => Array.from(new Set(modules.filter(isModuleId)))

export const normalizeCreateUserInput = (body: unknown): CreateUserInput => {
  const payload = body as Record<string, unknown>

  const username = typeof payload.username === 'string' ? payload.username.trim() : ''
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const role = typeof payload.role === 'string' && isUserRole(payload.role) ? payload.role : null
  const active = typeof payload.active === 'boolean' ? payload.active : true
  const password = typeof payload.password === 'string' ? payload.password : ''
  const modules = Array.isArray(payload.modules)
    ? uniqueModules(payload.modules.filter((value): value is string => typeof value === 'string'))
    : []

  if (!username) throw Object.assign(new Error('Username is required'), { status: 400 })
  if (!name) throw Object.assign(new Error('Name is required'), { status: 400 })
  if (!role) throw Object.assign(new Error('A valid role is required'), { status: 400 })
  if (password.length < 6) throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 })
  if (modules.length === 0) throw Object.assign(new Error('At least one module is required'), { status: 400 })

  return { username, name, role, modules, active, password }
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
    if (typeof payload.password !== 'string' || payload.password.length < 6) {
      throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 })
    }
    update.password = payload.password
  }

  if (Object.keys(update).length === 0) {
    throw Object.assign(new Error('No valid user fields were provided'), { status: 400 })
  }

  return update
}
