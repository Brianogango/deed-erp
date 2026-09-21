/**
 * Guard against a whole-collection save silently deleting records.
 *
 * The shared store persists legacy collections by replacing the stored array
 * with whatever the caller sends. When a caller holds only part of the
 * collection — a browser hydrated from a paginated `?limit=200` REST page, a
 * role-filtered slice, a stale cache — "replace" turns every record it did not
 * load into a delete. On 21 Sep 2026 that truncated deed_serials and
 * deed_stockMoves in production.
 *
 * Rule: a save may remove at most BULK_DELETE_MAX_REMOVALS records from a
 * collection. Beyond that, absence is treated as "not loaded", not "deleted".
 * Genuine bulk deletes must say so explicitly (allowBulkDelete).
 */

export const BULK_DELETE_MAX_REMOVALS = 5

type Row = Record<string, unknown>

const IDENTITY_FIELDS = ['id', 'ref', 'code', 'key', 'number', 'name'] as const

/** Same identity precedence as the Prisma projection's record_key. */
export function recordIdentity(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Row
  for (const field of IDENTITY_FIELDS) {
    const candidate = row[field]
    if (typeof candidate === 'string' && candidate.trim()) return `${field}:${candidate.trim()}`
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return `${field}:${candidate}`
  }
  return null
}

export type CollectionShrink = {
  existing: number
  incoming: number
  /** Identified records present now but absent from the incoming array. */
  removed: number
  isBulkDelete: boolean
}

export function assessCollectionShrink(current: unknown, incoming: unknown): CollectionShrink {
  const currentArr = Array.isArray(current) ? current : []
  const incomingArr = Array.isArray(incoming) ? incoming : []
  const incomingIds = new Set<string>()
  for (const row of incomingArr) {
    const id = recordIdentity(row)
    if (id) incomingIds.add(id)
  }
  let removed = 0
  for (const row of currentArr) {
    const id = recordIdentity(row)
    if (id && !incomingIds.has(id)) removed++
  }
  return {
    existing: currentArr.length,
    incoming: incomingArr.length,
    removed,
    isBulkDelete: removed > BULK_DELETE_MAX_REMOVALS,
  }
}

/**
 * Union the incoming array with stored records it is missing. Incoming rows
 * win (they carry the caller's edits) and keep their order; stored rows the
 * caller never loaded are appended unchanged.
 */
export function unionMissingRecords(current: unknown, incoming: unknown): unknown[] {
  const currentArr = Array.isArray(current) ? current : []
  const incomingArr = Array.isArray(incoming) ? incoming : []
  const incomingIds = new Set<string>()
  for (const row of incomingArr) {
    const id = recordIdentity(row)
    if (id) incomingIds.add(id)
  }
  const kept = currentArr.filter(row => {
    const id = recordIdentity(row)
    return id !== null && !incomingIds.has(id)
  })
  return [...incomingArr, ...kept]
}

export type GuardedCollectionWrite = {
  value: unknown
  /** True when the incoming array was merged instead of replacing the store. */
  blocked: boolean
  shrink: CollectionShrink
}

/**
 * Apply the bulk-delete rule to one collection write. Non-array values pass
 * through untouched.
 */
export function guardCollectionWrite(current: unknown, incoming: unknown): GuardedCollectionWrite {
  const shrink = assessCollectionShrink(current, incoming)
  if (!Array.isArray(incoming) || !Array.isArray(current) || !shrink.isBulkDelete) {
    return { value: incoming, blocked: false, shrink }
  }
  return { value: unionMissingRecords(current, incoming), blocked: true, shrink }
}

export class BulkDeleteRefusedError extends Error {
  readonly key: string
  readonly shrink: CollectionShrink
  constructor(key: string, shrink: CollectionShrink) {
    super(
      `Refusing to delete ${shrink.removed} ${key} records in one save `
      + `(had ${shrink.existing}, received ${shrink.incoming}). `
      + 'Pass allowBulkDelete for an intentional bulk delete.',
    )
    this.name = 'BulkDeleteRefusedError'
    this.key = key
    this.shrink = shrink
  }
}
