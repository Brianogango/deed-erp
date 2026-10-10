import { describe, expect, it } from 'vitest'
import { buildPayslipEmail, payslipPeriodLabel } from '@/lib/hr/payslip-email'

describe('payslip email', () => {
  it('names the period and carries no amounts', () => {
    const m = buildPayslipEmail({ companyName: 'Deed Technologies', employeeName: 'Jane Wanjiku', month: '09', year: 2026, hrEmail: 'hr@deed.co.ke' })
    expect(m.subject).toBe('Your payslip for September 2026')
    expect(m.text).toContain('Hi Jane,')
    expect(m.text).toContain('hr@deed.co.ke')
    expect(`${m.text}${m.html}`).not.toMatch(/KSh|net pay|\d{2},\d{3}/i)
  })

  it('escapes names and handles a numeric month', () => {
    expect(payslipPeriodLabel(1, 2027)).toBe('January 2027')
    const m = buildPayslipEmail({ companyName: 'A & B', employeeName: '<b>X</b>', month: 12, year: 2026 })
    expect(m.html).toContain('A &amp; B')
    expect(m.html).not.toContain('<b>X</b>')
  })
})
