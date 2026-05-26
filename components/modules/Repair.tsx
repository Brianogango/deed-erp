// @ts-nocheck
'use client'
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
  MarkDeliveredConfirm
} from './RepairModals'

function RepairContent() {
  const { 
    view, setView, activeRepair, setActiveId,
    showAssignModal, setShowAssignModal,
    showDiagnosisModal, setShowDiagnosisModal,
    showQuoteModal, setShowQuoteModal,
    showQAModal, setShowQAModal,
    showDeliveryModal, setShowDeliveryModal,
    showProgressModal, setShowProgressModal,
    showProcurementModal, setShowProcurementModal,
    showReturnModal, setShowReturnModal,
    showDeclineModal, setShowDeclineModal,
    showMarkDeliveredConfirm, setShowMarkDeliveredConfirm
  } = useRepair()

  return (
    <div className="flex flex-col h-full min-h-0">
      {view === 'list' && (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <RepairClientJobs />
          </div>
        </div>
      )}

      {view === 'refurb' && (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <RepairRefurbJobs />
          </div>
        </div>
      )}

      {view === 'intake' && (
        <RepairIntake onCancel={() => setView('list')} onSuccess={(id) => setActiveId(id)} />
      )}

      {view === 'detail' && activeRepair && (
        <div className="flex-1">
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
  )
}

export default function Repair() {
  return (
    <RepairProvider>
      <RepairContent />
    </RepairProvider>
  )
}
