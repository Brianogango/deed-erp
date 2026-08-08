/**
 * Resolve commercial line payload from a sale-order write body.
 *
 * Client edits always mutate `lines`. API mappers historically spread the raw
 * Prisma `items` array onto the same object (`{ ...order, lines: mapped }`), so
 * a PATCH of the whole row could send BOTH:
 *   lines: [current draft]      ← correct after deletes
 *   items: [stale Prisma rows]  ← pre-delete snapshot
 *
 * Preferring `items` first made every soft/hard persist ignore deletes and
 * rewrite the database with the old line set (UI/blob looked right; Prisma did not).
 */
export function saleOrderLinesFromBody(body: {
  lines?: unknown
  items?: unknown
} | null | undefined): any[] | undefined {
  if (!body || typeof body !== 'object') return undefined
  if (Array.isArray(body.lines)) return body.lines
  if (Array.isArray(body.items)) return body.items
  return undefined
}

/** Strip raw Prisma `items` so client round-trips cannot resurrect deletes. */
export function omitSaleOrderPrismaItems<T extends Record<string, unknown>>(order: T): Omit<T, 'items'> {
  const { items: _items, ...rest } = order
  return rest
}
