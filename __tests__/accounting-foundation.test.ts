import { describe, expect, it } from 'vitest'
import { extractAccountCode, uuidFromKey } from '@/lib/accounting/ids'
import {
  APPROVAL_RULES,
  extractApprovalValue,
  rolesFromThresholds,
} from '@/lib/sales-approval-rules'
import {
  applyDeliveryAverage,
  applyReceiptAverage,
  stockValuationEventKey,
  stockValuationJournalRef,
} from '@/lib/inventory/valuation-math'
import { buildZeroBalanceCoaTemplate, coaTemplateToBlobAccounts } from '@/lib/accounting/coa-template'

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
  it('keeps price approvals as Director OR Finance (not a chain)', () => {
    expect(APPROVAL_RULES.discount({ discountPercent: 5 })).toEqual([])
    expect(APPROVAL_RULES.discount({ discountPercent: 15 })).toEqual(['director', 'finance_officer'])
    expect(APPROVAL_RULES.discount({ discountPercent: 55 })).toEqual(['director', 'finance_officer'])
    expect(APPROVAL_RULES.special_pricing({})).toEqual(['director', 'finance_officer'])
    expect(APPROVAL_RULES.backorder({ backorderQty: 3 })).toEqual([])
    expect(APPROVAL_RULES.backorder({ backorderQty: 50 })).toEqual([])
    expect(APPROVAL_RULES.purchase_high_value({ proposedValue: 999_999, threshold: 50_000 })).toEqual([])
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

describe('weighted-average valuation math', () => {
  it('computes receipt average cost', () => {
    const r1 = applyReceiptAverage({ currentQty: 0, currentValue: 0, qty: 2, unitCost: 1000 })
    expect(r1).toMatchObject({ totalQty: 2, totalValue: 2000, averageCost: 1000 })
    const r2 = applyReceiptAverage({
      currentQty: r1.totalQty,
      currentValue: r1.totalValue,
      qty: 2,
      unitCost: 2000,
    })
    expect(r2.totalQty).toBe(4)
    expect(r2.totalValue).toBe(6000)
    expect(r2.averageCost).toBe(1500)
  })

  it('reduces delivery at average cost', () => {
    const d = applyDeliveryAverage({
      currentQty: 4,
      currentValue: 6000,
      averageCost: 1500,
      qty: 1,
    })
    expect(d.totalCost).toBe(1500)
    expect(d.totalQty).toBe(3)
    expect(d.totalValue).toBe(4500)
    expect(d.averageCost).toBe(1500)
  })

  it('builds stable valuation keys (no Date.now)', () => {
    expect(stockValuationEventKey('receipt', 'REC001', 'prod-1'))
      .toBe(stockValuationEventKey('receipt', 'REC001', 'prod-1'))
    expect(stockValuationJournalRef('delivery', 'DN001', 'prod-1'))
      .toBe('JRN/STK/DEL/DN001/prod-1')
  })
})

describe('zero-balance CoA template', () => {
  it('never ships demo balances', () => {
    const rows = buildZeroBalanceCoaTemplate()
    expect(rows.length).toBeGreaterThan(20)
    expect(rows.every(r => r.balance === 0)).toBe(true)
    expect(rows.some(r => r.code === '1800')).toBe(true)
    expect(rows.some(r => r.code === '3000')).toBe(true)
    expect(rows.some(r => r.code === '6200')).toBe(true)
    expect(rows.some(r => r.code === '6210')).toBe(true)
    const codes = rows.map(r => r.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('maps to blob account shape', () => {
    const blob = coaTemplateToBlobAccounts(buildZeroBalanceCoaTemplate().slice(0, 3))
    expect(blob[0]).toMatchObject({ balance: 0, isActive: true })
    expect(blob[0].id).toContain('coa-bootstrap-')
  })
})
