'use client'
import { useEffect, useMemo, useState } from 'react'
import { useHrStore } from '@/hooks/useHrStore'
import { buildOrgTree, type OrgNode } from '@/lib/hr/org-chart'
import { avatarColor } from './HREmployeeProfile'

const initials = (n: string) => n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()

/**
 * HR mock I: who reports to whom as a real tree. People with no manager (and
 * nobody under them) wait in a tray; pick a person, then pick their manager —
 * or set a whole department at once.
 */
export default function HROrgChart({ canManage = true }: { canManage?: boolean }) {
  const { employees, updateEmployee } = useHrStore()
  const [picked, setPicked] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [trayAll, setTrayAll] = useState(false)
  const [byDept, setByDept] = useState<{ dept: string; manager: string } | null>(null)

  const active = useMemo(() => employees.filter(e => e.status !== 'exited'), [employees])
  const forest = useMemo(() => buildOrgTree(employees), [employees])
  const tops = forest.filter(n => n.reports.length > 0)
  const tray = forest.filter(n => n.reports.length === 0).map(n => n.employee)
  const pickedEmp = active.find(e => e.id === picked)
  const depts = useMemo(() => [...new Set(tray.map(e => e.departmentId).filter(Boolean) as string[])].sort(), [tray])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicked(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Would making `managerId` the manager of `who` create a loop?
  const below = (who: string, managerId: string) => {
    let cur = active.find(e => e.id === managerId)
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      if (cur.id === who) return true
      seen.add(cur.id)
      cur = cur.managerEmployeeId ? active.find(e => e.id === cur!.managerEmployeeId) : undefined
    }
    return false
  }

  const choose = (id: string) => {
    if (!canManage) return
    if (!picked) { setPicked(id); return }
    if (picked === id) { setPicked(null); return }
    if (below(picked, id)) return
    updateEmployee(picked, { managerEmployeeId: id })
    setPicked(null); setHover(null)
  }

  const card = (e: { id: string; fullName: string; jobTitle?: string }, sub: string, top = false) => {
    const isPicked = picked === e.id
    const target = !!picked && !isPicked && !below(picked, e.id)
    return (
      <button type="button" className={`hri-node${top ? ' is-top' : ''}${isPicked ? ' is-picked' : ''}${target ? ' is-target' : ''}`}
        disabled={!canManage || (!!picked && !isPicked && !target)}
        onClick={() => choose(e.id)} onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(h => (h === e.id ? null : h))}
        title={picked ? (isPicked ? 'Cancel' : `${pickedEmp?.fullName} reports to ${e.fullName}`) : 'Pick to change who they report to'}>
        <span className="hri-av" style={{ background: avatarColor(e.fullName) }}>{initials(e.fullName)}</span>
        <div><b>{e.fullName}</b><small>{sub}</small></div>
      </button>
    )
  }

  const drop = (managerId: string) => (pickedEmp && hover === managerId && pickedEmp.managerEmployeeId !== managerId ? (
    <><div className="hri-vline" /><div className="hri-node is-drop"><span className="hri-av">+</span><div><b>{pickedEmp.fullName}</b><small>will report here</small></div></div></>
  ) : null)

  const branch = (n: OrgNode, top = false): React.ReactNode => {
    const e = n.employee
    const sub = [e.jobTitle, `${n.reports.length} direct`].filter(Boolean).join(' · ')
    const leafSub = e.jobTitle || e.departmentId || '—'
    return (
      <>
        {card(e, n.reports.length ? sub : leafSub, top)}
        {n.reports.length === 1 && !n.reports[0].reports.length ? (
          <><div className="hri-vline" />{card(n.reports[0].employee, n.reports[0].employee.jobTitle || '—')}{drop(n.reports[0].employee.id)}{drop(e.id)}</>
        ) : n.reports.length > 0 ? (
          <>
            <div className="hri-vline" />
            <div className="hri-row">
              {n.reports.map(r => <div key={r.employee.id} className="hri-col">{branch(r)}</div>)}
            </div>
            {drop(e.id)}
          </>
        ) : drop(e.id)}
      </>
    )
  }

  const shownTray = trayAll ? tray : tray.slice(0, 8)
  const applyDept = () => {
    if (!byDept?.dept || !byDept.manager) return
    for (const e of tray) if (e.departmentId === byDept.dept && e.id !== byDept.manager) updateEmployee(e.id, { managerEmployeeId: byDept.manager })
    setByDept(null)
  }

  return (
    <section className="hra-card hri">
      <div className="hra-ch">
        <b className="hrc-title">Who reports to whom</b>
        <span className="hri-muted">{picked ? <>Now pick who <b>{pickedEmp?.fullName}</b> reports to · <button type="button" className="hrh-link" onClick={() => setPicked(null)}>Cancel</button></> : 'Approvals for leave and attendance go up these lines'}</span>
      </div>

      <div className="hri-org">
        {tops.length === 0
          ? <p className="hri-muted hri-empty">No reporting lines yet. Pick someone below, then pick their manager.</p>
          : <div className="hri-row is-tops">{tops.map(n => <div key={n.employee.id} className="hri-col">{branch(n, true)}</div>)}</div>}
      </div>

      {tray.length > 0 && (
        <div className="hri-tray">
          <div className="hri-tray__head">
            <div>
              <b>{tray.length} {tray.length === 1 ? 'person has' : 'people have'} no manager yet</b>
              <div className="hri-muted">Pick a person, then pick their manager — or set a whole department at once</div>
            </div>
            {canManage && depts.length > 0 && <button type="button" className="hrb-btn" onClick={() => setByDept(byDept ? null : { dept: depts[0], manager: '' })}>Set by department</button>}
          </div>
          {byDept && (
            <div className="hri-dept">
              <label>Everyone in <select value={byDept.dept} onChange={e => setByDept({ ...byDept, dept: e.target.value })}>{depts.map(d => <option key={d} value={d}>{d} ({tray.filter(e => e.departmentId === d).length})</option>)}</select></label>
              <label>reports to <select value={byDept.manager} onChange={e => setByDept({ ...byDept, manager: e.target.value })}><option value="">Pick a manager…</option>{active.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}</select></label>
              <button type="button" className="hrb-btn is-p" disabled={!byDept.manager} onClick={applyDept}>Set</button>
            </div>
          )}
          <div className="hri-chips">
            {shownTray.map(e => {
              const isPicked = picked === e.id
              const target = !!picked && !isPicked
              return (
                <button key={e.id} type="button" className={`hri-pch${isPicked ? ' is-picked' : ''}${target ? ' is-target' : ''}`} disabled={!canManage} onClick={() => choose(e.id)}>
                  <span className="hri-av" style={{ background: avatarColor(e.fullName) }}>{initials(e.fullName)}</span>
                  {e.fullName}{isPicked && e.departmentId ? ` · ${e.departmentId}` : ''}
                </button>
              )
            })}
            {tray.length > 8 && <button type="button" className="hri-pch is-more" onClick={() => setTrayAll(v => !v)}>{trayAll ? 'Show less' : `+ ${tray.length - 8} more`}</button>}
          </div>
        </div>
      )}
    </section>
  )
}
