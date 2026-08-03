import { describe, expect, it } from 'vitest'
import {
  buildInventoryBarcode,
  coerceTrackingForCategory,
  inferTrackingMethod,
  isSerialOnlyCategory,
  productOffersOnHandSerials,
  rewriteInventoryTags,
} from '@/lib/inventory-identifiers'

describe('inferTrackingMethod', () => {
  it('forces SERIAL for Laptops even when QUANTITY was saved', () => {
    expect(inferTrackingMethod({ trackingMethod: 'QUANTITY', category: 'Laptops' })).toBe('SERIAL')
    expect(inferTrackingMethod({ trackingMethod: 'BATCH', category: 'Desktops' })).toBe('SERIAL')
  })

  it('derives SERIAL from legacy requiresSerial flag', () => {
    expect(inferTrackingMethod({ requiresSerial: true })).toBe('SERIAL')
  })

  it('derives NONE for service unit', () => {
    expect(inferTrackingMethod({ unit: 'service' })).toBe('NONE')
  })

  it('keeps QUANTITY for parts and accessories', () => {
    expect(inferTrackingMethod({ trackingMethod: 'QUANTITY', category: 'Accessories' })).toBe('QUANTITY')
    expect(inferTrackingMethod({ category: 'Parts & Components' })).toBe('QUANTITY')
  })
})

describe('serial-only categories', () => {
  it('recognizes machine categories', () => {
    expect(isSerialOnlyCategory('Laptops')).toBe(true)
    expect(isSerialOnlyCategory('Mobile Devices')).toBe(true)
    expect(isSerialOnlyCategory('Parts & Components')).toBe(false)
  })

  it('coerces tracking to SERIAL for machines', () => {
    expect(coerceTrackingForCategory('Laptops', 'QUANTITY')).toBe('SERIAL')
    expect(coerceTrackingForCategory('Accessories', 'QUANTITY')).toBe('QUANTITY')
  })
})

describe('productOffersOnHandSerials', () => {
  it('offers Serials for Laptops', () => {
    expect(productOffersOnHandSerials({
      trackingMethod: 'QUANTITY',
      category: 'Laptops',
      requiresSerial: false,
    })).toBe(true)
  })

  it('hides Serials for bulk parts', () => {
    expect(productOffersOnHandSerials({
      trackingMethod: 'QUANTITY',
      category: 'Parts & Components',
    })).toBe(false)
  })
})

describe('buildInventoryBarcode', () => {
  it('uses the manufacturer serial as the tag (no INV- prefix)', () => {
    expect(buildInventoryBarcode({ existingBarcodes: [], manufacturerSerial: 'SN-001-A' })).toBe('SN-001-A')
    expect(buildInventoryBarcode({
      existingBarcodes: [],
      manufacturerSerial: '5CG023BRN8',
    })).toBe('5CG023BRN8')
  })

  it('falls back to SKU when serial is missing', () => {
    expect(buildInventoryBarcode({
      existingBarcodes: [],
      productSku: 'LAP-X1',
    })).toBe('LAP-X1')
  })

  it('appends a suffix on collisions', () => {
    expect(buildInventoryBarcode({
      existingBarcodes: ['5CG023BRN8'],
      manufacturerSerial: '5CG023BRN8',
    })).toBe('5CG023BRN8-2')
  })
})

describe('rewriteInventoryTags', () => {
  it('rewrites INV-* legacy tags to the manufacturer serial', () => {
    const { rows, rewritten } = rewriteInventoryTags([
      { serial: '5CG023BRN8', barcode: 'INV-5CG023BRN8-0001' },
      { serial: '5CG023BT9T', barcode: 'INV-5CG023BT9T-0001' },
      { serial: 'KEEP', barcode: 'KEEP' },
    ])
    expect(rewritten).toBe(2)
    expect(rows[0].barcode).toBe('5CG023BRN8')
    expect(rows[1].barcode).toBe('5CG023BT9T')
    expect(rows[2].barcode).toBe('KEEP')
  })

  it('leaves barcode that already equals the serial unchanged', () => {
    const { rows, rewritten } = rewriteInventoryTags([
      { serial: 'ABC123', barcode: 'ABC123' },
    ])
    expect(rewritten).toBe(0)
    expect(rows[0].barcode).toBe('ABC123')
  })

  it('rewrites sequential INV-###### tags to serial', () => {
    const { rows, rewritten } = rewriteInventoryTags([
      { serial: 'SN9', barcode: 'INV-000001' },
    ])
    expect(rewritten).toBe(1)
    expect(rows[0].barcode).toBe('SN9')
  })
})
