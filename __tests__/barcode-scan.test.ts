import { describe, expect, it } from 'vitest'
import {
  buildSerialLabelScanPayload,
  codesEqual,
  identityMatchesScan,
  matchPosScan,
  parseScanPayload,
  resolveOrcConfirmedSerial,
} from '@/lib/barcode-scan'

describe('parseScanPayload', () => {
  it('parses plain inventory barcodes', () => {
    const parsed = parseScanPayload(' INV-ABC123-0001 ')
    expect(parsed.candidates).toContain('INV-ABC123-0001')
    expect(parsed.barcode).toBeUndefined()
  })

  it('parses legacy SKU|SERIAL QR payloads', () => {
    const parsed = parseScanPayload('SKU:HP-450|SERIAL:SN9988')
    expect(parsed.sku).toBe('HP-450')
    expect(parsed.serial).toBe('SN9988')
    expect(parsed.candidates[0]).toBe('SN9988')
    expect(parsed.candidates).toContain('HP-450')
  })

  it('parses extended BARCODE field', () => {
    const parsed = parseScanPayload('SKU:X|SERIAL:S1|BARCODE:INV-1')
    expect(parsed.candidates[0]).toBe('INV-1')
    expect(parsed.serial).toBe('S1')
  })
})

describe('codesEqual / identityMatchesScan', () => {
  it('matches case-insensitively', () => {
    expect(codesEqual('abc', 'ABC')).toBe(true)
    expect(identityMatchesScan(
      { barcode: 'inv-1', serial: 'sn-9', sku: 'sku-1' },
      'SN-9',
    )).toBe(true)
  })
})

describe('matchPosScan', () => {
  const serials = [
    { id: 's1', productId: 'p1', barcode: 'INV-1', serial: 'MFG-1', sku: 'LAP-1', status: 'available', location: 'shop' },
    { id: 's2', productId: 'p1', barcode: 'INV-2', serial: 'MFG-2', sku: 'LAP-1', status: 'sold', location: 'shop' },
  ]
  const products = [
    { id: 'p1', name: 'Laptop', sku: 'LAP-1', barcode: 'PROD-LAP', requiresSerial: true },
    { id: 'p2', name: 'Mouse', sku: 'MOU-1', barcode: 'PROD-MOU', requiresSerial: false },
  ]
  const getSellableQty = (productId: string, requiresSerial: boolean) => {
    if (requiresSerial) return serials.filter(s => s.productId === productId && s.status === 'available').length
    return productId === 'p2' ? 5 : 0
  }

  it('matches unit by inventory barcode', () => {
    const result = matchPosScan({ code: 'inv-1', serials, products, getSellableQty })
    expect(result).toEqual({ kind: 'serial', serial: serials[0] })
  })

  it('matches unit from legacy QR payload', () => {
    const result = matchPosScan({ code: 'SKU:LAP-1|SERIAL:MFG-1', serials, products, getSellableQty })
    expect(result.kind).toBe('serial')
  })

  it('asks for unit scan when product barcode is serialized', () => {
    const result = matchPosScan({ code: 'PROD-LAP', serials, products, getSellableQty })
    expect(result).toMatchObject({ kind: 'product', needsUnitScan: true })
  })

  it('adds non-serial product by barcode', () => {
    const result = matchPosScan({ code: 'prod-mou', serials, products, getSellableQty })
    expect(result).toMatchObject({ kind: 'product', needsUnitScan: false })
  })

  it('returns not_found for unknown codes', () => {
    expect(matchPosScan({ code: 'NOPE', serials, products, getSellableQty }).kind).toBe('not_found')
  })
})

describe('resolveOrcConfirmedSerial', () => {
  it('accepts inventory barcode for the expected unit', () => {
    const result = resolveOrcConfirmedSerial({
      scanned: 'INV-9',
      expectedSerial: 'MFG-9',
      serials: [{ serial: 'MFG-9', barcode: 'INV-9' }],
    })
    expect(result).toEqual({ confirmed: 'MFG-9', matched: true })
  })

  it('accepts legacy QR', () => {
    const result = resolveOrcConfirmedSerial({
      scanned: 'SKU:X|SERIAL:MFG-9',
      expectedSerial: 'MFG-9',
    })
    expect(result.matched).toBe(true)
  })
})

describe('buildSerialLabelScanPayload', () => {
  it('prefers inventory barcode over manufacturer serial', () => {
    expect(buildSerialLabelScanPayload({ serial: 'MFG', barcode: 'INV-1' })).toBe('INV-1')
    expect(buildSerialLabelScanPayload({ serial: 'MFG', barcode: '' })).toBe('MFG')
  })
})
