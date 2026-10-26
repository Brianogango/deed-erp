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
import { AsyncLocalStorage } from 'node:async_hooks'

const cache = new Map<string, { fingerprint: string; value: unknown; builtAt: number }>()

/**
 * A stored list is rebuilt after this long even when its fingerprint has not
 * moved, so a change the fingerprint cannot see (a repair script editing a
 * row without touching updated_at) shows within minutes, not until restart.
 */
const MAX_AGE_MS = 10 * 60 * 1000

/**
 * Callers that only read and serialize a list (the store GET) can take the
 * stored list itself instead of a copy. Copying every cached list on every
 * request was a large share of a load's time once the lists were cached.
 * Inside this scope the lists MUST NOT be changed: filter / map into new
 * arrays and objects only.
 */
const sharedScope = new AsyncLocalStorage<true>()

export function withSharedReadModels<T>(fn: () => Promise<T>): Promise<T> {
  return sharedScope.run(true, fn)
}

const shared = () => sharedScope.getStore() === true

/**
 * A separate copy of a list. Lists holding values structuredClone cannot copy
 * (Prisma Decimals) are copied as JSON — the form the browser gets anyway —
 * instead of failing the load.
 */
function copyOf<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}
const warnedFingerprint = new Set<string>()
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
  const t0 = Date.now()
  try {
    fp = await fingerprint()
  } catch (err) {
    // Said once per list and process: a failing check silently turns the
    // cache off (sale orders were rebuilt on every load that way).
    if (!warnedFingerprint.has(name) && process.env.NODE_ENV !== 'test') {
      warnedFingerprint.add(name)
      console.warn(`[read-model-cache] ${name}: change check failed, rebuilding every time:`, err instanceof Error ? err.message : err)
    }
    return build()
  }
  if (!fp) return build()
  const fpMs = Date.now() - t0
  const hit = cache.get(name)
  if (hit && hit.fingerprint === fp && Date.now() - hit.builtAt < MAX_AGE_MS) {
    const value = (shared() ? hit.value : copyOf(hit.value)) as T
    const total = Date.now() - t0
    if (total >= 150 && process.env.NODE_ENV !== 'test') {
      console.warn(`[read-model-cache] slow hit ${name} ${total}ms (check ${fpMs}ms, copy ${total - fpMs}ms)`)
    }
    return value
  }

  const running = inFlight.get(name)
  if (running && running.fingerprint === fp) {
    const value = await running.promise
    return (shared() ? value : copyOf(value)) as T
  }

  const started = Date.now()
  const promise = build().then(value => {
    // Stored as its own copy: the builder's caller may change what it gets.
    // Within a shared scope everyone reads the stored copy, so it is the value.
    const stored = copyOf(value)
    cache.set(name, { fingerprint: fp, value: stored, builtAt: Date.now() })
    const ms = Date.now() - started
    if (ms >= 100 && process.env.NODE_ENV !== 'test') {
      console.warn(`[read-model-cache] rebuilt ${name} in ${ms}ms (check ${fpMs}ms; ${changedParts(hit?.fingerprint, fp)})`)
    }
    return stored
  })
  inFlight.set(name, { fingerprint: fp, promise })
  try {
    const value = await promise
    return (shared() ? value : copyOf(value)) as T
  } finally {
    if (inFlight.get(name)?.promise === promise) inFlight.delete(name)
  }
}

export function clearReadModelCache(name?: string): void {
  if (name) {
    cache.delete(name)
    inFlight.delete(name)
    rowBuilds.delete(name)
  } else {
    cache.clear()
    inFlight.clear()
    rowBuilds.clear()
  }
}

/**
 * A list kept per row: each row has a signature (a hash of everything the
 * row is built from), and only rows whose signature changed are re-read and
 * converted; the rest are reused from the last build. `base` covers what
 * touches every row (names joined in, the frozen screen copy): when it
 * changes, or signatures cannot be read, every row is re-read.
 *
 * Signatures are read BEFORE the rows, so a stored row is never older than
 * its signature; a change in between only causes one extra re-read later.
 * The list comes back in signature order, then any row the full read found
 * that the signatures did not list yet.
 *
 * Row objects are shared between builds: callers must not change them (the
 * list cache around this copies them for callers that might).
 */
const rowBuilds = new Map<string, { base: string; sigs: Map<string, string>; rows: Map<string, unknown> }>()

export async function incrementalRows<R>(opts: {
  name: string
  base: string
  signatures: () => Promise<Array<{ id: string; sig: string }>>
  /** null = every row. Returns the converted rows by id. */
  load: (ids: string[] | null) => Promise<Map<string, R>>
}): Promise<R[]> {
  const sigList = await opts.signatures().catch(() => null)
  const previous = rowBuilds.get(opts.name)
  const usable = sigList && previous && opts.base && previous.base === opts.base ? previous : null

  if (sigList && usable) {
    const stale = sigList.filter(s => usable.sigs.get(s.id) !== s.sig).map(s => s.id)
    const fresh = stale.length ? await opts.load(stale) : new Map<string, R>()
    const staleIds = new Set(stale)
    const rows = new Map<string, unknown>()
    const sigs = new Map<string, string>()
    for (const { id, sig } of sigList) {
      // A changed row that is gone by the time it is read is dropped, never
      // served in its old form.
      const row = staleIds.has(id) ? fresh.get(id) : usable.rows.get(id)
      if (row === undefined) continue
      rows.set(id, row)
      sigs.set(id, sig)
    }
    rowBuilds.set(opts.name, { base: opts.base, sigs, rows })
    return [...rows.values()] as R[]
  }

  const all = await opts.load(null)
  if (!sigList) {
    rowBuilds.delete(opts.name)
    return [...all.values()]
  }
  const listed = new Set(sigList.map(s => s.id))
  const ordered = sigList.map(s => all.get(s.id)).filter((r): r is R => r !== undefined)
  // Added after the signatures were read: shown now, re-read next time.
  for (const [id, row] of all) if (!listed.has(id)) ordered.push(row)
  if (opts.base) {
    const sigs = new Map(sigList.filter(s => all.has(s.id)).map(s => [s.id, s.sig]))
    rowBuilds.set(opts.name, { base: opts.base, sigs, rows: new Map(all) })
  } else {
    rowBuilds.delete(opts.name)
  }
  return ordered
}
