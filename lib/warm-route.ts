/**
 * Prefetch store keys + boot APIs for a route before the user clicks.
 * Safe to call on sidebar hover / focus; dedupes in-flight work.
 */

import { appStateKeysForRoute } from '@/lib/app-state-hydration'
import { persistClientStoreValue } from '@/lib/client-store-cache'
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
    // Kick Prisma boot groups for this route (StoreProvider listens).
    window.dispatchEvent(new CustomEvent('deed_route_change', { detail: { pathname: route } }))

    const keys = appStateKeysForRoute(route)
    if (keys.length === 0) return

    const dirtyKeys = (() => {
      try {
        const raw = window.localStorage.getItem('deed_dirty_keys')
        return new Set<string>(raw ? JSON.parse(raw) : [])
      } catch {
        return new Set<string>()
      }
    })()

    const etagStorageKey = currentUserId
      ? `deed_store_etag_${currentUserId}_${route}`
      : `deed_store_etag_${route}`
    const storedEtag = (() => {
      try { return window.localStorage.getItem(etagStorageKey) } catch { return null }
    })()
    const allKeysCached = keys.every(key => window.localStorage.getItem(key) !== null)

    try {
      const res = await fetch(`/api/store?keys=${encodeURIComponent(keys.join(','))}`, {
        headers: storedEtag && allKeysCached ? { 'If-None-Match': storedEtag } : undefined,
      })
      if (res.status === 304) {
        warmedRoutes.add(route)
        return
      }
      if (!res.ok) return
      const etag = res.headers.get('etag')
      try {
        if (etag) window.localStorage.setItem(etagStorageKey, etag)
      } catch { /* ignore */ }

      const state = await res.json() as Record<string, unknown>
      for (const [key, value] of Object.entries(state || {})) {
        if (!key.startsWith('deed_') || dirtyKeys.has(key)) continue
        let serialized: string
        try {
          serialized = typeof value === 'string' ? value : JSON.stringify(value)
        } catch {
          continue
        }
        try {
          if (window.localStorage.getItem(key) === serialized) continue
        } catch { /* ignore */ }
        persistClientStoreValue(key, serialized)
        window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key, value: serialized } }))
      }
      warmedRoutes.add(route)
      // Tip Next.js to prefetch the page JS too when possible.
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
