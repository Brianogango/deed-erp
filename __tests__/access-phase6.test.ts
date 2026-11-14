import { describe, expect, it } from 'vitest'
import { canWriteStoreKey, STORE_WRITE_POLICIES } from '@/lib/auth/store-write-policy'
import { upgradeRolePermissions } from '@/lib/auth/access-roles'
import { SAVE_AREAS } from '@/lib/auth/save-areas'
import { isKnownClientAppStateKey } from '@/lib/app-state-hydration'

// An Inventory Officer on a custom role, with rights added and removed.
const custom = (permissions: string[], modules: string[]) => ({ role: 'inventory_officer', modules, permissions })

describe('saving from the screens follows the role’s permissions', () => {
  it('a right added outside the base role is honoured', () => {
    expect(canWriteStoreKey({ role: 'inventory_officer', modules: ['sales'] }, 'deed_saleOrders')).toBe(false)
    expect(canWriteStoreKey(custom(['save.sales.orders'], ['inventory', 'sales']), 'deed_saleOrders')).toBe(true)
  })

  it('a right taken away is refused even with the module open', () => {
    expect(canWriteStoreKey({ role: 'inventory_officer', modules: ['inventory'] }, 'deed_stockAdjustments')).toBe(true)
    expect(canWriteStoreKey(custom(['save.inventory.products'], ['inventory']), 'deed_stockAdjustments')).toBe(false)
    expect(canWriteStoreKey(custom(['save.inventory.products'], ['inventory']), 'deed_products')).toBe(true)
  })

  it('still needs one of the area’s modules', () => {
    expect(canWriteStoreKey(custom(['save.sales.orders'], ['inventory']), 'deed_saleOrders')).toBe(false)
  })

  it('every screen-saved key belongs to exactly one area', () => {
    const keys = SAVE_AREAS.flatMap(a => a.storeKeys.map(k => typeof k === 'string' ? k : k[0]))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter(k => !isKnownClientAppStateKey(k))).toEqual([])
    expect(Object.keys(STORE_WRITE_POLICIES).length).toBe(keys.length)
  })
})

describe('the one-time upgrade of stored custom roles', () => {
  it('a role saved with an exact list gets the save rights its base role had, nothing else', () => {
    const p = upgradeRolePermissions({ baseRole: 'admin_officer', modules: ['dashboard', 'hr'], permissions: ['manageHR'] }, 0, true)
    expect(p).toEqual(expect.arrayContaining(['manageHR', 'save.expenses', 'save.hr.departments', 'save.settings.company']))
    expect(p).not.toContain('sales.contacts.edit')
    expect(p).not.toContain('save.settings.system')
  })

  it('an older role also gets the route rights it used to take from its base role', () => {
    const p = upgradeRolePermissions({ baseRole: 'admin_officer', modules: ['dashboard', 'sales'], permissions: [] }, 0, false)
    expect(p).toEqual(expect.arrayContaining(['sales.contacts.edit', 'save.sales.orders']))
  })

  it('runs once: an up-to-date role is left as it is', () => {
    expect(upgradeRolePermissions({ baseRole: 'admin_officer', modules: ['dashboard'], permissions: ['viewUsers'] }, 1, true)).toEqual(['viewUsers'])
  })
})
