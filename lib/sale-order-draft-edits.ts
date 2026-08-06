/**
 * Draft quotation line edits stay local until the user clicks Save.
 * While an SO id is in this set, remote blob/Prisma hydration must not
 * replace that row's lines (SSE / boot sync was restoring deleted products).
 */

const pendingDraftSaleOrderIds = new Set<string>()

export function markSaleOrderDraftEdit(id: string) {
  if (id) pendingDraftSaleOrderIds.add(id)
}

export function clearSaleOrderDraftEdit(id: string) {
  pendingDraftSaleOrderIds.delete(id)
}

export function hasSaleOrderDraftEdits() {
  return pendingDraftSaleOrderIds.size > 0
}

export function isSaleOrderDraftEditing(id: string) {
  return pendingDraftSaleOrderIds.has(id)
}

/** Preserve locally-edited draft quotation rows over stale remote copies. */
export function mergeSaleOrdersPreservingDraftEdits<T extends { id?: string }>(
  local: T[],
  remote: T[],
): T[] {
  if (!Array.isArray(remote)) return Array.isArray(local) ? local : []
  if (!pendingDraftSaleOrderIds.size || !Array.isArray(local) || local.length === 0) {
    return remote
  }
  const localById = new Map(
    local.filter(row => row && row.id != null).map(row => [String(row.id), row]),
  )
  const seen = new Set<string>()
  const merged = remote.map(row => {
    const id = row?.id != null ? String(row.id) : ''
    if (id) seen.add(id)
    if (id && pendingDraftSaleOrderIds.has(id) && localById.has(id)) {
      return localById.get(id) as T
    }
    return row
  })
  // Keep any local-only rows still being edited (should be rare).
  for (const id of pendingDraftSaleOrderIds) {
    if (!seen.has(id) && localById.has(id)) merged.push(localById.get(id) as T)
  }
  return merged
}
