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
  faFileInvoiceDollar, faCalendarAlt, faTrash, faUpload, faSync,
  faExpand, faTools, faCheckCircle, faHistory,
  faClipboardList, faQuoteRight, faStethoscope, faWrench,
  faBoxOpen, faStickyNote, faPaperPlane, faExclamationTriangle,
  faClock, faStar, faArrowRight, faCartPlus, faBan, faShieldAlt,
  faTruck, faPrint, faPen, faUndo,
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
import { isDirectRepairPath, quotableStatusesForPath, repairPathLabel, startableStatusesForPath } from '@/lib/repair-path'

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

function SectionCard({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <section
      className={`bg-[var(--bg-card)] rounded-xl sm:rounded-2xl border border-[var(--border)] shadow-sm overflow-hidden ${className}`}
      style={{ animation: 'cardUp 0.5s ease both', animationDelay: `${delay}ms` }}
    >
      {children}
    </section>
  )
}

function SectionHeader({ icon, iconBg, title, subtitle, action }: any) {
  return (
    <div className="flex items-start sm:items-center justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-[var(--border-lt)] gap-2">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center shadow-sm shrink-0 ${iconBg}`}>
          <Fa icon={icon} className="text-white text-xs sm:text-sm" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[11px] sm:text-[12px] font-black text-[var(--text-1)] uppercase tracking-wider leading-none">{title}</h3>
          {subtitle && <p className="text-[9px] sm:text-[10px] text-[var(--text-3)] font-semibold mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 mt-0.5 sm:mt-0">{action}</div>}
    </div>
  )
}

function InfoField({ label, value, highlight = false, mono = false }: any) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">{label}</span>
      <p className={`text-[11px] sm:text-[12px] leading-tight truncate ${highlight ? 'font-black text-blue-600' : 'font-semibold text-[var(--text-2)]'} ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-[var(--text-4)] italic text-[10px]">—</span>}
      </p>
    </div>
  )
}

function ActionBtn({ onClick, href, icon, label, color, shadow, pulse = false }: any) {
  const cls = `relative flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-white text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${color} ${shadow} shadow-lg whitespace-nowrap shrink-0`
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
    activeRepair: r, currentUserId, currentUser, systemSettings, setView, setActiveId,
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

  const { invoices, setModule, outboundReleases, initRelease, serials, reviewPortalPayment, leaveDeviceWithDeed, convertRetainedRepairToDonation, convertRetainedRepairToBuyBack, createTradeInFromRepair, waiveDiagnosisFee } = useRepairStore()

  const [showOrcPanel, setShowOrcPanel] = useState(false)
  const [showPaymentRejectInput, setShowPaymentRejectInput] = useState(false)
  const [paymentRejectReason, setPaymentRejectReason] = useState('')
  const [waiveFeeReason, setWaiveFeeReason] = useState('')
  const [showWaiveFeeModal, setShowWaiveFeeModal] = useState(false)

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
  const canAssign   = (currentUser?.role === 'technical_lead' || (currentUser?.role === 'director' && systemSettings?.repAdminAssignsJobs))
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
  const canQuote    = quotableStatusesForPath(r.repairPath).includes(r.status)
    && (isDirectRepairPath(r.repairPath) || !!(r.diagnosis?.findings || r.diagnosis?.faultDescription))
    && (isMyRepair || ['director','admin_officer','technical_lead','sales_rep','finance_officer'].includes(currentUser?.role ?? ''))
    && !r.diagnosisStopped
    && !pendingOutsourceJob
    // Lock quote editing once device is marked ready-for-collection or has been picked up
    && !['ready','invoiced','verified_released','delivered','closed','cancelled','declined','unrepairable','returned','retained'].includes(r.status)
  const canStart      = startableStatusesForPath(r.repairPath).includes(r.status) && isMyRepair && !pendingOutsourceJob
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
  const canStopAtDiagnosis    = !r.diagnosisStopped && !!r.diagnosis && !isDirectRepairPath(r.repairPath)
  const canWaiveDiagnosisFee  = ['director', 'technical_lead', 'admin_officer', 'finance_officer'].includes(currentRole)
    && !isDirectRepairPath(r.repairPath)
    && r.diagnosisFeeStatus !== 'waived'
    && r.diagnosisFeeStatus !== 'invoiced'
    && r.diagnosisFeeStatus !== 'not_applicable'
    && (r.diagnosisFee ?? 0) > 0
    && !TERMINAL.includes(r.status)
  // Return the device unrepaired at no charge (e.g. goodwill / part unavailable)
  const canReturnDevice       = ['director', 'admin_officer', 'technical_lead'].includes(currentRole)
    && ['received', 'assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc'].includes(r.status)
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
  const canInvoice = r.status === 'ready'
    && !r.underWarranty
    && !r.invoiceId
    && ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')
    && !pendingOutsourceJob
  const canCloseJob = ['delivered', 'collected'].includes(r.status)
    && ['director', 'admin_officer', 'technical_lead', 'finance_officer'].includes(currentRole)
  const canMarkUnrepairable = ['assigned', 'diagnosed', 'in_repair'].includes(r.status)
    && ['technical_lead', 'director'].includes(currentRole)
    && !pendingOutsourceJob
  const failedQcItems = (r.qcItems ?? []).filter(item => item.testedDate && !item.passed)
  const showQcFailPanel = !!(r.qcFailReason || failedQcItems.length) && ['in_repair', 'qc'].includes(r.status)
  const canUpdateProgress = !TERMINAL.includes(r.status)
    && ['approved', 'awaiting_parts', 'in_repair', 'ready'].includes(r.status)
    && (isMyRepair || ['director', 'technical_lead', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? ''))
    && !pendingOutsourceJob

  const linkedInvoice      = invoices.find(i => i.id === (r.invoiceId ?? (r as any).linkedInvoiceId))
  const linkedOutsourceJob = pendingOutsourceJob ?? outsourceJobs.find(j => j.repairOrderId === r.id)

  const hasProc      = (r.procurementRequests?.length ?? 0) > 0
  const hasPartsUsed = (r.partsUsed?.length ?? 0) > 0

  const nextActionHint = pendingOutsourceJob ? `Device is at ${pendingOutsourceJob.vendorName} via ${pendingOutsourceJob.ref}. Mark it returned in Outsource before continuing.`
    : canDiagnose ? 'Log your technical diagnosis to proceed'
    : canMarkPartsArrived ? 'Confirm parts have arrived so the technician can start'
    : canStart     ? 'Start the repair'
    : canComplete  ? 'Mark repair complete to submit for QA'
    : canPerformQA ? 'Perform QC check — repair is ready for testing'
    : canInvoice   ? 'Generate the customer invoice before release'
    : canQuote && !r.quote ? 'Generate a repair quote'
    : canQuote && r.quote ? 'Update or re-send the quote to move forward'
    : canCloseJob  ? 'Close the job after collection'
    : r.status === 'awaiting_parts' ? 'Parts are being sourced — monitor procurement below'
    : r.status === 'diagnosed' && !hasDiagnosis ? 'Diagnosis stage has no findings — log diagnosis to continue'
    : r.status === 'diagnosed' ? 'Generate or edit the quote to continue past diagnosis'
    : null

  // Exactly one dominant workflow CTA; everything else goes into More.
  const primaryActionId = canVerify ? 'verify'
    : canMarkPartsArrived ? 'parts_arrived'
    : canStart ? 'start'
    : canComplete ? 'complete'
    : canPerformQA ? 'qc'
    : canInvoice ? 'invoice'
    : canPrepareRelease ? 'prepare_release'
    : (canMarkCollected && (repairOrc?.status === 'verified' || !repairOrc)) ? 'collect'
    : canCloseJob ? 'close'
    : canDiagnose ? 'diagnose'
    : (canUpdateDiagnosis && !canQuote) ? 'diagnose'
    : canQuote ? 'quote'
    : canAssign ? 'assign'
    : null

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

  return (
    <div className="bg-[var(--bg-page)] pb-8" style={{ animation: 'fadeIn 0.3s ease both' }}>
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
      <header className="erp-record-header sticky top-0 z-30 shadow-sm">
        <div className="w-full max-w-[1440px] mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">

          {/* Left: back + title */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              aria-label="Back to repair list"
              onClick={() => { setActiveId(null); setView('list') }}
              className="w-11 h-11 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] text-[var(--text-2)] flex items-center justify-center transition-colors shrink-0"
            >
              <Fa icon={faArrowLeft} className="text-sm" />
            </button>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
              <h2 className="erp-record-title font-mono shrink-0">{r.ref}</h2>
              <StatusChip status={r.status} />
              <span className="hidden md:flex items-center gap-1.5 text-xs font-medium text-[var(--text-3)] min-w-0">
                <span className="text-[var(--border)]">·</span>
                <span className="text-[var(--text-1)] font-semibold truncate max-w-[140px]">{r.customerName}</span>
                <span className="text-[var(--border)]">·</span>
                <span className="text-[var(--primary)] truncate max-w-[140px]">{r.productName}</span>
              </span>
              <span className="md:hidden text-xs font-medium text-[var(--text-3)] truncate max-w-full">
                {r.customerName} · <span className="text-[var(--primary)]">{r.productName}</span>
              </span>
              {isMyRepair && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--success-bg)] text-[var(--success-text)] text-[11px] font-semibold">
                  Your job
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${
                  isDirectRepairPath(r.repairPath)
                    ? 'bg-violet-50 text-violet-700 border-violet-200'
                    : 'bg-sky-50 text-sky-700 border-sky-200'
                }`}
                title={isDirectRepairPath(r.repairPath) ? 'Bypasses diagnosis; quotes auto-approve' : 'Tech diagnoses before quoting'}
              >
                {repairPathLabel(r.repairPath)}
              </span>
            </div>
          </div>

          {/* One primary workflow action + overflow for secondary/danger */}
          <div className="section-actions flex flex-wrap items-center gap-2 justify-start sm:justify-end shrink-0">
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

            {primaryActionId === 'verify' && (
              <ActionBtn onClick={handleVerify} icon={faUserCheck} label="Verify intake" color="bg-emerald-600 hover:bg-emerald-700" shadow="shadow-emerald-100" />
            )}
            {primaryActionId === 'assign' && (
              <ActionBtn onClick={() => setShowAssignModal(true)} icon={faUserPlus} label={r.assignedTechnicianId ? 'Reassign' : 'Assign technician'} color="bg-slate-900 hover:bg-black" shadow="shadow-slate-200" />
            )}
            {primaryActionId === 'diagnose' && (
              <ActionBtn onClick={() => setShowDiagnosisModal(true)} icon={faStethoscope} label={canUpdateDiagnosis && !canDiagnose ? 'Update diagnosis' : 'Log diagnosis'} color="bg-blue-600 hover:bg-blue-700" shadow="shadow-blue-100" pulse={canDiagnose} />
            )}
            {primaryActionId === 'quote' && (
              <ActionBtn onClick={() => setShowQuoteModal(true)} icon={faFileInvoiceDollar} label="Generate quote" color="bg-indigo-600 hover:bg-indigo-700" shadow="shadow-indigo-100" pulse />
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
              <ActionBtn onClick={() => setShowProgressModal(true)} icon={faFileInvoiceDollar} label="Create invoice" color="bg-amber-600 hover:bg-amber-700" shadow="shadow-amber-100" pulse />
            )}
            {primaryActionId === 'prepare_release' && (
              <ActionBtn
                onClick={() => {
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
                }}
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

            <SecondaryActionMenu
              ariaLabel="More repair actions"
              actions={[
                { id: 'decline', label: 'Decline', onClick: () => setShowDeclineModal(true), hidden: !canVerify, danger: true },
                { id: 'assign', label: r.assignedTechnicianId ? 'Reassign technician' : 'Assign technician', onClick: () => setShowAssignModal(true), hidden: !canAssign || primaryActionId === 'assign' },
                { id: 'diagnosis', label: canUpdateDiagnosis ? 'Update diagnosis' : 'Log diagnosis', onClick: () => setShowDiagnosisModal(true), hidden: !(canDiagnose || canUpdateDiagnosis) || primaryActionId === 'diagnose' },
                { id: 'quote', label: r.quote ? 'Edit quote' : 'Generate quote', onClick: () => setShowQuoteModal(true), hidden: !canQuote || primaryActionId === 'quote' },
                { id: 'parts_arrived', label: 'Mark parts arrived', onClick: () => markPartsArrived(r.id), hidden: !canMarkPartsArrived || primaryActionId === 'parts_arrived' },
                { id: 'progress', label: 'Update progress', onClick: () => setShowProgressModal(true), hidden: !canUpdateProgress || ['start', 'complete', 'invoice'].includes(primaryActionId ?? '') },
                { id: 'invoice', label: 'Create invoice', onClick: () => setShowProgressModal(true), hidden: !canInvoice || primaryActionId === 'invoice' },
                { id: 'procure', label: 'Request parts', onClick: () => setShowProcurementModal(true), hidden: !canProcure },
                { id: 'stop', label: 'Stop at diagnosis', onClick: () => setShowStopDiagnosisModal(true), hidden: !canStopAtDiagnosis },
                { id: 'waive_fee', label: 'Waive diagnosis fee', onClick: () => { setWaiveFeeReason(''); setShowWaiveFeeModal(true) }, hidden: !canWaiveDiagnosisFee },
                { id: 'return', label: 'Return device', onClick: () => setShowReturnModal(true), hidden: !canReturnDevice },
                { id: 'leave', label: 'Customer leaves device', onClick: () => { setLeaveDeviceNotes(''); setLeaveConvertMode('donation'); setShowLeaveDeviceModal(true) }, hidden: !canLeaveDeviceWithDeed },
                { id: 'tradein', label: 'Trade-in after evaluation', onClick: () => {
                  setTradeInPrice('')
                  setTradeInCondition((r.deviceCondition === 'poor' || r.deviceCondition === 'damaged') ? 'poor' : r.deviceCondition === 'fair' ? 'fair' : 'good')
                  setTradeInNotes('')
                  setShowTradeInModal(true)
                }, hidden: !canTradeInFromRepair },
                { id: 'convert_donation', label: 'Convert → Donation', onClick: () => convertRetainedRepairToDonation(r.id), hidden: !canConvertRetained },
                { id: 'convert_buyback', label: 'Convert → Buy-back stock', onClick: () => convertRetainedRepairToBuyBack(r.id), hidden: !canConvertRetained },
                { id: 'unrepairable', label: 'Mark unrepairable', onClick: () => { setUnrepairableReason(''); setShowUnrepairableModal(true) }, hidden: !canMarkUnrepairable, danger: true },
                { id: 'back', label: 'Back step', onClick: () => moveRepairToPreviousProgress(r.id), hidden: !canMoveBack },
                { id: 'schedule', label: 'Schedule delivery', onClick: () => setShowDeliveryModal(true), hidden: !canScheduleDelivery },
                { id: 'close', label: 'Close job', onClick: () => closeRepairJob(r.id), hidden: !canCloseJob || primaryActionId === 'close' },
                { id: 'claim', label: 'File warranty claim', onClick: () => setShowClaimModal(true), hidden: !(r.underWarranty && !r.warrantyClaimId && ['director', 'admin_officer', 'finance_officer'].includes(currentUser?.role ?? '')) },
                { id: 'edit', label: 'Edit details', onClick: () => setShowEditDetailsModal(true), hidden: !canEditDetails },
                { id: 'sticker', label: 'Print sticker', onClick: () => { void printRepairSticker(r) } },
                { id: 'cancel', label: 'Cancel repair', onClick: () => setShowCancelModal(true), hidden: !canCancel, danger: true },
                { id: 'delete', label: 'Delete repair', onClick: () => setShowDeleteConfirm(true), hidden: !canDelete, danger: true },
              ]}
            />
          </div>
        </div>

        {/* Next-action hint for assigned tech or QA performer */}
        {(isMyRepair || canPerformQA) && nextActionHint && (
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

      {/* ── Body ── */}
      <div className="p-3 sm:p-4 lg:p-6">
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 lg:gap-6">

          {/* ═══ Left Column ═══ */}
          <div className="lg:col-span-8 space-y-4 sm:space-y-5 lg:space-y-6">

            {/* Device & Client */}
            <SectionCard delay={60}>
              <SectionHeader
                icon={faMicrochip}
                iconBg="bg-slate-800"
                title="Device & Client"
                subtitle="Intake profile"
                action={
                  <div className="flex items-center gap-1.5 bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--border)]">
                    <Fa icon={faCalendarAlt} className="text-[var(--text-3)] text-[9px]" />
                    <span className="text-[10px] font-bold text-[var(--text-2)] whitespace-nowrap">
                      {new Date(r.intakeDate).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
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
            <SectionCard delay={130}>
              <SectionHeader icon={faCircleExclamation} iconBg="bg-amber-500" title="Reported Issue" subtitle="Customer's description" />
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
              <SectionCard delay={200}>
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
                    {((r.diagnosisFee && r.diagnosisFee > 0) || r.diagnosisFeeStatus === 'waived' || r.deviceTier) && (
                      <div className="p-3 rounded-xl bg-[rgba(245,158,11,0.08)] border border-amber-500/25">
                        <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Diagnosis Fee</p>
                        <p className="text-[13px] font-black text-amber-500">
                          {r.diagnosisFeeStatus === 'waived'
                            ? 'Waived'
                            : (r.diagnosisFee && r.diagnosisFee > 0 ? fmtKes(r.diagnosisFee) : '—')}
                        </p>
                        {r.deviceTier && (
                          <p className="text-[10px] font-semibold text-amber-700/80 mt-0.5">
                            {r.deviceTier === 'high_end' ? 'High-end' : 'Regular'} · 0% VAT
                          </p>
                        )}
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
              <SectionCard delay={50}>
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
              <SectionCard delay={70}>
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
            {(r.qcReportUrl || r.qcReportData || r.qcReportName) && (
              <SectionCard delay={270}>
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

            {/* ── Parts Used in Repair ── */}
            {hasPartsUsed && (
              <SectionCard delay={260}>
                <SectionHeader
                  icon={faBoxOpen}
                  iconBg="bg-orange-500"
                  title="Parts Used"
                  subtitle={`${r.partsUsed.length} component${r.partsUsed.length !== 1 ? 's' : ''}`}
                />
                <div className="px-4 sm:px-6 py-4 sm:py-5">
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
                </div>
              </SectionCard>
            )}


            {/* Issue Photos */}
            <SectionCard delay={380}>
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
          <div className="lg:col-span-4 space-y-4 sm:space-y-5 lg:space-y-6">

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
            <SectionCard delay={100}>
              <SectionHeader icon={faQuoteRight} iconBg="bg-emerald-600" title="Financials" subtitle="Quote & charges" />
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
              <SectionCard delay={180}>
                <SectionHeader
                  icon={faBoxOpen}
                  iconBg="bg-orange-500"
                  title="Parts & Procurement"
                  subtitle={`${r.procurementRequests.length} request${r.procurementRequests.length !== 1 ? 's' : ''}`}
                  action={
                    canProcure
                      ? <button onClick={() => setShowProcurementModal(true)} className="text-[9px] font-black text-orange-600 uppercase tracking-wider px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-all">+ New</button>
                      : null
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
                                <p className="text-[11px] font-bold text-[var(--text-1)] truncate">{item.productName || item.description}</p>
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
              <SectionCard delay={180}>
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
            ) : null}

            {/* Work Notes */}
            <SectionCard delay={160}>
              <SectionHeader
                icon={faStickyNote}
                iconBg="bg-navy-500"
                title="Work Notes"
                subtitle="Technician progress log"
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

            {/* Repair Timeline */}
            <SectionCard delay={340}>
              <SectionHeader icon={faHistory} iconBg="bg-slate-600" title="Repair Timeline" subtitle="Status & progress history" />
              <div className="px-4 sm:px-6 py-4 sm:py-5">
                <StatusStepper
                  currentStatus={r.status}
                  history={r.statusHistory || []}
                  steps={repairProgressOrderFor(r)}
                />
              </div>
            </SectionCard>

          </div>
        </div>
      </div>

      {/* Warranty Claim Modal */}
      {showClaimModal && (
        <Modal title="File Warranty Claim" onClose={() => { setShowClaimModal(false); setClaimNotes('') }}>
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
        <Modal title="Mark Unrepairable" onClose={() => { setShowUnrepairableModal(false); setUnrepairableReason('') }}>
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
        <Modal title="Customer Leaves Device" onClose={() => setShowLeaveDeviceModal(false)}>
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
        <Modal title="Trade-in after evaluation" subtitle={r.ref} onClose={() => setShowTradeInModal(false)} width={460}>
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
        <Modal title="Waive Diagnosis Fee" subtitle={r.ref} onClose={() => setShowWaiveFeeModal(false)} width={440}>
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
    </div>
  )
}
