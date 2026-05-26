'use client'
import { useRepair } from './repair/RepairContext'
import { Badge } from '@/components/ui'
import { STATUS_LABELS } from './repair-config'
import { fmtKes, fmtDate } from '@/lib/store'
import { Fa } from '@/components/icons'
import { 
  faTools, 
  faHourglassHalf, 
  faScrewdriverWrench, 
  faExclamationCircle, 
  faCheckCircle, 
  faArchive,
  faPlus,
  faSearch,
  faMapMarkerAlt,
  faUser,
  faCalendarAlt,
  faChevronRight
} from '@fortawesome/free-solid-svg-icons'

export default function RepairClientJobs({ onNewIntake, onSelect }: { onNewIntake: () => void, onSelect: (id: string) => void }) {
  const { 
    visibleRepairs: filtered, 
    filter, 
    setFilter, 
    repairs, 
    currentUser, 
    outsourceJobs,
    setShowAssignModal,
    setActiveId
  } = useRepair()

  const isLeadTech = currentUser?.role === 'technical_lead' || currentUser?.role === 'director'

  // Summary stats
  const stats = [
    { label: 'TOTAL JOBS', count: repairs.length, icon: faTools, color: 'bg-blue-600', border: 'border-l-blue-600' },
    { label: 'PENDING', count: repairs.filter(r => ['pending_verification', 'received', 'assigned'].includes(r.status)).length, icon: faHourglassHalf, color: 'bg-amber-500', border: 'border-l-amber-500' },
    { label: 'IN REPAIR', count: repairs.filter(r => r.status === 'in_repair').length, icon: faScrewdriverWrench, color: 'bg-indigo-500', border: 'border-l-indigo-500' },
    { label: 'AWAITING APPR', count: repairs.filter(r => r.status === 'awaiting_approval').length, icon: faExclamationCircle, color: 'bg-orange-500', border: 'border-l-orange-500' },
    { label: 'READY', count: repairs.filter(r => r.status === 'ready').length, icon: faCheckCircle, color: 'bg-emerald-500', border: 'border-l-emerald-500' },
    { label: 'COMPLETED', count: repairs.filter(r => ['delivered', 'closed'].includes(r.status)).length, icon: faArchive, color: 'bg-slate-600', border: 'border-l-slate-600' },
  ]

  const filterTabs = [
    { id: 'all', label: 'All', count: repairs.length },
    { id: 'pending_verification', label: 'New', count: repairs.filter(r => r.status === 'pending_verification').length },
    { id: 'assigned', label: 'Assigned', count: repairs.filter(r => r.status === 'assigned').length },
    { id: 'diagnosed', label: 'Diagnosed', count: repairs.filter(r => r.status === 'diagnosed').length },
    { id: 'awaiting_approval', label: 'Awaiting Approval', count: repairs.filter(r => r.status === 'awaiting_approval').length },
    { id: 'awaiting_parts', label: 'Awaiting Parts', count: repairs.filter(r => r.status === 'awaiting_parts').length },
    { id: 'in_repair', label: 'In Repair', count: repairs.filter(r => r.status === 'in_repair').length },
    { id: 'qc', label: 'QC Testing', count: repairs.filter(r => r.status === 'qc').length },
    { id: 'ready', label: 'Ready', count: repairs.filter(r => r.status === 'ready').length },
    { id: 'declined', label: 'Declined', count: repairs.filter(r => r.status === 'declined').length },
    { id: 'unrepairable', label: 'Unrepairable', count: repairs.filter(r => r.status === 'unrepairable').length },
  ]

  return (
    <div className="flex flex-col h-full bg-slate-50/50 animate-in fade-in duration-300">
      {/* Dashboard Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-6 flex-shrink-0">
        <div className="max-w-[1600px] mx-auto flex flex-col gap-8">
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-600 shadow-inner">
                <Fa icon={faTools} className="text-xl" />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 tracking-tight">Repair Management</h1>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-0.5">{repairs.length} total jobs</p>
              </div>
            </div>
            <button 
              onClick={onNewIntake}
              className="btn-primary px-6 py-3 rounded-2xl bg-slate-900 hover:bg-black shadow-xl shadow-slate-200 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <Fa icon={faPlus} className="text-xs" />
              <span className="font-bold tracking-tight">New Intake</span>
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {stats.map((s, i) => (
              <div key={i} className={`card p-4 border-l-4 ${s.border} shadow-sm hover:shadow-md transition-shadow cursor-default group`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{s.label}</span>
                  <Fa icon={s.icon} className={`text-xs ${s.color.replace('bg-', 'text-')} opacity-40 group-hover:opacity-100 transition-opacity`} />
                </div>
                <p className="text-2xl font-black text-slate-900 tracking-tighter">{s.count}</p>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col p-6 max-w-[1600px] mx-auto w-full">
        
        {/* Filter Bar & Search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-1 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide w-full sm:w-auto">
            {filterTabs.map(tab => (
              <button 
                key={tab.id} 
                onClick={() => setFilter(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold transition-all whitespace-nowrap
                  ${filter === tab.id 
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' 
                    : 'text-slate-500 hover:bg-slate-100'}
                `}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`
                    px-1.5 py-0.5 rounded-full text-[9px] font-black
                    ${filter === tab.id ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}
                  `}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          
          <div className="relative w-full sm:w-64">
            <Fa icon={faSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
            <input 
              type="text" 
              placeholder="Search repairs..." 
              className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-xs font-medium focus:ring-2 focus:ring-slate-100 focus:border-slate-300 transition-all outline-none"
            />
          </div>
        </div>

        {/* Table Section */}
        <div className="flex-1 overflow-hidden card shadow-sm border-slate-200 flex flex-col bg-white">
          <div className="overflow-x-auto w-full flex-1 custom-scrollbar">
            <table className="w-full border-collapse min-w-[1000px]">
              <thead className="sticky top-0 z-20 bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Reference', 'Customer', 'Device Details', 'Status', 'Location', 'Technician', 'Date', 'Total'].map(h => (
                    <th key={h} className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {h}
                    </th>
                  ))}
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-24 text-center">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Fa icon={faTools} className="text-4xl opacity-10" />
                        <p className="text-sm font-bold">No repair jobs found</p>
                        <p className="text-[11px] font-medium opacity-60">Try adjusting your filters or search query</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map(r => {
                    const outJob = outsourceJobs.find(j => j.repairOrderId === r.id && j.status === 'sent')
                    return (
                      <tr 
                        key={r.id} 
                        onClick={() => onSelect(r.id)}
                        className="group hover:bg-slate-50/80 cursor-pointer transition-all animate-in fade-in duration-300"
                      >
                        <td className="px-6 py-4">
                          <span className="text-[11px] font-black text-slate-900 font-mono tracking-tighter group-hover:text-blue-600 transition-colors">
                            {r.ref}
                          </span>
                          {r.priority && r.priority !== 'normal' && (
                            <div className={`mt-1 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full inline-block ${r.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                              {r.priority}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-900">{r.customerName}</span>
                            <span className="text-[10px] text-slate-400 font-medium">{r.customerPhone}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col max-w-[200px]">
                            <span className="text-xs font-bold text-slate-700 truncate">{r.productName}</span>
                            {r.serialNumber && <span className="text-[10px] text-slate-400 font-mono truncate">{r.serialNumber}</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge status={r.status} label={STATUS_LABELS[r.status]} />
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            let label: string, color: string
                            if (outJob) {
                              label = outJob.vendorName; color = 'text-amber-600'
                            } else if (['declined', 'unrepairable'].includes(r.status)) {
                              label = 'Pending Return'; color = 'text-red-600'
                            } else if (['delivered', 'returned', 'closed', 'cancelled'].includes(r.status)) {
                              label = 'With Customer'; color = 'text-emerald-600'
                            } else {
                              label = 'In Shop'; color = 'text-blue-600'
                            }
                            return (
                              <div className="flex items-center gap-1.5">
                                <Fa icon={faMapMarkerAlt} className={`text-[10px] ${color} opacity-50`} />
                                <span className={`text-[11px] font-bold ${color}`}>{label}</span>
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          {r.assignedTechnicianName ? (
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] font-black shadow-sm">
                                {r.assignedTechnicianName.slice(0, 1).toUpperCase()}
                              </div>
                              <span className="text-xs font-bold text-slate-700">{r.assignedTechnicianName}</span>
                            </div>
                          ) : (
                            <span className="text-xs font-medium text-slate-400 italic">Unassigned</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <Fa icon={faCalendarAlt} className="text-[10px] opacity-40" />
                            <span className="text-[11px] font-bold">{fmtDate(r.intakeDate)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs font-black text-slate-900">{r.total ? fmtKes(r.total) : '—'}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 group-hover:text-blue-600 group-hover:bg-blue-50 transition-all">
                              <Fa icon={faChevronRight} className="text-[10px]" />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Placeholder */}
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Showing {filtered.length} of {repairs.length} results</p>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-400 cursor-not-allowed">Previous</button>
              <button className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-white transition-all">Next</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
