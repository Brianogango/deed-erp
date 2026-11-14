'use client'
import { createFinanceActions } from './store/actions/finance'
import { createSalesActions } from './store/actions/sales'
import { createInventoryActions } from './store/actions/inventory'
import { createRepairActions } from './store/actions/repairs'
import { createShellActions } from './store/actions/shell'
import { createSopActions } from './store/actions/sop'
import { createHrActions } from './store/actions/hr'
import { createPurchasingActions } from './store/actions/purchasing'
import { createDeliveryActions } from './store/actions/delivery'
import { createAfterSalesActions } from './store/actions/after-sales'
import { createContext, useContext, useEffect, useMemo } from 'react'
import { isPosBankPayment } from '@/lib/pos-session'
export { isPosBankPayment }
export type { CompanyAsset, CompanyAssetInput } from '@/lib/company-property'
import { CATEGORY_CONFIG, ALL_CATEGORIES, type CategoryId } from '@/lib/product-categories'
export { CATEGORY_CONFIG, ALL_CATEGORIES, type CategoryId }
import { calcStockByLocation as _calcStockByLocation, upsertBulkStock as _upsertBulkStock } from '@/lib/business-logic'
import { registerSaleOrderDraftPersistApi } from '@/lib/sale-order-draft-persist'
// Buy-back settlement: Pay (cash) XOR Add as credit (3102). Shared by store + tests.
import { formatKeDate, formatKeDateTime, installIntlFormatCache } from '@/lib/intl-cache'
export type { BuyBack, BuyBackLine, BuyBackStatus, ClientExchange, Donation, DonationLine, DonationType, ExchangeLine, ExchangeStatus, RMAResolution, RMAStatus, ReturnOrder, ReturnOrderLine } from './store/after-sales'
export type { LocationId, ModuleId, User, UserRole, WorkflowApproval } from './store/core'
export type { Delivery, DeliveryJob, DeliveryJobStatus, DeliveryJobType, DeliveryLine, Rider, RiderWeeklyPay } from './store/delivery'
export type { Account, AccountType, BankAccount, BankStatementLine, CashbookEntry, Deposit, DepositItem, DepositPayment, DepositStatus, ExpenseApprovalStep, ExpensePaymentMethod, ExpenseStatus, Invoice, InvoiceLine, InvoicePayment, InvoiceStatus, InvoiceType, JournalEntry, JournalEntryLine, Payment, RefundPayment, RefundPaymentMethod, StatementLineCategory } from './store/finance'
export type { Candidate, CandidateCommunication, CandidateInterview, CandidateOffer, CandidateStage, Department, Employee, EmployeeAssetAssignment, EmployeeChecklistItem, EmployeeTraining, HRDocument, HRSOP, JobPosting, JobStatus, LeaveBalance, LeaveRequest, PayrollLine, PayrollRun, Payslip, PerfPeriod, PerfStatus, PerformanceTarget, RefSOP, RefSOPCategory, SOPCategory, SalaryAdvance, TrainingProgram, TrainingStatus } from './store/hr'
export type { AdjReason, Holdover, HoldoverDeviceCondition, HoldoverPurpose, HoldoverStatus, ItemReleaseStatus, OrcItem, OrcLogEntry, OutboundRelease, Product, RefurbPart, RefurbStatus, RefurbishmentJob, ReleaseStatus, SerialNumber, SignatureMethod, StockMove, TaggedIntakeInput } from './store/inventory'
export type { POLine, POStatus, PurchaseOrder, PurchaseReturn, Receipt } from './store/purchasing'
export type { OutsourceJobStatus, RepairOrder, Warranty } from './store/repairs'
export type { Client, Contact, CustomerContract, KilimallDispatch, KilimallOrder, KilimallOrderStatus, KilimallSettlement, KilimallSettlementLine, LeadSource, OpportunityStage, POSOrder, Quote, SOStatus, SaleOrder, SaleOrderItem } from './store/sales'
export type { CompanySettings } from './store/settings'
import { _pendingSync, _inFlightSyncKeys } from './store/sync'
import { type AppState, type InventoryStoreState, type SalesStoreState, type RepairStoreState, type ShellStoreState, type CrmStoreState, type FinanceStoreState, type HrStoreState, type DeliveryStoreState, type CommerceStoreState, type AfterSalesStoreState, type OperationsStoreState } from './store/state'
export { SYNC_STATUS_EVENT, LAST_SYNC_AT_LS, DIRTY_KEYS_LS, useStoreHydrated, debouncedServerSync, SESSION_AUDIT_LOG_LIMIT, RETIRED_LOCAL_KEYS, evictRetiredLocalKeys } from './store/sync'
export { canManageHR } from './store/permissions'
export { DEFAULT_BANK_ACCOUNTS, DEFAULT_COMPANY_SETTINGS } from './store/initial-state'
export { SOP_METRIC_TYPES, type SOPMetricType, type SOPMetric, type SOP } from './store/sop'
export { OUTSOURCE_SERVICE_TYPES, type OutsourceServiceType, type OutsourceVendor, type OutsourceJob } from './store/repairs'
export { EXPENSE_CATEGORIES, type ExpenseCategory, type Expense } from './store/expenses'
export { uid, now } from './store/ids'
export type { SOPTargetDir } from './store/sop'
export type { IntakeChannel, RepairDiagnosis, RepairPaymentConfirmationStatus, RepairQAItem, RepairQuote, RepairStatus } from '@/lib/repair-types'

// Reuse Intl formatters for every toLocale*String call in the app (lib/intl-cache.ts).
if (typeof window !== 'undefined') installIntlFormatCache()
export { PRODUCT_KIND_OPTIONS, UOM_OPTIONS, inferProductKind, defaultTrackingForKind, defaultUnitForKind, kindRequiresInventoryAccounts } from '@/lib/product-kind'
export {
  resolveProductAccounts,
  applyCategoryAccountDefaults
} from '@/lib/product-accounts'

// ── In-app Notifications ──────────────────────────────────────────────────────
import type { AppNotification } from '@/lib/in-app-notifications'
import { type StoreProviderProps, useStoreCore } from './store/use-store-core'
export { type StoreDeps } from './store/use-store-core'
export { LOCATIONS, fmtKes, announceIssuedWarranties } from './store/helpers'
export type { AppNotification }

// ─── Context ──────────────────────────────────────────────────────────────────
const StoreCtx = createContext<AppState | null>(null)
const InventoryStoreCtx = createContext<InventoryStoreState | null>(null)
const SalesStoreCtx = createContext<SalesStoreState | null>(null)
const RepairStoreCtx = createContext<RepairStoreState | null>(null)
const DashboardStoreCtx = createContext<AppState | null>(null)
const CrmStoreCtx = createContext<CrmStoreState | null>(null)
const FinanceStoreCtx = createContext<FinanceStoreState | null>(null)
const HrStoreCtx = createContext<HrStoreState | null>(null)
const DeliveryStoreCtx = createContext<DeliveryStoreState | null>(null)
const CommerceStoreCtx = createContext<CommerceStoreState | null>(null)
const AfterSalesStoreCtx = createContext<AfterSalesStoreState | null>(null)
const OperationsStoreCtx = createContext<OperationsStoreState | null>(null)
const ShellStoreCtx = createContext<ShellStoreState | null>(null)

function StoreProvider(props: StoreProviderProps) {
  const core = useStoreCore(props)

const storeCtx: AppState = {
    stockReservations: core.stockReservations,
    activeModule: core.activeModule, sidebarOpen: core.sidebarOpen, toast: core.toast,
    
    // CRM & Contacts
    contacts: core.contacts, companies: core.companies, contactPersons: core.contactPersons, opportunities: core.normalizedOpportunities, opportunityActivities: core.opportunityActivities, quotes: core.quotes,
    
    // Products & Inventory
    products: core.products, productPriceHistory: core.productPriceHistory, serials: core.serials,
    
   // Sales & Invoicing
    saleOrders: core.normalizedSaleOrders, invoices: core.invoices, deliveries: core.deliveries,

    // Payments & Credit
    payments: core.payments,
    customerCredits: core.customerCredits,

    ...createFinanceActions(core),
    
    // Purchasing
    purchaseOrders: core.purchaseOrders, receipts: core.receipts, stockTransfers: core.stockTransfers, purchaseReturns: core.purchaseReturns, refurbishmentJobs: core.refurbishmentJobs,
    
    // Repairs
    repairs: core.repairs,

    // HR — employees, departments, leave, hrDocuments, recruitment, and training
    // moved to useHrStore(); read/call that hook directly instead of from useApp().
    contracts: core.contracts, customerContracts: core.customerContracts,
    workflowApprovals: core.workflowApprovals,
    payrollRuns: core.payrollRuns, payslips: core.payslips, salaryAdvances: core.salaryAdvances, employeeAssetAssignments: core.employeeAssetAssignments,

    // Accounting
    journalEntries: core.journalEntries, accounts: core.accounts,

    // Inventory
    warranties: core.warranties, bulkStock: core.bulkStock, openingStockPosted: core.openingStockLocked, stockMoves: core.stockMoves, stockAdjustments: core.stockAdjustments,

    // POS
    posOrders: core.posOrders, posSessionOpen: core.posSessionOpen, posSessionOpeningCash: core.posSessionOpeningCash, posSessionId: core.posSessionId, posSessions: core.posSessions,

    // System
    auditLogs: core.auditLogs,

    // Delivery
    riders: core.riders, deliveryJobs: core.deliveryJobs, riderWeeklyPays: core.riderWeeklyPays,

    // Kilimall
    kilimallOrders: core.kilimallOrders, kilimallDispatches: core.kilimallDispatches, kilimallSettlements: core.kilimallSettlements,

    ...createSalesActions(core),

    notifications: core.notifications, profileImages: core.profileImages,

    ...createShellActions(core),

    // Cashbook & bank reconciliation
    bankAccounts: core.bankAccounts, bankRecons: core.bankRecons, bankStatementLines: core.bankStatementLines,
    documentPaymentDetails: core.documentPaymentDetails,
    companySettings: core.companySettings,
    systemSettings: core.systemSettings,

    sopDocuments: core.sopDocuments,
    saveSopDocuments: core.setSopDocuments,
    sops: core.sops, sopActuals: core.sopActuals,

    hrSops: core.hrSops,
    hrPerfTargets: core.hrPerfTargets,
    saveHrSops: core.setHrSops,
    saveHrPerfTargets: core.setHrPerfTargets,

    ...createSopActions(core),

    refSops: core.refSops,

    expenses: core.expenses,

    outsourceVendors: core.outsourceVendors, outsourceJobs: core.outsourceJobs, outsourcePayments: core.outsourcePayments,

    ...createRepairActions(core),

    // Deposits
    deposits: core.deposits,

    // Holdovers are saved to the holdovers table (the deed_holdovers copy is frozen).
    holdovers: core.holdovers,

    ...createInventoryActions(core),

    companyAssets: core.companyAssets,

    // ── Outbound Release Checkpoint ─────────────────────────────────────────
    outboundReleases: core.outboundReleases,
    showToast: core.showToast,
    users: core.users, currentUserId: core.currentUserId, currentUser: core.currentUser(),

    ...createHrActions(core),

    refreshProductCatalog: core.refreshProductCatalog,

    ...createPurchasingActions(core),

    // ── Rider Management ────────────────────────────────────────────────────

    ...createDeliveryActions(core),
    
    // ── Approval Workflows ────────────────────────────────────────────────────
    approvalRequests: core.approvalRequests,

    // ── Returns / RMA ─────────────────────────────────────────────────────────
    returnOrders: core.returnOrders, refundPayments: core.refundPayments,

    ...createAfterSalesActions(core),

    // ── Buy-backs ─────────────────────────────────────────────────────────────
    buyBacks: core.buyBacks,

    // ── Donations ─────────────────────────────────────────────────────────────
    donations: core.donations,

    // ── Client Exchanges ──────────────────────────────────────────────────────
    clientExchanges: core.clientExchanges,
  }

  core.storeCtxRef.current = storeCtx

  useEffect(() => {
    registerSaleOrderDraftPersistApi({
      updateSaleOrder: (id, patch, opts) => core.storeCtxRef.current!.updateSaleOrder(id, patch as any, opts),
      getSaleOrder: (id) => core.soRef.current.find(s => s.id === id),
    })
    return () => registerSaleOrderDraftPersistApi(null)
  }, [])

  const inventoryStore = useMemo<InventoryStoreState>(() => ({
    products: core.products,
    productPriceHistory: core.productPriceHistory,
    serials: core.serials,
    stockMoves: core.stockMoves,
    stockTransfers: core.stockTransfers,
    openingStockPosted: core.openingStockLocked,
    purchaseOrders: core.purchaseOrders,
    receipts: core.receipts,
    contacts: core.contacts,
    currentUserId: core.currentUserId,
    users: core.users,
    accounts: core.accounts,
    refurbishmentJobs: core.refurbishmentJobs,
    systemSettings: core.systemSettings,
    bulkStock: core.bulkStock,
    stockAdjustments: core.stockAdjustments,
    saleOrders: core.saleOrders,
    ...core.inventoryActions,
  }), [
    core.products,
    core.productPriceHistory,
    core.serials,
    core.stockMoves,
    core.stockTransfers,
    core.openingStockLocked,
    core.purchaseOrders,
    core.receipts,
    core.contacts,
    core.currentUserId,
    core.users,
    core.accounts,
    core.refurbishmentJobs,
    core.systemSettings,
    core.bulkStock,
    core.stockAdjustments,
    core.saleOrders,
    core.inventoryActions,
  ])

  const salesStore = useMemo<SalesStoreState>(() => ({
    saleOrders: core.saleOrders,
    repairs: core.repairs,
    contacts: core.contacts,
    products: core.products,
    serials: core.serials,
    invoices: core.invoices,
    deliveries: core.deliveries,
    returnOrders: core.returnOrders,
    stockReservations: core.stockReservations,
    posOrders: core.posOrders,
    users: core.users,
    currentUserId: core.currentUserId,
    systemSettings: core.systemSettings,
    companySettings: core.companySettings,
    bankAccounts: core.bankAccounts,
    documentPaymentDetails: core.documentPaymentDetails,
    outboundReleases: core.outboundReleases,
    approvalRequests: core.approvalRequests,
    sops: core.sops,
    ...core.salesActions,
  }), [
    core.saleOrders,
    core.contacts,
    core.products,
    core.serials,
    core.invoices,
    core.deliveries,
    core.returnOrders,
    core.stockReservations,
    core.posOrders,
    core.users,
    core.currentUserId,
    core.systemSettings,
    core.companySettings,
    core.bankAccounts,
    core.documentPaymentDetails,
    core.outboundReleases,
    core.approvalRequests,
    core.sops,
    core.salesActions,
  ])

  const repairStore = useMemo<RepairStoreState>(() => ({
    repairs: core.repairs,
    contacts: core.contacts,
    products: core.products,
    users: core.users,
    riders: core.riders,
    refurbishmentJobs: core.refurbishmentJobs,
    currentUserId: core.currentUserId,
    outsourceJobs: core.outsourceJobs,
    outsourceVendors: core.outsourceVendors,
    warranties: core.warranties,
    systemSettings: core.systemSettings,
    companySettings: core.companySettings,
    invoices: core.invoices,
    quotes: core.quotes,
    saleOrders: core.saleOrders,
    outboundReleases: core.outboundReleases,
    serials: core.serials,
    ...core.repairActions,
  }), [
    core.repairs,
    core.contacts,
    core.products,
    core.users,
    core.riders,
    core.refurbishmentJobs,
    core.currentUserId,
    core.outsourceJobs,
    core.outsourceVendors,
    core.warranties,
    core.systemSettings,
    core.companySettings,
    core.invoices,
    core.quotes,
    core.saleOrders,
    core.outboundReleases,
    core.serials,
    core.repairActions,
  ])

  const shellStore = useMemo<ShellStoreState>(() => ({
    activeModule: core.activeModule,
    sidebarOpen: core.sidebarOpen,
    toast: core.toast,
    currentUser: core.currentUser(),
    currentUserId: core.currentUserId,
    users: core.users,
    notifications: core.notifications,
    profileImages: core.profileImages,
    repairs: core.repairs,
    ...core.shellActions,
  }), [
    core.activeModule,
    core.sidebarOpen,
    core.toast,
    core.users,
    core.currentUserId,
    core.notifications,
    core.profileImages,
    core.repairs,
    core.shellActions,
  ])

  const crmStore = useMemo<CrmStoreState>(() => ({
    contacts: core.contacts,
    companies: core.companies,
    contactPersons: core.contactPersons,
    customerCredits: core.customerCredits,
    opportunities: core.opportunities,
    opportunityActivities: core.opportunityActivities,
    quotes: core.quotes,
    customerContracts: core.customerContracts,
    invoices: core.invoices,
    posOrders: core.posOrders,
    repairs: core.repairs,
    saleOrders: core.saleOrders,
    users: core.users,
    currentUserId: core.currentUserId,
    systemSettings: core.systemSettings,
    ...core.crmActions,
  }), [
    core.contacts,
    core.companies,
    core.contactPersons,
    core.customerCredits,
    core.opportunities,
    core.opportunityActivities,
    core.quotes,
    core.customerContracts,
    core.invoices,
    core.posOrders,
    core.repairs,
    core.saleOrders,
    core.users,
    core.currentUserId,
    core.systemSettings,
    core.crmActions,
  ])

  const financeStore = useMemo<FinanceStoreState>(() => ({
    accounts: core.accounts,
    bankAccounts: core.bankAccounts,
    documentPaymentDetails: core.documentPaymentDetails,
    bankRecons: core.bankRecons,
    bankStatementLines: core.bankStatementLines,
    buyBacks: core.buyBacks,
    clientExchanges: core.clientExchanges,
    companySettings: core.companySettings,
    contacts: core.contacts,
    currentUser: core.currentUser(),
    currentUserId: core.currentUserId,
    customerCredits: core.customerCredits,
    deliveries: core.deliveries,
    deposits: core.deposits,
    donations: core.donations,
    expenses: core.expenses,
    invoices: core.invoices,
    journalEntries: core.journalEntries,
    companyAssets: core.companyAssets,
    outboundReleases: core.outboundReleases,
    outsourceJobs: core.outsourceJobs,
    outsourcePayments: core.outsourcePayments,
    outsourceVendors: core.outsourceVendors,
    payrollRuns: core.payrollRuns,
    posOrders: core.posOrders,
    products: core.products,
    purchaseOrders: core.purchaseOrders,
    purchaseReturns: core.purchaseReturns,
    receipts: core.receipts,
    refundPayments: core.refundPayments,
    repairs: core.repairs,
    saleOrders: core.saleOrders,
    serials: core.serials,
    systemSettings: core.systemSettings,
    users: core.users,
    ...core.financeActions,
  }), [
    core.accounts,
    core.bankAccounts,
    core.documentPaymentDetails,
    core.bankRecons,
    core.bankStatementLines,
    core.buyBacks,
    core.clientExchanges,
    core.companySettings,
    core.contacts,
    core.users,
    core.currentUserId,
    core.customerCredits,
    core.deliveries,
    core.deposits,
    core.donations,
    core.expenses,
    core.invoices,
    core.journalEntries,
    core.companyAssets,
    core.outboundReleases,
    core.outsourceJobs,
    core.outsourcePayments,
    core.outsourceVendors,
    core.payrollRuns,
    core.posOrders,
    core.products,
    core.purchaseOrders,
    core.purchaseReturns,
    core.receipts,
    core.refundPayments,
    core.repairs,
    core.saleOrders,
    core.serials,
    core.systemSettings,
    core.financeActions,
  ])

  const hrStore = useMemo<HrStoreState>(() => ({
    currentUser: core.currentUser(),
    currentUserId: core.currentUserId,
    users: core.users,
    refSops: core.refSops,
    sopDocuments: core.sopDocuments,
    ...core.hrActions,
  }), [
    core.users,
    core.currentUserId,
    core.refSops,
    core.sopDocuments,
    core.hrActions,
  ])

  const deliveryStore = useMemo<DeliveryStoreState>(() => ({
    companySettings: core.companySettings,
    currentUserId: core.currentUserId,
    deliveryJobs: core.deliveryJobs,
    invoices: core.invoices,
    repairs: core.repairs,
    riderWeeklyPays: core.riderWeeklyPays,
    riders: core.riders,
    saleOrders: core.saleOrders,
    users: core.users,
    ...core.deliveryActions,
  }), [
    core.companySettings,
    core.currentUserId,
    core.deliveryJobs,
    core.invoices,
    core.repairs,
    core.riderWeeklyPays,
    core.riders,
    core.saleOrders,
    core.users,
    core.deliveryActions,
  ])

  const commerceStore = useMemo<CommerceStoreState>(() => ({
    companySettings: core.companySettings,
    systemSettings: core.systemSettings,
    contacts: core.contacts,
    currentUserId: core.currentUserId,
    customerCredits: core.customerCredits,
    invoices: core.invoices,
    kilimallDispatches: core.kilimallDispatches,
    kilimallOrders: core.kilimallOrders,
    kilimallSettlements: core.kilimallSettlements,
    posOrders: core.posOrders,
    posSessionOpen: core.posSessionOpen,
    posSessionOpeningCash: core.posSessionOpeningCash,
    posSessionId: core.posSessionId,
    posSessions: core.posSessions,
    products: core.products,
    saleOrders: core.saleOrders,
    serials: core.serials,
    users: core.users,
    bankAccounts: core.bankAccounts,
    ...core.commerceActions,
  }), [
    core.companySettings,
    core.systemSettings,
    core.contacts,
    core.currentUserId,
    core.customerCredits,
    core.invoices,
    core.kilimallDispatches,
    core.kilimallOrders,
    core.kilimallSettlements,
    core.posOrders,
    core.posSessionOpen,
    core.posSessionOpeningCash,
    core.posSessionId,
    core.posSessions,
    core.products,
    core.saleOrders,
    core.serials,
    core.users,
    core.bankAccounts,
    core.commerceActions,
  ])

  const afterSalesStore = useMemo<AfterSalesStoreState>(() => ({
    buyBacks: core.buyBacks,
    clientExchanges: core.clientExchanges,
    contacts: core.contacts,
    currentUserId: core.currentUserId,
    donations: core.donations,
    invoices: core.invoices,
    posOrders: core.posOrders,
    products: core.products,
    returnOrders: core.returnOrders,
    saleOrders: core.saleOrders,
    serials: core.serials,
    users: core.users,
    warranties: core.warranties,
    ...core.afterSalesActions,
  }), [
    core.buyBacks,
    core.clientExchanges,
    core.contacts,
    core.currentUserId,
    core.donations,
    core.invoices,
    core.posOrders,
    core.products,
    core.returnOrders,
    core.saleOrders,
    core.serials,
    core.users,
    core.warranties,
    core.afterSalesActions,
  ])

  const operationsStore = useMemo<OperationsStoreState>(() => ({
    contactPersons: core.contactPersons,
    contacts: core.contacts,
    currentUserId: core.currentUserId,
    holdovers: core.holdovers,
    products: core.products,
    refurbishmentJobs: core.refurbishmentJobs,
    repairs: core.repairs,
    serials: core.serials,
    systemSettings: core.systemSettings,
    users: core.users,
    warranties: core.warranties,
    ...core.operationsActions,
  }), [
    core.contactPersons,
    core.contacts,
    core.currentUserId,
    core.holdovers,
    core.products,
    core.refurbishmentJobs,
    core.repairs,
    core.serials,
    core.systemSettings,
    core.users,
    core.warranties,
    core.operationsActions,
  ])

  return (
    <StoreCtx.Provider value={storeCtx}>
      <InventoryStoreCtx.Provider value={inventoryStore}>
        <SalesStoreCtx.Provider value={salesStore}>
          <RepairStoreCtx.Provider value={repairStore}>
            <DashboardStoreCtx.Provider value={storeCtx}>
              <CrmStoreCtx.Provider value={crmStore}>
                <FinanceStoreCtx.Provider value={financeStore}>
                  <HrStoreCtx.Provider value={hrStore}>
                    <DeliveryStoreCtx.Provider value={deliveryStore}>
                      <CommerceStoreCtx.Provider value={commerceStore}>
                        <AfterSalesStoreCtx.Provider value={afterSalesStore}>
                          <OperationsStoreCtx.Provider value={operationsStore}>
                            <ShellStoreCtx.Provider value={shellStore}>
                              {core.children}
                            </ShellStoreCtx.Provider>
                          </OperationsStoreCtx.Provider>
                        </AfterSalesStoreCtx.Provider>
                      </CommerceStoreCtx.Provider>
                    </DeliveryStoreCtx.Provider>
                  </HrStoreCtx.Provider>
                </FinanceStoreCtx.Provider>
              </CrmStoreCtx.Provider>
            </DashboardStoreCtx.Provider>
          </RepairStoreCtx.Provider>
        </SalesStoreCtx.Provider>
      </InventoryStoreCtx.Provider>
    </StoreCtx.Provider>
  )
}

export { StoreProvider as AppProvider }

export function useApp() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}

export function useInventoryStore() {
  const ctx = useContext(InventoryStoreCtx)
  if (!ctx) throw new Error('useInventoryStore must be inside AppProvider')
  return ctx
}

export function useSalesStore() {
  const ctx = useContext(SalesStoreCtx)
  if (!ctx) throw new Error('useSalesStore must be inside AppProvider')
  return ctx
}

export function useRepairStore() {
  const ctx = useContext(RepairStoreCtx)
  if (!ctx) throw new Error('useRepairStore must be inside AppProvider')
  return ctx
}

export function useCrmStore() {
  const ctx = useContext(CrmStoreCtx)
  if (!ctx) throw new Error('useCrmStore must be inside AppProvider')
  return ctx
}
export function useFinanceStore() {
  const ctx = useContext(FinanceStoreCtx)
  if (!ctx) throw new Error('useFinanceStore must be inside AppProvider')
  return ctx
}
export function useHrStore() {
  const ctx = useContext(HrStoreCtx)
  if (!ctx) throw new Error('useHrStore must be inside AppProvider')
  return ctx
}
export function useDeliveryStore() {
  const ctx = useContext(DeliveryStoreCtx)
  if (!ctx) throw new Error('useDeliveryStore must be inside AppProvider')
  return ctx
}
export function useCommerceStore() {
  const ctx = useContext(CommerceStoreCtx)
  if (!ctx) throw new Error('useCommerceStore must be inside AppProvider')
  return ctx
}
export function useAfterSalesStore() {
  const ctx = useContext(AfterSalesStoreCtx)
  if (!ctx) throw new Error('useAfterSalesStore must be inside AppProvider')
  return ctx
}
export function useOperationsStore() {
  const ctx = useContext(OperationsStoreCtx)
  if (!ctx) throw new Error('useOperationsStore must be inside AppProvider')
  return ctx
}
export function useShellStore() {
  const ctx = useContext(ShellStoreCtx)
  if (!ctx) throw new Error('useShellStore must be inside AppProvider')
  return ctx
}
export const fmtDate = (d: string) => { try { return formatKeDate(d) } catch { return d } }
export const fmtDateTime = (d: string) => {
  try {
    const raw = String(d || '')
    if (!raw) return ''
    const dt = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`)
    if (Number.isNaN(dt.getTime())) return raw
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatKeDate(dt)
    return formatKeDateTime(dt)
  } catch {
    return d
  }
}
