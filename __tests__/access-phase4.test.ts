import { describe, expect, it } from 'vitest'
import { userAccessChangeViolation } from '@/lib/auth/access-control'
import { auditAreasOfKey, auditAreasFor, visibleAuditKeys } from '@/lib/auth/audit-areas'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { userCan } from '@/lib/auth/can'
import { validateRoleInput } from '@/lib/auth/access-roles'

// An HR person on a custom role (based on Admin Officer).
const hr = { role: 'admin_officer', modules: ['dashboard', 'hr', 'leave', 'my_documents'], permissions: ['manageHR', 'manageUsers', 'viewUsers', 'audit.view.users', 'audit.view.hr'], permissionsExact: true }

describe('HR manages user accounts', () => {
  it('can create users on the roles the Director set up', () => {
    expect(userAccessChangeViolation({ actor: hr, next: { role: 'sales_rep', modules: ['dashboard', 'sales', 'crm'] } })).toBeNull()
  })

  it('never touches a Director or makes one', () => {
    expect(userAccessChangeViolation({ actor: hr, target: { role: 'director' } })).toMatch(/Director’s account/)
    expect(userAccessChangeViolation({ actor: hr, target: { role: 'admin' } })).toMatch(/Director’s account/)
    expect(userAccessChangeViolation({ actor: hr, next: { role: 'director' } })).toMatch(/make someone a Director/)
  })

  it('cannot widen a role: user-admin roles, extra modules, acting technician', () => {
    expect(userAccessChangeViolation({ actor: hr, next: { role: 'admin_officer', grantsUserAdmin: true } })).toMatch(/manages users/)
    expect(userAccessChangeViolation({ actor: hr, next: { role: 'sales_rep', modules: ['sales', 'accounting'] } })).toMatch(/accounting/)
    expect(userAccessChangeViolation({ actor: hr, next: { role: 'sales_rep', actsAsTechnician: true } })).toMatch(/technician/)
  })

  it('the Director may do all of it', () => {
    expect(userAccessChangeViolation({ actor: { role: 'director' }, target: { role: 'director' }, next: { role: 'director', grantsUserAdmin: true } })).toBeNull()
  })

  it('HR saves HR records; the role editor keeps roles with the Director', () => {
    expect(canWriteStoreKey(hr, 'deed_leaveRequests')).toBe(true)
    expect(canWriteStoreKey({ role: 'admin_officer', modules: ['hr'] }, 'deed_leaveRequests')).toBe(false)
    expect(validateRoleInput({ name: 'HR', baseRole: 'admin_officer', modules: ['hr'], permissions: ['manageUsers'] }).ok).toBe(true)
    expect(validateRoleInput({ name: 'HR', baseRole: 'admin_officer', modules: ['hr'], permissions: ['manageRoles'] }).ok).toBe(false)
  })

  it('a role saved by the editor holds exactly its list', () => {
    // Admin Officer may edit contacts through the base role…
    expect(userCan({ role: 'admin_officer', permissions: [] }, 'sales.contacts.edit')).toBe(true)
    // …but not once the role was saved with an exact list.
    expect(userCan(hr, 'sales.contacts.edit')).toBe(false)
  })
})

describe('audit log by area', () => {
  it('files saved data under its area', () => {
    expect(auditAreasOfKey('deed_invoices')).toEqual(expect.arrayContaining(['finance', 'sales']))
    expect(auditAreasOfKey('deed_products')).toEqual(['inventory'])
    expect(auditAreasOfKey('deed_saleOrders')).toContain('sales')
    expect(auditAreasOfKey('deed_leaveRequests')).toEqual(['hr'])
  })

  it('each role reads its own areas; the Director reads everything', () => {
    expect(auditAreasFor({ role: 'director' })).toBe('all')
    expect([...(auditAreasFor({ role: 'admin_officer' }) as Set<string>)].sort()).toEqual(['inventory', 'sales', 'users'])
    expect([...(auditAreasFor({ role: 'finance_officer' }) as Set<string>)]).toEqual(['finance'])
    expect([...(auditAreasFor(hr) as Set<string>)].sort()).toEqual(['hr', 'users'])
    expect((auditAreasFor({ role: 'technician' }) as Set<string>).size).toBe(0)
  })

  it('shows only the keys of your areas', () => {
    const finance = auditAreasFor({ role: 'finance_officer' })
    expect(visibleAuditKeys(['deed_invoices', 'deed_products'], finance)).toEqual(['deed_invoices'])
    expect(visibleAuditKeys(['deed_products'], finance)).toEqual([])
  })
})
