'use client'
import { createContext, useContext } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useFinanceStore } from '@/lib/store'
import type { Invoice, Account, JournalEntry } from '@/lib/store'

type MainTab = 'invoices' | 'bills' | 'journals' | 'refunds' | 'coa' | 'gl' | 'partner_ledger' | 'pl' | 'bs' | 'cashbook'

export interface AccountingCtxValue {
  // Store
  invoices: ReturnType<typeof useFinanceStore>['invoices']
  contacts: ReturnType<typeof useFinanceStore>['contacts']
  journalEntries: ReturnType<typeof useFinanceStore>['journalEntries']
  refundPayments: ReturnType<typeof useFinanceStore>['refundPayments']
  users: ReturnType<typeof useFinanceStore>['users']
  currentUserId: string | null
  accounts: ReturnType<typeof useFinanceStore>['accounts']
  bankAccounts: ReturnType<typeof useFinanceStore>['bankAccounts']
  posOrders: ReturnType<typeof useFinanceStore>['posOrders']
  expenses: ReturnType<typeof useFinanceStore>['expenses']
  payrollRuns: ReturnType<typeof useFinanceStore>['payrollRuns']
  purchaseOrders: ReturnType<typeof useFinanceStore>['purchaseOrders']
  companySettings: ReturnType<typeof useFinanceStore>['companySettings']
  // Store actions
  registerPayment: ReturnType<typeof useFinanceStore>['registerPayment']
  deleteInvoice: ReturnType<typeof useFinanceStore>['deleteInvoice']
  updateInvoice: ReturnType<typeof useFinanceStore>['updateInvoice']
  postInvoice: ReturnType<typeof useFinanceStore>['postInvoice']
  addAccount: ReturnType<typeof useFinanceStore>['addAccount']
  updateAccount: ReturnType<typeof useFinanceStore>['updateAccount']
  showToast: ReturnType<typeof useFinanceStore>['showToast']
  // Derived
  currentUser: ReturnType<typeof useFinanceStore>['users'][0] | null
  canViewJournals: boolean
  canManageFinance: boolean
  customers: ReturnType<typeof useFinanceStore>['contacts']
  vendors: ReturnType<typeof useFinanceStore>['contacts']
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
