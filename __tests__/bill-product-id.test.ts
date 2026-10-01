import { describe, it, expect } from 'vitest'
import { resolveBillProductId } from '@/lib/purchase/bill-product-id'

const catalogue = [
  { id: 'good-id', name: 'Dahua Digital Video Recorder - DH-XVR5108HS-5M-I3/T' },
  { id: 'a', name: 'Cable' },
  { id: 'b', name: 'cable' },
]

describe('resolveBillProductId', () => {
  it('keeps the line\'s own id when the catalogue has it', () => {
    expect(resolveBillProductId({ productId: 'good-id', productName: 'x' }, catalogue)).toBe('good-id')
  })
  it('falls back to the one product with the same name when the id is stale', () => {
    expect(resolveBillProductId(
      { productId: 'stale-id', productName: 'Dahua Digital Video Recorder - DH-XVR5108HS-5M-I3/T' }, catalogue,
    )).toBe('good-id')
  })
  it('leaves the id off when the name is ambiguous or unknown', () => {
    expect(resolveBillProductId({ productId: 'stale-id', productName: 'Cable' }, catalogue)).toBeUndefined()
    expect(resolveBillProductId({ productId: 'stale-id', productName: 'Nothing' }, catalogue)).toBeUndefined()
    expect(resolveBillProductId({ productId: '', productName: '' }, catalogue)).toBeUndefined()
  })
})
