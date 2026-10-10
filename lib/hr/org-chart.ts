/** Reporting lines for the org chart. Tolerates missing, inactive and circular managers. */

export interface OrgEmployee {
  id: string
  fullName: string
  jobTitle?: string
  departmentId?: string
  status?: string
  managerEmployeeId?: string
}

export interface OrgNode {
  employee: OrgEmployee
  reports: OrgNode[]
  /** Everyone below this person, at any depth. */
  totalBelow: number
}

/**
 * Build the reporting forest from active employees. Anyone whose manager is missing,
 * exited, or part of a loop becomes a root, so nobody disappears from the chart.
 */
export function buildOrgTree(employees: OrgEmployee[]): OrgNode[] {
  const active = employees.filter(e => e.status !== 'exited')
  const byId = new Map(active.map(e => [e.id, e]))
  const children = new Map<string, OrgEmployee[]>()
  const roots: OrgEmployee[] = []

  // Break loops: walk up from each person; if we meet ourselves again, make this person a root.
  const loops = (start: OrgEmployee) => {
    const seen = new Set<string>([start.id])
    let cur = start.managerEmployeeId ? byId.get(start.managerEmployeeId) : undefined
    while (cur) {
      if (seen.has(cur.id)) return true
      seen.add(cur.id)
      cur = cur.managerEmployeeId ? byId.get(cur.managerEmployeeId) : undefined
    }
    return false
  }

  for (const e of active) {
    const mgr = e.managerEmployeeId && e.managerEmployeeId !== e.id ? byId.get(e.managerEmployeeId) : undefined
    if (!mgr || loops(e)) roots.push(e)
    else children.set(mgr.id, [...(children.get(mgr.id) ?? []), e])
  }

  const byName = (a: OrgEmployee, b: OrgEmployee) => a.fullName.localeCompare(b.fullName)
  const build = (e: OrgEmployee, depth: number): OrgNode => {
    const reports = depth > 25 ? [] : (children.get(e.id) ?? []).sort(byName).map(c => build(c, depth + 1))
    return { employee: e, reports, totalBelow: reports.reduce((s, r) => s + 1 + r.totalBelow, 0) }
  }
  // People who lead a team come first, then alphabetical.
  return roots
    .sort((a, b) => (children.get(b.id)?.length ?? 0) - (children.get(a.id)?.length ?? 0) || byName(a, b))
    .map(r => build(r, 0))
}
