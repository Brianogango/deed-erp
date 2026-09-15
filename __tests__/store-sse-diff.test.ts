import { describe, expect, it } from 'vitest'
import {
  pickChangedSseKeys,
  splitSseBroadcastState,
  SSE_FALLBACK_POLL_MS,
  SSE_MAX_KEY_BYTES,
} from '@/lib/store-sse-diff'

describe('pickChangedSseKeys', () => {
  const hash = (value: unknown) => JSON.stringify(value)

  it('sends only keys whose payload hash changed', () => {
    const last: Record<string, string> = {}
    const first = pickChangedSseKeys(
      { deed_invoices: [{ id: '1' }], deed_quotes: [{ id: 'q' }] },
      last,
      hash,
    )
    expect(Object.keys(first).sort()).toEqual(['deed_invoices', 'deed_quotes'])

    const second = pickChangedSseKeys(
      { deed_invoices: [{ id: '1' }], deed_quotes: [{ id: 'q2' }] },
      last,
      hash,
    )
    expect(Object.keys(second)).toEqual(['deed_quotes'])
    expect(second.deed_quotes).toEqual([{ id: 'q2' }])
  })

  it('returns empty when the overlap window repeats the same bytes', () => {
    const last: Record<string, string> = { deed_invoices: hash([{ id: '1' }]) }
    const next = pickChangedSseKeys({ deed_invoices: [{ id: '1' }] }, last, hash)
    expect(next).toEqual({})
  })

  it('keeps small keys in the SSE body and lists oversized keys for refetch', () => {
    const small = { id: '1' }
    const huge = 'x'.repeat(SSE_MAX_KEY_BYTES + 8)
    const { lean, invalidated } = splitSseBroadcastState({
      deed_expenses: small,
      deed_repairs_v2: huge,
    })
    expect(lean).toEqual({ deed_expenses: small })
    expect(invalidated).toEqual(['deed_repairs_v2'])
  })

  it('still reports invalidated keys when every changed blob is too large', () => {
    const huge = { blob: 'x'.repeat(SSE_MAX_KEY_BYTES + 8) }
    const { lean, invalidated } = splitSseBroadcastState({ deed_invoices: huge })
    expect(lean).toEqual({})
    expect(invalidated).toEqual(['deed_invoices'])
  })

  it('falls back faster than a minute when LISTEN misses a notify', () => {
    expect(SSE_FALLBACK_POLL_MS).toBe(8_000)
    expect(SSE_FALLBACK_POLL_MS).toBeLessThan(60_000)
  })
})
