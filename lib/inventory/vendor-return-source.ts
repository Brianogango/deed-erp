/**
 * Where goods going back to the supplier are taken from.
 *
 * Returns used to come out of Ready for Sale (warehouse) only, so a faulty
 * accessory sitting in With Issues or Quarantine had to be made sellable
 * first just to send it back. The reason for the return decides the order:
 * damaged goods come out of the faulty stages first; excess or wrong supply
 * out of the good stock first. A line may be split across stages.
 *
 * Refurbishment is left out on purpose: stock there is being worked on.
 */

type ReturnReason = 'damaged' | 'wrong_supply' | 'excess' | 'other' | string

const VENDOR_RETURN_LOCATIONS = ['quarantine', 'shop', 'pending_testing', 'warehouse'] as const
type VendorReturnLocation = (typeof VENDOR_RETURN_LOCATIONS)[number]

export function vendorReturnPickOrder(reason: ReturnReason | undefined): VendorReturnLocation[] {
  if (reason === 'excess' || reason === 'wrong_supply') {
    return ['warehouse', 'pending_testing', 'shop', 'quarantine']
  }
  // damaged, other, or unknown: the faulty stages first, sellable stock last.
  return ['quarantine', 'shop', 'pending_testing', 'warehouse']
}

export function pickVendorReturnSources(
  onHandByLocation: Partial<Record<string, number>>,
  qty: number,
  reason: ReturnReason | undefined,
): { ok: true; picks: Array<{ location: VendorReturnLocation; qty: number }> } | { ok: false; available: number } {
  let remaining = Math.max(0, Math.floor(qty))
  const picks: Array<{ location: VendorReturnLocation; qty: number }> = []
  for (const location of vendorReturnPickOrder(reason)) {
    if (remaining <= 0) break
    const here = Math.max(0, Math.floor(Number(onHandByLocation[location] ?? 0)))
    const take = Math.min(here, remaining)
    if (take > 0) {
      picks.push({ location, qty: take })
      remaining -= take
    }
  }
  if (remaining > 0) {
    const available = VENDOR_RETURN_LOCATIONS.reduce((s, l) => s + Math.max(0, Number(onHandByLocation[l] ?? 0)), 0)
    return { ok: false, available }
  }
  return { ok: true, picks }
}
