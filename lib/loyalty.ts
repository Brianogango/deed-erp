/** Loyalty earn rate: 1 point per this many KES spent (after discounts / redemption). */
export const LOYALTY_KES_PER_POINT = 2000

export function loyaltyPointsEarned(amountKes: number): number {
  return Math.floor(Math.max(0, Number(amountKes) || 0) / LOYALTY_KES_PER_POINT)
}
