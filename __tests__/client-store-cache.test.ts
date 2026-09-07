import { describe, expect, it } from 'vitest'
import { CLIENT_STORE_PERSIST_MAX_BYTES } from '@/lib/client-store-cache'

describe('client store persist cap', () => {
  it('is large enough for current production repairs and products blobs', () => {
    expect(CLIENT_STORE_PERSIST_MAX_BYTES).toBeGreaterThan(1024 * 1024)
    expect(CLIENT_STORE_PERSIST_MAX_BYTES).toBeLessThanOrEqual(2 * 1024 * 1024)
  })
})
