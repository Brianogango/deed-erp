import 'server-only'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

/**
 * Repairs that were deleted, so a stale browser cannot bring them back.
 *
 * Deleting a repair removes it from the blob and from the repairs table. But
 * mergeRepairsStoreWrite is union-by-id: a row present in an incoming array
 * and absent from the server's is treated as new and inserted. A second tab
 * holding the array from before the delete — or an offline queue flushing on
 * reconnect, or the sendBeacon on unload — therefore re-adds the repair, and
 * the mirror then recreates the Prisma row from it. Nothing in the delete path
 * prevented that.
 *
 * A tombstone is the missing piece: the id is remembered for a window long
 * enough to outlive any stale client, and merges drop it on sight. It is not a
 * permanent record — an id that has been gone for TTL_DAYS can no longer be
 * resurrected by a tab that old, and keeping every id forever would grow a
 * blob key without bound.
 */

const REPAIR_TOMBSTONE_KEY = 'deed_repairs_deleted_v1'

/** Long enough to outlive a laptop left asleep over a weekend. */
export const TOMBSTONE_TTL_DAYS = 30

type RepairTombstones = Record<string, string>

const ttlMs = TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000

/** Drop entries past the window. Pure, so the merge logic stays testable. */
export function pruneTombstones(
  tombstones: RepairTombstones,
  now: number = Date.now(),
): RepairTombstones {
  const next: RepairTombstones = {}
  for (const [id, at] of Object.entries(tombstones)) {
    const stamped = Date.parse(at)
    if (Number.isNaN(stamped) || now - stamped < ttlMs) next[id] = at
  }
  return next
}

export function tombstoneIds(tombstones: RepairTombstones): Set<string> {
  return new Set(Object.keys(tombstones))
}

export async function loadRepairTombstones(): Promise<RepairTombstones> {
  try {
    const state = await loadAppState([REPAIR_TOMBSTONE_KEY])
    const raw = state[REPAIR_TOMBSTONE_KEY]
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as RepairTombstones
  } catch {
    // A missing or unreadable record must never block a store write.
    return {}
  }
}

/** Record a deletion. Called after the delete itself has succeeded. */
export async function recordRepairTombstone(id: string): Promise<void> {
  if (!id) return
  try {
    const current = await loadRepairTombstones()
    const next = pruneTombstones({ ...current, [id]: new Date().toISOString() })
    await saveStoreKeys({ [REPAIR_TOMBSTONE_KEY]: JSON.stringify(next) })
  } catch (err) {
    // The repair is already deleted; losing the tombstone only means the old
    // resurrection window is back, so warn rather than fail the delete.
    console.error(`[repair-tombstone] ${id} not recorded:`, err)
  }
}
