/**
 * Client store-sync helpers — retry backoff and per-key remote merge rules.
 * Kept out of lib/store.tsx so unit tests do not import the monolith.
 */

export const SYNC_RETRY_MIN_MS = 500
export const SYNC_RETRY_MAX_MS = 30_000
export const SSE_RETRY_MIN_MS = 1_000
export const SSE_RETRY_MAX_MS = 30_000

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
