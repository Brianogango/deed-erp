/**
 * Union two id-keyed collections. Incoming wins on id conflict; current-only
 * rows are kept so a paginated API page cannot shrink the client store.
 */
export function mergeCollectionById<T extends { id?: unknown }>(
  current: T[] | null | undefined,
  incoming: T[] | null | undefined,
): T[] {
  const cur = Array.isArray(current) ? current : []
  const inc = Array.isArray(incoming) ? incoming : []
  if (inc.length === 0) return cur
  const byId = new Map<string, T>()
  for (const row of cur) {
    const id = row?.id != null ? String(row.id) : ''
    if (id) byId.set(id, row)
  }
  for (const row of inc) {
    const id = row?.id != null ? String(row.id) : ''
    if (!id) continue
    byId.set(id, row)
  }
  return [...byId.values()]
}
