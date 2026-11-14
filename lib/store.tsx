// @ts-nocheck
'use client'
import { createSalesActions } from './store/actions/sales'
import { createInventoryActions } from './store/actions/inventory'
import { createRepairActions } from './store/actions/repairs'
import { createShellActions } from './store/actions/shell'
import { createSopActions } from './store/actions/sop'
import { createHrActions } from './store/actions/hr'
import { createPurchasingActions } from './store/actions/purchasing'
import { createDeliveryActions } from './store/actions/delivery'
import { createAfterSalesActions } from './store/actions/after-sales'
import type { StoreDeps } from './store/actions/deps'
import { applyReversalToInvoices, reversalJournalForStore, type PaymentReversalInfo } from '@/lib/accounting/payment-reversal'
import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef, useMemo } from 'react'
import {
  hasActivePosSession,
  isPosBankPayment,
  mergePosSessionsRemoteState,
  posOrdersForSession,
  resolveOpenPosSessionId,
} from '@/lib/pos-session'
export { isPosBankPayment }
import { mergeDirtyPosOrdersBlob, mergePosOrdersRemoteState, nextPosTicketRef } from '@/lib/pos-orders-merge'
import { loyaltyPointsEarned } from '@/lib/loyalty'
import { allocateDocNumber, allocateDocNumberSync } from '@/lib/doc-numbers'
import { adjustmentsMissingValuation, isProvisionalDocRef, recordsNeedingNumbers } from '@/lib/doc-number-repair'
import { allocateRepairRef, takenRepairRefs } from '@/lib/repair-ref'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { useRouteDataReady } from '@/lib/route-data-ready'
import { persistClientStoreValue } from '@/lib/client-store-cache'
import { scheduleCatalogHealOnce } from '@/lib/catalog-boot-heal'
import { requestCreateUser, requestDeleteUser, requestUpdateUser, requestDeactivateUser, requestReactivateUser } from '@/lib/auth/client-users'
import { awaitingIdentification } from '@/lib/refurbishment/unidentified'
import { PAID_TO_RIDER, riderFeeAccount, riderPayForJob } from '@/lib/delivery/rider-direct-pay'
import { isWithholdingMethod, WITHHOLDING_KINDS } from '@/lib/accounting/withholding'
import { getFirstAllowedModule, hasModuleAccess as userHasModuleAccess } from '@/lib/auth/access'
import { mergeCatalogProducts, mergeProductsRemoteState } from '@/lib/catalog-merge'
import { seedSerialSpecs } from '@/lib/reconfiguration/unit-config'
import { refurbishmentSellingNamePatch } from '@/lib/refurbishment/apply-upgrade-specs'
import { bootApiGroupsForRoute, type BootApiGroup } from '@/lib/boot-apis'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'
import { isPrismaRestSotStoreKey } from '@/lib/domain-source-of-truth'
import { useInventoryDomainStore } from '@/hooks/useInventoryDomainStore'
import { useNotificationStore } from '@/hooks/useNotificationStore'
import { documentMoneySnapshot, FUNCTIONAL_CURRENCY } from '@/lib/currency'
import { resolveListPrice } from '@/lib/pricing/pricelist'
import {
  DEFAULT_PRICING_MARGIN_POLICY,
  normalizePricingMarginPolicy,
  type PricingMarginPolicy,
} from '@/lib/pricing/margin-policy'
import type { CreateUserInput, ModuleId as AuthModuleId, PublicUser, UpdateUserInput, UserRole as AuthUserRole } from '@/lib/auth/types'
import {
  type CompanyAsset,
  type CompanyAssetInput,
  type CompanyAssetStatus,
  nextCompanyAssetRef,
  resolvedPpeAccountCode,
  validateCompanyAssetInput,
  canDeleteCompanyAsset,
  applyMove,
  applyCustodian,
  applyStatusChange,
  applyDispose,
  applyWriteOff,
  historyEntry,
} from '@/lib/company-property'
import {
  applyBookDepreciationCharge,
  canDepreciateAsset,
  monthlyBookDepreciation,
  periodAlreadyRun,
  periodKey,
  shouldPostCapitaliseJournal,
  withBookDefaults,
  isPpeCostAccount,
} from '@/lib/company-property-ppe'
import {
  buildCapitaliseFromApJournal,
  buildCapitaliseFromInventoryJournal,
  buildDepreciationJournal,
  buildDisposalJournal,
  depreciationJournalRef,
  type PpeJournalDraft,
} from '@/lib/accounting/ppe-journals'
import { applyKraAnnualAllowance, initialTaxWdv } from '@/lib/tax/kra-capital-allowances'
export type { CompanyAsset, CompanyAssetInput } from '@/lib/company-property'
import { CATEGORY_CONFIG, ALL_CATEGORIES, type CategoryId } from '@/lib/product-categories'
export { CATEGORY_CONFIG, ALL_CATEGORIES, type CategoryId }
import { calcStockByLocation as _calcStockByLocation, upsertBulkStock as _upsertBulkStock, aggregatePayroll } from '@/lib/business-logic'
import { calculatePayroll } from '@/lib/payroll'
import {
  APPROVAL_RULES,
  createApprovalRequest,
  computeConfirmBackorderLines,
  getPendingApprovals,
  processApproval,
  approvalRecipientIds,
  approvalDocumentPath,
} from '@/lib/sales-approvals'
import { actorSatisfiesApprovalRoles, isSalesConfirmGatingApproval } from '@/lib/sales-approval-rules'
import { computeSaleOrderApprovalTriggers } from '@/lib/sales/margin-approval'
import { allocateSalesReturn, liveQtyInvoicedBySoLine } from '@/lib/sales/return-allocation'

/**
 * Roles the server sends customer invoices to (see invoiceSliceForRole). For
 * anyone else the screen holds no customer invoices, so counting live ones
 * would read as "none" and drop a credit note that is owed.
 */
const seesCustomerInvoices = (user: { role?: string } | null | undefined) => userCan(user, 'accounting.customer_invoices.view')
import {
  findReleasedOrcsForReturn,
  pickPostedInvoiceForReturn,
  resolveReturnCreditAmount,
  stampDeliveryReturnQtys,
} from '@/lib/sales/return-orchestration'
import { isDownPaymentMode, normalizeCreateInvoiceMode } from '@/lib/sales/down-payment'
import {
  advanceExpenseApproval,
  buildExpenseApprovalChain,
  canUserReviewExpense,
  expenseChainIsComplete,
} from '@/lib/expense-approval-chain'
import type { ApprovalRequest, ApprovalType, StockReservation } from '@/lib/sales-flow-types'
import {
  buildNotifyRows,
  clearReadNotificationsForUser,
  markAllNotificationsReadForUser,
  markNotificationReadInList,
  mergeNotificationsSticky,
  userIdsWithRoles,
  type NotifyUsersInput,
} from '@/lib/in-app-notifications'
import { LEAVE_ENTITLEMENTS, NOTICE_EXEMPT_TYPES, CALENDAR_DAY_TYPES, calcWorkingDays, calcCalendarDays, noticeDaysGiven, requiredNotice, decemberClosureDays } from '@/lib/leave-utils'
import type { StoreLeaveType } from '@/lib/leave-utils'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'
import { normalizeOpportunitiesForClient, normalizeOpportunityForClient } from '@/lib/opportunity-normalization'
import { normalizeCompaniesForClient } from '@/lib/company-normalization'
import { saleOrderPersistBody } from '@/lib/sale-order-persist'
import { fulfillmentSaleOrderPatch } from '@/lib/sales/fulfillment-sale-order-patch'
import { readLockVersionFromResponse } from '@/lib/optimistic-lock'
import { createdInvoiceId, invoiceErrorMessage, invoicePersistBody, putInvoiceOrCreateThenPost, putInvoiceWithLockRetry } from '@/lib/invoice-persist'
import { resolveAddSaleOrderLineTaxRate } from '@/lib/sale-order-line-tax'
import {
  markSaleOrderDraftEdit,
  hasSaleOrderDraftEdits,
  isSaleOrderDraftEditing,
  stampSaleOrderPersisted,
  mergeSaleOrdersPreservingDraftEdits,
  saleOrderLinesFingerprint,
} from '@/lib/sale-order-draft-edits'
import { mergeRepairsStoreWrite } from '@/lib/repair-store-merge'
import { mergeCollectionById } from '@/lib/collection-merge'
import { isKnownClientAppStateKey } from '@/lib/app-state-hydration'
import { fetchCollection } from '@/lib/api-pagination'
import { fetchAndApplyStoreKeys } from '@/lib/client-store-hydrate'
import {
  registerSaleOrderDraftPersistApi,
  scheduleDraftSaleOrderLinePersist,
  beginHardSaleOrderPersist,
  endHardSaleOrderPersist,
  waitForDraftSaleOrderPersistIdle,
  isSaleOrderHardSaving,
} from '@/lib/sale-order-draft-persist'
import {
  normalizeSaleOrdersForClient,
  saleOrderCancelBlockers,
  splitDeliveryForBackorder,
  initialDeliveryState,
  invoicePaymentStatus,
  invoiceDocState,
  isOpenInvoice,
  invoiceResidual,
  hasValidatedDeliveryForInvoice,
  isOpenDeliveryStatus,
  normalizeDeliveryStatus,
  remainingUndeliveredByProduct,
  openDeliveryDemandByProduct,
  saleOrderLooksConfirmed,
  canReverseConfirmedSale,
  isQuotationStage,
} from '@/lib/odoo-sales-flow'
import {
  applyConfirmLineSelection,
  confirmSelectionHasProduct,
} from '@/lib/sales/confirm-quotation'
import { calcSaleOrderTotals } from '@/lib/sales/line-calc'
import { trimSaleOrderLinesToDelivered } from '@/lib/sales/fulfillment-trim'
import {
  allocateDeliveredQtyToOrderLines,
  assertSerialUsableForDeliveryPrepare,
  pairOrderLinesWithDeliveryLines,
  planPrepareDeliveryLines,
  sumQtyByProductId,
} from '@/lib/delivery-prepare'
import { isNonStockSaleLine, isDeliveryNoteLine, saleLineFieldsForRepairQuoteLine } from '@/lib/sales/non-stock-line'
import { resolveInvoicePolicy } from '@/lib/sales/invoice-policy'
import {
  normalizeDocumentPaymentDetails,
  type DocumentPaymentDetails,
  type DocumentPaymentDetailsMap,
} from '@/lib/document-payment-details'
import { useHrStore as useHrDomainStore } from '@/hooks/useHrStore'
import {
  buildInventoryBarcode,
  inferTrackingMethod,
  isSerialTracking,
  isStockTracked,
  isSerialOnlyCategory,
  type TrackingMethod,
} from '@/lib/inventory-identifiers'
import { canonicalRole, isDirector } from '@/lib/auth/roles'
import {
  aggregateLinesByAccount,
  COMPANY_ACCOUNT_FALLBACKS,
  formatAccountLabel,
  resolveProductAccounts,
  type AccountableProduct,
} from '@/lib/product-accounts'
import {
  buildVendorBillPerpetualLines,
  buildVendorCreditPerpetualLines,
} from '@/lib/accounting/vendor-bill-perpetual'
import { autoMatchStatementLines } from '@/lib/accounting/bank-statement-match'
import { inferProductKind, defaultTrackingForKind, defaultUnitForKind } from '@/lib/product-kind'
import {
  canPostOrPayCustomerInvoice,
  canPayOwnPostedInvoice,
  canCancelOrResetInvoice,
  canApplyCustomerCredit,
  paymentJournalRef,
  DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES,
} from '@/lib/finance-controls'
// Buy-back settlement: Pay (cash) XOR Add as credit (3102). Shared by store + tests.
import {
  BUYBACK_STORE_CREDIT_METHOD,
  buildBuyBackStoreCreditJournalLines,
  buyBackStoreCreditAmount,
  canCreditBuyBack,
  canPayBuyBackCash,
  buildBuyBackPayoutBillLines,
  resolveBuyBackProduct,
} from '@/lib/buyback-credit'
import { userCan } from '@/lib/auth/can'
import { customerCreditBalance } from '@/lib/customer-credit-view'
import { canOverrideCustomerCredit, evaluateCustomerCreditGate, isPayOnReceipt } from '@/lib/customer-credit-gate'
import { ensureArray, parseStoredState, preferExistingArray } from '@/lib/safe-local-state'
import {
  nextSseRetryMs,
  nextSyncRetryMs,
  parseStoreSseData,
  STORE_HELLO_GRACE_MS,
  STORE_NOTIFY_BACKUP_POLL_MS,
} from '@/lib/store-sync-retry'
import { startVisiblePoll } from '@/lib/visible-poll'
import { repairOutsourceReadiness, repairHasLoggedDiagnosis } from '@/lib/repair-outsource'
import { applyLoggedDiagnosis, type DiagnosisLogRepairPatch } from '@/lib/repair-diagnosis-log'
import { getPreviousRepairProgressStatus } from '@/lib/repair-progress'
import { evaluateRepairTransition } from '@/lib/repair-transition-policy'
import { repairDatesWriteError } from '@/lib/data-validation'
import { ensureRepairIntakeTimestamp } from '@/lib/repair-datetime'
import { EXCHANGE_RETURN_LOCATION } from '@/lib/aftersales/exchange-stock'
import {
  isDirectRepairPath,
  isQuoteDeclinedReopenable,
  isQuoteAwaitingApproval,
  quotableStatusesForPath,
  returnableStatusesForPath,
  startableStatusesForPath,
} from '@/lib/repair-path'
import {
  BILLING_EXEMPT_REASON_LABELS,
  canMarkRepairBillingExempt,
  isRepairBillingExempt,
  isRepairNoCharge,
  normalizeBillingExemptReason,
  startableStatusesWhenBillingExempt,
  type BillingExemptReason,
} from '@/lib/repair-billing-exempt'
import { applyRepairHandover, canCloseRepairAfterHandover, repairHasInvoiceLink } from '@/lib/repair-handover'
import { resolveWarrantyMonths, addWarrantyMonths } from '@/lib/warranty-period'
import { resolveRepairWarranty } from '@/lib/repair-warranty'
import {
  ensureDiagnosisFeeInQuoteLines,
  isDiagnosisFeeLine,
  isDiagnosisFeeSettled,
  migratedDiagnosisFeeSettings,
  needsDiagnosisFeeSettingsMigration,
  normalizeStoredDiagnosisFee,
  resolveCustomerBillingType,
  resolveDiagnosisFee,
  shouldChargeDiagnosisFee,
  taxableQuoteSubtotal,
  diagnosisFeeAmount,
} from '@/lib/diagnosis-fee'
import { buildRepairInvoiceCharges, invoiceMatchesRepairCharges, repairBillsFeeOnly, repairInvoiceChargeTotal } from '@/lib/repair-invoice'
import { repairPriceChangeImpact, describeRepairPriceChange } from '@/lib/repair/document-impact'
import { isAssignableTechnician, isRepairTechActor, isRepairAssignerRole, mergeAssignableTechniciansIntoUsers } from '@/lib/repair/assignable-technicians'
import { requestSaleOrderInvoice } from '@/lib/sales/create-invoice-request'
import { resolveBillProductId } from '@/lib/purchase/bill-product-id'
import { contactPaymentTermsDays, customerPaymentTermsDays } from '@/lib/due-date'
import { deniedSaveMessage } from '@/lib/store-denied-message'
import { planRepairConsolidation, supersededOrderBlockers } from '@/lib/repair/consolidation-plan'
import { isSellableSerial } from '@/lib/inventory/sellable-stock'
import { reportingFetch } from '@/lib/save-failure'
import { allocateReceiptToPoLines, billedQtyByPoLine } from '@/lib/purchase/receipt-allocation'
import { reissueAfterClientDecision, reissueBlocker, reissueOnRevision, type InvoiceReissue } from '@/lib/repair/invoice-reissue'
import { countCorrectionBlocker, countCorrectionNote, partsOrderNote, purchaseOrderBlocker, requestAfterCountCheck, requestAfterPurchaseOrder, type PartsRequest, type PartsRequestKind } from '@/lib/repair/parts-request'
import { refurbPartAfterRequest, refurbPartRequest, refurbPartsOrderNote } from '@/lib/refurbishment/parts-request'
import { executeRepairConsolidation, mergedSaleOrderFromPlan } from '@/lib/repair/consolidation-execute'
import { findSaleOrderForRepair, findSalesQuoteForRepair, isDiagnosisFeeOnlyLines } from '@/lib/repair/sale-order-link'
import { isRepairLinkedSaleOrder } from '@/lib/sales/commission-closer'
import {
  buildDefaultRepairQcItems,
  prepareRepairQcItemsForRound,
  summarizeFailedQcItems,
} from '@/lib/repair-qc'
import {
  buyBackConditionFromRepair,
  canConvertRetainedRepair,
  canCreateTradeInFromRepair,
  findRepairCatalogProduct,
  matchRepairDeviceSerial,
} from '@/lib/repair-retain-convert'
import { planRepairPartConsume, planRepairPartReserve } from '@/lib/inventory/repair-parts-stock'
import {
  isOpeningStockLocked,
  isOpeningStockMove,
} from '@/lib/inventory/opening-stock'
import { billableQty, assertBillableQty, poHasReceivedGoods } from '@/lib/purchase/three-way-match'
import { allocatePurchaseReturn, liveQtyBilledByPoLine } from '@/lib/purchase/return-allocation'
import {
  formatStockByLocation,
  resolveBulkDeliverySourceLocation,
} from '@/lib/inventory/delivery-source'
import { resolveAssignedRiderFee } from '@/lib/delivery-job-fee'
import {
  appendDeliveryChargeToInvoice,
  buildDeliveryChargeInvoiceLine,
} from '@/lib/invoice-delivery-charge'
import { safeLocalStorageSet } from '@/lib/client-store-cache'
import { computeCollectionDelta, upsertOnlyDelta, type CollectionDelta } from '@/lib/store-delta'
import { deltaDisabledFor, forgetServerBaseline, patchServerBaseline, rememberServerBaseline, serverBaselineFor } from '@/lib/store-baseline'
import { isSlimRow, SLIM_MARK } from '@/lib/store-slim'
import { loadFullRecord } from '@/lib/full-record'
import { awaitRouteHydration, awaitStoreDownloads, downloadedThisSession, keysChangedSinceRead, noteStoreChanges, noteStoreRead, trackStoreDownload } from '@/lib/store-freshness'
import { formatKeDate, formatKeDateTime, formatKeInteger, installIntlFormatCache } from '@/lib/intl-cache'
import { keepContainedRows, keepUnchangedRows } from '@/lib/same-content'
import { refurbPartStockTaken } from '@/lib/refurbishment/refurb-parts'
import type { KilimallReturnEntry, KilimallReturnInput } from '@/lib/kilimall/kilimall-return'
import { contactFromPersonInput, deriveContactPersons } from '@/lib/contact-person-derive'
import {
  applyCustomerToInvoice,
  applyCustomerToQuote,
  applyCustomerToSaleOrder,
  formatCustomerAddress,
  quoteMatchesCustomer,
  shouldSyncInvoiceCustomer,
  shouldSyncQuoteCustomer,
  shouldSyncSaleOrderCustomer,
} from '@/lib/sync-customer-documents'
import type { IntakeChannel, RepairDiagnosis, RepairDiagnosisRevisionType, RepairPaymentConfirmationStatus, RepairQAItem, RepairQuote, RepairQuoteLine, RepairQuoteLineDecision, RepairStatus } from '@/lib/repair-types'
import type { BuyBack, BuyBackLine, ClientExchange, Donation, DonationLine, DonationType, ExchangeLine, RMAResolution, ReturnOrder, ReturnOrderLine } from './store/after-sales'
export type { BuyBack, BuyBackLine, BuyBackStatus, ClientExchange, Donation, DonationLine, DonationType, ExchangeLine, ExchangeStatus, RMAResolution, RMAStatus, ReturnOrder, ReturnOrderLine } from './store/after-sales'
import type { AuditLog, LocationId, ModuleId, User, UserRole, WorkflowApproval } from './store/core'
export type { LocationId, ModuleId, User, UserRole, WorkflowApproval } from './store/core'
import type { Delivery, DeliveryJob, DeliveryJobStatus, DeliveryLine, Rider, RiderWeeklyPay } from './store/delivery'
export type { Delivery, DeliveryJob, DeliveryJobStatus, DeliveryJobType, DeliveryLine, Rider, RiderWeeklyPay } from './store/delivery'
import type { Account, AccountType, BankAccount, BankRecon, BankStatementLine, CreateDepositInput, CustomerCredit, Deposit, DepositPayment, DepositStatus, ExpenseApprovalStep, ExpensePaymentMethod, ExpenseStatus, Invoice, InvoiceLine, InvoicePayment, InvoiceType, JournalEntry, JournalEntryLine, Payment, RefundPayment, RefundPaymentMethod, VendorJournalOpts } from './store/finance'
export type { Account, AccountType, BankAccount, BankStatementLine, CashbookEntry, Deposit, DepositItem, DepositPayment, DepositStatus, ExpenseApprovalStep, ExpensePaymentMethod, ExpenseStatus, Invoice, InvoiceLine, InvoicePayment, InvoiceStatus, InvoiceType, JournalEntry, JournalEntryLine, Payment, RefundPayment, RefundPaymentMethod, StatementLineCategory } from './store/finance'
import type { Candidate, Contract, Department, Employee, EmployeeAssetAssignment, EmployeeTraining, HRDocument, HRSOP, JobPosting, LeaveBalance, LeaveRequest, PayrollRun, Payslip, PerformanceTarget, RefSOP, SalaryAdvance, TrainingProgram } from './store/hr'
export type { Candidate, CandidateCommunication, CandidateInterview, CandidateOffer, CandidateStage, Department, Employee, EmployeeAssetAssignment, EmployeeChecklistItem, EmployeeTraining, HRDocument, HRSOP, JobPosting, JobStatus, LeaveBalance, LeaveRequest, PayrollLine, PayrollRun, Payslip, PerfPeriod, PerfStatus, PerformanceTarget, RefSOP, RefSOPCategory, SOPCategory, SalaryAdvance, TrainingProgram, TrainingStatus } from './store/hr'
import type { AdjReason, BulkStockLevel, Holdover, ItemReleaseStatus, OrcLogEntry, OutboundRelease, Product, ProductPriceHistory, RefurbPart, RefurbishmentJob, ReleaseStatus, SerialNumber, SignatureMethod, StockAdjustment, StockMove, TaggedIntakeInput } from './store/inventory'
export type { AdjReason, Holdover, HoldoverDeviceCondition, HoldoverPurpose, HoldoverStatus, ItemReleaseStatus, OrcItem, OrcLogEntry, OutboundRelease, Product, RefurbPart, RefurbStatus, RefurbishmentJob, ReleaseStatus, SerialNumber, SignatureMethod, StockMove, TaggedIntakeInput } from './store/inventory'
import type { POLine, PurchaseOrder, PurchaseReturn, Receipt, StockTransfer } from './store/purchasing'
export type { POLine, POStatus, PurchaseOrder, PurchaseReturn, Receipt } from './store/purchasing'
import type { OutsourceJobStatus, OutsourcePayment, RepairOrder, Warranty } from './store/repairs'
export type { OutsourceJobStatus, RepairOrder, Warranty } from './store/repairs'
import type { Company, Contact, ContactPerson, CustomerContract, KilimallDispatch, KilimallOrder, KilimallSettlement, KilimallSettlementLine, Opportunity, OpportunityActivity, OpportunityStage, POSOrder, POSSession, Quote, QuoteLineItem, SaleOrder } from './store/sales'
export type { Client, Contact, CustomerContract, KilimallDispatch, KilimallOrder, KilimallOrderStatus, KilimallSettlement, KilimallSettlementLine, LeadSource, OpportunityStage, POSOrder, Quote, SOStatus, SaleOrder, SaleOrderItem } from './store/sales'
import type { CompanySettings, SystemSettings } from './store/settings'
export type { CompanySettings } from './store/settings'
import type { SOPActual, SOPDocument, SOPTargetDir } from './store/sop'
import { uid, now } from './store/ids'
import { type ExpenseCategory, type Expense } from './store/expenses'
import { isoDate, accountLine, journalFromPpeDraft, bankAccountLabel, bankAccountIdForMethod, buildInvoicePostingJournal, buildVendorCreditJournal, buildInvoicePaymentJournal, buildExpenseApprovalJournal, buildExpenseCompanyPaymentJournal, buildExpenseReimbursementJournal, buildReversalJournal, buildCustomerCreditJournal } from './store/journals'
import { OUTSOURCE_SERVICE_TYPES, type OutsourceVendor, type OutsourceJob } from './store/repairs'
import { type SOP } from './store/sop'
import { DEFAULT_SYSTEM_SETTINGS, seedAccounts, seedContacts, seedCompanies, seedOpportunities, seedQuotes, seedCustomerContracts, seedOpportunityActivities, seedContracts, seedWorkflowApprovals, seedPayrollRuns, seedPayslips, seedJournalEntries, seedEmployeeAssetAssignments, seedProducts, seedSerials, seedPOs, seedReceipts, seedTransfers, seedRefurbishmentJobs, seedSOs, seedRiders, seedDeliveryJobs, seedDeliveries, seedWarranties, seedInvoices, seedBulkStock, seedRepairs, seedSOPs, seedSopActuals, seedRefSOPs, seedExpenses, seedOutsourceVendors, seedOutsourceJobs, seedOutsourcePayments } from './store/initial-state'
import { DEFAULT_BANK_ACCOUNTS, DEFAULT_COMPANY_SETTINGS } from './store/initial-state'
import { canApproveInventoryAction, canValidatePurchaseReceiptAction, canManageInventoryControl, canApprovePayroll, canManageHRAssets, canManageFinance, canManageFullFinanceAction, canCreateCustomerInvoiceFromSOAction, canManageProcurement } from './store/permissions'
import { canManageHR } from './store/permissions'
import { _pendingSync, _inFlightSyncKeys, isServerHydrated, markServerHydrated, emitSyncStatus, getDirtyKeys, addDirtyKey, removeDirtyKeys, rememberSaleOrdersSnapshot, flushServerSync, compressProfileImage, useLS, sync } from './store/sync'
import { SESSION_AUDIT_LOG_LIMIT, RETIRED_LOCAL_KEYS, evictRetiredLocalKeys } from './store/sync'
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

export const LOCATIONS: Record<LocationId, { name: string; icon: string; color: string }> = {
  warehouse:         { name: 'Warehouse (Main)',  icon: '🏭', color: '#875BF7' },
  shop:              { name: 'With Issues',        icon: '⚠️',  color: '#F59E0B' },
  repair_unit:       { name: 'Repair Unit',       icon: '🔧', color: '#F04438' },
  computer_aid:      { name: 'Computer Aid',      icon: '🤝', color: '#0EA5E9' },
  computer_aid_collected: { name: 'Computer Aid — Collected', icon: '✅', color: '#12B76A' },
  computer_aid_issues: { name: 'Computer Aid — With Issues', icon: '⚠️', color: '#F79009' },
  vendor:            { name: 'Vendor',            icon: '🚚', color: '#F79009' },
  customer:          { name: 'Customer',          icon: '👤', color: '#2E90FA' },
  employee:          { name: 'Employee Asset',    icon: '🧑', color: '#7F56D9' },
  pending_testing:   { name: 'Inbound — Awaiting tests', icon: '🧪', color: '#0EA5E9' },
  quarantine:        { name: 'Inbound — Rejected', icon: '🚫', color: '#DC2626' },
}
export { PRODUCT_KIND_OPTIONS, UOM_OPTIONS, inferProductKind, defaultTrackingForKind, defaultUnitForKind, kindRequiresInventoryAccounts } from '@/lib/product-kind'
export {
  resolveProductAccounts,
  applyCategoryAccountDefaults
} from '@/lib/product-accounts'

// ── In-app Notifications ──────────────────────────────────────────────────────
export type {
  AppNotification
} from '@/lib/in-app-notifications'

// Comprehensive Repair Status Flow
const REPAIR_TERMINAL_STATUSES: RepairStatus[] = ['closed', 'cancelled', 'declined', 'unrepairable', 'returned', 'retained']

const normalizeProductIdentity = (value: unknown) => String(value ?? '').trim().toLowerCase()

function findProductIdentityDuplicate(products: Product[], product: Partial<Product>, excludeId?: string) {
  const name = normalizeProductIdentity(product.name)
  const sku = normalizeProductIdentity(product.sku)
  const barcode = normalizeProductIdentity(product.barcode)
  const allowSharedName = !!(product as Partial<Product> & { parentId?: string }).parentId
  return products.find(existing => {
    if (excludeId && existing.id === excludeId) return false
    return (
      (!allowSharedName && !!name && normalizeProductIdentity(existing.name) === name) ||
      (!!sku && normalizeProductIdentity(existing.sku) === sku) ||
      (!!barcode && normalizeProductIdentity(existing.barcode) === barcode)
    )
  })
}

function productCreateLockKey(product: Partial<Product>) {
  return [
    normalizeProductIdentity(product.name),
    normalizeProductIdentity(product.sku),
    normalizeProductIdentity(product.barcode),
  ].join('|')
}
const addDays = (d: string, n: number) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10) }
const addMonths = (d: string, m: number) => { const dt = new Date(d); dt.setMonth(dt.getMonth() + m); return dt.toISOString().slice(0, 10) }

// Document numbers come from the server (lib/doc-numbers.ts); the per-browser
// counters that lived here repeated across browsers (ADJ/0001, TR/0001…).

/**
 * Ask the server to issue the warranties for machines just sold. It reads the
 * saved sale, so it runs once the save has had time to reach the server, and
 * again a little later in case it had not. Safe to repeat.
 */
let warrantySyncTimers: ReturnType<typeof setTimeout>[] = []
/** Hand warranties the server just issued to open screens (merged by id). */
export function announceIssuedWarranties(out: { added?: unknown[] } | null | undefined) {
  if (typeof window === 'undefined' || !Array.isArray(out?.added) || !out.added.length) return
  window.dispatchEvent(new CustomEvent('deed:warranties-issued', { detail: out.added }))
}
function requestWarrantySync() {
  if (typeof window === 'undefined') return
  warrantySyncTimers.forEach(clearTimeout)
  const run = () => { void fetch('/api/warranties/sync', { method: 'POST' }).then(r => r.json()).then(announceIssuedWarranties).catch(() => {}) }
  warrantySyncTimers = [setTimeout(run, 8_000), setTimeout(run, 45_000)]
}

/** Repairs whose invoice is being created right now (see createInvoiceFromRepair). */
const repairInvoiceInFlight = new Map<string, Promise<Invoice | null>>()

/** Allocate a Kilimall order / dispatch / settlement ref from the server-side atomic counter. */
async function fetchNextKilimallRef(kind: 'kilimall_order' | 'kilimall_dispatch' | 'kilimall_settlement'): Promise<string | null> {
  try {
    return await allocateDocNumber(kind)
  } catch {
    return null
  }
}

/** Allocate a delivery-job ref from the server-side atomic counter. */
async function fetchNextDeliveryRef(): Promise<string | null> {
  try {
    return await allocateDocNumber('delivery_job')
  } catch {
    return null
  }
}

// Draft invoices carry a placeholder reference; the official INV/BILL number
// is assigned from the per-year sequence only when the invoice is posted
// (Odoo: posting assigns the official number).
const draftInvoiceRef = (type: InvoiceType) =>
  `DRAFT/${type === 'vendor_bill' ? 'BILL' : 'INV'}/${uid().slice(0, 8).toUpperCase()}`
const isDraftInvoiceRef = (ref: string | undefined) => Boolean(ref?.startsWith('DRAFT/'))

const calcSO = (lines: SaleOrderLine[]) => {
  const sub = lines.reduce((a, l) => a + l.subtotal, 0)
  const tax = lines.reduce((a, l) => a + Math.round(l.subtotal * l.taxRate / 100), 0)
  return { subtotal: sub, taxTotal: tax, total: sub + tax }
}
const calcPO = (lines: POLine[]) => {
  const sub = lines.reduce((a, l) => a + l.subtotal, 0)
  const tax = lines.reduce((a, l) => a + Math.round(l.subtotal * l.taxRate / 100), 0)
  return { subtotal: sub, taxTotal: tax, total: sub + tax }
}

const calcStockByLocation = _calcStockByLocation
const upsertBulkStock = _upsertBulkStock

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

const DATA_VERSION = 'v4'

/**
 * Save a newly created invoice/bill to the invoices table and TELL the user if
 * it does not land. This used to be fire-and-forget `sync`, so a failed save
 * left a posted bill that existed only on screen (and was later dropped by the
 * list rebuild). Retries only when no response arrived or the gateway failed
 * (502/503/504); on a retry a "already exists" answer counts as success.
 */
const saveInvoiceToServer = async (
  invoice: unknown,
  onFailure: (message: string) => void,
): Promise<boolean> => {
  const ref = String((invoice as { ref?: unknown })?.ref ?? 'document')
  const delays = [0, 1500, 4000]
  let lastError = ''
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    try {
      const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })
      if (res.ok) return true
      const payload = await res.json().catch(() => null) as { error?: string } | null
      lastError = payload?.error || `server returned ${res.status}`
      if (attempt > 0 && (res.status === 409 || /already exists|unique/i.test(lastError))) return true
      if (![502, 503, 504].includes(res.status)) break
    } catch {
      lastError = 'no connection to the server'
    }
  }
  onFailure(`${ref} was NOT saved to the server (${lastError}). Do not close this tab; tell Finance so it can be re-saved.`)
  return false
}

/**
 * A write whose failure the user is told about.
 *
 * `sync` above discards everything — it does not even read res.ok — so a 403,
 * a 404 or a 500 looks exactly like success and the caller's toast still says
 * "saved". Use this wherever the user is being told their change was stored.
 */
const syncOrWarn = (
  url: string,
  opts: RequestInit,
  onFailure: (message: string) => void,
  fallbackMessage: string,
) => {
  void fetch(url, opts)
    .then(async res => {
      if (res.ok) return
      const payload = await res.json().catch(() => null) as { error?: string } | null
      onFailure(payload?.error || fallbackMessage)
    })
    .catch(() => onFailure(fallbackMessage))
}

/**
 * Post a journal this action built into journal_entries.
 *
 * These flows had no server endpoint of their own, so the only thing putting
 * their entries in the ledger was the blob mirror replaying
 * deed_journalEntries — which made the blob load-bearing for the Trial
 * Balance, the P&L and the Balance Sheet. The route dedupes on ref, so the
 * local copy and this post describe the same entry rather than two.
 */
type SystemJournalKind =
  | 'fixed_asset'
  | 'pos_session'
  | 'rma_refund'
  | 'buyback_credit'
  | 'sale_order_credit_note'
  | 'invoice_adjustment'

const postSystemJournal = (
  kind: SystemJournalKind,
  journal: JournalEntry,
  onFailure: (message: string) => void,
) => {
  syncOrWarn('/api/accounting/system-journals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      id: journal.id,
      ref: journal.ref,
      date: journal.date,
      description: journal.description,
      invoiceId: (journal as JournalEntry & { invoiceId?: string }).invoiceId,
      lines: journal.lines.map(l => ({
        account: l.account,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    }),
  }, onFailure, `${journal.ref} was not posted to the ledger — please retry`)
}

/** Save a holdover (holdovers table). Resolves to the saved record, or an error message. */
async function saveHoldoverToServer(method: 'POST' | 'PATCH', url: string, body: Partial<Holdover>): Promise<Holdover | string> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.id) return data as Holdover
    return String(data?.error ?? `server returned ${res.status}`)
  } catch {
    return 'check your connection and try again'
  }
}

/** Save an account to the chart (account_codes). Resolves to an error message, or null when saved. */
async function saveAccountToServer(method: 'POST' | 'PUT', url: string, account: Account): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    })
    if (res.ok) return null
    const data = await res.json().catch(() => null)
    return String(data?.error ?? `server returned ${res.status}`)
  } catch {
    return 'check your connection and try again'
  }
}

async function patchSaleOrderPersist(
  id: string,
  order: Record<string, unknown>,
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/sale-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saleOrderPersistBody(order)),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, error: String(data?.error ?? `Could not save quotation (${res.status})`) }
    }
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'Could not save quotation — check your connection and try again' }
  }
}

/** Apply a draft quotation line edit locally and block stale remote sync. */
function applyLocalDraftSaleOrder(
  soRef: React.MutableRefObject<SaleOrder[]>,
  setSaleOrders: React.Dispatch<React.SetStateAction<SaleOrder[]>>,
  orderId: string,
  updated: SaleOrder,
) {
  markSaleOrderDraftEdit(orderId)
  soRef.current = soRef.current.map(s => (s.id === orderId ? updated : s))
  setSaleOrders(prev => {
    const next = prev.map(s => (s.id === orderId ? updated : s))
    try {
      const serialized = JSON.stringify(next)
      rememberSaleOrdersSnapshot(serialized)
      _pendingSync['deed_saleOrders'] = serialized
      addDirtyKey('deed_saleOrders')
      if (typeof window !== 'undefined') {
        persistClientStoreValue('deed_saleOrders', serialized)
      }
    } catch { /* ignore quota / circular */ }
    return next
  })
}

/**
 * Merge Prisma PATCH response into local SO state.
 * Only lockVersion (+ optional lines/totals) — never wholesale-replace the row,
 * or a slower notes keystroke response can clobber a newer local edit.
 */
function applySaleOrderPersistResult(
  setSaleOrders: React.Dispatch<React.SetStateAction<SaleOrder[]>>,
  soRef: React.MutableRefObject<SaleOrder[]>,
  id: string,
  data: any,
  opts?: { syncLines?: boolean; expectedLinesFingerprint?: string },
) {
  if (!data || typeof data !== 'object') return
  const [normalized] = normalizeSaleOrdersForClient([data]) as SaleOrder[]
  if (!normalized) return
  setSaleOrders(cur => {
    const next = cur.map(s => {
      if (s.id !== id) return s
      const withLock = {
        ...s,
        lockVersion: normalized.lockVersion ?? s.lockVersion,
      }
      if (!opts?.syncLines || !Array.isArray(normalized.lines)) return withLock
      // A slower PATCH must not restore products the user already removed.
      if (
        opts.expectedLinesFingerprint
        && saleOrderLinesFingerprint(s.lines) !== opts.expectedLinesFingerprint
      ) {
        return withLock
      }
      return {
        ...withLock,
        lines: normalized.lines,
        subtotal: normalized.subtotal ?? s.subtotal,
        taxTotal: normalized.taxTotal ?? s.taxTotal,
        total: normalized.total ?? s.total,
        discountAmount: normalized.discountAmount ?? s.discountAmount,
      }
    })
    soRef.current = next
    return next
  })
}

/** Prevents concurrent confirmSO races from creating duplicate waiting DNs. */
const confirmingSaleOrderIds = new Set<string>()

function StoreProvider({
  children,
  initialUser = null,
  initialUsers = [],
  initialModule,
  serverState,
}: {
  children: ReactNode
  initialUser?: User | null
  initialUsers?: User[]
  initialModule?: ModuleId
  serverState?: Record<string, unknown>
}) {
  // Keep local ERP data through deploys. The server snapshot below is the
  // authority and will update changed keys without making modules appear empty
  // during a data-version bump.
  if (typeof window !== 'undefined') {
    try {
      if (localStorage.getItem('deed_data_version') !== DATA_VERSION) {
        localStorage.setItem('deed_data_version', DATA_VERSION)
      }
    } catch {
      // Private mode / blocked storage must not crash the root shell.
    }
  }

  // Real-time sync via Server-Sent Events (replaces 3-second polling)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const arrayCount = (serialized: string | null): number | null => {
      if (!serialized) return null
      try {
        const parsed = JSON.parse(serialized)
        return Array.isArray(parsed) ? parsed.length : null
      } catch {
        return null
      }
    }

    const arrayIds = (serialized: string | null): Set<string> | null => {
      if (!serialized) return null
      try {
        const parsed = JSON.parse(serialized)
        if (!Array.isArray(parsed)) return null
        return new Set(
          parsed
            .map((row: { id?: unknown }) => (row?.id != null ? String(row.id) : ''))
            .filter(Boolean),
        )
      } catch {
        return null
      }
    }

    /** Prefer remote rows on id conflict; keep any local-only rows. */
    const mergeArrayById = (localStr: string | null, remoteStr: string): string => {
      let localArr: Array<{ id?: unknown }> = []
      let remoteArr: Array<{ id?: unknown }> = []
      try { localArr = localStr ? JSON.parse(localStr) : [] } catch { localArr = [] }
      try { remoteArr = JSON.parse(remoteStr) } catch { return remoteStr }
      if (!Array.isArray(localArr)) localArr = []
      if (!Array.isArray(remoteArr)) return remoteStr
      const remoteIds = new Set(
        remoteArr.map(row => (row?.id != null ? String(row.id) : '')).filter(Boolean),
      )
      const merged = [
        ...remoteArr.filter(row => row?.id != null),
        ...localArr.filter(row => row?.id != null && !remoteIds.has(String(row.id))),
      ]
      return JSON.stringify(merged)
    }

    const remoteHasMissingIds = (localStr: string | null, remoteStr: string): boolean => {
      const remoteIds = arrayIds(remoteStr)
      if (!remoteIds || remoteIds.size === 0) return false
      const localIds = arrayIds(localStr)
      if (!localIds || localIds.size === 0) return true
      for (const id of remoteIds) {
        if (!localIds.has(id)) return true
      }
      return false
    }

    const CRITICAL_VISIBILITY_KEYS = [
      'deed_repairs_v2',
      'deed_invoices',
      'deed_expenses',
      'deed_outsourceJobs',
      'deed_outsourcePayments',
      'deed_outsourceVendors',
    ] as const
    const CRITICAL_VISIBILITY_KEY_SET = new Set<string>(CRITICAL_VISIBILITY_KEYS)

    // Publish a key to the running app. The localStorage write is a cache and
    // is allowed to fail — the event carries the value, so the in-memory store
    // updates either way. Dropping the event when the cache is full is what
    // made a full quota look like "the ERP stopped seeing new records".
    const publishRemoteKey = (key: string, value: string) => {
      safeLocalStorageSet(key, value)
      window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key, value } }))
    }

    // Reclaim space from keys the browser no longer keeps, before any
    // hydration writes compete for the same quota.
    evictRetiredLocalKeys()
    removeDirtyKeys(RETIRED_LOCAL_KEYS)

    // Recovery pass: if browser cache is empty OR missing rows the server has
    // (common after creating an outsource job on another tab/device), pull/merge
    // server truth so Jobs lists stay complete.
    const reconcileCriticalVisibilityKeys = async () => {
      // One batched GET instead of 5 sequential /api/store/<key> round-trips.
      try {
        const path = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
        // Route hydration already replaces every clean key with the server
        // copy; only keys with unsaved local edits (which hydration skips)
        // need this merge. Fetching all of them duplicated the page's largest
        // downloads on every load.
        const dirty = getDirtyKeys()
        const needed = CRITICAL_VISIBILITY_KEYS.filter(key => appStateKeysForRoute(path).includes(key) && dirty.has(key))
        if (!needed.length) return
        const res = await fetch(`/api/store?keys=${encodeURIComponent(needed.join(','))}`)
        if (!res.ok) return
        const state = await res.json().catch(() => null) as Record<string, unknown> | null
        if (!state || typeof state !== 'object') return
        for (const key of needed) {
          if (!(key in state)) continue
          try {
            const value = state[key]
            const remoteStr = typeof value === 'string' ? value : JSON.stringify(value ?? null)
            const localStr = window.localStorage.getItem(key)
            const localCount = arrayCount(localStr)
            const remoteCount = arrayCount(remoteStr)
            const missingRemoteRows = remoteHasMissingIds(localStr, remoteStr)
            const shouldRecover = typeof remoteCount === 'number' && remoteCount > 0 && (
              localStr === null
              || localCount === 0
              || missingRemoteRows
              || (typeof localCount === 'number' && remoteCount > localCount)
            )
            if (!shouldRecover) continue
            removeDirtyKeys([key])
            const nextStr = (localStr && typeof localCount === 'number' && localCount > 0 && missingRemoteRows)
              ? mergeArrayById(localStr, remoteStr)
              : remoteStr
            publishRemoteKey(key, nextStr)
          } catch {
            // best effort recovery only
          }
        }
      } catch {
        // best effort recovery only
      }
    }
    void reconcileCriticalVisibilityKeys()

    // 1. Hydrate from serverState immediately on mount.
    //    If there are locally-dirty keys (written while offline with the tab closed),
    //    push them to the server first — then let server state apply normally so the
    //    server remains authoritative after the sync completes.
    if (serverState && Object.keys(serverState).length > 0 && !isServerHydrated()) {
      const dirty = getDirtyKeys()

      // Push any writes that were queued while offline and lost from _pendingSync
      // when the tab closed (they're still in localStorage and marked dirty).
      if (dirty.size > 0) {
        const toSync: Record<string, string> = {}
        dirty.forEach(k => {
          const local = window.localStorage.getItem(k)
          if (local !== null) toSync[k] = local
        })
        if (Object.keys(toSync).length > 0) {
          fetch('/api/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toSync),
          }).then(r => { if (r.ok) removeDirtyKeys(Object.keys(toSync)) }).catch(() => {})
        }
      }

      // Apply server state — skip keys that have local dirty writes not yet confirmed.
      // This prevents server state from overwriting repairs/records created while offline.
      for (const [k, v] of Object.entries(serverState)) {
        try {
          const remoteStr = typeof v === 'string' ? v : JSON.stringify(v)
          const localStr  = window.localStorage.getItem(k)
          if (dirty.has(k)) {
            if (k === 'deed_posOrders') {
              publishRemoteKey(k, mergeDirtyPosOrdersBlob(localStr, remoteStr))
              continue
            }
            const localCount = arrayCount(localStr)
            const remoteCount = arrayCount(remoteStr)
            const missingRemoteRows = CRITICAL_VISIBILITY_KEY_SET.has(k) && remoteHasMissingIds(localStr, remoteStr)
            const shouldRecoverFromStaleEmpty = localCount === 0
              && typeof remoteCount === 'number'
              && remoteCount > 0
              && !(k === 'deed_saleOrders' && hasSaleOrderDraftEdits())
            if (!shouldRecoverFromStaleEmpty && !missingRemoteRows) continue // local unsynced write — server state is stale for this key
            // Recover from stale-empty / incomplete local cache and clear dirty flag.
            removeDirtyKeys([k])
            if (missingRemoteRows && localStr && typeof localCount === 'number' && localCount > 0) {
              publishRemoteKey(k, mergeArrayById(localStr, remoteStr))
              continue
            }
          }
          if (localStr !== remoteStr) {
            publishRemoteKey(k, remoteStr)
          }
        } catch (err) { console.warn(`[store] could not hydrate key ${k}`, err) }
      }
      markServerHydrated()
      emitSyncStatus('idle')
    }

    const applyRemoteState = (remoteState: Record<string, unknown>) => {
      const pendingKeys = new Set(Object.keys(_pendingSync))
      const dirtyKeys   = getDirtyKeys()
      for (const [k, v] of Object.entries(remoteState)) {
        if (!k.startsWith('deed_')) continue
        // Per-key isolation. This loop had no try/catch at all, so one failing
        // key — a quota throw on the largest blob, most often — aborted the
        // whole pass, skipped every remaining key, and escaped into the SSE
        // listener, which killed live updates for the rest of the session.
        try {
        // Skip THIS key when it has an unconfirmed local write — other keys in
        // the same SSE payload still apply. One pending key must not freeze the store.
        const remoteStr = typeof v === 'string' ? v : JSON.stringify(v)
        const local = window.localStorage.getItem(k)
        if (pendingKeys.has(k) || dirtyKeys.has(k) || _inFlightSyncKeys.has(k)) {
          if (k === 'deed_posOrders') {
            publishRemoteKey(k, mergeDirtyPosOrdersBlob(local, remoteStr))
            continue
          }
          const localCount = arrayCount(local)
          const remoteCount = arrayCount(remoteStr)
          const missingRemoteRows = CRITICAL_VISIBILITY_KEY_SET.has(k) && remoteHasMissingIds(local, remoteStr)
          // Draft quote line edits may omit localStorage when the blob is large
          // (>512KB). Never treat that as "stale empty" or SSE restores deleted lines.
          const shouldRecoverFromStaleEmpty = localCount === 0
            && typeof remoteCount === 'number'
            && remoteCount > 0
            && !(k === 'deed_saleOrders' && hasSaleOrderDraftEdits())
          if (!shouldRecoverFromStaleEmpty && !missingRemoteRows) continue
          removeDirtyKeys([k])
          if (missingRemoteRows && local && typeof localCount === 'number' && localCount > 0) {
            publishRemoteKey(k, mergeArrayById(local, remoteStr))
            continue
          }
        }
        if (local !== remoteStr) {
          publishRemoteKey(k, remoteStr)
        }
        } catch (err) {
          console.warn(`[store] could not apply remote key ${k}`, err)
        }
      }
    }

    // Conditional requests keep outage recovery cheap, and the in-flight map
    // prevents focus/visibility events from starting duplicate downloads.
    const storeEtags = new Map<string, string>()
    const storeFetchesInFlight = new Map<string, Promise<void>>()
    const fetchStoreKeys = async (keys: string[], changedAt?: Record<string, string>): Promise<void> => {
      let deedKeys = [...new Set(keys.filter(key => key.startsWith('deed_')))].sort()
      if (!deedKeys.length) return
      // A change notice for a copy we downloaded after that change is
      // already satisfied (the stream replays the last minute on connect).
      if (changedAt) {
        noteStoreChanges(changedAt)
        await awaitRouteHydration(deedKeys)
        await awaitStoreDownloads(deedKeys)
        deedKeys = keysChangedSinceRead(deedKeys, changedAt)
        if (!deedKeys.length) return
      }
      const keySet = deedKeys.join(',')
      const existing = storeFetchesInFlight.get(keySet)
      if (existing) return existing

      const request = (async () => {
        try {
          const etag = storeEtags.get(keySet)
          const res = await fetch(`/api/store?keys=${encodeURIComponent(keySet)}`, {
            headers: etag ? { 'If-None-Match': etag } : undefined,
          })
          if (res.status === 304) {
            noteStoreRead(deedKeys, res.headers.get('x-store-read-at'))
            return
          }
          if (!res.ok) return
          const nextEtag = res.headers.get('etag')
          if (nextEtag) storeEtags.set(keySet, nextEtag)
          const payload = await res.json().catch(() => null) as Record<string, unknown> | null
          if (payload && typeof payload === 'object') applyRemoteState(payload)
          noteStoreRead(deedKeys, res.headers.get('x-store-read-at'))
        } catch {
          // best effort — SSE reconnect / backup poll will retry
        }
      })().finally(() => {
        storeFetchesInFlight.delete(keySet)
      })
      storeFetchesInFlight.set(keySet, request)
      return trackStoreDownload(deedKeys, request)
    }

    // 2. SSE stream for real-time store updates — reconnect with backoff so a
    //    dropped socket cannot freeze every key behind one pending EventSource.
    let sseRetryMs = 1000
    let sseTimer: ReturnType<typeof setTimeout> | null = null
    let helloTimer: ReturnType<typeof setTimeout> | null = null
    let source: EventSource | null = null
    let sseClosed = false
    let stopBackupPoll: (() => void) | null = null

    const ensureBackupPoll = (enabled: boolean) => {
      if (enabled) {
        if (stopBackupPoll) return
        stopBackupPoll = startVisiblePoll(
          () => {
            const path = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
            const needed = CRITICAL_VISIBILITY_KEYS.filter(key => appStateKeysForRoute(path).includes(key))
            void fetchStoreKeys(needed)
          },
          STORE_NOTIFY_BACKUP_POLL_MS,
        )
        return
      }
      stopBackupPoll?.()
      stopBackupPoll = null
    }

    const connectSse = () => {
      if (sseClosed) return
      try { source?.close() } catch { /* already closed */ }
      if (helloTimer) {
        clearTimeout(helloTimer)
        helloTimer = null
      }
      let heardHello = false
      const watchedKeys = appStateKeysForRoute(
        typeof window !== 'undefined' ? (window.location.pathname || '/') : '/',
      ).join(',')
      source = new EventSource(
        watchedKeys
          ? `/api/store/stream?keys=${encodeURIComponent(watchedKeys)}`
          : '/api/store/stream',
      )
      source.addEventListener('hello', () => {
        heardHello = true
        if (helloTimer) {
          clearTimeout(helloTimer)
          helloTimer = null
        }
        // liveNotify=false is not a broken stream: the server route already
        // falls back to a cursor-based change poll and emits only changed keys.
        ensureBackupPoll(false)
      })
      source.addEventListener('store', (e: Event) => {
        const { state, invalidated, changedAt } = parseStoreSseData((e as MessageEvent).data)
        if (state) applyRemoteState(state)
        if (invalidated.length) {
          const path = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
          const needed = new Set(appStateKeysForRoute(path))
          void fetchStoreKeys(invalidated.filter(key => needed.has(key)), changedAt)
        }
      })
      source.onopen = () => {
        sseRetryMs = 1000
        // Stop full-state recovery as soon as the event transport reconnects.
        // The grace timer turns it back on if no protocol hello arrives.
        ensureBackupPoll(false)
        if (helloTimer) clearTimeout(helloTimer)
        helloTimer = setTimeout(() => {
          if (!heardHello) ensureBackupPoll(true)
        }, STORE_HELLO_GRACE_MS)
      }
      source.onerror = () => {
        try { source?.close() } catch { /* ignore */ }
        source = null
        if (helloTimer) {
          clearTimeout(helloTimer)
          helloTimer = null
        }
        ensureBackupPoll(true)
        if (sseClosed) return
        const wait = sseRetryMs
        sseRetryMs = nextSseRetryMs(sseRetryMs)
        sseTimer = setTimeout(connectSse, wait)
      }
    }
    connectSse()

    let lastStreamKeys = appStateKeysForRoute(
      typeof window !== 'undefined' ? (window.location.pathname || '/') : '/',
    ).join(',')
    const onStreamRoute = (e: Event) => {
      const nextPath = (e as CustomEvent).detail?.pathname
      if (typeof nextPath !== 'string') return
      const nextKeys = appStateKeysForRoute(nextPath).join(',')
      if (nextKeys === lastStreamKeys) return
      lastStreamKeys = nextKeys
      connectSse()
    }
    window.addEventListener('deed_route_change', onStreamRoute as EventListener)

    // 2b. When the network comes back, immediately flush any queued writes so data
    //     reaches the server without waiting for the next user interaction.
    const handleOnline = () => void flushServerSync()
    window.addEventListener('online', handleOnline)

    // 3. Sync users list (stored in DB, not app_state) — much less frequent.
    // Only user-account managers may GET /api/users. Everyone else gets
    // colleagues' names from /api/staff, and /api/technicians adds the
    // repair picker details for those who assign repairs.
    // A role that is refused once is refused every minute after: stop asking.
    // These refusals were ~560 of the server's error responses.
    let usersForbidden = false
    let techniciansForbidden = false
    const syncUsers = async () => {
      try {
        const res = usersForbidden ? null : await fetch('/api/users')
        if (res?.status === 403) usersForbidden = true
        if (res?.ok) {
          const data = await res.json()
          const fetched = Array.isArray(data) ? data : (Array.isArray(data.users) ? data.users : null)
          if (fetched) {
            setUsers(prev => JSON.stringify(prev) !== JSON.stringify(fetched)
              ? fetched.map((u: any) => ({ ...u, modules: Array.isArray(u.modules) ? [...u.modules] : [] }))
              : prev)
            return
          }
        }
        const staffRes = await fetch('/api/staff')
        if (staffRes.ok) {
          const staff = ((await staffRes.json())?.staff ?? []) as Array<Record<string, unknown>>
          setUsers(prev => mergeAssignableTechniciansIntoUsers(prev, staff.map((u: any) => ({
            ...u,
            username: u.username || u.id,
            createdAt: u.createdAt || '',
          }))).map(u => Array.isArray(u.modules) ? u : { ...u, modules: [] }))
        }
        if (techniciansForbidden) return
        const techRes = await fetch('/api/technicians')
        if (techRes.status === 403) techniciansForbidden = true
        if (!techRes.ok) return
        const techData = await techRes.json()
        const technicians = Array.isArray(techData?.technicians) ? techData.technicians : []
        if (!technicians.length) return
        setUsers(prev => mergeAssignableTechniciansIntoUsers(
          prev,
          technicians.map((u: any) => ({
            ...u,
            username: u.username || u.id,
            createdAt: u.createdAt || '',
            active: u.active !== false,
            modules: Array.isArray(u.modules) ? [...u.modules] : [],
          })),
        ))
      } catch {}
    }
    syncUsers()
    const usersId = setInterval(syncUsers, 60_000) // Users change rarely — sync every minute

    return () => {
      sseClosed = true
      if (sseTimer) clearTimeout(sseTimer)
      if (helloTimer) clearTimeout(helloTimer)
      stopBackupPoll?.()
      try { source?.close() } catch { /* already closed */ }
      clearInterval(usersId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('deed_route_change', onStreamRoute as EventListener)
    }
  }, [])

  const [activeModule, setActiveModule] = useState<ModuleId>(() => {
    // Prefer explicitly passed initialModule (e.g. SSR), then localStorage, then default
    if (initialModule) return initialModule
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('activeModule') as ModuleId | null
      if (saved && initialUser && userHasModuleAccess(initialUser, saved)) return saved
    }
    return getFirstAllowedModule(initialUser)
  })
  // Always start open (matches SSR); correct to actual viewport width after hydration
  const [sidebarOpen, setSidebarOpen] = useState(true)
  useEffect(() => { setSidebarOpen(window.innerWidth >= 1024) }, [])
  const [toast, setToast] = useState<AppState['toast']>(null)

  // Legacy & CRM
  const [contacts, setContacts] = useLS<Contact[]>('deed_contacts', seedContacts)
  const [companiesRaw, setCompanies] = useLS<Company[]>('deed_companies', seedCompanies)
  // Server rows arrive in the Prisma `clients` shape (no status, string
  // creditLimit) via boot fetch, app_state sync, or old localStorage snapshots.
  // Normalize once here so every consumer sees a well-formed Company.
  const companies = useMemo(() => normalizeCompaniesForClient(companiesRaw) as Company[], [companiesRaw])
  // Derived, not stored. A contact person is an individual contact with an
  // employer, so the directory is the only place either concept lives now.
  // Keeping the ContactPerson shape means every CRM call site — opportunity
  // and contract pickers, LeadScore, the detail panels — works unchanged.
  const contactPersons = useMemo(
    () => deriveContactPersons(
      contacts,
      id => contacts.find(c => c.id === id)?.name,
    ) as unknown as ContactPerson[],
    [contacts],
  )
  const [opportunities, setOpportunities] = useLS<Opportunity[]>('deed_opportunities', seedOpportunities)
  const [opportunityActivities, setOpportunityActivities] = useLS<OpportunityActivity[]>('deed_oppActivities', seedOpportunityActivities)
  const [quotes, setQuotes] = useLS<Quote[]>('deed_quotes', seedQuotes)
  
  // Products & Inventory — merge SSE/cross-tab writes instead of replacing the
  // list. A hard replace + immediate Prisma re-merge was flashing the catalog
  // (and wiping in-progress search results) on every stock/sync push.
  const [products, setProducts] = useLS('deed_products', seedProducts, {
    mergeRemote: (local, remote) => mergeProductsRemoteState(local as any[], remote as any[]) as typeof local,
  })
  const [productPriceHistory, setProductPriceHistory] = useLS<ProductPriceHistory[]>('deed_productPriceHistory', [])

  // The relational catalog (/api/products) is the source of truth for product
  // identity and commercial fields. Boot merge uses the lite endpoint (no serials).
  const productsNowRef = useRef(products)
  productsNowRef.current = products
  const refreshProductCatalog = useCallback(async () => {
    try {
      const rows = await useInventoryDomainStore.getState().refreshProducts()
      if (!Array.isArray(rows) || rows.length === 0) return 0
      // Merge into the server's product list, not the browser's start-up copy:
      // merged before that list arrived, every product looked new and the
      // whole catalog was uploaded on each page load.
      await awaitRouteHydration(['deed_products'])
      await awaitStoreDownloads(['deed_products'])
      const mergeInto = (prev: typeof products) => {
        const merged = mergeCatalogProducts(prev, rows, CATEGORY_CONFIG, { preserveClientOrder: true }) as any[]
        const healed = merged.map(p => {
          if (!isSerialOnlyCategory(p.category)) return p
          if (p.trackingMethod === 'SERIAL' && p.requiresSerial) return p
          return { ...p, trackingMethod: 'SERIAL' as TrackingMethod, requiresSerial: true }
        })
        // Same data with keys in another order, or only leaving out fields the
        // server keeps anyway, is not a change: saving it re-uploaded every
        // product on every page load.
        return keepContainedRows(prev as any[], healed) as typeof prev
      }
      const before = productsNowRef.current
      const next = mergeInto(before)
      if (next === before) return rows.length
      // The merged list is the server's own catalog: when this browser has no
      // unsaved product edits, it is what the server holds — not an edit to
      // upload. (A later edit is still saved, diffed against it.)
      const key = 'deed_products'
      if (!_pendingSync[key] && !_inFlightSyncKeys.has(key) && !getDirtyKeys().has(key)) {
        try { rememberServerBaseline(key, JSON.stringify(next)) } catch { /* the save path diffs as before */ }
      }
      setProducts(current => (current === before ? next : mergeInto(current)))
      return rows.length
    } catch {
      return 0
    }
  }, [setProducts])

  useEffect(() => {
    // mergeRemote already protects against stale shorter blobs. Only re-pull
    // Prisma when a remote payload looks empty/corrupt — not on every stock sync.
    let timer: ReturnType<typeof setTimeout> | null = null
    const onRemote = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key !== 'deed_products') return
      let remote: unknown
      try {
        remote = typeof detail.value === 'string' ? JSON.parse(detail.value) : detail.value
      } catch {
        return
      }
      if (Array.isArray(remote) && remote.length > 0) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => refreshProductCatalog(), 400)
    }
    window.addEventListener('deed_remote_update', onRemote as EventListener)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('deed_remote_update', onRemote as EventListener)
    }
  }, [refreshProductCatalog])
  
  const [serials, setSerials] = useLS<SerialNumber[]>('deed_serials', seedSerials)
  
  // Sales & Invoicing
  const [saleOrders, setSaleOrders] = useLS<SaleOrder[]>('deed_saleOrders', seedSOs, {
    mergeRemote: (local, remote) =>
      mergeSaleOrdersPreservingDraftEdits(local as SaleOrder[], remote as SaleOrder[]) as SaleOrder[],
  })

  const [deliveries, setDeliveries] = useLS<Delivery[]>('deed_deliveries', seedDeliveries)

  const [invoices, setInvoices] = useLS<Invoice[]>('deed_invoices', seedInvoices)

  const [payments, setPayments] = useLS<Payment[]>('deed_payments', [])
  const [customerCredits, setCustomerCredits] = useLS<CustomerCredit[]>('deed_customerCredits', [])

  // Purchasing
  const [purchaseOrders, setPurchaseOrders] = useLS<PurchaseOrder[]>('deed_purchaseOrders', seedPOs)
  const [receipts, setReceipts] = useLS<Receipt[]>('deed_receipts', seedReceipts)

  const [stockTransfers, setStockTransfers] = useLS('deed_stockTransfers', seedTransfers)
  const [purchaseReturns, setPurchaseReturns] = useLS<PurchaseReturn[]>('deed_purchaseReturns', [])
  const [refurbishmentJobs, setRefurbishmentJobs] = useLS<RefurbishmentJob[]>('deed_refurbishmentJobs', seedRefurbishmentJobs)

  // Repairs
  const [repairs, setRepairs] = useLS<RepairOrder[]>('deed_repairs_v2', seedRepairs)

  // HR — employees, departments, leave, hrDocuments, recruitment, and training have
  // moved to hooks/useHrStore.ts (Zustand). `employees` is still read locally below
  // (via empRef) because payroll/asset actions that stay in this file need it.
  const [contracts, setContracts]       = useLS('deed_contracts', seedContracts)
  const [customerContracts, setCustomerContracts] = useLS('deed_customerContracts', seedCustomerContracts)
  const [workflowApprovals, setWorkflowApprovals] = useLS('deed_workflowApprovals', seedWorkflowApprovals)
  const [employeeAssetAssignments, setEmployeeAssetAssignments] = useLS('deed_employeeAssets', seedEmployeeAssetAssignments)

  const employees = useHrDomainStore(s => s.employees)

  // Sensitive: never stored in localStorage/app_state — fetched only for privileged roles
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>(seedPayrollRuns)
  const [payslips, setPayslips] = useState<Payslip[]>(seedPayslips)
  // Salary advances are relational (Prisma) — fetched from the dedicated API,
  // scoped server-side (HR/finance see all; an employee sees only their own).
  const [salaryAdvances, setSalaryAdvances] = useState<SalaryAdvance[]>([])

  // Accounting
  const [journalEntries, setJournalEntries] = useLS('deed_journalEntries', seedJournalEntries)
  const [accounts, setAccounts]             = useLS('deed_accounts', seedAccounts)
  const [bankAccounts, setBankAccountsState] = useLS<BankAccount[]>('deed_bankAccounts', DEFAULT_BANK_ACCOUNTS)
  const [documentPaymentDetails, setDocumentPaymentDetailsState] = useLS<DocumentPaymentDetailsMap>(
    'deed_documentPaymentDetails',
    {},
  )
  const [companySettings, setCompanySettings] = useLS<CompanySettings>('deed_companySettings', DEFAULT_COMPANY_SETTINGS)
  const [systemSettings, setSystemSettings] = useLS<SystemSettings>('deed_systemSettings', DEFAULT_SYSTEM_SETTINGS)

  // Replace the temporary Odoo demo palette shipped by the first layout pass.
  // Preserve any genuinely custom colours selected later.
  useEffect(() => {
    const primary = String(companySettings.printPrimaryColor || '').toUpperCase()
    const secondary = String(companySettings.printSecondaryColor || '').toUpperCase()
    const hasOdooDemoPalette = (!primary || primary === '#714B67') && (!secondary || secondary === '#017E84')
    if (hasOdooDemoPalette) {
      setCompanySettings(previous => ({
        ...previous,
        printPrimaryColor: '#1B2762',
        printSecondaryColor: '#00AEEF',
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [dbApprovalRules, setDbApprovalRules] = useState<Array<{ approvalType: string; thresholds: { maxValue: number; requiredRoles: string[] }[]; isActive: boolean }>>([])
  // One-time bump: previous default was 100_000 with no settings UI; raise stored value to 1_000_000.
  useEffect(() => {
    if (systemSettings.accAdminOfficerInvoiceLimitKes === 100000) {
      setSystemSettings(prev => ({ ...prev, accAdminOfficerInvoiceLimitKes: 1000000 }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // High-value PO director approval was removed; clear stored tenants that still have it on.
  useEffect(() => {
    if (systemSettings.purRequireApprovalHighValue) {
      setSystemSettings(prev => ({ ...prev, purRequireApprovalHighValue: false }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-time: rewrite legacy diagnosis fee tiers (1,500 / 2,500) to flat KES 1,000.
  useEffect(() => {
    if (needsDiagnosisFeeSettingsMigration(systemSettings)) {
      setSystemSettings(prev => ({ ...prev, ...migratedDiagnosisFeeSettings(prev) }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ensure margin policy always has spreadsheet defaults when missing/partial.
  useEffect(() => {
    const normalized = normalizePricingMarginPolicy(systemSettings.pricingMarginPolicy)
    const prev = systemSettings.pricingMarginPolicy
    if (!prev || JSON.stringify(prev) !== JSON.stringify(normalized)) {
      setSystemSettings(p => ({ ...p, pricingMarginPolicy: normalized }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-time: rewrite unpaid open repairs still stamped with legacy 1,500 / 2,500.
  useEffect(() => {
    setRepairs(prev => {
      let changed = false
      const next = prev.map(r => {
        const status = String(r.diagnosisFeeStatus ?? '')
        if (status === 'paid' || status === 'invoiced' || status === 'waived') return r
        const stored = Number(r.diagnosisFee)
        if (stored !== 1500 && stored !== 2500) return r
        const amount = normalizeStoredDiagnosisFee(r, systemSettings)
        const resolved = resolveDiagnosisFee(r, systemSettings)
        changed = true
        return {
          ...r,
          diagnosisFee: amount,
          diagnosisFeeStatus: resolved.status === 'applicable' ? 'applicable' : resolved.status === 'not_applicable' ? 'not_applicable' : r.diagnosisFeeStatus,
        }
      })
      return changed ? next : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [bankRecons, setBankRecons]           = useLS<BankRecon[]>('deed_bankRecons', [])
  const [bankStatementLines, setBankStatementLines] = useLS<BankStatementLine[]>('deed_bankStatementLines', [])

  // Kilimall
  const [kilimallOrders, setKilimallOrders]         = useLS<KilimallOrder[]>('deed_kilimallOrders', [])
  const [kilimallDispatches, setKilimallDispatches] = useLS<KilimallDispatch[]>('deed_kilimallDispatches', [])
  const [kilimallSettlements, setKilimallSettlements] = useLS<KilimallSettlement[]>('deed_kilimallSettlements', [])

  // Returns / RMA
  const [returnOrders, setReturnOrders] = useLS<ReturnOrder[]>('deed_returnOrders', [])
  const [refundPayments, setRefundPayments] = useLS<RefundPayment[]>('deed_refundPayments', [])

  // Buy-backs / Donations / Exchanges
  const [buyBacks, setBuyBacks]           = useLS<BuyBack[]>('deed_buyBacks', [])
  const [donations, setDonations]         = useLS<Donation[]>('deed_donations', [])
  const [clientExchanges, setClientExchanges] = useLS<ClientExchange[]>('deed_clientExchanges', [])

  // Inventory
  const [warranties, setWarranties]         = useLS('deed_warranties', seedWarranties)
  useEffect(() => {
    const onIssued = (e: Event) => {
      const rows = (e as CustomEvent<Warranty[]>).detail ?? []
      setWarranties(prev => {
        const have = new Set(prev.map(w => w.id))
        const fresh = rows.filter(w => w && !have.has(w.id))
        return fresh.length ? [...prev, ...fresh] : prev
      })
    }
    window.addEventListener('deed:warranties-issued', onIssued)
    return () => window.removeEventListener('deed:warranties-issued', onIssued)
  }, [setWarranties])
  const [bulkStock, setBulkStock]           = useLS<BulkStockLevel[]>('deed_bulkStock', seedBulkStock)
  const [openingStockPosted, setOpeningStockPosted] = useLS<boolean>('deed_openingStockPosted', false)
  
  const [stockMoves, setStockMoves] = useLS<StockMove[]>('deed_stockMoves', [], {
    mergeRemote: (local, remote) => mergeCollectionById(local as StockMove[], remote as StockMove[]),
  })

  // Heal lock when OPENING moves already exist (ops seed / missed flag sync).
  const openingStockLocked = isOpeningStockLocked(openingStockPosted, stockMoves)
  useEffect(() => {
    if (!openingStockPosted && stockMoves.some(isOpeningStockMove)) {
      setOpeningStockPosted(true)
    }
  }, [openingStockPosted, stockMoves, setOpeningStockPosted])
  
  const [stockAdjustments, setStockAdjustments] = useLS<StockAdjustment[]>('deed_stockAdjustments', [])
  const [stockReservations, setStockReservations] = useLS<StockReservation[]>('deed_stockReservations', [])

  // Route-scoped Prisma boot only — idle prefetch of other modules competed with first clicks.
  const bootedApiGroupsRef = useRef<Set<BootApiGroup>>(new Set())
  useEffect(() => {
    if (!initialUser) return

    const fetchLeave = () => fetch('/api/leave-requests').then(r => r.ok && r.json().then(data => {
      if (data.requests) useHrDomainStore.getState().setLeaveRequests(data.requests)
      if (data.balances) useHrDomainStore.getState().setLeaveBalances(data.balances)
    })).catch(() => {})

    const runGroup = async (group: BootApiGroup) => {
      if (bootedApiGroupsRef.current.has(group)) return
      bootedApiGroupsRef.current.add(group)
      try {
        switch (group) {
          case 'products': {
            refreshProductCatalog()
            break
          }
          case 'contacts': {
            const result = await fetchAndApplyStoreKeys({
              keys: ['deed_contacts', 'deed_companies', 'deed_contactPersons'],
              etagStorageKey: 'deed_boot_etag_contacts',
            })
            if (result === 'error') throw new Error('contacts hydrate failed')
            break
          }
          case 'sales': {
            const result = await fetchAndApplyStoreKeys({
              keys: ['deed_quotes', 'deed_saleOrders', 'deed_payments', 'deed_deliveries'],
              etagStorageKey: 'deed_boot_etag_sales',
            })
            if (result === 'error') throw new Error('sales hydrate failed')
            break
          }
          case 'crm': {
            const result = await fetchAndApplyStoreKeys({
              keys: ['deed_opportunities', 'deed_oppActivities'],
              etagStorageKey: 'deed_boot_etag_crm',
            })
            if (result === 'error') throw new Error('crm hydrate failed')
            break
          }
          case 'repairs': {
            const result = await fetchAndApplyStoreKeys({
              keys: ['deed_repairs_v2'],
              etagStorageKey: 'deed_boot_etag_repairs',
            })
            if (result === 'error') throw new Error('repairs hydrate failed')
            break
          }
          case 'purchases': {
            const result = await fetchAndApplyStoreKeys({
              keys: ['deed_purchaseOrders', 'deed_receipts'],
              etagStorageKey: 'deed_boot_etag_purchases',
            })
            if (result === 'error') throw new Error('purchases hydrate failed')
            break
          }
          case 'employees': {
            const d = await fetchCollection('/api/employees?limit=200')
            const prev = useHrDomainStore.getState().employees ?? []
            useHrDomainStore.getState().setEmployees(preferExistingArray(prev, d))
            break
          }
          case 'leave':
            await fetchLeave()
            break
          case 'payroll': {
            if (!userCan(initialUser, 'managePayroll')) break
            const [data, paymentJournalData] = await Promise.all([
              fetch('/api/payroll').then(r => r.ok ? r.json() : null),
              fetch('/api/accounting/journals?source=payroll_payment&limit=500').then(r => r.ok ? r.json() : null),
            ])
            if (data?.runs) setPayrollRuns(data.runs)
            if (data?.payslips) setPayslips(data.payslips)
            const paymentJournals = Array.isArray(paymentJournalData?.journals)
              ? paymentJournalData.journals as JournalEntry[]
              : []
            if (paymentJournals.length > 0) {
              setJournalEntries(prev => {
                const authoritativeRefs = new Set(paymentJournals.map(j => j.ref))
                return [...paymentJournals, ...prev.filter(j => !authoritativeRefs.has(j.ref))]
              })
            }
            break
          }
          case 'salary_advances': {
            const data = await fetch('/api/salary-advances').then(r => r.ok ? r.json() : null)
            if (Array.isArray(data)) setSalaryAdvances(data)
            break
          }
          case 'approval_rules': {
            const data = await fetch('/api/settings/approval-rules').then(r => r.ok ? r.json() : [])
            if (Array.isArray(data)) setDbApprovalRules(data)
            break
          }
          case 'stock_moves': {
            // deed_stockMoves / deed_serials are saved back as WHOLE collections.
            // Hydrating them from a paginated REST page (?limit=200) put a
            // partial list into synced state, and the next save replaced the
            // stored collection with it (production truncation, 21 Sep 2026).
            // Load the complete collections as a remote update, which neither
            // marks the keys dirty nor syncs them back to the server.
            const result = await fetchAndApplyStoreKeys({
              keys: ['deed_stockMoves', 'deed_serials'],
              etagStorageKey: 'deed_boot_etag_stock_moves',
            })
            if (result === 'error') throw new Error('stock_moves hydrate failed')
            break
          }
        }
      } catch {
        bootedApiGroupsRef.current.delete(group)
      }
    }

    const path = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
    const immediate = bootApiGroupsForRoute(path)
    void Promise.all(immediate.map(runGroup))
    scheduleCatalogHealOnce()

    // Leave lists belong on HR. Polling them on every screen re-fetched
    // employees/balances while the user was on Sales or Finance.
    let leaveInterval: ReturnType<typeof setInterval> | undefined
    const canPollLeave = userCan(initialUser, 'manageHR')
    const startLeavePoll = (nextPath: string) => {
      if (!canPollLeave || !nextPath.startsWith('/hr') || leaveInterval) return
      leaveInterval = setInterval(fetchLeave, 60_000)
    }
    const stopLeavePoll = () => {
      if (!leaveInterval) return
      clearInterval(leaveInterval)
      leaveInterval = undefined
    }
    startLeavePoll(path)

    const onRoute = (e: Event) => {
      const nextPath = (e as CustomEvent).detail?.pathname
      if (typeof nextPath !== 'string') return
      void Promise.all(bootApiGroupsForRoute(nextPath).map(runGroup))
      if (nextPath.startsWith('/hr')) startLeavePoll(nextPath)
      else stopLeavePoll()
    }
    window.addEventListener('deed_route_change', onRoute as EventListener)

    return () => {
      stopLeavePoll()
      window.removeEventListener('deed_route_change', onRoute as EventListener)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUser?.id, initialUser?.role, refreshProductCatalog])

  // POS — union-merge remote payloads so a stale SSE/tab cannot drop till tickets.
  const [posOrders, setPosOrders] = useLS<POSOrder[]>('deed_posOrders', [], {
    mergeRemote: (local, remote) => mergePosOrdersRemoteState(local as POSOrder[], remote as POSOrder[]),
  })
  const [posSessionOpen, setPosSessionOpen] = useLS<boolean>('deed_posSessionOpen', false)
  const [posSessionOpeningCash, setPosSessionOpeningCash] = useLS<number>('deed_posSessionOpeningCash', 0)
  const [posSessionId, setPosSessionId] = useLS<string | null>('deed_posSessionId', null)
  const [posSessions, setPosSessions] = useLS<POSSession[]>('deed_posSessions', [], {
    mergeRemote: (local, remote) => mergePosSessionsRemoteState(local as POSSession[], remote as POSSession[]),
  })

  // Keep the till open until Close Session. If the open flag survived without
  // a session id, recover it from history so Charge / Close still work.
  useEffect(() => {
    if (!posSessionOpen) return
    const recovered = resolveOpenPosSessionId({ posSessionOpen, posSessionId, posSessions })
    if (recovered && recovered !== posSessionId) setPosSessionId(recovered)
  }, [posSessionOpen, posSessionId, posSessions, setPosSessionId])

  // Approvals & Audit
  const [approvalRequests, setApprovalRequests] = useLS<ApprovalRequest[]>('deed_approvalRequests', [])
  // Audit log: session-local only, never persisted.
  //
  // This was a useLS collection, which meant every browser accumulated its own
  // copy forever. It is write-only in three separate ways: no screen reads it,
  // the server ignores client writes to deed_auditLogs (P0-SEC-002 — the real
  // record is written by /api/audit/commercial), and nothing trims it. It was
  // the largest single key in app_state at ~1.1 MB, and on the client it was
  // pure ballast pushing the localStorage quota over — the failure that cost
  // a week of half-written deliveries, payments and orders.
  //
  // The in-memory mirror stays so the optimistic UI and any same-session
  // reader keep working, capped so a long shift cannot grow it without bound.
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [notifications, setNotifications] = useLS<AppNotification[]>(
    'deed_notifications',
    [],
    { mergeRemote: mergeNotificationsSticky },
  )
  const [profileImages, setProfileImages]       = useLS<Record<string, string>>('deed_profileImages', {})

  // Delivery / Riders
  const [riders, setRiders]               = useLS<Rider[]>('deed_riders', seedRiders)
  const [deliveryJobs, setDeliveryJobs]   = useLS<DeliveryJob[]>('deed_deliveryJobs', seedDeliveryJobs)
  const [riderWeeklyPays, setRiderWeeklyPays] = useLS<RiderWeeklyPay[]>('deed_riderWeeklyPays', [])

  // SOP Documents
  const [sopDocuments, setSopDocuments] = useLS<SOPDocument[]>('deed_sop_documents', [])
  // Performance Targets
  const [sops, setSops]             = useLS<SOP[]>('deed_sops', seedSOPs)
  const [sopActuals, setSopActuals] = useLS<SOPActual[]>('deed_sopActuals', seedSopActuals)
  const [refSops, setRefSops]       = useLS<RefSOP[]>('deed_ref_sops', seedRefSOPs)

  // HR SOPs & Targets
  const [hrSops, setHrSops] = useLS<HRSOP[]>('deed_hr_sops', [])
  const [hrPerfTargets, setHrPerfTargets] = useLS<PerformanceTarget[]>('deed_hr_perf_targets', [])

  // Expenses & Outsource
  const [expenses, setExpenses]               = useLS<Expense[]>('deed_expenses', seedExpenses)
  const [outsourceVendors, setOutsourceVendors] = useLS('deed_outsourceVendors', seedOutsourceVendors)
  const [outsourceJobs, setOutsourceJobs]       = useLS('deed_outsourceJobs', seedOutsourceJobs)
  const [outsourcePayments, setOutsourcePayments] = useLS('deed_outsourcePayments', seedOutsourcePayments)
  const [outboundReleases, setOutboundReleases] = useLS<OutboundRelease[]>('deed_outboundReleases', [])
  const [deposits, setDeposits] = useLS<Deposit[]>('deed_deposits', [])
  const [companyAssets, setCompanyAssets] = useLS<CompanyAsset[]>('deed_companyAssets', [])
  const [holdovers, setHoldovers] = useLS<Holdover[]>('deed_holdovers', (() => {
    // One-time migrate from the legacy local-only key used before store sync.
    if (typeof window === 'undefined') return [] as Holdover[]
    try {
      const legacy = window.localStorage.getItem('deed_holdovers_v1')
      if (!legacy) return [] as Holdover[]
      const parsed = JSON.parse(legacy)
      return Array.isArray(parsed) ? (parsed as Holdover[]) : []
    } catch {
      return [] as Holdover[]
    }
  })())

  // Merge any remaining legacy local-only holdovers into the synced key, then drop v1.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const legacyRaw = window.localStorage.getItem('deed_holdovers_v1')
      if (!legacyRaw) return
      const legacy = JSON.parse(legacyRaw)
      if (!Array.isArray(legacy) || legacy.length === 0) {
        window.localStorage.removeItem('deed_holdovers_v1')
        return
      }
      // Saved to the server; they show up once the list next loads.
      const legacyRows = (legacy as Holdover[]).filter(h => h?.id)
      void Promise.all(legacyRows.map(h => saveHoldoverToServer('POST', '/api/holdovers', h))).then(results => {
        if (results.every(r => typeof r !== 'string')) window.localStorage.removeItem('deed_holdovers_v1')
      })
    } catch {
      /* ignore corrupt legacy */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [users, setUsers] = useState<User[]>(() => {
    // This logic is now mostly handled by the server session, but we keep it for hydration
    if (!initialUser && initialUsers.length === 0) return []

    const candidates = [...initialUsers]

    if (initialUser && !candidates.some(user => user.id === initialUser.id)) {
      candidates.unshift(initialUser)
    }

    return candidates.map(user => ({ ...user, modules: Array.isArray(user.modules) ? [...user.modules] : [] }))
  })
  const [currentUserId, setCurrentUserId] = useState<string | null>(initialUser?.id ?? null)

  const showToast = useCallback((msg: string, type: 'success'|'error'|'info' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500)
    // Fan into the Zustand toast slice for domain hooks. AppShell still renders
    // the Context toast — do not mount a second Toast from this store.
    useNotificationStore.getState().showToast(msg, type)
  }, [])

  // ── Internal notification pusher (single-recipient compat + multi fan-out) ──
  const notifyUsers = useCallback((input: NotifyUsersInput) => {
    setNotifications(prev => buildNotifyRows(prev, input, uid).next)
    fetch('/api/notifications/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).catch(() => {})
  }, [])

  const pushNotif = useCallback((n: Omit<AppNotification, 'id' | 'createdAt' | 'read' | 'readAt'> & { excludeUserId?: string | null }) => {
    notifyUsers({
      recipients: [n.userId],
      type: n.type,
      title: n.title,
      body: n.body,
      module: n.module,
      path: n.path,
      icon: n.icon,
      entityKey: n.entityKey,
      excludeUserId: n.excludeUserId,
    })
  }, [notifyUsers])

  const syncRepairToPortal = useCallback((input: RepairOrder, historyNote?: string) => {
    // A finished repair's list row is slimmed (lib/store-slim.ts): the portal
    // copy must carry the real diagnosis log, so fetch the full row first and
    // overlay this change on it.
    if (isSlimRow(input)) {
      void loadFullRecord('deed_repairs_v2', String(input.id)).then(full => {
        const { [SLIM_MARK]: _mark, qcItems: _qc, statusHistory: _sh, diagnosisHistory: _dh, ...changes } = input as any
        syncRepairToPortal({ ...(full ?? {}), ...changes, ...(full ? {} : { diagnosisHistory: undefined }) } as RepairOrder, historyNote)
      })
      return
    }
    const r = input
    const portalRepair = {
      ref: r.ref,
      status: r.status,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      customerEmail: r.customerEmail,
      productName: r.productName,
      serialNumber: r.serialNumber ?? '',
      deviceCondition: r.deviceCondition,
      intakeChannel: r.intakeChannel,
      intakeDate: r.intakeDate,
      estimatedCompletionDate: r.estimatedCompletionDate,
      issueDescription: r.issueDescription ?? r.description ?? '',
      accessories: r.accessories ?? [],
      assignedTechnicianName: r.assignedTechnicianName || r.technicianName || undefined,
      repairPath: r.repairPath === 'direct_repair' ? 'direct_repair' : 'diagnosis_first',
      deviceTier: r.deviceTier === 'high_end' ? 'high_end' : r.deviceTier === 'regular' ? 'regular' : undefined,
      diagnosisFee: r.diagnosisFee,
      diagnosisFeeStatus: r.diagnosisFeeStatus,
      diagnosisFeeBilling: r.diagnosisFeeBilling,
      customerBillingType: r.customerBillingType,
      diagnosisFeePaidAt: r.diagnosisFeePaidAt,
      billingExempt: r.billingExempt,
      warrantyCoverage: r.warrantyCoverage,
      diagnosisStopped: r.diagnosisStopped,
      liabilityWaiverAccepted: r.liabilityWaiverAccepted,
      liabilityWaiverAcceptedAt: r.liabilityWaiverAcceptedAt,
      diagnosis: r.diagnosis ? {
        id: r.diagnosis.id,
        revision: r.diagnosis.revision,
        revisionType: r.diagnosis.revisionType,
        revisionReason: r.diagnosis.revisionReason,
        findings: r.diagnosis.findings,
        faultDescription: r.diagnosis.faultDescription,
        recommendedAction: r.diagnosis.recommendedAction,
        estimatedHours: r.diagnosis.estimatedHours,
        diagnosedBy: r.diagnosis.diagnosedBy,
        diagnosedDate: r.diagnosis.diagnosedDate,
      } : undefined,
      diagnosisHistory: (r.diagnosisHistory?.length ? r.diagnosisHistory : r.diagnosis ? [r.diagnosis] : []).map(d => ({
        id: d.id,
        revision: d.revision,
        revisionType: d.revisionType,
        revisionReason: d.revisionReason,
        findings: d.findings,
        faultDescription: d.faultDescription,
        recommendedAction: d.recommendedAction,
        estimatedHours: d.estimatedHours,
        diagnosedBy: d.diagnosedBy,
        diagnosedDate: d.diagnosedDate,
      })),
      quote: r.quote ? {
        lines: r.quote.lines.map(l => ({ id: l.id, type: l.type as 'part' | 'labor' | 'logistics' | 'software' | 'license' | 'service', description: l.description, qty: l.qty, unitPrice: l.unitPrice, subtotal: l.subtotal, lineDecision: l.decision })),
        subtotal: r.quote.subtotal,
        tax: r.quote.tax,
        total: r.quote.total,
        validUntil: r.quote.validUntil,
        sentDate: r.quote.sentDate,
        approvedDate: r.quote.approvedDate,
        approvedBy: r.quote.approvedBy,
        rejectedDate: r.quote.rejectedDate,
        rejectionReason: r.quote.rejectionReason,
        partiallyApproved: r.quote.partiallyApproved,
        approvedTotal: r.quote.approvedTotal,
        changeSummary: r.quote.changeSummary,
        prevTotal: r.quote.prevTotal,
        diagnosisRevision: r.quote.diagnosisRevision,
        diagnosisFaultSummary: r.quote.diagnosisFaultSummary,
      } : undefined,
      statusHistory: [{ status: r.status as any, date: now(), note: historyNote }],
      repairStartDate: r.repairStartDate,
      slaMissed: r.slaMissed ?? false,
      underWarranty: r.underWarranty ?? false,
      notes: r.notes,
      preRepairPhotos: r.preRepairPhotos,
      qcReportData: r.qcReportData,
      qcReportName: r.qcReportName,
      qcReportUrl: r.qcReportUrl,
      qcReportId: r.qcReportId,
      qcReportSize: r.qcReportSize,
      qcReportType: r.qcReportType,
      qcReportUploadedAt: r.qcReportUploadedAt,
      issuePhotos: r.issuePhotos,
      diagnosisReportData: r.diagnosisReportData,
      diagnosisReportName: r.diagnosisReportName,
      diagnosisReportUrl: r.diagnosisReportUrl,
    }
    fetch('/api/portal/repair/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repair: portalRepair }),
    }).catch(() => { /* silent — portal sync is best-effort */ })
  }, [])

  // Keep refs for current state in closures
  const prodRef   = useRef(products);   prodRef.current   = products
  const productCreateLocksRef = useRef(new Set<string>())
  const accountRef = useRef(accounts);  accountRef.current = accounts
  const serialRef = useRef(serials);    serialRef.current = serials
  const repairsRef = useRef(repairs); repairsRef.current = repairs
  const soRef      = useRef(saleOrders); soRef.current   = saleOrders
  const invRef    = useRef(invoices);  invRef.current    = invoices
  const poRef     = useRef(purchaseOrders); poRef.current = purchaseOrders
  /** Purchase orders being confirmed right now (double-click guard). */
  const confirmingPoRef = useRef(new Set<string>())
  /**
   * Till ticket numbers of POS sales whose stock call did not come back
   * (network drop, server error), keyed by session + cart. Charging the same
   * cart again reuses the number, so a sale the server did take is not taken
   * twice; a refused sale (stock gone) frees it.
   */
  const posPendingRefs = useRef(new Map<string, string>())
  const recRef    = useRef(receipts);   recRef.current    = receipts
  const purchaseReturnsRef = useRef(purchaseReturns); purchaseReturnsRef.current = purchaseReturns
  const warRef    = useRef(warranties); warRef.current    = warranties
  const delRef    = useRef(deliveries); delRef.current    = deliveries
  const orcRef    = useRef(outboundReleases); orcRef.current = outboundReleases
  const adjRef    = useRef(stockAdjustments); adjRef.current = stockAdjustments
  const empRef    = useRef(employees); empRef.current = employees
  const payrollRef = useRef(payrollRuns); payrollRef.current = payrollRuns
  const salaryAdvancesRef = useRef(salaryAdvances); salaryAdvancesRef.current = salaryAdvances
  const assetRef = useRef(employeeAssetAssignments); assetRef.current = employeeAssetAssignments
  const kilimallOrdersRef = useRef(kilimallOrders); kilimallOrdersRef.current = kilimallOrders
  const kilimallSettlementsRef = useRef(kilimallSettlements); kilimallSettlementsRef.current = kilimallSettlements
  const outsourceJobsRef = useRef(outsourceJobs); outsourceJobsRef.current = outsourceJobs
  const outsourcePaymentsRef = useRef(outsourcePayments); outsourcePaymentsRef.current = outsourcePayments
  const customerCreditsRef = useRef(customerCredits); customerCreditsRef.current = customerCredits
  const quotesRef = useRef(quotes); quotesRef.current = quotes
  const paymentsRef = useRef(payments); paymentsRef.current = payments

  const getProductTrackingMethod = (product: Partial<Product> | null | undefined): TrackingMethod =>
    inferTrackingMethod({
      trackingMethod: product?.trackingMethod,
      category: product?.category,
      requiresSerial: product?.requiresSerial,
      unit: product?.unit,
    })

  const buildInventoryBarcodeForProduct = (productId: string, manufacturerSerial?: string) => {
    const product = prodRef.current.find(item => item.id === productId)
    return buildInventoryBarcode({
      existingBarcodes: serialRef.current.map(item => item.barcode),
      manufacturerSerial,
      productSku: product?.sku,
    })
  }

  const normalizeUnitSkuSeed = (value: string | null | undefined, fallback: string) => {
    const cleaned = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
    return cleaned || fallback
  }

  const buildSerialUnitSku = (
    product: Product,
    serial: string,
    requestedSku: string | undefined,
    reservedSkus: Set<string>,
  ) => {
    const requested = String(requestedSku ?? '').trim().toUpperCase()
    if (requested && !['AUTO', 'SYSTEM', 'GENERATE'].includes(requested)) return requested

    const productSeed = normalizeUnitSkuSeed(product.sku || product.name, 'SKU')
    const serialSeed = normalizeUnitSkuSeed(serial, 'UNIT')
    const base = `${productSeed}-${serialSeed}`.slice(0, 40)
    let candidate = base
    let suffix = 1
    while (reservedSkus.has(candidate)) {
      candidate = `${base}-${suffix++}`.slice(0, 48)
    }
    return candidate
  }

  const getActiveOutsourceJob = (repairId: string) =>
    outsourceJobsRef.current.find(job => job.repairOrderId === repairId && job.status === 'sent')

  const blockIfOutsourced = (repairId: string, action = 'continue this repair') => {
    const job = getActiveOutsourceJob(repairId)
    if (!job) return false
    showToast(`Cannot ${action} while ${job.ref} is still at ${job.vendorName}. Mark it returned in Outsource first.`, 'error')
    return true
  }

  /** Intake a retained repair device into warehouse via free buy-back or donation-in. */
  // Buy-back / exchange numbers come from the server sequence (BBK/2026/0001),
  // like delivery notes. They used to be counted in each browser, so every
  // buy-back ended up as BBK/0001. The record is saved at once under a
  // temporary number that cannot clash (BBK/2026/L…); the server number then
  // replaces it on the record, its repair and its stock moves.
  /** A rider weekly-pay number: unique at once, the server's RWP/NNNN as soon as it answers. */
  const riderPayRef = (): string => {
    const provisional = allocateDocNumberSync('RWP')
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef('RWP').then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        setRiderWeeklyPays(p => p.map(w => (w.ref === provisional ? { ...w, ref: finalRef } : w)))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  /**
   * An expense claim number: unique at once, the server's EXP/NNNN as soon as
   * it answers. It used to come from this browser's own counter, so two
   * browsers issued the same EXP number; the second claim's journal was then
   * taken as already posted and skipped, and the claim could never be paid.
   */
  const expenseRef = (): string => {
    const provisional = allocateDocNumberSync('EXP')
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef('EXP').then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        setExpenses(p => p.map(e => (e.ref === provisional ? { ...e, ref: finalRef } : e)))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  /**
   * A customer contract number: unique at once, the server's CTR/NNNN as soon
   * as it answers. It used to come from this browser's own counter — the one
   * deals used too — so two browsers issued the same contract number.
   */
  const contractRef = (): string => {
    const provisional = allocateDocNumberSync('CTR')
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef('CTR').then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        setCustomerContracts(p => p.map(c => (c.ref === provisional ? { ...c, ref: finalRef } : c)))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  /** An outsource job number: unique at once, the server's OUT/NNNN as soon as it answers. */
  const outsourceRef = (): string => {
    const provisional = allocateDocNumberSync('OUT')
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef('OUT').then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        const swap = (text?: string) => (text && text.includes(provisional) ? text.split(provisional).join(finalRef) : text)
        setOutsourceJobs(p => p.map(j => (j.ref === provisional ? { ...j, ref: finalRef } : j)))
        setRepairs(p => (p.some(r => JSON.stringify(r.statusHistory ?? []).includes(provisional) || (r.notes ?? '').includes(provisional))
          ? p.map(r => ({
            ...r,
            notes: swap(r.notes),
            statusHistory: r.statusHistory?.map(h => ({ ...h, note: swap(h.note) ?? h.note })),
          }))
          : p))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  /** The outsource vendor's contact (Contacts / accounts), matched by name. */
  const outsourceVendorContactId = (vendorId: string, vendorName: string) =>
    contacts.find(c => c.isVendor && c.name.trim().toLowerCase() === vendorName.trim().toLowerCase())?.id ?? vendorId

  /** Bills raised for this vendor's outsource jobs (cancelled ones left out). */
  const outsourceVendorBills = (vendorId: string) => {
    const ids = new Set(outsourceJobsRef.current.filter(j => j.vendorId === vendorId && j.billId).map(j => j.billId!))
    return invRef.current.filter(i => ids.has(i.id) && i.status !== 'cancelled')
  }

  /**
   * Draft vendor bill for an outsource job. It carries the draft placeholder
   * like every other bill, so Finance's posting gives it the official BILL
   * number (it used to take a number from this browser's own counter, which
   * posting kept — duplicates across browsers).
   */
  const createOutsourceBill = (job: OutsourceJob, cost: number): string => {
    const line: InvoiceLine = {
      id: uid(),
      description: `Outsource Service: ${OUTSOURCE_SERVICE_TYPES.find(t => t.value === job.serviceType)?.label ?? job.serviceType} — ${job.deviceDescription}`,
      qty: 1,
      unitPrice: cost,
      taxRate: 0,
      subtotal: cost,
    }
    const vendorContactId = outsourceVendorContactId(job.vendorId, job.vendorName)
    const bill: Invoice = {
      id: uid(),
      ref: draftInvoiceRef('vendor_bill'),
      type: 'vendor_bill',
      status: 'draft',
      partnerId: vendorContactId,
      partnerName: job.vendorName,
      date: now(),
      dueDate: addDays(now(), contactPaymentTermsDays(contacts.find(c => c.id === vendorContactId), systemSettings.purDefaultPaymentTermsDays ?? 30)),
      lines: [line],
      subtotal: cost,
      taxTotal: 0,
      total: cost,
      amountPaid: 0,
      notes: `Outsource job ${job.ref} — ${job.deviceDescription}`,
    }
    invRef.current = [bill, ...invRef.current]
    setInvoices(prev => [bill, ...prev])
    void saveInvoiceToServer(bill, msg => showToast(msg, 'error'))
    showToast(`Draft vendor bill created for ${job.vendorName} — Finance confirms it before payment`, 'success')
    return bill.id
  }

  const tradeInRef = (prefix: 'BBK' | 'EXC'): string => {
    const provisional = allocateDocNumberSync(prefix)
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef(prefix).then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        const swap = (text?: string) => (text && text.includes(provisional) ? text.split(provisional).join(finalRef) : text)
        if (prefix === 'BBK') setBuyBacks(p => p.map(b => (b.ref === provisional ? { ...b, ref: finalRef } : b)))
        else setClientExchanges(p => p.map(e => (e.ref === provisional ? { ...e, ref: finalRef } : e)))
        setRepairs(p => (p.some(r => r.retainedBuyBackRef === provisional || (r.notes ?? '').includes(provisional))
          ? p.map(r => (r.retainedBuyBackRef === provisional || (r.notes ?? '').includes(provisional)
            ? { ...r, retainedBuyBackRef: r.retainedBuyBackRef === provisional ? finalRef : r.retainedBuyBackRef, notes: swap(r.notes) }
            : r))
          : p))
        setWarranties(p => (p.some(w => w.cancelledByRef === provisional)
          ? p.map(w => (w.cancelledByRef === provisional ? { ...w, cancelledByRef: finalRef, cancelledReason: swap(w.cancelledReason) } : w))
          : p))
        setStockMoves(p => (p.some(m => m.documentRef === provisional)
          ? p.map(m => (m.documentRef === provisional ? { ...m, documentRef: finalRef, reason: swap(m.reason) ?? m.reason } : m))
          : p))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  // A machine the customer sold back to us (buy-back) or handed in on an
  // exchange is no longer theirs: its warranty ends there. Only warranties
  // already on file are touched (a later resale gets its own new warranty).
  const cancelWarrantiesForTradeIn = (serialIds: string[], docRef: string, reason: string) => {
    const ids = new Set(serialIds.filter(Boolean))
    if (!ids.size) return
    const at = now()
    const ending = warranties.filter(w => ids.has(w.serialId) && w.status !== 'cancelled')
    if (!ending.length) return
    setWarranties(p => p.map(w => (ids.has(w.serialId) && w.status !== 'cancelled'
      ? { ...w, status: 'cancelled' as const, cancelledAt: at, cancelledReason: reason, cancelledByRef: docRef }
      : w)))
    addAuditLog('warranty_cancel', docRef, `Cancelled ${ending.map(w => w.ref).join(', ')} — ${reason}`)
  }

  const convertRetainedDeviceIntoInventory = (args: {
    repair: RepairOrder
    mode: 'buyback' | 'donation'
    notes?: string
    at: string
    byName: string
  }): { ok: true; mode: 'buyback' | 'donation'; id: string; ref: string } | { ok: false; message: string } => {
    const { repair, mode, notes, at, byName } = args
    const product = findRepairCatalogProduct(prodRef.current, repair)
    if (!product) {
      return { ok: false, message: 'Link a catalog product on the repair first' }
    }

    let serialId: string | undefined
    let serialText = ''
    if (product.requiresSerial || repair.serialNumber?.trim()) {
      const matched = matchRepairDeviceSerial(serialRef.current, product.id, repair)
      if ('error' in matched) return { ok: false, message: matched.error }
      serialText = matched.serialText
      if (matched.existing) {
        serialId = matched.existing.id
        if (matched.existing.status !== 'sold' && matched.existing.location !== 'customer') {
          setSerials(p => p.map(s => s.id === matched.existing!.id
            ? { ...s, status: 'sold' as const, location: 'customer' as LocationId, soldDate: s.soldDate || at }
            : s))
        }
      } else {
        const newSerial: SerialNumber = {
          id: uid(),
          serial: serialText,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          location: 'customer',
          status: 'sold',
          receivedDate: at,
          soldDate: at,
          barcode: buildInventoryBarcodeForProduct(product.id, serialText),
        }
        setSerials(p => [...p, newSerial])
        sync('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
        serialId = newSerial.id
      }
    }

    if (product.requiresSerial && !serialId) {
      return { ok: false, message: 'Serialized product needs a serial number' }
    }

    const condition = buyBackConditionFromRepair(repair.deviceCondition)
    const serialIds = serialId ? [serialId] : []
    const serialLabels = serialText
      ? [serialText]
      : serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id)

    if (mode === 'donation') {
      const don: Donation = {
        id: uid(),
        ref: allocateDocNumberSync('DON'),
        type: 'in',
        party: repair.customerName || 'Customer',
        date: at,
        lines: [{
          id: uid(),
          productId: product.id,
          productName: product.name,
          qty: 1,
          serialIds,
          notes: `From retained repair ${repair.ref}`,
        }],
        status: 'confirmed',
        location: 'warehouse',
        notes: `Customer left device with Deed from repair ${repair.ref}${notes ? ` — ${notes}` : ''}`,
        repairId: repair.id,
        repairRef: repair.ref,
        confirmedByName: byName,
        confirmedDate: at,
      }
      setDonations(p => [don, ...p]); numberDonations([don.id])
      if (serialId) {
        setSerials(p => p.map(s => s.id === serialId
          ? {
              ...s,
              status: condition === 'poor' ? 'refurbishment' as const : 'available' as const,
              location: 'warehouse' as LocationId,
              soldDate: undefined,
              saleOrderId: undefined,
              repairId: undefined,
            }
          : s))
      } else {
        setBulkStock(prev => upsertBulkStock(prev, product.id, 'warehouse', 1))
      }
      setProducts(p => p.map(x => x.id === product.id ? { ...x, stockQty: x.stockQty + 1 } : x))
      addMove(product.id, product.name, 1, 'in', `Donation in ${don.ref} (retained repair ${repair.ref})`, don.ref, 'customer', 'warehouse', serialLabels)
      return { ok: true, mode: 'donation', id: don.id, ref: don.ref }
    }

    const bb: BuyBack = {
      id: uid(),
      ref: tradeInRef('BBK'),
      customerId: repair.customerId,
      customerName: repair.customerName,
      repairId: repair.id,
      repairRef: repair.ref,
      status: 'stocked',
      date: at,
      lines: [{
        id: uid(),
        productId: product.id,
        productName: product.name,
        qty: 1,
        serialIds,
        condition,
        unitPrice: 0,
        notes: `From retained repair ${repair.ref}`,
      }],
      total: 0,
      destinationLocation: 'warehouse',
      notes: `Customer left device with Deed from repair ${repair.ref}${notes ? ` — ${notes}` : ''}`,
      approvedByName: byName,
      approvedDate: at,
      paidDate: at,
      paymentMethod: 'cash',
      stockedDate: at,
      stockedByName: byName,
    }
    setBuyBacks(p => [bb, ...p])
    if (serialId) {
      setSerials(p => p.map(s => s.id === serialId
        ? {
            ...s,
            status: condition === 'poor' ? 'refurbishment' as const : 'available' as const,
            location: 'warehouse' as LocationId,
            soldDate: undefined,
            saleOrderId: undefined,
            repairId: undefined,
          }
        : s))
    } else {
      setBulkStock(prev => upsertBulkStock(prev, product.id, 'warehouse', 1))
    }
    setProducts(p => p.map(x => x.id === product.id ? { ...x, stockQty: x.stockQty + 1 } : x))
    addMove(product.id, product.name, 1, 'in', `Buy-back ${bb.ref} (retained repair ${repair.ref})`, bb.ref, 'customer', 'warehouse', serialLabels)
      cancelWarrantiesForTradeIn(serialIds, bb.ref, `Bought back from ${repair.customerName} (${bb.ref}, retained repair ${repair.ref})`)
    return { ok: true, mode: 'buyback', id: bb.id, ref: bb.ref }
  }

  const markRepairLockedForOutsource = (repair: RepairOrder, job: OutsourceJob): RepairOrder => ({
    ...repair,
    status: 'in_repair',
    repairStartDate: repair.repairStartDate ?? now(),
    statusHistory: [
      ...(repair.statusHistory ?? []),
      {
        status: 'in_repair',
        date: now(),
        note: `Locked in repair while outsourced to ${job.vendorName} via ${job.ref}`,
        by: job.sentByName,
      },
    ],
  })

  // Keep the cached product quantity aligned with the location-aware stock records.
  // Only from complete, current copies: a page that has not downloaded the
  // serials or stock levels (the dashboard, repairs) computed quantities from
  // part of the stock, and that recalculated list — hundreds of products —
  // was saved to the server on every load, overwriting good quantities and
  // making every other open session download the catalog again.
  useEffect(() => {
    if (!downloadedThisSession(['deed_products', 'deed_serials', 'deed_bulkStock'])) return
    setProducts(prev => {
      let changed = false
      const next = prev.map(product => {
        const locs = calcStockByLocation(product, serials, bulkStock, product.id, true)
        const stockQty = locs.warehouse + locs.shop + locs.repair_unit
        if (product.stockQty === stockQty) return product
        changed = true
        return { ...product, stockQty }
      })
      return changed ? next : prev
    })
  }, [serials, bulkStock])

  // Customer quote decisions write deed_repairs_v2. The store SSE invalidates
  // that key; a 10s per-job /api/portal/repair/{ref} poll was reconstructing
  // invoices + photos for every awaiting-approval row on every screen.

  // Poll server for new notifications — sticky-merge so read never flips unread
  useEffect(() => {
    if (!currentUserId) return
    const checkNotifications = async () => {
      try {
        const res = await fetch(`/api/notifications?userId=${currentUserId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data?.notifications && Array.isArray(data.notifications)) {
          setNotifications(prev => mergeNotificationsSticky(prev, data.notifications as AppNotification[]))
        }
      } catch { /* silent */ }
    }
    const id = setInterval(checkNotifications, 60_000) // SSE handles real-time; this is a fallback
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId])

  const getVendorOutstanding = (vendorId: string) =>
    invRef.current.filter(i => i.type === 'vendor_bill' && i.partnerId === vendorId)
      .reduce((sum, inv) => sum + invoiceResidual(inv), 0)

  const addMove = (productId: string, productName: string, qty: number, type: StockMove['type'], reason: string, docRef: string, fromLoc?: LocationId, toLoc?: LocationId, serNums: string[] = []) => {
    const actor = currentUser()
    const move: StockMove = { id: uid(), type, productId, productName, qty, reason, fromLocation: fromLoc, toLocation: toLoc, serialNumbers: serNums, date: now(), userId: actor?.id ?? 'system', documentRef: docRef }
    setStockMoves(p => [move, ...p])
    sync('/api/stock-moves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(move) })
  }

  const currentUser = () => currentUserId ? users.find(u => u.id === currentUserId) ?? null : null

  // ── Refurbishment parts and warehouse stock ─────────────────────────────────
  /** Good stock of a part in the warehouse (not With Issues, not in the repair unit). */
  const refurbWarehouseQty = (productId: string) => {
    const prod = prodRef.current.find(p => p.id === productId)
    return calcStockByLocation(prod, serialRef.current, bulkStock, productId).warehouse
  }
  /** Take a refurbishment part out of warehouse stock. False (with a message) when there is not enough there. */
  const takeRefurbPartFromWarehouse = (job: RefurbishmentJob, part: RefurbPart, byName: string): boolean => {
    if (!part.productId) return false
    const prod = prodRef.current.find(p => p.id === part.productId)
    const available = refurbWarehouseQty(part.productId)
    if (available < part.qty) {
      showToast(`Not enough ${prod?.name ?? part.partName} in the warehouse: ${available} there, ${part.qty} needed. Order it or receive the PO first.`, 'error')
      return false
    }
    setProducts(p => p.map(x => x.id === part.productId ? { ...x, stockQty: Math.max(0, x.stockQty - part.qty) } : x))
    setBulkStock(prev => upsertBulkStock(prev, part.productId!, 'warehouse', -part.qty))
    addMove(part.productId, part.partName, part.qty, 'out', `Refurb ${job.ref} — part taken by ${byName}`, job.ref, 'warehouse', 'repair_unit', [])
    return true
  }
  /**
   * A parts-queue request wherever it is kept: a repair's procurement request,
   * or a refurbishment part (one request per part). `write` applies the
   * desk's change back to that record.
   */
  type QueueRequest = {
    ref: string
    technicianId?: string
    request: PartsRequest
    write: (fn: (req: PartsRequest) => PartsRequest) => void
  } & ({ kind: 'refurb'; job: RefurbishmentJob; part: RefurbPart } | { kind: 'repair'; repair: Repair })
  const partsQueueRequest = (kind: PartsRequestKind, ownerId: string, requestId: string): QueueRequest | null => {
    if (kind === 'refurb') {
      const job = refurbishmentJobs.find(j => j.id === ownerId)
      const part = job?.partsNeeded.find(pt => pt.id === requestId)
      const request = job && part ? refurbPartRequest(job, part) : null
      if (!job || !part || !request) return null
      return {
        kind, job, part, request, ref: job.ref, technicianId: job.assignedTechnicianId,
        write: fn => setRefurbishmentJobs(prev => prev.map(j => j.id !== ownerId ? j : {
          ...j,
          partsNeeded: j.partsNeeded.map(pt => {
            if (pt.id !== requestId) return pt
            const req = refurbPartRequest(j, pt)
            return req ? refurbPartAfterRequest(pt, fn(req)) : pt
          }),
        })),
      }
    }
    const repair = repairsRef.current.find(r => r.id === ownerId)
    const request = repair?.procurementRequests?.find(r => r.id === requestId)
    if (!repair || !request) return null
    return {
      kind, repair, request: request as PartsRequest, ref: repair.ref, technicianId: repair.assignedTechnicianId,
      write: fn => setRepairs(prev => prev.map(r => r.id !== ownerId ? r : {
        ...r,
        procurementRequests: (r.procurementRequests ?? []).map(req => req.id === requestId ? fn(req as PartsRequest) as typeof req : req),
      })),
    }
  }
  /**
   * Trade-in machines that need work go straight to Refurbishment with a job:
   * tagged ones (serial unknown) always, and ones taken in as "poor". They
   * used to be marked refurbishment with no job, and no screen showed them.
   */
  /**
   * Refurbishment job numbers come from the server (REF/NNNN). They used to be
   * counted in each browser, so every browser started again at REF/0001. A
   * new job gets a temporary, clash-free number and its real one a moment
   * later.
   */
  /**
   * Give records their real server numbers, one at a time (PREFIX/NNNN).
   * Records numbered in the browser used to repeat; see lib/doc-number-repair.ts.
   */
  const assignServerNumbers = (kind: string, prefix: string, ids: string[], apply: (id: string, ref: string) => void) => {
    if (!ids.length || typeof window === 'undefined') return
    const valid = new RegExp(`^${prefix}/\\d+$`)
    void (async () => {
      for (const id of ids) {
        const ref = await allocateDocNumber(kind).catch(() => null)
        if (ref && valid.test(ref)) apply(id, ref)
      }
    })()
  }
  /** The record with its new number; a real old one is kept as formerRef. */
  const withServerRef = <T extends { ref: string; formerRef?: string }>(r: T, ref: string): T =>
    ({ ...r, ref, ...(!r.formerRef && r.ref && !isProvisionalDocRef(r.ref) ? { formerRef: r.ref } : {}) })
  /**
   * Before posting stock or value under a record's number: its own number if
   * it is real and no other record has it, else a new server number (applied
   * to the record). Null when the server cannot give one.
   */
  const ensureUniqueServerRef = async <T extends { id: string; ref: string }>(
    kind: string, prefix: string, record: T, all: T[], apply: (id: string, ref: string) => void,
  ): Promise<string | null> => {
    if (record.ref && !isProvisionalDocRef(record.ref) && !all.some(o => o.id !== record.id && o.ref === record.ref)) return record.ref
    const ref = await allocateDocNumber(kind).catch(() => null)
    if (!ref || !new RegExp(`^${prefix}/\\d+$`).test(ref)) return null
    apply(record.id, ref)
    return ref
  }
  const numberRefurbJobs = (ids: string[]) =>
    assignServerNumbers('refurbishment', 'REF', ids, (id, ref) => setRefurbishmentJobs(p => p.map(j => j.id === id ? { ...j, ref } : j)))
  /** Jobs whose number another job already has, or still a temporary one. */
  const refurbJobsNeedingNumbers = (jobs: RefurbishmentJob[]): string[] =>
    recordsNeedingNumbers(jobs, { dateOf: j => j.intakeDate, isFinal: ref => /^REF\/\d+$/.test(ref) })

  /**
   * A stock adjustment's real number. A repeated old number is kept as
   * `formerRef` (its journals and stock moves carry it). A stand-in number is
   * also replaced where a parts request recorded it.
   */
  const applyAdjustmentNumber = (id: string, ref: string) => {
    const old = adjRef.current.find(a => a.id === id)?.ref
    setStockAdjustments(p => p.map(a => a.id === id ? withServerRef(a, ref) : a))
    if (!old || !isProvisionalDocRef(old)) return
    const swap = (refs?: string[]) => refs?.map(r => (r === old ? ref : r))
    setRepairs(p => p.some(r => r.procurementRequests?.some(q => q.adjustmentRefs?.includes(old)))
      ? p.map(r => ({ ...r, procurementRequests: r.procurementRequests?.map(q => q.adjustmentRefs?.includes(old) ? { ...q, adjustmentRefs: swap(q.adjustmentRefs) } : q) }))
      : p)
    setRefurbishmentJobs(p => p.some(j => j.partsNeeded.some(pt => pt.adjustmentRefs?.includes(old)))
      ? p.map(j => ({ ...j, partsNeeded: j.partsNeeded.map(pt => pt.adjustmentRefs?.includes(old) ? { ...pt, adjustmentRefs: swap(pt.adjustmentRefs) } : pt) }))
      : p)
  }
  const numberAdjustments = (ids: string[]) => assignServerNumbers('adjustment', 'ADJ', ids, applyAdjustmentNumber)

  // Transfers, customer returns, donations and refund payments: the same.
  const applyTransferNumber = (id: string, ref: string) => setStockTransfers(p => p.map(t => t.id === id ? withServerRef(t, ref) : t))
  const applyDonationNumber = (id: string, ref: string) => setDonations(p => p.map(d => d.id === id ? withServerRef(d, ref) : d))
  const applyRefundPaymentNumber = (id: string, ref: string) => setRefundPayments(p => p.map(r => r.id === id ? withServerRef(r, ref) : r))
  /** A return's number also shows on its refund payments. */
  const applyReturnNumber = (id: string, ref: string) => {
    setReturnOrders(p => p.map(r => r.id === id ? withServerRef(r, ref) : r))
    setRefundPayments(p => p.some(x => x.rmaId === id) ? p.map(x => x.rmaId === id ? { ...x, rmaRef: ref } : x) : p)
  }
  const numberTransfers = (ids: string[]) => assignServerNumbers('transfer', 'TR', ids, applyTransferNumber)
  const numberReturns = (ids: string[]) => assignServerNumbers('return_order', 'RMA', ids, applyReturnNumber)
  const numberDonations = (ids: string[]) => assignServerNumbers('donation', 'DON', ids, applyDonationNumber)
  const applyPosSessionNumber = (id: string, ref: string) => setPosSessions(p => p.map(x => x.id === id ? withServerRef(x, ref) : x))
  const numberPosSessions = (ids: string[]) => assignServerNumbers('pos_session', 'POSSESS', ids, applyPosSessionNumber)
  const numberRefundPayments = (ids: string[]) => assignServerNumbers('refund_payment', 'RFD', ids, applyRefundPaymentNumber)

  /**
   * One-time repair, per collection, once its data has loaded on this page:
   * repeated or stand-in numbers get server numbers (the oldest keeps its
   * own). Refund payments are money records: their repeats are only listed
   * (Accounting › Refunds), never renumbered here.
   */
  const pagePath = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
  const pageDataReady = useRouteDataReady(pagePath)
  const docNumbersRepaired = useRef(new Set<string>())
  useEffect(() => {
    const user = currentUser()
    if (!pageDataReady || !user) return
    const loaded = new Set(appStateKeysForRoute(pagePath))
    const series: Array<{ key: string; records: Array<{ id: string; ref: string }>; dateOf: (r: never) => string; renumber: (ids: string[]) => void }> = [
      { key: 'deed_stockTransfers', records: stockTransfers, dateOf: (t: StockTransfer) => t.date, renumber: numberTransfers },
      { key: 'deed_returnOrders', records: returnOrders, dateOf: (r: ReturnOrder) => r.requestDate, renumber: numberReturns },
      { key: 'deed_donations', records: donations, dateOf: (d: Donation) => d.date, renumber: numberDonations },
    ]
    for (const s of series) {
      if (!loaded.has(s.key) || !s.records.length || docNumbersRepaired.current.has(s.key) || !canWriteStoreKey(user, s.key)) continue
      docNumbersRepaired.current.add(s.key)
      s.renumber(recordsNeedingNumbers(s.records, { dateOf: s.dateOf as (r: { id: string; ref: string }) => string }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageDataReady, pagePath, currentUserId, stockTransfers.length, returnOrders.length, donations.length])
  const openTradeInRefurbJobs = (units: Array<{ serialId: string; issue: string; cost?: number; sourceRef: string }>) => {
    const open = new Set(refurbishmentJobs.filter(j => j.status !== 'transferred' && j.status !== 'written_off').map(j => j.serialId))
    const jobs: RefurbishmentJob[] = []
    for (const u of units) {
      const ser = serialRef.current.find(s => s.id === u.serialId)
      if (!ser || open.has(ser.id)) continue
      open.add(ser.id)
      const tagged = awaitingIdentification(ser)
      const prod = prodRef.current.find(p => p.id === ser.productId)
      jobs.push({
        id: uid(), ref: allocateDocNumberSync('REF'),
        status: 'queued',
        serialId: ser.id, serialNumber: ser.serial,
        productId: ser.productId, productName: ser.productName,
        specs: ser.specs || (tagged ? '' : prod?.description),
        specsAtIntake: ser.specs || (tagged ? '' : prod?.description || ''),
        intakeDate: new Date().toISOString(),
        intakeIssueDescription: u.issue,
        partsNeeded: [],
        intakeSource: 'trade_in',
        intakeSourceRef: u.sourceRef,
        ...(u.cost != null ? { intakeCost: u.cost } : {}),
        ...(tagged ? { identityPending: true, intakeTag: ser.intakeTag || ser.serial } : {}),
      })
    }
    if (!jobs.length) return 0
    const ids = new Set(jobs.map(j => j.serialId))
    const costs = new Map(units.map(u => [u.serialId, u.cost]))
    setSerials(p => p.map(s => !ids.has(s.id) ? s : { ...s, location: 'repair_unit', status: 'refurbishment', ...(costs.get(s.id) != null ? { intakeCost: costs.get(s.id) } : {}) }))
    setRefurbishmentJobs(p => [...p, ...jobs])
    numberRefurbJobs(jobs.map(j => j.id))
    return jobs.length
  }

  /** Put a part that was taken for a job and never fitted back into the warehouse. */
  const returnRefurbPartToWarehouse = (job: RefurbishmentJob, part: RefurbPart) => {
    if (!part.productId) return
    setProducts(p => p.map(x => x.id === part.productId ? { ...x, stockQty: x.stockQty + part.qty } : x))
    setBulkStock(prev => upsertBulkStock(prev, part.productId!, 'warehouse', part.qty))
    addMove(part.productId, part.partName, part.qty, 'in', `Refurb ${job.ref} — unused part returned`, job.ref, 'repair_unit', 'warehouse', [])
  }

  const addAuditLog = (action: string, documentRef: string, details: string, opts?: { sessionOnly?: boolean }) => {
    const actor = currentUser()?.username || 'system'
    const log: AuditLog = { id: uid(), date: now(), user: actor, action, documentRef, details }
    setAuditLogs(p => [log, ...p].slice(0, SESSION_AUDIT_LOG_LIMIT))
    if (opts?.sessionOnly) return
    // P0-SEC-002: persist via server-authored endpoint (client store writes to
    // deed_auditLogs are ignored).
    void fetch('/api/audit/commercial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, documentRef, details }),
    }).catch(() => { /* offline — local mirror remains until sync */ })
  }

  /**
   * Push customer identity onto linked quotes, sale orders (proformas), and invoices.
   * Used when a contact or document customer fields change so PDF reprints stay current.
   */
  const syncCustomerIdentityToDocuments = (opts: {
    contactId?: string
    saleOrderId?: string
    repairId?: string
    invoiceId?: string
    identity: {
      name: string
      email?: string
      phone?: string
      address?: string
      customerId?: string
    }
  }) => {
    const { contactId, saleOrderId, repairId, invoiceId, identity } = opts
    if (!identity.name?.trim()) return

    const quoteNext = quotesRef.current.map(q => {
      const repair = repairId ? repairsRef.current.find(r => r.id === repairId) : undefined
      const linked =
        (contactId && quoteMatchesCustomer(q, contactId))
        || (repairId && (q.repairId === repairId || (repair?.salesQuoteId && q.id === repair.salesQuoteId)))
      if (!linked || !shouldSyncQuoteCustomer(q.status)) return q
      const patched = applyCustomerToQuote(q, identity)
      if (
        patched.companyName === q.companyName
        && patched.contactPersonEmail === q.contactPersonEmail
        && patched.contactPersonPhone === q.contactPersonPhone
      ) return q
      sync(`/api/quotes/${q.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patched) })
      return patched
    })
    if (quoteNext.some((q, i) => q !== quotesRef.current[i])) {
      setQuotes(quoteNext)
      quotesRef.current = quoteNext
    }

    const soNext = soRef.current.map(so => {
      const repair = repairId ? repairsRef.current.find(r => r.id === repairId) : undefined
      const linked =
        (contactId && so.customerId === contactId)
        || (saleOrderId && so.id === saleOrderId)
        || (repair && (so.id === repair.saleOrderId || so.quoteId === repair.salesQuoteId))
      if (!linked || !shouldSyncSaleOrderCustomer(so.status)) return so
      const patched = applyCustomerToSaleOrder(so, {
        ...identity,
        customerId: identity.customerId || contactId || so.customerId,
      })
      if (
        patched.customerName === so.customerName
        && patched.customerId === so.customerId
        && patched.invoiceAddress === so.invoiceAddress
      ) return so
      sync(`/api/sale-orders/${so.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patched) })
      return patched
    })
    if (soNext.some((s, i) => s !== soRef.current[i])) {
      setSaleOrders(soNext)
      soRef.current = soNext
    }

    const invNext = invRef.current.map(inv => {
      if (inv.type === 'vendor_bill') return inv
      const repair = repairId ? repairsRef.current.find(r => r.id === repairId) : undefined
      const linked =
        (contactId && inv.partnerId === contactId)
        || (saleOrderId && inv.saleOrderId === saleOrderId)
        || (repairId && (inv.repairId === repairId || (repair?.invoiceId && inv.id === repair.invoiceId) || (repair?.saleOrderId && inv.saleOrderId === repair.saleOrderId)))
        || (invoiceId && inv.id === invoiceId)
      if (!linked || !shouldSyncInvoiceCustomer(inv.status)) return inv
      const patched = applyCustomerToInvoice(inv, {
        ...identity,
        customerId: identity.customerId || contactId || inv.partnerId,
      })
      if (
        patched.partnerName === inv.partnerName
        && patched.partnerId === inv.partnerId
        && patched.invoiceAddress === inv.invoiceAddress
      ) return inv
      sync(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patched) })
      return patched
    })
    if (invNext.some((inv, i) => inv !== invRef.current[i])) {
      setInvoices(invNext)
      invRef.current = invNext
    }

    if (contactId) {
      const repairNext = repairsRef.current.map(r => {
        if (repairId && r.id === repairId) return r // already updated by caller
        if (r.customerId !== contactId) return r
        const nextName = identity.name
        const nextPhone = identity.phone !== undefined ? identity.phone : r.customerPhone
        const nextEmail = identity.email !== undefined ? (identity.email || undefined) : r.customerEmail
        if (
          r.customerName === nextName
          && r.customerPhone === nextPhone
          && r.customerEmail === nextEmail
        ) return r
        const patched = {
          ...r,
          customerName: nextName,
          customerPhone: nextPhone || r.customerPhone,
          customerEmail: nextEmail,
        }
        setTimeout(() => syncRepairToPortal(patched), 0)
        return patched
      })
      if (repairNext.some((r, i) => r !== repairsRef.current[i])) {
        setRepairs(repairNext)
        repairsRef.current = repairNext
      }
    }
  }

  // Post an invoice's GL journal exactly once. Every path that marks an invoice
  // `posted` (from a sale order, delivery, repair-quote conversion, or the manual
  // postInvoice action) routes through here so the AR/revenue subledger and the
  // General Ledger never drift apart. The dedup guard keys on the journal ref.
  const postInvoiceJournalOnce = (inv: Invoice) => {
    const po = inv.purchaseOrderId ? poRef.current.find(p => p.id === inv.purchaseOrderId) : null
    const journal = buildInvoicePostingJournal(
      inv,
      (productId) => prodRef.current.find(p => p.id === productId),
      accountRef.current.map(a => ({ code: a.code, name: a.name })),
      {
        perpetual: systemSettings.invAutomatedValuation !== false,
        poLines: po?.lines?.map(l => ({ productId: l.productId, unitPrice: l.unitPrice })),
      },
    )
    setJournalEntries(p => (p.some(j => j.ref === journal.ref) ? p : [journal, ...p]))
    addAuditLog('post_invoice', inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} posted to journal ${journal.ref}`)
  }

  const storeCtxRef = useRef<AppState | null>(null)
  const inventoryActions = useMemo(() => ({
    addProduct: (...args: Parameters<AppState['addProduct']>) => storeCtxRef.current!.addProduct(...args),
    publishProductBulk: (...args: Parameters<AppState['publishProductBulk']>) => storeCtxRef.current!.publishProductBulk(...args),
    refreshProductCatalog: (...args: Parameters<AppState['refreshProductCatalog']>) => storeCtxRef.current!.refreshProductCatalog(...args),
    normalizeInventoryTags: (...args: Parameters<AppState['normalizeInventoryTags']>) => storeCtxRef.current!.normalizeInventoryTags(...args),
    updateProduct: (...args: Parameters<AppState['updateProduct']>) => storeCtxRef.current!.updateProduct(...args),
    updateProductPrice: (...args: Parameters<AppState['updateProductPrice']>) => storeCtxRef.current!.updateProductPrice(...args),
    archiveProduct: (...args: Parameters<AppState['archiveProduct']>) => storeCtxRef.current!.archiveProduct(...args),
    unarchiveProduct: (...args: Parameters<AppState['unarchiveProduct']>) => storeCtxRef.current!.unarchiveProduct(...args),
    createTransfer: (...args: Parameters<AppState['createTransfer']>) => storeCtxRef.current!.createTransfer(...args),
    addTransferLine: (...args: Parameters<AppState['addTransferLine']>) => storeCtxRef.current!.addTransferLine(...args),
    validateTransfer: (...args: Parameters<AppState['validateTransfer']>) => storeCtxRef.current!.validateTransfer(...args),
    submitTransfer: (...args: Parameters<AppState['submitTransfer']>) => storeCtxRef.current!.submitTransfer(...args),
    importOpeningStock: (...args: Parameters<AppState['importOpeningStock']>) => storeCtxRef.current!.importOpeningStock(...args),
    intakeProductSerials: (...args: Parameters<AppState['intakeProductSerials']>) => storeCtxRef.current!.intakeProductSerials(...args),
    getStockByLocation: (...args: Parameters<AppState['getStockByLocation']>) => storeCtxRef.current!.getStockByLocation(...args),
    getMonthlyMovements: (...args: Parameters<AppState['getMonthlyMovements']>) => storeCtxRef.current!.getMonthlyMovements(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    addAuditLog: (...args: Parameters<AppState['addAuditLog']>) => storeCtxRef.current!.addAuditLog(...args),
    updateSerial: (...args: Parameters<AppState['updateSerial']>) => storeCtxRef.current!.updateSerial(...args),
    releaseSerialToStock: (...args: Parameters<AppState['releaseSerialToStock']>) => storeCtxRef.current!.releaseSerialToStock(...args),
    createRefurbishmentJob: (...args: Parameters<AppState['createRefurbishmentJob']>) => storeCtxRef.current!.createRefurbishmentJob(...args),
    transferToSell: (...args: Parameters<AppState['transferToSell']>) => storeCtxRef.current!.transferToSell(...args),
    createAdjustment: (...args: Parameters<AppState['createAdjustment']>) => storeCtxRef.current!.createAdjustment(...args),
    approveAdjustment: (...args: Parameters<AppState['approveAdjustment']>) => storeCtxRef.current!.approveAdjustment(...args),
    fixAdjustmentNumbers: () => storeCtxRef.current!.fixAdjustmentNumbers(),
  }), [])

  const salesActions = useMemo(() => ({
    createSaleOrder: (...args: Parameters<AppState['createSaleOrder']>) => storeCtxRef.current!.createSaleOrder(...args),
    updateSaleOrder: (...args: Parameters<AppState['updateSaleOrder']>) => storeCtxRef.current!.updateSaleOrder(...args),
    confirmSO: (...args: Parameters<AppState['confirmSO']>) => storeCtxRef.current!.confirmSO(...args),
    ensureWaitingDeliveryForSO: (...args: Parameters<AppState['ensureWaitingDeliveryForSO']>) => storeCtxRef.current!.ensureWaitingDeliveryForSO(...args),
    markQuotationSent: (...args: Parameters<AppState['markQuotationSent']>) => storeCtxRef.current!.markQuotationSent(...args),
    setSaleOrderLock: (...args: Parameters<AppState['setSaleOrderLock']>) => storeCtxRef.current!.setSaleOrderLock(...args),
    addSOLine: (...args: Parameters<AppState['addSOLine']>) => storeCtxRef.current!.addSOLine(...args),
    removeSOLine: (...args: Parameters<AppState['removeSOLine']>) => storeCtxRef.current!.removeSOLine(...args),
    moveSOLine: (...args: Parameters<AppState['moveSOLine']>) => storeCtxRef.current!.moveSOLine(...args),
    addSOSection: (...args: Parameters<AppState['addSOSection']>) => storeCtxRef.current!.addSOSection(...args),
    assignSerialToSOLine: (...args: Parameters<AppState['assignSerialToSOLine']>) => storeCtxRef.current!.assignSerialToSOLine(...args),
    assignSerialsToSOLine: (...args: Parameters<AppState['assignSerialsToSOLine']>) => storeCtxRef.current!.assignSerialsToSOLine(...args),
    unassignSerialFromSOLine: (...args: Parameters<AppState['unassignSerialFromSOLine']>) => storeCtxRef.current!.unassignSerialFromSOLine(...args),
    addContact: (...args: Parameters<AppState['addContact']>) => storeCtxRef.current!.addContact(...args),
    createInvoiceFromSO: (...args: Parameters<AppState['createInvoiceFromSO']>) => storeCtxRef.current!.createInvoiceFromSO(...args),
    postInvoice: (...args: Parameters<AppState['postInvoice']>) => storeCtxRef.current!.postInvoice(...args),
    prepareDelivery: (...args: Parameters<AppState['prepareDelivery']>) => storeCtxRef.current!.prepareDelivery(...args),
    validateDelivery: (...args: Parameters<AppState['validateDelivery']>) => storeCtxRef.current!.validateDelivery(...args),
    reverseDelivery: (...args: Parameters<AppState['reverseDelivery']>) => storeCtxRef.current!.reverseDelivery(...args),
    markDeliveryNoteGenerated: (...args: Parameters<AppState['markDeliveryNoteGenerated']>) => storeCtxRef.current!.markDeliveryNoteGenerated(...args),
    deleteSaleOrder: (...args: Parameters<AppState['deleteSaleOrder']>) => storeCtxRef.current!.deleteSaleOrder(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    getStockByLocation: (...args: Parameters<AppState['getStockByLocation']>) => storeCtxRef.current!.getStockByLocation(...args),
    resetSOToDraft: (...args: Parameters<AppState['resetSOToDraft']>) => storeCtxRef.current!.resetSOToDraft(...args),
    cancelSO: (...args: Parameters<AppState['cancelSO']>) => storeCtxRef.current!.cancelSO(...args),
    createNewSOVersion: (...args: Parameters<AppState['createNewSOVersion']>) => storeCtxRef.current!.createNewSOVersion(...args),
    getCustomerCreditStatus: (...args: Parameters<AppState['getCustomerCreditStatus']>) => storeCtxRef.current!.getCustomerCreditStatus(...args),
    issueCreditNoteFromSaleOrder: (...args: Parameters<AppState['issueCreditNoteFromSaleOrder']>) => storeCtxRef.current!.issueCreditNoteFromSaleOrder(...args),
    updateDelivery: (...args: Parameters<AppState['updateDelivery']>) => storeCtxRef.current!.updateDelivery(...args),
    initRelease: (...args: Parameters<AppState['initRelease']>) => storeCtxRef.current!.initRelease(...args),
    approveRequest: (...args: Parameters<AppState['approveRequest']>) => storeCtxRef.current!.approveRequest(...args),
    getDocumentPaymentDetails: (...args: Parameters<AppState['getDocumentPaymentDetails']>) => storeCtxRef.current!.getDocumentPaymentDetails(...args),
    setDocumentPaymentDetails: (...args: Parameters<AppState['setDocumentPaymentDetails']>) => storeCtxRef.current!.setDocumentPaymentDetails(...args),
    addBankAccount: (...args: Parameters<AppState['addBankAccount']>) => storeCtxRef.current!.addBankAccount(...args),
  }), [])

  const repairActions = useMemo(() => ({
    createRepair: (...args: Parameters<AppState['createRepair']>) => storeCtxRef.current!.createRepair(...args),
    updateRepair: (...args: Parameters<AppState['updateRepair']>) => storeCtxRef.current!.updateRepair(...args),
    deleteRepair: (...args: Parameters<AppState['deleteRepair']>) => storeCtxRef.current!.deleteRepair(...args),
    verifyRepairIntake: (...args: Parameters<AppState['verifyRepairIntake']>) => storeCtxRef.current!.verifyRepairIntake(...args),
    assignTechnicianToRepair: (...args: Parameters<AppState['assignTechnicianToRepair']>) => storeCtxRef.current!.assignTechnicianToRepair(...args),
    logDiagnosis: (...args: Parameters<AppState['logDiagnosis']>) => storeCtxRef.current!.logDiagnosis(...args),
    stopAtDiagnosis: (...args: Parameters<AppState['stopAtDiagnosis']>) => storeCtxRef.current!.stopAtDiagnosis(...args),
    markDiagnosisFeePaid: (...args: Parameters<AppState['markDiagnosisFeePaid']>) => storeCtxRef.current!.markDiagnosisFeePaid(...args),
    waiveDiagnosisFee: (...args: Parameters<AppState['waiveDiagnosisFee']>) => storeCtxRef.current!.waiveDiagnosisFee(...args),
    markRepairNoCharge: (...args: Parameters<AppState['markRepairNoCharge']>) => storeCtxRef.current!.markRepairNoCharge(...args),
    generateRepairQuote: (...args: Parameters<AppState['generateRepairQuote']>) => storeCtxRef.current!.generateRepairQuote(...args),
    approveRepairQuote: (...args: Parameters<AppState['approveRepairQuote']>) => storeCtxRef.current!.approveRepairQuote(...args),
    startRepair: (...args: Parameters<AppState['startRepair']>) => storeCtxRef.current!.startRepair(...args),
    markRepairComplete: (...args: Parameters<AppState['markRepairComplete']>) => storeCtxRef.current!.markRepairComplete(...args),
    addRepairQAItem: (...args: Parameters<AppState['addRepairQAItem']>) => storeCtxRef.current!.addRepairQAItem(...args),
    completeRepairQA: (...args: Parameters<AppState['completeRepairQA']>) => storeCtxRef.current!.completeRepairQA(...args),
    markPartsArrived: (...args: Parameters<AppState['markPartsArrived']>) => storeCtxRef.current!.markPartsArrived(...args),
    scheduleDelivery: (...args: Parameters<AppState['scheduleDelivery']>) => storeCtxRef.current!.scheduleDelivery(...args),
    deliverRepair: (...args: Parameters<AppState['deliverRepair']>) => storeCtxRef.current!.deliverRepair(...args),
    closeRepairJob: (...args: Parameters<AppState['closeRepairJob']>) => storeCtxRef.current!.closeRepairJob(...args),
    createInvoiceFromRepair: (...args: Parameters<AppState['createInvoiceFromRepair']>) => storeCtxRef.current!.createInvoiceFromRepair(...args),
    consolidateRepairInvoices: (...args: Parameters<AppState['consolidateRepairInvoices']>) => storeCtxRef.current!.consolidateRepairInvoices(...args),
    reviewPortalPayment: (...args: Parameters<AppState['reviewPortalPayment']>) => storeCtxRef.current!.reviewPortalPayment(...args),
    getVisibleRepairs: (...args: Parameters<AppState['getVisibleRepairs']>) => storeCtxRef.current!.getVisibleRepairs(...args),
    updateRepairProgress: (...args: Parameters<AppState['updateRepairProgress']>) => storeCtxRef.current!.updateRepairProgress(...args),
    moveRepairToPreviousProgress: (...args: Parameters<AppState['moveRepairToPreviousProgress']>) => storeCtxRef.current!.moveRepairToPreviousProgress(...args),
    requestProcurement: (...args: Parameters<AppState['requestProcurement']>) => storeCtxRef.current!.requestProcurement(...args),
    correctPartsCount: (...args: Parameters<AppState['correctPartsCount']>) => storeCtxRef.current!.correctPartsCount(...args),
    raisePartsPurchaseOrder: (...args: Parameters<AppState['raisePartsPurchaseOrder']>) => storeCtxRef.current!.raisePartsPurchaseOrder(...args),
    markUnrepairable: (...args: Parameters<AppState['markUnrepairable']>) => storeCtxRef.current!.markUnrepairable(...args),
    declineQuote: (...args: Parameters<AppState['declineQuote']>) => storeCtxRef.current!.declineQuote(...args),
    returnToCustomer: (...args: Parameters<AppState['returnToCustomer']>) => storeCtxRef.current!.returnToCustomer(...args),
    leaveDeviceWithDeed: (...args: Parameters<AppState['leaveDeviceWithDeed']>) => storeCtxRef.current!.leaveDeviceWithDeed(...args),
    convertRetainedRepairToDonation: (...args: Parameters<AppState['convertRetainedRepairToDonation']>) => storeCtxRef.current!.convertRetainedRepairToDonation(...args),
    convertRetainedRepairToBuyBack: (...args: Parameters<AppState['convertRetainedRepairToBuyBack']>) => storeCtxRef.current!.convertRetainedRepairToBuyBack(...args),
    createTradeInFromRepair: (...args: Parameters<AppState['createTradeInFromRepair']>) => storeCtxRef.current!.createTradeInFromRepair(...args),
    fileWarrantyClaim: (...args: Parameters<AppState['fileWarrantyClaim']>) => storeCtxRef.current!.fileWarrantyClaim(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    appendRepairHistory: (...args: Parameters<AppState['appendRepairHistory']>) => storeCtxRef.current!.appendRepairHistory(...args),
    setModule: (...args: Parameters<AppState['setModule']>) => storeCtxRef.current!.setModule(...args),
    initRelease: (...args: Parameters<AppState['initRelease']>) => storeCtxRef.current!.initRelease(...args),
    addOutsourceJob: (...args: Parameters<AppState['addOutsourceJob']>) => storeCtxRef.current!.addOutsourceJob(...args),
  }), [])

  const shellActions = useMemo(() => ({
    getVisibleRepairs: (...args: Parameters<AppState['getVisibleRepairs']>) => storeCtxRef.current!.getVisibleRepairs(...args),
    logout: (...args: Parameters<AppState['logout']>) => storeCtxRef.current!.logout(...args),
    markAllNotificationsRead: (...args: Parameters<AppState['markAllNotificationsRead']>) => storeCtxRef.current!.markAllNotificationsRead(...args),
    markNotificationRead: (...args: Parameters<AppState['markNotificationRead']>) => storeCtxRef.current!.markNotificationRead(...args),
    clearReadNotifications: (...args: Parameters<AppState['clearReadNotifications']>) => storeCtxRef.current!.clearReadNotifications(...args),
    setModule: (...args: Parameters<AppState['setModule']>) => storeCtxRef.current!.setModule(...args),
    setProfileImage: (...args: Parameters<AppState['setProfileImage']>) => storeCtxRef.current!.setProfileImage(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    toggleSidebar: (...args: Parameters<AppState['toggleSidebar']>) => storeCtxRef.current!.toggleSidebar(...args),
    updateUser: (...args: Parameters<AppState['updateUser']>) => storeCtxRef.current!.updateUser(...args),
  }), [])

  const crmActions = useMemo(() => ({
    addContact: (...args: Parameters<AppState['addContact']>) => storeCtxRef.current!.addContact(...args),
    completeActivity: (...args: Parameters<AppState['completeActivity']>) => storeCtxRef.current!.completeActivity(...args),
    createCompany: (...args: Parameters<AppState['createCompany']>) => storeCtxRef.current!.createCompany(...args),
    createContactPerson: (...args: Parameters<AppState['createContactPerson']>) => storeCtxRef.current!.createContactPerson(...args),
    createCustomerContract: (...args: Parameters<AppState['createCustomerContract']>) => storeCtxRef.current!.createCustomerContract(...args),
    createOpportunity: (...args: Parameters<AppState['createOpportunity']>) => storeCtxRef.current!.createOpportunity(...args),
    ingestOpportunity: (...args: Parameters<AppState['ingestOpportunity']>) => storeCtxRef.current!.ingestOpportunity(...args),
    deleteCompany: (...args: Parameters<AppState['deleteCompany']>) => storeCtxRef.current!.deleteCompany(...args),
    deleteContact: (...args: Parameters<AppState['deleteContact']>) => storeCtxRef.current!.deleteContact(...args),
    deleteContactPerson: (...args: Parameters<AppState['deleteContactPerson']>) => storeCtxRef.current!.deleteContactPerson(...args),
    deleteOpportunity: (...args: Parameters<AppState['deleteOpportunity']>) => storeCtxRef.current!.deleteOpportunity(...args),
    logActivity: (...args: Parameters<AppState['logActivity']>) => storeCtxRef.current!.logActivity(...args),
    markOpportunityLost: (...args: Parameters<AppState['markOpportunityLost']>) => storeCtxRef.current!.markOpportunityLost(...args),
    markOpportunityWon: (...args: Parameters<AppState['markOpportunityWon']>) => storeCtxRef.current!.markOpportunityWon(...args),
    moveOpportunityStage: (...args: Parameters<AppState['moveOpportunityStage']>) => storeCtxRef.current!.moveOpportunityStage(...args),
    renewCustomerContract: (...args: Parameters<AppState['renewCustomerContract']>) => storeCtxRef.current!.renewCustomerContract(...args),
    terminateCustomerContract: (...args: Parameters<AppState['terminateCustomerContract']>) => storeCtxRef.current!.terminateCustomerContract(...args),
    updateCompany: (...args: Parameters<AppState['updateCompany']>) => storeCtxRef.current!.updateCompany(...args),
    updateContact: (...args: Parameters<AppState['updateContact']>) => storeCtxRef.current!.updateContact(...args),
    updateContactPerson: (...args: Parameters<AppState['updateContactPerson']>) => storeCtxRef.current!.updateContactPerson(...args),
    updateOpportunity: (...args: Parameters<AppState['updateOpportunity']>) => storeCtxRef.current!.updateOpportunity(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
  }), [])

  const financeActions = useMemo(() => ({
    addAccount: (...args: Parameters<AppState['addAccount']>) => storeCtxRef.current!.addAccount(...args),
    addContact: (...args: Parameters<AppState['addContact']>) => storeCtxRef.current!.addContact(...args),
    addDepositPayment: (...args: Parameters<AppState['addDepositPayment']>) => storeCtxRef.current!.addDepositPayment(...args),
    addOutsourceJob: (...args: Parameters<AppState['addOutsourceJob']>) => storeCtxRef.current!.addOutsourceJob(...args),
    addOutsourceVendor: (...args: Parameters<AppState['addOutsourceVendor']>) => storeCtxRef.current!.addOutsourceVendor(...args),
    addPOLine: (...args: Parameters<AppState['addPOLine']>) => storeCtxRef.current!.addPOLine(...args),
    addReturnLine: (...args: Parameters<AppState['addReturnLine']>) => storeCtxRef.current!.addReturnLine(...args),
    addStatementLine: (...args: Parameters<AppState['addStatementLine']>) => storeCtxRef.current!.addStatementLine(...args),
    updateStatementLine: (...args: Parameters<AppState['updateStatementLine']>) => storeCtxRef.current!.updateStatementLine(...args),
    applyCustomerCreditToInvoice: (...args: Parameters<AppState['applyCustomerCreditToInvoice']>) => storeCtxRef.current!.applyCustomerCreditToInvoice(...args),
    autoMatchStatements: (...args: Parameters<AppState['autoMatchStatements']>) => storeCtxRef.current!.autoMatchStatements(...args),
    bulkAddPOLines: (...args: Parameters<AppState['bulkAddPOLines']>) => storeCtxRef.current!.bulkAddPOLines(...args),
    cancelDeposit: (...args: Parameters<AppState['cancelDeposit']>) => storeCtxRef.current!.cancelDeposit(...args),
    cancelInvoice: (...args: Parameters<AppState['cancelInvoice']>) => storeCtxRef.current!.cancelInvoice(...args),
    completeDeposit: (...args: Parameters<AppState['completeDeposit']>) => storeCtxRef.current!.completeDeposit(...args),
    confirmPO: (...args: Parameters<AppState['confirmPO']>) => storeCtxRef.current!.confirmPO(...args),
    confirmPurchaseReturn: (...args: Parameters<AppState['confirmPurchaseReturn']>) => storeCtxRef.current!.confirmPurchaseReturn(...args),
    createBillFromPO: (...args: Parameters<AppState['createBillFromPO']>) => storeCtxRef.current!.createBillFromPO(...args),
    createDeposit: (...args: Parameters<AppState['createDeposit']>) => storeCtxRef.current!.createDeposit(...args),
    createManualInvoice: (...args: Parameters<AppState['createManualInvoice']>) => storeCtxRef.current!.createManualInvoice(...args),
    importOpeningBalances: (...args: Parameters<AppState['importOpeningBalances']>) => storeCtxRef.current!.importOpeningBalances(...args),
    createPO: (...args: Parameters<AppState['createPO']>) => storeCtxRef.current!.createPO(...args),
    createPurchaseReturn: (...args: Parameters<AppState['createPurchaseReturn']>) => storeCtxRef.current!.createPurchaseReturn(...args),
    createReceiptFromPO: (...args: Parameters<AppState['createReceiptFromPO']>) => storeCtxRef.current!.createReceiptFromPO(...args),
    deleteInvoice: (...args: Parameters<AppState['deleteInvoice']>) => storeCtxRef.current!.deleteInvoice(...args),
    deletePO: (...args: Parameters<AppState['deletePO']>) => storeCtxRef.current!.deletePO(...args),
    deleteStatementLine: (...args: Parameters<AppState['deleteStatementLine']>) => storeCtxRef.current!.deleteStatementLine(...args),
    getCustomerCreditBalance: (...args: Parameters<AppState['getCustomerCreditBalance']>) => storeCtxRef.current!.getCustomerCreditBalance(...args),
    initRelease: (...args: Parameters<AppState['initRelease']>) => storeCtxRef.current!.initRelease(...args),
    logReturnPickup: (...args: Parameters<AppState['logReturnPickup']>) => storeCtxRef.current!.logReturnPickup(...args),
    matchStatementLine: (...args: Parameters<AppState['matchStatementLine']>) => storeCtxRef.current!.matchStatementLine(...args),
    postInvoice: (...args: Parameters<AppState['postInvoice']>) => storeCtxRef.current!.postInvoice(...args),
    recordOutsourcePayment: (...args: Parameters<AppState['recordOutsourcePayment']>) => storeCtxRef.current!.recordOutsourcePayment(...args),
    createOutsourceJobBill: (...args: Parameters<AppState['createOutsourceJobBill']>) => storeCtxRef.current!.createOutsourceJobBill(...args),
    registerPayment: (...args: Parameters<AppState['registerPayment']>) => storeCtxRef.current!.registerPayment(...args),
    reverseInvoicePayment: (...args: Parameters<AppState['reverseInvoicePayment']>) => storeCtxRef.current!.reverseInvoicePayment(...args),
    setInvoicePaymentBlocked: (...args: Parameters<AppState['setInvoicePaymentBlocked']>) => storeCtxRef.current!.setInvoicePaymentBlocked(...args),
    payExpense: (...args: Parameters<AppState['payExpense']>) => storeCtxRef.current!.payExpense(...args),
    payPayrollRun: (...args: Parameters<AppState['payPayrollRun']>) => storeCtxRef.current!.payPayrollRun(...args),
    reimburseExpense: (...args: Parameters<AppState['reimburseExpense']>) => storeCtxRef.current!.reimburseExpense(...args),
    removePOLine: (...args: Parameters<AppState['removePOLine']>) => storeCtxRef.current!.removePOLine(...args),
    resetInvoiceToDraft: (...args: Parameters<AppState['resetInvoiceToDraft']>) => storeCtxRef.current!.resetInvoiceToDraft(...args),
    returnOutsourceJob: (...args: Parameters<AppState['returnOutsourceJob']>) => storeCtxRef.current!.returnOutsourceJob(...args),
    revertPOToDraft: (...args: Parameters<AppState['revertPOToDraft']>) => storeCtxRef.current!.revertPOToDraft(...args),
    reviewExpense: (...args: Parameters<AppState['reviewExpense']>) => storeCtxRef.current!.reviewExpense(...args),
    saveBankRecon: (...args: Parameters<AppState['saveBankRecon']>) => storeCtxRef.current!.saveBankRecon(...args),
    scheduleInvoiceDelivery: (...args: Parameters<AppState['scheduleInvoiceDelivery']>) => storeCtxRef.current!.scheduleInvoiceDelivery(...args),
    sendPO: (...args: Parameters<AppState['sendPO']>) => storeCtxRef.current!.sendPO(...args),
    setModule: (...args: Parameters<AppState['setModule']>) => storeCtxRef.current!.setModule(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    submitExpense: (...args: Parameters<AppState['submitExpense']>) => storeCtxRef.current!.submitExpense(...args),
    unmatchStatementLine: (...args: Parameters<AppState['unmatchStatementLine']>) => storeCtxRef.current!.unmatchStatementLine(...args),
    updateAccount: (...args: Parameters<AppState['updateAccount']>) => storeCtxRef.current!.updateAccount(...args),
    updateInvoice: (...args: Parameters<AppState['updateInvoice']>) => storeCtxRef.current!.updateInvoice(...args),
    moveInvoiceLine: (...args: Parameters<AppState['moveInvoiceLine']>) => storeCtxRef.current!.moveInvoiceLine(...args),
    addInvoiceSection: (...args: Parameters<AppState['addInvoiceSection']>) => storeCtxRef.current!.addInvoiceSection(...args),
    updateOutsourceVendor: (...args: Parameters<AppState['updateOutsourceVendor']>) => storeCtxRef.current!.updateOutsourceVendor(...args),
    updatePO: (...args: Parameters<AppState['updatePO']>) => storeCtxRef.current!.updatePO(...args),
    updatePOLine: (...args: Parameters<AppState['updatePOLine']>) => storeCtxRef.current!.updatePOLine(...args),
    validateReceipt: (...args: Parameters<AppState['validateReceipt']>) => storeCtxRef.current!.validateReceipt(...args),
    getDocumentPaymentDetails: (...args: Parameters<AppState['getDocumentPaymentDetails']>) => storeCtxRef.current!.getDocumentPaymentDetails(...args),
    setDocumentPaymentDetails: (...args: Parameters<AppState['setDocumentPaymentDetails']>) => storeCtxRef.current!.setDocumentPaymentDetails(...args),
    addBankAccount: (...args: Parameters<AppState['addBankAccount']>) => storeCtxRef.current!.addBankAccount(...args),
    createCompanyAsset: (...args: Parameters<AppState['createCompanyAsset']>) => storeCtxRef.current!.createCompanyAsset(...args),
    updateCompanyAsset: (...args: Parameters<AppState['updateCompanyAsset']>) => storeCtxRef.current!.updateCompanyAsset(...args),
    deleteCompanyAsset: (...args: Parameters<AppState['deleteCompanyAsset']>) => storeCtxRef.current!.deleteCompanyAsset(...args),
    moveCompanyAsset: (...args: Parameters<AppState['moveCompanyAsset']>) => storeCtxRef.current!.moveCompanyAsset(...args),
    setCompanyAssetCustodian: (...args: Parameters<AppState['setCompanyAssetCustodian']>) => storeCtxRef.current!.setCompanyAssetCustodian(...args),
    setCompanyAssetStatus: (...args: Parameters<AppState['setCompanyAssetStatus']>) => storeCtxRef.current!.setCompanyAssetStatus(...args),
    disposeCompanyAsset: (...args: Parameters<AppState['disposeCompanyAsset']>) => storeCtxRef.current!.disposeCompanyAsset(...args),
    writeOffCompanyAsset: (...args: Parameters<AppState['writeOffCompanyAsset']>) => storeCtxRef.current!.writeOffCompanyAsset(...args),
    runCompanyAssetDepreciation: (...args: Parameters<AppState['runCompanyAssetDepreciation']>) => storeCtxRef.current!.runCompanyAssetDepreciation(...args),
    linkSerialToCompanyAsset: (...args: Parameters<AppState['linkSerialToCompanyAsset']>) => storeCtxRef.current!.linkSerialToCompanyAsset(...args),
  }), [])

  const hrActions = useMemo(() => ({
    addRefSop: (...args: Parameters<AppState['addRefSop']>) => storeCtxRef.current!.addRefSop(...args),
    deleteRefSop: (...args: Parameters<AppState['deleteRefSop']>) => storeCtxRef.current!.deleteRefSop(...args),
    updateRefSop: (...args: Parameters<AppState['updateRefSop']>) => storeCtxRef.current!.updateRefSop(...args),
    saveSopDocuments: (...args: Parameters<AppState['saveSopDocuments']>) => storeCtxRef.current!.saveSopDocuments(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    updateUser: (...args: Parameters<AppState['updateUser']>) => storeCtxRef.current!.updateUser(...args),
  }), [])

  const deliveryActions = useMemo(() => ({
    addRider: (...args: Parameters<AppState['addRider']>) => storeCtxRef.current!.addRider(...args),
    advanceJobStatus: (...args: Parameters<AppState['advanceJobStatus']>) => storeCtxRef.current!.advanceJobStatus(...args),
    assignRiderToJob: (...args: Parameters<AppState['assignRiderToJob']>) => storeCtxRef.current!.assignRiderToJob(...args),
    recordCustomerPaidRider: (...args: Parameters<AppState['recordCustomerPaidRider']>) => storeCtxRef.current!.recordCustomerPaidRider(...args),
    createDeliveryJob: (...args: Parameters<AppState['createDeliveryJob']>) => storeCtxRef.current!.createDeliveryJob(...args),
    deleteDeliveryJob: (...args: Parameters<AppState['deleteDeliveryJob']>) => storeCtxRef.current!.deleteDeliveryJob(...args),
    generateWeeklyPay: (...args: Parameters<AppState['generateWeeklyPay']>) => storeCtxRef.current!.generateWeeklyPay(...args),
    markWeeklyPayPaid: (...args: Parameters<AppState['markWeeklyPayPaid']>) => storeCtxRef.current!.markWeeklyPayPaid(...args),
    scheduleInvoiceDelivery: (...args: Parameters<AppState['scheduleInvoiceDelivery']>) => storeCtxRef.current!.scheduleInvoiceDelivery(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    updateDeliveryJob: (...args: Parameters<AppState['updateDeliveryJob']>) => storeCtxRef.current!.updateDeliveryJob(...args),
    updateRider: (...args: Parameters<AppState['updateRider']>) => storeCtxRef.current!.updateRider(...args),
  }), [])

  const commerceActions = useMemo(() => ({
    closePOSSession: (...args: Parameters<AppState['closePOSSession']>) => storeCtxRef.current!.closePOSSession(...args),
    confirmKilimallDispatch: (...args: Parameters<AppState['confirmKilimallDispatch']>) => storeCtxRef.current!.confirmKilimallDispatch(...args),
    createKilimallOrder: (...args: Parameters<AppState['createKilimallOrder']>) => storeCtxRef.current!.createKilimallOrder(...args),
    createKilimallSettlement: (...args: Parameters<AppState['createKilimallSettlement']>) => storeCtxRef.current!.createKilimallSettlement(...args),
    createPOSOrder: (...args: Parameters<AppState['createPOSOrder']>) => storeCtxRef.current!.createPOSOrder(...args),
    getCustomerCreditStatus: (...args: Parameters<AppState['getCustomerCreditStatus']>) => storeCtxRef.current!.getCustomerCreditStatus(...args),
    openPOSSession: (...args: Parameters<AppState['openPOSSession']>) => storeCtxRef.current!.openPOSSession(...args),
    reconcileKilimallSettlement: (...args: Parameters<AppState['reconcileKilimallSettlement']>) => storeCtxRef.current!.reconcileKilimallSettlement(...args),
    matchKilimallSettlementLine: (...args: Parameters<AppState['matchKilimallSettlementLine']>) => storeCtxRef.current!.matchKilimallSettlementLine(...args),
    setModule: (...args: Parameters<AppState['setModule']>) => storeCtxRef.current!.setModule(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    updateKilimallOrder: (...args: Parameters<AppState['updateKilimallOrder']>) => storeCtxRef.current!.updateKilimallOrder(...args),
    returnKilimallOrder: (...args: Parameters<AppState['returnKilimallOrder']>) => storeCtxRef.current!.returnKilimallOrder(...args),
    updateKilimallSettlement: (...args: Parameters<AppState['updateKilimallSettlement']>) => storeCtxRef.current!.updateKilimallSettlement(...args),
    updateProduct: (...args: Parameters<AppState['updateProduct']>) => storeCtxRef.current!.updateProduct(...args),
  }), [])

  const afterSalesActions = useMemo(() => ({
    addContact: (...args: Parameters<AppState['addContact']>) => storeCtxRef.current!.addContact(...args),
    approveBuyBack: (...args: Parameters<AppState['approveBuyBack']>) => storeCtxRef.current!.approveBuyBack(...args),
    approveExchange: (...args: Parameters<AppState['approveExchange']>) => storeCtxRef.current!.approveExchange(...args),
    approveReturn: (...args: Parameters<AppState['approveReturn']>) => storeCtxRef.current!.approveReturn(...args),
    cancelExchange: (...args: Parameters<AppState['cancelExchange']>) => storeCtxRef.current!.cancelExchange(...args),
    completeExchange: (...args: Parameters<AppState['completeExchange']>) => storeCtxRef.current!.completeExchange(...args),
    confirmDonation: (...args: Parameters<AppState['confirmDonation']>) => storeCtxRef.current!.confirmDonation(...args),
    createBuyBack: (...args: Parameters<AppState['createBuyBack']>) => storeCtxRef.current!.createBuyBack(...args),
    creditBuyBack: (...args: Parameters<AppState['creditBuyBack']>) => storeCtxRef.current!.creditBuyBack(...args),
    createDonation: (...args: Parameters<AppState['createDonation']>) => storeCtxRef.current!.createDonation(...args),
    createExchange: (...args: Parameters<AppState['createExchange']>) => storeCtxRef.current!.createExchange(...args),
    createReturnOrder: (...args: Parameters<AppState['createReturnOrder']>) => storeCtxRef.current!.createReturnOrder(...args),
    deleteBuyBack: (...args: Parameters<AppState['deleteBuyBack']>) => storeCtxRef.current!.deleteBuyBack(...args),
    deleteDonation: (...args: Parameters<AppState['deleteDonation']>) => storeCtxRef.current!.deleteDonation(...args),
    payBuyBack: (...args: Parameters<AppState['payBuyBack']>) => storeCtxRef.current!.payBuyBack(...args),
    processReturn: (...args: Parameters<AppState['processReturn']>) => storeCtxRef.current!.processReturn(...args),
    receiveReturn: (...args: Parameters<AppState['receiveReturn']>) => storeCtxRef.current!.receiveReturn(...args),
    registerCustomerReturnSerial: (...args: Parameters<AppState['registerCustomerReturnSerial']>) => storeCtxRef.current!.registerCustomerReturnSerial(...args),
    rejectReturn: (...args: Parameters<AppState['rejectReturn']>) => storeCtxRef.current!.rejectReturn(...args),
    cancelWarranty: (...args: Parameters<AppState['cancelWarranty']>) => storeCtxRef.current!.cancelWarranty(...args),
    releaseSerialToStock: (...args: Parameters<AppState['releaseSerialToStock']>) => storeCtxRef.current!.releaseSerialToStock(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    stockBuyBack: (...args: Parameters<AppState['stockBuyBack']>) => storeCtxRef.current!.stockBuyBack(...args),
  }), [])

  const operationsActions = useMemo(() => ({
    addContact: (...args: Parameters<AppState['addContact']>) => storeCtxRef.current!.addContact(...args),
    addHoldover: (...args: Parameters<AppState['addHoldover']>) => storeCtxRef.current!.addHoldover(...args),
    addRefurbishmentPart: (...args: Parameters<AppState['addRefurbishmentPart']>) => storeCtxRef.current!.addRefurbishmentPart(...args),
    allocateRefurbPart: (...args: Parameters<AppState['allocateRefurbPart']>) => storeCtxRef.current!.allocateRefurbPart(...args),
    assignRefurbishmentJob: (...args: Parameters<AppState['assignRefurbishmentJob']>) => storeCtxRef.current!.assignRefurbishmentJob(...args),
    completeRelease: (...args: Parameters<AppState['completeRelease']>) => storeCtxRef.current!.completeRelease(...args),
    completeVerification: (...args: Parameters<AppState['completeVerification']>) => storeCtxRef.current!.completeVerification(...args),
    createContactPerson: (...args: Parameters<AppState['createContactPerson']>) => storeCtxRef.current!.createContactPerson(...args),
    deleteContactPerson: (...args: Parameters<AppState['deleteContactPerson']>) => storeCtxRef.current!.deleteContactPerson(...args),
    createRefurbishmentJob: (...args: Parameters<AppState['createRefurbishmentJob']>) => storeCtxRef.current!.createRefurbishmentJob(...args),
    createRepair: (...args: Parameters<AppState['createRepair']>) => storeCtxRef.current!.createRepair(...args),
    getAvailableSerials: (...args: Parameters<AppState['getAvailableSerials']>) => storeCtxRef.current!.getAvailableSerials(...args),
    getVisibleRepairs: (...args: Parameters<AppState['getVisibleRepairs']>) => storeCtxRef.current!.getVisibleRepairs(...args),
    markRefurbishmentReady: (...args: Parameters<AppState['markRefurbishmentReady']>) => storeCtxRef.current!.markRefurbishmentReady(...args),
    notifyTechPartAvailable: (...args: Parameters<AppState['notifyTechPartAvailable']>) => storeCtxRef.current!.notifyTechPartAvailable(...args),
    pickRelease: (...args: Parameters<AppState['pickRelease']>) => storeCtxRef.current!.pickRelease(...args),
    removeRefurbishmentPart: (...args: Parameters<AppState['removeRefurbishmentPart']>) => storeCtxRef.current!.removeRefurbishmentPart(...args),
    requestPartFromInventory: (...args: Parameters<AppState['requestPartFromInventory']>) => storeCtxRef.current!.requestPartFromInventory(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    transferToSell: (...args: Parameters<AppState['transferToSell']>) => storeCtxRef.current!.transferToSell(...args),
    updateHoldover: (...args: Parameters<AppState['updateHoldover']>) => storeCtxRef.current!.updateHoldover(...args),
    updateRefurbishmentJob: (...args: Parameters<AppState['updateRefurbishmentJob']>) => storeCtxRef.current!.updateRefurbishmentJob(...args),
    updateRefurbishmentPart: (...args: Parameters<AppState['updateRefurbishmentPart']>) => storeCtxRef.current!.updateRefurbishmentPart(...args),
    updateRepair: (...args: Parameters<AppState['updateRepair']>) => storeCtxRef.current!.updateRepair(...args),
    updateSerial: (...args: Parameters<AppState['updateSerial']>) => storeCtxRef.current!.updateSerial(...args),
    verifyReleaseItem: (...args: Parameters<AppState['verifyReleaseItem']>) => storeCtxRef.current!.verifyReleaseItem(...args),
    voidRelease: (...args: Parameters<AppState['voidRelease']>) => storeCtxRef.current!.voidRelease(...args),
    writeOffRefurbishmentJob: (...args: Parameters<AppState['writeOffRefurbishmentJob']>) => storeCtxRef.current!.writeOffRefurbishmentJob(...args),
    restoreRefurbishmentJob: (...args: Parameters<AppState['restoreRefurbishmentJob']>) => storeCtxRef.current!.restoreRefurbishmentJob(...args),
    fixRefurbJobNumbers: () => storeCtxRef.current!.fixRefurbJobNumbers(),
    fixAdjustmentNumbers: () => storeCtxRef.current!.fixAdjustmentNumbers(),
    intakeTaggedMachines: (...args: Parameters<AppState['intakeTaggedMachines']>) => storeCtxRef.current!.intakeTaggedMachines(...args),
    identifyRefurbUnit: (...args: Parameters<AppState['identifyRefurbUnit']>) => storeCtxRef.current!.identifyRefurbUnit(...args),
    harvestRefurbishmentJob: (...args: Parameters<AppState['harvestRefurbishmentJob']>) => storeCtxRef.current!.harvestRefurbishmentJob(...args),
  }), [])

  // Wire cross-cutting deps (currentUser/users/showToast/addAuditLog/pushNotif/
  // workflowApprovals) into useHrStore so its actions can use them without this
  // file's Context — see hooks/useHrStore.ts and the store-refactor pilot plan.
  useEffect(() => {
    useHrDomainStore.getState().setHrContext({
      currentUser, users, showToast, addAuditLog, pushNotif,
      workflowApprovals, setWorkflowApprovals,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, users, workflowApprovals])

// Server-store pushes (SSE / cross-tab sync) can land raw Prisma rows in the
// opportunities state; normalize at the exposure point so every consumer —
// especially the CRM pipeline's owner filters — always sees the client shape.
const normalizedOpportunities = useMemo(
  () => normalizeOpportunitiesForClient(opportunities) as Opportunity[],
  [opportunities],
)

// Sale orders from older localStorage snapshots or store pushes may carry
// legacy statuses ('confirmed', 'delivered', 'pending_approval', …); expose
// them normalized onto the Odoo vocabulary so the UI and workflow guards
// always see quotation | quotation_sent | sale | cancelled.
const normalizedSaleOrders = useMemo(
  () => normalizeSaleOrdersForClient(saleOrders) as SaleOrder[],
  [saleOrders],
)

const pushPpeJournal = (draft: PpeJournalDraft | null): string | undefined => {
  if (!draft || draft.lines.length === 0) return undefined
  if (Math.abs(draft.totalDebit - draft.totalCredit) > 0.05) return undefined
  const journal = journalFromPpeDraft(draft)
  setJournalEntries(prev => (prev.some(j => j.ref === journal.ref) ? prev : [journal, ...prev]))
  // Capitalisation, depreciation and disposal had no server endpoint at all,
  // so the ledger only ever saw them if the blob mirror happened to replay it.
  // Posting unconditionally is safe: the route dedupes on ref and returns the
  // existing entry, which is also why the local guard above is not consulted —
  // a setState updater has not run yet at this point.
  postSystemJournal('fixed_asset', journal, message => showToast(message, 'error'))
  return journal.ref
}

const capitaliseCompanyAsset = (asset: CompanyAsset): CompanyAsset => {
  const kind = shouldPostCapitaliseJournal(asset)
  if (!kind) return asset
  const date = (asset.acquiredDate || new Date().toISOString()).slice(0, 10)
  const draft = kind === 'inventory'
    ? buildCapitaliseFromInventoryJournal(asset, date)
    : buildCapitaliseFromApJournal(asset, date)
  const ref = pushPpeJournal(draft)
  return ref ? { ...asset, capitaliseJournalRef: ref } : asset
}

const setSerialCapitalised = (serialId: string | undefined, restore = false) => {
  if (!serialId) return
  setSerials(prev => prev.map(s => s.id !== serialId ? s : {
    ...s,
    status: restore ? 'available' : 'capitalised',
  }))
}

const storeDeps: StoreDeps = {
  get applyLocalDraftSaleOrder() { return applyLocalDraftSaleOrder },
  get applySaleOrderPersistResult() { return applySaleOrderPersistResult },
  get bankAccounts() { return bankAccounts },
  get calcSO() { return calcSO },
  get companies() { return companies },
  get confirmingSaleOrderIds() { return confirmingSaleOrderIds },
  get contactPersons() { return contactPersons },
  get contractRef() { return contractRef },
  get customerContracts() { return customerContracts },
  get customerCreditsRef() { return customerCreditsRef },
  get fetchNextKilimallRef() { return fetchNextKilimallRef },
  get kilimallOrdersRef() { return kilimallOrdersRef },
  get kilimallSettlementsRef() { return kilimallSettlementsRef },
  get numberPosSessions() { return numberPosSessions },
  get patchSaleOrderPersist() { return patchSaleOrderPersist },
  get posOrders() { return posOrders },
  get posPendingRefs() { return posPendingRefs },
  get posSessionId() { return posSessionId },
  get posSessionOpen() { return posSessionOpen },
  get posSessionOpeningCash() { return posSessionOpeningCash },
  get posSessions() { return posSessions },
  get requestWarrantySync() { return requestWarrantySync },
  get setApprovalRequests() { return setApprovalRequests },
  get setCompanies() { return setCompanies },
  get setCustomerContracts() { return setCustomerContracts },
  get setKilimallDispatches() { return setKilimallDispatches },
  get setKilimallOrders() { return setKilimallOrders },
  get setKilimallSettlements() { return setKilimallSettlements },
  get setOpportunities() { return setOpportunities },
  get setOpportunityActivities() { return setOpportunityActivities },
  get setPosOrders() { return setPosOrders },
  get setPosSessionId() { return setPosSessionId },
  get setPosSessionOpen() { return setPosSessionOpen },
  get setPosSessionOpeningCash() { return setPosSessionOpeningCash },
  get setPosSessions() { return setPosSessions },
  get adjRef() { return adjRef },
  get applyAdjustmentNumber() { return applyAdjustmentNumber },
  get applyTransferNumber() { return applyTransferNumber },
  get approvalRequests() { return approvalRequests },
  get buildSerialUnitSku() { return buildSerialUnitSku },
  get findProductIdentityDuplicate() { return findProductIdentityDuplicate },
  get getProductTrackingMethod() { return getProductTrackingMethod },
  get holdovers() { return holdovers },
  get numberAdjustments() { return numberAdjustments },
  get numberTransfers() { return numberTransfers },
  get openingStockPosted() { return openingStockPosted },
  get productCreateLockKey() { return productCreateLockKey },
  get productCreateLocksRef() { return productCreateLocksRef },
  get products() { return products },
  get purchaseOrders() { return purchaseOrders },
  get receipts() { return receipts },
  get refurbJobsNeedingNumbers() { return refurbJobsNeedingNumbers },
  get refurbWarehouseQty() { return refurbWarehouseQty },
  get refurbishmentJobs() { return refurbishmentJobs },
  get returnRefurbPartToWarehouse() { return returnRefurbPartToWarehouse },
  get saveHoldoverToServer() { return saveHoldoverToServer },
  get setHoldovers() { return setHoldovers },
  get setOpeningStockPosted() { return setOpeningStockPosted },
  get setProductPriceHistory() { return setProductPriceHistory },
  get setStockAdjustments() { return setStockAdjustments },
  get setStockMoves() { return setStockMoves },
  get setStockReservations() { return setStockReservations },
  get setStockTransfers() { return setStockTransfers },
  get stockAdjustments() { return stockAdjustments },
  get stockMoves() { return stockMoves },
  get stockTransfers() { return stockTransfers },
  get storeCtx() { return storeCtx },
  get takeRefurbPartFromWarehouse() { return takeRefurbPartFromWarehouse },
  get REPAIR_TERMINAL_STATUSES() { return REPAIR_TERMINAL_STATUSES },
  get blockIfOutsourced() { return blockIfOutsourced },
  get convertRetainedDeviceIntoInventory() { return convertRetainedDeviceIntoInventory },
  get createOutsourceBill() { return createOutsourceBill },
  get getActiveOutsourceJob() { return getActiveOutsourceJob },
  get markRepairLockedForOutsource() { return markRepairLockedForOutsource },
  get outsourceJobsRef() { return outsourceJobsRef },
  get outsourceRef() { return outsourceRef },
  get outsourceVendorBills() { return outsourceVendorBills },
  get partsQueueRequest() { return partsQueueRequest },
  get quotes() { return quotes },
  get repairInvoiceInFlight() { return repairInvoiceInFlight },
  get setContacts() { return setContacts },
  get setOutsourceJobs() { return setOutsourceJobs },
  get setOutsourcePayments() { return setOutsourcePayments },
  get setOutsourceVendors() { return setOutsourceVendors },
  get setQuotes() { return setQuotes },
  get syncCustomerIdentityToDocuments() { return syncCustomerIdentityToDocuments },
  get users() { return users },
  get warRef() { return warRef },
  get setActiveModule() { return setActiveModule },
  get setCompanySettings() { return setCompanySettings },
  get setCurrentUserId() { return setCurrentUserId },
  get setNotifications() { return setNotifications },
  get setProfileImages() { return setProfileImages },
  get setSidebarOpen() { return setSidebarOpen },
  get setSystemSettings() { return setSystemSettings },
  get setUsers() { return setUsers },
  get setRefSops() { return setRefSops },
  get setSopActuals() { return setSopActuals },
  get setSops() { return setSops },
  get assetRef() { return assetRef },
  get empRef() { return empRef },
  get journalEntries() { return journalEntries },
  get payrollRef() { return payrollRef },
  get repairsRef() { return repairsRef },
  get salaryAdvancesRef() { return salaryAdvancesRef },
  get setEmployeeAssetAssignments() { return setEmployeeAssetAssignments },
  get setPayrollRuns() { return setPayrollRuns },
  get setPayslips() { return setPayslips },
  get setSalaryAdvances() { return setSalaryAdvances },
  get setWorkflowApprovals() { return setWorkflowApprovals },
  get accountRef() { return accountRef },
  get calcPO() { return calcPO },
  get confirmingPoRef() { return confirmingPoRef },
  get currentUserId() { return currentUserId },
  get notifyUsers() { return notifyUsers },
  get numberRefurbJobs() { return numberRefurbJobs },
  get poRef() { return poRef },
  get purchaseReturnsRef() { return purchaseReturnsRef },
  get recRef() { return recRef },
  get setPurchaseOrders() { return setPurchaseOrders },
  get setPurchaseReturns() { return setPurchaseReturns },
  get setReceipts() { return setReceipts },
  get setRefurbishmentJobs() { return setRefurbishmentJobs },
  get systemSettings() { return systemSettings },
  get accounts() { return accounts },
  get addDays() { return addDays },
  get companySettings() { return companySettings },
  get contacts() { return contacts },
  get deliveries() { return deliveries },
  get deliveryJobs() { return deliveryJobs },
  get fetchNextDeliveryRef() { return fetchNextDeliveryRef },
  get invoices() { return invoices },
  get postInvoiceJournalOnce() { return postInvoiceJournalOnce },
  get repairs() { return repairs },
  get riderPayRef() { return riderPayRef },
  get riderWeeklyPays() { return riderWeeklyPays },
  get riders() { return riders },
  get saleOrders() { return saleOrders },
  get setDeliveryJobs() { return setDeliveryJobs },
  get setRiderWeeklyPays() { return setRiderWeeklyPays },
  get setRiders() { return setRiders },
  get stockReservations() { return stockReservations },
  get syncRepairToPortal() { return syncRepairToPortal },
  get LOCATIONS() { return LOCATIONS },
  get addAuditLog() { return addAuditLog },
  get addMove() { return addMove },
  get applyReturnNumber() { return applyReturnNumber },
  get buildInventoryBarcodeForProduct() { return buildInventoryBarcodeForProduct },
  get bulkStock() { return bulkStock },
  get buyBacks() { return buyBacks },
  get calcStockByLocation() { return calcStockByLocation },
  get cancelWarrantiesForTradeIn() { return cancelWarrantiesForTradeIn },
  get clientExchanges() { return clientExchanges },
  get currentUser() { return currentUser },
  get delRef() { return delRef },
  get donations() { return donations },
  get draftInvoiceRef() { return draftInvoiceRef },
  get ensureUniqueServerRef() { return ensureUniqueServerRef },
  get fmtKes() { return fmtKes },
  get invRef() { return invRef },
  get numberDonations() { return numberDonations },
  get numberRefundPayments() { return numberRefundPayments },
  get numberReturns() { return numberReturns },
  get openTradeInRefurbJobs() { return openTradeInRefurbJobs },
  get orcRef() { return orcRef },
  get postSystemJournal() { return postSystemJournal },
  get prodRef() { return prodRef },
  get returnOrders() { return returnOrders },
  get saveInvoiceToServer() { return saveInvoiceToServer },
  get seesCustomerInvoices() { return seesCustomerInvoices },
  get serialRef() { return serialRef },
  get setBulkStock() { return setBulkStock },
  get setBuyBacks() { return setBuyBacks },
  get setClientExchanges() { return setClientExchanges },
  get setCustomerCredits() { return setCustomerCredits },
  get setDeliveries() { return setDeliveries },
  get setDonations() { return setDonations },
  get setInvoices() { return setInvoices },
  get setJournalEntries() { return setJournalEntries },
  get setOutboundReleases() { return setOutboundReleases },
  get setProducts() { return setProducts },
  get setRefundPayments() { return setRefundPayments },
  get setRepairs() { return setRepairs },
  get setReturnOrders() { return setReturnOrders },
  get setSaleOrders() { return setSaleOrders },
  get setSerials() { return setSerials },
  get setWarranties() { return setWarranties },
  get showToast() { return showToast },
  get soRef() { return soRef },
  get storeCtxRef() { return storeCtxRef },
  get syncOrWarn() { return syncOrWarn },
  get tradeInRef() { return tradeInRef },
  get upsertBulkStock() { return upsertBulkStock },
  get warranties() { return warranties },
}

const storeCtx: AppState = {
    activeModule, sidebarOpen, toast,
    
    // CRM & Contacts
    contacts, companies, contactPersons, opportunities: normalizedOpportunities, opportunityActivities, quotes,
    
    // Products & Inventory
    products, productPriceHistory, serials,
    
   // Sales & Invoicing
    saleOrders: normalizedSaleOrders, invoices, deliveries,

    // Payments & Credit
    payments,
    customerCredits,
    allocatePaymentToInvoice: (paymentId, invoiceId, amount) => {
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance or Admin Officer can allocate payments', 'error'); return;
      }
      const payment = payments.find(p => p.id === paymentId)
      const invoice = invoices.find(i => i.id === invoiceId)
      if (!payment || !invoice) return
      setPayments(prev => {
        const next = prev.map(p => {
          if (p.id !== paymentId) return p
          const existing = p.invoices.find(i => i.invoiceId === invoiceId)
          const updated = existing 
            ? p.invoices.map(i => i.invoiceId === invoiceId ? { ...i, amountAllocated: i.amountAllocated + amount } : i)
            : [...p.invoices, { invoiceId, invoiceRef: invoice.ref, amountAllocated: amount }]
          return { ...p, invoices: updated }
        })
        const updatedP = next.find(p => p.id === paymentId)
        if (updatedP) sync(`/api/payments/${paymentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedP) })
        return next
      })
      setInvoices(prev => {
        const next = prev.map(i => {
          if (i.id !== invoiceId) return i
          // Payment progress is derived from amountPaid — status stays Posted.
          return { ...i, amountPaid: i.amountPaid + amount }
        })
        const updatedI = next.find(i => i.id === invoiceId)
        if (updatedI) sync(`/api/invoices/${invoiceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedI) })
        return next
      })
      addAuditLog('allocate_payment', payment.ref, `Allocated ${fmtKes(amount)} to invoice ${invoice.ref}`)
      showToast(`Allocated ${fmtKes(amount)} to ${invoice.ref}`, 'success')
    },
    generateReceipt: (paymentId) => {
      const payment = payments.find(p => p.id === paymentId)
      if (!payment) return
      showToast(`Receipt ${payment.receiptNumber} generated.`, 'info')
    },
    getCustomerCreditBalance: (customerId) => customerCreditBalance(customerCreditsRef.current, customerId),
    applyCustomerCreditToInvoice: async (invoiceId, requestedAmount) => {
      const actor = currentUser()
      if (!canApplyCustomerCredit(actor?.role)) {
        showToast('Only Finance, Admin Officer, or Director can apply customer credit', 'error')
        return
      }
      const inv = invRef.current.find(i => i.id === invoiceId)
      if (!inv || inv.type !== 'customer_invoice') return
      if (inv.status === 'draft' || inv.status === 'cancelled') {
        showToast('Post the invoice before applying customer credit', 'error')
        return
      }
      const balance = Math.max(0, inv.total - inv.amountPaid)
      if (balance <= 0) {
        showToast('Invoice is already fully paid', 'info')
        return
      }

      let remaining = Math.min(requestedAmount ?? balance, balance)
      const applications: { creditId: string; amount: number; ref: string }[] = []
      const appliedAt = now()
      const appliedBy = actor?.name ?? 'Finance'

      const nextCredits = customerCreditsRef.current.map(credit => {
        if (remaining <= 0 || credit.customerId !== inv.partnerId || !['available', 'partially_used'].includes(credit.status) || credit.balance <= 0) return credit
        const amount = Math.min(remaining, credit.balance)
        remaining -= amount
        const nextBalance = Math.max(0, credit.balance - amount)
        applications.push({ creditId: credit.id, amount, ref: credit.ref })
        return {
          ...credit,
          balance: nextBalance,
          status: nextBalance <= 0 ? 'used' : 'partially_used',
          applications: [
            ...(credit.applications ?? []),
            { invoiceId: inv.id, invoiceRef: inv.ref, amount, date: appliedAt, appliedBy },
          ],
        }
      })

      const applied = applications.reduce((sum, item) => sum + item.amount, 0)
      if (applied <= 0) {
        showToast('No available customer credit for this invoice', 'info')
        return
      }

      const paymentId = crypto.randomUUID()
      const payment: InvoicePayment = {
        id: paymentId,
        date: appliedAt,
        amount: applied,
        method: 'customer_credit',
        reference: applications.map(a => a.ref).join(', '),
        recordedBy: appliedBy,
      }
      const prevCredits = customerCreditsRef.current
      const prevInvoice = inv
      setCustomerCredits(nextCredits)
      const updatedInvoice: Invoice = {
        ...inv,
        amountPaid: inv.amountPaid + applied,
        payments: [...(inv.payments ?? []), payment],
        notes: `${inv.notes || ''}\nApplied customer credit ${applications.map(a => `${a.ref} (${fmtKes(a.amount)})`).join(', ')}`.trim(),
      }
      setInvoices(prev => prev.map(i => i.id === inv.id ? updatedInvoice : i))
      // No journal is built here: /api/invoices/[id]/payments books the credit
      // application itself (Dr 3313 / Cr 1800). The browser's own JRN/CAPP copy
      // reached the ledger too, so every applied credit came off the customer's
      // balance twice (INV/2026/0262).

      try {
        const res = await fetch(`/api/invoices/${inv.id}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: applied,
            paymentMethod: 'customer_credit',
            reference: payment.reference,
            paidAt: appliedAt,
            idempotencyKey: paymentId,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Credit apply failed (${res.status})`)
        }
      } catch (err: any) {
        setCustomerCredits(prevCredits)
        setInvoices(prev => prev.map(i => i.id === inv.id ? prevInvoice : i))
        showToast(err?.message || 'Failed to apply customer credit', 'error')
        return
      }

      addAuditLog('apply_customer_credit', inv.ref, `Applied ${fmtKes(applied)} customer credit to ${inv.ref}`)
      showToast(`Applied ${fmtKes(applied)} customer credit`, 'success')
    },
    
    // Purchasing
    purchaseOrders, receipts, stockTransfers, purchaseReturns, refurbishmentJobs,
    
    // Repairs
    repairs,

    // HR — employees, departments, leave, hrDocuments, recruitment, and training
    // moved to useHrStore(); read/call that hook directly instead of from useApp().
    contracts, customerContracts,
    workflowApprovals,
    payrollRuns, payslips, salaryAdvances, employeeAssetAssignments,

    // Accounting
    journalEntries, accounts,

    // Inventory
    warranties, bulkStock, openingStockPosted: openingStockLocked, stockMoves, stockAdjustments,

    // POS
    posOrders, posSessionOpen, posSessionOpeningCash, posSessionId, posSessions,

    // System
    auditLogs,

    // Delivery
    riders, deliveryJobs, riderWeeklyPays,

    // Kilimall
    kilimallOrders, kilimallDispatches, kilimallSettlements,

    ...createSalesActions(storeDeps),

    notifications, profileImages,

    ...createShellActions(storeDeps),

    // Cashbook & bank reconciliation
    bankAccounts, bankRecons, bankStatementLines,
    addStatementLine: (line) => {
      const locked = systemSettings.accLockDates && bankRecons.some(r => r.bankAccountId === line.bankAccountId && r.month === line.month && r.status === 'reconciled')
      if (locked) { showToast('This reconciled bank period is locked. Reopen it before adding statement lines.', 'error'); return }
      setBankStatementLines(prev => [...prev, { ...line, id: uid() }])
    },
    updateStatementLine: (id, p) => {
      const line = bankStatementLines.find(l => l.id === id)
      const bankAccountId = p.bankAccountId ?? line?.bankAccountId
      const month = p.month ?? line?.month
      const locked = !!bankAccountId && !!month && systemSettings.accLockDates && bankRecons.some(r => r.bankAccountId === bankAccountId && r.month === month && r.status === 'reconciled')
      if (locked) { showToast('This reconciled bank period is locked. Reopen it before editing statement lines.', 'error'); return }
      setBankStatementLines(prev => prev.map(l => l.id === id ? { ...l, ...p } : l))
    },
    deleteStatementLine: (id) => {
      const line = bankStatementLines.find(l => l.id === id)
      const locked = !!line && systemSettings.accLockDates && bankRecons.some(r => r.bankAccountId === line.bankAccountId && r.month === line.month && r.status === 'reconciled')
      if (locked) { showToast('This reconciled bank period is locked. Reopen it before deleting statement lines.', 'error'); return }
      setBankStatementLines(prev => prev.filter(l => l.id !== id))
    },
    matchStatementLine: (statementId, entryId) => {
      const line = bankStatementLines.find(l => l.id === statementId)
      const locked = !!line && systemSettings.accLockDates && bankRecons.some(r => r.bankAccountId === line.bankAccountId && r.month === line.month && r.status === 'reconciled')
      if (locked) { showToast('This reconciled bank period is locked. Reopen it before changing matches.', 'error'); return }
      setBankStatementLines(prev => prev.map(l =>
        l.id === statementId ? { ...l, matchedEntryId: entryId } : l
      ))
    },
    unmatchStatementLine: (statementId) => {
      const line = bankStatementLines.find(l => l.id === statementId)
      const locked = !!line && systemSettings.accLockDates && bankRecons.some(r => r.bankAccountId === line.bankAccountId && r.month === line.month && r.status === 'reconciled')
      if (locked) { showToast('This reconciled bank period is locked. Reopen it before changing matches.', 'error'); return }
      setBankStatementLines(prev => prev.map(l =>
        l.id === statementId ? { ...l, matchedEntryId: undefined } : l
      ))
    },
    autoMatchStatements: (bankAccountId, month, cashbookEntries) => {
      const locked = systemSettings.accLockDates && bankRecons.some(r => r.bankAccountId === bankAccountId && r.month === month && r.status === 'reconciled')
      if (locked) { showToast('This reconciled bank period is locked. Reopen it before auto-matching.', 'error'); return 0 }
      const scoped = bankStatementLines.filter(
        l => l.bankAccountId === bankAccountId && l.month === month,
      )
      const { lines: matchedScoped, matchedCount } = autoMatchStatementLines({
        statementLines: scoped,
        cashbookEntries,
        bankAccountId,
        month,
      })
      const byId = new Map(matchedScoped.map(l => [l.id, l]))
      setBankStatementLines(prev => prev.map(l => byId.get(l.id) ?? l))
      return matchedCount
    },
    saveBankRecon: (recon) => {
      if (!canManageFullFinanceAction(currentUser())) {
        showToast('Only Finance or Director can save bank reconciliations', 'error'); return;
      }
      const user = currentUser()
      const existing = bankRecons.find(r => r.bankAccountId === recon.bankAccountId && r.month === recon.month)
      if (existing && existing.status === 'reconciled' && systemSettings.accLockDates && recon.status !== 'pending') {
        showToast('This reconciled bank period is locked. Reopen it before resaving.', 'error'); return
      }
      if (existing) {
        const updatedRecon = { ...existing, ...recon, reconciledBy: user?.name, reconciledAt: now() }
        setBankRecons(prev => prev.map(r => r.id === existing.id ? updatedRecon : r))
        addAuditLog(recon.status === 'pending' ? 'reopen_bank_recon' : 'update_bank_recon', `${recon.bankAccountId}/${recon.month}`, `Bank reconciliation ${recon.status === 'pending' ? 'reopened' : 'updated'} for ${recon.bankAccountId} ${recon.month}`)
      } else {
        const newRecon: BankRecon = { ...recon, id: uid(), reconciledBy: user?.name, reconciledAt: now() }
        setBankRecons(prev => [...prev, newRecon])
        addAuditLog('save_bank_recon', `${recon.bankAccountId}/${recon.month}`, `Bank reconciliation saved as ${recon.status}`)
      }
      showToast(recon.status === 'reconciled' ? 'Bank period reconciled and locked' : 'Bank reconciliation saved', 'success')
    },
    updateBankRecon: (id, p) => {
      const existing = bankRecons.find(r => r.id === id)
      if (existing?.status === 'reconciled' && systemSettings.accLockDates && p.status !== 'pending') {
        showToast('This reconciled bank period is locked. Reopen it before editing.', 'error'); return
      }
      setBankRecons(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
    },
    updateBankAccount: (id, p) => setBankAccountsState(prev => prev.map(a => a.id === id ? { ...a, ...p } : a)),
    addBankAccount: (a) => {
      const id = uid()
      setBankAccountsState(prev => [...prev, { ...a, id }])
      return id
    },
    deleteBankAccount: (id) => setBankAccountsState(prev => prev.filter(a => a.id !== id)),
    documentPaymentDetails,
    getDocumentPaymentDetails: (documentId) =>
      normalizeDocumentPaymentDetails(documentPaymentDetails[documentId]),
    setDocumentPaymentDetails: (documentId, details) => {
      if (!documentId) return
      const next = normalizeDocumentPaymentDetails(details)
      setDocumentPaymentDetailsState(prev => ({ ...prev, [documentId]: next }))
    },
    companySettings,
    systemSettings,

    sopDocuments,
    saveSopDocuments: setSopDocuments,
    sops, sopActuals,

    hrSops,
    hrPerfTargets,
    saveHrSops: setHrSops,
    saveHrPerfTargets: setHrPerfTargets,

    ...createSopActions(storeDeps),

    refSops,

    expenses,

    submitExpense: (e) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      const expenseRule = dbApprovalRules.find(r => r.approvalType === 'expense' && r.isActive)
      const approvalChain = buildExpenseApprovalChain(
        Number(e.amount) || 0,
        expenseRule?.thresholds,
      )
      // Strip receiptDataUrl from the expense object saved in deed_expenses.
      // Receipts are stored separately under expense_receipt_<id> via the API so
      // the deed_expenses blob stays small and loads instantly.
      const { receiptDataUrl: _receiptBlob, ...eMeta } = e as (typeof e & { receiptDataUrl?: string })
      const expense: Expense = {
        ...eMeta,
        id: uid(),
        ref: expenseRef(),
        submittedByUserId: user.id,
        submittedByName: user.name,
        submittedDate: now(),
        status: 'submitted',
        approvalChain,
        createdAt: now(),
      }
      // Upload the receipt blob separately (non-blocking)
      if (_receiptBlob) {
        fetch(`/api/expense-receipts/${expense.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataUrl: _receiptBlob,
            fileName: expense.receiptFileName,
            fileType: expense.receiptFileType,
            fileSize: expense.receiptFileSize,
          }),
        }).then(res => {
          if (!res.ok) throw new Error(String(res.status))
        }).catch(() => {
          // It used to fail silently, leaving a claim that says it has a
          // receipt the server never stored. Open the claim and attach it again.
          showToast('The receipt did not upload — open the claim and attach it again', 'error')
        })
      }
      setExpenses(prev => [expense, ...prev])
      // Notify finance / director approvers (not the submitter)
      notifyUsers({
        recipientRoles: ['director', 'finance_officer'],
        recipients: userIdsWithRoles(users, ['director', 'finance_officer'], user.id),
        type: 'expense',
        title: `Expense claim from ${expense.submittedByName}`,
        // The number is still provisional here; the server's EXP number replaces it a moment later.
        body: `${expense.description} · KES ${expense.amount.toLocaleString()}`,
        module: 'expenses',
        icon: '💰',
        entityKey: `expense:${expense.id}:submitted`,
        excludeUserId: user.id,
      })
      showToast('Expense claim submitted', 'success')
      return expense
    },

    reviewExpense: (id, approved, notes) => {
      const user = currentUser()
      if (!user) return
      if (!canManageFullFinanceAction(user)) {
        showToast('Only Finance or Director can review expenses', 'error'); return
      }
      const expense = expenses.find(e => e.id === id)
      if (!expense) return
      if (expense.status === 'reimbursed' || expense.status === 'paid') { showToast('Paid expenses cannot be reviewed again', 'error'); return }
      // The server refused the approval journal (closed period, …): put the
      // claim back as it was. It used to stay "approved" with a journal only
      // this browser had, so the books never showed the expense.
      const undoApproval = (journalRef: string) => {
        setExpenses(prev => prev.map(e => e.id === id ? expense : e))
        setJournalEntries(prev => prev.filter(j => j.ref !== journalRef))
      }

      const chain = expense.approvalChain
      if (chain?.length) {
        if (!canUserReviewExpense(user.role, chain)) {
          const pending = chain.find(s => s.status === 'pending')
          showToast(`This step requires ${pending?.role?.replace('_', ' ') ?? 'another approver'}`, 'error')
          return
        }
        const nextChain = advanceExpenseApproval({
          chain,
          approved,
          reviewerRole: user.role,
          reviewerName: user.name,
        })
        const fullyApproved = approved && expenseChainIsComplete(nextChain)
        const reviewedExpense: Expense = {
          ...expense,
          approvalChain: nextChain,
          status: !approved ? 'rejected' : fullyApproved ? 'approved' : 'submitted',
          reviewedByUserId: fullyApproved || !approved ? user.id : expense.reviewedByUserId,
          reviewedByName: fullyApproved || !approved ? user.name : expense.reviewedByName,
          reviewedDate: fullyApproved || !approved ? now() : expense.reviewedDate,
          reviewNotes: notes ?? expense.reviewNotes,
        }
        setExpenses(prev => prev.map(e => e.id === id ? reviewedExpense : e))
        if (fullyApproved && !journalEntries.some(j => j.ref === `JRN/EXP/${expense.ref}`)) {
          const journal = buildExpenseApprovalJournal(reviewedExpense)
          setJournalEntries(prev => [journal, ...prev])
          addAuditLog('post_expense', expense.ref, `Expense ${expense.ref} posted to journal ${journal.ref}`)
          void fetch('/api/expenses/post-journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'approval',
              expenseId: reviewedExpense.id,
              ref: reviewedExpense.ref,
              amount: reviewedExpense.amount,
              description: reviewedExpense.description,
              category: reviewedExpense.category,
              paymentMethod: reviewedExpense.paymentMethod,
              submittedByName: reviewedExpense.submittedByName,
              bankAccountId: journal.bankAccountId,
              date: journal.date,
            }),
          }).then(async res => {
            if (!res.ok) {
              const payload = await res.json().catch(() => null) as { error?: string } | null
              undoApproval(journal.ref)
              showToast(`${payload?.error || 'Expense journal posting failed'} — the approval was undone`, 'error')
            }
          }).catch(() => {
            undoApproval(journal.ref)
            showToast('Expense journal posting failed — the approval was undone', 'error')
          })
        }
        if (expense?.submittedByUserId) {
          const pending = nextChain.find(s => s.status === 'pending')
          notifyUsers({
            recipients: [expense.submittedByUserId],
            type: 'expense',
            title: !approved ? 'Expense claim rejected' : fullyApproved ? 'Expense claim approved ✓' : 'Expense claim — next approval',
            body: !approved
              ? `Your expense claim ${expense.ref} was rejected by ${user.name}.${notes ? ' Note: ' + notes : ''}`
              : fullyApproved
                ? `Your expense claim ${expense.ref} (${expense.description}) is fully approved.${notes ? ' Note: ' + notes : ''}`
                : `Your expense claim ${expense.ref} was approved by ${user.name}. Awaiting ${pending?.role?.replace('_', ' ') ?? 'next approver'}.`,
            module: 'expenses',
            path: `?id=${expense.id}`,
            icon: !approved ? '❌' : fullyApproved ? '💰' : '⏳',
            entityKey: `expense:${expense.id}:review`,
            excludeUserId: user.id,
          })
        }
        if (!approved) {
          showToast('Expense rejected', 'error')
        } else if (fullyApproved) {
          showToast('Expense approved and posted', 'success')
        } else {
          showToast('Step approved — awaiting next approver', 'success')
        }
        return
      }

      const reviewedExpense: Expense = { ...expense, status: approved ? 'approved' : 'rejected', reviewedByUserId: user.id, reviewedByName: user.name, reviewedDate: now(), reviewNotes: notes }
      setExpenses(prev => prev.map(e => e.id === id ? reviewedExpense : e))
      if (approved && !journalEntries.some(j => j.ref === `JRN/EXP/${expense.ref}`)) {
        const journal = buildExpenseApprovalJournal(reviewedExpense)
        setJournalEntries(prev => [journal, ...prev])
        addAuditLog('post_expense', expense.ref, `Expense ${expense.ref} posted to journal ${journal.ref}`)
        void fetch('/api/expenses/post-journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'approval',
            expenseId: reviewedExpense.id,
            ref: reviewedExpense.ref,
            amount: reviewedExpense.amount,
            description: reviewedExpense.description,
            category: reviewedExpense.category,
            paymentMethod: reviewedExpense.paymentMethod,
            submittedByName: reviewedExpense.submittedByName,
            bankAccountId: journal.bankAccountId,
            date: journal.date,
          }),
        }).then(async res => {
          if (!res.ok) {
            const payload = await res.json().catch(() => null) as { error?: string } | null
            undoApproval(journal.ref)
            showToast(`${payload?.error || 'Expense journal posting failed'} — the approval was undone`, 'error')
          }
        }).catch(() => {
          undoApproval(journal.ref)
          showToast('Expense journal posting failed — the approval was undone', 'error')
        })
      }
      if (expense?.submittedByUserId) {
        notifyUsers({
          recipients: [expense.submittedByUserId],
          type: 'expense',
          title: approved ? 'Expense claim approved ✓' : 'Expense claim rejected',
          body: `Your expense claim ${expense.ref} (${expense.description}) has been ${approved ? 'approved' : 'rejected'} by ${user.name}.${notes ? ' Note: ' + notes : ''}`,
          module: 'expenses',
          path: `?id=${expense.id}`,
          icon: approved ? '💰' : '❌',
          entityKey: `expense:${expense.id}:review`,
          excludeUserId: user.id,
        })
      }
      showToast(approved ? 'Expense approved and posted' : 'Expense rejected', approved ? 'success' : 'error')
    },

    payExpense: (id, method, bankAccountId, reference, paymentDate, notes) => {
      const user = currentUser()
      if (!user) return
      if (!canManageFullFinanceAction(user)) {
        showToast('Only Finance or Director can pay approved expenses', 'error'); return
      }
      const expense = expenses.find(e => e.id === id)
      if (!expense) return
      if (expense.paymentMethod === 'reimbursement') {
        showToast('Staff-paid claims must use Reimburse, not Pay', 'error'); return
      }
      if (expense.status !== 'approved') {
        showToast('Expense must be approved before payment', 'error'); return
      }
      const actualBankId = bankAccountIdForMethod(method || expense.paymentMethod, bankAccountId)
      const paidDate = paymentDate || now()
      const paidExpense: Expense = {
        ...expense,
        status: 'paid',
        paidDate,
        paymentBankAccount: actualBankId,
        paymentReference: reference,
        reviewNotes: notes ?? expense.reviewNotes,
      }
      const journalRef = `JRN/EXPPAY/${expense.ref}`
      if (journalEntries.some(j => j.ref === journalRef)) {
        showToast('This expense payment was already posted', 'info')
        return
      }
      const journal = buildExpenseCompanyPaymentJournal(paidExpense, actualBankId, method, paidDate)
      setExpenses(prev => prev.map(e => e.id === id ? paidExpense : e))
      setJournalEntries(prev => [journal, ...prev])
      addAuditLog('post_expense_payment', expense.ref, `Expense payment ${expense.ref} posted to ${journal.ref}${reference ? ` (Ref: ${reference})` : ''}`)
      void fetch('/api/expenses/post-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'payment',
          expenseId: paidExpense.id,
          ref: paidExpense.ref,
          amount: paidExpense.amount,
          paymentMethod: method || paidExpense.paymentMethod,
          bankAccountId: actualBankId,
          date: paidDate,
        }),
      }).then(async res => {
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null
          setExpenses(prev => prev.map(e => e.id === id ? expense : e))
          setJournalEntries(prev => prev.filter(j => j.ref !== journal.ref))
          showToast(payload?.error || 'Expense payment posting failed', 'error')
        }
      }).catch(() => {
        setExpenses(prev => prev.map(e => e.id === id ? expense : e))
        setJournalEntries(prev => prev.filter(j => j.ref !== journal.ref))
        showToast('Expense payment posting failed', 'error')
      })
      showToast('Expense marked paid', 'success')
    },

    reimburseExpense: (id, notes, method, bankAccountId, reference, paymentDate) => {
      const user = currentUser()
      if (!user) return
      if (!canManageFullFinanceAction(user)) {
        showToast('Only Finance or Director can reimburse expenses', 'error'); return
      }
      const expense = expenses.find(e => e.id === id)
      if (!expense) return
      if (expense.paymentMethod !== 'reimbursement') { showToast('Only staff reimbursement claims can be reimbursed', 'error'); return }
      if (expense.status !== 'approved') { showToast('Expense must be approved before reimbursement', 'error'); return }
      const actualBankId = bankAccountIdForMethod(method, bankAccountId)
      const reimbursementDate = paymentDate || now()
      const reimbursedExpense: Expense = {
        ...expense,
        status: 'reimbursed',
        reviewNotes: notes ?? expense.reviewNotes,
        reimbursementMethod: method,
        reimbursementBankAccount: actualBankId,
        reimbursementReference: reference,
        reimbursementDate,
      }
      const journalRef = `JRN/RIM/${expense.ref}`
      if (journalEntries.some(j => j.ref === journalRef)) {
        showToast('This reimbursement was already posted', 'info')
        return
      }
      const journal = buildExpenseReimbursementJournal(reimbursedExpense, actualBankId, reimbursementDate)
      setExpenses(prev => prev.map(e => e.id === id ? reimbursedExpense : e))
      setJournalEntries(prev => [journal, ...prev])
      addAuditLog('post_reimbursement', expense.ref, `Expense reimbursement ${expense.ref} posted to journal ${journal.ref}${reference ? ` (Ref: ${reference})` : ''}`)
      void fetch('/api/expenses/post-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'reimbursement',
          expenseId: reimbursedExpense.id,
          ref: reimbursedExpense.ref,
          amount: reimbursedExpense.amount,
          submittedByName: reimbursedExpense.submittedByName,
          bankAccountId: actualBankId,
          date: journal.date,
        }),
      }).then(async res => {
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null
          setExpenses(prev => prev.map(e => e.id === id ? expense : e))
          setJournalEntries(prev => prev.filter(j => j.ref !== journal.ref))
          showToast(payload?.error || 'Expense reimbursement posting failed', 'error')
        }
      }).catch(() => {
        setExpenses(prev => prev.map(e => e.id === id ? expense : e))
        setJournalEntries(prev => prev.filter(j => j.ref !== journal.ref))
        showToast('Expense reimbursement posting failed', 'error')
      })
      showToast('Expense reimbursed and posted', 'success')
    },

    outsourceVendors, outsourceJobs, outsourcePayments,

    ...createRepairActions(storeDeps),

    // Deposits
    deposits,
    createDeposit: async (d) => {
      const user = currentUser()
      if (!user) throw new Error('Please log in to continue')

      const { initialPayment = 0, payMethod = 'cash', payRef, ...depositInput } = d
      const paid = Number(initialPayment)
      if (!Number.isFinite(paid) || paid <= 0) {
        throw new Error('Initial payment must be greater than zero')
      }
      if (
        !depositInput.customerId ||
        !depositInput.customerName.trim() ||
        depositInput.items.length === 0 ||
        depositInput.items.some(item =>
          !item.productId || !item.productName.trim() || item.qty <= 0 || item.unitPrice < 0
        )
      ) {
        throw new Error('Complete the customer and every reserved item before saving')
      }
      if (paid > depositInput.totalValue) {
        throw new Error('Initial payment cannot exceed the order total')
      }

      // Allocate the linked quotation reference before persisting either record.
      // If allocation fails, the deposit is not partially created.
      const quotationRef = await storeCtxRef.current!.allocateDocRef('QUO')
      const provisionalId = uid()
      const response = await fetch('/api/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...depositInput,
          id: provisionalId,
          initialPayment: paid,
          payMethod,
          payRef,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(String(body?.error ?? 'Could not save deposit'))
      }

      const deposit = body as Deposit
      setDeposits(prev => [deposit, ...prev])
      // No journal is built here. /api/deposits posted the receipt journal in
      // the same transaction that created this deposit, as
      // JRN/DEP/<ref>/<full payment id>. The local copy used a truncated id,
      // so the two refs never matched, the mirror could not dedupe them, and
      // every deposit receipt landed in the ledger twice.

      const soLines = deposit.items.map(item => ({
        id: uid(),
        productId: item.productId,
        productName: item.productName,
        qty: item.qty,
        unitPrice: item.unitPrice,
        discount: 0,
        taxRate: 0,
        subtotal: item.total,
        serialIds: [],
        accountCode: '',
      }))
      const saleOrder: SaleOrder = {
        id: uid(),
        ref: quotationRef,
        status: 'quotation',
        customerId: deposit.customerId,
        customerName: deposit.customerName,
        date: now(),
        validUntil: addDays(now(), 30),
        lines: soLines,
        ...calcSO(soLines),
        notes: `Linked to deposit ${deposit.ref}`,
        createdByUserId: user.id,
        createdByName: user.name,
      }
      const quotationResponse = await fetch('/api/sale-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saleOrder),
      })
      if (quotationResponse.ok) {
        setSaleOrders(prev => [saleOrder, ...prev])
      } else {
        showToast(
          `${deposit.ref} was created, but its linked quotation could not be saved. Please retry from Sales.`,
          'error',
        )
      }
      return deposit
    },
    addDepositPayment: (depositId, p) => {
      let updatedDeposit: Deposit | undefined
      let paymentToSync: DepositPayment | undefined
      setDeposits(prev => prev.map(d => {
        if (d.id !== depositId) return d
        const amount = Math.min(Math.max(Number(p.amount) || 0, 0), d.balance)
        if (amount <= 0) return d
        const payment: DepositPayment = { ...p, id: uid(), amount }
        const totalPaid = d.totalPaid + payment.amount
        const balance = Math.max(0, d.totalValue - totalPaid)
        const status: DepositStatus = balance <= 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'active'
        updatedDeposit = { ...d, payments: [...d.payments, payment], totalPaid, balance, status }
        paymentToSync = payment
        return updatedDeposit
      }))
      if (updatedDeposit && paymentToSync) {
        // The receipt journal is posted by /api/deposits/[id]/payments. The
        // local copy keyed its ref on a truncated payment id that never
        // matched the server's, so the ledger took the receipt twice.
        // idempotencyKey makes a retry safe: the service returns the existing
        // deposit rather than taking a second payment.
        syncOrWarn(`/api/deposits/${depositId}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: paymentToSync.amount,
            method: paymentToSync.method,
            ref: paymentToSync.ref,
            idempotencyKey: paymentToSync.id,
          }),
        }, message => showToast(message, 'error'), 'Deposit payment could not be recorded — please retry')
        showToast('Payment recorded', 'success')
      } else {
        showToast('Payment must be greater than zero and within the remaining balance', 'error')
      }
    },
    completeDeposit: (depositId) => {
      const deposit = deposits.find(d => d.id === depositId)
      if (!deposit) return
      if (deposit.status !== 'fully_paid') {
        showToast('Only fully paid deposits can be marked as collected', 'error')
        return
      }
      // A customer deposit is a liability until the sale is invoiced. Clearing
      // 3100 straight into revenue skips VAT and the AR subledger, which is why
      // /complete requires an invoice and refuses to recognise revenue itself.
      //
      // This used to build the entry locally — crediting 5000 when no invoice
      // was linked — and POST to /complete with an empty body, which failed its
      // schema every time. sync() swallowed the 422, so the liability looked
      // cleared while the server had done nothing, and the only thing reaching
      // the ledger was the blob mirror replaying the wrong journal.
      let appliedAmount = 0
      let appliedInvoiceId: string | undefined
      if (deposit.totalPaid > 0) {
        const linkedSo = saleOrders.find(s => (s.notes || '').includes(deposit.ref))
        const linkedInv = linkedSo
          ? invRef.current.find(i =>
              i.type === 'customer_invoice'
              && i.status === 'posted'
              && i.saleOrderId === linkedSo.id
              && (i.total - i.amountPaid) > 0)
          : undefined
        if (!linkedInv) {
          showToast(
            `Post the invoice for ${deposit.ref}'s sale order first — a deposit cannot be taken to revenue directly`,
            'error',
          )
          return
        }
        appliedInvoiceId = linkedInv.id
        appliedAmount = Math.min(deposit.totalPaid, linkedInv.total - linkedInv.amountPaid)
        if (appliedAmount > 0) {
          const payment: InvoicePayment = {
            id: uid(),
            date: now(),
            amount: appliedAmount,
            method: 'deposit_apply',
            reference: deposit.ref,
            recordedBy: currentUser()?.name || 'Finance',
          }
          setInvoices(prev => prev.map(i => {
            if (i.id !== linkedInv.id) return i
            return {
              ...i,
              amountPaid: i.amountPaid + payment.amount,
              payments: [...(i.payments || []), payment],
              notes: `${i.notes || ''}\nApplied deposit ${deposit.ref} (${fmtKes(payment.amount)})`.trim(),
            }
          }))
        }
      }
      setDeposits(prev => prev.map(d =>
        d.id === depositId ? { ...d, status: 'completed' as DepositStatus, completedAt: now() } : d
      ))
      syncOrWarn(`/api/deposits/${depositId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: appliedInvoiceId,
          ...(appliedAmount > 0 ? { amount: appliedAmount } : {}),
        }),
      }, message => showToast(message, 'error'), 'Deposit could not be applied to its invoice — please retry')
      showToast('Deposit applied to its invoice — liability cleared', 'success')
    },
    cancelDeposit: (depositId, reason) => {
      // The refund journal is posted by /api/deposits/[id]/cancel as
      // JRN/DEP/REFUND/<ref>/<paymentId>. The local copy used
      // JRN/REFUND/<ref> — a different ref, so the mirror added a second
      // reversal and the deposit liability was cleared twice.
      setDeposits(prev => prev.map(d =>
        d.id === depositId ? { ...d, status: 'cancelled' as DepositStatus, cancelledAt: now(), cancelReason: reason } : d
      ))
      syncOrWarn(`/api/deposits/${depositId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }, message => showToast(message, 'error'), 'Deposit cancellation could not be recorded — please retry')
      showToast('Deposit cancelled', 'info')
    },

    // Holdovers are saved to the holdovers table (the deed_holdovers copy is frozen).
    holdovers,

    ...createInventoryActions(storeDeps),

    companyAssets,
    createCompanyAsset: (input) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can record company property', 'error')
        return null
      }
      const error = validateCompanyAssetInput(input, companyAssets)
      if (error) { showToast(error, 'error'); return null }
      const serialId = input.serialId?.trim() || undefined
      if (serialId) {
        const serial = serialRef.current.find(s => s.id === serialId)
        if (!serial || serial.status !== 'available') {
          showToast('Trading serial must be available in stock', 'error')
          return null
        }
      }
      const at = new Date().toISOString()
      const status = input.status && ['draft', 'in_use', 'in_storage'].includes(input.status) ? input.status : 'draft'
      const books = withBookDefaults({
        category: input.category,
        costKes: Number(input.costKes) || 0,
        usefulLifeMonths: input.usefulLifeMonths,
        residualKes: input.residualKes,
        depreciationMethod: input.depreciationMethod,
        accumDeprKes: input.accumDeprKes,
      })
      const serial = serialId ? serialRef.current.find(s => s.id === serialId) : undefined
      let record: CompanyAsset = {
        id: uid(),
        ref: nextCompanyAssetRef(companyAssets.map(a => a.ref)),
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        category: input.category,
        assetClass: input.assetClass,
        ppeAccountCode: resolvedPpeAccountCode(input),
        qty: Number(input.qty),
        unit: (input.unit || 'each').trim() || 'each',
        assetTag: input.assetTag?.trim() || undefined,
        serialNumber: input.serialNumber?.trim() || serial?.serial || undefined,
        serialId,
        locationName: input.locationName.trim(),
        custodianEmployeeId: input.custodianEmployeeId?.trim() || undefined,
        custodianName: input.custodianName?.trim() || undefined,
        status,
        condition: input.condition,
        acquiredDate: input.acquiredDate,
        acquiredVia: input.acquiredVia,
        supplierName: input.supplierName?.trim() || undefined,
        purchaseOrderRef: input.purchaseOrderRef?.trim() || undefined,
        billRef: input.billRef?.trim() || undefined,
        expenseRef: input.expenseRef?.trim() || undefined,
        costKes: books.costKes,
        usefulLifeMonths: books.usefulLifeMonths,
        residualKes: books.residualKes,
        depreciationMethod: books.depreciationMethod,
        accumDeprKes: books.accumDeprKes,
        taxWdvKes: initialTaxWdv(books.costKes),
        notes: input.notes?.trim() || undefined,
        history: [
          historyEntry({
            at,
            action: 'create',
            toStatus: status,
            toLocation: input.locationName.trim(),
            userId: user.id,
            userName: user.name,
            note: input.acquiredVia === 'opening' ? 'Opening register — no journal posted' : undefined,
          }),
        ],
        createdByUserId: user.id,
        createdByName: user.name,
        createdAt: at,
        updatedAt: at,
      }
      if (serialId) setSerialCapitalised(serialId)
      record = capitaliseCompanyAsset(record)
      setCompanyAssets(prev => [record, ...prev])
      addAuditLog('create_company_asset', record.ref, `${record.name} (${record.qty} ${record.unit}) at ${record.locationName}`)
      showToast(record.capitaliseJournalRef ? `${record.ref} recorded and capitalised` : `${record.ref} recorded`, 'success')
      return record
    },
    updateCompanyAsset: (id, input) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can edit company property', 'error')
        return
      }
      const existing = companyAssets.find(a => a.id === id)
      if (!existing) { showToast('Asset item not found', 'error'); return }
      const error = validateCompanyAssetInput(input, companyAssets, id)
      if (error) { showToast(error, 'error'); return }
      const at = new Date().toISOString()
      const nextStatus = existing.status === 'draft' && input.status && ['draft', 'in_use', 'in_storage'].includes(input.status)
        ? input.status
        : existing.status
      const books = withBookDefaults({
        category: input.category,
        costKes: Number(input.costKes) || 0,
        usefulLifeMonths: input.usefulLifeMonths ?? existing.usefulLifeMonths,
        residualKes: input.residualKes ?? existing.residualKes,
        depreciationMethod: input.depreciationMethod ?? existing.depreciationMethod,
        accumDeprKes: existing.accumDeprKes,
      })
      let next: CompanyAsset = {
        ...existing,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        category: input.category,
        assetClass: input.assetClass,
        ppeAccountCode: resolvedPpeAccountCode(input),
        qty: Number(input.qty),
        unit: (input.unit || existing.unit || 'each').trim() || 'each',
        assetTag: input.assetTag?.trim() || undefined,
        serialNumber: input.serialNumber?.trim() || existing.serialNumber,
        locationName: input.locationName.trim(),
        custodianEmployeeId: input.custodianEmployeeId?.trim() || undefined,
        custodianName: input.custodianName?.trim() || undefined,
        status: nextStatus,
        condition: input.condition,
        acquiredDate: input.acquiredDate,
        acquiredVia: input.acquiredVia,
        supplierName: input.supplierName?.trim() || undefined,
        purchaseOrderRef: input.purchaseOrderRef?.trim() || undefined,
        billRef: input.billRef?.trim() || undefined,
        expenseRef: input.expenseRef?.trim() || undefined,
        costKes: books.costKes,
        usefulLifeMonths: books.usefulLifeMonths,
        residualKes: books.residualKes,
        depreciationMethod: books.depreciationMethod,
        notes: input.notes?.trim() || undefined,
        updatedAt: at,
        history: nextStatus !== existing.status
          ? [...existing.history, historyEntry({
              at,
              action: 'status',
              fromStatus: existing.status,
              toStatus: nextStatus,
              userId: user.id,
              userName: user.name,
            })]
          : existing.history,
      }
      if (!existing.taxWdvKes) next.taxWdvKes = initialTaxWdv(books.costKes)
      next = capitaliseCompanyAsset(next)
      setCompanyAssets(prev => prev.map(a => a.id === id ? next : a))
      showToast('Asset item updated', 'success')
    },
    deleteCompanyAsset: (id) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can delete company property', 'error')
        return
      }
      const existing = companyAssets.find(a => a.id === id)
      if (!existing) return
      if (!canDeleteCompanyAsset(existing.status)) {
        showToast('Only draft items can be deleted. Dispose or write off live records.', 'error')
        return
      }
      if (existing.serialId) {
        const serial = serialRef.current.find(s => s.id === existing.serialId)
        if (serial?.status === 'capitalised') setSerialCapitalised(existing.serialId, true)
      }
      setCompanyAssets(prev => prev.filter(a => a.id !== id))
      addAuditLog('delete_company_asset', existing.ref, `Deleted draft ${existing.name}`)
      showToast(`${existing.ref} deleted`, 'info')
    },
    moveCompanyAsset: (id, locationName, note) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can move company property', 'error')
        return
      }
      const existing = companyAssets.find(a => a.id === id)
      if (!existing) return
      const result = applyMove(existing, locationName, { userId: user.id, userName: user.name, at: new Date().toISOString() }, note)
      if (!result.ok) { showToast(result.error, 'error'); return }
      setCompanyAssets(prev => prev.map(a => a.id === id ? result.asset : a))
      addAuditLog('move_company_asset', existing.ref, `${existing.locationName} → ${result.asset.locationName}`)
      showToast(`${existing.ref} moved to ${result.asset.locationName}`, 'success')
    },
    setCompanyAssetCustodian: (id, custodian, note) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can change custodians', 'error')
        return
      }
      const existing = companyAssets.find(a => a.id === id)
      if (!existing) return
      const result = applyCustodian(existing, custodian, { userId: user.id, userName: user.name, at: new Date().toISOString() }, note)
      if (!result.ok) { showToast(result.error, 'error'); return }
      setCompanyAssets(prev => prev.map(a => a.id === id ? result.asset : a))
      showToast(result.asset.custodianName ? `Custodian set to ${result.asset.custodianName}` : 'Custodian cleared', 'success')
    },
    setCompanyAssetStatus: async (id, status, note, opts) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can change property status', 'error')
        return
      }
      const existing = companyAssets.find(a => a.id === id)
      if (!existing) return
      const at = new Date().toISOString()
      const result = applyStatusChange(existing, status, { userId: user.id, userName: user.name, at }, note)
      if (!result.ok) { showToast(result.error, 'error'); return }
      let next = capitaliseCompanyAsset(result.asset)
      if (status === 'under_repair' && opts?.createRepair && !existing.repairId) {
        const companyName = String(companySettings.name || '').trim()
        const self = contacts.find(c => {
          const n = String(c.name || '').trim().toLowerCase()
          const t = String(c.tradingName || '').trim().toLowerCase()
          const target = companyName.toLowerCase()
          return c.isCustomer && target && (n === target || t === target)
        })
        if (!self) {
          showToast('Add a customer contact named like the company to open a repair job', 'error')
        } else {
          const repair = await storeCtxRef.current?.createRepair(
            self.id,
            self.name,
            existing.name,
            existing.serialNumber || existing.assetTag || existing.ref,
            note || `Company property ${existing.ref} under repair`,
          )
          if (repair) {
            next = {
              ...next,
              repairId: repair.id,
              repairRef: repair.ref,
              history: [
                ...next.history,
                historyEntry({
                  at,
                  action: 'repair_job',
                  userId: user.id,
                  userName: user.name,
                  note: repair.ref,
                }),
              ],
            }
          }
        }
      }
      setCompanyAssets(prev => prev.map(a => a.id === id ? next : a))
      addAuditLog('update_company_asset', existing.ref, `${existing.status} → ${status}`)
      showToast(`${existing.ref} marked ${status.replace(/_/g, ' ')}`, 'success')
    },
    disposeCompanyAsset: (id, qty, opts) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can dispose company property', 'error')
        return
      }
      const existing = companyAssets.find(a => a.id === id)
      if (!existing) return
      const at = new Date().toISOString()
      const proceeds = Number(opts?.proceedsKes) || 0
      const suffix = qty < existing.qty ? `P${(existing.disposedQty ?? 0) + qty}` : undefined
      const draft = existing.assetClass === 'capital'
        ? buildDisposalJournal(existing, qty, proceeds, at.slice(0, 10), '2211 - Petty Cash', suffix)
        : null
      const journalRef = pushPpeJournal(draft)
      const result = applyDispose(existing, qty, { userId: user.id, userName: user.name, at }, opts)
      if (!result.ok) { showToast(result.error, 'error'); return }
      const next = {
        ...result.asset,
        disposalJournalRef: result.asset.status === 'disposed' ? (journalRef || result.asset.disposalJournalRef) : result.asset.disposalJournalRef,
      }
      if (next.status === 'disposed' && existing.serialId) {
        const serial = serialRef.current.find(s => s.id === existing.serialId)
        if (serial?.status === 'capitalised') {
          setSerials(prev => prev.map(s => s.id === existing.serialId ? { ...s, status: 'written_off' } : s))
        }
      }
      setCompanyAssets(prev => prev.map(a => a.id === id ? next : a))
      addAuditLog('dispose_company_asset', existing.ref, next.status === 'disposed' ? 'Disposed' : `Disposed ${qty} of ${existing.qty}`)
      showToast(next.status === 'disposed' ? `${existing.ref} disposed` : `${existing.ref} quantity reduced`, 'success')
    },
    writeOffCompanyAsset: (id, reason) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can write off company property', 'error')
        return
      }
      const existing = companyAssets.find(a => a.id === id)
      if (!existing) return
      const at = new Date().toISOString()
      const draft = existing.assetClass === 'capital'
        ? buildDisposalJournal(existing, existing.qty, 0, at.slice(0, 10))
        : null
      const journalRef = pushPpeJournal(draft)
      const result = applyWriteOff(existing, { userId: user.id, userName: user.name, at }, reason)
      if (!result.ok) { showToast(result.error, 'error'); return }
      const next = { ...result.asset, disposalJournalRef: journalRef || result.asset.disposalJournalRef }
      if (existing.serialId) {
        const serial = serialRef.current.find(s => s.id === existing.serialId)
        if (serial?.status === 'capitalised') {
          setSerials(prev => prev.map(s => s.id === existing.serialId ? { ...s, status: 'written_off' } : s))
        }
      }
      setCompanyAssets(prev => prev.map(a => a.id === id ? next : a))
      addAuditLog('write_off_company_asset', existing.ref, reason || 'Written off')
      showToast(`${existing.ref} written off`, 'info')
    },
    runCompanyAssetDepreciation: (period) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'viewCompanyProperty')) {
        showToast('Only Finance, Admin, or a Director can run depreciation', 'error')
        return
      }
      const key = period && /^\d{4}-\d{2}$/.test(period) ? period : periodKey()
      const already = journalEntries.some(j => j.ref === depreciationJournalRef(key))
      if (already) {
        showToast(`Depreciation ${key} is already posted`, 'info')
        return
      }
      const [yearStr, monthStr] = key.split('-')
      const year = Number(yearStr)
      const month = Number(monthStr)
      const date = new Date(year, month, 0).toISOString().slice(0, 10)
      const charges: Array<{ asset: CompanyAsset; amount: number }> = []
      const nextAssets = companyAssets.map(asset => {
        if (!canDepreciateAsset(asset)) return asset
        if (periodAlreadyRun(asset.lastDepreciatedPeriod, key)) return asset
        const amount = monthlyBookDepreciation(asset)
        let next = applyBookDepreciationCharge(asset, amount, key)
        const kra = applyKraAnnualAllowance(next, year)
        next = kra.asset
        if (amount > 0) charges.push({ asset, amount })
        return next
      })
      const draft = buildDepreciationJournal(key, charges, date)
      const ref = pushPpeJournal(draft)
      setCompanyAssets(nextAssets)
      addAuditLog('depreciate_company_assets', key, ref ? `${charges.length} assets · ${ref}` : 'No book charge this period')
      showToast(ref ? `Posted depreciation ${key}` : `No depreciation to post for ${key}`, ref ? 'success' : 'info')
    },
    linkSerialToCompanyAsset: (assetId, serialId) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return }
      if (!userCan(user, 'manageCompanyProperty')) {
        showToast('Only a Director or Admin Officer can link a trading serial', 'error')
        return
      }
      const existing = companyAssets.find(a => a.id === assetId)
      if (!existing) { showToast('Asset item not found', 'error'); return }
      if (existing.serialId) { showToast('This item already has a trading serial', 'error'); return }
      const serial = serialRef.current.find(s => s.id === serialId)
      if (!serial || serial.status !== 'available') {
        showToast('Trading serial must be available in stock', 'error')
        return
      }
      const at = new Date().toISOString()
      let next: CompanyAsset = {
        ...existing,
        serialId: serial.id,
        serialNumber: existing.serialNumber || serial.serial,
        updatedAt: at,
        history: [
          ...existing.history,
          historyEntry({
            at,
            action: 'link_serial',
            userId: user.id,
            userName: user.name,
            note: serial.serial,
          }),
        ],
      }
      setSerialCapitalised(serial.id)
      next = capitaliseCompanyAsset(next)
      setCompanyAssets(prev => prev.map(a => a.id === assetId ? next : a))
      showToast(`${existing.ref} linked to serial ${serial.serial}`, 'success')
    },

    // ── Outbound Release Checkpoint ─────────────────────────────────────────
    outboundReleases,
    showToast,
    users, currentUserId, currentUser: currentUser(),

    ...createHrActions(storeDeps),

    // ── Chart of Accounts ──────────────────────────────────────────────────────
    // The chart of accounts is saved to account_codes; the deed_accounts screen copy is frozen.
    addAccount: (a) => {
      const account = { ...a, id: uid() }
      setAccounts(p => [...p, account])
      void saveAccountToServer('POST', '/api/accounting/accounts', account).then(error => {
        if (!error) return
        setAccounts(p => p.filter(x => x.id !== account.id))
        showToast(`Account ${a.code} not saved: ${error}`, 'error')
      })
      showToast(`Account ${a.code} added`)
      return account
    },
    updateAccount: (id, p) => {
      const before = accountRef.current.find(a => a.id === id)
      if (!before) return
      const next = { ...before, ...p }
      setAccounts(prev => prev.map(a => a.id === id ? next : a))
      void saveAccountToServer('PUT', `/api/accounting/accounts/${encodeURIComponent(id)}`, next).then(error => {
        if (!error) return
        setAccounts(prev => prev.map(a => a.id === id ? before : a))
        showToast(`Account ${before.code} not saved: ${error}`, 'error')
      })
      showToast('Account updated')
    },

    refreshProductCatalog,

    // ── Invoices ──────────────────────────────────────────────────────────────
    createManualInvoice: (type, partnerId, partnerName, dueDate, lines, vatRate, notes = '', documentDate, customerPoNumber) => {
      if (type === 'customer_invoice') {
        // Laptops and other serial-tracked machines leave stock only through a
        // validated delivery or the POS till (lib/sales/serial-invoice-gate.ts).
        const typed = new Set(lines
          .filter(l => (l.type ?? 'item') !== 'section')
          .map(l => String(l.desc ?? '').trim().replace(/\s+/g, ' ').toLowerCase())
          .filter(Boolean))
        const machine = prodRef.current.find(p =>
          (p.requiresSerial || String(p.trackingMethod ?? '').toUpperCase() === 'SERIAL')
          && typed.has(String(p.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()))
        if (machine) {
          showToast(`${machine.name} is serial-tracked: sell it through a sale order and validate the delivery (or at the POS till), so the machine leaves stock with its serial number.`, 'error')
          return null
        }
      }
      const builtLines: InvoiceLine[] = lines
        .filter(l => {
          if ((l.type ?? 'item') === 'section') return !!String(l.desc || '').trim()
          return true
        })
        .map(l => {
          if ((l.type ?? 'item') === 'section') {
            return {
              id: uid(),
              lineType: 'section' as const,
              description: String(l.desc).trim(),
              qty: 0,
              unitPrice: 0,
              taxRate: 0,
              subtotal: 0,
            }
          }
          const qty = Number(l.qty) || 1
          const unitPrice = Number(l.price) || 0
          const taxRate = vatRate > 0 ? vatRate : Number(l.tax) || 0
          const discountPct = Math.min(100, Math.max(0, Number(l.discount) || 0))
          const gross = qty * unitPrice
          const discountAmount = Math.round(gross * discountPct) / 100
          const subtotal = Math.max(0, gross - discountAmount)
          return {
            id: uid(),
            lineType: 'item' as const,
            description: l.desc,
            qty,
            unitPrice,
            taxRate,
            ...(discountPct > 0 ? { discountPct } : {}),
            ...(String(l.account ?? '').trim() ? { accountCode: String(l.account).trim() } : {}),
            subtotal,
          }
        })
      const itemLines = builtLines.filter(l => l.lineType !== 'section')
      const subtotal = itemLines.reduce((s, l) => s + l.subtotal, 0)
      const taxTotal = itemLines.reduce((s, l) => s + Math.round(l.subtotal * l.taxRate / 100), 0)
      const invoice: Invoice = {
        id: uid(),
        // Placeholder ref — the official number is assigned when posted.
        ref: draftInvoiceRef(type),
        type,
        status: 'draft',
        partnerId,
        partnerName,
        date: documentDate || now(),
        dueDate: dueDate || addDays(now(), 0),
        lines: builtLines,
        subtotal,
        taxTotal,
        total: subtotal + taxTotal,
        amountPaid: 0,
        notes,
        ...(customerPoNumber?.trim() ? { customerPoNumber: customerPoNumber.trim() } : {}),
      }
      setInvoices(prev => [invoice, ...prev])
      void saveInvoiceToServer(invoice, msg => showToast(msg, 'error'))
      showToast(`${type === 'vendor_bill' ? 'Bill' : 'Invoice'} ${invoice.ref} created`, 'success')
      return invoice
    },

    importOpeningBalances: async (invoices) => {
      // Server first: the posted-at-create path validates dates and the
      // fiscal lock and posts the journal exactly once. Only documents the
      // server accepted are added here, so a refused row leaves nothing behind.
      const saved: Invoice[] = []
      const failed: string[] = []
      for (const invoice of invoices) {
        let reason = ''
        const ok = await saveInvoiceToServer(invoice, msg => { reason = msg })
        if (ok) saved.push(invoice)
        else failed.push(`${invoice.ref} (${invoice.partnerName}): ${reason || 'not saved'}`)
      }
      if (saved.length) setInvoices(prev => [...saved.filter(inv => !prev.some(p => p.id === inv.id)), ...prev])
      return { saved, failed }
    },

    moveInvoiceLine: (invoiceId, lineId, direction) => {
      const inv = invRef.current.find(i => i.id === invoiceId)
      if (!inv) return
      if (inv.status !== 'draft') {
        showToast('Only draft invoices can reorder lines', 'error')
        return
      }
      const index = (inv.lines || []).findIndex(l => l.id === lineId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= (inv.lines || []).length) return
      const lines = [...(inv.lines || [])]
      ;[lines[index], lines[target]] = [lines[target], lines[index]]
      storeCtxRef.current!.updateInvoice(invoiceId, { lines })
    },

    addInvoiceSection: (invoiceId, title) => {
      const inv = invRef.current.find(i => i.id === invoiceId)
      if (!inv) return
      if (inv.status !== 'draft') {
        showToast('Only draft invoices can add sections', 'error')
        return
      }
      const sectionTitle = String(title ?? '').trim() || 'Section'
      const lines = [...(inv.lines || []), {
        id: uid(),
        lineType: 'section' as const,
        description: sectionTitle,
        qty: 0,
        unitPrice: 0,
        taxRate: 0,
        subtotal: 0,
      }]
      storeCtxRef.current!.updateInvoice(invoiceId, { lines })
    },

    updateInvoice: (id, p) => {
      const existing = invRef.current.find(i => i.id === id)
      if (!existing) return
      const protectedStatus = existing.status !== 'draft' && existing.status !== 'cancelled'
      const cancelling = p.status === 'cancelled'
      // Allow linking a rider delivery job / address on posted invoices without unlocking lines.
      const keys = Object.keys(p)
      const deliveryLinkOnly = keys.length > 0 && keys.every(k => k === 'deliveryJobId' || k === 'deliveryAddress')
      if (protectedStatus && !cancelling && !deliveryLinkOnly && systemSettings.secDisableInvoiceEditAfterValidation) {
        showToast('Posted documents are locked. Reset to draft first, then edit and save.', 'error')
        return
      }
      if (cancelling && existing.status !== 'cancelled') {
        const related = journalEntries.filter(j => j.invoiceId === id && !j.ref.startsWith('REV/'))
        const reversals = related
          .filter(j => !journalEntries.some(existingJournal => existingJournal.ref === `REV/${j.ref}`))
          .map(j => buildReversalJournal(j, existing.ref, `${existing.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`))
        if (reversals.length > 0) {
          setJournalEntries(prev => [...reversals, ...prev])
          addAuditLog('reverse_invoice', existing.ref, `${existing.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled with ${reversals.length} reversal journal${reversals.length === 1 ? '' : 's'}`)
        } else {
          addAuditLog('cancel_invoice', existing.ref, `${existing.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`)
        }
      }
      setInvoices(prev => {
        const next = prev.map(i => i.id === id ? { ...i, ...p } : i)
        const updated = next.find(i => i.id === id)
        if (updated) {
          invRef.current = next
          sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoicePersistBody(updated as unknown as Record<string, unknown>)) })
        }
        return next
      })
      if (
        existing.type !== 'vendor_bill'
        && ('partnerId' in p || 'partnerName' in p || 'invoiceAddress' in p)
      ) {
        const contact = contacts.find(c => c.id === (p.partnerId ?? existing.partnerId))
        const name = String(p.partnerName ?? existing.partnerName ?? contact?.name ?? '').trim()
        syncCustomerIdentityToDocuments({
          contactId: p.partnerId ?? existing.partnerId,
          saleOrderId: existing.saleOrderId,
          invoiceId: id,
          identity: {
            name,
            email: contact?.email || undefined,
            phone: contact?.phone || contact?.mobile || undefined,
            address: 'invoiceAddress' in p
              ? (p.invoiceAddress || undefined)
              : (existing.invoiceAddress || (contact ? formatCustomerAddress(contact) : undefined)),
            customerId: p.partnerId ?? existing.partnerId,
          },
        })
      }
    },
    postInvoice: async (id, forcedRef) => {
      const actor = currentUser()
      if (!canManageFinance(actor)) {
        showToast('Only Finance or Admin Officer can post invoices', 'error'); return
      }
      const inv = invRef.current.find(i => i.id === id)
      if (!inv) return
      if (inv.status === 'posted') {
        showToast(`${inv.ref} is already posted`, 'info'); return
      }
      const gate = canPostOrPayCustomerInvoice({
        role: actor?.role,
        invoiceType: inv.type,
        action: 'post',
      })
      if (!gate.ok) { showToast(gate.reason || 'Cannot post invoice', 'error'); return }
      if (!inv.lines || inv.lines.length === 0) {
        showToast('Cannot post an invoice with no line items', 'error'); return
      }
      // Vendor bill 3-way match: billed qty must still fit received − previously billed.
      if (inv.type === 'vendor_bill' && inv.purchaseOrderId) {
        const po = poRef.current.find(p => p.id === inv.purchaseOrderId)
        if (!po) { showToast('Linked purchase order not found', 'error'); return }
        try {
          for (const line of inv.lines) {
            const poLine = po.lines.find(l =>
              l.productId && line.productId && l.productId === line.productId
            ) || po.lines.find(l => line.description?.includes(l.productName))
            if (!poLine) continue
            // qtyBilled already includes this draft bill's qty from createBillFromPO —
            // assert using received vs (billed − this line) + this line ≡ received ≥ billed.
            const alreadyBilledExcludingThis = Math.max(0, (poLine.qtyBilled ?? 0) - Math.floor(Number(line.qty) || 0))
            assertBillableQty(
              { qty: poLine.qty, qtyReceived: poLine.qtyReceived, qtyBilled: alreadyBilledExcludingThis },
              Number(line.qty) || 0,
            )
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Three-way match failed', 'error')
          return
        }
      }
      // Posting assigns the official number: drafts carry a placeholder ref
      // until Finance confirms them (Odoo behaviour).
      const finalRef = isDraftInvoiceRef(inv.ref)
        ? (forcedRef ?? await storeCtxRef.current!.allocateDocRef(inv.type === 'vendor_bill' ? 'BILL' : 'INV'))
        : inv.ref
      const postedMeta = {
        ref: finalRef,
        status: 'posted' as const,
        postedByUserId: actor?.id,
        postedByName: actor?.name,
        postedAt: now(),
      }
      const linesWithTax = (inv.lines || []).map(l => ({
        ...l,
        taxCategory: l.taxCategory || (Number(l.taxRate) > 0 ? 'standard_16' : 'out_of_scope'),
      }))
      const postedInvoice = { ...inv, ...postedMeta, lines: linesWithTax }
      setInvoices(p => p.map(i => i.id === id ? postedInvoice : i))
      let ledgerWarning: string | null = null
      try {
        // Edit PUT already incremented Prisma lockVersion; the local row still
        // holds the pre-edit value. Omit + one retry, same as sale-order Confirm.
        // A 404 means Create Bill never reached Prisma — create as draft, then
        // post using the server id so a new UUID cannot 404 again.
        const { res, data, id: postedId } = await putInvoiceOrCreateThenPost(
          id,
          postedInvoice as unknown as Record<string, unknown>,
        )
        if (!res.ok) {
          const err = invoiceErrorMessage(data, 'Could not post invoice to accounting')
          setInvoices(p => p.map(i => i.id === id ? inv : i))
          showToast(err, 'error')
          return
        }
        if (postedId !== id) {
          const remapped = { ...postedInvoice, id: postedId }
          invRef.current = invRef.current.map(i => i.id === id ? remapped : i)
          setInvoices(p => p.map(i => i.id === id ? remapped : i))
          setPurchaseOrders(p => p.map(po => po.billId === id ? { ...po, billId: postedId } : po))
        }
        ledgerWarning = typeof (data as { ledgerWarning?: unknown } | null)?.ledgerWarning === 'string'
          ? String((data as { ledgerWarning: string }).ledgerWarning)
          : null
        const postedLock = readLockVersionFromResponse(data)
        if (postedLock !== undefined) {
          const withLock = { ...(postedId !== id ? { ...postedInvoice, id: postedId } : postedInvoice), lockVersion: postedLock }
          invRef.current = invRef.current.map(i => i.id === postedId || i.id === id ? withLock : i)
          setInvoices(p => p.map(i => i.id === postedId || i.id === id ? withLock : i))
        }
      } catch {
        setInvoices(p => p.map(i => i.id === id ? inv : i))
        showToast('Could not post invoice to accounting', 'error')
        return
      }
      // Auto-post GL journal using the shared posting engine.
      postInvoiceJournalOnce({ ...inv, ref: finalRef })
      addAuditLog('post_invoice', finalRef, `Posted by ${actor?.name || 'Finance'}`)
      if (ledgerWarning) {
        showToast(`${finalRef} is confirmed but NOT booked in the ledger: ${ledgerWarning}. Tell Finance — it shows in the health check.`, 'error')
      } else {
        showToast(`${finalRef} posted to accounting`)
      }
    },
    setInvoicePaymentBlocked: (id, blocked) => {
      const actor = currentUser()
      if (!canManageFullFinanceAction(actor)) {
        showToast('Only Finance or Director can block or release invoice payments', 'error'); return
      }
      const inv = invRef.current.find(i => i.id === id)
      if (!inv || invoiceDocState(inv.status) !== 'posted') {
        showToast('Only posted invoices can be blocked', 'error'); return
      }
      setInvoices(p => {
        const next = p.map(i => i.id === id ? { ...i, paymentBlocked: blocked } : i)
        const updated = next.find(i => i.id === id)
        if (updated) sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoicePersistBody(updated as unknown as Record<string, unknown>)) })
        return next
      })
      addAuditLog(blocked ? 'block_invoice_payment' : 'release_invoice_payment', inv.ref, `${blocked ? 'Payment blocked' : 'Payment released'} by ${actor?.name ?? 'Finance'}`)
      showToast(blocked ? `${inv.ref} payment blocked` : `${inv.ref} payment released`)
    },
    registerPayment: async (invoiceId, amount, method, bankAccountId, reference, paymentDate) => {
      const actor = currentUser()
      if (!canManageFinance(actor)) {
        showToast('Only Finance or Admin Officer can register payments', 'error'); return false
      }
      const inv = invRef.current.find(i => i.id === invoiceId)
      if (!inv) return false
      // Use the shared document-state projection (not a raw === 'posted' check):
      // a posted invoice hydrated from Prisma carries status 'approved'/'invoiced',
      // which the header badge and "Register payment" button already treat as
      // Posted. A raw equality here rejected those, so the button appeared but the
      // payment failed with "Only posted invoices can receive payments".
      if (invoiceDocState(inv.status) !== 'posted') {
        showToast('Only posted invoices can receive payments', 'error'); return false
      }
      if (inv.paymentBlocked) { showToast('Payments are blocked on this invoice — release the block first', 'error'); return false }
      const sodThreshold = systemSettings.accAdminOfficerInvoiceLimitKes ?? DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES
      const gate = canPostOrPayCustomerInvoice({
        role: actor?.role,
        invoiceType: inv.type,
        action: 'pay',
      })
      if (!gate.ok) { showToast(gate.reason || 'Cannot register payment', 'error'); return false }
      const sod = canPayOwnPostedInvoice({
        role: actor?.role,
        actorUserId: actor?.id,
        postedByUserId: inv.postedByUserId,
        invoiceTotal: inv.total,
        sodThresholdKes: sodThreshold,
      })
      if (!sod.ok) { showToast(sod.reason || 'Segregation of duties blocked this payment', 'error'); return false }
      const balance = inv.total - inv.amountPaid
      if (balance <= 0) { showToast('Invoice is already fully paid', 'info'); return false }
      const capped = Math.min(amount, balance)
      const paymentId = crypto.randomUUID()
      const paidToRider = method === PAID_TO_RIDER && inv.type !== 'vendor_bill'
      const withheld = isWithholdingMethod(method) && inv.type !== 'vendor_bill' ? WITHHOLDING_KINDS[method] : null
      if (isWithholdingMethod(method) && !withheld) { showToast('Withholding is recorded on customer invoices only', 'error'); return false }
      if (withheld && !reference?.trim()) { showToast('Enter the withholding certificate number', 'error'); return false }
      const journal = buildInvoicePaymentJournal(inv, capped, method, bankAccountId, paymentDate, paymentId,
        withheld ? withheld.accountLabel : paidToRider ? riderFeeAccount(accounts.map(a => a.code)).label : undefined)
      if (journalEntries.some(j => j.ref === journal.ref)) {
        showToast('This payment journal was already posted', 'info'); return false
      }
      const prevInvoice = inv
      const newPayment: InvoicePayment = {
        id: paymentId,
        date: paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString(),
        amount: capped,
        method: method || 'cash',
        reference: reference || undefined,
        bankAccountId: paidToRider || withheld ? undefined : bankAccountIdForMethod(method, bankAccountId),
        recordedBy: actor?.name || 'Finance',
      }
      const append = `\nPaid ${fmtKes(capped)} via ${method || 'cash'}${bankAccountId ? ` (Bank: ${bankAccountId})` : ''}${reference ? ` Ref: ${reference}` : ''}`
      setInvoices(p => p.map(i => {
        if (i.id !== invoiceId) return i
        return {
          ...i,
          amountPaid: i.amountPaid + capped,
          notes: (i.notes || '') + append,
          payments: [...(i.payments || []), newPayment],
        }
      }))
      setJournalEntries(p => [journal, ...p])
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: capped,
            paymentMethod: method || 'cash',
            reference: reference || undefined,
            paidAt: paymentDate,
            bankAccountId: withheld ? undefined : bankAccountId,
            idempotencyKey: paymentId,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Payment failed (${res.status})`)
        }
      } catch (err: any) {
        setInvoices(p => p.map(i => i.id === invoiceId ? prevInvoice : i))
        setJournalEntries(p => p.filter(j => j.ref !== journal.ref))
        showToast(err?.message || 'Payment could not be registered', 'error')
        return false
      }
      addAuditLog('register_payment', invoiceId, `Registered payment of KES ${capped} for ${inv.ref}${reference ? ` (Ref: ${reference})` : ''}`)
      showToast('Payment registered')
      return true
    },
    reverseInvoicePayment: async (invoiceId, paymentId, reason) => {
      const actor = currentUser()
      if (!userCan(actor, 'invoices.payments.reverse')) {
        showToast('Only Finance or a Director can reverse a payment', 'error'); return false
      }
      const inv = invRef.current.find(i => i.id === invoiceId)
      if (!inv) return false
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/payments/${paymentId}/reverse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        })
        const body = await res.json().catch(() => ({})) as { error?: string; reversal?: PaymentReversalInfo & { amountPaidByInvoice: Record<string, number>; reversalJournalRef: string | null } }
        if (!res.ok || !body.reversal) throw new Error(body.error || `Reversal failed (${res.status})`)
        const reversal = body.reversal
        setInvoices(prev => {
          const next = applyReversalToInvoices(prev as unknown as Array<Record<string, any>>, reversal, reversal.amountPaidByInvoice) as unknown as Invoice[]
          invRef.current = next
          return next
        })
        const originalRef = paymentJournalRef(inv.ref, paymentId)
        if (reversal.reversalJournalRef) {
          setJournalEntries(prev => {
            const rev = reversalJournalForStore(prev as unknown as Array<Record<string, any>>, originalRef, reversal.reversalJournalRef!, reason, reversal.reversedAt)
            return rev ? [rev as unknown as JournalEntry, ...prev] : prev
          })
        }
        addAuditLog('reverse_payment', invoiceId, `Reversed payment of ${fmtKes(reversal.amount)} on ${inv.ref}: ${reason}`)
        showToast(`Payment of ${fmtKes(reversal.amount)} reversed — ${inv.ref} owes it again`, 'success')
        return true
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Payment could not be reversed', 'error')
        return false
      }
    },
    resetInvoiceToDraft: (id) => {
      const actor = currentUser()
      if (!canCancelOrResetInvoice(actor?.role)) {
        showToast('Only Finance, Admin Officer, or Director can reset invoices to draft', 'error')
        return
      }
      const inv = invRef.current.find(i => i.id === id)
      if (!inv) return
      if (inv.status === 'cancelled') {
        showToast('Cancelled invoices cannot be reset to draft', 'error')
        return
      }
      if (inv.status === 'draft') {
        showToast('Document is already a draft', 'info')
        return
      }
      if (inv.amountPaid > 0) {
        showToast('Invoices with payments cannot be reset. Cancel to create credit instead.', 'error')
        return
      }
      const related = journalEntries.filter(j => j.invoiceId === id && !j.ref.startsWith('REV/'))
      const reversals = related
        .filter(j => !journalEntries.some(existingJournal => existingJournal.ref === `REV/${j.ref}`))
        .map(j => buildReversalJournal(j, inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} reset to draft`))
      // Keep reset audit off customer-facing invoice notes / PDFs — audit log only.
      const draft: Invoice = {
        ...inv,
        status: 'draft',
        amountPaid: 0,
        payments: [],
      }
      // Optimistic UI — Edit / Confirm appear immediately; revert if the API fails.
      if (reversals.length > 0) setJournalEntries(prev => [...reversals, ...prev])
      setInvoices(prev => {
        const next = prev.map(i => i.id === id ? draft : i)
        invRef.current = next
        return next
      })
      void (async () => {
        try {
          const res = await fetch(`/api/invoices/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            // Explicit intent. The server will not un-post an invoice on a
            // status of 'draft' alone, because that is what every stale tab
            // carries — an ordinary edit from one used to reverse the GL
            // journal without anybody asking.
            body: JSON.stringify({ ...draft, resetToDraft: true }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => null) as { error?: string } | null
            setInvoices(prev => {
              const next = prev.map(i => i.id === id ? inv : i)
              invRef.current = next
              return next
            })
            if (reversals.length > 0) {
              setJournalEntries(prev => prev.filter(j => !reversals.some(r => r.id === j.id)))
            }
            showToast(data?.error || `Could not reset ${inv.type === 'vendor_bill' ? 'bill' : 'invoice'} to draft`, 'error')
            return
          }
          addAuditLog('reset_invoice_draft', inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} reset to draft${reversals.length ? ` with ${reversals.length} reversal journal${reversals.length === 1 ? '' : 's'}` : ''}`)
          showToast(`${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} reset to draft — you can edit and confirm`)
        } catch {
          setInvoices(prev => {
            const next = prev.map(i => i.id === id ? inv : i)
            invRef.current = next
            return next
          })
          if (reversals.length > 0) {
            setJournalEntries(prev => prev.filter(j => !reversals.some(r => r.id === j.id)))
          }
          showToast(`Could not reset ${inv.type === 'vendor_bill' ? 'bill' : 'invoice'} to draft — check your connection`, 'error')
        }
      })()
    },
    cancelInvoice: async (id, forcedCreditRef) => {
      const actor = currentUser()
      if (!canCancelOrResetInvoice(actor?.role)) {
        showToast('Only Finance, Admin Officer, or Director can cancel invoices', 'error')
        return
      }
      const inv = invRef.current.find(i => i.id === id)
      if (!inv) return
      if (inv.status === 'draft') {
        showToast('Delete draft invoices instead of cancelling them', 'info')
        return
      }
      if (inv.status === 'cancelled') {
        showToast('Document is already cancelled', 'info')
        return
      }

      const isPaidCustomerInvoice = inv.type === 'customer_invoice' && inv.amountPaid > 0
      let credit: CustomerCredit | null = null
      if (isPaidCustomerInvoice) {
        const creditAmount = Math.min(inv.amountPaid, inv.total)
        credit = {
          id: uid(),
          ref: forcedCreditRef ?? await storeCtxRef.current!.allocateDocRef('CN'),
          customerId: inv.partnerId,
          customerName: inv.partnerName,
          sourceInvoiceId: inv.id,
          sourceInvoiceRef: inv.ref,
          amount: creditAmount,
          balance: creditAmount,
          status: 'available',
          createdAt: now(),
          createdBy: actor?.name ?? 'Finance',
          notes: `Credit note generated from cancelled paid invoice ${inv.ref}`,
          applications: [],
        }
        setCustomerCredits(prev => [credit!, ...prev])
        setJournalEntries(prev => [buildCustomerCreditJournal(inv, credit!.ref, creditAmount), ...prev])
      } else {
        const related = journalEntries.filter(j => j.invoiceId === id && !j.ref.startsWith('REV/'))
        const reversals = related
          .filter(j => !journalEntries.some(existingJournal => existingJournal.ref === `REV/${j.ref}`))
          .map(j => buildReversalJournal(j, inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`))
        if (reversals.length > 0) setJournalEntries(prev => [...reversals, ...prev])
      }

      const cancelled: Invoice = {
        ...inv,
        status: 'cancelled',
        notes: `${inv.notes || ''}\nCancelled by ${actor?.name ?? 'Finance'}${credit ? `; credit note ${credit.ref} created for ${fmtKes(credit.amount)}.` : '.'}`.trim(),
      }
      setInvoices(prev => prev.map(i => i.id === id ? cancelled : i))
      // Server reverses Prisma posting journal (unpaid) or posts 3102 credit journal (paid).
      sync(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cancelled, creditRef: credit?.ref }),
      })
      addAuditLog('cancel_invoice', inv.ref, credit ? `Paid invoice cancelled; credit note ${credit.ref} created for ${fmtKes(credit.amount)}` : `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`)
      showToast(credit ? `Invoice cancelled — credit note ${credit.ref} created` : `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`)
    },
    deleteInvoice: (id) => {
      const inv = invRef.current.find(i => i.id === id)
      if (!inv) return
      if (inv.status === 'draft') {
        setInvoices(p => p.filter(i => i.id !== id))
        sync(`/api/invoices/${id}`, { method: 'DELETE' })
        addAuditLog('delete_draft_invoice', inv.ref, `Draft ${inv.type === 'vendor_bill' ? 'bill' : 'invoice'} deleted`)
        showToast('Draft document deleted')
        return
      }
      if (inv.status === 'cancelled') { showToast('Document is already cancelled', 'info'); return }
      storeCtx.cancelInvoice(id)
    },
    addAuditLog: (action, documentRef, details) => { addAuditLog(action, documentRef, details) },

    allocateDocRef: async (prefix) => {
      const { prefixToKind, allocateDocNumber, allocateDocNumberSync } = await import('@/lib/doc-numbers')
      const kind = prefixToKind(prefix)
      if (kind === 'pos') {
        if (typeof window !== 'undefined') {
          try {
            return await allocateDocNumber(kind)
          } catch {
            /* fall through to local POS/NNNN high-water */
          }
        }
        return nextPosTicketRef(posOrders.map(o => o.ref))
      }
      if (typeof window !== 'undefined' && kind) {
        // Two more tries before the clash-free local number: a brief network
        // blip should still get the next number in the real sequence.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await allocateDocNumber(kind)
          } catch {
            if (attempt < 2) await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
          }
        }
        console.warn(`[doc-numbers] server did not issue a ${prefix} number; using a temporary one`)
      }
      return allocateDocNumberSync(prefix)
    },

    ...createPurchasingActions(storeDeps),

    // ── Rider Management ────────────────────────────────────────────────────
    riders,
    deliveryJobs,
    riderWeeklyPays,

    ...createDeliveryActions(storeDeps),
    
    // ── Approval Workflows ────────────────────────────────────────────────────
    approvalRequests,

    // ── Returns / RMA ─────────────────────────────────────────────────────────
    returnOrders, refundPayments,

    ...createAfterSalesActions(storeDeps),

    // ── Buy-backs ─────────────────────────────────────────────────────────────
    buyBacks,

    // ── Donations ─────────────────────────────────────────────────────────────
    donations,

    // ── Client Exchanges ──────────────────────────────────────────────────────
    clientExchanges,
  }

  storeCtxRef.current = storeCtx

  useEffect(() => {
    registerSaleOrderDraftPersistApi({
      updateSaleOrder: (id, patch, opts) => storeCtxRef.current!.updateSaleOrder(id, patch as any, opts),
      getSaleOrder: (id) => soRef.current.find(s => s.id === id),
    })
    return () => registerSaleOrderDraftPersistApi(null)
  }, [])

  const inventoryStore = useMemo<InventoryStoreState>(() => ({
    products,
    productPriceHistory,
    serials,
    stockMoves,
    stockTransfers,
    openingStockPosted: openingStockLocked,
    purchaseOrders,
    receipts,
    contacts,
    currentUserId,
    users,
    accounts,
    refurbishmentJobs,
    systemSettings,
    bulkStock,
    stockAdjustments,
    saleOrders,
    ...inventoryActions,
  }), [
    products,
    productPriceHistory,
    serials,
    stockMoves,
    stockTransfers,
    openingStockLocked,
    purchaseOrders,
    receipts,
    contacts,
    currentUserId,
    users,
    accounts,
    refurbishmentJobs,
    systemSettings,
    bulkStock,
    stockAdjustments,
    saleOrders,
    inventoryActions,
  ])

  const salesStore = useMemo<SalesStoreState>(() => ({
    saleOrders,
    contacts,
    products,
    serials,
    invoices,
    deliveries,
    returnOrders,
    stockReservations,
    posOrders,
    users,
    currentUserId,
    systemSettings,
    companySettings,
    bankAccounts,
    documentPaymentDetails,
    outboundReleases,
    approvalRequests,
    sops,
    ...salesActions,
  }), [
    saleOrders,
    contacts,
    products,
    serials,
    invoices,
    deliveries,
    returnOrders,
    stockReservations,
    posOrders,
    users,
    currentUserId,
    systemSettings,
    companySettings,
    bankAccounts,
    documentPaymentDetails,
    outboundReleases,
    approvalRequests,
    sops,
    salesActions,
  ])

  const repairStore = useMemo<RepairStoreState>(() => ({
    repairs,
    contacts,
    products,
    users,
    riders,
    refurbishmentJobs,
    currentUserId,
    outsourceJobs,
    outsourceVendors,
    warranties,
    systemSettings,
    companySettings,
    invoices,
    quotes,
    saleOrders,
    outboundReleases,
    serials,
    ...repairActions,
  }), [
    repairs,
    contacts,
    products,
    users,
    riders,
    refurbishmentJobs,
    currentUserId,
    outsourceJobs,
    outsourceVendors,
    warranties,
    systemSettings,
    companySettings,
    invoices,
    quotes,
    saleOrders,
    outboundReleases,
    serials,
    repairActions,
  ])

  const shellStore = useMemo<ShellStoreState>(() => ({
    activeModule,
    sidebarOpen,
    toast,
    currentUser: currentUser(),
    currentUserId,
    users,
    notifications,
    profileImages,
    repairs,
    ...shellActions,
  }), [
    activeModule,
    sidebarOpen,
    toast,
    users,
    currentUserId,
    notifications,
    profileImages,
    repairs,
    shellActions,
  ])

  const crmStore = useMemo<CrmStoreState>(() => ({
    contacts,
    companies,
    contactPersons,
    customerCredits,
    opportunities,
    opportunityActivities,
    quotes,
    customerContracts,
    invoices,
    posOrders,
    repairs,
    saleOrders,
    users,
    currentUserId,
    systemSettings,
    ...crmActions,
  }), [
    contacts,
    companies,
    contactPersons,
    customerCredits,
    opportunities,
    opportunityActivities,
    quotes,
    customerContracts,
    invoices,
    posOrders,
    repairs,
    saleOrders,
    users,
    currentUserId,
    systemSettings,
    crmActions,
  ])

  const financeStore = useMemo<FinanceStoreState>(() => ({
    accounts,
    bankAccounts,
    documentPaymentDetails,
    bankRecons,
    bankStatementLines,
    buyBacks,
    clientExchanges,
    companySettings,
    contacts,
    currentUser: currentUser(),
    currentUserId,
    customerCredits,
    deliveries,
    deposits,
    donations,
    expenses,
    invoices,
    journalEntries,
    companyAssets,
    outboundReleases,
    outsourceJobs,
    outsourcePayments,
    outsourceVendors,
    payrollRuns,
    posOrders,
    products,
    purchaseOrders,
    purchaseReturns,
    receipts,
    refundPayments,
    repairs,
    saleOrders,
    serials,
    systemSettings,
    users,
    ...financeActions,
  }), [
    accounts,
    bankAccounts,
    documentPaymentDetails,
    bankRecons,
    bankStatementLines,
    buyBacks,
    clientExchanges,
    companySettings,
    contacts,
    users,
    currentUserId,
    customerCredits,
    deliveries,
    deposits,
    donations,
    expenses,
    invoices,
    journalEntries,
    companyAssets,
    outboundReleases,
    outsourceJobs,
    outsourcePayments,
    outsourceVendors,
    payrollRuns,
    posOrders,
    products,
    purchaseOrders,
    purchaseReturns,
    receipts,
    refundPayments,
    repairs,
    saleOrders,
    serials,
    systemSettings,
    financeActions,
  ])

  const hrStore = useMemo<HrStoreState>(() => ({
    currentUser: currentUser(),
    currentUserId,
    users,
    refSops,
    sopDocuments,
    ...hrActions,
  }), [
    users,
    currentUserId,
    refSops,
    sopDocuments,
    hrActions,
  ])

  const deliveryStore = useMemo<DeliveryStoreState>(() => ({
    companySettings,
    currentUserId,
    deliveryJobs,
    invoices,
    repairs,
    riderWeeklyPays,
    riders,
    saleOrders,
    users,
    ...deliveryActions,
  }), [
    companySettings,
    currentUserId,
    deliveryJobs,
    invoices,
    repairs,
    riderWeeklyPays,
    riders,
    saleOrders,
    users,
    deliveryActions,
  ])

  const commerceStore = useMemo<CommerceStoreState>(() => ({
    companySettings,
    systemSettings,
    contacts,
    currentUserId,
    customerCredits,
    invoices,
    kilimallDispatches,
    kilimallOrders,
    kilimallSettlements,
    posOrders,
    posSessionOpen,
    posSessionOpeningCash,
    posSessionId,
    posSessions,
    products,
    saleOrders,
    serials,
    users,
    bankAccounts,
    ...commerceActions,
  }), [
    companySettings,
    systemSettings,
    contacts,
    currentUserId,
    customerCredits,
    invoices,
    kilimallDispatches,
    kilimallOrders,
    kilimallSettlements,
    posOrders,
    posSessionOpen,
    posSessionOpeningCash,
    posSessionId,
    posSessions,
    products,
    saleOrders,
    serials,
    users,
    bankAccounts,
    commerceActions,
  ])

  const afterSalesStore = useMemo<AfterSalesStoreState>(() => ({
    buyBacks,
    clientExchanges,
    contacts,
    currentUserId,
    donations,
    invoices,
    posOrders,
    products,
    returnOrders,
    saleOrders,
    serials,
    users,
    warranties,
    ...afterSalesActions,
  }), [
    buyBacks,
    clientExchanges,
    contacts,
    currentUserId,
    donations,
    invoices,
    posOrders,
    products,
    returnOrders,
    saleOrders,
    serials,
    users,
    warranties,
    afterSalesActions,
  ])

  const operationsStore = useMemo<OperationsStoreState>(() => ({
    contactPersons,
    contacts,
    currentUserId,
    holdovers,
    products,
    refurbishmentJobs,
    repairs,
    serials,
    systemSettings,
    users,
    warranties,
    ...operationsActions,
  }), [
    contactPersons,
    contacts,
    currentUserId,
    holdovers,
    products,
    refurbishmentJobs,
    repairs,
    serials,
    systemSettings,
    users,
    warranties,
    operationsActions,
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
                              {children}
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

function useFeatureStore(ctx: React.Context<AppState | null>, name: string) {
  const value = useContext(ctx)
  if (!value) throw new Error(`${name} must be inside AppProvider`)
  return value
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

// Coerce defensively: amounts synced from the server sometimes arrive as
// strings (Prisma Decimal) or undefined — never render "KSh NaN".
export const fmtKes = (n: number | string | null | undefined) => {
  const v = typeof n === 'string' ? Number(n.replace(/,/g, '')) : Number(n ?? 0)
  return `KSh ${formatKeInteger(Math.round(Number.isFinite(v) ? v : 0))}`
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
