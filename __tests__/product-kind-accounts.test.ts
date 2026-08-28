import { describe, expect, it } from 'vitest'
import {
  defaultTrackingForKind,
  defaultUnitForKind,
  inferProductKind,
  kindRequiresInventoryAccounts,
} from '@/lib/product-kind'
import {
  aggregateLinesByAccount,
  applyCategoryAccountDefaults,
  COMPANY_ACCOUNT_FALLBACKS,
  resolveProductAccounts,
} from '@/lib/product-accounts'

describe('product kind', () => {
  it('infers storable / consumable / service from category and tracking', () => {
    expect(inferProductKind({ category: 'Laptops', trackingMethod: 'SERIAL' })).toBe('storable')
    expect(inferProductKind({ category: 'Accessories', trackingMethod: 'QUANTITY' })).toBe('consumable')
    expect(inferProductKind({ category: 'Services', trackingMethod: 'NONE' })).toBe('service')
    expect(inferProductKind({ productKind: 'consumable', category: 'Laptops' })).toBe('consumable')
  })

  it('defaults tracking and UoM from kind', () => {
    expect(defaultTrackingForKind('service')).toBe('NONE')
    expect(defaultTrackingForKind('consumable')).toBe('QUANTITY')
    expect(defaultUnitForKind('service')).toBe('service')
    expect(defaultUnitForKind('storable', 'SERIAL')).toBe('pcs')
    expect(kindRequiresInventoryAccounts('storable')).toBe(true)
    expect(kindRequiresInventoryAccounts('service')).toBe(false)
  })
})

describe('product account resolution', () => {
  it('applies category defaults then company fallbacks', () => {
    const resolved = resolveProductAccounts({ category: 'Laptops', name: 'HP' })
    expect(resolved.productKind).toBe('storable')
    expect(resolved.saleAccountCode).toBe('5001')
    expect(resolved.inventoryAccountCode).toBe('1200')
    expect(resolved.cogsAccountCode).toBe('6001')
  })

  it('lets product overrides win over category defaults', () => {
    const resolved = resolveProductAccounts({
      category: 'Services',
      productKind: 'service',
      saleAccountCode: '5099',
    })
    expect(resolved.saleAccountCode).toBe('5099')
    expect(resolved.costAccountCode).toBe('6102')
  })

  it('prefills empty form fields from category', () => {
    const filled = applyCategoryAccountDefaults('Services', {})
    expect(filled.productKind).toBe('service')
    expect(filled.saleAccountCode).toBe('5003')
    expect(filled.inventoryAccountCode || '').toBe('')
  })

  it('aggregates invoice lines by resolved revenue account', () => {
    const buckets = aggregateLinesByAccount({
      lines: [
        { productId: 'a', subtotal: 1000, accountCode: '5001' },
        { productId: 'b', subtotal: 500 },
        { productId: 'c', subtotal: 200, accountCode: '5001' },
      ],
      resolveProduct: (id) => id === 'b'
        ? { category: 'Services', productKind: 'service' }
        : { category: 'Laptops', productKind: 'storable' },
      side: 'revenue',
      accounts: [
        { code: '5001', name: 'Hardware Sales' },
        { code: '5003', name: 'Service Revenue' },
      ],
    })
    expect(buckets).toEqual(expect.arrayContaining([
      { account: '5001 - Hardware Sales', amount: 1200 },
      { account: '5003 - Service Revenue', amount: 500 },
    ]))
    expect(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode).toBe('5000')
    expect(COMPANY_ACCOUNT_FALLBACKS.adjustmentAccountCode).toBe('6200')
    expect(COMPANY_ACCOUNT_FALLBACKS.writeOffAccountCode).toBe('6205')
    expect(COMPANY_ACCOUNT_FALLBACKS.priceDifferenceAccountCode).toBe('6210')
  })
})
