import { describe, expect, it } from 'vitest'
import {
  canReadStoreKey,
  filterReadableStoreKeys,
  filterStoreValueForRole,
  hasFullStoreContentAccess,
} from '@/lib/auth/authorization'

const user = (role: any, modules: any[], id = 'u1') => ({ id, role, modules })

describe('collaborative wholesale store read authorization', () => {
  it('requires both an allowed role and the sales module for sale orders', () => {
    expect(canReadStoreKey(user('sales_rep', ['sales']), 'deed_saleOrders')).toBe(true)
    expect(canReadStoreKey(user('sales_rep', ['dashboard']), 'deed_saleOrders')).toBe(false)
    expect(canReadStoreKey(user('technician', ['sales']), 'deed_saleOrders')).toBe(false)
    expect(hasFullStoreContentAccess(user('technician', ['sales']), 'deed_saleOrders')).toBe(false)
  })

  it('requires repair role and module for repair records', () => {
    expect(canReadStoreKey(user('technical_lead', ['repair']), 'deed_repairs_v2')).toBe(true)
    expect(canReadStoreKey(user('technical_lead', ['inventory']), 'deed_repairs_v2')).toBe(false)
    expect(canReadStoreKey(user('sales_rep', ['repair']), 'deed_repairs_v2')).toBe(false)
  })

  it('allows contacts and products only for modules with a legitimate workflow', () => {
    expect(canReadStoreKey(user('inventory_officer', ['purchase']), 'deed_contacts')).toBe(true)
    expect(canReadStoreKey(user('technician', ['repair']), 'deed_contacts')).toBe(true)
    expect(canReadStoreKey(user('technician', ['dashboard']), 'deed_contacts')).toBe(false)
    expect(canReadStoreKey(user('kilimall_officer', ['kilimall']), 'deed_products')).toBe(true)
    expect(canReadStoreKey(user('sales_rep', ['hr']), 'deed_products')).toBe(false)
  })

  it('filters requested keys without blocking ordinary collaborative keys', () => {
    const keys = ['deed_saleOrders', 'deed_repairs_v2', 'deed_contacts', 'deed_quotes']
    expect(filterReadableStoreKeys(user('sales_rep', ['sales']), keys)).toEqual([
      'deed_saleOrders',
      'deed_contacts',
      'deed_quotes',
    ])
  })

  it('returns only a sales rep own sale orders', () => {
    const orders = [
      { id: 'mine', createdByUserId: 'rep-1' },
      { id: 'other', createdByUserId: 'rep-2' },
      { id: 'legacy-without-owner' },
    ]
    const result = filterStoreValueForRole(user('sales_rep', ['sales'], 'rep-1'), 'deed_saleOrders', orders) as any[]
    expect(result.map(order => order.id)).toEqual(['mine'])
    expect(hasFullStoreContentAccess(user('sales_rep', ['sales']), 'deed_saleOrders')).toBe(false)
  })

  it('returns only repairs assigned to the technician', () => {
    const repairs = [
      { id: 'mine', assignedTechnicianId: 'tech-1' },
      { id: 'other', assignedTechnicianId: 'tech-2' },
      { id: 'unassigned' },
    ]
    const result = filterStoreValueForRole(user('technician', ['repair'], 'tech-1'), 'deed_repairs_v2', repairs) as any[]
    expect(result.map(repair => repair.id)).toEqual(['mine'])
    expect(hasFullStoreContentAccess(user('technician', ['repair']), 'deed_repairs_v2')).toBe(false)
  })

  it('keeps full collaborative slices for oversight roles with grants', () => {
    const orders = [{ id: 'one', createdByUserId: 'rep-1' }, { id: 'two', createdByUserId: 'rep-2' }]
    expect(filterStoreValueForRole(user('finance_officer', ['sales']), 'deed_saleOrders', orders)).toEqual(orders)
    expect(hasFullStoreContentAccess(user('technical_lead', ['repair']), 'deed_repairs_v2')).toBe(true)
  })
})
