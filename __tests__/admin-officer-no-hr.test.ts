import { describe, it, expect } from 'vitest'
import { hasPermission } from '@/lib/auth/authorization'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'

const ao = { id: 'u-ao', role: 'admin_officer', modules: ['hr', 'leave', 'delivery'] } as any

describe('Admin Officer has no HR rights', () => {
  it('cannot see team HR records or payroll', () => {
    for (const p of ['manageHR', 'viewHrRecords', 'viewEmployeeSensitive', 'managePayroll', 'approveLeave'] as const) {
      expect(hasPermission(ao, p), p).toBe(false)
    }
  })
  it('keeps rider weekly pay (delivery admin)', () => {
    expect(hasPermission(ao, 'manageRiderPay')).toBe(true)
  })
  it('cannot write HR store records', () => {
    for (const key of ['deed_leaveRequests', 'deed_leaveBalances', 'deed_salaryAdvances', 'deed_contracts', 'deed_candidates']) {
      expect(canWriteStoreKey(ao, key), key).toBe(false)
    }
    expect(canWriteStoreKey({ ...ao, role: 'director' }, 'deed_leaveRequests')).toBe(true)
  })
})

describe('Technical Lead has no leave rights', () => {
  const lead = { id: 'u-tl', role: 'technical_lead', modules: ['hr', 'leave', 'repair'] } as any
  it('cannot see or decide team leave', () => {
    expect(hasPermission(lead, 'approveLeave')).toBe(false)
    expect(hasPermission(lead, 'viewHrRecords')).toBe(false)
    expect(canWriteStoreKey(lead, 'deed_leaveRequests')).toBe(false)
  })
})
