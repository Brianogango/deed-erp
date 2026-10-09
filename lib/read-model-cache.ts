/**
 * Keep a finished, table-built list in memory and reuse it until the data
 * behind it changes.
 *
 * Building the invoice and sale-order lists reads every row with its lines,
 * payments and links (several queries, thousands of rows) and converts them
 * for the screens: 400–700 ms on production, on every full load and on every
 * save that merges lists, even when nothing changed since the last build.
 *
 * `fingerprint` is a cheap query (a few aggregates) over the tables the list
 * is built from. Same fingerprint → same list, so the stored one is returned
 * (as a copy, so a caller that edits what it receives cannot change the cache).
 * Any difference, or any failure to compute the fingerprint, rebuilds from the
 * tables, so the worst case is today's behaviour. The fingerprint is taken
 * BEFORE the build: if data changes in between, the stored list is tagged with
 * the older fingerprint and is rebuilt on the next call.
 */
const cache = new Map<string, { fingerprint: string; value: unknown }>()

export async function cachedByFingerprint<T>(
  name: string,
  fingerprint: () => Promise<string>,
  build: () => Promise<T>,
): Promise<T> {
  let fp = ''
  try {
    fp = await fingerprint()
  } catch {
    return build()
  }
  if (!fp) return build()
  const hit = cache.get(name)
  if (hit && hit.fingerprint === fp) return structuredClone(hit.value) as T
  const value = await build()
  cache.set(name, { fingerprint: fp, value: structuredClone(value) })
  return value
}

export function clearReadModelCache(name?: string): void {
  if (name) cache.delete(name)
  else cache.clear()
}
