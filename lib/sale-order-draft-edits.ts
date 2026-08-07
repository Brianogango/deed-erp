/**
 * Draft quotation line edits stay local until the user clicks Save (or an
 * auto-persist flush lands). While an SO id is in this set (or was just
 * persisted), remote blob/Prisma hydration must not replace that row's lines
 * — SSE was restoring deletes.
 *
 * Pending ids are mirrored to sessionStorage so a soft remount / sales boot
 * still protects in-progress edits (the in-memory Set alone did not survive).
 */

const SESSION_KEY = 'deed_so_draft_edit_ids'

const pendingDraftSaleOrderIds = new Set<string>()

/** After Save, keep protecting the row briefly while blob/SSE catch up. */
const recentlyPersisted = new Map<string, { at: number; lineKey: string }>()
const PERSIST_GUARD_MS = 20_000

function readSessionIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

function writeSessionIds() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify([...pendingDraftSaleOrderIds]))
  } catch { /* private mode / quota */ }
}

/** Hydrate in-memory set from sessionStorage (safe to call more than once). */
export function hydrateSaleOrderDraftEditsFromSession() {
  for (const id of readSessionIds()) pendingDraftSaleOrderIds.add(id)
}

// Pull any ids from a previous soft navigation as soon as this module loads.
hydrateSaleOrderDraftEditsFromSession()

function commercialLinesKey(lines: unknown): string {
  if (!Array.isArray(lines)) return ''
  return lines
    .filter((l: any) => l && l.lineType !== 'section')
    .map((l: any) => [
      String(l.productId ?? ''),
      String(l.description ?? l.productName ?? ''),
      Number(l.qty ?? 0),
      Number(l.unitPrice ?? 0),
      Number(l.taxRate ?? 0),
      Number(l.lineTotal ?? l.subtotal ?? 0),
    ].join('|'))
    .sort()
    .join(';')
}

function prunePersisted() {
  const cutoff = Date.now() - PERSIST_GUARD_MS
  for (const [id, meta] of recentlyPersisted) {
    if (meta.at < cutoff) recentlyPersisted.delete(id)
  }
}

export function markSaleOrderDraftEdit(id: string) {
  if (!id) return
  pendingDraftSaleOrderIds.add(id)
  writeSessionIds()
}

export function clearSaleOrderDraftEdit(id: string) {
  pendingDraftSaleOrderIds.delete(id)
  writeSessionIds()
}

export function hasSaleOrderDraftEdits() {
  hydrateSaleOrderDraftEditsFromSession()
  return pendingDraftSaleOrderIds.size > 0
}

export function isSaleOrderDraftEditing(id: string) {
  hydrateSaleOrderDraftEditsFromSession()
  return pendingDraftSaleOrderIds.has(id)
}

/** Call after a successful Prisma line persist so stale blob SSE cannot undo it. */
export function stampSaleOrderPersisted(id: string, lines: unknown) {
  if (!id) return
  pendingDraftSaleOrderIds.delete(id)
  writeSessionIds()
  recentlyPersisted.set(id, { at: Date.now(), lineKey: commercialLinesKey(lines) })
}

function shouldPreserveLocal(id: string, localRow: { lines?: unknown } | undefined): boolean {
  if (!id || !localRow) return false
  hydrateSaleOrderDraftEditsFromSession()
  if (pendingDraftSaleOrderIds.has(id)) return true
  prunePersisted()
  const stamp = recentlyPersisted.get(id)
  if (!stamp) return false
  // Keep local when it still matches what we just saved (blocks older remote copies).
  return commercialLinesKey(localRow.lines) === stamp.lineKey
}

/** Preserve locally-edited / just-saved draft quotation rows over stale remote copies. */
export function mergeSaleOrdersPreservingDraftEdits<T extends { id?: string; lines?: unknown }>(
  local: T[],
  remote: T[],
): T[] {
  if (!Array.isArray(remote)) return Array.isArray(local) ? local : []
  hydrateSaleOrderDraftEditsFromSession()
  prunePersisted()
  const protecting = pendingDraftSaleOrderIds.size > 0 || recentlyPersisted.size > 0
  if (!protecting || !Array.isArray(local) || local.length === 0) {
    return remote
  }
  const localById = new Map(
    local.filter(row => row && row.id != null).map(row => [String(row.id), row]),
  )
  const seen = new Set<string>()
  const merged = remote.map(row => {
    const id = row?.id != null ? String(row.id) : ''
    if (id) seen.add(id)
    const localRow = id ? localById.get(id) : undefined
    if (id && shouldPreserveLocal(id, localRow)) {
      return localRow as T
    }
    return row
  })
  for (const id of pendingDraftSaleOrderIds) {
    if (!seen.has(id) && localById.has(id)) merged.push(localById.get(id) as T)
  }
  return merged
}

/** Test helper */
export function _resetSaleOrderDraftEditStateForTests() {
  pendingDraftSaleOrderIds.clear()
  recentlyPersisted.clear()
  if (typeof window !== 'undefined') {
    try { window.sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
  }
}
