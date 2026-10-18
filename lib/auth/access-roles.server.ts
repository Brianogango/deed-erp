import 'server-only'
import { randomUUID } from 'node:crypto'
import { sql } from './db'
import type { AccessRole } from './access-roles'
import type { ModuleId, UserRole } from './types'

/**
 * Storage for custom roles. The table and the users.access_role_id column are
 * created the first time they are needed, the same way the rest of the user
 * store grows, so there is nothing to run by hand.
 */
let ready: Promise<void> | null = null

export const ensureAccessRoleStore = async () => {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS access_roles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          base_role TEXT NOT NULL,
          modules_json TEXT NOT NULL DEFAULT '[]',
          permissions_json TEXT NOT NULL DEFAULT '[]',
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS access_roles_name_lower_idx ON access_roles (lower(name))`
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS access_role_id TEXT`
    })().catch(error => {
      ready = null
      throw error
    })
  }
  await ready
}

type RoleRow = {
  id: string
  name: string
  description: string | null
  base_role: string
  modules_json: string | null
  permissions_json: string | null
}

const parseList = (value: string | null | undefined): string[] => {
  try {
    const parsed = JSON.parse(value ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const toRole = (row: RoleRow): AccessRole => ({
  id: row.id,
  name: row.name,
  description: row.description ?? '',
  baseRole: row.base_role as UserRole,
  modules: parseList(row.modules_json) as ModuleId[],
  permissions: parseList(row.permissions_json),
  builtIn: false,
})

// Roles are read on almost every request, so they are kept for a few seconds.
// Saving a role clears this instance's copy at once; another server process
// picks the change up within the TTL.
const CACHE_TTL_MS = 5_000
let cache: { at: number; roles: Map<string, AccessRole> } | null = null
export const clearAccessRoleCache = () => { cache = null }

export async function getAccessRoleMap(): Promise<Map<string, AccessRole>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.roles
  await ensureAccessRoleStore()
  const { rows } = await sql`SELECT id, name, description, base_role, modules_json, permissions_json FROM access_roles ORDER BY lower(name)`
  const roles = new Map((rows as unknown as RoleRow[]).map(row => [row.id, toRole(row)]))
  cache = { at: Date.now(), roles }
  return roles
}

export async function listCustomRoles(): Promise<AccessRole[]> {
  return [...(await getAccessRoleMap()).values()]
}

export async function getCustomRole(id: string): Promise<AccessRole | null> {
  return (await getAccessRoleMap()).get(id) ?? null
}

export async function countUsersOnRoles(): Promise<Record<string, number>> {
  await ensureAccessRoleStore()
  const { rows } = await sql`SELECT access_role_id AS id, count(*)::int AS n FROM users WHERE access_role_id IS NOT NULL GROUP BY access_role_id`
  return Object.fromEntries((rows as Array<{ id: string; n: number }>).map(r => [r.id, Number(r.n)]))
}

type RoleFields = Pick<AccessRole, 'name' | 'description' | 'baseRole' | 'modules' | 'permissions'>

export async function nameIsTaken(name: string, exceptId?: string): Promise<boolean> {
  await ensureAccessRoleStore()
  const { rows } = await sql`SELECT id FROM access_roles WHERE lower(name) = lower(${name})`
  return (rows as Array<{ id: string }>).some(r => r.id !== exceptId)
}

export async function createCustomRole(fields: RoleFields, createdBy: string): Promise<AccessRole> {
  await ensureAccessRoleStore()
  const id = randomUUID()
  const nowTs = new Date().toISOString()
  await sql`
    INSERT INTO access_roles (id, name, description, base_role, modules_json, permissions_json, created_by, created_at, updated_at)
    VALUES (${id}, ${fields.name}, ${fields.description}, ${fields.baseRole}, ${JSON.stringify(fields.modules)}, ${JSON.stringify(fields.permissions)}, ${createdBy}, ${nowTs}, ${nowTs})
  `
  clearAccessRoleCache()
  return { id, ...fields, builtIn: false }
}

/**
 * Saves a role and keeps the stored role and modules of everyone on it in step,
 * so anything that reads the users table directly (notifications by role, for
 * instance) sees the role's base role rather than a stale one.
 */
export async function updateCustomRole(id: string, fields: RoleFields): Promise<AccessRole | null> {
  await ensureAccessRoleStore()
  const nowTs = new Date().toISOString()
  const { rows } = await sql`
    UPDATE access_roles
    SET name = ${fields.name}, description = ${fields.description}, base_role = ${fields.baseRole},
        modules_json = ${JSON.stringify(fields.modules)}, permissions_json = ${JSON.stringify(fields.permissions)},
        updated_at = ${nowTs}
    WHERE id = ${id}
    RETURNING id
  `
  if (!rows.length) return null
  await sql`UPDATE users SET role = ${fields.baseRole}, modules_json = ${JSON.stringify(fields.modules)}, updated_at = ${nowTs} WHERE access_role_id = ${id}`
  clearAccessRoleCache()
  return { id, ...fields, builtIn: false }
}

/** Deletes a role nobody holds. Returns how many people still hold it, if any. */
export async function deleteCustomRole(id: string): Promise<{ deleted: boolean; inUse: number }> {
  await ensureAccessRoleStore()
  const inUse = (await countUsersOnRoles())[id] ?? 0
  if (inUse > 0) return { deleted: false, inUse }
  await sql`DELETE FROM access_roles WHERE id = ${id}`
  clearAccessRoleCache()
  return { deleted: true, inUse: 0 }
}
