/**
 * Draft quotation line edits often race (add → remove → Save, notes keystrokes).
 * Sending a stale lockVersion 409s the PATCH while the UI stays optimistic, so a
 * refresh reloads Prisma without the change. Same omit pattern as confirmSO.
 */
export function saleOrderPersistBody<T extends Record<string, unknown>>(
  order: T,
): Omit<T, 'lockVersion' | 'expectedVersion'> {
  const { lockVersion: _lockVersion, expectedVersion: _expectedVersion, ...body } = order
  return body
}
