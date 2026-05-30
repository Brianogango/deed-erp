'use client'
import { createContext, useContext } from 'react'
import type { ReactNode, RefObject, MutableRefObject } from 'react'
import { useApp } from '@/lib/store'

type View = 'list' | 'intake' | 'detail'

export interface RepairCtxValue {
  // Store
  repairs: ReturnType<typeof useApp>['repairs']
  contacts: ReturnType<typeof useApp>['contacts']
  products: ReturnType<typeof useApp>['products']
  users: ReturnType<typeof useApp>['users']
  riders: ReturnType<typeof useApp>['riders']
  refurbishmentJobs: ReturnType<typeof useApp>['refurbishmentJobs']
  currentUserId: string | null
  outsourceJobs: ReturnType<typeof useApp>['outsourceJobs']
  warranties: ReturnType<typeof useApp>['warranties']
  systemSettings: ReturnType<typeof useApp>['systemSettings']
  companySettings: ReturnType<typeof useApp>['companySettings']
  // Store actions
  createRepair: ReturnType<typeof useApp>['createRepair']
  updateRepair: ReturnType<typeof useApp>['updateRepair']
  deleteRepair: ReturnType<typeof useApp>['deleteRepair']
  verifyRepairIntake: ReturnType<typeof useApp>['verifyRepairIntake']
  assignTechnicianToRepair: ReturnType<typeof useApp>['assignTechnicianToRepair']
  logDiagnosis: ReturnType<typeof useApp>['logDiagnosis']
  stopAtDiagnosis: ReturnType<typeof useApp>['stopAtDiagnosis']
  generateRepairQuote: ReturnType<typeof useApp>['generateRepairQuote']
  approveRepairQuote: ReturnType<typeof useApp>['approveRepairQuote']
  startRepair: ReturnType<typeof useApp>['startRepair']
  markRepairComplete: ReturnType<typeof useApp>['markRepairComplete']
  addRepairQAItem: ReturnType<typeof useApp>['addRepairQAItem']
  completeRepairQA: ReturnType<typeof useApp>['completeRepairQA']
  markPartsArrived: ReturnType<typeof useApp>['markPartsArrived']
  scheduleDelivery: ReturnType<typeof useApp>['scheduleDelivery']
  deliverRepair: ReturnType<typeof useApp>['deliverRepair']
  closeRepairJob: ReturnType<typeof useApp>['closeRepairJob']
  createInvoiceFromRepair: ReturnType<typeof useApp>['createInvoiceFromRepair']
  getVisibleRepairs: ReturnType<typeof useApp>['getVisibleRepairs']
  updateRepairProgress: ReturnType<typeof useApp>['updateRepairProgress']
  requestProcurement: ReturnType<typeof useApp>['requestProcurement']
  markUnrepairable: ReturnType<typeof useApp>['markUnrepairable']
  returnToCustomer: ReturnType<typeof useApp>['returnToCustomer']
  fileWarrantyClaim: ReturnType<typeof useApp>['fileWarrantyClaim']
  showToast: ReturnType<typeof useApp>['showToast']
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
  showOutsourceModal: boolean; setShowOutsourceModal: (v: boolean) => void
  // Report uploads
  diagReportInputRef: RefObject<HTMLInputElement>
  qcReportInputRef: RefObject<HTMLInputElement>
  uploadingDiagReport: boolean; setUploadingDiagReport: (v: boolean) => void
  uploadingQcReport: boolean; setUploadingQcReport: (v: boolean) => void
  handleReportUpload: (file: File, field: 'diagnosisReportData' | 'qcReportData', nameFld: 'diagnosisReportName' | 'qcReportName', repairId: string, setLoading: (v: boolean) => void) => void
  // Derived
  visibleRepairs: ReturnType<typeof useApp>['repairs']
  activeRepair: ReturnType<typeof useApp>['repairs'][0] | null
  currentUser: ReturnType<typeof useApp>['users'][0] | undefined
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
