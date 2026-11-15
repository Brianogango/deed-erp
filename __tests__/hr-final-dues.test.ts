import { describe, expect, it } from 'vitest'
import { calculateFinalDues, type FinalDuesInput } from '@/lib/hr/final-dues'

const base: FinalDuesInput = {
  basicSalary: 60000, housingAllowance: 0, transportAllowance: 0, exitDate: '2026-09-15',
  unusedLeaveDays: 0, noticePayDays: 0, exitMonthSalaryPaid: false,
  outstandingLoans: 0, outstandingAdvances: 0, unreturnedAssetsCharge: 0, otherDeductions: 0,
}

describe('final dues', () => {
  it('pro-rates the exit month on calendar days', () => {
    const r = calculateFinalDues(base)
    expect(r.daysWorkedInExitMonth).toBe(15)
    expect(r.daysInExitMonth).toBe(30)
    expect(r.earnings[0].amount).toBe(30000)
  })

  it('pays unused leave and notice at 1/30 of basic', () => {
    const r = calculateFinalDues({ ...base, exitMonthSalaryPaid: true, unusedLeaveDays: 6, noticePayDays: 30 })
    expect(r.dailyRate).toBe(2000)
    expect(r.earnings.map(e => e.amount)).toEqual([12000, 60000])
    expect(r.gross).toBe(72000)
  })

  it('skips the pro-rata salary when the month was already paid', () => {
    const r = calculateFinalDues({ ...base, exitMonthSalaryPaid: true })
    expect(r.earnings).toEqual([])
    expect(r.gross).toBe(0)
    expect(r.statutory).toEqual([])
  })

  it('deducts recoveries and goes negative when the employee owes the company', () => {
    const r = calculateFinalDues({ ...base, exitMonthSalaryPaid: true, outstandingLoans: 20000, outstandingAdvances: 5000 })
    expect(r.gross).toBe(0)
    expect(r.recoveries.map(x => x.amount)).toEqual([20000, 5000])
    expect(r.net).toBe(-25000)
  })

  it('handles a month-end exit', () => {
    const r = calculateFinalDues({ ...base, exitDate: '2026-02-28' })
    expect(r.daysWorkedInExitMonth).toBe(28)
    expect(r.earnings[0].amount).toBe(60000)
  })
})

import { lengthOfService, buildCertificateOfService, buildFinalDuesPdf } from '@/lib/hr/exit-documents'
import { DOCUMENT_LAYOUT_IDS } from '@/lib/document-layout'

const exitEmp = { name: 'Jane Wanjiku', employeeNo: 'E1', jobTitle: 'Senior Technician', department: 'Repairs', idNumber: '12345678', startDate: '2024-01-01', exitDate: '2026-09-15', exitReason: 'Resigned' }

describe('exit documents', () => {
  it('computes length of service inclusively', () => {
    expect(lengthOfService('2024-01-01', '2024-12-31')).toBe('1 year')
    expect(lengthOfService('2025-03-15', '2026-09-14')).toBe('1 year, 6 months')
    expect(lengthOfService('2026-09-01', '2026-09-01')).toBe('1 day')
  })
  it('builds one-page certificate and statement', () => {
    expect(buildCertificateOfService(exitEmp, { name: 'Deed' }, '2026-09-16').getNumberOfPages()).toBe(1)
    expect(buildFinalDuesPdf(exitEmp, { name: 'Deed' }, calculateFinalDues(base)).getNumberOfPages()).toBe(1)
  })

  // Both documents sit on the shared letterhead, so every print template and paper
  // size a company can choose has to stay inside one page.
  it.each(DOCUMENT_LAYOUT_IDS)('stays one branded page on the %s template', layout => {
    const co = {
      name: 'Deed Technologies LTD', address: 'Sanlam House', city: 'Nairobi', phone: '0113407964',
      email: 'info@deed.africa', website: 'https://deed.africa', kraPin: 'P051999898X',
      printTemplate: layout, printBackground: 'demo_logo' as const, printTagline: 'Technology that works for you',
      printPrimaryColor: '#0F766E', printSecondaryColor: '#14B8A6', invoiceFooter: 'Thank you.',
    }
    for (const doc of [buildCertificateOfService(exitEmp, co, '2026-09-16'), buildFinalDuesPdf(exitEmp, co, calculateFinalDues(base))]) {
      expect(doc.getNumberOfPages()).toBe(1)
      expect(String.fromCharCode(...new Uint8Array(doc.output('arraybuffer')).slice(0, 5))).toBe('%PDF-')
    }
  })

  it.each(['a4', 'letter'] as const)('stays one page on %s paper', printPaperFormat => {
    const co = { name: 'Deed Technologies LTD', printPaperFormat }
    expect(buildCertificateOfService(exitEmp, co, '2026-09-16').getNumberOfPages()).toBe(1)
    expect(buildFinalDuesPdf(exitEmp, co, calculateFinalDues(base)).getNumberOfPages()).toBe(1)
  })
})
