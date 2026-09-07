import { describe, expect, it } from 'vitest'
import {
  mergeRemoteStatePerKey,
  nextSseRetryMs,
  nextSyncRetryMs,
  SSE_RETRY_MIN_MS,
  SYNC_RETRY_MAX_MS,
  SYNC_RETRY_MIN_MS,
} from '@/lib/store-sync-retry'

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

describe('mergeRemoteStatePerKey', () => {
  it('applies every key except the ones that are pending', () => {
    const pending = new Set(['deed_invoices'])
    const applied = mergeRemoteStatePerKey(
      {
        deed_invoices: '[]',
        deed_saleOrders: '[{"id":"1"}]',
        ignored: 'nope',
      },
      key => pending.has(key),
    )
    expect(applied.map(([key]) => key)).toEqual(['deed_saleOrders'])
  })
})
