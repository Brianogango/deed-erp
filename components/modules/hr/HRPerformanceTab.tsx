'use client'
import { useMemo, useState } from 'react'
import { useApp, fmtKes, type PerfPeriod, type PerfStatus, type PerformanceTarget } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Fa } from '@/components/icons'
import { faChartLine, faBullseye, faTrophy, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { Field, Input, Modal, Select, Textarea } from '@/components/ui'

type TargetForm = {
  employeeId: string
  metric: string
  description: string
  targetValue: string
  currentValue: string
  unit: string
  period: PerfPeriod
  periodLabel: string
  dueDate: string
  status: PerfStatus
}

const uid = () => crypto.randomUUID()
const today = () => new Date().toISOString().slice(0, 10)
const monthLabel = () => new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' })

const emptyTargetForm = (employeeId = ''): TargetForm => ({
  employeeId,
  metric: '',
  description: '',
  targetValue: '',
  currentValue: '0',
  unit: '',
  period: 'monthly',
  periodLabel: monthLabel(),
  dueDate: today(),
  status: 'on_track',
})

export default function HRPerformanceTab() {
  const { hrPerfTargets, currentUser, saveHrPerfTargets, showToast } = useApp()
  const { employees } = useHrStore()
  const isAdmin = currentUser?.role === 'director'
  const isFinance = currentUser?.role === 'finance_officer'
  const canViewAllTargets = isAdmin || isFinance
  const currentEmployee = useMemo(() => {
    if (!currentUser) return null
    const normalize = (value?: string | null) => (value ?? '').trim().toLowerCase()
    const currentUsername = normalize(currentUser.username)
    return employees.find(employee => {
      const employeeEmailUser = normalize(employee.email?.split('@')[0])
      return employee.userId === currentUser.id ||
        normalize(employee.fullName) === normalize(currentUser.name) ||
        (!!employeeEmailUser && employeeEmailUser === currentUsername) ||
        normalize(employee.employeeNo) === currentUsername
    }) ?? null
  }, [currentUser, employees])
  const visibleTargets = canViewAllTargets ? hrPerfTargets : hrPerfTargets.filter(t => currentEmployee && t.employeeId === currentEmployee.id)
  const [showTargetModal, setShowTargetModal] = useState(false)
  const [targetForm, setTargetForm] = useState<TargetForm>(() => emptyTargetForm(employees.find(e => e.status !== 'exited')?.id ?? employees[0]?.id ?? ''))

  const employeeOptions = employees
    .filter(e => e.status !== 'exited')
    .map(e => ({ value: e.id, label: `${e.fullName} · ${e.jobTitle}` }))

  const openTargetModal = () => {
    setTargetForm(emptyTargetForm(employees.find(e => e.status !== 'exited')?.id ?? employees[0]?.id ?? ''))
    setShowTargetModal(true)
  }

  const submitTarget = () => {
    const employee = employees.find(e => e.id === targetForm.employeeId)
    const metric = targetForm.metric.trim()
    const description = targetForm.description.trim()
    const targetValue = Number(targetForm.targetValue)
    const currentValue = Number(targetForm.currentValue || 0)

    if (!employee) { showToast('Select an employee for this target', 'error'); return }
    if (!metric) { showToast('Target metric is required', 'error'); return }
    if (!Number.isFinite(targetValue) || targetValue <= 0) { showToast('Target value must be greater than zero', 'error'); return }
    if (!Number.isFinite(currentValue) || currentValue < 0) { showToast('Current value cannot be negative', 'error'); return }
    if (!targetForm.periodLabel.trim()) { showToast('Period label is required', 'error'); return }
    if (!targetForm.dueDate) { showToast('Due date is required', 'error'); return }

    const calculatedStatus: PerfStatus = currentValue >= targetValue ? 'achieved' : targetForm.status
    const target: PerformanceTarget = {
      id: uid(),
      employeeId: employee.id,
      employeeName: employee.fullName,
      metric,
      description,
      targetValue,
      currentValue,
      unit: targetForm.unit.trim() || 'units',
      period: targetForm.period,
      periodLabel: targetForm.periodLabel.trim(),
      dueDate: targetForm.dueDate,
      status: calculatedStatus,
      createdByName: currentUser?.name ?? 'System',
      createdAt: new Date().toISOString(),
    }

    saveHrPerfTargets([target, ...hrPerfTargets])
    showToast('Performance target added', 'success')
    setShowTargetModal(false)
  }

  const stats = useMemo(() => {
    const total = visibleTargets.length
    const achieved = visibleTargets.filter(t => t.status === 'achieved').length
    const atRisk = visibleTargets.filter(t => t.status === 'at_risk').length
    return { total, achieved, atRisk }
  }, [visibleTargets])

  return (
    <div className="flex flex-col">
      <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary-50 text-primary-600 flex items-center justify-center text-xl">
            <Fa icon={faBullseye} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider">Active Targets</p>
            <h3 className="text-xl font-black text-[var(--text-1)]">{stats.total}</h3>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center text-xl">
            <Fa icon={faTrophy} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider">Achieved</p>
            <h3 className="text-xl font-black text-[var(--text-1)]">{stats.achieved}</h3>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center text-xl">
            <Fa icon={faTriangleExclamation} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider">At Risk</p>
            <h3 className="text-xl font-black text-[var(--text-1)]">{stats.atRisk}</h3>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Performance Overview</h3>
          {isAdmin && (
            <button onClick={openTargetModal} className="btn-primary py-1.5 px-4 text-[10px]">Set New Target</button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4">
          {visibleTargets.length > 0 ? (
            visibleTargets.map(t => {
              const pct = Math.min(100, Math.round((t.currentValue / t.targetValue) * 100))
              const color = t.status === 'achieved' ? 'bg-green-500' : t.status === 'at_risk' ? 'bg-red-500' : 'bg-primary-500'
              
              return (
                <div key={t.id} className="card p-5 hover:border-primary-500/30 transition-all">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--bg-muted)] flex items-center justify-center font-bold text-xs text-[var(--text-2)]">
                        {t.employeeName.slice(0, 1)}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-[var(--text-1)]">{t.employeeName}</h4>
                        <p className="text-[10px] text-[var(--text-4)]">{t.metric} · {t.periodLabel}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        t.status === 'achieved' ? 'bg-green-100 text-green-700' : 
                        t.status === 'at_risk' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {t.status.replace('_', ' ')}
                      </span>
                      <p className="text-[10px] text-[var(--text-4)] mt-1">Due {t.dueDate}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold">
                      <span className="text-[var(--text-2)]">
                        {t.unit === 'KSh' ? fmtKes(t.currentValue) : `${t.currentValue} ${t.unit}`}
                      </span>
                      <span className="text-[var(--text-4)]">
                        Target: {t.unit === 'KSh' ? fmtKes(t.targetValue) : `${t.targetValue} ${t.unit}`}
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${color} transition-all duration-500`} 
                        style={{ width: `${pct}%` }} 
                      />
                    </div>
                    <p className="text-[10px] text-[var(--text-3)] italic">"{t.description}"</p>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="py-20 text-center card border-dashed">
              <div className="text-4xl mb-4">📈</div>
              <h4 className="text-sm font-bold text-[var(--text-1)]">No Performance Targets</h4>
              <p className="text-xs text-[var(--text-4)] max-w-xs mx-auto mt-1">
                {canViewAllTargets ? 'Establish performance goals and track employee progress directly from this dashboard.' : 'No performance targets have been assigned to you yet.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {showTargetModal && (
        <Modal title="Set New Target" subtitle="Create an employee performance target and sync it to the server" onClose={() => setShowTargetModal(false)} width={620}>
          <Field label="Employee" required><Select value={targetForm.employeeId} onChange={employeeId => setTargetForm(p => ({ ...p, employeeId }))} options={employeeOptions.length ? employeeOptions : [{ value: '', label: 'No active employees available' }]} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Metric" required><Input autoFocus value={targetForm.metric} onChange={metric => setTargetForm(p => ({ ...p, metric }))} placeholder="e.g. Closed sales" /></Field>
            <Field label="Unit"><Input value={targetForm.unit} onChange={unit => setTargetForm(p => ({ ...p, unit }))} placeholder="e.g. KSh, orders, calls" /></Field>
            <Field label="Target Value" required><Input type="number" value={targetForm.targetValue} onChange={targetValue => setTargetForm(p => ({ ...p, targetValue }))} /></Field>
            <Field label="Current Value"><Input type="number" value={targetForm.currentValue} onChange={currentValue => setTargetForm(p => ({ ...p, currentValue }))} /></Field>
            <Field label="Period"><Select value={targetForm.period} onChange={period => setTargetForm(p => ({ ...p, period: period as PerfPeriod }))} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'annual', label: 'Annual' }]} /></Field>
            <Field label="Period Label" required><Input value={targetForm.periodLabel} onChange={periodLabel => setTargetForm(p => ({ ...p, periodLabel }))} placeholder="e.g. May 2026" /></Field>
            <Field label="Due Date" required><Input type="date" value={targetForm.dueDate} onChange={dueDate => setTargetForm(p => ({ ...p, dueDate }))} /></Field>
            <Field label="Initial Status"><Select value={targetForm.status} onChange={status => setTargetForm(p => ({ ...p, status: status as PerfStatus }))} options={[{ value: 'on_track', label: 'On Track' }, { value: 'at_risk', label: 'At Risk' }, { value: 'achieved', label: 'Achieved' }, { value: 'missed', label: 'Missed' }]} /></Field>
          </div>
          <Field label="Description"><Textarea value={targetForm.description} onChange={description => setTargetForm(p => ({ ...p, description }))} placeholder="Describe the target and any measurement rules." /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setShowTargetModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={submitTarget}>Save Target</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
