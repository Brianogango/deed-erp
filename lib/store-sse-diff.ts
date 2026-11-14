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

