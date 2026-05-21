import 'server-only'

import 'server-only'

import { sql } from './db'
import { buildSeedUsers } from './seed'
import type { AuthUserRecord, CreateUserInput, PublicUser, UpdateUserInput } from './types'

type UserRow = {
  id: string
  username: string
  name: string
  role: string  // raw DB value — migrateRoles() normalises to current UserRole names
  modules_json: string | null
  active: number
  created_at: string
  password_hash: string
  password_history_json?: string
  failed_login_attempts?: number
  locked_until?: string
  must_change_password?: number
  employee_id?: string | null
  email?: string | null
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

const parseModulesJson = (value: string | null | undefined): AuthUserRecord['modules'] => {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((module): module is AuthUserRecord['modules'][number] => typeof module === 'string') : []
  } catch {
    return []
  }
}

const toAuthUser = (row: UserRow): AuthUserRecord & { passwordHistory: string[] } => ({
  id: row.id,
  username: row.username,
  name: row.name,
  role: normalizeStoredRole(row.role),
  modules: parseModulesJson(row.modules_json),
  active: Boolean(row.active),
  createdAt: row.created_at,
  passwordHash: row.password_hash,
  passwordHistory: row.password_history_json ? JSON.parse(row.password_history_json) : [],
  failedLoginAttempts: row.failed_login_attempts ?? 0,
  lockedUntil: row.locked_until ?? null,
  mustChangePassword: Boolean(row.must_change_password),
  employeeId: row.employee_id ?? null,
  email: row.email ?? null,
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
      INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash, password_history_json)
      VALUES (${user.id}, ${user.username}, ${user.name}, ${user.role}, ${JSON.stringify(user.modules)}, ${user.active ? 1 : 0}, ${user.createdAt}, ${user.passwordHash}, ${historyJson})
      ON CONFLICT (id) DO NOTHING
    `
  }
}

const ensureAdminExists = async () => {
  const allModules = JSON.stringify([
    'dashboard','sales','crm','inventory','contacts','purchase','pos','repair',
    'refurbishment','delivery','ecommerce','kilimall','accounting','hr','outsource',
    'sops','after_sales','expenses','leave','my_documents',
  ])
  // Only update the existing brian admin record — never INSERT.
  // This avoids conflicts with the Prisma-managed schema constraints.
  // The password_hash is intentionally NOT updated so UI password changes persist.
  await sql`
    UPDATE users
    SET name = 'Brian Ogango',
        role = 'director',
        modules_json = ${allModules},
        active = 1
    WHERE username = 'brian'
  `
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

export const ensureUserStore = async () => {
  await ensureSchemaReady()
  await migratePasswordHistory()
  await migrateLockoutFields()
  await migrateMustChangePassword()
  await migrateEmployeeLinkFields()
  await seedUsersIfEmpty()
  await ensureAdminExists()
  await migrateRoles()
}

export const listAuthUsers = async () => {
  await ensureUserStore()
  
  const { rows } = await sql`
    SELECT id, username, name, role, modules_json, active, created_at, password_hash, password_history_json, failed_login_attempts, locked_until, must_change_password, employee_id, email
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
    SELECT id, username, name, role, modules_json, active, created_at, password_hash, password_history_json, failed_login_attempts, locked_until, must_change_password, employee_id, email
    FROM users
    WHERE id = ${id}
  `

  return rows.length ? toAuthUser(rows[0] as unknown as UserRow) : null
}

export const findAuthUserByUsername = async (username: string) => {
  await ensureUserStore()
  
  const { rows } = await sql`
    SELECT id, username, name, role, modules_json, active, created_at, password_hash, password_history_json, failed_login_attempts, locked_until, must_change_password, employee_id, email
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
    email: input.email ?? null,
  }

  const historyJson = JSON.stringify([passwordHash])
  await sql`
    INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash, password_history_json, must_change_password, employee_id, email)
    VALUES (${user.id}, ${user.username}, ${user.name}, ${user.role}, ${JSON.stringify(user.modules)}, ${user.active ? 1 : 0}, ${user.createdAt}, ${user.passwordHash}, ${historyJson}, ${user.mustChangePassword ? 1 : 0}, ${user.employeeId}, ${user.email})
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
  }

  await sql`
    UPDATE users
    SET username = ${nextUser.username}, 
        name = ${nextUser.name}, 
        role = ${nextUser.role}, 
        modules_json = ${JSON.stringify(nextUser.modules)}, 
        active = ${nextUser.active ? 1 : 0}, 
        password_hash = ${nextUser.passwordHash},
        password_history_json = ${historyJson},
        must_change_password = ${nextUser.mustChangePassword ? 1 : 0},
        employee_id = ${nextUser.employeeId ?? null},
        email = ${nextUser.email ?? null}
    WHERE id = ${id}
  `

  return nextUser
}

export const deleteAuthUser = async (id: string) => {
  await ensureUserStore()

  const existingUser = await findAuthUserById(id)
  if (!existingUser) return null
  
  await sql`DELETE FROM users WHERE id = ${id}`
  return existingUser
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
