import { describe, it, expect } from 'vitest'
import {
  normalizeOpportunityForClient,
  normalizeOpportunitiesForClient,
} from '@/lib/opportunity-normalization'

const dbRow = {
  id: 'a1b2c3d4-0000-0000-0000-000000000000',
  clientId: 'client-1',
  name: 'Fleet laptops',
  description: 'Corporate refresh',
  stage: 'new',
  closeDate: '2026-08-15T00:00:00.000Z',
  value: '250000.00',
  probability: 20,
  assignedToId: 'rep-1',
  createdById: 'rep-1',
  createdAt: '2026-07-01T09:00:00.000Z',
  client: { id: 'client-1', name: 'Acme Ltd' },
  assignedTo: { id: 'rep-1', name: 'Jane Rep' },
}

describe('normalizeOpportunityForClient — raw Prisma rows → CRM shape', () => {
  it('maps assignedToId/value/closeDate to ownerId/expectedValue/expectedCloseDate', () => {
    const opp = normalizeOpportunityForClient(dbRow)
    expect(opp.ownerId).toBe('rep-1')
    expect(opp.ownerName).toBe('Jane Rep')
    expect(opp.expectedValue).toBe(250000)
    expect(opp.expectedCloseDate).toBe('2026-08-15')
    expect(opp.companyName).toBe('Acme Ltd')
    expect(opp.companyId).toBe('client-1')
    expect(opp.ref).toMatch(/^OPP-/)
  })

  it('maps unknown/legacy DB stages onto the client pipeline stages', () => {
    expect(normalizeOpportunityForClient({ ...dbRow, stage: 'new' }).stage).toBe('prospecting')
    expect(normalizeOpportunityForClient({ ...dbRow, stage: 'won' }).stage).toBe('closed_won')
    expect(normalizeOpportunityForClient({ ...dbRow, stage: 'lost' }).stage).toBe('closed_lost')
    expect(normalizeOpportunityForClient({ ...dbRow, stage: 'weird' }).stage).toBe('prospecting')
  })

  it('falls back to createdById when the row was never assigned', () => {
    const opp = normalizeOpportunityForClient({ ...dbRow, assignedToId: null, assignedTo: null })
    expect(opp.ownerId).toBe('rep-1')
  })

  it('is a no-op for opportunities already in the client shape', () => {
    const clientOpp = {
      id: 'opp-1',
      ref: 'OPP-0001',
      name: 'Existing deal',
      clientId: 'c-1',
      companyId: 'c-1',
      companyName: 'Beta Co',
      ownerId: 'rep-2',
      ownerName: 'Bob Rep',
      stage: 'negotiation',
      probability: 60,
      expectedValue: 90000,
      expectedCloseDate: '2026-09-01',
      createdAt: '2026-06-01T08:00:00.000Z',
      createdDate: '2026-06-01',
    }
    const normalized = normalizeOpportunityForClient(clientOpp)
    expect(normalized).toMatchObject(clientOpp)
  })

  it('normalizes lists and tolerates non-array input', () => {
    expect(normalizeOpportunitiesForClient([dbRow])).toHaveLength(1)
    expect(normalizeOpportunitiesForClient(null as any)).toEqual([])
  })
})
