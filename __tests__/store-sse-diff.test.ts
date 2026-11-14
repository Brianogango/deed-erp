import { describe, expect, it } from 'vitest'
import { SSE_FALLBACK_POLL_MS } from '@/lib/store-sse-diff'

describe('pickChangedSseKeys', () => {
  
  
  
  
  
  it('falls back faster than a minute when LISTEN misses a notify', () => {
    expect(SSE_FALLBACK_POLL_MS).toBe(8_000)
    expect(SSE_FALLBACK_POLL_MS).toBeLessThan(60_000)
  })
})
