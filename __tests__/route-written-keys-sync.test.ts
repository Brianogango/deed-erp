import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('server-only', () => ({}))

// The browser stays quiet about refusals for lists the server ignores on the
// general save. Those are the frozen lists minus the table-fed ones and repairs;
// keep the two files in step.
describe('route-written lists match the server', () => {
  it('lists every frozen key that the general save ignores', () => {
    const server = readFileSync('lib/server-store.ts', 'utf8')
    const frozen = [...server.match(/export const FROZEN_STORE_KEYS = new Set\(\[([^\]]+)\]/)![1].matchAll(/'([^']+)'/g)].map(m => m[1])
    const tableFed = [...server.match(/const TABLE_FED_KEYS = \[([^\]]+)\]/)![1].matchAll(/'([^']+)'/g)].map(m => m[1])
    const expected = frozen.filter(k => !tableFed.includes(k) && k !== 'deed_repairs_v2').sort()
    const client = readFileSync('lib/store-denied-message.ts', 'utf8')
    const listed = [...client.match(/const ROUTE_WRITTEN_KEYS = new Set\(\[([^\]]+)\]/)![1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort()
    expect(listed).toEqual(expected)
  })
})
