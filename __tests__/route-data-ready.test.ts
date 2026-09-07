import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { criticalAppStateKeysForRoute } from '@/lib/app-state-hydration'
import {
  isRouteDataReady,
  markRouteDataReady,
  resetRouteDataReadyForTests,
  routeHasLocalCache,
} from '@/lib/route-data-ready'

function stubLocalStorage() {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
    clear: () => store.clear(),
  }
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', { localStorage: ls })
  return ls
}

describe('route data ready', () => {
  beforeEach(() => {
    stubLocalStorage()
    resetRouteDataReadyForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats a route as cached once every critical hydration key is present', () => {
    const keys = criticalAppStateKeysForRoute('/finance')
    expect(keys.length).toBeGreaterThan(3)
    expect(routeHasLocalCache('/finance')).toBe(false)
    keys.slice(0, -1).forEach(key => window.localStorage.setItem(key, '[]'))
    expect(routeHasLocalCache('/finance')).toBe(false)
    keys.forEach(key => window.localStorage.setItem(key, '[]'))
    expect(routeHasLocalCache('/finance')).toBe(true)
  })

  it('remembers a route after markRouteDataReady', () => {
    expect(isRouteDataReady('/repairs')).toBe(false)
    markRouteDataReady('/repairs')
    expect(isRouteDataReady('/repairs')).toBe(true)
    expect(isRouteDataReady('/repairs?status=all')).toBe(true)
  })

  it('does not treat a prior sync timestamp as cached route data', () => {
    window.localStorage.setItem('deed_last_synced_at', new Date().toISOString())
    expect(routeHasLocalCache('/')).toBe(false)
    expect(isRouteDataReady('/')).toBe(false)
  })

  it('can paint the dashboard before deferred keys such as serials are cached', () => {
    const keys = criticalAppStateKeysForRoute('/')
    keys.forEach(key => window.localStorage.setItem(key, '[]'))
    expect(window.localStorage.getItem('deed_serials')).toBeNull()
    expect(routeHasLocalCache('/')).toBe(true)
  })
})
