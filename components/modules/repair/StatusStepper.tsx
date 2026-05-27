'use client'

import { Fa } from '@/components/icons'
import { faCheckCircle, faCircleDot } from '@fortawesome/free-solid-svg-icons'
import { STEPPER_STEPS, STATUS_LABELS, STATUS_COLORS } from '../repair-config'

interface HistoryEntry {
  status: string
  timestamp?: string
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
  } catch {
    return null
  }
}

export default function StatusStepper({ currentStatus, history = [], steps, labels }: StatusStepperProps) {
  const resolvedSteps  = steps  ?? STEPPER_STEPS
  const resolvedLabels = labels ?? STATUS_LABELS

  const currentIndex = resolvedSteps.indexOf(currentStatus)
  const progressPct  = resolvedSteps.length > 1
    ? Math.max(0, Math.min(100, (currentIndex / (resolvedSteps.length - 1)) * 100))
    : 0

  const historyMap = history.reduce<Record<string, HistoryEntry>>((acc, h) => {
    if (h.status) acc[h.status] = h
    return acc
  }, {})

  return (
    <div className="relative">
      {/* Background track */}
      <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-slate-100 rounded-full" />
      {/* Filled progress */}
      <div
        className="absolute left-[11px] top-3 w-0.5 bg-gradient-to-b from-blue-500 to-emerald-500 rounded-full transition-all duration-700"
        style={{ height: `${progressPct}%` }}
      />

      <div className="space-y-4 relative">
        {resolvedSteps.map((step, idx) => {
          const isCompleted = idx < currentIndex
          const isCurrent   = idx === currentIndex
          const isPending   = idx > currentIndex
          const hist        = historyMap[step]
          const color       = STATUS_COLORS[step as keyof typeof STATUS_COLORS] ?? '#94A3B8'

          return (
            <div key={step} className={`flex items-start gap-3.5 group transition-opacity ${isPending ? 'opacity-40' : 'opacity-100'}`}>
              {/* Step indicator */}
              <div className="relative z-10 shrink-0 mt-0.5">
                {isCompleted ? (
                  <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-100">
                    <Fa icon={faCheckCircle} className="text-white text-[10px]" />
                  </div>
                ) : isCurrent ? (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center ring-4 ring-offset-1 ring-blue-100 shadow-lg" style={{ backgroundColor: color }}>
                    <Fa icon={faCircleDot} className="text-white text-[10px]" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center">
                    <span className="text-[9px] font-black text-slate-400">{idx + 1}</span>
                  </div>
                )}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-[11px] font-black uppercase tracking-wider leading-none ${
                    isCurrent ? 'text-blue-600' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                  }`}>
                    {resolvedLabels[step as keyof typeof resolvedLabels] ?? step.replace(/_/g, ' ')}
                  </p>
                  {hist?.timestamp && (
                    <span className="text-[9px] font-bold text-slate-400 tabular-nums shrink-0">{fmtTs(hist.timestamp)}</span>
                  )}
                </div>
                {isCurrent && (
                  <p className="text-[9px] text-blue-400 font-bold mt-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                    Current stage
                  </p>
                )}
                {hist?.by && (
                  <p className="text-[9px] text-slate-400 font-medium mt-0.5">by {hist.by}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
