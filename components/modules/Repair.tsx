'use client'
import { useState, useEffect, useRef, useCallback, Suspense, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useApp, RepairStatus } from '@/lib/store'
import { ModuleSkeleton } from '@/components/ui'
import RepairClientJobs from './RepairClientJobs'
import RepairRefurbJobs from './RepairRefurbJobs'
import RepairIntake from '../repair/RepairIntake'
import { RepairProvider } from './repair/RepairContext'
import RepairDetailView from './repair/RepairDetailView'
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
  MarkDeliveredConfirm 
} from './RepairModals'

type View = 'list' | 'intake' | 'detail'

export default function Repair() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <RepairContent />
    </Suspense>
  )
}

function RepairContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs,
    warranties, createRepair, updateRepair, deleteRepair,
    verifyRepairIntake, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote, approveRepairQuote,
    startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived,
    scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    getVisibleRepairs, updateRepairProgress, requestProcurement, markUnrepairable, returnToCustomer, showToast,
    systemSettings, companySettings,
  } = useApp()

  const queryId = searchParams.get('id')
  const queryTab = searchParams.get('tab') as 'client' | 'refurb' | null

  const [view, setLocalView] = useState<View>(queryId ? 'detail' : 'list')
  const [activeId, setLocalActiveId] = useState<string | null>(queryId ?? null)
  const [filter, setFilter] = useState<RepairStatus | 'all'>('all')
  const [mainTab, setLocalMainTab] = useState<'client' | 'refurb'>(queryTab ?? 'client')

  const setActiveId = (id: string | null) => {
    setLocalActiveId(id)
    if (id) setLocalView('detail')
    else if (view === 'detail') setLocalView('list')
    
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('id', id)
    else params.delete('id')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const setView = (v: View) => {
    setLocalView(v)
    if (v !== 'detail' && activeId !== null) {
      setLocalActiveId(null)
      const params = new URLSearchParams(searchParams.toString())
      params.delete('id')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
  }

  const setMainTab = (t: 'client' | 'refurb') => {
    setLocalMainTab(t)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', t)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlId = searchParams.get('id')
    if (urlId !== activeId) {
      setLocalActiveId(urlId)
      if (urlId) setLocalView('detail')
      else if (view === 'detail') setLocalView('list')
    }
    const urlTab = searchParams.get('tab') as 'client' | 'refurb' | null
    if (urlTab && urlTab !== mainTab) {
      setLocalMainTab(urlTab)
    }
  }, [searchParams, activeId, mainTab, view])

  // Modals for detail actions
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

  // Diagnosis & Report Uploads
  const diagReportInputRef = useRef<HTMLInputElement>(null)
  const qcReportInputRef   = useRef<HTMLInputElement>(null)
  const [uploadingDiagReport, setUploadingDiagReport] = useState(false)
  const [uploadingQcReport,   setUploadingQcReport]   = useState(false)

  const handleReportUpload = (
    file: File,
    field: 'diagnosisReportData' | 'qcReportData',
    nameFld: 'diagnosisReportName' | 'qcReportName',
    repairId: string,
    setLoading: (v: boolean) => void,
  ) => {
    setLoading(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result as string
      updateRepair(repairId, { [field]: data, [nameFld]: file.name })
      setLoading(false)
      showToast('Report uploaded successfully', 'success')
    }
    reader.readAsDataURL(file)
  }

  const activeRepair = useMemo(() => repairs.find(r => r.id === activeId), [repairs, activeId])
  const currentUser = useMemo(() => users.find(u => u.id === currentUserId), [users, currentUserId])
  const visibleRepairs = useMemo(() => getVisibleRepairs(filter), [getVisibleRepairs, filter])

  const contextValue = {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs, warranties, systemSettings, companySettings,
    createRepair, updateRepair, deleteRepair, verifyRepairIntake, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote, approveRepairQuote,
    startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived, scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    getVisibleRepairs, updateRepairProgress, requestProcurement, markUnrepairable, returnToCustomer, showToast,
    view, setView, activeId, setActiveId, filter, setFilter, mainTab, setMainTab,
    showAssignModal, setShowAssignModal, showDiagnosisModal, setShowDiagnosisModal, showQuoteModal, setShowQuoteModal, showQAModal, setShowQAModal,
    showDeliveryModal, setShowDeliveryModal, showProgressModal, setShowProgressModal, showProcurementModal, setShowProcurementModal, showReturnModal, setShowReturnModal,
    showDeclineModal, setShowDeclineModal, showMarkDeliveredConfirm, setShowMarkDeliveredConfirm,
    diagReportInputRef, qcReportInputRef, uploadingDiagReport, setUploadingDiagReport, uploadingQcReport, setUploadingQcReport, handleReportUpload,
    visibleRepairs, activeRepair, currentUser
  }

  return (
    <RepairProvider value={contextValue}>
      <div className="flex flex-col h-full overflow-hidden bg-slate-50">
        {view === 'list' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex p-1 bg-slate-200/50 border-b border-slate-200 flex-shrink-0">
              <button 
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${mainTab === 'client' ? 'bg-white text-blue-600 shadow-sm rounded-lg' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setMainTab('client')}
              >
                Client Repairs
              </button>
              <button 
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${mainTab === 'refurb' ? 'bg-white text-blue-600 shadow-sm rounded-lg' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setMainTab('refurb')}
              >
                Refurbishment
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden relative">
              {mainTab === 'client' ? (
                <RepairClientJobs onNewIntake={() => setView('intake')} onSelect={setActiveId} />
              ) : (
                <RepairRefurbJobs onSelect={setActiveId} />
              )}
            </div>
          </div>
        )}

        {view === 'intake' && (
          <RepairIntake onCancel={() => setView('list')} onSuccess={(id) => setActiveId(id)} />
        )}

        {view === 'detail' && activeRepair && (
          <div className="flex-1 overflow-hidden">
            <RepairDetailView />
          </div>
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
      </div>
    </RepairProvider>
  )
}
