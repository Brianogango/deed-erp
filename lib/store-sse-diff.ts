/**
 * Drop store keys whose payload hash matches the last SSE send.
 * The stream already loads only rows changed since the cursor; this second
 * filter drops keys that were in the change-set but byte-identical (overlap
 * window, coalesced NOTIFY, or a write that saved the same JSON).
 */
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
