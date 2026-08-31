import { describe, expect, it } from 'vitest'
import {
  canReadStoreKey,
  canAccessRecord,
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
    expect(canReadStoreKey(user('admin_officer', ['repair']), 'deed_repairs_v2')).toBe(true)
    expect(canReadStoreKey(user('finance_officer', ['repair']), 'deed_repairs_v2')).toBe(true)
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

  it('returns every sale order to a sales rep', () => {
    const orders = [
      { id: 'mine', createdByUserId: 'rep-1' },
      { id: 'assigned', salespersonId: 'rep-1' },
      { id: 'other', createdByUserId: 'rep-2' },
      { id: 'legacy-without-owner' },
    ]
    const result = filterStoreValueForRole(user('sales_rep', ['sales'], 'rep-1'), 'deed_saleOrders', orders) as any[]
    expect(result.map(order => order.id)).toEqual(['mine', 'assigned', 'other', 'legacy-without-owner'])
    // Writes still merge so a stale partial cache cannot wipe the ledger.
    expect(hasFullStoreContentAccess(user('sales_rep', ['sales']), 'deed_saleOrders')).toBe(false)
  })

  it('returns only opportunities owned by the sales rep', () => {
    const opps = [
      { id: 'mine', ownerId: 'rep-1' },
      { id: 'assigned', assignedToId: 'rep-1' },
      { id: 'other', ownerId: 'rep-2' },
    ]
    const result = filterStoreValueForRole(user('sales_rep', ['crm'], 'rep-1'), 'deed_opportunities', opps) as any[]
    expect(result.map(o => o.id).sort()).toEqual(['assigned', 'mine'])
    expect(hasFullStoreContentAccess(user('sales_rep', ['crm']), 'deed_opportunities')).toBe(false)
  })

  it('canAccessRecord lets a sales rep open any sale order but still owns opportunities', () => {
    expect(canAccessRecord('sales_rep', 'sale_order', { createdByUserId: 'rep-1' }, 'rep-1')).toBe(true)
    expect(canAccessRecord('sales_rep', 'sale_order', { salespersonId: 'rep-1' }, 'rep-1')).toBe(true)
    expect(canAccessRecord('sales_rep', 'sale_order', { createdByUserId: 'rep-2' }, 'rep-1')).toBe(true)
    expect(canAccessRecord('finance_officer', 'sale_order', { createdByUserId: 'rep-2' }, 'rep-1')).toBe(true)
    expect(canAccessRecord('technician', 'sale_order', { createdByUserId: 'rep-1' }, 'tech-1')).toBe(false)
    expect(canAccessRecord('sales_rep', 'opportunity', { ownerId: 'rep-1' }, 'rep-1')).toBe(true)
    expect(canAccessRecord('sales_rep', 'opportunity', { ownerId: 'rep-2' }, 'rep-1')).toBe(false)
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
