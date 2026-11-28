import { describe, expect, it } from 'vitest'
import { employeeSetup } from '@/lib/hr/employee-setup'

const base = { id: 'e1', phone: '0722', nationalId: '123', kraPin: 'A1', nssfNumber: 'N1', shift: 'S1', paymentMode: 'mpesa' as const, bankAccount: '', mpesaNumber: '' }

describe('employee setup', () => {
  it('complete when details, pay, ID copy and contract are there; equipment is not counted', () => {
    const s = employeeSetup(base, [{ employeeId: 'e1', type: 'id_copy' }, { employeeId: 'e1', type: 'contract' }])
    expect(s.complete).toBe(true)
    expect(s.done).toBe(4)
    expect(s.items.find(i => i.key === 'equipment')?.required).toBe(false)
  })

  it('says what is missing', () => {
    const s = employeeSetup({ ...base, kraPin: '', paymentMode: 'bank', nssfNumber: '' }, [{ employeeId: 'other', type: 'contract' }])
    expect(s.complete).toBe(false)
    expect(s.items[0].hint).toBe('Missing KRA PIN')
    expect(s.items[1].hint).toBe('Missing bank account, NSSF')
    expect(s.missing).toEqual(['contact & id details', 'pay details', 'id copy', 'signed contract'])
  })

  it('counts open onboarding tasks', () => {
    const s = employeeSetup({ ...base, onboardingChecklist: [{ id: 't', label: 'Login', done: false }, { id: 'u', label: 'Mail', done: true }] }, [{ employeeId: 'e1', type: 'id_copy' }, { employeeId: 'e1', type: 'contract' }], 1)
    expect(s.total).toBe(5)
    expect(s.complete).toBe(false)
    expect(s.items.find(i => i.key === 'tasks')?.hint).toBe('1 of 2 left')
  })
})
