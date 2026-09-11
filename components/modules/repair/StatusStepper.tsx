'use client'

import { WorkflowStageBar } from '@/components/erp'
import { Fa } from '@/components/icons'
import { faUserPlus } from '@fortawesome/free-solid-svg-icons'
import { useRepair } from './RepairContext'
import { STEPPER_STEPS, STATUS_LABELS } from '../repair-config'
import { normalizeClientRole } from '@/lib/auth/access'

interface HistoryEntry {
  status: string
  date?: string
  timestamp?: string
  note?: string
  by?: string
}

interface StatusStepperProps {
  currentStatus: string
  history?: HistoryEntry[]
  steps?: string[]
  labels?: Record<string, string>
}

function fmtTs(ts?: string) {
  if (!ts) return null
  try {
    return new Date(ts).toLocaleString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return null }
}

const TERMINAL_FAIL = ['declined', 'unrepairable', 'returned', 'cancelled']
const ASSIGNMENT_LOCKED = ['closed', 'cancelled', 'returned', 'retained', 'unrepairable']

export default function StatusStepper({ currentStatus, history = [], steps, labels }: StatusStepperProps) {
  const {
    activeRepair,
    currentUser,
    systemSettings,
    setShowAssignModal,
    outsourceJobs,
  } = useRepair()

  const resolvedSteps = steps ?? STEPPER_STEPS
  const resolvedLabels = labels ?? STATUS_LABELS
  const isTerminalFailure = TERMINAL_FAIL.includes(currentStatus)
  const stageIds = resolvedSteps.includes(currentStatus)
    ? resolvedSteps
    : isTerminalFailure
      ? [...resolvedSteps, currentStatus]
      : resolvedSteps

  const historyMap = history.reduce<Record<string, HistoryEntry>>((acc, h) => {
    if (h.status) acc[h.status] = h
    return acc
  }, {})

  const stages = stageIds.map(step => {
    const hist = historyMap[step]
    const ts = fmtTs(hist?.date ?? hist?.timestamp)
    const detail = [hist?.note, hist?.by ? `by ${hist.by}` : null, ts].filter(Boolean).join(' · ')
    return {
      id: step,
      label: resolvedLabels[step as keyof typeof resolvedLabels] ?? step.replace(/_/g, ' '),
      description: detail || undefined,
    }
  })

  const current = stageIds.includes(currentStatus) ? currentStatus : stageIds[0] ?? currentStatus
  const blocker = isTerminalFailure
    ? `This repair workflow ended as ${resolvedLabels[currentStatus as keyof typeof resolvedLabels] ?? currentStatus.replace(/_/g, ' ')}.`
    : undefined

  const managerRole = normalizeClientRole(currentUser?.role)
  const canManageTechnician = managerRole === 'technical_lead'
    || (managerRole === 'director' && Boolean(systemSettings?.repAdminAssignsJobs))
  const pendingOutsource = Boolean(activeRepair && outsourceJobs?.some(job => job.repairOrderId === activeRepair.id && job.status === 'sent'))
  const assignmentLocked = !activeRepair
    || ASSIGNMENT_LOCKED.includes(currentStatus)
    || currentStatus === 'pending_verification'
    || pendingOutsource
  const technicianName = activeRepair?.assignedTechnicianName || 'Unassigned'

  return (
    <div className="space-y-2">
      {canManageTechnician && (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="min-w-0">
            <span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-4)]">Assigned technician</span>
            <strong className="block truncate text-[12px] font-bold text-[var(--text-1)] sm:text-[13px]">{technicianName}</strong>
            {pendingOutsource && <span className="block text-[10px] text-amber-600">Reassignment is locked while the device is outsourced.</span>}
          </div>
          <button
            type="button"
            onClick={() => setShowAssignModal(true)}
            disabled={assignmentLocked}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-[11px] font-black text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:bg-[var(--bg-surface)] disabled:text-[var(--text-4)]"
            title={assignmentLocked ? 'Technician assignment is locked at this repair stage' : activeRepair?.assignedTechnicianId ? 'Reassign technician' : 'Assign technician'}
          >
            <Fa icon={faUserPlus} className="text-[11px]" />
            {activeRepair?.assignedTechnicianId ? 'Reassign technician' : 'Assign technician'}
          </button>
        </div>
      )}

      <WorkflowStageBar
        stages={stages}
        current={current}
        blocker={blocker}
        className="repair-status-stepper"
        layout="wrap"
      />
    </div>
  )
}
