import { describe, expect, it } from 'vitest'
import { canAssignRepair } from '@/lib/repair/can-assign'

const lead = { role: 'technical_lead' }
const director = { role: 'director' }

describe('canAssignRepair', () => {
  it('open jobs, for those who may assign', () => {
    expect(canAssignRepair({ user: lead, status: 'received', outsourced: false })).toBe(true)
    expect(canAssignRepair({ user: { role: 'technician' }, status: 'received', outsourced: false })).toBe(false)
  })
  it('a Director only when "Admin assigns jobs" is on', () => {
    expect(canAssignRepair({ user: director, status: 'in_repair', outsourced: false, adminAssignsJobs: true })).toBe(true)
    expect(canAssignRepair({ user: director, status: 'in_repair', outsourced: false, adminAssignsJobs: false })).toBe(false)
  })
  it('never once finished or while at an outsource vendor — Directors included', () => {
    expect(canAssignRepair({ user: director, status: 'closed', outsourced: false, adminAssignsJobs: true })).toBe(false)
    expect(canAssignRepair({ user: director, status: 'in_repair', outsourced: true, adminAssignsJobs: true })).toBe(false)
    expect(canAssignRepair({ user: lead, status: 'collected', outsourced: false })).toBe(false)
  })
})
