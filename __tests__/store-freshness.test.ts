import { beforeEach, describe, expect, it } from 'vitest'
import {
  FRESH_WINDOW_MS,
  awaitStoreDownloads,
  keysChangedSinceRead,
  keysNeedingDownload,
  noteStoreChanges,
  noteStoreRead,
  resetStoreFreshness,
  trackStoreDownload,
} from '@/lib/store-freshness'

const T = (s: number) => new Date(Date.UTC(2026, 9, 4, 10, 0, s)).toISOString()

beforeEach(() => resetStoreFreshness())

describe('keysChangedSinceRead — stream replays on connect', () => {
  it('skips a change our copy was read after', () => {
    noteStoreRead(['deed_invoices'], T(30))
    expect(keysChangedSinceRead(['deed_invoices'], { deed_invoices: T(10) })).toEqual([])
  })

  it('keeps a change made after, or just before, our read', () => {
    noteStoreRead(['deed_invoices', 'deed_repairs_v2'], T(30))
    expect(keysChangedSinceRead(['deed_invoices'], { deed_invoices: T(40) })).toEqual(['deed_invoices'])
    // Within the margin: the write may not have been committed when we read.
    expect(keysChangedSinceRead(['deed_repairs_v2'], { deed_repairs_v2: T(28) })).toEqual(['deed_repairs_v2'])
  })

  it('keeps keys never downloaded or without a change time', () => {
    noteStoreRead(['deed_invoices'], T(30))
    expect(keysChangedSinceRead(['deed_serials', 'deed_invoices'], {})).toEqual(['deed_serials', 'deed_invoices'])
  })
})

describe('keysNeedingDownload — route loads', () => {
  it('skips a copy downloaded moments ago', () => {
    const now = Date.now()
    noteStoreRead(['deed_invoices'], T(30), now)
    expect(keysNeedingDownload(['deed_invoices', 'deed_serials'], now + 1000)).toEqual(['deed_serials'])
  })

  it('downloads again once the window has passed', () => {
    const now = Date.now()
    noteStoreRead(['deed_invoices'], T(30), now)
    expect(keysNeedingDownload(['deed_invoices'], now + FRESH_WINDOW_MS + 1)).toEqual(['deed_invoices'])
  })

  it('downloads again when the stream reported a later change', () => {
    const now = Date.now()
    noteStoreRead(['deed_invoices'], T(30), now)
    noteStoreChanges({ deed_invoices: T(45) })
    expect(keysNeedingDownload(['deed_invoices'], now + 1000)).toEqual(['deed_invoices'])
  })

  it('an older read never replaces a newer one', () => {
    const now = Date.now()
    noteStoreRead(['deed_invoices'], T(50), now)
    noteStoreRead(['deed_invoices'], T(10), now)
    expect(keysChangedSinceRead(['deed_invoices'], { deed_invoices: T(30) })).toEqual([])
  })
})

describe('trackStoreDownload — concurrent callers share one download', () => {
  it('waits for a running download of the same key', async () => {
    let finish!: () => void
    const work = new Promise<void>(resolve => { finish = resolve })
    trackStoreDownload(['deed_invoices'], work)
    let waited = false
    const waiting = awaitStoreDownloads(['deed_invoices']).then(() => { waited = true })
    await Promise.resolve()
    expect(waited).toBe(false)
    finish()
    await waiting
    expect(waited).toBe(true)
  })

  it('does not hang on a failed download', async () => {
    const work = Promise.reject(new Error('network'))
    trackStoreDownload(['deed_invoices'], work).catch(() => {})
    await expect(awaitStoreDownloads(['deed_invoices'])).resolves.toBeUndefined()
  })
})

describe('route hydration — notices wait for the page load', () => {
  it('resolves once the load has finished, then judges the notice against it', async () => {
    const { beginRouteHydration, endRouteHydration, awaitRouteHydration } = await import('@/lib/store-freshness')
    beginRouteHydration(['deed_serials'])
    let done = false
    const waiting = awaitRouteHydration(['deed_serials']).then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    noteStoreRead(['deed_serials'], T(30))
    endRouteHydration(['deed_serials'])
    await waiting
    expect(done).toBe(true)
    // A change from before the load is covered; one after it is not.
    expect(keysChangedSinceRead(['deed_serials'], { deed_serials: T(10) })).toEqual([])
    expect(keysChangedSinceRead(['deed_serials'], { deed_serials: T(31) })).toEqual(['deed_serials'])
  })

  it('does not wait for keys the load is not fetching', async () => {
    const { awaitRouteHydration } = await import('@/lib/store-freshness')
    await expect(awaitRouteHydration(['deed_invoices'])).resolves.toBeUndefined()
  })
})
