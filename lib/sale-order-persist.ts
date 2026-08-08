/**
 * Draft quotation line edits often race (add → remove → Save, notes keystrokes).
 * Sending a stale lockVersion 409s the PATCH while the UI stays optimistic, so a
 * refresh reloads Prisma without the change. Same omit pattern as confirmSO.
 *
 * Also drop raw Prisma `items` when `lines` is present — a stale `items` array
 * used to win over edited `lines` on the server (`body.items ?? body.lines`).
 */
export function saleOrderPersistBody<T extends Record<string, unknown>>(
  order: T,
): Omit<T, 'lockVersion' | 'expectedVersion' | 'items'> {
  const {
    lockVersion: _lockVersion,
    expectedVersion: _expectedVersion,
    items: _items,
    ...body
  } = order
  return body
}
