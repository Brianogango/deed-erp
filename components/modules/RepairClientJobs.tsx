'use client'
import { useState, useMemo, useEffect } from 'react'
import { DataTable, type ActiveFilterChip, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { useRepair } from './repair/RepairContext'
import { STATUS_LABELS, STATUS_COLORS } from './repair-config'
import { fmtKes, fmtDate } from '@/lib/store'
import { printRepairSticker } from '@/lib/repair-sticker'
import { ModuleHeader } from '@/components/ui'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
import { Fa } from '@/components/icons'
import {
  faTools, faPlus,
  faMapMarkerAlt, faCalendarAlt, faChevronRight,
  faFlag, faPrint,
} from '@fortawesome/free-solid-svg-icons'

const ITEMS_PER_PAGE = 15

// Brand tokens
const CYAN  = '#00AEEF'
const NAVY  = '#1A1F5E'

// Status options ordered by urgency / priority
const STATUS_FILTER_GROUPS = [
  {
    label: 'Needs Action',
    options: [
      { id: 'pending_verification', label: 'New — Pending Verification' },
      { id: 'awaiting_approval',    label: 'Awaiting Client Approval' },
      { id: 'awaiting_parts',       label: 'Awaiting Parts' },
    ],
  },
  {
    label: 'In Progress',
    options: [
      { id: 'assigned',   label: 'Assigned' },
      { id: 'diagnosed',  label: 'Diagnosed' },
      { id: 'approved',   label: 'Approved — Ready to Start' },
      { id: 'in_repair',  label: 'In Repair' },
      { id: 'qc',         label: 'Quality Check (QC)' },
    ],
  },
  {
    label: 'Completed / Terminal',
    options: [
      { id: 'ready',        label: 'Ready for Pickup' },
      { id: 'invoiced',     label: 'Invoiced' },
      { id: 'delivered',    label: 'Delivered' },
      { id: 'closed',       label: 'Closed' },
      { id: 'declined',     label: 'Declined' },
      { id: 'unrepairable', label: 'Unrepairable' },
      { id: 'returned',     label: 'Returned' },
      { id: 'cancelled',    label: 'Cancelled' },
    ],
  },
]

function RepairStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge
      status={status}
      label={STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}
    />
  )
}

function MobileRepairCard({ r, onSelect, outsourceJobs }: any) {
  const rowColor = STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#CBD5E1'
  const outJob   = outsourceJobs?.find((j: any) => j.repairOrderId === r.id && j.status === 'sent')
  const locLabel = outJob ? outJob.vendorName
    : ['declined', 'unrepairable'].includes(r.status) ? 'Pending Return'
    : ['delivered', 'returned', 'closed', 'cancelled'].includes(r.status) ? 'With Customer'
    : 'In Shop'
  const locStyle = outJob ? { color: '#F59E0B' }
    : ['declined', 'unrepairable'].includes(r.status) ? { color: '#EF4444' }
    : ['delivered', 'returned', 'closed', 'cancelled'].includes(r.status) ? { color: '#10B981' }
    : { color: CYAN }

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
            <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${r.repairPath === 'direct_repair' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>
              {r.repairPath === 'direct_repair' ? 'Direct' : 'Diagnosis'}
            </span>
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
          <RepairStatusBadge status={r.status} />
          <span className="text-[10px] text-[var(--text-4)] font-medium tabular-nums">{fmtDate(r.intakeDate)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[var(--border-lt)]">
        <div className="flex items-center gap-3">
          {r.assignedTechnicianName ? (
            <div className="flex items-center gap-1.5">
              <div
                className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[8px] font-black shrink-0"
                style={{ background: NAVY }}
              >
                {r.assignedTechnicianName.charAt(0).toUpperCase()}
              </div>
              <span className="text-[10px] font-bold text-[var(--text-2)] truncate max-w-[100px]">{r.assignedTechnicianName}</span>
            </div>
          ) : (
            <span className="text-[10px] text-[var(--text-4)] italic">Unassigned</span>
          )}
          <span className="text-[10px] font-bold flex items-center gap-1" style={locStyle}>
            <Fa icon={faMapMarkerAlt} className="text-[9px] opacity-60" />
            {locLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-black text-[var(--text-1)]">
            {r.total ? fmtKes(r.total) : <span className="text-[var(--text-4)]">—</span>}
          </span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); void printRepairSticker(r) }}
            aria-label="Print sticker"
            className="icon-btn"
          >
            <Fa icon={faPrint} aria-hidden="true" />
          </button>
          <Fa icon={faChevronRight} className="text-[10px] text-[var(--text-4)]" />
        </div>
      </div>
    </button>
  )
}

export default function RepairClientJobs({ onNewIntake, onSelect }: { onNewIntake: () => void; onSelect: (id: string) => void }) {
  const { visibleRepairs, filter, setFilter, outsourceJobs, currentUser } = useRepair()
  const canCreateIntake = ['director', 'admin_officer'].includes(currentUser?.role ?? '')

  const [searchQuery, setSearchQuery]       = useState('')
  const [statusFilter, setStatusFilter]     = useState(filter ?? 'all')
  const [techFilter, setTechFilter]         = useState('all')
  const [pathFilter, setPathFilter]         = useState<'all' | 'diagnosis_first' | 'direct_repair'>('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')

  // Keep statusFilter in sync with external filter prop
  useEffect(() => { if (filter !== statusFilter) setStatusFilter(filter) }, [filter])

  const technicians = useMemo(() => {
    const m = new Map<string, string>()
    visibleRepairs.forEach(r => { if (r.assignedTechnicianId && r.assignedTechnicianName) m.set(r.assignedTechnicianId, r.assignedTechnicianName) })
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }))
  }, [visibleRepairs])

  const handleStatusChange = (val: string) => { setStatusFilter(val); setFilter(val) }

  const clearAll = () => {
    setSearchQuery(''); handleStatusChange('all')
    setTechFilter('all'); setPathFilter('all'); setPriorityFilter('all'); setDateFrom(''); setDateTo('')
  }

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
    if (statusFilter === 'pending_group') list = list.filter(r => ['pending_verification','received','assigned'].includes(r.status))
    else if (statusFilter === 'done_group') list = list.filter(r => ['delivered','closed'].includes(r.status))
    else if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (techFilter !== 'all') list = techFilter === 'unassigned' ? list.filter(r => !r.assignedTechnicianId) : list.filter(r => r.assignedTechnicianId === techFilter)
    if (pathFilter === 'direct_repair') list = list.filter(r => r.repairPath === 'direct_repair')
    else if (pathFilter === 'diagnosis_first') list = list.filter(r => r.repairPath !== 'direct_repair')
    if (priorityFilter !== 'all') list = list.filter(r => r.priority === priorityFilter)
    if (dateFrom) list = list.filter(r => new Date(r.intakeDate) >= new Date(dateFrom))
    if (dateTo)   list = list.filter(r => new Date(r.intakeDate) <= new Date(dateTo + 'T23:59:59'))
    return list
  }, [visibleRepairs, searchQuery, statusFilter, techFilter, pathFilter, priorityFilter, dateFrom, dateTo])

  const selectedStatusLabel =
    statusFilter === 'pending_group' ? 'Pending Group'
    : statusFilter === 'done_group' ? 'Done Group'
    : STATUS_FILTER_GROUPS.flatMap(g => g.options).find(o => o.id === statusFilter)?.label ?? 'All Statuses'

  const inputCls = 'w-full appearance-none bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-2.5 pl-3 pr-8 text-[12px] font-medium text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-2 focus:ring-[rgba(0,174,239,0.12)]'

  const statusOptions = useMemo(() => [
    { value: 'all', label: `All statuses (${visibleRepairs.length})` },
    { value: 'pending_group', label: `Pending group (${visibleRepairs.filter(r => ['pending_verification','received','assigned'].includes(r.status)).length})` },
    { value: 'done_group', label: `Done group (${visibleRepairs.filter(r => ['delivered','closed'].includes(r.status)).length})` },
    ...STATUS_FILTER_GROUPS.flatMap(group =>
      group.options.map(opt => ({
        value: opt.id,
        label: `${opt.label} (${visibleRepairs.filter(r => r.status === opt.id).length})`,
      }))
    ),
  ], [visibleRepairs])

  const technicianOptions = useMemo(() => [
    { value: 'all', label: 'All technicians' },
    { value: 'unassigned', label: 'Unassigned' },
    ...technicians.map(t => ({ value: t.id, label: t.name })),
  ], [technicians])

  const pathOptions = useMemo(() => [
    { value: 'all', label: 'All paths' },
    { value: 'diagnosis_first', label: `Diagnosis First (${visibleRepairs.filter(r => r.repairPath !== 'direct_repair').length})` },
    { value: 'direct_repair', label: `Direct Repair (${visibleRepairs.filter(r => r.repairPath === 'direct_repair').length})` },
  ], [visibleRepairs])

  const repairPrimaryFilters: PrimaryFilterConfig[] = [
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All statuses',
      value: statusFilter,
      options: statusOptions,
      onChange: handleStatusChange,
    },
    {
      key: 'technician',
      label: 'Technician',
      placeholder: 'All technicians',
      value: techFilter,
      options: technicianOptions,
      onChange: setTechFilter,
    },
    {
      key: 'path',
      label: 'Workflow',
      placeholder: 'All paths',
      value: pathFilter,
      options: pathOptions,
      onChange: v => setPathFilter(v as typeof pathFilter),
    },
  ]

  const repairActiveFilters: ActiveFilterChip[] = [
    ...(statusFilter !== 'all' ? [{
      key: 'status',
      label: 'Status',
      valueLabel: selectedStatusLabel,
      onRemove: () => handleStatusChange('all'),
    }] : []),
    ...(techFilter !== 'all' ? [{
      key: 'technician',
      label: 'Technician',
      valueLabel: technicianOptions.find(t => t.value === techFilter)?.label ?? techFilter,
      onRemove: () => setTechFilter('all'),
    }] : []),
    ...(pathFilter !== 'all' ? [{
      key: 'path',
      label: 'Workflow',
      valueLabel: pathFilter === 'direct_repair' ? 'Direct Repair' : 'Diagnosis First',
      onRemove: () => setPathFilter('all'),
    }] : []),
    ...(priorityFilter !== 'all' ? [{
      key: 'priority',
      label: 'Priority',
      valueLabel: priorityFilter.charAt(0).toUpperCase() + priorityFilter.slice(1),
      onRemove: () => setPriorityFilter('all'),
    }] : []),
    ...(dateFrom ? [{
      key: 'dateFrom',
      label: 'From',
      valueLabel: dateFrom,
      onRemove: () => setDateFrom(''),
    }] : []),
    ...(dateTo ? [{
      key: 'dateTo',
      label: 'To',
      valueLabel: dateTo,
      onRemove: () => setDateTo(''),
    }] : []),
  ]

  type RepairRow = typeof visibleRepairs[number]

  function locationFor(r: RepairRow) {
    const outJob = outsourceJobs?.find((j: any) => j.repairOrderId === r.id && j.status === 'sent')
    const label = outJob ? outJob.vendorName
      : ['declined', 'unrepairable'].includes(r.status) ? 'Pending Return'
      : ['delivered', 'returned', 'closed', 'cancelled'].includes(r.status) ? 'With Customer'
      : 'In Shop'
    const color = outJob ? '#F59E0B'
      : ['declined', 'unrepairable'].includes(r.status) ? '#EF4444'
      : ['delivered', 'returned', 'closed', 'cancelled'].includes(r.status) ? '#10B981'
      : CYAN
    return { label, color }
  }

  const repairColumns: ColumnDef<RepairRow>[] = [
    {
      key: 'ref', label: 'Reference', priority: 1, width: '120px',
      render: r => (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-black font-mono tracking-tight" style={{ color: 'var(--text-1)' }}>{r.ref}</span>
          <span className={`self-start text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${r.repairPath === 'direct_repair' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>
            {r.repairPath === 'direct_repair' ? 'Direct' : 'Diagnosis'}
          </span>
          {r.priority && r.priority !== 'normal' && (
            <span className={`self-start text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${r.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
              {r.priority}
            </span>
          )}
        </div>
      ),
      searchValue: r => [r.ref, r.repairPath === 'direct_repair' ? 'direct repair' : 'diagnosis first'].join(' '),
    },
    {
      key: 'customer', label: 'Customer', priority: 2, width: '1fr',
      render: r => (
        <div>
          <p className="text-[12px] font-bold text-[var(--text-1)]">{r.customerName}</p>
          <p className="text-[10px] text-[var(--text-4)] font-medium mt-0.5">{r.customerPhone}</p>
        </div>
      ),
      exportValue: r => r.customerName,
    },
    {
      key: 'device', label: 'Device', priority: 2, width: '1fr',
      render: r => (
        <div>
          <p className="text-[12px] font-bold text-[var(--text-2)] max-w-[160px] truncate">{r.productName}</p>
          {r.serialNumber && <p className="text-[10px] text-[var(--text-4)] font-mono max-w-[160px] truncate mt-0.5">{r.serialNumber}</p>}
        </div>
      ),
      exportValue: r => r.productName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '140px',
      render: r => <RepairStatusBadge status={r.status} />,
      exportValue: r => r.status,
    },
    {
      key: 'location', label: 'Location', priority: 3, width: '130px',
      render: r => {
        const loc = locationFor(r)
        return (
          <div className="flex items-center gap-1.5">
            <Fa icon={faMapMarkerAlt} className="text-[10px] opacity-60" style={{ color: loc.color }} />
            <span className="text-[11px] font-bold whitespace-nowrap" style={{ color: loc.color }}>{loc.label}</span>
          </div>
        )
      },
      exportValue: r => locationFor(r).label,
    },
    {
      key: 'technician', label: 'Technician', priority: 3, width: '130px',
      render: r => r.assignedTechnicianName ? (
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[9px] font-black shrink-0" style={{ background: NAVY }}>
            {r.assignedTechnicianName.charAt(0).toUpperCase()}
          </div>
          <span className="text-[11px] font-bold text-[var(--text-2)] truncate max-w-[90px]">{r.assignedTechnicianName}</span>
        </div>
      ) : <span className="text-[11px] text-[var(--text-4)] italic">Unassigned</span>,
      exportValue: r => r.assignedTechnicianName ?? 'Unassigned',
    },
    {
      key: 'intakeDate', label: 'Intake Date', priority: 3, width: '110px',
      render: r => <span className="text-[11px] font-bold text-[var(--text-2)] tabular-nums">{fmtDate(r.intakeDate)}</span>,
      exportValue: r => r.intakeDate,
    },
    {
      key: 'amount', label: 'Amount', priority: 1, width: '110px', align: 'right',
      render: r => <span className="text-[12px] font-black text-[var(--text-1)]">{r.total ? fmtKes(r.total) : <span className="text-[var(--text-4)]">—</span>}</span>,
      exportValue: r => r.total ?? '',
    },
  ]

  function repairRowActions(r: RepairRow) {
    return (
      <button
        onClick={e => { e.stopPropagation(); void printRepairSticker(r) }}
        title="Print intake sticker"
        className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:bg-slate-100"
      >
        <Fa icon={faPrint} className="text-[10px] text-slate-500" />
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-page)]" style={{ animation: 'fadeIn 0.3s ease both' }}>

      {/* ── Header ── */}
      <div className="bg-[var(--bg-card)] border-b border-[var(--border)] flex-shrink-0 shadow-sm">
        <ModuleHeader
          title="Repair management"
          subtitle={`${visibleRepairs.length} job${visibleRepairs.length !== 1 ? 's' : ''}`}
          icon={<Fa icon={faTools} />}
          count={visibleRepairs.length}
          color={NAVY}
          primaryAction={canCreateIntake ? (
            <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={onNewIntake} hideLabelOnMobile={false}>
              New repair
            </PrimaryActionButton>
          ) : undefined}
        />
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col px-3 sm:px-6 py-3 sm:py-5 max-w-[1600px] mx-auto w-full gap-3 sm:gap-4">

        {/* ── Table / Card list ── */}
        <div className="flex-1 overflow-hidden bg-[var(--bg-card)] rounded-xl sm:rounded-2xl border border-[var(--border)] shadow-sm flex flex-col min-h-0">
          <DataTable
            tableId="repair_client_jobs"
            columns={repairColumns}
            rows={filteredRepairs}
            rowKey={r => r.id}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search repairs by name, reference, device, or serial..."
            clientSearch={false}
            primaryFilters={repairPrimaryFilters}
            advancedFilters={
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[var(--text-3)] flex items-center gap-1.5">
                    <Fa icon={faFlag} className="text-[9px]" style={{ color: 'var(--warning)' }} /> Priority
                  </span>
                  <select aria-label="Filter repairs by priority" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className={inputCls}>
                    <option value="all">All priorities</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[var(--text-3)] flex items-center gap-1.5">
                    <Fa icon={faCalendarAlt} className="text-[9px]" /> Date range
                  </span>
                  <div className="flex gap-2">
                    <input type="date" aria-label="Repairs from date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-2.5 px-3 text-[11px] font-medium text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-2 focus:ring-[rgba(0,174,239,0.12)]" />
                    <input type="date" aria-label="Repairs to date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)}
                      className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-2.5 px-3 text-[11px] font-medium text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-2 focus:ring-[rgba(0,174,239,0.12)]" />
                  </div>
                </label>
              </>
            }
            activeFilters={repairActiveFilters}
            onClearFilters={clearAll}
            hideColumnFilters
            perPage={ITEMS_PER_PAGE}
            emptyMessage="No repair jobs found"
            onRowClick={r => onSelect(r.id)}
            rowActions={repairRowActions}
            rowStyle={r => ({ borderLeft: `3px solid ${STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#CBD5E1'}` })}
            renderCard={r => <MobileRepairCard key={r.id} r={r} onSelect={onSelect} outsourceJobs={outsourceJobs} />}
            exportTitle="Repair Jobs"
            exportFilename="repair-jobs"
          />
        </div>
      </div>
    </div>
  )
}
