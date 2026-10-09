import { describe, expect, it } from 'vitest'
import { comparePayrollRuns, previousRun } from '@/lib/hr/payroll-variance'
import type { PayrollRun } from '@/lib/store'

const line = (id: string, name: string, basic: number, net: number, deductions = 0) =>
  ({ employeeId: id, employeeName: name, basicSalary: basic, allowances: 0, deductions, netPay: net })
const run = (id: string, month: string, year: number, lines: ReturnType<typeof line>[]): PayrollRun => ({
  id, ref: id, month, year, status: 'posted', lines,
  totalGross: lines.reduce((s, l) => s + l.basicSalary, 0),
  totalDeductions: lines.reduce((s, l) => s + l.deductions, 0),
  totalNet: lines.reduce((s, l) => s + l.netPay, 0),
})

describe('payroll variance', () => {
  const aug = run('aug', '08', 2026, [line('a', 'Ann', 100, 80), line('b', 'Bob', 50, 40), line('c', 'Cy', 70, 56)])
  const sep = run('sep', '09', 2026, [line('a', 'Ann', 100, 80), line('b', 'Bob', 60, 48), line('d', 'Di', 90, 72)])
  const jul = run('jul', '07', 2026, [])

  it('picks the latest earlier period', () => {
    expect(previousRun(sep, [jul, aug, sep])?.id).toBe('aug')
    expect(previousRun(jul, [jul, aug, sep])).toBeNull()
  })

  it('classifies new, left, changed and unchanged employees', () => {
    const v = comparePayrollRuns(sep, [jul, aug, sep])
    const kind = Object.fromEntries(v.rows.map(r => [r.employeeId, r.kind]))
    expect(kind).toEqual({ a: 'same', b: 'changed', c: 'left', d: 'new' })
    expect(v.rows.find(r => r.employeeId === 'b')?.netChange).toBe(8)
    expect(v.totals.headcount).toBe(0)
    expect(v.totals.net).toBe(24)
  })
})
