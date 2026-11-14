import { canonicalRole } from './roles'
import { userCan } from './can'
import { SAVE_AREAS } from './save-areas'
import { isKnownClientAppStateKey } from '@/lib/app-state-hydration'

type StoreUser = {
  role?: unknown
  modules?: unknown
  /** users.acts_as_technician — writes what a technician may write. */
  actsAsTechnician?: unknown
  /** A custom role's permissions. */
  permissions?: unknown
}

type StoreWritePolicy = {
  /** The "Save …" permission (lib/auth/save-areas.ts). */
  permission: string
  modules?: readonly string[]
}

/** Who may save each store key from the screens: one entry per key, from SAVE_AREAS. */
export const STORE_WRITE_POLICIES: Readonly<Record<string, StoreWritePolicy>> = Object.freeze(Object.fromEntries(
  SAVE_AREAS.flatMap(area => area.storeKeys.map(entry => {
    const [key, modules] = typeof entry === 'string' ? [entry, area.modules] : entry
    return [key, { permission: area.key, modules }]
  })),
))

const list = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null

export function canWriteStoreKey(user: StoreUser, key: string): boolean {
  if (!isKnownClientAppStateKey(key)) return false
  const entry = STORE_WRITE_POLICIES[key]
  if (!entry) return false
  const role = canonicalRole(user.role)
  if (!role) return false
  const subject = {
    role,
    modules: list(user.modules),
    permissions: list(user.permissions),
    actsAsTechnician: user.actsAsTechnician === true,
  }
  if (!userCan(subject, entry.permission)) return false
  if (!entry.modules?.length || role === 'director') return true
  const modules = new Set(subject.modules ?? [])
  return entry.modules.some(module => modules.has(module))
}
