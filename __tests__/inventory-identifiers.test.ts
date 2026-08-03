import { describe, expect, it } from 'vitest'
import {
  buildInventoryBarcode,
  coerceTrackingForCategory,
  inferTrackingMethod,
  isSerialOnlyCategory,
  productOffersOnHandSerials,
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
  it('builds deterministic INV barcode from serial seed', () => {
    expect(buildInventoryBarcode({ existingBarcodes: [], manufacturerSerial: 'SN-001-A' })).toBe('INV-SN001A-0001')
  })

  it('increments counter when barcode already exists', () => {
    const next = buildInventoryBarcode({
      existingBarcodes: ['INV-SN001A-0001', 'INV-SN001A-0002'],
      manufacturerSerial: 'SN-001-A',
    })
    expect(next).toBe('INV-SN001A-0003')
  })
})
