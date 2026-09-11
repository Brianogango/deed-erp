// @ts-nocheck
'use client'

import { useState, useRef } from 'react'
import { useRepair } from './RepairContext'
import { useRepairStore, fmtKes } from '@/lib/store'
import { printRepairSticker } from '@/lib/repair-sticker'
import { Fa } from '@/components/icons'
import {
  faArrowLeft, faMicrochip, faCircleExclamation, faCamera, faImage,
  faPlay, faLink, faExternalLinkAlt, faUserCheck, faUserPlus,
  faFileInvoiceDollar, faTrash, faUpload, faSync,
  faExpand, faTools, faCheckCircle, faHistory,
  faClipboardList, faQuoteRight, faStethoscope, faWrench,
  faBoxOpen, faStickyNote, faPaperPlane, faExclamationTriangle,
  faClock, faStar, faArrowRight, faCartPlus, faBan, faShieldAlt,
  faTruck, faUndo,
} from '@fortawesome/free-solid-svg-icons'
import { STATUS_LABELS, STATUS_COLORS } from '../repair-config'
import StatusStepper from './StatusStepper'
import MessageThread from './MessageThread'
import Chatter from '@/components/erp/Chatter'
import { Modal } from '@/components/ui'
import { SecondaryActionMenu, StatusBadge } from '@/components/erp'
import { OutboundReleasePanel, OrcStatusBadge } from '../OutboundReleasePanel'
import { normalizeClientRole } from '@/lib/auth/access'
import { readGuardedImageAsDataUrl } from '@/lib/client-image-guard'
import { repairProgressOrderFor } from '@/lib/repair-progress'
import { isDirectRepairPath, isQuoteDeclinedReopenable, quotableStatusesForPath, repairPathLabel, returnableStatusesForPath, startableStatusesForPath } from '@/lib/repair-path'
import {
  BILLING_EXEMPT_REASON_LABELS,
  billingExemptLabel,
  canMarkRepairBillingExempt,
  isRepairBillingExempt,
  isRepairNoCharge,
  startableStatusesWhenBillingExempt,
  type BillingExemptReason,
} from '@/lib/repair-billing-exempt'
import { resolveDiagnosisFee, shouldChargeDiagnosisFee } from '@/lib/diagnosis-fee'
import { pickRepairPrimaryAction } from '@/lib/repair-handover'
import { buildRepairInvoiceCharges, repairBillingNeedsSync } from '@/lib/repair-invoice'
import { findSaleOrderForRepair, findSalesQuoteForRepair } from '@/lib/repair/sale-order-link'

const PROC_COLORS = {
  pending:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: '#F59E0B' },
  ordered:   { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    dot: '#3B82F6' },
  received:  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: '#10B981' },
  cancelled: { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-200',     dot: '#EF4444' },
}

function StatusChip({ status }: { status: string }) {
  return (
    <StatusBadge
      status={status}
      label={STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? undefined}
    />
  )
}

function SectionCard({ children, className = '', delay = 0, id }: { children: React.ReactNode; className?: string; delay?: number; id?: string }) {
  return (
    <section
      id={id}
      className={`repair-section-card bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden ${className}`}
      style={{ animation: 'cardUp 0.5s ease both', animationDelay: `${delay}ms`, scrollMarginTop: '9.5rem' }}
    >
      {children}
    </section>
  )
}

function SectionHeader({ icon, iconBg, title, subtitle, action, id }: any) {
  return (
    <div id={id} className="repair-section-header flex items-start sm:items-center justify-between gap-2">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center shadow-sm shrink-0 ${iconBg}`}>
          <Fa icon={icon} className="text-white text-xs sm:text-sm" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[11px] sm:text-[12px] font-black text-[var(--text-1)] uppercase tracking-wider leading-none">{title}</h3>
          {subtitle && <p className="text-[9px] sm:text-[10px] text-[var(--text-3)] font-semibold mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="repair-section-header__action shrink-0 mt-0.5 sm:mt-0">{action}</div>}
    </div>
  )
}

function InfoField({ label, value, highlight = false, mono = false }: any) {
  return (
    <div className="repair-info-field flex flex-col gap-1 min-w-0">
      <span className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">{label}</span>
      <p className={`text-[11px] sm:text-[12px] leading-tight truncate ${highlight ? 'font-black text-blue-600' : 'font-semibold text-[var(--text-2)]'} ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-[var(--text-4)] italic text-[10px]">—</span>}
      </p>
    </div>
  )
}

function ActionBtn({ onClick, href, icon, label, color, shadow, pulse = false }: any) {
  const cls = `repair-action-btn relative flex items-center gap-1.5 text-white transition-all active:scale-95 ${color} whitespace-nowrap shrink-0`
  const content = (
    <>
      <Fa icon={icon} className="text-xs shrink-0" />
      <span className="hidden sm:inline">{label}</span>
      {pulse && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-yellow-300 border-2 border-white animate-pulse" />}
    </>
  )
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{content}</a>
  return <button onClick={onClick} className={cls}>{content}</button>
}

export default function RepairDetailView() {
  const {
    activeRepair: r, currentUserId, currentUser, systemSettings, companySettings, setView, setActiveId,
    setShowAssignModal, setShowDiagnosisModal, setShowQuoteModal, setShowQAModal,
    setShowDeclineModal, setShowProcurementModal, updateRepair, showToast,
    diagReportInputRef, qcReportInputRef, handleReportUpload, uploadingDiagReport, setUploadingDiagReport, uploadingQcReport, setUploadingQcReport,
    setShowCancelModal, setShowDeleteConfirm,
    setShowEditDetailsModal, setShowStopDiagnosisModal, setShowReturnModal,
    setShowDeliveryModal, setShowMarkDeliveredConfirm,
    setShowProgressModal,
    verifyRepairIntake, startRepair, markRepairComplete, moveRepairToPreviousProgress, outsourceJobs, fileWarrantyClaim,
    markPartsArrived, closeRepairJob, markUnrepairable,
  } = useRepair()

  const { invoices, quotes, saleOrders, setModule, outboundReleases, initRelease, serials, reviewPortalPayment, leaveDeviceWithDeed, convertRetainedRepairToDonation, convertRetainedRepairToBuyBack, createTradeInFromRepair, waiveDiagnosisFee, markDiagnosisFeePaid, markRepairNoCharge } = useRepairStore()

  const [showOrcPanel, setShowOrcPanel] = useState(false)
  const [activeRepairTab, setActiveRepairTab] = useState<'overview' | 'diagnosis' | 'quote' | 'parts' | 'work' | 'handover' | 'activity'>('overview')
  const [showPaymentRejectInput, setShowPaymentRejectInput] = useState(false)
  const [paymentRejectReason, setPaymentRejectReason] = useState('')
  const [waiveFeeReason, setWaiveFeeReason] = useState('')
  const [showWaiveFeeModal, setShowWaiveFeeModal] = useState(false)
  const [showNoChargeModal, setShowNoChargeModal] = useState(false)
  const [noChargeReason, setNoChargeReason] = useState('company_mistake')
  const [noChargeNotes, setNoChargeNotes] = useState('')

  // Find existing ORC for this repair
  const repairOrc = outboundReleases?.find(o => o.repairId === r?.id && o.status !== 'voided')

  const photoInputRef = useRef(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [workNoteDraft, setWorkNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [claimNotes, setClaimNotes] = useState('')
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [showUnrepairableModal, setShowUnrepairableModal] = useState(false)
  const [unrepairableReason, setUnrepairableReason] = useState('')
  const [showLeaveDeviceModal, setShowLeaveDeviceModal] = useState(false)
  const [leaveDeviceNotes, setLeaveDeviceNotes] = useState('')
  const [leaveConvertMode, setLeaveConvertMode] = useState<'none' | 'donation' | 'buyback'>('donation')
  const [showTradeInModal, setShowTradeInModal] = useState(false)
  const [tradeInPrice, setTradeInPrice] = useState('')
  const [tradeInCondition, setTradeInCondition] = useState<'good' | 'fair' | 'poor'>('good')
  const [tradeInNotes, setTradeInNotes] = useState('')

  if (!r) return null

  const currentRole = normalizeClientRole(currentUser?.role)
  const isMyRepair  = r.assignedTechnicianId === currentUserId
  const pendingOutsourceJob = outsourceJobs?.find(job => job.repairOrderId === r.id && job.status === 'sent')
  const hasDiagnosis = !!(r.diagnosis?.findings || r.diagnosis?.faultDescription)
  const canVerify   = r.status === 'pending_verification' && ['technical_lead','director','admin_officer'].includes(currentRole)
  const canAssign   = (currentRole === 'technical_lead' || (currentRole === 'director' && systemSettings?.repAdminAssignsJobs))
    && ['received','assigned','diagnosed','awaiting_approval','approved','awaiting_parts','in_repair','qc','ready'].includes(r.status)
    && !pendingOutsourceJob
  const canDiagnose = (
      r.status === 'assigned'
      || (r.status === 'diagnosed' && !hasDiagnosis)
    ) && (isMyRepair || ['technical_lead', 'director'].includes(currentRole))
    && r.repairPath !== 'direct_repair' && !pendingOutsourceJob
  const canUpdateDiagnosis = !!r.diagnosis && (isMyRepair || ['technical_lead', 'director'].includes(currentRole))
    && r.repairPath !== 'direct_repair'
    && ['diagnosed','awaiting_approval','approved','awaiting_parts','in_repair','qc','ready'].includes(r.status)
    && !pendingOutsourceJob
  const billingExempt = isRepairBillingExempt(r)
  const noCharge = isRepairNoCharge(r)
  const canQuote    = quotableStatusesForPath(r.repairPath).includes(r.status)
    && (isDirectRepairPath(r.repairPath) || !!(r.diagnosis?.findings || r.diagnosis?.faultDescription))
    && (isMyRepair || ['director','admin_officer','technical_lead','sales_rep','finance_officer'].includes(currentUser?.role ?? ''))
    && !r.diagnosisStopped
    && !billingExempt
    && !pendingOutsourceJob
    // Lock quote editing once device is marked ready-for-collection or has been picked up.
    // `declined` is intentionally allowed — staff may revise and re-send another quote.
    && !['ready','invoiced','verified_released','delivered','closed','cancelled','unrepairable','returned','retained'].includes(r.status)
  const canStart      = (
    billingExempt
      ? startableStatusesWhenBillingExempt()
      : startableStatusesForPath(r.repairPath)
  ).includes(r.status) && isMyRepair && !pendingOutsourceJob
  const canComplete   = r.status === 'in_repair' && isMyRepair && !pendingOutsourceJob
  // QC: director/lead always; technician only if they did NOT work on this repair
  const canPerformQA  = r.status === 'qc'
    && (['director', 'technical_lead'].includes(currentUser?.role ?? '')
    || (currentUser?.role === 'technician' && !isMyRepair))
    && !pendingOutsourceJob
  const canProcure    = isMyRepair && ['assigned','diagnosed','approved','in_repair','awaiting_parts'].includes(r.status) && !pendingOutsourceJob
  const isDirector  = currentRole === 'director'
  const isDeliveryManager = ['director', 'admin_officer', 'technical_lead'].includes(currentRole)
  const isStaff     = !!currentUser
  const TERMINAL    = ['delivered','closed','cancelled','declined','unrepairable','returned','retained']
  const canCancel   = isDirector && !TERMINAL.includes(r.status)
  const canDelete   = isDirector
  const canMoveBack           = ['technical_lead', 'director'].includes(currentRole) && !TERMINAL.includes(r.status) && r.status !== 'pending_verification' && !pendingOutsourceJob
  const canScheduleDelivery   = isDeliveryManager && ['ready', 'invoiced'].includes(r.status) && !pendingOutsourceJob
  const canMarkCollected      = isDeliveryManager && ['ready', 'invoiced', 'verified_released'].includes(r.status) && !pendingOutsourceJob
  const canPrepareRelease     = isDeliveryManager && ['ready', 'invoiced'].includes(r.status) && !repairOrc && !pendingOutsourceJob
  // Managers (director/admin officer/lead tech) can correct intake details until the job is terminal
  const canEditDetails        = ['director', 'admin_officer', 'technical_lead'].includes(currentRole) && !TERMINAL.includes(r.status)
  // Customer declines repair after diagnosis — close at diagnosis stage with the diagnosis fee
  const canStopAtDiagnosis    = !billingExempt && !r.diagnosisStopped && !!r.diagnosis && !isDirectRepairPath(r.repairPath)
  const feeResolved = resolveDiagnosisFee(r, systemSettings)
  const feeApplies = shouldChargeDiagnosisFee(r) && feeResolved.amount > 0
  const canWaiveDiagnosisFee  = ['director', 'technical_lead', 'admin_officer', 'finance_officer'].includes(currentRole)
    && !isDirectRepairPath(r.repairPath)
    && feeApplies
    && r.diagnosisFeeStatus !== 'waived'
    && r.diagnosisFeeStatus !== 'invoiced'
    && r.diagnosisFeeStatus !== 'paid'
    && r.diagnosisFeeStatus !== 'not_applicable'
    && (!TERMINAL.includes(r.status) || isQuoteDeclinedReopenable(r.status))
  const canMarkDiagnosisFeePaid = ['director', 'admin_officer', 'finance_officer', 'sales_rep'].includes(currentRole)
    && !isDirectRepairPath(r.repairPath)
    && feeApplies
    && r.diagnosisFeeStatus !== 'waived'
    && r.diagnosisFeeStatus !== 'not_applicable'
    && r.diagnosisFeeStatus !== 'paid'
    && r.diagnosisFeeStatus !== 'invoiced'
    && !r.diagnosisFeePaidAt
    && (!TERMINAL.includes(r.status) || isQuoteDeclinedReopenable(r.status) || r.diagnosisStopped)
  const canMarkNoCharge = canMarkRepairBillingExempt(currentRole, r) && !pendingOutsourceJob
  const canDeclineQuote = ['director', 'admin_officer', 'technical_lead', 'sales_rep', 'finance_officer'].includes(currentRole)
    && !!r.quote
    && ['awaiting_approval', 'diagnosed', 'approved'].includes(r.status)
    && !billingExempt
    && !pendingOutsourceJob
  // Return the device unrepaired (incl. after quote decline / unrepairable)
  const canReturnDevice       = ['director', 'admin_officer', 'technical_lead'].includes(currentRole)
    && returnableStatusesForPath(r.repairPath).includes(r.status)
    && !pendingOutsourceJob
  const canLeaveDeviceWithDeed = ['director', 'admin_officer', 'technical_lead'].includes(currentRole)
    && ['received', 'assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc', 'ready'].includes(r.status)
    && !pendingOutsourceJob
  const canTradeInFromRepair = ['director', 'admin_officer', 'technical_lead'].includes(currentRole)
    && ['received', 'assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc', 'ready', 'declined', 'unrepairable', 'retained'].includes(r.status)
    && !r.retainedBuyBackId && !r.retainedDonationId
    && !pendingOutsourceJob
  const canConvertRetained = r.status === 'retained'
    && !r.retainedBuyBackId && !r.retainedDonationId
    && ['director', 'admin_officer', 'technical_lead', 'inventory_officer'].includes(currentRole)
  const canMarkPartsArrived = r.status === 'awaiting_parts'
    && ['technical_lead', 'director', 'inventory_officer'].includes(currentRole)
    && !pendingOutsourceJob
  const linkedInvoice      = invoices.find(i => i.id === (r.invoiceId ?? (r as any).linkedInvoiceId))
    ?? invoices.find(i => i.repairId === r.id)
  const linkedSaleOrder    = findSaleOrderForRepair(saleOrders, r)
  const linkedSalesQuote   = findSalesQuoteForRepair(quotes, r)
  const billingSync        = repairBillingNeedsSync({
    salesQuoteStatus: linkedSalesQuote?.status,
    saleOrderStatus: linkedSaleOrder?.status,
    invoice: linkedInvoice,
    charges: buildRepairInvoiceCharges(r, true, companySettings?.vatRate ?? 0),
  })
  const canInvoice = ['ready', 'invoiced'].includes(r.status)
    && !noCharge
    && billingSync.needed
    && !(billingSync.invoicePaid && !billingSync.matchesInvoice)
    && ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')
    && !pendingOutsourceJob
  const canCloseJob = ['delivered', 'collected'].includes(r.status)
    && ['director', 'admin_officer', 'technical_lead', 'finance_officer'].includes(currentRole)
  const canMarkUnrepairable = ['assigned', 'diagnosed', 'in_repair'].includes(r.status)
    && ['technical_lead', 'director'].includes(currentRole)
    && !pendingOutsourceJob
  const failedQcItems = (r.qcItems ?? []).filter(item => item.testedDate && !item.passed)
  const showQcFailPanel = !!(r.qcFailReason || failedQcItems.length) && ['in_repair', 'qc'].includes(r.status)
  const hasQcReport = !!(r.qcReportUrl || r.qcReportData || r.qcReportName)
  const canUpdateProgress = !TERMINAL.includes(r.status)
    && (
      ['approved', 'awaiting_parts', 'in_repair', 'ready'].includes(r.status)
      || (r.status === 'invoiced' && canInvoice)
    )
    && (isMyRepair || ['director', 'technical_lead', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? ''))
    && !pendingOutsourceJob

  const linkedOutsourceJob = pendingOutsourceJob ?? outsourceJobs.find(j => j.repairOrderId === r.id)

  const hasProc      = (r.procurementRequests?.length ?? 0) > 0
  const hasPartsUsed = (r.partsUsed?.length ?? 0) > 0

  const quoteDecisionTotals = (r.quote?.lines ?? []).reduce((totals, line) => {
    const amount = Number(line.subtotal ?? 0)
    if (line.decision === 'approved') totals.approved += amount
    if (line.decision === 'declined') totals.declined += amount
    if (line.decision === 'deferred') totals.deferred += amount
    return totals
  }, { approved: 0, declined: 0, deferred: 0 })
  const quotedDecisionTotal = Number(r.quote?.total ?? 0)
  const approvedDecisionTotal = quoteDecisionTotals.approved || Number(r.quote?.approvedTotal ?? 0)
  const declinedDecisionTotal = quoteDecisionTotals.declined || (isQuoteDeclinedReopenable(r.status) ? quotedDecisionTotal : 0)
  const hasApprovedQuoteLines = approvedDecisionTotal > 0

  const nextActionHint = pendingOutsourceJob ? `Device is at ${pendingOutsourceJob.vendorName} via ${pendingOutsourceJob.ref}. Mark it returned in Outsource before continuing.`
    : isQuoteDeclinedReopenable(r.status) ? 'Customer declined this quote — revise and re-send, or return the device'
    : canDiagnose ? 'Log your technical diagnosis to proceed'
    : canMarkPartsArrived ? 'Confirm parts have arrived so the technician can start'
    : canStart     ? (billingExempt ? 'No-charge job — start the repair (quote & billing skipped)' : 'Start the repair')
    : canComplete  ? 'Mark repair complete to submit for QA'
    : canPerformQA ? 'Perform QC check — repair is ready for testing'
    : canInvoice   ? (billingSync.canRewriteInvoice || billingSync.quoteOpen || billingSync.saleOrderOpen
      ? 'Rebuild the invoice from the approved quote and convert the quotation'
      : 'Generate the customer invoice before release')
    : canQuote && !r.quote ? 'Generate a repair quote'
    : canQuote && r.quote ? 'Update or re-send the quote to move forward'
    : canCloseJob  ? 'Close the job after collection'
    : canMarkCollected ? 'Record pickup — mark collected when the device is handed over'
    : r.status === 'awaiting_parts' ? 'Parts are being sourced — monitor procurement below'
    : r.status === 'diagnosed' && !hasDiagnosis ? 'Diagnosis stage has no findings — log diagnosis to continue'
    : r.status === 'diagnosed' && billingExempt ? 'No-charge job — assign/start repair without quoting'
    : r.status === 'diagnosed' ? 'Generate or edit the quote to continue past diagnosis'
    : null

  // Exactly one dominant workflow CTA. Routine secondary actions live inside
  // the section they affect; the header overflow is reserved for rare record
  // administration only.
  const primaryActionId = pickRepairPrimaryAction({
    canVerify,
    canMarkPartsArrived,
    canStart,
    canComplete,
    canPerformQA,
    canInvoice,
    canPrepareRelease,
    canMarkCollected,
    canCloseJob,
    canDiagnose,
    canUpdateDiagnosis,
    canQuote,
    canAssign,
    quoteDeclinedReopenable: isQuoteDeclinedReopenable(r.status),
    noCharge,
    serialNumber: r.serialNumber,
    repairOrcStatus: repairOrc?.status,
  })

  const openNoCharge = () => {
    setNoChargeReason('company_mistake')
    setNoChargeNotes('')
    setShowNoChargeModal(true)
  }

  const openLeaveDevice = () => {
    setLeaveDeviceNotes('')
    setLeaveConvertMode('donation')
    setShowLeaveDeviceModal(true)
  }

  const openTradeIn = () => {
    setTradeInPrice('')
    setTradeInCondition(
      (r.deviceCondition === 'poor' || r.deviceCondition === 'damaged')
        ? 'poor'
        : r.deviceCondition === 'fair'
          ? 'fair'
          : 'good',
    )
    setTradeInNotes('')
    setShowTradeInModal(true)
  }

  const openPrepareRelease = () => {
    const repairSerial = r.serialNumber
      ? serials.find(s => s.id === r.serialNumber || s.serial === r.serialNumber || s.barcode === r.serialNumber)
      : undefined
    initRelease({
      repairId: r.id,
      clientId: r.customerId || '',
      clientName: r.customerName,
      sourceRef: r.ref,
      sourceType: 'repair',
      serials: r.serialNumber ? [{ serialNumberId: repairSerial?.id || '', expectedSerial: r.serialNumber }] : [],
    })
    setShowOrcPanel(true)
  }

  const handleVerify = () => {
    verifyRepairIntake(r.id)
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    try {
      const dataUrl = await readGuardedImageAsDataUrl(file, { label: 'Repair photo', maxBytes: 5 * 1024 * 1024 })
      const res = await fetch(`/api/repair-photos/${encodeURIComponent(r.ref)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: dataUrl, name: file.name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Upload failed')
      }
      const data = await res.json()
      const newPhoto = { url: data.photo.url, name: data.photo.name, date: data.photo.uploaded_at, _id: data.photo.id }
      updateRepair(r.id, { issuePhotos: [...(r.issuePhotos || []), newPhoto] })
      showToast('Photo uploaded', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Photo upload failed', 'error')
    } finally {
      setUploadingPhoto(false)
      e.target.value = ''
    }
  }

  const removePhoto = async (idx) => {
    const photos = [...(r.issuePhotos || [])]
    const photo = photos[idx]
    const photoId = (photo as any)._id
    if (photoId) {
      try {
        await fetch(`/api/repair-photos/${encodeURIComponent(r.ref)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: photoId }),
        })
      } catch { /* ignore — still remove from local state */ }
    }
    photos.splice(idx, 1)
    updateRepair(r.id, { issuePhotos: photos })
  }


  const portalUrl  = `https://erp.deed.co.ke/portal/repair/${r.ref}`
  const copyLink   = () => {
    navigator.clipboard.writeText(portalUrl)
    setCopiedLink(true)
    showToast('Portal link copied!', 'success')
    setTimeout(() => setCopiedLink(false), 2000)
  }
  const accentColor = STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#3B82F6'
  const intakeTimestamp = new Date(r.intakeDate || Date.now()).getTime()
  const repairAgeDays = Number.isFinite(intakeTimestamp)
    ? Math.max(0, Math.floor((Date.now() - intakeTimestamp) / 86400000))
    : 0
  const scrollToRepairSection = (id: string) => {
    const sectionTabs: Record<string, typeof activeRepairTab> = {
      'repair-overview': 'overview',
      'repair-diagnosis': 'diagnosis',
      'repair-diagnosis-financials': 'quote',
      'repair-parts': 'parts',
      'repair-qc': 'work',
      'repair-delivery': 'handover',
      'repair-history': 'activity',
    }
    const nextTab = sectionTabs[id]
    if (nextTab) setActiveRepairTab(nextTab)
    requestAnimationFrame(() => {
      document.querySelector('.repair-detail__tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const tabButtonClass = (tab: typeof activeRepairTab) =>
    `repair-detail__tab border transition-colors ${activeRepairTab === tab
      ? 'repair-detail__tab--active border-sky-200 bg-sky-50 text-sky-700'
      : 'border-transparent text-[var(--text-3)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-1)]'
    }`

  return (
    <div className="repair-detail bg-[var(--bg-page)] pb-8" style={{ animation: 'fadeIn 0.3s ease both' }}>
      <input type="file" ref={photoInputRef} onChange={handlePhotoUpload} accept="image/jpeg,image/png,image/webp" className="hidden" />
      <input type="file" ref={diagReportInputRef} accept=".pdf,.doc,.docx" className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (!file) return
          setUploadingDiagReport(true)
          handleReportUpload(file, 'diagnosisReportData', 'diagnosisReportName', r.id, setUploadingDiagReport)
          e.target.value = ''
        }}
      />
      <input type="file" ref={qcReportInputRef} accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,image/jpeg,image/png,image/webp" className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (!file) return
          setUploadingQcReport(true)
          handleReportUpload(file, 'qcReportData', 'qcReportName', r.id, setUploadingQcReport)
          e.target.value = ''
        }}
      />

      {/* ── Header ── */}
      <header className="repair-detail__header erp-record-header sticky top-0 z-30">
        <div className="repair-detail__header-row w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">

          {/* Left: back + title */}
          <div className="repair-detail__identity flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              aria-label="Back to repair list"
              onClick={() => { setActiveId(null); setView('list') }}
              className="w-11 h-11 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] text-[var(--text-2)] flex items-center justify-center transition-colors shrink-0"
            >
              <Fa icon={faArrowLeft} className="text-sm" />
            </button>
            <div className="repair-detail__identity-content flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
              <h2 className="erp-record-title shrink-0">{r.productName}</h2>
              <span className="repair-detail__status-chip">
                <StatusChip status={r.status} />
              </span>
              <span className="hidden md:flex items-center gap-1.5 text-xs font-medium text-[var(--text-3)] min-w-0">
                <span className="font-mono text-[var(--text-2)] font-semibold truncate max-w-[150px]">{r.ref}</span>
                <span className="text-[var(--border)]">·</span>
                <span className="text-[var(--text-1)] font-semibold truncate max-w-[180px]">{r.customerName}</span>
                <span className="text-[var(--border)]">·</span>
                <span className="text-[var(--text-3)] truncate max-w-[220px]" title={r.issueDescription}>{r.issueDescription || 'Repair assessment'}</span>
              </span>
              <span className="repair-detail__mobile-meta md:hidden text-xs font-medium text-[var(--text-3)] truncate max-w-full">
                <span className="font-mono">{r.ref}</span> · {r.customerName}
              </span>
              {isMyRepair && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--success-bg)] text-[var(--success-text)] text-[11px] font-semibold">
                  Your job
                </span>
              )}
              <span
                className={`repair-detail__path-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${
                  isDirectRepairPath(r.repairPath)
                    ? 'bg-violet-50 text-violet-700 border-violet-200'
                    : 'bg-sky-50 text-sky-700 border-sky-200'
                }`}
                title={isDirectRepairPath(r.repairPath) ? 'Bypasses diagnosis; quotes auto-approve' : 'Tech diagnoses before quoting'}
              >
                {repairPathLabel(r.repairPath)}
              </span>
              {billingExempt && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border bg-rose-50 text-rose-700 border-rose-200"
                  title={r.billingExemptNotes || 'No customer quote or invoice'}
                >
                  No-charge · {billingExemptLabel(r) || 'Company mistake'}
                </span>
              )}
            </div>
          </div>

          {/* One primary workflow action + overflow for secondary/danger */}
          <div className="repair-detail__actions section-actions">
            <div className="repair-detail__action-context">
              {pendingOutsourceJob && r.status === 'in_repair' && (
              <span className="badge badge-amber" title={`Waiting for ${pendingOutsourceJob.ref} to be marked returned`}>
                Waiting outsource return
              </span>
            )}
            {repairOrc && (
              <OrcStatusBadge release={repairOrc} onClick={() => setShowOrcPanel(true)} />
            )}
              {r.warrantyClaimId && (
                <span className="badge badge-green">{r.warrantyClaimId}</span>
              )}
            </div>

            <div className="repair-detail__action-controls" data-has-primary={Boolean(primaryActionId)}>
              <div className="repair-detail__primary-action hidden">
                {primaryActionId === 'verify' && (
              <ActionBtn onClick={handleVerify} icon={faUserCheck} label="Verify intake" color="bg-emerald-600 hover:bg-emerald-700" shadow="shadow-emerald-100" />
            )}
            {primaryActionId === 'assign' && (
              <ActionBtn onClick={() => setShowAssignModal(true)} icon={faUserPlus} label={r.assignedTechnicianId ? 'Reassign' : 'Assign technician'} color="bg-slate-900 hover:bg-black" shadow="shadow-slate-200" />
            )}
            {primaryActionId === 'diagnose' && (
              <ActionBtn onClick={() => setShowDiagnosisModal(true)} icon={faStethoscope} label={canUpdateDiagnosis && !canDiagnose ? 'Update diagnosis' : 'Log diagnosis'} color="bg-blue-600 hover:bg-blue-700" shadow="shadow-blue-100" pulse={canDiagnose} />
            )}
            {primaryActionId === 'quote' && !isQuoteDeclinedReopenable(r.status) && (
              <ActionBtn
                onClick={() => setShowQuoteModal(true)}
                icon={faFileInvoiceDollar}
                label={isQuoteDeclinedReopenable(r.status) ? 'Revise quote' : r.quote ? 'Update quote' : 'Generate quote'}
                color="bg-indigo-600 hover:bg-indigo-700"
                shadow="shadow-indigo-100"
                pulse
              />
            )}
            {primaryActionId === 'start' && (
              <ActionBtn onClick={() => startRepair(r.id)} icon={faPlay} label="Start repair" color="bg-violet-600 hover:bg-violet-700" shadow="shadow-violet-100" pulse />
            )}
            {primaryActionId === 'complete' && (
              <ActionBtn onClick={() => markRepairComplete(r.id)} icon={faCheckCircle} label="Mark complete" color="bg-emerald-600 hover:bg-emerald-700" shadow="shadow-emerald-100" pulse />
            )}
            {primaryActionId === 'qc' && (
              <ActionBtn onClick={() => setShowQAModal(true)} icon={faStar} label="Perform QC" color="bg-pink-600 hover:bg-pink-700" shadow="shadow-pink-100" pulse />
            )}
            {primaryActionId === 'parts_arrived' && (
              <ActionBtn onClick={() => markPartsArrived(r.id)} icon={faBoxOpen} label="Mark parts arrived" color="bg-orange-600 hover:bg-orange-700" shadow="shadow-orange-100" pulse />
            )}
            {primaryActionId === 'invoice' && (
              <ActionBtn onClick={() => setShowProgressModal(true)} icon={faFileInvoiceDollar} label={billingSync.canRewriteInvoice || billingSync.quoteOpen ? 'Align invoice with quote' : 'Create invoice'} color="bg-amber-600 hover:bg-amber-700" shadow="shadow-amber-100" pulse />
            )}
            {primaryActionId === 'prepare_release' && (
              <ActionBtn
                onClick={openPrepareRelease}
                icon={faBoxOpen}
                label="Prepare release"
                color="bg-violet-600 hover:bg-violet-700"
                shadow="shadow-violet-100"
                pulse
              />
            )}
            {primaryActionId === 'collect' && (
              <ActionBtn onClick={() => setShowMarkDeliveredConfirm(true)} icon={faTruck} label="Mark collected" color="bg-teal-600 hover:bg-teal-700" shadow="shadow-teal-100" pulse={repairOrc?.status === 'verified'} />
            )}
            {primaryActionId === 'close' && (
              <ActionBtn onClick={() => closeRepairJob(r.id)} icon={faCheckCircle} label="Close job" color="bg-slate-800 hover:bg-slate-900" shadow="shadow-slate-200" />
            )}

              </div>
              <div className="repair-detail__more-action">
                <SecondaryActionMenu
                  ariaLabel="Repair record administration"
                  mobilePresentation="anchored"
                  actions={[
                    { id: 'cancel', label: 'Cancel repair', onClick: () => setShowCancelModal(true), hidden: !canCancel, danger: true },
                    { id: 'delete', label: 'Delete repair', onClick: () => setShowDeleteConfirm(true), hidden: !canDelete, danger: true },
                  ]}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Next-action hint for assigned tech or QA performer */}
        {(isMyRepair || canPerformQA) && nextActionHint && !isQuoteDeclinedReopenable(r.status) && (
          <div className="max-w-[1600px] mx-auto mt-2.5">
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[rgba(37,99,235,0.08)] border border-blue-500/25">
              <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                <Fa icon={faArrowRight} className="text-white text-[8px]" />
              </div>
              <p className="text-[11px] font-bold text-[var(--text-2)]">
                <span className="font-black text-blue-600">Next step: </span>{nextActionHint}
              </p>
            </div>
          </div>
        )}
      </header>

      <section className="repair-detail__progress" aria-label="Repair progress">
        <div className="repair-detail__desktop-progress">
          <StatusStepper
            currentStatus={r.status}
            history={r.statusHistory || []}
            steps={repairProgressOrderFor(r)}
          />
        </div>
        <div className="repair-detail__mobile-stage">
          <span>Current stage</span>
          <strong>{STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status.replace(/_/g, ' ')}</strong>
          <div className="repair-detail__mobile-track"><i style={{ width: `${Math.max(12, ((repairProgressOrderFor(r).indexOf(r.status) + 1) / Math.max(repairProgressOrderFor(r).length, 1)) * 100)}%` }} /></div>
          <p><b>Next:</b> {nextActionHint || 'Continue the repair workflow'}</p>
        </div>
        {canMoveBack && (
          <div className="flex justify-end px-3 sm:px-5 pb-2">
            <button
              type="button"
              onClick={() => moveRepairToPreviousProgress(r.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-[var(--text-3)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-1)] transition-colors"
            >
              <Fa icon={faUndo} className="text-[9px]" />
              Previous stage
            </button>
          </div>
        )}
      </section>

      {isQuoteDeclinedReopenable(r.status) && (
        <section className="mx-auto mt-3 w-[min(1600px,calc(100%-1.5rem))] overflow-hidden rounded-2xl border border-red-200 bg-[var(--bg-card)]" aria-labelledby="declined-quote-title">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              <div className="border-b border-red-200 bg-red-50/70 px-4 py-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
                    <Fa icon={faBan} className="text-[13px]" />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-red-600">Customer decision</p>
                    <h2 id="declined-quote-title" className="m-0 text-[16px] font-black text-[var(--text-1)] sm:text-[18px]">Customer declined the quotation</h2>
                    <p className="mt-1 text-[11px] font-semibold leading-5 text-[var(--text-3)]">
                      This repair remains open. Revise the quotation or record the device handover outcome.
                    </p>
                    {r.quote?.rejectionReason && (
                      <p className="mt-2 rounded-lg border border-red-200 bg-white/80 px-3 py-2 text-[11px] font-bold text-[var(--text-2)]">
                        <span className="text-red-600">Reason:</span> {r.quote.rejectionReason}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 border-b border-[var(--border-lt)] sm:grid-cols-4">
                <div className="border-b border-r border-[var(--border-lt)] px-4 py-3 sm:border-b-0"><span className="block text-[9px] font-black uppercase tracking-wider text-[var(--text-4)]">Quoted</span><strong className="mt-1 block text-[15px] font-black text-[var(--text-1)]">{fmtKes(quotedDecisionTotal)}</strong></div>
                <div className="border-b border-[var(--border-lt)] px-4 py-3 sm:border-b-0 sm:border-r"><span className="block text-[9px] font-black uppercase tracking-wider text-[var(--text-4)]">Approved</span><strong className="mt-1 block text-[15px] font-black text-emerald-600">{fmtKes(approvedDecisionTotal)}</strong></div>
                <div className="border-r border-[var(--border-lt)] px-4 py-3"><span className="block text-[9px] font-black uppercase tracking-wider text-[var(--text-4)]">Declined</span><strong className="mt-1 block text-[15px] font-black text-red-600">{fmtKes(declinedDecisionTotal)}</strong></div>
                <div className="px-4 py-3"><span className="block text-[9px] font-black uppercase tracking-wider text-[var(--text-4)]">Deferred</span><strong className="mt-1 block text-[15px] font-black text-amber-600">{fmtKes(quoteDecisionTotals.deferred)}</strong></div>
              </div>

              {(r.quote?.lines?.length ?? 0) > 0 && (
                <div className="px-4 py-4 sm:px-5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="m-0 text-[12px] font-black text-[var(--text-1)]">Quotation and customer decisions</h3>
                    <button type="button" onClick={() => scrollToRepairSection('repair-diagnosis-financials')} className="text-[10px] font-black text-sky-600 hover:text-sky-700">View full quote</button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                    {(r.quote?.lines ?? []).map((line, index) => (
                      <div key={index} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-[var(--bg-card)] px-3 py-2.5 ${index ? 'border-t border-[var(--border-lt)]' : ''}`}>
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-bold text-[var(--text-2)]">{line.description}</p>
                          <p className="mt-0.5 text-[9px] capitalize text-[var(--text-4)]">{line.type} · qty {line.qty}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <strong className="text-[11px] font-black text-[var(--text-1)]">{fmtKes(line.subtotal)}</strong>
                          <span className={`min-w-[68px] rounded-full border px-2 py-1 text-center text-[8px] font-black uppercase tracking-wider ${
                            line.decision === 'approved'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : line.decision === 'deferred'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-red-200 bg-red-50 text-red-700'
                          }`}>{line.decision || 'Declined'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="border-t border-[var(--border)] bg-[var(--bg-surface)] p-4 xl:border-l xl:border-t-0 sm:p-5" aria-label="Declined quote next actions">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-sky-600">Next action</p>
              <h3 className="mt-1 text-[15px] font-black text-[var(--text-1)]">{hasApprovedQuoteLines ? 'Resolve the quotation scope' : 'Choose how to continue'}</h3>
              <p className="mt-1 text-[10px] leading-4 text-[var(--text-4)]">Nothing happens automatically after a decline. Select and record the appropriate outcome.</p>

              <div className="mt-4 space-y-2">
                {canQuote && (
                  <button type="button" className="btn-primary flex min-h-10 w-full items-center justify-center gap-2 px-4 text-[11px]" onClick={() => setShowQuoteModal(true)}>
                    <Fa icon={faSync} className="text-[10px]" /> Revise &amp; re-send quote
                  </button>
                )}
                {canReturnDevice && (
                  <button type="button" className="btn-secondary flex min-h-10 w-full items-center justify-center gap-2 px-4 text-[11px]" onClick={() => setShowReturnModal(true)}>
                    <Fa icon={faUndo} className="text-[10px]" /> Arrange device return
                  </button>
                )}
                {canTradeInFromRepair && (
                  <button type="button" className="btn-secondary flex min-h-10 w-full items-center justify-center gap-2 px-4 text-[11px]" onClick={openTradeIn}>
                    <Fa icon={faSync} className="text-[10px]" /> Trade-in evaluation
                  </button>
                )}
              </div>

              <ol className="mt-5 space-y-3 border-t border-[var(--border)] pt-4">
                <li className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[9px] font-black text-white">1</span><div><strong className="block text-[10px] text-[var(--text-2)]">Review the customer decision</strong><span className="text-[9px] text-[var(--text-4)]">Check declined and deferred lines.</span></div></li>
                <li className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-muted)] text-[9px] font-black text-[var(--text-3)]">2</span><div><strong className="block text-[10px] text-[var(--text-2)]">Record one outcome</strong><span className="text-[9px] text-[var(--text-4)]">Revise, return, or evaluate trade-in.</span></div></li>
                <li className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-muted)] text-[9px] font-black text-[var(--text-3)]">3</span><div><strong className="block text-[10px] text-[var(--text-2)]">Continue from the new state</strong><span className="text-[9px] text-[var(--text-4)]">The existing repair workflow resumes.</span></div></li>
              </ol>
            </aside>
          </div>
        </section>
      )}

      <section className="repair-detail__summary" aria-label="Repair summary">
        <div><span>Next action</span><strong>{nextActionHint || 'Review job activity'}</strong></div>
        <div><span>Age</span><strong>{repairAgeDays} day{repairAgeDays === 1 ? '' : 's'}</strong></div>
        <div><span>{r.quote ? 'Approved total' : 'Estimate'}</span><strong>{fmtKes(r.quote?.approvedTotal ?? r.quote?.total ?? r.total ?? 0)}</strong></div>
        <div><span>Technician</span><strong>{r.assignedTechnicianName || 'Unassigned'}</strong><small>{pendingOutsourceJob ? pendingOutsourceJob.vendorName : 'In shop'}</small></div>
      </section>

      <nav className="repair-detail__tabs" aria-label="Repair record sections">
        <button className={tabButtonClass('overview')} type="button" onClick={() => setActiveRepairTab('overview')}>Overview</button>
        <button className={tabButtonClass('diagnosis')} type="button" onClick={() => setActiveRepairTab('diagnosis')}>Diagnosis</button>
        <button className={tabButtonClass('quote')} type="button" onClick={() => setActiveRepairTab('quote')}>Quote</button>
        <button className={tabButtonClass('parts')} type="button" onClick={() => setActiveRepairTab('parts')}>Parts</button>
        <button className={tabButtonClass('work')} type="button" onClick={() => setActiveRepairTab('work')}>Work &amp; QC</button>
        <button className={tabButtonClass('handover')} type="button" onClick={() => setActiveRepairTab('handover')}>Handover</button>
        <button className={tabButtonClass('activity')} type="button" onClick={() => setActiveRepairTab('activity')}>Activity</button>
      </nav>

      {/* ── Body ── */}
      <div className="repair-detail__body">
        <div className="repair-detail__grid grid grid-cols-1 lg:grid-cols-12">

          {/* ═══ Left Column ═══ */}
          <div className={`repair-detail__main lg:col-span-8 ${['quote', 'handover', 'activity'].includes(activeRepairTab) ? 'hidden' : ''}`}>

            {/* Device & Client */}
            <SectionCard delay={60} id="repair-overview" className={activeRepairTab === 'overview' ? '' : 'hidden'}>
              <SectionHeader
                icon={faMicrochip}
                iconBg="bg-slate-800"
                title="Device & Client"
                subtitle="Intake profile"
                action={
                  <SecondaryActionMenu
                    label="Device"
                    ariaLabel="Device actions"
                    mobilePresentation="anchored"
                    actions={[
                      { id: 'edit', label: 'Edit details', onClick: () => setShowEditDetailsModal(true), hidden: !canEditDetails },
                      { id: 'sticker', label: 'Print sticker', onClick: () => { void printRepairSticker(r) } },
                    ]}
                  />
                }
              />
              <div className="px-4 sm:px-6 py-4 sm:py-5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-8 gap-y-4 sm:gap-y-5">
                <InfoField label={r.contactPersonName ? "Company" : "Client"} value={r.customerName} highlight />
                {r.contactPersonName && (
                  <InfoField label="Contact Person" value={`${r.contactPersonName}${r.contactPersonTitle ? ` — ${r.contactPersonTitle}` : ''}`} highlight />
                )}
                <InfoField label={r.contactPersonName ? "Company Phone" : "Phone"} value={r.customerPhone} />
                {r.contactPersonName && <InfoField label="Contact Phone" value={r.contactPersonPhone} />}
                <InfoField label={r.contactPersonName ? "Company Email" : "Email"} value={r.customerEmail} />
                {r.contactPersonName && <InfoField label="Contact Email" value={r.contactPersonEmail} />}
                <InfoField label="Device"      value={r.productName} />
                <InfoField label="Serial No."  value={r.serialNumber}                                        mono />
                <InfoField label="Colour"      value={r.deviceColor ?? r.deviceColour} />
                <InfoField label="Condition"   value={r.deviceCondition} />
                <InfoField label="Laptop Password" value={r.clientLaptopPassword} mono />
                <InfoField label="Priority"    value={r.priority}    highlight={['high','urgent'].includes(r.priority)} />
                <InfoField label="Channel"     value={r.intakeChannel?.replace(/_/g,' ')} />
                {canAssign ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">Technician</span>
                    <button
                      onClick={() => setShowAssignModal(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 -ml-2.5 rounded-lg cursor-pointer hover:bg-[rgba(37,99,235,0.08)] transition-colors text-left w-fit"
                    >
                      <Fa icon={faUserPlus} className="text-blue-500 text-[9px] shrink-0" />
                      <span className={`text-[13px] font-black ${r.assignedTechnicianId ? 'text-[var(--text-1)]' : 'text-amber-500'}`}>
                        {r.assignedTechnicianName ?? 'Unassigned'}
                      </span>
                      <span className="text-[9px] font-black text-blue-600 px-1.5 py-0.5 rounded-md bg-[rgba(37,99,235,0.1)] border border-blue-500/20 uppercase tracking-wide whitespace-nowrap">
                        {r.assignedTechnicianId ? 'Reassign' : 'Assign'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <InfoField label="Technician" value={r.assignedTechnicianName ?? 'Unassigned'} highlight={!!r.assignedTechnicianId} />
                )}
                <InfoField
                  label="Booked At"
                  value={(() => {
                    const raw = String(r.intakeDate || '')
                    const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`)
                    if (Number.isNaN(d.getTime())) return raw || '—'
                    return d.toLocaleString('en-KE', {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit', hour12: false,
                    })
                  })()}
                />
                <InfoField label="Booked By"   value={r.bookedByName ?? r.createdBy} />
                <InfoField label="Verified By" value={r.verifiedBy} />
              </div>
              {/* SLA strip */}
              {r.slaDeadline && (
                <div className={`mx-4 sm:mx-6 mb-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border ${r.slaMissed ? 'bg-[rgba(239,68,68,0.08)] border-red-500/25' : 'bg-[rgba(245,158,11,0.08)] border-amber-500/25'}`}>
                  <Fa icon={faClock} className={`text-xs ${r.slaMissed ? 'text-red-500' : 'text-amber-500'}`} />
                  <span className={`text-[10px] font-black ${r.slaMissed ? 'text-red-500' : 'text-amber-600'}`}>
                    SLA deadline: {new Date(r.slaDeadline).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {r.slaMissed && <span className="ml-2 uppercase tracking-wider">· Missed</span>}
                  </span>
                </div>
              )}

              {/* Scheduled delivery job link */}
              {r.deliveryMethod === 'delivery' && r.deliveryJobId && r.status !== 'delivered' && (
                <div className="mx-4 sm:mx-6 mb-4 flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[rgba(20,184,166,0.08)] border border-teal-500/25">
                  <div className="w-6 h-6 rounded-lg bg-teal-500 flex items-center justify-center shrink-0">
                    <Fa icon={faTruck} className="text-white text-[9px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black text-teal-600 uppercase tracking-widest">Rider Delivery Scheduled</p>
                    <p className="text-[11px] font-semibold text-[var(--text-2)]">
                      {r.deliveryRiderName ? `Assigned to ${r.deliveryRiderName}` : 'Rider not yet assigned'}
                      {r.deliveryScheduledDate ? ` · ${new Date(r.deliveryScheduledDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}` : ''}
                    </p>
                  </div>
                  <span className="text-[9px] font-black text-teal-600 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full shrink-0 font-mono">
                    {r.deliveryJobId.slice(-6).toUpperCase()}
                  </span>
                </div>
              )}

              {/* Delivery handover strip */}
              {r.status === 'delivered' && r.deliveryRecipient && (
                <div className="mx-4 sm:mx-6 mb-4 flex items-center gap-3 px-3.5 py-3 rounded-xl bg-[rgba(16,185,129,0.08)] border border-emerald-500/25">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0">
                    <Fa icon={faTruck} className="text-white text-[9px]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Device Collected</p>
                    <p className="text-[11px] font-semibold text-[var(--text-2)] truncate">
                      {r.deliveryRecipient}
                      {r.deliveryRecipientIsRep && r.deliveryRecipientRelationship
                        ? ` (${r.deliveryRecipientRelationship} — on behalf of client)`
                        : r.deliveryRecipientIsRep ? ' (Representative)' : ''}
                      {r.deliveryActualDate
                        ? ` · ${new Date(r.deliveryActualDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : ''}
                    </p>
                  </div>
                </div>
              )}

              {/* Linked invoice strip */}
              {r.invoiceId && linkedInvoice && (
                <div
                  className="mx-4 sm:mx-6 mb-4 flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[rgba(99,102,241,0.08)] border border-indigo-500/25 cursor-pointer hover:bg-[rgba(99,102,241,0.12)] transition-colors"
                  onClick={() => setModule('accounting')}
                >
                  <div className="w-6 h-6 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
                    <Fa icon={faFileInvoiceDollar} className="text-white text-[9px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Invoice Linked</p>
                    <p className="text-[11px] font-semibold text-[var(--text-2)]">
                      {linkedInvoice.ref} · {fmtKes(linkedInvoice.total)} · <span className="capitalize">{linkedInvoice.status}</span>{r.paymentConfirmationStatus ? ` · Portal payment: ${r.paymentConfirmationStatus.replace('_', ' ')}` : ''}
                    </p>
                  </div>
                  <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full shrink-0">View →</span>
                </div>
              )}

              {/* Outsource job strip */}
              {linkedOutsourceJob && (
                <a
                  href={`/outsource?tab=jobs&id=${encodeURIComponent(linkedOutsourceJob.id)}`}
                  className="mx-4 sm:mx-6 mb-4 flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[rgba(245,158,11,0.08)] border border-amber-500/25 hover:bg-[rgba(245,158,11,0.14)] transition-colors"
                >
                  <div className="w-6 h-6 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
                    <Fa icon={faTools} className="text-white text-[9px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Outsourced to Vendor</p>
                    <p className="text-[11px] font-semibold text-[var(--text-2)]">
                      {linkedOutsourceJob.vendorName} · {linkedOutsourceJob.ref} · <span className="capitalize">{linkedOutsourceJob.status.replace(/_/g, ' ')}</span>
                    </p>
                  </div>
                  <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">
                    Open →
                  </span>
                </a>
              )}
            </SectionCard>

            {/* Reported Issue */}
            <SectionCard delay={130} className={activeRepairTab === 'overview' ? '' : 'hidden'}>
              <SectionHeader
                icon={faCircleExclamation}
                iconBg="bg-amber-500"
                title="Reported Issue"
                subtitle="Customer's description"
                action={
                  <SecondaryActionMenu
                    label="Issue"
                    ariaLabel="Issue assessment actions"
                    mobilePresentation="anchored"
                    actions={[
                      { id: 'unrepairable', label: 'Mark unrepairable', onClick: () => { setUnrepairableReason(''); setShowUnrepairableModal(true) }, hidden: !canMarkUnrepairable, danger: true },
                      { id: 'claim', label: 'File warranty claim', onClick: () => setShowClaimModal(true), hidden: !(r.underWarranty && !r.warrantyClaimId && ['director', 'admin_officer', 'finance_officer'].includes(currentUser?.role ?? '')) },
                    ]}
                  />
                }
              />
              <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-3">
                <div className="bg-[var(--bg-surface)] rounded-xl p-4 sm:p-5 border border-[var(--border)]">
                  <Fa icon={faClipboardList} className="text-amber-500 text-base mb-2.5" />
                  <p className="text-[13px] sm:text-[14px] text-[var(--text-1)] leading-relaxed font-semibold">
                    {r.issueDescription || 'No issue description provided'}
                  </p>
                  {r.intakeNotes && (
                    <div className="mt-3 pt-3 border-t border-[var(--border)]">
                      <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">Intake Notes</p>
                      <p className="text-[12px] text-[var(--text-2)] leading-relaxed">{r.intakeNotes}</p>
                    </div>
                  )}
                </div>
                {billingExempt && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[rgba(225,29,72,0.08)] border border-rose-500/30">
                    <div className="w-7 h-7 rounded-lg bg-rose-600 flex items-center justify-center shrink-0">
                      <Fa icon={faBan} className="text-white text-xs" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-rose-700 uppercase tracking-widest">
                        No-charge — {billingExemptLabel(r) || 'Company mistake'}
                      </p>
                      <p className="text-[10px] text-rose-800 mt-0.5">
                        Quote approval and customer invoicing skipped.
                        {r.billingExemptBy ? ` Marked by ${r.billingExemptBy}.` : ''}
                        {r.billingExemptNotes ? ` ${r.billingExemptNotes}` : ''}
                      </p>
                    </div>
                  </div>
                )}
                {r.underWarranty && (() => {
                  const cov = r.warrantyCoverage
                  if (cov === 'full') return (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[rgba(16,185,129,0.08)] border border-emerald-500/30">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0">
                        <Fa icon={faShieldAlt} className="text-white text-xs" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Full Warranty Coverage</p>
                        <p className="text-[10px] text-emerald-700 mt-0.5">Company covers 100% — no charge to client. Quote auto-approved.</p>
                      </div>
                    </div>
                  )
                  if (cov === 'partial') return (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[rgba(37,99,235,0.08)] border border-blue-500/30">
                      <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                        <Fa icon={faShieldAlt} className="text-white text-xs" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Partial Warranty Coverage</p>
                        <p className="text-[10px] text-[var(--text-2)] mt-0.5">Client pays for uncovered items only. Quote approval required.</p>
                      </div>
                    </div>
                  )
                  if (cov === 'void') return (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[rgba(245,158,11,0.08)] border border-amber-500/30">
                      <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
                        <Fa icon={faShieldAlt} className="text-white text-xs" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Warranty Voided</p>
                        <p className="text-[10px] text-[var(--text-2)] mt-0.5">Client-caused damage — warranty does not apply. Client pays in full.</p>
                      </div>
                    </div>
                  )
                  // underWarranty = true but coverage not yet assessed (pre-diagnosis)
                  return (
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[rgba(37,99,235,0.08)] border border-blue-500/25">
                      <Fa icon={faShieldAlt} className="text-blue-500 text-xs" />
                      <span className="text-[10px] font-black text-blue-500 uppercase tracking-wide">Under Warranty</span>
                      <span className="text-[9px] text-[var(--text-3)] ml-1">— coverage determined at diagnosis</span>
                    </div>
                  )
                })()}
              </div>
            </SectionCard>

            {/* ── Diagnosis & Technical Assessment ── */}
            {hasDiagnosis && (
              <SectionCard delay={200} id="repair-diagnosis" className={activeRepairTab === 'diagnosis' ? '' : 'hidden'}>
                <SectionHeader
                  icon={faStethoscope}
                  iconBg="bg-blue-600"
                  title="Diagnosis & Technical Assessment"
                  subtitle={
                    r.diagnosis?.diagnosedDate
                      ? `${new Date(r.diagnosis.diagnosedDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })} · ${r.diagnosis.diagnosedBy}`
                      : 'Technical findings'
                  }
                  action={
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => diagReportInputRef?.current?.click()}
                        disabled={uploadingDiagReport}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[9px] font-black text-[var(--text-2)] uppercase tracking-wider hover:bg-[var(--bg-muted)] transition-all disabled:opacity-50 whitespace-nowrap"
                      >
                        <Fa icon={uploadingDiagReport ? faSync : faUpload} className={`text-[9px] ${uploadingDiagReport ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">{uploadingDiagReport ? 'Uploading…' : 'Report'}</span>
                      </button>
                      {canUpdateDiagnosis && (
                        <button onClick={() => setShowDiagnosisModal(true)} className="text-[9px] font-black text-blue-600 uppercase tracking-wider px-3 py-1.5 rounded-lg bg-[rgba(37,99,235,0.08)] border border-blue-500/25 hover:bg-[rgba(37,99,235,0.15)] transition-all">Update</button>
                      )}
                      <SecondaryActionMenu
                        label="Actions"
                        ariaLabel="Diagnosis actions"
                        mobilePresentation="anchored"
                        actions={[
                          { id: 'stop', label: 'Stop at diagnosis', onClick: () => setShowStopDiagnosisModal(true), hidden: !canStopAtDiagnosis },
                        ]}
                      />
                    </div>
                  }
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">

                  {/* Fault banner */}
                  {r.diagnosis?.faultDescription && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-600 text-white">
                      <Fa icon={faWrench} className="text-blue-200 text-sm mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-blue-200 mb-0.5">Fault Identified</p>
                        <p className="text-[14px] font-black leading-snug">{r.diagnosis.faultDescription}</p>
                      </div>
                    </div>
                  )}

                  {/* Client damage warning */}
                  {r.clientCausedDamage && (
                    <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[rgba(245,158,11,0.08)] border border-amber-500/30">
                      <Fa icon={faExclamationTriangle} className="text-amber-500 text-sm mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-black text-amber-500 uppercase tracking-wider">Client-Caused Damage</p>
                        {r.clientDamageReason && (
                          <p className="text-[11px] text-[var(--text-2)] mt-0.5 font-semibold">{r.clientDamageReason}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Technical findings text */}
                  {r.diagnosis?.findings && (
                    <div>
                      <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1.5">Technical Findings</p>
                      <div className="bg-[var(--bg-surface)] rounded-xl p-4 border border-[var(--border)]">
                        <p className="text-[12px] sm:text-[13px] text-[var(--text-2)] leading-relaxed font-medium">{r.diagnosis.findings}</p>
                      </div>
                    </div>
                  )}

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {r.diagnosis?.recommendedAction && (
                      <div className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                        <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Recommended Action</p>
                        <p className="text-[11px] font-semibold text-[var(--text-1)]">{r.diagnosis.recommendedAction}</p>
                      </div>
                    )}
                    {(r.diagnosis?.estimatedHours ?? 0) > 0 && (
                      <div className="p-3 rounded-xl bg-[rgba(99,102,241,0.08)] border border-indigo-500/25">
                        <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Est. Labour</p>
                        <p className="text-[18px] font-black text-indigo-500 leading-none">{r.diagnosis.estimatedHours}<span className="text-[11px] font-bold ml-0.5">h</span></p>
                      </div>
                    )}
                    {(feeApplies || feeResolved.status === 'paid' || feeResolved.status === 'invoiced' || feeResolved.status === 'waived' || feeResolved.status === 'not_applicable') && (
                      <div className="p-3 rounded-xl bg-[rgba(245,158,11,0.08)] border border-amber-500/25">
                        <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Diagnosis Fee</p>
                        <p className="text-[13px] font-black text-amber-500">
                          {feeResolved.status === 'waived'
                            ? 'Waived'
                            : feeResolved.status === 'not_applicable'
                              ? 'N/A'
                              : feeResolved.amount > 0 ? fmtKes(feeResolved.amount) : '—'}
                        </p>
                        <p className="text-[10px] font-semibold text-amber-700/80 mt-0.5">
                          {feeResolved.status === 'paid'
                            ? `Paid early${r.diagnosisFeePaidMethod ? ` · ${r.diagnosisFeePaidMethod}` : ''} · not credited against repair`
                            : feeResolved.status === 'invoiced'
                              ? 'On invoice · 0% VAT'
                              : feeResolved.status === 'not_applicable'
                                ? 'Not charged (pre-policy intake or exempt)'
                                : 'On final invoice with repair · 0% VAT'}
                        </p>
                        {r.diagnosisFeeStatus === 'waived' && r.diagnosisFeeWaivedReason && (
                          <p className="text-[10px] text-[var(--text-3)] mt-1">Reason: {r.diagnosisFeeWaivedReason}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {r.diagnosisStopped && (
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[rgba(239,68,68,0.08)] border border-red-500/25">
                      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      <span className="text-[10px] font-black text-red-500 uppercase tracking-wider">Closed at Diagnosis Stage</span>
                    </div>
                  )}

                  {(r.diagnosisHistory?.length ?? 0) > 1 && (
                    <div>
                      <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-2">Diagnosis History</p>
                      <div className="space-y-2">
                        {(r.diagnosisHistory ?? []).slice().reverse().map((d, idx) => (
                          <div key={d.id ?? `${d.diagnosedDate}-${idx}`} className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="text-[10px] font-black text-[var(--text-1)] uppercase tracking-wider">Revision {d.revision ?? (r.diagnosisHistory?.length ?? 0) - idx}</p>
                              <p className="text-[9px] text-[var(--text-4)] font-semibold">{d.diagnosedDate ? new Date(d.diagnosedDate).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</p>
                            </div>
                            <p className="text-[11px] font-bold text-[var(--text-2)]">{d.faultDescription}</p>
                            {d.revisionReason && <p className="text-[10px] text-blue-600 font-semibold mt-1">Reason: {d.revisionReason}</p>}
                            {d.findings && <p className="text-[10px] text-[var(--text-3)] leading-relaxed mt-1 line-clamp-2">{d.findings}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Diagnosis report attachment */}
                  {r.diagnosisReportName && (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 border border-indigo-200 flex items-center justify-center shrink-0">
                        <Fa icon={faClipboardList} className="text-indigo-600 text-xs" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-[var(--text-2)] truncate">{r.diagnosisReportName}</p>
                        <p className="text-[9px] text-[var(--text-4)] font-medium">Diagnosis Report PDF</p>
                      </div>
                      {(r.diagnosisReportUrl || r.diagnosisReportData) && (
                        <a href={r.diagnosisReportUrl || r.diagnosisReportData} download={r.diagnosisReportName}
                           className="text-[9px] font-black text-blue-600 uppercase tracking-wider px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition-all whitespace-nowrap">
                          Download
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            {/* ── Retained device convert ── */}
            {r.status === 'retained' && (
              <SectionCard delay={50} className={activeRepairTab === 'work' ? '' : 'hidden'}>
                <SectionHeader
                  icon={faBoxOpen}
                  iconBg="bg-stone-700"
                  title="Left with Deed"
                  subtitle={r.retainedDate ? new Date(r.retainedDate).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Retained'}
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-3">
                  {r.retainedDonationRef && (
                    <p className="text-[12px] font-bold text-[var(--text-1)]">Donation: {r.retainedDonationRef}</p>
                  )}
                  {r.retainedBuyBackRef && (
                    <div className="space-y-2">
                      <p className="text-[12px] font-bold text-[var(--text-1)]">Buy-back / trade-in: {r.retainedBuyBackRef}</p>
                      <button
                        type="button"
                        className="btn-secondary text-[11px]"
                        onClick={() => setModule('after_sales')}
                      >
                        Open Trade-in
                      </button>
                    </div>
                  )}
                  {canConvertRetained && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary text-[11px]"
                        style={{ background: '#57534E' }}
                        onClick={() => convertRetainedRepairToDonation(r.id)}
                      >
                        Convert → Donation
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-[11px]"
                        onClick={() => convertRetainedRepairToBuyBack(r.id)}
                      >
                        Convert → Buy-back stock (KES 0)
                      </button>
                      {canTradeInFromRepair && (
                        <button
                          type="button"
                          className="btn-primary text-[11px]"
                          onClick={() => {
                            setTradeInPrice('')
                            setTradeInCondition((r.deviceCondition === 'poor' || r.deviceCondition === 'damaged') ? 'poor' : r.deviceCondition === 'fair' ? 'fair' : 'good')
                            setTradeInNotes('')
                            setShowTradeInModal(true)
                          }}
                        >
                          Trade-in after evaluation
                        </button>
                      )}
                    </div>
                  )}
                  {!canConvertRetained && !r.retainedDonationRef && !r.retainedBuyBackRef && (
                    <p className="text-[11px] text-[var(--text-3)]">Device retained without stock convert.</p>
                  )}
                  {r.retainedBy && <p className="text-[10px] text-[var(--text-4)] font-semibold">By {r.retainedBy}</p>}
                </div>
              </SectionCard>
            )}

            {/* ── QC Fail Results (visible to tech after rework) ── */}
            {showQcFailPanel && (
              <SectionCard delay={70} id="repair-qc" className={activeRepairTab === 'work' ? '' : 'hidden'}>
                <SectionHeader
                  icon={faExclamationTriangle}
                  iconBg="bg-amber-600"
                  title="QC Failed — Rework Required"
                  subtitle={r.qcFailedDate ? new Date(r.qcFailedDate).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Latest QC round'}
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-3">
                  {r.qcFailReason && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                      <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-1">Fail reason</p>
                      <p className="text-[12px] font-bold text-amber-900 leading-relaxed">{r.qcFailReason}</p>
                      {r.qcFailedBy && <p className="text-[10px] text-amber-700 mt-1.5 font-semibold">By {r.qcFailedBy}</p>}
                    </div>
                  )}
                  {failedQcItems.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">Failed checklist items</p>
                      {failedQcItems.map(item => (
                        <div key={item.id} className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                          <p className="text-[11px] font-bold text-[var(--text-1)]">{item.description}</p>
                          {item.notes?.trim() && (
                            <p className="text-[10px] text-[var(--text-3)] mt-1 leading-relaxed">Note: {item.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            {/* ── QC Report Attachment ── */}
            {hasQcReport && (
              <SectionCard delay={270} id={!showQcFailPanel ? 'repair-qc' : undefined} className={activeRepairTab === 'work' ? '' : 'hidden'}>
                <SectionHeader
                  icon={faShieldAlt}
                  iconBg="bg-emerald-500"
                  title="QC Report File"
                  subtitle="Lightweight attachment visible to the customer portal"
                  action={
                    <button onClick={() => qcReportInputRef.current?.click()} className="btn-outline text-[10px]" disabled={uploadingQcReport}>
                      <Fa icon={faUpload} /> {uploadingQcReport ? 'Uploading...' : 'Replace File'}
                    </button>
                  }
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5">
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="w-9 h-9 rounded-lg bg-white border border-emerald-200 flex items-center justify-center shrink-0">
                      <Fa icon={faClipboardList} className="text-emerald-600 text-sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-black text-emerald-900 truncate">{r.qcReportName || 'QC report attached'}</p>
                      <p className="text-[10px] text-emerald-700 font-semibold">
                        Stored as a download link{r.qcReportSize ? ` • ${(r.qcReportSize / 1024 / 1024).toFixed(2)} MB` : ''}
                        {r.qcReportUploadedAt ? ` • ${new Date(r.qcReportUploadedAt).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                      </p>
                    </div>
                    {(r.qcReportUrl || r.qcReportData) && (
                      <a href={r.qcReportUrl || r.qcReportData} download={r.qcReportName || 'qc-report'} target="_blank" rel="noopener noreferrer"
                         className="text-[9px] font-black text-emerald-700 uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white border border-emerald-200 hover:bg-emerald-100 transition-all whitespace-nowrap">
                        Download
                      </a>
                    )}
                  </div>
                </div>
              </SectionCard>
            )}

            {!showQcFailPanel && !hasQcReport && (
              <SectionCard delay={270} id="repair-qc" className={activeRepairTab === 'work' ? '' : 'hidden'}>
                <SectionHeader
                  icon={faShieldAlt}
                  iconBg="bg-slate-500"
                  title="Quality Check"
                  subtitle={r.status === 'qc' ? 'Ready for testing' : 'No QC result recorded yet'}
                  action={canPerformQA ? (
                    <button onClick={() => setShowQAModal(true)} className="btn-primary text-[10px]">
                      Start QC
                    </button>
                  ) : null}
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5">
                  <p className="text-[11px] font-semibold text-[var(--text-3)]">
                    {r.status === 'qc'
                      ? 'This repair is waiting for an independent quality check.'
                      : 'QC becomes available after the repair work is completed.'}
                  </p>
                </div>
              </SectionCard>
            )}

            {/* ── Parts Used in Repair — always mounted: the Repair & Parts tab
                   scrolls here, and the header's Parts actions (Request parts /
                   Mark parts arrived) must be reachable before the first part
                   is logged. ── */}
            <SectionCard delay={260} id="repair-parts" className={activeRepairTab === 'parts' ? '' : 'hidden'}>
                <SectionHeader
                  icon={faBoxOpen}
                  iconBg="bg-orange-500"
                  title="Parts Used"
                  subtitle={hasPartsUsed ? `${r.partsUsed.length} component${r.partsUsed.length !== 1 ? 's' : ''}` : 'None logged yet'}
                  action={
                    <SecondaryActionMenu
                      label="Parts"
                      ariaLabel="Parts actions"
                      mobilePresentation="anchored"
                      actions={[
                        { id: 'request', label: 'Request parts', onClick: () => setShowProcurementModal(true), hidden: !canProcure },
                        { id: 'arrived', label: 'Mark parts arrived', onClick: () => markPartsArrived(r.id), hidden: !canMarkPartsArrived || primaryActionId === 'parts_arrived' },
                      ]}
                    />
                  }
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5">
                  {!hasPartsUsed ? (
                    <p className="text-[11px] font-semibold text-[var(--text-3)]">
                      No parts logged yet — use the Parts menu above to request components for this job.
                    </p>
                  ) : (
                  <div className="dt-scroll">
                    <table data-no-responsive className="w-full text-left">
                      <thead className="bg-[var(--bg-surface)] border-b border-[var(--border)]">
                        <tr>
                          {['Part / Component','Qty','Unit Price','Total'].map(h => (
                            <th key={h} className="px-3 sm:px-4 py-2.5 text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-lt)]">
                        {r.partsUsed.map((part, i) => (
                          <tr key={i} className="hover:bg-[var(--bg-surface)] transition-colors">
                            <td className="px-3 sm:px-4 py-3">
                              <p className="text-[11px] font-bold text-[var(--text-1)]">{part.productName}</p>
                              {part.serialId && <p className="text-[9px] font-mono text-[var(--text-4)] mt-0.5">{part.serialId}</p>}
                            </td>
                            <td className="px-3 sm:px-4 py-3 text-[11px] font-bold text-[var(--text-2)]">{part.qty}</td>
                            <td className="px-3 sm:px-4 py-3 text-[11px] font-mono text-[var(--text-2)]">{fmtKes(part.price)}</td>
                            <td className="px-3 sm:px-4 py-3 text-[11px] font-mono font-black text-[var(--text-1)]">{fmtKes(part.price * part.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-[var(--bg-surface)] border-t border-[var(--border)]">
                        <tr>
                          <td colSpan={3} className="px-3 sm:px-4 py-2.5 text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">Parts Total</td>
                          <td className="px-3 sm:px-4 py-2.5 text-[12px] font-black text-[var(--text-1)] font-mono">
                            {fmtKes(r.partsUsed.reduce((s, p) => s + p.price * p.qty, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  )}
                </div>
            </SectionCard>


            {/* Issue Photos */}
            <SectionCard delay={380} className={activeRepairTab === 'overview' ? '' : 'hidden'}>
              <SectionHeader
                icon={faCamera}
                iconBg="bg-indigo-600"
                title="Issue Photos"
                subtitle={`${(r.issuePhotos || []).length} photo${(r.issuePhotos || []).length !== 1 ? 's' : ''}`}
                action={
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-[var(--bg-surface)] text-[var(--text-2)] text-[10px] font-black uppercase tracking-wider hover:bg-[var(--bg-muted)] transition-all border border-[var(--border)] disabled:opacity-50 whitespace-nowrap"
                  >
                    <Fa icon={uploadingPhoto ? faSync : faUpload} className={`text-[10px] ${uploadingPhoto ? 'animate-spin' : ''}`} />
                    <span className="hidden sm:inline">{uploadingPhoto ? 'Uploading…' : 'Upload'}</span>
                  </button>
                }
              />
              <div className="px-4 sm:px-6 py-4 sm:py-5">
                {(r.issuePhotos?.length ?? 0) > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                    {r.issuePhotos.map((photo, idx) => (
                      <div key={idx} className="group relative aspect-square rounded-xl sm:rounded-2xl overflow-hidden border border-[var(--border)] shadow-sm hover:shadow-xl transition-all duration-300">
                        <img src={photo.url} alt={photo.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-2.5 sm:gap-3">
                          <button onClick={() => removePhoto(idx)} className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all shadow-lg active:scale-90">
                            <Fa icon={faTrash} className="text-xs sm:text-sm" />
                          </button>
                          <a href={photo.url} target="_blank" rel="noopener noreferrer" className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white text-slate-900 flex items-center justify-center hover:bg-slate-50 transition-all shadow-lg active:scale-90">
                            <Fa icon={faExpand} className="text-xs sm:text-sm" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 sm:py-14 bg-[var(--bg-surface)] rounded-xl sm:rounded-2xl border-2 border-dashed border-[var(--border)] gap-3">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{ background: 'rgba(99,102,241,0.08)', boxShadow: '0 0 0 10px rgba(99,102,241,0.05), 0 2px 8px rgba(0,0,0,0.06)' }}
                    >
                      <Fa icon={faImage} className="text-indigo-300 text-xl" />
                    </div>
                    <div className="text-center px-4">
                      <p className="text-[11px] sm:text-[12px] font-bold text-[var(--text-3)]">No photos yet</p>
                      <p className="text-[9px] sm:text-[10px] text-[var(--text-4)] mt-0.5">Capture device condition for documentation</p>
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          {/* ═══ Right Column ═══ */}
          <aside className={`repair-detail__aside ${['quote', 'handover', 'activity'].includes(activeRepairTab) ? 'lg:col-span-12 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start' : 'lg:col-span-4'}`}>
            {!isQuoteDeclinedReopenable(r.status) && (
              <section className="repair-section-card repair-detail__next-action border border-sky-200 bg-[var(--bg-card)] lg:sticky lg:top-[9.5rem] lg:col-start-2 lg:row-start-1">
                <div className="border-b border-[var(--border-lt)] bg-sky-50/70 px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-sky-600">Next action</p>
                  <h3 className="mt-1 text-[13px] font-black leading-snug text-[var(--text-1)]">{nextActionHint || 'Review job activity'}</h3>
                </div>
                <div className="p-3 [&_.repair-action-btn]:min-h-10 [&_.repair-action-btn]:w-full [&_.repair-action-btn]:justify-center [&_.repair-action-btn]:rounded-lg [&_.repair-action-btn]:px-4 [&_.repair-action-btn]:text-[11px]">
                  {primaryActionId === 'verify' && <ActionBtn onClick={handleVerify} icon={faUserCheck} label="Verify intake" color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'assign' && <ActionBtn onClick={() => setShowAssignModal(true)} icon={faUserPlus} label={r.assignedTechnicianId ? 'Reassign' : 'Assign technician'} color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'diagnose' && <ActionBtn onClick={() => setShowDiagnosisModal(true)} icon={faStethoscope} label={canUpdateDiagnosis && !canDiagnose ? 'Update diagnosis' : 'Log diagnosis'} color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'quote' && <ActionBtn onClick={() => setShowQuoteModal(true)} icon={faFileInvoiceDollar} label={r.quote ? 'Update quote' : 'Generate quote'} color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'start' && <ActionBtn onClick={() => startRepair(r.id)} icon={faPlay} label="Start repair" color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'complete' && <ActionBtn onClick={() => markRepairComplete(r.id)} icon={faCheckCircle} label="Mark complete" color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'qc' && <ActionBtn onClick={() => setShowQAModal(true)} icon={faStar} label="Perform QC" color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'parts_arrived' && <ActionBtn onClick={() => markPartsArrived(r.id)} icon={faBoxOpen} label="Mark parts arrived" color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'invoice' && <ActionBtn onClick={() => setShowProgressModal(true)} icon={faFileInvoiceDollar} label={billingSync.canRewriteInvoice || billingSync.quoteOpen ? 'Align invoice with quote' : 'Create invoice'} color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'prepare_release' && <ActionBtn onClick={openPrepareRelease} icon={faBoxOpen} label="Prepare release" color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'collect' && <ActionBtn onClick={() => setShowMarkDeliveredConfirm(true)} icon={faTruck} label="Mark collected" color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {primaryActionId === 'close' && <ActionBtn onClick={() => closeRepairJob(r.id)} icon={faCheckCircle} label="Close job" color="bg-sky-500 hover:bg-sky-600" shadow="" />}
                  {!primaryActionId && <p className="rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-[10px] font-semibold text-[var(--text-3)]">No workflow action is required at this stage.</p>}
                </div>
              </section>
            )}
            <SectionCard delay={80} id="repair-delivery" className={activeRepairTab === 'handover' ? '' : 'hidden'}>
              <SectionHeader
                icon={faTruck}
                iconBg="bg-teal-600"
                title="Delivery & Handover"
                subtitle={
                  r.status === 'delivered'
                    ? 'Device handed over'
                    : r.deliveryJobId
                      ? 'Delivery scheduled'
                      : 'Collection / delivery status'
                }
                action={
                  canScheduleDelivery ? (
                    <button onClick={() => setShowDeliveryModal(true)} className="btn-primary text-[10px]">Schedule</button>
                  ) : canMarkCollected ? (
                    <button onClick={() => setShowMarkDeliveredConfirm(true)} className="btn-primary text-[10px]">Mark collected</button>
                  ) : repairOrc ? (
                    <button onClick={() => setShowOrcPanel(true)} className="btn-secondary text-[10px]">Release record</button>
                  ) : null
                }
              />
              <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-2.5">
                {r.status === 'delivered' && r.deliveryRecipient ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Collected / delivered</p>
                    <p className="mt-1 text-[11px] font-semibold text-emerald-900">
                      {r.deliveryRecipient}
                      {r.deliveryActualDate ? ` · ${new Date(r.deliveryActualDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                    </p>
                  </div>
                ) : r.deliveryJobId ? (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-teal-700">Scheduled delivery</p>
                    <p className="mt-1 text-[11px] font-semibold text-teal-900">
                      {r.deliveryRiderName || 'Rider not assigned'}
                      {r.deliveryScheduledDate ? ` · ${new Date(r.deliveryScheduledDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] font-semibold text-[var(--text-3)]">
                    No delivery or collection handover has been recorded yet.
                  </p>
                )}
                {canPrepareRelease && !repairOrc && (
                  <button
                    type="button"
                    onClick={openPrepareRelease}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[var(--text-2)] hover:bg-[var(--bg-muted)]"
                  >
                    Prepare release
                  </button>
                )}
                <div className="flex justify-end pt-1">
                  <SecondaryActionMenu
                    label="Handover"
                    ariaLabel="Handover and device disposition actions"
                    mobilePresentation="anchored"
                    actions={[
                      { id: 'return', label: isQuoteDeclinedReopenable(r.status) ? 'Return device after decline' : 'Return device', onClick: () => setShowReturnModal(true), hidden: !canReturnDevice },
                      { id: 'leave', label: 'Customer leaves device', onClick: openLeaveDevice, hidden: !canLeaveDeviceWithDeed },
                      { id: 'tradein', label: 'Trade-in after evaluation', onClick: openTradeIn, hidden: !canTradeInFromRepair },
                      { id: 'convert_donation', label: 'Convert to donation', onClick: () => convertRetainedRepairToDonation(r.id), hidden: !canConvertRetained },
                      { id: 'convert_buyback', label: 'Convert to buy-back stock', onClick: () => convertRetainedRepairToBuyBack(r.id), hidden: !canConvertRetained },
                      { id: 'close', label: 'Close job', onClick: () => closeRepairJob(r.id), hidden: !canCloseJob || primaryActionId === 'close' },
                    ]}
                  />
                </div>
              </div>
            </SectionCard>

            {/* Follow-up Portal */}
            <div className="relative rounded-xl sm:rounded-2xl overflow-hidden shadow-sm border" style={{ borderColor: 'var(--border)', background: 'var(--navy)' }}>
              <div className="absolute inset-0 opacity-30 pointer-events-none"
                style={{ background: `radial-gradient(circle at 70% 30%, ${accentColor}50 0%, transparent 70%)` }} />
              <Fa icon={faLink} className="absolute -right-4 -top-4 text-white/5 text-[6rem] sm:text-[8rem] rotate-12 pointer-events-none" />
              <div className="relative z-10 p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <div>
                    <h3 className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.6)' }}>Follow-up Portal</h3>
                    <p className="text-[9px] sm:text-[10px] font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Customer tracking link</p>
                  </div>
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}>
                    <Fa icon={faExternalLinkAlt} style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }} />
                  </div>
                </div>
                <div className="rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 mb-3 sm:mb-4" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <p className="text-[10px] font-mono break-all leading-relaxed" style={{ color: 'var(--accent-cyan)' }}>{portalUrl}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <button onClick={copyLink}
                    className="py-2.5 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95"
                    style={copiedLink
                      ? { background: '#10B981', color: '#fff' }
                      : { background: '#fff', color: '#1A1F5E' }
                    }>
                    {copiedLink ? 'Copied!' : 'Copy Link'}
                  </button>
                  <a href={portalUrl} target="_blank" rel="noopener noreferrer"
                    className="py-2.5 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    style={{ background: 'var(--accent-cyan)', color: '#fff' }}>
                    <Fa icon={faExternalLinkAlt} className="text-xs" />
                    Open
                  </a>
                </div>
              </div>
            </div>

            {/* Financials */}
            <SectionCard delay={100} id={!hasDiagnosis ? 'repair-diagnosis' : undefined} className={activeRepairTab === 'quote' ? '' : 'hidden'}>
              <SectionHeader
                id="repair-diagnosis-financials"
                icon={faQuoteRight}
                iconBg="bg-emerald-600"
                title="Financials"
                subtitle="Quote & charges"
                action={
                  <SecondaryActionMenu
                    label="Billing"
                    ariaLabel="Financial and quote actions"
                    mobilePresentation="anchored"
                    actions={[
                      {
                        id: 'quote',
                        label: isQuoteDeclinedReopenable(r.status) ? 'Revise & re-send quote' : r.quote ? 'Edit quote' : 'Generate quote',
                        onClick: () => setShowQuoteModal(true),
                        hidden: !canQuote || primaryActionId === 'quote',
                      },
                      { id: 'decline', label: 'Decline quote', onClick: () => setShowDeclineModal(true), hidden: !canDeclineQuote, danger: true },
                      {
                        id: 'invoice',
                        label: billingSync.canRewriteInvoice || billingSync.quoteOpen ? 'Align invoice with quote' : 'Create invoice',
                        onClick: () => setShowProgressModal(true),
                        hidden: !canInvoice || primaryActionId === 'invoice',
                      },
                      { id: 'mark_fee_paid', label: 'Mark diagnosis fee paid', onClick: () => markDiagnosisFeePaid(r.id), hidden: !canMarkDiagnosisFeePaid },
                      { id: 'waive_fee', label: 'Waive diagnosis fee', onClick: () => { setWaiveFeeReason(''); setShowWaiveFeeModal(true) }, hidden: !canWaiveDiagnosisFee },
                      { id: 'no_charge', label: 'Mark no-charge', onClick: openNoCharge, hidden: !canMarkNoCharge },
                    ]}
                  />
                }
              />
              <div className="px-4 sm:px-6 py-4 sm:py-5">
                {r.quote ? (
                  <div className="space-y-3">
                    {/* Warranty coverage context banner */}
                    {r.underWarranty && r.warrantyCoverage && (
                      <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[10px] font-bold ${
                        r.warrantyCoverage === 'full'
                          ? 'bg-[rgba(16,185,129,0.10)] border border-emerald-500/30 text-emerald-700'
                          : r.warrantyCoverage === 'partial'
                          ? 'bg-[rgba(37,99,235,0.08)] border border-blue-500/25 text-blue-700'
                          : 'bg-[rgba(245,158,11,0.08)] border border-amber-500/30 text-amber-700'
                      }`}>
                        <Fa icon={faShieldAlt} className="text-xs shrink-0" />
                        {r.warrantyCoverage === 'full'
                          ? 'Full warranty — company pays, client charged KES 0'
                          : r.warrantyCoverage === 'partial'
                          ? 'Partial warranty — client pays for uncovered items only'
                          : 'Warranty voided — client pays full repair cost'}
                      </div>
                    )}

                    {r.quote.changeSummary && (
                      <div className="rounded-xl border p-3.5" style={{ background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-card))', borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)' }}>
                        <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-2">Quote Revision — What Changed</p>
                        <pre className="text-[10px] text-[var(--text-2)] whitespace-pre-wrap font-mono leading-relaxed">{r.quote.changeSummary}</pre>
                      </div>
                    )}

                    <div className="bg-[rgba(16,185,129,0.08)] rounded-xl p-4 sm:p-5 border border-emerald-500/25">
                      <p className="text-[9px] sm:text-[10px] font-black text-emerald-500 uppercase tracking-widest">
                        {r.underWarranty && r.warrantyCoverage === 'full' ? 'Total (Warranty Covered)' : 'Total Quote'}
                      </p>
                      <p className="text-2xl sm:text-3xl font-black text-[var(--text-1)] tracking-tight mt-1">{fmtKes(r.quote.total)}</p>
                      {r.quote.prevTotal !== undefined && r.quote.prevTotal !== r.quote.total && (
                        <p className="text-[10px] text-[var(--text-3)] line-through mt-0.5">{fmtKes(r.quote.prevTotal)}</p>
                      )}
                      {r.underWarranty && r.warrantyCoverage === 'full' && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Auto-approved — no client sign-off needed</span>
                        </div>
                      )}
                      {r.quote.approvedTotal !== undefined && r.quote.approvedTotal !== r.quote.total && (
                        <p className="text-[10px] font-bold text-emerald-600 mt-1">Approved items total: {fmtKes(r.quote.approvedTotal)}</p>
                      )}
                      {r.quote.approvedDate && r.warrantyCoverage !== 'full' && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">
                            Approved {new Date(r.quote.approvedDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      )}
                      {r.quote.rejectedDate && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          <span className="text-[9px] font-black text-red-600 uppercase tracking-widest">Quote Rejected</span>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <div className="p-3 sm:p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]">
                        <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">Subtotal</p>
                        <p className="text-[12px] sm:text-[13px] font-black text-[var(--text-1)] mt-1">{fmtKes(r.quote.subtotal)}</p>
                      </div>
                      <div className="p-3 sm:p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]">
                        <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">VAT</p>
                        <p className="text-[12px] sm:text-[13px] font-black text-[var(--text-1)] mt-1">{fmtKes(r.quote.tax)}</p>
                      </div>
                    </div>

                    {r.paymentConfirmationStatus && (
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3.5">
                        <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Portal Payment Confirmation</p>
                        <p className="text-[11px] font-semibold text-[var(--text-2)] capitalize">
                          {r.paymentConfirmationStatus.replace('_', ' ')}{r.paymentReceiptNumber ? ` · Receipt ${r.paymentReceiptNumber}` : ''}{r.paymentConfirmationAmount ? ` · ${fmtKes(r.paymentConfirmationAmount)}` : ''}
                        </p>
                        {r.paymentConfirmationSubmittedAt && <p className="text-[9px] text-[var(--text-4)] mt-1">Submitted {new Date(r.paymentConfirmationSubmittedAt).toLocaleString('en-KE')}</p>}
                        {r.paymentConfirmationText && (
                          <div className="mt-2 rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] p-2.5">
                            <p className="text-[8px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Customer M-PESA Message — verify against the invoice</p>
                            <p className="text-[10px] text-[var(--text-2)] whitespace-pre-wrap break-words font-mono">{r.paymentConfirmationText}</p>
                          </div>
                        )}
                        {r.paymentConfirmationImageUrl && (
                          <a href={r.paymentConfirmationImageUrl} target="_blank" rel="noreferrer" className="block mt-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={r.paymentConfirmationImageUrl} alt="Payment confirmation screenshot" className="max-h-48 rounded-lg border border-[var(--border-lt)] object-contain" />
                          </a>
                        )}
                        {r.paymentConfirmationNotes && <p className="text-[9px] text-[var(--text-4)] mt-2 italic">{r.paymentConfirmationNotes}</p>}
                        {r.paymentConfirmationReviewedAt && (
                          <p className="text-[9px] text-[var(--text-4)] mt-1">
                            Reviewed {new Date(r.paymentConfirmationReviewedAt).toLocaleString('en-KE')}{r.paymentConfirmationReviewedBy ? ` by ${r.paymentConfirmationReviewedBy}` : ''}
                          </p>
                        )}
                        {r.paymentConfirmationStatus === 'pending_review' && ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '') && (
                          <div className="mt-3 space-y-2">
                            {showPaymentRejectInput ? (
                              <div className="space-y-2">
                                <input
                                  value={paymentRejectReason}
                                  onChange={e => setPaymentRejectReason(e.target.value)}
                                  placeholder="Reason for rejecting (visible to staff)"
                                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[11px] text-[var(--text-1)]"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => { reviewPortalPayment(r.id, false, paymentRejectReason); setShowPaymentRejectInput(false); setPaymentRejectReason('') }}
                                    className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-red-700 transition-colors"
                                  >
                                    Confirm Rejection
                                  </button>
                                  <button
                                    onClick={() => { setShowPaymentRejectInput(false); setPaymentRejectReason('') }}
                                    className="px-3 py-2 rounded-lg border border-[var(--border)] text-[10px] font-black uppercase tracking-wider text-[var(--text-3)]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => reviewPortalPayment(r.id, true)}
                                  className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-emerald-700 transition-colors"
                                >
                                  Confirm & Register Payment
                                </button>
                                <button
                                  onClick={() => setShowPaymentRejectInput(true)}
                                  className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[10px] font-black uppercase tracking-wider hover:bg-red-100 transition-colors"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Line items breakdown */}
                    {(r.quote.lines?.length ?? 0) > 0 && (
                      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                        <div className="bg-[var(--bg-surface)] px-3 py-2 border-b border-[var(--border)]">
                          <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">Breakdown</p>
                        </div>
                        {r.quote.lines.map((line, i) => (
                          <div key={i} className={`flex items-center justify-between px-3 py-2.5 bg-[var(--bg-card)] ${i < r.quote.lines.length - 1 ? 'border-b border-[var(--border-lt)]' : ''}`}>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-semibold text-[var(--text-2)] truncate">{line.description}</p>
                              <p className="text-[9px] text-[var(--text-4)] capitalize">{line.type} · qty {line.qty}{line.decision ? ` · ${line.decision}` : ''}</p>
                            </div>
                            <div className="flex items-center gap-2 ml-3 shrink-0">
                              {line.decision && <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider border ${line.decision === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : line.decision === 'declined' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{line.decision}</span>}
                              <span className="text-[11px] font-mono font-bold text-[var(--text-1)]">{fmtKes(line.subtotal)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 sm:py-12 bg-[var(--bg-surface)] rounded-xl border-2 border-dashed border-[var(--border)] gap-3">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{ background: 'rgba(16,185,129,0.08)', boxShadow: '0 0 0 10px rgba(16,185,129,0.05)' }}
                    >
                      <Fa icon={faFileInvoiceDollar} className="text-emerald-300 text-xl" />
                    </div>
                    <div className="text-center">
                      <p className="text-[11px] font-bold text-[var(--text-3)]">No quote generated yet</p>
                      {canQuote && (
                        <button onClick={() => setShowQuoteModal(true)} className="text-[10px] font-black text-blue-600 hover:text-blue-700 uppercase tracking-wider mt-2 hover:underline transition-colors">
                          Generate Quote →
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Parts & Procurement */}
            {hasProc ? (
              <SectionCard delay={180} className={activeRepairTab === 'parts' ? '' : 'hidden'}>
                <SectionHeader
                  icon={faBoxOpen}
                  iconBg="bg-orange-500"
                  title="Parts & Procurement"
                  subtitle={`${r.procurementRequests.length} request${r.procurementRequests.length !== 1 ? 's' : ''}`}
                  action={
                    <SecondaryActionMenu
                      label="Parts"
                      ariaLabel="Parts and procurement actions"
                      mobilePresentation="anchored"
                      actions={[
                        { id: 'request', label: 'Request parts', onClick: () => setShowProcurementModal(true), hidden: !canProcure },
                        { id: 'arrived', label: 'Mark parts arrived', onClick: () => markPartsArrived(r.id), hidden: !canMarkPartsArrived || primaryActionId === 'parts_arrived' },
                      ]}
                    />
                  }
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-3">
                  {r.procurementRequests.map((req, ri) => {
                    const sc = PROC_COLORS[req.status] ?? PROC_COLORS.pending
                    return (
                      <div key={ri} className="rounded-xl border border-[var(--border)] overflow-hidden">
                        <div className="flex items-center justify-between px-3.5 py-2.5 bg-[var(--bg-surface)] border-b border-[var(--border)]">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-[var(--text-2)]">{req.requestedByName}</span>
                            <span className="text-[9px] text-[var(--text-4)]">·</span>
                            <span className="text-[9px] text-[var(--text-3)]">
                              {new Date(req.requestedDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${sc.bg} ${sc.text} ${sc.border}`}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sc.dot }} />
                            {req.status}
                          </span>
                        </div>
                        <div className="divide-y divide-[var(--border-lt)]">
                          {req.items.map((item, ii) => (
                            <div key={ii} className="flex items-center gap-3 px-3.5 py-2.5 bg-[var(--bg-card)]">
                              <div className="w-6 h-6 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center shrink-0">
                                <Fa icon={faBoxOpen} className="text-orange-500 text-[9px]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-bold text-[var(--text-1)] truncate" title={item.productName || item.description}>{item.productName || item.description}</p>
                                <p className="text-[9px] text-[var(--text-4)]">Qty: {item.qty}{item.supplier ? ` · ${item.supplier}` : ''}</p>
                              </div>
                              {item.estimatedCost && Number(item.estimatedCost) > 0 && (
                                <span className="text-[10px] font-mono font-bold text-[var(--text-2)] shrink-0">{fmtKes(Number(item.estimatedCost))}</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {req.notes && (
                          <div className="px-3.5 py-2 bg-[var(--bg-surface)] border-t border-[var(--border-lt)]">
                            <p className="text-[10px] text-amber-500 leading-snug">{req.notes}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </SectionCard>
            ) : canProcure ? (
              <SectionCard delay={180} className={activeRepairTab === 'parts' ? '' : 'hidden'}>
                <div className="px-4 sm:px-6 py-5 flex flex-col items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-orange-50 border border-orange-200 flex items-center justify-center">
                    <Fa icon={faBoxOpen} className="text-orange-400 text-base" />
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-[var(--text-2)]">Need parts for this repair?</p>
                    <p className="text-[9px] text-[var(--text-4)] mt-0.5">Submit a procurement request to sourcing</p>
                  </div>
                  <button onClick={() => setShowProcurementModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-50 border border-orange-200 text-orange-700 text-[10px] font-black uppercase tracking-wider hover:bg-orange-100 transition-all">
                    <Fa icon={faCartPlus} className="text-xs" />
                    Request Parts
                  </button>
                </div>
              </SectionCard>
            ) : !hasPartsUsed ? (
              <SectionCard delay={180} className={activeRepairTab === 'parts' ? '' : 'hidden'}>
                <SectionHeader
                  icon={faBoxOpen}
                  iconBg="bg-slate-500"
                  title="Parts & Procurement"
                  subtitle="No parts activity"
                  action={
                    <SecondaryActionMenu
                      label="Parts"
                      ariaLabel="Parts actions"
                      mobilePresentation="anchored"
                      actions={[
                        { id: 'arrived', label: 'Mark parts arrived', onClick: () => markPartsArrived(r.id), hidden: !canMarkPartsArrived || primaryActionId === 'parts_arrived' },
                      ]}
                    />
                  }
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5">
                  <p className="text-[11px] font-semibold text-[var(--text-3)]">
                    No parts have been used or requested for this repair.
                  </p>
                </div>
              </SectionCard>
            ) : null}

            {/* Work Notes */}
            <SectionCard delay={160} id="repair-history" className={activeRepairTab === 'activity' ? '' : 'hidden'}>
              <SectionHeader
                icon={faStickyNote}
                iconBg="bg-navy-500"
                title="Work Notes"
                subtitle="Technician progress log"
                action={
                  canUpdateProgress && !['start', 'complete', 'invoice'].includes(primaryActionId ?? '')
                    ? (
                      <button
                        type="button"
                        onClick={() => setShowProgressModal(true)}
                        className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-[var(--text-2)] hover:bg-[var(--bg-muted)]"
                      >
                        Update stage
                      </button>
                    )
                    : null
                }
              />
              <div className="px-4 sm:px-6 py-4 space-y-3">
                {/* Existing note entries */}
                {(() => {
                  const entries = r.notes ? r.notes.split('\n---\n').filter(Boolean) : []
                  if (entries.length === 0) return (
                    <p className="text-[10px] italic py-1" style={{ color: 'var(--text-4)' }}>No notes yet.</p>
                  )
                  return entries.map((entry, idx) => {
                    const lines = entry.split('\n')
                    const hasHeader = lines.length > 1 && lines[0].includes('·')
                    const header  = hasHeader ? lines[0] : null
                    const body    = hasHeader ? lines.slice(1).join('\n') : entry
                    return (
                      <div
                        key={idx}
                        className="border-l-2 pl-3 py-1"
                        style={{ borderColor: 'var(--accent-cyan)' }}
                      >
                        {header && (
                          <p className="text-[9px] font-bold mb-0.5" style={{ color: 'var(--text-3)' }}>
                            {header}
                          </p>
                        )}
                        <p className="text-[12px] leading-snug" style={{ color: 'var(--text-1)' }}>{body}</p>
                      </div>
                    )
                  })
                })()}

                {/* Add new note */}
                {isStaff && (
                  <div className="pt-1 space-y-2">
                    <textarea
                      className="w-full rounded-xl border px-3 py-2.5 text-[12px] resize-none focus:outline-none focus:ring-2"
                      style={{
                        background: 'var(--bg-surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-1)',
                        minHeight: 72,
                      }}
                      placeholder="Add a progress update, observation, or technical note..."
                      value={workNoteDraft}
                      onChange={e => setWorkNoteDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit?.()
                      }}
                    />
                    <div className="flex justify-end">
                      <button
                        disabled={!workNoteDraft.trim() || savingNote}
                        onClick={() => {
                          if (!workNoteDraft.trim()) return
                          setSavingNote(true)
                          const ts = new Date().toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                          const header = `${ts} · ${currentUser?.name || 'Staff'}`
                          const newEntry = `${header}\n${workNoteDraft.trim()}`
                          const updated = r.notes ? `${r.notes}\n---\n${newEntry}` : newEntry
                          updateRepair(r.id, { notes: updated })
                          setWorkNoteDraft('')
                          setSavingNote(false)
                          showToast('Note saved', 'success')
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40"
                        style={{ background: 'var(--navy)' }}
                      >
                        <Fa icon={faPaperPlane} className="text-[10px]" />
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>

            {activeRepairTab === 'activity' && (
              <>
                {/* Customer Chat */}
                <MessageThread repairRef={r.ref} staffName={currentUser?.name || 'Staff'} />

                {/* Internal staff notes / activities (DocumentMessage) */}
                <Chatter
                  model="repair"
                  recordId={r.id}
                  staffName={currentUser?.name || 'Staff'}
                  title="Internal Notes & Activities"
                  compact
                />
              </>
            )}


          </aside>
        </div>
      </div>

      {/* Warranty Claim Modal */}
      {showClaimModal && (
        <Modal variant="enterprise" title="File Warranty Claim" onClose={() => { setShowClaimModal(false); setClaimNotes('') }}>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
              <Fa icon={faShieldAlt} className="text-emerald-600 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold text-emerald-700">Filing warranty claim for {r.ref}</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">{r.productName} · {r.customerName}</p>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest mb-1.5">Claim Notes (optional)</label>
              <textarea
                className="form-input w-full resize-none"
                rows={3}
                placeholder="Describe the issue and scope of warranty coverage..."
                value={claimNotes}
                onChange={e => setClaimNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setShowClaimModal(false); setClaimNotes('') }}>Cancel</button>
              <button className="btn-primary" style={{ background: 'var(--success)' }} onClick={() => {
                fileWarrantyClaim(r.id, claimNotes)
                setShowClaimModal(false)
                setClaimNotes('')
              }}>
                <Fa icon={faShieldAlt} className="mr-1.5" />
                File Claim
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Mark Unrepairable Modal */}
      {showUnrepairableModal && (
        <Modal variant="enterprise" title="Mark Unrepairable" onClose={() => { setShowUnrepairableModal(false); setUnrepairableReason('') }}>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-50 border border-red-200">
              <Fa icon={faBan} className="text-red-600 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold text-red-700">Mark {r.ref} as unrepairable</p>
                <p className="text-[10px] text-red-600 mt-0.5">
                  This closes the job as unrepairable and notifies the customer. Reserved parts are released.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest mb-1.5">Reason *</label>
              <textarea
                className="form-input w-full resize-none"
                rows={3}
                placeholder="Why can this device not be repaired?"
                value={unrepairableReason}
                onChange={e => setUnrepairableReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setShowUnrepairableModal(false); setUnrepairableReason('') }}>Cancel</button>
              <button
                className="btn-primary"
                style={{ background: 'var(--danger)' }}
                disabled={!unrepairableReason.trim()}
                onClick={() => {
                  if (!unrepairableReason.trim()) return
                  markUnrepairable(r.id, unrepairableReason.trim())
                  setShowUnrepairableModal(false)
                  setUnrepairableReason('')
                }}
              >
                <Fa icon={faBan} className="mr-1.5" />
                Confirm Unrepairable
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Customer leaves device with Deed */}
      {showLeaveDeviceModal && (
        <Modal variant="enterprise" title="Customer Leaves Device" onClose={() => setShowLeaveDeviceModal(false)}>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-stone-50 border border-stone-200">
              <Fa icon={faBoxOpen} className="text-stone-600 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold text-stone-800">Customer leaves {r.ref} with Deed</p>
                <p className="text-[10px] text-stone-600 mt-0.5">
                  Closes the job as Left with Deed. Reserved parts are released and linked SO/invoice cancelled.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest mb-1.5">Notes (optional)</label>
              <textarea
                className="form-input w-full resize-none"
                rows={3}
                placeholder="e.g. Customer donated the laptop after declining repair"
                value={leaveDeviceNotes}
                onChange={e => setLeaveDeviceNotes(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest">Convert device</p>
              {([
                { v: 'donation' as const, label: 'Donation in → warehouse', sub: 'Creates a confirmed donation linked to this repair' },
                { v: 'buyback' as const, label: 'Buy-back stock (KES 0)', sub: 'Free buy-back stocked at warehouse, linked to this repair' },
                { v: 'none' as const, label: 'Retain only', sub: 'Close as Left with Deed — convert later from this job' },
              ]).map(opt => (
                <label
                  key={opt.v}
                  className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer"
                  style={{
                    borderColor: leaveConvertMode === opt.v ? '#57534E' : 'var(--border)',
                    background: leaveConvertMode === opt.v ? 'rgba(87,83,78,0.06)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    name="leave-convert"
                    checked={leaveConvertMode === opt.v}
                    onChange={() => setLeaveConvertMode(opt.v)}
                  />
                  <span className="text-[11px] font-medium text-[var(--text-2)] leading-relaxed">
                    {opt.label}
                    <span className="block text-[10px] text-[var(--text-3)] mt-0.5">{opt.sub}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowLeaveDeviceModal(false)}>Cancel</button>
              <button
                className="btn-primary"
                style={{ background: '#57534E' }}
                onClick={() => {
                  leaveDeviceWithDeed(r.id, {
                    convertToDonation: leaveConvertMode === 'donation',
                    convertToStock: leaveConvertMode === 'buyback',
                    notes: leaveDeviceNotes.trim() || undefined,
                  })
                  setShowLeaveDeviceModal(false)
                  setLeaveDeviceNotes('')
                }}
              >
                <Fa icon={faBoxOpen} className="mr-1.5" />
                Confirm Retain
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Paid trade-in after evaluation */}
      {showTradeInModal && (
        <Modal variant="enterprise" title="Trade-in after evaluation" subtitle={r.ref} onClose={() => setShowTradeInModal(false)} width={460}>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 p-3.5 rounded-xl" style={{ background: 'var(--info-bg)', border: '1px solid #BFDBFE' }}>
              <Fa icon={faBoxOpen} className="mt-0.5" style={{ color: 'var(--navy)' }} />
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                Closes this repair as <strong>Left with Deed</strong> and opens a <strong>draft BuyBack</strong> in Trade-in
                for {r.productName}. Finance approves, pays the customer, then stocks the device.
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest mb-1.5">Offer amount (KES)</label>
              <input
                className="form-input w-full"
                type="number"
                min={0}
                step={1}
                value={tradeInPrice}
                onChange={e => setTradeInPrice(e.target.value)}
                placeholder="e.g. 25000"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest mb-1.5">Condition</label>
              <select
                className="form-select w-full"
                value={tradeInCondition}
                onChange={e => setTradeInCondition(e.target.value as 'good' | 'fair' | 'poor')}
              >
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="poor">Poor (refurb)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[var(--text-3)] uppercase tracking-widest mb-1.5">Notes (optional)</label>
              <textarea
                className="form-input w-full resize-none"
                rows={3}
                value={tradeInNotes}
                onChange={e => setTradeInNotes(e.target.value)}
                placeholder="e.g. Customer declined repair — accepted trade-in offer"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowTradeInModal(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={tradeInPrice === '' || Number(tradeInPrice) < 0}
                onClick={() => {
                  const result = createTradeInFromRepair(r.id, {
                    unitPrice: Number(tradeInPrice),
                    condition: tradeInCondition,
                    notes: tradeInNotes.trim() || undefined,
                  })
                  if (result.ok) {
                    setShowTradeInModal(false)
                    setTradeInPrice('')
                    setTradeInNotes('')
                  }
                }}
              >
                Create trade-in draft
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Outbound Release Panel */}
      {showOrcPanel && repairOrc && (
        <OutboundReleasePanel
          release={repairOrc}
          isRepair
          onClose={() => setShowOrcPanel(false)}
        />
      )}

      {showWaiveFeeModal && (
        <Modal variant="enterprise" title="Waive Diagnosis Fee" subtitle={r.ref} onClose={() => setShowWaiveFeeModal(false)} width={440}>
          <div className="flex flex-col gap-4">
            <p className="text-[11px] text-[var(--text-2)] leading-relaxed">
              Waiving removes the diagnosis fee from this job. Labour and parts stay separate and are still billed if applicable.
            </p>
            <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)]">Reason (required)</label>
            <textarea
              className="form-input min-h-[88px]"
              value={waiveFeeReason}
              onChange={e => setWaiveFeeReason(e.target.value)}
              placeholder="e.g. Goodwill / director approval for VIP client"
            />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowWaiveFeeModal(false)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => {
                  waiveDiagnosisFee(r.id, waiveFeeReason)
                  setShowWaiveFeeModal(false)
                  setWaiveFeeReason('')
                }}
              >
                Confirm waive
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showNoChargeModal && (
        <Modal variant="enterprise" title="Mark No-Charge" subtitle={r.ref} onClose={() => setShowNoChargeModal(false)} width={460}>
          <div className="flex flex-col gap-4">
            <p className="text-[11px] text-[var(--text-2)] leading-relaxed">
              Use for company-mistake rework or goodwill. This skips customer quote approval and invoicing,
              zeroes the customer total, and sets the diagnosis fee to not applicable. Parts may still be
              requested internally.
            </p>
            <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)]">Reason</label>
            <select
              className="form-input"
              value={noChargeReason}
              onChange={e => setNoChargeReason(e.target.value)}
            >
              {(Object.keys(BILLING_EXEMPT_REASON_LABELS) as BillingExemptReason[]).map(key => (
                <option key={key} value={key}>{BILLING_EXEMPT_REASON_LABELS[key]}</option>
              ))}
            </select>
            <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)]">Notes (required)</label>
            <textarea
              className="form-input min-h-[88px]"
              value={noChargeNotes}
              onChange={e => setNoChargeNotes(e.target.value)}
              placeholder="e.g. Comeback — screen still flickering after our last repair; Deed error"
            />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowNoChargeModal(false)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => {
                  markRepairNoCharge(r.id, {
                    reason: noChargeReason as BillingExemptReason,
                    notes: noChargeNotes,
                  })
                  setShowNoChargeModal(false)
                  setNoChargeNotes('')
                }}
              >
                Confirm no-charge
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
