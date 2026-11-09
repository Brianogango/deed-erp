'use client'

import { Suspense, useState, useMemo, useEffect, useRef } from 'react'
import { useOperationsStore, fmtDate as fmtD } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { useRouteDataReady } from '@/lib/route-data-ready'
import { assignableTechnicians } from '@/lib/repair/assignable-technicians'
import { RefurbInstallActionField, refurbFitSlotForForm } from '@/components/refurbishment/RefurbInstallActionField'
import {
  applyRefurbPartsToUnitName,
  defaultRefurbInstallAction,
  refurbInstallActionLabel,
  resolveRefurbInstallAction,
} from '@/lib/refurbishment/apply-upgrade-specs'
import type { RefurbishmentJob, RefurbStatus, RefurbPart, SerialNumber } from '@/lib/store'
import { Confirm, Modal, Field, Textarea, ModuleSkeleton, useMounted, ModuleHeader, TabBar, SearchPicker } from '@/components/ui'
import { refurbNextStep, refurbFlowProgress, REFURB_FLOW_STEPS } from '@/lib/refurbishment/next-step'
import { RefurbWeeklyReport } from '@/components/refurbishment/RefurbWeeklyReport'
import { IdentifyUnitModal } from '@/components/refurbishment/IdentifyUnitModal'
import { HarvestPartsModal } from '@/components/refurbishment/HarvestPartsModal'
import { printLabelsForSerialUnits } from '@/lib/inventory/print-serial-device-label'
import { refurbWeekStart } from '@/lib/refurbishment/weekly-report'
import { StatusBadge, RecordHeader, PrimaryActionButton } from '@/components/erp'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { useUrlRecordId, useUrlUiPatch, useUrlUiState } from '@/hooks/useUrlRecordId'
import {
  faRotate, faPlus, faUser, faWrench, faCheckCircle,
  faArrowRight, faBan, faChevronLeft, faBoxOpen, faPencil, faTrash,
  faBell, faTriangleExclamation, faCheck, faMagnifyingGlass, faScrewdriverWrench, faPrint,
} from '@fortawesome/free-solid-svg-icons'

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_META: Record<RefurbStatus, { label: string; badgeStatus: string; bg: string; color: string; border: string }> = {
  queued:      { label: 'Queued',      badgeStatus: 'pending',   bg: 'var(--warning-bg)', color: 'var(--warning-text)', border: '#FCD34D' },
  assigned:    { label: 'Assigned',    badgeStatus: 'assigned',  bg: 'var(--primary-light)', color: 'var(--info-text)', border: '#93C5FD' },
  in_progress: { label: 'In progress', badgeStatus: 'in_repair', bg: '#EDE9FE', color: '#5B21B6', border: '#C4B5FD' },
  ready:       { label: 'Ready',       badgeStatus: 'ready',     bg: 'var(--success-bg)', color: 'var(--success-text)', border: '#6EE7B7' },
  transferred: { label: 'Transferred', badgeStatus: 'done',      bg: 'var(--bg-muted)', color: 'var(--text-3)', border: 'var(--border)' },
  written_off: { label: 'Written off', badgeStatus: 'cancelled', bg: 'var(--danger-bg)', color: '#991B1B', border: '#FCA5A5' },
}

const PART_STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  needed:    { label: 'Needed',    bg: 'var(--bg-muted)', color: 'var(--text-4)' },
  requested: { label: 'Requested', bg: 'var(--warning-bg)', color: 'var(--warning-text)' },
  allocated: { label: 'Allocated', bg: 'var(--primary-light)', color: 'var(--info-text)' },
  ordered:   { label: 'Ordered',   bg: '#EDE9FE', color: '#5B21B6' },
  received:  { label: 'Received',  bg: 'var(--success-bg)', color: 'var(--success-text)' },
  used:      { label: 'Used',      bg: 'var(--border-lt)', color: 'var(--text-3)' },
}

const STATUS_LEFT_BORDER: Record<RefurbStatus, string> = {
  queued: 'var(--warning)', assigned: 'var(--primary)', in_progress: '#8B5CF6',
  ready: 'var(--success)', transferred: 'var(--text-4)', written_off: 'var(--danger)',
}

function RefurbStatusBadge({ status }: { status: RefurbStatus }) {
  const m = STATUS_META[status]
  return <StatusBadge status={m.badgeStatus} label={m.label} />
}

function RefurbishmentContent() {
  const mounted = useMounted()
  const {
    refurbishmentJobs, serials, products,
    users, currentUserId,
    createRefurbishmentJob,
    assignRefurbishmentJob, updateRefurbishmentJob,
    addRefurbishmentPart, updateRefurbishmentPart, removeRefurbishmentPart,
    requestPartFromInventory, allocateRefurbPart, notifyTechPartAvailable,
    markRefurbishmentReady, transferToSell, writeOffRefurbishmentJob, restoreRefurbishmentJob,
    updateSerial,
    showToast,
    fixRefurbJobNumbers,
  } = useOperationsStore()

  const currentUser = users.find(u => u.id === currentUserId)
  const isLeadTech  = ['technical_lead', 'director'].includes(currentUser?.role ?? '')
  const canAssignJobs = currentUser?.role === 'technical_lead'

  // Job numbers used to be counted per browser, so several jobs share
  // REF/0001. A lead opening this screen gives the repeats (and any job
  // still on a temporary number) a real server number, once.
  const routeReady = useRouteDataReady('/refurbishment')
  const numbersFixed = useRef(false)
  useEffect(() => {
    if (!isLeadTech || !routeReady || numbersFixed.current || !refurbishmentJobs.length) return
    numbersFixed.current = true
    const n = fixRefurbJobNumbers()
    if (n > 0) showToast(`Giving ${n} job${n === 1 ? '' : 's'} a unique number`, 'info')
  }, [isLeadTech, routeReady, refurbishmentJobs.length, fixRefurbJobNumbers, showToast])
  const employees = useHrStore(s => s.employees)
  const techs       = assignableTechnicians(users, employees)

  const [activeId, setActiveId] = useUrlRecordId()
  const patchListUi = useUrlUiPatch()
  const [filterStatusValue, setFilterStatusValue] = useUrlUiState('status', 'all')
  const filterStatus: RefurbStatus | 'all' =
    ['queued', 'assigned', 'in_progress', 'ready', 'transferred', 'written_off'].includes(filterStatusValue)
      ? filterStatusValue as RefurbStatus
      : 'all'
  const setFilterStatus = (value: RefurbStatus | 'all') =>
    setFilterStatusValue(value, { queryPatch: { page: null } })
  const [jobSearch, setJobSearchValue] = useUrlUiState('q', '')
  const setJobSearch = (value: string) => setJobSearchValue(value, { queryPatch: { page: null } })
  const [viewValue, setViewValue] = useUrlUiState('view', 'jobs')
  const view: 'jobs' | 'report' = viewValue === 'report' ? 'report' : 'jobs'
  const [reportWeekValue, setReportWeek] = useUrlUiState('week', '')
  const reportWeek = /^\d{4}-\d{2}-\d{2}$/.test(reportWeekValue) ? refurbWeekStart(`${reportWeekValue}T12:00:00.000Z`) : refurbWeekStart(new Date())
  const [pageValue, setPageValue] = useUrlUiState('page', '1')
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1)
  const setPage = (value: number) => setPageValue(String(Math.max(1, value)))

  const [showAssignModal, setShowAssignModal]       = useState(false)
  const [showNotesModal, setShowNotesModal]         = useState(false)
  const [showPartModal, setShowPartModal]           = useState(false)
  const [showWriteOffModal, setShowWriteOffModal]   = useState(false)
  const [showCreateJobModal, setShowCreateJobModal] = useState(false)
  const [showIdentify, setShowIdentify]             = useState(false)
  const [showHarvest, setShowHarvest]               = useState(false)
  const [createJobSerial, setCreateJobSerial]       = useState<SerialNumber | null>(null)
  const [createJobIssue, setCreateJobIssue]         = useState('')
  const [editPartId, setEditPartId]                 = useState<string | null>(null)

  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set())
  const [showBulkSendModal, setShowBulkSendModal] = useState(false)
  const [bulkIssueDesc, setBulkIssueDesc]         = useState('')

  const [notesText, setNotesText]           = useState('')
  const [issuesText, setIssuesText]         = useState('')
  const [requestNow, setRequestNow]         = useState(true)
  const [writeOffReason, setWriteOffReason] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)
  const [partForm, setPartForm] = useState<Omit<RefurbPart, 'id' | 'qty'> & { qty: number | '' }>({
    partName: '', productId: undefined, qty: '', estimatedCost: 0, status: 'needed', notes: '', installAction: undefined,
  })

  const job = activeId ? refurbishmentJobs.find(j => j.id === activeId) ?? null : null

  const activeJobSerialIds = new Set(
    refurbishmentJobs
      .filter(j => j.status !== 'transferred' && j.status !== 'written_off')
      .map(j => j.serialId)
  )
  // Machines waiting for refurbishment with no open job. A written-off or
  // sold machine left in the repair unit is not one: written-off devices
  // used to come back here as "no job created yet".
  const orphanedSerials = useMemo(() =>
    serials.filter(s =>
      (s.status === 'refurbishment' || (s.location === 'repair_unit' && s.status === 'available')) &&
      !activeJobSerialIds.has(s.id)
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serials, refurbishmentJobs]
  )
  // "With Issues" stock still in our hands (the location is called shop).
  const withIssuesSerials = useMemo(() => serials.filter(s => s.location === 'shop' && ['available', 'returned'].includes(s.status)), [serials])
  // The sticker number follows the machine onto its job.
  const assetIdBySerialId = useMemo(() => new Map(serials.flatMap(s => {
    const a = (s as SerialNumber & { assetId?: string }).assetId
    return a ? [[s.id, a] as const] : []
  })), [serials])
  const unitInfo = (s: SerialNumber) => s as SerialNumber & { assetId?: string; intakeIssue?: string; identityPending?: boolean }
  const printStickers = (list: SerialNumber[], forSale = false) => {
    if (!list.length) return
    void printLabelsForSerialUnits({ serials: list, products, forSale })
  }
  // One toast for the batch; each machine keeps its own intake issue unless one is given here.
  const sendToRefurbishment = (list: SerialNumber[], issue: string) => {
    list.forEach(s => createRefurbishmentJob(s.id, issue, { silent: true }))
    showToast(`${list.length} machine${list.length === 1 ? '' : 's'} sent to refurbishment`)
  }

  const filtered = useMemo(() => {
    const list = filterStatus === 'all'
      ? refurbishmentJobs
      : refurbishmentJobs.filter(j => j.status === filterStatus)
    return [...list].sort((a, b) => b.intakeDate.localeCompare(a.intakeDate))
  }, [refurbishmentJobs, filterStatus])

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const fmtKes  = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0 })}`

  const canAssign    = (j: RefurbishmentJob) => canAssignJobs && j.status === 'queued'
  const canStart     = (j: RefurbishmentJob) => j.status === 'assigned' && (j.assignedTechnicianId === currentUserId || isLeadTech)
  const canLogNotes  = (j: RefurbishmentJob) => ['assigned', 'in_progress'].includes(j.status) && (j.assignedTechnicianId === currentUserId || isLeadTech)
  const canAddParts  = (j: RefurbishmentJob) => ['assigned', 'in_progress'].includes(j.status) && (j.assignedTechnicianId === currentUserId || isLeadTech)
  const canMarkReady = (j: RefurbishmentJob) => j.status === 'in_progress' && (j.assignedTechnicianId === currentUserId || isLeadTech)
  const canTransfer  = (j: RefurbishmentJob) => j.status === 'ready' && isLeadTech
  // A write-off is a loss booked to the accounts: the lead decides it.
  const canWriteOff  = (j: RefurbishmentJob) => ['assigned', 'in_progress'].includes(j.status) && isLeadTech
  // The technician on the job (or the lead) records the serial once it reads.
  const canIdentify  = (j: RefurbishmentJob) => !!j.identityPending && !['transferred', 'written_off'].includes(j.status) && (j.assignedTechnicianId === currentUserId || isLeadTech)

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<RefurbStatus | 'all', number>> = { all: refurbishmentJobs.length }
    refurbishmentJobs.forEach(j => { counts[j.status] = (counts[j.status] ?? 0) + 1 })
    return counts
  }, [refurbishmentJobs])

  const refurbishmentPrimaryFilters: PrimaryFilterConfig[] = [
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All statuses',
      value: filterStatus,
      options: [
        { value: 'all', label: `All statuses (${statusCounts.all ?? 0})` },
        ...(['queued', 'assigned', 'in_progress', 'ready', 'transferred', 'written_off'] as RefurbStatus[]).map(status => ({
          value: status,
          label: `${STATUS_META[status].label} (${statusCounts[status] ?? 0})`,
        })),
      ],
      onChange: value => setFilterStatus(value as RefurbStatus | 'all'),
    },
  ]

  const stats = {
    total:      refurbishmentJobs.length,
    queued:     refurbishmentJobs.filter(j => j.status === 'queued').length,
    inProgress: refurbishmentJobs.filter(j => j.status === 'in_progress').length,
    ready:      refurbishmentJobs.filter(j => j.status === 'ready').length,
    done:       refurbishmentJobs.filter(j => ['transferred', 'written_off'].includes(j.status)).length,
  }

  if (!mounted) return <ModuleSkeleton />

  // ═══════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (job) {
    const partTotal = job.partsNeeded.reduce((s, p) => s + p.estimatedCost * p.qty, 0)
    const readyParts = job.partsNeeded.filter(p => p.status === 'received' && p.notifiedTechDate)
    const sm = STATUS_META[job.status]

    return (
      <div className="mod-page">
        <RecordHeader
          title={job.ref}
          entity={`${job.productName} · S/N ${job.serialNumber}`}
          status={sm.badgeStatus}
          statusLabel={sm.label}
          onBack={() => setActiveId(null)}
          backLabel="Back"
          secondaryActions={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {job.underWarranty && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid #6EE7B7' }}>
                  WARRANTY
                </span>
              )}
              {canAssign(job) && (
                <PrimaryActionButton icon={<Fa icon={faUser} />} onClick={() => setShowAssignModal(true)} hideLabelOnMobile={false}>
                  Assign
                </PrimaryActionButton>
              )}
              {canStart(job) && (
                <PrimaryActionButton icon={<Fa icon={faWrench} />} onClick={() => updateRefurbishmentJob(job.id, { status: 'in_progress' })} hideLabelOnMobile={false}>
                  Start refurb
                </PrimaryActionButton>
              )}
              {canLogNotes(job) && (
                <button className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: 'var(--bg-muted)', color: 'var(--text-3)', border: '1px solid var(--border-lt)', cursor: 'pointer' }}
                  onClick={() => { setNotesText(job.techNotes ?? ''); setIssuesText(job.issuesFound ?? ''); setShowNotesModal(true) }}>
                  <Fa icon={faPencil} className="mr-1.5" />Issues & notes
                </button>
              )}
              {canIdentify(job) && (
                <PrimaryActionButton icon={<Fa icon={faMagnifyingGlass} />} onClick={() => setShowIdentify(true)} hideLabelOnMobile={false}>
                  Identify
                </PrimaryActionButton>
              )}
              {canMarkReady(job) && !job.identityPending && (
                <PrimaryActionButton icon={<Fa icon={faCheckCircle} />} onClick={() => markRefurbishmentReady(job.id)} hideLabelOnMobile={false}>
                  Mark ready
                </PrimaryActionButton>
              )}
              {canTransfer(job) && !job.identityPending && (
                <PrimaryActionButton icon={<Fa icon={faArrowRight} />} onClick={() => transferToSell(job.id)} hideLabelOnMobile={false}>
                  Send for retest
                </PrimaryActionButton>
              )}
              {['ready', 'transferred'].includes(job.status) && !job.identityPending && (() => {
                const unit = serials.find(s => s.id === job.serialId)
                return unit ? (
                  <button className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-2)', border: '1px solid var(--border-lt)', cursor: 'pointer' }}
                    onClick={() => printStickers([unit], true)}>
                    <Fa icon={faPrint} className="mr-1.5" />Print sale label
                  </button>
                ) : null
              })()}
              {canWriteOff(job) && (
                <button className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: 'var(--danger-bg)', color: '#991B1B', border: '1px solid #FCA5A5', cursor: 'pointer' }}
                  onClick={() => { setWriteOffReason(''); setShowWriteOffModal(true) }}>
                  <Fa icon={faBan} className="mr-1.5" />Write off
                </button>
              )}
              {canWriteOff(job) && (
                <button className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)', border: '1px solid #FCD34D', cursor: 'pointer' }}
                  onClick={() => setShowHarvest(true)}>
                  <Fa icon={faScrewdriverWrench} className="mr-1.5" />Harvest parts
                </button>
              )}
              {job.status === 'written_off' && job.outcome !== 'harvested' && isLeadTech && (
                <button className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: '#ECFDF5', color: 'var(--success-text)', border: '1px solid #A7F3D0', cursor: 'pointer' }}
                  onClick={() => setPendingConfirm({
                    msg: job.writeOffCost
                      ? `Bring this device back? It returns to stock and the KES ${job.writeOffCost.toLocaleString('en-KE')} write-off is reversed.`
                      : 'Bring this device back to refurbishment? It returns to stock.',
                    action: () => { void restoreRefurbishmentJob(job.id) },
                  })}>
                  <Fa icon={faRotate} className="mr-1.5" />Restore to queue
                </button>
              )}
            </div>
          }
        />

        <div className="mod-body p-4 flex flex-col gap-4">
          {/* Parts-ready notification */}
          {readyParts.length > 0 && (
            <div className="rounded-xl px-4 py-3 flex items-start gap-3"
              style={{ background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
              <span className="text-lg flex-shrink-0">✅</span>
              <div>
                <p className="text-xs font-bold" style={{ color: 'var(--success-text)' }}>
                  {readyParts.length} part{readyParts.length > 1 ? 's' : ''} ready — you can continue the job
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--success-text)' }}>
                  {readyParts.map(p => p.partName).join(', ')} — mark each as Used when installed
                </p>
              </div>
            </div>
          )}

          {(() => {
            const next = refurbNextStep(job, { id: currentUserId ?? undefined, isLead: isLeadTech, canAssign: canAssignJobs })
            if (next.key === 'none') return null
            const reached = refurbFlowProgress(job)
            return (
              <div className="card p-4 space-y-3">
                <ol className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Job progress">
                  {REFURB_FLOW_STEPS.map((label, i) => (
                    <li key={label} className="inline-flex items-center gap-1.5">
                      {i > 0 && <span aria-hidden="true" className="text-t3">→</span>}
                      <span className="rounded-full px-2 py-0.5 font-semibold" style={i <= reached
                        ? { background: '#E0F6FD', color: '#20164D', border: '1px solid #00AEEF' }
                        : { background: 'var(--bg-muted)', color: 'var(--text-3)', border: '1px solid var(--border-lt)' }}>
                        {i <= reached && <Fa icon={faCheck} className="mr-1" aria-hidden="true" />}{label}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-t1">Next: {next.title}</p>
                    <p className="text-[11px] text-t3">{next.detail}</p>
                  </div>
                  {next.mine && next.key === 'record_issues' && (
                    <button className="btn-primary text-xs py-1.5" onClick={() => { setNotesText(job.techNotes ?? ''); setIssuesText(job.issuesFound ?? ''); setShowNotesModal(true) }}>Record issues</button>
                  )}
                  {next.mine && next.key === 'start' && (
                    <button className="btn-primary text-xs py-1.5" onClick={() => updateRefurbishmentJob(job.id, { status: 'in_progress' })}>Start refurb</button>
                  )}
                  {next.mine && next.key === 'assign' && (
                    <button className="btn-primary text-xs py-1.5" onClick={() => setShowAssignModal(true)}>Assign</button>
                  )}
                  {next.mine && next.key === 'identify' && (
                    <button className="btn-primary text-xs py-1.5" onClick={() => setShowIdentify(true)}>Identify</button>
                  )}
                  {next.mine && next.key === 'mark_ready' && (
                    <button className="btn-primary text-xs py-1.5" onClick={() => markRefurbishmentReady(job.id)}>Mark ready</button>
                  )}
                </div>
              </div>
            )
          })()}

          {job.identityPending && !['transferred', 'written_off'].includes(job.status) && (
            <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{ background: 'var(--warning-bg)', border: '1px solid #FCD34D' }}>
              <Fa icon={faTriangleExclamation} className="mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold" style={{ color: 'var(--warning-text)' }}>Not identified yet — tag {job.intakeTag || job.serialNumber}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--warning-text)' }}>
                  Once it boots or the sticker is found, record the real serial and model. It cannot be marked ready until then. If it cannot be repaired, harvest its parts or write it off.
                </p>
              </div>
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Device */}
            <div className="card p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Device</p>
              <p className="text-sm font-semibold text-t1">{job.productName}</p>
              {assetIdBySerialId.get(job.serialId) && <p className="font-mono text-xs font-semibold text-t2">Asset ID: {assetIdBySerialId.get(job.serialId)}</p>}
              <p className="font-mono text-xs text-t3">{job.identityPending ? 'Tag' : 'S/N'}: {job.serialNumber}</p>
              {!job.identityPending && job.intakeTag && job.intakeTag !== job.serialNumber && <p className="font-mono text-[11px] text-t3">Tag: {job.intakeTag}</p>}
              {job.specs && <p className="text-xs text-t3">{job.specs}</p>}
              <div className="pt-1 space-y-0.5">
                <p className="text-[11px] text-t3">Intake: <span className="text-t2 font-medium">{fmtDate(job.intakeDate)}</span></p>
                {job.intakeSource && <p className="text-[11px] text-t3">From: <span className="text-t2 font-medium">{{ trade_in: 'Trade-in', stock: 'Stock without serials', unrecorded: 'Not on record', receipt: 'Purchase receipt' }[job.intakeSource]}{job.intakeSourceRef ? ` · ${job.intakeSourceRef}` : ''}</span></p>}
                {job.intakeCost != null && <p className="text-[11px] text-t3">Intake cost: <span className="text-t2 font-medium">{fmtKes(job.intakeCost)}</span></p>}
                {job.identifiedDate && <p className="text-[11px] text-t3">Identified: <span className="text-t2 font-medium">{fmtDate(job.identifiedDate)}</span></p>}
                {job.receiptRef && <p className="text-[11px] text-t3">Receipt: <span className="text-t2 font-medium">{job.receiptRef}</span></p>}
              </div>
            </div>

            {/* Assignment */}
            <div className="card p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Assignment</p>
              {job.assignedTechnicianName ? (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, var(--navy), var(--accent-cyan))' }}>
                    {job.assignedTechnicianName.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-t1">{job.assignedTechnicianName}</p>
                    {job.assignedDate && <p className="text-[10px] text-t3">Since {fmtDate(job.assignedDate)}</p>}
                  </div>
                </div>
              ) : (
                <p className="text-xs italic text-amber-500 font-medium inline-flex items-center gap-1"><Fa icon={faTriangleExclamation} aria-hidden="true" /> Not yet assigned</p>
              )}
              {job.startedDate && <p className="text-[11px] text-t3">Started: <span className="text-t2 font-medium">{fmtDate(job.startedDate)}</span></p>}
              {job.status === 'written_off' && (
                job.outcome === 'harvested' ? (
                  <div className="text-[11px] text-t3 space-y-0.5">
                    <p>Harvested for parts: <span className="text-t2 font-medium">{(job.harvestedParts ?? []).map(p => `${p.qty}× ${p.productName}`).join(', ') || '—'}</span></p>
                    <p>Kept in stock as parts: <span className="text-t2 font-medium">{fmtKes(job.harvestPartsValue ?? 0)}</span> · written off: <span className="text-t2 font-medium">{fmtKes(job.writeOffCost ?? 0)}</span></p>
                  </div>
                ) : (
                <p className="text-[11px] text-t3">Written off: <span className="text-t2 font-medium">{job.writeOffCost ? `${fmtKes(job.writeOffCost)} booked as a loss` : 'before write-offs were booked — no amount'}</span></p>
                )
              )}
              {job.completedDate && <p className="text-[11px] text-t3">Completed: <span className="text-t2 font-medium">{fmtDate(job.completedDate)}</span></p>}
              {job.transferDate  && <p className="text-[11px] text-t3">Transferred: <span className="text-t2 font-medium">{fmtDate(job.transferDate)}</span></p>}
            </div>

            {/* Status */}
            <div className="card p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Status</p>
              <RefurbStatusBadge status={job.status} />
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-t3">Parts logged</span>
                  <span className="font-semibold text-t1">{job.partsNeeded.length}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-t3">Parts cost</span>
                  <span className="font-semibold text-t1">{partTotal > 0 ? fmtKes(partTotal) : '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Issue & Notes */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Issues found</p>
              {canLogNotes(job) && (
                <button className="text-[11px] font-semibold" style={{ color: 'var(--info-text)' }}
                  onClick={() => { setNotesText(job.techNotes ?? ''); setIssuesText(job.issuesFound ?? ''); setShowNotesModal(true) }}>
                  {job.issuesFound ? 'Edit' : 'Record issues'}
                </button>
              )}
            </div>
            {job.issuesFound
              ? <p className="text-sm text-t1 whitespace-pre-line">{job.issuesFound}</p>
              : <p className="text-xs italic text-t3">{job.assignedTechnicianName ? `Waiting for ${job.assignedTechnicianName} to record what is wrong.` : 'Recorded by the technician once the job is assigned.'}</p>}
            {job.intakeIssueDescription && !/^Not identified/.test(job.intakeIssueDescription) && (
              <p className="text-[11px] text-t3">Noted at intake: {job.intakeIssueDescription}</p>
            )}
            {job.techNotes && (
              <>
                <div style={{ borderTop: '1px solid var(--bg-muted)', paddingTop: 12 }}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-t3 mb-2">Technician Notes</p>
                  <p className="text-sm text-t1 whitespace-pre-line">{job.techNotes}</p>
                </div>
              </>
            )}
          </div>

          {/* Parts */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid var(--bg-muted)' }}>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Parts & components needed</p>
              {canAddParts(job) && (
                <button className="btn-primary text-xs py-1"
                  onClick={() => {
                    setEditPartId(null)
                    setPartForm({ partName: '', qty: '', estimatedCost: 0, status: 'needed', notes: '', installAction: undefined })
                    setRequestNow(true)
                    setShowPartModal(true)
                  }}>
                  <Fa icon={faPlus} className="mr-1" />Add part
                </button>
              )}
            </div>
            <DataTable
              tableId={`refurbishment-parts-${job.id}`}
              columns={[
                {
                  key: 'part', label: 'Part', priority: 1, width: '1fr',
                  render: (p: RefurbPart) => {
                    const linkedProd = p.productId ? products.find(x => x.id === p.productId) : null
                    return (
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-t1">{p.partName}</p>
                        {linkedProd && <p className="text-[10px] text-t3">{linkedProd.name}</p>}
                        {(() => {
                          const slot = refurbFitSlotForForm({ partName: p.partName, productId: p.productId, products })
                          if (!slot) return null
                          return <p className="text-[10px] text-t3">{refurbInstallActionLabel(resolveRefurbInstallAction(p, slot))}</p>
                        })()}
                        {p.notes && <p className="text-[10px] text-t3">{p.notes}</p>}
                        {p.allocatedByName && <p className="text-[10px] text-green-600">Allocated by {p.allocatedByName}</p>}
                        {p.notifiedTechDate && <p className="text-[10px] text-emerald-600 inline-flex items-center gap-1"><Fa icon={faCheck} aria-hidden="true" /> Ready — notified {fmtD(p.notifiedTechDate)}</p>}
                      </div>
                    )
                  },
                  exportValue: (p: RefurbPart) => p.partName,
                },
                {
                  key: 'qty', label: 'Qty', priority: 1, width: '60px', align: 'right',
                  render: (p: RefurbPart) => <span className="text-xs text-t2">{p.qty}</span>,
                  exportValue: (p: RefurbPart) => p.qty,
                },
                {
                  key: 'cost', label: 'Cost', priority: 1, width: '100px', align: 'right',
                  render: (p: RefurbPart) => (
                    <span className="text-xs font-medium text-t1">{fmtKes(p.estimatedCost * p.qty)}</span>
                  ),
                  exportValue: (p: RefurbPart) => p.estimatedCost * p.qty,
                },
                {
                  key: 'stock', label: 'In Stock', priority: 2, width: '90px', align: 'center',
                  render: (p: RefurbPart) => {
                    const linkedProd = p.productId ? products.find(x => x.id === p.productId) : null
                    const inStock = linkedProd ? linkedProd.stockQty : null
                    const stockOk = inStock !== null && inStock >= p.qty
                    if (inStock === null) return <span className="text-t3 text-[10px]">—</span>
                    return (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: stockOk ? 'var(--success-bg)' : 'var(--danger-bg)', color: stockOk ? 'var(--success-text)' : '#991B1B' }}>
                        {inStock} avail
                      </span>
                    )
                  },
                  exportValue: (p: RefurbPart) => {
                    const linkedProd = p.productId ? products.find(x => x.id === p.productId) : null
                    return linkedProd?.stockQty ?? ''
                  },
                },
                {
                  key: 'status', label: 'Status', priority: 1, width: '90px', align: 'center',
                  render: (p: RefurbPart) => {
                    const pm = PART_STATUS_META[p.status] ?? PART_STATUS_META.needed
                    return (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: pm.bg, color: pm.color }}>
                        {pm.label}
                      </span>
                    )
                  },
                  exportValue: (p: RefurbPart) => (PART_STATUS_META[p.status] ?? PART_STATUS_META.needed).label,
                },
              ] as ColumnDef<RefurbPart>[]}
              rows={job.partsNeeded}
              rowKey={p => p.id}
              hideSearch
              emptyMessage="No parts logged for this job"
              perPage={50}
              rowActions={p => (
                <div className="flex items-center justify-end gap-1 flex-wrap">
                  {canAddParts(job) && p.productId && p.status === 'needed' && (
                    <button style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'var(--primary-light)', color: 'var(--info-text)', border: '1px solid #93C5FD', cursor: 'pointer' }}
                      onClick={() => requestPartFromInventory(job.id, p.id)}>Request</button>
                  )}
                  {isLeadTech && p.status === 'requested' && p.productId && (
                    <button style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid #6EE7B7', cursor: 'pointer' }}
                      onClick={() => allocateRefurbPart(job.id, p.id)}>Allocate</button>
                  )}
                  {isLeadTech && ['allocated', 'received'].includes(p.status) && !p.notifiedTechDate && (
                    <button style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: '#ECFDF5', color: 'var(--success-text)', border: '1px solid #A7F3D0', cursor: 'pointer' }}
                      onClick={() => notifyTechPartAvailable(job.id, p.id)}>Notify Tech</button>
                  )}
                  {canAddParts(job) && ['allocated', 'received'].includes(p.status) && (
                    <button style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'var(--bg-muted)', color: 'var(--text-3)', border: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => updateRefurbishmentPart(job.id, p.id, { status: 'used' })}>Mark Used</button>
                  )}
                  {canAddParts(job) && p.status !== 'used' && (
                    <>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: 11 }}
                        onClick={() => {
                          setEditPartId(p.id)
                          setPartForm({ partName: p.partName, productId: p.productId, qty: p.qty, estimatedCost: p.estimatedCost, status: p.status, notes: p.notes ?? '', installAction: p.installAction })
                          setShowPartModal(true)
                        }}
                        aria-label="Edit part"><Fa icon={faPencil} /></button>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 11 }}
                        onClick={() => removeRefurbishmentPart(job.id, p.id)}
                        aria-label="Remove part"><Fa icon={faTrash} /></button>
                    </>
                  )}
                </div>
              )}
            />
            {partTotal > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5"
                style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--bg-muted)' }}>
                <span className="text-xs font-semibold text-t2">Total Parts Cost</span>
                <span className="text-sm font-bold" style={{ color: 'var(--navy)' }}>{fmtKes(partTotal)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Assign Modal ── */}
        {showAssignModal && (
          <Modal title="Assign Technician" onClose={() => setShowAssignModal(false)} width={400}>
            {job.assignedTechnicianName && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-3"
                style={{ background: 'var(--warning-bg)', border: '1px solid #FDE68A', color: 'var(--warning-text)' }}>
                <span aria-hidden="true"><Fa icon={faTriangleExclamation} /></span>
                <span>Currently assigned to <strong>{job.assignedTechnicianName}</strong>. Selecting another will reassign.</span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {[...techs]
                .sort((a, b) => a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0)
                .map(tech => {
                  const isMe = tech.id === currentUserId
                  const isCurrent = tech.id === job.assignedTechnicianId
                  return (
                    <button key={tech.id}
                      onClick={() => { assignRefurbishmentJob(job.id, tech.id, tech.name); setShowAssignModal(false) }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs text-left transition-all"
                      style={{
                        border: `1px solid ${isCurrent ? '#A8D4E8' : 'var(--border-lt)'}`,
                        background: isCurrent ? '#E8F3FA' : 'var(--bg-surface)',
                        cursor: 'pointer',
                      }}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                        style={{ background: isMe ? 'linear-gradient(135deg, var(--success), #34D399)' : 'linear-gradient(135deg, var(--navy), var(--accent-cyan))' }}>
                        {tech.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-t1">{tech.name}</p>
                        <p className="text-[10px] text-t3 capitalize">{tech.role.replace('_', ' ')}{isMe ? ' — you' : ''}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {isMe      && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: 'var(--success-bg)', color: 'var(--success-text)' }}>Me</span>}
                        {isCurrent && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: 'var(--primary-light)', color: 'var(--info-text)' }}>Current</span>}
                      </div>
                    </button>
                  )
                })}
            </div>
          </Modal>
        )}

        {/* ── Notes Modal ── */}
        {showNotesModal && (
          <Modal title="Issues & notes" subtitle={`${job.ref} · ${job.productName}`} onClose={() => setShowNotesModal(false)} width={520}>
            <div className="space-y-3">
              <Field label="Issues found" required hint="What is wrong with the machine, one per line">
                <Textarea value={issuesText} onChange={setIssuesText} rows={4}
                  placeholder={'e.g. No display — backlight\nBattery holds no charge\nKeyboard: keys E and R dead'} />
              </Field>
              <Field label="Work notes (optional)">
                <Textarea value={notesText} onChange={setNotesText} rows={3}
                  placeholder="Tests done, work carried out…" />
              </Field>
              <p className="text-[11px] text-t3">Next, add the parts and components it needs under Parts needed — they go to stores as requests.</p>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowNotesModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => {
                if (!issuesText.trim()) { showToast('Record at least one issue found', 'error'); return }
                updateRefurbishmentJob(job.id, { issuesFound: issuesText.trim(), techNotes: notesText })
                setShowNotesModal(false)
                showToast('Issues saved')
              }}>Save</button>
            </div>
          </Modal>
        )}

        {/* ── Part Modal ── */}
        {showPartModal && (() => {
          const linkedProd = partForm.productId ? products.find(x => x.id === partForm.productId) : null
          return (
            <Modal title={editPartId ? 'Edit Part' : 'Add Part'} onClose={() => setShowPartModal(false)} width={440}>
              <div className="space-y-1">
                <SearchPicker
                  label="Find it in inventory"
                  placeholder="Search parts: RAM 8GB, battery 840 G5, SSD…"
                  items={products.filter(x => x.isActive)}
                  selectedLabel={linkedProd ? linkedProd.name : undefined}
                  formatSelected={x => x.name}
                  onSelect={prod => {
                    const slot = refurbFitSlotForForm({ partName: prod.name, productId: prod.id, products })
                    setPartForm(p => ({
                      ...p,
                      productId: prod.id,
                      partName: prod.name,
                      estimatedCost: prod.costPrice,
                      installAction: slot ? (p.installAction || defaultRefurbInstallAction(slot)) : undefined,
                    }))
                  }}
                  renderItem={x => (
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span className="text-xs text-t1 truncate">{x.name}{x.sku ? <span className="text-t3"> · {x.sku}</span> : null}</span>
                      <span className="text-[10px] text-t3 whitespace-nowrap">{x.stockQty} in stock</span>
                    </div>
                  )}
                  emptyText="Not in inventory — it is added by this name, unlinked"
                  // What is typed becomes the part name until an item is chosen.
                  onQueryChange={q => setPartForm(p => (p.productId ? p : { ...p, partName: q }))}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  {linkedProd ? (
                    <>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap', background: linkedProd.stockQty >= Number(partForm.qty || 1) ? 'var(--success-bg)' : 'var(--danger-bg)', color: linkedProd.stockQty >= Number(partForm.qty || 1) ? 'var(--success-text)' : '#991B1B' }}>
                        <span className="inline-flex items-center gap-1">{linkedProd.stockQty >= Number(partForm.qty || 1) ? <><Fa icon={faCheck} aria-hidden="true" /> {linkedProd.stockQty} in stock</> : <><Fa icon={faTriangleExclamation} aria-hidden="true" /> Only {linkedProd.stockQty} in stock — the lead will order it</>}</span>
                      </span>
                      <button type="button" className="text-[10px] text-t3 underline" onClick={() => setPartForm(p => ({ ...p, productId: undefined }))}>Unlink</button>
                    </>
                  ) : (
                    <span className="text-[10px] text-t3">Not linked — stores cannot pull it until it is linked to an inventory item.</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Part Name *">
                  <input className="form-input" value={partForm.partName}
                    onChange={e => {
                      const name = e.target.value
                      setPartForm(p => {
                        const slot = refurbFitSlotForForm({ partName: name, productId: p.productId, products })
                        return {
                          ...p,
                          partName: name,
                          installAction: slot ? (p.installAction || defaultRefurbInstallAction(slot)) : undefined,
                        }
                      })
                    }} />
                </Field>
                <Field label="Qty *">
                  <input className="form-input" type="number" min={1} value={partForm.qty}
                    onChange={e => setPartForm(p => ({ ...p, qty: e.target.value === '' ? '' : Number(e.target.value) }))} />
                </Field>
              </div>
              <Field label="Notes (optional)">
                <input className="form-input" value={partForm.notes ?? ''}
                  onChange={e => setPartForm(p => ({ ...p, notes: e.target.value }))} />
              </Field>
              {(() => {
                const slot = refurbFitSlotForForm({ partName: partForm.partName, productId: partForm.productId, products })
                if (!slot) return null
                const draftParts = [
                  ...job.partsNeeded.filter(p => p.id !== editPartId),
                  { ...partForm, qty: Number(partForm.qty) || 0, status: partForm.status || 'needed' },
                ]
                const preview = applyRefurbPartsToUnitName({
                  productName: job.productName,
                  specsAtIntake: typeof job.specsAtIntake === 'string' ? job.specsAtIntake : job.specs,
                  parts: draftParts,
                  products,
                })
                return (
                  <RefurbInstallActionField
                    slot={slot}
                    value={partForm.installAction}
                    onChange={action => setPartForm(p => ({ ...p, installAction: action }))}
                    afterName={preview?.sellingName}
                  />
                )
              })()}
              {!editPartId && (
                <label className="flex items-center gap-2 text-xs text-t2 mt-2">
                  <input type="checkbox" checked={requestNow && !!partForm.productId} disabled={!partForm.productId} onChange={e => setRequestNow(e.target.checked)} />
                  Request it from stores now {partForm.productId ? '' : '(link it to an inventory item first)'}
                </label>
              )}
              <div className="flex gap-2 justify-end mt-4">
                <button className="btn-outline" onClick={() => setShowPartModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={() => {
                  if (!partForm.partName.trim()) { showToast('Enter part name', 'error'); return }
                  const qty = Number(partForm.qty)
                  if (partForm.qty === '' || !Number.isInteger(qty) || qty < 1) { showToast('Enter the part quantity (1 or more)', 'error'); return }
                  const slot = refurbFitSlotForForm({ partName: partForm.partName, productId: partForm.productId, products })
                  const payload = {
                    ...partForm,
                    qty,
                    installAction: slot ? (partForm.installAction || defaultRefurbInstallAction(slot)) : undefined,
                  }
                  if (editPartId) {
                    updateRefurbishmentPart(job.id, editPartId, payload)
                  } else {
                    addRefurbishmentPart(job.id, payload, { request: requestNow && !!payload.productId })
                  }
                  setShowPartModal(false)
                }}>{!editPartId && requestNow && partForm.productId ? 'Add & request' : 'Save part'}</button>
              </div>
            </Modal>
          )
        })()}

        {/* ── Write-Off Modal ── */}
        {showWriteOffModal && (
          <Modal title="Write Off Device" onClose={() => setShowWriteOffModal(false)} width={400}>
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg mb-1"
                style={{ background: 'var(--danger-bg)', border: '1px solid #FCA5A5' }}>
                <span aria-hidden="true"><Fa icon={faTriangleExclamation} /></span>
                <p className="text-xs" style={{ color: '#991B1B', lineHeight: 1.5 }}>
                  This device will be marked as unrepairable and written off from inventory. You can restore it later if needed.
                </p>
              </div>
              <Field label="Reason for write-off *">
                <Textarea value={writeOffReason} onChange={setWriteOffReason} rows={3}
                  placeholder="Describe why the device cannot be repaired…" />
              </Field>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowWriteOffModal(false)}>Cancel</button>
              <button className="btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={() => {
                  if (!writeOffReason.trim()) { showToast('Enter a reason', 'error'); return }
                  void writeOffRefurbishmentJob(job.id, writeOffReason.trim()).then(ok => {
                    if (!ok) return
                    setShowWriteOffModal(false)
                    setActiveId(null)
                  })
                }}>Write Off</button>
            </div>
          </Modal>
        )}
        {showIdentify && <IdentifyUnitModal job={job} onClose={() => setShowIdentify(false)} />}
        {showHarvest && <HarvestPartsModal job={job} onClose={() => setShowHarvest(false)} onDone={() => { setShowHarvest(false); setActiveId(null) }} />}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="mod-page">
      <ModuleHeader
        title="Refurbishment"
        subtitle={`${stats.inProgress} in progress · ${stats.ready} ready`}
        icon={<Fa icon={faRotate} />}
        count={refurbishmentJobs.length}
        color="#8B5CF6"
      />
      <TabBar
        tabs={[{ id: 'jobs', label: 'Jobs' }, { id: 'report', label: 'Weekly report' }]}
        active={view}
        onChange={id => setViewValue(id === 'report' ? 'report' : 'jobs')}
        ariaLabel="Refurbishment sections"
      />
      {view === 'report' ? (
        <div className="mod-body p-3 sm:p-4">
          <RefurbWeeklyReport
            jobs={refurbishmentJobs}
            weekStart={reportWeek}
            onWeekChange={setReportWeek}
            onOpenJob={id => setActiveId(id)}
            generatedBy={currentUser?.name ?? 'ERP'}
            onPrintBlocked={() => showToast('Allow pop-ups for this site to print the report', 'error')}
          />
        </div>
      ) : (
      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

        {/* Parts inbox */}
        {(() => {
          const pendingParts = refurbishmentJobs.flatMap(j =>
            j.partsNeeded.filter(p => p.status === 'requested' || p.status === 'ordered').map(p => ({ job: j, part: p }))
          )
          if (pendingParts.length === 0) return null
          return (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #BFDBFE' }}>
              <div className="flex items-center gap-2 px-4 py-2.5"
                style={{ background: 'var(--info-bg)', borderBottom: '1px solid #BFDBFE' }}>
                <Fa icon={faBell} className="text-sm" aria-hidden="true" />
                <p className="text-xs font-bold" style={{ color: 'var(--info-text)' }}>
                  {pendingParts.length} part{pendingParts.length > 1 ? 's' : ''} waiting — the jobs carry on; ordering is in Inventory › Parts requests
                </p>
              </div>
              <div className="bg-white flex flex-col divide-y divide-primary-50">
                {pendingParts.map(({ job: j, part: p }) => {
                  const prod = p.productId ? products.find(x => x.id === p.productId) : null
                  return (
                    <div key={`${j.id}-${p.id}`} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-t1">
                          {p.partName} × {p.qty}
                          {p.status === 'ordered' && <span className="ml-1.5 font-normal text-t3">· ordered{p.poRef ? ` on ${p.poRef}` : ''} — the technician is told when it is received</span>}
                        </p>
                        <p className="text-t3">
                          Job: <span className="font-medium cursor-pointer" style={{ color: 'var(--navy)' }} onClick={() => setActiveId(j.id)}>{j.ref}</span>
                          {' · '}{j.productName}
                          {prod && <> · <span className={`inline-flex items-center gap-1 ${prod.stockQty >= p.qty ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}`}>{prod.stockQty >= p.qty ? <><Fa icon={faCheck} aria-hidden="true" /> {prod.stockQty} in stock</> : <><Fa icon={faTriangleExclamation} aria-hidden="true" /> Only {prod.stockQty}</>}</span></>}
                        </p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {isLeadTech && p.status === 'requested' && prod && prod.stockQty >= p.qty && (
                          <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid #6EE7B7', cursor: 'pointer' }}
                            onClick={() => allocateRefurbPart(j.id, p.id)}>Allocate from Stock</button>
                        )}
                        {p.status === 'requested' && (
                          <a href="/inventory?tab=parts_requests" style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#EDE9FE', color: '#5B21B6', border: '1px solid #C4B5FD', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                            Order in Inventory
                          </a>
                        )}
                        <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-muted)', color: 'var(--text-3)', border: '1px solid var(--border-lt)', cursor: 'pointer' }}
                          onClick={() => setActiveId(j.id)}>View</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* With Issues */}
        {withIssuesSerials.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #FED7AA' }}>
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 flex-wrap"
              style={{ background: '#FFF7ED', borderBottom: '1px solid #FED7AA' }}>
              <div className="flex items-center gap-2">
                <Fa icon={faTriangleExclamation} aria-hidden="true" />
                <p className="text-xs font-bold" style={{ color: 'var(--warning-text)' }}>
                  {withIssuesSerials.length} device{withIssuesSerials.length > 1 ? 's' : ''} with issues — awaiting refurbishment decision
                </p>
              </div>
              <div className="flex items-center gap-2">
              {isLeadTech && (
                <>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium cursor-pointer select-none" style={{ color: 'var(--warning-text)' }}>
                    <input type="checkbox"
                      checked={withIssuesSerials.length > 0 && withIssuesSerials.every(s => selectedIssueIds.has(s.id))}
                      onChange={e => setSelectedIssueIds(e.target.checked ? new Set(withIssuesSerials.map(s => s.id)) : new Set())}
                      style={{ accentColor: '#EA580C' }} />
                    Select All
                  </label>
                  {selectedIssueIds.size > 0 && (
                    <button className="btn-primary text-[11px] py-1 px-3"
                      style={{ background: '#EA580C', borderColor: '#EA580C' }}
                      onClick={() => setShowBulkSendModal(true)}>
                      <Fa icon={faWrench} className="mr-1.5" />Send {selectedIssueIds.size} to Refurbishment
                    </button>
                  )}
                </>
              )}
              </div>
            </div>
            <div className="bg-white grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {withIssuesSerials.map(s => {
                const isSel = selectedIssueIds.has(s.id)
                return (
                  <div key={s.id} className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-all"
                    style={{ background: isSel ? 'var(--warning-bg)' : 'var(--bg-surface)', border: `1px solid ${isSel ? 'var(--warning)' : 'var(--border-lt)'}` }}>
                    {isLeadTech && (
                      <input type="checkbox" checked={isSel} style={{ accentColor: '#EA580C', flexShrink: 0 }}
                        onChange={e => {
                          const next = new Set(selectedIssueIds)
                          e.target.checked ? next.add(s.id) : next.delete(s.id)
                          setSelectedIssueIds(next)
                        }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-t1 truncate" title={s.productName}>{s.productName}</p>
                      <p className="font-mono text-[10px] text-t3 truncate">
                        {unitInfo(s).assetId || s.serial}
                        {unitInfo(s).assetId && !unitInfo(s).identityPending && s.serial !== unitInfo(s).assetId ? ` · S/N ${s.serial}` : ''}
                      </p>
                      {unitInfo(s).intakeIssue && <p className="text-[10px] text-t3 truncate" title={unitInfo(s).intakeIssue}>{unitInfo(s).intakeIssue}</p>}
                    </div>
                    {isLeadTech && selectedIssueIds.size === 0 && (
                      <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#EA580C', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        onClick={() => { setCreateJobSerial(s); setCreateJobIssue(unitInfo(s).intakeIssue ?? ''); setShowCreateJobModal(true) }}>
                        Send
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {!isLeadTech && (
              <div className="px-4 py-2 text-[10px]" style={{ background: '#FFF7ED', color: 'var(--warning-text)', borderTop: '1px solid #FED7AA' }}>
                Ask the lead technician to send these devices for refurbishment.
              </div>
            )}
          </div>
        )}

        {/* Orphaned serials */}
        {orphanedSerials.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #FDE68A' }}>
            <div className="flex items-center gap-2 px-4 py-2.5"
              style={{ background: 'var(--warning-bg)', borderBottom: '1px solid #FDE68A' }}>
              <span aria-hidden="true"><Fa icon={faTriangleExclamation} /></span>
              <p className="text-xs font-bold" style={{ color: 'var(--warning-text)' }}>
                {orphanedSerials.length} device{orphanedSerials.length > 1 ? 's' : ''} in repair unit — no job created yet
              </p>
            </div>
            <div className="bg-white grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {orphanedSerials.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-t1 truncate" title={s.productName}>{s.productName}</p>
                    <p className="font-mono text-[10px] text-t3">{s.serial}</p>
                  </div>
                  {isLeadTech && (
                    <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: 'var(--warning)', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      onClick={() => { setCreateJobSerial(s); setCreateJobIssue(''); setShowCreateJobModal(true) }}>
                      + Create Job
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!isLeadTech && (
              <div className="px-4 py-2 text-[10px]" style={{ background: 'var(--warning-bg)', color: '#B45309', borderTop: '1px solid #FDE68A' }}>
                Ask the lead technician to create a job for these devices.
              </div>
            )}
          </div>
        )}

        {/* Jobs table */}
        <div className="card overflow-hidden">
          <DataTable
            tableId="refurbishment-jobs"
            columns={[
              {
                key: 'ref', label: 'Ref', priority: 1, width: '90px',
                render: (j: RefurbishmentJob) => <span className="font-mono text-[11px] font-semibold" style={{ color: '#5B21B6' }}>{j.ref}</span>,
                exportValue: (j: RefurbishmentJob) => j.ref,
              },
              {
                key: 'device', label: 'Device', priority: 1, width: '1fr',
                render: (j: RefurbishmentJob) => (
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-t1 erp-truncate" title={j.productName}>{j.productName}</p>
                    <p className="font-mono text-[10px] text-t3 erp-truncate" title={j.serialNumber}>
                      {assetIdBySerialId.get(j.serialId) && <span className="font-semibold text-t2">{assetIdBySerialId.get(j.serialId)} · </span>}
                      {j.identityPending ? 'Tag' : 'S/N'} {j.serialNumber}
                      {j.identityPending && !['transferred', 'written_off'].includes(j.status) && <span className="ml-1.5 font-sans font-semibold rounded px-1" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>Unidentified</span>}
                      {j.outcome === 'harvested' && <span className="ml-1.5 font-sans font-semibold rounded px-1" style={{ background: 'var(--bg-muted)', color: 'var(--text-3)' }}>Harvested</span>}
                    </p>
                  </div>
                ),
                accessor: (j: RefurbishmentJob) => `${j.productName} ${j.serialNumber} ${assetIdBySerialId.get(j.serialId) ?? ''}`,
                exportValue: (j: RefurbishmentJob) => j.productName,
              },
              {
                key: 'status', label: 'Status', priority: 1, width: '120px',
                render: (j: RefurbishmentJob) => <RefurbStatusBadge status={j.status} />,
                accessor: (j: RefurbishmentJob) => STATUS_META[j.status].label,
                exportValue: (j: RefurbishmentJob) => STATUS_META[j.status].label,
              },
              {
                key: 'technician', label: 'Technician', priority: 2, width: '110px',
                render: (j: RefurbishmentJob) => j.assignedTechnicianName ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, var(--navy), var(--accent-cyan))' }}>
                      {j.assignedTechnicianName.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-xs text-t1 truncate">{j.assignedTechnicianName}</span>
                  </div>
                ) : (
                  <span className="text-xs italic font-medium inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}><Fa icon={faTriangleExclamation} aria-hidden="true" /> Unassigned</span>
                ),
                exportValue: (j: RefurbishmentJob) => j.assignedTechnicianName || '',
              },
              {
                key: 'partsCost', label: 'Parts cost', align: 'right' as const, priority: 2, width: '130px',
                render: (j: RefurbishmentJob) => {
                  const partTotal = j.partsNeeded.reduce((s, p) => s + p.estimatedCost * p.qty, 0)
                  return <span className="text-xs font-medium text-t2">{partTotal > 0 ? fmtKes(partTotal) : '—'}</span>
                },
                exportValue: (j: RefurbishmentJob) => j.partsNeeded.reduce((s, p) => s + p.estimatedCost * p.qty, 0),
              },
              {
                key: 'intake', label: 'Intake', priority: 3, width: '90px',
                render: (j: RefurbishmentJob) => <span className="text-xs text-t3">{fmtDate(j.intakeDate)}</span>,
                exportValue: (j: RefurbishmentJob) => j.intakeDate,
              },
            ] as ColumnDef<RefurbishmentJob>[]}
            rows={filtered}
            rowKey={j => j.id}
            searchValue={jobSearch}
            onSearchChange={setJobSearch}
            searchPlaceholder="Search jobs by ref, device, serial or technician…"
            page={page}
            onPageChange={setPage}
            primaryFilters={refurbishmentPrimaryFilters}
            onClearFilters={() => patchListUi({ q: null, status: null, page: null })}
            hideColumnFilters
            emptyMessage={
              filterStatus !== 'all'
                ? `No jobs with status "${STATUS_META[filterStatus as RefurbStatus].label}"`
                : 'No refurbishment jobs'
            }
            onRowClick={j => setActiveId(j.id)}
            rowStyle={j => ({ borderLeft: `3px solid ${STATUS_LEFT_BORDER[j.status]}` })}
            cardAccent={j => STATUS_LEFT_BORDER[j.status]}
            exportTitle="Refurbishment Jobs"
            exportFilename="refurbishment-jobs"
          />
        </div>
      </div>
      )}


      {/* ── Bulk Send Modal ── */}
      {showBulkSendModal && (
        <Modal title={`Send ${selectedIssueIds.size} Device${selectedIssueIds.size > 1 ? 's' : ''} to Refurbishment`}
          onClose={() => setShowBulkSendModal(false)} width={480}>
          <div className="rounded-lg p-3 mb-3 flex flex-col gap-1.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)', maxHeight: 180, overflowY: 'auto' }}>
            {withIssuesSerials.filter(s => selectedIssueIds.has(s.id)).map(s => (
              <div key={s.id} className="flex items-center gap-2 text-xs">
                <Fa icon={faBoxOpen} className="text-t3" aria-hidden="true" />
                <span className="font-semibold text-t1">{s.productName}</span>
                <span className="font-mono text-t3">{unitInfo(s).assetId || s.serial}</span>
                {unitInfo(s).intakeIssue && <span className="text-t3 truncate">· {unitInfo(s).intakeIssue}</span>}
              </div>
            ))}
          </div>
          <Field label="Issue (optional)">
            <Textarea value={bulkIssueDesc} onChange={setBulkIssueDesc} rows={3}
              placeholder="Leave blank to keep each machine's own issues — the technician adds what they find" />
          </Field>
          <div className="flex gap-2 justify-end mt-4">
            <button className="btn-outline" onClick={() => setShowBulkSendModal(false)}>Cancel</button>
            <button className="btn-primary" style={{ background: '#EA580C', borderColor: '#EA580C' }}
              onClick={() => {
                sendToRefurbishment(withIssuesSerials.filter(s => selectedIssueIds.has(s.id)), bulkIssueDesc.trim())
                setSelectedIssueIds(new Set()); setBulkIssueDesc(''); setShowBulkSendModal(false)
              }}>
              Send to Refurbishment
            </button>
          </div>
        </Modal>
      )}

      {/* ── Create Job Modal ── */}
      {showCreateJobModal && createJobSerial && (
        <Modal title="Create Refurbishment Job" onClose={() => setShowCreateJobModal(false)} width={440}>
          <div className="rounded-lg p-3 mb-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
            <p className="text-xs font-semibold text-t1">{createJobSerial.productName}</p>
            <p className="font-mono text-[11px] text-t3">{unitInfo(createJobSerial).assetId ? `${unitInfo(createJobSerial).assetId} · ` : ''}S/N: {createJobSerial.serial}</p>
          </div>
          <Field label="Issue (optional)">
            <Textarea value={createJobIssue} onChange={setCreateJobIssue} rows={3}
              placeholder="Describe the problem — e.g. cracked screen, battery failure…" />
          </Field>
          <div className="flex gap-2 justify-end mt-4">
            <button className="btn-outline" onClick={() => setShowCreateJobModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => {
              createRefurbishmentJob(createJobSerial.id, createJobIssue.trim())
              setShowCreateJobModal(false)
            }}>Create Job</button>
          </div>
        </Modal>
      )}
      {pendingConfirm && (
        <Confirm
          message={pendingConfirm.msg}
          confirmLabel="Restore"
          onConfirm={() => { pendingConfirm.action(); setPendingConfirm(null) }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  )
}

export default function Refurbishment() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <RefurbishmentContent />
    </Suspense>
  )
}
