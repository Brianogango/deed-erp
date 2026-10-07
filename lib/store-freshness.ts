/**
 * One download per collection.
 *
 * A page load used to fetch the same collections two or three times: route
 * hydration, a startup recovery pass and the live-update stream (which
 * replays the last minute of changes on every connect) each asked on their
 * own — invoices alone came down three times on the dashboard. This module
 * remembers, per collection, when the server read the copy we hold and which
 * downloads are already running, so callers can skip what they already have.
 *
 * Times from the server (readAt, changedAt) are only compared with each
 * other; the freshness window uses the browser clock only.
 */

/** A write whose timestamp is this close before our read may not have been visible to it. */
const READ_MARGIN_MS = 5_000
/** How long a downloaded copy counts as current without any change notice. */
export const FRESH_WINDOW_MS = 60_000

type Seen = { readAt: number; receivedAt: number }

const seen = new Map<string, Seen>()
const changedAt = new Map<string, number>()
const inflight = new Map<string, Promise<unknown>>()
/** Keys shown from the browser cache: held, but never counted as fresh. */
const held = new Set<string>()
/** Keys the current page load is about to download itself (critical, then deferred). */
const hydrating = new Map<string, number>()
let hydrationWaiters: Array<() => void> = []

const parse = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : null
}

/** Record that the server read these collections at `readAtIso` (header x-store-read-at). */
export function noteStoreRead(keys: string[], readAtIso: string | null | undefined, receivedAt = Date.now()) {
  const readAt = parse(readAtIso)
  if (readAt === null) return
  for (const key of keys) {
    const prev = seen.get(key)
    if (!prev || prev.readAt <= readAt) seen.set(key, { readAt, receivedAt })
  }
}

/** Record change notices from the live-update stream (key → ISO time of the change). */
export function noteStoreChanges(changes: Record<string, string> | null | undefined) {
  for (const [key, iso] of Object.entries(changes ?? {})) {
    const t = parse(iso)
    if (t !== null && t > (changedAt.get(key) ?? -Infinity)) changedAt.set(key, t)
  }
}

/** Our copy was read after every change we have heard of for this key. */
function coversKnownChanges(key: string, s: Seen) {
  const change = changedAt.get(key)
  return change === undefined || change < s.readAt - READ_MARGIN_MS
}

/**
 * Keys a change notice still requires us to download. Without a change time
 * the notice cannot be ruled out, so the key is kept.
 */
export function keysChangedSinceRead(keys: string[], changes: Record<string, string> | null | undefined): string[] {
  return keys.filter(key => {
    const s = seen.get(key)
    const change = parse(changes?.[key])
    if (!s || change === null) return true
    return change >= s.readAt - READ_MARGIN_MS
  })
}

/** This page session holds a downloaded copy of every one of these keys (in memory). */
export function holdsStoreCopy(keys: string[]): boolean {
  return keys.every(key => seen.has(key) || held.has(key))
}

/** Copies loaded from the browser cache: enough to ask for a 304, not to skip asking. */
export function noteStoreHeld(keys: string[]) {
  for (const key of keys) held.add(key)
}

/** Keys with no current copy: never downloaded, older than the window, or changed since. */
export function keysNeedingDownload(keys: string[], now = Date.now()): string[] {
  return keys.filter(key => {
    const s = seen.get(key)
    if (!s || now - s.receivedAt > FRESH_WINDOW_MS) return true
    return !coversKnownChanges(key, s)
  })
}

/** Wait for any running download of these keys. */
export async function awaitStoreDownloads(keys: string[]) {
  const running = [...new Set(keys.map(key => inflight.get(key)).filter(Boolean))]
  if (running.length) await Promise.allSettled(running)
}

/**
 * Split a request, synchronously, into keys this caller must download and a
 * promise for downloads already running. Register the caller's download with
 * trackStoreDownload in the same tick, so two callers starting together
 * cannot both fetch the same key.
 */
export function claimStoreDownload(keys: string[], now = Date.now()): { mine: string[]; others: Promise<void> } {
  const running = keys.filter(key => inflight.has(key))
  const mine = keysNeedingDownload(keys.filter(key => !inflight.has(key)), now)
  return { mine, others: awaitStoreDownloads(running) }
}

/** Register a download so concurrent callers wait for it instead of repeating it. */
export function trackStoreDownload<T>(keys: string[], work: Promise<T>): Promise<T> {
  for (const key of keys) inflight.set(key, work)
  const clear = () => { for (const key of keys) if (inflight.get(key) === work) inflight.delete(key) }
  work.then(clear, clear)
  return work
}

/** The page load is about to download these keys; change notices can leave them to it. */
export function beginRouteHydration(keys: string[]) {
  for (const key of keys) hydrating.set(key, (hydrating.get(key) ?? 0) + 1)
}

export function endRouteHydration(keys: string[]) {
  for (const key of keys) {
    const n = (hydrating.get(key) ?? 0) - 1
    if (n > 0) hydrating.set(key, n)
    else hydrating.delete(key)
  }
  const waiters = hydrationWaiters
  hydrationWaiters = []
  waiters.forEach(wake => wake())
}

/**
 * Wait until the page load has downloaded these keys, so a change notice is
 * judged against that download instead of starting a second one beside it.
 */
export async function awaitRouteHydration(keys: string[]): Promise<void> {
  while (keys.some(key => (hydrating.get(key) ?? 0) > 0)) {
    await new Promise<void>(resolve => { hydrationWaiters.push(resolve) })
  }
}

/** Tests only. */
export function resetStoreFreshness() {
  seen.clear()
  changedAt.clear()
  inflight.clear()
  held.clear()
  hydrating.clear()
  hydrationWaiters = []
}
