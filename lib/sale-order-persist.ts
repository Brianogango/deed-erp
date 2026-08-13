/**
 * Draft quotation line edits often race (add → remove → Save, notes keystrokes).
 * Sending a stale lockVersion 409s the PATCH while the UI stays optimistic, so a
 * refresh reloads Prisma without the change. Same omit pattern as confirmSO.
 *
 * Also drop raw Prisma `items` when `lines` is present — a stale `items` array
 * used to win over edited `lines` on the server (`body.items ?? body.lines`).
 *
 * Drop `orderNumber` / `ref` too: draft line soft/hard persists dump the whole
 * client row, and rewriting order_number from a stale `ref` (e.g. leftover QUO
 * after confirm allocated SO/…) collides with the unique constraint. Soft
 * persist then fails silently and VAT / line edits never land in Prisma.
 * Confirm / heal send orderNumber via their own fetch, not this helper.
 */
export function saleOrderPersistBody<T extends Record<string, unknown>>(
  order: T,
): Omit<T, 'lockVersion' | 'expectedVersion' | 'items' | 'orderNumber' | 'ref'> {
  const {
    lockVersion: _lockVersion,
    expectedVersion: _expectedVersion,
    items: _items,
    orderNumber: _orderNumber,
    ref: _ref,
    ...body
  } = order
  return body
}
