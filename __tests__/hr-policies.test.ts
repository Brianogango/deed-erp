import { describe, expect, it } from 'vitest'
import { policyCoverage, policyVersion } from '@/lib/hr/policies'

const p1 = { id: 'p1', title: 'Code of conduct', updatedAt: '2026-01-10T00:00:00Z' }
const p2 = { id: 'p2', title: 'Leave policy', updatedAt: '2026-03-01T00:00:00Z' }
const emps = [{ id: 'a', fullName: 'Ann' }, { id: 'b', fullName: 'Bob' }, { id: 'x', fullName: 'Gone', status: 'exited' }]

describe('policy acknowledgements', () => {
  
  
  it('reports coverage over active staff and who is missing', () => {
    const acks = [{ employeeId: 'a', policyId: 'p1', policyVersion: policyVersion(p1) }]
    const [c1, c2] = policyCoverage([p1, p2], acks, emps)
    expect(c1).toMatchObject({ acknowledged: 1, total: 2, missing: ['Bob'] })
    expect(c2).toMatchObject({ acknowledged: 0, total: 2, missing: ['Ann', 'Bob'] })
  })
})
