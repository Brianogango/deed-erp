import { describe, expect, it } from 'vitest'
import { bootApiGroupsForRoute, bootStoreKeysForRoute, STORE_KEY_BOOT_GROUPS } from '@/lib/boot-apis'

// Every boot group that is only a store download used to issue its own
// /api/store request: opening Sales cost three round trips for nine keys
// before any of them could be applied. They go out together now.
describe('boot store keys', () => {
  it('collects a route\'s store-only groups into one list', () => {
    expect(bootApiGroupsForRoute('/sales')).toEqual(['products', 'contacts', 'sales', 'crm'])
    expect(bootStoreKeysForRoute('/sales')).toEqual([
      'deed_contacts', 'deed_companies', 'deed_contactPersons',
      'deed_quotes', 'deed_saleOrders', 'deed_payments', 'deed_deliveries',
      'deed_opportunities', 'deed_oppActivities',
    ])
  })

  it('asks for each key once when two groups share one', () => {
    const keys = bootStoreKeysForRoute('/purchases')
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('leaves groups that are REST calls out of the store download', () => {
    for (const group of ['products', 'employees', 'leave', 'payroll', 'salary_advances', 'approval_rules'] as const) {
      expect(STORE_KEY_BOOT_GROUPS[group]).toBeUndefined()
    }
  })

  it('boots nothing from the store on a route with no groups', () => {
    expect(bootStoreKeysForRoute('/documents')).toEqual([])
  })
})
