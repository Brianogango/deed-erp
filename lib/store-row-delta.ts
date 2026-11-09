/**
 * Changed rows only, instead of a whole list.
 *
 * When one invoice changes, every open screen used to download the whole
 * invoice list again (2–4 MB). The server remembers, per list version, each
 * row's id and a hash of its content (a manifest). A browser that says which
 * version it holds gets only the rows added or changed since, the ids
 * removed, and — when rows were added or moved — the new order of ids. It
 * patches its copy of that version; anything that does not fit (no copy, a
 * count that does not match) is downloaded whole as before.
 *
 * Pure — shared by the store route and the browser.
 */

type Row = Record<string, unknown>

export type RowManifest = { ids: string[]; hashes: Map<string, string> }

export type RowDelta = {
  /** Rows added or changed since the version the browser holds. */
  upsert: Row[]
  /** Ids no longer in the list. */
  remove: string[]
  /** The full id order, sent only when rows were added or reordered. */
  order?: string[]
  /** Row count after the change — a patched copy that does not reach it is thrown away. */
  count: number
}

/** Lists this short are sent whole: the change-only form saves nothing worth the work. */
export const MIN_DELTA_ROWS = 150

/** Ids and content hashes of a list, or null when a row has no unique string id. */
export function buildManifest(rows: unknown, hash: (row: Row) => string): RowManifest | null {
  if (!Array.isArray(rows)) return null
  const ids: string[] = []
  const hashes = new Map<string, string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const id = (row as Row).id
    if (typeof id !== 'string' || !id || hashes.has(id)) return null
    ids.push(id)
    hashes.set(id, hash(row as Row))
  }
  return { ids, hashes }
}

/** What changed from `prev` to the current list (`rows`, whose manifest is `cur`). */
export function diffRows(prev: RowManifest, rows: Row[], cur: RowManifest): RowDelta {
  const upsert: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    const id = cur.ids[i]
    if (prev.hashes.get(id) !== cur.hashes.get(id)) upsert.push(rows[i])
  }
  const remove = prev.ids.filter(id => !cur.hashes.has(id))
  // Same ids in the same order once removals are taken out: no order needed.
  const kept = prev.ids.filter(id => cur.hashes.has(id))
  const sameOrder = kept.length === cur.ids.length && kept.every((id, i) => id === cur.ids[i])
  return { upsert, remove, ...(sameOrder ? {} : { order: cur.ids }), count: cur.ids.length }
}

/**
 * The browser's copy with a delta applied, or null when it does not fit (the
 * caller then downloads the list whole). Upserted rows replace the copy's.
 */
export function applyRowDelta(base: unknown, delta: RowDelta): Row[] | null {
  let rows: unknown
  try {
    rows = typeof base === 'string' ? JSON.parse(base) : base
  } catch {
    return null
  }
  if (!Array.isArray(rows) || !delta || !Array.isArray(delta.upsert) || !Array.isArray(delta.remove)) return null
  const byId = new Map<string, Row>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null
    const id = (row as Row).id
    if (typeof id !== 'string') return null
    byId.set(id, row as Row)
  }
  for (const row of delta.upsert) {
    if (!row || typeof row.id !== 'string') return null
    byId.set(row.id as string, row)
  }
  const removed = new Set(delta.remove)
  let out: Row[]
  if (delta.order) {
    out = []
    for (const id of delta.order) {
      const row = byId.get(id)
      if (!row) return null
      out.push(row)
    }
  } else {
    const upserted = new Map(delta.upsert.map(r => [r.id as string, r]))
    out = (rows as Row[]).filter(r => !removed.has(r.id as string)).map(r => upserted.get(r.id as string) ?? r)
    // A row the copy does not have can only arrive with an order.
    if (delta.upsert.some(r => !(rows as Row[]).some(b => b.id === r.id))) return null
  }
  return out.length === delta.count ? out : null
}
