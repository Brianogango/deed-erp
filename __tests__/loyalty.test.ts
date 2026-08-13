import { describe, expect, it } from 'vitest'
import { LOYALTY_KES_PER_POINT, loyaltyPointsEarned } from '@/lib/loyalty'

describe('loyaltyPointsEarned', () => {
  it('is 1 point per 2000 KES', () => {
    expect(LOYALTY_KES_PER_POINT).toBe(2000)
    expect(loyaltyPointsEarned(0)).toBe(0)
    expect(loyaltyPointsEarned(1999)).toBe(0)
    expect(loyaltyPointsEarned(2000)).toBe(1)
    expect(loyaltyPointsEarned(8000)).toBe(4)
    expect(loyaltyPointsEarned(4500)).toBe(2)
  })
})
