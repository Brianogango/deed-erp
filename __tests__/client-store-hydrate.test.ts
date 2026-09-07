import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { applyHydratedStoreState } from '@/lib/client-store-hydrate'

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
})
