import { describe, expect, it } from 'vitest'
import { buildInventoryBarcode, inferTrackingMethod, productOffersOnHandSerials } from '@/lib/inventory-identifiers'

describe('inferTrackingMethod', () => {
  it('prefers explicit tracking method when provided', () => {
    expect(inferTrackingMethod({ trackingMethod: 'BATCH', category: 'Laptops' })).toBe('BATCH')
  })

  it('derives SERIAL from legacy requiresSerial flag', () => {
    expect(inferTrackingMethod({ requiresSerial: true })).toBe('SERIAL')
  })

  it('derives NONE for service unit', () => {
    expect(inferTrackingMethod({ unit: 'service' })).toBe('NONE')
  })

  it('derives default from category map', () => {
    expect(inferTrackingMethod({ category: 'Accessories' })).toBe('QUANTITY')
    expect(inferTrackingMethod({ category: 'Networking' })).toBe('SERIAL')
    expect(inferTrackingMethod({ category: 'Mobile Devices' })).toBe('SERIAL')
  })
})

describe('productOffersOnHandSerials', () => {
  it('offers Serials for Laptops even when wrongly saved as QUANTITY', () => {
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

  it('offers Serials when the SKU already has serial records', () => {
    expect(productOffersOnHandSerials({
      trackingMethod: 'QUANTITY',
      category: 'Parts & Components',
    }, { hasExistingSerials: true })).toBe(true)
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

  it('falls back to SKU seed when serial is missing', () => {
    expect(buildInventoryBarcode({ existingBarcodes: [], productSku: 'HP-ELITEBOOK-840' })).toBe('INV-HPELITEBOOK8-0001')
  })
})
