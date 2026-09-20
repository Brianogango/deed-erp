/**
 * Client store-sync helpers — retry backoff and per-key remote merge rules.
 * Kept out of lib/store.tsx so unit tests do not import the monolith.
 */

export const SYNC_RETRY_MIN_MS = 500
export const SYNC_RETRY_MAX_MS = 30_000
export const SSE_RETRY_MIN_MS = 1_000
export const SSE_RETRY_MAX_MS = 30_000
/**
 * Last-resort visible-tab GET while the SSE transport itself is unavailable.
 * A connected stream already performs cursor-based server fallback polling when
 * LISTEN/NOTIFY is down, so polling full blobs every five seconds is redundant.
 */
export const STORE_NOTIFY_BACKUP_POLL_MS = 30_000
/** Wait this long for the stream `hello` before treating the transport as unhealthy. */
export const STORE_HELLO_GRACE_MS = 3_000

export function nextBackoffMs(previous: number, minMs: number, maxMs: number): number {
  if (!Number.isFinite(previous) || previous <= 0) return minMs
  return Math.min(maxMs, previous * 2)
}

export function nextSyncRetryMs(previous: number): number {
  return nextBackoffMs(previous, SYNC_RETRY_MIN_MS, SYNC_RETRY_MAX_MS)
}

export function nextSseRetryMs(previous: number): number {
  return nextBackoffMs(previous, SSE_RETRY_MIN_MS, SSE_RETRY_MAX_MS)
}

/**
 * Apply a remote key map without letting one pending/dirty key freeze the rest.
 * `shouldSkipKey` is evaluated per key; other keys still merge.
 */
export function mergeRemoteStatePerKey<T>(
  remoteState: Record<string, T>,
  shouldSkipKey: (key: string, value: T) => boolean,
): Array<[string, T]> {
  const applied: Array<[string, T]> = []
  for (const [key, value] of Object.entries(remoteState)) {
    if (!key.startsWith('deed_')) continue
    if (shouldSkipKey(key, value)) continue
    applied.push([key, value])
  }
  return applied
}

function asDeedKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((key): key is string => typeof key === 'string' && key.startsWith('deed_'))
}

/** Parse an SSE `store` event body. Unknown / malformed payloads are empty. */
export function parseStoreSseData(raw: string): {
  state: Record<string, unknown> | null
  invalidated: string[]
} {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { state: null, invalidated: [] }
    }
    const record = parsed as { state?: unknown; invalidated?: unknown }
    const state = record.state && typeof record.state === 'object' && !Array.isArray(record.state)
      ? record.state as Record<string, unknown>
      : null
    return { state, invalidated: asDeedKeyList(record.invalidated) }
  } catch {
    return { state: null, invalidated: [] }
  }
}

/** Parse an SSE `hello` event. Missing/invalid `liveNotify` means not live. */
export function parseStoreHelloData(raw: string): { liveNotify: boolean } {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { liveNotify: false }
    }
    return { liveNotify: (parsed as { liveNotify?: unknown }).liveNotify === true }
  } catch {
    return { liveNotify: false }
  }
}
