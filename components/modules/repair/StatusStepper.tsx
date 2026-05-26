'use client'

import { Fa } from '@/components/icons'
import { faCheckCircle, faCircle } from '@fortawesome/free-solid-svg-icons'

interface StatusStepperProps {
  currentStatus: string
  steps: string[]
  labels: Record<string, string>
}

export default function StatusStepper({ currentStatus, steps, labels }: StatusStepperProps) {
  const currentIndex = steps.indexOf(currentStatus)

  return (
    <div className="relative">
      <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-slate-100" />
      <div className="space-y-6 relative">
        {steps.map((step, idx) => {
          const isCompleted = idx < currentIndex
          const isCurrent = idx === currentIndex
          const isPending = idx > currentIndex

          return (
            <div key={step} className="flex items-start gap-4">
              <div className={`
                relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[10px]
                ${isCompleted ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 
                  isCurrent ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 ring-4 ring-blue-50' : 
                  'bg-white text-slate-300 border-2 border-slate-100'}
              `}>
                {isCompleted ? <Fa icon={faCheckCircle} className="text-[10px]" /> : <span>{idx + 1}</span>}
              </div>
              <div className="flex-1 pt-0.5">
                <p className={`text-[10px] font-black uppercase tracking-widest ${isCurrent ? 'text-blue-600' : isCompleted ? 'text-slate-700' : 'text-slate-400'}`}>
                  {labels[step] || step.replace('_', ' ')}
                </p>
                {isCurrent && (
                  <p className="text-[9px] text-slate-400 font-bold mt-0.5 uppercase tracking-tighter italic">Currently at this stage</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
