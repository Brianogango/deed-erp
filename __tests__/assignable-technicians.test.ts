import { describe, expect, it } from 'vitest'
import { assignableTechnicians, isAssignableTechnician, isRepairTechActor, isRepairAssignerRole } from '@/lib/repair/assignable-technicians'
import {
  canReadStoreKey,
  hasFullStoreContentAccess,
  filterStoreValueForRole,
  canAccessRecord,
} from '@/lib/auth/authorization'

const users = [
  { id: 't1', name: 'Active Tech', role: 'technician', active: true, employeeId: 'e1' },
  { id: 't2', name: 'Off Tech', role: 'technician', active: false, employeeId: 'e2' },
  { id: 't3', name: 'Exited Tech', role: 'technician', active: true, employeeId: 'e3' },
  { id: 't4', name: 'Lead', role: 'technical_lead', active: true, employeeId: 'e4' },
  { id: 'k1', name: 'Kilimall', role: 'kilimall_officer', active: true, employeeId: 'e5', actsAsTechnician: true },
  { id: 'k2', name: 'Other Kilimall', role: 'kilimall_officer', active: true, employeeId: 'e6', actsAsTechnician: false },
  { id: 't5', name: 'Legacy Tech', role: 'repair_tech', active: true, employeeId: 'e7' },
  { id: 't6', name: 'Legacy Lead', role: 'lead_tech', active: true, employeeId: 'e8' },
]

const employees = [
  { id: 'e1', status: 'active' },
  { id: 'e2', status: 'active' },
  { id: 'e3', status: 'exited' },
  { id: 'e4', status: 'active' },
  { id: 'e5', status: 'active' },
  { id: 'e6', status: 'active' },
  { id: 'e7', status: 'active' },
  { id: 'e8', status: 'active' },
]

describe('assignableTechnicians', () => {
  it('includes actsAsTechnician users and excludes inactive/exited', () => {
    const list = assignableTechnicians(users, employees)
    expect(list.map(u => u.id).sort()).toEqual(['k1', 't1', 't4', 't5', 't6'])
  })

  it('isRepairTechActor normalizes technician aliases and supports flag users', () => {
    expect(isRepairTechActor({ role: 'technician' })).toBe(true)
    expect(isRepairTechActor({ role: 'repair_tech' })).toBe(true)
    expect(isRepairTechActor({ role: 'kilimall_officer', actsAsTechnician: true })).toBe(true)
    expect(isRepairTechActor({ role: 'kilimall_officer' })).toBe(false)
    expect(isRepairTechActor({ role: 'technical_lead' })).toBe(false)
  })

  it('accepts canonical and legacy technician/lead roles for assignment', () => {
    expect(isAssignableTechnician({ id: 'a', name: 'A', role: 'technician', active: true })).toBe(true)
    expect(isAssignableTechnician({ id: 'b', name: 'B', role: 'repair_tech', active: true })).toBe(true)
    expect(isAssignableTechnician({ id: 'c', name: 'C', role: 'technical_lead', active: true })).toBe(true)
    expect(isAssignableTechnician({ id: 'd', name: 'D', role: 'lead_tech', active: true })).toBe(true)
  })

  it('rejects actsAsTechnician when user is inactive', () => {
    expect(isAssignableTechnician({
      id: 'x', name: 'X', role: 'kilimall_officer', active: false, actsAsTechnician: true,
    })).toBe(false)
  })
})

describe('isRepairAssignerRole', () => {
  it('lets the technical lead assign under either role alias', () => {
    // Regression: the raw-role check skipped `lead_tech`, silently blocking
    // Technical Leads stored under the legacy alias from assigning jobs.
    expect(isRepairAssignerRole('technical_lead')).toBe(true)
    expect(isRepairAssignerRole('lead_tech')).toBe(true)
  })

  it('lets directors (and director aliases) assign', () => {
    expect(isRepairAssignerRole('director')).toBe(true)
    expect(isRepairAssignerRole('admin')).toBe(true)
    expect(isRepairAssignerRole('super_admin')).toBe(true)
  })

  it('rejects technicians and other non-lead roles', () => {
    expect(isRepairAssignerRole('technician')).toBe(false)
    expect(isRepairAssignerRole('repair_tech')).toBe(false)
    expect(isRepairAssignerRole('sales_rep')).toBe(false)
    expect(isRepairAssignerRole('')).toBe(false)
    expect(isRepairAssignerRole(null)).toBe(false)
    expect(isRepairAssignerRole(undefined)).toBe(false)
  })
})

describe('actsAsTechnician store ACL', () => {
  const kilo = (extra: Record<string, unknown> = {}) => ({
    id: 'k1',
    role: 'kilimall_officer' as const,
    modules: ['kilimall', 'repair'] as Array<'kilimall' | 'repair'>,
    actsAsTechnician: true,
    ...extra,
  })

  it('allows deed_repairs_v2 when flag + repair module are set', () => {
    expect(canReadStoreKey(kilo(), 'deed_repairs_v2')).toBe(true)
    expect(canReadStoreKey({ ...kilo(), actsAsTechnician: false }, 'deed_repairs_v2')).toBe(false)
    expect(canReadStoreKey({ ...kilo(), modules: ['kilimall'] }, 'deed_repairs_v2')).toBe(false)
  })

  it('filters repairs to assigned jobs only for flag users', () => {
    expect(hasFullStoreContentAccess(kilo(), 'deed_repairs_v2')).toBe(false)
    const repairs = [
      { id: 'mine', assignedTechnicianId: 'k1' },
      { id: 'other', assignedTechnicianId: 't1' },
    ]
    const filtered = filterStoreValueForRole(kilo(), 'deed_repairs_v2', repairs) as any[]
    expect(filtered.map(r => r.id)).toEqual(['mine'])
  })

  it('canAccessRecord allows assigned repairs for flag users', () => {
    expect(canAccessRecord('kilimall_officer', 'repair', { assignedTechnicianId: 'k1' }, 'k1', { actsAsTechnician: true })).toBe(true)
    expect(canAccessRecord('kilimall_officer', 'repair', { assignedTechnicianId: 't1' }, 'k1', { actsAsTechnician: true })).toBe(false)
    expect(canAccessRecord('kilimall_officer', 'repair', { assignedTechnicianId: 'k1' }, 'k1')).toBe(false)
  })
})
