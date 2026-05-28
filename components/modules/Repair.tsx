// @ts-nocheck
'use client'
import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useApp } from '@/lib/store'
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
  OutsourceRepairModal
} from './RepairModals'

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
    showOutsourceModal, setShowOutsourceModal
  } = useRepair()

  return (
    <div className="flex flex-col h-full min-h-0">
      {view === 'list' && (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-1 px-2 sm:px-4 py-2 bg-[var(--bg-card)] border-b border-[var(--border)] flex-shrink-0 shadow-sm">
            <button
              className={`flex-1 min-h-[44px] sm:min-h-0 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 ${mainTab === 'client' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-[var(--text-3)] hover:bg-[var(--bg-surface)]'}`}
              onClick={() => setMainTab('client')}
            >
              Client Repairs
            </button>
            <button
              className={`flex-1 min-h-[44px] sm:min-h-0 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 ${mainTab === 'refurb' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-[var(--text-3)] hover:bg-[var(--bg-surface)]'}`}
              onClick={() => setMainTab('refurb')}
            >
              Refurbishment
            </button>
          </div>
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
      {showOutsourceModal && activeRepair && <OutsourceRepairModal repair={activeRepair} onClose={() => setShowOutsourceModal(false)} />}
    </div>
  )
}

export default function Repair() {
  const {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs, warranties, systemSettings, companySettings,
    createRepair, updateRepair, deleteRepair, verifyRepairIntake, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote, approveRepairQuote,
    startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived, scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    getVisibleRepairs, updateRepairProgress, requestProcurement, markUnrepairable, returnToCustomer, showToast, appendRepairHistory
  } = useApp()

  const [view, setView] = useState('list')
  const [activeId, setActiveId] = useState(null)
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
  const [showOutsourceModal, setShowOutsourceModal] = useState(false)

  const diagReportInputRef = useRef(null)
  const qcReportInputRef = useRef(null)
  const [uploadingDiagReport, setUploadingDiagReport] = useState(false)
  const [uploadingQcReport, setUploadingQcReport] = useState(false)

  const handleReportUpload = useCallback((file, field, nameFld, repairId, setLoading) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result
      const isDiagReport = field === 'diagnosisReportData'
      // Write file data first
      updateRepair(repairId, { [field]: data, [nameFld]: file.name })
      // Then write history entry directly via dedicated action (bypasses Partial<RepairOrder> typing issues)
      appendRepairHistory(repairId, {
        status: isDiagReport ? 'diagnosed' : 'qc',
        date: new Date().toISOString(),
        note: isDiagReport ? `Diagnosis report attached: ${file.name}` : `QC report attached: ${file.name}`,
      })
      setLoading(false)
      showToast('Report uploaded successfully', 'success')
    }
    reader.readAsDataURL(file)
  }, [updateRepair, appendRepairHistory, showToast])

  const activeRepair = useMemo(() => repairs.find(r => r.id === activeId), [repairs, activeId])
  const currentUser = useMemo(() => users.find(u => u.id === currentUserId), [users, currentUserId])
  const visibleRepairs = useMemo(() => getVisibleRepairs(filter), [getVisibleRepairs, filter])

  // Deep-link: if URL contains ?id=<repairId>, open that repair on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    if (id) {
      setActiveId(id)
      setView('detail')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const contextValue = {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs, warranties, systemSettings, companySettings,
    createRepair, updateRepair, deleteRepair, verifyRepairIntake, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote, approveRepairQuote,
    startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived, scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    getVisibleRepairs, updateRepairProgress, requestProcurement, markUnrepairable, returnToCustomer, showToast, appendRepairHistory,
    view, setView, activeId, setActiveId, filter, setFilter, mainTab, setMainTab,
    showAssignModal, setShowAssignModal, showDiagnosisModal, setShowDiagnosisModal, showQuoteModal, setShowQuoteModal, showQAModal, setShowQAModal,
    showDeliveryModal, setShowDeliveryModal, showProgressModal, setShowProgressModal, showProcurementModal, setShowProcurementModal, showReturnModal, setShowReturnModal,
    showDeclineModal, setShowDeclineModal, showMarkDeliveredConfirm, setShowMarkDeliveredConfirm,
    showCancelModal, setShowCancelModal, showDeleteConfirm, setShowDeleteConfirm,
    showOutsourceModal, setShowOutsourceModal,
    diagReportInputRef, qcReportInputRef, uploadingDiagReport, setUploadingDiagReport, uploadingQcReport, setUploadingQcReport, handleReportUpload,
    visibleRepairs, activeRepair, currentUser
  }

  return (
    <RepairProvider value={contextValue}>
      <RepairContent />
    </RepairProvider>
  )
}
