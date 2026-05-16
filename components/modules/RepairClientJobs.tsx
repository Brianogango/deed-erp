'use client'
import { useApp, RepairOrder, RepairStatus, fmtKes, fmtDate } from '@/lib/store'
import { Badge } from '@/components/ui'
import { STATUS_LABELS } from './repair-config'

interface FilterTab {
  id: RepairStatus | 'all'
  label: string
  count: number
}

interface Props {
  filtered: RepairOrder[]
  filter: RepairStatus | 'all'
  setFilter: (f: RepairStatus | 'all') => void
  filterTabs: FilterTab[]
  isLeadTech: boolean
  onSelectRepair: (id: string) => void
  onQuickAssign: (id: string) => void
}

export default function RepairClientJobs({
  filtered, filter, setFilter, filterTabs, isLeadTech, onSelectRepair, onQuickAssign,
}: Props) {
  const { outsourceJobs } = useApp()

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ minWidth: 0 }}>
      {/* Section header + filter tabs */}
      <div className="flex-shrink-0 bg-white border-b border-[var(--border-lt)]">
        <div className="flex items-center gap-1 px-6 py-3 overflow-x-auto scrollbar-hide">
          {filterTabs.map(tab => (
            <button 
              key={tab.id} 
              onClick={() => setFilter(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold transition-all whitespace-nowrap
                ${filter === tab.id 
                  ? 'bg-primary-50 text-primary-600 border border-primary-100' 
                  : 'text-[var(--text-3)] hover:bg-[var(--bg-surface)] border border-transparent'}
              `}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span className={`
                  px-1.5 py-0.5 rounded-full text-[9px] font-bold
                  ${filter === tab.id ? 'bg-primary-600 text-white' : 'bg-[var(--bg-surface)] text-[var(--text-4)]'}
                `}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto w-full">
          <div className="min-w-[800px] flex flex-col min-h-full">
            <div className="table-head px-6 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-lt)]" style={{
              display: 'grid',
              gridTemplateColumns: isLeadTech
                ? '100px 1.5fr 1.5fr 100px 120px 130px 100px 80px 80px'
                : '100px 1.5fr 1.5fr 100px 120px 130px 100px 80px',
              gap: 12, alignItems: 'center',
            }}>
              {(isLeadTech
                ? ['Reference', 'Customer', 'Device Details', 'Status', 'Location', 'Technician', 'Date', 'Total', 'Action']
                : ['Reference', 'Customer', 'Device Details', 'Status', 'Location', 'Technician', 'Date', 'Total']
              ).map(h => (
                <span key={h} className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                  {h}
                </span>
              ))}
            </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-4xl mb-3">🔧</span>
            <p className="text-sm font-medium text-t2">No repair jobs found</p>
            <p className="text-xs text-t3 mt-1">Click "+ New Intake" to create the first job</p>
          </div>
        ) : (
          filtered.map(r => {
            const isOpen = !['delivered', 'closed', 'cancelled'].includes(r.status)
            const cols = isLeadTech
              ? '90px 1fr 1fr 80px 100px 110px 88px 62px 72px'
              : '90px 1fr 1fr 80px 100px 110px 88px 62px'
            const rowCols = isLeadTech
              ? '100px 1.5fr 1.5fr 100px 120px 130px 100px 80px 80px'
              : '100px 1.5fr 1.5fr 100px 120px 130px 100px 80px'
            return (
              <div key={r.id} className="table-row px-6 py-4 hover:bg-[var(--bg-surface)] cursor-pointer transition-colors border-b border-[var(--border-lt)]"
                style={{ display: 'grid', gridTemplateColumns: rowCols, gap: 12, alignItems: 'center' }}
                onClick={() => onSelectRepair(r.id)}>
                <div className="min-w-0">
                  <span className="font-mono text-[11px] font-bold text-primary-600">{r.ref}</span>
                  {r.priority && r.priority !== 'normal' && (
                    <div className={`
                      inline-flex items-center gap-1 px-1.5 py-0.5 rounded mt-1 text-[8px] font-bold uppercase
                      ${r.priority === 'urgent' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}
                    `}>
                      <span>{r.priority === 'urgent' ? '●' : '●'}</span>
                      <span>{r.priority}</span>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--text-1)] truncate">{r.customerName}</p>
                  <p className="text-[10px] text-[var(--text-4)] truncate">{r.customerPhone}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[var(--text-2)] truncate">{r.productName}</p>
                  {r.serialNumber && <p className="text-[10px] text-[var(--text-4)] font-mono truncate">{r.serialNumber}</p>}
                </div>
                <Badge status={r.status} label={STATUS_LABELS[r.status]} />
                {/* Location */}
                {(() => {
                  const outJob = outsourceJobs.find(j => j.repairOrderId === r.id && j.status === 'sent')
                  let label: string, bg: string, color: string
                  if (outJob) {
                    label = `🏭 ${outJob.vendorName}`; bg = 'bg-amber-50'; color = 'text-amber-700'
                  } else if (['declined', 'unrepairable'].includes(r.status)) {
                    label = '📦 Pending Return'; bg = 'bg-red-50'; color = 'text-red-700'
                  } else if (['delivered', 'returned', 'closed', 'cancelled'].includes(r.status)) {
                    label = '✅ With Customer'; bg = 'bg-green-50'; color = 'text-green-700'
                  } else {
                    label = '🔧 In Shop'; bg = 'bg-primary-50'; color = 'text-primary-700'
                  }
                  return (
                    <span className={`
                      text-[9px] font-bold px-2 py-1 rounded-full whitespace-nowrap inline-block truncate max-w-full
                      ${bg} ${color}
                    `}>{label}</span>
                  )
                })()}
                {/* Technician */}
                <div className="flex items-center gap-2 min-w-0">
                  {r.assignedTechnicianName ? (
                    <>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 bg-gradient-to-br from-primary-500 to-primary-700">
                        {r.assignedTechnicianName.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-xs text-[var(--text-2)] truncate">{r.assignedTechnicianName}</span>
                    </>
                  ) : (
                    <span className="text-xs text-[var(--text-4)] italic">Unassigned</span>
                  )}
                </div>
                <span className="text-xs text-[var(--text-3)]">{fmtDate(r.intakeDate)}</span>
                <span className="text-xs font-bold text-[var(--text-1)]">{r.total ? fmtKes(r.total) : '—'}</span>
                {isLeadTech && (
                  <button
                    onClick={e => { e.stopPropagation(); onQuickAssign(r.id) }}
                    disabled={!isOpen}
                    className={`
                      text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all
                      ${isOpen 
                        ? 'bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-100' 
                        : 'bg-gray-50 text-gray-300 border border-gray-100 cursor-not-allowed'}
                    `}
                  >
                    {r.assignedTechnicianName ? 'Reassign' : 'Assign'}
                  </button>
                )}
              </div>
            )
          })
        )}
          </div>
        </div>
      </div>
    </div>
  )
}
