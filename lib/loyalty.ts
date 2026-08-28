/** POS loyalty: 1 point per `kesPerPoint` KES spent; 1 point = 1 KES on redemption. */
export const LOYALTY_KES_PER_POINT = 2000

export function loyaltyPointsEarned(amountKes: number, kesPerPoint: number = LOYALTY_KES_PER_POINT): number {
  const rate = Math.max(1, Number(kesPerPoint) || LOYALTY_KES_PER_POINT)
  return Math.floor(Math.max(0, Number(amountKes) || 0) / rate)
}
