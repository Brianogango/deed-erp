/**
 * Per-key localStorage cap for ERP collections.
 *
 * 512 KiB dropped live repairs (~900 KiB) and products (~600 KiB), so those
 * keys never cached. Route hydration then skipped ETag 304 and re-downloaded
 * Finance, Operations, Repairs, and the dashboard on every visit.
 *
 * 1.5 MiB covers current production blobs with headroom. Quota errors are
 * still swallowed by the writer — the server copy remains authoritative.
 */
export const CLIENT_STORE_PERSIST_MAX_BYTES = 1.5 * 1024 * 1024

/** Write a serialized store value, or drop a stale oversized copy. */
export function persistClientStoreValue(key: string, serialized: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (serialized.length <= CLIENT_STORE_PERSIST_MAX_BYTES) {
      window.localStorage.setItem(key, serialized)
      return true
    }
    window.localStorage.removeItem(key)
    return false
  } catch {
    return false
  }
}
