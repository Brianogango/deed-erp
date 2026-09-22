'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useFinanceStore, fmtDate, fmtKes, OutsourceVendor, OutsourceJob, OUTSOURCE_SERVICE_TYPES, OutsourceServiceType } from '@/lib/store'
import { repairOutsourceReadiness } from '@/lib/repair-outsource'
import { ModuleSkeleton, useMounted, InfoRow, ModuleHeader, TabBar, SearchPicker, Modal } from '@/components/ui'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
import { DataTable, DetailsDrawer, type ColumnDef, type DrawerTab } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { useUrlUiPatch, useUrlUiState } from '@/hooks/useUrlRecordId'
import { faScrewdriverWrench, faClipboardList, faBuilding, faCreditCard, faPlus, faCircleCheck } from '@fortawesome/free-solid-svg-icons'

// ── Helpers ──────────────────────────────────────────────────────────────────

const svcLabel = (v: OutsourceServiceType) =>
  OUTSOURCE_SERVICE_TYPES.find(s => s.value === v)?.label ?? v

const STATUS_META: Record<OutsourceJob['status'], { label: string; badgeStatus: string }> = {
  sent:                { label: 'Out for repair', badgeStatus: 'sent' },
  returned_resolved:   { label: 'Returned – fixed', badgeStatus: 'done' },
  returned_unresolved: { label: 'Returned – not fixed', badgeStatus: 'failed' },
}

function OutsourceStatusBadge({ status }: { status: OutsourceJob['status'] }) {
  const m = STATUS_META[status]
  return <StatusBadge status={m.badgeStatus} label={m.label} />
}

function fmtBalance(billed: number, paid: number) {
  const bal = billed - paid
  return { bal, color: bal <= 0 ? 'var(--success-text)' : '#991B1B' }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Outsource() {
  return (
    <Suspense fallback={
      <ModuleSkeleton />
    }>
      <OutsourceContent />
    </Suspense>
  )
}

function OutsourceContent() {
  const mounted = useMounted()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const {
    users, currentUserId, repairs, bankAccounts,
    outsourceVendors, outsourceJobs, outsourcePayments, invoices,
    addOutsourceVendor, updateOutsourceVendor,
    addOutsourceJob, returnOutsourceJob, recordOutsourcePayment,
    setModule, showToast,
  } = useFinanceStore()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin = currentUser?.role === 'director'

  // ── filter state ──
  const queryTab = searchParams.get('tab') as 'jobs' | 'vendors' | null
  const queryId = searchParams.get('id')
  const queryVendorId = searchParams.get('vendorId')

  const [tab, setLocalTab] = useState<'jobs' | 'vendors'>(queryTab ?? 'jobs')
  const [selectedVendorId, setLocalSelectedVendorId] = useState<string | null>(queryVendorId ?? null)
  const [activeJobId, setLocalActiveJobId] = useState<string | null>(queryId ?? null)

  const setTab = (newTab: 'jobs' | 'vendors') => {
    setLocalTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const setSelectedVendorId = (id: string | null) => {
    setLocalSelectedVendorId(id)
    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set('vendorId', id)
      params.set('tab', 'vendors')
      setLocalTab('vendors')
    } else {
      params.delete('vendorId')
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const setActiveJobId = (id: string | null) => {
    setLocalActiveJobId(id)
    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set('id', id)
      params.set('tab', 'jobs')
      setLocalTab('jobs')
    } else {
      params.delete('id')
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlTab = searchParams.get('tab') as 'jobs' | 'vendors' | null
    if (urlTab && urlTab !== tab) setLocalTab(urlTab)

    const urlVendorId = searchParams.get('vendorId')
    if (urlVendorId !== selectedVendorId) setLocalSelectedVendorId(urlVendorId)

    const urlId = searchParams.get('id')
    if (urlId !== activeJobId) setLocalActiveJobId(urlId)
  }, [searchParams, tab, selectedVendorId, activeJobId])

  const patchJobsUi = useUrlUiPatch()
  const [jobStatusValue, setJobStatusValue] = useUrlUiState('status', 'all')
  const jobStatusFilter: OutsourceJob['status'] | 'all' =
    ['sent', 'returned_resolved', 'returned_unresolved'].includes(jobStatusValue)
      ? jobStatusValue as OutsourceJob['status']
      : 'all'
  const setJobStatusFilter = (value: OutsourceJob['status'] | 'all') => setJobStatusValue(value)
  const [jobVendorFilter, setJobVendorFilter] = useUrlUiState('vendor', 'all')
  const [jobSearch, setJobSearch] = useUrlUiState('q', '')
  const [jobPageValue, setJobPageValue] = useUrlUiState('page', '1')
  const jobPage = Math.max(1, Number.parseInt(jobPageValue, 10) || 1)
  const setJobPage = (page: number) => setJobPageValue(String(Math.max(1, page)))

  // ── Job modal ──
  const [showJobModal, setShowJobModal] = useState(false)
  const [jobForm, setJobForm] = useState({
    vendorId: '',
    repairOrderId: '',        // linked repair order (optional)
    deviceDescription: '',
    serial: '',
    serviceType: '' as OutsourceServiceType | '',
    issueDescription: '',
    sentDate: '',
    quotedCost: '',
    notes: '',
  })
  const [repairSearch, setRepairSearch] = useState('')

  // Vendor search within job modal
  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorModalFromJob, setVendorModalFromJob] = useState(false)

  // Open / in-progress repairs that pass outsource readiness (assigned; diagnosis required unless Direct Repair)
  const pickableRepairs = repairs.filter(r =>
    !['delivered', 'cancelled', 'closed', 'declined', 'unrepairable', 'returned', 'retained', 'ready', 'verified_released', 'collected'].includes(r.status)
    && repairOutsourceReadiness(r).ok
  )
  function selectRepair(repairId: string) {
    const r = repairs.find(x => x.id === repairId)
    if (!r) return
    const readiness = repairOutsourceReadiness(r)
    if (!readiness.ok) { showToast(readiness.reason, 'error'); return }
    setJobForm(f => ({
      ...f,
      repairOrderId:     r.id,
      deviceDescription: `${r.productName}${r.serialNumber ? ` – SN ${r.serialNumber}` : ''} (${r.customerName})`,
      serial:            r.serialNumber ?? '',
      issueDescription:  r.issueDescription || r.diagnosis?.faultDescription || '',
    }))
    setRepairSearch(`${r.ref} · ${r.productName} (${r.customerName})`)
  }

  function clearRepairLink() {
    setJobForm(f => ({ ...f, repairOrderId: '', deviceDescription: '', serial: '', issueDescription: '' }))
    setRepairSearch('')
  }

  function openVendorFromJob(query = vendorSearch) {
    setVendorSearch(query)
    setVendorModalFromJob(true)
    setEditVendorId(null)
    setVendorForm({ name: query.trim(), phone: '', email: '', address: '', specializations: [], notes: '' })
    setShowVendorModal(true)
  }

  // ── Return modal ──
  const [returnJobId, setReturnJobId] = useState<string | null>(null)
  const [returnForm, setReturnForm] = useState({
    returnedDate: '',
    isResolved: null as boolean | null,
    returnNotes: '',
    finalCost: '',
    repairNextStep: '' as 'keep' | 'in_repair' | 'unrepairable' | '',
  })

  // ── Vendor modal ──
  const [showVendorModal, setShowVendorModal] = useState(false)
  const [editVendorId, setEditVendorId] = useState<string | null>(null)
  const [vendorForm, setVendorForm] = useState({
    name: '', phone: '', email: '', address: '',
    specializations: [] as OutsourceServiceType[],
    notes: '',
  })

  // ── Payment modal ──
  const [payVendorId, setPayVendorId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [payReference, setPayReference] = useState('')

  // ── Derived data ─────────────────────────────────────────────────────────

  function vendorBilled(vendorId: string) {
    return outsourceJobs
      .filter(j => j.vendorId === vendorId && j.finalCost != null)
      .reduce((s, j) => s + (j.finalCost ?? 0), 0)
  }
  function vendorPaid(vendorId: string) {
    return outsourcePayments
      .filter(p => p.vendorId === vendorId)
      .reduce((s, p) => s + p.amount, 0)
  }

  const filteredJobs = outsourceJobs
    .filter(j => jobStatusFilter === 'all' || j.status === jobStatusFilter)
    .filter(j => jobVendorFilter === 'all' || j.vendorId === jobVendorFilter)
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.sentDate || a.createdAt || '') || 0
      const bTime = Date.parse(b.sentDate || b.createdAt || '') || 0
      if (bTime !== aTime) return bTime - aTime
      return (b.ref || '').localeCompare(a.ref || '')
    })

  const activeJob = activeJobId ? outsourceJobs.find(j => j.id === activeJobId) ?? null : null

  const selectedVendor = selectedVendorId ? outsourceVendors.find(v => v.id === selectedVendorId) ?? null : null
  const vendorJobs = selectedVendor ? outsourceJobs.filter(j => j.vendorId === selectedVendor.id) : []
  const vendorPaymentHistory = selectedVendor ? outsourcePayments.filter(p => p.vendorId === selectedVendor.id) : []

  // ── Counts for tab badge ──
  const outCount = outsourceJobs.filter(j => j.status === 'sent').length
  const returnedToday = outsourceJobs.filter(job =>
    job.returnedDate && new Date(job.returnedDate).toDateString() === new Date().toDateString()
  ).length
  const unresolvedCount = outsourceJobs.filter(job => job.status === 'returned_unresolved').length
  const vendorOutstanding = outsourceVendors.reduce(
    (sum, vendor) => sum + Math.max(0, vendorBilled(vendor.id) - vendorPaid(vendor.id)),
    0,
  )

  // ── Handlers ─────────────────────────────────────────────────────────────

  function openNewJob() {
    setJobForm({ vendorId: '', repairOrderId: '', deviceDescription: '', serial: '', serviceType: '', issueDescription: '', sentDate: '', quotedCost: '', notes: '' })
    setRepairSearch('')
    setVendorSearch('')
    setShowJobModal(true)
  }

  function submitJob() {
    if (!jobForm.vendorId) { showToast('Select a vendor', 'error'); return }
    if (!jobForm.deviceDescription.trim()) { showToast('Enter device description', 'error'); return }
    if (!jobForm.serviceType) { showToast('Select a service type', 'error'); return }
    if (!jobForm.issueDescription.trim()) { showToast('Describe the issue', 'error'); return }
    if (!jobForm.sentDate) { showToast('Select the date sent', 'error'); return }
    if (jobForm.quotedCost.trim() && (!Number.isFinite(Number(jobForm.quotedCost)) || Number(jobForm.quotedCost) < 0)) { showToast('Quoted cost must be a number of 0 or more', 'error'); return }
    if (jobForm.repairOrderId) {
      const linked = repairs.find(r => r.id === jobForm.repairOrderId)
      if (!linked) { showToast('Linked repair was not found', 'error'); return }
      const readiness = repairOutsourceReadiness(linked)
      if (!readiness.ok) { showToast(readiness.reason, 'error'); return }
    }
    const vendor = outsourceVendors.find(v => v.id === jobForm.vendorId)!
    const linkedRepair = jobForm.repairOrderId
      ? repairs.find(r => r.id === jobForm.repairOrderId)
      : undefined
    const deviceDescription = jobForm.deviceDescription.trim()
    addOutsourceJob({
      vendorId: jobForm.vendorId,
      vendorName: vendor.name,
      repairOrderId: jobForm.repairOrderId || undefined,
      deviceDescription: linkedRepair
        ? `${deviceDescription}${deviceDescription.includes(linkedRepair.ref) ? '' : ` (${linkedRepair.ref})`}`
        : deviceDescription,
      serial: jobForm.serial.trim() || undefined,
      serviceType: jobForm.serviceType as OutsourceServiceType,
      issueDescription: jobForm.issueDescription.trim(),
      sentDate: jobForm.sentDate,
      quotedCost: jobForm.quotedCost ? Number(jobForm.quotedCost) : undefined,
      notes: jobForm.notes.trim() || undefined,
    })
    setShowJobModal(false)
  }

  function openReturn(jobId: string) {
    setReturnJobId(jobId)
    setReturnForm({ returnedDate: '', isResolved: null, returnNotes: '', finalCost: '', repairNextStep: '' })
  }

  function submitReturn() {
    if (!returnJobId) return
    const returningJob = outsourceJobs.find(j => j.id === returnJobId)
    const hasLinkedRepair = !!(returningJob?.repairOrderId && repairs.some(r => r.id === returningJob.repairOrderId))
    if (!returnForm.returnedDate) { showToast('Select the return date', 'error'); return }
    if (returnForm.isResolved === null) { showToast('Select whether the issue was resolved', 'error'); return }
    if (returnForm.isResolved === false && hasLinkedRepair && !returnForm.repairNextStep) {
      showToast('Select what should happen to the linked repair', 'error'); return
    }
    if (returnForm.finalCost.trim() && (!Number.isFinite(Number(returnForm.finalCost)) || Number(returnForm.finalCost) < 0)) {
      showToast('Final cost must be a number of 0 or more', 'error'); return
    }
    returnOutsourceJob(returnJobId, {
      returnedDate: returnForm.returnedDate,
      isResolved: returnForm.isResolved,
      returnNotes: returnForm.returnNotes.trim() || undefined,
      finalCost: returnForm.finalCost ? Number(returnForm.finalCost) : undefined,
      repairNextStep: returnForm.isResolved === false && returnForm.repairNextStep ? returnForm.repairNextStep : undefined,
    })
    setReturnJobId(null)
  }

  function openAddVendor() {
    setEditVendorId(null)
    setVendorForm({ name: '', phone: '', email: '', address: '', specializations: [], notes: '' })
    setShowVendorModal(true)
  }

  function openEditVendor(v: OutsourceVendor) {
    setEditVendorId(v.id)
    setVendorForm({ name: v.name, phone: v.phone, email: v.email ?? '', address: v.address ?? '', specializations: [...v.specializations], notes: v.notes ?? '' })
    setShowVendorModal(true)
  }

  function submitVendor() {
    if (!vendorForm.name.trim()) { showToast('Enter vendor name', 'error'); return }
    if (!vendorForm.phone.trim()) { showToast('Enter phone number', 'error'); return }
    if (editVendorId) {
      updateOutsourceVendor(editVendorId, { ...vendorForm, email: vendorForm.email || undefined, address: vendorForm.address || undefined, notes: vendorForm.notes || undefined })
    } else {
      const newVendor = addOutsourceVendor({ ...vendorForm, email: vendorForm.email || undefined, address: vendorForm.address || undefined, notes: vendorForm.notes || undefined })
      if (vendorModalFromJob) {
        setJobForm(f => ({ ...f, vendorId: newVendor.id }))
        setVendorSearch(newVendor.name)
        setShowJobModal(true)
      }
    }
    setShowVendorModal(false)
    setVendorModalFromJob(false)
  }

  function toggleSpec(svc: OutsourceServiceType) {
    setVendorForm(f => ({
      ...f,
      specializations: f.specializations.includes(svc)
        ? f.specializations.filter(s => s !== svc)
        : [...f.specializations, svc],
    }))
  }

  function openPayVendor(vendorId: string) {
    setPayVendorId(vendorId)
    setPayAmount('')
    setPayDate('')
    setPayMethod('')
    setPayNotes('')
    setPayBankAccountId('')
    setPayReference('')
  }

  function submitPayment() {
    if (!payVendorId) return
    const amt = Number(payAmount)
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'error'); return }
    if (!payMethod) { showToast('Select a payment method', 'error'); return }
    if (!payDate) { showToast('Select the payment date', 'error'); return }
    const vendor = outsourceVendors.find(v => v.id === payVendorId)!
    const billed = vendorBilled(payVendorId)
    const paid   = vendorPaid(payVendorId)
    const bal    = billed - paid
    if (amt > bal) { showToast(`Amount exceeds outstanding balance of ${fmtKes(bal)}`, 'error'); return }
    recordOutsourcePayment({ 
      vendorId: payVendorId, vendorName: vendor.name, amount: amt, date: payDate, notes: payNotes.trim() || undefined,
      method: payMethod, bankAccountId: payBankAccountId, reference: payReference
    })
    setPayVendorId(null)
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  const tabStyle = (t: string) => ({
    background: tab === t ? '#E8F3FA' : 'transparent',
    border: `1px solid ${tab === t ? '#A8D4E8' : 'transparent'}`,
    borderRadius: 8, cursor: 'pointer',
    color: tab === t ? 'var(--navy)' : 'var(--text-4)',
    padding: '7px 14px', fontSize: 11, fontWeight: tab === t ? 600 : 400,
    display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
  } as React.CSSProperties)

  // ── Jobs DataTable column config ──────────────────────────────────────────
  const jobColumns: ColumnDef<OutsourceJob>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: job => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{job.ref}</span>,
    },
    {
      key: 'device', label: 'Device', priority: 1, width: '1.8fr',
      render: job => {
        const linked = job.repairOrderId ? repairs.find(x => x.id === job.repairOrderId) : null
        return (
          <div className="min-w-0">
            <p className="font-medium text-t1 erp-truncate" title={job.deviceDescription}>{job.deviceDescription}</p>
            {job.serial && <p className="text-[10px] text-t3 erp-truncate" title={job.serial}>SN: {job.serial}</p>}
            {linked && (
              <p className="text-[10px] font-mono erp-truncate" style={{ color: 'var(--accent-cyan)' }} title={`${linked.ref} · ${linked.customerName}`}>
                {linked.ref} · {linked.customerName}
              </p>
            )}
          </div>
        )
      },
      searchValue: job => {
        const linked = job.repairOrderId ? repairs.find(x => x.id === job.repairOrderId) : null
        return [job.deviceDescription, job.serial, linked?.ref, linked?.customerName, linked?.customerPhone, job.repairOrderId, job.ref].filter(Boolean).join(' ')
      },
      exportValue: job => job.deviceDescription,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '160px',
      render: job => <OutsourceStatusBadge status={job.status} />,
      exportValue: job => STATUS_META[job.status].label,
    },
    {
      key: 'cost', label: 'Cost', priority: 1, width: '110px', align: 'right',
      render: job => job.finalCost != null ? fmtKes(job.finalCost)
        : job.quotedCost != null ? <span className="text-t3">{fmtKes(job.quotedCost)} est.</span>
        : '—',
      exportValue: job => job.finalCost ?? job.quotedCost ?? '',
    },
    {
      key: 'vendor', label: 'Vendor', priority: 2, width: '140px',
      render: job => <span className="erp-truncate" title={job.vendorName}>{job.vendorName}</span>,
    },
    {
      key: 'sent', label: 'Sent', priority: 2, width: '100px',
      render: job => <span className="whitespace-nowrap">{fmtDate(job.sentDate)}</span>,
      exportValue: job => job.sentDate,
    },
    {
      key: 'service', label: 'Service', priority: 3, width: '120px',
      render: job => <span className="whitespace-nowrap">{svcLabel(job.serviceType)}</span>,
    },
    {
      key: 'by', label: 'By', priority: 3, width: '90px',
      render: job => job.sentByName.split(' ')[0],
      exportValue: job => job.sentByName,
    },
    {
      key: 'returned', label: 'Returned', priority: 3, width: '100px',
      render: job => job.returnedDate ? fmtDate(job.returnedDate) : '—',
      exportValue: job => job.returnedDate ?? '',
    },
  ]

  function jobRowActions(job: OutsourceJob) {
    const bill = job.billId ? invoices.find(i => i.id === job.billId) : null
    return (
      <>
        {job.status === 'sent' && (
          <button
            onClick={e => { e.stopPropagation(); openReturn(job.id) }}
            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-3)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Mark Returned
          </button>
        )}
        {bill && (
          <button
            onClick={e => { e.stopPropagation(); setModule('accounting'); router.push('/finance?tab=bills') }}
            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 7, border: '1px solid #BFDBFE', background: 'var(--info-bg)', color: 'var(--primary-dark)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {bill.ref}
          </button>
        )}
      </>
    )
  }

  function jobCard(job: OutsourceJob) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setActiveJobId(job.id)}
        className="record-card outsource-job-card w-full rounded-xl border bg-card p-3 text-left shadow-card cursor-pointer"
        style={{ borderColor: 'var(--border-lt)', borderLeft: '4px solid var(--navy)' }}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-wider text-primary-600 mb-0.5">{job.ref}</div>
            <div className="outsource-wrap text-sm font-black text-t1">{job.deviceDescription}</div>
            {job.repairOrderId && (() => {
              const linked = repairs.find(r => r.id === job.repairOrderId)
              return linked ? (
                <div className="outsource-wrap text-[11px] font-mono text-primary-600 mt-0.5">{linked.ref} · {linked.customerName}</div>
              ) : null
            })()}
            <div className="outsource-wrap text-[11px] text-t3 mt-0.5">{job.vendorName} · {svcLabel(job.serviceType)}</div>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="font-mono text-xs font-black text-t1">
              {job.finalCost != null ? fmtKes(job.finalCost) : job.quotedCost != null ? `${fmtKes(job.quotedCost)} est.` : '—'}
            </div>
            <div className="mt-1 flex justify-end"><OutsourceStatusBadge status={job.status} /></div>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-border-lt pt-2.5">
          <span className="text-[10px] text-t3">Sent {fmtDate(job.sentDate)}</span>
          {job.returnedDate && <span className="text-[10px] text-t3">· Returned {fmtDate(job.returnedDate)}</span>}
          <span className="ml-auto flex gap-2" onClick={e => e.stopPropagation()}>{jobRowActions(job)}</span>
        </div>
      </div>
    )
  }

  function jobDrawerTabs(job: OutsourceJob): DrawerTab[] {
    const bill = job.billId ? invoices.find(i => i.id === job.billId) : null
    const linkedRepair = job.repairOrderId ? repairs.find(r => r.id === job.repairOrderId) : null
    return [
      {
        id: 'overview',
        label: 'Overview',
        content: (
          <div className="flex flex-col">
            <InfoRow label="Reference" value={job.ref} mono />
            <InfoRow label="Status" value={<OutsourceStatusBadge status={job.status} />} />
            <InfoRow label="Vendor" value={job.vendorName} />
            <InfoRow label="Device" value={job.deviceDescription} />
            {job.serial && <InfoRow label="Serial" value={job.serial} mono />}
            {linkedRepair && <InfoRow label="Linked Repair" value={linkedRepair.ref} mono />}
            <InfoRow label="Service Type" value={svcLabel(job.serviceType)} />
            <InfoRow label="Issue Description" value={job.issueDescription} />
            <InfoRow label="Sent" value={`${fmtDate(job.sentDate)} by ${job.sentByName}`} />
            {job.returnedDate && <InfoRow label="Returned" value={fmtDate(job.returnedDate)} />}
            {job.quotedCost != null && <InfoRow label="Quoted Cost" value={fmtKes(job.quotedCost)} />}
            {job.finalCost != null && <InfoRow label="Final Cost" value={fmtKes(job.finalCost)} />}
            {job.returnNotes && <InfoRow label="Return Notes" value={job.returnNotes} />}
            {job.notes && <InfoRow label="Notes" value={job.notes} />}
            {bill && <InfoRow label="Vendor Bill" value={bill.ref} mono />}
          </div>
        ),
      },
    ]
  }

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page outsource-workspace">
      <ModuleHeader
        title="Outsource repairs"
        subtitle="External repair jobs, vendor performance and costs"
        icon={<Fa icon={faScrewdriverWrench} />}
        count={outsourceJobs.length}
        color="var(--navy)"
        primaryAction={
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openNewJob} hideLabelOnMobile={false}>
            Send for repair
          </PrimaryActionButton>
        }
      />

      <TabBar
        tabs={[
          { id: 'jobs', label: outCount > 0 ? `Jobs (${outCount})` : 'Jobs' },
          { id: 'vendors', label: `Vendors (${outsourceVendors.length})` },
        ]}
        active={tab}
        onChange={id => setTab(id as typeof tab)}
        maxVisibleDesktop={6}
        ariaLabel="Outsource sections"
      />

      <div className="mod-body outsource-body p-3 sm:p-4">
        <section className="outsource-summary" aria-label="Outsource repair summary">
          <button type="button" className="outsource-summary__item" onClick={() => { setTab('jobs'); setJobStatusFilter('sent') }}>
            <span>Out with vendors</span><strong>{outCount}</strong><small>Currently away</small>
          </button>
          <button type="button" className="outsource-summary__item is-warning" onClick={() => { setTab('jobs'); setJobStatusFilter('returned_unresolved') }}>
            <span>Needs follow-up</span><strong>{unresolvedCount}</strong><small>Returned unresolved</small>
          </button>
          <button type="button" className="outsource-summary__item" onClick={() => setTab('jobs')}>
            <span>Returned today</span><strong>{returnedToday}</strong><small>All outcomes</small>
          </button>
          <button type="button" className="outsource-summary__item" onClick={() => setTab('vendors')}>
            <span>Outstanding</span><strong>{fmtKes(vendorOutstanding)}</strong><small>Vendor balances</small>
          </button>
        </section>

      <div className="card overflow-hidden outsource-surface">

        {/* ── Jobs tab ── */}
        {tab === 'jobs' && (
          <div className="outsource-jobs-layout">
            <div className="outsource-directory">
              <DataTable
            tableId="outsource_jobs"
            columns={jobColumns}
            rows={filteredJobs}
            rowKey={job => job.id}
            emptyMessage="No outsource jobs match the filter."
            searchValue={jobSearch}
            onSearchChange={setJobSearch}
            searchPlaceholder="Search OUT ref, device, customer or repair…"
            clientSearch
            page={jobPage}
            onPageChange={setJobPage}
            primaryFilters={[
              {
                key: 'status',
                label: 'Status',
                placeholder: 'All statuses',
                value: jobStatusFilter,
                allValue: 'all',
                options: [
                  { value: 'all', label: 'All statuses' },
                  { value: 'sent', label: 'Out for Repair' },
                  { value: 'returned_resolved', label: 'Returned – Fixed' },
                  { value: 'returned_unresolved', label: 'Not Fixed' },
                ],
                onChange: v => setJobStatusFilter(v as typeof jobStatusFilter),
              },
              {
                key: 'vendor',
                label: 'Vendor',
                placeholder: 'All vendors',
                value: jobVendorFilter,
                allValue: 'all',
                options: [
                  { value: 'all', label: 'All vendors' },
                  ...outsourceVendors.map(v => ({ value: v.id, label: v.name })),
                ],
                onChange: setJobVendorFilter,
              },
            ]}
            onClearFilters={() => patchJobsUi({ q: null, status: null, vendor: null, page: null })}
            hideColumnFilters
            onRowClick={job => setActiveJobId(job.id)}
            rowActions={jobRowActions}
            renderCard={jobCard}
            exportTitle="Outsource Jobs"
            exportFilename="outsource-jobs"
          />
            </div>
            <aside className="outsource-attention" aria-label="Needs attention">
              <div className="outsource-attention__header">
                <div><span>Priority</span><h3>Needs attention</h3></div>
                <strong>{unresolvedCount + outsourceVendors.filter(v => vendorBilled(v.id) > vendorPaid(v.id)).length}</strong>
              </div>
              <div className="outsource-attention__group">
                <p>Returned unresolved</p>
                {outsourceJobs.filter(job => job.status === 'returned_unresolved').slice(0, 4).map(job => (
                  <button
                    key={job.id}
                    type="button"
                    className="outsource-attention__job"
                    onClick={() => setActiveJobId(job.id)}
                  >
                    <span className="outsource-attention__ref">{job.ref}</span>
                    <strong className="outsource-attention__device">{job.deviceDescription}</strong>
                    <small className="outsource-attention__vendor">{job.vendorName}</small>
                  </button>
                ))}
                {unresolvedCount === 0 && <small className="outsource-attention__empty">No unresolved returns.</small>}
              </div>
              <div className="outsource-attention__group">
                <p>Vendor balances</p>
                {outsourceVendors.filter(v => vendorBilled(v.id) > vendorPaid(v.id)).slice(0, 4).map(vendor => (
                  <button
                    key={vendor.id}
                    type="button"
                    className="outsource-attention__balance"
                    onClick={() => setSelectedVendorId(vendor.id)}
                  >
                    <strong className="outsource-attention__vendor-name">{vendor.name}</strong>
                    <span className="outsource-attention__amount">{fmtKes(vendorBilled(vendor.id) - vendorPaid(vendor.id))}</span>
                  </button>
                ))}
                {vendorOutstanding <= 0 && <small className="outsource-attention__empty">No outstanding balances.</small>}
              </div>
            </aside>
          </div>
        )}

        {/* ── Vendors tab ── */}
        {tab === 'vendors' && !selectedVendor && (
          <>
            {isAdmin && (
              <div className="flex justify-end px-4 py-2.5 border-b border-[var(--border-lt)]">
                <button type="button" className="btn-secondary text-[11px]" onClick={openAddVendor}>+ Add Vendor</button>
              </div>
            )}
            {outsourceVendors.length === 0 ? (
              <div className="py-14 text-center text-t3 text-sm">
                <Fa icon={faBuilding} className="text-3xl mb-2" aria-hidden="true" />
                No vendors added yet.
              </div>
            ) : (
              <div className="outsource-vendor-list divide-y" style={{ borderColor: 'var(--bg-surface)' }}>
                {outsourceVendors.map(vendor => {
                  const billed = vendorBilled(vendor.id)
                  const paid   = vendorPaid(vendor.id)
                  const { bal, color } = fmtBalance(billed, paid)
                  const vendorJobs = outsourceJobs.filter(j => j.vendorId === vendor.id)
                  const activeJobs = vendorJobs.filter(j => j.status === 'sent').length
                  const totalJobs  = vendorJobs.length
                  const completedJobs = vendorJobs.filter(j => j.isResolved)
                  const completionRate = totalJobs > 0 ? Math.round((completedJobs.length / totalJobs) * 100) : null
                  const avgTurnaround = completedJobs.length > 0
                    ? Math.round(completedJobs.reduce((s, j) => {
                        const sent = j.sentDate ? new Date(j.sentDate).getTime() : 0
                        const ret  = j.returnedDate ? new Date(j.returnedDate).getTime() : 0
                        return s + (sent && ret ? (ret - sent) / 86400000 : 0)
                      }, 0) / completedJobs.filter(j => j.sentDate && j.returnedDate).length || 0)
                    : null
                  return (
                    <div key={vendor.id} className="outsource-vendor-row flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4 px-4 py-3 hover:bg-gray-50 transition-colors">
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm text-white flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, var(--navy), var(--accent-cyan))' }}>
                        {vendor.name.slice(0, 2).toUpperCase()}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-t1 text-sm">{vendor.name}</p>
                        <p className="text-[11px] text-t3">{vendor.phone}{vendor.email ? ` · ${vendor.email}` : ''}</p>
                        <div className="flex gap-1.5 mt-1 flex-wrap">
                          {vendor.specializations.map(s => (
                            <span key={s} style={{ background: '#E8F3FA', color: 'var(--navy-dark)', borderRadius: 20, fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
                              {svcLabel(s)}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:gap-6 text-left lg:text-right flex-shrink-0 gap-3">
                        <div>
                          <p className="text-[10px] text-t3">Jobs</p>
                          <p className="text-sm font-bold text-t1">{totalJobs}</p>
                          {activeJobs > 0 && <p className="text-[11px]" style={{ color: 'var(--warning)' }}>{activeJobs} active</p>}
                        </div>
                        {completionRate !== null && (
                          <div>
                            <p className="text-[10px] text-t3">Completion</p>
                            <p className="text-sm font-bold" style={{ color: completionRate >= 80 ? 'var(--success)' : completionRate >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{completionRate}%</p>
                          </div>
                        )}
                        {avgTurnaround !== null && !isNaN(avgTurnaround) && avgTurnaround > 0 && (
                          <div>
                            <p className="text-[10px] text-t3">Avg Turn</p>
                            <p className="text-sm font-bold text-t1">{avgTurnaround}d</p>
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] text-t3">Billed</p>
                          <p className="text-sm font-bold text-t1">{fmtKes(billed)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-t3">Paid</p>
                          <p className="text-sm font-bold" style={{ color: 'var(--success)' }}>{fmtKes(paid)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-t3">Balance</p>
                          <p className="text-sm font-bold" style={{ color }}>{fmtKes(bal)}</p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-wrap flex-shrink-0">
                        <button
                          onClick={() => setSelectedVendorId(vendor.id)}
                          style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-lt)', background: 'var(--bg-surface)', color: 'var(--text-3)', cursor: 'pointer' }}>
                          View Details
                        </button>
                        {bal > 0 && (
                          <button
                            onClick={() => openPayVendor(vendor.id)}
                            style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--success)', background: '#ECFDF5', color: 'var(--success-text)', cursor: 'pointer', fontWeight: 600 }}>
                            Pay
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => openEditVendor(vendor)}
                            style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-lt)', background: 'var(--bg-surface)', color: 'var(--text-3)', cursor: 'pointer' }}>
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── Vendor Detail view ── */}
        {tab === 'vendors' && selectedVendor && (() => {
          const billed = vendorBilled(selectedVendor.id)
          const paid   = vendorPaid(selectedVendor.id)
          const { bal, color } = fmtBalance(billed, paid)
          return (
            <>
              {/* Back + header */}
              <div className="outsource-vendor-detail__header flex flex-wrap items-start sm:items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--bg-muted)' }}>
                <button onClick={() => setSelectedVendorId(null)}
                  style={{ fontSize: 11, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  ← Back
                </button>
                <div className="flex-1">
                  <p className="font-bold text-sm text-t1">{selectedVendor.name}</p>
                  <p className="text-[10px] text-t3">{selectedVendor.phone}{selectedVendor.email ? ` · ${selectedVendor.email}` : ''}{selectedVendor.address ? ` · ${selectedVendor.address}` : ''}</p>
                </div>
                <div className="flex flex-wrap gap-4 sm:gap-6 text-left sm:text-right">
                  <div><p className="text-[10px] text-t3">Billed</p><p className="font-bold text-sm">{fmtKes(billed)}</p></div>
                  <div><p className="text-[10px] text-t3">Paid</p><p className="font-bold text-sm" style={{ color: 'var(--success)' }}>{fmtKes(paid)}</p></div>
                  <div><p className="text-[10px] text-t3">Outstanding</p><p className="font-bold text-sm" style={{ color }}>{fmtKes(bal)}</p></div>
                </div>
                {bal > 0 && (
                  <button className="btn-primary text-[11px] px-4 py-2" onClick={() => openPayVendor(selectedVendor.id)}>
                    Record Payment
                  </button>
                )}
              </div>

              <div className="outsource-vendor-detail grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
                {/* Jobs for this vendor */}
                <div className="border-r" style={{ borderColor: 'var(--bg-muted)' }}>
                  <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider px-4 py-2.5 border-b" style={{ borderColor: 'var(--bg-surface)' }}>
                    Jobs ({vendorJobs.length})
                  </p>
                  {vendorJobs.length === 0 ? (
                    <p className="px-4 py-8 text-sm text-t3 text-center">No jobs yet for this vendor.</p>
                  ) : (
                    <div className="divide-y" style={{ borderColor: 'var(--bg-surface)' }}>
                      {vendorJobs.map(job => (
                        <div key={job.id} className="px-4 py-3 hover:bg-gray-50">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{job.ref}</span>
                                <OutsourceStatusBadge status={job.status} />
                              </div>
                              <p className="outsource-wrap font-medium text-t1 text-[12px]">{job.deviceDescription}</p>
                              <p className="text-[11px] text-t3">
                                {svcLabel(job.serviceType)} · Sent {fmtDate(job.sentDate)} by {job.sentByName}
                                {job.repairOrderId && (() => {
                                  const r = repairs.find(x => x.id === job.repairOrderId)
                                  return r ? <span className="font-mono ml-1" style={{ color: 'var(--accent-cyan)' }}>· 🔗 {r.ref}</span> : null
                                })()}
                              </p>
                              <p className="text-[11px] text-t2 mt-0.5 italic">"{job.issueDescription}"</p>
                              {job.returnedDate && (
                                <p className="text-[11px] mt-0.5" style={{ color: job.isResolved ? 'var(--success)' : 'var(--danger)' }}>
                                  Returned {fmtDate(job.returnedDate)} · {job.isResolved ? 'Resolved' : 'Not resolved'}
                                  {job.returnNotes ? ` — ${job.returnNotes}` : ''}
                                </p>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              {job.finalCost != null
                                ? <p className="font-bold text-sm text-t1">{fmtKes(job.finalCost)}</p>
                                : job.quotedCost != null
                                  ? <p className="text-[11px] text-t3">{fmtKes(job.quotedCost)} est.</p>
                                  : null}
                              {job.status === 'sent' && (
                                <button
                                  onClick={() => openReturn(job.id)}
                                  style={{ fontSize: 10, marginTop: 4, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-3)', cursor: 'pointer', display: 'block' }}>
                                  Mark Returned
                                </button>
                              )}
                              {job.billId && (() => {
                                const bill = invoices.find(i => i.id === job.billId)
                                return bill ? (
                                  <button
                                    onClick={() => { setModule('accounting'); router.push('/finance?tab=bills') }}
                                    style={{ fontSize: 10, marginTop: 4, padding: '3px 8px', borderRadius: 6, border: '1px solid #BFDBFE', background: 'var(--info-bg)', color: 'var(--primary-dark)', cursor: 'pointer', display: 'block' }}>
                                    Bill {bill.ref}
                                  </button>
                                ) : null
                              })()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Payment history */}
                <div>
                  <p className="text-[10px] font-semibold text-t3 uppercase tracking-wider px-4 py-2.5 border-b" style={{ borderColor: 'var(--bg-surface)' }}>
                    Payment History ({vendorPaymentHistory.length})
                  </p>
                  {vendorPaymentHistory.length === 0 ? (
                    <p className="px-4 py-8 text-sm text-t3 text-center">No payments recorded.</p>
                  ) : (
                    <div className="divide-y" style={{ borderColor: 'var(--bg-surface)' }}>
                      {vendorPaymentHistory.map(pmt => (
                        <div key={pmt.id} className="px-4 py-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{pmt.ref}</p>
                              <p className="text-[11px] text-t3">{fmtDate(pmt.date)}</p>
                              {pmt.notes && <p className="text-[11px] text-t2 italic mt-0.5">{pmt.notes}</p>}
                              <p className="text-[10px] text-t3 mt-0.5">by {pmt.paidByName}</p>
                            </div>
                            <p className="font-bold text-sm" style={{ color: 'var(--success)' }}>{fmtKes(pmt.amount)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )
        })()}
      </div>

      {/* ── Job Details Drawer ────────────────────────────────────────────── */}
      {activeJob && (
        <DetailsDrawer
          title={activeJob.ref}
          subtitle={activeJob.deviceDescription}
          tabs={jobDrawerTabs(activeJob)}
          onClose={() => setActiveJobId(null)}
          actions={jobRowActions(activeJob)}
        />
      )}

      {/* ── Send for Repair Modal ─────────────────────────────────────────── */}
      {showJobModal && (
        <Modal
          title="Send Device for Outsource Repair"
          subtitle="Link the repair, choose a vendor, and record service instructions."
          width={1100}
          variant="enterprise"
          accent="#2563EB"
          icon={<Fa icon={faScrewdriverWrench} />}
          onClose={() => setShowJobModal(false)}
          footer={(
            <>
              <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => setShowJobModal(false)}>Cancel</button>
              <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={submitJob}>Send for Repair</button>
            </>
          )}
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="min-w-0">
              <SearchPicker
                label="Link to Repair Job (Optional)"
                labelClassName="mb-1.5 block text-[13px] font-semibold text-slate-700"
                inputClassName="h-11 text-sm"
                placeholder="Search assigned repairs (diagnosis required unless Direct)…"
                items={pickableRepairs}
                selectedLabel={jobForm.repairOrderId ? repairSearch : undefined}
                formatSelected={r => `${r.ref} · ${r.productName} (${r.customerName})`}
                onSelect={r => selectRepair(r.id)}
                renderItem={r => (
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        <span className="font-mono text-blue-700">{r.ref}</span>
                        <span className="ml-2">{r.productName}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {r.customerName} · {r.repairPath === 'direct_repair' ? 'Direct Repair' : 'Diagnosis First'} · {r.issueDescription}{r.serialNumber ? ` · SN ${r.serialNumber}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={r.status} label={r.status.replace(/_/g, ' ')} size="xs" />
                  </div>
                )}
              />
              <p className="mt-1.5 text-[11px] text-slate-500">
                Diagnosis First repairs need an assigned tech and logged diagnosis. Direct Repair needs assignment only.
              </p>
              {jobForm.repairOrderId && (
                <button type="button" className="mt-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900" onClick={clearRepairLink}>
                  Clear repair selection
                </button>
              )}
            </div>

            <div className="min-w-0">
              <SearchPicker
                label="Vendor *"
                labelClassName="mb-1.5 block text-[13px] font-semibold text-slate-700"
                inputClassName="h-11 text-sm"
                placeholder="Search by vendor name, phone or specialty…"
                items={outsourceVendors}
                selectedLabel={jobForm.vendorId ? vendorSearch : undefined}
                formatSelected={v => v.name}
                onSelect={v => {
                  setJobForm(f => ({ ...f, vendorId: v.id }))
                  setVendorSearch(v.name)
                }}
                onCreateNew={openVendorFromJob}
                createNewLabels={{ title: 'Create vendor', subtitle: 'Add this vendor without losing the repair form' }}
                renderItem={v => (
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{v.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {v.phone}{v.email ? ` · ${v.email}` : ''}
                      {v.specializations.length ? ` · ${v.specializations.map(s => svcLabel(s)).join(', ')}` : ''}
                    </p>
                  </div>
                )}
              />
              {jobForm.vendorId && (
                <button
                  type="button"
                  className="mt-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900"
                  onClick={() => { setJobForm(f => ({ ...f, vendorId: '' })); setVendorSearch('') }}
                >
                  Clear vendor selection
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="outsource-device-description" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Device Description *</label>
            <input id="outsource-device-description" className="form-input h-11 w-full text-sm" placeholder="e.g. Dell Latitude 7430 – customer John Doe"
              value={jobForm.deviceDescription}
              onChange={e => setJobForm(f => ({ ...f, deviceDescription: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="outsource-serial" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Serial / IMEI</label>
              <input id="outsource-serial" className="form-input h-11 w-full text-sm" placeholder="e.g. A1B2C3"
                value={jobForm.serial}
                onChange={e => setJobForm(f => ({ ...f, serial: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="outsource-service-type" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Service Type *</label>
              <select id="outsource-service-type" className="form-input h-11 w-full text-sm" value={jobForm.serviceType}
                onChange={e => setJobForm(f => ({ ...f, serviceType: e.target.value as OutsourceServiceType | '' }))}>
                <option value="">Select…</option>
                {OUTSOURCE_SERVICE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="outsource-issue" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Issue / What to do *</label>
            <textarea id="outsource-issue" className="form-input min-h-[84px] w-full resize-y py-3 text-sm" rows={3}
              placeholder="Describe the fault and what you need the vendor to do…"
              value={jobForm.issueDescription}
              onChange={e => setJobForm(f => ({ ...f, issueDescription: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="outsource-date-sent" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Date Sent *</label>
              <input id="outsource-date-sent" type="date" className="form-input h-11 w-full text-sm" value={jobForm.sentDate}
                onChange={e => setJobForm(f => ({ ...f, sentDate: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="outsource-quoted-cost" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Quoted Cost (KSh)</label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-slate-500">KSh</span>
                <input id="outsource-quoted-cost" type="number" inputMode="decimal" className="form-input h-11 w-full pl-12 text-sm" placeholder="0"
                  value={jobForm.quotedCost}
                  onChange={e => setJobForm(f => ({ ...f, quotedCost: e.target.value }))} />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="outsource-notes" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Notes (optional)</label>
            <textarea id="outsource-notes" className="form-input min-h-[76px] w-full resize-y py-3 text-sm" rows={2}
              placeholder="Any additional notes…"
              value={jobForm.notes}
              onChange={e => setJobForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </Modal>
      )}

      {/* ── Mark Returned Modal ───────────────────────────────────────────── */}
      {returnJobId && (() => {
        const job = outsourceJobs.find(j => j.id === returnJobId)
        if (!job) return null
        return (
          <Modal
            title="Mark Device Returned"
            subtitle={`${job.ref} · ${job.deviceDescription}`}
            width={900}
            variant="enterprise"
            accent="#16A34A"
            icon={<Fa icon={faCircleCheck} />}
            onClose={() => setReturnJobId(null)}
            footer={(
              <>
                <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => setReturnJobId(null)}>Cancel</button>
                <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={submitReturn}>Confirm Return</button>
              </>
            )}
          >
            <div>
              <label htmlFor="outsource-return-date" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Return Date *</label>
              <input id="outsource-return-date" type="date" className="form-input h-11 w-full text-sm" value={returnForm.returnedDate}
                onChange={e => setReturnForm(f => ({ ...f, returnedDate: e.target.value }))} />
            </div>

            <fieldset>
              <legend className="mb-2 block text-[13px] font-semibold text-slate-700">Was the issue resolved? *</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { v: true, label: 'Yes – Fixed', icon: '✓', activeClass: 'border-emerald-400 bg-emerald-50 text-emerald-700' },
                  { v: false, label: 'No – Not Fixed', icon: '×', activeClass: 'border-red-400 bg-red-50 text-red-700' },
                ].map(opt => {
                  const selected = returnForm.isResolved === opt.v
                  return (
                    <button
                      key={String(opt.v)}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setReturnForm(f => ({ ...f, isResolved: opt.v, repairNextStep: '' }))}
                      className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                        selected ? opt.activeClass : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <span aria-hidden="true" className="text-base">{opt.icon}</span>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {returnForm.isResolved === false && job.repairOrderId && (() => {
              const linkedRepair = repairs.find(r => r.id === job.repairOrderId)
              if (!linkedRepair) return null
              return (
                <fieldset className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
                  <legend className="px-1 text-[13px] font-semibold text-amber-900">
                    What should happen to repair <span className="font-mono">{linkedRepair.ref}</span>? *
                  </legend>
                  <div className="mt-2 flex flex-col gap-2">
                    {([
                      { v: 'keep', label: 'Keep current status — decide later', sub: `Stay as "${linkedRepair.status.replace(/_/g, ' ')}"` },
                      { v: 'in_repair', label: 'Resume in-house repair', sub: 'Move back to In Repair so tech can continue' },
                      { v: 'unrepairable', label: 'Mark as unrepairable', sub: 'Device cannot be fixed — inform the customer' },
                    ] as { v: 'keep' | 'in_repair' | 'unrepairable'; label: string; sub: string }[]).map(opt => {
                      const active = returnForm.repairNextStep === opt.v
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setReturnForm(f => ({ ...f, repairNextStep: opt.v }))}
                          className={`rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                            active
                              ? 'border-[var(--navy)] bg-[var(--navy)] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <p className="text-[12px] font-semibold m-0">{opt.label}</p>
                          <p className={`text-[11px] m-0 mt-0.5 ${active ? 'text-white/75' : 'text-slate-500'}`}>{opt.sub}</p>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              )
            })()}

            <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div>
                <label htmlFor="outsource-final-cost" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Final Cost (KSh)</label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-slate-500">KSh</span>
                  <input id="outsource-final-cost" type="number" inputMode="decimal" className="form-input h-11 w-full pl-12 text-sm"
                    placeholder={job.quotedCost ? String(job.quotedCost) : '0'}
                    value={returnForm.finalCost}
                    onChange={e => setReturnForm(f => ({ ...f, finalCost: e.target.value }))} />
                </div>
                {job.quotedCost && <p className="mt-1 text-xs text-slate-500">Quoted: {fmtKes(job.quotedCost)}</p>}
              </div>
              <div>
                <label htmlFor="outsource-return-notes" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Return Notes</label>
                <textarea id="outsource-return-notes" className="form-input min-h-[76px] w-full resize-y py-3 text-sm" rows={2}
                  placeholder="What was done / why not fixed"
                  value={returnForm.returnNotes}
                  onChange={e => setReturnForm(f => ({ ...f, returnNotes: e.target.value }))} />
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* ── Add / Edit Vendor Modal ───────────────────────────────────────── */}
      {showVendorModal && (
        <div className="modal-overlay" style={{ zIndex: 9050 }} onClick={() => { setShowVendorModal(false); setVendorModalFromJob(false) }}>
          <div className="modal-box w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-t1">{editVendorId ? 'Edit Vendor' : 'Add Vendor'}</h3>
                {vendorModalFromJob && <p className="text-[10px] text-t3 mt-0.5">← Will return to Send for Repair after saving</p>}
              </div>
              <button onClick={() => { setShowVendorModal(false); setVendorModalFromJob(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Vendor Name *</label>
                  <input className="form-input w-full text-[12px]" placeholder="e.g. TechFix Solutions"
                    value={vendorForm.name} onChange={e => setVendorForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Phone *</label>
                  <input className="form-input w-full text-[12px]" type="tel" placeholder="07xxxxxxxx"
                    value={vendorForm.phone} onChange={e => setVendorForm(f => ({ ...f, phone: e.target.value }))} maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Email</label>
                  <input className="form-input w-full text-[12px]" type="email" placeholder="optional"
                    value={vendorForm.email} onChange={e => setVendorForm(f => ({ ...f, email: e.target.value }))} maxLength={100} />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Address</label>
                  <input className="form-input w-full text-[12px]" placeholder="e.g. Kirinyaga Rd, Nairobi"
                    value={vendorForm.address} onChange={e => setVendorForm(f => ({ ...f, address: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-2">Specialisations</label>
                <div className="flex flex-wrap gap-1.5">
                  {OUTSOURCE_SERVICE_TYPES.map(s => {
                    const active = vendorForm.specializations.includes(s.value)
                    return (
                      <button key={s.value} onClick={() => toggleSpec(s.value)}
                        style={{
                          fontSize: 10, padding: '3px 10px', borderRadius: 20, border: '1px solid', cursor: 'pointer',
                          background:  active ? 'var(--navy)' : 'var(--bg-surface)',
                          color:       active ? '#fff'    : 'var(--text-4)',
                          borderColor: active ? 'var(--navy)' : 'var(--border-lt)',
                          fontWeight:  active ? 600 : 400,
                        }}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Notes</label>
                <textarea className="form-input w-full text-[12px]" rows={2} placeholder="e.g. Reliable, 2–3 day turnaround"
                  value={vendorForm.notes} onChange={e => setVendorForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => { setShowVendorModal(false); setVendorModalFromJob(false) }}>Cancel</button>
              <button className="btn-primary text-[11px] py-2 px-4" onClick={submitVendor}>
                {editVendorId ? 'Save Changes' : vendorModalFromJob ? 'Save & Select Vendor' : 'Add Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Record Payment Modal ──────────────────────────────────────────── */}
      {payVendorId && (() => {
        const vendor = outsourceVendors.find(v => v.id === payVendorId)!
        const billed = vendorBilled(payVendorId)
        const paid   = vendorPaid(payVendorId)
        const bal    = billed - paid
        return (
          <div className="modal-overlay" onClick={() => setPayVendorId(null)}>
            <div className="modal-box w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-t1">Record Payment</h3>
                  <p className="text-[11px] text-t3">{vendor.name}</p>
                </div>
                <button onClick={() => setPayVendorId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
              </div>

              {/* Balance summary */}
              <div className="rounded-xl p-3 mb-4" style={{ background: '#FEF9C3', border: '1px solid #FDE68A' }}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-t2">Total Billed</span><span className="font-semibold">{fmtKes(billed)}</span>
                </div>
                <div className="flex justify-between text-[11px] mt-1">
                  <span className="text-t2">Total Paid</span><span className="font-semibold text-green-700">{fmtKes(paid)}</span>
                </div>
                <div className="flex justify-between text-[11px] mt-1 pt-1 border-t border-yellow-300">
                  <span className="font-bold text-t1">Outstanding Balance</span>
                  <span className="font-bold text-red-700">{fmtKes(bal)}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Amount to Pay (KSh) *</label>
                  <input type="number" className="form-input w-full text-[12px]" placeholder={`Max ${fmtKes(bal)}`}
                    value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                  <div className="flex gap-2 mt-1.5">
                    {[bal * 0.25, bal * 0.5, bal].map(amt => (
                      <button key={amt} onClick={() => setPayAmount(String(Math.round(amt)))}
                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border-lt)', background: 'var(--bg-surface)', color: 'var(--text-3)', cursor: 'pointer' }}>
                      {amt === bal ? 'Full' : `${Math.round((amt / bal) * 100)}%`}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Bank Account</label>
                <select aria-label="Payment bank account" className="form-input w-full text-[12px]" value={payBankAccountId} onChange={e => setPayBankAccountId(e.target.value)}>
                  <option value="">— Select Bank Account —</option>
                  {bankAccounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Payment Method *</label>
                <select aria-label="Payment method" className="form-input w-full text-[12px]" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              {payMethod === 'cheque' && (
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Cheque Number</label>
                  <input className="form-input w-full text-[12px]" placeholder="e.g. 000123" value={payReference} onChange={e => setPayReference(e.target.value)} />
                </div>
              )}
              {payMethod && payMethod !== 'cheque' && payMethod !== 'cash' && (
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Transaction Reference (optional)</label>
                  <input className="form-input w-full text-[12px]" placeholder="e.g. Bank/M-Pesa Ref" value={payReference} onChange={e => setPayReference(e.target.value)} />
                </div>
              )}
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Payment Date *</label>
                  <input type="date" aria-label="Payment date" className="form-input w-full text-[12px]" value={payDate}
                    onChange={e => setPayDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Notes (optional)</label>
                  <input className="form-input w-full text-[12px]" placeholder="e.g. M-Pesa ref 123ABC"
                    value={payNotes} onChange={e => setPayNotes(e.target.value)} />
                </div>
              </div>

              <div className="flex gap-2 mt-4 justify-end">
                <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setPayVendorId(null)}>Cancel</button>
                <button className="btn-primary text-[11px] py-2 px-4" style={{ background: 'var(--success)' }} onClick={submitPayment}>
                  Record Payment
                </button>
              </div>
            </div>
          </div>
        )
      })()}
      </div>{/* mod-body */}
    </div>
  )
}
