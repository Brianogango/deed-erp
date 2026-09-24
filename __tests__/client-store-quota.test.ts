import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { safeLocalStorageSet } from '@/lib/client-store-cache'

/**
 * REGRESSION 24-Sep-2026 — saving a delivery died with
 *   Failed to execute 'setItem' on 'Storage': Setting the value of
 *   'deed_seq2_war' exceeded the quota.
 * A four-byte counter could not be written because cached collections had
 * filled the browser's 5 MB allowance, and the exception aborted the whole
 * save. The store is a cache of server data: it may be evicted, never fatal.
 */
class QuotaError extends DOMException {
  constructor() { super('quota', 'QuotaExceededError') }
}

function fakeStorage(opts: { limit: number; seed?: Record<string, string> }) {
  const data = new Map<string, string>(Object.entries(opts.seed ?? {}))
  const used = () => [...data.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0)
  return {
    get length() { return data.size },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => { data.delete(k) },
    setItem: (k: string, v: string) => {
      const next = used() - (data.has(k) ? k.length + (data.get(k) as string).length : 0) + k.length + v.length
      if (next > opts.limit) throw new QuotaError()
      data.set(k, v)
    },
    clear: () => data.clear(),
    _data: data,
  }
}

// Tests run in the node environment: stand up just enough of `window`.
const install = (storage: ReturnType<typeof fakeStorage>) => {
  vi.stubGlobal('window', { localStorage: storage })
}

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { vi.unstubAllGlobals() })

describe('safeLocalStorageSet', () => {
  it('writes normally when there is room', () => {
    const storage = fakeStorage({ limit: 1000 })
    install(storage)
    expect(safeLocalStorageSet('deed_seq2_war', '11')).toBe(true)
    expect(storage.getItem('deed_seq2_war')).toBe('11')
  })

  it('does nothing on the server, where there is no window', () => {
    vi.unstubAllGlobals()
    expect(safeLocalStorageSet('deed_seq2_war', '11')).toBe(false)
  })

  it('evicts the largest cached collection to make room for a counter', () => {
    const storage = fakeStorage({
      limit: 120,
      seed: { deed_repairs_v2: 'x'.repeat(60), deed_products: 'y'.repeat(30) },
    })
    install(storage)
    expect(safeLocalStorageSet('deed_seq2_war', '11')).toBe(true)
    expect(storage.getItem('deed_seq2_war')).toBe('11')
    expect(storage.getItem('deed_repairs_v2')).toBeNull()   // biggest went first
    expect(storage.getItem('deed_products')).not.toBeNull() // smaller one kept
  })

  it('never drops counters or sync bookkeeping to make room', () => {
    const storage = fakeStorage({
      limit: 80,
      seed: { deed_seq2_del: '26', deed_dirtyKeys: '["a"]', deed_saleOrders: 'z'.repeat(40) },
    })
    install(storage)
    expect(safeLocalStorageSet('deed_seq2_war', '11')).toBe(true)
    expect(storage.getItem('deed_seq2_del')).toBe('26')
    expect(storage.getItem('deed_dirtyKeys')).toBe('["a"]')
    expect(storage.getItem('deed_saleOrders')).toBeNull()
  })

  it('reports failure instead of throwing when nothing can be freed', () => {
    const storage = fakeStorage({ limit: 5 })
    install(storage)
    expect(() => safeLocalStorageSet('deed_seq2_war', 'a'.repeat(50))).not.toThrow()
    expect(safeLocalStorageSet('deed_seq2_war', 'a'.repeat(50))).toBe(false)
  })

  it('does not evict on an unrelated storage failure', () => {
    const storage = fakeStorage({ limit: 1000, seed: { deed_products: 'y'.repeat(30) } })
    storage.setItem = () => { throw new Error('storage disabled') }
    install(storage)
    expect(safeLocalStorageSet('deed_seq2_war', '11')).toBe(false)
    expect(storage.getItem('deed_products')).not.toBeNull()
  })
})
