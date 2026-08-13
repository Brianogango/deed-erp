import { describe, it, expect } from 'vitest'
import { normalizeOpportunityForClient, opportunityMatchesOwner } from '@/lib/opportunity-normalization'

describe('normalizeOpportunityForClient', () => {
  it('maps assignedTo.username when name is missing', () => {
    const row = normalizeOpportunityForClient({
      id: 'opp-1',
      clientId: 'c1',
      client: { name: 'Acme Ltd' },
      assignedToId: 'u1',
      assignedTo: { id: 'u1', username: 'edwin.k', email: 'edwin@deed.co.ke' },
      stage: 'qualification',
      value: 50000,
      probability: 40,
    })
    expect(row.ownerId).toBe('u1')
    expect(row.ownerName).toBe('edwin.k')
    expect(row.companyName).toBe('Acme Ltd')
    expect(row.expectedValue).toBe(50000)
  })

  it('prefers assignedTo.name over username', () => {
    const row = normalizeOpportunityForClient({
      id: 'opp-2',
      assignedTo: { name: 'Edwin Kamau', username: 'edwin.k' },
      stage: 'new',
      value: 1,
    })
    expect(row.ownerName).toBe('Edwin Kamau')
    expect(row.stage).toBe('prospecting')
  })

  it('opportunityMatchesOwner accepts assignedToId when ownerId is missing', () => {
    expect(opportunityMatchesOwner({ assignedToId: 'rep-1' }, 'rep-1')).toBe(true)
    expect(opportunityMatchesOwner({ ownerId: 'rep-1' }, 'rep-1')).toBe(true)
    expect(opportunityMatchesOwner({ ownerId: 'rep-2', assignedToId: 'rep-1' }, 'rep-1')).toBe(true)
    expect(opportunityMatchesOwner({ ownerId: 'rep-2' }, 'rep-1')).toBe(false)
    expect(opportunityMatchesOwner({ ownerId: 'rep-2' }, 'all')).toBe(true)
  })
})
