/**
 * A document's amountPaid is never below the payments listed on it (reversed
 * payments are not in that list), capped at its total. Heals a figure lowered
 * by a stale save while the payments themselves survived.
 */
function atLeastListedPayments<T>(row: T): T {
  const r = row as { total?: unknown; amountPaid?: unknown; payments?: unknown }
  if (!Array.isArray(r.payments) || !r.payments.length) return row
  const total = Number(r.total)
  if (!(total > 0)) return row
  const listed = r.payments.reduce((s: number, p: { amount?: unknown }) => s + (Number(p?.amount) || 0), 0)
  const floor = Math.min(total, Math.round(listed * 100) / 100)
  return floor > (Number(r.amountPaid) || 0) + 0.005 ? { ...row, amountPaid: floor } : row
}
