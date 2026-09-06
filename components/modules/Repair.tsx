// @ts-nocheck
'use client'
import { useState, useMemo, useRef, useCallback, useEffect, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRepairStore } from '@/lib/store'
import { useRepair, RepairProvider } from './repair/RepairContext'
import RepairClientJobs from './RepairClientJobs'
import RepairRefurbJobs from './RepairRefurbJobs'
import {
  AssignTechnicianModal,
  LogDiagnosisModal,
  QuoteModal,
  QAModal,
  ScheduleDeliveryModal,
  RepairProgressModal,
  ProcurementModal,
  ReturnModal,
  DeclineModal,
  MarkDeliveredConfirm,
  CancelRepairModal,
  DeleteRepairConfirm,
  EditRepairDetailsModal,
  StopAtDiagnosisModal
} from './RepairModals'
import { ModuleHeader, ModuleSkeleton, StatePanel, TabBar, useMounted } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import { Fa } from '@/components/icons'
import { faPlus, faTools } from '@fortawesome/free-solid-svg-icons'
import { useRouter } from 'next/navigation'
import { useUrlQueryState, useUrlRecordId } from '@/hooks/useUrlRecordId'
import { isOpenRepairJob } from '@/lib/repair-progress'
import {
  canApplyPolledRepair,
  isDeedRepairsBlobDirty,
  refurbishmentJobHref,
  repairDetailPanel,
  resolveRepairWorkspaceId,
} from '@/lib/repair-open-record'
import { DIRTY_KEYS_LS } from '@/lib/store'
import { repairModuleView } from '@/lib/repair-workspace-view'

const RepairDetailView = dynamic(() => import('./repair/RepairDetailView'), {
  loading: () => <ModuleSkeleton />,
})
const RepairIntake = dynamic(() => import('../repair/RepairIntake'), {
  loading: () => <ModuleSkeleton />,
})

function RepairContent() {
  const {
    view, setView, activeRepair, setActiveId, mainTab, setMainTab, openRepairCount, currentUser,
    openRefurbJob, detailPanel,
    showAssignModal, setShowAssignModal,
    showDiagnosisModal, setShowDiagnosisModal,
    showQuoteModal, setShowQuoteModal,
    showQAModal, setShowQAModal,
    showDeliveryModal, setShowDeliveryModal,
    showProgressModal, setShowProgressModal,
    showProcurementModal, setShowProcurementModal,
    showReturnModal, setShowReturnModal,
    showDeclineModal, setShowDeclineModal,
    showMarkDeliveredConfirm, setShowMarkDeliveredConfirm,
    showCancelModal, setShowCancelModal,
    showDeleteConfirm, setShowDeleteConfirm,
    showEditDetailsModal, setShowEditDetailsModal,
    showStopDiagnosisModal, setShowStopDiagnosisModal
  } = useRepair()
  const canCreateIntake = ['director', 'admin_officer'].includes(currentUser?.role ?? '')

  return (
    <div className={`mod-page repair-workspace repair-workspace--${view} h-full min-h-0`}>
      {view === 'list' && (
        <div className="repair-list-shell flex flex-col h-full overflow-hidden">
          <div className="repair-module-header">
            <ModuleHeader
              title="Repair management"
              subtitle={`${openRepairCount} open job${openRepairCount === 1 ? '' : 's'}`}
              subtitleMode="visible"
              icon={<Fa icon={faTools} />}
              color="#061B4F"
              primaryAction={canCreateIntake ? (
                <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => setView('intake')} hideLabelOnMobile={false}>
                  New repair
                </PrimaryActionButton>
              ) : undefined}
            />
          </div>
          <TabBar
            tabs={[
              { id: 'client', label: 'Active jobs' },
              { id: 'refurb', label: 'Refurbishment' },
            ]}
            active={mainTab}
            onChange={id => setMainTab(id)}
            maxVisibleDesktop={6}
            ariaLabel="Repair sections"
          />
          <div className="flex-1 overflow-hidden flex flex-col">
            {mainTab === 'client' ? (
              <RepairClientJobs onSelect={(id) => { setActiveId(id); setView('detail') }} />
            ) : (
              <RepairRefurbJobs onSelect={openRefurbJob} />
            )}
          </div>
        </div>
      )}

      {view === 'intake' && (
        <RepairIntake onCancel={() => setView('list')} onSuccess={(id) => { setActiveId(id); setView('detail') }} />
      )}

      {detailPanel === 'detail' && activeRepair && <RepairDetailView />}
      {detailPanel === 'loading' && (
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <StatePanel
            tone="loading"
            title="Loading repair job"
            description="Fetching the open job. Stay on this page."
          />
        </div>
      )}
      {detailPanel === 'missing' && (
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <StatePanel
            tone="empty"
            title="Repair job not found"
            description="This link is not a repair order. It may have been removed, or it belongs to another module."
            action={(
              <PrimaryActionButton onClick={() => setView('list')} hideLabelOnMobile={false}>
                Back to jobs
              </PrimaryActionButton>
            )}
          />
        </div>
      )}

      {showAssignModal && activeRepair && <AssignTechnicianModal repair={activeRepair} onClose={() => setShowAssignModal(false)} />}
      {showDiagnosisModal && activeRepair && <LogDiagnosisModal repair={activeRepair} onClose={() => setShowDiagnosisModal(false)} />}
      {showQuoteModal && activeRepair && <QuoteModal repair={activeRepair} onClose={() => setShowQuoteModal(false)} />}
      {showQAModal && activeRepair && <QAModal repair={activeRepair} onClose={() => setShowQAModal(false)} />}
      {showDeliveryModal && activeRepair && <ScheduleDeliveryModal repair={activeRepair} onClose={() => setShowDeliveryModal(false)} />}
      {showProgressModal && activeRepair && <RepairProgressModal repair={activeRepair} onClose={() => setShowProgressModal(false)} />}
      {showProcurementModal && activeRepair && <ProcurementModal repair={activeRepair} onClose={() => setShowProcurementModal(false)} />}
      {showReturnModal && activeRepair && <ReturnModal repair={activeRepair} onClose={() => setShowReturnModal(false)} />}
      {showDeclineModal && activeRepair && <DeclineModal repair={activeRepair} onClose={() => setShowDeclineModal(false)} />}
      {showMarkDeliveredConfirm && activeRepair && <MarkDeliveredConfirm repair={activeRepair} onClose={() => setShowMarkDeliveredConfirm(false)} />}
      {showCancelModal && activeRepair && <CancelRepairModal repair={activeRepair} onClose={() => setShowCancelModal(false)} />}
      {showDeleteConfirm && activeRepair && <DeleteRepairConfirm repair={activeRepair} onClose={() => setShowDeleteConfirm(false)} onDeleted={() => setView('list')} />}
      {showEditDetailsModal && activeRepair && <EditRepairDetailsModal repair={activeRepair} onClose={() => setShowEditDetailsModal(false)} />}
      {showStopDiagnosisModal && activeRepair && <StopAtDiagnosisModal repair={activeRepair} onClose={() => setShowStopDiagnosisModal(false)} />}
    </div>
  )
}

export default function Repair() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <RepairInner />
    </Suspense>
  )
}

function RepairInner() {
  const mounted = useMounted()
  const {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs, warranties, systemSettings, companySettings,
    createRepair, updateRepair, deleteRepair, verifyRepairIntake, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote, approveRepairQuote,
    startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived, scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    getVisibleRepairs, updateRepairProgress, moveRepairToPreviousProgress, requestProcurement, markUnrepairable, returnToCustomer, fileWarrantyClaim, showToast, appendRepairHistory,
    setModule,
  } = useRepairStore()
  const router = useRouter()

  const [activeId, setActiveId] = useUrlRecordId()
  const [isIntake, setIsIntake] = useState(false)
  const setView = useCallback((nextView) => {
    if (nextView === 'intake') {
      setIsIntake(true)
      setActiveId(null, { history: 'replace' })
      return
    }
    setIsIntake(false)
    // Leaving a detail/intake is not a new navigation destination. Replacing
    // the current entry prevents Repair -> list -> Repair -> list history loops.
    if (nextView === 'list') setActiveId(null, { history: 'replace' })
  }, [setActiveId])
  const [filter, setFilter] = useState('all')
  const [mainTabValue, setMainTabValue] = useUrlQueryState('tab', 'client')
  const mainTab = mainTabValue === 'refurb' ? 'refurb' : 'client'
  const setMainTab = useCallback((nextTab) => {
    setMainTabValue(nextTab === 'refurb' ? 'refurb' : 'client', { history: 'replace' })
  }, [setMainTabValue])

  const [showAssignModal, setShowAssignModal] = useState(false)
  const [showDiagnosisModal, setShowDiagnosisModal] = useState(false)
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [showQAModal, setShowQAModal] = useState(false)
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  const [showProgressModal, setShowProgressModal] = useState(false)
  const [showProcurementModal, setShowProcurementModal] = useState(false)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [showMarkDeliveredConfirm, setShowMarkDeliveredConfirm] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showEditDetailsModal, setShowEditDetailsModal] = useState(false)
  const [showStopDiagnosisModal, setShowStopDiagnosisModal] = useState(false)

  const diagReportInputRef = useRef(null)
  const qcReportInputRef = useRef(null)
  const [uploadingDiagReport, setUploadingDiagReport] = useState(false)
  const [uploadingQcReport, setUploadingQcReport] = useState(false)

  const handleReportUpload = useCallback(async (file, field, nameFld, repairId, setLoading) => {
    const repair = repairs.find(r => r.id === repairId)

    if (field === 'qcReportData') {
      if (!repair?.ref) {
        setLoading(false)
        showToast('Repair reference is missing; QC report was not uploaded', 'error')
        return
      }
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`/api/repair-qc-reports/${encodeURIComponent(repair.ref)}`, { method: 'POST', body: form })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload.error || 'QC report upload failed')
        const report = payload.report
        updateRepair(repairId, {
          qcReportData: undefined,
          qcReportName: report.name,
          qcReportUrl: report.url,
          qcReportId: report.id,
          qcReportSize: report.size,
          qcReportType: report.contentType,
          qcReportUploadedAt: report.uploadedAt,
        })
        appendRepairHistory(repairId, { status: 'qc', date: new Date().toISOString(), note: `QC report attached: ${report.name}` })
        showToast('QC report uploaded as a lightweight download link', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'QC report upload failed', 'error')
      } finally {
        setLoading(false)
      }
      return
    }

    if (!repair?.ref) {
      setLoading(false)
      showToast('Repair reference is missing; report was not uploaded', 'error')
      return
    }
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/repair-diagnosis-reports/${encodeURIComponent(repair.ref)}`, { method: 'POST', body: form })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || 'Diagnosis report upload failed')
      const report = payload.report
      updateRepair(repairId, { diagnosisReportData: undefined, diagnosisReportName: report.name, diagnosisReportUrl: report.url })
      appendRepairHistory(repairId, { status: 'diagnosed', date: new Date().toISOString(), note: `Diagnosis report attached: ${report.name}` })
      showToast('Diagnosis report uploaded as a lightweight download link', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Diagnosis report upload failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [repairs, updateRepair, appendRepairHistory, showToast])

  const localActiveRepair = useMemo(() => repairs.find(r => r.id === activeId) ?? null, [repairs, activeId])
  const [serverActiveRepair, setServerActiveRepair] = useState(null)
  const [detailLookup, setDetailLookup] = useState('idle')
  const localGenerationRef = useRef(0)
  const workspaceIdKind = useMemo(
    () => resolveRepairWorkspaceId(
      activeId,
      repairs.map(r => r.id),
      refurbishmentJobs.map(j => j.id),
    ),
    [activeId, repairs, refurbishmentJobs],
  )

  const openRefurbJob = useCallback((id) => {
    setModule('refurbishment')
    router.push(refurbishmentJobHref(id))
  }, [router, setModule])

  useEffect(() => {
    if (workspaceIdKind !== 'refurb' || !activeId) return
    setModule('refurbishment')
    router.replace(refurbishmentJobHref(activeId))
  }, [activeId, router, setModule, workspaceIdKind])

  const localActiveRepairRef = useRef(localActiveRepair)
  localActiveRepairRef.current = localActiveRepair
  const skipGenerationBumpRef = useRef(true)

  // Keep the open record authoritative without reloading the whole Repair
  // module. This catches updates made from Sales, portal actions, ORC and other
  // tabs. It pauses in background tabs and refreshes immediately on focus.
  useEffect(() => {
    setServerActiveRepair(null)
    if (!activeId || workspaceIdKind === 'refurb') {
      setDetailLookup('idle')
      return
    }
    setDetailLookup(localActiveRepairRef.current ? 'idle' : 'loading')
    let cancelled = false
    let timer = null

    const refreshOpenRepair = async () => {
      if (document.visibilityState === 'hidden') return
      const fetchGeneration = localGenerationRef.current
      const repairsBlobDirty = isDeedRepairsBlobDirty(
        typeof window === 'undefined' ? null : window.localStorage.getItem(DIRTY_KEYS_LS),
      )
      // Dirty local writes must not be overlaid — but an unknown id still
      // needs a lookup so the workspace is not left on a loading panel.
      if (repairsBlobDirty && localActiveRepairRef.current) return
      try {
        const res = await fetch(`/api/repairs/${encodeURIComponent(activeId)}`, { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled && !localActiveRepairRef.current) {
            setDetailLookup('missing')
          }
          return
        }
        const payload = await res.json()
        if (cancelled || payload?.repair?.id !== activeId) return
        if (!canApplyPolledRepair({
          repairsBlobDirty: isDeedRepairsBlobDirty(window.localStorage.getItem(DIRTY_KEYS_LS)),
          localGeneration: localGenerationRef.current,
          fetchGeneration,
        })) return
        setServerActiveRepair(payload.repair)
        setDetailLookup('idle')
      } catch {
        // Preserve the local snapshot when connectivity is interrupted.
      }
    }

    const onFocus = () => { void refreshOpenRepair() }
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshOpenRepair() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    timer = window.setInterval(() => { void refreshOpenRepair() }, 8000)
    void refreshOpenRepair()

    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [activeId, workspaceIdKind])

  // Local mutations must win instantly; the next focused/polled server read
  // reconciles them. This avoids a stale remote snapshot masking a just-saved
  // diagnosis, quote, QC or status change. Skip the first bump so the initial
  // GET can apply; later store writes invalidate in-flight polls.
  useEffect(() => {
    if (skipGenerationBumpRef.current) {
      skipGenerationBumpRef.current = false
    } else {
      localGenerationRef.current += 1
    }
    setServerActiveRepair(null)
  }, [localActiveRepair])

  const repairsBlobDirty = typeof window !== 'undefined'
    && isDeedRepairsBlobDirty(window.localStorage.getItem(DIRTY_KEYS_LS))
  const activeRepair = (
    !repairsBlobDirty && serverActiveRepair?.id === activeId
  ) ? serverActiveRepair : localActiveRepair
  const view = repairModuleView(
    isIntake,
    workspaceIdKind === 'refurb' ? null : activeId,
  )
  const detailPanel = repairDetailPanel({
    view,
    hasActiveRepair: Boolean(activeRepair),
    lookup: detailLookup,
  })
  const currentUser = useMemo(() => users.find(u => u.id === currentUserId), [users, currentUserId])
  const allVisibleRepairs = useMemo(() => getVisibleRepairs(), [getVisibleRepairs, repairs])
  const openRepairCount = useMemo(() => allVisibleRepairs.filter(isOpenRepairJob).length, [allVisibleRepairs])

  // RepairClientJobs owns the URL-backed status/search/filter state. Keeping a
  // second status filter here caused races and stale/empty lists after Back.
  const visibleRepairs = allVisibleRepairs

  if (!mounted) return <ModuleSkeleton />

  const contextValue = {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs, warranties, systemSettings, companySettings,
    createRepair, updateRepair, deleteRepair, verifyRepairIntake, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote, approveRepairQuote,
    startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived, scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    getVisibleRepairs, updateRepairProgress, moveRepairToPreviousProgress, requestProcurement, markUnrepairable, returnToCustomer, fileWarrantyClaim, showToast, appendRepairHistory,
    view, setView, activeId, setActiveId, filter, setFilter, mainTab, setMainTab,
    openRefurbJob, detailPanel,
    showAssignModal, setShowAssignModal, showDiagnosisModal, setShowDiagnosisModal, showQuoteModal, setShowQuoteModal, showQAModal, setShowQAModal,
    showDeliveryModal, setShowDeliveryModal, showProgressModal, setShowProgressModal, showProcurementModal, setShowProcurementModal, showReturnModal, setShowReturnModal,
    showDeclineModal, setShowDeclineModal, showMarkDeliveredConfirm, setShowMarkDeliveredConfirm,
    showCancelModal, setShowCancelModal, showDeleteConfirm, setShowDeleteConfirm,
    showEditDetailsModal, setShowEditDetailsModal,
    showStopDiagnosisModal, setShowStopDiagnosisModal,
    diagReportInputRef, qcReportInputRef, uploadingDiagReport, setUploadingDiagReport, uploadingQcReport, setUploadingQcReport, handleReportUpload,
    visibleRepairs, openRepairCount, activeRepair, currentUser
  }

  return (
    <RepairProvider value={contextValue}>
      <RepairContent />
    </RepairProvider>
  )
}
