/**
 * Line ordering for quotations and sale orders.
 *
 * sale_order_items rows carry a sortOrder written from the client array index.
 * Reads used `include: { items: true }` with no ORDER BY in roughly twenty
 * places, so ordering is applied here, in the handful of mappers that turn
 * Prisma rows into client lines, rather than at each query — a query that
 * forgets its orderBy then still returns the right order.
 *
 * The sort is stable, so rows that share a sortOrder (anything written before
 * the column existed and not yet touched by the backfill) keep the order
 * Postgres returned them in, which is the order those documents display today.
 */
export function orderedSaleOrderItems<T>(items: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(items)) return []
  const position = (item: T) => Number((item as { sortOrder?: unknown } | null)?.sortOrder) || 0
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (position(a.item) - position(b.item)) || (a.index - b.index))
    .map(entry => entry.item)
}
