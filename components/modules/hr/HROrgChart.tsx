'use client'
import { useMemo, useState } from 'react'
import { useHrStore } from '@/hooks/useHrStore'
import { buildOrgTree, type OrgNode } from '@/lib/hr/org-chart'

function Node({ node, depth }: { node: OrgNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const e = node.employee
  const hasReports = node.reports.length > 0
  return (
    <li className="org-node" style={{ listStyle: 'none' }}>
      <div className="flex items-center gap-3 rounded-xl p-2.5 my-1" style={{ border: '1px solid var(--border-lt)', background: 'var(--bg-card)', maxWidth: 520 }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)' }}>
          {e.fullName.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold truncate" style={{ color: 'var(--text-1)' }}>{e.fullName}</p>
          <p className="text-[10px] truncate" style={{ color: 'var(--text-4)' }}>{[e.jobTitle, e.departmentId].filter(Boolean).join(' · ') || '—'}</p>
        </div>
        {hasReports && (
          <button type="button" className="btn-outline text-[10px]" onClick={() => setOpen(o => !o)} aria-expanded={open}>
            {open ? 'Hide' : 'Show'} {node.totalBelow}
          </button>
        )}
      </div>
      {hasReports && open && (
        <ul style={{ paddingLeft: 28, borderLeft: '2px solid var(--border-lt)', marginLeft: 18 }}>
          {node.reports.map(r => <Node key={r.employee.id} node={r} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  )
}

/** Who reports to whom. Set "Reports to" on each employee profile to build it. */
export default function HROrgChart() {
  const { employees } = useHrStore()
  const tree = useMemo(() => buildOrgTree(employees), [employees])
  const withManager = employees.filter(e => e.status !== 'exited' && e.managerEmployeeId).length
  return (
    <div className="hr-submodule hr-org-chart p-4 flex flex-col gap-3">
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
        {withManager} of {employees.filter(e => e.status !== 'exited').length} active employees have a manager set.
        {withManager === 0 && ' Open an employee, choose Edit, and fill in "Reports to" to build the chart.'}
      </p>
      {tree.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-4)' }}>No employees yet</p> : <ul style={{ margin: 0, padding: 0 }}>{tree.map(n => <Node key={n.employee.id} node={n} depth={0} />)}</ul>}
    </div>
  )
}
