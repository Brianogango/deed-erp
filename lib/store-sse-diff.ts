/**
 * Drop store keys whose payload hash matches the last SSE send.
 * The stream already loads only rows changed since the cursor; this second
 * filter drops keys that were in the change-set but byte-identical (overlap
 * window, coalesced NOTIFY, or a write that saved the same JSON).
 */

/** Keys larger than this are omitted from the SSE body; clients refetch them. */
export const SSE_MAX_KEY_BYTES = 1024 * 1024

/**
 * Safety-net poll inside each SSE connection. Postgres NOTIFY is the instant
 * path; this covers a dropped LISTEN socket or a missed payload.
 */
export const SSE_FALLBACK_POLL_MS = 8_000

export function pickChangedSseKeys(
  lean: Record<string, unknown>,
  lastKeyHashes: Record<string, string>,
  hash: (value: unknown) => string,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(lean)) {
    const next = hash(value)
    if (lastKeyHashes[key] === next) continue
    changed[key] = value
    lastKeyHashes[key] = next
  }
  return changed
}

/**
 * Split a readable change-set into payloads small enough to broadcast and
 * keys the client must GET immediately. Silent omission used to leave other
 * tabs on the 60s fallback (or never, if the key stayed oversized).
 */
export function splitSseBroadcastState(
  readable: Record<string, unknown>,
  maxBytes = SSE_MAX_KEY_BYTES,
): { lean: Record<string, unknown>; invalidated: string[] } {
  const lean: Record<string, unknown> = {}
  const invalidated: string[] = []
  for (const [key, value] of Object.entries(readable)) {
    try {
      if (JSON.stringify(value).length <= maxBytes) {
        lean[key] = value
      } else {
        invalidated.push(key)
      }
    } catch {
      invalidated.push(key)
    }
  }
  return { lean, invalidated }
}
