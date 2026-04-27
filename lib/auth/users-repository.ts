import 'server-only'

import { sql } from './db'
import { buildSeedUsers } from './seed'
import type { AuthUserRecord, CreateUserInput, PublicUser, UpdateUserInput } from './types'

type UserRow = {
  id: string
  username: string
  name: string
  role: string  // raw DB value — migrateRoles() normalises to current UserRole names
  modules_json: string
  active: number
  created_at: string
  password_hash: string
  password_history_json?: string
  failed_login_attempts?: number
  locked_until?: string
}

const toAuthUser = (row: UserRow): AuthUserRecord & { passwordHistory: string[] } => ({
  id: row.id,
  username: row.username,
  name: row.name,
  role: row.role as AuthUserRecord['role'],
  modules: JSON.parse(row.modules_json) as AuthUserRecord['modules'],
  active: Boolean(row.active),
  createdAt: row.created_at,
  passwordHash: row.password_hash,
  passwordHistory: row.password_history_json ? JSON.parse(row.password_history_json) : [],
  failedLoginAttempts: row.failed_login_attempts ?? 0,
  lockedUntil: row.locked_until ?? null,
})

const toPublicUser = (user: AuthUserRecord): PublicUser => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role,
  modules: [...user.modules],
  active: user.active,
  createdAt: user.createdAt,
  lockedUntil: user.lockedUntil,
})

const uid = () => Math.random().toString(36).slice(2, 9)
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
          locked_until TEXT
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
  const { hashPassword } = await import('./password')
  const allModules = JSON.stringify([
    'dashboard','sales','crm','inventory','contacts','purchase','pos','repair',
    'refurbishment','delivery','ecommerce','kilimall','accounting','hr','outsource',
    'sops','after_sales','expenses','leave','my_documents',
  ])
  const hash = await hashPassword('Og@835408')
  const historyJson = JSON.stringify([hash])
  await sql`
    INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash, password_history_json)
    VALUES ('u_brian', 'brian', 'Brian', 'director', ${allModules}, 1, '2026-04-25', ${hash}, ${historyJson})
    ON CONFLICT (username) DO UPDATE
      SET name = EXCLUDED.name,
          role = EXCLUDED.role,
          modules_json = EXCLUDED.modules_json,
          active = EXCLUDED.active,
          password_hash = EXCLUDED.password_hash,
          password_history_json = EXCLUDED.password_history_json
  `
}

const migrateRoles = async () => {
  // Migrate old role names to new 8-role structure
  await sql`UPDATE users SET role = 'director'          WHERE role = 'admin'`
  await sql`UPDATE users SET role = 'finance_officer'   WHERE role = 'finance'`
  await sql`UPDATE users SET role = 'technician'        WHERE role = 'repair_tech'`
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

export const ensureUserStore = async () => {
  await ensureSchemaReady()
  await migratePasswordHistory()
  await migrateLockoutFields()
  await seedUsersIfEmpty()
  await ensureAdminExists()
  await migrateRoles()
}

export const listAuthUsers = async () => {
  await ensureUserStore()
  
  const { rows } = await sql`
    SELECT id, username, name, role, modules_json, active, created_at, password_hash, password_history_json, failed_login_attempts, locked_until
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
    SELECT id, username, name, role, modules_json, active, created_at, password_hash, password_history_json, failed_login_attempts, locked_until
    FROM users
    WHERE id = ${id}
  `

  return rows.length ? toAuthUser(rows[0] as unknown as UserRow) : null
}

export const findAuthUserByUsername = async (username: string) => {
  await ensureUserStore()
  
  const { rows } = await sql`
    SELECT id, username, name, role, modules_json, active, created_at, password_hash, password_history_json, failed_login_attempts, locked_until
    FROM users
    WHERE lower(username) = lower(${username})
  `

  return rows.length ? toAuthUser(rows[0] as unknown as UserRow) : null
}

export const createAuthUser = async (input: CreateUserInput, passwordHash: string) => {
  await ensureUserStore()
  const user: AuthUserRecord = {
    id: `u_${uid()}`,
    username: input.username,
    name: input.name,
    role: input.role,
    modules: [...input.modules],
    active: input.active,
    createdAt: now(),
    passwordHash,
    failedLoginAttempts: 0,
    lockedUntil: null,
  }

  const historyJson = JSON.stringify([passwordHash])
  await sql`
    INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash, password_history_json)
    VALUES (${user.id}, ${user.username}, ${user.name}, ${user.role}, ${JSON.stringify(user.modules)}, ${user.active ? 1 : 0}, ${user.createdAt}, ${user.passwordHash}, ${historyJson})
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
  }

  await sql`
    UPDATE users
    SET username = ${nextUser.username}, 
        name = ${nextUser.name}, 
        role = ${nextUser.role}, 
        modules_json = ${JSON.stringify(nextUser.modules)}, 
        active = ${nextUser.active ? 1 : 0}, 
        password_hash = ${nextUser.passwordHash},
        password_history_json = ${historyJson}
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
