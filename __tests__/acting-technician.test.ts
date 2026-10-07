import { describe, expect, it } from 'vitest'
import { allowedOnlyAsTechnician, hasTechnicianCapability, isUserAllowed } from '@/lib/auth/authorization'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { buildMyWork } from '@/lib/my-work'
import { dashboardSectionsForUser } from '@/lib/dashboard-priority'

const REPAIR_ROLES = ['director', 'admin_officer', 'technical_lead', 'technician']
const kilimallTech = { id: 'k1', role: 'kilimall_officer', actsAsTechnician: true, modules: ['dashboard', 'kilimall', 'repair'] }
const kilimall = { ...kilimallTech, actsAsTechnician: false }

describe('a user acting as a technician', () => {
  it('passes the role checks a technician passes, and only those', () => {
    expect(hasTechnicianCapability(kilimallTech)).toBe(true)
    expect(isUserAllowed(kilimallTech, REPAIR_ROLES)).toBe(true)
    expect(isUserAllowed(kilimall, REPAIR_ROLES)).toBe(false)
    expect(isUserAllowed(kilimallTech, ['director', 'finance_officer'])).toBe(false)
  })

  it('is limited like a technician where only the technician entry lets them in', () => {
    expect(allowedOnlyAsTechnician(kilimallTech, ['director', 'finance_officer', 'technician'])).toBe(true)
    expect(allowedOnlyAsTechnician({ role: 'finance_officer', actsAsTechnician: true }, ['director', 'finance_officer', 'technician'])).toBe(false)
    // A real technician gets the same limits.
    expect(allowedOnlyAsTechnician({ role: 'technician' }, ['director', 'technician'])).toBe(true)
  })

  it('can save repair work (diagnosis lives in the repairs list)', () => {
    expect(canWriteStoreKey(kilimallTech, 'deed_repairs_v2')).toBe(true)
    expect(canWriteStoreKey(kilimall, 'deed_repairs_v2')).toBe(false)
  })

  it('gets the technician repair queue and the workshop dashboard section', () => {
    const base = { userId: 'k1', now: new Date('2026-10-07'), invoiceHref: () => '/finance', saleOrders: [], invoices: [], deliveries: [], buyBacks: [], stockAdjustments: [], serials: [], purchaseOrders: [] }
    const repairs = [{ id: 'r1', ref: 'REP-1', status: 'assigned', assignedTechnicianId: 'k1', intakeDate: '2026-10-01' }]
    const queues = buildMyWork({ ...base, role: 'kilimall_officer', actsAsTechnician: true, repairs })
    expect(queues.find(q => q.id === 'my-repairs')?.items.map(i => i.title)).toEqual(['REP-1'])
    expect(buildMyWork({ ...base, role: 'kilimall_officer', repairs }).find(q => q.id === 'my-repairs')).toBeUndefined()
    expect(dashboardSectionsForUser(kilimallTech as never).workshop).toBe(true)
  })
})
