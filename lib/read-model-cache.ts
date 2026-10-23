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
 *
 * A screen opens with several requests at once. When the list is out of date
 * they used to rebuild it in parallel — the same heavy queries several times
 * over, each slowing the others. Requests that find the same fingerprint now
 * share one build.
 */
const cache = new Map<string, { fingerprint: string; value: unknown }>()
const inFlight = new Map<string, { fingerprint: string; promise: Promise<unknown> }>()

/** Which parts of a `|`-separated fingerprint changed, e.g. "2,5" — for the log. */
export function changedParts(previous: string | undefined, next: string): string {
  if (!previous) return 'first build'
  const a = previous.split('|')
  const b = next.split('|')
  const parts: number[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) parts.push(i + 1)
  return parts.length ? `part ${parts.join(',')}` : 'unchanged'
}

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

  const running = inFlight.get(name)
  if (running && running.fingerprint === fp) {
    return structuredClone(await running.promise) as T
  }

  const started = Date.now()
  const promise = build().then(value => {
    cache.set(name, { fingerprint: fp, value: structuredClone(value) })
    const ms = Date.now() - started
    if (ms >= 200 && process.env.NODE_ENV !== 'test') {
      console.warn(`[read-model-cache] rebuilt ${name} in ${ms}ms (${changedParts(hit?.fingerprint, fp)})`)
    }
    return value
  })
  inFlight.set(name, { fingerprint: fp, promise })
  try {
    const value = await promise
    return structuredClone(value) as T
  } finally {
    if (inFlight.get(name)?.promise === promise) inFlight.delete(name)
  }
}

export function clearReadModelCache(name?: string): void {
  if (name) {
    cache.delete(name)
    inFlight.delete(name)
  } else {
    cache.clear()
    inFlight.clear()
  }
}
