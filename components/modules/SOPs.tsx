'use client'
import { useState, useMemo, useEffect } from 'react'
import {
  useApp, fmtKes,
  SOP, SOPMetric, SOPMetricType, SOPTargetDir,
  SOP_METRIC_TYPES,
} from '@/lib/store'
import { StatCard, ModuleSkeleton } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faBullseye, faCircleCheck, faTriangleExclamation, faUserSlash } from '@fortawesome/free-solid-svg-icons'

// ── Period helpers ────────────────────────────────────────────────────────────

function currentPeriodKey(period: SOP['period']): string {
  const n = new Date()
  if (period === 'monthly')   return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  if (period === 'quarterly') return `${n.getFullYear()}-Q${Math.ceil((n.getMonth() + 1) / 3)}`
  // ISO week
  const d = new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d.getTime() - y1.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`
}

function periodBounds(key: string, period: SOP['period']): { start: string; end: string } {
  if (period === 'weekly') {
    const [yr, wk] = key.replace('W', '').split('-').map(Number)
    const jan4 = new Date(yr, 0, 4)
    const ms = jan4.getTime() + (wk - 1) * 7 * 86400000 - ((jan4.getDay() + 6) % 7) * 86400000
    return {
      start: new Date(ms).toISOString().slice(0, 10),
      end:   new Date(ms + 6 * 86400000).toISOString().slice(0, 10),
    }
  }
  if (period === 'quarterly') {
    const [yr, q] = key.split('-Q').map(Number)
    const sm = (q - 1) * 3
    return {
      start: new Date(yr, sm, 1).toISOString().slice(0, 10),
      end:   new Date(yr, sm + 3, 0).toISOString().slice(0, 10),
    }
  }
  const [yr, mo] = key.split('-').map(Number)
  return {
    start: `${yr}-${String(mo).padStart(2, '0')}-01`,
    end:   new Date(yr, mo, 0).toISOString().slice(0, 10),
  }
}

function prevPeriodKeys(period: SOP['period'], count = 5): string[] {
  const keys: string[] = []
  const n = new Date()
  for (let i = 1; i <= count; i++) {
    if (period === 'monthly') {
      const d = new Date(n.getFullYear(), n.getMonth() - i, 1)
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    } else if (period === 'quarterly') {
      const q = Math.ceil((n.getMonth() + 1) / 3)
      const offset = q - i
      const yr = n.getFullYear() + Math.floor((offset - 1) / 4)
      const qn  = ((offset - 1 + 400) % 4) + 1
      keys.push(`${yr}-Q${qn}`)
    } else {
      keys.push(currentPeriodKey('weekly')) // simplified for weekly
    }
  }
  return keys
}

function fmtPeriodKey(key: string): string {
  if (key.includes('-W')) return `Week ${key.split('-W')[1]}, ${key.split('-W')[0]}`
  if (key.includes('-Q')) return `Q${key.split('-Q')[1]} ${key.split('-Q')[0]}`
  const [yr, mo] = key.split('-')
  return new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
}

// ── Auto-evaluation ───────────────────────────────────────────────────────────

interface EvalInput {
  repairs:        ReturnType<typeof useApp>['repairs']
  expenses:       ReturnType<typeof useApp>['expenses']
  outsourceJobs:  ReturnType<typeof useApp>['outsourceJobs']
  leaveRequests:  ReturnType<typeof useApp>['leaveRequests']
  employees:      ReturnType<typeof useApp>['employees']
  sopActuals:     ReturnType<typeof useApp>['sopActuals']
  saleOrders:     ReturnType<typeof useApp>['saleOrders']
}

function evalMetric(
  metric: SOPMetric,
  sopId: string,
  userId: string,
  periodKey: string,
  period: SOP['period'],
  data: EvalInput,
): number {
  const { start, end } = periodBounds(periodKey, period)
  const inPeriod = (d?: string) => !!d && d >= start && d <= end

  switch (metric.metricType) {
    case 'repairs_completed':
      return data.repairs.filter(r =>
        r.assignedTechnicianId === userId &&
        ['closed', 'delivered'].includes(r.status) &&
        inPeriod(r.repairCompletedDate ?? r.intakeDate)
      ).length

    case 'repairs_diagnosed':
      return data.repairs.filter(r =>
        r.assignedTechnicianId === userId &&
        r.diagnosis != null &&
        inPeriod(r.diagnosis.diagnosedDate)
      ).length

    case 'repairs_received':
      return data.repairs.filter(r => inPeriod(r.intakeDate)).length

    case 'outsource_sent':
      return data.outsourceJobs.filter(j => j.sentByUserId === userId && inPeriod(j.sentDate)).length

    case 'sales_orders':
      return data.saleOrders.filter(s =>
        s.createdByUserId === userId &&
        ['confirmed', 'delivered', 'invoiced'].includes(s.status) &&
        inPeriod(s.date)
      ).length

    case 'sales_revenue':
      return data.saleOrders.filter(s =>
        s.createdByUserId === userId &&
        ['confirmed', 'delivered', 'invoiced'].includes(s.status) &&
        inPeriod(s.date)
      ).reduce((sum, s) => sum + s.total, 0)

    case 'quotes_created':
      return data.saleOrders.filter(s =>
        s.createdByUserId === userId &&
        inPeriod(s.date)
      ).length

    case 'expenses_amount':
      return data.expenses.filter(e =>
        e.submittedByUserId === userId && inPeriod(e.expenseDate)
      ).reduce((s, e) => s + e.amount, 0)

    case 'expenses_count':
      return data.expenses.filter(e =>
        e.submittedByUserId === userId && inPeriod(e.expenseDate)
      ).length

    case 'leave_days': {
      const emp = data.employees.find(e => e.userId === userId)
      if (!emp) return 0
      return data.leaveRequests.filter(r =>
        r.employeeId === emp.id &&
        r.status === 'approved' &&
        inPeriod(r.startDate)
      ).reduce((s, r) => s + r.days, 0)
    }

    case 'custom': {
      const entry = data.sopActuals.find(
        a => a.sopId === sopId && a.metricId === metric.id && a.periodKey === periodKey
      )
      return entry?.actual ?? 0
    }

    default:
      return 0
  }
}

function isMetMet(actual: number, target: number, dir: SOPTargetDir) {
  return dir === 'min' ? actual >= target : actual <= target
}

function pct(actual: number, target: number, dir: SOPTargetDir): number {
  if (target === 0) return 100
  if (dir === 'min') return Math.min(100, Math.round((actual / target) * 100))
  // for max: 100% = within budget, going over shows as over
  return Math.min(100, Math.round((actual / target) * 100))
}

function fmtVal(v: number, unit: string) {
  if (unit === 'KSh') return fmtKes(v)
  return `${v.toLocaleString()} ${unit}`
}

// ── Colours ───────────────────────────────────────────────────────────────────

function metricColor(actual: number, target: number, dir: SOPTargetDir) {
  const p = target === 0 ? 100 : (actual / target) * 100
  if (isMetMet(actual, target, dir)) return { bar: '#10B981', text: '#065F46', bg: '#DCFCE7', border: '#A7F3D0' }
  if (dir === 'min') {
    if (p >= 70) return { bar: '#F59E0B', text: '#854D0E', bg: '#FEF9C3', border: '#FDE68A' }
    return { bar: '#EF4444', text: '#991B1B', bg: '#FEE2E2', border: '#FECACA' }
  }
  // max: going over budget
  if (p <= 85) return { bar: '#10B981', text: '#065F46', bg: '#DCFCE7', border: '#A7F3D0' }
  if (p <= 100) return { bar: '#F59E0B', text: '#854D0E', bg: '#FEF9C3', border: '#FDE68A' }
  return { bar: '#EF4444', text: '#991B1B', bg: '#FEE2E2', border: '#FECACA' }
}

const uid = () => Math.random().toString(36).slice(2, 9)

// ── Main Component ────────────────────────────────────────────────────────────

export default function SOPs() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const {
    users, currentUserId, repairs, expenses, outsourceJobs,
    leaveRequests, employees, sopActuals, saleOrders,
    sops, createSOP, updateSOP, deleteSOP, setSopActual,
    showToast,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  
  const canViewTeamHR  = ['director', 'finance_officer', 'technical_lead'].includes(currentUser?.role ?? '')
  const canEditTargets = currentUser?.role === 'director'
  const isAdmin        = currentUser?.role === 'director'

  const evalData: EvalInput = { repairs, expenses, outsourceJobs, leaveRequests, employees, sopActuals, saleOrders }

  // My SOP (if not admin, or admin viewing their own)
  const mySOP = sops.find(s => s.userId === currentUserId && s.active)

  const [tab, setTab] = useState<'overview' | 'manage' | 'my'>(canViewTeamHR ? 'overview' : 'my')

  // ── Admin: Overview ──
  const [selectedSopId, setSelectedSopId] = useState<string | null>(null)

  // ── Admin: Manage / Create ──
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editSopId, setEditSopId]             = useState<string | null>(null)
  const [sopUserId, setSopUserId]             = useState(users[0]?.id ?? '')
  const [sopPeriod, setSopPeriod]             = useState<SOP['period']>('monthly')
  const [sopNotes, setSopNotes]               = useState('')
  const [sopMetrics, setSopMetrics]           = useState<SOPMetric[]>([])

  // ── Update custom actual modal ──
  const [updatingActual, setUpdatingActual] = useState<{ sop: SOP; metric: SOPMetric; periodKey: string } | null>(null)
  const [actualValue, setActualValue]       = useState('')
  const [actualNote, setActualNote]         = useState('')

  // ── History period ──
  const [histPeriod, setHistPeriod] = useState<string | null>(null)

  // ────────────────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditSopId(null)
    setSopUserId(users[0]?.id ?? '')
    setSopPeriod('monthly')
    setSopNotes('')
    setSopMetrics([{ id: uid(), label: '', metricType: 'custom', target: 0, unit: '', targetDir: 'min' }])
    setShowCreateModal(true)
  }

  function openEdit(sop: SOP) {
    setEditSopId(sop.id)
    setSopUserId(sop.userId)
    setSopPeriod(sop.period)
    setSopNotes(sop.notes ?? '')
    setSopMetrics(sop.metrics.map(m => ({ ...m })))
    setShowCreateModal(true)
  }

  function addMetricRow() {
    setSopMetrics(m => [...m, { id: uid(), label: '', metricType: 'custom', target: 0, unit: '', targetDir: 'min' }])
  }

  function removeMetricRow(id: string) {
    setSopMetrics(m => m.filter(x => x.id !== id))
  }

  function updateMetricRow(id: string, patch: Partial<SOPMetric>) {
    setSopMetrics(m => m.map(x => {
      if (x.id !== id) return x
      const updated = { ...x, ...patch }
      // auto-fill unit from metric type
      if (patch.metricType) {
        const def = SOP_METRIC_TYPES.find(t => t.value === patch.metricType)
        if (def && def.unit) updated.unit = def.unit
        // default targetDir
        if (patch.metricType === 'expenses_amount' || patch.metricType === 'expenses_count' || patch.metricType === 'leave_days') {
          updated.targetDir = 'max'
        } else {
          updated.targetDir = 'min'
        }
      }
      return updated
    }))
  }

  function saveSOP() {
    const u = users.find(x => x.id === sopUserId)
    if (!u) { showToast('Select a user', 'error'); return }
    const metrics = sopMetrics.filter(m => m.label.trim() && m.target > 0)
    if (metrics.length === 0) { showToast('Add at least one metric with a label and target', 'error'); return }

    if (editSopId) {
      updateSOP(editSopId, { metrics, period: sopPeriod, notes: sopNotes || undefined })
    } else {
      createSOP({ userId: u.id, userName: u.name, period: sopPeriod, metrics, active: true, notes: sopNotes || undefined })
    }
    setShowCreateModal(false)
  }

  function openActualUpdate(sop: SOP, metric: SOPMetric, periodKey: string) {
    const existing = sopActuals.find(a => a.sopId === sop.id && a.metricId === metric.id && a.periodKey === periodKey)
    setActualValue(existing ? String(existing.actual) : '')
    setActualNote(existing?.notes ?? '')
    setUpdatingActual({ sop, metric, periodKey })
  }

  function saveActual() {
    if (!updatingActual) return
    const v = Number(actualValue)
    if (isNaN(v) || actualValue === '') { showToast('Enter a valid number', 'error'); return }
    setSopActual(updatingActual.sop.id, updatingActual.metric.id, updatingActual.periodKey, v, actualNote || undefined)
    setUpdatingActual(null)
    showToast('Actual updated', 'success')
  }

  // ── Per-SOP summary for overview ──
  function sopSummary(sop: SOP, periodKey: string) {
    const metrics = sop.metrics.map(m => {
      const actual = evalMetric(m, sop.id, sop.userId, periodKey, sop.period, evalData)
      const met    = isMetMet(actual, m.target, m.targetDir)
      return { ...m, actual, met }
    })
    const total = metrics.length
    const met   = metrics.filter(m => m.met).length
    return { metrics, total, met, pctOverall: total === 0 ? 0 : Math.round((met / total) * 100) }
  }

  // ── Current period view ──
  const viewSOP    = selectedSopId ? (sops.find(s => s.id === selectedSopId) ?? mySOP) : mySOP
  const viewPeriod = viewSOP ? (histPeriod ?? currentPeriodKey(viewSOP.period)) : ''
  const viewSummary = viewSOP ? sopSummary(viewSOP, viewPeriod) : null

  const tabStyle = (t: string): React.CSSProperties => ({
    background: tab === t ? '#E8F3FA' : 'transparent',
    border: `1px solid ${tab === t ? '#A8D4E8' : 'transparent'}`,
    borderRadius: 8, cursor: 'pointer',
    color: tab === t ? '#1B2762' : 'var(--text-3)',
    padding: '7px 14px', fontSize: 11, fontWeight: tab === t ? 600 : 400,
    transition: 'all 0.15s',
  })

  if (!mounted) return <ModuleSkeleton />

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-t1">Performance Targets</h2>
          <p className="text-[11px] text-t3">Set and track individual performance targets per staff member</p>
        </div>
        {isAdmin && (
          <button className="btn-primary text-[11px] px-4 py-2" onClick={openCreate}>+ Set Target</button>
        )}
      </div>

      {/* Stats (team view) */}
      {canViewTeamHR && (() => {
        const active = sops.filter(s => s.active)
        const usersWithSOP = new Set(active.map(s => s.userId)).size
        const usersTotal   = users.length
        const summaries    = active.map(s => sopSummary(s, currentPeriodKey(s.period)))
        const allMet       = summaries.filter(s => s.met === s.total && s.total > 0).length
        const atRisk       = summaries.filter(s => s.met < s.total).length
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Staff with Targets" value={`${usersWithSOP} / ${usersTotal}`} color="#1B2762" icon={<Fa icon={faBullseye} />} />
            <StatCard label="All Targets Met" value={allMet}                            color="#059669" icon={<Fa icon={faCircleCheck} />} />
            <StatCard label="Partially Met"   value={atRisk}                            color="#D97706" icon={<Fa icon={faTriangleExclamation} />} />
            <StatCard label="No Target Set"    value={usersTotal - usersWithSOP}         color="#6B7280" icon={<Fa icon={faUserSlash} />} />
          </div>
        )
      })()}

      {/* Tabs */}
      <div className="flex gap-1">
        {canViewTeamHR ? (
          <>
            <button style={tabStyle('overview')} onClick={() => setTab('overview')}>Overview — All Staff</button>
            <button style={tabStyle('manage')}   onClick={() => setTab('manage')}>Manage Targets</button>
            {mySOP && <button style={tabStyle('my')} onClick={() => setTab('my')}>My Targets</button>}
          </>
        ) : (
          <button style={tabStyle('my')} onClick={() => setTab('my')}>My Targets</button>
        )}
      </div>
      <div className="card overflow-hidden">

        {/* ── Overview (Team View) ── */}
        {tab === 'overview' && canViewTeamHR && (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[800px] flex flex-col divide-y divide-gray-100">
            {sops.filter(s => s.active).length === 0 ? (
              <div className="py-14 text-center text-t3 text-sm">
                <div style={{ fontSize: 36 }} className="mb-2">🎯</div>
                No active targets set. Click "+ Set Target" to get started.
              </div>
            ) : sops.filter(s => s.active).map(sop => {
              const pk  = currentPeriodKey(sop.period)
              const sum = sopSummary(sop, pk)
              const pctC = sum.pctOverall
              const col = pctC === 100 ? '#10B981' : pctC >= 60 ? '#F59E0B' : '#EF4444'
              return (
                <div key={sop.id}
                  className="p-4 cursor-pointer transition-colors hover:bg-gray-50 flex items-center gap-4"
                  onClick={() => { setSelectedSopId(sop.id); setHistPeriod(null); setTab('my') }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                    {sop.userName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-sm text-t1">{sop.userName}</p>
                      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 20, background: '#E8F3FA', color: '#14204F', fontWeight: 600 }}>
                        {sop.period}
                      </span>
                      <span className="text-[10px] text-t3">{fmtPeriodKey(pk)}</span>
                    </div>
                    {/* Mini progress bars */}
                    <div className="flex gap-2 flex-wrap">
                      {sum.metrics.map(m => {
                        const c = metricColor(m.actual, m.target, m.targetDir)
                        return (
                          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 60, height: 4, borderRadius: 4, background: '#E5E7EB', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(100, pct(m.actual, m.target, m.targetDir))}%`, background: c.bar, borderRadius: 4 }} />
                            </div>
                            <span style={{ fontSize: 9, color: c.text, fontWeight: 600 }}>
                              {fmtVal(m.actual, m.unit)}/{fmtVal(m.target, m.unit)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div style={{ textAlign: 'right' }}>
                      <p className="font-bold text-xl" style={{ color: col, lineHeight: 1 }}>{pctC}%</p>
                      <p className="text-[9px] text-t3">{sum.met}/{sum.total} targets met</p>
                    </div>
                    {canEditTargets && (
                      <button onClick={e => { e.stopPropagation(); openEdit(sop) }}
                        className="btn-outline text-[10px] py-0.5 px-2">
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        )}

        {/* ── Manage SOPs (Admins Only) ── */}
        {tab === 'manage' && canViewTeamHR && (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[800px] flex flex-col divide-y divide-gray-100">
            {sops.length === 0 ? (
              <div className="py-14 text-center text-t3 text-sm">No performance targets defined yet.</div>
            ) : sops.map(sop => (
              <div key={sop.id} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-t1">{sop.userName}</p>
                  <p className="text-[11px] text-t3">{sop.period} · {sop.metrics.length} metrics{sop.notes ? ` · ${sop.notes}` : ''}</p>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {sop.metrics.map(m => (
                      <span key={m.id} style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', fontWeight: 500 }}>
                        {m.label}: {m.targetDir === 'min' ? '≥' : '≤'} {fmtVal(m.target, m.unit)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {canEditTargets && (
                    <>
                      <button onClick={() => openEdit(sop)} className="btn-outline text-[10px] py-0.5 px-2">Edit</button>
                      <button onClick={() => { if (confirm('Delete this target?')) deleteSOP(sop.id) }} className="btn-outline text-[10px] py-0.5 px-2" style={{ color: '#EF4444', borderColor: '#FCA5A5' }}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            </div>
          </div>
        )}

        {/* ── My Targets (all users + drill-down) ── */}
        {tab === 'my' && (() => {
          const sop = selectedSopId ? sops.find(s => s.id === selectedSopId) : mySOP
          if (!sop) {
            return (
              <div className="py-14 text-center text-t3 text-sm">
                <div style={{ fontSize: 36 }} className="mb-2">🎯</div>
                {canViewTeamHR ? 'Select a staff member from the Overview tab.' : 'No performance target has been set for you yet. Contact your administrator.'}
              </div>
            )
          }

          const pk       = histPeriod ?? currentPeriodKey(sop.period)
          const isCurrent = pk === currentPeriodKey(sop.period)
          const summary  = sopSummary(sop, pk)
          const prevKeys = prevPeriodKeys(sop.period, 4)
          const canEditActuals = canEditTargets || sop.userId === currentUserId

          return (
            <div>
              {/* Period selector + back */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
                {selectedSopId && canViewTeamHR && (
                  <button onClick={() => { setSelectedSopId(null); setTab('overview') }}
                    style={{ fontSize: 11, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>
                    ← Back
                  </button>
                )}
                <span className="text-[11px] font-semibold text-t1">{sop.userName}</span>
                <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 20, background: '#E8F3FA', color: '#14204F', fontWeight: 600 }}>{sop.period}</span>
                <div className="flex gap-1.5 ml-2">
                  <button onClick={() => setHistPeriod(null)}
                    style={{ fontSize: 10, padding: '3px 10px', borderRadius: 20, border: '1px solid', cursor: 'pointer', background: isCurrent ? '#1B2762' : 'var(--bg-muted)', color: isCurrent ? '#fff' : 'var(--text-3)', borderColor: isCurrent ? '#1B2762' : 'var(--border)', fontWeight: isCurrent ? 600 : 400 }}>
                    {fmtPeriodKey(currentPeriodKey(sop.period))} (current)
                  </button>
                  {prevKeys.map(k => (
                    <button key={k} onClick={() => setHistPeriod(k)}
                      style={{ fontSize: 10, padding: '3px 10px', borderRadius: 20, border: '1px solid', cursor: 'pointer', background: histPeriod === k ? '#1B2762' : 'var(--bg-muted)', color: histPeriod === k ? '#fff' : 'var(--text-3)', borderColor: histPeriod === k ? '#1B2762' : 'var(--border)', fontWeight: histPeriod === k ? 600 : 400 }}>
                      {fmtPeriodKey(k)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Period summary */}
              <div className="px-4 py-3 border-b flex items-center gap-6 flex-wrap" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-muted)' }}>
                <div>
                  <p className="text-[10px] text-t3">Period</p>
                  <p className="font-semibold text-sm text-t1">{fmtPeriodKey(pk)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-t3">Overall Progress</p>
                  <p className="font-bold text-xl" style={{ color: summary.pctOverall === 100 ? '#10B981' : summary.pctOverall >= 60 ? '#F59E0B' : '#EF4444' }}>
                    {summary.pctOverall}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-t3">Targets Met</p>
                  <p className="font-bold text-sm">{summary.met} / {summary.total}</p>
                </div>
              </div>

              {/* Metric cards */}
              <div className="p-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {summary.metrics.map(m => {
                  const p    = pct(m.actual, m.target, m.targetDir)
                  const col  = metricColor(m.actual, m.target, m.targetDir)
                  const met  = isMetMet(m.actual, m.target, m.targetDir)
                  const isCustom = m.metricType === 'custom'
                  const autoType = SOP_METRIC_TYPES.find(t => t.value === m.metricType)
                  return (
                    <div key={m.id} className="rounded-xl p-4" style={{ border: `1px solid ${col.border}`, background: 'var(--bg-surface)' }}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-sm text-t1">{m.label}</p>
                          {isCustom
                            ? <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', fontWeight: 600 }}>Manual</span>
                            : <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 20, background: '#E8F3FA', color: '#14204F', fontWeight: 600 }}>Auto-tracked</span>
                          }
                        </div>
                        <span style={{ fontSize: 18 }}>{met ? '✅' : p >= 70 ? '⚠️' : '❌'}</span>
                      </div>

                      {/* Progress bar */}
                      <div className="mb-2">
                        <div className="flex justify-between text-[10px] mb-1">
                          <span style={{ color: col.text, fontWeight: 700 }}>{fmtVal(m.actual, m.unit)}</span>
                          <span className="text-t3">{m.targetDir === 'min' ? 'Target:' : 'Budget:'} {fmtVal(m.target, m.unit)}</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 8, background: '#E5E7EB', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 8,
                            width: `${Math.min(100, p)}%`,
                            background: col.bar,
                            transition: 'width 0.4s ease',
                          }} />
                        </div>
                        <div className="flex justify-between text-[10px] mt-1">
                          <span className="text-t3">
                            {m.targetDir === 'min'
                              ? `${m.target - m.actual > 0 ? `${fmtVal(m.target - m.actual, m.unit)} to go` : 'Reached ✓'}`
                              : `${m.target - m.actual >= 0 ? `${fmtVal(m.target - m.actual, m.unit)} remaining` : `Over by ${fmtVal(m.actual - m.target, m.unit)}`}`
                            }
                          </span>
                          <span style={{ color: col.text, fontWeight: 600 }}>{p}%</span>
                        </div>
                      </div>

                      {/* Update button for custom / admin override */}
                      {(isCustom || canEditTargets) && canEditActuals && (
                        <button onClick={() => openActualUpdate(sop, m, pk)}
                          style={{ width: '100%', fontSize: 10, padding: '5px', borderRadius: 6, border: `1px solid ${col.border}`, background: col.bg, color: col.text, cursor: 'pointer', fontWeight: 600 }}>
                          {isCustom ? 'Update Actual' : 'Override Actual'}
                        </button>
                      )}

                      {!isCustom && autoType && (
                        <p className="text-[9px] text-t3 mt-1.5">{autoType.hint}</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Historical table */}
              {prevKeys.length > 0 && (
                <div className="px-4 pb-4">
                  <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-2">Historical Comparison</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]" style={{ minWidth: 500 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border-lt)' }}>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-t3 uppercase tracking-wider">Metric</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-t3 uppercase tracking-wider">Target</th>
                          {[currentPeriodKey(sop.period), ...prevKeys].map(k => (
                            <th key={k} className="px-3 py-2 text-right text-[10px] font-semibold text-t3 uppercase tracking-wider whitespace-nowrap">
                              {fmtPeriodKey(k)}{k === currentPeriodKey(sop.period) ? ' ●' : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sop.metrics.map(m => (
                          <tr key={m.id} style={{ borderBottom: '1px solid var(--border-lt)' }}>
                            <td className="px-3 py-2 font-medium text-t1">{m.label}</td>
                            <td className="px-3 py-2 text-t3">
                              {m.targetDir === 'min' ? '≥' : '≤'} {fmtVal(m.target, m.unit)}
                            </td>
                            {[currentPeriodKey(sop.period), ...prevKeys].map(k => {
                              const actual = evalMetric(m, sop.id, sop.userId, k, sop.period, evalData)
                              const met    = isMetMet(actual, m.target, m.targetDir)
                              return (
                                <td key={k} className="px-3 py-2 text-right">
                                  <span style={{ fontWeight: 600, color: met ? '#059669' : '#DC2626' }}>
                                    {fmtVal(actual, m.unit)}
                                  </span>
                                  {' '}<span style={{ fontSize: 9 }}>{met ? '✓' : '✗'}</span>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* ── Create / Edit SOP Modal ───────────────────────────────────────── */}
      {showCreateModal && isAdmin && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-box w-full max-w-2xl" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-t1">{editSopId ? 'Edit Target' : 'Set Target for Staff Member'}</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9CA3AF' }}>×</button>
            </div>

            <div className="space-y-4">
              {/* User + Period */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Staff Member *</label>
                  <select className="form-input w-full text-[12px]" value={sopUserId}
                    onChange={e => setSopUserId(e.target.value)} disabled={!!editSopId}>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Review Period *</label>
                  <select className="form-input w-full text-[12px]" value={sopPeriod}
                    onChange={e => setSopPeriod(e.target.value as SOP['period'])}>
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
              </div>

              {/* Metrics table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold text-t2">Targets / Metrics *</label>
                  <button onClick={addMetricRow}
                    style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid #A8D4E8', background: '#E8F3FA', color: '#14204F', cursor: 'pointer', fontWeight: 600 }}>
                    + Add Metric
                  </button>
                </div>

                <div className="space-y-2">
                  {sopMetrics.map(m => (
                    <div key={m.id} className="rounded-lg p-3 flex gap-2 items-start" style={{ background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                      {/* Label */}
                      <div style={{ flex: '2 1 0' }}>
                        <label className="text-[9px] text-t3 block mb-0.5">Label</label>
                        <input className="form-input w-full text-[11px]" placeholder="e.g. Machines Sold"
                          value={m.label} onChange={e => updateMetricRow(m.id, { label: e.target.value })} />
                      </div>

                      {/* Metric type */}
                      <div style={{ flex: '2.5 1 0' }}>
                        <label className="text-[9px] text-t3 block mb-0.5">Track From</label>
                        <select className="form-input w-full text-[11px]" value={m.metricType}
                          onChange={e => updateMetricRow(m.id, { metricType: e.target.value as SOPMetricType })}>
                          {SOP_METRIC_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}{t.auto ? ' (auto)' : ' (manual)'}</option>
                          ))}
                        </select>
                      </div>

                      {/* Target + Direction */}
                      <div style={{ flex: '1.2 1 0' }}>
                        <label className="text-[9px] text-t3 block mb-0.5">Target</label>
                        <input type="number" className="form-input w-full text-[11px]" placeholder="0"
                          value={m.target || ''}
                          onChange={e => updateMetricRow(m.id, { target: Number(e.target.value) })} />
                      </div>

                      <div style={{ flex: '1 1 0' }}>
                        <label className="text-[9px] text-t3 block mb-0.5">Unit</label>
                        <input className="form-input w-full text-[11px]" placeholder="units"
                          value={m.unit}
                          onChange={e => updateMetricRow(m.id, { unit: e.target.value })} />
                      </div>

                      <div style={{ flex: '1 1 0' }}>
                        <label className="text-[9px] text-t3 block mb-0.5">Must</label>
                        <select className="form-input w-full text-[11px]" value={m.targetDir}
                          onChange={e => updateMetricRow(m.id, { targetDir: e.target.value as SOPTargetDir })}>
                          <option value="min">≥ Reach</option>
                          <option value="max">≤ Stay under</option>
                        </select>
                      </div>

                      <button onClick={() => removeMetricRow(m.id)}
                        style={{ marginTop: 18, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 16, flexShrink: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Notes (optional)</label>
                <input className="form-input w-full text-[12px]" placeholder="e.g. Sales team monthly targets"
                  value={sopNotes} onChange={e => setSopNotes(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn-primary text-[11px] py-2 px-4" onClick={saveSOP}>
                {editSopId ? 'Save Changes' : 'Create Target'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Update Custom Actual Modal ────────────────────────────────────── */}
      {updatingActual && (
        <div className="modal-overlay" onClick={() => setUpdatingActual(null)}>
          <div className="modal-box w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-t1">Update Actual Value</h3>
                <p className="text-[11px] text-t3">{updatingActual.metric.label} · {fmtPeriodKey(updatingActual.periodKey)}</p>
              </div>
              <button onClick={() => setUpdatingActual(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9CA3AF' }}>×</button>
            </div>

            <div className="rounded-xl p-3 mb-4 text-[11px]" style={{ background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
              <div className="flex justify-between">
                <span className="text-t3">Target</span>
                <span className="font-semibold">{updatingActual.metric.targetDir === 'min' ? '≥' : '≤'} {fmtVal(updatingActual.metric.target, updatingActual.metric.unit)}</span>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">
                  Actual Value ({updatingActual.metric.unit || 'units'}) *
                </label>
                <input type="number" className="form-input w-full text-[12px]" placeholder="0"
                  value={actualValue} onChange={e => setActualValue(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Notes (optional)</label>
                <input className="form-input w-full text-[12px]" placeholder="e.g. slow month, public holidays"
                  value={actualNote} onChange={e => setActualNote(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setUpdatingActual(null)}>Cancel</button>
              <button className="btn-primary text-[11px] py-2 px-4" onClick={saveActual}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
