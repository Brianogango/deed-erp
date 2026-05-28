'use client'
import { useState, useMemo, useEffect } from 'react'
import { useRepair } from './repair/RepairContext'
import { STATUS_LABELS, STATUS_COLORS } from './repair-config'
import { fmtKes, fmtDate } from '@/lib/store'
import { Fa } from '@/components/icons'
import {
  faTools, faHourglassHalf, faScrewdriverWrench, faExclamationCircle,
  faCheckCircle, faArchive, faPlus, faSearch, faMapMarkerAlt, faCalendarAlt,
  faChevronRight, faChevronLeft, faAngleDoubleLeft, faAngleDoubleRight,
  faTimes, faFilter, faChevronDown, faUser, faFlag,
} from '@fortawesome/free-solid-svg-icons'

const ITEMS_PER_PAGE = 15

const STATUS_BADGE: Record<string, string> = {
  pending_verification: 'bg-amber-50 text-amber-700 border-amber-200',
  received:            'bg-slate-100 text-slate-600 border-slate-200',
  assigned:            'bg-blue-50 text-blue-700 border-blue-200',
  diagnosed:           'bg-cyan-50 text-cyan-700 border-cyan-200',
  awaiting_approval:   'bg-orange-50 text-orange-700 border-orange-200',
  approved:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  awaiting_parts:      'bg-orange-100 text-orange-800 border-orange-200',
  in_repair:           'bg-violet-50 text-violet-700 border-violet-200',
  qc:                  'bg-pink-50 text-pink-700 border-pink-200',
  ready:               'bg-emerald-50 text-emerald-700 border-emerald-200',
  invoiced:            'bg-amber-50 text-amber-700 border-amber-200',
  delivered:           'bg-teal-50 text-teal-700 border-teal-200',
  closed:              'bg-slate-100 text-slate-500 border-slate-200',
  declined:            'bg-red-50 text-red-700 border-red-200',
  unrepairable:        'bg-red-100 text-red-800 border-red-300',
  returned:            'bg-stone-50 text-stone-600 border-stone-200',
  cancelled:           'bg-red-50 text-red-600 border-red-200',
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? '#94A3B8'
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wide whitespace-nowrap"
      style={{
        background: `linear-gradient(135deg, ${color}20, ${color}0e)`,
        border: `1px solid ${color}45`,
        color,
        boxShadow: `0 0 0 3px ${color}10`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}
    </span>
  )
}

/* ── Mobile card row ── */
function MobileRepairCard({ r, onSelect, outsourceJobs }: any) {
  const rowColor  = STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#CBD5E1'
  const outJob    = outsourceJobs?.find((j: any) => j.repairOrderId === r.id && j.status === 'sent')
  const locLabel  = outJob ? outJob.vendorName
    : ['declined','unrepairable'].includes(r.status) ? 'Pending Return'
    : ['delivered','returned','closed','cancelled'].includes(r.status) ? 'With Customer'
    : 'In Shop'
  const locCls = outJob ? 'text-amber-600'
    : ['declined','unrepairable'].includes(r.status) ? 'text-red-500'
    : ['delivered','returned','closed','cancelled'].includes(r.status) ? 'text-emerald-600'
    : 'text-blue-600'

  return (
    <button
      onClick={() => onSelect(r.id)}
      className="w-full text-left px-4 py-4 hover:bg-[var(--bg-surface)] active:bg-[var(--bg-surface)] transition-colors border-b border-[var(--border-lt)] last:border-0"
      style={{ borderLeft: `3px solid ${rowColor}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[12px] font-black text-[var(--text-1)] font-mono">{r.ref}</span>
            {r.priority && r.priority !== 'normal' && (
              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${r.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                {r.priority}
              </span>
            )}
          </div>
          <p className="text-[13px] font-bold text-[var(--text-1)] truncate">{r.customerName}</p>
          <p className="text-[11px] text-[var(--text-3)] truncate mt-0.5">{r.productName}</p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <StatusBadge status={r.status} />
          <span className="text-[10px] text-[var(--text-4)] font-medium tabular-nums">{fmtDate(r.intakeDate)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[var(--border-lt)]">
        <div className="flex items-center gap-3">
          {r.assignedTechnicianName ? (
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-slate-700 text-white flex items-center justify-center text-[8px] font-black shrink-0">
                {r.assignedTechnicianName.charAt(0).toUpperCase()}
              </div>
              <span className="text-[10px] font-bold text-[var(--text-2)] truncate max-w-[100px]">{r.assignedTechnicianName}</span>
            </div>
          ) : (
            <span className="text-[10px] text-[var(--text-4)] italic">Unassigned</span>
          )}
          <span className={`text-[10px] font-bold ${locCls} flex items-center gap-1`}>
            <Fa icon={faMapMarkerAlt} className="text-[9px] opacity-60" />
            {locLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-black text-[var(--text-1)]">
            {r.total ? fmtKes(r.total) : <span className="text-[var(--text-4)]">—</span>}
          </span>
          <Fa icon={faChevronRight} className="text-[10px] text-[var(--text-4)]" />
        </div>
      </div>
    </button>
  )
}

export default function RepairClientJobs({ onNewIntake, onSelect }: { onNewIntake: () => void; onSelect: (id: string) => void }) {
  const { visibleRepairs, filter, setFilter, outsourceJobs } = useRepair()

  const [searchQuery, setSearchQuery]       = useState('')
  const [techFilter, setTechFilter]         = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')
  const [showFilters, setShowFilters]       = useState(false)
  const [currentPage, setCurrentPage]       = useState(1)

  const technicians = useMemo(() => {
    const m = new Map<string, string>()
    visibleRepairs.forEach(r => { if (r.assignedTechnicianId && r.assignedTechnicianName) m.set(r.assignedTechnicianId, r.assignedTechnicianName) })
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }))
  }, [visibleRepairs])

  const activeFiltersCount = [techFilter !== 'all', priorityFilter !== 'all', !!dateFrom, !!dateTo].filter(Boolean).length
  const clearAll = () => { setSearchQuery(''); setTechFilter('all'); setPriorityFilter('all'); setDateFrom(''); setDateTo('') }

  useEffect(() => { setCurrentPage(1) }, [filter, searchQuery, techFilter, priorityFilter, dateFrom, dateTo])

  const filteredRepairs = useMemo(() => {
    let list = visibleRepairs
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(r =>
        r.ref.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        (r.customerPhone && r.customerPhone.toLowerCase().includes(q)) ||
        (r.serialNumber && r.serialNumber.toLowerCase().includes(q)) ||
        (r.assignedTechnicianName && r.assignedTechnicianName.toLowerCase().includes(q)) ||
        (r.issueDescription && r.issueDescription.toLowerCase().includes(q))
      )
    }
    if (techFilter !== 'all') list = techFilter === 'unassigned' ? list.filter(r => !r.assignedTechnicianId) : list.filter(r => r.assignedTechnicianId === techFilter)
    if (priorityFilter !== 'all') list = list.filter(r => r.priority === priorityFilter)
    if (dateFrom) list = list.filter(r => new Date(r.intakeDate) >= new Date(dateFrom))
    if (dateTo)   list = list.filter(r => new Date(r.intakeDate) <= new Date(dateTo + 'T23:59:59'))
    return list
  }, [visibleRepairs, searchQuery, techFilter, priorityFilter, dateFrom, dateTo])

  const totalPages       = Math.max(1, Math.ceil(filteredRepairs.length / ITEMS_PER_PAGE))
  const paginatedRepairs = filteredRepairs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (currentPage <= 3) return [1, 2, 3, 4, '…', totalPages]
    if (currentPage >= totalPages - 2) return [1, '…', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [1, '…', currentPage - 1, currentPage, currentPage + 1, '…', totalPages]
  }, [totalPages, currentPage])

  const stats = [
    { label: 'Total',     count: visibleRepairs.length,                                                                          icon: faTools,            accent: '#2563EB' },
    { label: 'Pending',   count: visibleRepairs.filter(r => ['pending_verification','received','assigned'].includes(r.status)).length, icon: faHourglassHalf,    accent: '#D97706' },
    { label: 'In Repair', count: visibleRepairs.filter(r => r.status === 'in_repair').length,                                   icon: faScrewdriverWrench, accent: '#7C3AED' },
    { label: 'Approval',  count: visibleRepairs.filter(r => r.status === 'awaiting_approval').length,                           icon: faExclamationCircle, accent: '#EA580C' },
    { label: 'Ready',     count: visibleRepairs.filter(r => r.status === 'ready').length,                                       icon: faCheckCircle,       accent: '#059669' },
    { label: 'Done',      count: visibleRepairs.filter(r => ['delivered','closed'].includes(r.status)).length,                  icon: faArchive,           accent: '#475569' },
  ]

  const filterTabs = [
    { id: 'all', label: 'All' },
    { id: 'pending_verification', label: 'New' },
    { id: 'assigned', label: 'Assigned' },
    { id: 'diagnosed', label: 'Diagnosed' },
    { id: 'awaiting_approval', label: 'Awaiting Appr.' },
    { id: 'awaiting_parts', label: 'Awaiting Parts' },
    { id: 'in_repair', label: 'In Repair' },
    { id: 'qc', label: 'QC' },
    { id: 'ready', label: 'Ready' },
    { id: 'declined', label: 'Declined' },
    { id: 'unrepairable', label: 'Unrepairable' },
  ].map(t => ({ ...t, count: t.id === 'all' ? visibleRepairs.length : visibleRepairs.filter(r => r.status === t.id).length }))

  return (
    <div className="flex flex-col h-full bg-[var(--bg-page)]" style={{ animation: 'fadeIn 0.3s ease both' }}>

      {/* ── Header ── */}
      <div className="bg-[var(--bg-card)] border-b border-[var(--border)] px-3 sm:px-6 pt-4 sm:pt-6 pb-4 sm:pb-5 flex-shrink-0 shadow-sm">
        <div className="max-w-[1600px] mx-auto space-y-4">

          {/* Title row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-blue-600 flex items-center justify-center shadow-md shadow-blue-200 shrink-0">
                <Fa icon={faTools} className="text-white text-sm" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-black text-[var(--text-1)] tracking-tight leading-none truncate">Repair Management</h1>
                <p className="text-[10px] sm:text-[11px] text-[var(--text-4)] font-bold uppercase tracking-widest mt-0.5">
                  {visibleRepairs.length} job{visibleRepairs.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button
              onClick={onNewIntake}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] sm:text-[12px] font-black uppercase tracking-wide shadow-md shadow-blue-200 transition-all active:scale-95 shrink-0"
            >
              <Fa icon={faPlus} className="text-xs" />
              <span className="hidden xs:inline sm:inline">New Intake</span>
              <span className="inline xs:hidden sm:hidden">New</span>
            </button>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            {stats.map((s, i) => (
              <div key={i} className="group bg-[var(--bg-card)] rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-[var(--border-lt)] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-default">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[9px] sm:text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest leading-tight">{s.label}</p>
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: s.accent + '18' }}>
                    <Fa icon={s.icon} className="text-[9px] sm:text-[10px]" style={{ color: s.accent }} />
                  </div>
                </div>
                <p className="text-xl sm:text-2xl font-black tracking-tighter" style={{ color: s.accent }}>{s.count}</p>
                <div className="mt-1.5 sm:mt-2 h-1 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: visibleRepairs.length ? `${(s.count / visibleRepairs.length) * 100}%` : '0%', backgroundColor: s.accent }}
                  />
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col px-3 sm:px-6 py-3 sm:py-5 max-w-[1600px] mx-auto w-full gap-3 sm:gap-4">

        {/* Filters + Search */}
        <div className="flex flex-col gap-2 sm:gap-3">

          {/* Status tabs + search row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
            {/* Status pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-hide w-full sm:flex-1">
              {filterTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={`
                    flex items-center gap-1 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-[11px] font-bold transition-all whitespace-nowrap
                    ${filter === tab.id
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                      : 'bg-[var(--bg-card)] text-[var(--text-3)] hover:bg-[var(--bg-surface)] border border-[var(--border)]'}
                  `}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] sm:text-[9px] font-black ${filter === tab.id ? 'bg-white/20 text-white' : 'bg-[var(--bg-surface)] text-[var(--text-3)]'}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Search + Filter toggle */}
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <div className="relative flex-1 sm:w-60 lg:w-72">
                <Fa icon={faSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)] text-xs pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl py-2 sm:py-2.5 pl-8 sm:pl-9 pr-8 text-[12px] font-medium text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all outline-none shadow-sm"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5">
                    <Fa icon={faTimes} className="text-xs" />
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowFilters(v => !v)}
                className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-[11px] font-bold border transition-all whitespace-nowrap shrink-0 ${
                  showFilters || activeFiltersCount > 0
                    ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm'
                    : 'bg-[var(--bg-card)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                <Fa icon={faFilter} className="text-xs" />
                <span className="hidden sm:inline">Filters</span>
                {activeFiltersCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                    {activeFiltersCount}
                  </span>
                )}
                <Fa icon={faChevronDown} className={`text-[9px] transition-transform hidden sm:block ${showFilters ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          {/* Advanced Filters Panel */}
          {showFilters && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-sm" style={{ animation: 'dropdownIn 0.2s ease both' }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Technician */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest flex items-center gap-1.5">
                    <Fa icon={faUser} className="text-[9px]" /> Technician
                  </label>
                  <div className="relative">
                    <select value={techFilter} onChange={e => setTechFilter(e.target.value)}
                      className="w-full appearance-none bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-2.5 pl-3 pr-8 text-[12px] font-medium text-[var(--text-1)] focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all">
                      <option value="all">All Technicians</option>
                      <option value="unassigned">Unassigned</option>
                      {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <Fa icon={faChevronDown} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] pointer-events-none" />
                  </div>
                </div>
                {/* Priority */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest flex items-center gap-1.5">
                    <Fa icon={faFlag} className="text-[9px]" /> Priority
                  </label>
                  <div className="relative">
                    <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
                      className="w-full appearance-none bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-2.5 pl-3 pr-8 text-[12px] font-medium text-[var(--text-1)] focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all">
                      <option value="all">All Priorities</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                    <Fa icon={faChevronDown} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] pointer-events-none" />
                  </div>
                </div>
                {/* Date From */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest flex items-center gap-1.5">
                    <Fa icon={faCalendarAlt} className="text-[9px]" /> From Date
                  </label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-2.5 px-3 text-[12px] font-medium text-[var(--text-1)] focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all" />
                </div>
                {/* Date To */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest flex items-center gap-1.5">
                    <Fa icon={faCalendarAlt} className="text-[9px]" /> To Date
                  </label>
                  <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-2.5 px-3 text-[12px] font-medium text-[var(--text-1)] focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all" />
                </div>
              </div>
              {activeFiltersCount > 0 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-lt)]">
                  <p className="text-[11px] font-bold text-blue-600">
                    {activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''} active · {filteredRepairs.length} result{filteredRepairs.length !== 1 ? 's' : ''}
                  </p>
                  <button onClick={clearAll} className="text-[10px] font-black text-red-500 hover:text-red-600 uppercase tracking-wider flex items-center gap-1">
                    <Fa icon={faTimes} className="text-[9px]" /> Clear All
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Table / Card list ── */}
        <div className="flex-1 overflow-hidden bg-[var(--bg-card)] rounded-xl sm:rounded-2xl border border-[var(--border)] shadow-sm flex flex-col min-h-0">

          {/* ── Mobile card list (< md) ── */}
          <div className="block md:hidden flex-1 overflow-y-auto custom-scrollbar">
            {paginatedRepairs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(37,99,235,0.07)', boxShadow: '0 0 0 10px rgba(37,99,235,0.04)' }}
                >
                  <Fa icon={faTools} className="text-blue-300 text-xl" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-[var(--text-3)]">No repair jobs found</p>
                  <p className="text-[11px] text-[var(--text-4)] mt-1">
                    {searchQuery ? `No results for "${searchQuery}"` : 'Try a different filter'}
                  </p>
                </div>
              </div>
            ) : (
              paginatedRepairs.map(r => (
                <MobileRepairCard key={r.id} r={r} onSelect={onSelect} outsourceJobs={outsourceJobs} />
              ))
            )}
          </div>

          {/* ── Desktop table (md+) ── */}
          <div className="hidden md:block overflow-x-auto flex-1 custom-scrollbar">
            <table className="w-full border-collapse min-w-[900px]">
              <thead className="sticky top-0 z-20">
                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                  {['Reference', 'Customer', 'Device', 'Status', 'Location', 'Technician', 'Intake Date', 'Amount'].map(h => (
                    <th key={h} className="px-4 lg:px-5 py-3.5 text-left text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                  <th className="px-4 py-3.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {paginatedRepairs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center">
                          <Fa icon={faTools} className="text-slate-300 text-xl" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-[var(--text-3)]">No repair jobs found</p>
                          <p className="text-[11px] text-[var(--text-4)] mt-1">
                            {searchQuery ? `No results for "${searchQuery}"` : 'Try a different status filter'}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedRepairs.map(r => {
                    const outJob    = outsourceJobs?.find((j: any) => j.repairOrderId === r.id && j.status === 'sent')
                    const rowColor  = STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#CBD5E1'
                    const locLabel  = outJob ? outJob.vendorName
                      : ['declined','unrepairable'].includes(r.status) ? 'Pending Return'
                      : ['delivered','returned','closed','cancelled'].includes(r.status) ? 'With Customer'
                      : 'In Shop'
                    const locCls = outJob ? 'text-amber-600'
                      : ['declined','unrepairable'].includes(r.status) ? 'text-red-500'
                      : ['delivered','returned','closed','cancelled'].includes(r.status) ? 'text-emerald-600'
                      : 'text-blue-600'
                    return (
                      <tr
                        key={r.id}
                        onClick={() => onSelect(r.id)}
                        className="group border-b border-[var(--border-lt)] last:border-0 cursor-pointer transition-all duration-150"
                        style={{
                          borderLeft: `3px solid ${rowColor}`,
                          '--row-color': rowColor,
                        } as React.CSSProperties}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `linear-gradient(to right, ${rowColor}0d, transparent)` }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                      >
                        <td className="px-4 lg:px-5 py-3.5">
                          <div className="flex flex-col gap-1">
                            <span className="text-[12px] font-black text-[var(--text-1)] font-mono tracking-tight group-hover:text-blue-600 transition-colors">{r.ref}</span>
                            {r.priority && r.priority !== 'normal' && (
                              <span className={`self-start text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${r.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {r.priority}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 lg:px-5 py-3.5">
                          <p className="text-[12px] font-bold text-[var(--text-1)]">{r.customerName}</p>
                          <p className="text-[10px] text-[var(--text-4)] font-medium mt-0.5">{r.customerPhone}</p>
                        </td>
                        <td className="px-4 lg:px-5 py-3.5">
                          <p className="text-[12px] font-bold text-[var(--text-2)] max-w-[160px] truncate">{r.productName}</p>
                          {r.serialNumber && <p className="text-[10px] text-[var(--text-4)] font-mono max-w-[160px] truncate mt-0.5">{r.serialNumber}</p>}
                        </td>
                        <td className="px-4 lg:px-5 py-3.5"><StatusBadge status={r.status} /></td>
                        <td className="px-4 lg:px-5 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <Fa icon={faMapMarkerAlt} className={`text-[10px] ${locCls} opacity-60`} />
                            <span className={`text-[11px] font-bold ${locCls} whitespace-nowrap`}>{locLabel}</span>
                          </div>
                        </td>
                        <td className="px-4 lg:px-5 py-3.5">
                          {r.assignedTechnicianName ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] font-black shrink-0">
                                {r.assignedTechnicianName.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-[11px] font-bold text-[var(--text-2)] truncate max-w-[90px]">{r.assignedTechnicianName}</span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-[var(--text-4)] italic">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 lg:px-5 py-3.5">
                          <span className="text-[11px] font-bold text-[var(--text-2)] tabular-nums">{fmtDate(r.intakeDate)}</span>
                        </td>
                        <td className="px-4 lg:px-5 py-3.5">
                          <span className="text-[12px] font-black text-[var(--text-1)]">
                            {r.total ? fmtKes(r.total) : <span className="text-[var(--text-4)]">—</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="w-7 h-7 rounded-full opacity-0 group-hover:opacity-100 bg-blue-50 flex items-center justify-center ml-auto transition-all">
                            <Fa icon={faChevronRight} className="text-[10px] text-blue-600" />
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          <div className="px-3 sm:px-5 py-3 border-t border-[var(--border-lt)] bg-[var(--bg-surface)]/60 flex items-center justify-between gap-2 flex-shrink-0">
            {/* Result count */}
            <p className="text-[10px] sm:text-[11px] font-bold text-[var(--text-4)] whitespace-nowrap">
              {filteredRepairs.length === 0 ? 'No results'
                : `${(currentPage - 1) * ITEMS_PER_PAGE + 1}–${Math.min(currentPage * ITEMS_PER_PAGE, filteredRepairs.length)} / ${filteredRepairs.length}`}
            </p>

            {/* Mobile: prev / page / next */}
            <div className="flex md:hidden items-center gap-2">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <Fa icon={faChevronLeft} className="text-[10px]" />
              </button>
              <span className="text-[11px] font-black text-[var(--text-2)] min-w-[60px] text-center">{currentPage} / {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <Fa icon={faChevronRight} className="text-[10px]" />
              </button>
            </div>

            {/* Desktop: full page numbers */}
            <div className="hidden md:flex items-center gap-1">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <Fa icon={faAngleDoubleLeft} className="text-[10px]" />
              </button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <Fa icon={faChevronLeft} className="text-[10px]" />
              </button>
              {pageNumbers.map((p, i) =>
                p === '…' ? (
                  <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-slate-400 text-[11px]">…</span>
                ) : (
                  <button key={p} onClick={() => setCurrentPage(Number(p))}
                    className={`w-8 h-8 rounded-lg text-[11px] font-black transition-all ${
                      currentPage === p
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-200 border border-blue-600'
                        : 'border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-2)] hover:border-[var(--border)] hover:text-[var(--text-1)]'
                    }`}>{p}</button>
                )
              )}
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <Fa icon={faChevronRight} className="text-[10px]" />
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <Fa icon={faAngleDoubleRight} className="text-[10px]" />
              </button>
            </div>

            <p className="text-[11px] font-bold text-[var(--text-4)] whitespace-nowrap hidden lg:block">
              Page {currentPage} of {totalPages}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
