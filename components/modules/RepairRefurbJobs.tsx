'use client'
import { useApp, RefurbStatus, fmtDate } from '@/lib/store'

const REFURB_STATUS_META: Record<RefurbStatus, { label: string; bg: string; color: string }> = {
  queued:      { label: 'Queued',      bg: '#FEF3C7', color: '#92400E' },
  assigned:    { label: 'Assigned',    bg: '#DBEAFE', color: '#1E40AF' },
  in_progress: { label: 'In Progress', bg: '#EDE9FE', color: '#5B21B6' },
  ready:       { label: 'Ready',       bg: '#D1FAE5', color: '#065F46' },
  transferred: { label: 'Transferred', bg: '#F3F4F6', color: '#374151' },
  written_off: { label: 'Written Off', bg: '#FEE2E2', color: '#991B1B' },
}

interface Props {
  isLeadTech: boolean
  isRepairTech: boolean
  isAdmin: boolean
}

export default function RepairRefurbJobs({ isLeadTech, isRepairTech, isAdmin }: Props) {
  const { refurbishmentJobs, currentUserId } = useApp()

  const jobs = refurbishmentJobs
    .filter(j => (isLeadTech || isAdmin) ? true : j.assignedTechnicianId === currentUserId)
    .filter(j => !['transferred', 'written_off'].includes(j.status))

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ background: '#FAF9FF' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0"
        style={{ background: '#F5F3FF', borderBottom: '1px solid #EDE9FE' }}>
        <div className="w-5 h-5 rounded flex items-center justify-center text-white text-[10px] font-bold"
          style={{ background: '#5B21B6' }}>R</div>
        <p className="text-xs font-bold" style={{ color: '#5B21B6' }}>Refurbishment Jobs</p>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
          style={{ background: '#EDE9FE', color: '#5B21B6' }}>{jobs.length}</span>
        {isRepairTech && (
          <span className="text-[9px] text-t3 ml-auto italic">assigned to you</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <span className="text-3xl mb-3">🔩</span>
            <p className="text-sm font-medium text-t2">No refurbishment jobs</p>
            <p className="text-[10px] text-t3 mt-1">
              {isRepairTech ? 'None assigned to you yet' : 'No active refurb jobs'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {jobs.map(j => {
              const meta = REFURB_STATUS_META[j.status]
              return (
                <div key={j.id} className="px-4 py-3 flex flex-col gap-1"
                  style={{ borderBottom: '1px solid #EDE9FE', borderLeft: '3px solid #8B5CF6' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#5B21B6' }}>{j.ref}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                  </div>
                  <p className="text-xs text-t1 truncate">{j.productName}</p>
                  <p className="font-mono text-[10px] text-t3">{j.serialNumber}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {j.assignedTechnicianName ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-white text-[7px] font-bold flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, #5B21B6, #8B5CF6)' }}>
                          {j.assignedTechnicianName.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="text-[10px] text-t2">{j.assignedTechnicianName}</span>
                      </>
                    ) : (
                      <span className="text-[10px] text-t3 italic">Unassigned</span>
                    )}
                    <span className="text-[10px] text-t3 ml-auto">{fmtDate(j.intakeDate)}</span>
                  </div>
                </div>
              )
            })}
            <div className="px-4 py-2 text-[10px]"
              style={{ background: '#F5F3FF', color: '#6D28D9', borderTop: '1px solid #EDE9FE' }}>
              Manage refurbishment progress in the <strong>Refurbishment</strong> module
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
