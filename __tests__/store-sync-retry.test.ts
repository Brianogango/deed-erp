import { describe, expect, it } from 'vitest'
import { nextSseRetryMs, nextSyncRetryMs, parseStoreSseData, SSE_RETRY_MIN_MS, STORE_HELLO_GRACE_MS, STORE_NOTIFY_BACKUP_POLL_MS, SYNC_RETRY_MAX_MS, SYNC_RETRY_MIN_MS } from '@/lib/store-sync-retry'

describe('sync retry backoff', () => {
  it('starts at the minimum and doubles up to the cap', () => {
    expect(nextSyncRetryMs(0)).toBe(SYNC_RETRY_MIN_MS)
    expect(nextSyncRetryMs(SYNC_RETRY_MIN_MS)).toBe(1000)
    expect(nextSyncRetryMs(16_000)).toBe(SYNC_RETRY_MAX_MS)
    expect(nextSyncRetryMs(SYNC_RETRY_MAX_MS)).toBe(SYNC_RETRY_MAX_MS)
  })

  it('backs off SSE reconnects independently', () => {
    expect(nextSseRetryMs(0)).toBe(SSE_RETRY_MIN_MS)
    expect(nextSseRetryMs(SSE_RETRY_MIN_MS)).toBe(2000)
  })
})


describe('store SSE payloads', () => {
  it('applies patched state and deed_ keys marked invalidated', () => {
    expect(parseStoreSseData(JSON.stringify({
      state: { deed_invoices: [{ id: '1' }] },
      patch: true,
      invalidated: ['deed_repairs_v2', 'ignore_me', 12],
      changedAt: { deed_repairs_v2: '2026-10-04T10:00:00.000Z', ignore_me: 'x', deed_invoices: 5 },
    }))).toEqual({
      state: { deed_invoices: [{ id: '1' }] },
      invalidated: ['deed_repairs_v2'],
      changedAt: { deed_repairs_v2: '2026-10-04T10:00:00.000Z' },
    })
  })

  it('treats malformed store events as empty so a bad packet cannot freeze sync', () => {
    expect(parseStoreSseData('{')).toEqual({ state: null, invalidated: [], changedAt: {} })
    expect(parseStoreSseData('[]')).toEqual({ state: null, invalidated: [], changedAt: {} })
  })

  
  it('uses a conservative full-state poll only when the stream transport is unhealthy', () => {
    expect(STORE_NOTIFY_BACKUP_POLL_MS).toBe(30_000)
    expect(STORE_HELLO_GRACE_MS).toBe(3_000)
  })
})
