'use client'

import { useEffect, useState } from 'react'
import { criticalAppStateKeysForRoute } from '@/lib/app-state-hydration'

function normalizeRoute(pathname: string) {
  const clean = (pathname || '/').split('?')[0].split('#')[0]
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1)
  return clean || '/'
}

const readyRoutes = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(listener => listener())
}

export function routeHasLocalCache(pathname: string): boolean {
  if (typeof window === 'undefined') return false
  const keys = criticalAppStateKeysForRoute(pathname)
  if (keys.length === 0) return true
  try {
    return keys.every(key => window.localStorage.getItem(key) !== null)
  } catch {
    return false
  }
}

export function markRouteDataReady(pathname: string) {
  const route = normalizeRoute(pathname)
  if (readyRoutes.has(route)) return
  readyRoutes.add(route)
  emit()
}

export function resetRouteDataReadyForTests() {
  readyRoutes.clear()
  emit()
}

export function isRouteDataReady(pathname: string) {
  return readyRoutes.has(normalizeRoute(pathname))
}

/** True once this session has loaded the route's store payload (or it was already cached). */
export function useRouteDataReady(pathname: string): boolean {
  const route = normalizeRoute(pathname)
  const [, setEpoch] = useState(0)

  useEffect(() => {
    const sync = () => setEpoch(n => n + 1)
    listeners.add(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [])

  // Read cache/ready synchronously so a navigation to an uncached route does
  // not paint one frame of empty module chrome before the skeleton.
  if (typeof window === 'undefined') return false
  return readyRoutes.has(route) || routeHasLocalCache(route)
}
