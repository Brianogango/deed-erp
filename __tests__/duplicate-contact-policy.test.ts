import { describe, expect, it } from 'vitest'
import {
  isObviousDuplicatePair,
  pickKeepContact,
} from '@/lib/crm/duplicate-contact-policy'

describe('duplicate contact policy', () => {
  it('keeps the real customer over an RFQ subject', () => {
    const keep = pickKeepContact([
      {
        id: 'rfq',
        name: 'Need 10 laptops RFQ',
        createdAt: '2026-01-01T00:00:00.000Z',
        leadCount: 8,
      },
      {
        id: 'real',
        name: 'Acme Ltd',
        createdAt: '2026-06-01T00:00:00.000Z',
        leadCount: 1,
      },
    ])
    expect(keep?.id).toBe('real')
  })

  it('treats an RFQ-titled row as an obvious duplicate of the company', () => {
    expect(isObviousDuplicatePair(
      { id: 'real', name: 'Acme Ltd', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'rfq', name: 'Quote for 20 ThinkPads', createdAt: '2026-02-01T00:00:00.000Z' },
    )).toBe(true)
  })

  it('does not auto-merge two different people who share a phone', () => {
    expect(isObviousDuplicatePair(
      { id: 'a', name: 'John Mwangi', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', name: 'Jane Wanjiku', createdAt: '2026-02-01T00:00:00.000Z' },
    )).toBe(false)
  })

  it('auto-merges the same customer stored twice', () => {
    expect(isObviousDuplicatePair(
      { id: 'a', name: 'Safaricom PLC', companyName: 'Safaricom', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', name: 'safaricom plc', createdAt: '2026-02-01T00:00:00.000Z' },
    )).toBe(true)
  })
})
