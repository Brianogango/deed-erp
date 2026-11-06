/**
 * The customer paid the rider the delivery charge directly, and paid the
 * rest of the invoice to the company. The rider has already been paid that
 * much, so:
 *  - the invoice's delivery charge is settled by a "paid to rider" payment:
 *    Dr rider-fee expense / Cr receivable (no cash reaches us), and
 *  - the rider's weekly pay counts that trip at its fee less what the
 *    customer paid them.
 * Together the rider-fee expense is still the full fee, the receivable is
 * cleared, and we pay the rider only the difference. Pure helpers.
 */

export const PAID_TO_RIDER = 'paid_to_rider'

/** Expense accounts for rider fees, first one that exists wins. */
export const RIDER_FEE_ACCOUNTS: Array<{ code: string; name: string }> = [
  { code: '6519', name: 'Courier and Delivery' },
  { code: '6401', name: 'Selling and Delivery' },
]

export function riderFeeAccount(existingCodes: Iterable<string>): { code: string; name: string; label: string } {
  const have = new Set([...existingCodes].map(c => String(c).trim()))
  const pick = RIDER_FEE_ACCOUNTS.find(a => have.has(a.code)) ?? RIDER_FEE_ACCOUNTS[0]
  return { ...pick, label: `${pick.code} - ${pick.name}` }
}

type JobLike = { riderFee?: number; customerPaidRider?: { amount: number } | null }

/** What we still owe the rider for a trip (negative: the rider holds ours). */
export const riderPayForJob = (job: JobLike) =>
  Math.round(((Number(job.riderFee) || 0) - (Number(job.customerPaidRider?.amount) || 0)) * 100) / 100

export const paidDirectToRider = (job: JobLike) => Number(job.customerPaidRider?.amount) || 0
