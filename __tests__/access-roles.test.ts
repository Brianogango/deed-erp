import { describe, expect, it } from 'vitest'
import { ROLE_MATRIX } from '@/lib/auth/role-matrix'
import { MODULE_IDS, ROLE_DEFAULT_MODULES, USER_ROLES } from '@/lib/auth/types'
import { PERMISSION_CATALOG, PERMISSION_GROUPS, builtInPermissions, isKnownPermission } from '@/lib/auth/permission-catalog'
import {
  BUILT_IN_ROLES,
  describeRoleDiff,
  diffRoles,
  effectivePermissions,
  validateRoleInput,
} from '@/lib/auth/access-roles'
import { userCan } from '@/lib/auth/can'

const valid = (over: Record<string, unknown> = {}) => ({
  name: 'Accounts Assistant',
  description: 'Reads finance, cannot post',
  baseRole: 'finance_officer',
  modules: ['dashboard', 'accounting'],
  permissions: ['accounting.invoices', 'accounting.cheques.view'],
  ...over,
})

describe('the permission catalog', () => {
  it('lists every named action exactly once', () => {
    const keys = PERMISSION_CATALOG.map(d => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const action of Object.keys(ROLE_MATRIX)) expect(keys.filter(k => k === action)).toHaveLength(1)
  })

  it('only refers to modules that exist', () => {
    for (const group of PERMISSION_GROUPS) if (group.module) expect(MODULE_IDS).toContain(group.module)
  })
})

describe('built-in roles keep exactly the rights they have today', () => {
  it('gives every built-in role the same named actions as the role rules', () => {
    for (const role of USER_ROLES) {
      const user = { role, modules: ROLE_DEFAULT_MODULES[role] }
      for (const [action, allowed] of Object.entries(ROLE_MATRIX)) {
        expect(userCan(user, action), `${role} / ${action}`).toBe((allowed as readonly string[]).includes(role))
      }
    }
  })

  it('lists a built-in role’s permissions the same way userCan reads them', () => {
    for (const built of BUILT_IN_ROLES) {
      const user = { role: built.baseRole, modules: built.modules }
      const viaCan = PERMISSION_CATALOG.filter(def => userCan(user, def.key)).map(def => def.key)
      expect(built.permissions.slice().sort()).toEqual(viaCan.slice().sort())
    }
  })

  it('keeps the old behaviour for parts of a module: they follow the module', () => {
    expect(userCan({ role: 'finance_officer', modules: ROLE_DEFAULT_MODULES.finance_officer }, 'accounting.cashbook')).toBe(true)
    expect(userCan({ role: 'sales_rep', modules: ROLE_DEFAULT_MODULES.sales_rep }, 'accounting.cashbook')).toBe(false)
    expect(userCan({ role: 'sales_rep', modules: [...ROLE_DEFAULT_MODULES.sales_rep, 'accounting'] }, 'accounting.cashbook')).toBe(true)
  })

  it('keeps the cheque register to the three roles that always had it', () => {
    const asRole = (role: (typeof USER_ROLES)[number]) => userCan({ role, modules: [...MODULE_IDS] }, 'accounting.cheques.manage')
    expect(USER_ROLES.filter(asRole).sort()).toEqual(['admin_officer', 'director', 'finance_officer'])
  })

  it('treats a Director as holding everything', () => {
    for (const def of PERMISSION_CATALOG) expect(userCan({ role: 'director', modules: [] }, def.key)).toBe(true)
  })

  it('never grants an unknown permission', () => {
    expect(userCan({ role: 'director', modules: [] }, 'made.up')).toBe(false)
    expect(userCan(null, 'postFinancial')).toBe(false)
  })
})

describe('a custom role holds exactly what it lists', () => {
  const user = { role: 'finance_officer' as const, modules: ['dashboard', 'accounting'] as never, permissions: ['accounting.invoices'] }

  it('ignores the base role for anything not listed', () => {
    expect(userCan(user, 'accounting.invoices')).toBe(true)
    expect(userCan(user, 'postFinancial')).toBe(false) // the base role has it, the custom role does not
    expect(userCan(user, 'accounting.cashbook')).toBe(false)
  })
})

describe('creating a custom role', () => {
  it('accepts a sensible role and keeps only permissions in modules it can open', () => {
    const checked = validateRoleInput(valid({ permissions: ['accounting.invoices', 'inventory.catalog'] }))
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.value.permissions).toEqual(['accounting.invoices'])
  })

  it('always lets the role open the dashboard', () => {
    const checked = validateRoleInput(valid({ modules: ['accounting'] }))
    expect(checked.ok && checked.value.modules).toEqual(['dashboard', 'accounting'])
  })

  it('refuses what cannot be right', () => {
    const error = (over: Record<string, unknown>) => { const r = validateRoleInput(valid(over)); return r.ok ? null : r.error }
    expect(error({ name: ' ' })).toContain('name')
    expect(error({ name: 'Finance Officer' })).toContain('built-in')
    expect(error({ baseRole: 'director' })).toContain('Director')
    expect(error({ baseRole: 'wizard' })).toContain('based on')
    expect(error({ modules: ['accounting', 'nonsense'] })).toContain('Unknown module')
    expect(error({ permissions: ['accounting.invoices', 'nonsense'] })).toContain('Unknown permission')
    expect(error({ permissions: ['manageUsers'] })).toContain('Director')
    expect(error({ modules: 'accounting' })).toContain('modules')
  })

  it('knows its permissions are real', () => {
    expect(isKnownPermission('accounting.cheques.manage')).toBe(true)
    expect(isKnownPermission('accounting.cheques.delete')).toBe(false)
  })
})

describe('what a module switch means', () => {
  it('drops permissions whose module is closed, keeps module-less ones', () => {
    expect(effectivePermissions(['dashboard'], ['accounting.invoices', 'viewAuditLog'])).toEqual(['viewAuditLog'])
    expect(effectivePermissions(['dashboard', 'accounting'], ['accounting.invoices', 'viewAuditLog'])).toEqual(['accounting.invoices', 'viewAuditLog'])
  })

  it('builds the built-in list from the modules the role opens', () => {
    expect(builtInPermissions('technician', ROLE_DEFAULT_MODULES.technician)).not.toContain('accounting.invoices')
  })
})

describe('saying what changed in a role', () => {
  const base = { name: 'A', baseRole: 'technician' as const, modules: ['dashboard'] as never, permissions: [] as string[] }
  it('describes permissions and modules in words', () => {
    const diff = diffRoles(base, { ...base, modules: ['dashboard', 'accounting'] as never, permissions: ['accounting.cashbook'] })
    expect(diff.changed).toBe(true)
    expect(describeRoleDiff(diff)).toBe('can now open accounting; gained Cashbook & reconciliation')
    expect(diffRoles(base, base).changed).toBe(false)
  })
})
