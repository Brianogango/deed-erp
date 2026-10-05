/**
 * Send only the records that changed.
 *
 * Every change to a collection used to upload the whole collection — editing
 * one repair posted every repair. The browser now diffs against what the
 * server last gave it and posts `{ upsert, remove }`; the server rebuilds the
 * full collection from its own copy and runs the same merge and guard
 * pipeline as before. Records this browser did not touch are never re-sent,
 * so a stale tab can no longer overwrite someone else's newer edit to them.
 *
 * Pure — shared by the client store and /api/store.
 */

import { sameContent } from '@/lib/same-content'

export type CollectionDelta = { upsert: unknown[]; remove: string[] }

type IdRow = { id?: unknown }

const idOf = (row: unknown): string | null => {
  const id = (row as IdRow | null)?.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

/**
 * The delta from `baselineRaw` (the collection as the server last sent it) to
 * `currentRaw`. Null when a delta cannot stand in for the full value — not
 * both arrays, a row without an id, duplicate ids — or is not worth it.
 */
export function computeCollectionDelta(baselineRaw: string, currentRaw: string): CollectionDelta | null {
  let baseline: unknown
  let current: unknown
  try {
    baseline = JSON.parse(baselineRaw)
    current = JSON.parse(currentRaw)
  } catch {
    return null
  }
  if (!Array.isArray(baseline) || !Array.isArray(current)) return null

  const before = new Map<string, unknown>()
  for (const row of baseline) {
    const id = idOf(row)
    if (id === null || before.has(id)) return null
    before.set(id, row)
  }
  const upsert: unknown[] = []
  const seen = new Set<string>()
  for (const row of current) {
    const id = idOf(row)
    if (id === null || seen.has(id)) return null
    seen.add(id)
    // Same data with keys in another order is not a change.
    if (!before.has(id) || !sameContent(before.get(id), row)) upsert.push(row)
  }
  const remove = [...before.keys()].filter(id => !seen.has(id))
  // Small collections, or most rows changed: the full value is just as cheap.
  if (current.length < 20 || upsert.length + remove.length > current.length / 2) return null
  return { upsert, remove }
}

export function isCollectionDelta(value: unknown): value is CollectionDelta {
  const v = value as CollectionDelta | null
  return !!v && typeof v === 'object' && Array.isArray(v.upsert) && Array.isArray(v.remove)
    && v.remove.every(id => typeof id === 'string')
    && v.upsert.every(row => idOf(row) !== null)
}

/**
 * Rebuild the full collection: stored rows keep their place, changed rows are
 * replaced in place, new rows go first (the app lists newest first), removed
 * rows drop out. Null when the stored value is not a collection.
 */
export function applyCollectionDelta(stored: unknown, delta: CollectionDelta): unknown[] | null {
  if (stored != null && !Array.isArray(stored)) return null
  const rows = (stored ?? []) as unknown[]
  const removed = new Set(delta.remove)
  const changed = new Map<string, unknown>()
  for (const row of delta.upsert) changed.set(idOf(row)!, row)
  const placed = new Set<string>()
  const kept: unknown[] = []
  for (const row of rows) {
    const id = idOf(row)
    if (id !== null && removed.has(id)) continue
    if (id !== null && changed.has(id)) {
      kept.push(changed.get(id))
      placed.add(id)
      continue
    }
    kept.push(row)
  }
  const added = delta.upsert.filter(row => !placed.has(idOf(row)!) && !removed.has(idOf(row)!))
  return [...added, ...kept]
}
