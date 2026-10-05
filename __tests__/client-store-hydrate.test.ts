import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { applyHydratedStoreState } from '@/lib/client-store-hydrate'
import { serverBaselineFor } from '@/lib/store-baseline'

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
  vi.stubGlobal('window', {
    localStorage: ls,
    dispatchEvent: () => true,
  })
  return store
}

describe('applyHydratedStoreState', () => {
  beforeEach(() => {
    stubLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not overwrite a collection that became dirty while the GET was in flight', () => {
    window.localStorage.setItem('deed_serials', JSON.stringify([{ id: 'local' }]))
    window.localStorage.setItem('deed_dirty_keys', JSON.stringify(['deed_serials']))
    const staleSnapshot = new Set<string>()
    applyHydratedStoreState(
      { deed_serials: [{ id: 'server' }] },
      staleSnapshot,
    )
    expect(JSON.parse(window.localStorage.getItem('deed_serials') || '[]')).toEqual([{ id: 'local' }])
  })

  it('applies a collection that is not dirty', () => {
    applyHydratedStoreState({ deed_serials: [{ id: 'server' }] })
    expect(JSON.parse(window.localStorage.getItem('deed_serials') || '[]')).toEqual([{ id: 'server' }])
  })

  it('does not replace last-known rows with an empty GET payload', () => {
    window.localStorage.setItem('deed_saleOrders', JSON.stringify([{ id: 'local' }]))
    applyHydratedStoreState({ deed_saleOrders: [] })
    expect(JSON.parse(window.localStorage.getItem('deed_saleOrders') || '[]')).toEqual([{ id: 'local' }])
  })

  it('clears a stale edited mark when this browser holds the server data (keys in another order)', () => {
    window.localStorage.setItem('deed_products', JSON.stringify([{ name: 'A', id: 'p1' }]))
    window.localStorage.setItem('deed_dirty_keys', JSON.stringify(['deed_products', 'deed_serials']))
    const applied = applyHydratedStoreState({ deed_products: [{ id: 'p1', name: 'A' }] })
    expect(Object.keys(applied)).toEqual(['deed_products'])
    expect(JSON.parse(window.localStorage.getItem('deed_dirty_keys') || '[]')).toEqual(['deed_serials'])
  })

  it('keeps a real local edit but records the server copy as the save baseline', () => {
    window.localStorage.setItem('deed_serials', JSON.stringify([{ id: 's1', note: 'edited' }]))
    window.localStorage.setItem('deed_dirty_keys', JSON.stringify(['deed_serials']))
    const server = JSON.stringify([{ id: 's1', note: 'old' }])
    applyHydratedStoreState({ deed_serials: server })
    expect(JSON.parse(window.localStorage.getItem('deed_serials') || '[]')).toEqual([{ id: 's1', note: 'edited' }])
    expect(serverBaselineFor('deed_serials')).toBe(server)
  })
})

