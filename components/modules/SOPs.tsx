'use client'
import { useState, useMemo, useEffect } from 'react'
import {
  useApp, fmtKes,
  SOP, SOPMetric, SOPMetricType, SOPTargetDir,
  SOP_METRIC_TYPES,
  type LeaveRequest, type Employee,
} from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Confirm, ModuleSkeleton, ModuleHeader, TabBar, Modal, StatCard, EmptyState } from '@/components/ui'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
import { Fa } from '@/components/icons'
import { faBullseye, faCircleCheck, faTriangleExclamation, faUserSlash, faPlus } from '@fortawesome/free-solid-svg-icons'

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
  leaveRequests:  LeaveRequest[]
  employees:      Employee[]
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
  if (isMetMet(actual, target, dir)) return { bar: 'var(--success)', text: 'var(--success-text)', bg: 'var(--success-bg)', border: '#A7F3D0' }
  if (dir === 'min') {
    if (p >= 70) return { bar: 'var(--warning)', text: '#854D0E', bg: '#FEF9C3', border: '#FDE68A' }
    return { bar: 'var(--danger)', text: '#991B1B', bg: 'var(--danger-bg)', border: '#FECACA' }
  }
  // max: going over budget
  if (p <= 85) return { bar: 'var(--success)', text: 'var(--success-text)', bg: 'var(--success-bg)', border: '#A7F3D0' }
  if (p <= 100) return { bar: 'var(--warning)', text: '#854D0E', bg: '#FEF9C3', border: '#FDE68A' }
  return { bar: 'var(--danger)', text: '#991B1B', bg: 'var(--danger-bg)', border: '#FECACA' }
}

const uid = () => crypto.randomUUID()

// ── Main Component ────────────────────────────────────────────────────────────

export default function SOPs() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const {
    users, currentUserId, repairs, expenses, outsourceJobs,
    sopActuals, saleOrders,
    sops, createSOP, updateSOP, deleteSOP, setSopActual,
    showToast,
  } = useApp()
  const { leaveRequests, employees } = useHrStore()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  
  const canViewTeamHR  = ['director', 'finance_officer', 'technical_lead'].includes(currentUser?.role ?? '')
  const canEditTargets = currentUser?.role === 'director'
  const isAdmin        = currentUser?.role === 'director'

  const evalData: EvalInput = { repairs, expenses, outsourceJobs, leaveRequests, employees, sopActuals, saleOrders }

  // My SOP (if not admin, or admin viewing their own)
  const mySOP = sops.find(s => s.userId === currentUserId && s.active)

  // Managers land on the operational Manage Targets screen; the team Overview
  // summary stays available as an optional tab (progressive disclosure).
  const [tab, setTab] = useState<'overview' | 'manage' | 'my'>(canViewTeamHR ? 'manage' : 'my')
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)

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
    color: tab === t ? 'var(--navy)' : 'var(--text-3)',
    padding: '7px 14px', fontSize: 11, fontWeight: tab === t ? 600 : 400,
    transition: 'all 0.15s',
  })

  if (!mounted) return <ModuleSkeleton />

  // ── Render ────────────────────────────────────────────────────────────────

  const sopTabs = canViewTeamHR
    ? [
        { id: 'overview', label: 'Overview' },
        { id: 'manage', label: 'Manage' },
        ...(mySOP ? [{ id: 'my', label: 'My targets' }] : []),
      ]
    : [{ id: 'my', label: 'My targets' }]

  const activeSops = sops.filter(s => s.active)
  const teamSummaries = activeSops.map(sop => sopSummary(sop, currentPeriodKey(sop.period)))
  const teamAchieved = teamSummaries.filter(summary => summary.pctOverall === 100).length
  const teamAtRisk = teamSummaries.filter(summary => summary.pctOverall < 60).length
  const teamAverage = teamSummaries.length
    ? Math.round(teamSummaries.reduce((sum, summary) => sum + summary.pctOverall, 0) / teamSummaries.length)
    : 0

  return (
    <div className="mod-page">
      <ModuleHeader
        title="KPI Targets"
        subtitle="Track individual targets per staff member"
        icon={<Fa icon={faBullseye} />}
        color="var(--warning)"
        primaryAction={isAdmin ? (
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openCreate} hideLabelOnMobile={false}>
            Set target
          </PrimaryActionButton>
        ) : undefined}
      />

      <TabBar
        tabs={sopTabs}
        active={tab}
        onChange={id => setTab(id as typeof tab)}
        maxVisibleDesktop={6}
        ariaLabel="Performance target sections"
      />

      <div className="mod-body bg-slate-50 p-3 sm:p-4 lg:p-6">

        {/* ── Overview (Team View) ── */}
        {tab === 'overview' && canViewTeamHR && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard compact label="Active targets" value={activeSops.length} sub="Staff scorecards" color="var(--primary)" icon={<Fa icon={faBullseye} />} />
              <StatCard compact label="Achieved" value={teamAchieved} sub="All metrics met" color="var(--success)" icon={<Fa icon={faCircleCheck} />} />
              <StatCard compact label="At risk" value={teamAtRisk} sub="Below 60% achieved" color="var(--danger)" icon={<Fa icon={faTriangleExclamation} />} />
              <StatCard compact label="Team completion" value={`${teamAverage}%`} sub="Average targets met" color={teamAverage >= 70 ? 'var(--success)' : 'var(--warning)'} icon={<Fa icon={faBullseye} />} />
            </div>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Team KPI scorecards">
            {activeSops.length === 0 ? (
              <EmptyState
                icon={<Fa icon={faBullseye} />}
                title="No active targets"
                subtitle={canEditTargets ? 'Set a target to start tracking team performance.' : 'No active KPI targets have been configured.'}
                action={canEditTargets ? <button type="button" className="btn-primary" onClick={openCreate}>Set target</button> : undefined}
              />
            ) : activeSops.map(sop => {
              const pk  = currentPeriodKey(sop.period)
              const sum = sopSummary(sop, pk)
              const pctC = sum.pctOverall
              const col = pctC === 100 ? 'var(--success)' : pctC >= 60 ? 'var(--warning)' : 'var(--danger)'
              return (
                <div key={sop.id}
                  role="button"
                  tabIndex={0}
                  className="flex cursor-pointer flex-col gap-4 border-b border-slate-100 p-4 transition-colors last:border-b-0 hover:bg-slate-50 sm:flex-row sm:items-center"
                  onClick={() => { setSelectedSopId(sop.id); setHistPeriod(null); setTab('my') }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedSopId(sop.id)
                      setHistPeriod(null)
                      setTab('my')
                    }
                  }}>
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, var(--navy), var(--accent-cyan))' }}>
                    {sop.userName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{sop.userName}</p>
                      <StatusBadge status={pctC === 100 ? 'done' : pctC >= 60 ? 'confirmed_blue' : 'failed'} label={pctC === 100 ? 'Achieved' : pctC >= 60 ? 'On track' : 'At risk'} size="xs" />
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold capitalize text-blue-700">{sop.period}</span>
                      <span className="text-xs text-slate-500">{fmtPeriodKey(pk)}</span>
                    </div>
                    {/* Mini progress bars */}
                    <div className="flex gap-2 flex-wrap">
                      {sum.metrics.map(m => {
                        const c = metricColor(m.actual, m.target, m.targetDir)
                        return (
                          <div key={m.id} className="flex items-center gap-1.5">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                              <div style={{ height: '100%', width: `${Math.min(100, pct(m.actual, m.target, m.targetDir))}%`, background: c.bar, borderRadius: 4 }} />
                            </div>
                            <span className="text-[11px] font-semibold" style={{ color: c.text }}>
                              {fmtVal(m.actual, m.unit)}/{fmtVal(m.target, m.unit)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right">
                      <p className="text-2xl font-bold tabular-nums" style={{ color: col, lineHeight: 1 }}>{pctC}%</p>
                      <p className="mt-1 text-xs text-slate-500">{sum.met}/{sum.total} targets met</p>
                    </div>
                    {canEditTargets && (
                      <button onClick={e => { e.stopPropagation(); openEdit(sop) }}
                        className="btn-outline px-3 py-1.5 text-xs">
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            </section>
          </div>
        )}

        {/* ── Manage SOPs (Admins Only) ── */}
        {tab === 'manage' && canViewTeamHR && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard compact label="Total scorecards" value={sops.length} sub="Configured targets" color="var(--primary)" icon={<Fa icon={faBullseye} />} />
              <StatCard compact label="Active" value={activeSops.length} sub="Currently tracked" color="var(--success)" icon={<Fa icon={faCircleCheck} />} />
              <StatCard compact label="Inactive" value={sops.length - activeSops.length} sub="Not currently tracked" color="var(--text-4)" icon={<Fa icon={faUserSlash} />} />
              <StatCard compact label="Metrics" value={sops.reduce((sum, sop) => sum + sop.metrics.length, 0)} sub="Across all scorecards" color="var(--warning)" icon={<Fa icon={faTriangleExclamation} />} />
            </div>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Managed KPI targets">
            {sops.length === 0 ? (
              <EmptyState icon={<Fa icon={faBullseye} />} title="No KPI targets defined" subtitle="Create a staff target to begin tracking performance." action={canEditTargets ? <button type="button" className="btn-primary" onClick={openCreate}>Set target</button> : undefined} />
            ) : sops.map(sop => (
              <div key={sop.id} className="flex flex-col gap-4 border-b border-slate-100 p-4 transition-colors last:border-b-0 hover:bg-slate-50 sm:flex-row sm:items-center">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{sop.userName}</p>
                    <StatusBadge status={sop.active ? 'active' : 'returned'} label={sop.active ? 'Active' : 'Inactive'} size="xs" />
                    <span className="text-xs capitalize text-slate-500">{sop.period} · {sop.metrics.length} metrics</span>
                  </div>
                  {sop.notes && <p className="mt-1 text-xs text-slate-500">{sop.notes}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sop.metrics.map(m => (
                      <span key={m.id} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                        {m.label}: {m.targetDir === 'min' ? '≥' : '≤'} {fmtVal(m.target, m.unit)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  {canEditTargets && (
                    <>
                      <button type="button" onClick={() => openEdit(sop)} className="btn-outline px-3 py-1.5 text-xs">Edit</button>
                      <button type="button" onClick={() => setPendingConfirm({ msg: 'Delete this target?', action: () => deleteSOP(sop.id) })} className="btn-outline px-3 py-1.5 text-xs" style={{ color: 'var(--danger)', borderColor: '#FCA5A5' }}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            </section>
          </div>
        )}

        {/* ── My Targets (all users + drill-down) ── */}
        {tab === 'my' && (() => {
          const sop = selectedSopId ? sops.find(s => s.id === selectedSopId) : mySOP
          if (!sop) {
            return (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <EmptyState
                  icon={<Fa icon={faBullseye} />}
                  title="No KPI target selected"
                  subtitle={canViewTeamHR ? 'Select a staff member from the Overview tab.' : 'No performance target has been set for you yet. Contact your administrator.'}
                />
              </div>
            )
          }

          const pk       = histPeriod ?? currentPeriodKey(sop.period)
          const isCurrent = pk === currentPeriodKey(sop.period)
          const summary  = sopSummary(sop, pk)
          const prevKeys = prevPeriodKeys(sop.period, 4)
          const canEditActuals = canEditTargets || sop.userId === currentUserId

          return (
            <div className="space-y-5">
              {/* Period selector + back */}
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center">
                {selectedSopId && canViewTeamHR && (
                  <button onClick={() => { setSelectedSopId(null); setTab('overview') }}
                    className="self-start text-xs font-semibold text-blue-700 hover:text-blue-900">
                    ← Back
                  </button>
                )}
                <div className="flex flex-wrap items-center gap-2 lg:mr-auto">
                  <span className="text-base font-semibold text-slate-900">{sop.userName}</span>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold capitalize text-blue-700">{sop.period}</span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button onClick={() => setHistPeriod(null)}
                    className={`flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${isCurrent ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {fmtPeriodKey(currentPeriodKey(sop.period))} (current)
                  </button>
                  {prevKeys.map(k => (
                    <button key={k} onClick={() => setHistPeriod(k)}
                      className={`flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${histPeriod === k ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {fmtPeriodKey(k)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Period summary */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard compact label="Period" value={fmtPeriodKey(pk)} sub={sop.period} color="var(--primary)" icon={<Fa icon={faBullseye} />} />
                <StatCard compact label="Overall progress" value={`${summary.pctOverall}%`} sub="Targets achieved" color={summary.pctOverall === 100 ? 'var(--success)' : summary.pctOverall >= 60 ? 'var(--warning)' : 'var(--danger)'} icon={<Fa icon={faCircleCheck} />} />
                <StatCard compact label="Targets met" value={`${summary.met} / ${summary.total}`} sub="Current scorecard" color={summary.met === summary.total ? 'var(--success)' : 'var(--warning)'} icon={<Fa icon={faTriangleExclamation} />} />
              </div>

              {/* Metric cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {summary.metrics.map(m => {
                  const p    = pct(m.actual, m.target, m.targetDir)
                  const col  = metricColor(m.actual, m.target, m.targetDir)
                  const met  = isMetMet(m.actual, m.target, m.targetDir)
                  const isCustom = m.metricType === 'custom'
                  const autoType = SOP_METRIC_TYPES.find(t => t.value === m.metricType)
                  return (
                    <article key={m.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-slate-900">{m.label}</p>
                          <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${isCustom ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'}`}>
                            {isCustom ? 'Manual' : 'Auto-tracked'}
                          </span>
                        </div>
                        <StatusBadge
                          status={met ? 'done' : p >= 70 ? 'confirmed_blue' : 'failed'}
                          label={met ? 'Achieved' : p >= 70 ? 'On track' : 'At risk'}
                          size="xs"
                        />
                      </div>

                      {/* Progress bar */}
                      <div className="mb-2">
                        <div className="mb-2 flex justify-between gap-3 text-xs">
                          <span style={{ color: col.text, fontWeight: 700 }}>{fmtVal(m.actual, m.unit)}</span>
                          <span className="text-t3">{m.targetDir === 'min' ? 'Target:' : 'Budget:'} {fmtVal(m.target, m.unit)}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.label} progress`}>
                          <div style={{
                            height: '100%', borderRadius: 8,
                            width: `${Math.min(100, p)}%`,
                            background: col.bar,
                            transition: 'width 0.4s ease',
                          }} />
                        </div>
                        <div className="mt-2 flex justify-between gap-3 text-xs">
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
                          className="mt-2 min-h-10 w-full rounded-lg border px-3 text-xs font-semibold transition-opacity hover:opacity-80"
                          style={{ borderColor: col.border, background: col.bg, color: col.text }}>
                          {isCustom ? 'Update Actual' : 'Override Actual'}
                        </button>
                      )}

                      {!isCustom && autoType && (
                        <p className="mt-2 text-xs text-slate-500">{autoType.hint}</p>
                      )}
                    </article>
                  )
                })}
              </div>

              {/* Historical table */}
              {prevKeys.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <h3 className="mb-3 text-base font-semibold text-slate-900">Historical comparison</h3>
                  <div className="dt-scroll rounded-xl border border-slate-200">
                    <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
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
                                  <span style={{ fontWeight: 600, color: met ? 'var(--success)' : 'var(--danger)' }}>
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
                </section>
              )}
            </div>
          )
        })()}
      </div>

      {/* ── Create / Edit SOP Modal ───────────────────────────────────────── */}
      {showCreateModal && isAdmin && (
        <Modal
          title={editSopId ? 'Edit Target' : 'Set Target for Staff Member'}
          subtitle="Define ownership, reporting period, and measurable KPI targets."
          width={1050}
          variant="enterprise"
          accent="#2563EB"
          icon={<Fa icon={faBullseye} />}
          onClose={() => setShowCreateModal(false)}
          footer={(
            <>
              <button type="button" className="btn-outline min-h-10 px-5 text-sm" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button type="button" className="btn-primary min-h-10 px-5 text-sm" onClick={saveSOP}>
                {editSopId ? 'Save Changes' : 'Create Target'}
              </button>
            </>
          )}
        >
            <div className="space-y-5">
              {/* User + Period */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Ownership and reporting period</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">Staff Member *</label>
                  <select aria-label="Staff member" className="form-input h-11 w-full text-sm" value={sopUserId}
                    onChange={e => setSopUserId(e.target.value)} disabled={!!editSopId}>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">Review Period *</label>
                  <select aria-label="Review period" className="form-input h-11 w-full text-sm" value={sopPeriod}
                    onChange={e => setSopPeriod(e.target.value as SOP['period'])}>
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
              </div>
            </section>

              {/* Metrics table */}
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Targets / Metrics *</h3>
                  <button type="button" onClick={addMetricRow}
                    className="btn-outline min-h-10 px-3 text-xs text-blue-700">
                    + Add Metric
                  </button>
                </div>

                <div className="space-y-3">
                  {sopMetrics.map(m => (
                    <div key={m.id} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[minmax(160px,2fr)_minmax(200px,2.5fr)_minmax(100px,1fr)_minmax(100px,1fr)_minmax(120px,1fr)_40px] md:items-end">
                      {/* Label */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Label</label>
                        <input className="form-input h-10 w-full text-sm" placeholder="e.g. Machines Sold"
                          value={m.label} onChange={e => updateMetricRow(m.id, { label: e.target.value })} />
                      </div>

                      {/* Metric type */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Track From</label>
                        <select aria-label={`Metric source for ${m.label || 'target'}`} className="form-input h-10 w-full text-sm" value={m.metricType}
                          onChange={e => updateMetricRow(m.id, { metricType: e.target.value as SOPMetricType })}>
                          {SOP_METRIC_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}{t.auto ? ' (auto)' : ' (manual)'}</option>
                          ))}
                        </select>
                      </div>

                      {/* Target + Direction */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Target</label>
                        <input type="number" className="form-input h-10 w-full text-sm" placeholder="0"
                          value={m.target || ''}
                          onChange={e => updateMetricRow(m.id, { target: Number(e.target.value) })} />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Unit</label>
                        <input className="form-input h-10 w-full text-sm" placeholder="units"
                          value={m.unit}
                          onChange={e => updateMetricRow(m.id, { unit: e.target.value })} />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Must</label>
                        <select aria-label={`Target direction for ${m.label || 'target'}`} className="form-input h-10 w-full text-sm" value={m.targetDir}
                          onChange={e => updateMetricRow(m.id, { targetDir: e.target.value as SOPTargetDir })}>
                          <option value="min">≥ Reach</option>
                          <option value="max">≤ Stay under</option>
                        </select>
                      </div>

                      <button type="button" onClick={() => removeMetricRow(m.id)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove ${m.label || 'metric'}`}>×</button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Notes */}
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">Notes (optional)</label>
                <input className="form-input h-11 w-full text-sm" placeholder="e.g. Sales team monthly targets"
                  value={sopNotes} onChange={e => setSopNotes(e.target.value)} />
              </div>
            </div>
        </Modal>
      )}

      {/* ── Update Custom Actual Modal ────────────────────────────────────── */}
      {updatingActual && (
        <Modal
          title="Update Actual Value"
          subtitle={`${updatingActual.metric.label} · ${fmtPeriodKey(updatingActual.periodKey)}`}
          width={560}
          variant="enterprise"
          accent="#2563EB"
          onClose={() => setUpdatingActual(null)}
          footer={(
            <>
              <button type="button" className="btn-outline min-h-10 px-5 text-sm" onClick={() => setUpdatingActual(null)}>Cancel</button>
              <button type="button" className="btn-primary min-h-10 px-5 text-sm" onClick={saveActual}>Save</button>
            </>
          )}
        >

            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Current target</span>
                <span className="font-semibold text-slate-900">{updatingActual.metric.targetDir === 'min' ? '≥' : '≤'} {fmtVal(updatingActual.metric.target, updatingActual.metric.unit)}</span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                  Actual Value ({updatingActual.metric.unit || 'units'}) *
                </label>
                <input type="number" className="form-input h-11 w-full text-sm" placeholder="0"
                  value={actualValue} onChange={e => setActualValue(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">Notes (optional)</label>
                <input className="form-input h-11 w-full text-sm" placeholder="e.g. slow month, public holidays"
                  value={actualNote} onChange={e => setActualNote(e.target.value)} />
              </div>
            </div>
        </Modal>
      )}
      {pendingConfirm && (
        <Confirm
          message={pendingConfirm.msg}
          onConfirm={() => { pendingConfirm.action(); setPendingConfirm(null) }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  )
}
