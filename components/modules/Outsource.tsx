'use client'
import { bankChoiceLabel } from '@/lib/finance/bank-choice-label'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useFinanceStore, fmtDate, fmtKes, OutsourceVendor, OutsourceJob, OUTSOURCE_SERVICE_TYPES, OutsourceServiceType } from '@/lib/store'
import { isOpenForOutsourcePicker, outsourcePickBlocker, repairOutsourceReadiness } from '@/lib/repair-outsource'
import { formatDaysOut, isOutsourceOverdue, outsourceDaysOut, outsourceDaysLate } from '@/lib/repair/outsource-visibility'
import { defaultExpectedReturnDate, findStockSerialForOutsource, outsourceHandoverSlipHtml, statusAfterUnfixedReturn, suggestedCustomerCharge, vendorScorecard, OUTSOURCE_DEFAULT_MARKUP_PCT } from '@/lib/repair/outsource-jobs'
import { LOCATIONS } from '@/lib/store/helpers'
import { OutsourcePhotos } from '@/components/outsource/OutsourcePhotos'
import { ModuleSkeleton, useMounted, InfoRow, ModuleHeader, TabBar, SearchPicker, Modal } from '@/components/ui'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
import { DataTable, DetailsDrawer, type ColumnDef, type DrawerTab } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { useUrlUiPatch, useUrlUiState } from '@/hooks/useUrlRecordId'
import { faScrewdriverWrench, faBuilding, faPlus, faCircleCheck } from '@fortawesome/free-solid-svg-icons'
import { userCan } from '@/lib/auth/can'
import { OperationalSummary } from '@/components/erp/OperationalSummary'

// ── Helpers ──────────────────────────────────────────────────────────────────

const svcLabel = (v: OutsourceServiceType) =>
  OUTSOURCE_SERVICE_TYPES.find(s => s.value === v)?.label ?? v

const STATUS_META: Record<OutsourceJob['status'], { label: string; badgeStatus: string }> = {
  sent:                { label: 'Out for repair', badgeStatus: 'sent' },
  returned_resolved:   { label: 'Returned – fixed', badgeStatus: 'done' },
  returned_unresolved: { label: 'Returned – not fixed', badgeStatus: 'failed' },
  cancelled:           { label: 'Cancelled', badgeStatus: 'cancelled' },
}

/** "3 days late" / "due in 2 days" / "due today" for a job still out. */
function dueLabel(job: OutsourceJob): { text: string; late: boolean } | null {
  const late = outsourceDaysLate(job)
  if (late === null) return null
  if (late > 0) return { text: `${late === 1 ? '1 day' : `${late} days`} late`, late: true }
  if (late === 0) return { text: 'due today', late: false }
  return { text: `due in ${-late === 1 ? '1 day' : `${-late} days`}`, late: false }
}

function OutsourceStatusBadge({ status }: { status: OutsourceJob['status'] }) {
  const m = STATUS_META[status]
  return <StatusBadge status={m.badgeStatus} label={m.label} />
}

function fmtBalance(billed: number, paid: number) {
  const bal = billed - paid
  return { bal, color: bal <= 0 ? 'var(--success-text)' : '#991B1B' }
}


/** A vendor's record: what came back fixed, how fast, how close to the quote, and what is owed. */
function VendorScore({ score, billed, paid, bal, balColor }: {
  score: ReturnType<typeof vendorScorecard>
  billed: number
  paid: number
  bal: number
  balColor: string
}) {
  const tone = (pct: number | null, good: number, ok: number) =>
    pct === null ? undefined : pct >= good ? 'is-good' : pct >= ok ? 'is-ok' : 'is-bad'
  return (
    <dl className="outsource-score">
      <div><dt>Jobs</dt><dd>{score.jobs}{score.out > 0 && <small>{score.out} out{score.overdueNow > 0 ? `, ${score.overdueNow} late` : ''}</small>}</dd></div>
      <div><dt>Fixed</dt><dd className={tone(score.fixRate, 80, 50)}>{score.fixRate === null ? '—' : `${score.fixRate}%`}{score.returned > 0 && <small>{score.fixed} of {score.returned}</small>}</dd></div>
      <div className="is-extra"><dt>Avg days</dt><dd>{score.avgDaysOut === null ? '—' : score.avgDaysOut}</dd></div>
      <div><dt>On time</dt><dd className={tone(score.onTimeRate, 80, 50)}>{score.onTimeRate === null ? '—' : `${score.onTimeRate}%`}</dd></div>
      <div className="is-extra"><dt>vs quote</dt><dd className={score.avgCostVsQuotePct === null ? undefined : score.avgCostVsQuotePct > 10 ? 'is-bad' : score.avgCostVsQuotePct > 0 ? 'is-ok' : 'is-good'}>
        {score.avgCostVsQuotePct === null ? '—' : `${score.avgCostVsQuotePct > 0 ? '+' : ''}${score.avgCostVsQuotePct}%`}
        {score.overQuote > 0 && <small>{score.overQuote} over</small>}
      </dd></div>
      <div className="is-extra"><dt>Billed</dt><dd>{fmtKes(billed)}</dd></div>
      <div className="is-extra"><dt>Paid</dt><dd className="is-good">{fmtKes(paid)}</dd></div>
      <div><dt>Owed</dt><dd style={{ color: balColor }}>{fmtKes(bal)}</dd></div>
    </dl>
  )
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
    addOutsourceJob, returnOutsourceJob, recordOutsourcePayment, createOutsourceJobBill,
    cancelOutsourceJob, updateOutsourceJob, deleteOutsourceVendor, chargeOutsourceToRepair,
    serials, companySettings, remindLateOutsourceJobs,
    setModule, showToast,
  } = useFinanceStore()

  // Jobs past the date a vendor promised: remind the sender and the lead once.
  useEffect(() => { remindLateOutsourceJobs() }, [outsourceJobs, remindLateOutsourceJobs])

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin = userCan(currentUser, 'repair.outsource.vendors')

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
    ['sent', 'returned_resolved', 'returned_unresolved', 'cancelled'].includes(jobStatusValue)
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
    expectedReturnDate: '',
    accessories: '',
    quotedCost: '',
    notes: '',
  })
  /** The promised date follows the sent date and service until someone types one. */
  const [expectedTouched, setExpectedTouched] = useState(false)
  const autoExpected = defaultExpectedReturnDate(jobForm.sentDate, jobForm.serviceType)
  const shownExpected = expectedTouched ? jobForm.expectedReturnDate : autoExpected
  /** A machine of ours (no repair linked) with this serial: it will be moved to Vendor. */
  const stockMatch = !jobForm.repairOrderId ? findStockSerialForOutsource(serials, jobForm.serial) : undefined
  const activeVendors = outsourceVendors.filter(v => v.active !== false)
  const [repairSearch, setRepairSearch] = useState('')

  // Vendor search within job modal
  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorModalFromJob, setVendorModalFromJob] = useState(false)

  // Every open workshop job is listed, including ones that cannot go out yet.
  // They used to be dropped from the list, so someone searching for a repair
  // they could see on the bench found nothing and was given no reason. Now the
  // reason sits on the row and ready ones sort first.
  const pickableRepairs = repairs
    .filter(r => isOpenForOutsourcePicker(r))
    .map(r => ({ ...r, outsourceBlocker: outsourcePickBlocker(r, outsourceJobs) }))
    .sort((a, b) => Number(a.outsourceBlocker !== null) - Number(b.outsourceBlocker !== null))
  function selectRepair(repairId: string) {
    const r = repairs.find(x => x.id === repairId)
    if (!r) return
    const blocker = outsourcePickBlocker(r, outsourceJobs)
    if (blocker) { showToast(`${r.ref}: ${blocker}`, 'error'); return }
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
    setVendorForm({ name: query.trim(), phone: '', email: '', address: '', specializations: [], notes: '', active: true })
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
    chargeCustomer: true,
    customerCharge: '',
  })

  // ── Edit / cancel / charge ──
  const [editJobId, setEditJobId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ vendorId: '', serviceType: '' as OutsourceServiceType | '', issueDescription: '', quotedCost: '', expectedReturnDate: '', accessories: '', notes: '' })
  const [cancelJobId, setCancelJobId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [chargeJobId, setChargeJobId] = useState<string | null>(null)
  const [chargeAmount, setChargeAmount] = useState('')

  // ── Vendor modal ──
  const [showVendorModal, setShowVendorModal] = useState(false)
  const [editVendorId, setEditVendorId] = useState<string | null>(null)
  const [vendorForm, setVendorForm] = useState({
    name: '', phone: '', email: '', address: '',
    specializations: [] as OutsourceServiceType[],
    notes: '',
    active: true,
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

  // Billed = the vendor's outsource bills in Finance (a job's final cost when
  // it has no bill yet); paid = what Finance recorded on those bills, plus
  // older payments that were recorded in Outsource only.
  function vendorJobBill(job: { billId?: string }) {
    return job.billId ? invoices.find(i => i.id === job.billId && i.status !== 'cancelled') : undefined
  }
  function vendorBilled(vendorId: string) {
    return outsourceJobs
      .filter(j => j.vendorId === vendorId)
      .reduce((s, j) => s + (vendorJobBill(j)?.total ?? (j.finalCost ?? 0)), 0)
  }
  function vendorPaid(vendorId: string) {
    const onBills = outsourceJobs
      .filter(j => j.vendorId === vendorId)
      .reduce((s, j) => s + (vendorJobBill(j)?.amountPaid ?? 0), 0)
    const outsourceOnly = outsourcePayments
      .filter(p => p.vendorId === vendorId && !p.postedToAccounts)
      .reduce((s, p) => s + p.amount, 0)
    return onBills + outsourceOnly
  }
  /** Returned jobs with a cost but no bill: owed, but Finance cannot pay them until a bill exists. */
  function jobsNeedingBill(vendorId?: string) {
    return outsourceJobs.filter(j => (!vendorId || j.vendorId === vendorId) && (j.finalCost ?? 0) > 0 && !vendorJobBill(j))
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

  // Vendors tab search: the vendor's own details plus the devices and
  // customers of the jobs sent to them; every word must match.
  const [vendorListSearch, setVendorListSearch] = useState('')
  const vendorSearchWords = vendorListSearch.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const listedVendors = vendorSearchWords.length === 0 ? outsourceVendors : outsourceVendors.filter(vendor => {
    const jobsText = outsourceJobs.filter(j => j.vendorId === vendor.id).map(j => {
      const linked = j.repairOrderId ? repairs.find(x => x.id === j.repairOrderId) : null
      return [j.ref, j.deviceDescription, j.serial, linked?.customerName, linked?.productName].filter(Boolean).join(' ')
    }).join(' ')
    const text = [vendor.name, vendor.phone, vendor.email, vendor.address, vendor.notes, ...(vendor.specializations ?? []), jobsText]
      .filter(Boolean).join(' ').toLowerCase()
    return vendorSearchWords.every(word => text.includes(word))
  })

  const selectedVendor = selectedVendorId ? outsourceVendors.find(v => v.id === selectedVendorId) ?? null : null
  const vendorJobs = selectedVendor ? outsourceJobs.filter(j => j.vendorId === selectedVendor.id) : []
  const vendorPaymentHistory = selectedVendor ? outsourcePayments.filter(p => p.vendorId === selectedVendor.id) : []

  // ── Counts for tab badge ──
  const outCount = outsourceJobs.filter(j => j.status === 'sent').length
  const overdueCount = outsourceJobs.filter(j => isOutsourceOverdue(j)).length
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
    setJobForm({ vendorId: '', repairOrderId: '', deviceDescription: '', serial: '', serviceType: '', issueDescription: '', sentDate: new Date().toISOString().slice(0, 10), expectedReturnDate: '', accessories: '', quotedCost: '', notes: '' })
    setExpectedTouched(false)
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
    if (shownExpected && shownExpected < jobForm.sentDate) { showToast('The promised return date is before the date sent', 'error'); return }
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
      expectedReturnDate: shownExpected || undefined,
      accessories: jobForm.accessories.trim() || undefined,
      quotedCost: jobForm.quotedCost ? Number(jobForm.quotedCost) : undefined,
      notes: jobForm.notes.trim() || undefined,
    })
    setShowJobModal(false)
  }

  function openReturn(jobId: string) {
    setReturnJobId(jobId)
    setReturnForm({ returnedDate: new Date().toISOString().slice(0, 10), isResolved: null, returnNotes: '', finalCost: '', repairNextStep: '', chargeCustomer: true, customerCharge: '' })
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
    const finalCost = returnForm.finalCost ? Number(returnForm.finalCost) : undefined
    const customerCharge = Number(returnForm.customerCharge || suggestedCustomerCharge(finalCost ?? 0))
    const willCharge = returnForm.isResolved === true && hasLinkedRepair && returnForm.chargeCustomer && (finalCost ?? 0) > 0
    if (willCharge && !(customerCharge > 0)) { showToast('Enter what the customer pays for this work, or untick it', 'error'); return }
    const ok = returnOutsourceJob(returnJobId, {
      returnedDate: returnForm.returnedDate,
      isResolved: returnForm.isResolved,
      returnNotes: returnForm.returnNotes.trim() || undefined,
      finalCost,
      repairNextStep: returnForm.isResolved === false && returnForm.repairNextStep ? returnForm.repairNextStep : undefined,
    })
    if (ok && willCharge) chargeOutsourceToRepair(returnJobId, customerCharge)
    setReturnJobId(null)
  }

  function openEditJob(job: OutsourceJob) {
    setEditJobId(job.id)
    setEditForm({
      vendorId: job.vendorId,
      serviceType: job.serviceType,
      issueDescription: job.issueDescription,
      quotedCost: job.quotedCost != null ? String(job.quotedCost) : '',
      expectedReturnDate: job.expectedReturnDate ?? defaultExpectedReturnDate(job.sentDate, job.serviceType),
      accessories: job.accessories ?? '',
      notes: job.notes ?? '',
    })
  }

  function submitEditJob() {
    if (!editJobId) return
    const job = outsourceJobs.find(j => j.id === editJobId)
    if (!job) return
    if (!editForm.vendorId) { showToast('Select a vendor', 'error'); return }
    if (!editForm.serviceType) { showToast('Select a service type', 'error'); return }
    if (!editForm.issueDescription.trim()) { showToast('Describe the work to do', 'error'); return }
    if (editForm.quotedCost.trim() && (!Number.isFinite(Number(editForm.quotedCost)) || Number(editForm.quotedCost) < 0)) { showToast('Quoted cost must be a number of 0 or more', 'error'); return }
    if (editForm.expectedReturnDate && job.sentDate && editForm.expectedReturnDate < job.sentDate.slice(0, 10)) { showToast('The promised return date is before the date sent', 'error'); return }
    const ok = updateOutsourceJob(editJobId, {
      vendorId: editForm.vendorId,
      serviceType: editForm.serviceType as OutsourceServiceType,
      issueDescription: editForm.issueDescription.trim(),
      quotedCost: editForm.quotedCost.trim() ? Number(editForm.quotedCost) : undefined,
      expectedReturnDate: editForm.expectedReturnDate || undefined,
      accessories: editForm.accessories.trim() || undefined,
      notes: editForm.notes.trim() || undefined,
    })
    if (ok) setEditJobId(null)
  }

  function openCancelJob(job: OutsourceJob) {
    setCancelJobId(job.id)
    setCancelReason('')
  }

  function submitCancelJob() {
    if (!cancelJobId) return
    if (cancelOutsourceJob(cancelJobId, cancelReason)) setCancelJobId(null)
  }

  function openCharge(job: OutsourceJob) {
    setChargeJobId(job.id)
    setChargeAmount(String(suggestedCustomerCharge(job.finalCost ?? 0) || ''))
  }

  function submitCharge() {
    if (!chargeJobId) return
    if (chargeOutsourceToRepair(chargeJobId, Number(chargeAmount))) setChargeJobId(null)
  }

  /** The linked repair can still take the vendor's work on its quote. */
  function canChargeCustomer(job: OutsourceJob) {
    if (job.status !== 'returned_resolved' || !job.repairOrderId || job.customerChargeAddedAt || !((job.finalCost ?? 0) > 0)) return false
    const r = repairs.find(x => x.id === job.repairOrderId)
    return !!r && !!r.quote && !r.invoiceId && !r.billingExempt && !r.underWarranty
  }

  function printHandoverSlip(job: OutsourceJob) {
    const vendor = outsourceVendors.find(v => v.id === job.vendorId)
    const repair = job.repairOrderId ? repairs.find(r => r.id === job.repairOrderId) : undefined
    const html = outsourceHandoverSlipHtml({
      companyName: companySettings?.name || 'Deed',
      jobRef: job.ref,
      vendorName: job.vendorName,
      vendorPhone: vendor?.phone,
      deviceDescription: job.deviceDescription,
      serial: job.serial,
      serviceLabel: svcLabel(job.serviceType),
      issueDescription: job.issueDescription,
      accessories: job.accessories,
      quotedCost: job.quotedCost,
      sentDate: job.sentDate,
      expectedReturnDate: job.expectedReturnDate,
      sentByName: job.sentByName,
      repairRef: repair?.ref,
      fmtKes,
      fmtDate,
    })
    const win = window.open('', '_blank', 'width=760,height=900')
    if (!win) { showToast('Allow pop-ups to print the handover slip', 'error'); return }
    win.document.open()
    win.document.write(html)
    win.document.close()
  }

  function openAddVendor() {
    setEditVendorId(null)
    setVendorForm({ name: '', phone: '', email: '', address: '', specializations: [], notes: '', active: true })
    setShowVendorModal(true)
  }

  function openEditVendor(v: OutsourceVendor) {
    setEditVendorId(v.id)
    setVendorForm({ name: v.name, phone: v.phone, email: v.email ?? '', address: v.address ?? '', specializations: [...v.specializations], notes: v.notes ?? '', active: v.active !== false })
    setShowVendorModal(true)
  }

  function submitVendor() {
    if (!vendorForm.name.trim()) { showToast('Enter vendor name', 'error'); return }
    if (!vendorForm.phone.trim()) { showToast('Enter phone number', 'error'); return }
    if (editVendorId) {
      updateOutsourceVendor(editVendorId, { ...vendorForm, email: vendorForm.email || undefined, address: vendorForm.address || undefined, notes: vendorForm.notes || undefined })
    } else {
      const { active: _active, ...fields } = vendorForm
      const newVendor = addOutsourceVendor({ ...fields, email: vendorForm.email || undefined, address: vendorForm.address || undefined, notes: vendorForm.notes || undefined })
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

  async function submitPayment() {
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
    const recorded = await recordOutsourcePayment({
      vendorId: payVendorId, vendorName: vendor.name, amount: amt, date: payDate, notes: payNotes.trim() || undefined,
      method: payMethod, bankAccountId: payBankAccountId, reference: payReference
    })
    if (recorded) setPayVendorId(null)
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  
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
        return [
          job.ref, job.deviceDescription, job.serial, job.vendorName, job.issueDescription, job.serviceType, job.sentByName, job.notes, job.returnNotes,
          linked?.ref, linked?.customerName, linked?.customerPhone, linked?.productName, linked?.serialNumber, job.repairOrderId,
        ].filter(Boolean).join(' ')
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
      render: job => {
        // How long a machine has been away is what tells you to chase it. Jobs
        // sent to Fastech in June were still open in late September unnoticed.
        const due = dueLabel(job)
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span>{fmtDate(job.sentDate)}</span>
            {due && (
              <span className={`outsource-due${due.late ? ' is-late' : ''}`}>{due.text}</span>
            )}
          </span>
        )
      },
      exportValue: job => job.sentDate,
    },
    {
      key: 'service', label: 'Service', priority: 3, width: '120px',
      render: job => <span className="whitespace-nowrap">{svcLabel(job.serviceType)}</span>,
    },
    {
      key: 'by', label: 'By', priority: 3, width: '90px',
      render: job => (job.sentByName ?? '').split(' ')[0] || '—',
      exportValue: job => job.sentByName,
    },
    {
      key: 'returned', label: 'Returned', priority: 3, width: '100px',
      render: job => job.returnedDate ? fmtDate(job.returnedDate) : '—',
      exportValue: job => job.returnedDate ?? '',
    },
  ]

  function openBills() {
    setModule('accounting')
    router.push('/finance?tab=bills')
  }

  /** The one next step for a row: bring it back in, or open its bill. */
  function jobRowActions(job: OutsourceJob) {
    const bill = job.billId ? invoices.find(i => i.id === job.billId) : null
    return (
      <>
        {job.status === 'sent' && (
          <button type="button" className="outsource-act is-primary" onClick={e => { e.stopPropagation(); openReturn(job.id) }}>
            Mark returned
          </button>
        )}
        {bill && (
          <button type="button" className="outsource-act" onClick={e => { e.stopPropagation(); openBills() }}>
            {bill.ref}
          </button>
        )}
      </>
    )
  }

  /** Everything that can be done to a job, in its details panel. */
  function jobDrawerActions(job: OutsourceJob) {
    const bill = job.billId ? invoices.find(i => i.id === job.billId) : null
    return (
      <div className="outsource-drawer-actions">
        {job.status === 'sent' && (
          <>
            <button type="button" className="outsource-act is-primary" onClick={() => openReturn(job.id)}>Mark returned</button>
            <button type="button" className="outsource-act" onClick={() => openEditJob(job)}>Edit</button>
            <button type="button" className="outsource-act" onClick={() => printHandoverSlip(job)}>Handover slip</button>
            <button type="button" className="outsource-act is-danger" onClick={() => openCancelJob(job)}>Cancel job</button>
          </>
        )}
        {canChargeCustomer(job) && (
          <button type="button" className="outsource-act is-primary" onClick={() => openCharge(job)}>Charge customer</button>
        )}
        {(job.finalCost ?? 0) > 0 && !vendorJobBill(job) && job.status !== 'sent' && job.status !== 'cancelled' && (
          <button type="button" className="outsource-act is-warning" onClick={() => createOutsourceJobBill(job.id)} title="This cost is owed but has no bill, so Finance cannot pay it yet">Create bill</button>
        )}
        {bill && <button type="button" className="outsource-act" onClick={openBills}>Bill {bill.ref}</button>}
      </div>
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
          {(() => {
            const due = dueLabel(job)
            return due ? <span className={`outsource-due${due.late ? ' is-late' : ''}`}>· {due.text}</span> : null
          })()}
          {job.status === 'cancelled' && <span className="text-[10px] text-t3">· Cancelled</span>}
          {job.returnedDate && <span className="text-[10px] text-t3">· Returned {fmtDate(job.returnedDate)}</span>}
          <span className="ml-auto flex gap-2" onClick={e => e.stopPropagation()}>{jobRowActions(job)}</span>
        </div>
      </div>
    )
  }

  function jobDrawerTabs(job: OutsourceJob): DrawerTab[] {
    const bill = job.billId ? invoices.find(i => i.id === job.billId) : null
    const linkedRepair = job.repairOrderId ? repairs.find(r => r.id === job.repairOrderId) : null
    const stockSerial = job.stockSerialId ? serials.find(x => x.id === job.stockSerialId) : null
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
            {job.status === 'sent' && (
              <InfoRow label="Promised back" value={job.expectedReturnDate
                ? `${fmtDate(job.expectedReturnDate)}${dueLabel(job) ? ` · ${dueLabel(job)!.text}` : ''}`
                : `${formatDaysOut(outsourceDaysOut(job))} out · no date promised`} />
            )}
            {job.accessories && <InfoRow label="Handed over with" value={job.accessories} />}
            {stockSerial && <InfoRow label="Stock machine" value={`${stockSerial.productName} · now at ${LOCATIONS[stockSerial.location]?.name ?? stockSerial.location}`} />}
            {job.returnedDate && <InfoRow label="Returned" value={`${fmtDate(job.returnedDate)}${job.returnedByName ? ` · received by ${job.returnedByName}` : ''}`} />}
            {job.status === 'cancelled' && <InfoRow label="Cancelled" value={`${job.cancelledDate ? fmtDate(job.cancelledDate) : ''}${job.cancelledByName ? ` by ${job.cancelledByName}` : ''}${job.cancelReason ? ` — ${job.cancelReason}` : ''}`} />}
            {job.quotedCost != null && <InfoRow label="Quoted Cost" value={fmtKes(job.quotedCost)} />}
            {job.finalCost != null && (
              <InfoRow label="Final Cost" value={`${fmtKes(job.finalCost)}${job.quotedCost && job.finalCost > job.quotedCost ? ` · ${fmtKes(job.finalCost - job.quotedCost)} over the quote` : ''}`} />
            )}
            {job.customerChargeAmount != null && linkedRepair && (
              <InfoRow label="Charged to customer" value={`${fmtKes(job.customerChargeAmount)} on ${linkedRepair.ref}'s quote`} />
            )}
            {canChargeCustomer(job) && <InfoRow label="Charged to customer" value="Not yet — use Charge customer" />}
            {job.returnNotes && <InfoRow label="Return Notes" value={job.returnNotes} />}
            {job.notes && <InfoRow label="Notes" value={job.notes} />}
            {bill && <InfoRow label="Vendor Bill" value={bill.ref} mono />}
          </div>
        ),
      },
      {
        id: 'attachments' as const,
        label: 'Photos',
        content: <OutsourcePhotos jobId={job.id} canAdd={job.status !== 'cancelled'} returned={job.status !== 'sent'} />,
      },
      ...(job.editLog?.length ? [{
        id: 'history' as const,
        label: 'Changes',
        content: (
          <ul className="outsource-changes">
            {job.editLog.slice().reverse().map((entry, i) => (
              <li key={i}><span>{fmtDate(entry.date)} · {entry.by}</span>{entry.note}</li>
            ))}
          </ul>
        ),
      }] : []),
    ]
  }

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page outsource-workspace">
      <ModuleHeader
        title="Outsource repairs"
        subtitle="External repair jobs, vendor performance and costs"
        icon={<Fa icon={faScrewdriverWrench} />}
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
        <OperationalSummary
          items={[
            ...(outCount > 0 ? [{ id: 'out', label: 'out', value: outCount, onClick: () => { setTab('jobs'); setJobStatusFilter('sent') } }] : []),
            ...(overdueCount > 0 ? [{ id: 'overdue', label: 'late', value: overdueCount, tone: 'danger' as const, onClick: () => { setTab('jobs'); setJobStatusFilter('sent') } }] : []),
            ...(unresolvedCount > 0 ? [{ id: 'unresolved', label: 'not fixed', value: unresolvedCount, tone: 'warning' as const, onClick: () => { setTab('jobs'); setJobStatusFilter('returned_unresolved') } }] : []),
            ...(returnedToday > 0 ? [{ id: 'today', label: 'returned today', value: returnedToday }] : []),
            ...(vendorOutstanding > 0 ? [{ id: 'owed', label: 'owed', value: fmtKes(vendorOutstanding), onClick: () => setTab('vendors') }] : []),
          ]}
        />

      <div className="card overflow-hidden outsource-surface">

        {/* ── Jobs tab ── */}
        {tab === 'jobs' && (
          <div>
            <div className="outsource-directory">
              <DataTable
            tableId="outsource_jobs"
            columns={jobColumns}
            rows={filteredJobs}
            rowKey={job => job.id}
            emptyMessage="No outsource jobs match the filter."
            searchValue={jobSearch}
            onSearchChange={setJobSearch}
            searchPlaceholder="Search jobs"
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
                  { value: 'cancelled', label: 'Cancelled' },
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
          </div>
        )}

        {/* ── Vendors tab ── */}
        {tab === 'vendors' && !selectedVendor && (
          <>
            <div className="outsource-vendor-toolbar">
              <input
                type="search"
                className="form-input"
                placeholder="Search vendors"
                value={vendorListSearch}
                onChange={e => setVendorListSearch(e.target.value)}
                aria-label="Search vendors"
              />
              {isAdmin && <button type="button" className="outsource-act" onClick={openAddVendor}>+ Vendor</button>}
            </div>
            {outsourceVendors.length === 0 ? (
              <div className="py-14 text-center text-t3 text-sm">
                <Fa icon={faBuilding} className="text-3xl mb-2" aria-hidden="true" />
                No vendors added yet.
              </div>
            ) : (
              <div className="outsource-vendor-list divide-y" style={{ borderColor: 'var(--bg-surface)' }}>
                {listedVendors.length === 0 && (
                  <div className="py-10 text-center text-t3 text-sm">No vendor matches “{vendorListSearch}”.</div>
                )}
                {listedVendors.map(vendor => {
                  const billed = vendorBilled(vendor.id)
                  const paid   = vendorPaid(vendor.id)
                  const { bal, color } = fmtBalance(billed, paid)
                  const score = vendorScorecard(vendor.id, outsourceJobs)
                  return (
                    <div key={vendor.id} className="outsource-vendor-row flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4 px-4 py-3 hover:bg-gray-50 transition-colors">
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm text-white flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, var(--navy), var(--accent-cyan))' }}>
                        {vendor.name.slice(0, 2).toUpperCase()}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-t1 text-sm">
                          {vendor.name}
                          {vendor.active === false && <span className="outsource-inactive">Inactive</span>}
                        </p>
                        <p className="text-[11px] text-t3">{vendor.phone}{vendor.email ? ` · ${vendor.email}` : ''}</p>
                        <div className="flex gap-1.5 mt-1 flex-wrap">
                          {vendor.specializations.map(s => (
                            <span key={s} style={{ background: '#E8F3FA', color: 'var(--navy-dark)', borderRadius: 20, fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
                              {svcLabel(s)}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Scorecard */}
                      <VendorScore score={score} billed={billed} paid={paid} bal={bal} balColor={color} />

                      {/* Actions */}
                      <div className="outsource-vendor-actions">
                        <button type="button" className="outsource-act" onClick={() => setSelectedVendorId(vendor.id)}>View</button>
                        {bal > 0 && <button type="button" className="outsource-act is-primary" onClick={() => openPayVendor(vendor.id)}>Pay</button>}
                        {isAdmin && <button type="button" className="outsource-act" onClick={() => openEditVendor(vendor)}>Edit</button>}
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
                <button type="button" className="outsource-act" onClick={() => setSelectedVendorId(null)}>
                  ‹ Back
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-t1">
                    {selectedVendor.name}
                    {selectedVendor.active === false && <span className="outsource-inactive">Inactive</span>}
                  </p>
                  <p className="text-[10px] text-t3">{selectedVendor.phone}{selectedVendor.email ? ` · ${selectedVendor.email}` : ''}{selectedVendor.address ? ` · ${selectedVendor.address}` : ''}</p>
                </div>
                {bal > 0 && (
                  <button type="button" className="outsource-act is-primary" onClick={() => openPayVendor(selectedVendor.id)}>
                    Record payment
                  </button>
                )}
                {isAdmin && <button type="button" className="outsource-act" onClick={() => openEditVendor(selectedVendor)}>Edit</button>}
              </div>
              <div className="outsource-vendor-detail__score">
                <VendorScore score={vendorScorecard(selectedVendor.id, outsourceJobs)} billed={billed} paid={paid} bal={bal} balColor={color} />
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
                              {job.status === 'sent' && dueLabel(job) && (
                                <p className={`outsource-due${dueLabel(job)!.late ? ' is-late' : ''}`}>{job.expectedReturnDate ? `Promised ${fmtDate(job.expectedReturnDate)} · ` : ''}{dueLabel(job)!.text}</p>
                              )}
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
                              <div className="outsource-job-acts">
                                {job.status === 'sent' && (
                                  <button type="button" className="outsource-act is-primary" onClick={() => openReturn(job.id)}>Mark returned</button>
                                )}
                                <button type="button" className="outsource-act" onClick={() => setActiveJobId(job.id)}>Details</button>
                                {job.billId && (() => {
                                  const bill = invoices.find(i => i.id === job.billId)
                                  return bill ? <button type="button" className="outsource-act" onClick={openBills}>Bill {bill.ref}</button> : null
                                })()}
                                {(job.finalCost ?? 0) > 0 && !vendorJobBill(job) && job.status !== 'sent' && job.status !== 'cancelled' && (
                                  <button type="button" className="outsource-act is-warning" onClick={() => createOutsourceJobBill(job.id)} title="This cost is owed but has no bill, so Finance cannot pay it yet">Create bill</button>
                                )}
                              </div>
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
                              <p className="text-[10px] mt-0.5" style={{ color: pmt.postedToAccounts ? 'var(--success)' : 'var(--warning-text)' }}>
                                {pmt.postedToAccounts
                                  ? `Paid through Finance${pmt.billRefs?.length ? ` · ${pmt.billRefs.join(', ')}` : ''}`
                                  : 'Recorded in Outsource only — not in the cash book or on the bill'}
                              </p>
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
          actions={jobDrawerActions(activeJob)}
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
                placeholder="Search by customer name, laptop model, serial, phone or REP…"
                items={pickableRepairs}
                searchText={r => [r.issueDescription, r.customerEmail].filter(Boolean).join(' ')}
                emptyText="No open repair matches — check the name or laptop model"
                selectedLabel={jobForm.repairOrderId ? repairSearch : undefined}
                formatSelected={r => `${r.ref} · ${r.productName} (${r.customerName})`}
                onSelect={r => selectRepair(r.id)}
                renderItem={r => (
                  <div className={`flex min-w-0 items-center justify-between gap-3 ${r.outsourceBlocker ? 'opacity-70' : ''}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        <span className="font-mono text-blue-700">{r.ref}</span>
                        <span className="ml-2">{r.productName}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {r.customerName} · {r.repairPath === 'direct_repair' ? 'Direct Repair' : 'Diagnosis First'} · {r.issueDescription}{r.serialNumber ? ` · SN ${r.serialNumber}` : ''}
                      </p>
                      {r.outsourceBlocker && (
                        <p className="truncate text-xs font-semibold" style={{ color: '#D97706' }}>{r.outsourceBlocker}</p>
                      )}
                    </div>
                    <StatusBadge status={r.status} label={r.status.replace(/_/g, ' ')} size="xs" />
                  </div>
                )}
              />
              {repairs.length === 0 && (
                <p className="mt-1.5 text-xs" style={{ color: '#D97706' }}>
                  No repairs are visible to your account. Ask an admin to give you the Repair or Outsource module, or send the machine without linking a repair.
                </p>
              )}
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
                items={activeVendors}
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
              {stockMatch && (
                <p className="mt-1.5 text-xs" style={{ color: 'var(--info-text)' }}>
                  Our stock: {stockMatch.productName} in {LOCATIONS[stockMatch.location]?.name ?? stockMatch.location}. It moves to Vendor while it is out, and back when it returns.
                </p>
              )}
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

          <div>
            <label htmlFor="outsource-accessories" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Handed over with</label>
            <input id="outsource-accessories" className="form-input h-11 w-full text-sm" placeholder="e.g. Charger, battery — leave empty for the device only"
              value={jobForm.accessories}
              onChange={e => setJobForm(f => ({ ...f, accessories: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <div>
              <label htmlFor="outsource-date-sent" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Date Sent *</label>
              <input id="outsource-date-sent" type="date" className="form-input h-11 w-full text-sm" value={jobForm.sentDate}
                onChange={e => setJobForm(f => ({ ...f, sentDate: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="outsource-expected" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Promised back by</label>
              <input id="outsource-expected" type="date" className="form-input h-11 w-full text-sm" value={shownExpected}
                min={jobForm.sentDate || undefined}
                onChange={e => { setExpectedTouched(true); setJobForm(f => ({ ...f, expectedReturnDate: e.target.value })) }} />
              <p className="mt-1 text-xs text-slate-500">
                {expectedTouched ? 'As agreed with the vendor' : jobForm.serviceType ? `Usual time for ${svcLabel(jobForm.serviceType as OutsourceServiceType)} — change it to what the vendor promised` : 'Set from the service type'}
              </p>
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
            <p className="text-xs text-slate-500">
              Received by <strong>{currentUser?.name ?? 'you'}</strong>{job.expectedReturnDate ? ` · promised ${fmtDate(job.expectedReturnDate)}` : ''}
            </p>
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
                      { v: 'keep', label: 'Put it back where it was — decide later', sub: `Back to "${statusAfterUnfixedReturn('keep', job.previousRepairStatus).replace(/_/g, ' ')}", as before it went out` },
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
                {job.quotedCost ? (
                  <p className="mt-1 text-xs" style={{ color: Number(returnForm.finalCost) > job.quotedCost ? 'var(--danger-text)' : 'var(--text-3)' }}>
                    Quoted: {fmtKes(job.quotedCost)}
                    {Number(returnForm.finalCost) > job.quotedCost ? ` — ${fmtKes(Number(returnForm.finalCost) - job.quotedCost)} over the quote` : ''}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="outsource-return-notes" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Return Notes</label>
                <textarea id="outsource-return-notes" className="form-input min-h-[76px] w-full resize-y py-3 text-sm" rows={2}
                  placeholder="What was done / why not fixed"
                  value={returnForm.returnNotes}
                  onChange={e => setReturnForm(f => ({ ...f, returnNotes: e.target.value }))} />
              </div>
            </div>

            {returnForm.isResolved === true && job.repairOrderId && Number(returnForm.finalCost) > 0 && (() => {
              const linkedRepair = repairs.find(r => r.id === job.repairOrderId)
              if (!linkedRepair) return null
              const exempt = linkedRepair.billingExempt || linkedRepair.underWarranty
              const suggested = suggestedCustomerCharge(Number(returnForm.finalCost))
              return (
                <fieldset className="outsource-charge">
                  <legend>Charge the customer for this work</legend>
                  {exempt ? (
                    <p>{linkedRepair.ref} is not charged to the customer (warranty or no-charge), so nothing is added.</p>
                  ) : !linkedRepair.quote ? (
                    <p>{linkedRepair.ref} has no quote yet — add the specialist work when you quote it.</p>
                  ) : linkedRepair.invoiceId ? (
                    <p>{linkedRepair.ref} is already invoiced — add the charge on the invoice in Finance.</p>
                  ) : (
                    <>
                      <label className="outsource-charge__tick">
                        <input type="checkbox" checked={returnForm.chargeCustomer} onChange={e => setReturnForm(f => ({ ...f, chargeCustomer: e.target.checked }))} />
                        Add it to {linkedRepair.ref}'s quote
                      </label>
                      {returnForm.chargeCustomer && (
                        <div className="outsource-charge__amount">
                          <span>KSh</span>
                          <input type="number" inputMode="decimal" aria-label="Customer price for the outsourced work" className="form-input h-11 w-full text-sm"
                            placeholder={String(suggested)}
                            value={returnForm.customerCharge}
                            onChange={e => setReturnForm(f => ({ ...f, customerCharge: e.target.value }))} />
                          <small>Vendor cost {fmtKes(Number(returnForm.finalCost))} + {OUTSOURCE_DEFAULT_MARKUP_PCT}% = {fmtKes(suggested)}. Change it if you agreed another price.</small>
                        </div>
                      )}
                    </>
                  )}
                </fieldset>
              )
            })()}

            <OutsourcePhotos jobId={job.id} canAdd returned />
          </Modal>
        )
      })()}

      {/* ── Edit open job ─────────────────────────────────────────────────── */}
      {editJobId && (() => {
        const job = outsourceJobs.find(j => j.id === editJobId)
        if (!job) return null
        const vendorChoices = outsourceVendors.filter(v => v.active !== false || v.id === job.vendorId)
        return (
          <Modal
            title={`Change ${job.ref}`}
            subtitle={job.deviceDescription}
            width={720}
            variant="enterprise"
            accent="#2563EB"
            icon={<Fa icon={faScrewdriverWrench} />}
            onClose={() => setEditJobId(null)}
            footer={(
              <>
                <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => setEditJobId(null)}>Cancel</button>
                <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={submitEditJob}>Save changes</button>
              </>
            )}
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <label htmlFor="outsource-edit-vendor" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Vendor *</label>
                <select id="outsource-edit-vendor" className="form-input h-11 w-full text-sm" value={editForm.vendorId}
                  onChange={e => setEditForm(f => ({ ...f, vendorId: e.target.value }))}>
                  {vendorChoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="outsource-edit-service" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Service Type *</label>
                <select id="outsource-edit-service" className="form-input h-11 w-full text-sm" value={editForm.serviceType}
                  onChange={e => setEditForm(f => ({ ...f, serviceType: e.target.value as OutsourceServiceType }))}>
                  {OUTSOURCE_SERVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="outsource-edit-issue" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Issue / What to do *</label>
              <textarea id="outsource-edit-issue" className="form-input min-h-[76px] w-full resize-y py-3 text-sm" rows={2}
                value={editForm.issueDescription} onChange={e => setEditForm(f => ({ ...f, issueDescription: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <label htmlFor="outsource-edit-quote" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Quoted Cost (KSh)</label>
                <input id="outsource-edit-quote" type="number" inputMode="decimal" className="form-input h-11 w-full text-sm"
                  value={editForm.quotedCost} onChange={e => setEditForm(f => ({ ...f, quotedCost: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="outsource-edit-expected" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Promised back by</label>
                <input id="outsource-edit-expected" type="date" className="form-input h-11 w-full text-sm" min={job.sentDate?.slice(0, 10)}
                  value={editForm.expectedReturnDate} onChange={e => setEditForm(f => ({ ...f, expectedReturnDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <label htmlFor="outsource-edit-accessories" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Handed over with</label>
              <input id="outsource-edit-accessories" className="form-input h-11 w-full text-sm"
                value={editForm.accessories} onChange={e => setEditForm(f => ({ ...f, accessories: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="outsource-edit-notes" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Notes</label>
              <textarea id="outsource-edit-notes" className="form-input min-h-[64px] w-full resize-y py-3 text-sm" rows={2}
                value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <p className="text-xs text-slate-500">Each change is kept on the job, with who made it.</p>
          </Modal>
        )
      })()}

      {/* ── Cancel open job ───────────────────────────────────────────────── */}
      {cancelJobId && (() => {
        const job = outsourceJobs.find(j => j.id === cancelJobId)
        if (!job) return null
        const linked = job.repairOrderId ? repairs.find(r => r.id === job.repairOrderId) : null
        return (
          <Modal
            title={`Cancel ${job.ref}`}
            subtitle={`${job.deviceDescription} · ${job.vendorName}`}
            width={560}
            variant="enterprise"
            accent="#DC2626"
            icon={<Fa icon={faScrewdriverWrench} />}
            onClose={() => setCancelJobId(null)}
            footer={(
              <>
                <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => setCancelJobId(null)}>Keep the job</button>
                <button type="button" className="btn-primary min-h-11 px-5 text-sm" style={{ background: 'var(--danger)' }} onClick={submitCancelJob}>Cancel job</button>
              </>
            )}
          >
            <p className="text-sm text-slate-600">
              Use this when the machine never went, or was called back before any work. No bill is raised.
              {linked ? ` ${linked.ref} goes back to "${String(job.previousRepairStatus ?? linked.status).replace(/_/g, ' ')}" in the workshop.` : ''}
              {job.stockSerialId ? ' The stock machine moves back to where it was.' : ''}
              {' '}If the vendor did work, use Mark returned instead.
            </p>
            <div>
              <label htmlFor="outsource-cancel-reason" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Why *</label>
              <textarea id="outsource-cancel-reason" className="form-input min-h-[76px] w-full resize-y py-3 text-sm" rows={2}
                placeholder="e.g. Sent to the wrong vendor; customer collected the machine"
                value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
            </div>
          </Modal>
        )
      })()}

      {/* ── Charge the customer for outsourced work ───────────────────────── */}
      {chargeJobId && (() => {
        const job = outsourceJobs.find(j => j.id === chargeJobId)
        const linked = job?.repairOrderId ? repairs.find(r => r.id === job.repairOrderId) : null
        if (!job || !linked) return null
        return (
          <Modal
            title="Charge the customer"
            subtitle={`${job.ref} · ${linked.ref} · ${linked.customerName}`}
            width={520}
            variant="enterprise"
            accent="#16A34A"
            icon={<Fa icon={faCircleCheck} />}
            onClose={() => setChargeJobId(null)}
            footer={(
              <>
                <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => setChargeJobId(null)}>Cancel</button>
                <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={submitCharge}>Add to quote</button>
              </>
            )}
          >
            <p className="text-sm text-slate-600">
              The vendor charged {fmtKes(job.finalCost ?? 0)}. This adds a line for the {svcLabel(job.serviceType).toLowerCase()} to {linked.ref}'s quote, so it is on the customer's invoice.
            </p>
            <div>
              <label htmlFor="outsource-charge-amount" className="mb-1.5 block text-[13px] font-semibold text-slate-700">Customer pays (KSh) *</label>
              <input id="outsource-charge-amount" type="number" inputMode="decimal" className="form-input h-11 w-full text-sm"
                value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} />
              <p className="mt-1 text-xs text-slate-500">Suggested: cost + {OUTSOURCE_DEFAULT_MARKUP_PCT}% = {fmtKes(suggestedCustomerCharge(job.finalCost ?? 0))}</p>
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

            {editVendorId && (
              <div className="outsource-vendor-status">
                <label>
                  <input type="checkbox" checked={vendorForm.active} onChange={e => setVendorForm(f => ({ ...f, active: e.target.checked }))} />
                  Active — offered when sending a machine out
                </label>
                {outsourceJobs.some(j => j.vendorId === editVendorId)
                  ? <p>Vendors with jobs on record stay for their history; untick Active to stop using one.</p>
                  : (
                    <button type="button" className="outsource-act is-danger" onClick={() => {
                      if (!window.confirm(`Remove ${vendorForm.name}? It has no jobs.`)) return
                      if (deleteOutsourceVendor(editVendorId)) { setShowVendorModal(false); setEditVendorId(null) }
                    }}>Remove vendor</button>
                  )}
              </div>
            )}

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
        const vendorBills = outsourceJobs.filter(j => j.vendorId === payVendorId).map(vendorJobBill).filter((b): b is NonNullable<typeof b> => Boolean(b))
        const draftBills = vendorBills.filter(b => b.status === 'draft' && b.total > b.amountPaid)
        const payableNow = vendorBills.filter(b => b.status !== 'draft').reduce((sum, b) => sum + Math.max(0, b.total - b.amountPaid), 0)
        const unbilled = jobsNeedingBill(payVendorId)
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
                <div className="flex justify-between text-[11px] mt-1">
                  <span className="text-t2">Can be paid now (confirmed bills)</span><span className="font-semibold">{fmtKes(payableNow)}</span>
                </div>
              </div>
              {(draftBills.length > 0 || unbilled.length > 0) && (
                <p className="text-[11px] mb-3 rounded-lg px-3 py-2" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
                  Payments go through Finance against the vendor's bills.
                  {draftBills.length > 0 && <> {draftBills.map(b => b.ref).join(', ')} {draftBills.length === 1 ? 'is a draft' : 'are drafts'} — Finance confirms {draftBills.length === 1 ? 'it' : 'them'} before payment.</>}
                  {unbilled.length > 0 && <> {unbilled.map(j => j.ref).join(', ')} {unbilled.length === 1 ? 'has' : 'have'} no bill yet — use “Create bill” on the job.</>}
                </p>
              )}

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
                  {bankAccounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{bankChoiceLabel(a)}</option>)}
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
