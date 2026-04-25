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
      <div className="flex-shrink-0" style={{ background: '#FFFFFF', borderBottom: '1px solid #F3F4F6' }}>
        <div className="flex items-center gap-2 px-5 py-2.5">
          <div className="w-5 h-5 rounded flex items-center justify-center text-white text-[10px] font-bold"
            style={{ background: '#1B2762' }}>C</div>
          <p className="text-xs font-bold text-t1">Client Repairs</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ background: '#E8F3FA', color: '#1B2762' }}>{filtered.length}</span>
        </div>
        <div className="flex items-center gap-1 px-5 pb-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {filterTabs.map(tab => (
            <button key={tab.id} onClick={() => setFilter(tab.id)}
              style={{
                padding: '5px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 10, whiteSpace: 'nowrap',
                fontWeight: filter === tab.id ? 600 : 400, transition: 'all 0.15s',
                background: filter === tab.id ? '#E8F3FA' : 'transparent',
                border: `1px solid ${filter === tab.id ? '#A8D4E8' : 'transparent'}`,
                color: filter === tab.id ? '#1B2762' : '#6B7280',
              }}>
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  marginLeft: 4, fontSize: 9, fontWeight: 700,
                  background: filter === tab.id ? '#A8D4E8' : '#F3F4F6',
                  color: filter === tab.id ? '#1B2762' : '#9CA3AF',
                  borderRadius: 20, padding: '1px 4px',
                }}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto w-full">
          <div className="min-w-[800px] flex flex-col min-h-full">
            <div className="table-head px-4 py-2.5" style={{
              display: 'grid',
              gridTemplateColumns: isLeadTech
                ? '90px 1fr 1fr 80px 100px 110px 88px 62px 72px'
                : '90px 1fr 1fr 80px 100px 110px 88px 62px',
              gap: 10, alignItems: 'center',
            }}>
              {(isLeadTech
                ? ['Ref', 'Customer', 'Device', 'Status', 'Location', 'Technician', 'Date', 'Total', '']
                : ['Ref', 'Customer', 'Device', 'Status', 'Location', 'Technician', 'Date', 'Total']
              ).map(h => <span key={h}>{h}</span>)}
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
            return (
              <div key={r.id} className="table-row"
                style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center' }}
                onClick={() => onSelectRepair(r.id)}>
                <div className="min-w-0">
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{r.ref}</span>
                  {r.priority && r.priority !== 'normal' && (
                    <span style={{
                      display: 'block', fontSize: 9, fontWeight: 700, marginTop: 2,
                      color: r.priority === 'urgent' ? '#DC2626' : '#92400E',
                    }}>
                      {r.priority === 'urgent' ? '🔴' : '🟡'} {r.priority}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-t1 truncate">{r.customerName}</p>
                  <p className="text-[10px] text-t3 truncate">{r.customerPhone} · By {r.bookedByName || r.createdBy}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-t1 truncate">{r.productName}</p>
                  {r.serialNumber && <p className="text-[10px] text-t3 font-mono truncate">{r.serialNumber}</p>}
                </div>
                <Badge status={r.status} label={STATUS_LABELS[r.status]} />
                {/* Location */}
                {(() => {
                  const outJob = outsourceJobs.find(j => j.repairOrderId === r.id && j.status === 'sent')
                  let label: string, bg: string, color: string
                  if (outJob) {
                    label = `🏭 ${outJob.vendorName}`; bg = '#FEF9C3'; color = '#854D0E'
                  } else if (['declined', 'unrepairable'].includes(r.status)) {
                    label = '📦 Pending Return'; bg = '#FEE2E2'; color = '#991B1B'
                  } else if (['delivered', 'returned', 'closed', 'cancelled'].includes(r.status)) {
                    label = '✅ With Customer'; bg = '#DCFCE7'; color = '#166534'
                  } else {
                    label = '🔧 In Shop'; bg = '#E8F3FA'; color = '#1B2762'
                  }
                  return (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                      background: bg, color, whiteSpace: 'nowrap', display: 'inline-block',
                      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{label}</span>
                  )
                })()}
                {/* Technician */}
                <div className="flex items-center gap-1.5 min-w-0">
                  {r.assignedTechnicianName ? (
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                        {r.assignedTechnicianName.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-xs text-t1 truncate">{r.assignedTechnicianName}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-t3 italic">Unassigned</span>
                  )}
                </div>
                <span className="text-xs text-t3">{fmtDate(r.intakeDate)}</span>
                <span className="text-xs font-semibold text-t1">{r.total ? fmtKes(r.total) : '—'}</span>
                {isLeadTech && (
                  <button
                    onClick={e => { e.stopPropagation(); onQuickAssign(r.id) }}
                    disabled={!isOpen}
                    style={{
                      fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5,
                      cursor: isOpen ? 'pointer' : 'default',
                      background: isOpen ? '#E8F3FA' : '#F9FAFB',
                      color: isOpen ? '#1B2762' : '#D1D5DB',
                      border: `1px solid ${isOpen ? '#A8D4E8' : '#E5E7EB'}`,
                      whiteSpace: 'nowrap', transition: 'all 0.1s',
                    }}>
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
