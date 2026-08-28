import { describe, expect, it } from 'vitest'
import { buildZeroBalanceCoaTemplate } from '@/lib/accounting/coa-template'
import {
  CUSTOMER_CREDITS_ACCOUNT,
  CUSTOMER_CREDITS_CODE,
  CUSTOMER_DEPOSITS_ACCOUNT,
  CUSTOMER_DEPOSITS_CODE,
} from '@/lib/accounting/liability-accounts'

describe('finance liability CoA split', () => {
  it('keeps deposits (3100) and customer credits (3102) as separate accounts', () => {
    expect(CUSTOMER_DEPOSITS_CODE).toBe('3100')
    expect(CUSTOMER_CREDITS_CODE).toBe('3102')
    expect(CUSTOMER_DEPOSITS_ACCOUNT).toContain('Customer Deposits')
    expect(CUSTOMER_CREDITS_ACCOUNT).toContain('Customer Credits')
    expect(CUSTOMER_DEPOSITS_ACCOUNT).not.toEqual(CUSTOMER_CREDITS_ACCOUNT)
  })

  it('includes 3100, 3102, 3105, 6108, and inventory posting accounts in the zero-balance CoA template', () => {
    const codes = new Set(buildZeroBalanceCoaTemplate().map(a => a.code))
    expect(codes.has('3100')).toBe(true)
    expect(codes.has('3102')).toBe(true)
    expect(codes.has('3105')).toBe(true)
    expect(codes.has('6108')).toBe(true)
    expect(codes.has('6200')).toBe(true)
    expect(codes.has('6205')).toBe(true)
    expect(codes.has('6210')).toBe(true)
  })

  it('includes every account the posting engine references', () => {
    const codes = new Set(buildZeroBalanceCoaTemplate().map(a => a.code))
    // PPE cost + accumulated depreciation + disposal + depreciation expense
    for (const c of ['1701', '1702', '1703', '1704', '1751', '1752', '1753', '1754', '6515', '6517', '5203']) {
      expect(codes.has(c)).toBe(true)
    }
    // Returns, FX, services purchases, expense categories, opening equity
    for (const c of ['5099', '5206', '6102', '6400', '6410', '6415', '6420', '6440', '6450', '6521', '6705', '4004']) {
      expect(codes.has(c)).toBe(true)
    }
    // Equity block
    for (const c of ['4001', '4002', '4003']) {
      expect(codes.has(c)).toBe(true)
    }
  })
})
