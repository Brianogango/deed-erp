import { describe, expect, it } from 'vitest'
import {
  applyBookDepreciationCharge,
  bookNbv,
  defaultBookMethod,
  defaultUsefulLifeMonths,
  disposalAmounts,
  monthlyBookDepreciation,
  periodAlreadyRun,
  shouldPostCapitaliseJournal,
  withBookDefaults,
  type BookAsset,
} from '@/lib/company-property-ppe'

function asset(partial: Partial<BookAsset> = {}): BookAsset {
  return {
    ref: 'AST/2026/0001',
    name: 'Visitor chairs',
    category: 'furniture',
    assetClass: 'capital',
    status: 'in_use',
    costKes: 96000,
    residualKes: 0,
    accumDeprKes: 0,
    usefulLifeMonths: 96,
    depreciationMethod: 'straight_line',
    ppeAccountCode: '1702',
    acquiredVia: 'purchase',
    qty: 1,
    ...partial,
  }
}

describe('book defaults', () => {
  it('uses 96 months SL for furniture, 60 SL for office, 36 RB for IT', () => {
    expect(defaultUsefulLifeMonths('furniture')).toBe(96)
    expect(defaultUsefulLifeMonths('office_equipment')).toBe(60)
    expect(defaultUsefulLifeMonths('it_non_trading')).toBe(36)
    expect(defaultBookMethod('furniture')).toBe('straight_line')
    expect(defaultBookMethod('it_non_trading')).toBe('reducing_balance')
  })

  it('fills missing life and method without clobbering an explicit straight-line IT asset', () => {
    const filled = withBookDefaults({
      category: 'it_non_trading' as const,
      costKes: 120000,
      depreciationMethod: 'straight_line' as const,
    })
    expect(filled.usefulLifeMonths).toBe(36)
    expect(filled.depreciationMethod).toBe('straight_line')
    expect(filled.residualKes).toBe(0)
  })
})

describe('monthly book depreciation', () => {
  it('charges straight-line cost / life, then stops at residual', () => {
    expect(monthlyBookDepreciation(asset())).toBe(1000)
    const almostDone = asset({ accumDeprKes: 95000, residualKes: 0 })
    expect(monthlyBookDepreciation(almostDone)).toBe(1000)
    const residual = asset({ accumDeprKes: 95000, residualKes: 6000 })
    expect(monthlyBookDepreciation(residual)).toBe(0)
  })

  it('charges reducing-balance on NBV for IT', () => {
    const it = asset({
      category: 'it_non_trading',
      ppeAccountCode: '1701',
      costKes: 36000,
      usefulLifeMonths: 36,
      depreciationMethod: 'reducing_balance',
    })
    // 1/3 annual → 1/36 of NBV per month
    expect(monthlyBookDepreciation(it)).toBe(1000)
    const after = applyBookDepreciationCharge(it, 1000, '2026-08')
    expect(after.accumDeprKes).toBe(1000)
    expect(after.lastDepreciatedPeriod).toBe('2026-08')
    expect(bookNbv(after)).toBe(35000)
  })
})

describe('shouldPostCapitaliseJournal', () => {
  it('skips opening, donation, draft, expensed, zero cost, and already posted', () => {
    expect(shouldPostCapitaliseJournal(asset({ acquiredVia: 'opening' }))).toBeNull()
    expect(shouldPostCapitaliseJournal(asset({ acquiredVia: 'donation' }))).toBeNull()
    expect(shouldPostCapitaliseJournal(asset({ status: 'draft' }))).toBeNull()
    expect(shouldPostCapitaliseJournal(asset({ assetClass: 'expensed' }))).toBeNull()
    expect(shouldPostCapitaliseJournal(asset({ costKes: 0 }))).toBeNull()
    expect(shouldPostCapitaliseJournal(asset({ capitaliseJournalRef: 'JRN/AST-CAP/X' }))).toBeNull()
  })

  it('posts inventory when a trading serial is linked, AP when purchased without a bill', () => {
    expect(shouldPostCapitaliseJournal(asset({ serialId: 's1' }))).toBe('inventory')
    expect(shouldPostCapitaliseJournal(asset({ billRef: 'BILL/1' }))).toBeNull()
    expect(shouldPostCapitaliseJournal(asset())).toBe('ap')
    expect(shouldPostCapitaliseJournal(asset({ serialId: 's1', billRef: 'BILL/1' }))).toBe('inventory')
  })
})

describe('disposalAmounts', () => {
  it('splits cost and accum, then gain is proceeds minus NBV', () => {
    const split = disposalAmounts(asset({ costKes: 100000, accumDeprKes: 40000, qty: 2 }), 1, 40000)
    expect(split.cost).toBe(50000)
    expect(split.accum).toBe(20000)
    expect(split.nbv).toBe(30000)
    expect(split.gain).toBe(10000)
  })

  it('records a loss when proceeds are below NBV', () => {
    const split = disposalAmounts(asset({ costKes: 100000, accumDeprKes: 10000, qty: 1 }), 1, 0)
    expect(split.gain).toBe(-90000)
  })
})

describe('periodAlreadyRun', () => {
  it('treats equal or later last period as already run', () => {
    expect(periodAlreadyRun('2026-08', '2026-08')).toBe(true)
    expect(periodAlreadyRun('2026-09', '2026-08')).toBe(true)
    expect(periodAlreadyRun('2026-07', '2026-08')).toBe(false)
    expect(periodAlreadyRun(undefined, '2026-08')).toBe(false)
  })
})
