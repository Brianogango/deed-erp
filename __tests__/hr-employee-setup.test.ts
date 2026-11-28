import { describe, expect, it } from 'vitest'
import { employeeSetup } from '@/lib/hr/employee-setup'

const base = { id: 'e1', phone: '0722', nationalId: '29341234', kraPin: 'A1', nssfNumber: 'N1', shift: 'S1', paymentMode: 'bank' as const, bankName: 'Equity', bankAccount: '01', mpesaNumber: '', basicSalary: 40000 }
const docs = [{ employeeId: 'e1', type: 'id_copy' as const }, { employeeId: 'e1', type: 'contract' as const }]

describe('onboarding (five steps)', () => {
  it('complete with details, ID copy, payroll, contract and equipment', () => {
    const s = employeeSetup(base, docs, 1)
    expect(s.complete).toBe(true)
    expect(s.total).toBe(5)
    expect(s.items[0].hint).toBe('Equity · ID 2934…')
  })

  it('says what is missing, shortest first in the list', () => {
    const s = employeeSetup({ ...base, kraPin: '', nssfNumber: '' }, [{ employeeId: 'other', type: 'contract' }])
    expect(s.done).toBe(0)
    expect(s.items[0].hint).toBe('Missing KRA PIN')
    expect(s.items[2].hint).toBe('Missing NSSF')
    expect(s.missing).toEqual(['details', 'ID', 'payroll', 'contract', 'kit'])
  })

  it('a daily-rate person with no monthly salary is set up for payroll', () => {
    const s = employeeSetup({ ...base, basicSalary: 0 }, docs, 0, { basis: 'daily', dailyRate: 1500 })
    expect(s.items[2]).toMatchObject({ done: true, hint: 'Daily rate · clocks in' })
    expect(s.done).toBe(4)
  })
})
