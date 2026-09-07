import { describe, expect, it } from 'vitest'
import { pickChangedSseKeys } from '@/lib/store-sse-diff'

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
})
