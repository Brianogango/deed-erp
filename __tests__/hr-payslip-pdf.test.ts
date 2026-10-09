import { describe, expect, it } from 'vitest'
import { buildPayslipPdf, buildP9Pdf, payslipFileName } from '@/lib/hr/payslip-pdf'
import type { PayslipDetail } from '@/lib/hr/payroll-report-types'

const detail: PayslipDetail = {
  id: 'p1', reference: 'PS/2026/09/001', status: 'published', paymentStatus: 'paid', paidAt: null,
  period: { month: '9', year: 2026, start: '2026-09-01', end: '2026-09-30', runReference: 'PAY/2026/09' },
  employee: { id: 'e1', number: 'EMP-001', name: 'Jane Wanjiku', jobTitle: 'Technician', department: 'Repairs', kraPin: 'A001', nssfNumber: '1', shaNumber: '2', idNumber: '3', paymentMode: 'bank', bankName: 'NCBA', bankAccount: '0011223344', mpesaNumber: '' },
  earnings: [{ label: 'Basic salary', amount: 100000 }, { label: 'Commission', amount: 5000 }],
  deductions: [{ label: 'PAYE', amount: 20000 }, { label: 'NSSF', amount: 6000 }],
  employer: [{ label: 'Employer NSSF', amount: 6000 }],
  advances: [{ ref: 'ADV/001', amount: 3000, remainingAfter: 6000 }],
  gross: 105000, totalDeductions: 29000, net: 76000,
  ytd: { gross: 945000, paye: 180000, nssf: 54000, net: 684000 },
}

describe('payslip pdf', () => {
  it('builds a one-page A4 payslip', () => {
    const doc = buildPayslipPdf(detail, { name: 'Deed Technologies', kraPin: 'P051999898X' })
    expect(doc.getNumberOfPages()).toBe(1)
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(2000)
    expect(payslipFileName(detail)).toBe('Payslip-PS-2026-09-001.pdf')
  })
  it('builds a P9 card', () => {
    const m = { month: 1, basic: 1, benefits: 0, gross: 1, nssf: 0, shif: 0, housingLevy: 0, pension: 0, taxablePay: 1, taxCharged: 0, personalRelief: 0, paye: 0 }
    const doc = buildP9Pdf({ employeeNo: 'E1', employeeName: 'Jane', kraPin: 'A1', months: [m] }, 2026, { name: 'Deed' })
    expect(doc.getNumberOfPages()).toBe(1)
  })
})
