import { describe, expect, it } from 'vitest'
import { buildZeroBalanceCoaTemplate } from '@/lib/accounting/coa-template'
import {
  CUSTOMER_CREDITS_ACCOUNT,
  CUSTOMER_CREDITS_CODE,
  CUSTOMER_DEPOSITS_ACCOUNT,
  CUSTOMER_DEPOSITS_CODE,
} from '@/lib/accounting/liability-accounts'

describe('finance liability CoA split', () => {
  it('keeps deposits (3100) and customer credits (3313) as separate accounts', () => {
    expect(CUSTOMER_DEPOSITS_CODE).toBe('3100')
    expect(CUSTOMER_CREDITS_CODE).toBe('3313')
    expect(CUSTOMER_DEPOSITS_ACCOUNT).toContain('Customer Deposits')
    expect(CUSTOMER_CREDITS_ACCOUNT).toContain('Customer Credits')
    expect(CUSTOMER_DEPOSITS_ACCOUNT).not.toEqual(CUSTOMER_CREDITS_ACCOUNT)
  })

  it('includes 3100, 3313, 3312, 6114, and inventory posting accounts in the zero-balance CoA template', () => {
    const codes = new Set(buildZeroBalanceCoaTemplate().map(a => a.code))
    expect(codes.has('3100')).toBe(true)
    expect(codes.has('3313')).toBe(true)
    expect(codes.has('3312')).toBe(true)
    expect(codes.has('6114')).toBe(true)
    expect(codes.has('6305')).toBe(true)
    expect(codes.has('6306')).toBe(true)
    expect(codes.has('6307')).toBe(true)
  })

  it('includes every account the posting engine references', () => {
    const codes = new Set(buildZeroBalanceCoaTemplate().map(a => a.code))
    // PPE cost + accumulated depreciation + disposal + depreciation expense
    for (const c of ['1701', '1702', '1703', '1704', '1751', '1752', '1753', '1754', '6515', '6517', '5203']) {
      expect(codes.has(c)).toBe(true)
    }
    // Returns, FX, services costs, official expense categories, opening equity
    for (const c of ['5099', '5206', '6301', '6503', '6504', '6505', '6506', '6507', '6511', '6518', '6519', '6521', '6595', '6599', '6705', '4004']) {
      expect(codes.has(c)).toBe(true)
    }
    // Employment + financial expense blocks (official 2025 chart)
    for (const c of ['6601', '6606', '6609', '6701', '6702', '6703', '6704']) {
      expect(codes.has(c)).toBe(true)
    }
    // Statutory + payroll liabilities
    for (const c of ['3302', '3303', '3304', '3305', '3306', '3310', '3311']) {
      expect(codes.has(c)).toBe(true)
    }
    // Equity block
    for (const c of ['4001', '4002', '4003']) {
      expect(codes.has(c)).toBe(true)
    }
  })
})
