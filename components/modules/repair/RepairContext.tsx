'use client'
import { createContext, useContext } from 'react'
import type { ReactNode, RefObject, MutableRefObject } from 'react'
import { useRepairStore } from '@/lib/store'

type View = 'list' | 'intake' | 'detail'

export interface RepairCtxValue {
  // Store
  repairs: ReturnType<typeof useRepairStore>['repairs']
  contacts: ReturnType<typeof useRepairStore>['contacts']
  products: ReturnType<typeof useRepairStore>['products']
  users: ReturnType<typeof useRepairStore>['users']
  riders: ReturnType<typeof useRepairStore>['riders']
  refurbishmentJobs: ReturnType<typeof useRepairStore>['refurbishmentJobs']
  currentUserId: string | null
  outsourceJobs: ReturnType<typeof useRepairStore>['outsourceJobs']
  warranties: ReturnType<typeof useRepairStore>['warranties']
  systemSettings: ReturnType<typeof useRepairStore>['systemSettings']
  companySettings: ReturnType<typeof useRepairStore>['companySettings']
  // Store actions
  createRepair: ReturnType<typeof useRepairStore>['createRepair']
  updateRepair: ReturnType<typeof useRepairStore>['updateRepair']
  deleteRepair: ReturnType<typeof useRepairStore>['deleteRepair']
  verifyRepairIntake: ReturnType<typeof useRepairStore>['verifyRepairIntake']
  assignTechnicianToRepair: ReturnType<typeof useRepairStore>['assignTechnicianToRepair']
  logDiagnosis: ReturnType<typeof useRepairStore>['logDiagnosis']
  stopAtDiagnosis: ReturnType<typeof useRepairStore>['stopAtDiagnosis']
  generateRepairQuote: ReturnType<typeof useRepairStore>['generateRepairQuote']
  approveRepairQuote: ReturnType<typeof useRepairStore>['approveRepairQuote']
  startRepair: ReturnType<typeof useRepairStore>['startRepair']
  markRepairComplete: ReturnType<typeof useRepairStore>['markRepairComplete']
  addRepairQAItem: ReturnType<typeof useRepairStore>['addRepairQAItem']
  completeRepairQA: ReturnType<typeof useRepairStore>['completeRepairQA']
  markPartsArrived: ReturnType<typeof useRepairStore>['markPartsArrived']
  scheduleDelivery: ReturnType<typeof useRepairStore>['scheduleDelivery']
  deliverRepair: ReturnType<typeof useRepairStore>['deliverRepair']
  closeRepairJob: ReturnType<typeof useRepairStore>['closeRepairJob']
  createInvoiceFromRepair: ReturnType<typeof useRepairStore>['createInvoiceFromRepair']
  getVisibleRepairs: ReturnType<typeof useRepairStore>['getVisibleRepairs']
  updateRepairProgress: ReturnType<typeof useRepairStore>['updateRepairProgress']
  moveRepairToPreviousProgress: ReturnType<typeof useRepairStore>['moveRepairToPreviousProgress']
  requestProcurement: ReturnType<typeof useRepairStore>['requestProcurement']
  markUnrepairable: ReturnType<typeof useRepairStore>['markUnrepairable']
  returnToCustomer: ReturnType<typeof useRepairStore>['returnToCustomer']
  fileWarrantyClaim: ReturnType<typeof useRepairStore>['fileWarrantyClaim']
  showToast: ReturnType<typeof useRepairStore>['showToast']
  // View state
  view: View; setView: (v: View) => void
  activeId: string | null; setActiveId: (id: string | null) => void
  filter: any; setFilter: (f: any) => void
  mainTab: 'client' | 'refurb'; setMainTab: (t: 'client' | 'refurb') => void
  // Quick-assign / invoice
  quickAssignRepairId: string | null; setQuickAssignRepairId: (v: string | null) => void
  invoiceRepairId: string | null; setInvoiceRepairId: (v: string | null) => void
  invoiceApplyVat: boolean; setInvoiceApplyVat: (v: boolean) => void
  // Modals
  showAssignModal: boolean; setShowAssignModal: (v: boolean) => void
  showDiagnosisModal: boolean; setShowDiagnosisModal: (v: boolean) => void
  showQuoteModal: boolean; setShowQuoteModal: (v: boolean) => void
  showQAModal: boolean; setShowQAModal: (v: boolean) => void
  showDeliveryModal: boolean; setShowDeliveryModal: (v: boolean) => void
  showProgressModal: boolean; setShowProgressModal: (v: boolean) => void
  showProcurementModal: boolean; setShowProcurementModal: (v: boolean) => void
  showReturnModal: boolean; setShowReturnModal: (v: boolean) => void
  // Diagnosis form
  diagForm: any; setDiagForm: (f: any) => void
  // Quote form
  quoteLines: any[]; setQuoteLines: (l: any[]) => void
  quoteApplyVat: boolean; setQuoteApplyVat: (v: boolean) => void
  // Delivery form
  deliveryForm: any; setDeliveryForm: (f: any) => void
  // Procurement form
  procurementForm: any; setProcurementForm: (f: any) => void
  // Decline/Return
  returnReason: string; setReturnReason: (v: string) => void
  showDeclineModal: boolean; setShowDeclineModal: (v: boolean) => void
  declineReason: string; setDeclineReason: (v: string) => void
  showMarkDeliveredConfirm: boolean; setShowMarkDeliveredConfirm: (v: boolean) => void
  showCancelModal: boolean; setShowCancelModal: (v: boolean) => void
  showDeleteConfirm: boolean; setShowDeleteConfirm: (v: boolean) => void
  showEditDetailsModal: boolean; setShowEditDetailsModal: (v: boolean) => void
  showStopDiagnosisModal: boolean; setShowStopDiagnosisModal: (v: boolean) => void
  // Report uploads
  diagReportInputRef: RefObject<HTMLInputElement>
  qcReportInputRef: RefObject<HTMLInputElement>
  uploadingDiagReport: boolean; setUploadingDiagReport: (v: boolean) => void
  uploadingQcReport: boolean; setUploadingQcReport: (v: boolean) => void
  handleReportUpload: (file: File, field: 'diagnosisReportData' | 'qcReportData', nameFld: 'diagnosisReportName' | 'qcReportName', repairId: string, setLoading: (v: boolean) => void) => Promise<void> | void
  // Derived
  visibleRepairs: ReturnType<typeof useRepairStore>['repairs']
  openRepairCount: number
  activeRepair: ReturnType<typeof useRepairStore>['repairs'][0] | null
  currentUser: ReturnType<typeof useRepairStore>['users'][0] | undefined
}

const RepairCtx = createContext<RepairCtxValue | null>(null)

export function useRepair(): RepairCtxValue {
  const ctx = useContext(RepairCtx)
  if (!ctx) throw new Error('useRepair must be used inside RepairProvider')
  return ctx
}

export function RepairProvider({ children, value }: { children: ReactNode; value: RepairCtxValue }) {
  return <RepairCtx.Provider value={value}>{children}</RepairCtx.Provider>
}
