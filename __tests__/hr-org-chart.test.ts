import { describe, expect, it } from 'vitest'
import { buildOrgTree, type OrgEmployee } from '@/lib/hr/org-chart'

const e = (id: string, name: string, manager?: string, status = 'active'): OrgEmployee => ({ id, fullName: name, managerEmployeeId: manager, status })

describe('org chart', () => {
  it('nests reports under their manager and counts everyone below', () => {
    const tree = buildOrgTree([e('d', 'Director'), e('a', 'Ann', 'd'), e('b', 'Bob', 'd'), e('c', 'Cy', 'a')])
    expect(tree).toHaveLength(1)
    expect(tree[0].employee.id).toBe('d')
    expect(tree[0].totalBelow).toBe(3)
    expect(tree[0].reports.map(r => r.employee.id)).toEqual(['a', 'b'])
    expect(tree[0].reports[0].reports[0].employee.id).toBe('c')
  })

  it('makes people with no, unknown or exited managers into roots', () => {
    const tree = buildOrgTree([e('x', 'Xena'), e('y', 'Yan', 'ghost'), e('z', 'Zed', 'gone'), e('gone', 'Gone', undefined, 'exited')])
    expect(tree.map(r => r.employee.id).sort()).toEqual(['x', 'y', 'z'])
  })

  it('does not lose anyone or loop forever when managers point at each other', () => {
    const tree = buildOrgTree([e('p', 'Pat', 'q'), e('q', 'Quin', 'p'), e('s', 'Sam', 's')])
    const ids: string[] = []
    const walk = (n: (typeof tree)[number]) => { ids.push(n.employee.id); n.reports.forEach(walk) }
    tree.forEach(walk)
    expect(ids.sort()).toEqual(['p', 'q', 's'])
  })
})
