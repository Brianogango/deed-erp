import { describe, expect, it } from 'vitest'
import {
  buildBankPaymentFile, buildHousingLevyReturn, buildMpesaPaymentFile, buildNssfReturn,
  buildP9, buildPayeReturn, buildShifReturn, normalizeKenyanMsisdn,
} from '@/lib/hr/statutory-exports'
import type { StatutoryReport, StatutoryRow, AnnualEmployeeRow } from '@/lib/hr/payroll-report-types'

const row = (over: Partial<StatutoryRow> = {}): StatutoryRow => ({
  employeeId: 'e1', employeeNo: 'EMP-001', employeeName: 'Jane Wanjiku', firstName: 'Jane', lastName: 'Wanjiku',
  idNumber: '12345678', kraPin: 'A001234567B', nssfNumber: '9876', shaNumber: 'SHA-1', paymentMode: 'bank',
  bankName: 'NCBA', bankAccount: '0011223344', mpesaNumber: '0712345678',
  basic: 100000, housingAllowance: 0, transportAllowance: 0, commission: 0, overtimePay: 0, otherAdditions: 0,
  gross: 100000, nssf: 6000, employerNssf: 6000, shif: 2750, housingLevy: 1500, employerHousingLevy: 1500,
  pension: 0, personalRelief: 2400, nonCashBenefits: 0, insuranceRelief: 0, paye: 20000, loanDeductions: 0, otherDeductions: 0, advanceDeductions: 0,
  totalDeductions: 30250, net: 69750, paymentStatus: 'pending', ...over,
})
const report = (rows: StatutoryRow[]): StatutoryReport => ({
  run: { id: 'r1', reference: 'PAY/2026/09', month: '09', year: 2026, status: 'posted', periodStart: '2026-09-01', periodEnd: '2026-09-30' },
  rows, totals: {},
})

describe('statutory exports', () => {
  it('names files by period and builds one NSSF line per employee with the employer share', () => {
    const t = buildNssfReturn(report([row()]))
    expect(t.filename).toBe('NSSF-schedule-2026-09')
    expect(t.rows[0]).toEqual(['EMP-001', 'Wanjiku', 'Jane', '12345678', 'A001234567B', '9876', 100000, 0, 6000, 6000, 12000])
  })

  it('PAYE return reports PAYE after relief and tax charged before relief', () => {
    const t = buildPayeReturn(report([row()]))
    const header = t.headers
    const r = t.rows[0]
    expect(r[header.indexOf('PAYE Tax')]).toBe(20000)
    expect(r[header.indexOf('Tax Payable')]).toBe(22400)
    expect(r[header.indexOf('Taxable Pay')]).toBe(89750)
  })

  it('PAYE return includes non-cash benefits in taxable pay and insurance relief in tax payable', () => {
    const t = buildPayeReturn(report([row({ nonCashBenefits: 20000, insuranceRelief: 1500, paye: 18500 })]))
    const r = t.rows[0]
    const h = t.headers
    expect(r[h.indexOf('Total Non Cash Pay')]).toBe(20000)
    expect(r[h.indexOf('Total Gross Pay')]).toBe(120000)
    expect(r[h.indexOf('Taxable Pay')]).toBe(109750)
    expect(r[h.indexOf('Insurance Relief')]).toBe(1500)
    expect(r[h.indexOf('Tax Payable')]).toBe(22400)
  })

  it('SHIF and housing levy schedules carry the right amounts', () => {
    expect(buildShifReturn(report([row()])).rows[0].slice(-2)).toEqual([100000, 2750])
    expect(buildHousingLevyReturn(report([row()])).rows[0].slice(-3)).toEqual([1500, 1500, 3000])
  })

  it('splits salary files by payment mode and reports who was left out', () => {
    const rows = [
      row(),
      row({ employeeNo: 'EMP-002', employeeName: 'No Account', bankAccount: '' }),
      row({ employeeNo: 'EMP-003', employeeName: 'Mo Pesa', paymentMode: 'mpesa', mpesaNumber: '0722 000 111', net: 5000 }),
      row({ employeeNo: 'EMP-004', employeeName: 'Bad Phone', paymentMode: 'mpesa', mpesaNumber: '123' }),
      row({ employeeNo: 'EMP-005', employeeName: 'Zero Net', net: 0 }),
    ]
    const bank = buildBankPaymentFile(report(rows))
    expect(bank.rows.map(r => r[0])).toEqual(['EMP-001'])
    expect(bank.skipped).toEqual(['No Account (no bank account)'])
    const mpesa = buildMpesaPaymentFile(report(rows))
    expect(mpesa.rows).toEqual([['254722000111', 5000, 'Mo Pesa', 'Salary 09/2026']])
    expect(mpesa.skipped).toEqual(['Bad Phone (no valid M-Pesa number)'])
  })

  it('normalises Kenyan mobile numbers', () => {
    expect(normalizeKenyanMsisdn('0712 345 678')).toBe('254712345678')
    expect(normalizeKenyanMsisdn('+254 112 345 678')).toBe('254112345678')
    expect(normalizeKenyanMsisdn('712345678')).toBe('254712345678')
    expect(normalizeKenyanMsisdn('12345')).toBeNull()
  })

  it('P9 adds an annual total row', () => {
    const month = (n: number) => ({ month: n, basic: 100, benefits: 10, gross: 110, nssf: 5, shif: 3, housingLevy: 2, pension: 0, taxablePay: 100, taxCharged: 20, personalRelief: 2, insuranceRelief: 1, paye: 18 })
    const emp: AnnualEmployeeRow = { employeeId: 'e1', employeeNo: 'EMP-001', employeeName: 'Jane', kraPin: 'A1', months: [month(1), month(2)] }
    const t = buildP9(emp, 2026)
    expect(t.rows).toHaveLength(3)
    expect(t.rows[2]).toEqual(['TOTAL', 200, 20, 220, 10, 6, 4, 0, 200, 40, 4, 2, 36])
  })
})
