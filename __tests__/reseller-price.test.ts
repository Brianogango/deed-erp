import { describe, it, expect } from 'vitest'
import { resolveResellerPrice } from '@/lib/pricing/reseller-price'
import { DEFAULT_PRICING_MARGIN_POLICY } from '@/lib/pricing/margin-policy'

const policy = DEFAULT_PRICING_MARGIN_POLICY

describe('resolveResellerPrice', () => {
  it('uses a saved wholesale price as a manual override', () => {
    const resolved = resolveResellerPrice({
      cost: 5000,
      salePrice: 7000,
      wholesalePrice: 6200,
      category: 'Parts & Components',
      policy,
    })
    expect(resolved).toEqual({ price: 6200, source: 'manual' })
  })

  it('computes the min GP band from cost when wholesale is unset', () => {
    const resolved = resolveResellerPrice({
      cost: 5000,
      salePrice: 7000,
      wholesalePrice: 0,
      category: 'Parts & Components',
      policy,
    })
    expect(resolved).toEqual({ price: 6500, source: 'min_band' })
  })

  it('does not fall back to retail when wholesale and cost are missing', () => {
    expect(resolveResellerPrice({
      cost: 0,
      salePrice: 30000,
      wholesalePrice: null,
      category: 'Laptops',
      policy,
    })).toBeNull()
  })

  it('omits unmapped categories instead of using sale price', () => {
    expect(resolveResellerPrice({
      cost: 10000,
      salePrice: 14000,
      wholesalePrice: 0,
      category: 'Services',
      policy,
    })).toBeNull()
  })

  it('omits services unless a wholesale override is saved', () => {
    expect(resolveResellerPrice({
      cost: 1000,
      salePrice: 2500,
      productKind: 'service',
      policy,
    })).toBeNull()
    expect(resolveResellerPrice({
      cost: 1000,
      salePrice: 2500,
      wholesalePrice: 1800,
      productKind: 'service',
      policy,
    })).toEqual({ price: 1800, source: 'manual' })
  })

  it('clamps a computed min band so it never exceeds retail', () => {
    const resolved = resolveResellerPrice({
      cost: 5000,
      salePrice: 6000,
      wholesalePrice: 0,
      category: 'Parts & Components',
      policy,
    })
    expect(resolved).toEqual({ price: 6000, source: 'min_band' })
  })

  it('does not clamp a manual wholesale above retail', () => {
    const resolved = resolveResellerPrice({
      cost: 5000,
      salePrice: 7000,
      wholesalePrice: 8000,
      category: 'Parts & Components',
      policy,
    })
    expect(resolved).toEqual({ price: 8000, source: 'manual' })
  })
})
