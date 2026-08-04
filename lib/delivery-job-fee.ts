/**
 * Rider fee helpers for delivery jobs.
 * Fee is always per-job and variable — rider.ratePerDelivery is only a suggestion.
 */

/** Resolve the fee to store when assigning a rider. */
export function resolveAssignedRiderFee(opts: {
  /** Fee already on the job (from create / prior edit). */
  existingFee?: number | null
  /** Explicit fee from the assign/create form. */
  overrideFee?: number | null
  /** Rider's optional default rate (suggestion only). */
  riderDefaultRate?: number | null
}): number {
  if (opts.overrideFee !== undefined && opts.overrideFee !== null && Number.isFinite(Number(opts.overrideFee))) {
    return Math.max(0, Number(opts.overrideFee))
  }
  const existing = Number(opts.existingFee)
  if (Number.isFinite(existing) && existing > 0) return existing
  const rate = Number(opts.riderDefaultRate)
  if (Number.isFinite(rate) && rate > 0) return rate
  return Number.isFinite(existing) ? Math.max(0, existing) : 0
}

/**
 * When selecting a rider in a form, only prefill the fee field if it is still empty
 * and the rider has a positive default rate. Never wipe a user-entered amount.
 */
export function suggestRiderFeePrefill(
  currentFeeInput: string,
  riderDefaultRate?: number | null,
): string {
  if (currentFeeInput.trim() !== '') return currentFeeInput
  const rate = Number(riderDefaultRate)
  if (Number.isFinite(rate) && rate > 0) return String(rate)
  return currentFeeInput
}

/** Parse a fee input string; returns null when empty/invalid. */
export function parseRiderFeeInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}
