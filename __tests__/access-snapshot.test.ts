/**
 * Who can do what today, by role name — the baseline the access rework is
 * checked against. A change here is a change in someone's access: it must
 * be intended, and the snapshot updated in the same commit.
 */
import { describe, expect, it } from 'vitest'
import { PERMISSION_CATALOG } from '@/lib/auth/permission-catalog'
import { ROLE_MATRIX, type PermissionAction } from '@/lib/auth/role-matrix'
import { userCan } from '@/lib/auth/can'
import { canReadStoreKey, hasPermission } from '@/lib/auth/authorization'
import { STORE_WRITE_POLICIES, canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { MODULE_IDS } from '@/lib/auth/types'
import { canonicalRole, canonicalUserRole } from '@/lib/auth/roles'

const ROLE_NAMES = [
  'director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead', 'kilimall_officer', 'sales_rep', 'technician',
  'super_admin', 'admin', 'finance', 'inventory', 'kilimall', 'sales', 'lead_tech', 'repair_tech',
]
const ALL_MODULES = [...MODULE_IDS] as string[]
const STORE_KEYS = Object.keys(STORE_WRITE_POLICIES).sort()

function accessOf(role: string) {
  const bare = { role: role as never, modules: [] as never[] }
  const full = { role: role as never, modules: ALL_MODULES as never[] }
  return {
    canonical: [canonicalUserRole(role), canonicalRole(role)],
    can: PERMISSION_CATALOG.map(d => d.key).filter(k => userCan(bare, k)).sort(),
    canWithAllModules: PERMISSION_CATALOG.map(d => d.key).filter(k => userCan(full, k)).sort(),
    actions: (Object.keys(ROLE_MATRIX) as PermissionAction[]).filter(a => hasPermission(bare, a)).sort(),
    saves: STORE_KEYS.filter(k => canWriteStoreKey({ role, modules: ALL_MODULES }, k)),
    reads: STORE_KEYS.filter(k => canReadStoreKey({ ...full, actsAsTechnician: false } as never, k)),
  }
}

describe('access snapshot', () => {
  it('matches today, role by role', () => {
    expect(Object.fromEntries(ROLE_NAMES.map(r => [r, accessOf(r)]))).toMatchSnapshot()
  })
})

