// @ts-nocheck
'use client'
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
    createKilimallOrder: async (p) => {
      const user = currentUser()
      if (!userCan(user, 'sales.kilimall.orders')) {
        showToast('Unauthorized to create Kilimall orders', 'error')
        return null
      }

      const kilimallRef = p.kilimallRef.trim()
      const qty = Number(p.qty)
      const unitPrice = Number(p.unitPrice)
      if (!kilimallRef || !p.productId || !p.productName.trim()) {
        showToast('Kilimall reference and product are required', 'error')
        return null
      }
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        showToast('Quantity and unit price must be greater than zero', 'error')
        return null
      }
      if (kilimallOrdersRef.current.some(order => order.kilimallRef.trim().toLowerCase() === kilimallRef.toLowerCase())) {
        showToast(`Kilimall order ${kilimallRef} already exists`, 'error')
        return null
      }

      const ref = await fetchNextKilimallRef('kilimall_order')
      if (!ref) { showToast('Could not get an order number from the server. Check your connection and try again.', 'error'); return null }
      if (kilimallOrdersRef.current.some(order => order.kilimallRef.trim().toLowerCase() === kilimallRef.toLowerCase())) {
        showToast(`Kilimall order ${kilimallRef} already exists`, 'error')
        return null
      }
      const order: KilimallOrder = {
        ...p,
        kilimallRef,
        qty,
        unitPrice,
        total: Math.round(qty * unitPrice * 100) / 100,
        id: uid(),
        ref,
        status: 'pending',
        createdDate: now(),
        createdBy: currentUserId ?? 'system',
      }
      setKilimallOrders(prev => [order, ...prev])
      addAuditLog('kilimall_order_create', order.id, `Order ${order.ref} — ${order.kilimallRef}`)
      return order
    },
    updateKilimallOrder: (id, p) => setKilimallOrders(prev => prev.map(o => o.id === id ? { ...o, ...p } : o)),
    returnKilimallOrder: async (id, input) => {
      try {
        const res = await fetch(`/api/kilimall/orders/${encodeURIComponent(id)}/return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        const data = await res.json().catch(() => null) as { error?: string; order?: KilimallOrder } | null
        if (!res.ok || !data?.order) {
          showToast(data?.error || 'Could not record the return', 'error')
          return false
        }
        // The server changed the order and the stock: take its copies.
        const keys = ['deed_kilimallOrders', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_products']
        noteStoreChanges(Object.fromEntries(keys.map(k => [k, new Date().toISOString()])))
        void fetchAndApplyStoreKeys({ keys, etagStorageKey: 'deed_kilimall_return' })
        const o = data.order
        showToast(input.outcome === 'exchange'
          ? `${o.ref} returned — back in Pending Dispatch to ship a replacement`
          : `${o.ref} returned — device is in the warehouse awaiting inspection`)
        addAuditLog('kilimall_return', o.ref, `Kilimall return (${input.outcome}, ${input.condition}): ${input.reason}`)
        return true
      } catch {
        showToast('Could not record the return. Check your connection and try again.', 'error')
        return false
      }
    },
    confirmKilimallDispatch: async (orderId, serialId, serialNumber, opts) => {
      const user = currentUser()
      if (!userCan(user, 'sales.kilimall.dispatch')) {
        showToast('Unauthorized to dispatch orders', 'error'); return null;
      }
      const order = kilimallOrdersRef.current.find(o => o.id === orderId)
      if (!order) { showToast('Order not found', 'error'); return null }
      if (order.status !== 'pending') { showToast('Order already dispatched', 'error'); return null }
      const serial = serialRef.current.find(s => s.id === serialId)
      if (!serial) { showToast('Serial not found in inventory', 'error'); return null }
      if (serial.status !== 'available') { showToast('Serial is not available', 'error'); return null }

      const shipProductId = opts?.fulfilledProductId || order.productId
      if (serial.productId !== shipProductId) {
        showToast('Serial does not belong to the product being shipped', 'error'); return null
      }

      const shipProduct = prodRef.current.find(p => p.id === shipProductId)
      const shipProductName = shipProduct?.name || serial.productName || order.productName
      const isSubstitution = shipProductId !== order.productId
      if (isSubstitution && !opts?.fulfilledProductId) {
        showToast('Select the product being shipped for a substitution', 'error'); return null
      }

      // The dispatch number comes from the server's counter (a number lost to a failed
      // dispatch is harmless; a duplicate is not), before any stock moves.
      const dispatchRef = await fetchNextKilimallRef('kilimall_dispatch')
      if (!dispatchRef) { showToast('Could not get a dispatch number from the server. Check your connection and try again.', 'error'); return null }

      // Authoritative stock out on the server first (serial -> sold, product on-hand,
      // stock move, COGS), exactly as a till sale does. Without this the serial was only
      // flagged locally and the product's stock never fell.
      try {
        const res = await fetch('/api/inventory/apply-pos-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderRef: order.ref,
            reasonLabel: 'Kilimall',
            lines: [{
              productId: shipProductId,
              productName: shipProductName,
              qty: 1,
              serialId,
              serialNumber,
              sourceLocation: 'warehouse',
            }],
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null
          showToast(payload?.error || 'Kilimall stock update failed', 'error')
          return null
        }
      } catch {
        showToast('Could not apply Kilimall stock on server', 'error')
        return null
      }
      // A second click while the request was in flight must not dispatch twice.
      const stillPending = kilimallOrdersRef.current.find(o => o.id === orderId)
      if (stillPending && stillPending.status !== 'pending') { showToast('Order already dispatched', 'error'); return null }

      const dispatch: KilimallDispatch = {
        id: uid(), ref: dispatchRef, date: opts?.dispatchDate || now(),
        orderId: order.id, orderRef: order.ref, kilimallRef: order.kilimallRef,
        productId: shipProductId, productName: shipProductName,
        orderedProductId: isSubstitution ? order.productId : undefined,
        orderedProductName: isSubstitution ? order.productName : undefined,
        isSubstitution: isSubstitution || undefined,
        serialId, serialNumber, status: 'dispatched',
        courier: opts?.courier?.trim() || undefined,
        dispatchDate: opts?.dispatchDate || undefined,
        trackingReference: opts?.trackingReference?.trim() || undefined,
        notes: [
          isSubstitution
            ? (opts?.substitutionReason?.trim() || `Substituted for ordered ${order.productName}`)
            : '',
          opts?.dispatchNotes?.trim() || '',
        ].filter(Boolean).join(' · ') || undefined,
        createdBy: currentUserId ?? 'system', createdDate: now(),
      }
      setKilimallDispatches(prev => [dispatch, ...prev])
      setKilimallOrders(prev => prev.map(o => o.id === orderId
        ? {
            ...o,
            status: 'dispatched' as const,
            dispatchId: dispatch.id,
            serialId,
            serialNumber,
            fulfilledProductId: isSubstitution ? shipProductId : undefined,
            fulfilledProductName: isSubstitution ? shipProductName : undefined,
            substitutionReason: isSubstitution
              ? (opts?.substitutionReason?.trim() || undefined)
              : undefined,
          }
        : o))
      setSerials(prev => prev.map(s => s.id === serialId ? { ...s, status: 'sold', location: 'customer', soldDate: now() } : s))
      setProducts(prev => prev.map(x => x.id === shipProductId ? { ...x, stockQty: Math.max(0, x.stockQty - 1) } : x))
      const toastMsg = isSubstitution
        ? `Dispatched ${order.ref} — shipped ${shipProductName} (ordered ${order.productName})`
        : `Dispatched ${order.ref} — serial ${serialNumber}`
      showToast(toastMsg)
      requestWarrantySync()
      addAuditLog(
        'kilimall_dispatch',
        dispatch.id,
        isSubstitution
          ? `Dispatch ${dispatch.ref} for ${order.ref}: substituted ${order.productName} → ${shipProductName}`
          : `Dispatch ${dispatch.ref} for ${order.ref}`,
      )
      return dispatch
    },
    createKilimallSettlement: async (p) => {
      const user = currentUser()
      if (!userCan(user, 'sales.kilimall.settlements')) {
        showToast('Unauthorized to manage settlements', 'error')
        return null
      }

      const grossAmount = Number(p.grossAmount)
      const deductions = Number(p.deductions)
      const netPaid = Number(p.netPaid)
      const normalizedRefs = p.lines.map(line => line.kilimallRef.trim().toLowerCase())
      if (!p.weekPeriod.trim() || !p.weekStart || !p.weekEnd || p.weekEnd < p.weekStart) {
        showToast('Enter a valid settlement period and date range', 'error')
        return null
      }
      if (![grossAmount, deductions, netPaid].every(Number.isFinite) || grossAmount <= 0 || deductions < 0 || netPaid < 0) {
        showToast('Settlement amounts cannot be negative and gross must be greater than zero', 'error')
        return null
      }
      if (Math.abs(grossAmount - deductions - netPaid) > 1) {
        showToast('Net paid must equal gross amount less deductions', 'error')
        return null
      }
      if (
        p.lines.length === 0 ||
        p.lines.some(line => !line.kilimallRef.trim() || !Number.isFinite(Number(line.amount)) || Number(line.amount) <= 0)
      ) {
        showToast('Every settlement line needs an order reference and a positive amount', 'error')
        return null
      }
      if (new Set(normalizedRefs).size !== normalizedRefs.length) {
        showToast('A Kilimall order can appear only once in a settlement', 'error')
        return null
      }
      if (kilimallSettlementsRef.current.some(existing =>
        p.paymentRef && existing.paymentRef?.trim().toLowerCase() === p.paymentRef.trim().toLowerCase()
      )) {
        showToast('This settlement payment reference already exists', 'error')
        return null
      }

      const settlementRef = await fetchNextKilimallRef('kilimall_settlement')
      if (!settlementRef) { showToast('Could not get a settlement number from the server. Check your connection and try again.', 'error'); return null }
      const settlement: KilimallSettlement = {
        ...p,
        grossAmount,
        deductions,
        netPaid,
        lines: p.lines.map(line => ({
          ...line,
          kilimallRef: line.kilimallRef.trim(),
          amount: Number(line.amount),
        })),
        id: uid(),
        ref: settlementRef,
        status: 'draft',
        createdDate: now(),
        createdBy: currentUserId ?? 'system',
      }
      setKilimallSettlements(prev => [settlement, ...prev])
      return settlement
    },
    updateKilimallSettlement: (id, p) => setKilimallSettlements(prev => prev.map(settlement =>
      settlement.id === id ? { ...settlement, ...p } : settlement
    )),
    reconcileKilimallSettlement: (settlementId) => {
      const user = currentUser()
      if (!userCan(user, 'sales.kilimall.settlements')) {
        showToast('Unauthorized to reconcile settlements', 'error')
        return
      }
      const settlement = kilimallSettlementsRef.current.find(item => item.id === settlementId)
      if (!settlement) return

      const orders = kilimallOrdersRef.current
      const updatedLines: KilimallSettlementLine[] = settlement.lines.map(line => {
        const normalizedRef = line.kilimallRef.trim().toLowerCase()
        const match = orders.find(order => order.kilimallRef.trim().toLowerCase() === normalizedRef)
        if (!match) return { ...line, status: 'unmatched', orderId: undefined, erpAmount: undefined }
        if (match.settlementId && match.settlementId !== settlement.id) {
          return {
            ...line,
            status: 'unmatched',
            orderId: match.id,
            erpAmount: match.total,
            notes: `Already linked to ${match.settlementRef || 'another settlement'}`,
          }
        }
        if (match.status === 'returned') {
          return { ...line, status: 'returned', orderId: match.id, erpAmount: match.total }
        }
        const difference = Math.abs(Number(line.amount) - Number(match.total))
        if (difference > 1) {
          return { ...line, status: 'mismatch', orderId: match.id, erpAmount: match.total }
        }
        return { ...line, status: 'matched', orderId: match.id, erpAmount: match.total }
      })

      const matchedOrderIds = new Set(
        updatedLines.filter(line => line.status === 'matched' && line.orderId).map(line => line.orderId as string),
      )
      setKilimallOrders(prev => prev.map(order => {
        if (matchedOrderIds.has(order.id)) {
          return { ...order, settlementId: settlement.id, settlementRef: settlement.ref }
        }
        if (order.settlementId === settlement.id) {
          const { settlementId: _settlementId, settlementRef: _settlementRef, ...unlinked } = order
          return unlinked
        }
        return order
      }))

      const allMatched = updatedLines.length > 0 && updatedLines.every(line => line.status === 'matched')
      const nextStatus: KilimallSettlement['status'] = allMatched ? 'reconciled' : 'partially_matched'
      setKilimallSettlements(prev => prev.map(item =>
        item.id === settlementId ? { ...item, lines: updatedLines, status: nextStatus } : item
      ))

      const matched = updatedLines.filter(line => line.status === 'matched').length
      const unresolved = updatedLines.length - matched
      showToast(
        allMatched
          ? `Reconciliation complete — ${matched}/${updatedLines.length} matched`
          : `Partially matched — ${matched} matched, ${unresolved} need review`,
        allMatched ? 'success' : 'info',
      )
      addAuditLog(
        'kilimall_reconcile',
        settlementId,
        `Settlement ${settlement.ref}: ${matched}/${updatedLines.length} matched`,
      )
    },
    matchKilimallSettlementLine: (settlementId, lineId, orderId, note) => {
      const user = currentUser()
      if (!userCan(user, 'sales.kilimall.settlements')) {
        showToast('Unauthorized to match settlement lines', 'error')
        return false
      }
      const settlement = kilimallSettlementsRef.current.find(item => item.id === settlementId)
      const line = settlement?.lines.find(item => item.id === lineId)
      const order = kilimallOrdersRef.current.find(item => item.id === orderId)
      if (!settlement || !line || !order) {
        showToast('Settlement line or order was not found', 'error')
        return false
      }
      if (order.settlementId && order.settlementId !== settlement.id) {
        showToast(`Order is already linked to ${order.settlementRef || 'another settlement'}`, 'error')
        return false
      }
      if (Math.abs(line.amount - order.total) > 1 && !note.trim()) {
        showToast('Add a note explaining the amount difference', 'error')
        return false
      }

      const updatedLines = settlement.lines.map(item => item.id === lineId ? {
        ...item,
        status: 'matched' as const,
        orderId: order.id,
        erpAmount: order.total,
        notes: note.trim() || undefined,
        manuallyMatched: true,
      } : item)
      const allMatched = updatedLines.every(item => item.status === 'matched')
      setKilimallSettlements(prev => prev.map(item => item.id === settlementId ? {
        ...item,
        lines: updatedLines,
        status: allMatched ? 'reconciled' : 'partially_matched',
      } : item))
      setKilimallOrders(prev => prev.map(item =>
        item.id === order.id
          ? { ...item, settlementId: settlement.id, settlementRef: settlement.ref }
          : item
      ))
      addAuditLog(
        'kilimall_manual_match',
        settlementId,
        `Settlement ${settlement.ref}: ${line.kilimallRef} matched to ${order.ref}`,
      )
      showToast('Settlement line matched', 'success')
      return true
    },

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

    // ── Contacts ─────────────────────────────────────────────────────────────
    // ── Legacy Contacts ────────────────────────────────────────────────────────
    addContact: async (c) => {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c),
      })
      if (!res.ok) {
        showToast('Failed to create contact', 'error')
        throw new Error('Failed to create contact')
      }
      const contact = await res.json()
      setContacts(prev => prev.some(item => item.id === contact.id)
        ? prev.map(item => item.id === contact.id ? contact : item)
        : [contact, ...prev])
      showToast(`${contact.name} ${res.status === 201 ? 'added' : 'updated'}`, 'success')
      return contact
    },
    updateContact: async (id, p) => {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      })
      if (!res.ok) {
        showToast('Failed to update contact', 'error')
        throw new Error('Failed to update contact')
      }
      const updated = await res.json()
      setContacts(prev => prev.map(c => c.id === id ? updated : c))
      const phone = String(updated.phone || updated.mobile || '').trim()
      const email = String(updated.email || '').trim()
      syncCustomerIdentityToDocuments({
        contactId: id,
        identity: {
          name: String(updated.name || '').trim(),
          email: email || undefined,
          phone: phone || undefined,
          address: formatCustomerAddress(updated),
          customerId: id,
        },
      })
      showToast('Contact updated', 'success')
      return updated
    },
    deleteContact: async (id) => {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setContacts(p => p.filter(c => c.id !== id))
        showToast('Contact deleted', 'success')
      }
    },

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

    
    // ── CRM - Companies ────────────────────────────────────────────────────────
    createCompany: (c) => {
      const user = currentUser()
      const company: Company = {
        ...c,
        id: uid(),
        creditUsed: 0,
        createdDate: now(),
        createdBy: user?.username ?? 'system',
      }
      setCompanies(p => [company, ...p])
      sync('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(company) })
      addAuditLog('create_company', company.name, `Company ${company.name} added to CRM`)
      showToast(`Company ${company.name} created`)
      return company
    },
    updateCompany: (id, p) => {
      setCompanies(prev => {
        const next = prev.map(c => c.id === id ? { ...c, ...p } : c)
        const updated = next.find(c => c.id === id)
        if (updated) sync(`/api/companies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('update_company', id, `Company updated`)
      showToast('Company updated')
    },
    deleteCompany: (id) => {
      const company = companies.find(c => c.id === id)
      setCompanies(p => p.filter(c => c.id !== id))
      sync(`/api/companies/${id}`, { method: 'DELETE' })
      addAuditLog('delete_company', id, `Company ${company?.name} deleted`)
      showToast('Company deleted')
    },
    
    // ── CRM - Contact Persons ──────────────────────────────────────────────────
    //
    // A contact person is an individual contact with an employer, so all three
    // actions write to the contacts directory. They used to write a separate
    // contact_persons table that no other screen read, which is why a person
    // added on the company form never appeared on that company's detail panel.
    createContactPerson: (c) => {
      const companyId = c.clientId || c.companyId || ''
      const fullName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()
      if (!companyId) {
        showToast('Pick a company before adding a contact person', 'error')
        return null as unknown as ContactPerson
      }
      if (!fullName) {
        showToast('A contact person needs a name', 'error')
        return null as unknown as ContactPerson
      }

      const existing = contactPersons.find(person =>
        person.clientId === companyId &&
        (
          (c.email && person.email?.trim().toLowerCase() === c.email.trim().toLowerCase()) ||
          (c.phone && person.phone?.replace(/\D/g, '').slice(-9) === c.phone.replace(/\D/g, '').slice(-9)) ||
          person.fullName.trim().toLowerCase() === fullName.toLowerCase()
        )
      )

      const id = existing?.id ?? uid()
      const payload = contactFromPersonInput({
        id,
        companyId,
        fullName,
        jobTitle: c.jobTitle,
        email: c.email,
        phone: c.phone,
        mobile: c.mobile,
        notes: c.notes,
      })

      // The directory write is the record. It is fire-and-forget only in the
      // sense that the caller is not awaited — failures are surfaced, never
      // swallowed the way the old contact-person sync did.
      void (existing
        ? storeCtxRef.current!.updateContact(id, payload as Partial<Contact>)
        : storeCtxRef.current!.addContact(payload as Omit<Contact, 'id' | 'createdAt'>)
      ).catch(() => {
        showToast(`${fullName} could not be saved — reopen the company and try again`, 'error')
      })

      if (!existing) {
        addAuditLog('create_contact_person', fullName, `Contact person added for ${c.companyName ?? companyId}`)
      }
      showToast(`${fullName} ${existing ? 'updated' : 'added'}`)

      return {
        ...c,
        id,
        clientId: companyId,
        companyId,
        fullName,
        createdDate: existing?.createdDate ?? now(),
      } as ContactPerson
    },
    updateContactPerson: (id, p) => {
      const person = contactPersons.find(c => c.id === id)
      if (!person) return
      const fullName = (p.firstName !== undefined || p.lastName !== undefined)
        ? `${p.firstName ?? person.firstName} ${p.lastName ?? person.lastName}`.trim()
        : person.fullName
      const patch: Partial<Contact> = {
        ...(fullName !== person.fullName ? { name: fullName } : {}),
        ...(p.jobTitle !== undefined ? { jobTitle: p.jobTitle } : {}),
        ...(p.email !== undefined ? { email: p.email } : {}),
        ...(p.phone !== undefined ? { phone: p.phone } : {}),
        ...(p.mobile !== undefined ? { mobile: p.mobile } : {}),
        ...(p.notes !== undefined ? { notes: p.notes } : {}),
        ...(p.clientId || p.companyId ? { companyId: p.clientId || p.companyId } : {}),
      }
      void storeCtxRef.current!.updateContact(id, patch).catch(() => {
        showToast('Contact person could not be saved — reopen the contact and try again', 'error')
      })
      showToast('Contact person updated')
    },
    deleteContactPerson: (id) => {
      void storeCtxRef.current!.deleteContact(id).catch(() => {
        showToast('Contact person could not be removed — it will reappear on refresh', 'error')
      })
      showToast('Contact person deleted')
    },
    
    // ── CRM - Opportunities ────────────────────────────────────────────────────
    createOpportunity: (opp) => {
      const user = currentUser()
      const company = companies.find(c => c.id === opp.companyId)
      const contact = contactPersons.find(cp => cp.id === opp.contactPersonId)
      
      // Lead scoring
      let leadScore = 0
      if (company?.segment === 'enterprise') leadScore += 30
      else if (company?.segment === 'sme') leadScore += 20
      else if (company?.segment === 'startup') leadScore += 10
      else if (company?.segment === 'government') leadScore += 25
      
      if (contact?.isDecisionMaker) leadScore += 25
      if (contact?.isTechnicalContact) leadScore += 10
      if (contact?.isPrimary) leadScore += 10
      
      if (opp.leadSource === 'referral') leadScore += 15
      if (opp.leadSource === 'existing_customer') leadScore += 20
      if (opp.leadSource === 'trade_show') leadScore += 10
      
      leadScore = Math.min(leadScore, 100)
      
      const opportunity: Opportunity = {
        ...opp,
        id: uid(),
        // Provisional: the server issues OPP/NNNN and the answer replaces it.
        // It used to come from this browser's own counter (duplicates).
        ref: allocateDocNumberSync('OPP'),
        createdDate: now(),
        quoteIds: [],
        actualValue: 0,
        leadScore,
        contactEmail: contact?.email,
        contactPhone: contact?.phone || contact?.mobile,
        ownerId: opp.ownerId ?? user?.id,
        assignedToId: opp.assignedToId ?? opp.ownerId ?? user?.id,
      }
      setOpportunities(p => [opportunity, ...p])
      addAuditLog('create_opportunity', opportunity.name, `Opportunity ${opportunity.name} created`)
      showToast('Opportunity created')
      void sync('/api/opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opportunity) })
        .then(async res => {
          if (!res || !res.ok) return
          const saved = await res.json().catch(() => null)
          if (saved?.id) storeCtxRef.current?.ingestOpportunity(saved)
        })
      return opportunity
    },
    ingestOpportunity: (raw) => {
      const normalized = normalizeOpportunityForClient(raw) as Opportunity
      if (!normalized?.id) return
      setOpportunities(prev => {
        const idx = prev.findIndex(o => o.id === normalized.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...prev[idx], ...normalized }
          return next
        }
        return [normalized, ...prev]
      })
    },
    updateOpportunity: (id, p) => setOpportunities(prev => {
      const next = prev.map(o => o.id === id ? { ...o, ...p, lastActivityDate: now() } : o)
      const updated = next.find(o => o.id === id)
      if (updated) sync(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      addAuditLog('update_opportunity', id, `Opportunity updated`)
      showToast('Opportunity updated')
      return next
    }),
    moveOpportunityStage: (id, stage) => setOpportunities(prev => {
      const next = prev.map(o => {
        if (o.id !== id) return o
        const probability = {
          prospecting: 10,
          qualification: 25,
          proposal: 50,
          negotiation: 75,
          closed_won: 100,
          closed_lost: 0,
          on_hold: o.probability,
        }[stage]
        return { ...o, stage, probability, lastActivityDate: now() }
      })
      const updated = next.find(o => o.id === id)
      if (updated) sync(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      addAuditLog('move_opportunity_stage', id, `Opportunity moved to ${stage}`)
      showToast(`Opportunity moved to ${stage.replace('_', ' ')}`)
      return next
    }),
    markOpportunityWon: (id, actualValue) => setOpportunities(prev => {
      const next = prev.map(o => o.id === id ? {
        ...o,
        stage: 'closed_won',
        probability: 100,
        actualValue,
        actualCloseDate: now(),
        lastActivityDate: now(),
      } : o)
      const updated = next.find(o => o.id === id)
      if (updated) sync(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      addAuditLog('win_opportunity', id, `Opportunity won - Value: ${actualValue}`)
      showToast('Opportunity marked as WON! 🎉', 'success')
      return next
    }),
    markOpportunityLost: (id, reason, competitor) => setOpportunities(prev => {
      const next = prev.map(o => o.id === id ? {
        ...o,
        stage: 'closed_lost',
        probability: 0,
        actualCloseDate: now(),
        lostReason: reason,
        lostToCompetitor: competitor,
        lastActivityDate: now(),
      } : o)
      const updated = next.find(o => o.id === id)
      if (updated) sync(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      addAuditLog('lose_opportunity', id, `Opportunity lost - Reason: ${reason}`)
      showToast('Opportunity marked as lost')
      return next
    }),
    deleteOpportunity: (id) => {
      setOpportunities(p => p.filter(o => o.id !== id))
      sync(`/api/opportunities/${id}`, { method: 'DELETE' })
      addAuditLog('delete_opportunity', id, `Opportunity deleted`)
      showToast('Opportunity deleted')
    },
    
    // ── CRM - Opportunity Activities ───────────────────────────────────────────
    logActivity: (activity) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      
      const act: OpportunityActivity = {
        ...activity,
        id: uid(),
        createdBy: user.id,
        createdByName: user.name,
        createdDate: now(),
      }
      setOpportunityActivities(p => [act, ...p])
      sync('/api/opportunity-activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(act) })
      setOpportunities(prev => {
        const next = prev.map(o => o.id === activity.opportunityId ? { ...o, lastActivityDate: now() } : o)
        const updated = next.find(o => o.id === activity.opportunityId)
        if (updated) sync(`/api/opportunities/${activity.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('log_activity', act.opportunityId, `Activity: ${act.subject}`)
      showToast('Activity logged')
      return act
    },
    completeActivity: (id, outcome) => setOpportunityActivities(prev => {
      const next = prev.map(a => a.id === id ? {
        ...a,
        status: 'completed',
        completedDate: now(),
        outcome: outcome ?? a.outcome,
      } : a)
      const updated = next.find(a => a.id === id)
      if (updated) sync(`/api/opportunity-activities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      showToast('Activity completed')
      return next
    }),
    
    // ── Customer Contracts ─────────────────────────────────────────────────────
    createCustomerContract: (contractInput) => {
      const contract: CustomerContract = {
        ...contractInput,
        id: uid(),
        ref: contractRef(),
      }
      setCustomerContracts(prev => [contract, ...prev])
      addAuditLog('create_contract', contract.companyName, `Contract for ${contract.companyName} created`)
      showToast('Contract created')
      return contract
    },
    updateCustomerContract: (id, patch) => {
      setCustomerContracts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
      addAuditLog('update_contract', id, 'Customer contract updated')
      showToast('Contract updated')
    },
    renewCustomerContract: (id) => {
      const current = customerContracts.find(c => c.id === id)
      if (!current) throw new Error('Contract not found')
      const renewed: CustomerContract = {
        ...current,
        id: uid(),
        ref: contractRef(),
        startDate: current.endDate,
        endDate: addDays(current.endDate, 365),
        renewalDate: addDays(current.endDate, 335),
        status: 'renewed',
      }
      setCustomerContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'renewed' } : c))
      setCustomerContracts(prev => [renewed, ...prev])
      addAuditLog('renew_contract', current.ref, `Renewed ${current.ref} for another year`)
      showToast(`Contract ${current.ref} renewed`)
      return renewed
    },
    terminateCustomerContract: (id, reason) => {
      setCustomerContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'terminated', notes: `${c.notes ?? ''} | Terminated: ${reason}` } : c))
      addAuditLog('terminate_contract', id, `Contract terminated: ${reason}`)
      showToast('Contract terminated')
    },
    
    // ── Sales - Quotes ─────────────────────────────────────────────────────────
    createQuote: async (quoteInput) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      if (Number(quoteInput.total ?? 0) < 1) {
        showToast('Quote total must be at least KES 1 — quotes below KES 1 cannot be created', 'error')
        return null
      }

      const quoteRef = await storeCtxRef.current!.allocateDocRef('QUO')
      const createdAt = now()
      const money = documentMoneySnapshot({
        currencyCode: quoteInput.currencyCode || companySettings.currency || FUNCTIONAL_CURRENCY,
        exchangeRateToBase: quoteInput.exchangeRateToBase,
      })
      const quote: Quote = {
        ...quoteInput,
        ...money,
        id: uid(),
        ref: quoteRef,
        quoteNumber: quoteRef,
        version: 1,
        issueDate: createdAt,
        quoteDate: createdAt,
        viewCount: 0,
        totalAmount: quoteInput.total,
        approvalStatus: 'not_required',
        approvalRequestIds: [],
        createdById: user.id,
        createdBy: user.id,
        createdByName: user.name,
        createdAt,
        updatedAt: createdAt,
      }
      setQuotes(p => [quote, ...p])
      sync('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quote) })
      setOpportunities(prev => {
        const next = prev.map(o => o.id === quote.opportunityId ? { ...o, quoteIds: [...o.quoteIds, quote.id] } : o)
        const updated = next.find(o => o.id === quote.opportunityId)
        if (updated) sync(`/api/opportunities/${quote.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('create_quote', quote.ref, `Quote created for ${quote.companyName}`)
      showToast(`Quote ${quote.ref} created`)
      return quote
    },
    updateQuote: (id, p) => setQuotes(prev => {
      const next = prev.map(q => q.id === id ? { ...q, ...p } : q)
      const updated = next.find(q => q.id === id)
      if (updated) sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      showToast('Quote updated')
      return next
    }),
    addQuoteLine: (quoteId, product, qty, discount = 0, customPrice) => {
      const quote = quotes.find(q => q.id === quoteId)
      if (!quote) return

      const priced = resolveListPrice({
        product,
        pricelist: quote.pricelist,
        qty,
        customPrice,
      })
      const unitPrice = priced.unitPrice
      const disc = Math.min(Math.max(discount, 0), 100)
      const discountAmount = Math.round(unitPrice * qty * disc / 100)
      const subtotal = unitPrice * qty - discountAmount
      const taxAmount = Math.round(subtotal * product.taxRate / 100)
      const lineTotal = subtotal + taxAmount
      
      const line: QuoteLineItem = {
        id: uid(),
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        description: product.description,
        qty,
        unit: product.unit,
        listPrice: priced.listPrice,
        unitPrice,
        discount: disc,
        discountAmount,
        taxRate: product.taxRate,
        taxAmount,
        subtotal,
        lineTotal,
      }
      
      const updatedLines = [...quote.lines, line]
      const newSubtotal = updatedLines.reduce((sum, l) => sum + l.subtotal, 0)
      const newTaxTotal = updatedLines.reduce((sum, l) => sum + l.taxAmount, 0)
      const newTotal = newSubtotal + newTaxTotal
      const totalDiscount = updatedLines.reduce((sum, l) => sum + l.discountAmount, 0)
      
      setQuotes(prev => {
        const next = prev.map(q => q.id === quoteId ? {
          ...q,
          lines: updatedLines,
          subtotal: newSubtotal, taxTotal: newTaxTotal, total: newTotal,
          discountAmount: totalDiscount,
          discountPercent: newSubtotal > 0 ? Math.round((totalDiscount / (newSubtotal + totalDiscount)) * 100 * 100) / 100 : 0,
        } : q)
        const updated = next.find(q => q.id === quoteId)
        if (updated) sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      
      showToast('Line item added to quote')
    },
    removeQuoteLine: (quoteId, lineId) => {
      const quote = quotes.find(q => q.id === quoteId)
      if (!quote) return
      
      const updatedLines = quote.lines.filter(l => l.id !== lineId)
      const newSubtotal = updatedLines.reduce((sum, l) => sum + l.subtotal, 0)
      const newTaxTotal = updatedLines.reduce((sum, l) => sum + l.taxAmount, 0)
      const newTotal = newSubtotal + newTaxTotal
      const totalDiscount = updatedLines.reduce((sum, l) => sum + l.discountAmount, 0)
      
      setQuotes(prev => {
        const next = prev.map(q => q.id === quoteId ? {
          ...q,
          lines: updatedLines,
          subtotal: newSubtotal, taxTotal: newTaxTotal, total: newTotal,
          discountAmount: totalDiscount,
          discountPercent: newSubtotal > 0 ? Math.round((totalDiscount / (newSubtotal + totalDiscount)) * 100 * 100) / 100 : 0,
        } : q)
        const updated = next.find(q => q.id === quoteId)
        if (updated) sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      
      showToast('Line item removed')
    },
    sendQuote: (id) => {
      const existing = quotes.find(q => q.id === id) as any
      if (!existing) return
      const quoteApprovalRequests = approvalRequests.filter(r => r.documentType === 'quote' && r.documentId === id && r.type === 'discount')
      if (quoteApprovalRequests.some(r => r.status === 'rejected')) {
        showToast(`${existing.ref ?? existing.quoteNumber} has a rejected discount approval. Revise before sending.`, 'error')
        return
      }
      if (quoteApprovalRequests.some(r => r.status === 'pending')) {
        showToast(`${existing.ref ?? existing.quoteNumber} is awaiting discount approval`, 'info')
        return
      }
      const maxDiscount = (existing.lines ?? existing.items ?? []).reduce((max: number, line: any) => Math.max(max, Number(line.discount ?? line.discountPct) || 0), 0)
      if (maxDiscount > 10 && quoteApprovalRequests.length === 0) {
        const user = currentUser()
        if (!user) return
        const request = createApprovalRequest('discount', 'quote', id, existing.ref ?? existing.quoteNumber ?? id, user.id, user.name, {
          reason: `Quote ${existing.ref ?? existing.quoteNumber ?? id} includes discount above 10%`,
          discountPercent: maxDiscount,
          discountAmount: Number(existing.discountAmount ?? 0),
          currentValue: Number(existing.total ?? existing.totalAmount ?? 0),
          proposedValue: Number(existing.total ?? existing.totalAmount ?? 0),
        }, users.map(u => ({ id: u.id, name: u.name, role: u.role })))
        setApprovalRequests(prev => [request, ...prev])
        const updatedQuote = { ...existing, approvalStatus: 'pending', approvalRequestIds: [...(existing.approvalRequestIds ?? []), request.id], approvalRequiredReason: request.details.reason }
        setQuotes(prev => prev.map(q => q.id === id ? updatedQuote : q))
        sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedQuote) })
        notifyUsers({
          recipients: approvalRecipientIds(request, users),
          type: 'system',
          title: `Quote approval needed: ${existing.ref ?? existing.quoteNumber}`,
          body: request.details.reason,
          module: 'sales',
          path: `/sales?id=${id}`,
          icon: '⚠️',
          entityKey: `quote:${id}:approval:${request.id}`,
          excludeUserId: currentUserId,
        })
        addAuditLog('quote_approval_requested', existing.ref ?? id, request.details.reason)
        showToast('Quote sent for approval before customer delivery', 'info')
        return
      }
      const sentDate = now()
      const updatedQuote = { ...existing, status: 'sent', sentDate, approvalStatus: quoteApprovalRequests.length ? 'approved' : (existing.approvalStatus ?? 'not_required') }
      setQuotes(prev => prev.map(q => q.id === id ? updatedQuote : q))
      sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedQuote) })

      const contact = contacts.find(c => c.id === existing.companyId || c.id === existing.clientId || c.companyId === existing.companyId || c.name === existing.companyName)
      const contactEmail = existing.contactEmail || existing.contactPersonEmail || contact?.email || ''
      const contactPhone = existing.contactPhone || existing.contactPersonPhone || contact?.phone || ''
      const channels = [
        ...(contactEmail ? ['email' as const] : []),
        ...(contactPhone ? ['whatsapp' as const] : []),
      ]

      if (channels.length === 0) {
        addAuditLog('send_quote', existing.ref ?? id, `Quote marked sent but no email/phone is available for ${existing.contactPersonName ?? existing.companyName ?? 'customer'}`)
        showToast('Quote marked sent, but no email or phone is available for delivery', 'info')
        return
      }

      fetch('/api/integrations/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: id,
          channels,
          quote: {
            ref: existing.ref ?? existing.quoteNumber ?? id,
            companyName: existing.companyName ?? contact?.name ?? 'Customer',
            contactPersonName: existing.contactPersonName ?? contact?.name ?? 'Customer',
            contactEmail,
            contactPhone,
            total: Number(existing.total ?? existing.totalAmount ?? 0),
            validUntil: existing.validUntil ?? addDays(sentDate, 7),
            ownerName: existing.createdByName ?? currentUser()?.name ?? 'Sales',
            lines: (existing.lines ?? existing.items ?? []).map((line: any) => ({
              productName: line.productName ?? line.description ?? 'Item',
              qty: Number(line.qty ?? 1),
              lineTotal: Number(line.lineTotal ?? line.subtotal ?? 0),
            })),
          },
        }),
      })
        .then(async res => {
          if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Quote delivery failed')
          addAuditLog('send_quote', existing.ref ?? id, `Quote sent to ${existing.contactPersonName ?? existing.companyName ?? 'customer'} via ${channels.join(', ')}`)
          showToast('Quote sent to customer')
        })
        .catch(err => {
          addAuditLog('send_quote_failed', existing.ref ?? id, err instanceof Error ? err.message : 'Quote delivery failed')
          showToast('Quote marked sent, but delivery failed', 'error')
        })
    },
    acceptQuote: (id) => setQuotes(prev => {
      const next = prev.map(q => q.id === id ? { ...q, status: 'accepted', acceptedDate: now() } : q)
      const updated = next.find(q => q.id === id)
      if (updated) sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      const quote = quotes.find(q => q.id === id)
      setOpportunities(p => {
        const n = p.map(o => o.id === quote?.opportunityId ? { ...o, stage: 'closed_won', probability: 100, lastActivityDate: now() } : o)
        const up = n.find(o => o.id === quote?.opportunityId)
        if (up) sync(`/api/opportunities/${quote?.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(up) })
        return n
      })
      addAuditLog('accept_quote', quote?.ref ?? id, `Quote accepted by customer`)
      showToast('Quote accepted — create sale order to proceed')
      return next
    }),
    rejectQuote: (id, reason) => setQuotes(prev => {
      const next = prev.map(q => q.id === id ? {
        ...q, status: 'rejected', rejectedDate: now(), rejectionReason: reason,
      } : q)
      const updated = next.find(q => q.id === id)
      if (updated) sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      const quote = quotes.find(q => q.id === id)
      addAuditLog('reject_quote', quote?.ref ?? id, `Quote rejected: ${reason}`)
      showToast('Quote rejected by customer')
      return next
    }),
    convertQuoteToSaleOrder: async (quoteId) => {
      const quote = quotes.find(q => q.id === quoteId)
      if (!quote) return null
      if (!['accepted', 'sent', 'viewed'].includes(quote.status)) {
        showToast('Only accepted or sent quotes can be converted to a sale order', 'error'); return null
      }
      // Prevent duplicate SOs — if a SO already references this quote, return it
      const existing = saleOrders.find(s => s.quoteId === quoteId)
      if (existing) {
        showToast(`Sale Order ${existing.ref} already exists for this quote`, 'info'); return existing
      }
      
      // Find or create legacy contact for company
      let contact = contacts.find(c => c.companyId === quote.companyId || c.name === quote.companyName)
      if (!contact) {
        const company = companies.find(comp => comp.id === quote.companyId)
        if (company) {
          // Saved to the clients table (the deed_contacts screen copy is frozen).
          const res = await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'company',
              name: company.name,
              email: company.email,
              phone: company.phone,
              address: company.physicalAddress,
              vatNumber: company.taxId,
              companyId: company.id,
              isCustomer: true,
              isVendor: false,
              tags: company.tags,
              creditLimit: company.creditLimit,
              paymentTerms: `${company.paymentTerms} days`,
            }),
          }).catch(() => null)
          const saved = res?.ok ? await res.json().catch(() => null) as Contact | null : null
          if (saved?.id) {
            contact = saved
            setContacts(p => p.some(c => c.id === saved.id) ? p : [saved, ...p])
          }
        }
      }
      
      const so: SaleOrder = {
        id: uid(),
        ref: await storeCtxRef.current!.allocateDocRef('QUO'),
        status: 'quotation',
        customerId: contact?.id ?? quote.companyId,
        customerName: quote.companyName,
        date: now(),
        validUntil: addDays(now(), 30),
        lines: quote.lines.map(ql => ({
          id: uid(),
          productId: ql.productId,
          productName: ql.productName,
          qty: ql.qty,
          unitPrice: ql.unitPrice,
          discount: ql.discount,
          taxRate: ql.taxRate,
          subtotal: ql.subtotal,
          serialIds: [],
        })),
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        notes: quote.notes ?? '',
      }
      
      setSaleOrders(p => [so, ...p])
      sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })
      setQuotes(prev => {
        const next = prev.map(q => q.id === quoteId ? {
          ...q, status: 'accepted', saleOrderId: so.id, convertedDate: now(),
        } : q)
        const updated = next.find(q => q.id === quoteId)
        if (updated) sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })

      // Do not reserve at quotation conversion — same as createSaleOrder.
      // Reservation happens during delivery preparation after Confirm.
      // Reserving here made confirmSO treat the order's own reservation as a
      // shortage and falsely raise Backorder approval.

      // Close linked opportunity as won
      if (quote.opportunityId) {
        setOpportunities(prev => {
          const next = prev.map(opp => opp.id === quote.opportunityId ? {
            ...opp, stage: 'closed_won', actualValue: quote.total, closedDate: now(), wonReason: 'Quote accepted and converted to sales order'
          } : opp)
          const updated = next.find(o => o.id === quote.opportunityId)
          if (updated) sync(`/api/opportunities/${quote.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        addAuditLog('close_opportunity_won', quote.opportunityId, `Opportunity won via ${so.ref}`)
      }
      
      addAuditLog('convert_quote', quote.ref, `Quote converted to ${so.ref} • Stock reserved`)
      showToast(`Sale order ${so.ref} created • Stock reserved`)
      return so
    },

    convertRepairQuoteToSOAndInvoice: async (quoteId) => {
      const quote = quotes.find(q => q.id === quoteId)
      if (!quote || quote.source !== 'repair') return null

      const soId = uid()
      const soRef = await storeCtxRef.current!.allocateDocRef('SO')
      const soLines = quote.lines.map(ql => ({
        id: uid(),
        productId: ql.productId,
        productName: ql.productName,
        qty: ql.qty,
        unitPrice: ql.unitPrice,
        discount: ql.discount,
        taxRate: ql.taxRate,
        subtotal: ql.subtotal,
        serialIds: [] as string[],
      }))
      const so: SaleOrder = {
        id: soId,
        ref: soRef,
        status: 'sale',
        confirmedAt: new Date().toISOString(),
        customerId: quote.companyId,
        customerName: quote.companyName,
        date: now(),
        validUntil: addDays(now(), 30),
        lines: soLines,
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        notes: quote.notes ?? '',
      }
      setSaleOrders(p => [so, ...p])
      sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })

      const invLines: InvoiceLine[] = quote.lines.map(ql => ({
        id: uid(),
        description: ql.description ?? ql.productName,
        qty: ql.qty,
        unitPrice: ql.unitPrice,
        taxRate: (quote.taxTotal ?? quote.taxAmount ?? 0) > 0 ? companySettings.vatRate : 0,
        subtotal: ql.subtotal,
      }))
      const invoice: Invoice = {
        id: uid(),
        ref: await storeCtxRef.current!.allocateDocRef('INV'),
        type: 'customer_invoice',
        status: 'posted',
        partnerId: quote.companyId,
        partnerName: quote.companyName,
        date: now(),
        dueDate: addDays(now(), customerPaymentTermsDays(contacts.find(c => c.id === quote.companyId), 14, systemSettings.accCreditPayOnReceiptEnforced)),
        lines: invLines,
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        amountPaid: 0,
        saleOrderId: soId,
        notes: quote.notes ?? '',
      }
      setInvoices(p => [invoice, ...p])
      postInvoiceJournalOnce(invoice)
      void saveInvoiceToServer(invoice, msg => showToast(msg, 'error'))

      setQuotes(p => {
        const next = p.map(q => q.id === quoteId ? {
          ...q, status: 'accepted', saleOrderId: soId, invoiceId: invoice.id, acceptedDate: now(), convertedDate: now(),
        } : q)
        const updated = next.find(q => q.id === quoteId)
        if (updated) sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })

      // Link back to repair
      if (quote.repairId) {
        setRepairs(p => p.map(r => r.id === quote.repairId ? {
          ...r, saleOrderId: soId, saleOrderRef: soRef, invoiceId: invoice.id, invoiceDate: now(), status: 'approved',
          quote: r.quote ? { ...r.quote, approvedDate: now(), approvedBy: 'customer' } : r.quote,
        } : r))
      }

      addAuditLog('convert_repair_quote', quote.ref, `Repair quote → ${soRef} + ${invoice.ref}`)
      showToast(`${soRef} & ${invoice.ref} created`)
      return { so, invoice }
    },

    reviseQuote: async (quoteId, changes) => {
      const originalQuote = quotes.find(q => q.id === quoteId)
      if (!originalQuote) return {} as Quote
      
      // Mark original as revised
      setQuotes(prev => {
        const next = prev.map(q => q.id === quoteId ? { ...q, status: 'revised' } : q)
        sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next.find(q => q.id === quoteId)) })
        return next
      })
      
      // Create new version
      const user = currentUser()
      const newQuote: Quote = {
        ...originalQuote,
        id: uid(),
        ref: await storeCtxRef.current!.allocateDocRef('QUO'),
        version: originalQuote.version + 1,
        status: 'draft',
        issueDate: now(),
        validUntil: addDays(now(), 14),
        parentQuoteId: quoteId,
        revisionNotes: changes,
        sentDate: undefined,
        viewedDate: undefined,
        viewCount: 0,
        acceptedDate: undefined,
        rejectedDate: undefined,
        saleOrderId: undefined,
        convertedDate: undefined,
        lines: originalQuote.lines.map(line => ({ ...line, id: uid() })),
      }
      
      setQuotes(p => [newQuote, ...p])
      sync('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newQuote) })
      addAuditLog('revise_quote', newQuote.ref, `Quote revised from ${originalQuote.ref} - v${newQuote.version}`)
      showToast(`Revised quote ${newQuote.ref} (v${newQuote.version}) created`)
      return newQuote
    },
    deleteQuote: (id) => {
      const quote = quotes.find(q => q.id === id)
      setQuotes(p => p.filter(q => q.id !== id))
      sync(`/api/quotes/${id}`, { method: 'DELETE' })
      addAuditLog('delete_quote', quote?.ref ?? id, `Quote deleted`)
      showToast('Quote deleted')
    },

    refreshProductCatalog,

    // ── Sale Orders ───────────────────────────────────────────────────────────
    createSaleOrder: async (customerId, customerName, initial = {}) => {
      const user = currentUser()
      const initialLines = initial.lines ?? []
      const totals = calcSO(initialLines)
      const money = documentMoneySnapshot({
        currencyCode: (initial as any).currencyCode || companySettings.currency || FUNCTIONAL_CURRENCY,
        exchangeRateToBase: (initial as any).exchangeRateToBase,
      })
      const soRef = await storeCtxRef.current!.allocateDocRef('QUO')
      const headerDiscount = Math.max(0, Number(initial.discountAmount) || 0)
      const so: SaleOrder = {
        id: uid(), ref: soRef, status: 'quotation', customerId, customerName,
        date: now(), validUntil: initial.validUntil ?? addDays(now(), 30), lines: initialLines, ...totals,
        approvalStatus: 'not_required', approvalRequestIds: [], stockReservationIds: [],
        deliveryDate: initial.deliveryDate,
        paymentTerms: initial.paymentTerms,
        notes: initial.notes ?? '',
        termsAndConditions: initial.termsAndConditions,
        optionalProducts: initial.optionalProducts ?? [],
        customerRef: initial.customerRef,
        opportunityId: initial.opportunityId,
        invoiceAddress: initial.invoiceAddress,
        deliveryAddress: initial.deliveryAddress,
        pricelist: initial.pricelist || 'RETAIL',
        pricelistId: (initial as any).pricelistId,
        discountAmount: headerDiscount,
        total: Math.max(0, (totals.total ?? 0) - headerDiscount),
        totalAmount: Math.max(0, (totals.totalAmount ?? totals.total ?? 0) - headerDiscount),
        ...money,
        // Odoo defaults the salesperson to the creating user; the form may override.
        salespersonId: initial.salespersonId ?? user?.id,
        salespersonName: initial.salespersonName ?? user?.name,
        salesTeam: initial.salesTeam,
        createdByUserId: user?.id, createdByName: user?.name,
      }
      setSaleOrders(p => [so, ...p])
      try {
        const res = await fetch('/api/sale-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(so),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setSaleOrders(p => p.filter(x => x.id !== so.id))
          showToast(String(data?.error || `Could not save ${so.ref}`), 'error')
          throw new Error(String(data?.error || `Could not save ${so.ref}`))
        }
        // Prefer server row when returned (stable refs / resolved product links).
        if (data && typeof data === 'object' && data.id) {
          const normalized = normalizeSaleOrdersForClient([data])[0] as SaleOrder
          setSaleOrders(p => p.map(x => x.id === so.id || x.id === normalized.id ? { ...so, ...normalized } : x))
          showToast(`${normalized.ref || so.ref} created`)
          return { ...so, ...normalized }
        }
      } catch (err) {
        if (err instanceof Error && /Could not save/.test(err.message)) throw err
        setSaleOrders(p => p.filter(x => x.id !== so.id))
        showToast(`Could not save ${so.ref} — check connection and try again`, 'error')
        throw err instanceof Error ? err : new Error(`Could not save ${so.ref}`)
      }
      showToast(`${so.ref} created`)
      return so
    },
    updateSaleOrder: async (id, p, opts) => {
      const existing = soRef.current.find(s => s.id === id)
      if (!existing) return false
      // Sent / confirmed documents are locked for content edits. Allow narrow
      // metadata (e.g. proformaRef) so PDF helpers still work without a reset.
      const keys = Object.keys(p)
      const metadataOnly = keys.length > 0 && keys.every(k =>
        k === 'proformaRef' || k === 'notes' || k === 'validUntil'
        || k === 'acceptedAt' || k === 'acceptedById' || k === 'acceptedByName'
        || k === 'salespersonId' || k === 'salespersonName',
      )
      if (existing.status !== 'quotation' && !metadataOnly) {
        showToast(
          existing.status === 'quotation_sent'
            ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
            : 'Only draft quotations can be edited. Reset to quotation first.',
          'error',
        )
        return false
      }
      if (existing.locked && !metadataOnly) {
        showToast('Unlock this quotation before editing', 'error')
        return false
      }
      const syncLines = Object.prototype.hasOwnProperty.call(p, 'lines')
      // Line changes stay local until Save ({ persist: true }). Immediate Prisma
      // PATCH + blob SSE was restoring deleted products before the user saved.
      const persistLines = syncLines && opts?.persist === true
      const softPersist = opts?.soft === true

      // Draft deletes/adds live on soRef. Never let a stale React `activeOrder.lines`
      // (passed from Save) or a stale soft-flush payload resurrect removals.
      let linesForUpdate = syncLines && Array.isArray(p.lines) ? p.lines as SaleOrderLine[] : existing.lines
      if (syncLines && Array.isArray(p.lines) && isSaleOrderDraftEditing(id)) {
        // Prefer the live draft order (add/remove already applied). Overlay only
        // refreshes field edits for ids still present.
        const draft = soRef.current.find(s => s.id === id) ?? existing
        const overlay = new Map((p.lines as SaleOrderLine[]).map(l => [l.id, l]))
        const draftIds = new Set(draft.lines.map(l => l.id))
        linesForUpdate = draft.lines.map(l => overlay.get(l.id) ?? l)
        // Explicit Save may carry a brand-new inline-editor line not yet on soRef.
        // Never re-append ids that already existed on the pre-edit row — those are
        // deletes. Soft auto-persist must never append payload-only ids at all.
        if (persistLines && !softPersist) {
          const preexistingIds = new Set(existing.lines.map(l => l.id))
          linesForUpdate = [
            ...linesForUpdate,
            ...(p.lines as SaleOrderLine[]).filter(
              l => l?.id && !draftIds.has(l.id) && !preexistingIds.has(l.id),
            ),
          ]
        }
      }
      const updated = syncLines
        ? { ...existing, ...p, lines: linesForUpdate, ...calcSO(linesForUpdate) }
        : { ...existing, ...p }

      if (syncLines && !persistLines) {
        applyLocalDraftSaleOrder(soRef, setSaleOrders, id, updated)
        scheduleDraftSaleOrderLinePersist(id)
        return true
      }

      if (persistLines) {
        applyLocalDraftSaleOrder(soRef, setSaleOrders, id, updated)
      } else {
        soRef.current = soRef.current.map(s => s.id === id ? updated : s)
        setSaleOrders(prev => prev.map(s => s.id === id ? updated : s))
      }

      const persist = async (retry = 0) => {
        // Re-read draft at persist time so a delete that landed after click still wins.
        const live = soRef.current.find(s => s.id === id) ?? updated
        const persistPayload = persistLines
          ? { ...live, lines: live.lines, ...calcSO(live.lines as SaleOrderLine[]) }
          : p
        const sentFingerprint = persistLines
          ? saleOrderLinesFingerprint((persistPayload as SaleOrder).lines)
          : ''
        // Metadata: send only the patch so a notes keystroke cannot rewrite lines.
        // Save: send the full draft row (minus lockVersion).
        const body = persistLines
          ? (persistPayload as unknown as Record<string, unknown>)
          : (p as unknown as Record<string, unknown>)
        // Soft auto-persist must not rewrite the shared blob mid-edit.
        if (softPersist) {
          ;(body as Record<string, unknown>).skipBroadcast = true
        }
        // Soft flushes are generation-gated: if Save or a newer edit superseded
        // this snapshot, skip the HTTP write so a stale A+B cannot land after A.
        if (softPersist && isSaleOrderHardSaving(id)) {
          return false
        }
        if (softPersist && persistLines && sentFingerprint) {
          const liveNow = soRef.current.find(s => s.id === id)
          if (
            liveNow
            && saleOrderLinesFingerprint(liveNow.lines) !== sentFingerprint
          ) {
            // Local draft moved since this soft snapshot was built — never write
            // the stale line set. A newer soft flush (or Save) owns persistence.
            if (!isSaleOrderHardSaving(id)) scheduleDraftSaleOrderLinePersist(id)
            return false
          }
        }
        const result = await patchSaleOrderPersist(id, body)
        if (!result.ok) {
          if (persistLines) {
            // Soft auto-persist must never erase the user's draft. Keep the mark
            // and retry quietly — explicit Save can still surface an error.
            if (softPersist) {
              if (!isSaleOrderHardSaving(id)) {
                markSaleOrderDraftEdit(id)
                scheduleDraftSaleOrderLinePersist(id)
              }
              return false
            }
            const latest = soRef.current.find(s => s.id === id)
            const stillOurs = latest && latest.lines === updated.lines
            if (stillOurs) {
              soRef.current = soRef.current.map(s => s.id === id ? existing : s)
              setSaleOrders(prev => prev.map(s => s.id === id ? existing : s))
            }
          }
          if (!softPersist) showToast(result.error, 'error')
          return false
        }
        const latestAfter = soRef.current.find(s => s.id === id)
        const localMoved = persistLines
          && !!latestAfter
          && saleOrderLinesFingerprint(latestAfter.lines) !== sentFingerprint
        // Soft response after Save/hard gate: keep local draft, never re-arm from stale.
        if (softPersist && isSaleOrderHardSaving(id)) {
          applySaleOrderPersistResult(setSaleOrders, soRef, id, result.data, { syncLines: false })
          return true
        }
        if (persistLines && (softPersist || localMoved)) {
          // Background sync / slower response: keep local lines, refresh lock only.
          applySaleOrderPersistResult(setSaleOrders, soRef, id, result.data, { syncLines: false })
          markSaleOrderDraftEdit(id)
          try {
            const serialized = JSON.stringify(soRef.current)
            rememberSaleOrdersSnapshot(serialized)
            _pendingSync['deed_saleOrders'] = serialized
            addDirtyKey('deed_saleOrders')
            persistClientStoreValue('deed_saleOrders', serialized)
          } catch { /* ignore */ }
          if (softPersist) {
            // Soft sync stays silent. If Save started, do not re-arm draft soft flushes.
            if (!isSaleOrderHardSaving(id) && localMoved) scheduleDraftSaleOrderLinePersist(id)
            return true
          }
          // Explicit Save while the user kept editing — persist the newer draft.
          if (retry < 2) return persist(retry + 1)
          scheduleDraftSaleOrderLinePersist(id)
          return true
        }
        applySaleOrderPersistResult(setSaleOrders, soRef, id, result.data, {
          syncLines: persistLines,
          expectedLinesFingerprint: sentFingerprint || undefined,
        })
        if (persistLines) {
          // Prefer the lines we just saved when pinning — never reopen the door
          // for a stale blob SSE to restore deleted products after Save.
          const savedLines = Array.isArray((persistPayload as SaleOrder).lines)
            ? (persistPayload as SaleOrder).lines
            : soRef.current.find(s => s.id === id)?.lines
          // If Prisma echoed more commercial lines than we sent, keep the draft
          // (stale server / race) — never let Save put deleted products back.
          const serverLines = Array.isArray(result.data?.lines) ? result.data.lines : null
          const savedCommercial = (savedLines ?? []).filter((l: any) => l?.lineType !== 'section')
          const serverCommercial = (serverLines ?? []).filter((l: any) => l?.lineType !== 'section')
          if (serverLines && savedCommercial.length < serverCommercial.length) {
            const pinnedOrder = {
              ...(soRef.current.find(s => s.id === id) ?? updated),
              lines: savedLines ?? [],
              ...calcSO((savedLines ?? []) as SaleOrderLine[]),
            }
            soRef.current = soRef.current.map(s => s.id === id ? pinnedOrder : s)
            setSaleOrders(prev => prev.map(s => s.id === id ? pinnedOrder : s))
            stampSaleOrderPersisted(id, pinnedOrder.lines)
          } else {
            stampSaleOrderPersisted(id, serverLines ?? savedLines ?? [])
          }
          try {
            const serialized = JSON.stringify(soRef.current)
            rememberSaleOrdersSnapshot(serialized)
            _pendingSync['deed_saleOrders'] = serialized
            addDirtyKey('deed_saleOrders')
            persistClientStoreValue('deed_saleOrders', serialized)
          } catch { /* ignore */ }
          // Push the saved snapshot to the blob before dropping the draft lock
          // window; stampSaleOrderPersisted still guards SSE for ~20s.
          void flushServerSync()
        }
        return true
      }

      if (existing && ('customerId' in p || 'customerName' in p || 'invoiceAddress' in p)) {
        const contact = contacts.find(c => c.id === (p.customerId ?? existing.customerId))
        const name = String(p.customerName ?? existing.customerName ?? contact?.name ?? '').trim()
        const address = 'invoiceAddress' in p
          ? (p.invoiceAddress || undefined)
          : (existing.invoiceAddress || (contact ? formatCustomerAddress(contact) : undefined))
        syncCustomerIdentityToDocuments({
          contactId: p.customerId ?? existing.customerId,
          saleOrderId: id,
          identity: {
            name,
            email: contact?.email || undefined,
            phone: contact?.phone || contact?.mobile || undefined,
            address,
            customerId: p.customerId ?? existing.customerId,
          },
        })
      }

      if (persistLines) {
        if (softPersist) return persist()
        // Explicit Save: cancel soft work, wait for any in-flight soft PATCH,
        // then write the latest soRef lines so a slower soft cannot win.
        beginHardSaleOrderPersist(id)
        await waitForDraftSaleOrderPersistIdle(id)
        try {
          return await persist()
        } finally {
          endHardSaleOrderPersist(id)
        }
      }
      void persist()
      return true
    },
    addSOLine: (orderId, product, qty, discount = 0, defaultTaxRate = 0) => {
      if (qty <= 0) {
        showToast('Quantity must be greater than zero', 'error')
        return false
      }
      const so = soRef.current.find(s => s.id === orderId)
      if (!so) return false
      if (so.status !== 'quotation') {
        showToast(
          so.status === 'quotation_sent'
            ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
            : 'Only draft quotations can add lines',
          'error',
        )
        return false
      }
      if (so.locked) {
        showToast('Unlock this quotation before adding lines', 'error')
        return false
      }
      // Quotation lines may exceed current availability. Reservation and
      // serial allocation happen only after confirmation in delivery prep.
      const priced = resolveListPrice({
        product,
        pricelist: so.pricelist,
        qty,
      })
      const unitPrice = priced.unitPrice
      const ex = so.lines.find(l => l.productId === product.id)
      // Add Product VAT checkbox is authoritative (see resolveAddSaleOrderLineTaxRate).
      const taxRate = resolveAddSaleOrderLineTaxRate({
        explicitTaxRate: defaultTaxRate,
        existingTaxRate: ex?.taxRate,
        merging: Boolean(ex),
      })
      let lines: SaleOrderLine[]
      if (ex) {
        const nextQty = ex.qty + qty
        const nextPriced = resolveListPrice({ product, pricelist: so.pricelist, qty: nextQty })
        lines = so.lines.map(l => l.productId === product.id ? {
          ...l,
          qty: nextQty,
          unitPrice: nextPriced.unitPrice,
          listPrice: nextPriced.listPrice,
          taxRate,
          subtotal: Math.round(nextPriced.unitPrice * nextQty * (1 - l.discount / 100)),
        } : l)
      } else {
        const sub = Math.round(unitPrice * qty * (1 - discount / 100))
        lines = [...so.lines, {
          id: uid(),
          productId: product.id,
          productName: product.name,
          qty,
          unitPrice,
          listPrice: priced.listPrice,
          discount,
          taxRate,
          subtotal: sub,
          serialIds: [],
          accountCode: resolveProductAccounts(product).saleAccountCode,
        }]
      }
      const updated = { ...so, lines, ...calcSO(lines) }
      applyLocalDraftSaleOrder(soRef, setSaleOrders, orderId, updated)
      scheduleDraftSaleOrderLinePersist(orderId)
      return true
    },
    assignSerialToSOLine: (orderId, lineId, serialId) => {
      setSaleOrders(p => p.map(so => {
        if (so.id !== orderId) return so
        const lines = so.lines.map(l => {
          if (l.id !== lineId) return l
          if (l.serialIds.includes(serialId)) return l
          if (l.serialIds.length >= l.qty) { showToast('All serials assigned for this line', 'error'); return l }
          return { ...l, serialIds: [...l.serialIds, serialId] }
        })
        const updated = { ...so, lines }
        sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleOrderPersistBody(updated as unknown as Record<string, unknown>)) })
        return updated
      }))
      setSerials(p => p.map(s => s.id === serialId ? { ...s, status: 'assigned' } : s))
    },
    assignSerialsToSOLine: (orderId, lineId, serialIds) => {
      if (!serialIds.length) return
      const so = soRef.current.find(s => s.id === orderId)
      const line = so?.lines.find((l: any) => l.id === lineId)
      if (!so || !line) return
      const current: string[] = line.serialIds || []
      const room = Math.max(0, Number(line.qty) - current.length)
      const toAdd = serialIds.filter(id => !current.includes(id)).slice(0, room)
      if (!toAdd.length) { showToast('All serials assigned for this line', 'error'); return }
      if (toAdd.length < serialIds.length) {
        showToast(`Only ${toAdd.length} of ${serialIds.length} serials assigned — line quantity reached`, 'info')
      }
      setSaleOrders(p => p.map(order => {
        if (order.id !== orderId) return order
        const lines = order.lines.map((l: any) => l.id === lineId ? { ...l, serialIds: [...(l.serialIds || []), ...toAdd] } : l)
        const updated = { ...order, lines }
        sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleOrderPersistBody(updated as unknown as Record<string, unknown>)) })
        return updated
      }))
      const nextSerialIds = [...current, ...toAdd]
      const pendingDelivery = delRef.current.find(d =>
        d.saleOrderId === orderId && ['draft', 'waiting', 'ready'].includes(d.status),
      )
      if (pendingDelivery) {
        // Pair SO lines → DN lines so duplicate products update only this row.
        const pairs = pairOrderLinesWithDeliveryLines(so.lines, pendingDelivery.lines)
        const targetPair = pairs.find(p => (p.orderLine as any).id === lineId)
        const targetDn = targetPair?.deliveryLine
        const lines = pendingDelivery.lines.map(deliveryLine =>
          targetDn && deliveryLine === targetDn
            ? { ...deliveryLine, serialIds: nextSerialIds }
            : deliveryLine,
        )
        setDeliveries(prev => prev.map(d => d.id === pendingDelivery.id ? { ...d, lines, status: 'waiting' as const, preparedAt: undefined } : d))
        sync(`/api/deliveries/${pendingDelivery.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines, status: 'waiting', preparedAt: null }),
        })
      }
      setSerials(p => p.map(s => {
        if (!toAdd.includes(s.id)) return s
        const updated = { ...s, status: 'assigned' as const, saleOrderId: orderId }
        sync(`/api/serials/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
    },
    unassignSerialFromSOLine: (orderId, lineId, serialId) => {
      setSaleOrders(p => p.map(so => {
        if (so.id !== orderId) return so
        const lines = so.lines.map(l => {
          if (l.id !== lineId) return l
          return { ...l, serialIds: (l.serialIds || []).filter(id => id !== serialId) }
        })
        const updated = { ...so, lines }
        sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleOrderPersistBody(updated as unknown as Record<string, unknown>)) })
        return updated
      }))
      const so = soRef.current.find(order => order.id === orderId)
      const line = so?.lines.find(item => item.id === lineId)
      const nextSerialIds = (line?.serialIds || []).filter(id => id !== serialId)
      const pendingDelivery = delRef.current.find(d =>
        d.saleOrderId === orderId && ['draft', 'waiting', 'ready'].includes(d.status),
      )
      if (pendingDelivery && line) {
        const pairs = pairOrderLinesWithDeliveryLines(so?.lines ?? [], pendingDelivery.lines)
        const targetDn = pairs.find(p => (p.orderLine as any).id === lineId)?.deliveryLine
        const lines = pendingDelivery.lines.map(deliveryLine =>
          targetDn && deliveryLine === targetDn
            ? { ...deliveryLine, serialIds: nextSerialIds }
            : deliveryLine,
        )
        setDeliveries(prev => prev.map(d => d.id === pendingDelivery.id ? { ...d, lines, status: 'waiting' as const, preparedAt: undefined } : d))
        sync(`/api/deliveries/${pendingDelivery.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines, status: 'waiting', preparedAt: null }),
        })
      }
      setSerials(p => p.map(s => {
        if (s.id !== serialId) return s
        const updated = { ...s, status: 'available' as const, saleOrderId: undefined }
        sync(`/api/serials/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
    },
    removeSOLine: (orderId, lineId) => {
      const so = soRef.current.find(s => s.id === orderId)
      if (!so) return false
      if (so.status !== 'quotation') {
        showToast(
          so.status === 'quotation_sent'
            ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
            : 'Only draft quotations can remove lines',
          'error',
        )
        return false
      }
      if (so.locked) {
        showToast('Unlock this quotation before removing lines', 'error')
        return false
      }
      const line = so.lines.find(l => l.id === lineId)
      if (line?.serialIds?.length) {
        setSerials(p => p.map(s => line.serialIds.includes(s.id) ? { ...s, status: 'available' } : s))
      }
      const lines = so.lines.filter(l => l.id !== lineId)
      const updated = { ...so, lines, ...calcSO(lines) }
      applyLocalDraftSaleOrder(soRef, setSaleOrders, orderId, updated)
      scheduleDraftSaleOrderLinePersist(orderId)
      return true
    },
    moveSOLine: (orderId, lineId, direction) => {
      const so = soRef.current.find(s => s.id === orderId)
      if (!so) return false
      if (so.status !== 'quotation') {
        showToast(
          so.status === 'quotation_sent'
            ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
            : 'Only draft quotations can reorder lines',
          'error',
        )
        return false
      }
      if (so.locked) {
        showToast('Unlock this quotation before reordering lines', 'error')
        return false
      }
      const index = so.lines.findIndex((l: any) => l.id === lineId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= so.lines.length) return false
      const lines = [...so.lines]
      ;[lines[index], lines[target]] = [lines[target], lines[index]]
      const updated = { ...so, lines }
      applyLocalDraftSaleOrder(soRef, setSaleOrders, orderId, updated)
      scheduleDraftSaleOrderLinePersist(orderId)
      return true
    },
    addSOSection: (orderId, title) => {
      const so = soRef.current.find(s => s.id === orderId)
      if (!so) return false
      if (so.status !== 'quotation') {
        showToast(
          so.status === 'quotation_sent'
            ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
            : 'Only draft quotations can add sections',
          'error',
        )
        return false
      }
      if (so.locked) {
        showToast('Unlock this quotation before adding sections', 'error')
        return false
      }
      const sectionTitle = String(title ?? '').trim() || 'Section'
      const lines = [...so.lines, {
        id: uid(),
        lineType: 'section' as const,
        productId: '',
        productName: sectionTitle,
        description: sectionTitle,
        qty: 0,
        unitPrice: 0,
        discount: 0,
        taxRate: 0,
        subtotal: 0,
        serialIds: [],
      }]
      const updated = { ...so, lines, ...calcSO(lines) }
      applyLocalDraftSaleOrder(soRef, setSaleOrders, orderId, updated)
      scheduleDraftSaleOrderLinePersist(orderId)
      return true
    },
    confirmSO: async (id, opts) => {
      const user = currentUser()
      if (!userCan(user, 'sales.orders.confirm')) {
        showToast('Unauthorized to confirm Sales Orders', 'error'); return;
      }
      const reserveStock = opts?.reserveStock !== false
      let so = soRef.current.find(s => s.id === id)
      if (!so) return

      // Flush unsaved draft line edits before confirm (add/remove stay local until Save).
      if (isSaleOrderDraftEditing(id)) {
        const flushed = await storeCtxRef.current!.updateSaleOrder(id, {
          lines: so.lines,
          subtotal: so.subtotal,
          taxTotal: so.taxTotal,
          total: so.total,
        }, { persist: true })
        if (flushed === false) return
        so = soRef.current.find(s => s.id === id)
        if (!so) return
      }

      // Already a durable Sales Order — never re-confirm / duplicate DNs.
      if (so.status === 'sale' || (saleOrderLooksConfirmed(so) && so.status !== 'cancelled')) {
        const openDn = delRef.current.filter(d => d.saleOrderId === id && isOpenDeliveryStatus(d.status))
        if (openDn.length === 0 && so.status === 'sale') {
          await storeCtxRef.current!.ensureWaitingDeliveryForSO(id)
        }
        if (so.status !== 'sale') {
          // Status drifted locally; heal Prisma + local without allocating a new SO number.
          try {
            const healRes = await fetch(`/api/sale-orders/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: 'sale',
                confirmedAt: so.confirmedAt ?? new Date().toISOString(),
                orderNumber: so.orderNumber ?? so.ref,
                quotationRef: so.quotationRef,
                confirmedById: so.confirmedById ?? user.id,
                confirmedByName: so.confirmedByName ?? user.name,
              }),
            })
            if (healRes.ok) {
              const healed = await healRes.json().catch(() => null)
              setSaleOrders(p => p.map(s => s.id !== id ? s : {
                ...s,
                status: 'sale' as const,
                lockVersion: healed?.lockVersion ?? s.lockVersion,
                confirmedAt: healed?.confirmedAt ?? s.confirmedAt,
                orderNumber: healed?.orderNumber ?? s.orderNumber,
                ref: healed?.ref ?? healed?.orderNumber ?? s.ref,
              }))
            }
          } catch { /* heal best-effort */ }
        }
        showToast(`${so.ref} is already a Sales Order`, 'info')
        return
      }

      if (so.status !== 'quotation' && so.status !== 'quotation_sent') {
        showToast(`${so.ref} is already ${so.status === 'cancelled' ? 'cancelled' : so.status}`, 'info')
        return
      }
      if (confirmingSaleOrderIds.has(id)) {
        showToast('Confirmation already in progress', 'info')
        return
      }

      const existingOpen = delRef.current.filter(d => d.saleOrderId === id && isOpenDeliveryStatus(d.status))
      // Open DN already exists while SO is still quotation → confirm SO onto that DN (no second DN).
      const reuseDelivery = existingOpen[0] ?? null

      confirmingSaleOrderIds.add(id)
      const snapshot = { ...so }
      try {
        const selection = applyConfirmLineSelection(so.lines ?? [], opts?.qtyByLineId)
        if (!confirmSelectionHasProduct(selection.lines)) {
          showToast('Keep at least one product to confirm', 'error')
          return
        }
        const orderLines = selection.lines.filter((line: any) => line.lineType !== 'section')
        const confirmTotals = calcSaleOrderTotals(selection.lines, {
          headerDiscount: Number(so.discountAmount) || 0,
        })
        if (selection.releasedSerialIds.length > 0) {
          setSerials(p => p.map(s =>
            selection.releasedSerialIds.includes(s.id) ? { ...s, status: 'available' } : s,
          ))
        }

        const creditStatus = storeCtxRef.current!.getCustomerCreditStatus(so.customerId, confirmTotals.totalAmount)
        const canCreditOverride = canOverrideCustomerCredit(user.role)
        if (!creditStatus.ok && !canCreditOverride) {
          showToast(creditStatus.message || 'Customer credit check failed — cannot confirm', 'error')
          return
        }
        if (!creditStatus.ok) showToast(`Overriding: ${creditStatus.message}`, 'info')
        if (so.validUntil && !isRepairLinkedSaleOrder(so)) {
          const until = new Date(so.validUntil)
          until.setHours(23, 59, 59, 999)
          if (!Number.isNaN(until.getTime()) && until.getTime() < Date.now()) {
            showToast('This quotation has expired. Extend Valid until before confirming.', 'error')
            return
          }
        }

        // Margin / floor / discount / backorder / credit approval automation.
        const backorderLines = computeConfirmBackorderLines(
          orderLines as any,
          prodRef.current as any,
          stockReservations as any,
          { excludeReferenceId: id },
        )
        const backorderQty = backorderLines.reduce((s, l) => s + l.qtyBackordered, 0)
        const listPriceByProductId: Record<string, number> = {}
        for (const line of orderLines) {
          if (!line.productId) continue
          const product = prodRef.current.find(p => p.id === line.productId)
          if (!product) continue
          const resolved = resolveListPrice({
            product,
            pricelist: (so as any).pricelist || (so as any).pricelistCode || 'RETAIL',
            qty: Number(line.qty) || 1,
          })
          listPriceByProductId[line.productId] = resolved.listPrice
        }
        const approvalTriggers = computeSaleOrderApprovalTriggers({
          lines: orderLines as any,
          products: prodRef.current as any,
          headerDiscountAmount: confirmTotals.discountAmount,
          orderTotal: confirmTotals.totalAmount,
          minMarginPercent: Number(systemSettings.salesMinMarginPercent ?? systemSettings.reconfigurationMinMarginPct ?? 10),
          pricingMarginPolicy: systemSettings.pricingMarginPolicy,
          listPriceByProductId,
          creditRequested: !creditStatus.ok ? confirmTotals.totalAmount : undefined,
          creditAvailable: !creditStatus.ok ? Number((creditStatus as any).creditAvailable) || 0 : undefined,
          backorderQty,
        })
        // Detection stays; special_pricing / credit_override do not gate confirm while on hold.
        const gatingTriggers = approvalTriggers.filter(t =>
          isSalesConfirmGatingApproval(t.type, systemSettings),
        )
        const pricingTrigger = approvalTriggers.find(t => t.type === 'special_pricing')
        const discountTrigger = approvalTriggers.find(t => t.type === 'discount')

        // Auto-create missing pending approval requests when the confirmer
        // cannot satisfy the required roles (Director/Finance may self-approve).
        const existingForDoc = approvalRequests.filter(r => r.documentId === id)
        const createdRequests: typeof approvalRequests = []
        const unmetTriggers = gatingTriggers.filter(trigger => {
          const roles = APPROVAL_RULES[trigger.type](trigger.details)
          if (roles.length === 0) return false
          // Price: Director OR Finance may self-satisfy. Other types still need every role.
          if (actorSatisfiesApprovalRoles(trigger.type, roles, user.role)) return false
          const already = existingForDoc.some(r =>
            r.type === trigger.type && (r.status === 'pending' || r.status === 'approved'),
          )
          return !already
        })
        for (const trigger of unmetTriggers) {
          const request = createApprovalRequest(
            trigger.type,
            'sales_order',
            id,
            so.ref,
            user.id,
            user.name,
            { ...trigger.details, reason: trigger.reason },
            users.map(u => ({ id: u.id, name: u.name, role: u.role })),
          )
          createdRequests.push(request)
        }
        if (createdRequests.length > 0) {
          setApprovalRequests(prev => [...createdRequests, ...prev])
          setSaleOrders(prev => prev.map(s => s.id !== id ? s : { ...s, approvalStatus: 'pending' }))
          for (const request of createdRequests) {
            notifyUsers({
              recipients: approvalRecipientIds(request, users),
              type: 'system',
              title: `Approval needed: ${request.type.replace(/_/g, ' ')}`,
              body: `${so.ref} — ${String(request.details?.reason ?? 'Special pricing / discount / credit approval required')}`,
              module: 'sales',
              path: approvalDocumentPath(request),
              icon: '⚠️',
              entityKey: `approval:${request.id}`,
              excludeUserId: user.id,
            })
          }
          showToast(
            `Approval required: ${createdRequests.map(r => r.type.replace(/_/g, ' ')).join(', ')}`,
            'error',
          )
          return
        }

        const leftoverSalesApprovals = approvalRequests.filter(r =>
          r.documentId === id &&
          isSalesConfirmGatingApproval(r.type, systemSettings) &&
          r.status === 'pending' &&
          gatingTriggers.some(t => t.type === r.type),
        )
        // The Director can override: confirming approves the pending requests
        // in their name, so the decision is still on record. Everyone else
        // waits for the approver.
        if (leftoverSalesApprovals.length > 0 && isDirector(user.role)) {
          const decided = leftoverSalesApprovals.map(r => processApproval(r, user.id, user.name, 'approved', 'Director override at confirm', user.role))
          const byId = new Map(decided.map(r => [r.id, r]))
          setApprovalRequests(prev => prev.map(r => byId.get(r.id) ?? r))
          addAuditLog('approval_override', so.ref, `Director approved ${decided.map(r => r.type.replace(/_/g, ' ')).join(', ')} at confirm`)
        } else if (leftoverSalesApprovals.length > 0) {
          showToast(
            `Resolve ${leftoverSalesApprovals.length} pending approval${leftoverSalesApprovals.length === 1 ? '' : 's'} before confirming`,
            'error',
          )
          return
        }

        const orderRef = await storeCtxRef.current!.allocateDocRef('SO')
        const confirmedAt = new Date().toISOString()
        // so was just re-fetched above (post-flush), so its lockVersion is
        // fresh for THIS request — sending it lets the server catch a genuine
        // lost-update (someone else changed this order between page load and
        // this click) instead of silently overwriting their change. A single
        // retry-after-refetch below absorbs the harmless case where our own
        // flush step raced the version forward without the caller knowing.
        const buildConfirmBody = (lockVersion: number | undefined) => ({
          ref: orderRef,
          orderNumber: orderRef,
          quotationRef: so.quotationRef ?? so.ref,
          status: 'sale' as const,
          confirmedAt,
          confirmedById: user.id,
          confirmedByName: user.name,
          approvedBy: user.id,
          // Do not force not_required — server enforces + role satisfaction.
          approvalStatus: gatingTriggers.length > 0 ? 'approved' as const : 'not_required' as const,
          locked: systemSettings.salesLockConfirmed || undefined,
          // Odoo At Confirmation vs Manual reservation
          reserveStock,
          lockVersion,
          belowPricelist: pricingTrigger?.details?.belowPricelist === true,
          belowCost: pricingTrigger?.details?.belowCost === true,
          belowMinimumMargin: pricingTrigger?.details?.belowMargin === true,
          specialPricing: Boolean(pricingTrigger),
          minMarginPercent: Number(systemSettings.salesMinMarginPercent ?? 10),
          worstMargin: pricingTrigger?.details?.worstMargin,
          pricingExceptionProducts: pricingTrigger?.details?.products,
          backorderQty: backorderQty > 0 ? backorderQty : undefined,
          discountPercent: discountTrigger?.details?.discountPercent,
          discountAmount: confirmTotals.discountAmount,
          creditRequested: !creditStatus.ok ? confirmTotals.totalAmount : undefined,
          creditAvailable: !creditStatus.ok ? Number((creditStatus as any).creditAvailable) || 0 : undefined,
          lines: selection.lines,
          total: confirmTotals.totalAmount,
          subtotal: confirmTotals.subtotal,
          taxTotal: confirmTotals.taxAmount,
        })

        let confirmRes = await fetch(`/api/sale-orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildConfirmBody(so.lockVersion)),
        })
        let confirmPayload = await confirmRes.json().catch(() => null)
        if (confirmRes.status === 409) {
          const fresh = await fetch(`/api/sale-orders/${id}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
          if (fresh && fresh.status !== 'sale' && fresh.status !== 'cancelled') {
            confirmRes = await fetch(`/api/sale-orders/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(buildConfirmBody(fresh.lockVersion)),
            })
            confirmPayload = await confirmRes.json().catch(() => null)
          }
        }
        if (!confirmRes.ok) {
          showToast(
            confirmRes.status === 409
              ? `${so.ref} was changed elsewhere — refresh and try confirming again`
              : confirmPayload?.error ?? `Could not confirm ${so.ref} — try again`,
            'error',
          )
          return
        }

        const serverRef = String(confirmPayload?.orderNumber ?? confirmPayload?.ref ?? orderRef)
        const serverLock = confirmPayload?.lockVersion

        const deliveryNoteLines = orderLines.filter(l => isDeliveryNoteLine(l))

        let del = reuseDelivery
        if (!del && deliveryNoteLines.length > 0) {
          const dnRef = await storeCtxRef.current!.allocateDocRef('DN')
          del = {
            id: uid(), ref: dnRef, saleOrderId: id, saleOrderRef: serverRef,
            customerId: so.customerId, customerName: so.customerName,
            status: 'waiting', date: now(),
            lines: deliveryNoteLines.map(l => {
              const prod = prodRef.current.find(p => p.id === l.productId)
              const selectedSource = (so.lines.find(line => line.id === l.id) as (SaleOrderLine & { sourceLocation?: LocationId }) | undefined)?.sourceLocation
              let sourceLocation
              if (isNonStockSaleLine(l, prod ?? null)) {
                sourceLocation = undefined
              } else if (selectedSource) {
                sourceLocation = selectedSource
              } else if (prod && isSerialTracking(inferTrackingMethod(prod))) {
                // Only Ready for Sale ships; a shortfall is reported, never filled
                // from With Issues (lib/inventory/sellable-stock.ts).
                sourceLocation = 'warehouse'
              } else {
                const qty = Math.max(0, Math.floor(Number(l.qty) || 0))
                sourceLocation = resolveBulkDeliverySourceLocation({
                  product: prod,
                  productId: l.productId,
                  qty,
                  preferred: 'warehouse',
                  serials: serialRef.current,
                  bulkStock,
                  reservations: stockReservations,
                  excludeReferenceId: id,
                }).location
              }
              return { productId: l.productId, productName: l.productName, qty: l.qty, qtyDone: 0, serialIds: [], sourceLocation }
            }),
            warrantyCreated: false,
          }

          const dnRes = await fetch('/api/deliveries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(del),
          })
          if (!dnRes.ok) {
            const dnErr = await dnRes.json().catch(() => null)
            setSaleOrders(p => p.map(s => {
              if (s.id !== id) return s
              return {
                ...s,
                ref: serverRef,
                orderNumber: serverRef,
                quotationRef: s.quotationRef ?? snapshot.ref,
                status: 'sale',
                confirmedAt,
                confirmedById: user.id,
                confirmedByName: user.name,
                approvedBy: user.id,
                approvalStatus: 'not_required',
                locked: systemSettings.salesLockConfirmed || undefined,
                lockVersion: serverLock ?? s.lockVersion,
              }
            }))
            showToast(dnErr?.error ?? `Confirmed as ${serverRef}, but delivery note failed to save — open Delivery to retry`, 'error')
            return
          }
          setDeliveries(p => [del, ...p.filter(d => d.id !== del.id)])
        } else if (del) {
          const patched = { ...del, saleOrderRef: serverRef }
          setDeliveries(p => p.map(d => d.id === del.id ? patched : d))
          sync(`/api/deliveries/${del.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ saleOrderRef: serverRef }),
          })
          del = patched
        }

        setSaleOrders(p => p.map(s => {
          if (s.id !== id) return s
          return {
            ...s,
            lines: selection.lines,
            subtotal: confirmTotals.subtotal,
            taxTotal: confirmTotals.taxAmount,
            taxAmount: confirmTotals.taxAmount,
            discountAmount: confirmTotals.discountAmount,
            total: confirmTotals.totalAmount,
            totalAmount: confirmTotals.totalAmount,
            ref: serverRef,
            orderNumber: serverRef,
            quotationRef: s.quotationRef ?? snapshot.ref,
            status: 'sale',
            confirmedAt,
            confirmedById: user.id,
            confirmedByName: user.name,
            approvedBy: user.id,
            approvalStatus: 'not_required',
            approvalRequiredReason: undefined,
            approvalRequestIds: [],
            discountApprovalId: undefined,
            creditOverrideApprovalId: undefined,
            backorderApprovalId: undefined,
            backorderLines: undefined,
            locked: systemSettings.salesLockConfirmed || undefined,
            stockReservationIds: s.stockReservationIds ?? [],
            deliveryId: del?.id,
            lockVersion: serverLock ?? s.lockVersion,
          }
        }))

        addAuditLog(
          'confirm_sale_order',
          serverRef,
          `Same document: quotation ${snapshot.ref} renamed to sales order ${serverRef} by ${user.name}${systemSettings.salesLockConfirmed ? ' · order locked' : ''}${selection.changed ? ` · ${selection.droppedIds.length} line(s) dropped at confirm` : ''}`,
        )
        showToast(
          del
            ? `Confirmed — this document is now ${serverRef} (was ${snapshot.ref}). Prepare delivery ${del.ref} to allocate stock.`
            : `Confirmed — this document is now ${serverRef} (was ${snapshot.ref}). Service lines do not reserve stock — create an invoice from ordered quantities.`,
        )
      } catch (error) {
        console.error('[confirmSO] failed:', error)
        showToast(
          error instanceof Error ? error.message : `Could not confirm ${snapshot.ref} — try again`,
          'error',
        )
      } finally {
        confirmingSaleOrderIds.delete(id)
      }
    },
    ensureWaitingDeliveryForSO: async (id) => {
      const so = soRef.current.find(s => s.id === id)
      if (!so || so.status === 'cancelled') return null
      if (!saleOrderLooksConfirmed(so) && so.status !== 'sale') return null
      const existingOpen = delRef.current.filter(d => d.saleOrderId === id && isOpenDeliveryStatus(d.status))
      if (existingOpen[0]) return existingOpen[0]
      const anyActive = delRef.current.find(d => d.saleOrderId === id && d.status !== 'cancelled')
      if (anyActive) return anyActive

      const orderLines = so.lines.filter((line: any) => isDeliveryNoteLine(line))
      if (!orderLines.length) {
        return null
      }
      const dnRef = await storeCtxRef.current!.allocateDocRef('DN')
      const del: Delivery = {
        id: uid(),
        ref: dnRef,
        saleOrderId: id,
        saleOrderRef: so.orderNumber ?? so.ref,
        customerId: so.customerId,
        customerName: so.customerName,
        status: 'waiting',
        date: now(),
        lines: orderLines.map(l => {
          const prod = prodRef.current.find(p => p.id === l.productId)
          let sourceLocation: LocationId | undefined
          if (isNonStockSaleLine(l, prod ?? null)) {
            sourceLocation = undefined
          } else if (prod && isSerialTracking(inferTrackingMethod(prod))) {
            // Only Ready for Sale ships; a shortfall is reported, never filled
            // from With Issues (lib/inventory/sellable-stock.ts).
            sourceLocation = 'warehouse'
          } else {
            const qty = Math.max(0, Math.floor(Number(l.qty) || 0))
            sourceLocation = resolveBulkDeliverySourceLocation({
              product: prod,
              productId: l.productId,
              qty,
              preferred: 'warehouse',
              serials: serialRef.current,
              bulkStock,
              reservations: stockReservations,
              excludeReferenceId: id,
            }).location
          }
          return { productId: l.productId, productName: l.productName, qty: l.qty, qtyDone: 0, serialIds: [], sourceLocation }
        }),
        warrantyCreated: false,
      }
      const dnRes = await fetch('/api/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(del),
      })
      if (!dnRes.ok) {
        const err = await dnRes.json().catch(() => null) as { error?: string } | null
        showToast(err?.error ?? 'Could not create delivery note', 'error')
        return null
      }
      setDeliveries(p => [del, ...p])
      setSaleOrders(p => p.map(s => s.id === id ? { ...s, deliveryId: del.id } : s))
      showToast(`Created delivery ${del.ref} for ${so.ref}`, 'info')
      return del
    },
    markQuotationSent: async (id, recipient, message) => {
      const user = currentUser()
      let so = soRef.current.find(s => s.id === id)
      if (!so || !user) return
      if (so.status !== 'quotation' && so.status !== 'quotation_sent') return
      if (isSaleOrderDraftEditing(id)) {
        const flushed = await storeCtxRef.current!.updateSaleOrder(id, {
          lines: so.lines,
          subtotal: so.subtotal,
          taxTotal: so.taxTotal,
          total: so.total,
        }, { persist: true })
        if (flushed === false) return
        so = soRef.current.find(s => s.id === id)
        if (!so) return
      }
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s
        const updated = {
          ...s,
          status: 'quotation_sent' as const,
          sentAt: new Date().toISOString(),
          sentById: user.id,
          sentByName: user.name,
          sentTo: recipient ?? s.sentTo,
          sentMessage: message ?? s.sentMessage,
        }
        sync(`/api/sale-orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saleOrderPersistBody(updated as unknown as Record<string, unknown>)),
        })
        return updated
      }))
      addAuditLog('quotation_sent', so.ref, `Quotation emailed to ${recipient ?? so.customerName} by ${user.name}${message ? ` — ${message}` : ''}`)
    },
    setSaleOrderLock: (id, locked) => {
      const user = currentUser()
      if (!user || !isDirector(user.role)) {
        showToast('Only a director can lock or unlock a confirmed order', 'error'); return
      }
      const so = soRef.current.find(s => s.id === id)
      if (!so) return
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s
        const updated = { ...s, locked }
        sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      addAuditLog(locked ? 'lock_sale_order' : 'unlock_sale_order', so.ref, `${locked ? 'Locked' : 'Unlocked'} by ${user.name}`)
      showToast(`${so.ref} ${locked ? 'locked' : 'unlocked'}`)
    },
    prepareDelivery: (deliveryId, qtysDone) => {
      const user = currentUser()
      if (!canApproveInventoryAction(user)) {
        showToast('Only Inventory or Admin can prepare deliveries', 'error')
        return false
      }
      const del = delRef.current.find(d => d.id === deliveryId)
      if (!del || !['draft', 'waiting', 'ready'].includes(normalizeDeliveryStatus(del.status))) {
        showToast('No pending delivery available to prepare', 'error')
        return false
      }
      const so = soRef.current.find(s => s.id === del.saleOrderId)
      if (!so) {
        showToast('Sales Order not found', 'error')
        return false
      }

      // Sum by product — Object.fromEntries would keep only the last duplicate line.
      const requested = qtysDone ?? sumQtyByProductId(del.lines)
      // SO line serialIds are often wiped (Prisma stores only one serialNumberId).
      // Prefer DN stamps + serial inventory already reserved for this order.
      const assignedSerials = serialRef.current.filter(s =>
        s.saleOrderId === so.id &&
        ['assigned', 'reserved', 'sold'].includes(String(s.status)),
      )
      const plan = planPrepareDeliveryLines({
        deliveryLines: del.lines,
        soLines: so.lines,
        requestedByProduct: requested,
        assignedSerials,
        isSerialTracked: (productId) => {
          const product = prodRef.current.find(p => p.id === productId)
          return !!product && isSerialTracking(inferTrackingMethod(product))
        },
      })
      if (!plan.ok) {
        showToast(plan.error, 'error')
        return false
      }

      const reservations: StockReservation[] = []
      const preparedLines: DeliveryLine[] = []
      let totalPrepared = 0
      let stockPrepared = 0
      const serialIdsToHeal = new Set<string>()
      const hasStockableDeliveryLine = del.lines.some(line =>
        !isNonStockSaleLine(line, prodRef.current.find(p => p.id === line.productId) ?? null),
      )

      for (let i = 0; i < del.lines.length; i++) {
        const deliveryLine = del.lines[i]
        const planned = plan.lines[i]
        const product = prodRef.current.find(p => p.id === deliveryLine.productId)
        if (isNonStockSaleLine(deliveryLine, product ?? null)) {
          const qty = Math.max(0, Number(deliveryLine.qty) || 0)
          preparedLines.push({ ...deliveryLine, qtyDone: qty, serialIds: [], sourceLocation: undefined })
          totalPrepared += qty
          continue
        }
        const serialTracked = !!product && isSerialTracking(inferTrackingMethod(product))
        const stockTracked = !!product && isStockTracked(inferTrackingMethod(product))
        const qty = planned?.qty ?? 0
        const serialIds = planned?.serialIds ?? []
        let sourceLocation = (deliveryLine.sourceLocation ?? 'warehouse') as LocationId

        if (serialTracked && qty > 0) {
          for (const id of serialIds) {
            const serial = serialRef.current.find(item => item.id === id)
            const check = assertSerialUsableForDeliveryPrepare(serial, {
              saleOrderId: so.id,
              productId: deliveryLine.productId,
              productName: deliveryLine.productName,
            })
            if (!check.ok) {
              showToast(check.error, 'error')
              return false
            }
            if (check.heal) serialIdsToHeal.add(id)
          }
        } else if (stockTracked && qty > 0) {
          const resolved = resolveBulkDeliverySourceLocation({
            product,
            productId: deliveryLine.productId,
            qty,
            preferred: deliveryLine.sourceLocation as LocationId | undefined,
            serials: serialRef.current,
            bulkStock,
            reservations: stockReservations,
            excludeDeliveryId: deliveryId,
            // Quote→SO often leaves a reservation on the order with no deliveryId;
            // that must not count as "elsewhere" or Prepare falsely fails.
            excludeReferenceId: so.id,
          })
          sourceLocation = resolved.location
          if (resolved.available < qty) {
            const breakdown = formatStockByLocation(resolved.byLocation, {
              warehouse: LOCATIONS.warehouse.name,
              shop: LOCATIONS.shop.name,
              repair_unit: LOCATIONS.repair_unit.name,
            })
            showToast(
              `Only ${resolved.available} ${deliveryLine.productName} free to ship (need ${qty}). Stock free by location — ${breakdown}`,
              'error',
            )
            return false
          }
        }

        preparedLines.push({ ...deliveryLine, qtyDone: qty, serialIds, sourceLocation: stockTracked ? sourceLocation : deliveryLine.sourceLocation })
        totalPrepared += qty
        stockPrepared += qty
        if (stockTracked && qty > 0) {
          reservations.push({
            id: uid(),
            productId: deliveryLine.productId,
            productName: deliveryLine.productName,
            qty,
            reservedFor: 'sales_order',
            referenceId: so.id,
            referenceRef: del.ref,
            referenceType: 'delivery',
            deliveryId,
            location: sourceLocation,
            reservedBy: user!.id,
            reservedDate: now(),
            expiresDate: addDays(now(), 7),
            status: 'reserved',
            fulfilledQty: 0,
            serialNumbers: serialIds.map(id => serialRef.current.find(item => item.id === id)?.serial ?? id),
            notes: `Reserved while preparing delivery ${del.ref}`,
          })
        }
      }

      if (serialIdsToHeal.size > 0) {
        // Claim SO/DN-stamped serials that inventory still shows as available/in_stock.
        const healIds = Array.from(serialIdsToHeal)
        setSerials(prev => prev.map(s => {
          if (!healIds.includes(s.id)) return s
          const updated = { ...s, status: 'assigned' as const, saleOrderId: so.id }
          sync(`/api/serials/${s.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
          })
          return updated
        }))
      }

      if (hasStockableDeliveryLine && stockPrepared <= 0) {
        showToast('Enter at least one delivery quantity before preparing', 'error')
        return false
      }
      if (totalPrepared <= 0) {
        showToast('Enter at least one delivery quantity before preparing', 'error')
        return false
      }

      setStockReservations(prev => [
        ...reservations,
        ...prev.map(reservation => {
          if (reservation.status !== 'reserved') return reservation
          const sameDelivery = reservation.deliveryId === deliveryId
          // Replace quote/SO-era orphans so prepare does not double-book stock.
          const orphanForThisOrder = reservation.referenceId === so.id && !reservation.deliveryId
          if (!sameDelivery && !orphanForThisOrder) return reservation
          return {
            ...reservation,
            status: 'cancelled' as const,
            notes: `${reservation.notes ?? ''} · replaced during re-preparation`.trim(),
          }
        }),
      ])
      const preparedAt = new Date().toISOString()
      setDeliveries(prev => prev.map(item => item.id === deliveryId ? {
        ...item,
        status: 'ready' as const,
        lines: preparedLines,
        preparedAt,
        preparedByUserId: user!.id,
        deliveryNoteGeneratedAt: undefined,
        deliveryNoteGeneratedByUserId: undefined,
      } : item))
      sync(`/api/deliveries/${deliveryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ready',
          lines: preparedLines,
          preparedAt,
          preparedByUserId: user!.id,
          deliveryNoteGeneratedAt: null,
          deliveryNoteGeneratedByUserId: null,
        }),
      })
      setSaleOrders(prev => prev.map(order => {
        if (order.id !== so.id) return order
        const updated = {
          ...order,
          stockReservationIds: Array.from(new Set([...(order.stockReservationIds ?? []), ...reservations.map(r => r.id)])),
        }
        sync(`/api/sale-orders/${order.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      addAuditLog('prepare_delivery', del.ref, `Reserved ${totalPrepared} item(s) for delivery ${del.ref}`)
      showToast(`${del.ref} prepared — stock reserved and ready to validate`)
      return true
    },
    reverseDelivery: async (deliveryId, reason) => {
      if (!canApproveInventoryAction(currentUser())) {
        showToast('Only Inventory, Admin or a Director can reverse a delivery', 'error'); return false
      }
      const del = delRef.current.find(d => d.id === deliveryId)
      if (!del) { showToast('This delivery is no longer loaded — refresh and try again', 'error'); return false }
      try {
        const res = await fetch(`/api/deliveries/${deliveryId}/reverse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason ?? '' }),
        })
        const payload = await res.json().catch(() => null) as { error?: string; reversedStock?: boolean } | null
        if (!res.ok) {
          showToast(payload?.error || `Could not reverse delivery (${res.status})`, 'error')
          return false
        }
        // The server rewrote stock, serials and reservations; the store stream
        // brings those back. Reflect the delivery itself immediately.
        setDeliveries(prev => prev.map(d => d.id === deliveryId ? { ...d, status: 'cancelled' as const } : d))
        // Same as the server: this delivery's reservations are released, so a
        // later save from this screen cannot put them back.
        setStockReservations(prev => prev.map(r =>
          r.deliveryId === deliveryId && (r.status === 'reserved' || r.status === 'fulfilled')
            ? { ...r, status: 'cancelled' as const }
            : r,
        ))
        addAuditLog('reverse_delivery', del.ref, `Delivery reversed${reason ? ` — ${reason}` : ''}`)
        showToast(payload?.reversedStock
          ? `${del.ref} reversed — stock and serials returned`
          : `${del.ref} cancelled — reserved stock released`)
        return true
      } catch (err) {
        showToast(`Could not reverse delivery — ${err instanceof Error ? err.message : 'unexpected error'}`, 'error')
        return false
      }
    },
    validateDelivery: async (deliveryId, qtysDone, opts) => {
      if (!canApproveInventoryAction(currentUser())) {
        showToast('Only Inventory or Admin can validate deliveries', 'error'); return;
      }
      const cancelRemaining = opts?.cancelRemaining === true
      const del = delRef.current.find(d => d.id === deliveryId)
      if (!del) {
        showToast('This delivery is no longer loaded — refresh the page and try again', 'error'); return
      }
      const so = soRef.current.find(s => s.id === del.saleOrderId)
      if (!so) {
        // Previously a non-null assertion: a delivery whose sale order had not
        // loaded threw a TypeError that surfaced as "Network error".
        showToast('The sale order for this delivery could not be loaded — refresh and try again', 'error'); return
      }
      if (del.status !== 'ready' || !del.preparedAt) {
        showToast('Prepare and reserve this delivery before validation', 'error')
        return
      }

      // Odoo-style partial validation: quantities actually done are shipped
      // now; the remainder moves to a backorder delivery. Stock is deducted
      // ONLY for the quantities validated as Done.
      // Prefer line-local qtyDone/serials (stamped at prepare). Optional
      // qtysDone is a per-product pool — never collapse duplicate product
      // rows with Object.fromEntries (SO/2026/0029 ThinkPad 1+2+1 bug).
      const requestedPool: Record<string, number> = {}
      if (qtysDone) {
        for (const [productId, raw] of Object.entries(qtysDone)) {
          requestedPool[productId] = Math.max(0, Number(raw) || 0)
        }
      } else {
        for (const line of del.lines) {
          const local = Math.max(Number(line.qtyDone) || 0, (line.serialIds ?? []).length)
          if (local <= 0) continue
          requestedPool[line.productId] = (requestedPool[line.productId] ?? 0) + local
        }
      }
      const { doneLines, backorderLines, lineDone } = splitDeliveryForBackorder(del.lines, requestedPool)
      if (doneLines.length === 0) {
        showToast('Enter the quantities delivered before validating', 'error'); return
      }
      // Serial-tracked lines cannot be split implicitly — check EACH delivery
      // line against its own done qty (never .find(productId), which breaks
      // when duplicate product rows have different quantities).
      for (let i = 0; i < del.lines.length; i++) {
        const l = del.lines[i]
        const prod = prodRef.current.find(x => x.id === l.productId)
        const done = lineDone[i] ?? 0
        if (prod && isSerialTracking(inferTrackingMethod(prod)) && done > 0 && done < l.qty) {
          showToast(`${l.productName} is serial-tracked — deliver all ${l.qty} units or remove serials to split`, 'error')
          return
        }
      }

      // Stock deduction is server-authoritative via /api/deliveries/:id/validate
      // (applyDeliveryStockMutation + COGS). Client only updates warranties,
      // reservations, backorders, and delivery/SO status — never re-decrements qty.
      const completedLines = del.lines.map((l, i) => ({
        ...l,
        qtyDone: lineDone[i] ?? 0,
      }))

      try {
        const res = await fetch(`/api/deliveries/${deliveryId}/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'done',
            lines: completedLines,
            warrantyCreated: false,
            autoInvoice: false,
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null
          showToast(payload?.error || 'Delivery validation failed', 'error')
          return
        }
      } catch {
        showToast('Could not validate delivery on server', 'error')
        return
      }

      const newWarranties: Warranty[] = []
      doneLines.forEach(l => {
        const prod = prodRef.current.find(x => x.id === l.productId)
        l.serialIds.forEach(sid => {
          setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'sold', location: 'customer', soldDate: now(), saleOrderId: del.saleOrderId } : s))
          if (prod && resolveWarrantyMonths(prod.warrantyMonths, systemSettings.invDefaultWarrantyMonths) > 0) {
            const serial = serialRef.current.find(s => s.id === sid)
            const months = resolveWarrantyMonths(prod.warrantyMonths, systemSettings.invDefaultWarrantyMonths)
            const war: Warranty = {
              id: uid(), ref: '',
              customerId: del.customerId, customerName: del.customerName,
              productId: l.productId, productName: l.productName,
              serialId: sid, serialNumber: serial?.serial ?? '',
              deliveryId: del.id, saleOrderRef: so.ref,
              startDate: now(), endDate: addWarrantyMonths(now(), months),
              status: 'active', months,
            }
            newWarranties.push(war)
          }
        })
      })
      // Issued on the server from what was sold (lib/warranty/e-warranty.ts), with their e-warranty links.
      if (newWarranties.length > 0) requestWarrantySync()
      setStockReservations(prev => prev.map(r => {
        if ((r.deliveryId ? r.deliveryId !== deliveryId : r.referenceId !== so.id) || r.status !== 'reserved') return r
        const deliveredLine = doneLines.find(line => line.productId === r.productId)
        if (!deliveredLine) return r
        const fulfilledQty = Math.min(r.qty, r.fulfilledQty + deliveredLine.qty)
        return {
          ...r,
          fulfilledQty,
          status: fulfilledQty >= r.qty ? 'fulfilled' as const : 'reserved' as const,
          fulfilledDate: fulfilledQty >= r.qty ? now() : r.fulfilledDate,
        }
      }))

      // Backorder for the undelivered remainder (linked to the same SO).
      let backorder: Delivery | null = null
      const shippedByProduct: Record<string, number> = {}
      doneLines.forEach(l => {
        shippedByProduct[l.productId] = (shippedByProduct[l.productId] ?? 0) + l.qty
      })
      const remainingAfterShip = remainingUndeliveredByProduct(
        allocateDeliveredQtyToOrderLines(so.lines ?? [], shippedByProduct, 'add'),
      )
      const otherOpenDemand = openDeliveryDemandByProduct(
        delRef.current.filter(d => d.id !== deliveryId),
        del.saleOrderId,
      )
      const clampedBackorder = backorderLines
        .map(line => {
          const soRemain = remainingAfterShip[line.productId] ?? 0
          const alreadyOpen = otherOpenDemand[line.productId] ?? 0
          const need = Math.max(0, Math.min(line.qty, soRemain - alreadyOpen))
          return need > 0 ? { ...line, qty: need, qtyDone: 0, serialIds: [] as string[] } : null
        })
        .filter(Boolean) as typeof backorderLines
      if (clampedBackorder.length > 0 && !cancelRemaining) {
        const backorderShort = clampedBackorder.some(l => {
          const prod = prodRef.current.find(p => p.id === l.productId)
          if (isNonStockSaleLine(l, prod ?? null)) return false
          return (Number(prod.stockQty) || 0) < l.qty
        })
        backorder = {
          id: uid(), ref: await storeCtxRef.current!.allocateDocRef('DN'), saleOrderId: del.saleOrderId, saleOrderRef: del.saleOrderRef,
          customerId: del.customerId, customerName: del.customerName,
          status: initialDeliveryState(backorderShort), date: now(),
          lines: clampedBackorder,
          warrantyCreated: false,
          backorderOfId: del.id,
          backorderOfRef: del.ref,
        }
        sync('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backorder) })
      }
      setDeliveries(p => {
        const next = p.map(d => d.id === deliveryId ? {
          ...d,
          status: 'done' as const,
          warrantyCreated: newWarranties.length > 0,
          lines: completedLines,
        } : d)
        return backorder ? [backorder, ...next] : next
      })

      setSaleOrders(p => p.map(s => {
        if (s.id !== del.saleOrderId) return s;
        const doneByProduct: Record<string, number> = {}
        doneLines.forEach(l => { doneByProduct[l.productId] = (doneByProduct[l.productId] ?? 0) + l.qty })
        const allocated = allocateDeliveredQtyToOrderLines(s.lines, doneByProduct, 'add')
        const trimmed = cancelRemaining
          ? trimSaleOrderLinesToDelivered(allocated)
          : { lines: allocated, changed: false, releasedSerialIds: [] }
        if (trimmed.releasedSerialIds.length > 0) {
          setSerials(prev => prev.map(serial =>
            trimmed.releasedSerialIds.includes(serial.id) ? { ...serial, status: 'available' } : serial,
          ))
        }
        const money = calcSaleOrderTotals(trimmed.lines, { headerDiscount: Number(s.discountAmount) || 0 })
        const updated = {
          ...s,
          lines: trimmed.lines,
          subtotal: money.subtotal,
          taxTotal: money.taxAmount,
          taxAmount: money.taxAmount,
          discountAmount: money.discountAmount,
          total: money.totalAmount,
          totalAmount: money.totalAmount,
        }
        sync(`/api/sale-orders/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fulfillmentSaleOrderPatch(
            updated as unknown as Record<string, unknown>,
            { cancelRemaining, trimmedChanged: trimmed.changed },
          )),
        })
        return updated
      }))
      addAuditLog(
        'validate_delivery',
        del.ref,
        `Delivery validated${backorder ? ` · backorder ${backorder.ref} created` : cancelRemaining ? ' · remaining lines dropped' : ''}`,
      )
      showToast(
        `Delivery done · stock updated${
          backorder
            ? ` · backorder ${backorder.ref} created`
            : cancelRemaining
              ? ' · remaining lines dropped'
              : ''
        }${newWarranties.length > 0 ? ` · ${newWarranties.length} warranty(ies) created` : ''}`,
      )
    },
    markDeliveryNoteGenerated: async (deliveryId) => {
      const delivery = delRef.current.find(item => item.id === deliveryId)
      const user = currentUser()
      if (!delivery || delivery.status !== 'done') {
        showToast('Only a validated delivery can generate the final Delivery Note', 'error')
        return false
      }
      // Heal qtyDone from serials when the Done delivery was saved with Delivered=0
      // (legacy bug). Never stamp a DN that unlocks invoicing with zero delivered.
      const healedLines = delivery.lines.map(line => {
        const qtyDone = Math.max(
          Number(line.qtyDone) || 0,
          Array.isArray(line.serialIds) ? line.serialIds.length : 0,
        )
        return { ...line, qtyDone: Math.min(line.qty, qtyDone) }
      })
      const deliveredTotal = healedLines.reduce((sum, line) => sum + (Number(line.qtyDone) || 0), 0)
      if (deliveredTotal <= 0) {
        showToast('Cannot generate Delivery Note — delivered quantity is 0. Prepare/validate with quantities (or serials) first.', 'error')
        return false
      }
      const so = soRef.current.find(s => s.id === delivery.saleOrderId)
      if (so) {
        // Persist SO qtyDelivered so Create Invoice (delivery policy) can proceed.
        // FIFO allocation — duplicate product rows must not each receive the full total.
        const doneByProduct: Record<string, number> = {}
        healedLines.forEach(line => {
          if ((line.qtyDone || 0) > 0) {
            doneByProduct[line.productId] = (doneByProduct[line.productId] ?? 0) + (line.qtyDone || 0)
          }
        })
        const healedSoLines = allocateDeliveredQtyToOrderLines(so.lines, doneByProduct, 'max')
        const prevById = new Map(so.lines.map(l => [l.id, Number(l.qtyDelivered) || 0]))
        const lineUpdates = healedSoLines
          .map(line => {
            if (!line.id) return null
            const next = Number(line.qtyDelivered) || 0
            const prev = prevById.get(line.id) ?? 0
            if (next <= prev) return null
            return { id: line.id, qtyDelivered: next }
          })
          .filter(Boolean) as Array<{ id: string; qtyDelivered: number }>
        if (lineUpdates.length > 0) {
          try {
            await fetch(`/api/sale-orders/${so.id}/deliver-lines`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lines: lineUpdates }),
            })
          } catch { /* local heal below still applies */ }
          setSaleOrders(prev => prev.map(order => {
            if (order.id !== so.id) return order
            return {
              ...order,
              lines: order.lines.map(line => {
                const upd = lineUpdates.find(u => u.id === line.id)
                return upd ? { ...line, qtyDelivered: upd.qtyDelivered } : line
              }),
            }
          }))
        }
      }
      const patch = {
        deliveryNoteGeneratedAt: new Date().toISOString(),
        deliveryNoteGeneratedByUserId: user?.id,
        lines: healedLines,
      }
      try {
        const response = await fetch(`/api/deliveries/${deliveryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!response.ok) {
          showToast('Delivery Note opened, but its generated status could not be saved', 'error')
          return false
        }
        setDeliveries(prev => prev.map(item => item.id === deliveryId ? { ...item, ...patch } : item))
        addAuditLog('generate_delivery_note', delivery.ref, `Final Delivery Note generated by ${user?.name ?? 'user'} (${deliveredTotal} unit(s))`)
        return true
      } catch {
        showToast('Delivery Note opened, but the server could not be reached', 'error')
        return false
      }
    },
    updateDelivery: (deliveryId, p) => {
      setDeliveries(prev => prev.map(d => d.id === deliveryId ? { ...d, ...p } : d))
      sync(`/api/deliveries/${deliveryId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
    },
    createInvoiceFromSO: async (orderId, lineOverridesOrOpts) => {
      if (!canCreateCustomerInvoiceFromSOAction(currentUser())) {
        showToast('Only Finance or Admin Officer can create invoices from a sale order', 'error'); return {} as Invoice;
      }
      const so = soRef.current.find(s => s.id === orderId)
      if (!so) { showToast('Sale order not found', 'error'); return {} as Invoice }
      if (so.status !== 'sale') {
        showToast('Only a confirmed Sales Order can be invoiced', 'error'); return {} as Invoice;
      }
      const invoiceOpts = Array.isArray(lineOverridesOrOpts)
        ? { mode: 'regular' as const, lines: lineOverridesOrOpts }
        : {
            mode: normalizeCreateInvoiceMode(lineOverridesOrOpts?.mode),
            percent: lineOverridesOrOpts?.percent,
            amount: lineOverridesOrOpts?.amount,
            lines: lineOverridesOrOpts?.lines,
          }
      const lineOverrides = invoiceOpts.lines
      // Down payments are commercial deposits — no delivery gate.
      // Regular/final still defer to the server for ordered vs delivered policy.
      if (!isDownPaymentMode(invoiceOpts.mode) && invoiceOpts.mode !== 'final') {
        // Soft client hint only for classic regular invoices when nothing
        // looks invoiceable yet; server is authoritative for mixed policies.
        if (!hasValidatedDeliveryForInvoice(delRef.current, orderId)) {
          const anyOrderPolicy = (so.lines ?? []).some((l: any) => {
            if (l.lineType === 'section') return false
            const product = prodRef.current.find(p => p.id === l.productId)
            return resolveInvoicePolicy({
              linePolicy: l.invoicePolicy,
              productPolicy: product?.invoicePolicy,
              productUnit: product?.unit,
              productKind: product?.productKind,
              productCategory: product?.category,
              trackingMethod: product?.trackingMethod,
              trackStock: product?.trackStock,
              productId: l.productId,
              lineType: l.lineType,
              lineUnit: l.unit,
            }) === 'order'
          })
          if (!anyOrderPolicy) {
            showToast('Validate the delivery before creating an invoice', 'error')
            return {} as Invoice
          }
        }
      }

      // Prefer server-atomic path (qtyInvoiced bump + invoice create in one transaction).
      try {
        const payloadBody: Record<string, unknown> = { mode: invoiceOpts.mode }
        if (invoiceOpts.percent != null) payloadBody.percent = invoiceOpts.percent
        if (invoiceOpts.amount != null) payloadBody.amount = invoiceOpts.amount
        if (lineOverrides?.length) payloadBody.lines = lineOverrides
        const response = await fetch(`/api/sale-orders/${orderId}/create-invoice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadBody),
        })
        const payload = await response.json().catch(() => null) as {
          ok?: boolean
          error?: string
          invoice?: Invoice & { taxTotal?: number }
        } | null
        if (response.ok && payload?.ok && payload.invoice?.id) {
          const remote = payload.invoice
          let remoteLines = Array.isArray(remote.lines) ? remote.lines : []
          let subtotal = Number(remote.subtotal) || 0
          let taxTotal = Number(remote.taxTotal) || 0
          let total = Number(remote.total) || 0

          // Defensive hydrate: never fall through to client re-invoice (qtyInvoiced already locked).
          if (remoteLines.length === 0) {
            try {
              const detailRes = await fetch(`/api/invoices/${remote.id}`)
              if (detailRes.ok) {
                const detail = await detailRes.json() as {
                  items?: Array<{
                    id?: string; description?: string | null; qty?: number; unitPrice?: number
                    taxRate?: number; lineSubtotal?: number; productId?: string | null
                  }>
                  subtotal?: number; taxAmount?: number; totalAmount?: number
                }
                remoteLines = (detail.items ?? []).map((item, idx) => ({
                  id: item.id ?? `line-${idx}`,
                  description: item.description ?? '',
                  qty: Number(item.qty) || 0,
                  unitPrice: Number(item.unitPrice) || 0,
                  taxRate: Number(item.taxRate) || 0,
                  subtotal: Number(item.lineSubtotal) || Math.round((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)),
                  ...(item.productId ? { productId: item.productId } : {}),
                }))
                if (Number(detail.subtotal)) subtotal = Number(detail.subtotal)
                if (detail.taxAmount != null) taxTotal = Number(detail.taxAmount) || 0
                if (Number(detail.totalAmount)) total = Number(detail.totalAmount)
              }
            } catch { /* InvoiceDetail will hydrate if needed */ }
          }

          if (remoteLines.length === 0) {
            showToast('Invoice was created but line items could not be loaded — open the invoice to refresh', 'error')
          }

          const local: Invoice = {
            id: remote.id,
            ref: remote.ref,
            type: 'customer_invoice',
            status: 'draft',
            partnerId: remote.partnerId || so.customerId,
            partnerName: remote.partnerName || so.customerName,
            date: remote.date || now(),
            dueDate: remote.dueDate || addDays(now(), parseInt(so.paymentTerms ?? '', 10) || 0),
            lines: remoteLines,
            subtotal: subtotal || remoteLines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0),
            taxTotal,
            total: total || subtotal + taxTotal,
            amountPaid: Number(remote.amountPaid) || 0,
            saleOrderId: remote.saleOrderId || so.id,
            ...(remote.repairId ? { repairId: remote.repairId } : {}),
            notes: remote.notes || `Created from ${so.ref}`,
            invoiceAddress: so.invoiceAddress,
            deliveryAddress: so.deliveryAddress,
            ...(so.customerRef ? { customerPoNumber: so.customerRef } : {}),
            ...documentMoneySnapshot({
              currencyCode: (remote as any).currencyCode || so.currencyCode || companySettings.currency,
              exchangeRateToBase: (remote as any).exchangeRateToBase ?? so.exchangeRateToBase,
            }),
          }
          // Only push into local store when we have lines — empty shells overwrite the mirror.
          if (remoteLines.length > 0) {
            setInvoices(p => [local, ...p.filter(i => i.id !== local.id)])
          }
          if (remote.repairId) {
            setRepairs(p => p.map(r => {
              if (r.id !== remote.repairId || r.invoiceId) return r
              return {
                ...r,
                invoiceId: local.id,
                invoiceDate: local.date,
              }
            }))
          }
          // Pull the server-authoritative SO back immediately so qtyInvoiced
          // and the Sales Order invoice status cannot stay on "To Invoice"
          // until SSE/localStorage catches up.
          try {
            const soResponse = await fetch(`/api/sale-orders/${orderId}`, { cache: 'no-store' })
            if (soResponse.ok) {
              const refreshedOrder = await soResponse.json()
              applySaleOrderPersistResult(setSaleOrders, soRef, orderId, refreshedOrder, { syncLines: true })
            }
          } catch { /* SSE remains the fallback */ }

          addAuditLog('create_invoice_from_so', local.ref, `Draft invoice created from ${so.ref} (server atomic)`)
          showToast(`Draft invoice ${local.ref} created — post it to finalize`)
          return local
        }
        showToast(payload?.error || 'Could not create the invoice — try again', 'error')
        return {} as Invoice
      } catch {
        // Do NOT fall back to a client-side invoice-creation path here. The
        // server's create-invoice endpoint atomically bumps qtyInvoiced and
        // creates the invoice inside one transaction with a guarded update —
        // if this request actually reached the server and committed before
        // the network dropped, a client-side fallback would create a SECOND
        // invoice for the same delivered quantity. Retrying this same
        // endpoint is safe (the guard makes it idempotent): if the first
        // attempt already invoiced everything, the retry finds nothing left
        // to invoice instead of duplicating it.
        showToast(
          lineOverrides
            ? 'Could not reach the server to create the partial invoice — check your connection and retry'
            : 'Could not reach the server to create the invoice — check your connection and retry',
          'error',
        )
        return {} as Invoice
      }
    },
    deleteSaleOrder: (id) => {
      const actor = currentUser()
      const so = soRef.current.find(s => s.id === id)
      if (!so) return
      const isQuotation = ['draft', 'sent', 'quotation', 'quotation_sent'].includes(so.status)
      if (!isQuotation && !isDirector(actor?.role)) {
        showToast('Only a director can delete confirmed sale orders — cancel or reset instead', 'error')
        return
      }
      if (!isQuotation) {
        const blockers = saleOrderCancelBlockers({
          status: so.status,
          deliveries: delRef.current.filter(d => d.saleOrderId === id),
          invoices: invRef.current.filter(i => i.saleOrderId === id),
        })
        if (blockers.length > 0) {
          showToast(`Cannot delete ${so.ref}: ${blockers.join('; ')}`, 'error')
          return
        }
      }
      setSaleOrders(p => p.filter(s => s.id !== id))
      sync(`/api/sale-orders/${id}`, { method: 'DELETE' })
      addAuditLog('delete_sale_order', so.ref, `Deleted by ${actor?.name || 'user'}`)
      showToast('Order deleted')
    },
    resetSOToDraft: async (id) => {
      // Odoo "Set to Quotation": back to the quotation stage. Pending
      // deliveries are cancelled and reservations released so the quotation
      // carries no fulfilment side effects.
      const actor = currentUser()
      const so = soRef.current.find(s => s.id === id)
      if (!so) return false
      // Sent → draft: sales staff may unlock for edits. Confirmed SO → quotation
      // still requires Finance / Admin Officer / Director.
      const salesCanResetSent = userCan(actor, 'sales.quotes.create')
      const financeCanResetConfirmed = canReverseConfirmedSale(actor?.role)
      if (so.status === 'quotation_sent' || so.status === 'cancelled') {
        if (!actor || !salesCanResetSent) {
          showToast('You do not have permission to reset this quotation to draft', 'error')
          return false
        }
      } else if (!actor || !financeCanResetConfirmed) {
        showToast('Only Finance, Admin Officer, or Director can reset a sale order to quotation', 'error')
        return false
      }
      const blockers = saleOrderCancelBlockers({
        status: so.status === 'sale' ? 'sale' : so.status,
        deliveries: delRef.current.filter(d => d.saleOrderId === id),
        invoices: invRef.current.filter(i => i.saleOrderId === id),
      })
      // Always block reset when fulfilment/AR exists (same as cancel for confirmed).
      if (so.status === 'sale' && blockers.length > 0) {
        showToast(`Cannot reset ${so.ref}: ${blockers.join('; ')}`, 'error')
        return false
      }
      const pendingDeliveries = delRef.current.filter(d => d.saleOrderId === id && ['draft', 'waiting', 'ready'].includes(d.status))
      // Persist the status change first so a failed PATCH cannot leave the UI
      // editable while the server still has quotation_sent / sale.
      const updated = {
        ...so,
        status: 'quotation' as const,
        savedAt: undefined,
        deliveryId: undefined,
        locked: undefined,
        confirmedAt: undefined,
        confirmedById: undefined,
        confirmedByName: undefined,
        // Clear send/accept stamps so "Send" is treated as initial again after reset.
        sentAt: undefined,
        sentTo: undefined,
        sentById: undefined,
        sentByName: undefined,
        sentMessage: undefined,
        acceptedAt: undefined,
        acceptedById: undefined,
        acceptedByName: undefined,
        lines: so.lines.map((l: any) => ({ ...l, serialIds: [] })),
      }
      const result = await patchSaleOrderPersist(id, {
        ...updated,
        locked: false,
        confirmedAt: null,
        sentAt: null,
        sentTo: null,
        sentById: null,
        sentMessage: null,
        acceptedAt: null,
        acceptedById: null,
      })
      if (!result.ok) {
        showToast(result.error || 'Could not reset to quotation — try again', 'error')
        return false
      }
      pendingDeliveries.forEach(d => {
        setDeliveries(prev => prev.map(x => x.id === d.id ? { ...x, status: 'cancelled' as const } : x))
        sync(`/api/deliveries/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) })
      })
      setStockReservations(prev => prev.map(r =>
        r.referenceId === id && r.status === 'reserved' ? { ...r, status: 'cancelled' as const } : r
      ))
      // Release SO-picked serials back to available (same as cancel) so Available stock recovers:
      // those on the order lines, on the deliveries just cancelled, and any linked to the order.
      const allSerialIds = new Set<string>([
        ...so.lines.flatMap((l: any) => l.serialIds ?? []),
        ...pendingDeliveries.flatMap(d => d.lines.flatMap(l => l.serialIds ?? [])),
      ])
      setSerials(p => p.map(s =>
        (allSerialIds.has(s.id) || s.saleOrderId === id) && !['sold', 'delivered'].includes(String(s.status))
          ? { ...s, status: 'available', saleOrderId: undefined }
          : s))
      const [normalized] = normalizeSaleOrdersForClient([
        { ...updated, ...(result.data && typeof result.data === 'object' ? result.data : {}), status: 'quotation' },
      ]) as SaleOrder[]
      const nextRow = normalized ?? updated
      soRef.current = soRef.current.map(s => s.id === id ? nextRow : s)
      setSaleOrders(p => p.map(s => s.id === id ? nextRow : s))
      addAuditLog('reset_to_quotation', so.ref, `Order set back to Quotation by ${actor.name}`)
      showToast(so.status === 'quotation_sent' ? 'Quotation reset to draft — you can edit and save' : 'Order set back to Quotation')
      return true
    },
    cancelSO: (id) => {
      const actor = currentUser()
      const so = soRef.current.find(s => s.id === id)
      if (!so) return
      // Cancelling a confirmed Sales Order reverses a commercial document,
      // same as "Set to Quotation" — requires Finance / Admin Officer /
      // Director (matches the server-side gate in saleTransitionError).
      if (so.status === 'sale' && !canReverseConfirmedSale(actor?.role)) {
        showToast('Only Finance, Admin Officer, or Director can cancel a confirmed Sales Order', 'error')
        return
      }
      // Dependent records are never silently cancelled: completed deliveries,
      // posted invoices and registered payments must be reversed first.
      const blockers = saleOrderCancelBlockers({
        status: so.status,
        deliveries: delRef.current.filter(d => d.saleOrderId === id),
        invoices: invRef.current.filter(i => i.saleOrderId === id),
      })
      if (blockers.length > 0) {
        showToast(`Cannot cancel ${so.ref}: ${blockers.join('; ')}`, 'error')
        return
      }
      // Release serials, pending deliveries and reservations. A serial claimed when the delivery was
      // prepared sits on the delivery lines and is linked to the order (saleOrderId), not always on
      // the order lines, so all three sources are released; sold units are never touched.
      const allSerialIds = new Set<string>([
        ...so.lines.flatMap((l: any) => l.serialIds ?? []),
        ...delRef.current
          .filter(d => d.saleOrderId === id && ['draft', 'waiting', 'ready'].includes(d.status))
          .flatMap(d => d.lines.flatMap(l => l.serialIds ?? [])),
      ])
      setSerials(p => p.map(s =>
        (allSerialIds.has(s.id) || s.saleOrderId === id) && !['sold', 'delivered'].includes(String(s.status))
          ? { ...s, status: 'available', saleOrderId: undefined }
          : s))
      delRef.current.filter(d => d.saleOrderId === id && ['draft', 'waiting', 'ready'].includes(d.status)).forEach(d => {
        setDeliveries(prev => prev.map(x => x.id === d.id ? { ...x, status: 'cancelled' as const } : x))
        sync(`/api/deliveries/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) })
      })
      setStockReservations(prev => prev.map(r =>
        r.referenceId === id && r.status === 'reserved' ? { ...r, status: 'cancelled' as const } : r
      ))
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s;
        const updated = { ...s, status: 'cancelled' as const }
        sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      addAuditLog('cancel_sale_order', so.ref, 'Order cancelled')
      showToast('Order cancelled')
    },
    createNewSOVersion: async (orderId) => {
      const so = soRef.current.find(s => s.id === orderId)
      if (!so) { showToast('Quotation not found', 'error'); return null }
      if (!isQuotationStage(so.status)) {
        showToast('Only quotations can be revised — confirmed Sales Orders require an amendment', 'error')
        return null
      }
      try {
        const res = await fetch(`/api/sale-orders/${orderId}/new-version`, { method: 'POST' })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.id) {
          showToast(payload?.error || 'Could not revise this quotation', 'error')
          return null
        }
        const created = payload as SaleOrder
        setSaleOrders(p => [created, ...p])
        addAuditLog('sale_order_new_version', created.ref, `Revision ${created.versionNumber} created from ${so.ref}`)
        showToast(`Revision ${created.versionNumber ?? 1} created — edit and resend ${created.ref}`)
        return created
      } catch {
        showToast('Could not reach the server to revise this quotation', 'error')
        return null
      }
    },

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

    // ── POS ───────────────────────────────────────────────────────────────────
    openPOSSession: (openingCash) => {
      if (hasActivePosSession({ posSessionOpen, posSessionId, posSessions })) {
        showToast('A POS session is already open', 'error')
        return
      }
      const user = currentUser()
      const session: POSSession = {
        id: uid(),
        ref: allocateDocNumberSync('POSSESS'), // the server's number follows (numberPosSessions)
        status: 'open',
        openedAt: new Date().toISOString(),
        openingCash: Math.max(0, Number(openingCash) || 0),
        totalSales: 0,
        totalCash: 0,
        totalMpesa: 0,
        totalCard: 0,
        orderCount: 0,
        openedBy: user?.name || user?.username,
      }
      setPosSessions(p => [session, ...p.map(s => (
        s.status === 'open' ? { ...s, status: 'closed' as const, closedAt: new Date().toISOString() } : s
      ))])
      numberPosSessions([session.id])
      setPosSessionId(session.id)
      setPosSessionOpen(true)
      setPosSessionOpeningCash(session.openingCash)
      addAuditLog('open_pos_session', session.ref, `Opening cash ${fmtKes(session.openingCash)}`)
      showToast(`POS session ${session.ref} opened`)
    },
    closePOSSession: (closingCash) => {
      const user = currentUser()
      const sessionId = resolveOpenPosSessionId({ posSessionOpen, posSessionId, posSessions })
      // Orphaned open flag (no id / no open history): clear the till so cashiers can reopen.
      if (!sessionId) {
        if (posSessionOpen || posSessionId) {
          setPosSessionOpen(false)
          setPosSessionId(null)
          setPosSessionOpeningCash(0)
          showToast('Cleared stuck POS session — open a new session to continue', 'info')
          return null
        }
        showToast('No open POS session', 'error')
        return null
      }
      if (!posSessionId || posSessionId !== sessionId) {
        setPosSessionId(sessionId)
        setPosSessionOpen(true)
      }
      const openSession = posSessions.find(s => s.id === sessionId)
      const orders = posOrdersForSession(posOrders, sessionId, openSession?.openedAt)
      const tenderAmount = (order: POSOrder) => Math.max(0, order.total - (order.customerCreditAmount || 0))
      const totalCash = orders.filter(o => o.payment === 'cash').reduce((a, o) => a + tenderAmount(o), 0)
      const totalMpesa = orders.filter(o => o.payment === 'mpesa').reduce((a, o) => a + tenderAmount(o), 0)
      const totalBank = orders.filter(o => isPosBankPayment(o.payment)).reduce((a, o) => a + tenderAmount(o), 0)
      const totalCard = totalBank // legacy field: bank + historical card
      const totalSales = orders.reduce((a, o) => a + o.total, 0)
      const counted = Math.max(0, Number(closingCash) || 0)
      const expectedCash = posSessionOpeningCash + totalCash
      const cashDifference = counted - expectedCash

      let journalId: string | undefined
      // Session settlement journal: tender totals (memo lines via balanced cash control).
      // Per-sale journals already recognized revenue; here we post cash over/short + a
      // zero-impact control entry summarizing tender mix for the GL/audit trail.
      const controlLines: JournalEntryLine[] = []
      if (Math.abs(cashDifference) >= 1) {
        if (cashDifference > 0) {
          controlLines.push(accountLine('2211 - Petty Cash', 'Cash over on session close', cashDifference, 0))
          controlLines.push(accountLine('6595 - Cash Over/Short', 'Cash over on session close', 0, cashDifference))
        } else {
          const short = Math.abs(cashDifference)
          controlLines.push(accountLine('6595 - Cash Over/Short', 'Cash short on session close', short, 0))
          controlLines.push(accountLine('2211 - Petty Cash', 'Cash short on session close', 0, short))
        }
      }
      // Balanced tender summary (Dr tender / Cr same tender) so method totals appear in journals.
      if (totalCash > 0) {
        controlLines.push(accountLine('2211 - Petty Cash', `Session cash sales ${fmtKes(totalCash)}`, totalCash, 0))
        controlLines.push(accountLine('2211 - Petty Cash', `Session cash sales cleared`, 0, totalCash))
      }
      if (totalMpesa > 0) {
        controlLines.push(accountLine('2210 - M-Pesa Paybill', `Session M-Pesa sales ${fmtKes(totalMpesa)}`, totalMpesa, 0))
        controlLines.push(accountLine('2210 - M-Pesa Paybill', `Session M-Pesa sales cleared`, 0, totalMpesa))
      }
      const bankByAccount = new Map<string, number>()
      for (const o of orders) {
        if (!isPosBankPayment(o.payment)) continue
        const id = o.bankAccountId || bankAccountIdForMethod(o.payment)
        bankByAccount.set(id, (bankByAccount.get(id) || 0) + tenderAmount(o))
      }
      for (const [bankId, amt] of bankByAccount) {
        if (amt <= 0) continue
        const label = bankAccountLabel(bankId)
        controlLines.push(accountLine(label, `Session bank sales ${fmtKes(amt)}`, amt, 0))
        controlLines.push(accountLine(label, `Session bank sales cleared`, 0, amt))
      }

      const sessionRef = openSession?.ref || allocateDocNumberSync('POSSESS')
      // The ledger keeps one journal per number and skips a repeat: a session
      // whose number is not yet the server's, or that another session shares,
      // closes under a journal number that also names the session.
      const claimedIds = new Set(
        orders.filter(o => o.sessionId === 'active').map(o => o.id).filter(Boolean),
      )
      if (claimedIds.size > 0) {
        setPosOrders(prev => prev.map(o => claimedIds.has(o.id) ? { ...o, sessionId } : o))
      }
      if (controlLines.length > 0) {
        const debit = controlLines.reduce((a, l) => a + l.debit, 0)
        const credit = controlLines.reduce((a, l) => a + l.credit, 0)
        const journal: JournalEntry = {
          id: uid(),
          ref: !isProvisionalDocRef(sessionRef) && !posSessions.some(s => s.id !== sessionId && s.ref === sessionRef) ? `JRN/${sessionRef}` : `JRN/${sessionRef}/${sessionId}`,
          date: now(),
          source: 'pos_session',
          description: `POS session close ${sessionRef} · sales ${fmtKes(totalSales)} · cash ${fmtKes(totalCash)} · mpesa ${fmtKes(totalMpesa)} · bank ${fmtKes(totalBank)} · variance ${fmtKes(cashDifference)}`,
          status: 'posted',
          bankAccountId: 'cash',
          lines: controlLines,
          totalDebit: debit,
          totalCredit: credit,
        }
        journalId = journal.id
        setJournalEntries(p => [journal, ...p])
        // No POS-session endpoint existed, so the tender control journal
        // reached the ledger only if the blob mirror replayed it.
        postSystemJournal('pos_session', journal, message => showToast(message, 'error'))
        addAuditLog('close_pos_session', sessionRef, journal.description)
      }

      const closed: POSSession = {
        id: sessionId,
        ref: sessionRef,
        status: 'closed',
        openedAt: openSession?.openedAt || new Date().toISOString(),
        closedAt: new Date().toISOString(),
        openingCash: posSessionOpeningCash,
        closingCash: counted,
        expectedCash,
        cashDifference,
        totalSales,
        totalCash,
        totalMpesa,
        totalCard,
        totalBank,
        orderCount: orders.length,
        openedBy: openSession?.openedBy,
        closedBy: user?.name || user?.username,
        journalId,
      }
      setPosSessions(p => {
        const exists = p.some(s => s.id === sessionId)
        return exists ? p.map(s => s.id === sessionId ? closed : s) : [closed, ...p]
      })
      setPosSessionOpen(false)
      setPosSessionId(null)
      setPosSessionOpeningCash(0)
      showToast(
        cashDifference === 0
          ? `Session closed · ${orders.length} sales · ${fmtKes(totalSales)}`
          : `Session closed · cash variance ${fmtKes(cashDifference)}`,
        cashDifference === 0 ? 'success' : 'info',
      )
      return closed
    },
    createPOSOrder: async (lines, payment, customerId, customerName, pointsRedeemed = 0, applyVat = false, paymentMeta) => {
      let sessionId = resolveOpenPosSessionId({ posSessionOpen, posSessionId, posSessions })
      if (!sessionId && posSessionOpen) {
        // Till is open but the id drifted — attach a real session and keep charging.
        const user = currentUser()
        const repaired: POSSession = {
          id: uid(),
          ref: allocateDocNumberSync('POSSESS'),
          status: 'open',
          openedAt: new Date().toISOString(),
          openingCash: posSessionOpeningCash,
          totalSales: 0,
          totalCash: 0,
          totalMpesa: 0,
          totalCard: 0,
          orderCount: 0,
          openedBy: user?.name || user?.username,
        }
        setPosSessions(p => [repaired, ...p])
        numberPosSessions([repaired.id])
        setPosSessionId(repaired.id)
        sessionId = repaired.id
      }
      if (!sessionId) {
        showToast('Open a POS session before charging', 'error')
        return null
      }
      const normalizedLines = lines.map(l => ({ ...l, subtotal: Number(l.price || 0) * Number(l.qty || 0) }))
      const sub = normalizedLines.reduce((a, l) => a + l.subtotal, 0)
      const vatRate = Number(companySettings.vatRate ?? 16)
      const tax = applyVat ? Math.round(sub * vatRate / 100) : 0
      const total = Math.max(0, sub + tax - pointsRedeemed)
      const requestedCustomerCredit = Math.max(0, Number(paymentMeta?.customerCreditAmount) || 0)
      const user = currentUser()
      if (requestedCustomerCredit > 0 && !customerId) {
        showToast('Select a customer before applying client credit', 'error')
        return null
      }
      if (requestedCustomerCredit > 0 && !canApplyCustomerCredit(user?.role)) {
        showToast('Only Finance, Admin Officer, or Director can apply client credit', 'error')
        return null
      }
      const availableCustomerCredit = customerId
        ? customerCreditBalance(customerCreditsRef.current, customerId)
        : 0
      if (requestedCustomerCredit > Math.min(availableCustomerCredit, total) + 0.01) {
        showToast('Client credit balance changed — review the available balance and try again', 'error')
        return null
      }
      const customerCreditAmount = Math.min(requestedCustomerCredit, availableCustomerCredit, total)
      const tenderTotal = Math.max(0, total - customerCreditAmount)
      const pointsEarned = customerId
        ? loyaltyPointsEarned(total, systemSettings.posLoyaltyKesPerPoint)
        : 0
      const resolvedBankId = tenderTotal > 0 && isPosBankPayment(payment)
        ? (paymentMeta?.bankAccountId || bankAccountIdForMethod(payment))
        : undefined
      const paymentReference = tenderTotal > 0
        ? ((paymentMeta?.paymentReference || '').trim() || undefined)
        : undefined
      const cartKey = [sessionId, ...normalizedLines
        .map(l => `${l.productId}:${l.serialId ?? ''}:${l.qty}`)
        .sort()].join('|')
      let orderRef = posPendingRefs.current.get(cartKey) ?? ''
      if (!orderRef) {
        try {
          orderRef = await storeCtxRef.current!.allocateDocRef('POS')
        } catch {
          orderRef = nextPosTicketRef(posOrders.map(o => o.ref))
        }
        if (!/^POS\/\d+$/.test(orderRef)) {
          orderRef = nextPosTicketRef(posOrders.map(o => o.ref))
        }
      }
      const invoiceId = uid()
      const creditAppliedAt = now()
      const creditAppliedBy = user?.name || user?.username || 'POS'
      let creditRemaining = customerCreditAmount
      const creditRefs: string[] = []
      const nextCustomerCredits = customerCreditAmount > 0
        ? customerCreditsRef.current.map(credit => {
            if (
              creditRemaining <= 0
              || credit.customerId !== customerId
              || !['available', 'partially_used'].includes(credit.status)
              || credit.balance <= 0
            ) return credit
            const amount = Math.min(creditRemaining, credit.balance)
            creditRemaining -= amount
            const nextBalance = Math.max(0, credit.balance - amount)
            creditRefs.push(credit.ref)
            return {
              ...credit,
              balance: nextBalance,
              status: nextBalance <= 0 ? 'used' as const : 'partially_used' as const,
              applications: [
                ...(credit.applications ?? []),
                {
                  invoiceId,
                  invoiceRef: orderRef,
                  amount,
                  date: creditAppliedAt,
                  appliedBy: creditAppliedBy,
                },
              ],
            }
          })
        : customerCreditsRef.current
      if (creditRemaining > 0.01) {
        showToast('Client credit could not be fully allocated — refresh the customer balance and try again', 'error')
        return null
      }

      const order: POSOrder = {
        id: uid(), ref: orderRef, sessionId,
        lines: normalizedLines, subtotal: sub, taxTotal: tax, total, payment,
        bankAccountId: resolvedBankId,
        paymentReference,
        customerId, customerName, date: now(), createdAt: new Date().toISOString(),
        createdByUserId: user?.id, createdByName: user?.name, pointsEarned, pointsRedeemed,
        customerCreditAmount: customerCreditAmount || undefined,
        customerCreditRefs: creditRefs.length ? creditRefs : undefined,
        salespersonId: paymentMeta?.salespersonId || user?.id,
        salespersonName: paymentMeta?.salespersonName || user?.name,
        ...(paymentMeta?.agentId ? {
          agentId: paymentMeta.agentId,
          agentName: paymentMeta.agentName,
          agentCommission: Math.max(0, Number(paymentMeta.agentCommission) || 0),
        } : {}),
        invoiceId,
      }
      // Authoritative stock deduction on the server before local UI mirror.
      const stockLines = normalizedLines.map(l => ({
        productId: l.productId,
        productName: l.productName,
        qty: l.qty,
        serialId: l.serialId,
        serialNumber: l.serialNumber,
        // POS always sells from warehouse (shop is "With Issues").
        sourceLocation: 'warehouse',
      }))
      try {
        const res = await fetch('/api/inventory/apply-pos-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderRef: order.ref,
            lines: stockLines,
            ...(customerId && (pointsEarned || pointsRedeemed) ? { loyalty: { customerId, earned: pointsEarned, redeemed: pointsRedeemed } } : {}),
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null
          // Refused outright (no stock, serial gone): nothing was taken, the
          // number can go. Otherwise the server may have taken the stock.
          if (res.status >= 400 && res.status < 500) posPendingRefs.current.delete(cartKey)
          else posPendingRefs.current.set(cartKey, orderRef)
          showToast(payload?.error || 'POS stock update failed', 'error')
          return null
        }
      } catch {
        posPendingRefs.current.set(cartKey, orderRef)
        showToast('Could not reach the server — the sale was not completed. Charge again to retry; stock will not be taken twice.', 'error')
        return null
      }
      posPendingRefs.current.delete(cartKey)
      // The server has taken the stock and tells every screen; quantities come
      // back from it. Subtracting here as well took a unit off twice whenever
      // the server's new figure reached this tab first — and the browser then
      // saved that figure. Only the serial is marked (setting it is harmless twice).
      normalizedLines.forEach(l => {
        if (l.serialId) setSerials(p => p.map(s => s.id === l.serialId ? { ...s, status: 'sold', location: 'customer', soldDate: now() } : s))
      })
      if (customerId) {
        setContacts(prev => prev.map(contact =>
          contact.id === customerId
            ? { ...contact, loyaltyPoints: Math.max(0, (contact.loyaltyPoints || 0) - pointsRedeemed) + pointsEarned }
            : contact,
        ))
      }
      if (customerCreditAmount > 0) {
        setCustomerCredits(nextCustomerCredits)
        addAuditLog(
          'apply_pos_customer_credit',
          order.ref,
          `Applied ${fmtKes(customerCreditAmount)} client credit (${creditRefs.join(', ')})`,
        )
      }

      // Persist the till ticket before the invoice so a later crash still leaves
      // Transaction History intact. Server union-merge is the source of truth.
      setPosOrders(p => [order, ...p])
      if (order.lines.some(l => l.serialId)) requestWarrantySync()
      try {
        const recorded = await fetch('/api/pos/record-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order }),
        })
        if (!recorded.ok) throw new Error(`HTTP ${recorded.status}`)
      } catch {
        // The browser copy still syncs it later; say so instead of staying silent.
        showToast(`${order.ref}: the till ticket is saved on this device only for now — keep this tab open until it syncs`, 'info')
        addAuditLog('pos_record_order_failed', order.ref, 'Till ticket not confirmed by the server')
      }
      // POS sales carry the till-ticket number (POS/NNNN) as their document
      // ref — the invoice record IS the sale receipt, so it shows as POS/0069
      // everywhere instead of consuming an INV/2026/NNNN invoice number.
      const invRefAllocated = orderRef
      const posInv: Invoice = {
        // Posted document, fully settled by the selected tender plus any client credit.
        id: invoiceId, ref: invRefAllocated, type: 'customer_invoice', status: 'posted',
        partnerId: customerId ?? 'walk-in', partnerName: customerName ?? 'Walk-in Customer',
        date: now(), dueDate: now(),
        lines: normalizedLines.map(l => {
          const product = prodRef.current.find(x => x.id === l.productId)
          return {
            id: uid(),
            description: l.serialNumber
              ? `${l.productName} ×${l.qty} · SN ${l.serialNumber}`
              : `${l.productName} ×${l.qty}`,
            qty: l.qty,
            unitPrice: l.price,
            taxRate: applyVat ? vatRate : 0,
            subtotal: l.subtotal,
            productId: l.productId,
            serialNumberId: l.serialId,
            accountCode: product ? resolveProductAccounts(product).saleAccountCode : undefined,
          }
        }),
        subtotal: sub, taxTotal: tax, total, amountPaid: total,
        notes: [
          `POS ${order.ref}`,
          paymentReference ? `Ref ${paymentReference}` : '',
          creditRefs.length ? `Client credit ${creditRefs.join(', ')} (${fmtKes(customerCreditAmount)})` : '',
        ].filter(Boolean).join(' · '),
        isPosInvoice: true,
        // An agent's sale earns the agent's commission, not the closer's.
        salespersonId: order.agentId ? undefined : order.salespersonId,
        salespersonName: order.agentId ? undefined : order.salespersonName,
      }
      setPosOrders(p => p.map(o => o.id === order.id ? { ...o, invoiceRef: posInv.ref } : o))
      setInvoices(p => [posInv, ...p])
      await saveInvoiceToServer(posInv, msg => showToast(msg, 'error'))
      const revenueBuckets = aggregateLinesByAccount({
        lines: posInv.lines,
        resolveProduct: (productId) => prodRef.current.find(p => p.id === productId),
        side: 'revenue',
        accounts: accountRef.current.map(a => ({ code: a.code, name: a.name })),
      })
      const revenueLines = revenueBuckets.length
        ? revenueBuckets.map(b => accountLine(b.account, `POS revenue ${order.ref}`, 0, b.amount))
        : [accountLine('5000 - Sales Revenue', `POS revenue ${order.ref}`, 0, sub)]
      const posJournal: JournalEntry = {
        id: uid(),
        ref: `JRN/${order.ref}`,
        date: now(),
        source: 'pos',
        description: `POS sale ${order.ref}${order.customerName ? ` — ${order.customerName}` : ''}`,
        status: 'posted',
        invoiceId: posInv.id,
        posOrderId: order.id,
        bankAccountId: bankAccountIdForMethod(payment, resolvedBankId),
        lines: [
          ...(tenderTotal > 0 ? [accountLine(
            bankAccountLabel(bankAccountIdForMethod(payment, resolvedBankId), payment),
            paymentReference ? `POS receipt ${order.ref} · ${paymentReference}` : `POS receipt ${order.ref}`,
            tenderTotal,
            0,
          )] : []),
          ...(customerCreditAmount > 0 ? [accountLine(
            '3313 - Customer Credits',
            `Client credit applied ${creditRefs.join(', ') || order.ref}`,
            customerCreditAmount,
            0,
          )] : []),
          ...(pointsRedeemed > 0 ? [accountLine('5200 - Sales Discounts', `Loyalty redemption ${order.ref}`, pointsRedeemed, 0)] : []),
          ...revenueLines,
          ...(tax > 0 ? [accountLine('3301 - Output VAT Payable', `VAT on ${order.ref}`, 0, tax)] : []),
        ],
        totalDebit: tenderTotal + customerCreditAmount + pointsRedeemed,
        totalCredit: sub + tax,
      }
      // A KES 0 sale has nothing to post; a one-line zero journal can never
      // balance and was retried by the journal mirror forever.
      const posJournalHasValue = posJournal.lines.some(l => Number(l.debit) > 0 || Number(l.credit) > 0)
      if (posJournalHasValue) {
        setJournalEntries(p => [posJournal, ...p])
        addAuditLog('post_pos', order.ref, `POS sale posted to journal ${posJournal.ref}`)
      }
      // A price typed in below the catalogue price is a discount someone gave:
      // leave a trail of who, what and how much.
      const discounted = normalizedLines.filter(l => Number((l as { listPrice?: number }).listPrice) > Number(l.price))
      if (discounted.length) {
        addAuditLog('pos_price_override', order.ref, discounted.map(l =>
          `${l.productName}${l.serialNumber ? ` (${l.serialNumber})` : ''}: ${fmtKes(Number((l as { listPrice?: number }).listPrice))} → ${fmtKes(l.price)}`,
        ).join('; '))
      }
      let accountingPostError: string | null = null
      try {
        const journalRes = await fetch('/api/pos/post-sale-journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            orderRef: order.ref,
            invoiceId: posInv.id,
            total: posInv.total,
            customerCreditAmount,
            subtotal: sub,
            tax,
            pointsRedeemed,
            paymentMethod: payment,
            bankAccountId: posJournal.bankAccountId,
            customerName: order.customerName,
            revenueLines: revenueBuckets.length
              ? revenueBuckets.map(b => ({ account: b.account, amount: b.amount }))
              : undefined,
            date: posJournal.date,
          }),
        })
        if (!journalRes.ok) {
          const payload = await journalRes.json().catch(() => null) as { error?: string } | null
          accountingPostError = payload?.error || `Accounting journal failed (HTTP ${journalRes.status})`
        }
      } catch {
        accountingPostError = 'Could not reach the accounting posting service'
      }
      if (accountingPostError) {
        addAuditLog('pos_accounting_post_failed', order.ref, accountingPostError)
      }
      const bankLabel = resolvedBankId
        ? (bankAccounts.find(b => b.id === resolvedBankId)?.name || resolvedBankId)
        : undefined
      const payLabel = isPosBankPayment(payment) ? 'BANK' : payment.toUpperCase()
      const creditLabel = customerCreditAmount > 0 && tenderTotal > 0 ? ` + ${fmtKes(customerCreditAmount)} client credit` : ''
      if (accountingPostError) {
        showToast(
          `${order.ref} sale recorded, but accounting needs attention: ${accountingPostError}`,
          'error',
        )
      } else {
        showToast(
          `${order.ref} · ${fmtKes(order.total)} via ${tenderTotal > 0 ? payLabel : 'CLIENT CREDIT'}`
            + (tenderTotal > 0 && bankLabel ? ` (${bankLabel})` : '')
            + creditLabel
            + (paymentReference ? ` · ${paymentReference}` : ''),
        )
      }
      return order
    },

    // ── Rider Management ────────────────────────────────────────────────────
    riders,
    deliveryJobs,
    riderWeeklyPays,

    ...createDeliveryActions(storeDeps),
    
    // ── Approval Workflows ────────────────────────────────────────────────────
    approvalRequests,
    checkDiscountApproval: (discountPercent) => {
      const roles = APPROVAL_RULES.discount({ discountPercent })
      return { requiresApproval: roles.length > 0, roles }
    },
    
    requestApproval: (type, details) => {
      const user = currentUser()
      if (!user) return null
      const request = createApprovalRequest(
        type,
        details.documentType ?? 'sales_order',
        details.documentId ?? details.referenceId ?? '',
        details.documentRef ?? details.referenceRef ?? 'Approval',
        user.id,
        user.name,
        { reason: details.reason ?? `${type} approval requested`, ...details },
        users.map(u => ({ id: u.id, name: u.name, role: u.role }))
      )
      
      setApprovalRequests(prev => [...prev, request])
      notifyUsers({
        recipients: approvalRecipientIds(request, users),
        type: 'system',
        title: `Approval needed: ${type.replace(/_/g, ' ')}`,
        body: String(request.details?.reason ?? `${type} approval requested`),
        module: request.documentType === 'purchase_order' ? 'purchase' : 'sales',
        path: approvalDocumentPath(request),
        icon: '⚠️',
        entityKey: `approval:${request.id}`,
        excludeUserId: user.id,
      })
      addAuditLog('approval_request', request.ref, `${type} approval by ${user.name}`)
      showToast('Approval request created', 'info')
      
      return request
    },

    checkCreditLimit: (customerId, orderTotal) => {
      const customer = companies.find(c => c.id === customerId)
      if (!customer) return { ok: true }
      const availableCredits = customerCreditBalance(customerCreditsRef.current, customerId)

      const outstanding = invoices
        .filter(inv => inv.partnerId === customerId && isOpenInvoice(inv))
        .reduce((sum, inv) => sum + invoiceResidual(inv), 0)
      const netOutstanding = Math.max(0, outstanding - availableCredits)

      const creditUsed = netOutstanding + orderTotal
      const creditAvailable = customer.creditLimit - netOutstanding

      if (creditUsed > customer.creditLimit) {
        return { ok: false, message: `Credit limit exceeded. Limit: ${fmtKes(customer.creditLimit)}, Used: ${fmtKes(netOutstanding)}, Available: ${fmtKes(creditAvailable)}`, requiresApproval: true }
      }
      return { ok: true, creditAvailable }
    },

    getCustomerCreditStatus: (customerId, newOrderTotal = 0, opts) => {
      const contact = contacts.find(c => c.id === customerId)
      const today = now()

      const unpaidInvoices = invoices.filter(inv =>
        inv.partnerId === customerId &&
        inv.type === 'customer_invoice' &&
        isOpenInvoice(inv)
      )

      const grossOutstandingBalance = unpaidInvoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.amountPaid), 0)
      const availableCredits = customerCreditBalance(customerCreditsRef.current, customerId)
      const outstandingBalance = Math.max(0, grossOutstandingBalance - availableCredits)

      const overdueInvoices = unpaidInvoices.filter(inv => inv.dueDate < today)
      const overdueBalance = Math.max(0, overdueInvoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.amountPaid), 0) - availableCredits)
      const overdueCount = overdueInvoices.length
      const creditLimit = contact?.creditLimit ?? 0
      const gate = evaluateCustomerCreditGate({
        overdueBalance,
        overdueCount,
        creditLimit,
        outstandingBalance,
        newOrderTotal,
        document: opts?.document ?? 'order',
        formatMoney: fmtKes,
        payOnReceipt: Boolean(systemSettings.accCreditPayOnReceiptEnforced) && isPayOnReceipt(contact),
      })

      return {
        ok: gate.ok,
        isLocked: gate.isLocked,
        creditLimitExceeded: gate.creditLimitExceeded,
        outstandingBalance,
        overdueBalance,
        overdueCount,
        creditLimit,
        creditAvailable: gate.creditAvailable,
        message: gate.message,
      }
    },

    issueCreditNoteFromSaleOrder: async (saleOrderId, amount, reason) => {
      const actor = currentUser()
      if (!canManageFullFinanceAction(actor)) {
        showToast('Only Finance or Director can issue credit notes', 'error')
        return null
      }
      if (!systemSettings.accCreditNotes) {
        showToast('Credit notes are disabled in Settings', 'error')
        return null
      }
      const so = soRef.current.find(s => s.id === saleOrderId)
      if (!so) return null
      const creditAmount = Math.max(0, Number(amount) || 0)
      if (creditAmount <= 0) {
        showToast('Enter a credit amount greater than zero', 'error')
        return null
      }
      const candidateInvoices = invRef.current.filter(i =>
        i.saleOrderId === saleOrderId && i.type === 'customer_invoice' && invoiceDocState(i.status) === 'posted',
      )
      if (candidateInvoices.length === 0) {
        showToast(`No posted invoice for ${so.ref} — cannot issue a credit note`, 'error')
        return null
      }
      if (candidateInvoices.length > 1) {
        showToast(`${so.ref} has multiple posted invoices — issue the credit note from Finance`, 'error')
        return null
      }
      const sourceInvoice = candidateInvoices[0]
      const maxCredit = Math.max(0, Number(sourceInvoice.amountPaid) || Number(sourceInvoice.total) || 0)
      if (creditAmount > maxCredit) {
        showToast(`Credit cannot exceed ${fmtKes(maxCredit)} for ${sourceInvoice.ref}`, 'error')
        return null
      }
      const ref = await storeCtxRef.current!.allocateDocRef('CN')
      const credit: CustomerCredit = {
        id: uid(),
        ref,
        customerId: so.customerId,
        customerName: so.customerName,
        sourceInvoiceId: sourceInvoice.id,
        sourceInvoiceRef: sourceInvoice.ref,
        amount: creditAmount,
        balance: creditAmount,
        status: 'available',
        createdAt: now(),
        createdBy: actor?.name ?? 'Finance',
        notes: reason?.trim() || `Credit note from sales order ${so.ref}`,
        applications: [],
      }
      setCustomerCredits(prev => [credit, ...prev])
      // No endpoint backs this flow, so the blob mirror was the only thing
      // putting the credit note in the ledger.
      const creditJournal = buildCustomerCreditJournal(sourceInvoice, ref, creditAmount)
      setJournalEntries(prev => [creditJournal, ...prev])
      postSystemJournal('sale_order_credit_note', creditJournal, message => showToast(message, 'error'))
      addAuditLog('sales_credit_note', so.ref, `Credit note ${ref} issued for ${fmtKes(creditAmount)}`)
      showToast(`Credit note ${ref} issued for ${fmtKes(creditAmount)}`, 'success')
      return ref
    },
    
    approveRequest: (requestId, decision, comments) => {
      const user = currentUser()
      if (!user) return
      const request = approvalRequests.find(r => r.id === requestId)
      if (!request) return
      let updatedRequest: ApprovalRequest
      try {
        updatedRequest = processApproval(request, user.id, user.name, decision, comments, user.role)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Unable to process approval', 'error')
        return
      }
      const nextRequests = approvalRequests.map(r => r.id === requestId ? updatedRequest : r)
      setApprovalRequests(nextRequests)
      if (request) {
        const docRequests = nextRequests.filter(r => r.documentId === request.documentId)
        const docStatus = docRequests.some(r => r.status === 'rejected') ? 'rejected'
          : docRequests.some(r => r.status === 'pending') ? 'pending'
          : 'approved'
        if (request.documentType === 'sales_order') {
          setSaleOrders(prev => prev.map(so => {
            if (so.id !== request.documentId) return so
            // The approval gate never changes the Odoo stage — the record
            // stays a Quotation until someone clicks Confirm.
            const updated = { ...so, approvalStatus: docStatus }
            sync(`/api/sale-orders/${so.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return updated
          }))
        }
        if (request.documentType === 'quote') {
          setQuotes(prev => prev.map(q => {
            if (q.id !== request.documentId) return q
            const updated = { ...q, approvalStatus: docStatus }
            sync(`/api/quotes/${q.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return updated
          }))
        }
        if (request.documentType === 'purchase_order') {
          setPurchaseOrders(prev => prev.map(po => {
            if (po.id !== request.documentId) return po
            const updated = { ...po, approvalStatus: docStatus }
            sync(`/api/purchase-orders/${po.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return updated
          }))
        }
        if (request.requestedBy && request.requestedBy !== user.id) {
          notifyUsers({
            recipients: [request.requestedBy],
            type: 'system',
            title: `Approval ${decision}: ${request.documentRef}`,
            body: `${request.type.replace(/_/g, ' ')} ${decision} by ${user.name}${comments ? ` — ${comments}` : ''}`,
            module: request.documentType === 'purchase_order' ? 'purchase' : 'sales',
            path: approvalDocumentPath(request),
            icon: decision === 'approved' ? '✅' : '❌',
            entityKey: `approval:${request.id}:decision`,
            excludeUserId: user.id,
          })
        }
        // If multi-level and still pending, notify the next level.
        if (updatedRequest.status === 'pending' && updatedRequest.currentLevel !== request.currentLevel) {
          notifyUsers({
            recipients: approvalRecipientIds(updatedRequest, users),
            type: 'system',
            title: `Approval needed: ${updatedRequest.type.replace(/_/g, ' ')}`,
            body: `${updatedRequest.documentRef} — next level after ${user.name}`,
            module: updatedRequest.documentType === 'purchase_order' ? 'purchase' : 'sales',
            path: approvalDocumentPath(updatedRequest),
            icon: '⚠️',
            entityKey: `approval:${updatedRequest.id}:level:${updatedRequest.currentLevel}`,
            excludeUserId: user.id,
          })
        }
        addAuditLog(`approval_${decision}`, request.ref, `${decision} by ${user.name}`)
        showToast(`Request ${decision}`, decision === 'approved' ? 'success' : 'error')
      }
    },
    
    getPendingApprovalsForUser: () => {
      const user = currentUser()
      if (!user) return []
      return getPendingApprovals(approvalRequests, user.id, user.role)
    },

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
