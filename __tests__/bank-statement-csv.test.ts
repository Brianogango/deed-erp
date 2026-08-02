import { describe, expect, it } from 'vitest'
import { parseBankStatementCsv, monthFromDate } from '@/lib/bank-statement-csv'

describe('bank statement CSV parser', () => {
  it('parses debit/credit columns and infers categories', () => {
    const csv = [
      'Date,Description,Reference,Debit,Credit,Balance',
      '2026-08-01,Customer receipt,MPESA-1,0,15000,15000',
      '02/08/2026,Bank charges,,50,0,14950',
      '2026-08-03,Vendor payment,CHQ-9,5000,0,9950',
    ].join('\n')
    const { lines, errors } = parseBankStatementCsv(csv)
    expect(errors).toHaveLength(0)
    expect(lines).toHaveLength(3)
    expect(lines[0].credit).toBe(15000)
    expect(lines[0].category).toBe('receipt')
    expect(lines[1].date).toBe('2026-08-02')
    expect(lines[1].category).toBe('bank_charge')
    expect(lines[2].debit).toBe(5000)
    expect(monthFromDate(lines[0].date)).toBe('2026-08')
  })

  it('supports signed Amount column', () => {
    const csv = 'Date,Narration,Amount\n2026-08-01,Transfer in,2500\n2026-08-02,Transfer out,-800'
    const { lines } = parseBankStatementCsv(csv)
    expect(lines[0].credit).toBe(2500)
    expect(lines[1].debit).toBe(800)
  })
})
