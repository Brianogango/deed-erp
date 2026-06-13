'use client'
import { createContext, useContext } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useApp } from '@/lib/store'
import type { Invoice, Account, JournalEntry } from '@/lib/store'

type MainTab = 'invoices' | 'bills' | 'journals' | 'refunds' | 'coa' | 'gl' | 'partner_ledger' | 'pl' | 'bs' | 'cashbook'

export interface AccountingCtxValue {
  // Store
  invoices: ReturnType<typeof useApp>['invoices']
  contacts: ReturnType<typeof useApp>['contacts']
  journalEntries: ReturnType<typeof useApp>['journalEntries']
  refundPayments: ReturnType<typeof useApp>['refundPayments']
  users: ReturnType<typeof useApp>['users']
  currentUserId: string | null
  accounts: ReturnType<typeof useApp>['accounts']
  bankAccounts: ReturnType<typeof useApp>['bankAccounts']
  posOrders: ReturnType<typeof useApp>['posOrders']
  expenses: ReturnType<typeof useApp>['expenses']
  payrollRuns: ReturnType<typeof useApp>['payrollRuns']
  purchaseOrders: ReturnType<typeof useApp>['purchaseOrders']
  companySettings: ReturnType<typeof useApp>['companySettings']
  // Store actions
  registerPayment: ReturnType<typeof useApp>['registerPayment']
  deleteInvoice: ReturnType<typeof useApp>['deleteInvoice']
  updateInvoice: ReturnType<typeof useApp>['updateInvoice']
  postInvoice: ReturnType<typeof useApp>['postInvoice']
  addAccount: ReturnType<typeof useApp>['addAccount']
  updateAccount: ReturnType<typeof useApp>['updateAccount']
  showToast: ReturnType<typeof useApp>['showToast']
  // Derived
  currentUser: ReturnType<typeof useApp>['users'][0] | null
  canViewJournals: boolean
  canManageFinance: boolean
  customers: ReturnType<typeof useApp>['contacts']
  vendors: ReturnType<typeof useApp>['contacts']
  allInvoices: Invoice[]
  customerInvoices: Invoice[]
  vendorBills: Invoice[]
  outstandingAR: number
  outstandingAP: number
  totalRevenueDynamic: number
  cashAtBankBS: number
  cashInHandBS: number
  allCashbookEntries: any[]
  cashbookTotals: Record<string, number>
  // Tab state
  tab: MainTab; setTab: (t: MainTab) => void
  // Invoice / Bill state
  invFilter: string; setInvFilter: (v: string) => void
  invSearch: string; setInvSearch: (v: string) => void
  selectedInvIds: Set<string>; setSelectedInvIds: (v: Set<string>) => void
  showBulkPayModal: boolean; setShowBulkPayModal: (v: boolean) => void
  payAmount: string; setPayAmount: (v: string) => void
  payMethod: string; setPayMethod: (v: string) => void
  payBankAccountId: string; setPayBankAccountId: (v: string) => void
  payReference: string; setPayReference: (v: string) => void
  showNewForm: boolean; setShowNewForm: (v: boolean) => void
  editingInvId: string | null; setEditingInvId: (v: string | null) => void
  newPartnerId: string; setNewPartnerId: (v: string) => void
  newPartnerName: string; setNewPartnerName: (v: string) => void
  newDueDate: string; setNewDueDate: (v: string) => void
  newLines: any[]; setNewLines: (v: any) => void
  applyVat: boolean; setApplyVat: (v: boolean) => void
  localInvoices: Invoice[]; setLocalInvoices: (v: Invoice[]) => void
  receiptFile: File | null; setReceiptFile: (v: File | null) => void
  isScanning: boolean; setIsScanning: (v: boolean) => void
  dragOver: boolean; setDragOver: (v: boolean) => void
  billFileRef: RefObject<HTMLInputElement>
  // Journal state
  viewJournal: JournalEntry | null; setViewJournal: (v: JournalEntry | null) => void
  journalDate: string; setJournalDate: (v: string) => void
  journalSource: string; setJournalSource: (v: string) => void
  journalRef: string; setJournalRef: (v: string) => void
  // COA state
  coaSearch: string; setCoaSearch: (v: string) => void
  coaTypeFilter: any; setCoaTypeFilter: (v: any) => void
  showAccountForm: boolean; setShowAccountForm: (v: boolean) => void
  editAccountId: string | null; setEditAccountId: (v: string | null) => void
  accountForm: Omit<Account, 'id'>; setAccountForm: (v: any) => void
  // GL state
  glAccount: string; setGlAccount: (v: string) => void
  glDateFrom: string; setGlDateFrom: (v: string) => void
  glDateTo: string; setGlDateTo: (v: string) => void
  // Partner Ledger
  plPartner: string; setPlPartner: (v: string) => void
  plDateFrom: string; setPlDateFrom: (v: string) => void
  plDateTo: string; setPlDateTo: (v: string) => void
  // Helpers
  hdr: (lines: any[], title: string, subtitle: string) => any[]
}

const AccountingCtx = createContext<AccountingCtxValue | null>(null)

export function useAccounting(): AccountingCtxValue {
  const ctx = useContext(AccountingCtx)
  if (!ctx) throw new Error('useAccounting must be used inside AccountingProvider')
  return ctx
}

export function AccountingProvider({ children, value }: { children: ReactNode; value: AccountingCtxValue }) {
  return <AccountingCtx.Provider value={value}>{children}</AccountingCtx.Provider>
}
