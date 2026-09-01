'use client'

import { WorkflowStageBar } from '@/components/erp'
import { STEPPER_STEPS, STATUS_LABELS } from '../repair-config'

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

export default function StatusStepper({ currentStatus, history = [], steps, labels }: StatusStepperProps) {
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

  return (
    <WorkflowStageBar
      stages={stages}
      current={current}
      blocker={blocker}
      className="repair-status-stepper"
    />
  )
}
