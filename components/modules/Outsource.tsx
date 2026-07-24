'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useFinanceStore, fmtDate, fmtKes, OutsourceVendor, OutsourceJob, OUTSOURCE_SERVICE_TYPES, OutsourceServiceType } from '@/lib/store'
import { ModuleSkeleton, useMounted, InfoRow } from '@/components/ui'
import { DataTable, DetailsDrawer, type ColumnDef, type DrawerTab } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faScrewdriverWrench, faClipboardList, faBuilding, faCreditCard } from '@fortawesome/free-solid-svg-icons'

// ── Helpers ──────────────────────────────────────────────────────────────────

const svcLabel = (v: OutsourceServiceType) =>
  OUTSOURCE_SERVICE_TYPES.find(s => s.value === v)?.label ?? v

const STATUS_META: Record<OutsourceJob['status'], { label: string; bg: string; text: string }> = {
  sent:                { label: 'Out for Repair', bg: '#FEF9C3', text: '#854D0E' },
  returned_resolved:   { label: 'Returned – Fixed', bg: 'var(--success-bg)', text: 'var(--success-text)' },
  returned_unresolved: { label: 'Returned – Not Fixed', bg: 'var(--danger-bg)', text: '#991B1B' },
}

function StatusBadge({ status }: { status: OutsourceJob['status'] }) {
  const m = STATUS_META[status]
  return (
    <span style={{ background: m.bg, color: m.text, borderRadius: 20, fontSize: 10, padding: '2px 9px', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  )
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
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
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
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
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
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlTab = searchParams.get('tab') as 'jobs' | 'vendors' | null
    if (urlTab && urlTab !== tab) setLocalTab(urlTab)

    const urlVendorId = searchParams.get('vendorId')
    if (urlVendorId !== selectedVendorId) setLocalSelectedVendorId(urlVendorId)

    const urlId = searchParams.get('id')
    if (urlId !== activeJobId) setLocalActiveJobId(urlId)
  }, [searchParams, tab, selectedVendorId, activeJobId])

  const [jobStatusFilter, setJobStatusFilter] = useState<OutsourceJob['status'] | 'all'>('all')
  const [jobVendorFilter, setJobVendorFilter] = useState<string>('all')

  // ── Job modal ──
  const [showJobModal, setShowJobModal] = useState(false)
  const [jobForm, setJobForm] = useState({
    vendorId: '',
    repairOrderId: '',        // linked repair order (optional)
    deviceDescription: '',
    serial: '',
    serviceType: 'bios_repair' as OutsourceServiceType,
    issueDescription: '',
    sentDate: new Date().toISOString().slice(0, 10),
    quotedCost: '',
    notes: '',
  })
  const [repairSearch, setRepairSearch] = useState('')
  const [showRepairPicker, setShowRepairPicker] = useState(false)

  // Vendor search within job modal
  const [vendorSearch, setVendorSearch] = useState('')
  const [showVendorPicker, setShowVendorPicker] = useState(false)
  const [vendorModalFromJob, setVendorModalFromJob] = useState(false)

  // Only open / in-progress repairs are sensible to send out
  const pickableRepairs = repairs.filter(r =>
    !['delivered', 'cancelled'].includes(r.status)
  )
  const repairSearchResults = repairSearch.trim()
    ? pickableRepairs.filter(r =>
        r.ref.toLowerCase().includes(repairSearch.toLowerCase()) ||
        r.customerName.toLowerCase().includes(repairSearch.toLowerCase()) ||
        r.productName.toLowerCase().includes(repairSearch.toLowerCase()) ||
        (r.serialNumber ?? '').toLowerCase().includes(repairSearch.toLowerCase())
      )
    : pickableRepairs.slice(0, 8)

  function selectRepair(repairId: string) {
    const r = repairs.find(x => x.id === repairId)
    if (!r) return
    setJobForm(f => ({
      ...f,
      repairOrderId:     r.id,
      deviceDescription: `${r.productName}${r.serialNumber ? ` – SN ${r.serialNumber}` : ''} (${r.customerName})`,
      serial:            r.serialNumber ?? '',
      issueDescription:  r.issueDescription,
    }))
    setRepairSearch(`${r.ref} · ${r.productName} (${r.customerName})`)
    setShowRepairPicker(false)
  }

  function clearRepairLink() {
    setJobForm(f => ({ ...f, repairOrderId: '', deviceDescription: '', serial: '', issueDescription: '' }))
    setRepairSearch('')
  }

  const vendorSearchResults = vendorSearch.trim()
    ? outsourceVendors.filter(v =>
        v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
        v.phone.includes(vendorSearch)
      )
    : outsourceVendors

  function openVendorFromJob() {
    setVendorModalFromJob(true)
    setEditVendorId(null)
    setVendorForm({ name: vendorSearch.trim(), phone: '', email: '', address: '', specializations: [], notes: '' })
    setShowVendorPicker(false)
    setShowVendorModal(true)
  }

  // ── Return modal ──
  const [returnJobId, setReturnJobId] = useState<string | null>(null)
  const [returnForm, setReturnForm] = useState({
    returnedDate: new Date().toISOString().slice(0, 10),
    isResolved: true,
    returnNotes: '',
    finalCost: '',
    repairNextStep: 'keep' as 'keep' | 'in_repair' | 'unrepairable',
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
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payNotes, setPayNotes] = useState('')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [payMethod, setPayMethod] = useState('bank')
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

  const activeJob = activeJobId ? outsourceJobs.find(j => j.id === activeJobId) ?? null : null

  const selectedVendor = selectedVendorId ? outsourceVendors.find(v => v.id === selectedVendorId) ?? null : null
  const vendorJobs = selectedVendor ? outsourceJobs.filter(j => j.vendorId === selectedVendor.id) : []
  const vendorPaymentHistory = selectedVendor ? outsourcePayments.filter(p => p.vendorId === selectedVendor.id) : []

  // ── Counts for tab badge ──
  const outCount = outsourceJobs.filter(j => j.status === 'sent').length

  // ── Handlers ─────────────────────────────────────────────────────────────

  function openNewJob() {
    setJobForm({ vendorId: '', repairOrderId: '', deviceDescription: '', serial: '', serviceType: 'bios_repair', issueDescription: '', sentDate: new Date().toISOString().slice(0, 10), quotedCost: '', notes: '' })
    setRepairSearch('')
    setShowRepairPicker(false)
    setVendorSearch('')
    setShowVendorPicker(false)
    setShowJobModal(true)
  }

  function submitJob() {
    if (!jobForm.vendorId) { showToast('Select a vendor', 'error'); return }
    if (!jobForm.deviceDescription.trim()) { showToast('Enter device description', 'error'); return }
    if (!jobForm.issueDescription.trim()) { showToast('Describe the issue', 'error'); return }
    const vendor = outsourceVendors.find(v => v.id === jobForm.vendorId)!
    addOutsourceJob({
      vendorId: jobForm.vendorId,
      vendorName: vendor.name,
      repairOrderId: jobForm.repairOrderId || undefined,
      deviceDescription: jobForm.deviceDescription.trim(),
      serial: jobForm.serial.trim() || undefined,
      serviceType: jobForm.serviceType,
      issueDescription: jobForm.issueDescription.trim(),
      sentDate: jobForm.sentDate,
      quotedCost: jobForm.quotedCost ? Number(jobForm.quotedCost) : undefined,
      notes: jobForm.notes.trim() || undefined,
    })
    setShowJobModal(false)
  }

  function openReturn(jobId: string) {
    setReturnJobId(jobId)
    setReturnForm({ returnedDate: new Date().toISOString().slice(0, 10), isResolved: true, returnNotes: '', finalCost: '', repairNextStep: 'keep' })
  }

  function submitReturn() {
    if (!returnJobId) return
    returnOutsourceJob(returnJobId, {
      returnedDate: returnForm.returnedDate,
      isResolved: returnForm.isResolved,
      returnNotes: returnForm.returnNotes.trim() || undefined,
      finalCost: returnForm.finalCost ? Number(returnForm.finalCost) : undefined,
      repairNextStep: returnForm.repairNextStep,
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
    setPayDate(new Date().toISOString().slice(0, 10))
    setPayNotes('')
    setPayBankAccountId('')
    setPayReference('')
  }

  function submitPayment() {
    if (!payVendorId) return
    const amt = Number(payAmount)
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'error'); return }
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
      key: 'device', label: 'Device', priority: 1, width: '1.6fr',
      render: job => (
        <div style={{ maxWidth: 220 }}>
          <p className="font-medium text-t1 truncate">{job.deviceDescription}</p>
          {job.serial && <p className="text-[10px] text-t3">SN: {job.serial}</p>}
          {job.repairOrderId && (() => {
            const r = repairs.find(x => x.id === job.repairOrderId)
            return r ? <p className="text-[10px] font-mono" style={{ color: 'var(--accent-cyan)' }}>🔗 {r.ref}</p> : null
          })()}
        </div>
      ),
      exportValue: job => job.deviceDescription,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '130px',
      render: job => <StatusBadge status={job.status} />,
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
      render: job => job.vendorName,
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
            style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-3)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Mark Returned
          </button>
        )}
        {bill && (
          <button
            onClick={e => { e.stopPropagation(); setModule('accounting'); router.push('/finance?tab=bills') }}
            style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid #BFDBFE', background: 'var(--info-bg)', color: 'var(--primary-dark)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
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
        className="record-card w-full rounded-xl border bg-card p-3 text-left shadow-card cursor-pointer"
        style={{ borderColor: 'var(--border-lt)', borderLeft: '4px solid var(--navy)' }}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-wider text-primary-600 mb-0.5">{job.ref}</div>
            <div className="text-sm font-black text-t1 truncate">{job.deviceDescription}</div>
            <div className="text-[11px] text-t3 mt-0.5 truncate">{job.vendorName} · {svcLabel(job.serviceType)}</div>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="font-mono text-xs font-black text-t1">
              {job.finalCost != null ? fmtKes(job.finalCost) : job.quotedCost != null ? `${fmtKes(job.quotedCost)} est.` : '—'}
            </div>
            <div className="mt-1 flex justify-end"><StatusBadge status={job.status} /></div>
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
            <InfoRow label="Status" value={<StatusBadge status={job.status} />} />
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
    <div className="mod-page">

      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ background: '#D9770618', color: 'var(--warning)' }}>
            <Fa icon={faScrewdriverWrench} style={{ fontSize: 14 }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-extrabold text-text-1">Outsource Repairs</h1>
              <span className="badge badge-gray text-[9px]">{outsourceJobs.length}</span>
            </div>
            <p className="text-[10px] text-text-3 mt-0.5">Devices sent to external vendors</p>
          </div>
        </div>
        <button type="button" className="btn-primary text-[11px]" onClick={openNewJob}>+ Send for Repair</button>
      </div>

      {/* KPI strip removed — outsource workload lives on the central dashboard */}

      <div className="mod-tabs">
        <button className={`mod-tab ${tab === 'jobs' ? 'active' : ''}`} onClick={() => setTab('jobs')}>
          Jobs{outCount > 0 && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>{outCount}</span>}
        </button>
        <button className={`mod-tab ${tab === 'vendors' ? 'active' : ''}`} onClick={() => setTab('vendors')}>
          Vendors ({outsourceVendors.length})
        </button>
      </div>

      <div className="mod-body p-3 sm:p-4">
      <div className="card overflow-hidden">

        {/* ── Jobs tab ── */}
        {tab === 'jobs' && (
          <>
            {/* Filter row */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--bg-surface)' }}>
              <span className="text-[11px] sm:text-[10px] text-t3 font-semibold">Status:</span>
              {([
                { value: 'all', label: 'All' },
                { value: 'sent', label: 'Out for Repair' },
                { value: 'returned_resolved', label: 'Returned – Fixed' },
                { value: 'returned_unresolved', label: 'Not Fixed' },
              ] as { value: typeof jobStatusFilter; label: string }[]).map(f => (
                <button key={f.value} onClick={() => setJobStatusFilter(f.value)}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid',
                    cursor: 'pointer',
                    background:  jobStatusFilter === f.value ? 'var(--navy)' : 'var(--bg-surface)',
                    color:       jobStatusFilter === f.value ? '#fff'    : 'var(--text-4)',
                    borderColor: jobStatusFilter === f.value ? 'var(--navy)' : 'var(--border-lt)',
                    fontWeight:  jobStatusFilter === f.value ? 600 : 400,
                  }}>
                  {f.label}
                </button>
              ))}
              <span className="text-[11px] sm:text-[10px] text-t3 ml-0 sm:ml-2 font-semibold">Vendor:</span>
              <select
                className="form-input text-sm sm:text-[11px] py-1 w-full sm:w-auto"
                value={jobVendorFilter}
                onChange={e => setJobVendorFilter(e.target.value)}
                style={{ minWidth: 140 }}>
                <option value="all">All Vendors</option>
                {outsourceVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>

            <DataTable
              tableId="outsource_jobs"
              columns={jobColumns}
              rows={filteredJobs}
              rowKey={job => job.id}
              emptyMessage="No outsource jobs match the filter."
              searchPlaceholder="Search ref, device, vendor…"
              onRowClick={job => setActiveJobId(job.id)}
              rowActions={jobRowActions}
              renderCard={jobCard}
              exportTitle="Outsource Jobs"
              exportFilename="outsource-jobs"
            />
          </>
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
              <div className="divide-y" style={{ borderColor: 'var(--bg-surface)' }}>
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
                    <div key={vendor.id} className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4 px-4 py-3 hover:bg-gray-50 transition-colors">
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
                            <span key={s} style={{ background: '#E8F3FA', color: 'var(--navy-dark)', borderRadius: 20, fontSize: 9, padding: '1px 7px', fontWeight: 600 }}>
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
                          {activeJobs > 0 && <p className="text-[9px]" style={{ color: 'var(--warning)' }}>{activeJobs} active</p>}
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
              <div className="flex flex-wrap items-start sm:items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--bg-muted)' }}>
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

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
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
                                <StatusBadge status={job.status} />
                              </div>
                              <p className="font-medium text-t1 text-[12px] truncate">{job.deviceDescription}</p>
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
        />
      )}

      {/* ── Send for Repair Modal ─────────────────────────────────────────── */}
      {showJobModal && (
        <div className="modal-overlay" onClick={() => setShowJobModal(false)}>
          <div className="modal-box w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-t1">Send Device for Outsource Repair</h3>
              <button onClick={() => setShowJobModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
            </div>

            <div className="space-y-3">

              {/* ── Repair picker ── */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">
                  Link to Repair Job
                  <span className="font-normal text-t3 ml-1">(search by ref, customer, device or serial)</span>
                </label>
                <div className="relative">
                  <div className="flex gap-1.5">
                    <input
                      className="form-input flex-1 text-[12px]"
                      placeholder="e.g. REP/0001 or customer name or Dell Latitude…"
                      value={repairSearch}
                      onChange={e => { setRepairSearch(e.target.value); setShowRepairPicker(true) }}
                      onFocus={() => setShowRepairPicker(true)}
                      readOnly={!!jobForm.repairOrderId}
                    />
                    {jobForm.repairOrderId && (
                      <button onClick={clearRepairLink}
                        style={{ fontSize: 11, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-lt)', background: 'var(--danger-bg)', color: '#991B1B', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Dropdown results */}
                  {showRepairPicker && !jobForm.repairOrderId && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9300, background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 220, overflowY: 'auto', marginTop: 2 }}>
                      {repairSearchResults.length === 0 ? (
                        <p className="px-3 py-3 text-[11px] text-t3">No matching repairs found.</p>
                      ) : (
                        repairSearchResults.map(r => (
                          <button key={r.id}
                            onClick={() => selectRepair(r.id)}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', borderBottom: '1px solid var(--bg-surface)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#F5F3FF')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{r.ref}</span>
                                <span className="text-[11px] text-t1 ml-2">{r.productName}</span>
                                {r.serialNumber && <span className="text-[10px] text-t3 ml-1">SN {r.serialNumber}</span>}
                                <div className="text-[10px] text-t3 truncate">{r.customerName} · {r.issueDescription}</div>
                              </div>
                              <span style={{
                                fontSize: 9, padding: '1px 7px', borderRadius: 20, fontWeight: 600, whiteSpace: 'nowrap',
                                background: r.status === 'received' ? 'var(--success-bg)' : r.status === 'in_repair' ? 'var(--primary-light)' : 'var(--bg-muted)',
                                color: r.status === 'received' ? 'var(--success-text)' : r.status === 'in_repair' ? 'var(--primary-dark)' : 'var(--text-4)',
                              }}>
                                {r.status.replace('_', ' ')}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Linked repair chip */}
                {jobForm.repairOrderId && (() => {
                  const r = repairs.find(x => x.id === jobForm.repairOrderId)!
                  return (
                    <div className="mt-1.5 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]"
                      style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', color: '#0D1A4A' }}>
                      🔗 Linked to <strong className="mx-1">{r.ref}</strong> · {r.productName} · {r.customerName}
                    </div>
                  )
                })()}
              </div>

              {/* ── Vendor search + inline create ── */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Vendor *</label>
                <div className="relative">
                  <div className="flex gap-1.5">
                    <input
                      className="form-input flex-1 text-[12px]"
                      placeholder="Search by vendor name or phone…"
                      value={vendorSearch}
                      readOnly={!!jobForm.vendorId}
                      onChange={e => {
                        setVendorSearch(e.target.value)
                        setJobForm(f => ({ ...f, vendorId: '' }))
                        setShowVendorPicker(true)
                      }}
                      onFocus={() => { if (!jobForm.vendorId) setShowVendorPicker(true) }}
                    />
                    {jobForm.vendorId && (
                      <button
                        onClick={() => { setJobForm(f => ({ ...f, vendorId: '' })); setVendorSearch(''); setShowVendorPicker(false) }}
                        style={{ fontSize: 11, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-lt)', background: 'var(--danger-bg)', color: '#991B1B', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Clear
                      </button>
                    )}
                  </div>

                  {showVendorPicker && !jobForm.vendorId && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9300, background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 220, overflowY: 'auto', marginTop: 2 }}>
                      {vendorSearchResults.length === 0 && (
                        <p className="px-3 py-3 text-[11px] text-t3">No vendors match "{vendorSearch}"</p>
                      )}
                      {vendorSearchResults.map(v => (
                        <button key={v.id}
                          onClick={() => { setJobForm(f => ({ ...f, vendorId: v.id })); setVendorSearch(v.name); setShowVendorPicker(false) }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', borderBottom: '1px solid var(--bg-surface)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#F0F9FF')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <div className="font-medium text-[12px] text-t1">{v.name}</div>
                          <div className="text-[10px] text-t3">{v.phone}{v.email ? ` · ${v.email}` : ''}{v.specializations.length ? ` · ${v.specializations.map(s => svcLabel(s)).join(', ')}` : ''}</div>
                        </button>
                      ))}
                      <button
                        onClick={openVendorFromJob}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'var(--success-bg)', cursor: 'pointer', borderTop: '1px solid var(--border-lt)', color: 'var(--success-text)', fontSize: 11, fontWeight: 700 }}>
                        + Create new vendor{vendorSearch.trim() ? `: "${vendorSearch.trim()}"` : ''}
                      </button>
                    </div>
                  )}
                </div>

                {/* Selected vendor chip */}
                {jobForm.vendorId && (() => {
                  const v = outsourceVendors.find(x => x.id === jobForm.vendorId)!
                  return (
                    <div className="mt-1.5 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]"
                      style={{ background: 'var(--success-bg)', border: '1px solid #BBF7D0', color: 'var(--success-text)' }}>
                      🏭 <strong className="mx-1">{v.name}</strong> · {v.phone}
                    </div>
                  )
                })()}

              </div>

              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Device Description *</label>
                <input className="form-input w-full text-[12px]" placeholder="e.g. Dell Latitude 7490 – customer John Doe"
                  value={jobForm.deviceDescription}
                  onChange={e => setJobForm(f => ({ ...f, deviceDescription: e.target.value }))} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Serial / IMEI</label>
                  <input className="form-input w-full text-[12px]" placeholder="e.g. A1B2C3"
                    value={jobForm.serial}
                    onChange={e => setJobForm(f => ({ ...f, serial: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Service Type *</label>
                  <select className="form-input w-full text-[12px]" value={jobForm.serviceType}
                    onChange={e => setJobForm(f => ({ ...f, serviceType: e.target.value as OutsourceServiceType }))}>
                    {OUTSOURCE_SERVICE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Issue / What to do *</label>
                <textarea className="form-input w-full text-[12px]" rows={2}
                  placeholder="Describe the fault and what you need the vendor to do..."
                  value={jobForm.issueDescription}
                  onChange={e => setJobForm(f => ({ ...f, issueDescription: e.target.value }))} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Date Sent *</label>
                  <input type="date" className="form-input w-full text-[12px]" value={jobForm.sentDate}
                    onChange={e => setJobForm(f => ({ ...f, sentDate: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Quoted Cost (KSh)</label>
                  <input type="number" className="form-input w-full text-[12px]" placeholder="0"
                    value={jobForm.quotedCost}
                    onChange={e => setJobForm(f => ({ ...f, quotedCost: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Notes (optional)</label>
                <textarea className="form-input w-full text-[12px]" rows={1}
                  placeholder="Any additional notes..."
                  value={jobForm.notes}
                  onChange={e => setJobForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setShowJobModal(false)}>Cancel</button>
              <button className="btn-primary text-[11px] py-2 px-4" onClick={submitJob}>Send for Repair</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark Returned Modal ───────────────────────────────────────────── */}
      {returnJobId && (() => {
        const job = outsourceJobs.find(j => j.id === returnJobId)
        if (!job) return null
        return (
          <div className="modal-overlay" onClick={() => setReturnJobId(null)}>
            <div className="modal-box w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-t1">Mark Device Returned</h3>
                  <p className="text-[11px] text-t3">{job.ref} · {job.deviceDescription}</p>
                </div>
                <button onClick={() => setReturnJobId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Return Date *</label>
                  <input type="date" className="form-input w-full text-[12px]" value={returnForm.returnedDate}
                    onChange={e => setReturnForm(f => ({ ...f, returnedDate: e.target.value }))} />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-2">Was the issue resolved?</label>
                  <div className="flex gap-2">
                    {[{ v: true, label: '✓ Yes – Fixed', bg: 'var(--success-bg)', text: 'var(--success-text)', border: '#86EFAC' },
                      { v: false, label: '✗ No – Not Fixed', bg: 'var(--danger-bg)', text: '#991B1B', border: '#FCA5A5' }
                    ].map(opt => (
                      <button key={String(opt.v)}
                        onClick={() => setReturnForm(f => ({ ...f, isResolved: opt.v, repairNextStep: 'keep' }))}
                        style={{
                          flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                          background: returnForm.isResolved === opt.v ? opt.bg : 'var(--bg-surface)',
                          color:      returnForm.isResolved === opt.v ? opt.text : 'var(--text-4)',
                          border:     `1px solid ${returnForm.isResolved === opt.v ? opt.border : 'var(--border-lt)'}`,
                        }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Repair next-step — only shown when not resolved and job has a linked repair */}
                {!returnForm.isResolved && job.repairOrderId && (() => {
                  const linkedRepair = repairs.find(r => r.id === job.repairOrderId)
                  if (!linkedRepair) return null
                  return (
                    <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: '10px 12px' }}>
                      <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--warning-text)' }}>
                        What should happen to repair <span className="font-mono">{linkedRepair.ref}</span>?
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {([
                          { v: 'keep',        label: 'Keep current status — decide later', sub: `Stay as "${linkedRepair.status.replace(/_/g, ' ')}"` },
                          { v: 'in_repair',   label: 'Resume in-house repair',             sub: 'Move back to In Repair so tech can continue' },
                          { v: 'unrepairable',label: 'Mark as unrepairable',                sub: 'Device cannot be fixed — inform the customer' },
                        ] as { v: 'keep' | 'in_repair' | 'unrepairable'; label: string; sub: string }[]).map(opt => {
                          const active = returnForm.repairNextStep === opt.v
                          return (
                            <button key={opt.v}
                              onClick={() => setReturnForm(f => ({ ...f, repairNextStep: opt.v }))}
                              style={{
                                textAlign: 'left', padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                                background: active ? 'var(--navy)' : 'var(--bg-surface)',
                                color:      active ? '#fff'    : 'var(--text-3)',
                                border:     `1px solid ${active ? 'var(--navy)' : 'var(--border-lt)'}`,
                              }}>
                              <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>{opt.label}</p>
                              <p style={{ fontSize: 10, margin: 0, opacity: active ? 0.75 : 1, color: active ? 'var(--border)' : 'var(--text-4)' }}>{opt.sub}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-t2 block mb-1">Final Cost (KSh)</label>
                    <input type="number" className="form-input w-full text-[12px]"
                      placeholder={job.quotedCost ? String(job.quotedCost) : '0'}
                      value={returnForm.finalCost}
                      onChange={e => setReturnForm(f => ({ ...f, finalCost: e.target.value }))} />
                    {job.quotedCost && <p className="text-[10px] text-t3 mt-0.5">Quoted: {fmtKes(job.quotedCost)}</p>}
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-t2 block mb-1">Return Notes</label>
                    <input className="form-input w-full text-[12px]" placeholder="What was done / why not fixed"
                      value={returnForm.returnNotes}
                      onChange={e => setReturnForm(f => ({ ...f, returnNotes: e.target.value }))} />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-4 justify-end">
                <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setReturnJobId(null)}>Cancel</button>
                <button className="btn-primary text-[11px] py-2 px-4" onClick={submitReturn}>Confirm Return</button>
              </div>
            </div>
          </div>
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
                <select className="form-input w-full text-[12px]" value={payBankAccountId} onChange={e => setPayBankAccountId(e.target.value)}>
                  <option value="">— Select Bank Account —</option>
                  {bankAccounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Payment Method</label>
                <select className="form-input w-full text-[12px]" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
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
              {payMethod !== 'cheque' && payMethod !== 'cash' && (
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Transaction Reference (optional)</label>
                  <input className="form-input w-full text-[12px]" placeholder="e.g. Bank/M-Pesa Ref" value={payReference} onChange={e => setPayReference(e.target.value)} />
                </div>
              )}
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Payment Date *</label>
                  <input type="date" className="form-input w-full text-[12px]" value={payDate}
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
