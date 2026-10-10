import { describe, expect, it } from 'vitest'
import { calculateKenyaPayroll, calculateKenyaPayrollCapped } from '@/lib/hr/kenya-payroll'

describe('insurance relief and benefits in kind', () => {
  it('leaves existing results unchanged when neither is supplied', () => {
    const a = calculateKenyaPayroll(100000, 0, 0)
    expect(a.insuranceRelief).toBe(0)
    expect(a.nonCashBenefits).toBe(0)
  })

  it('gives 15% of premiums as relief against PAYE, capped at 5,000 a month', () => {
    const base = calculateKenyaPayroll(150000, 0, 0)
    const small = calculateKenyaPayroll(150000, 0, 0, { insurancePremiums: 10000 })
    expect(small.insuranceRelief).toBe(1500)
    expect(base.paye - small.paye).toBe(1500)
    const big = calculateKenyaPayroll(150000, 0, 0, { insurancePremiums: 100000 })
    expect(big.insuranceRelief).toBe(5000)
  })

  it('never takes PAYE below zero', () => {
    const r = calculateKenyaPayroll(30000, 0, 0, { insurancePremiums: 100000 })
    expect(r.paye).toBe(0)
  })

  it('taxes a non-cash benefit without paying it out or changing NSSF/SHIF', () => {
    const base = calculateKenyaPayroll(100000, 0, 0)
    const withCar = calculateKenyaPayroll(100000, 0, 0, { nonCashBenefits: 20000 })
    expect(withCar.grossSalary).toBe(base.grossSalary)
    expect(withCar.nssf).toBe(base.nssf)
    expect(withCar.shif).toBe(base.shif)
    expect(withCar.taxablePay - base.taxablePay).toBe(20000)
    expect(withCar.paye).toBeGreaterThan(base.paye)
    expect(withCar.netSalary).toBeCloseTo(base.netSalary - (withCar.paye - base.paye), 2)
  })
})

describe('deduction cap', () => {
  it('leaves normal deductions alone', () => {
    const r = calculateKenyaPayrollCapped(100000, 0, 0, { loanDeductions: 10000 })
    expect(r.capped).toBe(false)
    expect(r.loanDeductions).toBe(10000)
  })

  it('scales loans back so take-home stays at least one third of gross', () => {
    const r = calculateKenyaPayrollCapped(50000, 0, 0, { loanDeductions: 45000 })
    expect(r.capped).toBe(true)
    expect(r.loanDeductions).toBeLessThan(45000)
    expect(r.netSalary).toBeGreaterThanOrEqual(r.grossSalary / 3 - 0.01)
  })

  it('cuts loans before other deductions, and never touches salary advances', () => {
    const r = calculateKenyaPayrollCapped(50000, 0, 0, { advanceDeductions: 8000, loanDeductions: 40000, otherDeductions: 1000 })
    expect(r.advanceDeductions).toBe(8000)
    expect(r.loanDeductions).toBeLessThan(40000)
    expect(r.otherDeductions).toBeLessThanOrEqual(1000)
  })
})
