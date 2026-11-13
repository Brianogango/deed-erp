import { describe, expect, it } from 'vitest'
import { allowedOnlyAsTechnician, hasTechnicianCapability } from '@/lib/auth/authorization'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { userCan } from '@/lib/auth/can'
import { buildMyWork } from '@/lib/my-work'
import { dashboardSectionsForUser } from '@/lib/dashboard-priority'

const kilimallTech = { id: 'k1', role: 'kilimall_officer', actsAsTechnician: true, modules: ['dashboard', 'kilimall', 'repair'] }
const kilimall = { ...kilimallTech, actsAsTechnician: false }

describe('a user acting as a technician', () => {
  it('passes the role checks a technician passes, and only those', () => {
    expect(hasTechnicianCapability(kilimallTech)).toBe(true)
    expect(userCan(kilimallTech, 'repair.edit')).toBe(true)
    expect(userCan(kilimall, 'repair.edit')).toBe(false)
    expect(userCan(kilimallTech, 'managePayroll')).toBe(false)
  })

  it('holds the permissions technicians hold', () => {
    expect(userCan(kilimallTech, 'repair.edit')).toBe(true)
    expect(userCan(kilimall, 'repair.edit')).toBe(false)
  })

  it('is limited like a technician where only the technician grant lets them in', () => {
    expect(allowedOnlyAsTechnician(kilimallTech, 'repair.edit')).toBe(true)
    // Finance may edit repair invoices in its own right.
    expect(allowedOnlyAsTechnician({ role: 'finance_officer', actsAsTechnician: true }, 'repair.invoice.edit')).toBe(false)
    // A real technician gets the same limits; the Director never does.
    expect(allowedOnlyAsTechnician({ role: 'technician' }, 'repair.edit')).toBe(true)
    expect(allowedOnlyAsTechnician({ role: 'director' }, 'repair.edit')).toBe(false)
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
