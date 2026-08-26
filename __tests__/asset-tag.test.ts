import { describe, expect, it } from 'vitest'
import { assetTagBarcodeValue } from '@/lib/product-label'

describe('asset tag barcode', () => {
  it('encodes the asset tag when set, otherwise the register ref', () => {
    expect(assetTagBarcodeValue({ ref: 'AST/2026/0001', assetTag: 'FUR-001' })).toBe('FUR-001')
    expect(assetTagBarcodeValue({ ref: 'AST/2026/0001' })).toBe('AST/2026/0001')
  })
})
