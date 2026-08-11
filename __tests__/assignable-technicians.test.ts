import { describe, expect, it } from 'vitest'
import { assignableTechnicians, isAssignableTechnician } from '@/lib/repair/assignable-technicians'

const users = [
  { id: 't1', name: 'Active Tech', role: 'technician', active: true, employeeId: 'e1' },
  { id: 't2', name: 'Off Tech', role: 'technician', active: false, employeeId: 'e2' },
  { id: 't3', name: 'Exited Tech', role: 'technician', active: true, employeeId: 'e3' },
  { id: 't4', name: 'Lead', role: 'technical_lead', active: true, employeeId: 'e4' },
  { id: 's1', name: 'Sales', role: 'sales_rep', active: true, employeeId: 'e5' },
]

const employees = [
  { id: 'e1', status: 'active' },
  { id: 'e2', status: 'active' },
  { id: 'e3', status: 'exited' },
  { id: 'e4', status: 'active' },
  { id: 'e5', status: 'active' },
]

describe('assignableTechnicians', () => {
  it('excludes inactive users and exited employees', () => {
    const list = assignableTechnicians(users, employees)
    expect(list.map(u => u.id)).toEqual(['t1', 't4'])
  })

  it('treats missing active as assignable when role matches', () => {
    expect(isAssignableTechnician({ id: 'x', name: 'X', role: 'technician', active: true })).toBe(true)
  })
})
