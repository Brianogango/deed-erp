import { describe, it, expect } from 'vitest'

/** Mirrors helpers in components/modules/POS.tsx */
function roundMoney(n: number) {
  return Math.max(0, Math.round((Number(n) || 0) * 100) / 100)
}
function priceFromDiscount(listPrice: number, discountPct: number) {
  const pct = Math.min(100, Math.max(0, Number(discountPct) || 0))
  return roundMoney(listPrice * (1 - pct / 100))
}
function discountFromPrice(listPrice: number, price: number) {
  if (!listPrice || listPrice <= 0) return 0
  const pct = (1 - roundMoney(price) / listPrice) * 100
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10))
}

describe('POS line price / discount sync', () => {
  it('applies discount % onto list price', () => {
    expect(priceFromDiscount(10000, 10)).toBe(9000)
    expect(priceFromDiscount(10000, 0)).toBe(10000)
    expect(priceFromDiscount(10000, 100)).toBe(0)
  })

  it('derives discount % from a custom unit price', () => {
    expect(discountFromPrice(10000, 9000)).toBe(10)
    expect(discountFromPrice(10000, 10000)).toBe(0)
    expect(discountFromPrice(10000, 7500)).toBe(25)
  })

  it('round-trips price ↔ discount without drift for whole KES', () => {
    const list = 15500
    const pct = 12
    const price = priceFromDiscount(list, pct)
    expect(discountFromPrice(list, price)).toBe(pct)
  })
})
