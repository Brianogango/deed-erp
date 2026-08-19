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

  it('includes 3100, 3102, 3105, and 6108 in the zero-balance CoA template', () => {
    const codes = new Set(buildZeroBalanceCoaTemplate().map(a => a.code))
    expect(codes.has('3100')).toBe(true)
    expect(codes.has('3102')).toBe(true)
    expect(codes.has('3105')).toBe(true)
    expect(codes.has('6108')).toBe(true)
  })
})
