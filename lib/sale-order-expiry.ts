/** Reject confirming an expired quotation (validUntil before today). */
export function assertQuoteNotExpired(
  validUntil: Date | string | null | undefined,
  opts?: { skip?: boolean },
): { ok: true } | { ok: false; status: 409; error: string } {
  if (opts?.skip) return { ok: true }
  if (!validUntil) return { ok: true }
  const until = new Date(validUntil)
  if (Number.isNaN(until.getTime())) return { ok: true }
  until.setHours(23, 59, 59, 999)
  if (until.getTime() < Date.now()) {
    return {
      ok: false,
      status: 409,
      error: 'This quotation has expired. Extend Valid until before confirming.',
    }
  }
  return { ok: true }
}
