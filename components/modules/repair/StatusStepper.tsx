'use client'

import { Fa } from '@/components/icons'
import { faCheck, faCircleDot, faLock } from '@fortawesome/free-solid-svg-icons'
import { STEPPER_STEPS, STATUS_LABELS, STATUS_COLORS } from '../repair-config'

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
  const resolvedSteps  = steps  ?? STEPPER_STEPS
  const resolvedLabels = labels ?? STATUS_LABELS

  const currentIndex = resolvedSteps.indexOf(currentStatus)
  const isFailed     = TERMINAL_FAIL.includes(currentStatus)

  // Build history map keyed by status, preferring `date` then `timestamp`
  const historyMap = history.reduce<Record<string, HistoryEntry>>((acc, h) => {
    if (h.status) acc[h.status] = h
    return acc
  }, {})

  return (
    <div className="relative select-none">
      <style>{`
        @keyframes stepPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--pulse-color); }
          50%       { box-shadow: 0 0 0 8px transparent; }
        }
        @keyframes stepGlow {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.6; }
        }
        @keyframes lineGrow {
          from { height: 0; }
          to   { height: 100%; }
        }
        .step-enter {
          animation: fadeSlideIn 0.35s ease both;
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>

      {/* Vertical track */}
      <div className="absolute left-[11px] top-4 bottom-4 w-0.5 rounded-full bg-[var(--border)]" />

      {/* Filled progress track */}
      {currentIndex > 0 && !isFailed && (
        <div
          className="absolute left-[11px] top-4 w-0.5 rounded-full transition-all duration-700"
          style={{
            height: `calc(${(currentIndex / (resolvedSteps.length - 1)) * 100}% - 8px)`,
            background: 'linear-gradient(to bottom, #3B82F6, #10B981)',
            boxShadow: '0 0 6px rgba(59,130,246,0.4)',
          }}
        />
      )}

      <div className="space-y-1 relative">
        {resolvedSteps.map((step, idx) => {
          const isCompleted = isFailed ? false : idx < currentIndex
          const isCurrent   = idx === currentIndex
          const isPending   = isFailed ? idx !== currentIndex : idx > currentIndex
          const hist        = historyMap[step]
          const color       = STATUS_COLORS[step as keyof typeof STATUS_COLORS] ?? '#94A3B8'
          const ts          = fmtTs(hist?.date ?? hist?.timestamp)

          return (
            <div
              key={step}
              className="step-enter flex items-start gap-3.5 py-2 rounded-xl transition-all duration-200"
              style={{
                animationDelay: `${idx * 40}ms`,
                opacity: isPending ? 0.45 : 1,
              }}
            >
              {/* ── Node ── */}
              <div className="relative z-10 shrink-0 mt-0.5">
                {isCompleted ? (
                  /* Completed: colored ring + check */
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300"
                    style={{
                      background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                      boxShadow: `0 0 0 3px ${color}25, 0 2px 6px ${color}40`,
                    }}
                  >
                    <Fa icon={faCheck} className="text-white text-9" />
                  </div>
                ) : isCurrent ? (
                  /* Current: pulsing glow with status color */
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{
                      background: color,
                      boxShadow: `0 0 0 3px ${color}30, 0 0 12px ${color}50`,
                      animation: `stepPulse 2s ease-in-out infinite`,
                      ['--pulse-color' as string]: `${color}40`,
                    }}
                  >
                    <Fa icon={faCircleDot} className="text-white text-10" />
                  </div>
                ) : (
                  /* Pending: subtle circle with number */
                  <div className="w-6 h-6 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-center">
                    {isFailed && idx === currentIndex ? (
                      <Fa icon={faLock} className="text-[var(--text-4)] text-[8px]" />
                    ) : (
                      <span className="text-[8px] font-black text-[var(--text-4)]">{idx + 1}</span>
                    )}
                  </div>
                )}
              </div>

              {/* ── Content ── */}
              <div className="flex-1 min-w-0 pb-0.5">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p
                      className="text-11 font-black uppercase tracking-wider leading-none truncate"
                      style={{ color: isCurrent ? color : isCompleted ? 'var(--text-2)' : 'var(--text-4)' }}
                    >
                      {resolvedLabels[step as keyof typeof resolvedLabels] ?? step.replace(/_/g, ' ')}
                    </p>
                    {isCurrent && (
                      <span
                        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest"
                        style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}
                      >
                        <span
                          className="w-1 h-1 rounded-full shrink-0"
                          style={{ background: color, animation: 'stepGlow 1.5s ease-in-out infinite' }}
                        />
                        Now
                      </span>
                    )}
                  </div>
                  {ts && (
                    <span className="text-9 font-semibold text-[var(--text-4)] tabular-nums shrink-0">{ts}</span>
                  )}
                </div>

                {/* History note */}
                {hist?.note && (
                  <p className="text-10 text-[var(--text-3)] font-medium mt-0.5 leading-snug">{hist.note}</p>
                )}
                {hist?.by && !hist.note && (
                  <p className="text-9 text-[var(--text-4)] mt-0.5">by {hist.by}</p>
                )}

                {/* Color indicator bar for completed/current */}
                {(isCompleted || isCurrent) && (
                  <div
                    className="mt-1.5 h-0.5 rounded-full transition-all duration-500"
                    style={{
                      width: isCurrent ? '60%' : '100%',
                      background: isCurrent
                        ? `linear-gradient(to right, ${color}, transparent)`
                        : `${color}50`,
                    }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
