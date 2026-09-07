/**
 * Prefetch store keys + boot APIs for a route before the user clicks.
 * Safe to call on sidebar hover / focus; dedupes in-flight work.
 */

import { criticalAppStateKeysForRoute, deferredAppStateKeysForRoute } from '@/lib/app-state-hydration'
import { fetchAndApplyStoreKeys, readDirtyStoreKeys } from '@/lib/client-store-hydrate'
import { bootApiGroupsForRoute } from '@/lib/boot-apis'

const warmedRoutes = new Set<string>()
const inFlight = new Map<string, Promise<void>>()

function normalizeRoute(pathname: string) {
  const clean = (pathname || '/').split('?')[0].split('#')[0]
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1)
  return clean || '/'
}

/** Warm local cache + notify StoreProvider for Prisma boot groups. */
export function warmRoute(pathname: string, currentUserId?: string | null): void {
  if (typeof window === 'undefined') return
  const route = normalizeRoute(pathname)
  if (!route || warmedRoutes.has(route) || inFlight.has(route)) return

  const work = (async () => {
    window.dispatchEvent(new CustomEvent('deed_route_change', { detail: { pathname: route } }))

    const criticalKeys = criticalAppStateKeysForRoute(route)
    const deferredKeys = deferredAppStateKeysForRoute(route)
    if (criticalKeys.length === 0 && deferredKeys.length === 0) return

    const dirtyKeys = readDirtyStoreKeys()
    const etagCritical = currentUserId
      ? `deed_store_etag_${currentUserId}_${route}`
      : `deed_store_etag_${route}`
    const etagDeferred = `${etagCritical}_deferred`

    try {
      if (criticalKeys.length > 0) {
        await fetchAndApplyStoreKeys({
          keys: criticalKeys,
          etagStorageKey: etagCritical,
          dirtyKeys,
        })
      }
      if (deferredKeys.length > 0) {
        await fetchAndApplyStoreKeys({
          keys: deferredKeys,
          etagStorageKey: etagDeferred,
          dirtyKeys,
        })
      }
      warmedRoutes.add(route)
      void bootApiGroupsForRoute(route)
    } catch {
      // best-effort warm
    }
  })()

  inFlight.set(route, work)
  void work.finally(() => { inFlight.delete(route) })
}

export function markRouteWarmed(pathname: string) {
  warmedRoutes.add(normalizeRoute(pathname))
}
