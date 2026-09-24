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
      return safeLocalStorageSet(key, serialized)
    }
    window.localStorage.removeItem(key)
    return false
  } catch {
    return false
  }
}

/**
 * Keys that must survive an eviction: counters, sync bookkeeping and tiny
 * flags. They are a few bytes each and losing them costs a duplicate document
 * number or a full re-sync.
 */
const PROTECTED_KEY_PREFIXES = ['deed_seq2_', 'deed_dirty', 'deed_data_version', 'deed_last_sync', 'deed_etag_']

const isQuotaError = (err: unknown): boolean =>
  err instanceof DOMException &&
  (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22)

/**
 * Cached ERP collections, largest first — what an eviction may drop. Each is a
 * copy of data the server still holds, so dropping one costs a re-download,
 * never a loss.
 */
function evictableKeys(): Array<{ key: string; size: number }> {
  const out: Array<{ key: string; size: number }> = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (!key || !key.startsWith('deed_')) continue
    if (PROTECTED_KEY_PREFIXES.some(prefix => key.startsWith(prefix))) continue
    out.push({ key, size: (window.localStorage.getItem(key) ?? '').length })
  }
  return out.sort((a, b) => b.size - a.size)
}

/**
 * Write to localStorage without ever throwing into a business action.
 *
 * A full store used to abort whatever the user was doing: saving a delivery
 * died on `Setting the value of 'deed_seq2_war' exceeded the quota` — a
 * four-byte counter failing because cached collections had filled the 5 MB
 * browser allowance. On a quota error the largest cached collections are
 * dropped (the server copy is authoritative and re-downloads) and the write
 * is retried once.
 *
 * Returns true when the value was stored.
 */
export function safeLocalStorageSet(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch (err) {
    if (!isQuotaError(err)) return false
    for (const candidate of evictableKeys()) {
      if (candidate.key === key) continue
      try { window.localStorage.removeItem(candidate.key) } catch { return false }
      try {
        window.localStorage.setItem(key, value)
        return true
      } catch (retryErr) {
        if (!isQuotaError(retryErr)) return false
      }
    }
    return false
  }
}
