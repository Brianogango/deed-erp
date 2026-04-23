import 'server-only'

import { getDatabase } from './db'
import { buildSeedUsers } from './seed'
import type { AuthUserRecord, CreateUserInput, PublicUser, UpdateUserInput } from './types'

type UserRow = {
  id: string
  username: string
  name: string
  role: AuthUserRecord['role']
  modules_json: string
  active: number
  created_at: string
  password_hash: string
}

const toAuthUser = (row: UserRow): AuthUserRecord => ({
  id: row.id,
  username: row.username,
  name: row.name,
  role: row.role,
  modules: JSON.parse(row.modules_json) as AuthUserRecord['modules'],
  active: Boolean(row.active),
  createdAt: row.created_at,
  passwordHash: row.password_hash,
})

const toPublicUser = (user: AuthUserRecord): PublicUser => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role,
  modules: [...user.modules],
  active: user.active,
  createdAt: user.createdAt,
})

const uid = () => Math.random().toString(36).slice(2, 9)
const now = () => new Date().toISOString().slice(0, 10)

let schemaReady = false
let schemaPromise: Promise<void> | null = null

const ensureSchema = () => {
  const database = getDatabase()

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      modules_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
  `)
}

const ensureSchemaReady = async () => {
  if (schemaReady) return

  if (!schemaPromise) {
    schemaPromise = (async () => {
      ensureSchema()
      schemaReady = true
    })()
  }

  await schemaPromise
}

const getUserCount = () => {
  const database = getDatabase()
  const row = database.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  return row.count
}

const seedUsersIfEmpty = async () => {
  await ensureSchemaReady()

  const database = getDatabase()
  if (getUserCount() > 0) return

  const seededUsers = await buildSeedUsers()
  const insertStatement = database.prepare(`
    INSERT OR IGNORE INTO users (id, username, name, role, modules_json, active, created_at, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const user of seededUsers) {
    insertStatement.run(
      user.id,
      user.username,
      user.name,
      user.role,
      JSON.stringify(user.modules),
      user.active ? 1 : 0,
      user.createdAt,
      user.passwordHash,
    )
  }
}

export const ensureUserStore = async () => {
  await ensureSchemaReady()
  await seedUsersIfEmpty()
}

export const listAuthUsers = async () => {
  await ensureUserStore()

  const database = getDatabase()
  const rows = database.prepare(`
    SELECT id, username, name, role, modules_json, active, created_at, password_hash
    FROM users
    ORDER BY created_at DESC, username ASC
  `).all() as UserRow[]

  return rows.map(toAuthUser)
}

export const listPublicUsers = async () => {
  const users = await listAuthUsers()
  return users.map(toPublicUser)
}

export const findAuthUserById = async (id: string) => {
  await ensureUserStore()

  const database = getDatabase()
  const row = database.prepare(`
    SELECT id, username, name, role, modules_json, active, created_at, password_hash
    FROM users
    WHERE id = ?
  `).get(id) as UserRow | undefined

  return row ? toAuthUser(row) : null
}

export const findAuthUserByUsername = async (username: string) => {
  await ensureUserStore()

  const database = getDatabase()
  const row = database.prepare(`
    SELECT id, username, name, role, modules_json, active, created_at, password_hash
    FROM users
    WHERE lower(username) = lower(?)
  `).get(username) as UserRow | undefined

  return row ? toAuthUser(row) : null
}

export const createAuthUser = async (input: CreateUserInput, passwordHash: string) => {
  await ensureUserStore()

  const database = getDatabase()
  const user: AuthUserRecord = {
    id: `u_${uid()}`,
    username: input.username,
    name: input.name,
    role: input.role,
    modules: [...input.modules],
    active: input.active,
    createdAt: now(),
    passwordHash,
  }

  database.prepare(`
    INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.username,
    user.name,
    user.role,
    JSON.stringify(user.modules),
    user.active ? 1 : 0,
    user.createdAt,
    user.passwordHash,
  )

  return user
}

export const updateAuthUser = async (id: string, input: UpdateUserInput, passwordHash?: string) => {
  await ensureUserStore()

  const existingUser = await findAuthUserById(id)
  if (!existingUser) return null

  const nextUser: AuthUserRecord = {
    ...existingUser,
    username: input.username ?? existingUser.username,
    name: input.name ?? existingUser.name,
    role: input.role ?? existingUser.role,
    modules: input.modules ? [...input.modules] : existingUser.modules,
    active: input.active ?? existingUser.active,
    passwordHash: passwordHash ?? existingUser.passwordHash,
  }

  const database = getDatabase()
  database.prepare(`
    UPDATE users
    SET username = ?, name = ?, role = ?, modules_json = ?, active = ?, password_hash = ?
    WHERE id = ?
  `).run(
    nextUser.username,
    nextUser.name,
    nextUser.role,
    JSON.stringify(nextUser.modules),
    nextUser.active ? 1 : 0,
    nextUser.passwordHash,
    id,
  )

  return nextUser
}

export const deleteAuthUser = async (id: string) => {
  await ensureUserStore()

  const existingUser = await findAuthUserById(id)
  if (!existingUser) return null

  const database = getDatabase()
  database.prepare('DELETE FROM users WHERE id = ?').run(id)
  return existingUser
}

export const toPublicAuthUser = toPublicUser
