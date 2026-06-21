'use client'
import { useRepair } from './repair/RepairContext'
import { RefurbStatus, fmtDate } from '@/lib/store'
import { Fa } from '@/components/icons'
import { StatePanel } from '@/components/ui'
import { 
  faMicrochip, 
  faCalendarAlt, 
  faUser, 
  faArrowRight,
  faInfoCircle
} from '@fortawesome/free-solid-svg-icons'

const REFURB_STATUS_META: Record<RefurbStatus, { label: string; bg: string; color: string }> = {
  queued:      { label: 'Queued',      bg: 'bg-amber-100', color: 'text-amber-700' },
  assigned:    { label: 'Assigned',    bg: 'bg-blue-100', color: 'text-blue-700' },
  in_progress: { label: 'In Progress', bg: 'bg-indigo-100', color: 'text-indigo-700' },
  ready:       { label: 'Ready',       bg: 'bg-emerald-100', color: 'text-emerald-700' },
  transferred: { label: 'Transferred', bg: 'bg-slate-100', color: 'text-slate-700' },
  written_off: { label: 'Written Off', bg: 'bg-red-100', color: 'text-red-700' },
}

export default function RepairRefurbJobs({ onSelect }: { onSelect: (id: string) => void }) {
  const { refurbishmentJobs, currentUserId, currentUser } = useRepair()

  const isLeadTech = currentUser?.role === 'technical_lead' || currentUser?.role === 'director'
  const isAdmin = currentUser?.role === 'director' || currentUser?.role === 'admin_officer'
  const isRepairTech = currentUser?.role === 'technician'

  const jobs = refurbishmentJobs
    .filter(j => (isLeadTech || isAdmin) ? true : j.assignedTechnicianId === currentUserId)
    .filter(j => !['transferred', 'written_off'].includes(j.status))

  return (
    <div className="flex flex-col h-full bg-white animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <Fa icon={faMicrochip} className="text-sm" />
          </div>
          <div>
            <p className="text-xs font-black text-slate-900 uppercase tracking-tight">Refurbishment Jobs</p>
            <p className="text-[10px] text-slate-400 font-bold">{jobs.length} Active Jobs</p>
          </div>
        </div>
        {isRepairTech && (
          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100">Assigned to you</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {jobs.length === 0 ? (
          <div className="px-6 py-10">
            <StatePanel
              tone="empty"
              title="No refurbishment jobs"
              description={isRepairTech ? 'None assigned to you yet.' : 'No active refurbishment jobs at the moment.'}
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {jobs.map(j => {
              const meta = REFURB_STATUS_META[j.status]
              return (
                <div 
                  key={j.id} 
                  onClick={() => onSelect(j.id)}
                  className="px-6 py-4 flex flex-col gap-2 hover:bg-slate-50/50 cursor-pointer transition-all border-l-4 border-l-indigo-600 group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-black text-indigo-600 tracking-tighter group-hover:underline underline-offset-4">{j.ref}</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${meta.bg} ${meta.color}`}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <p className="text-xs font-bold text-slate-800 truncate">{j.productName}</p>
                    <p className="font-mono text-[10px] text-slate-400 font-medium">{j.serialNumber || 'No Serial'}</p>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        {j.assignedTechnicianName ? (
                          <>
                            <div className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[8px] font-black shadow-sm">
                              {j.assignedTechnicianName.slice(0, 1).toUpperCase()}
                            </div>
                            <span className="text-[10px] font-bold text-slate-600">{j.assignedTechnicianName}</span>
                          </>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 italic">Unassigned</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Fa icon={faCalendarAlt} className="text-[9px]" />
                        <span className="text-[10px] font-bold">{fmtDate(j.intakeDate)}</span>
                      </div>
                    </div>
                    <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-all">
                      <Fa icon={faArrowRight} className="text-[10px]" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* Footer Info */}
      <div className="px-6 py-3 bg-indigo-50/30 border-t border-indigo-100 flex items-center gap-2">
        <Fa icon={faInfoCircle} className="text-indigo-400 text-xs" />
        <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-tight">
          Manage refurbishment details in the <strong>Refurbishment</strong> module
        </p>
      </div>
    </div>
  )
}
