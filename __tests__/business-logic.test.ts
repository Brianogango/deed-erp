/**
 * Tests for lib/business-logic.ts
 *
 * These are pure-function tests — no mocking, no React, no DB.
 * They verify the core inventory, payroll, and deposit calculation logic
 * that underpins the ERP's financial correctness.
 */

import { describe, it, expect } from 'vitest'
import {
  calcStockByLocation,
  availableSellableQty,
  isListedInProductCatalog,
  upsertBulkStock,
  computePayrollLine,
  aggregatePayroll,
  resolveDepositStatus,
  capPayment,
  type StockProduct,
  type SerialNumber,
  type BulkStockLevel,
  type PayrollEmployee,
} from '@/lib/business-logic'

// ── calcStockByLocation ───────────────────────────────────────────────────────

describe('calcStockByLocation()', () => {
  const bulkProduct: StockProduct = { requiresSerial: false }
  const serialProduct: StockProduct = { requiresSerial: true }

  describe('bulk (non-serial) products', () => {
    it('returns zeros for all locations when no bulk stock exists', () => {
      const result = calcStockByLocation(bulkProduct, [], [], 'prod-1')
      expect(result).toEqual({ warehouse: 0, shop: 0, repair_unit: 0, vendor: 0, customer: 0, employee: 0, pending_testing: 0, quarantine: 0 })
    })

    it('reads qty from bulk stock levels for matching product', () => {
      const bulk: BulkStockLevel[] = [
        { productId: 'prod-1', location: 'warehouse', qty: 10 },
        { productId: 'prod-1', location: 'shop', qty: 3 },
      ]
      const result = calcStockByLocation(bulkProduct, [], bulk, 'prod-1')
      expect(result.warehouse).toBe(10)
      expect(result.shop).toBe(3)
      expect(result.repair_unit).toBe(0)
    })

    it('ignores bulk stock for other products', () => {
      const bulk: BulkStockLevel[] = [
        { productId: 'other-prod', location: 'warehouse', qty: 99 },
      ]
      const result = calcStockByLocation(bulkProduct, [], bulk, 'prod-1')
      expect(result.warehouse).toBe(0)
    })

    it('ignores serial records for bulk products', () => {
      const serials: SerialNumber[] = [
        { productId: 'prod-1', location: 'warehouse', status: 'in_stock' },
      ]
      const result = calcStockByLocation(bulkProduct, serials, [], 'prod-1')
      expect(result.warehouse).toBe(0)
    })
  })

  describe('serial products', () => {
    it('returns zeros when no serials exist', () => {
      const result = calcStockByLocation(serialProduct, [], [], 'prod-1')
      expect(result).toEqual({ warehouse: 0, shop: 0, repair_unit: 0, vendor: 0, customer: 0, employee: 0, pending_testing: 0, quarantine: 0 })
    })

    it('counts each active serial at its location', () => {
      const serials: SerialNumber[] = [
        { productId: 'prod-1', location: 'warehouse', status: 'in_stock' },
        { productId: 'prod-1', location: 'warehouse', status: 'in_stock' },
        { productId: 'prod-1', location: 'shop', status: 'in_stock' },
      ]
      const result = calcStockByLocation(serialProduct, serials, [], 'prod-1')
      expect(result.warehouse).toBe(2)
      expect(result.shop).toBe(1)
    })

    it('excludes serials with status "returned"', () => {
      const serials: SerialNumber[] = [
        { productId: 'prod-1', location: 'warehouse', status: 'in_stock' },
        { productId: 'prod-1', location: 'warehouse', status: 'returned' }, // excluded
      ]
      const result = calcStockByLocation(serialProduct, serials, [], 'prod-1')
      expect(result.warehouse).toBe(1)
    })

    it('excludes serials for other products', () => {
      const serials: SerialNumber[] = [
        { productId: 'other-prod', location: 'warehouse', status: 'in_stock' },
      ]
      const result = calcStockByLocation(serialProduct, serials, [], 'prod-1')
      expect(result.warehouse).toBe(0)
    })

    it('ignores bulk stock entries for serial products', () => {
      const bulk: BulkStockLevel[] = [{ productId: 'prod-1', location: 'warehouse', qty: 50 }]
      const result = calcStockByLocation(serialProduct, [], bulk, 'prod-1')
      expect(result.warehouse).toBe(0)
    })
  })

  describe('undefined product', () => {
    it('returns all-zeros when product is undefined', () => {
      const result = calcStockByLocation(undefined, [], [], 'prod-1')
      expect(result).toEqual({ warehouse: 0, shop: 0, repair_unit: 0, vendor: 0, customer: 0, employee: 0, pending_testing: 0, quarantine: 0 })
    })
  })
})

describe('availableSellableQty()', () => {
  it('counts only available warehouse serials for laptops, ignoring sold, With Issues, and repair', () => {
    const serials: SerialNumber[] = [
      { productId: 'prod-1', location: 'warehouse', status: 'available' },
      { productId: 'prod-1', location: 'warehouse', status: 'available' },
      { productId: 'prod-1', location: 'shop', status: 'available' },
      { productId: 'prod-1', location: 'repair_unit', status: 'available' },
      { productId: 'prod-1', location: 'warehouse', status: 'sold' },
      { productId: 'prod-1', location: 'warehouse', status: 'in_stock' },
      { productId: 'prod-1', location: 'warehouse', status: 'assigned' },
    ]
    expect(availableSellableQty(
      { category: 'Laptops', requiresSerial: true },
      serials,
      [{ productId: 'prod-1', location: 'warehouse', qty: 99 }],
      'prod-1',
    )).toBe(2)
  })

  it('counts bulk qty at warehouse only', () => {
    const bulk: BulkStockLevel[] = [
      { productId: 'prod-1', location: 'warehouse', qty: 3 },
      { productId: 'prod-1', location: 'shop', qty: 2 },
      { productId: 'prod-1', location: 'repair_unit', qty: 1 },
      { productId: 'prod-1', location: 'quarantine', qty: 8 },
    ]
    expect(availableSellableQty(
      { category: 'Accessories', requiresSerial: false },
      [],
      bulk,
      'prod-1',
    )).toBe(3)
  })

  it('returns 0 for services', () => {
    expect(availableSellableQty(
      { category: 'Services', unit: 'service' },
      [{ productId: 'prod-1', location: 'warehouse', status: 'available' }],
      [{ productId: 'prod-1', location: 'warehouse', qty: 4 }],
      'prod-1',
    )).toBe(0)
  })
})

describe('isListedInProductCatalog()', () => {
  const laptop = { category: 'Laptops', requiresSerial: true, isActive: true, canBeSold: true }
  const warehouseSerial: SerialNumber = { productId: 'prod-1', location: 'warehouse', status: 'available' }

  it('lists a laptop with warehouse stock', () => {
    expect(isListedInProductCatalog(laptop, [warehouseSerial], [], 'prod-1')).toBe(true)
  })

  it('hides zero-stock, With Issues only, archived, not-for-sale, and services', () => {
    expect(isListedInProductCatalog(laptop, [], [], 'prod-1')).toBe(false)
    expect(isListedInProductCatalog(laptop, [{ productId: 'prod-1', location: 'shop', status: 'available' }], [], 'prod-1')).toBe(false)
    expect(isListedInProductCatalog({ ...laptop, isActive: false }, [warehouseSerial], [], 'prod-1')).toBe(false)
    expect(isListedInProductCatalog({ ...laptop, canBeSold: false }, [warehouseSerial], [], 'prod-1')).toBe(false)
    expect(isListedInProductCatalog(
      { unit: 'service', isActive: true, canBeSold: true },
      [warehouseSerial],
      [{ productId: 'prod-1', location: 'warehouse', qty: 4 }],
      'prod-1',
    )).toBe(false)
  })
})

// ── upsertBulkStock ───────────────────────────────────────────────────────────

describe('upsertBulkStock()', () => {
  it('adds a new entry when product+location has no existing record', () => {
    const result = upsertBulkStock([], 'prod-1', 'warehouse', 5)
    expect(result).toEqual([{ productId: 'prod-1', location: 'warehouse', qty: 5 }])
  })

  it('increases qty of existing entry', () => {
    const levels: BulkStockLevel[] = [{ productId: 'prod-1', location: 'warehouse', qty: 10 }]
    const result = upsertBulkStock(levels, 'prod-1', 'warehouse', 5)
    const entry = result.find(l => l.productId === 'prod-1' && l.location === 'warehouse')
    expect(entry?.qty).toBe(15)
  })

  it('decreases qty with a negative delta', () => {
    const levels: BulkStockLevel[] = [{ productId: 'prod-1', location: 'warehouse', qty: 10 }]
    const result = upsertBulkStock(levels, 'prod-1', 'warehouse', -3)
    const entry = result.find(l => l.productId === 'prod-1' && l.location === 'warehouse')
    expect(entry?.qty).toBe(7)
  })

  it('removes the entry when qty reaches exactly 0', () => {
    const levels: BulkStockLevel[] = [{ productId: 'prod-1', location: 'warehouse', qty: 5 }]
    const result = upsertBulkStock(levels, 'prod-1', 'warehouse', -5)
    expect(result.find(l => l.productId === 'prod-1' && l.location === 'warehouse')).toBeUndefined()
  })

  it('floors qty at 0 (never negative stock)', () => {
    const levels: BulkStockLevel[] = [{ productId: 'prod-1', location: 'warehouse', qty: 3 }]
    const result = upsertBulkStock(levels, 'prod-1', 'warehouse', -10)
    expect(result.find(l => l.productId === 'prod-1' && l.location === 'warehouse')).toBeUndefined()
  })

  it('does not mutate the input array', () => {
    const levels: BulkStockLevel[] = [{ productId: 'prod-1', location: 'warehouse', qty: 5 }]
    const original = JSON.stringify(levels)
    upsertBulkStock(levels, 'prod-1', 'warehouse', 3)
    expect(JSON.stringify(levels)).toBe(original)
  })

  it('preserves entries for other products', () => {
    const levels: BulkStockLevel[] = [
      { productId: 'prod-1', location: 'warehouse', qty: 10 },
      { productId: 'prod-2', location: 'warehouse', qty: 5 },
    ]
    const result = upsertBulkStock(levels, 'prod-1', 'warehouse', -2)
    const other = result.find(l => l.productId === 'prod-2')
    expect(other?.qty).toBe(5)
  })

  it('preserves entries for other locations of the same product', () => {
    const levels: BulkStockLevel[] = [
      { productId: 'prod-1', location: 'warehouse', qty: 10 },
      { productId: 'prod-1', location: 'shop', qty: 3 },
    ]
    const result = upsertBulkStock(levels, 'prod-1', 'warehouse', -2)
    const shopEntry = result.find(l => l.productId === 'prod-1' && l.location === 'shop')
    expect(shopEntry?.qty).toBe(3)
  })
})

// ── computePayrollLine ────────────────────────────────────────────────────────

describe('computePayrollLine()', () => {
  const emp: PayrollEmployee = {
    id: 'emp-001',
    fullName: 'Jane Otieno',
    basicSalary: 50000,
    housingAllowance: 10000,
    transportAllowance: 5000,
  }

  it('sums housing and transport into allowances', () => {
    const line = computePayrollLine(emp)
    expect(line.allowances).toBe(15000)
  })

  it('computes deductions as 18% of basicSalary (rounded)', () => {
    const line = computePayrollLine(emp)
    expect(line.deductions).toBe(Math.round(50000 * 0.18)) // 9000
  })

  it('netPay = basicSalary + allowances − deductions', () => {
    const line = computePayrollLine(emp)
    expect(line.netPay).toBe(50000 + 15000 - 9000) // 56000
  })

  it('carries employee id and name through', () => {
    const line = computePayrollLine(emp)
    expect(line.employeeId).toBe('emp-001')
    expect(line.employeeName).toBe('Jane Otieno')
  })

  it('carries basicSalary through', () => {
    const line = computePayrollLine(emp)
    expect(line.basicSalary).toBe(50000)
  })

  it('rounds deductions correctly for non-integer results', () => {
    const oddSalary: PayrollEmployee = { ...emp, basicSalary: 33333 }
    const line = computePayrollLine(oddSalary)
    expect(line.deductions).toBe(Math.round(33333 * 0.18))
  })

  it('handles zero allowances', () => {
    const noAllowances: PayrollEmployee = { ...emp, housingAllowance: 0, transportAllowance: 0 }
    const line = computePayrollLine(noAllowances)
    expect(line.allowances).toBe(0)
    expect(line.netPay).toBe(50000 - Math.round(50000 * 0.18))
  })
})

// ── aggregatePayroll ──────────────────────────────────────────────────────────

describe('aggregatePayroll()', () => {
  it('sums totalGross as sum of (basicSalary + allowances)', () => {
    const lines = [
      { employeeId: '1', employeeName: 'A', basicSalary: 50000, allowances: 15000, deductions: 9000, netPay: 56000 },
      { employeeId: '2', employeeName: 'B', basicSalary: 30000, allowances: 8000,  deductions: 5400, netPay: 32600 },
    ]
    const { totalGross } = aggregatePayroll(lines)
    expect(totalGross).toBe(103000) // (50000+15000) + (30000+8000)
  })

  it('sums totalDeductions', () => {
    const lines = [
      { employeeId: '1', employeeName: 'A', basicSalary: 50000, allowances: 15000, deductions: 9000, netPay: 56000 },
      { employeeId: '2', employeeName: 'B', basicSalary: 30000, allowances: 8000,  deductions: 5400, netPay: 32600 },
    ]
    const { totalDeductions } = aggregatePayroll(lines)
    expect(totalDeductions).toBe(14400)
  })

  it('sums totalNet', () => {
    const lines = [
      { employeeId: '1', employeeName: 'A', basicSalary: 50000, allowances: 15000, deductions: 9000, netPay: 56000 },
      { employeeId: '2', employeeName: 'B', basicSalary: 30000, allowances: 8000,  deductions: 5400, netPay: 32600 },
    ]
    const { totalNet } = aggregatePayroll(lines)
    expect(totalNet).toBe(88600)
  })

  it('returns zeros for empty list', () => {
    const result = aggregatePayroll([])
    expect(result).toEqual({ totalGross: 0, totalDeductions: 0, totalNet: 0 })
  })
})

// ── resolveDepositStatus ──────────────────────────────────────────────────────

describe('resolveDepositStatus()', () => {
  it('returns "fully_paid" when balance is exactly 0', () => {
    expect(resolveDepositStatus(0)).toBe('fully_paid')
  })

  it('returns "fully_paid" when balance is negative (over-payment capped upstream)', () => {
    expect(resolveDepositStatus(-1)).toBe('fully_paid')
  })

  it('returns "partially_paid" when balance > 0', () => {
    expect(resolveDepositStatus(1)).toBe('partially_paid')
    expect(resolveDepositStatus(50000)).toBe('partially_paid')
  })
})

// ── capPayment ────────────────────────────────────────────────────────────────

describe('capPayment()', () => {
  it('returns the requested amount when it is less than balance', () => {
    expect(capPayment(10000, 60000)).toBe(10000)
  })

  it('caps at balance when requested amount exceeds it', () => {
    expect(capPayment(80000, 60000)).toBe(60000)
  })

  it('returns exact balance when payment equals balance', () => {
    expect(capPayment(60000, 60000)).toBe(60000)
  })

  it('returns 0 when requested amount is 0', () => {
    expect(capPayment(0, 60000)).toBe(0)
  })
})
