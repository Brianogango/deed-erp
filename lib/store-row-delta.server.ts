import 'server-only'
import { createHash } from 'crypto'
import { buildManifest, diffRows, MIN_DELTA_ROWS, type RowDelta, type RowManifest } from './store-row-delta'

/**
 * Manifests of recently served list versions (per key, version and viewer —
 * the version string already carries the viewer). Kept in memory per worker,
 * newest last; a browser whose version is not here gets the list whole.
 */
const MAX_MANIFESTS = 48
const manifests = new Map<string, RowManifest>()

const rowHash = (row: Record<string, unknown>) => createHash('md5').update(JSON.stringify(row)).digest('base64').slice(0, 16)

function remember(id: string, m: RowManifest) {
  manifests.delete(id)
  manifests.set(id, m)
  while (manifests.size > MAX_MANIFESTS) manifests.delete(manifests.keys().next().value as string)
}

/**
 * Record this list version, and when the browser holds an older one we know,
 * return what changed — only when that is clearly smaller than the list.
 */
export function rowDeltaFor(key: string, rows: unknown, currentVersion: string | undefined, haveVersion: string | undefined): RowDelta | null {
  if (!currentVersion || !Array.isArray(rows) || rows.length < MIN_DELTA_ROWS) return null
  const cur = buildManifest(rows, rowHash)
  if (!cur) return null
  remember(`${key}|${currentVersion}`, cur)
  const prev = haveVersion ? manifests.get(`${key}|${haveVersion}`) : undefined
  if (!prev || haveVersion === currentVersion) return null
  const delta = diffRows(prev, rows as Record<string, unknown>[], cur)
  // A large change is sent whole: the patch would not save much.
  if (delta.upsert.length > rows.length * 0.4) return null
  return delta
}

export function clearRowManifests() {
  manifests.clear()
}
