import { describe, expect, it } from 'vitest'
import {
  commissionCloserHint,
  commissionCloserOptions,
  commissionCloserSelectOptions,
  isCommissionCloserRole,
} from '@/lib/sales/commission-closer'

const users = [
  { id: 'rep', name: 'Jane Rep', role: 'sales_rep', active: true, employeeId: 'emp-1' },
  { id: 'dir', name: 'Brian', role: 'director', active: true, employeeId: 'emp-2' },
  { id: 'fin', name: 'Finance', role: 'finance_officer', active: true, employeeId: 'emp-3' },
  { id: 'tech', name: 'Tech', role: 'technician', active: true, employeeId: 'emp-4' },
  { id: 'gone', name: 'Leaver', role: 'sales_rep', active: false, employeeId: 'emp-5' },
  { id: 'unlinked', name: 'New Rep', role: 'sales_rep', active: true, employeeId: null },
]

describe('commission closer eligibility', () => {
  it('treats sales, director, admin, and kilimall as closers — not finance or workshop', () => {
    expect(isCommissionCloserRole('sales_rep')).toBe(true)
    expect(isCommissionCloserRole('director')).toBe(true)
    expect(isCommissionCloserRole('admin_officer')).toBe(true)
    expect(isCommissionCloserRole('kilimall_officer')).toBe(true)
    expect(isCommissionCloserRole('finance_officer')).toBe(false)
    expect(isCommissionCloserRole('technician')).toBe(false)
  })

  it('lists active closers and flags missing HR employee links', () => {
    const options = commissionCloserOptions(users)
    expect(options.map(o => o.id)).toEqual(['dir', 'rep', 'unlinked'])
    expect(options.find(o => o.id === 'unlinked')?.hasEmployee).toBe(false)
    expect(commissionCloserSelectOptions(options).find(o => o.value === 'unlinked')?.label).toMatch(/no HR employee/)
  })

  it('explains that the creator is not the commission earner', () => {
    const hint = commissionCloserHint({
      closer: { id: 'rep', name: 'Jane Rep', role: 'sales_rep', hasEmployee: true },
      createdByName: 'Brian',
    })
    expect(hint).toMatch(/Creator stays Brian/)
    expect(hint).toMatch(/invoice is posted/)
  })

  it('warns when the chosen closer cannot receive commission', () => {
    const hint = commissionCloserHint({
      closer: { id: 'unlinked', name: 'New Rep', role: 'sales_rep', hasEmployee: false },
      createdByName: 'Brian',
    })
    expect(hint).toMatch(/no Employee record/)
  })
})
