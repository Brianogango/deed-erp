// @ts-nocheck
'use client'
import { useState, useMemo, useRef, useCallback, useEffect, Suspense } from 'react'
import { useRepairStore } from '@/lib/store'
import { useRepair, RepairProvider } from './repair/RepairContext'
import RepairClientJobs from './RepairClientJobs'
import RepairRefurbJobs from './RepairRefurbJobs'
import RepairDetailView from './repair/RepairDetailView'
import RepairIntake from '../repair/RepairIntake'
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
import { ModuleSkeleton, TabBar, useMounted } from '@/components/ui'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'

function RepairContent() {
  const { 
    view, setView, activeRepair, setActiveId, mainTab, setMainTab,
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

  return (
    <div className="mod-page h-full min-h-0">
      {view === 'list' && (
        <div className="flex flex-col h-full overflow-hidden">
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
              <RepairClientJobs onNewIntake={() => setView('intake')} onSelect={(id) => { setActiveId(id); setView('detail') }} />
            ) : (
              <RepairRefurbJobs onSelect={(id) => { setActiveId(id); setView('detail') }} />
            )}
          </div>
        </div>
      )}

      {view === 'intake' && (
        <RepairIntake onCancel={() => setView('list')} onSuccess={(id) => { setActiveId(id); setView('detail') }} />
      )}

      {view === 'detail' && activeRepair && (
        <RepairDetailView />
      )}

      {/* Global Repair Modals */}
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
    getVisibleRepairs, updateRepairProgress, moveRepairToPreviousProgress, requestProcurement, markUnrepairable, returnToCustomer, fileWarrantyClaim, showToast, appendRepairHistory
  } = useRepairStore()

  const [urlActiveId, setUrlActiveId] = useUrlRecordId()
  const [view, setLocalView] = useState('list')
  const [activeId, setLocalActiveId] = useState(null)
  const setActiveId = useCallback((id) => {
    setLocalActiveId(id)
    setUrlActiveId(id)
  }, [setUrlActiveId])
  const setView = useCallback((nextView) => {
    setLocalView(nextView)
    if (nextView === 'list') setActiveId(null)
  }, [setActiveId])
  const [filter, setFilter] = useState('all')
  const [mainTab, setMainTab] = useState('client')
  
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
        appendRepairHistory(repairId, {
          status: 'qc',
          date: new Date().toISOString(),
          note: `QC report attached: ${report.name}`,
        })
        showToast('QC report uploaded as a lightweight download link', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'QC report upload failed', 'error')
      } finally {
        setLoading(false)
      }
      return
    }

    // Diagnosis reports: store on the server (like QC reports) instead of
    // embedding the file as base64 inside the repair record.
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
      updateRepair(repairId, {
        diagnosisReportData: undefined,
        diagnosisReportName: report.name,
        diagnosisReportUrl: report.url,
      })
      appendRepairHistory(repairId, {
        status: 'diagnosed',
        date: new Date().toISOString(),
        note: `Diagnosis report attached: ${report.name}`,
      })
      showToast('Diagnosis report uploaded as a lightweight download link', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Diagnosis report upload failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [repairs, updateRepair, appendRepairHistory, showToast])

  const activeRepair = useMemo(() => repairs.find(r => r.id === activeId), [repairs, activeId])
  const currentUser = useMemo(() => users.find(u => u.id === currentUserId), [users, currentUserId])
  const visibleRepairs = useMemo(() => {
    const all = getVisibleRepairs()
    return filter === 'all' ? all : all.filter(r => r.status === filter)
  }, [getVisibleRepairs, filter, repairs])

  // Deep-link: keep ?id=<repairId> while a repair is open and restore it on refresh.
  // Back clears local + URL via setActiveId(null); do not fight that with a stale ?id=.
  useEffect(() => {
    if (!urlActiveId) {
      if (activeId) setLocalActiveId(null)
      if (view === 'detail') setLocalView('list')
      return
    }

    if (repairs.some(r => r.id === urlActiveId)) {
      if (activeId !== urlActiveId) setLocalActiveId(urlActiveId)
      if (view !== 'detail') setLocalView('detail')
    }
  }, [urlActiveId, repairs, activeId, view])

  if (!mounted) return <ModuleSkeleton />

  const contextValue = {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs, warranties, systemSettings, companySettings,
    createRepair, updateRepair, deleteRepair, verifyRepairIntake, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote, approveRepairQuote,
    startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived, scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    getVisibleRepairs, updateRepairProgress, moveRepairToPreviousProgress, requestProcurement, markUnrepairable, returnToCustomer, fileWarrantyClaim, showToast, appendRepairHistory,
    view, setView, activeId, setActiveId, filter, setFilter, mainTab, setMainTab,
    showAssignModal, setShowAssignModal, showDiagnosisModal, setShowDiagnosisModal, showQuoteModal, setShowQuoteModal, showQAModal, setShowQAModal,
    showDeliveryModal, setShowDeliveryModal, showProgressModal, setShowProgressModal, showProcurementModal, setShowProcurementModal, showReturnModal, setShowReturnModal,
    showDeclineModal, setShowDeclineModal, showMarkDeliveredConfirm, setShowMarkDeliveredConfirm,
    showCancelModal, setShowCancelModal, showDeleteConfirm, setShowDeleteConfirm,
    showEditDetailsModal, setShowEditDetailsModal,
    showStopDiagnosisModal, setShowStopDiagnosisModal,
    diagReportInputRef, qcReportInputRef, uploadingDiagReport, setUploadingDiagReport, uploadingQcReport, setUploadingQcReport, handleReportUpload,
    visibleRepairs, activeRepair, currentUser
  }

  return (
    <RepairProvider value={contextValue}>
      <RepairContent />
    </RepairProvider>
  )
}
