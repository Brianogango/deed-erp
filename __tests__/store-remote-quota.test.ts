import { describe, expect, it, vi, beforeEach } from 'vitest'
import { safeLocalStorageSet } from '@/lib/client-store-cache'

/**
 * The SSE apply loop used to call window.localStorage.setItem directly with no
 * try/catch. One quota throw aborted the whole pass, skipped every remaining
 * key, and escaped into the EventSource listener — which is how a full browser
 * cache turned into "the ERP stopped seeing new records" for a whole session.
 *
 * These cover the contract the loop now relies on: the cache write is allowed
 * to fail, and failing must not throw.
 */

function makeStorage(opts: { failOn?: (key: string) => boolean } = {}) {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => { data.delete(k) },
    setItem: (k: string, v: string) => {
      if (opts.failOn?.(k)) {
        const err: any = new Error('quota')
        err.name = 'QuotaExceededError'
        throw err
      }
      data.set(k, v)
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size },
    data,
  }
}

beforeEach(() => { vi.unstubAllGlobals() })

describe('remote key cache writes', () => {
  it('reports failure instead of throwing when the key cannot be stored', () => {
    const localStorage = makeStorage({ failOn: () => true })
    vi.stubGlobal('window', { localStorage })
    expect(() => safeLocalStorageSet('deed_auditLogs', 'x')).not.toThrow()
    expect(safeLocalStorageSet('deed_auditLogs', 'x')).toBe(false)
  })

  it('still stores the keys that fit when one key is too large', () => {
    const localStorage = makeStorage({ failOn: (k) => k === 'deed_auditLogs' })
    vi.stubGlobal('window', { localStorage })

    const results = ['deed_repairs_v2', 'deed_auditLogs', 'deed_saleOrders']
      .map(key => ({ key, ok: safeLocalStorageSet(key, '[]') }))

    // The oversized key fails on its own; the keys after it are unaffected.
    expect(results).toEqual([
      { key: 'deed_repairs_v2', ok: true },
      { key: 'deed_auditLogs', ok: false },
      { key: 'deed_saleOrders', ok: true },
    ])
    expect(localStorage.data.get('deed_saleOrders')).toBe('[]')
  })
})
