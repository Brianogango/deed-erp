import 'server-only'

import { sql } from './db'
import { buildSeedUsers } from './seed'
import type { AuthUserRecord, CreateUserInput, PublicUser, UpdateUserInput } from './types'
import { invalidateUserSessions } from './session-validity'

// Row type matches the live PostgreSQL schema which has BOTH Prisma-managed
// columns (is_active, must_reset_pw) AND legacy app columns (active, must_change_password).
type UserRow = {
  id: string
  username: string
  name: string | null
  role: string
  modules_json: any
  // Prisma-managed columns
  is_active: boolean
  must_reset_pw: boolean
  // Legacy columns kept for backward compatibility
  active?: number | null
  must_change_password?: number | null
  created_at: string
  password_hash: string
  password_history_json?: string
  failed_login_attempts?: number
  locked_until?: string
  employee_id?: string | null
  email?: string | null
  acts_as_technician?: boolean | number | null
}

const normalizeStoredRole = (role: string): AuthUserRecord['role'] => {
  const aliases: Record<string, AuthUserRecord['role']> = {
    super_admin: 'director',
    admin: 'director',
    director: 'director',
    admin_officer: 'admin_officer',
    finance: 'finance_officer',
    finance_officer: 'finance_officer',
    inventory: 'inventory_officer',
    inventory_officer: 'inventory_officer',
    kilimall: 'kilimall_officer',
    kilimall_officer: 'kilimall_officer',
    sales: 'sales_rep',
    sales_rep: 'sales_rep',
    lead_tech: 'technical_lead',
    technical_lead: 'technical_lead',
    repair_tech: 'technician',
    technician: 'technician',
  }
  return aliases[role] ?? (role as AuthUserRecord['role'])
}

const parseModulesJson = (value: any): AuthUserRecord['modules'] => {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.filter((m): m is AuthUserRecord['modules'][number] => typeof m === 'string')
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((m): m is AuthUserRecord['modules'][number] => typeof m === 'string')
        : []
    } catch {
      return []
    }
  }
  return []
}

const toAuthUser = (row: UserRow): AuthUserRecord & { passwordHistory: string[] } => ({
  id: row.id,
  username: row.username,
  name: row.name || '',
  role: normalizeStoredRole(row.role),
  modules: parseModulesJson(row.modules_json),
  // Prefer Prisma is_active; fall back to legacy active column
  active: row.is_active ?? (row.active != null ? Boolean(row.active) : true),
  createdAt: row.created_at,
  passwordHash: row.password_hash,
  passwordHistory: row.password_history_json ? JSON.parse(row.password_history_json) : [],
  failedLoginAttempts: row.failed_login_attempts ?? 0,
  lockedUntil: row.locked_until ?? null,
  // Prefer Prisma must_reset_pw; fall back to legacy must_change_password
  mustChangePassword: (row.must_reset_pw ?? false) || Boolean(row.must_change_password),
  employeeId: row.employee_id ?? null,
  email: row.email ?? null,
  actsAsTechnician: Boolean(row.acts_as_technician),
})

const toPublicUser = (user: AuthUserRecord): PublicUser => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role,
  modules: Array.isArray(user.modules) ? [...user.modules] : [],
  active: user.active,
  createdAt: user.createdAt,
  lockedUntil: user.lockedUntil,
  mustChangePassword: false,
  employeeId: user.employeeId ?? null,
  email: user.email ?? null,
  actsAsTechnician: Boolean(user.actsAsTechnician),
})

const uid = () => require("crypto").randomUUID()
const now = () => new Date().toISOString().slice(0, 10)

let schemaReady = false
let schemaPromise: Promise<void> | null = null

const ensureSchema = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      modules_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          password_history_json TEXT DEFAULT '[]',
          failed_login_attempts INTEGER DEFAULT 0,
          locked_until TEXT,
          must_change_password INTEGER DEFAULT 0,
          employee_id TEXT,
          email TEXT
    )
  `
}

const ensureSchemaReady = async () => {
  if (schemaReady) return

  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureSchema()
      schemaReady = true
    })()
  }

  await schemaPromise
}

const getUserCount = async () => {
  const { rows } = await sql`SELECT COUNT(*) as count FROM users`
  return Number(rows[0].count)
}

const seedUsersIfEmpty = async () => {
  await ensureSchemaReady()
  if ((await getUserCount()) > 0) return

  const seededUsers = await buildSeedUsers()

  for (const user of seededUsers) {
    const historyJson = JSON.stringify([user.passwordHash])
    await sql`
      INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash, password_history_json, must_change_password)
      VALUES (${user.id}, ${user.username}, ${user.name}, ${user.role}, ${JSON.stringify(user.modules)}, ${user.active ? 1 : 0}, ${user.createdAt}, ${user.passwordHash}, ${historyJson}, 1)
      ON CONFLICT (id) DO NOTHING
    `
  }
}

const migrateRoles = async () => {
  // Normalise legacy role names to the current operational role catalog.
  await sql`UPDATE users SET role = 'director'        WHERE role IN ('admin', 'super_admin')`
  await sql`UPDATE users SET role = 'finance_officer' WHERE role = 'finance'`
  await sql`UPDATE users SET role = 'technical_lead'  WHERE role = 'lead_tech'`
  await sql`UPDATE users SET role = 'technician'      WHERE role = 'repair_tech'`
  await sql`UPDATE users SET role = 'sales_rep'       WHERE role = 'sales'`
  await sql`UPDATE users SET role = 'inventory_officer' WHERE role = 'inventory'`
  await sql`UPDATE users SET role = 'kilimall_officer'  WHERE role = 'kilimall'`
}

const migratePasswordHistory = async () => {
  try {
    await sql`ALTER TABLE users ADD COLUMN password_history_json TEXT DEFAULT '[]'`
  } catch {
    // Column probably exists
  }
}

const migrateLockoutFields = async () => {
  try {
    await sql`ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0`
    await sql`ALTER TABLE users ADD COLUMN locked_until TEXT`
  } catch {
    // Columns probably exist
  }
}

const migrateMustChangePassword = async () => {
  try {
    await sql`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`
  } catch {
    // Column probably exists
  }
}

const migrateEmployeeLinkFields = async () => {
  try {
    await sql`ALTER TABLE users ADD COLUMN employee_id TEXT`
  } catch {
    // Column probably exists
  }

  try {
    await sql`ALTER TABLE users ADD COLUMN email TEXT`
  } catch {
    // Column probably exists
  }
}

const migrateActsAsTechnician = async () => {
  try {
    await sql`ALTER TABLE users ADD COLUMN acts_as_technician BOOLEAN NOT NULL DEFAULT false`
  } catch {
    // Column probably exists
  }
}

export const ensureUserStore = async () => {
  await ensureSchemaReady()
  await migratePasswordHistory()
  await migrateLockoutFields()
  await migrateMustChangePassword()
  await migrateEmployeeLinkFields()
  await migrateActsAsTechnician()
  await seedUsersIfEmpty()
  await migrateRoles()
}

export const listAuthUsers = async () => {
  await ensureUserStore()
  
  const { rows } = await sql`
    SELECT id, username, name, role, modules_json,
           is_active, must_reset_pw,
           active, must_change_password,
           created_at, password_hash, password_history_json,
           failed_login_attempts, locked_until,
           employee_id, email, acts_as_technician
    FROM users
    ORDER BY created_at DESC, username ASC
  `

  return rows.map(r => toAuthUser(r as UserRow))
}

export const listPublicUsers = async () => {
  const users = await listAuthUsers()
  return users.map(toPublicUser)
}

export const findAuthUserById = async (id: string) => {
  await ensureUserStore()
  
  const { rows } = await sql`
    SELECT id, username, name, role, modules_json,
           is_active, must_reset_pw,
           active, must_change_password,
           created_at, password_hash, password_history_json,
           failed_login_attempts, locked_until,
           employee_id, email, acts_as_technician
    FROM users
    WHERE id = ${id}
  `

  return rows.length ? toAuthUser(rows[0] as unknown as UserRow) : null
}

export const findAuthUserByUsername = async (username: string) => {
  await ensureUserStore()
  
  const { rows } = await sql`
    SELECT id, username, name, role, modules_json,
           is_active, must_reset_pw,
           active, must_change_password,
           created_at, password_hash, password_history_json,
           failed_login_attempts, locked_until,
           employee_id, email, acts_as_technician
    FROM users
    WHERE lower(username) = lower(${username})
  `

  return rows.length ? toAuthUser(rows[0] as unknown as UserRow) : null
}

export const createAuthUser = async (input: CreateUserInput, passwordHash: string) => {
  await ensureUserStore()
  const username = input.username?.trim()
  const name = input.name?.trim()
  if (!username || !name) throw Object.assign(new Error('Generated username and name are required before saving the user'), { status: 400 })
  const user: AuthUserRecord = {
    id: uid(),
    username,
    name,
    role: input.role,
    modules: [...input.modules],
    active: input.active ?? true,
    createdAt: now(),
    passwordHash,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: input.mustChangePassword ?? true,
    employeeId: input.employeeId ?? null,
        // email is NOT NULL in the Prisma schema — derive a fallback if not provided
    email: input.email?.trim() || `${username}@deed.africa`,
    actsAsTechnician: Boolean(input.actsAsTechnician),
  }
  const historyJson = JSON.stringify([passwordHash])
  const nowTs = new Date().toISOString()
  // Write to BOTH Prisma-managed columns AND legacy columns for full compatibility
  await sql`
    INSERT INTO users (
      id, username, name, role, modules_json,
      is_active, must_reset_pw,
      active, must_change_password,
      created_at, updated_at,
      password_hash, password_history_json,
      employee_id, email, acts_as_technician
    )
    VALUES (
      ${user.id}, ${user.username}, ${user.name}, ${user.role},
      ${JSON.stringify(user.modules)},
      ${user.active}, ${user.mustChangePassword},
      ${user.active ? 1 : 0}, ${user.mustChangePassword ? 1 : 0},
      ${user.createdAt}, ${nowTs},
      ${user.passwordHash}, ${historyJson},
      ${user.employeeId}, ${user.email}, ${user.actsAsTechnician ?? false}
    )
  `
  return user
}

export const updateAuthUser = async (id: string, input: UpdateUserInput, passwordHash?: string) => {
  await ensureUserStore()

  const existingUser = await findAuthUserById(id)
  if (!existingUser) return null

  let historyJson = existingUser.passwordHistory ? JSON.stringify(existingUser.passwordHistory) : '[]'
  if (passwordHash && passwordHash !== existingUser.passwordHash) {
    const history = existingUser.passwordHistory || []
    historyJson = JSON.stringify([passwordHash, ...history].slice(0, 5)) // Keep the last 5 hashes
  }

  const nextUser: AuthUserRecord = {
    ...existingUser,
    username: input.username ?? existingUser.username,
    name: input.name ?? existingUser.name,
    role: input.role ?? existingUser.role,
    modules: input.modules ? [...input.modules] : existingUser.modules,
    active: input.active ?? existingUser.active,
    passwordHash: passwordHash ?? existingUser.passwordHash,
    mustChangePassword: input.mustChangePassword ?? existingUser.mustChangePassword,
    employeeId: input.employeeId !== undefined ? input.employeeId : existingUser.employeeId,
    email: input.email !== undefined ? input.email : existingUser.email,
    actsAsTechnician: input.actsAsTechnician !== undefined
      ? Boolean(input.actsAsTechnician)
      : Boolean(existingUser.actsAsTechnician),
  }

  const nowTs = new Date().toISOString()
  // Update BOTH Prisma-managed and legacy columns
  await sql`
    UPDATE users
    SET username             = ${nextUser.username},
        name                 = ${nextUser.name},
        role                 = ${nextUser.role},
        modules_json         = ${JSON.stringify(nextUser.modules)},
        is_active            = ${nextUser.active},
        must_reset_pw        = ${nextUser.mustChangePassword},
        active               = ${nextUser.active ? 1 : 0},
        must_change_password = ${nextUser.mustChangePassword ? 1 : 0},
        password_hash        = ${nextUser.passwordHash},
        password_history_json = ${historyJson},
        employee_id          = ${nextUser.employeeId ?? null},
        email                = ${nextUser.email ?? null},
        acts_as_technician   = ${nextUser.actsAsTechnician ?? false},
        updated_at           = ${nowTs}
    WHERE id = ${id}
  `

  // Role / active / technician-capability changes must refresh session claims.
  if (
    nextUser.role !== existingUser.role ||
    nextUser.active !== existingUser.active ||
    Boolean(nextUser.actsAsTechnician) !== Boolean(existingUser.actsAsTechnician)
  ) {
    await invalidateUserSessions(id, {
      isActive: nextUser.active,
      role: nextUser.role,
      actsAsTechnician: Boolean(nextUser.actsAsTechnician),
    })
  }

  return nextUser
}

// ─── Hard delete ─────────────────────────────────────────────────────────────
export const deleteAuthUser = async (id: string) => {
  await ensureUserStore()
  const existingUser = await findAuthUserById(id)
  if (!existingUser) return null
  await sql`DELETE FROM users WHERE id = ${id}`
  await invalidateUserSessions(id, { isActive: false, role: existingUser.role })
  return existingUser
}

// ─── Soft delete / deactivation ──────────────────────────────────────────────
// Sets is_active = false and active = 0 without removing the record.
// This preserves audit trails and foreign-key references.
export const deactivateAuthUser = async (id: string) => {
  await ensureUserStore()
  const existingUser = await findAuthUserById(id)
  if (!existingUser) return null
  const nowTs = new Date().toISOString()
  await sql`
    UPDATE users
    SET is_active  = false,
        active     = 0,
        updated_at = ${nowTs}
    WHERE id = ${id}
  `
  await invalidateUserSessions(id, { isActive: false, role: existingUser.role })
  return { ...existingUser, active: false }
}

// ─── Re-activate a previously deactivated user ───────────────────────────────
export const reactivateAuthUser = async (id: string) => {
  await ensureUserStore()
  const existingUser = await findAuthUserById(id)
  if (!existingUser) return null
  const nowTs = new Date().toISOString()
  await sql`
    UPDATE users
    SET is_active  = true,
        active     = 1,
        updated_at = ${nowTs}
    WHERE id = ${id}
  `
  await invalidateUserSessions(id, { isActive: true, role: existingUser.role })
  return { ...existingUser, active: true }
}

export const recordFailedLogin = async (id: string, maxAttempts = 5, lockMinutes = 15) => {
  await ensureUserStore()
  const user = await findAuthUserById(id)
  if (!user) return null

  const attempts = user.failedLoginAttempts + 1
  let lockedUntil: string | null = null
  
  if (attempts >= maxAttempts) {
    lockedUntil = new Date(Date.now() + lockMinutes * 60000).toISOString()
  }

  await sql`
    UPDATE users 
    SET failed_login_attempts = ${attempts}, 
        locked_until = ${lockedUntil} 
    WHERE id = ${id}
  `
  return { attempts, lockedUntil }
}

export const clearFailedLogin = async (id: string) => {
  await ensureUserStore()
  await sql`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ${id}`
}

export const toPublicAuthUser = toPublicUser
