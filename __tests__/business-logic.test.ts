/**
 * Tests for lib/business-logic.ts
 *
 * These are pure-function tests — no mocking, no React, no DB.
 * They verify the core inventory, payroll, and deposit calculation logic
 * that underpins the ERP's financial correctness.
 */

import { describe, it, expect } from 'vitest'
import { calcStockByLocation, availableSellableQty, isListedInPartnerCatalog, upsertBulkStock, aggregatePayroll, onHandQtyAtStockLocations, isLowStockSku, type StockProduct, type SerialNumber, type BulkStockLevel } from '@/lib/business-logic'

// ── calcStockByLocation ───────────────────────────────────────────────────────

describe('calcStockByLocation()', () => {
  const bulkProduct: StockProduct = { requiresSerial: false }
  const serialProduct: StockProduct = { requiresSerial: true }

  describe('bulk (non-serial) products', () => {
    it('returns zeros for all locations when no bulk stock exists', () => {
      const result = calcStockByLocation(bulkProduct, [], [], 'prod-1')
      expect(result).toEqual({
        warehouse: 0, shop: 0, repair_unit: 0,
        computer_aid: 0, computer_aid_collected: 0, computer_aid_issues: 0,
        vendor: 0, customer: 0, employee: 0, pending_testing: 0, quarantine: 0,
      })
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
      expect(result).toEqual({
        warehouse: 0, shop: 0, repair_unit: 0,
        computer_aid: 0, computer_aid_collected: 0, computer_aid_issues: 0,
        vendor: 0, customer: 0, employee: 0, pending_testing: 0, quarantine: 0,
      })
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
      expect(result).toEqual({
        warehouse: 0, shop: 0, repair_unit: 0,
        computer_aid: 0, computer_aid_collected: 0, computer_aid_issues: 0,
        vendor: 0, customer: 0, employee: 0, pending_testing: 0, quarantine: 0,
      })
    })
  })
})

describe('onHandQtyAtStockLocations() / isLowStockSku()', () => {
  const bulkSku: StockProduct = {
    id: 'prod-1',
    isActive: true,
    minStock: 5,
    requiresSerial: false,
    unit: 'pcs',
  }

  it('sums warehouse + shop + repair_unit only', () => {
    const bulk: BulkStockLevel[] = [
      { productId: 'prod-1', location: 'warehouse', qty: 2 },
      { productId: 'prod-1', location: 'shop', qty: 1 },
      { productId: 'prod-1', location: 'repair_unit', qty: 1 },
      { productId: 'prod-1', location: 'computer_aid', qty: 7 },
      { productId: 'prod-1', location: 'customer', qty: 9 },
    ]
    expect(onHandQtyAtStockLocations(bulkSku, [], bulk, 'prod-1')).toBe(4)
  })

  it('flags an active stock-tracked SKU at or below min', () => {
    expect(isLowStockSku(bulkSku, 5)).toBe(true)
    expect(isLowStockSku(bulkSku, 4)).toBe(true)
    expect(isLowStockSku(bulkSku, 6)).toBe(false)
  })

  it('ignores inactive, service, and minStock 0 SKUs', () => {
    expect(isLowStockSku({ ...bulkSku, isActive: false }, 0)).toBe(false)
    expect(isLowStockSku({ ...bulkSku, unit: 'service' }, 0)).toBe(false)
    expect(isLowStockSku({ ...bulkSku, minStock: 0 }, 0)).toBe(false)
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
      { productId: 'prod-1', location: 'computer_aid', qty: 6 },
      { productId: 'prod-1', location: 'quarantine', qty: 8 },
    ]
    expect(availableSellableQty(
      { category: 'Accessories', requiresSerial: false },
      [],
      bulk,
      'prod-1',
    )).toBe(3)
  })

  it('does not treat Computer Aid custody serials as saleable warehouse stock', () => {
    const serials: SerialNumber[] = [
      { productId: 'prod-1', location: 'warehouse', status: 'available' },
      { productId: 'prod-1', location: 'computer_aid', status: 'available' },
      { productId: 'prod-1', location: 'computer_aid_collected', status: 'available' },
      { productId: 'prod-1', location: 'computer_aid_issues', status: 'available' },
    ]
    expect(availableSellableQty(
      { category: 'Laptops', requiresSerial: true },
      serials,
      [],
      'prod-1',
    )).toBe(1)
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


describe('isListedInPartnerCatalog()', () => {
  const laptop = { category: 'Laptops', requiresSerial: true, isActive: true, canBeSold: true }

  it('lists zero-stock and With Issues-only SKUs', () => {
    expect(isListedInPartnerCatalog(laptop)).toBe(true)
    expect(isListedInPartnerCatalog({ ...laptop, unit: 'pcs' })).toBe(true)
  })

  it('hides archived and not-for-sale SKUs', () => {
    expect(isListedInPartnerCatalog({ ...laptop, isActive: false })).toBe(false)
    expect(isListedInPartnerCatalog({ ...laptop, canBeSold: false })).toBe(false)
    expect(isListedInPartnerCatalog(undefined)).toBe(false)
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


// ── capPayment ────────────────────────────────────────────────────────────────

