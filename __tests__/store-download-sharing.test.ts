import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal browser surface used by client-store-hydrate.
const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
      removeItem: (k: string) => { storage.delete(k) },
    },
    dispatchEvent: () => true,
  })
  vi.stubGlobal('localStorage', (globalThis as any).window.localStorage)
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init?: unknown) {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const respond = (keys: string[]) => new Response(
  JSON.stringify(Object.fromEntries(keys.map(k => [k, [{ id: `${k}-1` }]]))),
  { status: 200, headers: { 'x-store-read-at': new Date().toISOString() } },
)
const requestedKeys = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([url]) => decodeURIComponent(String(url).split('keys=')[1]).split(','))

describe('fetchAndApplyStoreKeys — one download per collection', () => {
  it('two callers starting together download a shared key once', async () => {
    const fetchMock = vi.fn(async (url: string) => respond(decodeURIComponent(url.split('keys=')[1]).split(',')))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAndApplyStoreKeys } = await import('@/lib/client-store-hydrate')
    await Promise.all([
      fetchAndApplyStoreKeys({ keys: ['deed_saleOrders', 'deed_invoices'], etagStorageKey: 'a' }),
      fetchAndApplyStoreKeys({ keys: ['deed_saleOrders', 'deed_deliveries'], etagStorageKey: 'b' }),
    ])
    const all = requestedKeys(fetchMock).flat()
    expect(all.filter(k => k === 'deed_saleOrders')).toHaveLength(1)
    expect(all.sort()).toEqual(['deed_deliveries', 'deed_invoices', 'deed_saleOrders'])
  })

  it('a key downloaded moments ago is not downloaded again', async () => {
    const fetchMock = vi.fn(async (url: string) => respond(decodeURIComponent(url.split('keys=')[1]).split(',')))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAndApplyStoreKeys } = await import('@/lib/client-store-hydrate')
    await fetchAndApplyStoreKeys({ keys: ['deed_invoices'], etagStorageKey: 'a' })
    expect(await fetchAndApplyStoreKeys({ keys: ['deed_invoices'], etagStorageKey: 'b' })).toBe('not-modified')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetches a key itself when the download it waited on fails', async () => {
    let first = true
    const fetchMock = vi.fn(async (url: string) => {
      const keys = decodeURIComponent(url.split('keys=')[1]).split(',')
      if (first) { first = false; await new Promise(r => setTimeout(r, 5)); throw new DOMException('aborted', 'AbortError') }
      return respond(keys)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAndApplyStoreKeys } = await import('@/lib/client-store-hydrate')
    const cancelled = fetchAndApplyStoreKeys({ keys: ['deed_repairs_v2'], etagStorageKey: 'a' }).catch(() => 'cancelled')
    const waiting = fetchAndApplyStoreKeys({ keys: ['deed_repairs_v2'], etagStorageKey: 'b' })
    expect(await cancelled).toBe('cancelled')
    await waiting
    expect(requestedKeys(fetchMock)).toEqual([['deed_repairs_v2'], ['deed_repairs_v2']])
  })

  it('a return visit sends the versions it holds and keeps collections the server says are unchanged', async () => {
    const sentHave: Array<Record<string, string>> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const keys = decodeURIComponent(url.split('keys=')[1]).split(',')
      const have = JSON.parse((init?.headers as Record<string, string>)['x-store-have'] || '{}')
      sentHave.push(have)
      const invoicesVersion = sentHave.length === 1 ? 'v1#me' : 'v2#me'
      const versions = Object.fromEntries(keys.map(k => [k, k === 'deed_invoices' ? invoicesVersion : 'v1#me']))
      const unchanged = keys.filter(k => have[k] === versions[k])
      const body: Record<string, unknown> = { versions, unchanged }
      for (const k of keys) if (!unchanged.includes(k)) body[k] = [{ id: `${k}-1` }]
      return new Response(JSON.stringify(body), { status: 200, headers: { 'x-store-read-at': new Date().toISOString() } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAndApplyStoreKeys } = await import('@/lib/client-store-hydrate')
    const { FRESH_WINDOW_MS } = await import('@/lib/store-freshness')
    await fetchAndApplyStoreKeys({ keys: ['deed_repairs_v2', 'deed_invoices'], etagStorageKey: 'route' })
    const realNow = Date.now
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + FRESH_WINDOW_MS + 1000)
    // Server-side, invoices changed (v1 -> v2); repairs did not.
    const result = await fetchAndApplyStoreKeys({ keys: ['deed_repairs_v2', 'deed_invoices'], etagStorageKey: 'route' })
    expect(sentHave[0]).toEqual({})
    expect(sentHave[1]).toEqual({ deed_repairs_v2: 'v1#me', deed_invoices: 'v1#me' })
    expect(result).toBe('applied')
    const third = await (async () => {
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 2 * FRESH_WINDOW_MS + 2000)
      return fetchAndApplyStoreKeys({ keys: ['deed_repairs_v2', 'deed_invoices'], etagStorageKey: 'route' })
    })()
    expect(sentHave[2]).toEqual({ deed_repairs_v2: 'v1#me', deed_invoices: 'v2#me' })
    expect(third).toBe('not-modified')
  })
})
