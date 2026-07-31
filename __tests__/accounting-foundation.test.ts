import { describe, expect, it } from 'vitest'
import { extractAccountCode, uuidFromKey } from '@/lib/accounting/ids'
import {
  APPROVAL_RULES,
  extractApprovalValue,
  rolesFromThresholds,
} from '@/lib/sales-approval-rules'

describe('accounting ids', () => {
  it('extracts codes from CoA labels', () => {
    expect(extractAccountCode('1800 - Accounts Receivable')).toBe('1800')
    expect(extractAccountCode('5001')).toBe('5001')
    expect(extractAccountCode('nope')).toBeNull()
  })

  it('builds stable UUIDs from business keys', () => {
    expect(uuidFromKey('account', '1800')).toBe(uuidFromKey('account', '1800'))
    expect(uuidFromKey('account', '1800')).not.toBe(uuidFromKey('account', '1801'))
  })
})

describe('approval thresholds', () => {
  it('keeps hardcoded discount ladders', () => {
    expect(APPROVAL_RULES.discount({ discountPercent: 5 })).toEqual([])
    expect(APPROVAL_RULES.discount({ discountPercent: 15 })).toEqual(['director'])
    expect(APPROVAL_RULES.discount({ discountPercent: 55 })).toEqual(['director', 'finance_officer'])
  })

  it('resolves DB-style thresholds by value', () => {
    const thresholds = [
      { maxValue: 10, requiredRoles: [] },
      { maxValue: 20, requiredRoles: ['director'] },
      { maxValue: 999, requiredRoles: ['director', 'finance_officer'] },
    ]
    expect(rolesFromThresholds(thresholds, 8)).toEqual([])
    expect(rolesFromThresholds(thresholds, 12)).toEqual(['director'])
    expect(rolesFromThresholds(thresholds, 50)).toEqual(['director', 'finance_officer'])
  })

  it('extracts approval values', () => {
    expect(extractApprovalValue('discount', { discountPercent: 12 })).toBe(12)
    expect(extractApprovalValue('credit_override', { creditRequested: 150000, creditAvailable: 50000 })).toBe(100000)
    expect(extractApprovalValue('backorder', { backorderQty: 3 })).toBe(3)
  })
})
