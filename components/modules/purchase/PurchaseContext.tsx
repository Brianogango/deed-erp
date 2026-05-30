'use client'
import { createContext, useContext, useState, useMemo, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  useApp, fmtKes, fmtDate,
  type Receipt, type LocationId, type POLine, type Account,
} from '@/lib/store'

type MainView = 'orders' | 'receipts' | 'returns' | 'bills' | 'tradein'
type SubView  = 'list' | 'form' | 'receive'
type ImportRow = {
  raw: Record<string, string>; productId: string; productName: string; accountCode?: string
  qty: number; unitPrice: number; taxRate: number; requiresSerial: boolean
  importedSerials: string[]; specs: string; status: 'ok' | 'warn' | 'error'; message: string; serialWarning?: string
}

export interface PurchaseCtxValue {
  // Store
  purchaseOrders: ReturnType<typeof useApp>['purchaseOrders']
  contacts: ReturnType<typeof useApp>['contacts']
  products: ReturnType<typeof useApp>['products']
  receipts: ReturnType<typeof useApp>['receipts']
  invoices: ReturnType<typeof useApp>['invoices']
  purchaseReturns: ReturnType<typeof useApp>['purchaseReturns']
  serials: ReturnType<typeof useApp>['serials']
  users: ReturnType<typeof useApp>['users']
  bankAccounts: ReturnType<typeof useApp>['bankAccounts']
  currentUserId: string | null
  accounts: ReturnType<typeof useApp>['accounts']
  companySettings: ReturnType<typeof useApp>['companySettings']
  // Store actions
  createPO: ReturnType<typeof useApp>['createPO']
  updatePO: ReturnType<typeof useApp>['updatePO']
  addPOLine: ReturnType<typeof useApp>['addPOLine']
  removePOLine: ReturnType<typeof useApp>['removePOLine']
  updatePOLine: ReturnType<typeof useApp>['updatePOLine']
  bulkAddPOLines: ReturnType<typeof useApp>['bulkAddPOLines']
  sendPO: ReturnType<typeof useApp>['sendPO']
  confirmPO: ReturnType<typeof useApp>['confirmPO']
  validateReceipt: ReturnType<typeof useApp>['validateReceipt']
  deletePO: ReturnType<typeof useApp>['deletePO']
  revertPOToDraft: ReturnType<typeof useApp>['revertPOToDraft']
  createBillFromPO: ReturnType<typeof useApp>['createBillFromPO']
  postInvoice: ReturnType<typeof useApp>['postInvoice']
  registerPayment: ReturnType<typeof useApp>['registerPayment']
  createPurchaseReturn: ReturnType<typeof useApp>['createPurchaseReturn']
  addReturnLine: ReturnType<typeof useApp>['addReturnLine']
  confirmPurchaseReturn: ReturnType<typeof useApp>['confirmPurchaseReturn']
  logReturnPickup: ReturnType<typeof useApp>['logReturnPickup']
  addContact: ReturnType<typeof useApp>['addContact']
  showToast: ReturnType<typeof useApp>['showToast']
  // Local view state
  mainView: MainView; setMainView: (v: MainView) => void
  subView: SubView;   setSubView: (v: SubView) => void
  activeId: string | null; setActiveId: (id: string | null) => void
  filter: string; setFilter: (f: string) => void
  // Derived
  vendors: ReturnType<typeof useApp>['contacts']
  purchasableProds: ReturnType<typeof useApp>['products']
  vendorBills: ReturnType<typeof useApp>['invoices']
  activePO: ReturnType<typeof useApp>['purchaseOrders'][0] | null
  activeReceipt: Receipt | null
  linkedBill: ReturnType<typeof useApp>['invoices'][0] | null
  filteredPOs: ReturnType<typeof useApp>['purchaseOrders']
  currentUser: ReturnType<typeof useApp>['users'][0] | undefined
  stats: { rfqs: number; activePOs: number; pendingGRNs: number; unpaid: number }
  // RFQ
  showNewRFQ: boolean; setShowNewRFQ: (v: boolean) => void
  newVendorId: string; setNewVendorId: (v: string) => void
  newVendorName: string; setNewVendorName: (v: string) => void
  showNewVendorModal: boolean; setShowNewVendorModal: (v: boolean) => void
  newVendorForm: { name: string; email: string; phone: string; address: string; vatNumber: string; paymentTermsDays: string; creditLimit: string }
  setNewVendorForm: (f: any) => void
  handleCreateRFQ: () => void
  handleCreateVendorForRFQ: () => Promise<void>
  // Add line
  showAddLine: boolean; setShowAddLine: (v: boolean) => void
  addProd: any; setAddProd: (p: any) => void
  addQty: string; setAddQty: (v: string) => void
  addPrice: string; setAddPrice: (v: string) => void
  addVAT: boolean; setAddVAT: (v: boolean) => void
  handleAddLine: () => void
  // Inline edit
  editCell: { lineId: string; field: 'qty' | 'unitPrice' | 'taxRate' } | null
  setEditCell: (c: any) => void
  editVal: string; setEditVal: (v: string) => void
  commitCell: (poId: string, lineId: string, field: string, val: string) => void
  // Import
  showImport: boolean; setShowImport: (v: boolean) => void
  importRows: ImportRow[]; setImportRows: (r: ImportRow[]) => void
  importVendorId: string; setImportVendorId: (v: string) => void
  importVendorName: string; setImportVendorName: (v: string) => void
  isDragging: boolean; setIsDragging: (v: boolean) => void
  fileInputRef: React.RefObject<HTMLInputElement>
  setImportRowAccount: (idx: number, code: string) => void
  // Scan
  showScanModal: boolean; setShowScanModal: (v: boolean) => void
  scanFile: File | null; setScanFile: (f: File | null) => void
  isScanningScan: boolean; setIsScanningScan: (v: boolean) => void
  scanFileRef: React.RefObject<HTMLInputElement>
  // GRN
  activeReceiptId: string | null; setActiveReceiptId: (id: string | null) => void
  grnLines: Receipt['lines']; setGrnLines: (l: Receipt['lines']) => void
  destLocation: LocationId; setDestLocation: (l: LocationId) => void
  serialInputs: Record<number, string>; setSerialInputs: (v: any) => void
  serialAccessories: Record<string, string[]>; setSerialAccessories: (v: any) => void
  serialAccessoryNotes: Record<string, string>; setSerialAccessoryNotes: (v: any) => void
  serialSpecs: Record<string, string>; setSerialSpecs: (v: any) => void
  serialIssues: Record<string, string>; setSerialIssues: (v: any) => void
  serialRefs: React.MutableRefObject<Record<number, HTMLInputElement | null>>
  // Return
  showReturnModal: boolean; setShowReturnModal: (v: boolean) => void
  returnReceiptId: string; setReturnReceiptId: (v: string) => void
  returnReason: any; setReturnReason: (v: any) => void
  returnLines: any[]; setReturnLines: (v: any) => void
  returnScanInput: Record<number, string>; setReturnScanInput: (v: any) => void
  returnCollectedBy: string; setReturnCollectedBy: (v: string) => void
  returnCollectedDate: string; setReturnCollectedDate: (v: string) => void
  returnPickupNotes: string; setReturnPickupNotes: (v: string) => void
  // Return filters
  retSearchSerial: string; setRetSearchSerial: (v: string) => void
  retFilterStatus: string; setRetFilterStatus: (v: string) => void
  retFilterReason: string; setRetFilterReason: (v: string) => void
  retFilterVendor: string; setRetFilterVendor: (v: string) => void
  retDateFrom: string; setRetDateFrom: (v: string) => void
  retDateTo: string; setRetDateTo: (v: string) => void
  retExpandedId: string | null; setRetExpandedId: (v: string | null) => void
  showPickupModal: boolean; setShowPickupModal: (v: boolean) => void
  pickupReturnId: string; setPickupReturnId: (v: string) => void
  pickupCollectedBy: string; setPickupCollectedBy: (v: string) => void
  pickupCollectedDate: string; setPickupCollectedDate: (v: string) => void
  pickupNotes: string; setPickupNotes: (v: string) => void
  // Payment
  showPayModal: boolean; setShowPayModal: (v: boolean) => void
  payInvoiceId: string; setPayInvoiceId: (v: string) => void
  payAmount: string; setPayAmount: (v: string) => void
  payBankAccountId: string; setPayBankAccountId: (v: string) => void
  payMethod: string; setPayMethod: (v: string) => void
  payReference: string; setPayReference: (v: string) => void
  // Delete
  delId: string | null; setDelId: (v: string | null) => void
  // Helpers
  fmtKes: typeof fmtKes
  fmtDate: typeof fmtDate
}

const PurchaseCtx = createContext<PurchaseCtxValue | null>(null)

export function usePurchase(): PurchaseCtxValue {
  const ctx = useContext(PurchaseCtx)
  if (!ctx) throw new Error('usePurchase must be used inside PurchaseProvider')
  return ctx
}

export function PurchaseProvider({ children, initialState }: { children: ReactNode; initialState: PurchaseCtxValue }) {
  return <PurchaseCtx.Provider value={initialState}>{children}</PurchaseCtx.Provider>
}
