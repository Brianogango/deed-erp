import { describe, expect, it, vi } from 'vitest'
import { gunzipSync } from 'node:zlib'
vi.mock('server-only', () => ({}))
import { compressedJson } from '@/lib/http/compressed-json'

const big = JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `Customer ${i}` })) })
const req = (enc?: string) => new Request('http://x/api/store', { headers: enc ? { 'accept-encoding': enc } : {} })

describe('compressedJson', () => {
  it('gzips a large body when the browser accepts gzip', async () => {
    const res = await compressedJson(req('gzip, deflate, br'), big, { headers: { ETag: '"v1"', Vary: 'x-store-have' } })
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toBe('x-store-have, Accept-Encoding')
    expect(res.headers.get('etag')).toBe('"v1"')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBeLessThan(big.length / 3)
    expect(gunzipSync(body).toString()).toBe(big)
  })

  it('sends plain JSON when gzip is not accepted or the body is small', async () => {
    for (const [r, json] of [[req(), big], [req('gzip'), '{"a":1}']] as const) {
      const res = await compressedJson(r, json)
      expect(res.headers.get('content-encoding')).toBeNull()
      expect(await res.text()).toBe(json)
      expect(res.headers.get('content-type')).toBe('application/json')
    }
  })
})
