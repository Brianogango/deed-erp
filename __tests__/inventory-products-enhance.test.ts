import { describe, expect, it } from 'vitest'
import {
  EMPTY_PRODUCT_FILTERS,
  activeFilterChips,
  collectVendorProductIds,
  getProductQtySnapshot,
  productMatchesFilters,
  productMatchesSearch,
} from '@/lib/inventory/product-filters'
import { validateSerialEdit } from '@/lib/inventory/serial-edit'
import {
  canArchiveProduct,
  canEditSerialNumber,
  canValidatePurchaseReceipt,
  canViewPurchaseCost,
} from '@/lib/inventory/permissions'

describe('product filters', () => {
  const product = {
    id: 'p1',
    name: 'HP EliteBook',
    sku: 'HP-840',
    barcode: '123',
    category: 'Laptops',
    unit: 'unit',
    requiresSerial: true,
    trackingMethod: 'SERIAL',
    minStock: 2,
    stockQty: 5,
    isActive: true,
  }

  const serials = [
    { productId: 'p1', location: 'warehouse' as const, status: 'available', serial: 'SN-1', barcode: 'INV-1' },
    { productId: 'p1', location: 'shop' as const, status: 'assigned', serial: 'SN-2', barcode: 'INV-2' },
    { productId: 'p1', location: 'warehouse' as const, status: 'sold', serial: 'SN-3', barcode: 'INV-3' },
    { productId: 'p1', location: 'repair_unit' as const, status: 'refurbishment', serial: 'SN-4', barcode: 'INV-4' },
    { productId: 'p1', location: 'repair_unit' as const, status: 'under_repair', serial: 'SN-5', barcode: 'INV-5' },
  ]

  it('scopes on-hand to selected warehouse', () => {
    const all = getProductQtySnapshot(product, serials, [], 'all')
    const wh = getProductQtySnapshot(product, serials, [], 'warehouse')
    expect(all.onHand).toBe(4) // available + assigned + refurb + under_repair (not sold)
    expect(all.available).toBe(1)
    expect(all.reserved).toBe(1)
    expect(all.refurbishment).toBe(1)
    expect(all.underRepair).toBe(1)
    expect(all.held).toBe(3)
    expect(wh.onHand).toBe(1)
    expect(wh.available).toBe(1)
    expect(wh.reserved).toBe(0)
    expect(wh.held).toBe(0)
  })

  it('treats held filter as any non-free on-hand serials', () => {
    const qty = getProductQtySnapshot(product, serials, [], 'all')
    expect(productMatchesFilters({
      product,
      filters: { ...EMPTY_PRODUCT_FILTERS, stockAvailability: 'reserved' },
      qty,
      serials,
    })).toBe(true)
  })

  it('matches search by serial', () => {
    expect(productMatchesSearch(product, 'sn-1', serials)).toBe(true)
    expect(productMatchesSearch(product, 'missing', serials)).toBe(false)
  })

  it('filters by tracking and low stock', () => {
    const qty = getProductQtySnapshot(product, serials, [], 'all')
    expect(productMatchesFilters({
      product,
      filters: { ...EMPTY_PRODUCT_FILTERS, tracking: 'SERIAL' },
      qty,
      serials,
    })).toBe(true)

    expect(productMatchesFilters({
      product,
      filters: { ...EMPTY_PRODUCT_FILTERS, stockAvailability: 'low_stock' },
      qty,
      serials,
    })).toBe(false)

    const lowQty = { ...qty, onHand: 1 }
    expect(productMatchesFilters({
      product,
      filters: { ...EMPTY_PRODUCT_FILTERS, reorder: 'below_level' },
      qty: lowQty,
      serials,
    })).toBe(true)
  })

  it('filters by actual supplying vendor via receipt', () => {
    const ids = collectVendorProductIds({
      vendorId: 'v1',
      serials: [{ productId: 'p1', receiptId: 'r1' }],
      receipts: [{
        id: 'r1',
        vendorId: 'v1',
        status: 'validated',
        lines: [{ productId: 'p1' }],
      }],
      purchaseOrders: [],
    })
    expect(ids.has('p1')).toBe(true)

    const chips = activeFilterChips({
      ...EMPTY_PRODUCT_FILTERS,
      warehouse: 'warehouse',
      vendorId: 'v1',
      tracking: 'SERIAL',
    }, 'Tech Supplies')
    expect(chips.map(c => c.key)).toEqual(['warehouse', 'vendor', 'tracking'])
  })

  it('hides archived products unless Status is Archived or All', () => {
    const archived = { ...product, isActive: false }
    const qty = getProductQtySnapshot(archived, serials, [], 'all')
    expect(productMatchesFilters({
      product: archived,
      filters: EMPTY_PRODUCT_FILTERS,
      qty,
      serials,
    })).toBe(false)
    expect(productMatchesFilters({
      product: archived,
      filters: { ...EMPTY_PRODUCT_FILTERS, status: 'archived' },
      qty,
      serials,
    })).toBe(true)
    expect(productMatchesFilters({
      product,
      filters: { ...EMPTY_PRODUCT_FILTERS, status: 'archived' },
      qty: getProductQtySnapshot(product, serials, [], 'all'),
      serials,
    })).toBe(false)
    expect(productMatchesFilters({
      product: archived,
      filters: { ...EMPTY_PRODUCT_FILTERS, status: 'all' },
      qty,
      serials,
    })).toBe(true)

    const chips = activeFilterChips({ ...EMPTY_PRODUCT_FILTERS, status: 'archived' })
    expect(chips.map(c => c.key)).toContain('status')
    expect(chips.find(c => c.key === 'status')?.valueLabel).toBe('Archived')
  })
})

describe('serial edit validation', () => {
  const current = {
    id: 's1',
    serial: 'ABC-1',
    barcode: 'INV-1',
    status: 'available',
  }

  it('requires reason for serial corrections', () => {
    const result = validateSerialEdit({
      current,
      next: { serial: 'ABC-2', barcode: 'INV-1' },
      existing: [current],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects duplicates and sold serial renames', () => {
    expect(validateSerialEdit({
      current,
      next: { serial: 'DUP' },
      existing: [current, { id: 's2', serial: 'DUP' }],
      reason: 'fix',
    }).ok).toBe(false)

    expect(validateSerialEdit({
      current: { ...current, status: 'sold', soldDate: '2026-01-01' },
      next: { serial: 'NEW' },
      existing: [current],
      reason: 'fix',
    }).ok).toBe(false)
  })

  it('accepts valid corrections with reason', () => {
    const result = validateSerialEdit({
      current,
      next: { serial: 'ABC-9', barcode: 'INV-9', specs: '16GB' },
      existing: [current],
      reason: 'Typo on receipt',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.patch.serial).toBe('ABC-9')
  })
})

describe('inventory permissions', () => {
  it('gates receipt validation and serial edits', () => {
    expect(canValidatePurchaseReceipt('director')).toBe(true)
    expect(canValidatePurchaseReceipt('admin_officer')).toBe(true)
    expect(canValidatePurchaseReceipt('inventory_officer')).toBe(true)
    expect(canValidatePurchaseReceipt('technical_lead')).toBe(false)
    expect(canValidatePurchaseReceipt('sales_rep')).toBe(false)
    expect(canEditSerialNumber('inventory_officer')).toBe(true)
    expect(canEditSerialNumber('technician')).toBe(false)
    expect(canViewPurchaseCost('finance_officer')).toBe(true)
  })

  it('gates product archive / restore', () => {
    expect(canArchiveProduct('director')).toBe(true)
    expect(canArchiveProduct('inventory_officer')).toBe(true)
    expect(canArchiveProduct('technical_lead')).toBe(true)
    expect(canArchiveProduct('sales_rep')).toBe(false)
    expect(canArchiveProduct('technician')).toBe(false)
  })
})
