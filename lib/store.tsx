// @ts-nocheck
'use client'
import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef, useMemo } from 'react'
import { requestCreateUser, requestDeleteUser, requestUpdateUser, requestDeactivateUser, requestReactivateUser } from '@/lib/auth/client-users'
import { canManageHRRole, getFirstAllowedModule, hasModuleAccess as userHasModuleAccess, normalizeClientRole } from '@/lib/auth/access'
import { mergeCatalogProducts, mergeProductsRemoteState } from '@/lib/catalog-merge'
import { bootApiGroupsForRoute, remainingBootApiGroups, type BootApiGroup } from '@/lib/boot-apis'
import { documentMoneySnapshot, FUNCTIONAL_CURRENCY } from '@/lib/currency'
import { resolveListPrice } from '@/lib/pricing/pricelist'
import type { CreateUserInput, ModuleId as AuthModuleId, PublicUser, UpdateUserInput, UserRole as AuthUserRole } from '@/lib/auth/types'
import { calcStockByLocation as _calcStockByLocation, upsertBulkStock as _upsertBulkStock, aggregatePayroll } from '@/lib/business-logic'
import { calculatePayroll } from '@/lib/payroll'
import {
  APPROVAL_RULES,
  createApprovalRequest,
  getPendingApprovals,
  processApproval,
} from '@/lib/sales-approvals'
import {
  advanceExpenseApproval,
  buildExpenseApprovalChain,
  canUserApproveExpenseStep,
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
import { normalizeOpportunitiesForClient } from '@/lib/opportunity-normalization'
import { normalizeCompaniesForClient } from '@/lib/company-normalization'
import { saleOrderPersistBody } from '@/lib/sale-order-persist'
import {
  markSaleOrderDraftEdit,
  clearSaleOrderDraftEdit,
  hasSaleOrderDraftEdits,
  isSaleOrderDraftEditing,
  stampSaleOrderPersisted,
  mergeSaleOrdersPreservingDraftEdits,
} from '@/lib/sale-order-draft-edits'
import {
  normalizeSaleOrdersForClient,
  invoiceableQty as odooInvoiceableQty,
  saleOrderCancelBlockers,
  splitDeliveryForBackorder,
  initialDeliveryState,
  invoicePaymentStatus,
  invoiceDocState,
  isOpenInvoice,
  invoiceResidual,
  hasValidatedDeliveryForInvoice,
  isOpenDeliveryStatus,
  remainingUndeliveredByProduct,
  openDeliveryDemandByProduct,
  saleOrderLooksConfirmed,
  type InvoicePolicy,
} from '@/lib/odoo-sales-flow'
import { pairOrderLinesWithDeliveryLines, planPrepareDeliveryLines, sumQtyByProductId } from '@/lib/delivery-prepare'
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
import {
  aggregateLinesByAccount,
  COMPANY_ACCOUNT_FALLBACKS,
  formatAccountLabel,
  resolveProductAccounts,
  type AccountableProduct,
} from '@/lib/product-accounts'
import { inferProductKind, defaultTrackingForKind, defaultUnitForKind } from '@/lib/product-kind'
import {
  canPostOrPayCustomerInvoice,
  canPayOwnPostedInvoice,
  paymentJournalRef,
  DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES,
} from '@/lib/finance-controls'
import { ensureArray, parseStoredState } from '@/lib/safe-local-state'
import { repairOutsourceReadiness } from '@/lib/repair-outsource'
import { getPreviousRepairProgressStatus } from '@/lib/repair-progress'
import { assertFiniteSequenceNext, repairDatesWriteError } from '@/lib/data-validation'
import {
  isDirectRepairPath,
  isQuoteDeclinedReopenable,
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
import { billableQty, assertBillableQty } from '@/lib/purchase/three-way-match'
import {
  formatStockByLocation,
  resolveBulkDeliverySourceLocation,
} from '@/lib/inventory/delivery-source'
import { resolveAssignedRiderFee } from '@/lib/delivery-job-fee'
import {
  appendDeliveryChargeToInvoice,
  buildDeliveryChargeInvoiceLine,
} from '@/lib/invoice-delivery-charge'
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

export type ModuleId = AuthModuleId

export type UserRole = AuthUserRole

export type User = PublicUser

// ─── Stock Locations ──────────────────────────────────────────────────────────
export type LocationId = 'warehouse' | 'shop' | 'repair_unit' | 'vendor' | 'customer' | 'employee' | 'pending_testing' | 'quarantine'

export const LOCATIONS: Record<LocationId, { name: string; icon: string; color: string }> = {
  warehouse:         { name: 'Warehouse (Main)',  icon: '🏭', color: '#875BF7' },
  shop:              { name: 'With Issues',        icon: '⚠️',  color: '#F59E0B' },
  repair_unit:       { name: 'Repair Unit',       icon: '🔧', color: '#F04438' },
  vendor:            { name: 'Vendor',            icon: '🚚', color: '#F79009' },
  customer:          { name: 'Customer',          icon: '👤', color: '#2E90FA' },
  employee:          { name: 'Employee Asset',    icon: '🧑', color: '#7F56D9' },
  pending_testing:   { name: 'Pending Testing',   icon: '🧪', color: '#0EA5E9' },
  quarantine:        { name: 'Quarantine',        icon: '🚫', color: '#DC2626' },
}

// ─── Category Config ──────────────────────────────────────────────────────────
export type CategoryId = 'Laptops' | 'Desktops' | 'Parts & Components' | 'Accessories' | 'Printers' | 'Networking' | 'Mobile Devices' | 'Software & Licences' | 'Services'

export const CATEGORY_CONFIG: Record<CategoryId, { serialRequired: boolean; trackStock: boolean }> = {
  Laptops:               { serialRequired: true,  trackStock: true  },
  Desktops:              { serialRequired: true,  trackStock: true  },
  'Parts & Components':  { serialRequired: false, trackStock: true  },
  Accessories:           { serialRequired: false, trackStock: true  },
  Printers:              { serialRequired: true,  trackStock: true  },
  Networking:            { serialRequired: true,  trackStock: true  },
  'Mobile Devices':      { serialRequired: true,  trackStock: true  },
  'Software & Licences': { serialRequired: false, trackStock: false },
  Services:              { serialRequired: false, trackStock: false },
}

export const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as CategoryId[]

export type { ProductKind } from '@/lib/product-kind'
export { PRODUCT_KIND_OPTIONS, UOM_OPTIONS, inferProductKind, defaultTrackingForKind, defaultUnitForKind, kindRequiresInventoryAccounts } from '@/lib/product-kind'
export {
  CATEGORY_ACCOUNT_DEFAULTS,
  COMPANY_ACCOUNT_FALLBACKS,
  resolveProductAccounts,
  applyCategoryAccountDefaults,
  formatAccountLabel,
  aggregateLinesByAccount,
} from '@/lib/product-accounts'

// ─── Core Types ───────────────────────────────────────────────────────────────

// CRM & Sales Types
export type OpportunityStage = 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost' | 'on_hold'
export type LeadSource = 'website' | 'referral' | 'cold_call' | 'email_campaign' | 'social_media' | 'trade_show' | 'partner' | 'existing_customer' | 'walk_in'
export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired' | 'revised'

export interface Client {
  id: string
  name: string
  tradingName?: string
  taxId: string
  email: string
  phone: string
  website?: string
  physicalAddress: string
  postalAddress?: string
  city: string
  country: string
  segment?: string
  industry?: string
  employees?: number
  annualRevenue?: number
  creditLimit?: number
  creditUsed: number
  paymentTerms?: number
  accountManagerId?: string
  accountManagerName?: string
  tags?: string[]
  status: 'active' | 'inactive' | 'suspended'
  notes?: string
  createdAt: string
  updatedAt: string
  // Relations
  opportunities?: Opportunity[]
  contactPersons?: ContactPerson[]
  quotes?: Quote[]
  saleOrders?: SaleOrder[]
}

export type Company = Client

export interface ContactPerson {
  id: string
  clientId: string
  companyId?: string
  companyName?: string
  firstName: string
  lastName: string
  jobTitle?: string
  department?: string
  email: string
  phone: string
  mobile?: string
  linkedIn?: string
  isPrimary?: boolean
  isDecisionMaker?: boolean
  isTechnicalContact?: boolean
  isBillingContact?: boolean
  preferredChannel?: 'email' | 'phone' | 'whatsapp'
  notes?: string
  // Relations
  client?: Client
}

export interface Opportunity {
  id: string
  ref: string
  name: string
  clientId: string
  companyId?: string
  companyName?: string
  contactPersonId?: string
  contactPersonName?: string
  assignedToId?: string
  ownerId?: string
  ownerName?: string
  stage: OpportunityStage
  probability: number
  expectedValue: number
  actualValue?: number
  expectedCloseDate?: string
  actualCloseDate?: string
  leadSource?: LeadSource
  leadScore?: number
  description?: string
  customerNeeds?: string
  competitorInfo?: string
  notes?: string
  tags?: string[]
  quoteIds?: string[]
  lostReason?: string
  lostToCompetitor?: string
  createdAt: string
  createdDate?: string
  lastActivityDate?: string
  // Relations
  client?: Client
  contactPerson?: ContactPerson
  assignedTo?: User
  quotes?: Quote[]
  activities?: OpportunityActivity[]
}

export interface QuoteLineItem {
  id: string
  productId: string
  productName: string
  sku: string
  description?: string
  qty: number
  unit: string
  listPrice: number
  unitPrice: number
  discount: number
  discountAmount: number
  taxRate: number
  taxAmount: number
  subtotal: number
  lineTotal: number
  notes?: string
}

export interface Quote {
  id: string
  quoteNumber: string
  ref: string
  clientId?: string
  companyId: string
  companyName: string
  contactPersonId?: string
  contactPersonName: string
  contactPersonEmail?: string
  contactPersonPhone?: string
  opportunityName: string
  ownerId?: string
  ownerName?: string
  source?: string
  repairId?: string
  repairRef?: string
  assignedToId?: string
  status: QuoteStatus
  quoteDate: string
  issueDate: string
  validUntil: string
  sentDate?: string
  viewedDate?: string
  acceptedDate?: string
  rejectedDate?: string
  rejectionReason?: string
  viewCount: number
  version: number
  opportunityId?: string
  subject?: string
  subtotal: number
  discountAmount: number
  discountPct?: number
  discountPercent: number
  taxAmount?: number
  taxTotal: number
  totalAmount: number
  total: number
  /** Document currency snapshot (KES-first). */
  currencyCode?: string
  baseCurrencyCode?: string
  exchangeRateToBase?: number
  pricelist?: string
  pricelistId?: string
  notes?: string
  internalNotes?: string
  terms?: string
  paymentTerms?: string
  deliveryTerms?: string
  warranty?: string
  approvedById?: string
  approvedAt?: string
  convertedToId?: string
  saleOrderId?: string
  invoiceId?: string
  parentQuoteId?: string
  approvalStatus?: 'not_required' | 'pending' | 'approved' | 'rejected'
  approvalRequestIds?: string[]
  approvalRequiredReason?: string
  createdById?: string
  createdByName?: string
  createdAt?: string
  updatedAt?: string
  lines: QuoteLineItem[]
  // Relations
  client?: Client
  assignedTo?: User
  approvedBy?: User
  convertedTo?: Invoice
  createdBy?: User
  items?: QuoteItem[]
  invoices?: Invoice[]
  opportunity?: Opportunity
  saleOrders?: SaleOrder[]
}

export interface OpportunityActivity {
  id: string
  opportunityId: string
  type: string
  subject?: string
  description?: string
  outcome?: string
  scheduledAt?: string
  scheduledDate?: string
  status?: 'completed' | 'scheduled'
  completedDate?: string
  createdById: string
  createdByName?: string
  createdAt: string
  createdDate?: string
  // Relations
  opportunity?: Opportunity
  createdBy?: User
}

// Contact — unified record for companies, individuals, customers, vendors
export interface Contact {
  id: string
  type: 'individual' | 'company'
  // Identity
  name: string            // company name OR full name for individual
  tradingName?: string    // companies only
  registrationNumber?: string // companies: business registration number
  vatNumber?: string      // KRA PIN (companies & individuals)
  idNumber?: string       // national ID / passport (individuals)
  // Individual-specific
  jobTitle?: string
  companyId?: string      // links individual to a company contact
  // Contact details
  email: string
  phone: string
  mobile?: string
  website?: string
  // Address
  address: string
  postalAddress?: string
  city?: string
  country?: string
  // Classification
  isCustomer: boolean
  isVendor: boolean
  industry?: string
  tags: string[]
  // Financial
  creditLimit?: number
  paymentTermsDays?: number
  paymentTerms?: string   // kept for backward compat
  bankName?: string
  bankAccount?: string
  bankBranch?: string
  bankDetails?: string    // kept for backward compat
  // Other
  notes?: string
  vendorRating?: number
  loyaltyPoints?: number
  createdAt: string
  /** Soft-archive (P1-DEED-006) — hidden from pickers, retained for history. */
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  /** Set when this contact was merged into another (survivor id). */
  mergedIntoId?: string
}

export interface AuditLog {
  id: string; date: string; user: string; action: string; documentRef: string; details: string
}

// ── In-app Notifications ──────────────────────────────────────────────────────
export type {
  NotifType,
  AppNotification,
  NotifyUsersInput,
} from '@/lib/in-app-notifications'

// ── Cashbook / Bank Accounts ──────────────────────────────────────────────────
export interface BankAccount {
  id: string
  name: string           // e.g. "NCBA Current"
  bankName: string       // e.g. "NCBA Bank Kenya PLC"
  accountNo: string
  currency: string       // 'KES'
  openingBalance: number
  openingDate: string
  active: boolean
}

export interface BankRecon {
  id: string
  bankAccountId: string
  month: string          // 'YYYY-MM'
  statementBalance: number
  statementDate: string  // last day of month
  notes: string
  reconciledBy?: string
  reconciledAt?: string
  status: 'pending' | 'reconciled' | 'discrepancy'
}

// Derived cashbook entry type (not stored — computed from transactions)
export interface CashbookEntry {
  id: string
  date: string
  ref: string
  description: string
  category: string
  bankAccountId: string  // which bank/cash account
  debit: number          // money out
  credit: number         // money in
  sourceType: 'customer_invoice' | 'vendor_bill' | 'deposit' | 'pos' | 'expense' | 'payroll' | 'purchase'
  sourceId: string
  recordedBy: string
}

export type StatementLineCategory = 'bank_charge' | 'interest_earned' | 'transfer' | 'receipt' | 'payment' | 'other'

export interface BankStatementLine {
  id: string
  bankAccountId: string
  month: string            // 'YYYY-MM'
  date: string
  description: string
  reference: string        // cheque no / mpesa code / bank ref
  debit: number            // money out on statement
  credit: number           // money in on statement
  balance?: number         // running balance per statement (optional)
  category: StatementLineCategory
  matchedEntryId?: string  // cashbook entry id it's matched to
}

// Default 5 bank accounts for the company
export const DEFAULT_BANK_ACCOUNTS: BankAccount[] = [
  { id: 'ncba',   name: 'NCBA Current Account',  bankName: 'NCBA Bank Kenya PLC',  accountNo: '1005157785', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true },
  { id: 'equity', name: 'Equity Bank Account',    bankName: 'Equity Bank Kenya',    accountNo: '0670200000', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true },
  { id: 'kcb',    name: 'KCB Current Account',    bankName: 'KCB Bank Kenya',       accountNo: '1109876543', currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true },
  { id: 'mpesa',  name: 'M-Pesa Paybill',         bankName: 'Safaricom M-Pesa',     accountNo: '880100',     currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true },
  { id: 'cash',   name: 'Petty Cash Float',        bankName: 'Cash',                 accountNo: 'CASH',       currency: 'KES', openingBalance: 0, openingDate: '2025-01-01', active: true },
]

export interface CompanySettings {
  name: string
  address: string
  city: string
  phone: string
  email: string
  website: string
  kraPin: string
  vatRate: number
  mpesaPaybill: string
  mpesaAccount: string
  logoUrl: string
  /** Document default / display currency. Books remain KES (functionalCurrency). */
  currency: string
  /** Always KES — accounting / trial balance functional currency. */
  functionalCurrency?: 'KES'
  invoiceFooter: string
  printTemplate?: 'classic' | 'modern' | 'compact'
}

export interface SystemSettings {
  // General
  multiUserRoles: boolean
  enforceDeptAccess: boolean
  auditLogs: boolean
  fiscalYearStart: string
  // CRM
  crmLeads: boolean
  crmLeadScoring: boolean
  crmTags: boolean
  crmSourceTracking: boolean
  crmPipelineStages: string[]
  crmEnforceNextActivity: boolean
  crmAutoAssignLeads: boolean
  crmAutoFollowUpAfterQuote: boolean
  // Sales
  salesQuotationTemplates: boolean
  salesOptionalProducts: boolean
  salesDigitalSignature: boolean
  salesOnlineAcceptance: boolean
  salesPricelists: boolean
  salesDiscountControl: boolean
  salesConfirmedQuotesToOrders: boolean
  /** Odoo "Lock Confirmed Sales": confirmed orders freeze commercial fields. */
  salesLockConfirmed: boolean
  // Inventory
  invProductsMasterOnly: boolean
  invNoDirectStockEdits: boolean
  invMultiStepRoutes: boolean
  invStorageLocations: string[]
  invSerialNumbers: boolean
  invLots: boolean
  invAutomatedValuation: boolean
  invCostingMethod: 'fifo' | 'average' | 'standard'
  /** Feature flag for Device Reconfiguration work orders. Default true when unset. */
  reconfigurationEnabled: boolean
  /**
   * Minimum gross-margin % required after reconfiguration without finance override.
   */
  reconfigurationMinMarginPct: number
  /**
   * Per-category markup % used to auto-calculate sale price from cost:
   * salePrice = round(costPrice × (1 + pct / 100)).
   * Omit or leave blank for a category to disable auto-calc for it.
   */
  invCategorySaleMarkupPct: Partial<Record<CategoryId, number>>
  // Purchase
  purPurchaseAgreements: boolean
  purVendorPricelists: boolean
  purRequireApprovalHighValue: boolean
  purHighValueThreshold: number
  purEnforceRFQFlow: boolean
  purStoreLeadTimes: boolean
  // Repair
  repRepairOrders: boolean
  repWarrantyTracking: boolean
  repPartsConsumption: boolean
  repEnforceFlow: boolean
  repOnlyAssignedTechSeesJob: boolean
  repAdminAssignsJobs: boolean
  /** Flat Diagnosis First fee (KES) — walk-in & corporate; not credited against labour. */
  diagnosisFeeKes: number
  /** @deprecated Prefer diagnosisFeeKes. */
  diagnosisFeeRegularKes: number
  /** @deprecated Prefer diagnosisFeeKes. */
  diagnosisFeeHighEndKes: number
  // Accounting
  accCustomerInvoices: boolean
  accVendorBills: boolean
  accCreditNotes: boolean
  accVatEnabled: boolean
  accBankJournals: boolean
  accMpesaJournals: boolean
  accReconciliation: boolean
  accLockDates: boolean
  accApprovalForRefunds: boolean
  // HR
  hrAttendance: boolean
  hrLeaves: boolean
  hrRestrictSalaryInfo: boolean
  hrRoleBasedVisibility: boolean
  // POS
  posSessionControl: boolean
  posCashControl: boolean
  posReceiptPrinting: boolean
  // Security
  secDisableProductDeletion: boolean
  secDisableStockManipulation: boolean
  secDisableInvoiceEditAfterValidation: boolean
  // When true (default), customers must enter the phone number on file to approve a quote
  // or confirm payment through the portal. Set false only to temporarily reduce friction.
  secPortalRequirePhoneVerification: boolean
  /**
   * Admin Officer may post/pay customer invoices at or under this KES total.
   * Bank recon, cancel/reset, and expense reimbursement stay Finance/Director.
   */
  accAdminOfficerInvoiceLimitKes: number
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  multiUserRoles: true, enforceDeptAccess: true, auditLogs: true, fiscalYearStart: 'January',
  crmLeads: true, crmLeadScoring: false, crmTags: true, crmSourceTracking: true,
  crmPipelineStages: ['Inquiry Received', 'Assigned', 'Contacted', 'Qualified', 'Needs Confirmed', 'Quote Sent', 'Follow-up', 'Won', 'Lost'],
  crmEnforceNextActivity: true, crmAutoAssignLeads: false, crmAutoFollowUpAfterQuote: true,
  salesQuotationTemplates: true, salesOptionalProducts: true, salesDigitalSignature: false,
  salesOnlineAcceptance: false, salesPricelists: true, salesDiscountControl: true, salesConfirmedQuotesToOrders: true,
  salesLockConfirmed: true,
  invProductsMasterOnly: true, invNoDirectStockEdits: true, invMultiStepRoutes: true,
  invStorageLocations: ['Incoming', 'Workshop', 'Ready for Sale', 'Faulty / Scrap'],
  invSerialNumbers: true, invLots: false, invAutomatedValuation: true, invCostingMethod: 'average',
  reconfigurationEnabled: true, reconfigurationMinMarginPct: 10,
  invCategorySaleMarkupPct: {},
  purPurchaseAgreements: false, purVendorPricelists: true, purRequireApprovalHighValue: true,
  purHighValueThreshold: 50000, purEnforceRFQFlow: true, purStoreLeadTimes: true,
  repRepairOrders: true, repWarrantyTracking: true, repPartsConsumption: true,
  repEnforceFlow: true, repOnlyAssignedTechSeesJob: true, repAdminAssignsJobs: true,
  diagnosisFeeKes: 1000, diagnosisFeeRegularKes: 1000, diagnosisFeeHighEndKes: 1000,
  accCustomerInvoices: true, accVendorBills: true, accCreditNotes: true, accVatEnabled: true,
  accBankJournals: true, accMpesaJournals: true, accReconciliation: true,
  accLockDates: true, accApprovalForRefunds: true,
  accAdminOfficerInvoiceLimitKes: 1000000,
  hrAttendance: false, hrLeaves: true, hrRestrictSalaryInfo: true, hrRoleBasedVisibility: true,
  posSessionControl: true, posCashControl: true, posReceiptPrinting: true,
  secDisableProductDeletion: true, secDisableStockManipulation: true, secDisableInvoiceEditAfterValidation: true,
  secPortalRequirePhoneVerification: true,
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  name:          'Deed Technologies LTD',
  address:       'Sanlam House, Kenyatta Avenue',
  city:          'Nairobi 6690-20200',
  phone:         '0113407964',
  email:         'info@deed.africa',
  website:       'http://deed.africa',
  kraPin:        'P051999898X',
  vatRate:       16,
  mpesaPaybill:  '880100',
  mpesaAccount:  '468778',
  logoUrl:       '',
  currency:      'KES',
  functionalCurrency: 'KES',
  invoiceFooter: 'Thank you for your business.',
  printTemplate: 'classic',
}

// ── Chart of Accounts ─────────────────────────────────────────────────────────
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export interface Account {
  id: string
  code: string          // e.g. "1101"
  name: string
  type: AccountType
  group: string         // top-level BS/PL section e.g. "Inventory - Closing"
  subGroup?: string     // second-level COA grouping e.g. "Raw Materials"
  isActive: boolean
  balance: number       // seed / static balance; dynamic accounts are computed at runtime
  isDynamic?: boolean   // true = balance comes from invoices/journals at runtime
  dynamicKey?: 'ar' | 'ap' | 'revenue' | 'salaries' | 'net_profit'
  notes?: string
}

export interface Product {
  id: string; name: string; sku: string; barcode: string
  category: CategoryId; salePrice: number; costPrice: number; taxRate: number
  /** Optional channel prices — used by WHOLESALE / KILIMALL pricelists. */
  wholesalePrice?: number
  kilimallPrice?: number
  /** Odoo-style commercial type: storable | consumable | service */
  productKind?: import('@/lib/product-kind').ProductKind
  trackingMethod?: TrackingMethod
  // stockQty is derived from serials+moves — kept for display/quick access
  stockQty: number; minStock: number; unit: string
  // Odoo-style invoicing policy: invoice Ordered ('order') or Delivered
  // ('delivery') quantities. Default is 'order'.
  invoicePolicy?: 'order' | 'delivery'
  description: string; canBeSold: boolean; canBePurchased: boolean
  image: string; isActive: boolean; warrantyMonths: number
  requiresSerial: boolean  // maintained for backward compatibility with legacy flows
  saleAccountCode?: string  // revenue account code e.g. '5001'
  costAccountCode?: string  // cost/purchase account code e.g. '6101'
  inventoryAccountCode?: string  // inventory asset account code e.g. '1200'
  cogsAccountCode?: string       // cost of goods sold account code e.g. '6001'
  adjustmentAccountCode?: string // stock gain/variance account code
  writeOffAccountCode?: string   // damage, theft, expiry, and write-off expense account code
  priceDifferenceAccountCode?: string // PO vs vendor bill price variance
  parentId?: string          // links to a parent product — makes this a variant
  priceUpdatedAt?: string
  priceUpdatedBy?: string
}

export interface ProductPriceHistory {
  id: string
  productId: string
  productName: string
  sku: string
  oldSalePrice: number
  newSalePrice: number
  oldCostPrice: number
  newCostPrice: number
  reason: string
  effectiveDate: string
  updatedById?: string
  updatedByName: string
  updatedAt: string
}

// Individual serialized unit
export interface SerialNumber {
  id: string; serial: string; productId: string; productName: string
  sku?: string
  location: LocationId
  status: 'available' | 'assigned' | 'sold' | 'under_repair' | 'returned' | 'written_off' | 'refurbishment' | 'reconfiguration'
  purchaseOrderId?: string; receiptId?: string
  saleOrderId?: string; warrantyId?: string; repairId?: string
  receivedDate: string; soldDate?: string
  barcode: string  // same as serial or system-generated
  accessories?: string[]   // accessories received with unit e.g. ['Charger', 'Bag']
  accessoryNotes?: string  // free-text note about condition / missing items
  specs?: string           // freetext specs e.g. "8GB RAM, 512GB SSD, Intel i5-12th Gen"
}

// Refurbishment job — unit received with issues, needs work before going to sales floor
export type RefurbStatus = 'queued' | 'assigned' | 'in_progress' | 'ready' | 'transferred' | 'written_off'

export interface RefurbPart {
  id: string
  partName: string
  productId?: string        // linked inventory product (optional — parts may not be in catalogue)
  qty: number
  estimatedCost: number
  // 'needed'    — logged but not yet actioned
  // 'requested' — tech asked for it; lead tech alerted (stock was unavailable)
  // 'allocated' — lead tech pulled it from stock
  // 'ordered'   — PO raised for it
  // 'received'  — PO received / part is now in-house
  // 'used'      — installed in the device
  status: 'needed' | 'requested' | 'allocated' | 'ordered' | 'received' | 'used'
  requestedDate?: string
  allocatedDate?: string
  allocatedByName?: string
  notifiedTechDate?: string   // when lead tech flagged it ready for the tech
  poId?: string               // linked purchase order (if ordered)
  notes?: string
}

export interface RefurbishmentJob {
  id: string
  ref: string           // e.g. REF/0001
  status: RefurbStatus
  serialId: string
  serialNumber: string
  productId: string
  productName: string
  specs?: string
  receiptId?: string
  receiptRef?: string
  intakeDate: string
  intakeIssueDescription: string   // issue flagged on receipt
  assignedTechnicianId?: string
  assignedTechnicianName?: string
  assignedDate?: string
  techNotes?: string   // technician's running notes / diagnosis
  partsNeeded: RefurbPart[]
  completedDate?: string
  transferDate?: string
  underWarranty?: boolean
}

export interface SaleOrderItem {
  id: string
  saleOrderId: string
  productId?: string
  description?: string
  qty: number
  unitPrice: number
  taxRate: number
  lineTotal: number
  notes?: string
  serialNumberId?: string
  // Relations
  saleOrder?: SaleOrder
  product?: Product
  serialNumber?: SerialNumber
}

// Odoo-style sale document states. Fulfilment progress (delivery, invoicing)
// no longer lives in the status: it is derived from the delivery records and
// per-line qtyDelivered / qtyInvoiced (see lib/odoo-sales-flow.ts).
export type SOStatus = 'quotation' | 'quotation_sent' | 'sale' | 'cancelled'

export interface SaleOrder {
  id: string
  orderNumber?: string
  ref?: string
  // Original quotation number (QUO/…), kept when confirmation assigns the SO number.
  quotationRef?: string
  // Pro-forma invoice number (PI/…), assigned the first time a pro-forma is issued.
  proformaRef?: string
  clientId?: string
  customerId: string
  customerName: string
  quoteId?: string
  invoiceId?: string
  deliveryId?: string
  approvalStatus?: 'not_required' | 'pending' | 'approved' | 'rejected'
  approvalRequestIds?: string[]
  approvalRequiredReason?: string
  stockReservationIds?: string[]
  creditOverrideApprovalId?: string
  discountApprovalId?: string
  backorderApprovalId?: string
  backorderLines?: Array<{ productId: string; productName: string; qtyOrdered: number; qtyAvailable: number; qtyBackordered: number }>
  status: SOStatus
  orderDate: string
  date: string
  validUntil?: string
  deliveryDate?: string
  paymentTerms?: string
  // Quotation versioning: versionGroupId points at the v1 (root) order's own
  // id for every row in a lineage once a second version exists; undefined
  // means this quotation was never versioned.
  versionNumber?: number
  versionGroupId?: string
  // Quotation Sent metadata (recorded when Send by Email succeeds)
  sentAt?: string
  sentById?: string
  sentByName?: string
  sentTo?: string
  sentMessage?: string
  // Odoo sale-order commercial fields
  pricelist?: string
  pricelistId?: string
  /** Document currency snapshot (KES-first). Books remain KES. */
  currencyCode?: string
  baseCurrencyCode?: string
  exchangeRateToBase?: number
  salespersonId?: string
  salespersonName?: string
  salesTeam?: string
  // Sales Order confirmation metadata
  confirmedAt?: string
  confirmedById?: string
  confirmedByName?: string
  // Lock Confirmed Sales — commercial fields frozen until unlocked
  locked?: boolean
  customerRef?: string
  invoiceAddress?: string
  deliveryAddress?: string
  lines: any[]
  subtotal: number
  taxAmount: number
  taxTotal: number
  discountAmount: number
  totalAmount: number
  total: number
  amountPaid: number
  notes?: string
  lockVersion?: number
  createdById?: string
  createdByUserId?: string
  createdByName?: string
  createdAt?: string
  updatedAt?: string
  // Relations
  client?: Client
  quote?: Quote
  createdBy?: User
  items?: SaleOrderItem[]
  invoices?: Invoice[]
  deliveries?: DeliveryNote[]
}

export type InvoiceType = 'customer_invoice' | 'vendor_bill'
// Pure document state. Payment progress (Not Paid / Partially Paid / Paid /
// Blocked / Reversed) is never stored — it is derived from amountPaid, the
// payments list and the paymentBlocked flag via invoicePaymentStatus().
// Records persisted before this separation may still carry legacy values
// ('paid', 'partially_paid', 'overdue') which invoiceDocState() normalizes.
export type InvoiceStatus = 'draft' | 'posted' | 'cancelled'

export interface InvoiceLine {
  id: string; description: string; qty: number; unitPrice: number; taxRate: number; subtotal: number
  /** Per-line discount percent (0–100). Applied before tax. */
  discountPct?: number
  lineType?: 'item' | 'section'
  productId?: string    // original product (for account lookup)
  accountCode?: string  // revenue account code (e.g. '5001')
}

export interface InvoicePayment {
  id: string
  date: string
  amount: number
  method: string
  reference?: string
  bankAccountId?: string
  journalEntryId?: string
  recordedBy: string
}

export interface Invoice {
  id: string; ref: string; type: InvoiceType; status: InvoiceStatus
  partnerId: string; partnerName: string
  date: string; dueDate: string
  lines: InvoiceLine[]; subtotal: number; taxTotal: number; total: number; amountPaid: number
  saleOrderId?: string; purchaseOrderId?: string; receiptId?: string; repairId?: string; notes: string
  payments?: InvoicePayment[]
  /** Document currency snapshot (KES-first). */
  currencyCode?: string
  baseCurrencyCode?: string
  exchangeRateToBase?: number
  // Carried forward from the source sale order (Odoo invoice/delivery address).
  invoiceAddress?: string
  deliveryAddress?: string
  /** Linked rider logistics job (DeliveryJob) — not the stock DN. */
  deliveryJobId?: string
  // Finance dispute flag — payment collection blocked until released.
  paymentBlocked?: boolean
  /** User who posted the invoice — used for SoD on large payments. */
  postedByUserId?: string
  postedByName?: string
  postedAt?: string
}

export interface Payment {
  id: string
  ref: string
  customerId: string
  customerName: string
  amount: number
  method: 'cash' | 'bank_transfer' | 'mpesa' | 'card' | 'cheque'
  invoices: { invoiceId: string; invoiceRef: string; amountAllocated: number }[]
  status: 'pending' | 'cleared' | 'bounced'
  reference: string
  receiptNumber: string
  receivedBy: string
  receivedDate: string
  clearedDate?: string
  accountingDate: string
  notes?: string
}

export interface CustomerCredit {
  id: string
  ref: string
  customerId: string
  customerName: string
  sourceInvoiceId: string
  sourceInvoiceRef: string
  amount: number
  balance: number
  status: 'available' | 'partially_used' | 'used' | 'void'
  createdAt: string
  createdBy: string
  notes?: string
  applications: {
    invoiceId: string
    invoiceRef: string
    amount: number
    date: string
    appliedBy: string
  }[]
}

// ── Outbound Release Checkpoint ───────────────────────────────────────────────
export type ReleaseStatus = 'pending' | 'all_picked' | 'verified' | 'released' | 'voided'
export type ItemReleaseStatus = 'picked' | 'verified' | 'released'
export type SignatureMethod = 'digital' | 'paper'

export interface OrcItem {
  id: string
  releaseId: string
  serialNumberId: string
  expectedSerial: string
  confirmedSerial?: string
  serialMatched?: boolean
  status: ItemReleaseStatus
  verifiedById?: string
  verifiedAt?: string
}

export interface OrcLogEntry {
  id: string
  releaseId: string
  action: string
  fromStatus?: string
  toStatus?: string
  performedById: string
  performedByName?: string
  performedAt: string
  notes?: string
  metadata?: Record<string, unknown>
}

export interface OutboundRelease {
  id: string
  ref: string
  // source — exactly one set
  invoiceId?: string
  repairId?: string
  deliveryNoteId?: string
  // source doc display info (populated client-side for quick display)
  sourceRef?: string
  sourceType?: 'invoice' | 'repair' | 'delivery_note'
  clientId: string
  clientName?: string
  status: ReleaseStatus
  initiatedById: string
  initiatedByName?: string
  initiatedAt: string
  verifiedById?: string
  verifiedByName?: string
  verifiedAt?: string
  receivedBy?: string
  receivedByPhone?: string
  releaseNotes?: string
  conditionOnRelease?: string
  // signatures
  receiverSigData?: string
  receiverSigMethod?: SignatureMethod
  receiverSigRef?: string
  releaserSigData?: string
  releaserSigMethod?: SignatureMethod
  releaserSigRef?: string
  customerAckSigData?: string
  customerAckSigMethod?: SignatureMethod
  customerAckSigRef?: string
  releasedAt?: string
  voidedById?: string
  voidReason?: string
  voidedAt?: string
  items: OrcItem[]
  auditLog: OrcLogEntry[]
  createdAt: string
  updatedAt: string
}

// ── Deposits ──────────────────────────────────────────────────────────────────
export type DepositStatus = 'active' | 'partially_paid' | 'fully_paid' | 'completed' | 'cancelled'

export interface DepositItem {
  productId: string
  productName: string
  sku: string
  qty: number
  unitPrice: number
  total: number
}

export interface DepositPayment {
  id: string
  date: string
  amount: number
  method: 'cash' | 'mpesa' | 'bank_transfer' | 'card'
  ref?: string
  recordedBy: string
}

export interface Deposit {
  id: string
  ref: string
  customerId: string
  customerName: string
  customerPhone: string
  items: DepositItem[]
  totalValue: number
  totalPaid: number
  balance: number
  status: DepositStatus
  payments: DepositPayment[]
  notes?: string
  createdAt: string
  createdBy: string
  dueDate?: string
  completedAt?: string
  cancelledAt?: string
  cancelReason?: string
}

export type CreateDepositInput = Omit<Deposit, 'id' | 'ref' | 'totalPaid' | 'balance' | 'status' | 'payments' | 'createdAt' | 'createdBy'> & {
  initialPayment?: number
  payMethod?: DepositPayment['method']
  payRef?: string
}

/** Device loan / temporary issue log (Holdovers module). */
export type HoldoverStatus = 'active' | 'returned' | 'overdue'
export type HoldoverPurpose = 'repair_loaner' | 'exam' | 'purchase_pending' | 'short_term' | 'other'
export type HoldoverDeviceCondition = 'excellent' | 'good' | 'fair' | 'damaged'

export interface Holdover {
  id: string
  ref: string
  clientName: string
  clientPhone: string
  clientIdNo: string
  productId: string
  productName: string
  serialId: string
  serialNumber: string
  deviceCondition: HoldoverDeviceCondition
  accessories: string
  purpose: HoldoverPurpose
  purposeNote: string
  linkedRepairId: string
  linkedRepairRef: string
  issuedDate: string
  expectedReturnDate: string
  returnedDate: string
  returnCondition: HoldoverDeviceCondition | ''
  returnNotes: string
  returnLocation: 'shop' | 'warehouse'
  status: HoldoverStatus
  issuedByName: string
  authorizedByUserId: string
  authorizedByName: string
  createdAt: string
}

export interface DeliveryLine {
  productId: string; productName: string; qty: number; qtyDone: number; serialIds: string[]; sourceLocation?: LocationId
}

export interface Delivery {
  id: string; ref: string
  saleOrderId: string; saleOrderRef: string
  customerId: string; customerName: string
  // Odoo-style stock states. 'waiting' = stock not fully reservable yet.
  status: 'draft' | 'waiting' | 'ready' | 'done' | 'cancelled'
  date: string; lines: DeliveryLine[]
  warrantyCreated: boolean
  /** Set when this delivery is the backorder of a partially validated one. */
  backorderOfId?: string
  backorderOfRef?: string
  // Recipient info — saved when DN is printed/signed
  recipientName?: string
  recipientPhone?: string
  recipientIdNumber?: string
  deliveryAddress?: string
  notes?: string
  /** Inventory allocation completed; delivery can now be validated. */
  preparedAt?: string
  preparedByUserId?: string
  /** Final delivery note popup/document was generated successfully. */
  deliveryNoteGeneratedAt?: string
  deliveryNoteGeneratedByUserId?: string
}

// ── Rider Delivery ────────────────────────────────────────────────────────────
export type DeliveryJobType =
  | 'repair_pickup'    // collect device from customer for repair
  | 'repair_dropoff'   // return repaired device to customer
  | 'sales_delivery'   // deliver items from a confirmed sale order
  | 'general'          // ad-hoc rider trip with no SO / repair / invoice link

export type DeliveryJobStatus =
  | 'pending'     // created, not yet assigned to a rider
  | 'assigned'    // rider assigned
  | 'in_transit'  // rider picked up and is on the way
  | 'delivered'   // completed successfully
  | 'failed'      // delivery attempt failed
  | 'cancelled'

export interface Rider {
  id: string
  name: string
  phone: string
  idNumber: string
  vehicle: 'motorcycle' | 'bicycle' | 'car' | 'foot'
  vehicleReg?: string
  active: boolean
  ratePerDelivery: number   // KES paid per completed delivery
  createdAt: string
}

export interface DeliveryJob {
  id: string
  ref: string
  type: DeliveryJobType
  status: DeliveryJobStatus
  // Source link (one of these)
  saleOrderId?: string
  saleOrderRef?: string
  repairOrderId?: string
  repairOrderRef?: string
  /** Customer invoice that scheduled this rider delivery. */
  invoiceId?: string
  invoiceRef?: string
  // Customer details
  customerName: string
  customerPhone: string
  // Addresses
  pickupAddress: string
  deliveryAddress: string
  // Rider
  riderId?: string
  riderName?: string
  assignedAt?: string
  // Schedule & completion
  scheduledDate: string
  pickedUpAt?: string
  deliveredAt?: string
  // Billing
  billedTo?: 'customer' | 'company'
  /** Amount charged to the customer for delivery (may differ from riderFee). */
  deliveryFee?: number
  riderFee: number       // amount paid to rider for this job
  // Metadata
  notes: string
  failureReason?: string
  createdByUserId: string
  createdByName: string
  createdAt: string
}

export interface RiderWeeklyPay {
  id: string
  ref: string
  riderId: string
  riderName: string
  weekStart: string   // YYYY-MM-DD (Monday)
  weekEnd: string     // YYYY-MM-DD (Sunday)
  jobIds: string[]
  deliveryCount: number
  ratePerDelivery: number
  totalAmount: number
  status: 'pending' | 'paid'
  paidDate?: string
  paidByUserId?: string
  paidByName?: string
  invoiceId?: string   // accounting vendor_bill created on confirmation
  invoiceRef?: string
  notes: string
  createdAt: string
}

// Enhanced Purchase Order Line with serial tracking
export interface POLine {
  id: string; productId: string; productName: string
  qty: number; qtyReceived: number; qtyBilled?: number; unitPrice: number; taxRate: number; subtotal: number
  requiresSerial: boolean
  importedSerials?: string[]   // serials pre-loaded from CSV import (auto-fills GRN)
  specs?: string               // product specs from import (e.g. "Intel i5, 8GB RAM, 512GB SSD")
  accountCode?: string         // cost account code (e.g. '6101')
}

export type POStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'received' | 'cancelled'

export interface PurchaseOrder {
  id: string; ref: string; status: POStatus
  vendorId: string; vendorName: string
  date: string; expectedDate: string
  lines: POLine[]; subtotal: number; taxTotal: number; total: number
  billId?: string; notes: string; receiptIds: string[]
  lockVersion?: number
  approvalStatus?: 'not_required' | 'pending' | 'approved' | 'rejected'
  approvalRequestIds?: string[]
  // Repair procurement link — set when auto-created from a repair procurement request
  repairId?: string; repairRef?: string; procurementRequestId?: string
}

// Receipt (Goods Receipt Note) — created when PO is received
export interface Receipt {
  id: string; ref: string; poId: string; poRef: string
  vendorId: string; vendorName: string
  status: 'draft' | 'validated'
  date: string
  lines: {
    productId: string; productName: string
    qtyExpected: number; qtyReceived: number
    serials: string[]       // serial numbers entered/confirmed during receipt
    requiresSerial: boolean
    importedSerials?: string[]  // pre-loaded from CSV/PO import — shown as pre-filled in GRN
    specs?: string              // specs from import — shown in GRN for reference
  }[]
  destinationLocation: LocationId
  billId?: string
}

// Stock Transfer between internal locations
export interface StockTransfer {
  id: string; ref: string
  fromLocation: LocationId; toLocation: LocationId
  status: 'draft' | 'done'
  date: string
  lines: {
    productId: string; productName: string
    qty: number; serialIds: string[]
  }[]
  notes: string
}

// Purchase Return
export interface PurchaseReturn {
  id: string; ref: string
  poId: string; poRef: string; receiptId: string; receiptRef: string
  vendorId: string; vendorName: string
  status: 'draft' | 'confirmed'
  date: string
  reason: 'damaged' | 'wrong_supply' | 'excess' | 'other'
  lines: {
    productId: string; productName: string
    qty: number; serialIds: string[]
    requiresSerial: boolean
  }[]
  creditNoteId?: string
  // Pickup / dispatch tracking
  collectedByUserId?: string
  collectedByName?: string
  collectedDate?: string
  pickupNotes?: string
}

// Comprehensive Repair Status Flow
export type RepairStatus =
  | 'pending_verification' // Customer/self-service intake awaiting admin verification
  | 'received'           // Admin verified, ready for assignment
  | 'assigned'           // Technician assigned
  | 'diagnosed'          // Diagnosis complete, findings logged
  | 'awaiting_approval'  // Quote sent, waiting for client approval
  | 'approved'           // Client approved, ready to start repair
  | 'awaiting_parts'     // Waiting for parts to arrive
  | 'in_repair'          // Repair in progress
  | 'qc'                 // Quality control/testing
  | 'ready'              // Ready for pickup/delivery
  | 'verified_released'  // ORC gate passed — authoriser confirmed serial, awaiting pickup
  | 'invoiced'           // Invoice generated
  | 'delivered'          // Handed over to customer
  | 'collected'          // ORC/customer handover complete
  | 'closed'             // Job completed and closed
  | 'cancelled'          // Job cancelled
  | 'declined'           // Customer declined the quote
  | 'unrepairable'       // Device cannot be repaired
  | 'returned'           // Device returned to customer without repair
  | 'retained'           // Customer left / donated the device to Deed

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

export type IntakeChannel = 'walk_in' | 'website' | 'whatsapp' | 'call' | 'email' | 'rider_pickup'

export type RepairDiagnosisRevisionType = 'initial' | 'update' | 'correction'

export interface RepairDiagnosis {
  id?: string
  revision?: number
  revisionType?: RepairDiagnosisRevisionType
  revisionReason?: string
  findings: string
  faultDescription: string
  recommendedAction: string
  estimatedHours: number
  diagnosedBy: string
  diagnosedDate: string
}

export type RepairQuoteLineDecision = 'approved' | 'declined' | 'deferred'
export type RepairPaymentConfirmationStatus = 'pending_review' | 'auto_paid' | 'confirmed' | 'rejected'

export interface RepairQuoteLine {
  id: string
  type: 'part' | 'labor' | 'logistics' | 'software' | 'license' | 'service'
  description: string
  productId?: string
  productName?: string
  qty: number
  unitPrice: number
  subtotal: number
  reserved: boolean
  decision?: RepairQuoteLineDecision
  /** Locked Diagnosis First fee line — not removable; 0% VAT. */
  isDiagnosisFee?: boolean
}

export interface RepairQuote {
  id: string
  lines: RepairQuoteLine[]
  subtotal: number
  tax: number
  total: number
  validUntil: string
  sentDate: string
  approvedDate?: string
  approvedBy?: string
  rejectedDate?: string
  rejectionReason?: string
  partiallyApproved?: boolean
  approvedTotal?: number
  // Populated on revisions — human-readable line-by-line diff vs previous quote
  changeSummary?: string
  prevTotal?: number
  diagnosisRevision?: number
  diagnosisFaultSummary?: string
}

export interface RepairQAItem {
  id: string
  description: string
  passed: boolean
  testedBy?: string
  testedDate?: string
  notes?: string
}

export interface RepairOrder {
  id: string
  ref: string
  status: RepairStatus
  
  // Customer & Device
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  // Contact person (for company repairs)
  contactPersonId?: string
  contactPersonName?: string
  contactPersonPhone?: string
  contactPersonEmail?: string
  contactPersonTitle?: string
  productId: string
  productName: string
  serialNumber: string
  serialId?: string
  deviceCondition?: 'good' | 'fair' | 'poor' | 'damaged'
  clientLaptopPassword?: string
  deviceColor?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'

  // Intake
  intakeChannel: IntakeChannel
  intakeDate: string
  intakeNotes: string
  issueDescription: string
  accessories: { name: string; received: boolean; notes?: string }[]
  preRepairPhotos?: string[]
  verificationDate?: string
  verifiedBy?: string
  verificationNotes?: string

  // Repair path
  repairPath?: 'diagnosis_first' | 'direct_repair'   // whether to diagnose before repairing
  liabilityWaiverAccepted?: boolean                   // required for direct_repair self-service intake
  liabilityWaiverText?: string
  liabilityWaiverAcceptedAt?: string
  liabilityWaiverSignature?: string
  /** Staff-picked at intake (informational). Fee amount is flat — not tiered. */
  deviceTier?: 'regular' | 'high_end'
  deviceType?: string
  deviceBrand?: string
  deviceModel?: string
  diagnosisFee?: number                               // resolved Diagnosis First fee (KES)
  diagnosisFeeStatus?: 'pending' | 'applicable' | 'paid' | 'waived' | 'invoiced' | 'not_applicable'
  /** Walk-in or corporate — fee normally on final invoice. Optional early pay recorded as paid. */
  diagnosisFeeBilling?: 'upfront' | 'invoice'
  customerBillingType?: 'walk_in' | 'corporate'
  diagnosisFeePaidAt?: string
  diagnosisFeePaidBy?: string
  diagnosisFeePaidMethod?: string
  diagnosisFeeWaivedBy?: string
  diagnosisFeeWaivedReason?: string
  diagnosisStopped?: boolean                          // true if repair closed at diagnosis stage (fee-only)
  
  // Warranty
  warrantyId?: string
  underWarranty: boolean
  warrantyCoverage?: 'full' | 'partial' | 'void'
  warrantyClaimId?: string
  warrantyVerificationStatus?: 'not_checked' | 'verified' | 'pending_manual_review' | 'excluded_client_damage'
  serialWarrantyException?: boolean
  serialWarrantyExceptionReason?: 'device_cannot_power_on' | 'label_unreadable' | 'sticker_missing' | 'customer_unable_to_confirm' | 'other'
  serialWarrantyExceptionNotes?: string
  clientCausedDamage?: boolean
  clientDamageReason?: string

  /**
   * Company mistake / goodwill — skip customer quote approval and invoicing.
   * Distinct from warranty (customer entitlement). Manager-only; audited.
   */
  billingExempt?: boolean
  billingExemptReason?: 'company_mistake' | 'goodwill' | 'other'
  billingExemptNotes?: string
  billingExemptBy?: string
  billingExemptAt?: string
  
  // Assignment
  assignedTechnicianId?: string
  assignedTechnicianName?: string
  assignedDate?: string
  
  // Diagnosis
  diagnosis?: RepairDiagnosis
  diagnosisHistory?: RepairDiagnosis[]
  
  // Quotation
  quote?: RepairQuote
  quoteApprovalDeadline?: string

  // Parts procurement requests
  procurementRequests?: {
    id: string
    repairId?: string
    repairRef?: string
    requestedBy: string
    requestedByName: string
    requestedDate: string
    urgency: string
    status: 'pending' | 'ordered' | 'received' | 'cancelled'
    notes: string
    items: { type: string; productId: string; productName: string; description: string; qty: string; estimatedCost: string; supplier: string }[]
  }[]
  
  // Repair Execution
  repairStartDate?: string
  repairCompletedDate?: string
  partsUsed: {
    productId: string
    productName: string
    qty: number
    price: number
    serialId?: string
    reservedDate?: string
    usedDate?: string
  }[]
  laborCost: number
  logisticsCost: number
  total: number
  
  // QA
  qcItems: RepairQAItem[]
  qcPassedDate?: string
  qcApprovedBy?: string
  /** Required when QC fails — shown to tech + status history. */
  qcFailReason?: string
  qcFailedDate?: string
  qcFailedBy?: string
  /** Set when customer leaves the device with Deed (terminal retained). */
  retainedDate?: string
  retainedBy?: string
  retainedBuyBackId?: string
  retainedBuyBackRef?: string
  retainedDonationId?: string
  retainedDonationRef?: string
  qcReportData?: string      // base64 PDF data URL
  qcReportName?: string
  qcReportUrl?: string       // lightweight server download URL for QC reports
  qcReportId?: string
  qcReportSize?: number
  qcReportType?: string
  qcReportUploadedAt?: string

  // Reports
  diagnosisReportData?: string   // legacy inline base64 PDF data URL
  diagnosisReportName?: string
  diagnosisReportUrl?: string    // lightweight server download URL for diagnosis reports
  
  // Billing
  invoiceId?: string
  invoiceDate?: string
  // Sales quote / SO / Invoice links (set when repair quote is promoted to sales quote)
  salesQuoteId?: string
  salesQuoteRef?: string
  saleOrderId?: string
  saleOrderRef?: string

  // Portal payment confirmation (customer-submitted M-PESA proof)
  paymentConfirmationText?: string
  paymentConfirmationImageUrl?: string
  paymentConfirmationStatus?: RepairPaymentConfirmationStatus
  paymentConfirmationSubmittedAt?: string
  paymentReceiptNumber?: string
  paymentConfirmationAmount?: number
  paymentConfirmationReviewedAt?: string
  paymentConfirmationReviewedBy?: string
  paymentConfirmationNotes?: string

  // Delivery
  deliveryMethod?: 'pickup' | 'delivery' | 'courier'
  deliveryScheduledDate?: string
  deliveryActualDate?: string
  deliveryAddress?: string
  deliveryRecipient?: string
  deliveryRecipientPhone?: string
  deliveryRecipientIsRep?: boolean
  deliveryRecipientRelationship?: string
  deliveryRecipientIdNumber?: string
  deliveryNotes?: string
  deliveryRiderId?: string
  deliveryRiderName?: string
  deliveryJobId?: string
  
  // Metadata
  createdBy: string
  bookedByName: string        // Display name of the staff who created the intake
  createdDate: string
  closedDate?: string
  notes: string
  
  // SLA
  slaDeadline?: string
  slaMissed: boolean
  estimatedCompletionDate?: string
  
  // Status timeline — one entry per key status transition
  statusHistory?: { status: string; date: string; note?: string; by?: string }[]

  // Legacy/backward compatibility
  date: string
  description: string
  technicianName: string
  intakeSource?: 'customer' | 'employee_asset_return'
  linkedEmployeeId?: string
}

export interface Warranty {
  id: string; ref: string
  customerId: string; customerName: string
  productId: string; productName: string; serialId: string; serialNumber: string
  deliveryId: string; saleOrderRef: string
  startDate: string; endDate: string
  status: 'active' | 'expiring' | 'expired'
  months: number
}

// ── Kilimall ──────────────────────────────────────────────────────────────────
export type KilimallOrderStatus = 'pending' | 'dispatched' | 'delivered' | 'returned' | 'cancelled'

export interface KilimallOrder {
  id: string; ref: string
  kilimallRef: string        // external Kilimall order ID
  orderDate: string
  customerName?: string
  /** Product the Kilimall customer ordered (catalog listing). */
  productId: string; productName: string
  qty: number; unitPrice: number; total: number
  status: KilimallOrderStatus
  serialId?: string; serialNumber?: string
  /** Product actually shipped when different from the ordered product. */
  fulfilledProductId?: string
  fulfilledProductName?: string
  substitutionReason?: string
  dispatchId?: string
  settlementId?: string
  settlementRef?: string
  rmaId?: string
  notes?: string
  createdDate: string; createdBy: string
}

export interface KilimallDispatch {
  id: string; ref: string
  date: string
  orderId: string; orderRef: string; kilimallRef: string
  /** Product actually shipped (serial belongs to this product). */
  productId: string; productName: string
  /** Ordered product when a substitution was made. */
  orderedProductId?: string
  orderedProductName?: string
  isSubstitution?: boolean
  serialId: string; serialNumber: string
  status: 'dispatched' | 'delivered' | 'failed'
  notes?: string
  createdBy: string; createdDate: string
}

export interface KilimallSettlementLine {
  id: string
  kilimallRef: string
  amount: number
  status: 'matched' | 'unmatched' | 'returned' | 'mismatch'
  orderId?: string
  erpAmount?: number
  notes?: string
}

export interface KilimallSettlement {
  id: string; ref: string
  weekPeriod: string         // e.g. "1–7 Apr 2026"
  weekStart: string; weekEnd: string
  totalOrders: number
  grossAmount: number
  deductions: number
  netPaid: number
  paymentDate?: string
  paymentRef?: string
  paymentMethod?: 'bank' | 'mpesa'
  status: 'draft' | 'posted' | 'reconciled'
  lines: KilimallSettlementLine[]
  createdDate: string; createdBy: string
}

export type RMAStatus = 'requested' | 'approved' | 'received' | 'processed' | 'rejected'
export type RMAResolution = 'refund' | 'replacement' | 'repair' | 'credit_note'

export interface ReturnOrderLine {
  id: string
  productId: string; productName: string
  qty: number; serialIds: string[]
  condition: 'good' | 'damaged' | 'defective'
  reason: string
}

export interface ReturnOrder {
  id: string; ref: string
  saleOrderId: string; saleOrderRef: string
  customerId: string; customerName: string
  status: RMAStatus
  requestDate: string; reason: string
  lines: ReturnOrderLine[]
  resolution?: RMAResolution
  refundAmount?: number
  repairId?: string; notes?: string
  approvedByName?: string; approvedDate?: string
  receivedDate?: string
  processedDate?: string; processedByName?: string
}

// ── Buy-Back (customer sells machine back to us) ──────────────────────────────
export type BuyBackStatus = 'draft' | 'approved' | 'paid' | 'stocked'

export interface BuyBackLine {
  id: string
  productId: string; productName: string
  qty: number; serialIds: string[]
  condition: 'good' | 'fair' | 'poor'
  unitPrice: number  // amount we pay per unit
  notes?: string
}

export interface BuyBack {
  id: string; ref: string
  customerId: string; customerName: string
  originalSOId?: string; originalSORef?: string
  /** When created from a retained repair (customer left device with Deed). */
  repairId?: string
  repairRef?: string
  status: BuyBackStatus
  date: string
  lines: BuyBackLine[]
  total: number
  paymentMethod?: 'cash' | 'bank_transfer' | 'mpesa'
  destinationLocation: LocationId
  notes?: string
  approvedByName?: string; approvedDate?: string
  paidDate?: string
  stockedDate?: string; stockedByName?: string
}

// ── Donation ──────────────────────────────────────────────────────────────────
export type DonationType = 'in' | 'out'

export interface DonationLine {
  id: string
  productId: string; productName: string
  qty: number; serialIds: string[]
  notes?: string
}

export interface Donation {
  id: string; ref: string
  type: DonationType
  party: string          // donor name (in) or recipient name (out)
  date: string
  lines: DonationLine[]
  status: 'draft' | 'confirmed'
  location: LocationId   // destination for 'in', source for 'out'
  notes?: string
  /** When created from a retained repair (customer left device with Deed). */
  repairId?: string
  repairRef?: string
  confirmedByName?: string; confirmedDate?: string
}

// ── Client Exchange ────────────────────────────────────────────────────────────
export type ExchangeStatus = 'draft' | 'approved' | 'completed' | 'cancelled'

export interface ExchangeLine {
  id: string
  productId: string; productName: string
  qty: number; serialIds: string[]
  unitPrice: number
}

export interface ClientExchange {
  id: string; ref: string
  customerId: string; customerName: string
  originalSOId?: string; originalSORef?: string
  status: ExchangeStatus
  date: string
  returnLines: ExchangeLine[]   // items customer brings back
  newLines: ExchangeLine[]      // items we give them
  returnTotal: number
  newTotal: number
  priceDiff: number             // newTotal - returnTotal (positive = customer owes us)
  notes?: string
  approvedByName?: string; approvedDate?: string
  completedDate?: string; completedByName?: string
}

export interface POSOrder {
  id: string; ref: string; sessionId: string
  lines: {
    productId: string; productName: string; barcode: string
    qty: number; price: number; subtotal: number; serialId?: string; serialNumber?: string
  }[]
  subtotal: number; taxTotal: number; total: number
  payment: 'cash' | 'mpesa' | 'card'
  customerId?: string; customerName?: string; date: string
  createdByUserId?: string; createdByName?: string
  pointsEarned?: number
  pointsRedeemed?: number
  createdAt?: string
}

export interface POSSession {
  id: string
  ref: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt?: string
  openingCash: number
  closingCash?: number
  expectedCash?: number
  cashDifference?: number
  totalSales: number
  totalCash: number
  totalMpesa: number
  totalCard: number
  orderCount: number
  openedBy?: string
  closedBy?: string
  journalId?: string
}

export interface StockMove {
  id: string; type: 'in' | 'out' | 'transfer' | 'adjustment' | 'return'
  productId: string; productName: string; qty: number; reason: string
  fromLocation?: LocationId; toLocation?: LocationId
  serialNumbers: string[]; date: string; userId: string
  documentRef: string  // PO ref, SO ref, etc.
}

export interface BulkStockLevel {
  productId: string
  location: LocationId
  qty: number
}

export interface Department {
  id: string
  name: string
  managerEmployeeId?: string
  description: string
}

export interface Employee {
  id: string
  employeeNo: string
  fullName: string
  email: string
  phone: string
  nationalId: string
  kraPin: string
  nssfNumber?: string
  gender?: 'male' | 'female' | ''
  departmentId: string
  jobTitle: string
  shift?: string
  managerEmployeeId?: string
  startDate: string
  status: 'active' | 'on_leave' | 'exited'
  userId?: string
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  bankName?: string
  bankAccount: string
}

export type JobStatus = 'open' | 'closed' | 'draft'
export type CandidateStage = 'applied' | 'screening' | 'interview' | 'offered' | 'hired' | 'rejected'

export interface JobPosting {
  id: string; title: string; departmentId: string; location: string; type: 'full_time' | 'part_time' | 'contract'; status: JobStatus; postedDate: string; closingDate?: string; description: string;
}
export interface Candidate {
  id: string; jobId: string; firstName: string; lastName: string; email: string; phone: string; stage: CandidateStage; appliedDate: string; resumeUrl?: string; notes?: string;
}

export type TrainingStatus = 'not_started' | 'in_progress' | 'completed'
export interface TrainingProgram {
  id: string; title: string; description: string; mandatoryForNewHires: boolean; durationDays: number;
}
export interface EmployeeTraining {
  id: string; employeeId: string; trainingId: string; status: TrainingStatus; enrolledDate: string; completedDate?: string; score?: number;
}

export interface Contract {
  id: string
  employeeId: string
  type: 'permanent' | 'fixed_term' | 'consultant'
  startDate: string
  endDate?: string
  grossSalary: number
  benefits: string[]
  signedDate?: string
  status: 'draft' | 'active' | 'expired'
}

export interface LeaveBalance {
  id: string
  employeeId: string
  leaveType: StoreLeaveType
  year: number
  entitlement: number
  used: number
  pending: number
  carryForward: number  // always 0 for annual (use-it-or-lose-it policy)
}

export interface LeaveRequest {
  id: string
  ref: string
  employeeId: string
  employeeName: string
  leaveType: StoreLeaveType
  startDate: string
  endDate: string
  days: number
  reason: string
  status: 'pending_hr' | 'approved' | 'rejected' | 'cancelled'
  submittedDate: string
  hrApprovalBy?: string
  hrDecisionDate?: string
  reviewNotes?: string
  submittedByUserId?: string
  isSystemGenerated?: boolean  // true for december_closure auto-applied by HR
}

export interface HRDocument {
  id: string
  employeeId: string
  type: 'contract' | 'nda' | 'id_copy' | 'certification' | 'work_permit' | 'other'
  title: string
  expiryDate?: string
  visibility: 'hr_only' | 'hr_finance' | 'employee_visible'
  status: 'active' | 'expiring' | 'expired'
  // File upload metadata
  fileName?: string
  fileSize?: number        // bytes
  fileType?: string        // MIME type
  fileDataUrl?: string     // base64 data URL (demo only)
  uploadedByUserId?: string
  uploadedByName?: string
  uploadedDate?: string
  notes?: string
}

export interface CustomerContract {
  id: string
  ref: string
  companyId: string
  companyName: string
  contactPersonId: string
  contactPersonName: string
  type: 'sales' | 'maintenance' | 'support' | 'rental' | 'subscription'
  contractValue: number
  startDate: string
  endDate: string
  renewalDate: string
  noticePeriod: number
  paymentSchedule: 'monthly' | 'quarterly' | 'annual' | 'one-time'
  autoRenewal: boolean
  slaTier?: 'bronze' | 'silver' | 'gold' | 'platinum'
  responseTimeHours?: number
  resolutionTimeHours?: number
  status: 'draft' | 'active' | 'expired' | 'terminated' | 'renewed'
  opportunityId?: string
  quoteId?: string
  saleOrderIds: string[]
  invoiceIds: string[]
  documentUrl?: string
  signedDocumentUrl?: string
  notes?: string
}

export interface WorkflowApproval {
  id: string
  process: 'leave' | 'expense' | 'salary_change' | 'salary_advance' | 'hiring' | 'payroll'
  ref: string
  targetId: string
  targetName: string
  stepName: string
  approverRole: UserRole
  approverUserId?: string
  status: 'pending' | 'approved' | 'rejected'
  requestedBy: string
  requestedDate: string
  decisionDate?: string
}

export interface PayrollLine {
  employeeId: string
  employeeName: string
  basicSalary: number
  allowances: number
  deductions: number
  statutoryDeductions?: number
  salaryAdvanceDeductions?: Array<{ advanceId: string; ref: string; amount: number; remainingAfter: number }>
  netPay: number
}

export interface PayrollRun {
  id: string
  ref: string
  month: string
  year: number
  status: 'draft' | 'pending_approval' | 'approved' | 'posted'
  lines: PayrollLine[]
  totalGross: number
  totalDeductions: number
  totalNet: number
  postedJournalId?: string
}

export interface EmployeeAssetAssignment {
  id: string
  employeeId: string
  employeeName: string
  productId: string
  productName: string
  serialId?: string
  serialNumber?: string
  qty: number
  assignedDate: string
  status: 'assigned' | 'returned' | 'reassigned'
  returnedDate?: string
  returnLocation?: LocationId
  previousAssignmentId?: string
  acknowledgedByEmployee: boolean
  acknowledgmentDate?: string
  handoverCondition: 'new' | 'good' | 'fair' | 'damaged'
  handoverNotes?: string
  returnCondition?: 'good' | 'fair' | 'damaged'
  returnInspectionNotes?: string
}

export interface Payslip {
  id: string
  ref: string
  payrollRunId: string
  employeeId: string
  employeeName: string
  month: string
  year: number
  grossPay: number
  deductions: number
  salaryAdvanceDeductions?: Array<{ advanceId: string; ref: string; amount: number; remainingAfter: number }>
  netPay: number
  status: 'draft' | 'published'
  generatedDate: string
  downloadUrl?: string
}

export interface SalaryAdvance {
  id: string
  ref: string
  employeeId: string
  employeeName: string
  employeeNo?: string
  departmentId?: string
  jobTitle?: string
  amount: number
  paymentTerms: 'payroll_deduction' | 'manual_repayment'
  repaymentMonths: number
  repaymentStartPeriod: string
  monthlyDeduction: number
  amountRecovered: number
  outstandingAmount: number
  deductions: Array<{ payrollRunId: string; payslipId?: string; period: string; amount: number; date: string }>
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'repaid' | 'cancelled'
  requestedDate: string
  neededByDate?: string
  approvedByUserId?: string
  approvedByName?: string
  decisionDate?: string
  decisionNote?: string
  paidDate?: string
  repaymentStartMonth?: string
  createdByUserId?: string
}

export interface JournalEntryLine {
  id: string
  account: string
  description: string
  debit: number
  credit: number
}

export interface JournalEntry {
  id: string
  ref: string
  date: string
  source: 'payroll' | 'refund' | 'invoice' | 'payment' | 'bill' | 'purchase_payment' | 'expense' | 'pos' | 'pos_session' | 'purchase' | 'manual' | 'adjustment'
  description: string
  status: 'posted'
  lines: JournalEntryLine[]
  totalDebit: number
  totalCredit: number
  payrollRunId?: string
  rmaId?: string
  invoiceId?: string
  expenseId?: string
  paymentId?: string
  posOrderId?: string
  purchaseOrderId?: string
  bankAccountId?: string
}

export type RefundPaymentMethod = 'cash' | 'mpesa' | 'bank_transfer'

export interface RefundPayment {
  id: string
  ref: string
  rmaId: string
  rmaRef: string
  customerName: string
  amount: number
  paymentMethod: RefundPaymentMethod
  bankAccountId?: string
  paymentDate: string
  notes?: string
  journalEntryId: string
  createdBy: string
  createdDate: string
}

export type AdjReason = 'damage' | 'theft' | 'count_correction' | 'expiry' | 'other'
export type AdjStatus = 'pending' | 'approved' | 'rejected'

export interface StockAdjustment {
  id: string; ref: string
  productId: string; productName: string
  type: 'add' | 'subtract'
  qty: number; reason: AdjReason; notes: string
  status: AdjStatus
  inventoryAccountCode?: string
  varianceAccountCode?: string
  writeOffAccountCode?: string
  requestedBy: string; approvedBy?: string
  date: string; approvedDate?: string
}

const canApproveInventoryAction = (user: User | null) =>
  !!user && ['director', 'admin_officer', 'inventory_officer', 'technical_lead'].includes(user.role)

/** GRN / purchase receipt validation — narrower than general inventory approvals. */
const canValidatePurchaseReceiptAction = (user: User | null) =>
  !!user && ['director', 'admin_officer', 'inventory_officer'].includes(user.role)

const canManageInventoryControl = (user: User | null) =>
  !!user && ['director', 'inventory_officer', 'technical_lead', 'finance_officer'].includes(user.role)

export const canManageHR = (user: User | null) =>
  !!user && canManageHRRole(user.role)

const canApprovePayroll = (user: User | null) =>
  !!user && ['director', 'finance_officer'].includes(user.role)

const canManageHRAssets = (user: User | null) =>
  !!user && ['director', 'inventory_officer', 'technical_lead'].includes(user.role)

/** Broad money role (includes Admin Officer) — use with threshold helpers for post/pay. */
const canManageFinance = (user: User | null) =>
  !!user && ['director', 'finance_officer', 'admin_officer'].includes(user.role)

/** Bank recon / cancel-reset / expense reimburse — Finance + Director only. */
const canManageFullFinanceAction = (user: User | null) =>
  !!user && ['director', 'finance_officer'].includes(user.role)

/** Draft customer invoice from SO. */
const canCreateCustomerInvoiceFromSOAction = (user: User | null) =>
  !!user && ['director', 'finance_officer', 'admin_officer'].includes(user.role)

const isoDate = (date?: string) => {
  const source = date || now()
  return source.includes('T') ? source : new Date(`${source}T00:00:00`).toISOString()
}

const accountLine = (account: string, description: string, debit = 0, credit = 0): JournalEntryLine => ({
  id: uid(),
  account,
  description,
  debit: Math.round(debit * 100) / 100,
  credit: Math.round(credit * 100) / 100,
})

const bankAccountLabel = (bankAccountId?: string, method?: string) => {
  const id = bankAccountId || (method === 'mpesa' || method === 'mpesa_company' ? 'mpesa' : method === 'cash' || method === 'petty_cash' ? 'cash' : 'ncba')
  if (id === 'mpesa') return '2210 - M-Pesa Paybill'
  if (id === 'cash') return '2211 - Petty Cash'
  if (id === 'equity') return '2202 - Equity Bank'
  if (id === 'kcb') return '2203 - KCB Bank'
  return '2201 - NCBA Bank'
}

const bankAccountIdForMethod = (method?: string, bankAccountId?: string) => {
  if (bankAccountId) return bankAccountId
  if (method === 'mpesa' || method === 'mpesa_company') return 'mpesa'
  if (method === 'cash' || method === 'petty_cash') return 'cash'
  return 'ncba'
}

const expenseAccountForCategory = (category?: ExpenseCategory) => {
  const map: Partial<Record<ExpenseCategory, string>> = {
    courier: '6420 - Courier & Delivery',
    office_supplies: '6405 - Office Supplies',
    water: '6415 - Utilities - Water',
    printing: '6410 - Printing & Stationery',
    transport: '6400 - Transport & Fuel',
    meals: '6430 - Meals & Entertainment',
    utilities: '6415 - Utilities',
    software: '6440 - Software & Subscriptions',
    hardware: '1510 - Equipment & Hardware',
    maintenance: '6450 - Maintenance & Repairs',
    other: '6499 - Other Operating Expenses',
  }
  return map[category ?? 'other'] ?? '6499 - Other Operating Expenses'
}

const buildInvoicePostingJournal = (
  inv: Invoice,
  resolveProduct?: (productId: string) => AccountableProduct | undefined,
  chartAccounts: Array<{ code: string; name: string }> = [],
): JournalEntry => {
  if (inv.type === 'customer_invoice') {
    const revenueBuckets = aggregateLinesByAccount({
      lines: inv.lines.map(l => ({
        productId: l.productId,
        subtotal: l.subtotal,
        accountCode: l.accountCode,
        lineType: l.lineType,
      })),
      resolveProduct,
      side: 'revenue',
      accounts: chartAccounts,
    })
    const revenueLines = revenueBuckets.length
      ? revenueBuckets.map(b => accountLine(b.account, `Revenue: ${inv.ref}`, 0, b.amount))
      : [accountLine(formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, chartAccounts), `Revenue: ${inv.ref}`, 0, inv.subtotal)]
    const lines = [
      accountLine('1800 - Accounts Receivable', `AR: ${inv.partnerName}`, inv.total, 0),
      ...revenueLines,
      ...(inv.taxTotal > 0 ? [accountLine('3301 - Output VAT Payable', `VAT on ${inv.ref}`, 0, inv.taxTotal)] : []),
    ]
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
    return { id: uid(), ref: `JRN/${inv.ref}`, date: now(), source: 'invoice', description: `Invoice ${inv.ref} — ${inv.partnerName}`, status: 'posted', invoiceId: inv.id, lines, totalDebit, totalCredit }
  }

  const purchaseBuckets = aggregateLinesByAccount({
    lines: inv.lines.map(l => ({
      productId: l.productId,
      subtotal: l.subtotal,
      accountCode: l.accountCode,
      lineType: l.lineType,
    })),
    resolveProduct,
    side: 'purchase',
    accounts: chartAccounts,
  })
  const purchaseLines = purchaseBuckets.length
    ? purchaseBuckets.map(b => accountLine(b.account, `Purchase: ${inv.partnerName}`, b.amount, 0))
    : [accountLine(formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.costAccountCode, chartAccounts), `Purchase: ${inv.partnerName}`, inv.subtotal, 0)]
  const lines = [
    ...purchaseLines,
    ...(inv.taxTotal > 0 ? [accountLine('1150 - VAT Input', `VAT input on ${inv.ref}`, inv.taxTotal, 0)] : []),
    accountLine('3000 - Accounts Payable', `AP: ${inv.partnerName}`, 0, inv.total),
  ]
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
  return { id: uid(), ref: `JRN/${inv.ref}`, date: now(), source: 'bill', description: `Bill ${inv.ref} — ${inv.partnerName}`, status: 'posted', invoiceId: inv.id, lines, totalDebit, totalCredit }
}

const buildInvoicePaymentJournal = (
  inv: Invoice,
  amount: number,
  method?: string,
  bankAccountId?: string,
  paymentDate?: string,
  paymentId?: string,
): JournalEntry => {
  const actualBankId = bankAccountIdForMethod(method, bankAccountId)
  const bankAccount = bankAccountLabel(actualBankId, method)
  const isVendorPayment = inv.type === 'vendor_bill'
  const lines = isVendorPayment
    ? [
        accountLine('3000 - Accounts Payable', `AP settlement: ${inv.partnerName}`, amount, 0),
        accountLine(bankAccount, `Payment out: ${inv.ref}`, 0, amount),
      ]
    : [
        accountLine(bankAccount, `Received from ${inv.partnerName}`, amount, 0),
        accountLine('1800 - Accounts Receivable', `AR settlement: ${inv.ref}`, 0, amount),
      ]
  return {
    id: uid(),
    ref: paymentId ? paymentJournalRef(inv.ref, paymentId) : `JRN/PAY/${inv.ref}/${uid()}`,
    date: isoDate(paymentDate),
    source: isVendorPayment ? 'purchase_payment' : 'payment',
    description: `Payment for ${inv.ref} — ${inv.partnerName}`,
    status: 'posted',
    invoiceId: inv.id,
    bankAccountId: actualBankId,
    lines,
    totalDebit: amount,
    totalCredit: amount,
  }
}

const buildDepositPaymentJournal = (deposit: Pick<Deposit, 'id' | 'ref' | 'customerName'>, payment: DepositPayment): JournalEntry => {
  const bankAccountId = bankAccountIdForMethod(payment.method)
  const bankAccount = bankAccountLabel(bankAccountId, payment.method)
  const lines = [
    accountLine(bankAccount, `Deposit receipt: ${deposit.ref}`, payment.amount, 0),
    accountLine('3100 - Customer Deposits', `Customer deposit liability: ${deposit.customerName}`, 0, payment.amount),
  ]
  return {
    id: uid(),
    ref: `JRN/DEP/${deposit.ref}/${payment.id.slice(0, 8)}`,
    date: isoDate(payment.date),
    source: 'manual',
    description: `Deposit payment — ${deposit.ref}`,
    status: 'posted',
    bankAccountId,
    depositId: deposit.id,
    lines,
    totalDebit: payment.amount,
    totalCredit: payment.amount,
  } as JournalEntry & { depositId: string }
}

const buildExpenseApprovalJournal = (expense: Expense): JournalEntry => {
  const isReimbursement = expense.paymentMethod === 'reimbursement'
  const liabilityOrBank = isReimbursement
    ? '3105 - Employee Reimbursements Payable'
    : bankAccountLabel(bankAccountIdForMethod(expense.paymentMethod), expense.paymentMethod)
  const lines = [
    accountLine(expenseAccountForCategory(expense.category), `${expense.ref}: ${expense.description}`, expense.amount, 0),
    accountLine(liabilityOrBank, isReimbursement ? `Reimbursement payable: ${expense.submittedByName}` : `Company-paid expense: ${expense.ref}`, 0, expense.amount),
  ]
  return { id: uid(), ref: `JRN/EXP/${expense.ref}`, date: isoDate(expense.expenseDate), source: 'expense', description: `Expense approval — ${expense.ref}`, status: 'posted', expenseId: expense.id, bankAccountId: isReimbursement ? undefined : bankAccountIdForMethod(expense.paymentMethod), lines, totalDebit: expense.amount, totalCredit: expense.amount }
}

const buildExpenseReimbursementJournal = (expense: Expense, bankAccountId?: string): JournalEntry => {
  const actualBankId = bankAccountIdForMethod('bank_transfer', bankAccountId)
  const lines = [
    accountLine('3105 - Employee Reimbursements Payable', `Settle reimbursement: ${expense.submittedByName}`, expense.amount, 0),
    accountLine(bankAccountLabel(actualBankId), `Cash paid for ${expense.ref}`, 0, expense.amount),
  ]
  return { id: uid(), ref: `JRN/RIM/${expense.ref}`, date: now(), source: 'expense', description: `Expense reimbursement — ${expense.ref}`, status: 'posted', expenseId: expense.id, bankAccountId: actualBankId, lines, totalDebit: expense.amount, totalCredit: expense.amount }
}

const buildReversalJournal = (original: JournalEntry, documentRef: string, reason = 'Document cancelled'): JournalEntry => {
  const lines = original.lines.map(line => accountLine(line.account, `Reversal of ${original.ref}: ${line.description}`, line.credit, line.debit))
  return {
    ...original,
    id: uid(),
    ref: `REV/${original.ref}`,
    date: now(),
    source: 'manual',
    description: `${reason} — reversal of ${original.description} (${documentRef})`,
    lines,
    totalDebit: original.totalCredit,
    totalCredit: original.totalDebit,
  }
}

const buildCustomerCreditJournal = (inv: Invoice, creditRef: string, amount: number): JournalEntry => {
  const subtotalRatio = inv.total > 0 ? inv.subtotal / inv.total : 1
  const taxRatio = inv.total > 0 ? inv.taxTotal / inv.total : 0
  const revenueReversal = Math.round(amount * subtotalRatio * 100) / 100
  const vatReversal = Math.round(amount * taxRatio * 100) / 100
  const lines = [
    accountLine('5000 - Sales Revenue', `Credit note ${creditRef}: reverse ${inv.ref}`, revenueReversal, 0),
    ...(vatReversal > 0 ? [accountLine('3301 - Output VAT Payable', `Credit VAT ${creditRef}`, vatReversal, 0)] : []),
    accountLine('3100 - Customer Credits', `Customer credit: ${inv.partnerName}`, 0, amount),
  ]
  return {
    id: uid(),
    ref: `JRN/${creditRef}`,
    date: now(),
    source: 'manual',
    description: `Credit note ${creditRef} for cancelled paid invoice ${inv.ref}`,
    status: 'posted',
    invoiceId: inv.id,
    lines,
    totalDebit: amount,
    totalCredit: amount,
  }
}

const buildCustomerCreditApplicationJournal = (inv: Invoice, amount: number, creditRefs: string): JournalEntry => {
  const lines = [
    accountLine('3100 - Customer Credits', `Apply credit ${creditRefs}`, amount, 0),
    accountLine('1800 - Accounts Receivable', `Credit applied to ${inv.ref}`, 0, amount),
  ]
  return {
    id: uid(),
    ref: `JRN/CAPP/${inv.ref}/${Date.now()}`,
    date: now(),
    source: 'payment',
    description: `Customer credit applied to ${inv.ref}`,
    status: 'posted',
    invoiceId: inv.id,
    lines,
    totalDebit: amount,
    totalCredit: amount,
  }
}

const canManageProcurement = (user: User | null) =>
  !!user && ['director', 'admin_officer', 'inventory_officer'].includes(normalizeClientRole(user.role))

// ── Outsource Repair ────────────────────────────────────────────────────────
export const OUTSOURCE_SERVICE_TYPES = [
  { value: 'bios_repair',         label: 'BIOS Repair' },
  { value: 'power_repair',        label: 'Power Repair' },
  { value: 'body_works',          label: 'Body Works' },
  { value: 'laptop_skin',         label: 'Laptop Skin' },
  { value: 'screen_replacement',  label: 'Screen Replacement' },
  { value: 'keyboard_repair',     label: 'Keyboard Repair' },
  { value: 'motherboard_repair',  label: 'Motherboard Repair' },
  { value: 'data_recovery',       label: 'Data Recovery' },
  { value: 'charging_port',       label: 'Charging Port Repair' },
  { value: 'other',               label: 'Other' },
] as const

export type OutsourceServiceType = typeof OUTSOURCE_SERVICE_TYPES[number]['value']

export interface OutsourceVendor {
  id: string
  name: string
  phone: string
  email?: string
  address?: string
  specializations: OutsourceServiceType[]
  notes?: string
  createdAt: string
}

export type OutsourceJobStatus = 'sent' | 'returned_resolved' | 'returned_unresolved'

export interface OutsourceJob {
  id: string
  ref: string
  vendorId: string
  vendorName: string
  deviceDescription: string   // e.g. "Dell Latitude 7490 – SN 4XZ7K"
  serial?: string
  repairOrderId?: string      // optional link to a repair order
  previousRepairStatus?: RepairStatus
  serviceType: OutsourceServiceType
  issueDescription: string
  sentDate: string
  sentByUserId: string
  sentByName: string
  returnedDate?: string
  isResolved?: boolean
  returnNotes?: string
  quotedCost?: number
  finalCost?: number
  billId?: string
  status: OutsourceJobStatus
  notes?: string
  createdAt: string
}

export interface OutsourcePayment {
  id: string
  ref: string
  vendorId: string
  vendorName: string
  amount: number
  date: string
  method?: string
  bankAccountId?: string
  reference?: string
  notes?: string
  paidByUserId: string
  paidByName: string
  createdAt: string
}

// ── Expenses ─────────────────────────────────────────────────────────────────
export const EXPENSE_CATEGORIES = [
  { value: 'courier',         label: 'Courier / Delivery' },
  { value: 'office_supplies', label: 'Office Supplies' },
  { value: 'water',           label: 'Drinking Water' },
  { value: 'printing',        label: 'Printing & Stationery' },
  { value: 'transport',       label: 'Transport / Fuel' },
  { value: 'meals',           label: 'Meals & Entertainment' },
  { value: 'utilities',       label: 'Utilities' },
  { value: 'software',        label: 'Software / Subscriptions' },
  { value: 'hardware',        label: 'Equipment / Hardware' },
  { value: 'maintenance',     label: 'Maintenance & Repairs' },
  { value: 'other',           label: 'Other' },
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]['value']
export type ExpensePaymentMethod = 'reimbursement' | 'petty_cash' | 'mpesa_company' | 'company_card'
export type ExpenseStatus = 'submitted' | 'approved' | 'rejected' | 'reimbursed'

export type ExpenseApprovalStep = {
  role: string
  status: 'pending' | 'approved' | 'rejected'
  by?: string
  at?: string
}

export interface Expense {
  id: string
  ref: string                       // EXP/0001
  submittedByUserId: string
  submittedByName: string
  expenseDate: string               // actual date of purchase
  submittedDate: string
  category: ExpenseCategory
  description: string
  amount: number
  paymentMethod: ExpensePaymentMethod
  status: ExpenseStatus
  approvalChain?: ExpenseApprovalStep[]
  // Receipt proof
  receiptFileName?: string
  receiptFileType?: string
  receiptFileSize?: number
  receiptDataUrl?: string           // base64 — image or PDF
  // Review
  reviewedByUserId?: string
  reviewedByName?: string
  reviewedDate?: string
  reviewNotes?: string
  // Structured reimbursement metadata, kept separate from review notes
  reimbursementMethod?: string
  reimbursementBankAccount?: string
  reimbursementReference?: string
  notes?: string
  createdAt: string
}

// ── SOP Documents ───────────────────────────────────────────────────────────
export interface SOPDocStep {
  id: string
  order: number
  instruction: string
  note?: string
}

export interface SOPDocument {
  id: string
  title: string
  category: string
  department: string           // department grouping e.g. 'repairs', 'sales', 'hr'
  purpose: string
  scope: string
  steps: SOPDocStep[]
  tags: string[]
  version: string
  status: 'draft' | 'active' | 'archived'
  reviewDate?: string
  // File attachment (stored separately via /api/sop-files/[sopId])
  fileName?: string            // original file name e.g. 'Repair-Intake-SOP-v1.pdf'
  fileType?: string            // MIME type e.g. 'application/pdf'
  fileSize?: number            // bytes — used for display only
  createdByName: string
  createdAt: string
  updatedAt: string
}

// ── SOPs / Performance Targets ───────────────────────────────────────────────
export const SOP_METRIC_TYPES = [
  { value: 'repairs_completed',  label: 'Repairs Completed',     unit: 'repairs', auto: true,  hint: 'Closed/delivered repairs assigned to this user in the period' },
  { value: 'repairs_diagnosed',  label: 'Repairs Diagnosed',     unit: 'repairs', auto: true,  hint: 'Repairs where diagnosis was logged by this user in the period' },
  { value: 'repairs_received',   label: 'Repairs Received',      unit: 'repairs', auto: true,  hint: 'New repair orders received in the period' },
  { value: 'outsource_sent',     label: 'Outsource Jobs Sent',   unit: 'jobs',    auto: true,  hint: 'Outsource jobs dispatched by this user in the period' },
  { value: 'sales_orders',       label: 'Sales Orders Closed',   unit: 'orders',  auto: true,  hint: 'Confirmed/delivered/invoiced orders created by this user in the period' },
  { value: 'sales_revenue',      label: 'Sales Revenue (KSh)',   unit: 'KSh',     auto: true,  hint: 'Total revenue from orders created by this user in the period' },
  { value: 'quotes_created',     label: 'Quotes Created',        unit: 'quotes',  auto: true,  hint: 'New quotations created by this user in the period' },
  { value: 'expenses_amount',    label: 'Expense Budget (KSh)',  unit: 'KSh',     auto: true,  hint: 'Total expense amount submitted by this user — should stay within target' },
  { value: 'expenses_count',     label: 'Expense Claims Filed',  unit: 'claims',  auto: true,  hint: 'Number of expense claims submitted in the period' },
  { value: 'leave_days',         label: 'Leave Days Taken',      unit: 'days',    auto: true,  hint: 'Approved leave days taken in the period' },
  { value: 'custom',             label: 'Custom / Manual',       unit: '',        auto: false, hint: 'Manually tracked metric — user or admin updates the actual value' },
] as const

export type SOPMetricType = typeof SOP_METRIC_TYPES[number]['value']

export type SOPTargetDir = 'min' | 'max'
// 'min' = actual must reach or exceed target (e.g. 200 sales)
// 'max' = actual must not exceed target (e.g. expenses ≤ budget)

export interface SOPMetric {
  id: string
  label: string
  metricType: SOPMetricType
  target: number
  unit: string
  targetDir: SOPTargetDir
}

export interface SOP {
  id: string
  userId: string
  userName: string
  period: 'monthly' | 'weekly' | 'quarterly'
  metrics: SOPMetric[]
  active: boolean
  notes?: string
  createdByUserId: string
  createdByName: string
  createdAt: string
}

// Manually entered actual values for custom (non-auto) metrics
export interface SOPActual {
  id: string
  sopId: string
  metricId: string
  periodKey: string    // "2026-04" / "2026-W16" / "2026-Q2"
  actual: number
  notes?: string
  updatedByUserId: string
  updatedByName: string
  updatedDate: string
}

// ── HR SOP types ──────────────────────────────────────────────────────────────
export type SOPCategory = 'recruitment' | 'onboarding' | 'leave' | 'payroll' | 'offboarding' | 'conduct' | 'general'
export interface HRSOP {
  id: string; title: string; category: SOPCategory; content: string
  status: 'active' | 'draft'; version: string
  createdByName: string; createdAt: string; updatedAt: string
}

// ── Performance Target types ──────────────────────────────────────────────────
export type PerfStatus = 'on_track' | 'at_risk' | 'achieved' | 'missed'
export type PerfPeriod = 'monthly' | 'quarterly' | 'annual'
export interface PerformanceTarget {
  id: string; employeeId: string; employeeName: string
  metric: string; description: string
  targetValue: number; currentValue: number; unit: string
  period: PerfPeriod; periodLabel: string; dueDate: string
  status: PerfStatus; createdByName: string; createdAt: string
}

// ── Reference SOPs (My Documents) ───────────────────────────────────────────
export type RefSOPCategory = 'sales' | 'repair' | 'credit' | 'hr'

export interface RefSOP {
  id: string
  category: RefSOPCategory
  title: string
  content: string
  updatedAt: string
  createdByName: string
  fileName?: string
  fileData?: string
}

// Monthly inventory snapshot
export interface InventorySnapshot {
  id: string; month: string; year: number
  lines: { productId: string; productName: string; opening: number; purchases: number; sales: number; usage: number; closing: number }[]
  createdAt: string
}

export interface AppState {
  activeModule: ModuleId; sidebarOpen: boolean
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null
  
  // Legacy & CRM
  contacts: Contact[]
  companies: Company[]
  contactPersons: ContactPerson[]
  opportunities: Opportunity[]
  opportunityActivities: OpportunityActivity[]
  quotes: Quote[]
  
  // Products & Inventory
  products: Product[]
  productPriceHistory: ProductPriceHistory[]
  serials: SerialNumber[]
  
  // Sales
  saleOrders: SaleOrder[]; invoices: Invoice[]; deliveries: Delivery[]
  
  // Payments & Credit
  payments: Payment[]
  customerCredits: CustomerCredit[]
  allocatePaymentToInvoice: (paymentId: string, invoiceId: string, amount: number) => void
  generateReceipt: (paymentId: string) => void
  getCustomerCreditBalance: (customerId: string) => number
  applyCustomerCreditToInvoice: (invoiceId: string, amount?: number) => void
  checkCreditLimit: (customerId: string, orderTotal: number) => { ok: boolean; message?: string; requiresApproval?: boolean; creditAvailable?: number }
  getCustomerCreditStatus: (customerId: string, newOrderTotal?: number) => {
    ok: boolean
    isLocked: boolean
    creditLimitExceeded: boolean
    outstandingBalance: number
    overdueBalance: number
    overdueCount: number
    creditLimit: number
    creditAvailable: number
    message: string
  }

  // Purchasing
  purchaseOrders: PurchaseOrder[]; receipts: Receipt[]
  stockTransfers: StockTransfer[]
  purchaseReturns: PurchaseReturn[]
  refurbishmentJobs: RefurbishmentJob[]
  
  // Repairs
  repairs: RepairOrder[]
  // departments/employees/leaveBalances/leaveRequests/hrDocuments/jobPostings/
  // candidates/trainingPrograms/employeeTrainings moved to useHrStore() (hooks/useHrStore.ts)
  contracts: Contract[]
  customerContracts: CustomerContract[]
  workflowApprovals: WorkflowApproval[]
  payrollRuns: PayrollRun[]
  payslips: Payslip[]
  salaryAdvances: SalaryAdvance[]
  journalEntries: JournalEntry[]
  accounts: Account[]
  employeeAssetAssignments: EmployeeAssetAssignment[]
  warranties: Warranty[]; posOrders: POSOrder[]

  // Kilimall
  kilimallOrders: KilimallOrder[]
  kilimallDispatches: KilimallDispatch[]
  kilimallSettlements: KilimallSettlement[]
  createKilimallOrder: (p: Omit<KilimallOrder, 'id' | 'ref' | 'status' | 'createdDate' | 'createdBy'>) => KilimallOrder
  updateKilimallOrder: (id: string, p: Partial<KilimallOrder>) => void
  confirmKilimallDispatch: (
    orderId: string,
    serialId: string,
    serialNumber: string,
    opts?: { fulfilledProductId?: string; substitutionReason?: string },
  ) => KilimallDispatch | null
  createKilimallSettlement: (p: Omit<KilimallSettlement, 'id' | 'ref' | 'status' | 'createdDate' | 'createdBy'>) => KilimallSettlement
  updateKilimallSettlement: (id: string, p: Partial<KilimallSettlement>) => void
  reconcileKilimallSettlement: (settlementId: string) => void
  posSessionOpen: boolean; posSessionOpeningCash: number
  posSessionId: string | null
  posSessions: POSSession[]
  stockMoves: StockMove[]
  bulkStock: BulkStockLevel[]
  openingStockPosted: boolean
  stockAdjustments: StockAdjustment[]
  auditLogs: AuditLog[]
  users: User[]
  currentUserId: string | null
  currentUser: User | null

  // Notifications & profile
  notifications: AppNotification[]
  profileImages: Record<string, string>      // userId → base64 data URL
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  clearReadNotifications: () => void
  setProfileImage: (userId: string, dataUrl: string) => void

  // Rider deliveries
  riders: Rider[]
  deliveryJobs: DeliveryJob[]
  riderWeeklyPays: RiderWeeklyPay[]
  addRider: (r: Omit<Rider, 'id' | 'createdAt'>) => Rider
  updateRider: (id: string, p: Partial<Rider>) => void
  createDeliveryJob: (j: Omit<DeliveryJob, 'id' | 'ref' | 'status' | 'createdByUserId' | 'createdByName' | 'createdAt'>) => DeliveryJob
  updateDeliveryJob: (id: string, p: Partial<DeliveryJob>) => void
  deleteDeliveryJob: (id: string) => void
  assignRiderToJob: (jobId: string, riderId: string, riderFee?: number) => void
  /**
   * Create a sales_delivery rider job from a customer invoice.
   * When deliveryFee > 0, always appends a Delivery charge line on the invoice
   * (draft or posted). Posted invoices also get an adjustment journal.
   */
  scheduleInvoiceDelivery: (invoiceId: string, opts: {
    deliveryAddress: string
    scheduledDate: string
    riderFee: number
    deliveryFee?: number
    riderId?: string
    notes?: string
    /** When false, skip adding the delivery charge invoice line. Default true. */
    addChargeToInvoice?: boolean
  }) => DeliveryJob | null
  advanceJobStatus: (jobId: string, newStatus: DeliveryJobStatus, failureReason?: string) => void
  generateWeeklyPay: (riderId: string, weekStart: string) => RiderWeeklyPay | null
  markWeeklyPayPaid: (id: string) => void

  // Cashbook & bank reconciliation
  bankAccounts: BankAccount[]
  bankRecons: BankRecon[]
  bankStatementLines: BankStatementLine[]
  saveBankRecon: (recon: Omit<BankRecon, 'id' | 'reconciledBy' | 'reconciledAt'>) => void
  updateBankRecon: (id: string, p: Partial<BankRecon>) => void
  updateBankAccount: (id: string, p: Partial<Pick<BankAccount, 'name' | 'bankName' | 'accountNo' | 'openingBalance' | 'openingDate' | 'active'>>) => void
  addBankAccount: (a: Omit<BankAccount, 'id'>) => string
  deleteBankAccount: (id: string) => void
  /** Per-document bank/M-Pesa selection for quote / proforma / invoice PDFs. */
  documentPaymentDetails: DocumentPaymentDetailsMap
  getDocumentPaymentDetails: (documentId: string) => DocumentPaymentDetails
  setDocumentPaymentDetails: (documentId: string, details: DocumentPaymentDetails) => void
  companySettings: CompanySettings
  updateCompanySettings: (p: Partial<CompanySettings>) => void
  systemSettings: SystemSettings
  updateSystemSettings: (p: Partial<SystemSettings>) => void
  addStatementLine: (line: Omit<BankStatementLine, 'id'>) => void
  updateStatementLine: (id: string, p: Partial<BankStatementLine>) => void
  deleteStatementLine: (id: string) => void
  matchStatementLine: (statementId: string, entryId: string) => void
  unmatchStatementLine: (statementId: string) => void
  autoMatchStatements: (bankAccountId: string, month: string, cashbookEntries: { id: string; date: string; debit: number; credit: number }[]) => number

  // SOP Documents
  sopDocuments: SOPDocument[]
  saveSopDocuments: (docs: SOPDocument[]) => void
  // SOPs / Performance Targets
  sops: SOP[]
  sopActuals: SOPActual[]
  createSOP: (s: Omit<SOP, 'id' | 'createdByUserId' | 'createdByName' | 'createdAt'>) => SOP
  updateSOP: (id: string, p: Partial<Pick<SOP, 'metrics' | 'period' | 'active' | 'notes'>>) => void
  deleteSOP: (id: string) => void
  setSopActual: (sopId: string, metricId: string, periodKey: string, actual: number, notes?: string) => void

  // HR SOPs & Targets
  hrSops: HRSOP[]
  hrPerfTargets: PerformanceTarget[]
  saveHrSops: (sops: HRSOP[]) => void
  saveHrPerfTargets: (targets: PerformanceTarget[]) => void

  // Reference SOPs (My Documents)
  refSops: RefSOP[]
  addRefSop: (s: Omit<RefSOP, 'id' | 'updatedAt' | 'createdByName'>) => void
  updateRefSop: (id: string, p: Partial<RefSOP>) => void
  deleteRefSop: (id: string) => void

  // Expenses
  expenses: Expense[]
  submitExpense: (e: Omit<Expense, 'id' | 'ref' | 'submittedByUserId' | 'submittedByName' | 'submittedDate' | 'status' | 'createdAt'>) => Expense
  reviewExpense: (id: string, approved: boolean, notes?: string) => void
  reimburseExpense: (id: string, notes?: string, method?: string, bankAccountId?: string, reference?: string) => void

  // Deposits
  deposits: Deposit[]
  createDeposit: (d: CreateDepositInput) => Deposit
  addDepositPayment: (depositId: string, p: Omit<DepositPayment, 'id'>) => void
  completeDeposit: (depositId: string) => void
  cancelDeposit: (depositId: string, reason: string) => void

  // Holdovers (device loans)
  holdovers: Holdover[]
  addHoldover: (h: Holdover) => void
  updateHoldover: (id: string, patch: Partial<Holdover>) => void

  // Outsource repair
  outsourceVendors: OutsourceVendor[]
  outsourceJobs: OutsourceJob[]
  outsourcePayments: OutsourcePayment[]
  addOutsourceVendor: (v: Omit<OutsourceVendor, 'id' | 'createdAt'>) => OutsourceVendor
  updateOutsourceVendor: (id: string, p: Partial<OutsourceVendor>) => void
  addOutsourceJob: (j: Omit<OutsourceJob, 'id' | 'ref' | 'createdAt' | 'sentByUserId' | 'sentByName' | 'status'>) => OutsourceJob
  returnOutsourceJob: (id: string, p: { returnedDate: string; isResolved: boolean; returnNotes?: string; finalCost?: number; repairNextStep?: 'keep' | 'in_repair' | 'unrepairable' }) => void
  recordOutsourcePayment: (p: Omit<OutsourcePayment, 'id' | 'ref' | 'createdAt' | 'paidByUserId' | 'paidByName'>) => OutsourcePayment

  // Outbound Release Checkpoint
  outboundReleases: OutboundRelease[]
  initRelease: (p: { invoiceId?: string; repairId?: string; deliveryNoteId?: string; clientId: string; clientName: string; sourceRef: string; sourceType: OutboundRelease['sourceType']; serials: { serialNumberId: string; expectedSerial: string }[] }) => OutboundRelease
  pickRelease: (id: string) => void
  verifyReleaseItem: (releaseId: string, itemId: string, confirmedSerial: string) => void
  completeVerification: (id: string, p: { verifiedById: string; verifiedByName: string }) => void
  completeRelease: (id: string, p: { receivedBy: string; receivedByPhone?: string; releaseNotes?: string; conditionOnRelease?: string; receiverSigData?: string; receiverSigMethod?: SignatureMethod; receiverSigRef?: string; customerAckSigData?: string; customerAckSigMethod?: SignatureMethod; customerAckSigRef?: string }) => void
  voidRelease: (id: string, reason: string) => void

  setModule: (m: ModuleId) => void
  toggleSidebar: () => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void

  // Legacy Contacts (backward compatibility)
  addContact: (c: Omit<Contact, 'id' | 'createdAt'>) => Promise<Contact>
  updateContact: (id: string, p: Partial<Contact>) => Promise<Contact>
  deleteContact: (id: string) => Promise<void>

  // Chart of Accounts
  addAccount: (a: Omit<Account, 'id'>) => Account
  updateAccount: (id: string, p: Partial<Account>) => void

  // CRM - Companies
  createCompany: (c: Omit<Company, 'id' | 'creditUsed' | 'createdAt' | 'updatedAt'>) => Company
  updateCompany: (id: string, p: Partial<Company>) => void
  deleteCompany: (id: string) => void
  
  // CRM - Contact Persons
  createContactPerson: (c: Omit<ContactPerson, 'id'>) => ContactPerson
  updateContactPerson: (id: string, p: Partial<ContactPerson>) => void
  deleteContactPerson: (id: string) => void
  
  // CRM - Opportunities
  createOpportunity: (opp: Omit<Opportunity, 'id' | 'ref' | 'createdDate' | 'createdAt' | 'quoteIds' | 'actualValue' | 'leadScore'>) => Opportunity
  updateOpportunity: (id: string, p: Partial<Opportunity>) => void
  moveOpportunityStage: (id: string, stage: OpportunityStage) => void
  markOpportunityWon: (id: string, actualValue: number) => void
  markOpportunityLost: (id: string, reason: string, competitor?: string) => void
  deleteOpportunity: (id: string) => void
  
  // CRM - Opportunity Activities
  logActivity: (activity: Omit<OpportunityActivity, 'id' | 'createdAt' | 'createdDate' | 'createdById' | 'createdByName'>) => OpportunityActivity
  completeActivity: (id: string, outcome?: string) => void
  
  // Customer Contracts
  createCustomerContract: (contract: Omit<CustomerContract, 'id' | 'ref'>) => CustomerContract
  updateCustomerContract: (id: string, patch: Partial<CustomerContract>) => void
  renewCustomerContract: (id: string) => CustomerContract
  terminateCustomerContract: (id: string, reason: string) => void
  
  // Sales - Quotes
  createQuote: (quote: Omit<Quote, 'id' | 'ref' | 'quoteNumber' | 'quoteDate' | 'totalAmount' | 'version' | 'issueDate' | 'viewCount' | 'createdBy' | 'createdById' | 'createdByName' | 'createdAt' | 'updatedAt'>) => Quote
  updateQuote: (id: string, p: Partial<Quote>) => void
  addQuoteLine: (quoteId: string, product: Product, qty: number, discount?: number, customPrice?: number) => void
  removeQuoteLine: (quoteId: string, lineId: string) => void
  sendQuote: (id: string) => void
  acceptQuote: (id: string) => void
  rejectQuote: (id: string, reason: string) => void
  convertQuoteToSaleOrder: (quoteId: string) => SaleOrder | null
  convertRepairQuoteToSOAndInvoice: (quoteId: string) => { so: SaleOrder; invoice: Invoice } | null
  reviseQuote: (quoteId: string, changes: string) => Quote
  deleteQuote: (id: string) => void

  // Products
  addProduct: (p: Omit<Product, 'id'>) => Product
  /** Bulk publish: server checks exists, creates missing, then refreshes catalog into local state. */
  publishProductBulk: (rows: Array<Omit<Product, 'id'> & { skuProvided?: boolean }>) => Promise<{
    created: number
    skipped: number
    failed: number
    skippedRows: { name: string; reason: string }[]
    failedRows: { name: string; reason: string }[]
  }>
  refreshProductCatalog: () => Promise<number>
  /** Rewrite legacy INV-* tags so Tag = manufacturer serial. */
  normalizeInventoryTags: () => Promise<number>
  updateProduct: (id: string, p: Partial<Product>) => void
  updateProductPrice: (id: string, salePrice: number, costPrice: number, reason: string, effectiveDate?: string) => ProductPriceHistory | null
  /** Soft-archive a product master (`isActive: false`). Hides from pickers; stock history kept. */
  archiveProduct: (id: string) => void
  /** Restore an archived product (`isActive: true`). */
  unarchiveProduct: (id: string) => void
  deleteProduct: (id: string) => void
  importOpeningStock: (items: { productId: string; qty: number; serials?: string[]; serialSkus?: string[]; location?: LocationId }[]) => void
  /**
   * Add available on-hand serials to one product (opening balance / stock intake).
   * Server-authoritative — increases On hand / Available via deed_serials.
   */
  intakeProductSerials: (
    productId: string,
    input: { serials: string[]; location?: LocationId; reason: string; kind?: 'opening_balance' | 'stock_intake' },
  ) => Promise<{ added: number; documentRef: string } | null>

  // Serials
  getProductSerials: (productId: string, location?: LocationId) => SerialNumber[]
   getAvailableSerials: (productId: string) => SerialNumber[]
  updateSerial: (id: string, patch: Partial<SerialNumber>) => void
  /** Return a held (assigned) serial to available on-hand stock and detach from SO lines. */
  releaseSerialToStock: (serialId: string, destination?: LocationId) => boolean

  // Sale Orders
  createSaleOrder: (customerId: string, customerName: string, initial?: Partial<Pick<SaleOrder, 'lines' | 'deliveryDate' | 'notes' | 'paymentTerms' | 'validUntil' | 'customerRef' | 'invoiceAddress' | 'deliveryAddress' | 'pricelist' | 'salespersonId' | 'salespersonName' | 'salesTeam'>>) => SaleOrder | Promise<SaleOrder>
  updateSaleOrder: (
    id: string,
    p: Partial<SaleOrder>,
    opts?: { persist?: boolean },
  ) => void | Promise<boolean>
  addSOLine: (orderId: string, product: Product, qty: number, discount?: number, defaultTaxRate?: number) => void | Promise<boolean>
  assignSerialToSOLine: (orderId: string, lineId: string, serialId: string) => void
  assignSerialsToSOLine: (orderId: string, lineId: string, serialIds: string[]) => void
  unassignSerialFromSOLine: (orderId: string, lineId: string, serialId: string) => void
  removeSOLine: (orderId: string, lineId: string) => void | Promise<boolean>
  /** Reorder a quotation line (product or section) up/down. Quotation stage only. */
  moveSOLine: (orderId: string, lineId: string, direction: -1 | 1) => void | Promise<boolean>
  /** Insert a section heading on a quotation. */
  addSOSection: (orderId: string, title?: string) => void | Promise<boolean>
  confirmSO: (id: string) => void | Promise<void>
  /** Create a waiting delivery when a confirmed SO has none (heal / retry). */
  ensureWaitingDeliveryForSO: (id: string) => Promise<Delivery | null>
  /** Send by Email succeeded → Quotation Sent (records date/user/recipient). */
  markQuotationSent: (id: string, recipient?: string, message?: string) => void | Promise<void>
  /** Lock/unlock a confirmed sales order (Lock Confirmed Sales setting). */
  setSaleOrderLock: (id: string, locked: boolean) => void
  resetSOToDraft: (id: string) => void
  cancelSO: (id: string) => void
  /** Quotation versioning: clone a quotation-stage SO into a new draft version (v2, v3, …). Confirmed SOs use duplicateSaleOrder in the UI instead. */
  createNewSOVersion: (orderId: string) => Promise<SaleOrder | null>
  /** Reserve quantity / assigned serials for this delivery. */
  prepareDelivery: (deliveryId: string, qtysDone?: Record<string, number>) => boolean
  /** Validate a delivery; partial quantities create a backorder delivery. */
  validateDelivery: (deliveryId: string, qtysDone?: Record<string, number>) => void
  /** Persist successful final DN generation before enabling invoicing. */
  markDeliveryNoteGenerated: (deliveryId: string) => Promise<boolean>
  updateDelivery: (deliveryId: string, p: Partial<Pick<Delivery, 'status' | 'recipientName' | 'recipientPhone' | 'recipientIdNumber' | 'deliveryAddress' | 'notes' | 'deliveryNoteGeneratedAt' | 'deliveryNoteGeneratedByUserId'>>) => void
  /** lineOverrides: partial-invoice qty picker — { itemId, qty } per SO line, capped server-side. Omit to invoice everything currently invoiceable. */
  createInvoiceFromSO: (orderId: string, lineOverrides?: Array<{ itemId: string; qty: number }>) => Promise<Invoice> | Invoice
  deleteSaleOrder: (id: string) => void

  // Invoices
  createManualInvoice: (type: InvoiceType, partnerId: string, partnerName: string, dueDate: string, lines: { type?: 'item' | 'section'; desc: string; qty: string; price: string; tax: string; discount?: string }[], vatRate: number, notes?: string, documentDate?: string) => Invoice
  updateInvoice: (id: string, p: Partial<Invoice>) => void
  /** Reorder a draft invoice line (product or section) up/down. */
  moveInvoiceLine: (invoiceId: string, lineId: string, direction: -1 | 1) => void
  /** Insert a section heading on a draft invoice. */
  addInvoiceSection: (invoiceId: string, title?: string) => void
  postInvoice: (id: string, forcedRef?: string) => void | Promise<void>
  /** Finance dispute flag — Odoo "Blocked" payment status. */
  setInvoicePaymentBlocked: (id: string, blocked: boolean) => void
  registerPayment: (invoiceId: string, amount: number, method?: string, bankAccountId?: string, reference?: string, paymentDate?: string) => void
  resetInvoiceToDraft: (id: string) => void
  cancelInvoice: (id: string, forcedCreditRef?: string) => void
  deleteInvoice: (id: string) => void

  // Audit logs
  addAuditLog: (action: string, documentRef: string, details: string) => void

  /** Fetch a server-allocated document ref; falls back to local docSeq on failure. */
  allocateDocRef: (prefix: string) => Promise<string>

  // Purchase Orders
  createPO: (vendorId: string, vendorName: string, initial?: Partial<Pick<PurchaseOrder, 'lines' | 'expectedDate' | 'notes'>>, forcedRef?: string) => Promise<PurchaseOrder>
  updatePO: (id: string, p: Partial<PurchaseOrder>) => void
  addPOLine: (poId: string, product: Product, qty: number, unitPrice: number, taxRate?: number) => void
  removePOLine: (poId: string, lineId: string) => void
  updatePOLine: (poId: string, lineId: string, updates: Partial<Pick<POLine, 'qty' | 'unitPrice' | 'taxRate' | 'productName' | 'accountCode'>>) => void
  bulkAddPOLines: (poId: string, rows: { productId: string; productName: string; qty: number; unitPrice: number; taxRate: number; requiresSerial: boolean; importedSerials?: string[]; specs?: string; accountCode?: string }[]) => void
  sendPO: (id: string) => void
  revertPOToDraft: (id: string) => void
  confirmPO: (id: string) => void
  // Create receipt from PO (opens receiving dialog)
  createReceiptFromPO: (poId: string, forcedRef?: string) => Receipt | null
  // Validate receipt — the CRITICAL stock entry step
  // serialAccessories: map of serial string → accessories array (e.g. { 'SN001': ['Charger','Bag'] })
  // serialIssues: map of serial string → issue description (non-empty = received with issues → refurbishment)
  validateReceipt: (receiptId: string, lines: Receipt['lines'], destination: LocationId, serialAccessories?: Record<string, string[]>, serialAccessoryNotes?: Record<string, string>, serialSpecs?: Record<string, string>, serialIssues?: Record<string, string>) => void
  deletePO: (id: string) => void
  createBillFromPO: (poId: string) => Invoice | null

  // Purchase Returns
  createPurchaseReturn: (receiptId: string, reason: PurchaseReturn['reason']) => PurchaseReturn
  addReturnLine: (returnId: string, productId: string, productName: string, qty: number, serialIds: string[], requiresSerial: boolean) => void
  confirmPurchaseReturn: (returnId: string) => void
  logReturnPickup: (returnId: string, collectedByUserId: string, collectedByName: string, collectedDate: string, pickupNotes?: string) => void

  // Refurbishment
  createRefurbishmentJob: (serialId: string, issueDescription: string) => void
  assignRefurbishmentJob: (jobId: string, techId: string, techName: string) => void
  updateRefurbishmentJob: (jobId: string, patch: Partial<Pick<RefurbishmentJob, 'techNotes' | 'status' | 'completedDate'>>) => void
  addRefurbishmentPart: (jobId: string, part: Omit<RefurbPart, 'id'>) => void
  updateRefurbishmentPart: (jobId: string, partId: string, patch: Partial<RefurbPart>) => void
  removeRefurbishmentPart: (jobId: string, partId: string) => void
  requestPartFromInventory: (jobId: string, partId: string) => void   // tech → checks stock; allocates or alerts lead
  allocateRefurbPart: (jobId: string, partId: string) => void         // lead tech → deducts stock, marks allocated
  notifyTechPartAvailable: (jobId: string, partId: string) => void    // lead tech → stamps notified date
  markRefurbishmentReady: (jobId: string) => void
  transferToSell: (jobId: string) => void
  writeOffRefurbishmentJob: (jobId: string, reason: string) => void

  // HR users & auth
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  createUser: (u: CreateUserInput) => Promise<User>
  updateUser: (id: string, p: UpdateUserInput) => Promise<void>
  unlockUser: (id: string) => Promise<void>
  deleteUser: (id: string) => Promise<void>
  deactivateUser: (id: string) => Promise<void>
  reactivateUser: (id: string) => Promise<void>
  resendCredentials: (id: string) => Promise<void>
  hasModuleAccess: (module: ModuleId) => boolean
  isSuperAdmin: () => boolean

  // HR
  // addEmployee/updateEmployee/addLeaveRequest/decideLeaveRequest/cancelLeaveRequest/
  // updateLeaveBalance/initYearBalances/applyDecemberClosure/expireYearEndBalances/
  // addHRDocument moved to useHrStore() (hooks/useHrStore.ts)
  createPayrollRun: (month: string, year: number) => PayrollRun
  approvePayrollRun: (id: string) => void
  postPayrollRun: (id: string) => void
  applySalaryAdvance: (request: Omit<SalaryAdvance, 'id' | 'ref' | 'requestedDate' | 'status' | 'monthlyDeduction' | 'amountRecovered' | 'outstandingAmount' | 'deductions'>) => SalaryAdvance
  decideSalaryAdvance: (id: string, approved: boolean, note?: string) => void
  markSalaryAdvancePaid: (id: string, paidDate?: string) => void
  cancelSalaryAdvance: (id: string) => void
  assignAssetToEmployee: (employeeId: string, productId: string, qty: number, serialId?: string, handoverCondition?: EmployeeAssetAssignment['handoverCondition'], handoverNotes?: string) => void
  acknowledgeEmployeeAsset: (assignmentId: string, notes?: string) => void
  returnEmployeeAsset: (assignmentId: string, returnLocation: LocationId, condition: 'good' | 'fair' | 'damaged', notes: string) => void
  reassignEmployeeAsset: (assignmentId: string, employeeId: string) => void
  uploadMyDocument: (document: Omit<HRDocument, 'id' | 'employeeId' | 'uploadedByUserId' | 'uploadedByName' | 'uploadedDate'>) => HRDocument
  // Recruitment & Training (addJobPosting/updateJobPosting/addCandidate/updateCandidate/
  // addTrainingProgram/enrollEmployeeTraining/updateTrainingStatus) moved to useHrStore()

  // Stock Transfers (internal moves)
  createTransfer: (from: LocationId, to: LocationId, notes?: string) => StockTransfer
  addTransferLine: (transferId: string, productId: string, productName: string, qty: number, serialIds: string[]) => void
  validateTransfer: (transferId: string) => void | Promise<void>
  submitTransfer: (from: LocationId, to: LocationId, productId: string, productName: string, qty: number, serialIds: string[], notes?: string) => boolean | Promise<boolean>

  // Repairs - Full Workflow
  createRepair: (customerId: string, customerName: string, productName: string, serial: string, desc: string) => RepairOrder
  updateRepair: (id: string, p: Partial<RepairOrder>) => void
  deleteRepair: (id: string) => void
  checkWarrantyForRepair: (repairId: string, serial: string) => boolean
  fileWarrantyClaim: (repairId: string, notes: string) => void
  
  // Repair Workflow Actions
  verifyRepairIntake: (repairId: string, notes?: string) => void
  assignTechnicianToRepair: (repairId: string, technicianId: string) => void
  logDiagnosis: (repairId: string, diagnosis: Omit<RepairDiagnosis, 'diagnosedBy' | 'diagnosedDate'>) => void
  stopAtDiagnosis: (repairId: string) => void          // Close job at diagnosis stage, charge diagnosis fee
  markDiagnosisFeePaid: (repairId: string, method?: string) => void
  waiveDiagnosisFee: (repairId: string, reason: string) => void
  /**
   * Mark a repair as no-charge (company mistake / goodwill).
   * Skips customer quote approval and invoicing. Manager-only; audited.
   */
  markRepairNoCharge: (
    repairId: string,
    opts: { reason: BillingExemptReason; notes: string },
  ) => void
  generateRepairQuote: (repairId: string, lines: Omit<RepairQuoteLine, 'id' | 'reserved'>[], applyVat?: boolean) => void
  sendQuoteToCustomer: (repairId: string) => void
  approveRepairQuote: (repairId: string, approved: boolean, reason?: string) => void
  startRepair: (repairId: string) => void
  markRepairComplete: (repairId: string) => void
  addRepairQAItem: (repairId: string, description: string) => void
  completeRepairQA: (
    repairId: string,
    qaResults: { itemId: string; description?: string; passed: boolean; notes?: string }[],
    failReason?: string,
  ) => void
  markPartsArrived: (repairId: string) => void
  markRepairReady: (repairId: string) => void
  scheduleDelivery: (repairId: string, method: 'pickup' | 'delivery' | 'courier', scheduledDate: string, address?: string, riderId?: string, riderName?: string) => void
  deliverRepair: (repairId: string, recipientName: string, recipientPhone: string, isRep?: boolean, repRelationship?: string, repIdNumber?: string) => void
  closeRepairJob: (repairId: string) => void
  createInvoiceFromRepair: (repairId: string, applyVat?: boolean) => Invoice | null
  // Finance review of a customer-submitted portal payment confirmation.
  // Confirm registers the payment against the linked invoice; reject flags it.
  reviewPortalPayment: (repairId: string, approved: boolean, notes?: string) => void
  
  // Repair Access Control
  canViewRepair: (repairId: string) => boolean
  getVisibleRepairs: () => RepairOrder[]
  updateRepairProgress: (repairId: string, newStatus: RepairStatus, message: string, notifyCustomer: boolean) => void
  moveRepairToPreviousProgress: (repairId: string) => void
  
  // Parts Procurement
  requestProcurement: (repairId: string, items: any[], urgency: string, notes: string) => void
  appendRepairHistory: (repairId: string, entry: { status: string; date: string; note?: string; by?: string }) => void
  
  // Quote Management
  declineQuote: (repairId: string, reason: string) => void
  markUnrepairable: (repairId: string, reason: string) => void
  returnToCustomer: (repairId: string, reason: string) => void
  /** Customer left the device with Deed (terminal). Optionally convert into stock via free buy-back or donation-in. */
  leaveDeviceWithDeed: (
    repairId: string,
    opts?: { convertToStock?: boolean; convertToDonation?: boolean; notes?: string },
  ) => { ok: boolean; message: string; buyBackId?: string; buyBackRef?: string; donationId?: string; donationRef?: string }
  /** One-click: convert a retained repair into a confirmed donation-in linked to the repair. */
  convertRetainedRepairToDonation: (
    repairId: string,
    opts?: { notes?: string },
  ) => { ok: boolean; message: string; donationId?: string; donationRef?: string }
  /** One-click: convert a retained repair into a free stocked buy-back linked to the repair. */
  convertRetainedRepairToBuyBack: (
    repairId: string,
    opts?: { notes?: string },
  ) => { ok: boolean; message: string; buyBackId?: string; buyBackRef?: string }
  /**
   * Paid trade-in after evaluation: retain the repair and open a draft BuyBack
   * (approve → pay → stock) linked to this job.
   */
  createTradeInFromRepair: (
    repairId: string,
    opts: {
      unitPrice: number
      condition?: 'good' | 'fair' | 'poor'
      notes?: string
    },
  ) => { ok: boolean; message: string; buyBackId?: string; buyBackRef?: string }

  // POS
  openPOSSession: (openingCash: number) => void
  closePOSSession: (closingCash: number) => POSSession | null
  createPOSOrder: (lines: POSOrder['lines'], payment: POSOrder['payment'], customerId?: string, customerName?: string, pointsRedeemed?: number, applyVat?: boolean) => POSOrder | null | Promise<POSOrder | null>

  // Inventory reports
  getStockByLocation: (productId: string) => Record<LocationId, number>
  getMonthlyMovements: (productId: string) => { opening: number; purchases: number; sales: number; usage: number; closing: number }

  // Stock adjustments
  createAdjustment: (productId: string, productName: string, type: 'add' | 'subtract', qty: number, reason: AdjReason, notes: string) => StockAdjustment
  approveAdjustment: (adjId: string, approved: boolean) => void | Promise<void>
  
  // Stock Reservations
  stockReservations: StockReservation[]
  reserveStock: (productId: string, qty: number, reservedFor: string, referenceId: string, referenceRef: string) => StockReservation | null
  getReservedQty: (productId: string) => number
  getAvailableStock: (productId: string) => number
  fulfillReservation: (productId: string, referenceId: string, qty: number) => void
  cancelReservation: (referenceId: string, reason: string) => void
  
  // Delivery & Fulfillment
  createDeliveryFromSO: (salesOrderId: string, forcedRef?: string) => Delivery | null
  confirmDeliveryWithStockDeduction: (deliveryId: string) => void
  createInvoiceFromDelivery: (deliveryId: string) => Invoice | null
  
  // Approval Workflows
  approvalRequests: ApprovalRequest[]
  checkDiscountApproval: (discountPercent: number) => { requiresApproval: boolean; roles: string[] }
  requestApproval: (type: ApprovalType, details: any) => ApprovalRequest | null
  approveRequest: (requestId: string, decision: 'approved' | 'rejected', comments?: string) => void
  getPendingApprovalsForUser: () => any[]

  // Returns / RMA
  returnOrders: ReturnOrder[]
  refundPayments: RefundPayment[]
  createReturnOrder: (saleOrderId: string, saleOrderRef: string, customerId: string, customerName: string, reason: string, lines: Omit<ReturnOrderLine, 'id'>[]) => ReturnOrder
  approveReturn: (id: string) => void
  receiveReturn: (id: string) => void
  processReturn: (id: string, resolution: RMAResolution, refundAmount?: number, processNotes?: string, refundPaymentMethod?: RefundPaymentMethod) => void
  rejectReturn: (id: string, reason: string) => void

  // Buy-backs
  buyBacks: BuyBack[]
  createBuyBack: (customerId: string, customerName: string, lines: Omit<BuyBackLine, 'id'>[], destination: LocationId, notes?: string, originalSOId?: string, originalSORef?: string) => BuyBack
  approveBuyBack: (id: string) => void
  payBuyBack: (id: string, paymentMethod: BuyBack['paymentMethod']) => void
  stockBuyBack: (id: string) => void
  deleteBuyBack: (id: string) => void
  /** Register a serial that is not yet in Deed for a customer return / buyback / exchange / RMA. */
  registerCustomerReturnSerial: (
    productId: string,
    serialText: string,
    opts?: { saleOrderId?: string; source?: string },
  ) => SerialNumber | null

  // Donations
  donations: Donation[]
  createDonation: (type: DonationType, party: string, location: LocationId, lines: Omit<DonationLine, 'id'>[], notes?: string) => Donation
  confirmDonation: (id: string) => void
  deleteDonation: (id: string) => void

  // Client Exchanges
  clientExchanges: ClientExchange[]
  createExchange: (customerId: string, customerName: string, returnLines: Omit<ExchangeLine, 'id'>[], newLines: Omit<ExchangeLine, 'id'>[], notes?: string, originalSOId?: string, originalSORef?: string) => ClientExchange
  approveExchange: (id: string) => void
  completeExchange: (id: string) => void
  cancelExchange: (id: string) => void
}

export type InventoryStoreState = Pick<AppState,
  | 'products'
  | 'productPriceHistory'
  | 'serials'
  | 'stockMoves'
  | 'stockTransfers'
  | 'openingStockPosted'
  | 'purchaseOrders'
  | 'receipts'
  | 'contacts'
  | 'currentUserId'
  | 'users'
  | 'accounts'
  | 'refurbishmentJobs'
  | 'systemSettings'
  | 'bulkStock'
  | 'stockAdjustments'
  | 'saleOrders'
  | 'addProduct'
  | 'publishProductBulk'
  | 'refreshProductCatalog'
  | 'normalizeInventoryTags'
  | 'updateProduct'
  | 'updateProductPrice'
  | 'archiveProduct'
  | 'unarchiveProduct'
  | 'updateSerial'
  | 'releaseSerialToStock'
  | 'createTransfer'
  | 'addTransferLine'
  | 'validateTransfer'
  | 'submitTransfer'
  | 'importOpeningStock'
  | 'intakeProductSerials'
  | 'getStockByLocation'
  | 'getMonthlyMovements'
  | 'showToast'
  | 'addAuditLog'
  | 'createRefurbishmentJob'
  | 'transferToSell'
  | 'createAdjustment'
  | 'approveAdjustment'
>

export type SalesStoreState = Pick<AppState,
  | 'saleOrders'
  | 'contacts'
  | 'products'
  | 'serials'
  | 'invoices'
  | 'deliveries'
  | 'returnOrders'
  | 'users'
  | 'currentUserId'
  | 'systemSettings'
  | 'companySettings'
  | 'bankAccounts'
  | 'documentPaymentDetails'
  | 'getDocumentPaymentDetails'
  | 'setDocumentPaymentDetails'
  | 'addBankAccount'
  | 'outboundReleases'
  | 'approvalRequests'
  | 'sops'
  | 'createSaleOrder'
  | 'updateSaleOrder'
  | 'confirmSO'
  | 'ensureWaitingDeliveryForSO'
  | 'markQuotationSent'
  | 'setSaleOrderLock'
  | 'addSOLine'
  | 'removeSOLine'
  | 'moveSOLine'
  | 'addSOSection'
  | 'assignSerialToSOLine'
  | 'assignSerialsToSOLine'
  | 'unassignSerialFromSOLine'
  | 'addContact'
  | 'createInvoiceFromSO'
  | 'prepareDelivery'
  | 'validateDelivery'
  | 'markDeliveryNoteGenerated'
  | 'deleteSaleOrder'
  | 'showToast'
  | 'getStockByLocation'
  | 'resetSOToDraft'
  | 'cancelSO'
  | 'createNewSOVersion'
  | 'getCustomerCreditStatus'
  | 'confirmDeliveryWithStockDeduction'
  | 'updateDelivery'
  | 'initRelease'
  | 'approveRequest'
>

export type RepairStoreState = Pick<AppState,
  | 'repairs'
  | 'contacts'
  | 'products'
  | 'users'
  | 'riders'
  | 'refurbishmentJobs'
  | 'currentUserId'
  | 'outsourceJobs'
  | 'outsourceVendors'
  | 'warranties'
  | 'systemSettings'
  | 'companySettings'
  | 'invoices'
  | 'outboundReleases'
  | 'serials'
  | 'createRepair'
  | 'updateRepair'
  | 'deleteRepair'
  | 'verifyRepairIntake'
  | 'assignTechnicianToRepair'
  | 'logDiagnosis'
  | 'stopAtDiagnosis'
  | 'markDiagnosisFeePaid'
  | 'waiveDiagnosisFee'
  | 'markRepairNoCharge'
  | 'generateRepairQuote'
  | 'approveRepairQuote'
  | 'startRepair'
  | 'markRepairComplete'
  | 'addRepairQAItem'
  | 'completeRepairQA'
  | 'markPartsArrived'
  | 'scheduleDelivery'
  | 'reviewPortalPayment'
  | 'deliverRepair'
  | 'closeRepairJob'
  | 'createInvoiceFromRepair'
  | 'getVisibleRepairs'
  | 'updateRepairProgress'
  | 'moveRepairToPreviousProgress'
  | 'requestProcurement'
  | 'markUnrepairable'
  | 'declineQuote'
  | 'returnToCustomer'
  | 'leaveDeviceWithDeed'
  | 'convertRetainedRepairToDonation'
  | 'convertRetainedRepairToBuyBack'
  | 'createTradeInFromRepair'
  | 'fileWarrantyClaim'
  | 'showToast'
  | 'appendRepairHistory'
  | 'setModule'
  | 'initRelease'
  | 'addOutsourceJob'
>

export type ShellStoreState = Pick<AppState,
  | 'activeModule'
  | 'sidebarOpen'
  | 'toast'
  | 'currentUser'
  | 'currentUserId'
  | 'users'
  | 'notifications'
  | 'profileImages'
  // Keep repairs so the sidebar badge re-renders; invoices are unused by shell chrome.
  | 'repairs'
  | 'getVisibleRepairs'
  | 'logout'
  | 'markAllNotificationsRead'
  | 'markNotificationRead'
  | 'clearReadNotifications'
  | 'setModule'
  | 'setProfileImage'
  | 'showToast'
  | 'toggleSidebar'
  | 'updateUser'
>

export type CrmStoreState = Pick<AppState,
  | 'contacts'
  | 'companies'
  | 'contactPersons'
  | 'opportunities'
  | 'opportunityActivities'
  | 'quotes'
  | 'customerContracts'
  | 'invoices'
  | 'posOrders'
  | 'repairs'
  | 'saleOrders'
  | 'users'
  | 'currentUserId'
  | 'systemSettings'
  | 'addContact'
  | 'completeActivity'
  | 'createCompany'
  | 'createContactPerson'
  | 'createCustomerContract'
  | 'createOpportunity'
  | 'deleteCompany'
  | 'deleteContact'
  | 'deleteContactPerson'
  | 'deleteOpportunity'
  | 'logActivity'
  | 'markOpportunityLost'
  | 'markOpportunityWon'
  | 'moveOpportunityStage'
  | 'renewCustomerContract'
  | 'terminateCustomerContract'
  | 'updateCompany'
  | 'updateContact'
  | 'updateContactPerson'
  | 'updateOpportunity'
  | 'showToast'
>

export type FinanceStoreState = Pick<AppState,
  | 'accounts'
  | 'bankAccounts'
  | 'documentPaymentDetails'
  | 'getDocumentPaymentDetails'
  | 'setDocumentPaymentDetails'
  | 'addBankAccount'
  | 'bankRecons'
  | 'bankStatementLines'
  | 'buyBacks'
  | 'clientExchanges'
  | 'companySettings'
  | 'contacts'
  | 'currentUser'
  | 'currentUserId'
  | 'customerCredits'
  | 'deliveries'
  | 'deposits'
  | 'donations'
  | 'expenses'
  | 'invoices'
  | 'journalEntries'
  | 'outboundReleases'
  | 'outsourceJobs'
  | 'outsourcePayments'
  | 'outsourceVendors'
  | 'payrollRuns'
  | 'posOrders'
  | 'products'
  | 'purchaseOrders'
  | 'purchaseReturns'
  | 'receipts'
  | 'refundPayments'
  | 'repairs'
  | 'saleOrders'
  | 'serials'
  | 'systemSettings'
  | 'users'
  | 'addAccount'
  | 'addContact'
  | 'addDepositPayment'
  | 'addOutsourceJob'
  | 'addOutsourceVendor'
  | 'addPOLine'
  | 'addReturnLine'
  | 'addStatementLine'
  | 'applyCustomerCreditToInvoice'
  | 'autoMatchStatements'
  | 'bulkAddPOLines'
  | 'cancelDeposit'
  | 'cancelInvoice'
  | 'completeDeposit'
  | 'confirmPO'
  | 'confirmPurchaseReturn'
  | 'createBillFromPO'
  | 'createDeposit'
  | 'createManualInvoice'
  | 'moveInvoiceLine'
  | 'addInvoiceSection'
  | 'createPO'
  | 'createPurchaseReturn'
  | 'createReceiptFromPO'
  | 'deleteInvoice'
  | 'deletePO'
  | 'deleteStatementLine'
  | 'getCustomerCreditBalance'
  | 'initRelease'
  | 'logReturnPickup'
  | 'matchStatementLine'
  | 'postInvoice'
  | 'recordOutsourcePayment'
  | 'registerPayment'
  | 'setInvoicePaymentBlocked'
  | 'reimburseExpense'
  | 'removePOLine'
  | 'resetInvoiceToDraft'
  | 'returnOutsourceJob'
  | 'revertPOToDraft'
  | 'reviewExpense'
  | 'saveBankRecon'
  | 'scheduleInvoiceDelivery'
  | 'sendPO'
  | 'setModule'
  | 'showToast'
  | 'submitExpense'
  | 'unmatchStatementLine'
  | 'updateAccount'
  | 'updateInvoice'
  | 'updateOutsourceVendor'
  | 'updatePO'
  | 'updatePOLine'
  | 'validateReceipt'
>

export type HrStoreState = Pick<AppState,
  | 'currentUser'
  | 'currentUserId'
  | 'users'
  | 'refSops'
  | 'sopDocuments'
  | 'addRefSop'
  | 'deleteRefSop'
  | 'updateRefSop'
  | 'saveSopDocuments'
  | 'showToast'
  | 'updateUser'
>

export type DeliveryStoreState = Pick<AppState,
  | 'companySettings'
  | 'currentUserId'
  | 'deliveryJobs'
  | 'invoices'
  | 'repairs'
  | 'riderWeeklyPays'
  | 'riders'
  | 'saleOrders'
  | 'users'
  | 'addRider'
  | 'advanceJobStatus'
  | 'assignRiderToJob'
  | 'createDeliveryJob'
  | 'deleteDeliveryJob'
  | 'generateWeeklyPay'
  | 'markWeeklyPayPaid'
  | 'scheduleInvoiceDelivery'
  | 'showToast'
  | 'updateDeliveryJob'
  | 'updateRider'
>

export type CommerceStoreState = Pick<AppState,
  | 'companySettings'
  | 'contacts'
  | 'currentUserId'
  | 'customerCredits'
  | 'invoices'
  | 'kilimallDispatches'
  | 'kilimallOrders'
  | 'kilimallSettlements'
  | 'posOrders'
  | 'posSessionOpen'
  | 'posSessionOpeningCash'
  | 'posSessionId'
  | 'posSessions'
  | 'products'
  | 'saleOrders'
  | 'serials'
  | 'users'
  | 'closePOSSession'
  | 'confirmKilimallDispatch'
  | 'createKilimallOrder'
  | 'createKilimallSettlement'
  | 'createPOSOrder'
  | 'getCustomerCreditStatus'
  | 'openPOSSession'
  | 'reconcileKilimallSettlement'
  | 'setModule'
  | 'showToast'
  | 'updateKilimallOrder'
  | 'updateKilimallSettlement'
  | 'updateProduct'
>

export type AfterSalesStoreState = Pick<AppState,
  | 'buyBacks'
  | 'clientExchanges'
  | 'contacts'
  | 'currentUserId'
  | 'donations'
  | 'products'
  | 'returnOrders'
  | 'saleOrders'
  | 'serials'
  | 'users'
  | 'warranties'
  | 'addContact'
  | 'approveBuyBack'
  | 'approveExchange'
  | 'approveReturn'
  | 'cancelExchange'
  | 'completeExchange'
  | 'confirmDonation'
  | 'createBuyBack'
  | 'createDonation'
  | 'createExchange'
  | 'createReturnOrder'
  | 'deleteBuyBack'
  | 'deleteDonation'
  | 'payBuyBack'
  | 'processReturn'
  | 'receiveReturn'
  | 'registerCustomerReturnSerial'
  | 'rejectReturn'
  | 'showToast'
  | 'stockBuyBack'
>

export type OperationsStoreState = Pick<AppState,
  | 'contactPersons'
  | 'contacts'
  | 'currentUserId'
  | 'holdovers'
  | 'products'
  | 'refurbishmentJobs'
  | 'repairs'
  | 'serials'
  | 'systemSettings'
  | 'users'
  | 'warranties'
  | 'addContact'
  | 'addHoldover'
  | 'addRefurbishmentPart'
  | 'allocateRefurbPart'
  | 'assignRefurbishmentJob'
  | 'completeRelease'
  | 'completeVerification'
  | 'createContactPerson'
  | 'createRefurbishmentJob'
  | 'createRepair'
  | 'getAvailableSerials'
  | 'getVisibleRepairs'
  | 'markRefurbishmentReady'
  | 'notifyTechPartAvailable'
  | 'pickRelease'
  | 'removeRefurbishmentPart'
  | 'requestPartFromInventory'
  | 'showToast'
  | 'transferToSell'
  | 'updateHoldover'
  | 'updateRefurbishmentJob'
  | 'updateRefurbishmentPart'
  | 'updateRepair'
  | 'updateSerial'
  | 'verifyReleaseItem'
  | 'voidRelease'
  | 'writeOffRefurbishmentJob'
>

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString().slice(0, 10)
const addDays = (d: string, n: number) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10) }
const addMonths = (d: string, m: number) => { const dt = new Date(d); dt.setMonth(dt.getMonth() + m); return dt.toISOString().slice(0, 10) }

const makeC = () => ({
  so: 88, inv: 88, po: 39, rep: 0, del: 26, pos: 12, war: 10, rec: 0, tr: 0, ret: 0, adj: 0, rma: 0,
  opp: 15, quote: 24, activity: 0, outsource: 4, outsource_pay: 1, exp: 5, sop: 3, refurb: 0,
  djb: 3, rwp: 0, bbk: 0, don: 0, exc: 0, ko: 0, kd: 0, ks: 0, rfd: 0,
  dep: 0, proc: 0, jrn_rfd: 0, orc: 0,
})
let C = makeC()
export const seq = (prefix: string, key: keyof ReturnType<typeof makeC>) => {
  const lsKey = `deed_seq2_${key}`
  const stored = typeof window !== 'undefined' ? localStorage.getItem(lsKey) : null
  const parsed = stored !== null ? parseInt(stored, 10) : NaN
  const fallback = C[key]
  const current = Number.isFinite(parsed) ? parsed : (Number.isFinite(fallback) ? fallback : NaN)
  const next = assertFiniteSequenceNext(current + 1, `${prefix} sequence`)
  if (typeof window !== 'undefined') localStorage.setItem(lsKey, String(next))
  C[key] = next
  return `${prefix}/${String(next).padStart(4, '0')}`
}

// ── Standard document numbering ───────────────────────────────────────────────
// Commercial documents (QUO, SO, PI, DN, INV, RCT, CN, PO and REC goods
// receipts) use a separate sequence per document type per calendar year,
// formatted as PREFIX/YYYY/NNNN. Unlike `seq` above, the next number is
// derived from the documents already loaded from the server — so every
// browser continues the same sequence — with a localStorage high-water mark
// guarding rapid consecutive creates in the same session.
let docRefSource: (() => Array<string | undefined>) | null = null
export const registerDocRefSource = (fn: () => Array<string | undefined>) => { docRefSource = fn }

export const docSeq = (prefix: string) => {
  const year = new Date().getFullYear()
  const re = new RegExp(`^${prefix}/${year}/(\\d+)$`)
  let max = 0
  for (const ref of docRefSource?.() ?? []) {
    const m = ref ? re.exec(ref) : null
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  const lsKey = `deed_docseq_${prefix}_${year}`
  if (typeof window !== 'undefined') {
    const stored = parseInt(localStorage.getItem(lsKey) ?? '0', 10)
    if (Number.isFinite(stored) && stored > max) max = stored
  }
  const next = max + 1
  if (typeof window !== 'undefined') localStorage.setItem(lsKey, String(next))
  return `${prefix}/${year}/${String(next).padStart(4, '0')}`
}

// Draft invoices carry a placeholder reference; the official INV/BILL number
// is assigned from the per-year sequence only when the invoice is posted
// (Odoo: posting assigns the official number).
export const draftInvoiceRef = (type: InvoiceType) =>
  `DRAFT/${type === 'vendor_bill' ? 'BILL' : 'INV'}/${uid().slice(0, 8).toUpperCase()}`
export const isDraftInvoiceRef = (ref: string | undefined) => Boolean(ref?.startsWith('DRAFT/'))

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

// ─── Seed Data ────────────────────────────────────────────────────────────────

// Chart of Accounts — Kenya IFRS-aligned, accrual basis
// Revenue seed balances represent YTD (Jan–Apr 2026) actuals
// Expense seed balances represent YTD actuals
// Balance Sheet seed balances are as at 16 Apr 2026
// BS is designed to balance:
//   Total Assets (static 6,233,000 + dynamic AR) = Total Liabilities (static 1,213,900 + dynamic AP) + Total Equity (4,200,000 + current year P/L 65,100)
// ── Chart of Accounts builder ─────────────────────────────────────────────────
// Generates the full Deed Technologies Ltd COA (3-level hierarchy)
function buildSeedAccounts(): Account[] {
  let n = 1
  const mk = (
    code: string, name: string, type: AccountType,
    group: string, subGroup: string, balance = 0,
    extra: Partial<Account> = {},
  ): Account => ({ id: `coa${n++}`, code, name, type, group, subGroup, isActive: true, balance, ...extra })

  const PRODUCTS = [
    'Laptops', 'Accessories', 'Desktop / Combo', 'Monitors', 'Servers', 'Storage',
    'Power Backup Solutions', 'Printers', 'Software Licenses', 'Parts and Components',
    'Printer Consumables', 'Networking Equipment', 'Consumer Electronics',
  ]
  const SOLUTIONS = [
    'On-Demand IT', 'IT Consultancy', 'Managed IT Infrastructure', 'Server Administration',
    'Cloud Solutions', 'Data Backup', 'Data Recovery', 'Power Backup',
    'Enterprise OEM Software Services', 'Security Solutions',
  ]

  const a: Account[] = []
  const p = (arr: Account[]) => { arr.forEach(x => a.push(x)) }

  // ── OPENING STOCK (Current Asset) ────────────────────────────────────────────
  PRODUCTS.forEach((name, i) => p([mk(`11${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Opening', 'Raw Materials')]))
  PRODUCTS.forEach((name, i) => p([mk(`12${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Opening', 'Work in Progress')]))
  PRODUCTS.forEach((name, i) => p([mk(`13${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Opening', 'Finished Products')]))

  // ── CLOSING STOCK (Current Asset — appears on Balance Sheet as Inventory) ────
  PRODUCTS.forEach((name, i) => p([mk(`14${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Closing', 'Raw Materials')]))
  PRODUCTS.forEach((name, i) => p([mk(`15${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Closing', 'Work in Progress')]))
  PRODUCTS.forEach((name, i) => {
    const bal = name === 'Laptops' ? 480_000
      : name === 'Accessories' ? 124_000
      : name === 'Networking Equipment' ? 156_000
      : name === 'Servers' ? 120_000 : 0
    p([mk(`16${String(i+1).padStart(2,'0')}`, name, 'asset', 'Inventory - Closing', 'Finished Products', bal)])
  })

  // ── PROPERTY, PLANT & EQUIPMENT ──────────────────────────────────────────────
  a.push(mk('1701', 'Computer & Accessories',  'asset', 'PPE - Cost',             'Cost', 840_000))
  a.push(mk('1702', 'Furniture & Fittings',    'asset', 'PPE - Cost',             'Cost', 180_000))
  a.push(mk('1703', 'Office Equipment',        'asset', 'PPE - Cost',             'Cost', 2_400_000))
  a.push(mk('1704', 'Software',               'asset', 'PPE - Cost',             'Cost', 85_000))
  a.push(mk('1751', 'Computer & Accessories',  'asset', 'Accumulated Depreciation','Accum. Depr.', -280_000, { notes: 'Contra account' }))
  a.push(mk('1752', 'Furniture & Fittings',    'asset', 'Accumulated Depreciation','Accum. Depr.', -45_000,  { notes: 'Contra account' }))
  a.push(mk('1753', 'Office Equipment',        'asset', 'Accumulated Depreciation','Accum. Depr.', -320_000, { notes: 'Contra account' }))
  a.push(mk('1754', 'Software',               'asset', 'Accumulated Depreciation','Accum. Depr.', -21_000,  { notes: 'Contra account' }))

  // ── RECEIVABLES (DEBTORS) ────────────────────────────────────────────────────
  // Consolidated dynamic AR (computed from outstanding customer invoices)
  a.push(mk('1800', 'Accounts Receivable (Products)', 'asset', 'Receivables - Product', 'Product', 0,
    { isDynamic: true, dynamicKey: 'ar', notes: 'Computed from outstanding customer invoices' }))
  PRODUCTS.forEach((name, i) => p([mk(`18${String(i+1).padStart(2,'0')}`, name, 'asset', 'Receivables - Product', 'Product')]))
  SOLUTIONS.forEach((name, i) => p([mk(`19${String(i+1).padStart(2,'0')}`, name, 'asset', 'Receivables - Services', 'Solutions and Services')]))
  a.push(mk('1921', 'Hardware Support',         'asset', 'Receivables - Repair', 'Expert Repair Services'))
  a.push(mk('1922', 'Software Support',         'asset', 'Receivables - Repair', 'Expert Repair Services'))
  a.push(mk('1931', 'Advances',                 'asset', 'Receivables - Other',  'Other Debtors'))
  a.push(mk('1932', 'Other Debtors (Receivables)', 'asset', 'Receivables - Other', 'Other Debtors'))

  // ── PREPAYMENTS ──────────────────────────────────────────────────────────────
  PRODUCTS.forEach((name, i) => {
    const bal = name === 'Laptops' ? 45_000 : name === 'Accessories' ? 18_000 : 0
    p([mk(`20${String(i+1).padStart(2,'0')}`, name, 'asset', 'Prepayments - Product', 'Product', bal)])
  })
  SOLUTIONS.forEach((name, i) => p([mk(`21${String(i+1).padStart(2,'0')}`, name, 'asset', 'Prepayments - Services', 'Solutions and Services')]))
  a.push(mk('2121', 'Hardware Support',         'asset', 'Prepayments - Repair', 'Expert Repair Services'))
  a.push(mk('2122', 'Software Support',         'asset', 'Prepayments - Repair', 'Expert Repair Services'))
  a.push(mk('2131', 'Other Prepayments',        'asset', 'Prepayments - Other',  'Other Prepayments'))

  // ── CASH & CASH EQUIVALENTS ───────────────────────────────────────────────────
  a.push(mk('2201', 'ABSA Bank',                'asset', 'Cash at Bank',  'Cash at Bank', 1_640_000))
  a.push(mk('2202', 'Equity Bank',              'asset', 'Cash at Bank',  'Cash at Bank', 490_000))
  a.push(mk('2211', 'Petty Cash / Mobile Money','asset', 'Cash in Hand',  'Cash in Hand', 385_000))

  // ── PAYABLES (CREDITORS) ─────────────────────────────────────────────────────
  // Consolidated dynamic AP (computed from outstanding vendor bills)
  a.push(mk('3000', 'Accounts Payable (Products)', 'liability', 'Payables - Product', 'Product', 0,
    { isDynamic: true, dynamicKey: 'ap', notes: 'Computed from outstanding vendor bills' }))
  PRODUCTS.forEach((name, i) => p([mk(`30${String(i+1).padStart(2,'0')}`, name, 'liability', 'Payables - Product', 'Product')]))
  SOLUTIONS.forEach((name, i) => p([mk(`31${String(i+1).padStart(2,'0')}`, name, 'liability', 'Payables - Services', 'Solutions and Services')]))
  a.push(mk('3121', 'Hardware Support',         'liability', 'Payables - Repair', 'Expert Repair Services'))
  a.push(mk('3122', 'Software Support',         'liability', 'Payables - Repair', 'Expert Repair Services'))
  a.push(mk('3131', 'Other Creditors (Payables)', 'liability', 'Payables - Other', 'Other Creditors'))

  // ── ACCRUALS ─────────────────────────────────────────────────────────────────
  a.push(mk('3201', 'Accruals',                 'liability', 'Accruals', 'Accruals'))

  // ── STATUTORY & OTHER CURRENT LIABILITIES ────────────────────────────────────
  a.push(mk('3301', 'Output VAT Payable (16%)', 'liability', 'Statutory Liabilities', 'Current Liabilities', 89_000))
  a.push(mk('3302', 'PAYE Payable — KRA',       'liability', 'Statutory Liabilities', 'Current Liabilities', 48_600))
  a.push(mk('3303', 'NSSF Payable',             'liability', 'Statutory Liabilities', 'Current Liabilities', 24_300))
  a.push(mk('3304', 'NHIF / SHIF Payable',      'liability', 'Statutory Liabilities', 'Current Liabilities', 12_000))

  // ── NON-CURRENT LIABILITIES ───────────────────────────────────────────────────
  a.push(mk('3401', 'Bank Loan',                'liability', 'Non-Current Liabilities', 'Non-Current Liabilities', 800_000))
  a.push(mk('3402', 'Directors Account',        'liability', 'Non-Current Liabilities', 'Non-Current Liabilities', 396_000))

  // ── EQUITY ───────────────────────────────────────────────────────────────────
  a.push(mk('4001', 'Share Capital',            'equity', 'Equity', 'Equity', 3_000_000))
  a.push(mk('4002', 'Retained Earnings',        'equity', 'Equity', 'Equity', 1_140_000))
  a.push(mk('4003', 'Current Year P&L',         'equity', 'Equity', 'Equity', 0,
    { isDynamic: true, dynamicKey: 'net_profit', notes: 'Computed from P&L statement' }))

  // ── REVENUE ──────────────────────────────────────────────────────────────────
  a.push(mk('5000', 'Sales — Products (Invoices)', 'revenue', 'Revenue - Products', 'Product', 0,
    { isDynamic: true, dynamicKey: 'revenue', notes: 'Computed from customer invoices' }))
  PRODUCTS.forEach((name, i) => p([mk(`50${String(i+1).padStart(2,'0')}`, name, 'revenue', 'Revenue - Products', 'Product')]))
  SOLUTIONS.forEach((name, i) => p([mk(`51${String(i+1).padStart(2,'0')}`, name, 'revenue', 'Revenue - Solutions', 'Solutions and Services')]))
  a.push(mk('5121', 'Hardware Support', 'revenue', 'Revenue - Repair', 'Expert Repair Services', 180_600))
  a.push(mk('5122', 'Software Support', 'revenue', 'Revenue - Repair', 'Expert Repair Services', 36_000))
  a.push(mk('5099', 'Sales Returns & Refunds', 'revenue', 'Revenue - Products', 'Product', 0, { notes: 'Contra account — debit entries reduce revenue' }))

  // ── OTHER INCOME ─────────────────────────────────────────────────────────────
  a.push(mk('5201', 'Dividends and Interest',         'revenue', 'Other Income', 'Other Income', 8_400))
  a.push(mk('5202', 'Commission',                     'revenue', 'Other Income', 'Other Income', 4_000))
  a.push(mk('5203', 'Profit / Surplus on Disposal of Assets', 'revenue', 'Other Income', 'Other Income'))
  a.push(mk('5204', 'Bad Debts Recovered',            'revenue', 'Other Income', 'Other Income'))
  a.push(mk('5205', 'Discount Received',              'revenue', 'Other Income', 'Other Income'))

  // ── LOCAL PURCHASES ───────────────────────────────────────────────────────────
  PRODUCTS.forEach((name, i) => {
    const bal = name === 'Laptops' ? 120_000 : name === 'Accessories' ? 35_000
      : name === 'Networking Equipment' ? 28_700 : 0
    p([mk(`61${String(i+1).padStart(2,'0')}`, name, 'expense', 'Local Purchases', 'Local Purchases', bal)])
  })

  // ── IMPORT PURCHASES ──────────────────────────────────────────────────────────
  PRODUCTS.forEach((name, i) => {
    const bal = name === 'Laptops' ? 24_800 : name === 'Servers' ? 0 : 0
    p([mk(`62${String(i+1).padStart(2,'0')}`, name, 'expense', 'Import Purchases', 'Import Purchases', bal)])
  })

  // ── DIRECT EXPENSES ───────────────────────────────────────────────────────────
  a.push(mk('6301', "Solutions and Expert Repair Services' Costs", 'expense', 'Direct Expenses', 'Direct Expenses'))
  a.push(mk('6302', 'Direct Salaries',     'expense', 'Direct Expenses', 'Direct Expenses', 0, { isDynamic: true, dynamicKey: 'salaries', notes: 'Computed from payroll journals' }))
  a.push(mk('6303', 'Direct Wages',        'expense', 'Direct Expenses', 'Direct Expenses'))
  a.push(mk('6304', 'Direct Commission',   'expense', 'Direct Expenses', 'Direct Expenses'))

  // ── OTHER DIRECT EXPENSES ─────────────────────────────────────────────────────
  a.push(mk('6401', 'Selling and Delivery',   'expense', 'Other Direct Expenses', 'Other Direct Expenses'))
  a.push(mk('6402', 'Packaging Expenses',     'expense', 'Other Direct Expenses', 'Other Direct Expenses'))

  // ── OPERATING & ADMINISTRATIVE EXPENSES ──────────────────────────────────────
  a.push(mk('6501', 'Advertisement and Promotion',               'expense', 'Operating Expenses', 'Operating and Administrative', 3_000))
  a.push(mk('6502', 'Auditors Remuneration',                     'expense', 'Operating Expenses', 'Operating and Administrative', 2_000))
  a.push(mk('6503', 'Computer Expenses',                         'expense', 'Operating Expenses', 'Operating and Administrative', 1_200))
  a.push(mk('6504', 'Printing and Stationery',                   'expense', 'Operating Expenses', 'Operating and Administrative', 1_200))
  a.push(mk('6505', 'Repairs and Maintenance',                   'expense', 'Operating Expenses', 'Operating and Administrative', 1_000))
  a.push(mk('6506', 'Water and Electricity',                     'expense', 'Operating Expenses', 'Operating and Administrative', 4_800))
  a.push(mk('6507', 'Fuel and Transport',                        'expense', 'Operating Expenses', 'Operating and Administrative', 2_400))
  a.push(mk('6508', 'Rent and Service Charge',                   'expense', 'Operating Expenses', 'Operating and Administrative', 18_000))
  a.push(mk('6509', 'Legal Expenses',                            'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6510', 'Telephone and Internet',                    'expense', 'Operating Expenses', 'Operating and Administrative', 2_400))
  a.push(mk('6511', 'Subsistence and Accommodation',             'expense', 'Operating Expenses', 'Operating and Administrative', 1_200))
  a.push(mk('6512', 'Bad Debts Written Off',                     'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6513', 'Provision for Bad and Doubtful Debts',      'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6514', 'Gifts and Donations',                       'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6515', 'Loss on Disposal of Assets',                'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6516', 'Management Fees',                           'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6517', 'Depreciation and Amortization',             'expense', 'Operating Expenses', 'Operating and Administrative', 9_200))
  a.push(mk('6518', 'Office Expenses',                           'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6519', 'Courier and Delivery',                      'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6520', 'Discount Allowed',                          'expense', 'Operating Expenses', 'Operating and Administrative'))
  a.push(mk('6521', 'Expensed Assets',                           'expense', 'Operating Expenses', 'Operating and Administrative'))

  // ── EMPLOYMENT EXPENSES ────────────────────────────────────────────────────────
  a.push(mk('6601', 'Salaries',                            'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6602', 'Wages',                               'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6603', 'Commission',                          'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6604', 'Staff Bonus',                         'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6605', 'Training Expenses',                   'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6606', 'Contribution to Pension Fund (NSSF)', 'expense', 'Employment Expenses', 'Employment Expenses', 1_440))
  a.push(mk('6607', 'Leave Encashment',                    'expense', 'Employment Expenses', 'Employment Expenses'))
  a.push(mk('6608', 'Any Other Employment Costs',          'expense', 'Employment Expenses', 'Employment Expenses'))

  // ── FINANCIAL EXPENSES ────────────────────────────────────────────────────────
  a.push(mk('6701', 'Interest Expense',                            'expense', 'Financial Expenses', 'Financial Expenses'))
  a.push(mk('6702', 'Commitment Fees',                             'expense', 'Financial Expenses', 'Financial Expenses'))
  a.push(mk('6703', 'Bank Charges',                                'expense', 'Financial Expenses', 'Financial Expenses', 900))
  a.push(mk('6704', 'Insurance',                                   'expense', 'Financial Expenses', 'Financial Expenses', 2_400))
  a.push(mk('6705', 'Realized and Unrealized Exchange Loss',       'expense', 'Financial Expenses', 'Financial Expenses'))

  return a
}

const seedAccounts: Account[] = buildSeedAccounts()

const seedContacts: Contact[] = []

const seedCompanies: Company[] = []

const seedContactPersons: ContactPerson[] = []

const seedOpportunities: Opportunity[] = []

const seedQuotes: Quote[] = []

const seedCustomerContracts: CustomerContract[] = []

const seedOpportunityActivities: OpportunityActivity[] = []

const seedDepartments: Department[] = [
  { id: 'HR', name: 'HR', description: 'Human resources and people operations' },
  { id: 'Sales', name: 'Sales', description: 'Sales and revenue operations' },
  { id: 'Marketing', name: 'Marketing', description: 'Marketing and demand generation' },
  { id: 'Finance', name: 'Finance', description: 'Finance, accounting, and controls' },
  { id: 'Engineering', name: 'Engineering', description: 'Engineering and technical delivery' },
  { id: 'Logistics & Supply Chain Management', name: 'Logistics & Supply Chain Management', description: 'Logistics, procurement, warehousing, and supply chain' },
  { id: 'Strategy & R&D', name: 'Strategy & R&D', description: 'Strategy, research, and development' },
  { id: 'Administration', name: 'Administration', description: 'Administration and office operations' },
  { id: 'Circular Computing Centre', name: 'Circular Computing Centre', description: 'Circular computing centre operations' },
  { id: 'Managed IT Services', name: 'Managed IT Services', description: 'Managed IT services delivery' },
  { id: 'AI & Automation', name: 'AI & Automation', description: 'AI, automation, and workflow transformation' },
  { id: 'Training & Certification', name: 'Training & Certification', description: 'Training, certification, and enablement' },
  { id: 'ESG & Sustainability', name: 'ESG & Sustainability', description: 'ESG reporting and sustainability programs' },
  { id: 'Investor Relations & Capital Raising', name: 'Investor Relations & Capital Raising', description: 'Investor relations and capital raising' },
  { id: 'Regional Expansion / New Markets', name: 'Regional Expansion / New Markets', description: 'Regional expansion and new market development' },
  { id: 'Deed Foundation', name: 'Deed Foundation', description: 'Deed Foundation programs and impact initiatives' },
]

const seedEmployees: Employee[] = []

const seedContracts: Contract[] = []

const seedLeaveBalances: LeaveBalance[] = []

const seedLeaveRequests: LeaveRequest[] = []

const seedHRDocuments: HRDocument[] = []

const seedWorkflowApprovals: WorkflowApproval[] = []

const seedPayrollRuns: PayrollRun[] = []

const seedPayslips: Payslip[] = []

const seedJournalEntries: JournalEntry[] = []

const seedEmployeeAssetAssignments: EmployeeAssetAssignment[] = []

const seedJobPostings: JobPosting[] = []
const seedCandidates: Candidate[] = []
const seedTrainingPrograms: TrainingProgram[] = []
const seedEmployeeTrainings: EmployeeTraining[] = []

const seedProducts: Product[] = []

const seedSerials: SerialNumber[] = []

const seedPOs: PurchaseOrder[] = []

const seedReceipts: Receipt[] = []

const seedTransfers: StockTransfer[] = []

// Refurbishment seed — devices received with issues, awaiting tech assignment
const seedRefurbishmentJobs: RefurbishmentJob[] = []

// SO seed

const seedSOs: SaleOrder[] = []

const seedRiders: Rider[] = []

const seedDeliveryJobs: DeliveryJob[] = []

const seedDeliveries: Delivery[] = []

const seedWarranties: Warranty[] = []


const seedInvoices: Invoice[] = []

const seedBulkStock: BulkStockLevel[] = []

const seedRepairs: RepairOrder[] = []

// ── SOP seed data ─────────────────────────────────────────────────────────────
const seedSOPs: SOP[] = []
const seedSopActuals: SOPActual[] = []
const seedRefSOPs: RefSOP[] = []

// ── Expense seed data ─────────────────────────────────────────────────────────
const seedExpenses: Expense[] = []

// ── Outsource seed data ───────────────────────────────────────────────────────
const seedOutsourceVendors: OutsourceVendor[] = []

const seedOutsourceJobs: OutsourceJob[] = []

const seedOutsourcePayments: OutsourcePayment[] = []

// ─── Server sync (debounced, 500ms) ──────────────────────────────────────────
const _pendingSync: Record<string, string> = {}
let _syncTimer: ReturnType<typeof setTimeout> | null = null
let _syncInstalled = false
let _serverHydrated = false
export const SYNC_STATUS_EVENT = 'deed_sync_status'
export const LAST_SYNC_AT_LS = 'deed_last_synced_at'

// ── Dirty key tracking ────────────────────────────────────────────────────────
// Persisted in localStorage so a page-reload still knows which keys need to be
// pushed to the server before accepting remote state — even after _pendingSync
// was cleared from memory (e.g. the tab was closed while offline).
export const DIRTY_KEYS_LS = 'deed_dirty_keys'

type SyncStage = 'idle' | 'syncing' | 'synced' | 'error' | 'conflict'

function emitSyncStatus(stage: SyncStage, extras?: { skippedKeys?: string[]; message?: string }) {
  if (typeof window === 'undefined') return
  const pendingKeys = Object.keys(_pendingSync).length
  const lastSyncedAt = window.localStorage.getItem(LAST_SYNC_AT_LS) || null
  window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, {
    detail: {
      stage,
      pendingKeys,
      lastSyncedAt,
      skippedKeys: extras?.skippedKeys ?? [],
      message: extras?.message ?? '',
      timestamp: new Date().toISOString(),
    },
  }))
}

function getDirtyKeys(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set()
    const raw = localStorage.getItem(DIRTY_KEYS_LS)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

function addDirtyKey(key: string) {
  try {
    const keys = getDirtyKeys()
    keys.add(key)
    localStorage.setItem(DIRTY_KEYS_LS, JSON.stringify([...keys]))
  } catch {}
}

function removeDirtyKeys(keys: string[]) {
  try {
    const dirty = getDirtyKeys()
    keys.forEach(k => dirty.delete(k))
    localStorage.setItem(DIRTY_KEYS_LS, JSON.stringify([...dirty]))
  } catch {}
}

async function flushServerSync() {
  if (Object.keys(_pendingSync).length === 0) return
  const entries = { ..._pendingSync }
  emitSyncStatus('syncing')
  // Do NOT clear _pendingSync before the fetch resolves — keeping entries here
  // blocks applyRemoteState from overwriting local changes with a stale SSE push
  // that arrives during the in-flight window.
  try {
    const res = await fetch('/api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    })
    if (res.status === 401) {
      // Session expired — redirect to login so user can re-authenticate and data re-syncs on next mount
      if (typeof window !== 'undefined') window.location.href = '/login'
      return
    }
    if (res.status === 403) {
      // Every key in the batch was permission-denied. Drop them from the retry
      // queue — retrying can never succeed for this session and a stuck queue
      // blocks later legitimate writes from flushing.
      const payload = await res.json().catch(() => null) as { deniedKeys?: string[] } | null
      const denied = payload?.deniedKeys ?? Object.keys(entries)
      denied.forEach(k => { if (_pendingSync[k] === entries[k]) delete _pendingSync[k] })
      removeDirtyKeys(denied)
      emitSyncStatus('error', { message: `Your role cannot save: ${denied.join(', ')}` })
      return
    }
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`)
    const payload = await res.json().catch(() => null) as { skippedKeys?: string[]; deniedKeys?: string[] } | null
    // Only remove from _pendingSync once the server has confirmed receipt.
    // If a newer write arrived for the same key while in-flight, leave it.
    Object.keys(entries).forEach(k => {
      if (_pendingSync[k] === entries[k]) delete _pendingSync[k]
    })
    removeDirtyKeys(Object.keys(entries))
    // Draft quotation line edits are local until Save. Keep deed_saleOrders
    // dirty/pending so SSE + Prisma boot cannot restore deleted products.
    if (hasSaleOrderDraftEdits()) {
      addDirtyKey('deed_saleOrders')
      try {
        const local = typeof window !== 'undefined' ? window.localStorage.getItem('deed_saleOrders') : null
        if (local) _pendingSync['deed_saleOrders'] = local
      } catch { /* ignore */ }
    }
    if (typeof window !== 'undefined') {
      const syncedAt = new Date().toISOString()
      window.localStorage.setItem(LAST_SYNC_AT_LS, syncedAt)
    }
    const skippedKeys = payload?.skippedKeys ?? []
    if (skippedKeys.length > 0) {
      emitSyncStatus('conflict', {
        skippedKeys,
        message: 'Server rejected stale local data for protected keys.',
      })
      return
    }
    emitSyncStatus('synced')
  } catch {
    // offline or failed — entries remain in _pendingSync for retry on next debouncedServerSync call
    emitSyncStatus('error', { message: 'Unable to sync pending changes. Retry will happen automatically.' })
  }
}

export function debouncedServerSync(key: string, value: string) {
  _pendingSync[key] = value
  addDirtyKey(key)
  emitSyncStatus('syncing')
  if (_syncTimer) clearTimeout(_syncTimer)
  _syncTimer = setTimeout(flushServerSync, 500)

  // Register beforeunload once so data always syncs when the user closes/navigates away
  if (typeof window !== 'undefined' && !_syncInstalled) {
    _syncInstalled = true
    window.addEventListener('beforeunload', () => {
      if (Object.keys(_pendingSync).length === 0) return
      const entries = { ..._pendingSync }
      const body = JSON.stringify(entries)
      // sendBeacon is fire-and-forget and survives page unload
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' })
        navigator.sendBeacon('/api/store', blob)
      } else {
        sync('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      }
    })
  }
}

// ─── Persistence helper ───────────────────────────────────────────────────────
// ─── Profile image compression (max 200×200px, ~80 KB) ───────────────────────
function compressProfileImage(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 200
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
      const w = Math.round(img.width * ratio)
      const h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      // Compress until under 80 KB
      let q = 0.82
      let result = canvas.toDataURL('image/jpeg', q)
      while (result.length > 80 * 1024 && q > 0.2) {
        q = Math.round((q - 0.1) * 10) / 10
        result = canvas.toDataURL('image/jpeg', q)
      }
      resolve(result)
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// ─── Fetch freshness helpers (5-minute stale cache) ─────────────────────────
const FETCH_STALE_MS = 5 * 60 * 1000
function isFresh(key: string): boolean {
  try {
    const ts = localStorage.getItem(`${key}__ts`)
    return !!ts && Date.now() - Number(ts) < FETCH_STALE_MS
  } catch { return false }
}
function stampCache(key: string) {
  try { localStorage.setItem(`${key}__ts`, String(Date.now())) } catch {}
}

/**
 * Persists state to localStorage under the given key.
 * Falls back to `seed` on first load or if storage is unavailable.
 * Also syncs changes back to the server via a debounced POST.
 *
 * Array seeds reject non-array stored JSON (common corruption that used to
 * crash the authenticated shell with a blank white page after login).
 */
function useLS<T>(
  key: string,
  seed: T,
  opts?: { mergeRemote?: (local: T, remote: T) => T },
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return seed
    try {
      const stored = window.localStorage.getItem(key)
      const { value, corrupted } = parseStoredState(stored, seed)
      if (corrupted) {
        try { window.localStorage.removeItem(key) } catch { /* ignore */ }
      }
      return value
    } catch {
      return seed
    }
  })

  const isFirstRender = useRef(true)
  const skipNextSync = useRef(false)
  const mergeRemoteRef = useRef(opts?.mergeRemote)
  mergeRemoteRef.current = opts?.mergeRemote

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }
    let serialized: string | undefined
    try { serialized = JSON.stringify(state) } catch { return }
    // Skip localStorage for large values — avoids quota errors and slow reads/writes.
    // The server (app_state) and SSE still keep this data in sync across devices.
    if (serialized.length <= 512 * 1024) {
      try { window.localStorage.setItem(key, serialized) } catch { /* quota exceeded */ }
    } else {
      try { window.localStorage.removeItem(key) } catch { /* ignore */ }
    }
    debouncedServerSync(key, serialized)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const seedRef = useRef(seed)
  seedRef.current = seed

  // Listen for cross-device updates (from our polling) or cross-tab updates
  useEffect(() => {
    const handleUpdate = (newValue: string) => {
      const { value, corrupted } = parseStoredState(newValue, seedRef.current)
      if (corrupted) {
        try { window.localStorage.removeItem(key) } catch { /* ignore */ }
        return
      }
      skipNextSync.current = true
      setState(prev => {
        const merge = mergeRemoteRef.current
        return merge ? merge(prev, value) : value
      })
    }
    const handleStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) handleUpdate(e.newValue)
    }
    const handleCustom = (e: CustomEvent) => {
      if (e.detail?.key === key && e.detail?.value) handleUpdate(e.detail.value)
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('deed_remote_update', handleCustom as EventListener)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('deed_remote_update', handleCustom as EventListener)
    }
  }, [key])

  return [state, setState]
}

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

// Fire-and-forget server sync — swallows network errors so local state is never blocked
const sync = (url: string, opts: RequestInit) => fetch(url, opts).catch(() => {})

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
      _pendingSync['deed_saleOrders'] = serialized
      addDirtyKey('deed_saleOrders')
      if (typeof window !== 'undefined' && serialized.length <= 512 * 1024) {
        window.localStorage.setItem('deed_saleOrders', serialized)
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
  opts?: { syncLines?: boolean },
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

export function StoreProvider({
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

    // Recovery pass: if browser cache is empty OR missing rows the server has
    // (common after creating an outsource job on another tab/device), pull/merge
    // server truth so Jobs lists stay complete.
    const reconcileCriticalVisibilityKeys = async () => {
      // One batched GET instead of 5 sequential /api/store/<key> round-trips.
      try {
        const res = await fetch(`/api/store?keys=${encodeURIComponent(CRITICAL_VISIBILITY_KEYS.join(','))}`)
        if (!res.ok) return
        const state = await res.json().catch(() => null) as Record<string, unknown> | null
        if (!state || typeof state !== 'object') return
        for (const key of CRITICAL_VISIBILITY_KEYS) {
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
            window.localStorage.setItem(key, nextStr)
            window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key, value: nextStr } }))
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
    if (serverState && Object.keys(serverState).length > 0 && !_serverHydrated) {
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
            const localCount = arrayCount(localStr)
            const remoteCount = arrayCount(remoteStr)
            const missingRemoteRows = CRITICAL_VISIBILITY_KEY_SET.has(k) && remoteHasMissingIds(localStr, remoteStr)
            const shouldRecoverFromStaleEmpty = localCount === 0 && typeof remoteCount === 'number' && remoteCount > 0
            if (!shouldRecoverFromStaleEmpty && !missingRemoteRows) continue // local unsynced write — server state is stale for this key
            // Recover from stale-empty / incomplete local cache and clear dirty flag.
            removeDirtyKeys([k])
            if (missingRemoteRows && localStr && typeof localCount === 'number' && localCount > 0) {
              const merged = mergeArrayById(localStr, remoteStr)
              window.localStorage.setItem(k, merged)
              window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key: k, value: merged } }))
              continue
            }
          }
          if (localStr !== remoteStr) {
            window.localStorage.setItem(k, remoteStr)
            window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key: k, value: remoteStr } }))
          }
        } catch { /* quota — ignore */ }
      }
      _serverHydrated = true
      emitSyncStatus('idle')
    }

    const applyRemoteState = (remoteState: Record<string, unknown>) => {
      const pendingKeys = new Set(Object.keys(_pendingSync))
      const dirtyKeys   = getDirtyKeys()
      for (const [k, v] of Object.entries(remoteState)) {
        if (!k.startsWith('deed_')) continue
        // Skip keys that have an unconfirmed local write — unless local array is stale-empty
        // and server has non-empty data (recover visibility after backup restores).
        const remoteStr = typeof v === 'string' ? v : JSON.stringify(v)
        const local = window.localStorage.getItem(k)
        if (pendingKeys.has(k) || dirtyKeys.has(k)) {
          const localCount = arrayCount(local)
          const remoteCount = arrayCount(remoteStr)
          const missingRemoteRows = CRITICAL_VISIBILITY_KEY_SET.has(k) && remoteHasMissingIds(local, remoteStr)
          const shouldRecoverFromStaleEmpty = localCount === 0 && typeof remoteCount === 'number' && remoteCount > 0
          if (!shouldRecoverFromStaleEmpty && !missingRemoteRows) continue
          removeDirtyKeys([k])
          if (missingRemoteRows && local && typeof localCount === 'number' && localCount > 0) {
            const merged = mergeArrayById(local, remoteStr)
            window.localStorage.setItem(k, merged)
            window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key: k, value: merged } }))
            continue
          }
        }
        if (local !== remoteStr) {
          window.localStorage.setItem(k, remoteStr)
          window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key: k, value: remoteStr } }))
        }
      }
    }

    // 2. SSE stream for real-time store updates
    const source = new EventSource('/api/store/stream')

    source.addEventListener('store', (e: Event) => {
      try {
        const { state } = JSON.parse((e as MessageEvent).data)
        if (state) applyRemoteState(state)
      } catch { /* malformed message — ignore */ }
    })

    // EventSource reconnects automatically on errors — no extra handling needed

    // 2b. When the network comes back, immediately flush any queued writes so data
    //     reaches the server without waiting for the next user interaction.
    const handleOnline = () => void flushServerSync()
    window.addEventListener('online', handleOnline)

    // 3. Sync users list (stored in DB, not app_state) — much less frequent
    const syncUsers = async () => {
      try {
        const res = await fetch('/api/users')
        if (!res.ok) return
        const data = await res.json()
        const fetched = Array.isArray(data) ? data : (Array.isArray(data.users) ? data.users : null)
        if (fetched) {
          setUsers(prev => JSON.stringify(prev) !== JSON.stringify(fetched)
            ? fetched.map((u: any) => ({ ...u, modules: Array.isArray(u.modules) ? [...u.modules] : [] }))
            : prev)
        }
      } catch {}
    }
    syncUsers()
    const usersId = setInterval(syncUsers, 60_000) // Users change rarely — sync every minute

    return () => {
      source.close()
      clearInterval(usersId)
      window.removeEventListener('online', handleOnline)
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
  useEffect(() => { setSidebarOpen(window.innerWidth >= 768) }, [])
  const [toast, setToast] = useState<AppState['toast']>(null)

  // Legacy & CRM
  const [contacts, setContacts] = useLS<Contact[]>('deed_contacts', seedContacts)
  const [companiesRaw, setCompanies] = useLS<Company[]>('deed_companies', seedCompanies)
  // Server rows arrive in the Prisma `clients` shape (no status, string
  // creditLimit) via boot fetch, app_state sync, or old localStorage snapshots.
  // Normalize once here so every consumer sees a well-formed Company.
  const companies = useMemo(() => normalizeCompaniesForClient(companiesRaw) as Company[], [companiesRaw])
  const [contactPersons, setContactPersons] = useLS<ContactPerson[]>('deed_contactPersons', seedContactPersons)
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
  const refreshProductCatalog = useCallback(() => {
    fetch('/api/products?lite=1')
      .then(r => (r.ok ? r.json() : null))
      .then((rows: any[] | null) => {
        if (!Array.isArray(rows) || rows.length === 0) return
        setProducts(prev => {
          const merged = mergeCatalogProducts(prev, rows, CATEGORY_CONFIG, { preserveClientOrder: true })
          return JSON.stringify(merged) === JSON.stringify(prev) ? prev : merged
        })
      })
      .catch(() => {})
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

  const HR_ROLES = ['director', 'finance_officer']
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
  const [dbApprovalRules, setDbApprovalRules] = useState<Array<{ approvalType: string; thresholds: { maxValue: number; requiredRoles: string[] }[]; isActive: boolean }>>([])
  // One-time bump: previous default was 100_000 with no settings UI; raise stored value to 1_000_000.
  useEffect(() => {
    if (systemSettings.accAdminOfficerInvoiceLimitKes === 100000) {
      setSystemSettings(prev => ({ ...prev, accAdminOfficerInvoiceLimitKes: 1000000 }))
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
  const [bulkStock, setBulkStock]           = useLS<BulkStockLevel[]>('deed_bulkStock', seedBulkStock)
  const [openingStockPosted, setOpeningStockPosted] = useLS<boolean>('deed_openingStockPosted', false)
  
  const [stockMoves, setStockMoves] = useState<StockMove[]>([])

  // Heal lock when OPENING moves already exist (ops seed / missed flag sync).
  const openingStockLocked = isOpeningStockLocked(openingStockPosted, stockMoves)
  useEffect(() => {
    if (!openingStockPosted && stockMoves.some(isOpeningStockMove)) {
      setOpeningStockPosted(true)
    }
  }, [openingStockPosted, stockMoves, setOpeningStockPosted])
  
  const [stockAdjustments, setStockAdjustments] = useLS<StockAdjustment[]>('deed_stockAdjustments', [])
  const [stockReservations, setStockReservations] = useLS<StockReservation[]>('deed_stockReservations', [])

  // Route-scoped Prisma boot + idle prefetch of the rest (cuts cold-start fan-out).
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
          case 'products':
            refreshProductCatalog()
            break
          case 'contacts': {
            const results = await Promise.allSettled([
              fetch('/api/contacts').then(r => r.ok ? r.json() : null),
              fetch('/api/companies').then(r => r.ok ? r.json() : null),
              fetch('/api/contact-persons').then(r => r.ok ? r.json() : null),
            ])
            const val = (r: PromiseSettledResult<unknown>) =>
              r.status === 'fulfilled' && r.value != null ? r.value : null
            const [dc, dco, dcp] = results.map(val) as any[]
            if (dc) setContacts(Array.isArray(dc) ? dc : (dc.items ?? []))
            if (dco) setCompanies(Array.isArray(dco) ? dco : (dco.items ?? []))
            if (dcp) setContactPersons(Array.isArray(dcp) ? dcp : (dcp.items ?? []))
            break
          }
          case 'sales': {
            const results = await Promise.allSettled([
              fetch('/api/quotes').then(r => r.ok ? r.json() : null),
              fetch('/api/sale-orders?limit=200').then(r => r.ok ? r.json() : null),
            ])
            const val = (r: PromiseSettledResult<unknown>) =>
              r.status === 'fulfilled' && r.value != null ? r.value : null
            const [dq, dso] = results.map(val) as any[]
            if (dq) setQuotes(Array.isArray(dq) ? normalizeQuotesForClient(dq) as Quote[] : [])
            if (dso) {
              const incoming = normalizeSaleOrdersForClient(
                Array.isArray(dso) ? dso : (dso.items ?? []),
              ) as SaleOrder[]
              setSaleOrders(prev => mergeSaleOrdersPreservingDraftEdits(prev, incoming))
            }
            break
          }
          case 'crm': {
            const results = await Promise.allSettled([
              fetch('/api/opportunities').then(r => r.ok ? r.json() : null),
              fetch('/api/opportunity-activities').then(r => r.ok ? r.json() : null),
            ])
            const val = (r: PromiseSettledResult<unknown>) =>
              r.status === 'fulfilled' && r.value != null ? r.value : null
            const [dopp, doa] = results.map(val) as any[]
            if (dopp) setOpportunities(Array.isArray(dopp) ? normalizeOpportunitiesForClient(dopp) as Opportunity[] : [])
            if (doa) setOpportunityActivities(Array.isArray(doa) ? doa : [])
            break
          }
          case 'repairs': {
            const data = await fetch('/api/repairs?limit=200').then(r => r.ok ? r.json() : null)
            const list = Array.isArray(data) ? data : (data?.items ?? null)
            if (Array.isArray(list)) {
              setRepairs(prev => JSON.stringify(prev) === JSON.stringify(list) ? prev : list)
            }
            break
          }
          case 'employees': {
            const d = await fetch('/api/employees').then(r => r.ok ? r.json() : null)
            if (d) useHrDomainStore.getState().setEmployees(Array.isArray(d) ? d : (d.items ?? []))
            break
          }
          case 'leave':
            await fetchLeave()
            break
          case 'payroll': {
            if (!['director', 'finance_officer'].includes(initialUser.role)) break
            const data = await fetch('/api/payroll').then(r => r.ok ? r.json() : null)
            if (data?.runs) setPayrollRuns(data.runs)
            if (data?.payslips) setPayslips(data.payslips)
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
            const d = await fetch('/api/stock-moves?limit=200').then(r => r.ok ? r.json() : null)
            if (d) setStockMoves(Array.isArray(d) ? d : (d.items ?? []))
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

    // Only warm high-traffic groups in the background — full remainingBoot
    // fan-out competed with the user's first clicks after login.
    const PRIORITY_IDLE: BootApiGroup[] = ['products', 'contacts', 'sales', 'crm']
    const idleGroups = remainingBootApiGroups(immediate).filter(g => PRIORITY_IDLE.includes(g))
    let idleHandle: number | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const prefetchIdle = () => { void Promise.all(idleGroups.map(runGroup)) }
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleHandle = window.requestIdleCallback(prefetchIdle, { timeout: 12000 })
    } else {
      idleTimer = setTimeout(prefetchIdle, 8000)
    }

    // Managers need periodic leave refresh; SSE covers most real-time cases.
    let leaveInterval: ReturnType<typeof setInterval> | undefined
    if (['director', 'admin_officer'].includes(initialUser.role)) {
      leaveInterval = setInterval(fetchLeave, 60_000)
    }

    const onRoute = (e: Event) => {
      const nextPath = (e as CustomEvent).detail?.pathname
      if (typeof nextPath !== 'string') return
      void Promise.all(bootApiGroupsForRoute(nextPath).map(runGroup))
    }
    window.addEventListener('deed_route_change', onRoute as EventListener)

    return () => {
      if (idleHandle !== undefined && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle)
      if (idleTimer) clearTimeout(idleTimer)
      if (leaveInterval) clearInterval(leaveInterval)
      window.removeEventListener('deed_route_change', onRoute as EventListener)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUser?.id, initialUser?.role, refreshProductCatalog])

  // POS
  const [posOrders, setPosOrders]           = useLS<POSOrder[]>('deed_posOrders', []) // To be migrated
  const [posSessionOpen, setPosSessionOpen] = useLS<boolean>('deed_posSessionOpen', false)
  const [posSessionOpeningCash, setPosSessionOpeningCash] = useLS<number>('deed_posSessionOpeningCash', 0)
  const [posSessionId, setPosSessionId] = useLS<string | null>('deed_posSessionId', null)
  const [posSessions, setPosSessions] = useLS<POSSession[]>('deed_posSessions', [])

  // Approvals & Audit
  const [approvalRequests, setApprovalRequests] = useLS<ApprovalRequest[]>('deed_approvalRequests', [])
  const [auditLogs, setAuditLogs]               = useLS<AuditLog[]>('deed_auditLogs', []) // To be migrated
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
      setHoldovers(prev => {
        if (!Array.isArray(prev) || prev.length === 0) return legacy as Holdover[]
        const ids = new Set(prev.map(h => h.id))
        const missing = (legacy as Holdover[]).filter(h => h?.id && !ids.has(h.id))
        return missing.length ? [...missing, ...prev] : prev
      })
      window.localStorage.removeItem('deed_holdovers_v1')
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
  }, [])

  // ── Internal notification pusher (single-recipient compat + multi fan-out) ──
  const notifyUsers = useCallback((input: NotifyUsersInput) => {
    setNotifications(prev => buildNotifyRows(prev, input, uid).next)
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

  const syncRepairToPortal = useCallback((r: RepairOrder, historyNote?: string) => {
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
  const accountRef = useRef(accounts);  accountRef.current = accounts
  const serialRef = useRef(serials);    serialRef.current = serials
  const repairsRef = useRef(repairs); repairsRef.current = repairs
  const soRef      = useRef(saleOrders); soRef.current   = saleOrders
  const invRef    = useRef(invoices);  invRef.current    = invoices
  const poRef     = useRef(purchaseOrders); poRef.current = purchaseOrders
  const recRef    = useRef(receipts);   recRef.current    = receipts
  const purchaseReturnsRef = useRef(purchaseReturns); purchaseReturnsRef.current = purchaseReturns
  const warRef    = useRef(warranties); warRef.current    = warranties
  const delRef    = useRef(deliveries); delRef.current    = deliveries
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

  // Feed the per-year document sequencer (docSeq) every ref currently in use,
  // so QUO/SO/PI/DN/INV/RCT/CN/PO numbers continue from the loaded data
  // instead of a per-browser counter.
  registerDocRefSource(() => [
    ...soRef.current.flatMap(s => [s.ref, s.quotationRef, s.proformaRef]),
    ...quotesRef.current.flatMap((q: any) => [q.ref, q.quoteNumber]),
    ...invRef.current.map(i => i.ref),
    ...delRef.current.map(d => d.ref),
    ...recRef.current.map(r => r.ref),
    ...paymentsRef.current.map((p: any) => p.receiptNumber),
    ...poRef.current.map(p => p.ref),
    ...customerCreditsRef.current.map(c => c.ref),
  ])

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
        ref: seq('DON', 'don'),
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
      setDonations(p => [don, ...p])
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
      ref: seq('BBK', 'bbk'),
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
  useEffect(() => {
    setProducts(prev => {
      let changed = false
      const next = prev.map(product => {
        const locs = calcStockByLocation(product, serials, bulkStock, product.id)
        const stockQty = locs.warehouse + locs.shop + locs.repair_unit
        if (product.stockQty === stockQty) return product
        changed = true
        return { ...product, stockQty }
      })
      return changed ? next : prev
    })
  }, [serials, bulkStock])

  // Poll portal every 20 s for quote approval decisions — auto-applies them to ERP state
  useEffect(() => {
    const check = async () => {
      const pending = repairsRef.current.filter(r => r.status === 'awaiting_approval')
      for (const repair of pending) {
        try {
          const res = await fetch(`/api/portal/repair/${encodeURIComponent(repair.ref)}`)
          if (!res.ok) continue
          const { repair: p } = await res.json()
          if (!p || (p.status !== 'approved' && p.status !== 'declined')) continue
          const approved = p.status === 'approved'
          let serverRepair: RepairOrder | undefined
          const repairRes = await fetch(`/api/repairs?q=${encodeURIComponent(repair.ref)}`)
          if (repairRes.ok) {
            const serverRepairs = await repairRes.json().catch(() => [])
            if (Array.isArray(serverRepairs)) serverRepair = serverRepairs.find((item: RepairOrder) => item.id === repair.id || item.ref === repair.ref)
          }
          setRepairs(prev => prev.map(r => {
            if (r.id !== repair.id || r.status !== 'awaiting_approval') return r
            if (serverRepair) return serverRepair
            return {
              ...r,
              status: approved ? 'approved' : 'declined',
              quote: r.quote ? {
                ...r.quote,
                ...(approved
                  ? { approvedDate: p.quote?.approvedDate ?? now(), approvedBy: 'customer' }
                  : { rejectedDate: p.quote?.rejectedDate ?? now(), rejectionReason: p.quote?.rejectionReason }),
              } : r.quote,
            }
          }))
          if (repair.assignedTechnicianId) {
            notifyUsers({
              recipients: [repair.assignedTechnicianId],
              type: 'repair',
              title: approved ? '✅ Quote approved by customer' : '❌ Quote declined by customer',
              body: `${repair.ref} — ${repair.productName}`,
              module: 'repair',
              path: `?id=${repair.id}`,
              icon: approved ? '✅' : '❌',
              entityKey: `repair:${repair.id}:portal_quote`,
            })
          }
          setAuditLogs(prev => [{
            id: uid(), date: now(), user: 'portal',
            action: approved ? 'quote_approved_portal' : 'quote_declined_portal',
            documentRef: repair.id,
            details: approved ? 'Customer approved quote via tracking portal' : `Customer declined: ${p.quote?.rejectionReason ?? ''}`,
          }, ...prev])
        } catch { /* silent */ }
      }
    }
    const id = setInterval(check, 60_000) // Portal approvals: SSE is primary, this is a fallback
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      .reduce((sum, inv) => sum + Math.max(0, inv.total - inv.amountPaid), 0)

  const addMove = (productId: string, productName: string, qty: number, type: StockMove['type'], reason: string, docRef: string, fromLoc?: LocationId, toLoc?: LocationId, serNums: string[] = []) => {
    const actor = currentUser()
    const move: StockMove = { id: uid(), type, productId, productName, qty, reason, fromLocation: fromLoc, toLocation: toLoc, serialNumbers: serNums, date: now(), userId: actor?.id ?? 'system', documentRef: docRef }
    setStockMoves(p => [move, ...p])
    sync('/api/stock-moves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(move) })
  }

  const currentUser = () => currentUserId ? users.find(u => u.id === currentUserId) ?? null : null

  const addAuditLog = (action: string, documentRef: string, details: string) => {
    const actor = currentUser()?.username || 'system'
    const log: AuditLog = { id: uid(), date: now(), user: actor, action, documentRef, details }
    setAuditLogs(p => [log, ...p])
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
    const journal = buildInvoicePostingJournal(
      inv,
      (productId) => prodRef.current.find(p => p.id === productId),
      accountRef.current.map(a => ({ code: a.code, name: a.name })),
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
    prepareDelivery: (...args: Parameters<AppState['prepareDelivery']>) => storeCtxRef.current!.prepareDelivery(...args),
    validateDelivery: (...args: Parameters<AppState['validateDelivery']>) => storeCtxRef.current!.validateDelivery(...args),
    markDeliveryNoteGenerated: (...args: Parameters<AppState['markDeliveryNoteGenerated']>) => storeCtxRef.current!.markDeliveryNoteGenerated(...args),
    deleteSaleOrder: (...args: Parameters<AppState['deleteSaleOrder']>) => storeCtxRef.current!.deleteSaleOrder(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    getStockByLocation: (...args: Parameters<AppState['getStockByLocation']>) => storeCtxRef.current!.getStockByLocation(...args),
    resetSOToDraft: (...args: Parameters<AppState['resetSOToDraft']>) => storeCtxRef.current!.resetSOToDraft(...args),
    cancelSO: (...args: Parameters<AppState['cancelSO']>) => storeCtxRef.current!.cancelSO(...args),
    createNewSOVersion: (...args: Parameters<AppState['createNewSOVersion']>) => storeCtxRef.current!.createNewSOVersion(...args),
    getCustomerCreditStatus: (...args: Parameters<AppState['getCustomerCreditStatus']>) => storeCtxRef.current!.getCustomerCreditStatus(...args),
    confirmDeliveryWithStockDeduction: (...args: Parameters<AppState['confirmDeliveryWithStockDeduction']>) => storeCtxRef.current!.confirmDeliveryWithStockDeduction(...args),
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
    reviewPortalPayment: (...args: Parameters<AppState['reviewPortalPayment']>) => storeCtxRef.current!.reviewPortalPayment(...args),
    getVisibleRepairs: (...args: Parameters<AppState['getVisibleRepairs']>) => storeCtxRef.current!.getVisibleRepairs(...args),
    updateRepairProgress: (...args: Parameters<AppState['updateRepairProgress']>) => storeCtxRef.current!.updateRepairProgress(...args),
    moveRepairToPreviousProgress: (...args: Parameters<AppState['moveRepairToPreviousProgress']>) => storeCtxRef.current!.moveRepairToPreviousProgress(...args),
    requestProcurement: (...args: Parameters<AppState['requestProcurement']>) => storeCtxRef.current!.requestProcurement(...args),
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
    registerPayment: (...args: Parameters<AppState['registerPayment']>) => storeCtxRef.current!.registerPayment(...args),
    setInvoicePaymentBlocked: (...args: Parameters<AppState['setInvoicePaymentBlocked']>) => storeCtxRef.current!.setInvoicePaymentBlocked(...args),
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
    setModule: (...args: Parameters<AppState['setModule']>) => storeCtxRef.current!.setModule(...args),
    showToast: (...args: Parameters<AppState['showToast']>) => storeCtxRef.current!.showToast(...args),
    updateKilimallOrder: (...args: Parameters<AppState['updateKilimallOrder']>) => storeCtxRef.current!.updateKilimallOrder(...args),
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
    getCustomerCreditBalance: (customerId) => {
      return customerCreditsRef.current
        .filter(c => c.customerId === customerId && ['available', 'partially_used'].includes(c.status))
        .reduce((sum, credit) => sum + Math.max(0, credit.balance), 0)
    },
    applyCustomerCreditToInvoice: (invoiceId, requestedAmount) => {
      const actor = currentUser()
      if (!canManageFullFinanceAction(actor)) {
        showToast('Only Finance or Director can apply customer credit', 'error')
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
      setCustomerCredits(nextCredits)

      const payment: InvoicePayment = {
        id: uid(),
        date: appliedAt,
        amount: applied,
        method: 'customer_credit',
        reference: applications.map(a => a.ref).join(', '),
        recordedBy: appliedBy,
      }
      const updatedInvoice: Invoice = {
        ...inv,
        amountPaid: inv.amountPaid + applied,
        payments: [...(inv.payments ?? []), payment],
        notes: `${inv.notes || ''}\nApplied customer credit ${applications.map(a => `${a.ref} (${fmtKes(a.amount)})`).join(', ')}`.trim(),
      }
      setInvoices(prev => prev.map(i => i.id === inv.id ? updatedInvoice : i))
      sync(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedInvoice) })
      setJournalEntries(prev => [buildCustomerCreditApplicationJournal(inv, applied, applications.map(a => a.ref).join(', ')), ...prev])
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
    createKilimallOrder: (p) => {
      const user = currentUser()
      if (!user || !['director', 'kilimall_officer', 'sales_rep'].includes(user.role)) {
        showToast('Unauthorized to create Kilimall orders', 'error'); return {} as KilimallOrder;
      }
      const order: KilimallOrder = {
        ...p, id: uid(), ref: seq('KO', 'ko'), status: 'pending',
        createdDate: now(), createdBy: currentUserId ?? 'system',
      }
      setKilimallOrders(prev => [order, ...prev])
      addAuditLog('kilimall_order_create', order.id, `Order ${order.ref} — ${order.kilimallRef}`)
      return order
    },
    updateKilimallOrder: (id, p) => setKilimallOrders(prev => prev.map(o => o.id === id ? { ...o, ...p } : o)),
    confirmKilimallDispatch: (orderId, serialId, serialNumber, opts) => {
      const user = currentUser()
      if (!user || !['director', 'inventory_officer', 'kilimall_officer'].includes(user.role)) {
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

      const dispatch: KilimallDispatch = {
        id: uid(), ref: seq('KD', 'kd'), date: now(),
        orderId: order.id, orderRef: order.ref, kilimallRef: order.kilimallRef,
        productId: shipProductId, productName: shipProductName,
        orderedProductId: isSubstitution ? order.productId : undefined,
        orderedProductName: isSubstitution ? order.productName : undefined,
        isSubstitution: isSubstitution || undefined,
        serialId, serialNumber, status: 'dispatched',
        notes: isSubstitution
          ? (opts?.substitutionReason?.trim() || `Substituted for ordered ${order.productName}`)
          : undefined,
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
      setSerials(prev => prev.map(s => s.id === serialId ? { ...s, status: 'sold', location: 'customer' } : s))
      const toastMsg = isSubstitution
        ? `Dispatched ${order.ref} — shipped ${shipProductName} (ordered ${order.productName})`
        : `Dispatched ${order.ref} — serial ${serialNumber}`
      showToast(toastMsg)
      addAuditLog(
        'kilimall_dispatch',
        dispatch.id,
        isSubstitution
          ? `Dispatch ${dispatch.ref} for ${order.ref}: substituted ${order.productName} → ${shipProductName}`
          : `Dispatch ${dispatch.ref} for ${order.ref}`,
      )
      return dispatch
    },
    createKilimallSettlement: (p) => {
      const user = currentUser()
      if (!user || !['director', 'finance_officer', 'kilimall_officer'].includes(user.role)) {
        showToast('Unauthorized to manage settlements', 'error'); return {} as KilimallSettlement;
      }
      const s: KilimallSettlement = {
        ...p, id: uid(), ref: seq('KS', 'ks'), status: 'draft',
        createdDate: now(), createdBy: currentUserId ?? 'system',
      }
      setKilimallSettlements(prev => [s, ...prev])
      return s
    },
    updateKilimallSettlement: (id, p) => setKilimallSettlements(prev => prev.map(s => s.id === id ? { ...s, ...p } : s)),
    reconcileKilimallSettlement: (settlementId) => {
      const user = currentUser()
      if (!user || !['director', 'finance_officer', 'kilimall_officer'].includes(user.role)) {
        showToast('Unauthorized to reconcile settlements', 'error'); return;
      }
      const settlement = kilimallSettlementsRef.current.find(s => s.id === settlementId)
      if (!settlement) return
      const orders = kilimallOrdersRef.current
      const updatedLines = settlement.lines.map(line => {
        const match = orders.find(o => o.kilimallRef === line.kilimallRef)
        if (!match) return { ...line, status: 'unmatched' as const }
        if (match.status === 'returned') return { ...line, status: 'returned' as const, orderId: match.id, erpAmount: match.total }
        const diff = Math.abs(line.amount - match.total)
        if (diff > 1) return { ...line, status: 'mismatch' as const, orderId: match.id, erpAmount: match.total }
        return { ...line, status: 'matched' as const, orderId: match.id, erpAmount: match.total }
      })
      // link matched orders to this settlement
      updatedLines.filter(l => l.status === 'matched' || l.status === 'mismatch').forEach(l => {
        if (l.orderId) setKilimallOrders(prev => prev.map(o =>
          o.id === l.orderId ? { ...o, settlementId: settlement.id, settlementRef: settlement.ref } : o))
      })
      setKilimallSettlements(prev => prev.map(s => s.id === settlementId
        ? { ...s, lines: updatedLines, status: 'reconciled' } : s))
      const matched = updatedLines.filter(l => l.status === 'matched').length
      showToast(`Reconciliation complete — ${matched}/${updatedLines.length} matched`)
      addAuditLog('kilimall_reconcile', settlementId, `Settlement ${settlement.ref} reconciled`)
    },

    notifications, profileImages,
    markNotificationRead: (id) => {
      setNotifications(prev => markNotificationReadInList(prev, id))
    },
    markAllNotificationsRead: () => {
      const uid = currentUserId
      if (!uid) return
      setNotifications(prev => markAllNotificationsReadForUser(prev, uid))
    },
    clearReadNotifications: () => {
      const uid = currentUserId
      if (!uid) return
      setNotifications(prev => clearReadNotificationsForUser(prev, uid))
    },
    setProfileImage: (userId, dataUrl) => {
      compressProfileImage(dataUrl).then(compressed => {
        setProfileImages(prev => ({ ...prev, [userId]: compressed }))
      })
    },

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
      const stmtLines = bankStatementLines.filter(
        l => l.bankAccountId === bankAccountId && l.month === month && !l.matchedEntryId
      )
      const usedEntries = new Set(
        bankStatementLines
          .filter(l => l.bankAccountId === bankAccountId && l.month === month && l.matchedEntryId)
          .map(l => l.matchedEntryId as string)
      )
      let matched = 0
      const newLines = bankStatementLines.map(stmt => {
        if (stmt.bankAccountId !== bankAccountId || stmt.month !== month || stmt.matchedEntryId) return stmt
        // Find best cashbook entry match
        const direction = stmt.credit > 0 ? 'credit' : 'debit'
        const stmtAmt   = direction === 'credit' ? stmt.credit : stmt.debit
        let best: { id: string; score: number } | null = null
        for (const entry of cashbookEntries) {
          if (usedEntries.has(entry.id)) continue
          const entryAmt = direction === 'credit' ? entry.credit : entry.debit
          if (entryAmt === 0) continue
          const amtDiff  = Math.abs(entryAmt - stmtAmt)
          const dayDiff  = Math.abs(new Date(entry.date).getTime() - new Date(stmt.date).getTime()) / 86400000
          if (amtDiff <= 1 && dayDiff <= 5) {
            const score = amtDiff * 10 + dayDiff
            if (!best || score < best.score) best = { id: entry.id, score }
          }
        }
        if (best) {
          usedEntries.add(best.id)
          matched++
          return { ...stmt, matchedEntryId: best.id }
        }
        return stmt
      })
      setBankStatementLines(newLines)
      return matched
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
    updateCompanySettings: (p) => setCompanySettings(prev => ({ ...prev, ...p })),
    systemSettings,
    updateSystemSettings: (p) => setSystemSettings(prev => ({ ...prev, ...p })),

    sopDocuments,
    saveSopDocuments: setSopDocuments,
    sops, sopActuals,

    hrSops,
    hrPerfTargets,
    saveHrSops: setHrSops,
    saveHrPerfTargets: setHrPerfTargets,

    createSOP: (s) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      const sop: SOP = { ...s, id: uid(), createdByUserId: user.id, createdByName: user.name, createdAt: now() }
      setSops(prev => [...prev, sop])
      showToast('SOP created', 'success')
      return sop
    },

    updateSOP: (id, p) => {
      setSops(prev => prev.map(s => s.id === id ? { ...s, ...p } : s))
      showToast('SOP updated', 'success')
    },

    deleteSOP: (id) => {
      setSops(prev => prev.filter(s => s.id !== id))
      showToast('SOP deleted', 'info')
    },

    setSopActual: (sopId, metricId, periodKey, actual, notes) => {
      const user = currentUser()
      if (!user) return
      setSopActuals(prev => {
        const existing = prev.findIndex(a => a.sopId === sopId && a.metricId === metricId && a.periodKey === periodKey)
        const entry: SOPActual = { id: uid(), sopId, metricId, periodKey, actual, notes, updatedByUserId: user.id, updatedByName: user.name, updatedDate: now() }
        if (existing >= 0) return prev.map((a, i) => i === existing ? entry : a)
        return [...prev, entry]
      })
    },

    refSops,
    addRefSop: (s) => {
      const user = currentUser()
      const doc: RefSOP = { ...s, id: uid(), updatedAt: now(), createdByName: user?.name ?? 'Admin' }
      setRefSops(p => [doc, ...p])
      showToast('Document added to Reference Library')
    },
    updateRefSop: (id, p) => {
      setRefSops(prev => prev.map(s => s.id === id ? { ...s, ...p, updatedAt: now() } : s))
      showToast('Document updated')
    },
    deleteRefSop: (id) => {
      setRefSops(p => p.filter(s => s.id !== id))
      showToast('Document deleted')
    },

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
        ref: seq('EXP', 'exp'),
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
        }).catch(() => { /* non-blocking — receipt upload failure is silent */ })
      }
      setExpenses(prev => [expense, ...prev])
      // Notify finance / director approvers (not the submitter)
      notifyUsers({
        recipients: userIdsWithRoles(users, ['director', 'finance_officer'], user.id),
        type: 'expense',
        title: `Expense claim from ${expense.submittedByName}`,
        body: `${expense.ref} — ${expense.description} · KES ${expense.amount.toLocaleString()}`,
        module: 'expenses',
        icon: '💰',
        entityKey: `expense:${expense.id}:submitted`,
        excludeUserId: user.id,
      })
      showToast(`Expense ${expense.ref} submitted`, 'success')
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
      if (expense.status === 'reimbursed') { showToast('Reimbursed expenses cannot be reviewed again', 'error'); return }

      const chain = expense.approvalChain
      if (chain?.length) {
        if (!canUserApproveExpenseStep(user.role, chain)) {
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

    reimburseExpense: (id, notes, method, bankAccountId, reference) => {
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
      const reimbursedExpense: Expense = {
        ...expense,
        status: 'reimbursed',
        reviewNotes: notes ?? expense.reviewNotes,
        reimbursementMethod: method,
        reimbursementBankAccount: actualBankId,
        reimbursementReference: reference,
      }
      setExpenses(prev => prev.map(e => e.id === id ? reimbursedExpense : e))
      if (!journalEntries.some(j => j.ref === `JRN/RIM/${expense.ref}`)) {
        const journal = buildExpenseReimbursementJournal(reimbursedExpense, actualBankId)
        setJournalEntries(prev => [journal, ...prev])
        addAuditLog('post_reimbursement', expense.ref, `Expense reimbursement ${expense.ref} posted to journal ${journal.ref}${reference ? ` (Ref: ${reference})` : ''}`)
      }
      showToast('Expense reimbursed and posted', 'success')
    },

    outsourceVendors, outsourceJobs, outsourcePayments,

    addOutsourceVendor: (v) => {
      const vendor: OutsourceVendor = { ...v, id: uid(), createdAt: now() }
      setOutsourceVendors(prev => [...prev, vendor])
      // Also create a vendor contact so they appear in the Contacts module
      const contactPayload: Omit<Contact, 'id' | 'createdAt'> = {
        type: 'company',
        name: v.name,
        phone: v.phone,
        email: v.email ?? '',
        address: v.address ?? '',
        isCustomer: false,
        isVendor: true,
        tags: ['outsource-vendor'],
        notes: v.notes,
      }
      fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactPayload),
      }).then(r => r.ok && r.json().then(c => setContacts(p => [c, ...p]))).catch(() => {})
      showToast('Vendor added', 'success')
      return vendor
    },

    updateOutsourceVendor: (id, p) => {
      setOutsourceVendors(prev => prev.map(v => v.id === id ? { ...v, ...p } : v))
    },

    addOutsourceJob: (j) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      const linkedRepair = j.repairOrderId ? repairsRef.current.find(r => r.id === j.repairOrderId) : undefined
      if (j.repairOrderId) {
        if (!linkedRepair) {
          showToast('Linked repair was not found', 'error')
          return null
        }
        const existing = getActiveOutsourceJob(j.repairOrderId)
        if (existing) {
          showToast(`Repair is already outsourced via ${existing.ref}. Mark it returned before sending out again.`, 'error')
          return null
        }
        if (['ready', 'verified_released', 'collected', 'closed', 'cancelled', 'declined', 'unrepairable', 'returned'].includes(linkedRepair.status)) {
          showToast('This repair is already closed or cannot be outsourced at this stage', 'error')
          return null
        }
        const readiness = repairOutsourceReadiness(linkedRepair)
        if (!readiness.ok) {
          showToast(readiness.reason, 'error')
          return null
        }
      }
      const nextOutNum = outsourceJobsRef.current.reduce((max, x) => {
        const n = parseInt(x.ref.replace(/^OUT\//, ''), 10)
        return isNaN(n) ? max : Math.max(max, n)
      }, 0) + 1
      const job: OutsourceJob = {
        ...j,
        id: uid(),
        ref: `OUT/${String(nextOutNum).padStart(4, '0')}`,
        sentByUserId: user.id,
        sentByName: user.name,
        previousRepairStatus: linkedRepair?.status,
        status: 'sent',
        createdAt: now(),
      }
      setOutsourceJobs(prev => [job, ...prev])
      if (linkedRepair) {
        const lockedRepair = markRepairLockedForOutsource(linkedRepair, job)
        setRepairs(prev => prev.map(r => r.id === linkedRepair.id ? lockedRepair : r))
        syncRepairToPortal(lockedRepair, `Device sent to vendor — repair remains in progress until ${job.ref} is returned`)
        addAuditLog('outsource_repair', linkedRepair.id, `Repair locked in repair and sent to ${job.vendorName} via ${job.ref}`)
      }
      showToast(`Job ${job.ref} created`, 'success')

      // Notify technical leads (+ directors) — exclude actor; internal only
      const notifBody = `${job.ref}: ${job.deviceDescription} → ${job.vendorName} for ${OUTSOURCE_SERVICE_TYPES.find(t => t.value === job.serviceType)?.label ?? job.serviceType}. Sent by ${user.name}.`
      notifyUsers({
        recipients: userIdsWithRoles(users, ['technical_lead', 'director'], user.id),
        type: 'repair',
        title: 'Repair Outsourced',
        body: notifBody,
        module: 'outsource',
        icon: '🔧',
        entityKey: `outsource:${job.id}:created`,
        excludeUserId: user.id,
      })

      return job
    },

    returnOutsourceJob: (id, p) => {
      const job = outsourceJobsRef.current.find(j => j.id === id)
      if (!job) return

      let billId: string | undefined

      if (p.isResolved && p.finalCost && p.finalCost > 0) {
        const billRef = seq('BILL', 'inv')
        const billLine: InvoiceLine = {
          id: uid(),
          description: `Outsource Service: ${OUTSOURCE_SERVICE_TYPES.find(t => t.value === job.serviceType)?.label ?? job.serviceType} — ${job.deviceDescription}`,
          qty: 1,
          unitPrice: p.finalCost,
          taxRate: 0,
          subtotal: p.finalCost,
        }
        const bill: Invoice = {
          id: uid(),
          ref: billRef,
          type: 'vendor_bill',
          status: 'draft',
          partnerId: job.vendorId,
          partnerName: job.vendorName,
          date: now(),
          dueDate: addDays(now(), 30),
          lines: [billLine],
          subtotal: p.finalCost,
          taxTotal: 0,
          total: p.finalCost,
          amountPaid: 0,
          notes: `Outsource job ${job.ref} — ${job.deviceDescription}`,
        }
        billId = bill.id
        setInvoices(prev => [bill, ...prev])
        sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bill) })
        showToast(`Vendor bill ${billRef} created for ${job.vendorName}`, 'success')
      }

      setOutsourceJobs(prev => prev.map(j =>
        j.id === id
          ? { ...j, ...p, status: p.isResolved ? 'returned_resolved' : 'returned_unresolved', ...(billId ? { billId } : {}) }
          : j
      ))

      if (job.repairOrderId) {
        const repair = repairsRef.current.find(r => r.id === job.repairOrderId)

        const resumeStatus: RepairStatus = 'qc'

        if (p.isResolved) {
          const qcItems = prepareRepairQcItemsForRound(repair?.qcItems, uid)
          const returnedRepair = repair ? {
            ...repair,
            status: resumeStatus,
            repairCompletedDate: repair.repairCompletedDate ?? now(),
            qcItems,
            qcFailReason: undefined,
            qcFailedDate: undefined,
            qcFailedBy: undefined,
            qcPassedDate: undefined,
            qcApprovedBy: undefined,
            statusHistory: [
              ...(repair.statusHistory ?? []),
              {
                status: resumeStatus,
                date: now(),
                note: `Outsource job ${job.ref} returned fixed from ${job.vendorName}; moved to QC`,
                by: job.sentByName,
              },
            ],
          } : null
          setRepairs(prev => prev.map(r =>
            r.id === job.repairOrderId && returnedRepair ? returnedRepair : r
          ))
          if (returnedRepair) syncRepairToPortal(returnedRepair, `Outsource job ${job.ref} returned fixed — repair moved to QC`)
          addAuditLog('advance_repair', job.repairOrderId, `Outsource job ${job.ref} returned resolved; repair resumed at ${resumeStatus}`)

          // Notify assigned tech + TL/director (exclude actor)
          notifyUsers({
            recipients: [
              repair?.assignedTechnicianId,
              ...userIdsWithRoles(users, ['director', 'technical_lead']),
            ],
            type: 'repair',
            title: repair?.assignedTechnicianId ? 'Outsource returned — repair resumed' : `Outsource job ${job.ref} resolved`,
            body: repair?.assignedTechnicianId
              ? `${job.ref}: ${job.deviceDescription} came back fixed from ${job.vendorName}. Repair ${repair.ref} resumed at ${resumeStatus}.`
              : `${job.deviceDescription} returned fixed from ${job.vendorName}. ${repair ? `Repair ${repair.ref} resumed at ${resumeStatus}.` : ''}`,
            module: repair?.assignedTechnicianId ? 'repair' : 'outsource',
            icon: '✅',
            entityKey: `outsource:${job.id}:returned_ok`,
            excludeUserId: currentUserId,
          })
        } else {
          // Unresolved — apply next-step to the linked repair
          const nextStep = p.repairNextStep ?? 'keep'
          if (repair) {
            const newStatus = nextStep === 'unrepairable' ? 'unrepairable' as const
              : nextStep === 'in_repair' ? 'in_repair' as const
              : 'in_repair' as const
            const returnedRepair = {
              ...repair,
              status: newStatus,
              statusHistory: [
                ...(repair.statusHistory ?? []),
                {
                  status: newStatus,
                  date: now(),
                  note: `Outsource job ${job.ref} returned unresolved from ${job.vendorName}`,
                  by: job.sentByName,
                },
              ],
            }
            setRepairs(prev => prev.map(r =>
              r.id === job.repairOrderId ? returnedRepair : r
            ))
            syncRepairToPortal(returnedRepair, `Outsource job ${job.ref} returned unresolved`)
            addAuditLog('advance_repair', job.repairOrderId,
              `Status set to ${newStatus} after outsource job ${job.ref} returned unresolved`)
          }

          // Notify assigned tech + TL/director (exclude actor)
          const nextLabel = p.repairNextStep === 'unrepairable' ? 'marked unrepairable'
            : p.repairNextStep === 'in_repair' ? 'moved back to in-repair'
            : 'status unchanged'
          notifyUsers({
            recipients: [
              repair?.assignedTechnicianId,
              ...userIdsWithRoles(users, ['director', 'technical_lead']),
            ],
            type: 'repair',
            title: repair?.assignedTechnicianId ? 'Outsource returned — not fixed' : `Outsource job ${job.ref} unresolved`,
            body: repair?.assignedTechnicianId
              ? `${job.ref}: ${job.deviceDescription} came back unfixed from ${job.vendorName}. Repair ${repair?.ref ?? ''} ${nextLabel}.`
              : `${job.deviceDescription} returned unfixed from ${job.vendorName}. ${repair ? `Repair ${repair.ref} ${nextLabel}.` : ''}`,
            module: repair?.assignedTechnicianId ? 'repair' : 'outsource',
            icon: '⚠️',
            entityKey: `outsource:${job.id}:returned_bad`,
            excludeUserId: currentUserId,
          })
        }
      }

      if (!billId) showToast('Job marked as returned', 'success')
    },

    // Deposits
    deposits,
    createDeposit: async (d) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      const { initialPayment = 0, payMethod = 'cash', payRef, ...depositInput } = d
      const paid = Math.min(Math.max(Number(initialPayment) || 0, 0), depositInput.totalValue)
      const payment: DepositPayment | null = paid > 0 ? {
        id: uid(),
        date: now(),
        amount: paid,
        method: payMethod,
        ref: payRef || undefined,
        recordedBy: user.name,
      } : null
      const deposit: Deposit = {
        ...depositInput,
        id: uid(),
        ref: seq('DEP', 'dep'),
        totalPaid: paid,
        balance: Math.max(0, depositInput.totalValue - paid),
        status: paid >= depositInput.totalValue ? 'fully_paid' : paid > 0 ? 'partially_paid' : 'active',
        payments: payment ? [payment] : [],
        createdAt: now(),
        createdBy: user.name,
      }
      setDeposits(p => [deposit, ...p])
      if (payment) setJournalEntries(p => [buildDepositPaymentJournal(deposit, payment), ...p])
      sync('/api/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...depositInput,
          id: deposit.id,
          ref: deposit.ref,
          initialPayment: paid,
          payMethod,
          payRef,
        }),
      })
      // Auto-create a linked quotation-status Sale Order
      if (depositInput.items?.length) {
        const soLines = depositInput.items.map(item => ({
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
        const soRef = await storeCtxRef.current!.allocateDocRef('QUO')
        const so: SaleOrder = {
          id: uid(),
          ref: soRef,
          status: 'quotation',
          customerId: depositInput.customerId,
          customerName: depositInput.customerName,
          date: now(),
          validUntil: addDays(now(), 30),
          lines: soLines,
          ...calcSO(soLines),
          notes: `Linked to deposit ${deposit.ref}`,
          createdByUserId: user.id,
          createdByName: user.name,
        }
        setSaleOrders(p => [so, ...p])
        sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })
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
        setJournalEntries(prev => [buildDepositPaymentJournal(updatedDeposit!, paymentToSync!), ...prev])
        sync(`/api/deposits/${depositId}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: paymentToSync.amount,
            method: paymentToSync.method,
            ref: paymentToSync.ref,
          }),
        })
      }
      showToast('Payment recorded', 'success')
    },
    completeDeposit: (depositId) => {
      setDeposits(prev => prev.map(d =>
        d.id === depositId ? { ...d, status: 'completed' as DepositStatus, completedAt: now() } : d
      ))
      sync(`/api/deposits/${depositId}/complete`, { method: 'POST' })
      showToast('Deposit marked as collected', 'success')
    },
    cancelDeposit: (depositId, reason) => {
      const deposit = deposits.find(d => d.id === depositId)
      if (deposit && deposit.totalPaid > 0) {
        const refundJournal: JournalEntry = {
          id: uid(), ref: `JRN/REFUND/${deposit.ref}`,
          date: now(), source: 'manual',
          description: `Deposit refund — ${deposit.ref} (cancelled: ${reason})`, status: 'posted',
          lines: [
            { id: uid(), account: '3100 - Customer Deposits', description: `Reverse deposit liability: ${deposit.ref}`, debit: deposit.totalPaid, credit: 0 },
            { id: uid(), account: '2211 - Petty Cash / Mobile Money', description: `Refund payable: ${deposit.ref}`, debit: 0, credit: deposit.totalPaid },
          ],
          totalDebit: deposit.totalPaid, totalCredit: deposit.totalPaid,
        }
        setJournalEntries(p => [refundJournal, ...p])
      }
      setDeposits(prev => prev.map(d =>
        d.id === depositId ? { ...d, status: 'cancelled' as DepositStatus, cancelledAt: now(), cancelReason: reason } : d
      ))
      sync(`/api/deposits/${depositId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      showToast('Deposit cancelled', 'info')
    },

    // Holdovers — synced via useLS('deed_holdovers') → app_state
    holdovers,
    addHoldover: (h) => {
      setHoldovers(prev => [h, ...prev])
      try { window.localStorage.removeItem('deed_holdovers_v1') } catch { /* ignore */ }
      showToast(`${h.ref} issued to ${h.clientName}`, 'success')
    },
    updateHoldover: (id, patch) => {
      setHoldovers(prev => prev.map(h => (h.id === id ? { ...h, ...patch } : h)))
    },

    recordOutsourcePayment: (p) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      const nextPayNum = outsourcePaymentsRef.current.reduce((max, x) => {
        const n = parseInt(x.ref.replace(/^OPAY\//, ''), 10)
        return isNaN(n) ? max : Math.max(max, n)
      }, 0) + 1
      const payment: OutsourcePayment = {
        ...p,
        id: uid(),
        ref: `OPAY/${String(nextPayNum).padStart(4, '0')}`,
        paidByUserId: user.id,
        paidByName: user.name,
        createdAt: now(),
      }
      setOutsourcePayments(prev => [payment, ...prev])
      showToast(`Payment ${payment.ref} recorded`, 'success')
      return payment
    },

    // ── Outbound Release Checkpoint ─────────────────────────────────────────
    outboundReleases,

    initRelease: (p) => {
      const user = currentUser()
      const ref = seq('ORC', 'orc')
      const release: OutboundRelease = {
        id: uid(), ref,
        invoiceId: p.invoiceId, repairId: p.repairId, deliveryNoteId: p.deliveryNoteId,
        clientId: p.clientId, clientName: p.clientName,
        sourceRef: p.sourceRef, sourceType: p.sourceType,
        status: 'pending',
        initiatedById: user?.id ?? '', initiatedByName: user?.name ?? '',
        initiatedAt: now(),
        items: p.serials.map(s => ({
          id: uid(), releaseId: '', // filled by setter
          serialNumberId: s.serialNumberId, expectedSerial: s.expectedSerial,
          status: 'picked' as ItemReleaseStatus,
        })),
        auditLog: [{ id: uid(), releaseId: '', action: 'initiated', toStatus: 'pending', performedById: user?.id ?? '', performedByName: user?.name ?? '', performedAt: now() }],
        createdAt: now(), updatedAt: now(),
      }
      // Fix nested releaseId references
      release.items = release.items.map(i => ({ ...i, releaseId: release.id }))
      release.auditLog = release.auditLog.map(l => ({ ...l, releaseId: release.id }))
      setOutboundReleases(prev => [release, ...prev])
      fetch('/api/outbound-releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: release.id,
          ref: release.ref,
          invoiceId: release.invoiceId,
          repairId: release.repairId,
          deliveryNoteId: release.deliveryNoteId,
          clientId: release.clientId,
          serials: release.items.map(item => ({
            id: item.id,
            serialNumberId: item.serialNumberId,
            expectedSerial: item.expectedSerial,
          })),
        }),
      })
        .then(async res => {
          if (!res.ok) return null
          return res.json()
        })
        .then(serverRelease => {
          if (!serverRelease) return
          setOutboundReleases(prev => prev.map(item => {
            if (item.id !== release.id) return item
            return {
              ...item,
              ref: serverRelease.ref ?? item.ref,
              items: Array.isArray(serverRelease.items) && serverRelease.items.length
                ? item.items.map(localItem => {
                    const serverItem = serverRelease.items.find((i: any) => i.id === localItem.id || i.expectedSerial === localItem.expectedSerial)
                    return serverItem ? { ...localItem, id: serverItem.id, releaseId: release.id } : localItem
                  })
                : item.items,
            }
          }))
        })
        .catch(() => { /* app_state/local release remains available offline */ })
      showToast(`Release ${ref} initiated`)
      return release
    },

    pickRelease: (id) => {
      const user = currentUser()
      setOutboundReleases(prev => prev.map(r => {
        if (r.id !== id || r.status !== 'pending') return r
        const log: OrcLogEntry = { id: uid(), releaseId: id, action: 'all_picked', fromStatus: 'pending', toStatus: 'all_picked', performedById: user?.id ?? '', performedByName: user?.name ?? '', performedAt: now() }
        const updated = { ...r, status: 'all_picked' as ReleaseStatus, updatedAt: now(), auditLog: [...r.auditLog, log] }
        sync(`/api/outbound-releases/${id}/pick`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user?.id }) })
        return updated
      }))
    },

    verifyReleaseItem: (releaseId, itemId, confirmedSerial) => {
      const user = currentUser()
      setOutboundReleases(prev => prev.map(r => {
        if (r.id !== releaseId) return r
        const items = r.items.map(i => {
          if (i.id !== itemId) return i
          return { ...i, confirmedSerial, serialMatched: confirmedSerial.trim().toLowerCase() === i.expectedSerial.trim().toLowerCase(), status: 'verified' as ItemReleaseStatus, verifiedById: user?.id, verifiedAt: now() }
        })
        return { ...r, items, updatedAt: now() }
      }))
    },

    completeVerification: (id, p) => {
      setOutboundReleases(prev => prev.map(r => {
        if (r.id !== id) return r
        const allVerified = r.items.every(i => i.status === 'verified')
        if (!allVerified) { showToast('All items must be verified before completing', 'error'); return r }
        const log: OrcLogEntry = { id: uid(), releaseId: id, action: 'verified', fromStatus: r.status, toStatus: 'verified', performedById: p.verifiedById, performedByName: p.verifiedByName, performedAt: now() }
        const updated = { ...r, status: 'verified' as ReleaseStatus, verifiedById: p.verifiedById, verifiedByName: p.verifiedByName, verifiedAt: now(), updatedAt: now(), auditLog: [...r.auditLog, log] }
        sync(`/api/outbound-releases/${id}/verify`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
        // Advance repair to verified_released
        if (r.repairId) {
          setRepairs((rs: any[]) => rs.map((rep: any) => rep.id === r.repairId ? { ...rep, status: 'verified_released' } : rep))
        }
        return updated
      }))
    },

    completeRelease: (id, p) => {
      const user = currentUser()
      setOutboundReleases(prev => prev.map(r => {
        if (r.id !== id || r.status !== 'verified') return r
        if (!p.receivedBy?.trim()) { showToast('Received-by name is required', 'error'); return r }
        const hasSignature = !!p.receiverSigData || (p.receiverSigMethod === 'paper' && !!p.receiverSigRef)
        if (!hasSignature) { showToast('Receiver signature is required', 'error'); return r }
        const releasedAt = now()
        const log: OrcLogEntry = { id: uid(), releaseId: id, action: 'released', fromStatus: 'verified', toStatus: 'released', performedById: user?.id ?? '', performedByName: user?.name ?? '', performedAt: releasedAt, notes: p.releaseNotes }
        const updated = { ...r, ...p, status: 'released' as ReleaseStatus, releasedAt, updatedAt: releasedAt, items: r.items.map(i => ({ ...i, status: 'released' as ItemReleaseStatus })), auditLog: [...r.auditLog, log] }
        sync(`/api/outbound-releases/${id}/release`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
        // Advance repair to collected
        if (r.repairId) {
          setRepairs((rs: any[]) => rs.map((rep: any) => {
            if (rep.id !== r.repairId) return rep
            const updatedRepair = {
              ...rep,
              status: 'collected',
              collectedDate: releasedAt,
              closedDate: releasedAt,
              conditionOnRelease: p.conditionOnRelease ?? rep.conditionOnRelease,
              deliveryRecipient: p.receivedBy,
              deliveryRecipientPhone: p.receivedByPhone,
              notes: p.releaseNotes ? `${rep.notes ? `${rep.notes}\n` : ''}ORC release: ${p.releaseNotes}` : rep.notes,
            }
            syncRepairToPortal(updatedRepair, `Device released to ${p.receivedBy}`)
            return updatedRepair
          }))
        }
        showToast(`${r.ref} released — items left the building`, 'success')
        return updated
      }))
    },

    voidRelease: (id, reason) => {
      const user = currentUser()
      setOutboundReleases(prev => prev.map(r => {
        if (r.id !== id || r.status === 'released' || r.status === 'voided') return r
        const log: OrcLogEntry = { id: uid(), releaseId: id, action: 'voided', fromStatus: r.status, toStatus: 'voided', performedById: user?.id ?? '', performedByName: user?.name ?? '', performedAt: now(), notes: reason }
        const updated = { ...r, status: 'voided' as ReleaseStatus, voidedById: user?.id, voidReason: reason, voidedAt: now(), updatedAt: now(), auditLog: [...r.auditLog, log] }
        sync(`/api/outbound-releases/${id}/void`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, userId: user?.id }) })
        if (r.repairId) {
          setRepairs((rs: any[]) => rs.map((rep: any) => rep.id === r.repairId && rep.status === 'verified_released' ? { ...rep, status: 'ready' } : rep))
        }
        showToast(`${r.ref} voided`)
        return updated
      }))
    },
    // ────────────────────────────────────────────────────────────────────────

    setModule: (m) => {
      const user = currentUser()
      if (!userHasModuleAccess(user, m)) {
        showToast('Access denied', 'error')
        addAuditLog('access_denied', m, `Denied access to ${m}`)
        return
      }
      setActiveModule(m)
      if (typeof window !== 'undefined') window.localStorage.setItem('activeModule', m)
      addAuditLog('navigate', m, `Navigated to ${m}`)
    },
    toggleSidebar: () => setSidebarOpen(v => !v),
    showToast,
    users, currentUserId, currentUser: currentUser(),
    login: async (username, password) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })

        if (!res.ok) {
          showToast('Invalid username or password', 'error')
          addAuditLog('login_failed', username, 'Failed login attempt')
          return false
        }

        window.location.href = '/'
        return true
      } catch {
        showToast('Unable to reach the authentication service', 'error')
        return false
      }
    },
    logout: async () => {
      const user = currentUser()
      if (user) addAuditLog('logout', user.username, 'User logged out')
      await fetch('/api/auth/logout', { method: 'POST' })
      setCurrentUserId(null)
      setActiveModule('dashboard')
      // P0-DEED-001 / SEC-004: purge business + draft keys on explicit logout
      try {
        const { purgeClientBusinessStorage } = await import('@/hooks/useFormDraft')
        purgeClientBusinessStorage()
      } catch {
        // ignore — still complete logout
      }
      showToast('Logged out')
      window.location.href = '/login'
    },
    createUser: async (u) => {
      const { ok, payload } = await requestCreateUser(u)

      if (!ok || !payload || !('user' in payload) || !payload.user) {
        const message = payload?.message ?? 'Unable to create user'
        showToast(message, 'error')
        throw new Error(message)
      }

      const user = payload.user as User
      setUsers(prev => [user, ...prev.filter(item => item.id !== user.id)])
      addAuditLog('create_user', user.username, `Created user ${user.name}`)

      const temporaryPassword = (payload as any).temporaryPassword as string | undefined
      const credentialDelivery = (payload as any).credentialDelivery
      if (temporaryPassword) {
        window.alert(`User created for ${user.name}.\n\nEmail delivery failed or no email address is available.\n\nTemporary password (share securely):\n\n${temporaryPassword}`)
      } else if (credentialDelivery?.success) {
        showToast(`User created and credentials emailed to ${user.email || user.name}`)
      } else {
        showToast(`User created for ${user.name}`)
      }
      return user
    },
    updateUser: async (id, p) => {
      const { ok, payload } = await requestUpdateUser(id, p)

      if (!ok || !payload || !('user' in payload) || !payload.user) {
        const message = payload?.message ?? 'Unable to update user'
        showToast(message, 'error')
        throw new Error(message)
      }

      const user = payload.user as User
      setUsers(prev => prev.map(item => item.id === id ? user : item))
      addAuditLog('update_user', id, `Updated user ${user.name}`)
      showToast('User profile updated')
    },
    unlockUser: async (id) => {
      const { ok, payload } = await requestUpdateUser(id, { unlock: true })

      if (!ok || !payload || !('user' in payload) || !payload.user) {
        const message = payload?.message ?? 'Unable to unlock user'
        showToast(message, 'error')
        throw new Error(message)
      }

      const user = payload.user as User
      setUsers(prev => prev.map(item => item.id === id ? user : item))
      addAuditLog('unlock_user', id, `Unlocked user ${user.username}`)
      showToast('User unlocked successfully')
    },
    deleteUser: async (id) => {
      const { ok, payload } = await requestDeleteUser(id)
      if (!ok) {
        const message = payload?.message ?? 'Unable to delete user'
        showToast(message, 'error')
        throw new Error(message)
      }
      setUsers(prev => prev.filter(u => u.id !== id))
      addAuditLog('delete_user', id, `Deleted user ${id}`)
      showToast('User deleted')
    },
    deactivateUser: async (id) => {
      const { ok, payload } = await requestDeactivateUser(id)
      if (!ok) {
        const message = payload?.message ?? 'Unable to deactivate user'
        showToast(message, 'error')
        throw new Error(message)
      }
      setUsers(prev => prev.map(u => u.id === id ? { ...u, active: false } : u))
      addAuditLog('deactivate_user', id, `Deactivated user ${id}`)
      showToast('User deactivated')
    },
    reactivateUser: async (id) => {
      const { ok, payload } = await requestReactivateUser(id)
      if (!ok) {
        const message = payload?.message ?? 'Unable to reactivate user'
        showToast(message, 'error')
        throw new Error(message)
      }
      setUsers(prev => prev.map(u => u.id === id ? { ...u, active: true } : u))
      addAuditLog('reactivate_user', id, `Reactivated user ${id}`)
      showToast('User reactivated')
    },
    resendCredentials: async (id) => {
      try {
        const res = await fetch(`/api/users/${id}/resend-credentials`, { method: 'POST' })
        const data = await res.json().catch(() => ({})) as any
        if (!res.ok) {
          showToast(data?.message || 'Failed to resend credentials', 'error')
          throw new Error(data?.message || 'resend failed')
        }
        const temporaryPassword = data.temporaryPassword as string | undefined
        if (temporaryPassword) {
          window.alert(`Credentials reset for ${data.user?.name || 'the user'}.\n\nEmail delivery failed or no email address is available.\n\nNew temporary password (share securely):\n\n${temporaryPassword}`)
        } else if (data.credentialDelivery?.success) {
          showToast(`Credentials reset and emailed to ${data.user?.email || data.user?.name || 'the user'}`)
        } else {
          showToast(`Credentials reset for ${data.user?.name || 'the user'}`)
        }
        addAuditLog('resend_credentials', id, `Resent credentials for user ${id}`)
        if (data.user) setUsers(prev => prev.map(u => u.id === id ? data.user as User : u))
      } catch (e) {
        // already toasted
        throw e
      }
    },
    hasModuleAccess: (module) => userHasModuleAccess(currentUser(), module),
    isSuperAdmin: () => currentUser()?.role === 'director',

    createPayrollRun: (month, year) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can prepare payroll', 'error'); throw new Error('Unauthorized payroll run creation') }
      const periodKey = `${year}-${month}`
      const recoveryUpdates = new Map<string, SalaryAdvance>()
      const lines = empRef.current.filter(emp => emp.status === 'active').map(emp => {
        // Statutory Kenyan payroll (NSSF tiers, SHIF, PAYE bands + personal relief)
        // rather than a flat deduction, so payslip figures are compliant.
        const breakdown = calculatePayroll(emp.basicSalary, emp.housingAllowance ?? 0, emp.transportAllowance ?? 0)
        const baseLine = {
          employeeId: emp.id,
          employeeName: emp.fullName,
          basicSalary: emp.basicSalary,
          allowances: (emp.housingAllowance ?? 0) + (emp.transportAllowance ?? 0),
          deductions: breakdown.totalDeductions,
          netPay: breakdown.netSalary,
        }
        const activeAdvances = salaryAdvancesRef.current.filter(advance =>
          advance.employeeId === emp.id &&
          advance.status === 'paid' &&
          advance.paymentTerms === 'payroll_deduction' &&
          advance.repaymentStartPeriod <= periodKey &&
          (advance.outstandingAmount ?? advance.amount) > 0 &&
          !(advance.deductions ?? []).some(deduction => deduction.period === periodKey)
        )
        const salaryAdvanceDeductions = activeAdvances.map(advance => {
          const outstanding = advance.outstandingAmount ?? advance.amount
          const deductionAmount = Math.min(advance.monthlyDeduction, outstanding)
          const remainingAfter = Math.max(0, outstanding - deductionAmount)
          recoveryUpdates.set(advance.id, {
            ...advance,
            amountRecovered: (advance.amountRecovered ?? 0) + deductionAmount,
            outstandingAmount: remainingAfter,
            status: remainingAfter <= 0 ? 'repaid' : advance.status,
            deductions: [
              ...(advance.deductions ?? []),
              { payrollRunId: '', period: periodKey, amount: deductionAmount, date: now() },
            ],
          })
          return { advanceId: advance.id, ref: advance.ref, amount: deductionAmount, remainingAfter }
        })
        const advanceDeductionTotal = salaryAdvanceDeductions.reduce((sum, deduction) => sum + deduction.amount, 0)
        return {
          ...baseLine,
          statutoryDeductions: baseLine.deductions,
          salaryAdvanceDeductions,
          deductions: baseLine.deductions + advanceDeductionTotal,
          netPay: baseLine.netPay - advanceDeductionTotal,
        }
      })
      const { totalGross, totalDeductions, totalNet } = aggregatePayroll(lines)
      const payroll: PayrollRun = { id: uid(), ref: `PAY/${year}/${month}`, month, year, status: 'pending_approval', lines, totalGross, totalDeductions, totalNet }
      setPayrollRuns(prev => [payroll, ...prev])
          
          const newPayslips = lines.map((line, index) => ({ id: uid(), ref: `PS/${year}/${month}/${String(index + 1).padStart(3, '0')}`, payrollRunId: payroll.id, employeeId: line.employeeId, employeeName: line.employeeName, month, year, grossPay: line.basicSalary + line.allowances, deductions: line.deductions, salaryAdvanceDeductions: line.salaryAdvanceDeductions, netPay: line.netPay, status: 'draft' as const, generatedDate: now(), downloadUrl: `/payslips/${year}-${month}-${line.employeeId}.pdf` }))
          setPayslips(prev => [...newPayslips, ...prev])
          if (recoveryUpdates.size > 0) {
            const payslipByEmployee = new Map(newPayslips.map(payslip => [payslip.employeeId, payslip.id]))
            const nextAdvances = salaryAdvancesRef.current.map(advance => {
              const updated = recoveryUpdates.get(advance.id)
              if (!updated) return advance
              return {
                ...updated,
                deductions: updated.deductions.map(deduction => deduction.payrollRunId
                  ? deduction
                  : { ...deduction, payrollRunId: payroll.id, payslipId: payslipByEmployee.get(updated.employeeId) }),
              }
            })
            salaryAdvancesRef.current = nextAdvances
            setSalaryAdvances(nextAdvances)
            // Persist each recovered advance (deductions/outstanding/status) to Prisma.
            recoveryUpdates.forEach((_v, advanceId) => {
              const persisted = nextAdvances.find(a => a.id === advanceId)
              if (persisted) sync(`/api/salary-advances/${advanceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deductions: persisted.deductions, amountRecovered: persisted.amountRecovered, outstandingAmount: persisted.outstandingAmount, status: persisted.status }) })
            })
          }
          sync('/api/payroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: payroll, payslips: newPayslips }) })
          
      setWorkflowApprovals(prev => [{ id: uid(), process: 'payroll', ref: payroll.ref, targetId: payroll.id, targetName: `Payroll ${month}/${year}`, stepName: 'Finance Approval', approverRole: 'finance_officer', status: 'pending', requestedBy: currentUser()?.name ?? 'HR', requestedDate: now() }, ...prev])
      addAuditLog('create_payroll', payroll.ref, `Payroll prepared for ${month}/${year}`)
      showToast('Payroll run created and sent for approval')
      return payroll
    },
    approvePayrollRun: (id) => {
      if (!canApprovePayroll(currentUser())) { showToast('Only Finance or HR approvers can approve payroll', 'error'); return }
      const payroll = payrollRef.current.find(run => run.id === id)
      if (!payroll) return
          setPayrollRuns(prev => {
            const next = prev.map(run => run.id === id ? { ...run, status: 'approved' as const } : run)
            sync(`/api/payroll/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) })
            return next
          })
      setWorkflowApprovals(prev => prev.map(flow => flow.targetId === id && flow.process === 'payroll' && flow.status === 'pending' ? { ...flow, status: 'approved', approverUserId: currentUser()?.id, decisionDate: now() } : flow))
      addAuditLog('approve_payroll', payroll.ref, `Payroll approved by ${currentUser()?.name}`)
      showToast('Payroll approved')
    },
    postPayrollRun: (id) => {
      const payroll = payrollRef.current.find(run => run.id === id)
      if (!payroll) return
      if (!canApprovePayroll(currentUser())) { showToast('Only Finance or HR approvers can post payroll', 'error'); return }
      if (payroll.status !== 'approved') { showToast('Payroll must be approved before posting', 'error'); return }
      const journal: JournalEntry = {
        id: uid(), ref: `JRN/PAY/${payroll.year}/${payroll.month}`, date: now(), source: 'payroll', description: `Payroll journal for ${payroll.month}/${payroll.year}`, status: 'posted', payrollRunId: payroll.id,
        lines: [
          { id: uid(), account: 'Payroll Expense', description: `Payroll expense ${payroll.ref}`, debit: payroll.totalGross, credit: 0 },
          { id: uid(), account: 'Payroll Deductions Payable', description: `Payroll deductions ${payroll.ref}`, debit: 0, credit: payroll.totalDeductions },
          { id: uid(), account: 'Salaries Payable', description: `Net salaries payable ${payroll.ref}`, debit: 0, credit: payroll.totalNet },
        ],
        totalDebit: payroll.totalGross,
        totalCredit: payroll.totalGross,
      }
      setJournalEntries(prev => [journal, ...prev])
          setPayrollRuns(prev => {
            const next = prev.map(run => run.id === id ? { ...run, status: 'posted' as const, postedJournalId: journal.id } : run)
            sync(`/api/payroll/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'posted', postedJournalId: journal.id }) })
            return next
          })
      setPayslips(prev => prev.map(payslip => payslip.payrollRunId === payroll.id ? { ...payslip, status: 'published' } : payslip))
      addAuditLog('post_payroll', payroll.ref, `Payroll posted to accounting journal ${journal.ref}`)
      showToast('Payroll posted to accounting journal')
    },
    applySalaryAdvance: (request) => {
      const user = currentUser()
      if (!user) { showToast('You must be logged in to apply for a salary advance', 'error'); throw new Error('Not authenticated') }
      const amount = Number(request.amount) || 0
      const repaymentMonths = Math.max(1, Number(request.repaymentMonths) || 1)
      if (amount <= 0) { showToast('Enter a valid advance amount', 'error'); throw new Error('Invalid amount') }
      if (!request.reason.trim()) { showToast('Enter a reason for the advance', 'error'); throw new Error('Missing reason') }
      const currentPeriod = now().slice(0, 7)
      const advance: SalaryAdvance = {
        ...request,
        amount,
        paymentTerms: request.paymentTerms ?? 'payroll_deduction',
        repaymentMonths,
        repaymentStartPeriod: request.repaymentStartPeriod || currentPeriod,
        monthlyDeduction: Math.ceil(amount / repaymentMonths),
        amountRecovered: 0,
        outstandingAmount: amount,
        deductions: [],
        id: uid(),
        ref: seq('ADV', 'adv'),
        requestedDate: now(),
        status: 'pending',
        createdByUserId: user.id,
      }
      salaryAdvancesRef.current = [advance, ...salaryAdvancesRef.current]
      setSalaryAdvances(prev => [advance, ...prev])
      sync('/api/salary-advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(advance) })
      setWorkflowApprovals(prev => [{
        id: uid(), process: 'salary_advance', ref: advance.ref, targetId: advance.id, targetName: advance.employeeName,
        stepName: 'Salary Advance Approval', approverRole: 'finance_officer', status: 'pending',
        requestedBy: user.name, requestedDate: now(),
      }, ...prev])
      addAuditLog('salary_advance_apply', advance.ref, `${advance.employeeName} requested ${fmtKes(amount)}`)
      showToast(`Salary advance ${advance.ref} submitted for approval`)
      return advance
    },
    decideSalaryAdvance: (id, approved, note) => {
      const user = currentUser()
      if (!['director', 'finance_officer'].includes(user?.role ?? '')) {
        showToast('Only Finance or Director can review salary advances', 'error')
        return
      }
      const advance = salaryAdvancesRef.current.find(item => item.id === id)
      if (!advance) return
      if (advance.status !== 'pending') { showToast('This salary advance has already been reviewed', 'error'); return }
      const status: SalaryAdvance['status'] = approved ? 'approved' : 'rejected'
      const patch = {
        status,
        approvedByUserId: user?.id,
        approvedByName: user?.name,
        decisionDate: now(),
        decisionNote: note,
      }
      salaryAdvancesRef.current = salaryAdvancesRef.current.map(item => item.id === id ? { ...item, ...patch } : item)
      setSalaryAdvances(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
      sync(`/api/salary-advances/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'decide', approved, note }) })
      setWorkflowApprovals(prev => prev.map(flow => flow.targetId === id && flow.process === 'salary_advance' && flow.status === 'pending'
        ? { ...flow, status: approved ? 'approved' : 'rejected', approverUserId: user?.id, decisionDate: now() }
        : flow))
      addAuditLog('salary_advance_decide', advance.ref, `${approved ? 'Approved' : 'Rejected'} by ${user?.name}`)
      showToast(`Salary advance ${approved ? 'approved' : 'rejected'}`)
    },
    markSalaryAdvancePaid: (id, paidDate = now().slice(0, 10)) => {
      const user = currentUser()
      if (!['director', 'finance_officer'].includes(user?.role ?? '')) {
        showToast('Only Finance can mark salary advances as paid', 'error')
        return
      }
      const advance = salaryAdvancesRef.current.find(item => item.id === id)
      if (!advance) return
      if (advance.status !== 'approved') { showToast('Only approved advances can be marked paid', 'error'); return }
      const patch = {
        status: 'paid' as const,
        paidDate,
        outstandingAmount: advance.outstandingAmount ?? advance.amount,
        amountRecovered: advance.amountRecovered ?? 0,
        deductions: advance.deductions ?? [],
      }
      salaryAdvancesRef.current = salaryAdvancesRef.current.map(item => item.id === id ? { ...item, ...patch } : item)
      setSalaryAdvances(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
      sync(`/api/salary-advances/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pay', paidDate }) })
      addAuditLog('salary_advance_paid', advance.ref, `Marked paid by ${user?.name}`)
      showToast('Salary advance marked as paid')
    },
    cancelSalaryAdvance: (id) => {
      const user = currentUser()
      const advance = salaryAdvancesRef.current.find(item => item.id === id)
      if (!advance) return
      if (advance.status !== 'pending') { showToast('Only pending advances can be cancelled', 'error'); return }
      if (advance.createdByUserId !== user?.id && !['director', 'finance_officer'].includes(user?.role ?? '')) {
        showToast('You can only cancel your own pending advance', 'error')
        return
      }
      salaryAdvancesRef.current = salaryAdvancesRef.current.map(item => item.id === id ? { ...item, status: 'cancelled' as const } : item)
      setSalaryAdvances(prev => prev.map(item => item.id === id ? { ...item, status: 'cancelled' as const } : item))
      sync(`/api/salary-advances/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })
      setWorkflowApprovals(prev => prev.map(flow => flow.targetId === id && flow.process === 'salary_advance' && flow.status === 'pending'
        ? { ...flow, status: 'rejected', approverUserId: user?.id, decisionDate: now() }
        : flow))
      showToast('Salary advance cancelled')
    },
    assignAssetToEmployee: (employeeId, productId, qty, serialId, handoverCondition = 'good', handoverNotes = '') => {
      const employee = empRef.current.find(emp => emp.id === employeeId)
      const product = prodRef.current.find(prod => prod.id === productId)
      if (!employee || !product) return
      if (!canManageHRAssets(currentUser())) { showToast('Only HR or inventory controllers can assign assets', 'error'); return }
      const serial = serialId ? serialRef.current.find(item => item.id === serialId) : undefined
      if (product.requiresSerial && !serial) { showToast('Serialized assets require a serial selection', 'error'); return }
      const assignment: EmployeeAssetAssignment = { id: uid(), employeeId, employeeName: employee.fullName, productId, productName: product.name, serialId, serialNumber: serial?.serial, qty, assignedDate: now(), status: 'assigned', acknowledgedByEmployee: false, handoverCondition, handoverNotes }
      setEmployeeAssetAssignments(prev => [assignment, ...prev])
      if (serial) {
        setSerials(prev => prev.map(item => item.id === serial.id ? { ...item, status: 'assigned', location: 'employee' } : item))
      } else {
        setBulkStock(prev => upsertBulkStock(prev, productId, 'warehouse', -qty))
      }
      setProducts(prev => prev.map(item => item.id === productId ? { ...item, stockQty: Math.max(0, item.stockQty - qty) } : item))
      const empUserId2 = employee.userId
      if (empUserId2) {
        notifyUsers({
          recipients: [empUserId2],
          type: 'asset',
          title: 'Asset assigned to you',
          body: `${product.name}${serial ? ` (S/N: ${serial.serial})` : ` ×${qty}`} has been issued to you. Please acknowledge receipt.`,
          module: 'hr',
          path: '?tab=self_service',
          icon: '💻',
          entityKey: `asset:${assignment.id}:assigned`,
          excludeUserId: currentUserId,
        })
      }
      addAuditLog('assign_asset', assignment.productName, `Assigned ${assignment.productName} to ${employee.fullName}`)
      showToast('Asset assigned to employee')
    },
    acknowledgeEmployeeAsset: (assignmentId, notes) => {
      const assignment = assetRef.current.find(item => item.id === assignmentId)
      if (!assignment || assignment.acknowledgedByEmployee) return
      const employee = empRef.current.find(item => item.id === assignment.employeeId)
      const user = currentUser()
      if (!(user && (canManageHRAssets(user) || employee?.userId === user.id))) { showToast('Only HR, inventory, or the assigned employee can acknowledge this asset', 'error'); return }
      setEmployeeAssetAssignments(prev => prev.map(item => item.id === assignmentId ? { ...item, acknowledgedByEmployee: true, acknowledgmentDate: now(), handoverNotes: notes ?? item.handoverNotes } : item))
      addAuditLog('acknowledge_asset', assignment.productName, `Acknowledged ${assignment.productName} by ${assignment.employeeName}`)
      showToast('Asset acknowledged')
    },
    returnEmployeeAsset: (assignmentId, returnLocation, condition, notes) => {
      const assignment = assetRef.current.find(item => item.id === assignmentId)
      if (!assignment || assignment.status !== 'assigned') return
      if (!canManageHRAssets(currentUser())) { showToast('Only HR or inventory controllers can receive returned assets', 'error'); return }
      const product = prodRef.current.find(item => item.id === assignment.productId)
      if (!product) return
      setEmployeeAssetAssignments(prev => prev.map(item => item.id === assignmentId ? { ...item, status: 'returned', returnedDate: now(), returnLocation, returnCondition: condition, returnInspectionNotes: notes } : item))
      if (condition === 'damaged') {
        if (assignment.serialId) {
          setSerials(prev => prev.map(serial => serial.id === assignment.serialId ? { ...serial, status: 'under_repair', location: 'repair_unit' } : serial))
        } else {
          setBulkStock(prev => upsertBulkStock(prev, assignment.productId, 'repair_unit', assignment.qty))
        }
        const repair: RepairOrder = {
          id: uid(),
          ref: seq('REP', 'rep'),
          status: 'received',
          customerId: assignment.employeeId,
          customerName: assignment.employeeName,
          customerPhone: '',
          productId: assignment.productId,
          productName: assignment.productName,
          serialNumber: assignment.serialNumber ?? '',
          serialId: assignment.serialId,
          intakeChannel: 'walk_in',
          intakeDate: new Date().toISOString(),
          intakeNotes: `Internal asset return - ${notes || 'Damaged on return'}`,
          issueDescription: `Device returned damaged from employee asset assignment`,
          accessories: [],
          underWarranty: false,
          partsUsed: [],
          laborCost: 0,
          logisticsCost: 0,
          total: 0,
          qcItems: [],
          createdBy: currentUser()?.username ?? 'system',
          createdDate: now(),
          notes,
          slaMissed: false,
          date: now(),
          description: `Internal asset return inspection: ${notes || 'Damaged on return'}`,
          technicianName: '',
          intakeSource: 'employee_asset_return',
          linkedEmployeeId: assignment.employeeId,
          bookedByName: currentUser()?.name ?? 'System',
        }
        setRepairs(prev => [repair, ...prev])
        addAuditLog('return_asset_repair', assignment.productName, `Damaged return routed to repair for ${assignment.productName}`)
        showToast(`Damaged asset routed to repair unit via ${repair.ref}`, 'info')
        return
      }
      if (assignment.serialId) {
        setSerials(prev => prev.map(serial => serial.id === assignment.serialId ? { ...serial, status: 'available', location: returnLocation } : serial))
      } else {
        setBulkStock(prev => upsertBulkStock(prev, assignment.productId, returnLocation, assignment.qty))
      }
      setProducts(prev => prev.map(item => item.id === assignment.productId ? { ...item, stockQty: item.stockQty + assignment.qty } : item))
      addAuditLog('return_asset', assignment.productName, `Returned ${assignment.productName} from ${assignment.employeeName} in ${condition} condition`)
      showToast('Asset returned to inventory')
    },
    reassignEmployeeAsset: (assignmentId, employeeId) => {
      const assignment = assetRef.current.find(item => item.id === assignmentId)
      const employee = empRef.current.find(item => item.id === employeeId)
      if (!assignment || !employee || assignment.status !== 'assigned') return
      if (!canManageHRAssets(currentUser())) { showToast('Only HR or inventory controllers can reassign assets', 'error'); return }
      setEmployeeAssetAssignments(prev => prev.map(item => item.id === assignmentId ? { ...item, status: 'reassigned', returnedDate: now(), returnLocation: 'employee' } : item))
      setEmployeeAssetAssignments(prev => [{ ...assignment, id: uid(), employeeId: employee.id, employeeName: employee.fullName, assignedDate: now(), previousAssignmentId: assignment.id, status: 'assigned', acknowledgedByEmployee: false, acknowledgmentDate: undefined }, ...prev])
      addAuditLog('reassign_asset', assignment.productName, `Reassigned ${assignment.productName} to ${employee.fullName}`)
      showToast('Asset reassigned')
    },
    uploadMyDocument: (document) => {
      const user = currentUser()
      if (!user) { showToast('You must be logged in to upload documents', 'error'); throw new Error('Not authenticated') }
      const emp = empRef.current.find(e => e.userId === user.id)
      if (!emp) { showToast('No employee record linked to your account. Contact HR.', 'error'); throw new Error('No employee record') }
      const doc: HRDocument = {
        ...document,
        id: uid(),
        employeeId: emp.id,
        uploadedByUserId: user.id,
        uploadedByName: user.name,
        uploadedDate: now(),
        visibility: 'employee_visible',
      }
      useHrDomainStore.getState().setHRDocuments(prev => [doc, ...prev])
      addAuditLog('upload_document', doc.title, `${user.name} uploaded document: ${doc.title}`)
      showToast('Document uploaded successfully')
      return doc
    },

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
    addAccount: (a) => { const account = { ...a, id: uid() }; setAccounts(p => [...p, account]); showToast(`Account ${a.code} added`); return account },
    updateAccount: (id, p) => { setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...p } : a)); showToast('Account updated') },

    
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
    createContactPerson: (c) => {
      const existing = contactPersons.find(person =>
        (person.clientId === c.clientId || person.companyId === c.companyId || person.companyId === c.clientId || person.clientId === c.companyId) &&
        (
          (c.email && person.email?.trim().toLowerCase() === c.email.trim().toLowerCase()) ||
          (c.phone && person.phone?.replace(/\D/g, '').slice(-9) === c.phone.replace(/\D/g, '').slice(-9)) ||
          `${person.firstName} ${person.lastName}`.trim().toLowerCase() === `${c.firstName} ${c.lastName}`.trim().toLowerCase()
        )
      )
      if (existing) {
        const updated = {
          ...existing,
          ...c,
          id: existing.id,
          fullName: `${c.firstName || existing.firstName} ${c.lastName || existing.lastName}`.trim(),
        }
        setContactPersons(prev => prev.map(person => person.id === existing.id ? updated : person))
        sync(`/api/contact-persons/${existing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        showToast(`${updated.fullName} updated`)
        return updated
      }
      const contactPerson: ContactPerson = {
        ...c,
        id: uid(),
        fullName: `${c.firstName} ${c.lastName}`,
        createdDate: now(),
      }
      setContactPersons(p => [contactPerson, ...p])
      sync('/api/contact-persons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contactPerson) })
      addAuditLog('create_contact_person', contactPerson.fullName, `Contact person added for ${c.companyName}`)
      showToast(`${contactPerson.fullName} added`)
      return contactPerson
    },
    updateContactPerson: (id, p) => {
      setContactPersons(prev => {
        const next = prev.map(c => {
          if (c.id !== id) return c
          const updated = { ...c, ...p }
          if (p.firstName || p.lastName) {
            updated.fullName = `${updated.firstName} ${updated.lastName}`
          }
          return updated
        })
        const updatedObj = next.find(c => c.id === id)
        if (updatedObj) sync(`/api/contact-persons/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedObj) })
        return next
      })
      showToast('Contact person updated')
    },
    deleteContactPerson: (id) => {
      setContactPersons(p => p.filter(c => c.id !== id))
      sync(`/api/contact-persons/${id}`, { method: 'DELETE' })
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
        ref: seq('OPP', 'opp'),
        createdDate: now(),
        quoteIds: [],
        actualValue: 0,
        leadScore,
      }
      setOpportunities(p => [opportunity, ...p])
      addAuditLog('create_opportunity', opportunity.ref, `Opportunity ${opportunity.name} created`)
      showToast(`Opportunity ${opportunity.ref} created`)
      sync('/api/opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opportunity) })
      return opportunity
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
      if (updated) sync(`/api/activities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) }) // If you want to build this PUT endpoint later, else it falls back gracefully
      showToast('Activity completed')
      return next
    }),
    
    // ── Customer Contracts ─────────────────────────────────────────────────────
    createCustomerContract: (contractInput) => {
      const contract: CustomerContract = {
        ...contractInput,
        id: uid(),
        ref: seq('CTR', 'opp'),
      }
      setCustomerContracts(prev => [contract, ...prev])
      addAuditLog('create_contract', contract.ref, `Contract for ${contract.companyName} created`)
      showToast(`Contract ${contract.ref} created`)
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
        ref: seq('CTR', 'opp'),
        startDate: current.endDate,
        endDate: addDays(current.endDate, 365),
        renewalDate: addDays(current.endDate, 335),
        status: 'renewed',
      }
      setCustomerContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'renewed' } : c))
      setCustomerContracts(prev => [renewed, ...prev])
      addAuditLog('renew_contract', renewed.ref, `Renewed from ${current.ref}`)
      showToast(`Contract renewed as ${renewed.ref}`)
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
          recipients: request.approvers[0]?.approverIds ?? [],
          type: 'system',
          title: `Quote approval needed: ${existing.ref ?? existing.quoteNumber}`,
          body: request.details.reason,
          module: 'sales',
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
          contact = {
            id: uid(),
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
            createdAt: now(),
            creditLimit: company.creditLimit,
            paymentTerms: `${company.paymentTerms} days`,
          }
          setContacts(p => [...p, contact!])
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
        dueDate: addDays(now(), 14),
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
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })

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

    // ── Products ─────────────────────────────────────────────────────────────
    addProduct: async (p) => {
      const productKind = inferProductKind({
        productKind: p.productKind,
        trackingMethod: p.trackingMethod,
        category: p.category,
        unit: p.unit,
        requiresSerial: p.requiresSerial,
      })
      const trackingMethod = inferTrackingMethod({
        trackingMethod: p.trackingMethod ?? defaultTrackingForKind(productKind, p.category),
        category: p.category,
        requiresSerial: p.requiresSerial,
        unit: p.unit,
      })
      const accounts = resolveProductAccounts({ ...p, productKind, trackingMethod })
      p = {
        ...p,
        barcode: String(p.barcode ?? '').trim(),
        productKind,
        trackingMethod,
        requiresSerial: isSerialTracking(trackingMethod),
        unit: p.unit || defaultUnitForKind(productKind, trackingMethod),
        saleAccountCode: p.saleAccountCode || accounts.saleAccountCode,
        costAccountCode: p.costAccountCode || accounts.costAccountCode,
        inventoryAccountCode: p.inventoryAccountCode || (productKind === 'storable' ? accounts.inventoryAccountCode : p.inventoryAccountCode),
        cogsAccountCode: p.cogsAccountCode || (productKind === 'storable' ? accounts.cogsAccountCode : p.cogsAccountCode),
        adjustmentAccountCode: p.adjustmentAccountCode || accounts.adjustmentAccountCode,
        writeOffAccountCode: p.writeOffAccountCode || accounts.writeOffAccountCode,
        priceDifferenceAccountCode: p.priceDifferenceAccountCode || accounts.priceDifferenceAccountCode,
      }
      const duplicate = findProductIdentityDuplicate(prodRef.current, p)
      if (duplicate) {
        showToast(`Product already exists: ${duplicate.name} (${duplicate.sku || duplicate.barcode || 'same name'})`, 'error')
        return duplicate as any
      }
      // Optimistic update — add immediately so the UI responds
      const tempId = uid()
      const optimistic = { ...p, id: tempId, stockQty: 0, createdAt: new Date().toISOString() }
      setProducts(prev => [...prev, optimistic as any])

      // Background sync to database
      try {
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        })
        if (res.ok) {
          const saved = await res.json()
          // Keep the ERP product shape from the form/import row. The API returns
          // Prisma fields (sellingPrice, reorderLevel, categoryId, etc.), so a
          // raw replacement can drop category/unit/account metadata in local state.
          const reconciled = {
            ...optimistic,
            id: saved.id ?? tempId,
            createdAt: saved.createdAt ?? optimistic.createdAt,
            salePrice: Number(saved.salePrice ?? saved.sellingPrice ?? optimistic.salePrice),
            costPrice: Number(saved.costPrice ?? optimistic.costPrice),
            minStock: Number(saved.minStock ?? saved.reorderLevel ?? optimistic.minStock),
            stockQty: saved.stockQty ?? optimistic.stockQty ?? 0,
            sku: saved.sku || optimistic.sku,
          }
          setProducts(prev => prev.map(x => x.id === tempId ? reconciled as any : x))
          showToast(`${p.name} created`, 'success')
          // Re-merge catalog so a concurrent SSE wipe cannot drop this product.
          void (async () => {
            try {
              const catalogRes = await fetch('/api/products?lite=1')
              if (!catalogRes.ok) return
              const catalogRows = await catalogRes.json()
              if (!Array.isArray(catalogRows)) return
              setProducts(prev => mergeCatalogProducts(prev, catalogRows, CATEGORY_CONFIG) as any)
            } catch { /* ignore */ }
          })()
          return reconciled as any
        }
        const err = await res.json().catch(() => ({}))
        setProducts(prev => prev.filter(x => x.id !== tempId))
        showToast(err?.error || err?.message || `Could not create ${p.name}`, 'error')
        return null as any
      } catch {
        setProducts(prev => prev.filter(x => x.id !== tempId))
        showToast(`Could not create ${p.name}. Check your connection and try again.`, 'error')
        return null as any
      }
    },

    refreshProductCatalog: async () => {
      try {
        // Idempotent: force SERIAL on all Laptops / machine-category products.
        await fetch('/api/products/normalize-serial-tracking', { method: 'POST' }).catch(() => null)
        // Idempotent: rewrite legacy INV-* tags to manufacturer serial.
        await storeCtxRef.current!.normalizeInventoryTags().catch(() => 0)
        const res = await fetch('/api/products?lite=1')
        if (!res.ok) return 0
        const rows = await res.json()
        if (!Array.isArray(rows) || rows.length === 0) return 0
        // Single state update + stable order — avoids catalog flicker mid-search.
        setProducts(prev => {
          const merged = mergeCatalogProducts(prev, rows, CATEGORY_CONFIG, { preserveClientOrder: true }) as any[]
          const healed = merged.map(p => {
            if (!isSerialOnlyCategory(p.category)) return p
            if (p.trackingMethod === 'SERIAL' && p.requiresSerial) return p
            return { ...p, trackingMethod: 'SERIAL' as TrackingMethod, requiresSerial: true }
          })
          return JSON.stringify(healed) === JSON.stringify(prev) ? prev : healed
        })
        return rows.length
      } catch {
        return 0
      }
    },

    normalizeInventoryTags: async () => {
      try {
        const res = await fetch('/api/inventory/normalize-tags', { method: 'POST' })
        if (!res.ok) return 0
        const data = await res.json().catch(() => null)
        const next = Array.isArray(data?.serials) ? data.serials as SerialNumber[] : null
        const rewritten = Number(data?.rewritten ?? 0)
        if (next) setSerials(next)
        return Number.isFinite(rewritten) ? rewritten : 0
      } catch {
        return 0
      }
    },

    publishProductBulk: async (rows) => {
      const empty = { created: 0, skipped: 0, failed: 0, skippedRows: [] as { name: string; reason: string }[], failedRows: [] as { name: string; reason: string }[] }
      if (!rows.length) return empty

      const products = rows.map(row => {
        const productKind = inferProductKind({
          productKind: row.productKind,
          trackingMethod: row.trackingMethod,
          category: row.category,
          unit: row.unit,
          requiresSerial: row.requiresSerial,
        })
        const trackingMethod = inferTrackingMethod({
          trackingMethod: row.trackingMethod ?? defaultTrackingForKind(productKind, row.category),
          category: row.category,
          requiresSerial: row.requiresSerial,
          unit: row.unit,
        })
        return {
          name: row.name,
          sku: (row as any).skuProvided ? row.sku : '',
          skuProvided: !!(row as any).skuProvided,
          barcode: String(row.barcode ?? '').trim(),
          category: row.category,
          productKind,
          trackingMethod,
          salePrice: Number(row.salePrice ?? 0),
          costPrice: Number(row.costPrice ?? 0),
          taxRate: Number(row.taxRate ?? 16),
          minStock: Number(row.minStock ?? 5),
          unit: row.unit || defaultUnitForKind(productKind, trackingMethod),
          description: row.description || '',
          isActive: true,
          canBeSold: row.canBeSold !== false,
          canBePurchased: row.canBePurchased !== false,
        }
      })

      try {
        const res = await fetch('/api/products/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ products }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          showToast(body?.error || body?.message || 'Bulk publish failed', 'error')
          return { ...empty, failed: rows.length, failedRows: [{ name: 'bulk', reason: body?.error || 'Bulk publish failed' }] }
        }

        const createdProducts = Array.isArray(body.products) ? body.products : []
        const byName = new Map(rows.map(r => [String(r.name ?? '').trim().toLowerCase(), r]))

        // Immediately seed local state from the publish response so the UI
        // shows products even if the follow-up catalog GET is slow/fails.
        if (createdProducts.length > 0) {
          setProducts(prev => {
            const asCatalog = createdProducts.map((p: any) => ({
              id: String(p.id),
              sku: p.sku,
              barcode: p.barcode ?? null,
              name: p.name,
              description: p.description ?? null,
              sellingPrice: p.salePrice ?? p.sellingPrice,
              costPrice: p.costPrice,
              reorderLevel: p.minStock ?? p.reorderLevel,
              isActive: p.isActive !== false,
              trackingMethod: p.trackingMethod ?? null,
              invoicePolicy: p.invoicePolicy ?? 'order',
              category: p.category?.name ? p.category : { name: byName.get(String(p.name ?? '').trim().toLowerCase())?.category || 'Laptops' },
            }))
            let merged = mergeCatalogProducts(prev, asCatalog, CATEGORY_CONFIG) as any[]
            merged = merged.map(p => {
              const src = byName.get(String(p.name ?? '').trim().toLowerCase())
              if (!src) return p
              return {
                ...p,
                productKind: src.productKind ?? p.productKind,
                trackingMethod: src.trackingMethod ?? p.trackingMethod,
                requiresSerial: src.requiresSerial ?? p.requiresSerial,
                unit: src.unit || p.unit,
                warrantyMonths: src.warrantyMonths ?? p.warrantyMonths,
                taxRate: src.taxRate ?? p.taxRate,
                saleAccountCode: src.saleAccountCode || p.saleAccountCode,
                costAccountCode: src.costAccountCode || p.costAccountCode,
                inventoryAccountCode: src.inventoryAccountCode || p.inventoryAccountCode,
                cogsAccountCode: src.cogsAccountCode || p.cogsAccountCode,
                adjustmentAccountCode: src.adjustmentAccountCode || p.adjustmentAccountCode,
                writeOffAccountCode: src.writeOffAccountCode || p.writeOffAccountCode,
                priceDifferenceAccountCode: src.priceDifferenceAccountCode || p.priceDifferenceAccountCode,
              }
            })
            return merged
          })
        }

        // Always re-merge from the relational catalog so published products persist.
        try {
          const catalogRes = await fetch('/api/products?lite=1')
          if (catalogRes.ok) {
            const catalogRows = await catalogRes.json()
            if (Array.isArray(catalogRows)) {
              setProducts(prev => {
                const merged = mergeCatalogProducts(prev, catalogRows, CATEGORY_CONFIG) as any[]
                return merged.map(p => {
                  const src = byName.get(String(p.name ?? '').trim().toLowerCase())
                  if (!src) return p
                  return {
                    ...p,
                    productKind: src.productKind ?? p.productKind,
                    trackingMethod: src.trackingMethod ?? p.trackingMethod,
                    requiresSerial: src.requiresSerial ?? p.requiresSerial,
                    unit: src.unit || p.unit,
                    warrantyMonths: src.warrantyMonths ?? p.warrantyMonths,
                    taxRate: src.taxRate ?? p.taxRate,
                    saleAccountCode: src.saleAccountCode || p.saleAccountCode,
                    costAccountCode: src.costAccountCode || p.costAccountCode,
                    inventoryAccountCode: src.inventoryAccountCode || p.inventoryAccountCode,
                    cogsAccountCode: src.cogsAccountCode || p.cogsAccountCode,
                    adjustmentAccountCode: src.adjustmentAccountCode || p.adjustmentAccountCode,
                    writeOffAccountCode: src.writeOffAccountCode || p.writeOffAccountCode,
                    priceDifferenceAccountCode: src.priceDifferenceAccountCode || p.priceDifferenceAccountCode,
                  }
                })
              })
            }
          }
        } catch { /* catalog refresh best-effort after local seed */ }

        return {
          created: Number(body.created ?? 0),
          skipped: Number(body.skipped ?? 0),
          failed: Number(body.failed ?? 0),
          skippedRows: Array.isArray(body.skippedRows) ? body.skippedRows : [],
          failedRows: Array.isArray(body.failedRows) ? body.failedRows : [],
        }
      } catch {
        showToast('Bulk publish failed. Check your connection and try again.', 'error')
        return { ...empty, failed: rows.length, failedRows: [{ name: 'bulk', reason: 'Network error' }] }
      }
    },

    updateProduct: (id, p) => {
      const duplicate = findProductIdentityDuplicate(prodRef.current, p, id)
      if (duplicate) {
        showToast(`Product already exists: ${duplicate.name} (${duplicate.sku || duplicate.barcode || 'same name'})`, 'error')
        return
      }
      const current = prodRef.current.find(product => product.id === id)
      if (!current) return
      const currentTracking = getProductTrackingMethod(current)
      const nextCategory = p.category ?? current.category
      const nextTracking = inferTrackingMethod({
        trackingMethod: p.trackingMethod,
        category: nextCategory,
        requiresSerial: p.requiresSerial ?? current.requiresSerial,
        unit: p.unit ?? current.unit,
      })
      if (currentTracking !== nextTracking) {
        // Always allow upgrading machine categories (Laptops…) to SERIAL.
        const serialUpgrade = nextTracking === 'SERIAL' && isSerialOnlyCategory(nextCategory)
        const hasStock =
          serialRef.current.some(item => item.productId === id && item.status !== 'sold') ||
          bulkStock.some(item => item.productId === id && item.qty > 0)
        const hasTransactions =
          saleOrders.some(order => order.lines.some(line => line.productId === id)) ||
          purchaseOrders.some(order => order.lines.some(line => line.productId === id)) ||
          receipts.some(receipt => receipt.lines.some(line => line.productId === id))
        if (!serialUpgrade && (hasStock || hasTransactions)) {
          showToast('Tracking method cannot be changed after stock or transactions exist. Use admin migration flow.', 'error')
          return
        }
      }
      setProducts(prev => prev.map(x => {
        if (x.id !== id) return x
        const productKind = inferProductKind({
          productKind: p.productKind ?? x.productKind,
          trackingMethod: nextTracking,
          category: nextCategory,
          unit: p.unit ?? x.unit,
          requiresSerial: p.requiresSerial ?? x.requiresSerial,
        })
        const updated = {
          ...x,
          ...p,
          productKind,
          trackingMethod: nextTracking,
          requiresSerial: isSerialTracking(nextTracking),
          unit: p.unit || defaultUnitForKind(productKind, nextTracking),
        }
        return updated
      }))
      showToast('Product master updated')
      fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...p,
          trackingMethod: nextTracking,
          requiresSerial: isSerialTracking(nextTracking),
          category: nextCategory,
        }),
      }).catch(() => {})
    },
    updateProductPrice: (id, salePrice, costPrice, reason, effectiveDate) => {
      const product = products.find(p => p.id === id)
      const user = currentUser()
      if (!product) { showToast('Product not found', 'error'); return null }
      if (salePrice < 0 || costPrice < 0) { showToast('Prices cannot be negative', 'error'); return null }
      if (!reason.trim()) { showToast('Enter a reason for the price update', 'error'); return null }
      const updatedAt = new Date().toISOString()
      const updatedByName = user?.name ?? user?.username ?? 'System'
      const history: ProductPriceHistory = {
        id: uid(),
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        oldSalePrice: Number(product.salePrice ?? 0),
        newSalePrice: salePrice,
        oldCostPrice: Number(product.costPrice ?? 0),
        newCostPrice: costPrice,
        reason: reason.trim(),
        effectiveDate: effectiveDate || now(),
        updatedById: user?.id,
        updatedByName,
        updatedAt,
      }
      // Catalog price edits update sale price; cost stays purchase-driven unless
      // an explicit cost change is passed (bulk import).
      const patch: Partial<Product> = {
        salePrice,
        costPrice,
        priceUpdatedAt: updatedAt,
        priceUpdatedBy: updatedByName,
      }
      const previous = { salePrice: product.salePrice, costPrice: product.costPrice }
      setProducts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
      setProductPriceHistory(prev => [history, ...prev])
      void fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salePrice, costPrice }),
      }).then(async res => {
        if (res.ok) return
        const payload = await res.json().catch(() => null) as { error?: string } | null
        setProducts(prev => prev.map(p => p.id === id ? { ...p, ...previous } : p))
        setProductPriceHistory(prev => prev.filter(h => h.id !== history.id))
        showToast(payload?.error ?? 'Failed to save sale price on server', 'error')
      }).catch(() => {
        showToast('Network error saving sale price', 'error')
      })
      addAuditLog('update_product_price', product.sku || product.name, `Price updated for ${product.name}: ${fmtKes(history.oldSalePrice)} → ${fmtKes(salePrice)}. Reason: ${history.reason}`)
      showToast(`Sale price updated for ${product.name}`, 'success')
      return history
    },
    archiveProduct: (id) => {
      if (!canApproveInventoryAction(currentUser())) {
        showToast('Only inventory approvers can archive products', 'error')
        return
      }
      const product = prodRef.current.find(p => p.id === id)
      if (!product) {
        showToast('Product not found', 'error')
        return
      }
      if (!product.isActive) {
        showToast(`${product.name} is already archived`, 'info')
        return
      }
      const ids = [
        id,
        ...prodRef.current.filter(p => p.parentId === id && p.isActive).map(p => p.id),
      ]
      setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, isActive: false } : p))
      for (const productId of ids) {
        fetch(`/api/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: false }),
        }).catch(() => {})
      }
      const extra = ids.length > 1 ? ` (+${ids.length - 1} variant${ids.length === 2 ? '' : 's'})` : ''
      addAuditLog('archive_product', product.sku || product.name, `Archived product ${product.name}${extra}`)
      showToast(`Archived ${product.name}${extra}`, 'success')
    },
    unarchiveProduct: (id) => {
      if (!canApproveInventoryAction(currentUser())) {
        showToast('Only inventory approvers can restore archived products', 'error')
        return
      }
      const product = prodRef.current.find(p => p.id === id)
      if (!product) {
        showToast('Product not found', 'error')
        return
      }
      if (product.isActive) {
        showToast(`${product.name} is already active`, 'info')
        return
      }
      // Restoring a variant whose parent is archived — restore parent too so it stays findable.
      const parent = product.parentId ? prodRef.current.find(p => p.id === product.parentId) : undefined
      const ids = [
        id,
        ...(parent && !parent.isActive ? [parent.id] : []),
      ]
      setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, isActive: true } : p))
      for (const productId of ids) {
        fetch(`/api/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: true }),
        }).catch(() => {})
      }
      addAuditLog('unarchive_product', product.sku || product.name, `Restored product ${product.name}`)
      showToast(`Restored ${product.name}`, 'success')
    },
    deleteProduct: (id) => {
      if (!canApproveInventoryAction(currentUser())) { showToast('Only inventory approvers can delete product masters', 'error'); return }
      const hasStock =
        serialRef.current.some(item => item.productId === id && item.status !== 'sold') ||
        bulkStock.some(item => item.productId === id && item.qty > 0)
      const hasTransactions =
        saleOrders.some(order => order.lines.some(line => line.productId === id)) ||
        purchaseOrders.some(order => order.lines.some(line => line.productId === id)) ||
        receipts.some(receipt => receipt.lines.some(line => line.productId === id)) ||
        invoices.some(invoice => invoice.lines.some(line => line.productId === id))
      if (hasStock || hasTransactions) {
        showToast('Cannot delete product master with stock or transactions. Archive it instead.', 'error')
        return
      }
      setProducts(p => p.filter(x => x.id !== id))
      setBulkStock(p => p.filter(level => level.productId !== id))
      showToast('Product deleted')
      fetch(`/api/products/${id}`, { method: 'DELETE' }).catch(() => {})
    },
    importOpeningStock: async (items) => {
      if (!canApproveInventoryAction(currentUser())) { showToast('Only inventory approvers can post opening stock', 'error'); return }
      if (isOpeningStockLocked(openingStockPosted, stockMoves)) {
        if (!openingStockPosted) setOpeningStockPosted(true)
        showToast('Opening stock has already been posted and is locked', 'error')
        return
      }
      try {
        const preflightItems = items.map(item => {
          const product = prodRef.current.find(x => x.id === item.productId)
          return {
            productId: item.productId,
            productName: product?.name,
            qty: item.qty,
            requiresSerial: Boolean(product?.requiresSerial),
            serials: item.serials ?? [],
            serialSkus: item.serialSkus ?? [],
          }
        })
        const response = await fetch('/api/inventory/validate-opening-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: preflightItems }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { errors?: string[]; error?: string } | null
          const message = payload?.errors?.[0] || payload?.error || 'Opening stock validation failed'
          showToast(message, 'error')
          return
        }
      } catch {
        showToast('Could not validate opening stock on server', 'error')
        return
      }
      const newSerials: SerialNumber[] = []
      const stockDeltas = new Map<string, number>()
      const bulkItems: Array<{ productId: string; location: LocationId; qty: number }> = []
      const seenSerials = new Set<string>()
      const reservedUnitSkus = new Set(
        serialRef.current.map(item => String(item.sku ?? '').trim().toUpperCase()).filter(Boolean),
      )

      for (const item of items) {
        const prod = prodRef.current.find(x => x.id === item.productId)
        if (!prod) continue
        const loc = item.location ?? 'warehouse'
        if (prod.requiresSerial && item.serials) {
          if (item.serials.length !== item.qty) {
            showToast(`Opening stock for ${prod.name} requires one serial per unit`, 'error')
            return
          }
          if ((item.serialSkus?.length ?? 0) > item.serials.length) {
            showToast(`Opening stock for ${prod.name} has more unit SKUs than serial numbers`, 'error')
            return
          }
          const duplicateSerial = item.serials.find(serial => {
            const normalized = serial.trim().toUpperCase()
            if (seenSerials.has(normalized)) return true
            seenSerials.add(normalized)
            return serialRef.current.some(existing => existing.serial.trim().toUpperCase() === normalized)
          })
          if (duplicateSerial) {
            showToast(`Duplicate serial detected while posting opening stock for ${prod.name}: ${duplicateSerial}`, 'error')
            return
          }
          const serialUnitSkus = item.serials.map((serial, idx) => {
            const unitSku = buildSerialUnitSku(prod, serial, item.serialSkus?.[idx], reservedUnitSkus)
            if (reservedUnitSkus.has(unitSku)) return null
            reservedUnitSkus.add(unitSku)
            return unitSku
          })
          const duplicateSkuIndex = serialUnitSkus.findIndex(unitSku => unitSku === null)
          if (duplicateSkuIndex !== -1) {
            showToast(`Duplicate unit SKU detected for ${prod.name}: ${item.serialSkus?.[duplicateSkuIndex]}`, 'error')
            return
          }
          item.serials.forEach((s, idx) => {
            const newSerial: SerialNumber = {
              id: uid(),
              serial: s,
              sku: serialUnitSkus[idx]!,
              productId: item.productId,
              productName: prod.name,
              location: loc,
              status: 'available',
              receivedDate: now(),
              // Internal inventory barcode is distinct from manufacturer serial.
              barcode: buildInventoryBarcodeForProduct(item.productId, s),
            }
            newSerials.push(newSerial)
          })
          stockDeltas.set(item.productId, (stockDeltas.get(item.productId) ?? 0) + item.serials.length)
        } else {
          bulkItems.push({ productId: item.productId, location: loc, qty: item.qty })
          stockDeltas.set(item.productId, (stockDeltas.get(item.productId) ?? 0) + item.qty)
        }
      }

      if (newSerials.length > 0) {
        setSerials(prev => [...prev, ...newSerials])
      }
      if (bulkItems.length > 0) {
        setBulkStock(prev => bulkItems.reduce(
          (next, item) => upsertBulkStock(next, item.productId, item.location, item.qty),
          prev,
        ))
      }
      if (stockDeltas.size > 0) {
        setProducts(prev => prev.map(product => {
          const delta = stockDeltas.get(product.id)
          return delta ? { ...product, stockQty: product.stockQty + delta } : product
        }))
      }
      items.forEach(item => {
        const prod = prodRef.current.find(x => x.id === item.productId)
        if (!prod) return
        const loc = item.location ?? 'warehouse'
        if (prod.requiresSerial && item.serials) {
          addMove(item.productId, prod.name, item.serials.length, 'in', 'Opening stock', 'OPENING', undefined, loc, item.serials)
        } else {
          addMove(item.productId, prod.name, item.qty, 'in', 'Opening stock', 'OPENING', undefined, loc)
        }
      })
      setOpeningStockPosted(true)
      addAuditLog('opening_stock', 'OPENING', `Opening stock posted — ${items.length} product(s)`)
      showToast('Opening stock posted · locked against further changes')
    },

    intakeProductSerials: async (productId, input) => {
      const product = prodRef.current.find(p => p.id === productId)
      if (!product) { showToast('Product not found', 'error'); return null }
      const serials = (input.serials ?? []).map(s => String(s).trim()).filter(Boolean)
      if (serials.length === 0) { showToast('Enter at least one serial number', 'error'); return null }
      if (!String(input.reason ?? '').trim()) { showToast('Reason is required', 'error'); return null }

      try {
        const res = await fetch('/api/inventory/intake-serials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId,
            serials,
            location: input.location ?? 'warehouse',
            reason: input.reason,
            kind: input.kind,
          }),
        })
        const data = await res.json().catch(() => ({})) as {
          error?: string
          errors?: string[]
          added?: number
          documentRef?: string
          serials?: SerialNumber[]
          move?: StockMove
          product?: Partial<Product>
        }
        if (!res.ok) {
          showToast(data.errors?.[0] || data.error || 'Could not add serials', 'error')
          return null
        }

        if (Array.isArray(data.serials) && data.serials.length > 0) {
          setSerials(prev => {
            const existingIds = new Set(prev.map(s => s.id))
            const incoming = data.serials!.filter(s => !existingIds.has(s.id))
            return incoming.length ? [...incoming, ...prev] : prev
          })
        }
        if (data.move) {
          setStockMoves(prev => (prev.some(m => m.id === data.move!.id) ? prev : [data.move!, ...prev]))
        }
        if (data.product) {
          setProducts(prev => prev.map(p => p.id === productId
            ? {
                ...p,
                requiresSerial: true,
                trackingMethod: 'SERIAL',
                stockQty: typeof data.product!.stockQty === 'number' ? data.product!.stockQty : p.stockQty + (data.added ?? serials.length),
              }
            : p))
        }

        const docRef = data.documentRef || 'INTK'
        addAuditLog(
          'serial_intake',
          docRef,
          `Added ${data.added ?? serials.length} on-hand serial(s) to ${product.name} @ ${input.location ?? 'warehouse'}: ${serials.join(', ')}`,
        )
        showToast(`Added ${data.added ?? serials.length} serial(s) — On hand updated (${docRef})`, 'success')
        return { added: data.added ?? serials.length, documentRef: docRef }
      } catch {
        showToast('Could not reach server to add serials', 'error')
        return null
      }
    },

    // ── Serials ───────────────────────────────────────────────────────────────
    getProductSerials: (productId, location) =>
      serialRef.current.filter(s => s.productId === productId && (!location || s.location === location)),
      getAvailableSerials: (productId) =>
      serialRef.current.filter(s => s.productId === productId && s.status === 'available' && (s.location === 'warehouse' || s.location === 'shop')),
    updateSerial: (id, patch) => setSerials(p => {
      const next = p.map(s => s.id === id ? { ...s, ...patch } : s)
      const updated = next.find(s => s.id === id)
      if (updated) sync(`/api/serials/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      return next
    }),

    releaseSerialToStock: (serialId, destination = 'warehouse') => {
      const user = currentUser()
      if (!user || !['director', 'admin_officer', 'inventory_officer'].includes(user.role)) {
        showToast('Only Inventory, Admin Officer or Director can release held serials', 'error')
        return false
      }
      const serial = serialRef.current.find(s => s.id === serialId)
      if (!serial) { showToast('Serial not found', 'error'); return false }
      if (serial.status === 'available') {
        showToast('Serial is already available on hand', 'info')
        return false
      }
      if (serial.status === 'sold') {
        showToast('Sold serials must be returned via buyback, exchange or RMA — not released directly', 'error')
        return false
      }
      if (!['assigned', 'returned'].includes(serial.status)) {
        showToast(`Cannot release serial with status “${serial.status.replace(/_/g, ' ')}”`, 'error')
        return false
      }

      // Detach from any open SO line that still holds this serial id.
      setSaleOrders(prev => prev.map(so => {
        const touched = so.lines.some(l => (l.serialIds || []).includes(serialId))
        if (!touched) return so
        const lines = so.lines.map(l => ({
          ...l,
          serialIds: (l.serialIds || []).filter(id => id !== serialId),
        }))
        const updated = { ...so, lines }
        sync(`/api/sale-orders/${so.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))

      const dest: LocationId = (['warehouse', 'shop', 'repair_unit'] as LocationId[]).includes(destination)
        ? destination
        : 'warehouse'
      const nextSerial: SerialNumber = {
        ...serial,
        status: 'available',
        location: dest,
        saleOrderId: undefined,
        repairId: undefined,
        soldDate: undefined,
      }
      setSerials(p => {
        const next = p.map(s => s.id === serialId ? nextSerial : s)
        sync(`/api/serials/${serialId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nextSerial) })
        return next
      })
      addAuditLog(
        'serial_release',
        serial.serial,
        `Released ${serial.serial} from ${serial.status} → available @ ${dest} by ${user.name}`,
      )
      showToast(`${serial.serial} returned to on-hand (available)`, 'success')
      return true
    },

    getSalesApprovalState: (documentId: string) => {
      const requests = approvalRequests.filter(r => r.documentId === documentId && ['discount', 'credit_override', 'backorder', 'special_pricing'].includes(r.type))
      if (requests.length === 0) return { status: 'not_required', requests }
      if (requests.some(r => r.status === 'rejected')) return { status: 'rejected', requests }
      if (requests.some(r => r.status === 'pending')) return { status: 'pending', requests }
      return { status: 'approved', requests }
    },

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
      const so: SaleOrder = {
        id: uid(), ref: soRef, status: 'quotation', customerId, customerName,
        date: now(), validUntil: initial.validUntil ?? addDays(now(), 30), lines: initialLines, ...totals,
        approvalStatus: 'not_required', approvalRequestIds: [], stockReservationIds: [],
        deliveryDate: initial.deliveryDate,
        paymentTerms: initial.paymentTerms,
        notes: initial.notes ?? '',
        customerRef: initial.customerRef,
        invoiceAddress: initial.invoiceAddress,
        deliveryAddress: initial.deliveryAddress,
        pricelist: initial.pricelist || 'RETAIL',
        pricelistId: (initial as any).pricelistId,
        ...money,
        // Odoo defaults the salesperson to the creating user; the form may override.
        salespersonId: initial.salespersonId ?? user?.id,
        salespersonName: initial.salespersonName ?? user?.name,
        salesTeam: initial.salesTeam,
        createdByUserId: user?.id, createdByName: user?.name,
      }
      setSaleOrders(p => [so, ...p])
      sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })
      showToast(`${so.ref} created`)
      return so
    },
    updateSaleOrder: async (id, p, opts) => {
      const existing = soRef.current.find(s => s.id === id)
      if (!existing) return false
      // Sent / confirmed documents are locked for content edits. Allow narrow
      // metadata (e.g. proformaRef) so PDF helpers still work without a reset.
      const keys = Object.keys(p)
      const metadataOnly = keys.length > 0 && keys.every(k => k === 'proformaRef')
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

      // Draft deletes/adds live on soRef. Never let a stale React `activeOrder.lines`
      // (passed from Save) resurrect products the user already removed.
      let linesForUpdate = syncLines && Array.isArray(p.lines) ? p.lines as SaleOrderLine[] : existing.lines
      if (syncLines && Array.isArray(p.lines) && isSaleOrderDraftEditing(id)) {
        const draft = soRef.current.find(s => s.id === id) ?? existing
        const overlay = new Map((p.lines as SaleOrderLine[]).map(l => [l.id, l]))
        linesForUpdate = draft.lines.map(l => overlay.get(l.id) ?? l)
      }
      const updated = syncLines
        ? { ...existing, ...p, lines: linesForUpdate, ...calcSO(linesForUpdate) }
        : { ...existing, ...p }

      if (syncLines && !persistLines) {
        applyLocalDraftSaleOrder(soRef, setSaleOrders, id, updated)
        return true
      }

      if (persistLines) {
        applyLocalDraftSaleOrder(soRef, setSaleOrders, id, updated)
      } else {
        soRef.current = soRef.current.map(s => s.id === id ? updated : s)
        setSaleOrders(prev => prev.map(s => s.id === id ? updated : s))
      }

      const persist = async () => {
        // Re-read draft at persist time so a delete that landed after click still wins.
        const live = soRef.current.find(s => s.id === id) ?? updated
        const persistPayload = persistLines
          ? { ...live, lines: live.lines, ...calcSO(live.lines as SaleOrderLine[]) }
          : p
        // Metadata: send only the patch so a notes keystroke cannot rewrite lines.
        // Save: send the full draft row (minus lockVersion).
        const body = persistLines
          ? (persistPayload as unknown as Record<string, unknown>)
          : (p as unknown as Record<string, unknown>)
        const result = await patchSaleOrderPersist(id, body)
        if (!result.ok) {
          if (persistLines) {
            const latest = soRef.current.find(s => s.id === id)
            const stillOurs = latest && latest.lines === updated.lines
            if (stillOurs) {
              soRef.current = soRef.current.map(s => s.id === id ? existing : s)
              setSaleOrders(prev => prev.map(s => s.id === id ? existing : s))
            }
          }
          showToast(result.error, 'error')
          return false
        }
        applySaleOrderPersistResult(setSaleOrders, soRef, id, result.data, { syncLines: persistLines })
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
            _pendingSync['deed_saleOrders'] = serialized
            addDirtyKey('deed_saleOrders')
            if (typeof window !== 'undefined' && serialized.length <= 512 * 1024) {
              window.localStorage.setItem('deed_saleOrders', serialized)
            }
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

      if (persistLines) return persist()
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
      let lines: SaleOrderLine[]
      if (ex) {
        const nextQty = ex.qty + qty
        const nextPriced = resolveListPrice({ product, pricelist: so.pricelist, qty: nextQty })
        lines = so.lines.map(l => l.productId === product.id ? {
          ...l,
          qty: nextQty,
          unitPrice: nextPriced.unitPrice,
          listPrice: nextPriced.listPrice,
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
          taxRate: product.taxRate > 0 ? product.taxRate : defaultTaxRate,
          subtotal: sub,
          serialIds: [],
          accountCode: resolveProductAccounts(product).saleAccountCode,
        }]
      }
      const updated = { ...so, lines, ...calcSO(lines) }
      applyLocalDraftSaleOrder(soRef, setSaleOrders, orderId, updated)
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
      return true
    },
    confirmSO: async (id) => {
      const user = currentUser()
      if (!user || !['director', 'sales_rep', 'admin_officer'].includes(user.role)) {
        showToast('Unauthorized to confirm Sales Orders', 'error'); return;
      }
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
        const orderLines = so.lines.filter((line: any) => line.lineType !== 'section')
        if (!orderLines.length) {
          showToast('Add at least one product before confirming', 'error')
          return
        }

        const leftoverSalesApprovals = approvalRequests.filter(r =>
          r.documentId === id &&
          ['discount', 'credit_override', 'backorder', 'special_pricing'].includes(r.type) &&
          r.status === 'pending',
        )
        if (leftoverSalesApprovals.length > 0) {
          const leftoverIds = new Set(leftoverSalesApprovals.map(r => r.id))
          setApprovalRequests(prev => prev.map(r =>
            leftoverIds.has(r.id)
              ? { ...r, status: 'cancelled' as const, notes: 'Auto-cleared: sales confirmation approvals disabled' }
              : r,
          ))
        }

        const unpaidInvoices = invoices.filter(inv =>
          inv.partnerId === so.customerId &&
          inv.type === 'customer_invoice' &&
          isOpenInvoice(inv)
        )
        const overdueBalance = unpaidInvoices
          .filter(inv => inv.dueDate < now())
          .reduce((sum, inv) => sum + Math.max(0, inv.total - inv.amountPaid), 0)
        if (overdueBalance > 0) {
          showToast(`Account locked by overdue balance of ${fmtKes(overdueBalance)}. Clear overdue invoices before confirming.`, 'error')
          return
        }

        const orderRef = await storeCtxRef.current!.allocateDocRef('SO')
        const confirmedAt = new Date().toISOString()
        // Omit lockVersion so a stale client version cannot 409 the confirm after line edits.
        const confirmBody = {
          ref: orderRef,
          orderNumber: orderRef,
          quotationRef: so.quotationRef ?? so.ref,
          status: 'sale' as const,
          confirmedAt,
          confirmedById: user.id,
          confirmedByName: user.name,
          approvedBy: user.id,
          approvalStatus: 'not_required' as const,
          locked: systemSettings.salesLockConfirmed || undefined,
        }

        const confirmRes = await fetch(`/api/sale-orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(confirmBody),
        })
        const confirmPayload = await confirmRes.json().catch(() => null)
        if (!confirmRes.ok) {
          showToast(confirmPayload?.error ?? `Could not confirm ${so.ref} — try again`, 'error')
          return
        }

        const serverRef = String(confirmPayload?.orderNumber ?? confirmPayload?.ref ?? orderRef)
        const serverLock = confirmPayload?.lockVersion

        let del = reuseDelivery
        if (!del) {
          const dnRef = await storeCtxRef.current!.allocateDocRef('DN')
          del = {
            id: uid(), ref: dnRef, saleOrderId: id, saleOrderRef: serverRef,
            customerId: so.customerId, customerName: so.customerName,
            status: 'waiting', date: now(),
            lines: orderLines.map(l => {
              const prod = prodRef.current.find(p => p.id === l.productId)
              const selectedSource = (so.lines.find(line => line.id === l.id) as (SaleOrderLine & { sourceLocation?: LocationId }) | undefined)?.sourceLocation
              let sourceLocation
              if (prod?.unit === 'service') {
                sourceLocation = undefined
              } else if (selectedSource) {
                sourceLocation = selectedSource
              } else if (prod && isSerialTracking(inferTrackingMethod(prod))) {
                const shopAvailable = serialRef.current.filter(s => s.productId === l.productId && s.status === 'available' && s.location === 'shop').length
                sourceLocation = shopAvailable >= l.qty ? 'shop' : 'warehouse'
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
        } else {
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
            deliveryId: del.id,
            lockVersion: serverLock ?? s.lockVersion,
          }
        }))

        addAuditLog('confirm_sale_order', serverRef, `Quotation ${snapshot.ref} confirmed into Sales Order ${serverRef} by ${user.name}${systemSettings.salesLockConfirmed ? ' · order locked' : ''}`)
        showToast(`${snapshot.ref} confirmed as ${serverRef} — prepare delivery ${del.ref} to allocate stock`)
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

      const orderLines = so.lines.filter((line: any) => line.lineType !== 'section')
      if (!orderLines.length) {
        showToast('Cannot create delivery — order has no product lines', 'error')
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
          if (prod?.unit === 'service') {
            sourceLocation = undefined
          } else if (prod && isSerialTracking(inferTrackingMethod(prod))) {
            const shopAvailable = serialRef.current.filter(s => s.productId === l.productId && s.status === 'available' && s.location === 'shop').length
            sourceLocation = shopAvailable >= l.qty ? 'shop' : 'warehouse'
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
      if (!user || user.role !== 'director') {
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
      if (!del || !['draft', 'waiting', 'ready'].includes(del.status)) {
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

      for (let i = 0; i < del.lines.length; i++) {
        const deliveryLine = del.lines[i]
        const planned = plan.lines[i]
        const product = prodRef.current.find(p => p.id === deliveryLine.productId)
        const serialTracked = !!product && isSerialTracking(inferTrackingMethod(product))
        const stockTracked = !!product && isStockTracked(inferTrackingMethod(product))
        const qty = planned?.qty ?? 0
        const serialIds = planned?.serialIds ?? []
        let sourceLocation = (deliveryLine.sourceLocation ?? 'warehouse') as LocationId

        if (serialTracked && qty > 0) {
          const invalid = serialIds.find(id => {
            const serial = serialRef.current.find(item => item.id === id)
            return !serial || serial.status !== 'assigned' || serial.saleOrderId !== so.id
          })
          if (invalid) {
            showToast(`A selected serial for ${deliveryLine.productName} is no longer reserved for this Sales Order`, 'error')
            return false
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
    validateDelivery: async (deliveryId, qtysDone) => {
      if (!canApproveInventoryAction(currentUser())) {
        showToast('Only Inventory or Admin can validate deliveries', 'error'); return;
      }
      const del = delRef.current.find(d => d.id === deliveryId)!
      const so  = soRef.current.find(s => s.id === del.saleOrderId)!
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

      const newWarranties: Warranty[] = []
      doneLines.forEach(l => {
        const prod = prodRef.current.find(x => x.id === l.productId)
        if (prod && prod.unit !== 'service') {
          if (!isSerialTracking(inferTrackingMethod(prod)) && l.sourceLocation !== undefined) setBulkStock(prev => upsertBulkStock(prev, l.productId, l.sourceLocation as LocationId, -l.qty))
          setProducts(p => p.map(x => x.id === l.productId ? { ...x, stockQty: Math.max(0, x.stockQty - l.qty) } : x))
          addMove(l.productId, l.productName, l.qty, 'out', `Delivery ${del.ref}`, del.ref, l.sourceLocation ?? 'warehouse', 'customer', l.serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id))
        }
        l.serialIds.forEach(sid => {
          setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'sold', location: 'customer', soldDate: now(), saleOrderId: del.saleOrderId } : s))
          if (prod && prod.warrantyMonths > 0) {
            const serial = serialRef.current.find(s => s.id === sid)
            const war: Warranty = {
              id: uid(), ref: seq('WAR', 'war'),
              customerId: del.customerId, customerName: del.customerName,
              productId: l.productId, productName: l.productName,
              serialId: sid, serialNumber: serial?.serial ?? '',
              deliveryId: del.id, saleOrderRef: so.ref,
              startDate: now(), endDate: addMonths(now(), prod.warrantyMonths),
              status: 'active', months: prod.warrantyMonths,
            }
            newWarranties.push(war)
          }
        })
      })
      if (newWarranties.length > 0) setWarranties(p => [...p, ...newWarranties])
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
      // Clamp to SO remaining after this shipment; skip if already covered or
      // another open picking already holds the remainder (avoids DN spam on qty=1).
      let backorder: Delivery | null = null
      const remainingAfterShip = remainingUndeliveredByProduct(
        (so.lines ?? []).map(line => {
          const shipped = doneLines.find(d => d.productId === line.productId)?.qty ?? 0
          return {
            ...line,
            qtyDelivered: Math.max(0, Number(line.qtyDelivered) || 0) + shipped,
          }
        }),
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
      if (clampedBackorder.length > 0) {
        // Ready when the remaining quantity is on hand, Waiting otherwise.
        const backorderShort = clampedBackorder.some(l => {
          const prod = prodRef.current.find(p => p.id === l.productId)
          if (!prod || prod.unit === 'service') return false
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
      const completedLines = del.lines.map(l => ({
        ...l,
        qtyDone: doneLines.find(x => x.productId === l.productId)?.qty ?? 0,
      }))
      setDeliveries(p => {
        const next = p.map(d => d.id === deliveryId ? {
          ...d,
          status: 'done' as const,
          warrantyCreated: newWarranties.length > 0,
          lines: completedLines,
        } : d)
        return backorder ? [backorder, ...next] : next
      })

      // Track delivered quantities on the sale order lines. The order status
      // itself stays "Sales Order" — delivery progress is not a sale state.
      setSaleOrders(p => p.map(s => {
        if (s.id !== del.saleOrderId) return s;
        const doneByProduct: Record<string, number> = {}
        doneLines.forEach(l => { doneByProduct[l.productId] = (doneByProduct[l.productId] ?? 0) + l.qty })
        const lines = s.lines.map((l: any) => doneByProduct[l.productId]
          ? { ...l, qtyDelivered: Math.min(Number(l.qty) || 0, (Number(l.qtyDelivered) || 0) + doneByProduct[l.productId]) }
          : l)
        const updated = { ...s, lines }
        sync(`/api/sale-orders/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      sync(`/api/deliveries/${deliveryId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'done',
          lines: completedLines,
          warrantyCreated: newWarranties.length > 0,
          autoInvoice: false,
        }),
      })
      addAuditLog('validate_delivery', del.ref, `Delivery validated${backorder ? ` · backorder ${backorder.ref} created` : ''}`)
      showToast(`Delivery done · stock updated${backorder ? ` · backorder ${backorder.ref} created` : ''}${newWarranties.length > 0 ? ` · ${newWarranties.length} warranty(ies) created` : ''}`)
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
        const doneByProduct: Record<string, number> = {}
        healedLines.forEach(line => {
          if ((line.qtyDone || 0) > 0) {
            doneByProduct[line.productId] = (doneByProduct[line.productId] ?? 0) + (line.qtyDone || 0)
          }
        })
        const lineUpdates = so.lines
          .map(line => {
            const add = doneByProduct[line.productId] ?? 0
            if (add <= 0) return null
            const next = Math.max(Number(line.qtyDelivered) || 0, Math.min(Number(line.qty) || 0, add))
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
    createInvoiceFromSO: async (orderId, lineOverrides) => {
      if (!canCreateCustomerInvoiceFromSOAction(currentUser())) {
        showToast('Only Finance or Admin Officer can create invoices from a sale order', 'error'); return {} as Invoice;
      }
      const so = soRef.current.find(s => s.id === orderId)
      if (!so) { showToast('Sale order not found', 'error'); return {} as Invoice }
      if (so.status !== 'sale') {
        showToast('Only a confirmed Sales Order can be invoiced', 'error'); return {} as Invoice;
      }
      if (!hasValidatedDeliveryForInvoice(delRef.current, orderId)) {
        showToast('Validate the delivery before creating an invoice', 'error')
        return {} as Invoice
      }

      // Prefer server-atomic path (qtyInvoiced bump + invoice create in one transaction).
      try {
        const response = await fetch(`/api/sale-orders/${orderId}/create-invoice`, {
          method: 'POST',
          ...(lineOverrides ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines: lineOverrides }),
          } : {}),
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
            dueDate: remote.dueDate || addDays(now(), parseInt(so.paymentTerms ?? '', 10) || 30),
            lines: remoteLines,
            subtotal: subtotal || remoteLines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0),
            taxTotal,
            total: total || subtotal + taxTotal,
            amountPaid: Number(remote.amountPaid) || 0,
            saleOrderId: remote.saleOrderId || so.id,
            notes: remote.notes || `Created from ${so.ref}`,
            invoiceAddress: so.invoiceAddress,
            deliveryAddress: so.deliveryAddress,
            ...documentMoneySnapshot({
              currencyCode: (remote as any).currencyCode || so.currencyCode || companySettings.currency,
              exchangeRateToBase: (remote as any).exchangeRateToBase ?? so.exchangeRateToBase,
            }),
          }
          // Only push into local store when we have lines — empty shells overwrite the mirror.
          if (remoteLines.length > 0) {
            setInvoices(p => [local, ...p.filter(i => i.id !== local.id)])
          }
          addAuditLog('create_invoice_from_so', local.ref, `Draft invoice created from ${so.ref} (server atomic)`)
          showToast(`Draft invoice ${local.ref} created — post it to finalize`)
          return local
        }
        if (payload?.error) {
          showToast(payload.error, 'error')
          return {} as Invoice
        }
      } catch {
        // Fall through to client path if server unavailable
      }

      // A partial-invoice request must never silently fall back to invoicing
      // everything — that would invoice quantities the user explicitly chose
      // not to invoice this round.
      if (lineOverrides) {
        showToast('Could not reach the server to create the partial invoice — try again', 'error')
        return {} as Invoice
      }

      // Odoo-style invoicing fallback (client) when server path unavailable.
      const itemLines = so.lines.filter((l: any) => l.lineType !== 'section')
      const invoiceable = itemLines.map((l: any) => ({
        line: l,
        qtyToInvoice: odooInvoiceableQty({
          qty: Number(l.qty) || 0,
          qtyDelivered: Number(l.qtyDelivered) || 0,
          qtyInvoiced: Number(l.qtyInvoiced) || 0,
          // This workflow invoices fulfilled quantities only.
          invoicePolicy: 'delivery' as InvoicePolicy,
        }),
      })).filter(entry => entry.qtyToInvoice > 0)

      if (invoiceable.length === 0) {
        showToast('Nothing to invoice on this order — quantities are already invoiced or not yet delivered', 'error')
        return {} as Invoice
      }

      const invLines: InvoiceLine[] = invoiceable.map(({ line: l, qtyToInvoice }) => {
        const unitNet = (Number(l.qty) || 0) > 0 ? (Number(l.subtotal) || 0) / Number(l.qty) : Number(l.unitPrice) || 0
        return {
          id: uid(), lineType: 'item', description: `${l.productName} ×${qtyToInvoice}`,
          qty: qtyToInvoice, unitPrice: l.unitPrice, taxRate: l.taxRate,
          subtotal: Math.round(unitNet * qtyToInvoice),
          productId: l.productId, accountCode: l.accountCode,
        }
      })
      const subtotal = invLines.reduce((s, l) => s + l.subtotal, 0)
      const taxTotal = invLines.reduce((s, l) => s + Math.round(l.subtotal * (l.taxRate || 0) / 100), 0)
      const total = subtotal + taxTotal
      if (total < 1) {
        showToast('Invoice total must be at least KES 1 — invoices below KES 1 cannot be created', 'error'); return {} as Invoice;
      }

      // The invoice is created in Draft: finance reviews and posts it, which
      // assigns the official INV number, the accounting entry, and locks
      // financial fields. Customer, addresses, payment terms and the source
      // document all carry forward from the order.
      const inv: Invoice = {
        id: uid(), ref: draftInvoiceRef('customer_invoice'), type: 'customer_invoice', status: 'draft',
        partnerId: so.customerId, partnerName: so.customerName,
        date: now(), dueDate: addDays(now(), parseInt(so.paymentTerms ?? '', 10) || 30),
        lines: invLines,
        subtotal, taxTotal, total, amountPaid: 0,
        invoiceAddress: so.invoiceAddress,
        deliveryAddress: so.deliveryAddress,
        saleOrderId: orderId, notes: `Source document: ${so.ref}`,
      }
      setInvoices(p => [inv, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv) })

      // Track invoiced quantities on the order lines; the order status itself
      // stays "Sales Order" and its invoice status is derived from the ledger.
      const invoicedByLine = new Map(invoiceable.map(({ line, qtyToInvoice }) => [line.id, qtyToInvoice]))
      setSaleOrders(p => p.map(s => {
        if (s.id !== orderId) return s;
        const lines = s.lines.map((l: any) => invoicedByLine.has(l.id)
          ? { ...l, qtyInvoiced: (Number(l.qtyInvoiced) || 0) + invoicedByLine.get(l.id)! }
          : l)
        const updated = { ...s, lines, invoiceId: inv.id }
        sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      addAuditLog('create_invoice_from_so', inv.ref, `Draft invoice created from ${so.ref}`)
      showToast(`Draft invoice ${inv.ref} created — post it to finalize`); return inv
    },
    deleteSaleOrder: (id) => {
      const actor = currentUser()
      const so = soRef.current.find(s => s.id === id)
      if (!so) return
      const isQuotation = ['draft', 'sent', 'quotation', 'quotation_sent'].includes(so.status)
      if (!isQuotation && actor?.role !== 'director') {
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
    resetSOToDraft: (id) => {
      // Odoo "Set to Quotation": back to the quotation stage. Pending
      // deliveries are cancelled and reservations released so the quotation
      // carries no fulfilment side effects.
      const actor = currentUser()
      const so = soRef.current.find(s => s.id === id)
      if (!so) return
      // Sent → draft: sales staff may unlock for edits. Confirmed SO → quotation
      // still requires Finance / Director.
      const salesCanResetSent = ['director', 'finance_officer', 'sales_rep', 'admin_officer'].includes(actor?.role ?? '')
      const financeCanResetConfirmed = ['director', 'finance_officer'].includes(actor?.role ?? '')
      if (so.status === 'quotation_sent' || so.status === 'cancelled') {
        if (!actor || !salesCanResetSent) {
          showToast('You do not have permission to reset this quotation to draft', 'error')
          return
        }
      } else if (!actor || !financeCanResetConfirmed) {
        showToast('Only Finance or Director can reset a sale order to quotation', 'error')
        return
      }
      const blockers = saleOrderCancelBlockers({
        status: so.status === 'sale' ? 'sale' : so.status,
        deliveries: delRef.current.filter(d => d.saleOrderId === id),
        invoices: invRef.current.filter(i => i.saleOrderId === id),
      })
      // Always block reset when fulfilment/AR exists (same as cancel for confirmed).
      if (so.status === 'sale' && blockers.length > 0) {
        showToast(`Cannot reset ${so.ref}: ${blockers.join('; ')}`, 'error')
        return
      }
      const pendingDeliveries = delRef.current.filter(d => d.saleOrderId === id && ['draft', 'waiting', 'ready'].includes(d.status))
      pendingDeliveries.forEach(d => {
        setDeliveries(prev => prev.map(x => x.id === d.id ? { ...x, status: 'cancelled' as const } : x))
        sync(`/api/deliveries/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) })
      })
      setStockReservations(prev => prev.map(r =>
        r.referenceId === id && r.status === 'reserved' ? { ...r, status: 'cancelled' as const } : r
      ))
      // Release SO-picked serials back to available (same as cancel) so Available stock recovers.
      const allSerialIds = so.lines.flatMap((l: any) => l.serialIds ?? [])
      if (allSerialIds.length > 0) {
        setSerials(p => p.map(s => allSerialIds.includes(s.id) ? { ...s, status: 'available', saleOrderId: undefined } : s))
      }
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s;
        const updated = {
          ...s,
          status: 'quotation' as const,
          savedAt: undefined,
          deliveryId: undefined,
          locked: undefined,
          confirmedAt: undefined,
          confirmedById: undefined,
          confirmedByName: undefined,
          lines: s.lines.map((l: any) => ({ ...l, serialIds: [] })),
        }
        sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...updated, locked: false, confirmedAt: null }) })
        return updated
      }))
      addAuditLog('reset_to_quotation', so.ref, `Order set back to Quotation by ${actor.name}`)
      showToast(so.status === 'quotation_sent' ? 'Quotation reset to draft — you can edit and save' : 'Order set back to Quotation')
    },
    cancelSO: (id) => {
      const actor = currentUser()
      const so = soRef.current.find(s => s.id === id)
      if (!so) return
      // Cancelling a confirmed Sales Order reverses a commercial document,
      // same as "Set to Quotation" — requires Finance/Director (matches the
      // server-side gate in saleTransitionError).
      if (so.status === 'sale' && !['director', 'finance_officer'].includes(actor?.role ?? '')) {
        showToast('Only Finance or Director can cancel a confirmed Sales Order', 'error')
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
      // Release serials, pending deliveries and reservations.
      const allSerialIds = so.lines.flatMap((l: any) => l.serialIds ?? [])
      if (allSerialIds.length > 0) {
        setSerials(p => p.map(s => allSerialIds.includes(s.id) ? { ...s, status: 'available' } : s))
      }
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
        showToast('Only a quotation can have a new version — use Duplicate for confirmed Sales Orders', 'error')
        return null
      }
      try {
        const res = await fetch(`/api/sale-orders/${orderId}/new-version`, { method: 'POST' })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.id) {
          showToast(payload?.error || 'Could not create a new version', 'error')
          return null
        }
        const created = payload as SaleOrder
        setSaleOrders(p => [created, ...p])
        addAuditLog('sale_order_new_version', created.ref, `Version ${created.versionNumber} created from ${so.ref}`)
        showToast(`Created ${created.ref}`)
        return created
      } catch {
        showToast('Could not reach the server to create a new version', 'error')
        return null
      }
    },

    // ── Invoices ──────────────────────────────────────────────────────────────
    createManualInvoice: (type, partnerId, partnerName, dueDate, lines, vatRate, notes = '', documentDate) => {
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
        dueDate: dueDate || addDays(now(), 30),
        lines: builtLines,
        subtotal,
        taxTotal,
        total: subtotal + taxTotal,
        amountPaid: 0,
        notes,
      }
      setInvoices(prev => [invoice, ...prev])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })
      showToast(`${type === 'vendor_bill' ? 'Bill' : 'Invoice'} ${invoice.ref} created`, 'success')
      return invoice
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
          sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
      const limit = systemSettings.accAdminOfficerInvoiceLimitKes ?? DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES
      const gate = canPostOrPayCustomerInvoice({
        role: actor?.role,
        invoiceType: inv.type,
        invoiceTotal: inv.total,
        limitKes: limit,
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
      setInvoices(p => {
        const next = p.map(i => i.id === id ? { ...i, ...postedMeta } : i)
        const updated = next.find(i => i.id === id)
        if (updated) sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      // Auto-post GL journal using the shared posting engine.
      postInvoiceJournalOnce({ ...inv, ref: finalRef })
      addAuditLog('post_invoice', finalRef, `Posted by ${actor?.name || 'Finance'}`)
      showToast(`${finalRef} posted to accounting`)
    },
    setInvoicePaymentBlocked: (id, blocked) => {
      const actor = currentUser()
      if (!canManageFullFinanceAction(actor)) {
        showToast('Only Finance or Director can block or release invoice payments', 'error'); return
      }
      const inv = invRef.current.find(i => i.id === id)
      if (!inv || inv.status !== 'posted') {
        showToast('Only posted invoices can be blocked', 'error'); return
      }
      setInvoices(p => {
        const next = p.map(i => i.id === id ? { ...i, paymentBlocked: blocked } : i)
        const updated = next.find(i => i.id === id)
        if (updated) sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog(blocked ? 'block_invoice_payment' : 'release_invoice_payment', inv.ref, `${blocked ? 'Payment blocked' : 'Payment released'} by ${actor?.name ?? 'Finance'}`)
      showToast(blocked ? `${inv.ref} payment blocked` : `${inv.ref} payment released`)
    },
    registerPayment: (invoiceId, amount, method, bankAccountId, reference, paymentDate) => {
      const actor = currentUser()
      if (!canManageFinance(actor)) {
        showToast('Only Finance or Admin Officer can register payments', 'error'); return
      }
      const inv = invRef.current.find(i => i.id === invoiceId)
      if (!inv) return
      if (inv.status !== 'posted') {
        showToast('Only posted invoices can receive payments', 'error'); return
      }
      if (inv.paymentBlocked) { showToast('Payments are blocked on this invoice — release the block first', 'error'); return }
      const limit = systemSettings.accAdminOfficerInvoiceLimitKes ?? DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES
      const gate = canPostOrPayCustomerInvoice({
        role: actor?.role,
        invoiceType: inv.type,
        invoiceTotal: inv.total,
        limitKes: limit,
      })
      if (!gate.ok) { showToast(gate.reason || 'Cannot register payment', 'error'); return }
      const sod = canPayOwnPostedInvoice({
        role: actor?.role,
        actorUserId: actor?.id,
        postedByUserId: inv.postedByUserId,
        invoiceTotal: inv.total,
        sodThresholdKes: limit,
      })
      if (!sod.ok) { showToast(sod.reason || 'Segregation of duties blocked this payment', 'error'); return }
      const balance = inv.total - inv.amountPaid
      if (balance <= 0) { showToast('Invoice is already fully paid', 'info'); return }
      const capped = Math.min(amount, balance)
      const paymentId = crypto.randomUUID()
      const journal = buildInvoicePaymentJournal(inv, capped, method, bankAccountId, paymentDate, paymentId)
      if (journalEntries.some(j => j.ref === journal.ref)) {
        showToast('This payment journal was already posted', 'info'); return
      }
      setInvoices(p => {
        const next = p.map(i => {
          if (i.id !== invoiceId) return i
          const paid = i.amountPaid + capped
          const newPayment: InvoicePayment = {
            id: paymentId,
            date: paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString(),
            amount: capped,
            method: method || 'cash',
            reference: reference || undefined,
            bankAccountId: bankAccountIdForMethod(method, bankAccountId),
            recordedBy: actor?.name || 'Finance',
          }
          const append = `\nPaid ${fmtKes(capped)} via ${method || 'cash'}${bankAccountId ? ` (Bank: ${bankAccountId})` : ''}${reference ? ` Ref: ${reference}` : ''}`
          return {
            ...i,
            amountPaid: paid,
            notes: (i.notes || '') + append,
            payments: [...(i.payments || []), newPayment],
          }
        })
        return next
      })
      setJournalEntries(p => [journal, ...p])
      fetch(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: capped,
          paymentMethod: method || 'cash',
          reference: reference || undefined,
          paidAt: paymentDate,
          bankAccountId,
          idempotencyKey: paymentId,
        }),
      })
      addAuditLog('register_payment', invoiceId, `Registered payment of KES ${capped} for ${inv.ref}${reference ? ` (Ref: ${reference})` : ''}`)
      showToast('Payment registered')
    },
    resetInvoiceToDraft: (id) => {
      const actor = currentUser()
      if (!canManageFullFinanceAction(actor)) {
        showToast('Only Finance or Director can reset invoices to draft', 'error')
        return
      }
      const inv = invRef.current.find(i => i.id === id)
      if (!inv) return
      if (inv.status === 'cancelled') {
        showToast('Cancelled invoices cannot be reset to draft', 'error')
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
      if (reversals.length > 0) setJournalEntries(prev => [...reversals, ...prev])
      const draft: Invoice = {
        ...inv,
        status: 'draft',
        amountPaid: 0,
        payments: [],
        notes: `${inv.notes || ''}\nReset to draft by ${actor?.name ?? 'Finance'} for changes.`.trim(),
      }
      setInvoices(prev => prev.map(i => i.id === id ? draft : i))
      sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      addAuditLog('reset_invoice_draft', inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} reset to draft${reversals.length ? ` with ${reversals.length} reversal journal${reversals.length === 1 ? '' : 's'}` : ''}`)
      showToast(`${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} reset to draft`)
    },
    cancelInvoice: async (id, forcedCreditRef) => {
      const actor = currentUser()
      if (!canManageFullFinanceAction(actor)) {
        showToast('Only Finance or Director can cancel invoices', 'error')
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
      sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cancelled) })
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
      if (typeof window !== 'undefined' && kind) {
        try {
          return await allocateDocNumber(kind)
        } catch {
          /* fall through to local sequence */
        }
      }
      return allocateDocNumberSync(prefix)
    },

    // ── Purchase Orders ───────────────────────────────────────────────────────
    createPO: async (vendorId, vendorName, initial = {}, forcedRef) => {
      if (!canManageProcurement(currentUser())) {
        showToast('Only Inventory or Admin can create Purchase Orders', 'error'); return {} as PurchaseOrder;
      }
      const initialLines = initial.lines ?? []
      const poRefAllocated = forcedRef ?? await storeCtxRef.current!.allocateDocRef('PO')
      const po: PurchaseOrder = {
        id: uid(), ref: poRefAllocated, status: 'draft', vendorId, vendorName,
        date: now(), expectedDate: initial.expectedDate ?? addDays(now(), 7),
        approvalStatus: 'not_required', approvalRequestIds: [],
        lines: initialLines, ...calcPO(initialLines), notes: initial.notes ?? '', receiptIds: [],
      }
      setPurchaseOrders(p => [po, ...p]); addAuditLog('create_po', po.ref, `Draft purchase order created for vendor ${vendorName}`)
      showToast(`${po.ref} created`);
      sync('/api/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(po) })
      return po
    },
    updatePO: (id, p) => setPurchaseOrders(prev => {
      const next = prev.map(po => po.id === id ? { ...po, ...p } : po)
      const updated = next.find(po => po.id === id)
      if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      return next
    }),
    addPOLine: (poId, product, qty, unitPrice, taxRate) => {
      const catCfg = CATEGORY_CONFIG[product.category as CategoryId] ?? { serialRequired: false }
      const effectiveTaxRate = taxRate !== undefined ? taxRate : product.taxRate
      setPurchaseOrders(p => {
        const next = p.map(po => {
          if (po.id !== poId) return po
          const line: POLine = { id: uid(), productId: product.id, productName: product.name, qty, qtyReceived: 0, unitPrice, taxRate: effectiveTaxRate, subtotal: qty * unitPrice, requiresSerial: catCfg.serialRequired, accountCode: resolveProductAccounts(product).costAccountCode }
          const lines = [...po.lines, line]
          return { ...po, lines, ...calcPO(lines) }
        })
        const updated = next.find(po => po.id === poId)
        if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
    },
    removePOLine: (poId, lineId) => {
      setPurchaseOrders(p => {
        const next = p.map(po => { if (po.id !== poId) return po; const lines = po.lines.filter(l => l.id !== lineId); return { ...po, lines, ...calcPO(lines) } })
        const updated = next.find(po => po.id === poId)
        if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
    },
    updatePOLine: (poId, lineId, updates) => {
      setPurchaseOrders(p => {
        const next = p.map(po => {
          if (po.id !== poId) return po
          const lines = po.lines.map(l => {
            if (l.id !== lineId) return l
            const qty       = updates.qty       !== undefined ? updates.qty       : l.qty
            const unitPrice = updates.unitPrice !== undefined ? updates.unitPrice : l.unitPrice
            const taxRate   = updates.taxRate   !== undefined ? updates.taxRate   : l.taxRate
            return { ...l, ...updates, qty, unitPrice, taxRate, subtotal: qty * unitPrice }
          })
          return { ...po, lines, ...calcPO(lines) }
        })
        const updated = next.find(po => po.id === poId)
        if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
    },
    bulkAddPOLines: (poId, rows) => {
      setPurchaseOrders(p => {
        const next = p.map(po => {
          if (po.id !== poId) return po
          const newLines: POLine[] = rows.map(r => ({
            id: uid(), productId: r.productId, productName: r.productName,
            qty: r.qty, qtyReceived: 0, unitPrice: r.unitPrice, taxRate: r.taxRate,
            subtotal: r.qty * r.unitPrice, requiresSerial: r.requiresSerial,
            importedSerials: r.importedSerials?.length ? r.importedSerials : undefined,
            specs: r.specs || undefined,
            accountCode: r.accountCode,
          }))
          const lines = [...po.lines, ...newLines]
          return { ...po, lines, ...calcPO(lines) }
        })
        const updated = next.find(po => po.id === poId)
        if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
    },
    sendPO: (id) => {
      const po = poRef.current.find(p => p.id === id)
      if (!po) return
      const vendor = contacts.find(c => c.id === po.vendorId)
      
      setPurchaseOrders(p => {
        const next = p.map(po => po.id === id ? { ...po, status: 'sent' as const } : po)
        const updated = next.find(po => po.id === id)
        if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('send_po', po.ref, `PO sent to vendor ${po.vendorName}`)
      showToast('PO sent to vendor')
    },
    revertPOToDraft: (id) => {
      const po = poRef.current.find(p => p.id === id)
      if (!po || !['draft', 'sent'].includes(po.status)) return
      setPurchaseOrders(p => {
        const next = p.map(po => po.id === id ? { ...po, status: 'draft' as const } : po)
        const updated = next.find(po => po.id === id)
        if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      showToast('PO reverted to draft')
    },
    confirmPO: async (id) => {
      const user = currentUser()
      if (!canManageProcurement(user)) {
        showToast('Only Inventory or Admin can confirm Purchase Orders', 'error'); return;
      }
      const po = poRef.current.find(p => p.id === id)
      if (!po) return

      const purchaseApprovals = approvalRequests.filter(r =>
        r.documentType === 'purchase_order' && r.documentId === id && r.type === 'purchase_high_value',
      )
      if (purchaseApprovals.some(r => r.status === 'rejected')) {
        showToast('Purchase approval was rejected — revise the PO before confirming', 'error')
        return
      }
      if (purchaseApprovals.some(r => r.status === 'pending') || po.approvalStatus === 'pending') {
        showToast('Purchase approval is still pending', 'error')
        return
      }

      const requireHighValue = systemSettings.purRequireApprovalHighValue !== false
      const threshold = Number(systemSettings.purHighValueThreshold ?? 50000)
      const alreadyApproved = purchaseApprovals.some(r => r.status === 'approved')
      if (requireHighValue && po.total > threshold && !alreadyApproved) {
        const request = createApprovalRequest(
          'purchase_high_value',
          'purchase_order',
          id,
          po.ref,
          user!.id,
          user!.name,
          {
            reason: `PO total ${fmtKes(po.total)} exceeds high-value threshold ${fmtKes(threshold)}`,
            proposedValue: po.total,
            threshold,
          },
          users.map(u => ({ id: u.id, name: u.name, role: u.role })),
        )
        setApprovalRequests(prev => [request, ...prev])
        setPurchaseOrders(p => {
          const next = p.map(row => row.id === id
            ? { ...row, approvalStatus: 'pending' as const, approvalRequestIds: [...(row.approvalRequestIds ?? []), request.id] }
            : row)
          const updated = next.find(row => row.id === id)
          if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        addAuditLog('purchase_approval_required', po.ref, request.details.reason)
        showToast(`Approval required — PO total exceeds ${fmtKes(threshold)}`, 'info')
        return
      }

      // Auto-create incoming shipment (receipt) when PO is confirmed — Odoo behaviour
      const receiptRef = await storeCtxRef.current!.allocateDocRef('REC')
      const receipt: Receipt = {
        id: uid(), ref: receiptRef, poId: id, poRef: po.ref,
        vendorId: po.vendorId, vendorName: po.vendorName,
        status: 'draft', date: now(),
        lines: po.lines.map(l => ({
          productId: l.productId, productName: l.productName,
          qtyExpected: l.qty - l.qtyReceived, qtyReceived: 0, serials: [],
          requiresSerial: l.requiresSerial,
          importedSerials: l.importedSerials,
          specs: l.specs,
        })),
        destinationLocation: 'warehouse',
      }
      setReceipts(p => [receipt, ...p])
      sync('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) })
      setPurchaseOrders(p => {
        const next = p.map(row => row.id === id
          ? { ...row, status: 'confirmed' as const, approvalStatus: alreadyApproved ? 'approved' as const : (row.approvalStatus ?? 'not_required') }
          : row)
        const updated = next.find(row => row.id === id)
        if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('confirm_po', po.ref, `PO confirmed — receipt ${receipt.ref} created automatically`)
      showToast(`Order confirmed · Receipt ${receipt.ref} ready for goods receiving`)
    },
    createReceiptFromPO: async (poId, forcedRef) => {
      const po = poRef.current.find(p => p.id === poId)!
      const outstandingLines = po.lines.filter(l => l.qtyReceived < l.qty)
      if (outstandingLines.length === 0) {
        showToast('All ordered quantities have already been received', 'info')
        return recRef.current.find(r => r.poId === poId && r.status === 'draft') ?? null
      }
      const receipt: Receipt = {
        id: uid(),
        ref: forcedRef ?? await storeCtxRef.current!.allocateDocRef('REC'),
        poId, poRef: po.ref,
        vendorId: po.vendorId, vendorName: po.vendorName,
        status: 'draft', date: now(),
        lines: outstandingLines.map(l => ({
          productId: l.productId, productName: l.productName,
          qtyExpected: l.qty - l.qtyReceived, qtyReceived: 0, serials: [],
          requiresSerial: l.requiresSerial,
          importedSerials: l.importedSerials,
          specs: l.specs,
        })),
        destinationLocation: 'warehouse',
      }
      setReceipts(p => [receipt, ...p])
      sync('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) })
      showToast(`Receipt ${receipt.ref} created`); 
      return receipt
    },
    validateReceipt: async (receiptId, lines, destination, serialAccessories, serialAccessoryNotes, serialSpecs, serialIssues) => {
      if (!canValidatePurchaseReceiptAction(currentUser())) {
        showToast('Only Director, Admin Officer, or Inventory Officer can validate GRNs', 'error'); return
      }
      const receipt = recRef.current.find(r => r.id === receiptId)!
      const po = poRef.current.find(p => p.id === receipt.poId)!
      // Validate: serialized products need all serial numbers
      for (const line of lines) {
        if (line.requiresSerial && line.serials.length < line.qtyReceived) {
          showToast(`Enter all serial numbers for ${line.productName} (${line.serials.length}/${line.qtyReceived})`, 'error'); return
        }
        for (const s of line.serials) {
          if (serialRef.current.find(x => x.serial === s)) {
            showToast(`Serial ${s} already exists in system`, 'error'); return
          }
        }
      }

      const receivedByProduct = new Map(lines.map(line => [line.productId, line.qtyReceived]))
      const updatedPoLines = po.lines.map(line => {
        const receivedQty = receivedByProduct.get(line.productId)
        if (receivedQty === undefined) return line
        return { ...line, qtyReceived: Math.min(line.qty, line.qtyReceived + receivedQty) }
      })
      const allReceived = updatedPoLines.every(line => line.qtyReceived >= line.qty)
      const anyReceived = updatedPoLines.some(line => line.qtyReceived > 0)
      const hasOtherDraftReceipt = recRef.current.some(r => r.poId === receipt.poId && r.status === 'draft' && r.id !== receiptId)
      const followUpLines = updatedPoLines
        .filter(line => line.qtyReceived < line.qty)
        .map(line => ({
          productId: line.productId,
          productName: line.productName,
          qtyExpected: line.qty - line.qtyReceived,
          qtyReceived: 0,
          serials: [] as string[],
          requiresSerial: line.requiresSerial,
          importedSerials: line.importedSerials?.slice(line.qtyReceived),
          specs: line.specs,
        }))
      const followUpRef = (!allReceived && anyReceived && !hasOtherDraftReceipt && followUpLines.length > 0)
        ? await storeCtxRef.current!.allocateDocRef('REC')
        : null
      const followUpReceipt: Receipt | null = followUpRef
        ? {
            id: uid(), ref: followUpRef, poId: receipt.poId, poRef: receipt.poRef,
            vendorId: receipt.vendorId, vendorName: receipt.vendorName,
            status: 'draft', date: now(),
            lines: followUpLines,
            destinationLocation: destination,
          }
        : null

      // Build rich serial rows, then apply authoritative server stock+serial mutation.
      const newSerials: SerialNumber[] = []
      const newRefurbJobs: RefurbishmentJob[] = []
      for (const line of lines) {
        if (!line.requiresSerial) continue
        for (const s of line.serials) {
          const issueDesc = serialIssues?.[s]?.trim() ?? ''
          const hasIssue = issueDesc.length > 0
          const newSerial: SerialNumber = {
            id: uid(), serial: s, productId: line.productId, productName: line.productName,
            location: hasIssue ? 'warehouse' : destination,
            status: hasIssue ? 'refurbishment' : 'available',
            purchaseOrderId: po.id,
            receiptId: receiptId,
            receivedDate: now(),
            barcode: buildInventoryBarcodeForProduct(line.productId, s),
            accessories: serialAccessories?.[s] ?? [],
            accessoryNotes: serialAccessoryNotes?.[s],
            specs: serialSpecs?.[s],
          }
          newSerials.push(newSerial)
          if (hasIssue) {
            newRefurbJobs.push({
              id: uid(), ref: seq('REF', 'refurb'),
              status: 'queued',
              serialId: newSerial.id, serialNumber: s,
              productId: line.productId, productName: line.productName,
              specs: serialSpecs?.[s],
              receiptId, receiptRef: receipt.ref,
              intakeDate: new Date().toISOString(),
              intakeIssueDescription: issueDesc,
              partsNeeded: [],
            })
          }
        }
      }

      try {
        const response = await fetch('/api/inventory/validate-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            applyStock: true,
            destination,
            receiptId,
            receiptRef: receipt.ref,
            purchaseOrderId: po.id,
            lines: lines.map(line => ({
              productId: line.productId,
              productName: line.productName,
              qtyReceived: Number(line.qtyReceived ?? 0),
              requiresSerial: Boolean(line.requiresSerial),
              serials: line.serials ?? [],
              serialRecords: newSerials.filter(s => s.productId === line.productId),
            })),
          }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { errors?: string[]; error?: string } | null
          const message = payload?.errors?.[0] || payload?.error || 'Receipt validation failed'
          showToast(message, 'error')
          return
        }
      } catch {
        showToast('Could not validate receipt on server', 'error')
        return
      }

      if (newSerials.length > 0) setSerials(p => [...p, ...newSerials])
      if (newRefurbJobs.length > 0) setRefurbishmentJobs(p => [...p, ...newRefurbJobs])

      // Mirror server stock into local UI state (server already persisted blobs).
      lines.forEach(line => {
        if (line.requiresSerial) {
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.serials.length } : x))
        } else {
          setBulkStock(prev => upsertBulkStock(prev, line.productId, destination, line.qtyReceived))
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qtyReceived } : x))
        }
      })

      // Update receipt status
      setReceipts(p => {
        const next = p.map(r => r.id === receiptId ? { ...r, status: 'validated' as const, lines, destinationLocation: destination } : r)
        if (followUpReceipt) next.unshift(followUpReceipt)
        const updated = next.find(r => r.id === receiptId)
        if (updated) sync(`/api/receipts/${receiptId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        if (followUpReceipt) sync('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(followUpReceipt) })
        return next
      })

      // Update PO quantities and status (receiptId already added in confirmPO)
      setPurchaseOrders(p => {
        const next = p.map(po => {
          if (po.id !== receipt.poId) return po
          const receiptIds = po.receiptIds.includes(receiptId) ? po.receiptIds : [...po.receiptIds, receiptId]
          const newReceiptIds = followUpReceipt && !receiptIds.includes(followUpReceipt.id) ? [...receiptIds, followUpReceipt.id] : receiptIds
          return { ...po, lines: updatedPoLines, status: allReceived ? 'received' as const : anyReceived ? 'partial' as const : po.status, receiptIds: newReceiptIds }
        })
        const updated = next.find(po => po.id === receipt.poId)
        if (updated) sync(`/api/purchase-orders/${receipt.poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      // Auto-resume repair if this PO was created from a procurement request
      if (po.repairId) {
        const linkedRepair = repairs.find(r => r.id === po.repairId)
        if (linkedRepair && linkedRepair.status === 'awaiting_parts') {
          // Mark procurement request as received
          setRepairs(prev => prev.map(r => r.id === po.repairId ? {
            ...r,
            procurementRequests: (r.procurementRequests ?? []).map(req =>
              req.id === po.procurementRequestId ? { ...req, status: 'received' as const } : req
            ),
          } : r))
          // Reserve parts into repair_unit and move repair back to approved
          const partLines = (linkedRepair.quote?.lines ?? []).filter(l => l.type === 'part' && l.productId)
          const grnReserve = planRepairPartReserve({
            repairRef: linkedRepair.ref,
            lines: partLines.map(line => {
              const product = prodRef.current.find(p => p.id === line.productId)
              return {
                productId: line.productId!,
                productName: line.productName ?? line.description,
                qty: line.qty,
                requiresSerial: Boolean(product?.requiresSerial),
              }
            }),
            stockFor: (productId) => {
              const product = prodRef.current.find(p => p.id === productId)
              const locs = calcStockByLocation(product, serialRef.current, bulkStock, productId)
              return { warehouse: locs.warehouse, shop: locs.shop, repair_unit: locs.repair_unit }
            },
            availableSerialsFor: (productId) => serialRef.current
              .filter(s => s.productId === productId && s.status === 'available')
              .map(s => ({ id: s.id, serial: s.serial, location: s.location })),
          })
          for (const step of grnReserve.steps) {
            if (step.kind === 'assign_serial') {
              setSerials(p => p.map(s => s.id === step.serialId
                ? { ...s, status: 'assigned' as const, repairId: po.repairId, location: 'repair_unit' as LocationId }
                : s))
              addMove(step.productId, step.productName, 1, 'transfer', step.reason, linkedRepair.ref, step.from, 'repair_unit', [step.serialNumber])
            } else {
              setBulkStock(prev => {
                let next = upsertBulkStock(prev, step.productId, step.from, -step.qty)
                next = upsertBulkStock(next, step.productId, step.to, step.qty)
                return next
              })
              addMove(step.productId, step.productName, step.qty, 'transfer', step.reason, linkedRepair.ref, step.from, step.to, [])
            }
          }
          const updatedQuoteLines = (linkedRepair.quote?.lines ?? []).map(l => ({
            ...l, reserved: l.type === 'part' ? true : l.reserved,
          }))
          const partsUsedNow = partLines.map(line => ({
            productId: line.productId ?? '', productName: line.productName ?? line.description,
            qty: line.qty, price: line.unitPrice, reservedDate: now(),
          }))
          setRepairs(prev => prev.map(r => r.id === po.repairId ? {
            ...r,
            status: 'approved',
            quote: r.quote ? { ...r.quote, lines: updatedQuoteLines } : r.quote,
            partsUsed: partsUsedNow,
            procurementRequests: (r.procurementRequests ?? []).map(req =>
              req.status === 'pending' || req.status === 'ordered' ? { ...req, status: 'received' as const } : req
            ),
          } : r))
          if (linkedRepair.assignedTechnicianId) {
            notifyUsers({
              recipients: [linkedRepair.assignedTechnicianId],
              type: 'repair',
              title: `Parts arrived — ${linkedRepair.ref} ready to start`,
              body: `${linkedRepair.productName} · Parts received via ${receipt.ref}`,
              module: 'repair', path: `?id=${linkedRepair.id}`, icon: '📦',
              entityKey: `repair:${linkedRepair.id}:parts_arrived`,
              excludeUserId: currentUserId,
            })
          }
          syncRepairToPortal({ ...linkedRepair, status: 'approved' }, 'Parts arrived — repair resuming')
          addAuditLog('parts_arrived', po.repairId, `Auto-resumed via GRN ${receipt.ref} (PO ${po.ref})`)
          showToast(`Stock received · Repair ${linkedRepair.ref} auto-resumed — technician notified`)
        } else {
          showToast(`Stock received · use "Create Bill" to generate the vendor invoice`)
        }
      } else {
        showToast(followUpReceipt ? `Stock received · ${followUpReceipt.ref} created for remaining items` : `Stock received · use "Create Bill" to generate the vendor invoice`)
      }
      addAuditLog('validate_receipt', receipt.ref, `Stock received from ${receipt.vendorName}`)
    },
    deletePO: (id) => { 
      setPurchaseOrders(p => p.filter(po => po.id !== id)); 
      sync(`/api/purchase-orders/${id}`, { method: 'DELETE' })
      showToast('PO deleted') 
    },
    createBillFromPO: (poId) => {
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance or Admin Officer can create vendor bills', 'error'); return null;
      }
      const po = poRef.current.find(p => p.id === poId)
      if (!po) return null
      const hasValidatedReceipt = recRef.current.some(r => r.poId === poId && r.status === 'validated')
      if (!hasValidatedReceipt) { showToast('Receive goods before creating a vendor bill', 'error'); return null }

      let billableLines: Array<POLine & { billQty: number }>
      try {
        billableLines = po.lines
          .map(l => {
            const billQty = billableQty(l)
            assertBillableQty(l, billQty)
            return { ...l, billQty }
          })
          .filter(l => l.billQty > 0)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Three-way match failed', 'error')
        return null
      }

      if (billableLines.length === 0) {
        showToast('No received quantity left to bill on this purchase order', 'error')
        return null
      }

      const sub = billableLines.reduce((a, l) => a + l.billQty * l.unitPrice, 0)
      const tax = billableLines.reduce((a, l) => a + Math.round(l.billQty * l.unitPrice * l.taxRate / 100), 0)
      const bill: Invoice = {
        id: uid(), ref: draftInvoiceRef('vendor_bill'), type: 'vendor_bill', status: 'draft',
        partnerId: po.vendorId, partnerName: po.vendorName,
        date: now(), dueDate: addDays(now(), 30),
        lines: billableLines.map(l => ({
          id: uid(), description: `${l.productName} ×${l.billQty}`, qty: l.billQty,
          unitPrice: l.unitPrice, taxRate: l.taxRate, subtotal: l.billQty * l.unitPrice,
          productId: l.productId,
        })),
        subtotal: sub, taxTotal: tax, total: sub + tax, amountPaid: 0,
        purchaseOrderId: po.id, notes: '',
      }
      setInvoices(p => [bill, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bill) })
      setPurchaseOrders(p => {
        const next = p.map(x => {
          if (x.id !== poId) return x
          const lines = x.lines.map(line => {
            const match = billableLines.find(b => b.id === line.id)
            if (!match) return line
            return { ...line, qtyBilled: (line.qtyBilled ?? 0) + match.billQty }
          })
          // Keep billId as latest bill for UI deep-link; further bills allowed via billable qty.
          return { ...x, billId: bill.id, lines }
        })
        const updated = next.find(x => x.id === poId)
        if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('create_bill', bill.ref, `Vendor bill created from PO ${po.ref} (3-way match)`)
      showToast(`Bill draft created · confirm to post liability`)
      return bill
    },

    // ── Purchase Returns ───────────────────────────────────────────────────────
    createPurchaseReturn: (receiptId, reason) => {
      const receipt = recRef.current.find(r => r.id === receiptId)!
      const po = poRef.current.find(p => p.id === receipt.poId)!
      const ret: PurchaseReturn = {
        id: uid(), ref: seq('RET', 'ret'), poId: po.id, poRef: po.ref,
        receiptId, receiptRef: receipt.ref, vendorId: po.vendorId, vendorName: po.vendorName,
        status: 'draft', date: now(), reason, lines: [],
      }
      purchaseReturnsRef.current = [ret, ...purchaseReturnsRef.current]
      setPurchaseReturns(p => [ret, ...p]); showToast(`Return ${ret.ref} created`); return ret
    },
    addReturnLine: (returnId, productId, productName, qty, serialIds, requiresSerial) => {
      const line = { productId, productName, qty, serialIds, requiresSerial }
      purchaseReturnsRef.current = purchaseReturnsRef.current.map(r => r.id !== returnId ? r : { ...r, lines: [...r.lines, line] })
      setPurchaseReturns(p => p.map(r => r.id !== returnId ? r : { ...r, lines: [...r.lines, line] }))
    },
    confirmPurchaseReturn: (returnId) => {
      const ret = purchaseReturnsRef.current.find(r => r.id === returnId)
      if (!ret) { showToast('Return not found', 'error'); return }
      if (ret.lines.length === 0) { showToast('Add at least one return line before confirming', 'error'); return }
      // Deduct stock, mark serials as returned
      ret.lines.forEach(l => {
        const prod = prodRef.current.find(x => x.id === l.productId)
        if (l.requiresSerial) {
          l.serialIds.forEach(sid => setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'returned', location: 'vendor' } : s)))
          setProducts(p => p.map(x => x.id === l.productId ? { ...x, stockQty: Math.max(0, x.stockQty - l.serialIds.length) } : x))
          addMove(l.productId, l.productName, l.serialIds.length, 'return', `Return ${ret.ref}`, ret.ref, 'warehouse', 'vendor', l.serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id))
        } else {
          setBulkStock(prev => upsertBulkStock(prev, l.productId, 'warehouse', -l.qty))
          setProducts(p => p.map(x => x.id === l.productId ? { ...x, stockQty: Math.max(0, x.stockQty - l.qty) } : x))
          addMove(l.productId, l.productName, l.qty, 'return', `Return ${ret.ref}`, ret.ref, 'warehouse', 'vendor', [])
        }
      })
      // Create credit note
      const creditTotal = ret.lines.reduce((a, l) => {
        const po = poRef.current.find(p => p.id === ret.poId)!
        return a + l.qty * (po.lines.find(x => x.productId === l.productId)?.unitPrice ?? 0)
      }, 0)
      const creditNote: Invoice = {
        id: uid(), ref: seq('BILL', 'inv'), type: 'vendor_bill', status: 'posted',
        partnerId: ret.vendorId, partnerName: ret.vendorName,
        date: now(), dueDate: now(),
        lines: ret.lines.map(l => {
          const po = poRef.current.find(p => p.id === ret.poId)!
          const up = po.lines.find(x => x.productId === l.productId)?.unitPrice ?? 0
          return { id: uid(), description: `RETURN: ${l.productName} ×${l.qty}`, qty: l.qty, unitPrice: -up, taxRate: companySettings.vatRate, subtotal: -(l.qty * up) }
        }),
        subtotal: -creditTotal, taxTotal: -Math.round(creditTotal * companySettings.vatRate / 100), total: -(creditTotal + Math.round(creditTotal * companySettings.vatRate / 100)), amountPaid: 0,
        purchaseOrderId: ret.poId, notes: `Purchase return ${ret.ref}`,
      }
      setInvoices(p => [creditNote, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creditNote) })
      purchaseReturnsRef.current = purchaseReturnsRef.current.map(r => r.id === returnId ? { ...r, status: 'confirmed', creditNoteId: creditNote.id } : r)
      setPurchaseReturns(p => p.map(r => r.id === returnId ? { ...r, status: 'confirmed', creditNoteId: creditNote.id } : r))
      showToast(`Return confirmed · credit note ${creditNote.ref} created`)
    },
    logReturnPickup: (returnId, collectedByUserId, collectedByName, collectedDate, pickupNotes) => {
      setPurchaseReturns(p => p.map(r => r.id !== returnId ? r : { ...r, collectedByUserId, collectedByName, collectedDate, pickupNotes }))
      showToast('Pickup details saved')
    },

    // ── Refurbishment ──────────────────────────────────────────────────────────
    createRefurbishmentJob: (serialId, issueDescription) => {
      const ser = serialRef.current.find(s => s.id === serialId)
      if (!ser) { showToast('Serial not found', 'error'); return }
      const prod = prodRef.current.find(p => p.id === ser.productId)
      const job: RefurbishmentJob = {
        id: uid(), ref: seq('REF', 'refurb'),
        status: 'queued',
        serialId, serialNumber: ser.serial,
        productId: ser.productId, productName: ser.productName,
        specs: prod?.description,
        intakeDate: new Date().toISOString(),
        intakeIssueDescription: issueDescription,
        partsNeeded: [],
      }
      // Move serial to repair_unit with refurbishment status
      setSerials(p => p.map(s => s.id === serialId ? { ...s, location: 'repair_unit', status: 'refurbishment' } : s))
      setRefurbishmentJobs(p => [...p, job])
      showToast(`Refurbishment job ${job.ref} created`)
    },
    assignRefurbishmentJob: (jobId, techId, techName) => {
      const job = refurbishmentJobs.find(j => j.id === jobId)
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, assignedTechnicianId: techId, assignedTechnicianName: techName, assignedDate: now(), status: 'assigned' }))
      if (job) {
        notifyUsers({
          recipients: [techId],
          type: 'assignment',
          title: 'Refurbishment job assigned',
          body: `${job.productName} (${job.serialNumber}) has been assigned to you for refurbishment.`,
          module: 'refurbishment',
          path: '?tab=refurb',
          icon: '🔧',
          entityKey: `refurb:${jobId}:assigned`,
          excludeUserId: currentUserId,
        })
      }
      showToast(`Job assigned to ${techName}`)
    },
    updateRefurbishmentJob: (jobId, patch) => {
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, ...patch, ...(patch.status === 'in_progress' && !j.assignedTechnicianId ? {} : {}) }))
    },
    addRefurbishmentPart: (jobId, part) => {
      const newPart: RefurbPart = { ...part, id: uid() }
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, partsNeeded: [...j.partsNeeded, newPart] }))
    },
    updateRefurbishmentPart: (jobId, partId, patch) => {
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : { ...pt, ...patch }) }))
    },
    removeRefurbishmentPart: (jobId, partId) => {
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, partsNeeded: j.partsNeeded.filter(pt => pt.id !== partId) }))
    },

    requestPartFromInventory: (jobId, partId) => {
      const job  = refurbishmentJobs.find(j => j.id === jobId)
      const part = job?.partsNeeded.find(p => p.id === partId)
      if (!job || !part || !part.productId) { showToast('Part must be linked to an inventory product first', 'error'); return }
      const prod = prodRef.current.find(p => p.id === part.productId)
      const inStock = prod ? prod.stockQty : 0
      if (inStock >= part.qty) {
        // Available — auto-allocate immediately
        setProducts(p => p.map(x => x.id === part.productId ? { ...x, stockQty: Math.max(0, x.stockQty - part.qty) } : x))
        setBulkStock(prev => {
          const locs = calcStockByLocation(prod, serialRef.current, prev, part.productId!)
          const src: LocationId = locs.shop >= part.qty ? 'shop' : 'warehouse'
          return upsertBulkStock(prev, part.productId!, src, -part.qty)
        })
        addMove(part.productId, part.partName, part.qty, 'out', `Refurb ${job.ref} — part allocated`, job.ref, 'warehouse', 'repair_unit', [])
        setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
            ...pt, status: 'allocated', allocatedDate: now(), allocatedByName: 'Auto (stock available)', requestedDate: now(),
          })
        }))
        showToast(`Part allocated from stock — ${prod?.name ?? part.partName} × ${part.qty}`)
      } else {
        // Not enough stock — flag to lead tech
        setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
            ...pt, status: 'requested', requestedDate: now(),
          })
        }))
        notifyUsers({
          recipients: userIdsWithRoles(users, ['technical_lead', 'inventory_officer'], currentUserId),
          type: 'repair',
          title: 'Part requested for refurb job',
          body: `${job.ref} — ${part.partName} × ${part.qty} (out of stock)`,
          module: 'refurbishment',
          path: '?tab=refurb',
          icon: '🔧',
          entityKey: `refurb:${jobId}:part:${partId}:oos`,
          excludeUserId: currentUserId,
        })
        showToast(`Part requested — lead tech alerted to avail or order: ${part.partName} × ${part.qty}`, 'info')
      }
    },

    allocateRefurbPart: (jobId, partId) => {
      const user = currentUser(); if (!user) return
      const job  = refurbishmentJobs.find(j => j.id === jobId)
      const part = job?.partsNeeded.find(p => p.id === partId)
      if (!job || !part || !part.productId) { showToast('No linked product — cannot allocate from inventory', 'error'); return }
      const prod = prodRef.current.find(p => p.id === part.productId)
      if (!prod || prod.stockQty < part.qty) { showToast(`Insufficient stock: ${prod?.stockQty ?? 0} available, ${part.qty} needed. Create a PO instead.`, 'error'); return }
      setProducts(p => p.map(x => x.id === part.productId ? { ...x, stockQty: Math.max(0, x.stockQty - part.qty) } : x))
      setBulkStock(prev => {
        const locs = calcStockByLocation(prod, serialRef.current, prev, part.productId!)
        const src: LocationId = locs.shop >= part.qty ? 'shop' : 'warehouse'
        return upsertBulkStock(prev, part.productId!, src, -part.qty)
      })
      addMove(part.productId, part.partName, part.qty, 'out', `Refurb ${job.ref} — part allocated by ${user.name}`, job.ref, 'warehouse', 'repair_unit', [])
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
        ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
          ...pt, status: 'allocated', allocatedDate: now(), allocatedByName: user.name,
        })
      }))
      showToast(`Part allocated from stock by ${user.name}`)
    },

    notifyTechPartAvailable: (jobId, partId) => {
      const user = currentUser(); if (!user) return
      const job = refurbishmentJobs.find(j => j.id === jobId)
      const part = job?.partsNeeded.find(pt => pt.id === partId)
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
        ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
          ...pt, status: 'received', notifiedTechDate: now(), allocatedByName: user.name,
        })
      }))
      if (job?.assignedTechnicianId) {
        notifyUsers({
          recipients: [job.assignedTechnicianId],
          type: 'assignment',
          title: 'Part ready for your refurb job',
          body: `${job.ref} — ${part?.partName ?? 'Part'} is available and ready to use.`,
          module: 'refurbishment',
          path: '?tab=refurb',
          icon: '📦',
          entityKey: `refurb:${jobId}:part:${partId}:ready`,
          excludeUserId: user.id,
        })
      }
      showToast('Technician notified — part is ready for use')
    },

    markRefurbishmentReady: (jobId) => {
      const job = refurbishmentJobs.find(j => j.id === jobId)
      if (!job) return
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, status: 'ready', completedDate: now() }))
      showToast(`${job.serialNumber} marked as ready — transfer to sales when needed`)
    },
    transferToSell: (jobId) => {
      const job = refurbishmentJobs.find(j => j.id === jobId)
      if (!job) return
      // Move serial to warehouse, mark available
      setSerials(p => p.map(s => s.id !== job.serialId ? s : { ...s, status: 'available', location: 'warehouse' }))
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, status: 'transferred', transferDate: now() }))
      showToast(`${job.serialNumber} transferred to ready-to-sell inventory`)
    },
    writeOffRefurbishmentJob: (jobId, reason) => {
      const job = refurbishmentJobs.find(j => j.id === jobId)
      if (!job) return
      setSerials(p => p.map(s => s.id !== job.serialId ? s : { ...s, status: 'written_off' }))
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, status: 'written_off', techNotes: (j.techNotes ? j.techNotes + '\n' : '') + `Written off: ${reason}`, completedDate: now() }))
      showToast(`${job.serialNumber} written off`)
    },

    // ── Stock Transfers ────────────────────────────────────────────────────────
    createTransfer: (from, to, notes = '') => {
      if (!canManageInventoryControl(currentUser())) { showToast('Only inventory-controlled roles can create transfers', 'error'); throw new Error('Unauthorized transfer creation') }
      const tr: StockTransfer = { id: uid(), ref: seq('TR', 'tr'), fromLocation: from, toLocation: to, status: 'draft', date: now(), lines: [], notes }
      setStockTransfers(p => [tr, ...p]); showToast(`Transfer ${tr.ref} created`); return tr
    },
    addTransferLine: (transferId, productId, productName, qty, serialIds) => {
      setStockTransfers(p => p.map(t => t.id !== transferId ? t : { ...t, lines: [...t.lines, { productId, productName, qty, serialIds }] }))
    },
    validateTransfer: async (transferId) => {
      if (!canManageInventoryControl(currentUser())) { showToast('Only inventory-controlled roles can validate transfers', 'error'); return }
      const tr = stockTransfers.find(t => t.id === transferId)!
      try {
        const res = await fetch('/api/inventory/apply-transfer-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transferRef: tr.ref,
            fromLocation: tr.fromLocation,
            toLocation: tr.toLocation,
            lines: tr.lines.map(l => ({
              productId: l.productId,
              productName: l.productName,
              qty: l.qty,
              serialIds: l.serialIds,
            })),
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null
          showToast(payload?.error || 'Transfer validation failed', 'error')
          return
        }
      } catch {
        showToast('Could not apply transfer on server', 'error')
        return
      }
      // Mirror server stock into local UI (moves already persisted server-side).
      tr.lines.forEach(l => {
        if (l.serialIds.length > 0) {
          l.serialIds.forEach(sid => setSerials(p => p.map(s => s.id === sid ? { ...s, location: tr.toLocation } : s)))
        } else {
          setBulkStock(prev => upsertBulkStock(upsertBulkStock(prev, l.productId, tr.fromLocation, -l.qty), l.productId, tr.toLocation, l.qty))
        }
      })
      setStockTransfers(p => p.map(t => t.id === transferId ? { ...t, status: 'done' } : t))
      showToast(`Transfer ${tr.ref} validated — stock moved to ${LOCATIONS[tr.toLocation].name}`)
    },

    // ── Combined create+validate in one atomic step (avoids React batching race) ──
    submitTransfer: async (from, to, productId, productName, qty, serialIds, notes = '') => {
      if (!canManageInventoryControl(currentUser())) {
        showToast('Only inventory-controlled roles can create transfers', 'error')
        return false
      }
      if (from === to) {
        showToast('Source and destination must be different', 'error')
        return false
      }
      if (qty <= 0) {
        showToast('Transfer quantity must be greater than zero', 'error')
        return false
      }
      // Validate source has enough stock before moving
      const product = products.find(p => p.id === productId)
      if (product && !product.requiresSerial) {
        const srcQty = calcStockByLocation(product, serialRef.current, bulkStock, productId)[from] ?? 0
        if (srcQty < qty) {
          showToast(`Insufficient stock at ${LOCATIONS[from].name}: ${srcQty} available, ${qty} requested`, 'error')
          return false
        }
      }
      const ref = seq('TR', 'tr')
      const id = uid()
      const line = { productId, productName, qty, serialIds }
      try {
        const res = await fetch('/api/inventory/apply-transfer-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transferRef: ref,
            fromLocation: from,
            toLocation: to,
            lines: [{ productId, productName, qty, serialIds }],
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null
          showToast(payload?.error || 'Transfer failed', 'error')
          return false
        }
      } catch {
        showToast('Could not apply transfer on server', 'error')
        return false
      }
      // Mirror server stock into local UI (moves already persisted server-side).
      if (serialIds.length > 0) {
        serialIds.forEach(sid => setSerials(p => p.map(s => s.id === sid ? { ...s, location: to } : s)))
      } else {
        setBulkStock(prev => upsertBulkStock(upsertBulkStock(prev, productId, from, -qty), productId, to, qty))
      }
      const tr: StockTransfer = { id, ref, fromLocation: from, toLocation: to, status: 'done', date: now(), lines: [line], notes }
      setStockTransfers(p => [tr, ...p])
      showToast(`Transfer ${ref} validated — stock moved to ${LOCATIONS[to].name}`)
      return true
    },

    // ── Repairs ───────────────────────────────────────────────────────────────
    createRepair: (customerId, customerName, productName, serial, desc) => {
      const customer = contacts.find(c => c.id === customerId)
      const user = currentUser()
      // Note: ref is now fetched from server on demand via updateRepair
      // For now, use a temporary placeholder that will be replaced
      const rep: RepairOrder = {
        id: uid(),
        ref: `REP-${Date.now().toString().slice(-6)}`,
        status: 'received',
        
        // Customer & Device
        customerId,
        customerName,
        customerPhone: customer?.phone ?? '',
        customerEmail: customer?.email,
        productId: '',
        productName,
        serialNumber: serial,
        deviceCondition: 'good',
        
        // Intake
        intakeChannel: 'walk_in',
        intakeDate: new Date().toISOString(),
        intakeNotes: desc,
        issueDescription: desc,
        accessories: [],
        
        // Warranty
        underWarranty: false,
        warrantyVerificationStatus: serial.trim() ? 'not_checked' : 'pending_manual_review',
        serialWarrantyException: !serial.trim(),
        serialWarrantyExceptionReason: !serial.trim() ? 'other' : undefined,
        serialWarrantyExceptionNotes: !serial.trim() ? 'Serial number was not captured during intake.' : undefined,
        
        // Repair
        partsUsed: [],
        laborCost: 0,
        logisticsCost: 0,
        total: 0,
        
        // QA
        qcItems: [],
        
        // Metadata
        createdBy: user?.username ?? 'system',
        bookedByName: user?.name ?? 'System',
        createdDate: now(),
        notes: '',
        slaMissed: false,
        
        // Legacy fields
        date: now(),
        description: desc,
        technicianName: '',
      }
      setRepairs(p => [rep, ...p])
      syncRepairToPortal(rep, 'Repair booked in')
      fetch('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rep),
      })
        .then(async res => {
          if (!res.ok) return null
          return res.json() as Promise<RepairOrder>
        })
        .then(serverRepair => {
          if (!serverRepair) return
          setRepairs(prev => prev.map(item => {
            if (item.id !== rep.id) return item
            // Preserve any local intake details applied immediately after createRepair
            // (company contact person, warranty, accessories, etc.) while adopting the
            // server-generated reference.
            const merged = { ...serverRepair, ...item, id: serverRepair.id, ref: serverRepair.ref }
            syncRepairToPortal(merged, 'Repair booked in')
            return merged
          }))
        })
        .catch(() => { /* local/app_state sync remains available offline */ })
      addAuditLog('create_repair', rep.ref, `Repair job created for ${customerName} - ${productName}`)
      // Notify all lead techs of the new job
      notifyUsers({
        recipients: userIdsWithRoles(users, ['technical_lead'], currentUserId),
        type: 'repair',
        title: 'New repair job booked',
        body: `${customerName} — ${productName}`,
        module: 'repair',
        path: `?id=${rep.id}`,
        icon: '🛠️',
        entityKey: `repair:${rep.id}:booked`,
        excludeUserId: currentUserId,
      })
      showToast(`${rep.ref} created`)
      return rep
    },
    updateRepair: (id, p) => {
      const existing = repairsRef.current.find(r => r.id === id)
      if (!existing) return
      if ('intakeDate' in p || 'date' in p) {
        const dateErr = repairDatesWriteError({
          intakeDate: 'intakeDate' in p ? p.intakeDate : existing.intakeDate,
          date: 'date' in p ? p.date : existing.date,
        })
        if (dateErr) { showToast(dateErr, 'error'); return }
      }
      const partsTotal = (p.partsUsed ?? existing.partsUsed).reduce((a, x) => a + x.qty * x.price, 0)
      const updatedBase = { ...existing, ...p }
      const feeDue = shouldChargeDiagnosisFee(updatedBase) && (updatedBase.diagnosisStopped || updatedBase.diagnosisFeeStatus === 'applicable')
        ? (updatedBase.diagnosisFee ?? 0)
        : 0
      const updated: RepairOrder = {
        ...updatedBase,
        total: updatedBase.underWarranty && updatedBase.warrantyCoverage === 'full'
          ? 0
          : partsTotal + updatedBase.laborCost + feeDue,
      }
      setRepairs(prev => prev.map(r => r.id === id ? updated : r))
      repairsRef.current = repairsRef.current.map(r => r.id === id ? updated : r)
      // Sync portal when customer-visible intake / report fields change
      if (
        'qcReportData' in p || 'diagnosisReportData' in p || 'preRepairPhotos' in p || 'issuePhotos' in p
        || 'repairPath' in p || 'liabilityWaiverAccepted' in p || 'notes' in p
        || 'issueDescription' in p || 'customerName' in p || 'customerPhone' in p || 'customerEmail' in p
      ) {
        setTimeout(() => syncRepairToPortal(updated), 0)
      }
      if ('customerName' in p || 'customerPhone' in p || 'customerEmail' in p || 'customerId' in p) {
        const contact = contacts.find(c => c.id === updated.customerId)
        syncCustomerIdentityToDocuments({
          contactId: updated.customerId,
          saleOrderId: updated.saleOrderId,
          repairId: updated.id,
          invoiceId: updated.invoiceId,
          identity: {
            name: String(updated.customerName || '').trim(),
            email: updated.customerEmail || contact?.email || undefined,
            phone: updated.customerPhone || contact?.phone || contact?.mobile || undefined,
            address: contact ? formatCustomerAddress(contact) : undefined,
            customerId: updated.customerId,
          },
        })
      }
    },
    deleteRepair: (id) => {
      const user = currentUser()
      if (!user || user.role !== 'director') {
        showToast('Only a director can delete a repair', 'error'); return
      }
      const repair = repairs.find(r => r.id === id)
      if (!repair) return
      setRepairs(p => p.filter(r => r.id !== id))
      setOutsourceJobs(p => p.map(j => j.repairOrderId === id ? { ...j, repairOrderId: undefined } : j))
      addAuditLog('delete_repair', repair.ref, `Repair ${repair.ref} deleted by ${user.name}`)
      showToast(`Repair ${repair.ref} deleted`)
    },
    checkWarrantyForRepair: (repairId, serial) => {
      const war = warRef.current.find(w => w.serialNumber === serial && w.status === 'active')
      if (war) {
        setRepairs(p => p.map(r => r.id === repairId ? { ...r, warrantyId: war.id, underWarranty: true, laborCost: 0, total: 0 } : r))
        addAuditLog('warranty_check', repairId, `Active warranty ${war.ref} applied`)
        showToast(`✓ Active warranty ${war.ref} — repair is FREE`, 'info')
        return true
      }
      showToast('No active warranty for this serial number', 'error')
      return false
    },
    fileWarrantyClaim: (repairId, notes) => {
      const repair = repairsRef.current.find(r => r.id === repairId)
      if (!repair) return
      if (!repair.underWarranty) { showToast('Repair is not under warranty', 'error'); return }
      if (repair.warrantyClaimId) { showToast('Warranty claim already filed', 'error'); return }
      const claimId = `WC-${Date.now()}`
      setRepairs(p => p.map(r => r.id === repairId ? { ...r, warrantyClaimId: claimId } : r))
      addAuditLog('warranty_claim', repairId, `Warranty claim filed: ${claimId}${notes ? ` — ${notes}` : ''}`)
      showToast(`Warranty claim ${claimId} filed`, 'success')
    },
    
    // ── Repair Workflow Actions ──────────────────────────────────────────────
    verifyRepairIntake: (repairId, notes = '') => {
      const actor = currentUser()
      if (!actor || !['technical_lead', 'director', 'admin_officer'].includes(actor.role)) {
        showToast('Only authorised staff can verify repair intake', 'error'); return
      }
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) { showToast('Repair not found', 'error'); return }
      if (repair.status !== 'pending_verification') {
        showToast('Only pending verification repairs can be verified', 'error'); return
      }
      const verified: RepairOrder = {
        ...repair,
        status: 'received',
        verificationDate: now(),
        verifiedBy: actor.name,
        verificationNotes: notes.trim() || undefined,
      }
      setRepairs(p => p.map(r => r.id === repairId ? verified : r))
      syncRepairToPortal(verified, 'Device verified by staff — repair received')
      notifyUsers({
        recipients: userIdsWithRoles(users, ['technical_lead'], actor.id),
        type: 'repair',
        title: `Repair intake verified: ${repair.ref}`,
        body: `${repair.productName} for ${repair.customerName} is ready for assignment.`,
        module: 'repair',
        path: `?id=${repair.id}`,
        icon: '✅',
        entityKey: `repair:${repair.id}:verified`,
        excludeUserId: actor.id,
      })
      addAuditLog('verify_repair_intake', repairId, `${actor.name} verified intake${notes ? `: ${notes}` : ''}`)
      showToast(`${repair.ref} verified and moved to received`)
    },

    assignTechnicianToRepair: (repairId, technicianId) => {
      const actor = currentUser()
      if (!actor || !['technical_lead', 'director'].includes(actor.role)) {
        showToast('Only the Technical Lead can assign repairs', 'error'); return
      }
      const tech = users.find(u => u.id === technicianId)
      if (!tech) { showToast('Technician not found', 'error'); return }
      const repair = repairs.find(r => r.id === repairId)

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        assignedTechnicianId: technicianId,
        assignedTechnicianName: tech.name,
        assignedDate: now(),
        status: r.status === 'received' ? 'assigned' : r.status,
        technicianName: tech.name,
      } : r))

      if (repair) {
        notifyUsers({
          recipients: [technicianId],
          type: 'assignment',
          title: 'Repair job assigned to you',
          body: `${repair.productName} — ${repair.issueDescription?.slice(0, 80) ?? 'See repair details'}.`,
          module: 'repair',
          path: `?id=${repair.id}`,
          icon: '🛠️',
          entityKey: `repair:${repair.id}:assigned`,
          excludeUserId: actor.id,
        })
        syncRepairToPortal({ ...repair, assignedTechnicianId: technicianId, assignedTechnicianName: tech.name, assignedDate: now(), status: repair.status === 'received' ? 'assigned' : repair.status, technicianName: tech.name }, `Assigned to ${tech.name}`)
      }
      addAuditLog('assign_technician', repairId, `${actor.name} assigned to ${tech.name}`)
      showToast(`Assigned to ${tech.name}`)
    },
    
    logDiagnosis: (repairId, diagnosisInput) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      if (isDirectRepairPath(repair.repairPath)) {
        showToast('Direct Repair jobs skip diagnosis — change the workflow path first if diagnosis is required', 'error')
        return
      }
      const isAssignedTech = repair.assignedTechnicianId === user.id
      const isLeadOrDirector = ['technical_lead', 'director'].includes(normalizeClientRole(user.role))
      if (!isAssignedTech && !isLeadOrDirector) {
        showToast('Only the assigned technician or lead technician can log or update a diagnosis', 'error'); return
      }

      const previousHistory = repair.diagnosisHistory?.length ? repair.diagnosisHistory : repair.diagnosis ? [repair.diagnosis] : []
      const nextRevision = previousHistory.length + 1
      const isRevision = previousHistory.length > 0
      const diagnosis: RepairDiagnosis = {
        ...diagnosisInput,
        id: uid(),
        revision: nextRevision,
        revisionType: (diagnosisInput as any).revisionType ?? (isRevision ? 'update' : 'initial'),
        revisionReason: (diagnosisInput as any).revisionReason,
        diagnosedBy: user.name,
        diagnosedDate: now(),
      }
      const diagnosisHistory = [...previousHistory, diagnosis]
      // After a Back step to assigned, revising an existing diagnosis must still
      // advance to diagnosed — otherwise quote/start stay locked forever.
      const nextStatus = (repair.status === 'assigned' || repair.status === 'received' || !isRevision)
        ? 'diagnosed'
        : repair.status

      const diagHistEntry = {
        status: 'diagnosed' as const,
        date: diagnosis.diagnosedDate,
        note: isRevision ? `Diagnosis ${diagnosis.revisionType === 'correction' ? 'correction' : 'update'} #${nextRevision}: ${diagnosis.faultDescription}` : diagnosis.faultDescription ?? 'Diagnosis completed',
        by: user.name,
      }
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        diagnosis,
        diagnosisHistory,
        status: nextStatus,
        statusHistory: [
          ...(r.statusHistory || []).filter(h => !(h.status === 'diagnosed' && !isRevision)),
          diagHistEntry,
        ],
      } : r))

      if (repair) syncRepairToPortal({ ...repair, diagnosis, diagnosisHistory, status: nextStatus }, isRevision ? 'Diagnosis updated — latest findings are available' : 'Diagnosis completed')
      addAuditLog(isRevision ? 'update_diagnosis' : 'diagnose_repair', repairId, `${isRevision ? 'Diagnosis updated' : 'Diagnosis logged'}: ${diagnosis.findings}`)
      showToast(isRevision ? 'Diagnosis update saved — revise the quote if pricing changed' : 'Diagnosis logged — choose to proceed to repair or stop here')
    },

    stopAtDiagnosis: (repairId) => {
      const user = currentUser()
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      if (isDirectRepairPath(repair.repairPath)) {
        showToast('Stop at diagnosis only applies to Diagnosis First repairs', 'error'); return
      }
      const isManager = !!user && ['director', 'admin_officer', 'technical_lead'].includes(normalizeClientRole(user.role))
      if (!user || (!isManager && repair.assignedTechnicianId !== user.id)) {
        showToast('Only the assigned technician or a manager can stop at diagnosis', 'error'); return
      }
      const resolved = resolveDiagnosisFee(repair, systemSettings)
      const DIAGNOSIS_FEE = resolved.amount
      const alreadyPaid = isDiagnosisFeeSettled(repair) || resolved.status === 'paid'
      const nextFeeStatus = DIAGNOSIS_FEE <= 0
        ? (resolved.status as RepairOrder['diagnosisFeeStatus'])
        : alreadyPaid
          ? 'paid'
          : 'applicable'
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        diagnosisStopped: true,
        diagnosisFee: DIAGNOSIS_FEE,
        diagnosisFeeStatus: nextFeeStatus,
        diagnosisFeeBilling: r.diagnosisFeeBilling ?? resolved.billing,
        customerBillingType: r.customerBillingType ?? resolved.customerType,
        laborCost: 0,
        logisticsCost: 0,
        total: DIAGNOSIS_FEE,
        status: 'ready',
      } : r))
      addAuditLog('stop_at_diagnosis', repairId, `Repair stopped at diagnosis — KES ${DIAGNOSIS_FEE} diagnosis fee ${alreadyPaid ? '(already paid)' : 'due (not credited against repairs)'}`)
      showToast(
        DIAGNOSIS_FEE <= 0
          ? 'Repair closed at diagnosis — no diagnosis fee'
          : alreadyPaid
            ? `Repair closed at diagnosis — diagnosis fee KES ${DIAGNOSIS_FEE.toLocaleString('en-KE')} already paid`
            : `Repair closed at diagnosis — KES ${DIAGNOSIS_FEE.toLocaleString('en-KE')} diagnosis fee due (not credited against repair)`,
      )
    },

    markDiagnosisFeePaid: (repairId, method) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      const resolved = resolveDiagnosisFee(repair, systemSettings)
      if (resolved.amount <= 0) {
        showToast('No diagnosis fee on this job', 'error')
        return
      }
      if (isDiagnosisFeeSettled(repair)) {
        showToast('Diagnosis fee already marked paid')
        return
      }
      const canMark = ['director', 'admin_officer', 'finance_officer', 'sales_rep'].includes(
        normalizeClientRole(user.role),
      )
      if (!canMark) {
        showToast('Only sales, finance, admin officer, or a director can mark the diagnosis fee paid', 'error')
        return
      }
      const at = now()
      const payMethod = method?.trim() || 'cash'
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        diagnosisFee: resolved.amount,
        diagnosisFeeStatus: 'paid',
        diagnosisFeeBilling: r.diagnosisFeeBilling ?? resolved.billing,
        customerBillingType: r.customerBillingType ?? resolved.customerType,
        diagnosisFeePaidAt: at,
        diagnosisFeePaidBy: user.id,
        diagnosisFeePaidMethod: payMethod,
      } : r))
      addAuditLog(
        'diagnosis_fee_paid',
        repairId,
        `Diagnosis fee KES ${resolved.amount.toLocaleString('en-KE')} marked paid (${payMethod}) — not credited against repair bill`,
      )
      showToast(`Diagnosis fee KES ${resolved.amount.toLocaleString('en-KE')} recorded as paid`)
    },

    generateRepairQuote: async (repairId, incomingLines, applyVat = true) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      if (blockIfOutsourced(repairId, 'update the repair quote')) return
      const canGenerate = ['director', 'technical_lead', 'admin_officer', 'sales_rep', 'finance_officer'].includes(user.role) || repair.assignedTechnicianId === user.id
      if (!canGenerate) {
        showToast('Only the assigned technician or authorised staff can generate a quote', 'error'); return
      }
      const QUOTABLE_STATUSES = quotableStatusesForPath(repair.repairPath)
      if (!QUOTABLE_STATUSES.includes(repair.status)) {
        showToast('Cannot generate a new quote at this stage', 'error'); return
      }
      if (!incomingLines.length) {
        showToast('Add at least one quote line before generating a quote', 'error'); return
      }
      const invalidLine = incomingLines.find(line => !line.description?.trim?.() || Number(line.qty) <= 0 || Number(line.unitPrice) < 0)
      if (invalidLine) {
        showToast('Every quote line needs a description, quantity greater than zero, and a non-negative price', 'error'); return
      }
      const isUpdate = !!repair.quote
      const prevQuote = repair.quote
      const reopeningAfterDecline = isQuoteDeclinedReopenable(repair.status)

      // ── Gap 3: Reverse reserved stock on quote revision ───────────────────
      // If parts were already reserved (markPartsArrived ran), unreserve them
      // so stock is accurate before new parts are evaluated.
      if (isUpdate && prevQuote) {
        const reservedParts = repair.partsUsed?.filter(p => p.reservedDate && !p.usedDate) ?? []
        reservedParts.forEach(part => {
          const prod = prodRef.current.find(x => x.id === part.productId)
          if (!prod) return
          if (prod.requiresSerial) {
            // Return assigned serials back to available
            setSerials(prev => prev.map(s =>
              s.productId === part.productId && s.status === 'assigned' && s.repairId === repairId
                ? { ...s, status: 'available' as const, repairId: undefined }
                : s
            ))
          } else {
            // Restore bulk stock
            setBulkStock(prev => upsertBulkStock(prev, part.productId, 'repair_unit', part.qty))
            addMove(part.productId, part.productName, part.qty, 'in',
              `Stock unreserved — quote revision ${repair.ref}`, repair.ref, 'repair_unit', 'warehouse')
          }
        })
      }

      const resolvedFee = resolveDiagnosisFee(repair, systemSettings)
      // Fee stays on the quote for visibility but is never credited against labour/parts.
      // Fees already paid early still appear as a locked quote line (settled separately).
      const chargeFee = shouldChargeDiagnosisFee(repair) && resolvedFee.amount > 0
      const incomingWithFee = ensureDiagnosisFeeInQuoteLines(
        incomingLines.map(line => ({
          ...line,
          subtotal: Number(line.qty) * Number(line.unitPrice),
          isDiagnosisFee: isDiagnosisFeeLine(line as any) || undefined,
        })),
        resolvedFee.amount,
        chargeFee,
      )

      const lines: RepairQuoteLine[] = incomingWithFee.map(line => ({
        ...line,
        type: line.type as RepairQuoteLine['type'],
        id: uid(),
        reserved: false,
        isDiagnosisFee: isDiagnosisFeeLine(line) || undefined,
      }))

      const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
      // Diagnosis fee is always 0% VAT — tax only non-fee lines
      const tax = applyVat ? Math.round(taxableQuoteSubtotal(lines) * (companySettings.vatRate / 100)) : 0

      // ── Gap 1: Build change diff summary ─────────────────────────────────
      let changeSummary: string | undefined
      let prevTotal: number | undefined
      if (isUpdate && prevQuote) {
        prevTotal = prevQuote.total
        const fmtKesLocal = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0 })}`
        const diffLines: string[] = []
        const prevByDesc = new Map(prevQuote.lines.map(l => [l.description.toLowerCase(), l]))
        const newByDesc = new Map(incomingLines.map(l => [l.description.toLowerCase(), l]))
        // Removed lines
        prevQuote.lines.forEach(l => {
          if (!newByDesc.has(l.description.toLowerCase())) {
            diffLines.push(`Removed: ${l.description} (was ${fmtKesLocal(l.subtotal)})`)
          }
        })
        // Added lines
        incomingLines.forEach(l => {
          if (!prevByDesc.has(l.description.toLowerCase())) {
            diffLines.push(`Added: ${l.description} — ${l.qty} × ${fmtKesLocal(l.unitPrice)} = ${fmtKesLocal(l.subtotal)}`)
          }
        })
        // Modified lines
        incomingLines.forEach(l => {
          const prev = prevByDesc.get(l.description.toLowerCase())
          if (!prev) return
          if (prev.qty !== l.qty || prev.unitPrice !== l.unitPrice) {
            diffLines.push(`Changed: ${l.description} — ${fmtKesLocal(prev.subtotal)} → ${fmtKesLocal(l.subtotal)}${prev.qty !== l.qty ? ` (qty ${prev.qty}→${l.qty})` : ''}${prev.unitPrice !== l.unitPrice ? ` (price ${fmtKesLocal(prev.unitPrice)}→${fmtKesLocal(l.unitPrice)})` : ''}`)
          }
        })
        if (diffLines.length === 0) diffLines.push('No line-item changes — total updated')
        diffLines.push(`Total: ${fmtKesLocal(prevQuote.total)} → ${fmtKesLocal(subtotal + (applyVat ? Math.round(subtotal * (companySettings.vatRate / 100)) : 0))}`)
        if (reopeningAfterDecline) {
          diffLines.unshift(
            `Re-quote after customer decline${prevQuote.rejectionReason ? ` (“${prevQuote.rejectionReason}”)` : ''}`,
          )
        }
        changeSummary = diffLines.join('\n')
      } else if (reopeningAfterDecline && prevQuote) {
        prevTotal = prevQuote.total
        changeSummary = `Re-quote after customer decline${prevQuote.rejectionReason ? ` (“${prevQuote.rejectionReason}”)` : ''}`
      }

      const quote: RepairQuote = {
        id: uid(),
        lines,
        subtotal,
        tax,
        total: subtotal + tax,
        validUntil: addDays(now(), 7),
        sentDate: now(),
        diagnosisRevision: repair.diagnosis?.revision,
        diagnosisFaultSummary: repair.diagnosis?.faultDescription,
        ...(changeSummary ? { changeSummary, prevTotal } : {}),
      }

      const derivedLaborCost = lines.filter(l => l.type === 'labor').reduce((s, l) => s + l.subtotal, 0)
      const derivedLogisticsCost = lines.filter(l => l.type === 'logistics').reduce((s, l) => s + l.subtotal, 0)

      // Chained lookup: a dangling salesQuoteId (e.g. the local quote list was
      // rebuilt from the server) must fall through to the repair-link search,
      // otherwise a revision creates a brand-new quote → duplicate quotes.
      const existingSalesQuote = (repair.salesQuoteId ? quotes.find(q => q.id === repair.salesQuoteId) : undefined)
        ?? quotes.find(q => q.source === 'repair' && (q.repairId === repair.id || q.repairRef === repair.ref))
        ?? (repair.salesQuoteRef ? quotes.find(q => q.ref === repair.salesQuoteRef || q.quoteNumber === repair.salesQuoteRef) : undefined)
      // Even if the quote is missing from local state, an id recorded on the
      // repair means it exists server-side — update it instead of duplicating.
      const existingSalesQuoteId = existingSalesQuote?.id ?? repair.salesQuoteId

      // Also honour the sale order the customer-portal approval flow may have
      // created (it records linkedSaleOrderId, not saleOrderId).
      let linkedSaleOrderId = repair.saleOrderId ?? (repair as any).linkedSaleOrderId ?? existingSalesQuote?.saleOrderId
      const linkedSaleOrder = linkedSaleOrderId ? saleOrders.find(s => s.id === linkedSaleOrderId) : undefined
      let linkedSaleOrderRef = repair.saleOrderRef ?? (repair as any).linkedSaleOrderRef ?? linkedSaleOrder?.ref ?? linkedSaleOrder?.orderNumber

      const soLines = quote.lines.map(l => ({
        id: uid(), productId: l.productId ?? '', productName: l.productName ?? l.description,
        qty: l.qty, unitPrice: l.unitPrice, discount: 0, taxRate: 0,
        subtotal: l.subtotal, serialIds: [] as string[],
      }))

      // Full warranty / billing-exempt = company pays; Direct Repair auto-approves
      const isFullWarranty = repair.underWarranty && repair.warrantyCoverage === 'full'
      const isBillingExempt = isRepairBillingExempt(repair)
      const isNoCharge = isFullWarranty || isBillingExempt
      const isDirectRepair = isDirectRepairPath(repair.repairPath)
      const chargeTotal = isNoCharge ? 0 : quote.total
      // Full warranty + billing-exempt + Direct Repair quotes are auto-approved — no client approval gate
      const quoteStatus: RepairStatus = (isNoCharge || isDirectRepair) ? 'approved' : 'awaiting_approval'
      if (isNoCharge || isDirectRepair) {
        quote.approvedDate = now()
        quote.approvedBy = isBillingExempt
          ? `No-charge (${normalizeBillingExemptReason(repair.billingExemptReason)}) — auto-approved`
          : isFullWarranty
            ? 'Warranty (auto-approved)'
            : `Direct Repair path (auto-approved by ${user.name})`
      }

      if (isUpdate && linkedSaleOrderId) {
        const soPatch = {
          lines: soLines,
          subtotal: quote.subtotal,
          taxAmount: quote.tax,
          taxTotal: quote.tax,
          totalAmount: chargeTotal,
          total: chargeTotal,
          notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
          repairRef: repair.ref,
        }
        setSaleOrders(p => p.map(s => s.id === linkedSaleOrderId ? { ...s, ...soPatch } : s))
        // Always push the revision to the server — even when the SO isn't in
        // local state (e.g. it was created by the customer-portal approval).
        sync(`/api/sale-orders/${linkedSaleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(soPatch) })
      } else if (chargeTotal >= 1) {
        const soId = uid()
        const soRef = await storeCtxRef.current!.allocateDocRef('QUO')
        const saleOrderRecord = {
          id: soId, ref: soRef, status: 'quotation' as const,
          customerId: repair.customerId, customerName: repair.customerName,
          date: now(), validUntil: addDays(now(), 7),
          lines: soLines, subtotal: quote.subtotal, taxTotal: quote.tax, total: chargeTotal,
          notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
          createdByUserId: user.id,
        }
        setSaleOrders(p => [saleOrderRecord, ...p])
        sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleOrderRecord) })
        linkedSaleOrderId = soId
        linkedSaleOrderRef = soRef
      }

      // Push a Sales Quote so the repair quote appears in the Sales module
      const salesQuoteLines = quote.lines.map(l => ({
        id: uid(),
        productId: l.productId ?? '',
        productName: l.productName ?? l.description,
        sku: '',
        description: l.description,
        qty: l.qty,
        unit: 'pcs',
        listPrice: l.unitPrice,
        unitPrice: l.unitPrice,
        discount: 0,
        discountAmount: 0,
        taxRate: applyVat ? companySettings.vatRate : 0,
        taxAmount: applyVat ? Math.round(l.subtotal * (companySettings.vatRate / 100)) : 0,
        subtotal: l.subtotal,
        lineTotal: applyVat ? l.subtotal + Math.round(l.subtotal * (companySettings.vatRate / 100)) : l.subtotal,
      }))
      const isQuoteUpdate = isUpdate && !!existingSalesQuoteId
      // Never CREATE a sales quote below KES 1 (e.g. full-warranty repairs) —
      // updating an existing quote to a lower total is still allowed.
      const shouldPushSalesQuote = isQuoteUpdate || chargeTotal >= 1
      const salesQuoteId = shouldPushSalesQuote ? (existingSalesQuoteId ?? uid()) : undefined
      const salesQuoteRef = shouldPushSalesQuote
        ? (repair.salesQuoteRef ?? existingSalesQuote?.ref ?? existingSalesQuote?.quoteNumber ?? await storeCtxRef.current!.allocateDocRef('QUO'))
        : undefined
      const salesQuoteRecord = {
        ...existingSalesQuote,
        id: salesQuoteId,
        quoteNumber: existingSalesQuote?.quoteNumber ?? salesQuoteRef,
        ref: salesQuoteRef,
        clientId: repair.customerId,
        companyId: repair.customerId,
        companyName: repair.customerName,
        contactPersonId: repair.contactPersonId ?? repair.customerId,
        contactPersonName: repair.contactPersonName ?? repair.customerName,
        opportunityName: `Repair — ${repair.ref}`,
        ownerId: user.id,
        ownerName: user.name,
        status: isFullWarranty || isBillingExempt ? 'accepted' : 'sent',
        source: 'repair',
        repairId: repair.id,
        repairRef: repair.ref,
        lines: salesQuoteLines,
        subtotal: quote.subtotal,
        discountAmount: 0,
        discountPercent: 0,
        taxAmount: quote.tax,
        taxTotal: quote.tax,
        totalAmount: chargeTotal,
        total: chargeTotal,
        saleOrderId: linkedSaleOrderId,
        version: isUpdate && existingSalesQuoteId ? ((quotes.find(q => q.id === existingSalesQuoteId)?.version ?? 1) + 1) : 1,
        quoteDate: existingSalesQuote?.quoteDate ?? now(),
        issueDate: now(),
        validUntil: quote.validUntil,
        sentDate: now(),
        viewCount: existingSalesQuote?.viewCount ?? 0,
        createdBy: user.id,
        createdByName: user.name,
        createdAt: existingSalesQuote?.createdAt ?? now(),
        updatedAt: now(),
      }
      if (isQuoteUpdate) {
        // Upsert locally — the quote may be absent from local state if the
        // list was rebuilt from the server after the original POST failed.
        setQuotes(p => p.some(q => q.id === existingSalesQuoteId)
          ? p.map(q => q.id === existingSalesQuoteId ? { ...q, ...salesQuoteRecord } : q)
          : [salesQuoteRecord as unknown as Quote, ...p])
        // PUT the revision; if the quote never reached the server, create it.
        fetch(`/api/quotes/${existingSalesQuoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(salesQuoteRecord) })
          .then(res => {
            if (res.status === 404) {
              return fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(salesQuoteRecord) })
            }
            return res
          })
          .catch(() => {})
      } else if (shouldPushSalesQuote) {
        setQuotes(p => [salesQuoteRecord as unknown as Quote, ...p])
        sync('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(salesQuoteRecord) })
      }

      const existingInvoice = (repair.invoiceId ? invoices.find(inv => inv.id === repair.invoiceId) : undefined)
        ?? ((repair as any).linkedInvoiceId ? invoices.find(inv => inv.id === (repair as any).linkedInvoiceId) : undefined)
        ?? (existingSalesQuote?.invoiceId ? invoices.find(inv => inv.id === existingSalesQuote.invoiceId) : undefined)
        ?? invoices.find(inv =>
          inv.repairId === repair.id ||
          (!!linkedSaleOrderId && inv.saleOrderId === linkedSaleOrderId) ||
          inv.notes?.includes(repair.ref)
        )
      // An invoice id recorded on the repair means one exists server-side even
      // when it is missing from local state — always patch it on revision.
      const invoiceIdToUpdate = existingInvoice?.id ?? repair.invoiceId ?? (repair as any).linkedInvoiceId
      if (isUpdate && invoiceIdToUpdate) {
        const invoiceLines: InvoiceLine[] = quote.lines.map(l => ({
          id: uid(),
          productId: l.productId,
          description: `[${l.type.toUpperCase()}] ${l.description}`,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxRate: quote.tax > 0 ? companySettings.vatRate : 0,
          subtotal: l.subtotal,
        }))
        const revisionNote = changeSummary ? `Repair quote revision ${repair.ref}:\n${changeSummary}` : `Repair quote revised: ${repair.ref}`
        const invoicePatch = {
          lines: invoiceLines,
          subtotal: quote.subtotal,
          taxTotal: quote.tax,
          taxAmount: quote.tax,
          total: chargeTotal,
          totalAmount: chargeTotal,
          repairId: repair.id,
        }
        setInvoices(p => p.map(inv => inv.id === invoiceIdToUpdate ? {
          ...inv,
          ...invoicePatch,
          saleOrderId: linkedSaleOrderId ?? inv.saleOrderId,
          notes: `${inv.notes ?? ''}\n${revisionNote}`.trim(),
        } : inv))
        sync(`/api/invoices/${invoiceIdToUpdate}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...invoicePatch, ...(linkedSaleOrderId ? { saleOrderId: linkedSaleOrderId } : {}) }),
        })
      }

      // ── Gap 2: Handle orphaned procurement requests on revision ──────────
      // Cancel pending/ordered procurement requests and their linked draft POs
      // when the quote changes. New missing parts will trigger fresh requests
      // when the revised quote is approved.
      if (isUpdate && prevQuote) {
        const newPartIds = new Set(lines.filter(l => l.type === 'part' && l.productId).map(l => l.productId!))
        const prevPartIds = new Set(prevQuote.lines.filter(l => l.type === 'part' && l.productId).map(l => l.productId!))
        // Cancel requests for parts removed from the quote
        const removedPartIds = [...prevPartIds].filter(id => !newPartIds.has(id))
        const requestsToCancel = (repair.procurementRequests ?? []).filter(req =>
          ['pending', 'ordered'].includes(req.status) &&
          req.items.some(i => removedPartIds.includes(i.productId))
        )
        if (requestsToCancel.length > 0) {
          const cancelIds = new Set(requestsToCancel.map(r => r.id))
          // Cancel linked draft POs that have no vendor assigned yet
          setPurchaseOrders(prev => prev.map(po => {
            if (!po.repairId || po.repairId !== repairId) return po
            if (!po.procurementRequestId || !cancelIds.has(po.procurementRequestId)) return po
            if (po.status !== 'draft' || po.vendorId) return po
            const updated = { ...po, status: 'cancelled' as const }
            sync(`/api/purchase-orders/${po.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return updated
          }))
        }
      }

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        quote,
        laborCost: derivedLaborCost,
        logisticsCost: derivedLogisticsCost,
        total: chargeTotal,
        diagnosisFee: chargeFee ? resolvedFee.amount : (r.diagnosisFeeStatus === 'waived' ? 0 : r.diagnosisFee),
        diagnosisFeeStatus: chargeFee
          ? (r.diagnosisFeeStatus === 'paid' || r.diagnosisFeePaidAt ? 'paid' : 'applicable')
          : (isDirectRepairPath(r.repairPath) || isNoCharge ? 'not_applicable' : r.diagnosisFeeStatus),
        diagnosisFeeBilling: r.diagnosisFeeBilling ?? resolvedFee.billing,
        customerBillingType: r.customerBillingType ?? resolvedFee.customerType,
        deviceTier: resolvedFee.tier ?? r.deviceTier,
        status: quoteStatus,
        quoteApprovalDeadline: (isNoCharge || isDirectRepair) ? undefined : quote.validUntil,
        ...(linkedSaleOrderId ? { saleOrderId: linkedSaleOrderId, saleOrderRef: linkedSaleOrderRef } : {}),
        ...(salesQuoteId ? { salesQuoteId, salesQuoteRef } : {}),
        ...(invoiceIdToUpdate ? { invoiceId: invoiceIdToUpdate } : {}),
        // Clear reserved parts — they were unreserved above (Gap 3)
        ...(isUpdate ? {
          partsUsed: [],
          procurementRequests: (r.procurementRequests ?? []).map(req =>
            ['pending', 'ordered'].includes(req.status) ? { ...req, status: 'cancelled' as const } : req
          ),
        } : {}),
      } : r))

      if (isFullWarranty) {
        // Warranty-covered — no customer approval needed, notify staff instead
        notifyUsers({
          recipients: [
            repair.assignedTechnicianId,
            ...userIdsWithRoles(users, ['director', 'finance_officer']),
          ],
          type: 'repair',
          title: `Warranty repair approved: ${repair.ref}`,
          body: `${repair.productName} (${repair.customerName}) is fully covered under warranty. Quote auto-approved — KES 0 charge.`,
          module: 'repair', path: `?id=${repair.id}`, icon: '🛡️',
          entityKey: `repair:${repair.id}:warranty_approved`,
          excludeUserId: currentUserId,
        })
        syncRepairToPortal({ ...repair, quote, status: 'approved', total: 0 }, 'Repair is fully covered under warranty — no charge')
        addAuditLog('generate_quote', repairId, `Warranty quote auto-approved (full coverage): KES 0`)
        showToast('Quote auto-approved — repair is fully covered under warranty')
      } else if (isDirectRepair) {
        // Direct Repair — quote is informational / billing; tech can start without portal approval
        syncRepairToPortal(
          { ...repair, quote, laborCost: derivedLaborCost, logisticsCost: derivedLogisticsCost, total: chargeTotal, status: 'approved' },
          isUpdate
            ? `Quote revised to KES ${chargeTotal.toLocaleString('en-KE')} (Direct Repair — no approval required)`
            : `Quote ready: KES ${chargeTotal.toLocaleString('en-KE')} (Direct Repair — no approval required)`,
        )
        const auditDetail = isUpdate && changeSummary
          ? `Direct Repair quote revised: KES ${prevQuote?.total ?? 0} → KES ${quote.total}\n${changeSummary}`
          : `Direct Repair quote ${isUpdate ? 'updated' : 'generated'} and auto-approved: KES ${quote.total}`
        addAuditLog(isUpdate ? 'update_quote' : 'generate_quote', repairId, auditDetail)
        showToast(isUpdate ? 'Quote revised and auto-approved (Direct Repair)' : 'Quote auto-approved — Direct Repair can start without client approval')
      } else {
        const coverageLabel = repair.underWarranty ? (repair.warrantyCoverage === 'partial' ? ' (partial warranty — uncovered items)' : ' (warranty voided — client pays)') : ''
        const portalMsg = reopeningAfterDecline
          ? `Revised quote after your previous decline — new total KES ${chargeTotal.toLocaleString('en-KE')}. Please review and approve.`
          : isUpdate
            ? `Quote revised — new total KES ${chargeTotal.toLocaleString('en-KE')}. Please review and re-approve.`
            : 'Quote sent — awaiting your approval'
        syncRepairToPortal({ ...repair, quote, laborCost: derivedLaborCost, logisticsCost: derivedLogisticsCost, total: chargeTotal, status: 'awaiting_approval', quoteApprovalDeadline: quote.validUntil }, portalMsg)
        const auditDetail = isUpdate && changeSummary
          ? `Quote revised: KES ${prevQuote?.total ?? 0} → KES ${quote.total}\n${changeSummary}`
          : `Quote ${isUpdate ? 'updated' : 'generated'}${coverageLabel}: KES ${quote.total}`
        addAuditLog(isUpdate ? 'update_quote' : 'generate_quote', repairId, auditDetail)
        if (repair.customerEmail || repair.customerPhone) {
          const trackingUrl = typeof window !== 'undefined' ? `${window.location.origin}/portal/repair/${encodeURIComponent(repair.ref)}` : undefined
          fetch('/api/notifications/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'quote',
              customerName: repair.customerName,
              customerEmail: repair.customerEmail,
              customerPhone: repair.customerPhone,
              channels: repair.customerEmail ? ['email'] : undefined,
              repairRef: repair.ref,
              deviceName: repair.productName,
              quoteTotal: quote.total,
              quoteUrl: trackingUrl,
              changeSummary,
            }),
          }).catch(() => {})
        }
        showToast(
          reopeningAfterDecline
            ? 'Revised quote sent after decline — awaiting customer re-approval'
            : isUpdate
              ? 'Quote revised — customer re-notified, procurement requests reset'
              : `Quote generated — customer notified via ${repair.customerEmail ? 'email' : 'SMS'}`,
        )
      }
    },
    
    sendQuoteToCustomer: async (repairId) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair?.quote) { showToast('No quote to send', 'error'); return }
      
      // Update status to awaiting approval
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'awaiting_approval',
      } : r))
      
      addAuditLog('send_quote', repair.ref, `Quote sent to ${repair.customerName}`)
      
      // Send via the available customer channel: email now, phone messaging fallback.
      if (repair.customerEmail || repair.customerPhone) {
        try {
          const portalUrl = process.env.NEXT_PUBLIC_APP_URL 
            ? `${process.env.NEXT_PUBLIC_APP_URL}/portal/quotes/${repair.id}`
            : undefined

          const response = await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'quote',
              customerName: repair.customerName,
              customerEmail: repair.customerEmail,
              customerPhone: repair.customerPhone,
              channels: repair.customerEmail ? ['email'] : undefined,
              repairRef: repair.ref,
              deviceName: repair.productName,
              quoteTotal: repair.quote.total,
              quoteUrl: portalUrl
            })
          })

          const result = await response.json()

          if (result.success) {
            const sentChannel = result.results?.email?.success ? 'EMAIL' : result.channel?.toUpperCase()
            showToast(`Quote sent to ${repair.customerName} via ${sentChannel || 'notification'}`, 'success')
          } else {
            showToast(`Quote sent • Notification failed: ${result.error}`, 'error')
          }
        } catch {
          showToast('Quote sent • Notification error', 'error')
        }
      } else {
        showToast(`Quote prepared • No email or phone number for ${repair.customerName}`, 'info')
      }
    },
    
    approveRepairQuote: async (repairId, approved, reason) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair?.quote) return
      
      if (!approved) {
        setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          quote: {
            ...r.quote!,
            rejectedDate: now(),
            rejectionReason: reason,
          },
          status: 'declined',
        } : r))

        addAuditLog('reject_quote', repairId, `Quote rejected: ${reason || 'No reason provided'}`)
        showToast('Quote rejected — repair job declined')
        return
      }
      
      // Reserve parts from inventory
      const partLines = repair.quote.lines.filter(line => line.type === 'part')
      let allPartsAvailable = true
      
      for (const line of partLines) {
        if (!line.productId) continue
        
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) continue
        
        if (product.requiresSerial) {
          const availableSerials = serialRef.current.filter(s => 
            s.productId === line.productId && 
            s.status === 'available' && 
            (s.location === 'warehouse' || s.location === 'shop' || s.location === 'repair_unit')
          )
          
          if (availableSerials.length < line.qty) {
            allPartsAvailable = false
            showToast(`Insufficient stock for ${product.name}`, 'error')
            break
          }
        } else {
          const stock = calcStockByLocation(product, serialRef.current, bulkStock, product.id)
          const available = stock.warehouse + stock.shop + stock.repair_unit
          
          if (available < line.qty) {
            allPartsAvailable = false
            notifyUsers({
              recipients: userIdsWithRoles(users, ['technical_lead', 'inventory_officer'], currentUserId),
              type: 'repair',
              title: 'Part needed for repair',
              body: `${repair.ref} — ${product.name} × ${line.qty} (only ${available} in stock)`,
              module: 'repair',
              path: `?id=${repair.id}`,
              icon: '🔧',
              entityKey: `repair:${repair.id}:part_oos:${line.productId}`,
              excludeUserId: currentUserId,
            })
            showToast(`Insufficient stock for ${product.name}`, 'error')
            break
          }
        }
      }
      
      if (!allPartsAvailable) {
        // Client approved but parts are missing — move to awaiting_parts and auto-request procurement
        const missingItems = partLines.filter(line => {
          if (!line.productId) return false
          const product = prodRef.current.find(p => p.id === line.productId)
          if (!product) return false
          if (product.requiresSerial) {
            const available = serialRef.current.filter(s => s.productId === line.productId && s.status === 'available').length
            return available < line.qty
          } else {
            const stock = calcStockByLocation(product, serialRef.current, bulkStock, product.id)
            return (stock.warehouse + stock.shop + stock.repair_unit) < line.qty
          }
        }).map(line => ({
          productId: line.productId,
          productName: line.productName || line.description,
          qty: line.qty,
          description: `Auto-procurement for repair ${repair.ref}`,
        }))

        // Mark quote as approved by client but repair is waiting on parts
        setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: 'awaiting_parts',
          quote: { ...r.quote!, approvedDate: now(), approvedBy: 'customer' },
        } : r))
        syncRepairToPortal({ ...repair, status: 'awaiting_parts' }, 'Quote approved — sourcing parts')

        if (missingItems.length > 0) {
          const procRef = seq('PROC', 'proc')
          const newProc = {
            id: uid(), ref: procRef, repairId, repairRef: repair.ref,
            requestedBy: repair.assignedTechnicianId ?? repair.createdBy,
            requestedByName: repair.assignedTechnicianName ?? repair.bookedByName ?? 'System',
            requestedDate: now(), urgency: 'high', status: 'pending' as const,
            notes: `Auto-generated — parts needed for approved quote on ${repair.ref}`,
            items: missingItems.map(item => ({
              type: 'part', productId: item.productId ?? '', productName: item.productName,
              description: item.description, qty: String(item.qty), estimatedCost: '', supplier: '',
            })),
          }
          setRepairs(p => p.map(r => r.id === repairId ? {
            ...r, procurementRequests: [...(r.procurementRequests ?? []), newProc],
          } : r))

          // Auto-create a draft PO (no vendor — admin assigns later)
          const autoPo: PurchaseOrder = {
            id: uid(), ref: await storeCtxRef.current!.allocateDocRef('PO'), status: 'draft',
            vendorId: '', vendorName: '',
            date: now(), expectedDate: addDays(now(), 7),
            lines: missingItems
              .filter(item => item.productId)
              .map(item => {
                const prod = prodRef.current.find(p => p.id === item.productId)
                const catCfg = prod ? (CATEGORY_CONFIG[prod.category as CategoryId] ?? { serialRequired: false }) : { serialRequired: false }
                return {
                  id: uid(), productId: item.productId ?? '', productName: item.productName,
                  qty: item.qty, qtyReceived: 0, unitPrice: 0, taxRate: prod?.taxRate ?? 0,
                  subtotal: 0, requiresSerial: catCfg.serialRequired,
                }
              }),
            subtotal: 0, taxTotal: 0, total: 0,
            notes: `Auto-created — parts for approved quote on repair ${repair.ref}`,
            receiptIds: [],
            repairId, repairRef: repair.ref, procurementRequestId: newProc.id,
          }
          setPurchaseOrders(p => [autoPo, ...p])
          sync('/api/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(autoPo) })
          addAuditLog('create_po', autoPo.ref, `Draft PO auto-created for repair ${repair.ref} — assign vendor in Purchase`)

          notifyUsers({
            recipients: userIdsWithRoles(users, ['technical_lead', 'inventory_officer'], currentUserId),
            type: 'repair',
            title: `Parts needed: ${repair.ref}`,
            body: `Client approved quote. ${missingItems.length} part(s) need procurement before repair can start.`,
            module: 'repair', path: `?id=${repair.id}`, icon: '📦',
            entityKey: `repair:${repair.id}:parts_needed`,
            excludeUserId: currentUserId,
          })
          showToast('Quote approved — parts sourcing required before repair can start', 'info')
        }

        // Create a quotation-status SO if one doesn't exist yet
        // (the customer-portal approval flow records linkedSaleOrderId)
        let awaitingSoId = repair.saleOrderId ?? (repair as any).linkedSaleOrderId
        let awaitingSoRef = repair.saleOrderRef ?? (repair as any).linkedSaleOrderRef
        if (!awaitingSoId) {
          awaitingSoId = uid()
          awaitingSoRef = await storeCtxRef.current!.allocateDocRef('QUO')
          const awaitingSo: SaleOrder = {
            id: awaitingSoId, ref: awaitingSoRef, status: 'quotation',
            customerId: repair.customerId, customerName: repair.customerName,
            date: now(), validUntil: addDays(now(), 30),
            lines: repair.quote.lines.map(l => ({
              id: uid(), productId: l.productId ?? '', productName: l.productName ?? l.description,
              qty: l.qty, unitPrice: l.unitPrice, discount: 0, taxRate: 0,
              subtotal: l.subtotal, serialIds: [],
            })),
            subtotal: repair.quote.subtotal, taxTotal: repair.quote.tax, total: repair.quote.total,
            notes: `Repair order ${repair.ref} — awaiting parts`,
            createdByUserId: repair.createdBy,
          }
          setSaleOrders(p => [awaitingSo, ...p])
          sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(awaitingSo) })
          setRepairs(p => p.map(r => r.id === repairId ? { ...r, saleOrderId: awaitingSoId, saleOrderRef: awaitingSoRef } : r))
        }

        // Mark linked Sales Quote as accepted and create a draft invoice
        const awaitingInvLines: InvoiceLine[] = repair.quote.lines.map(l => ({
          id: uid(), description: `[${l.type.toUpperCase()}] ${l.description}`,
          qty: l.qty, unitPrice: l.unitPrice, taxRate: repair.quote!.tax > 0 ? companySettings.vatRate : 0, subtotal: l.subtotal,
        }))
        const existingInvoice = (repair.invoiceId ? invRef.current.find(inv => inv.id === repair.invoiceId) : undefined)
          ?? ((repair as any).linkedInvoiceId ? invRef.current.find(inv => inv.id === (repair as any).linkedInvoiceId) : undefined)
          ?? invRef.current.find(inv => inv.repairId === repairId || inv.saleOrderId === awaitingSoId)
        let awaitingInvoiceId = existingInvoice?.id
        if (repair.quote.total >= 1) {
          const invoicePatch: Invoice = {
            ...(existingInvoice ?? {
              id: uid(), ref: draftInvoiceRef('customer_invoice'), type: 'customer_invoice', status: 'draft',
              partnerId: repair.customerId, partnerName: repair.customerName,
              date: now(), dueDate: addDays(now(), 14), amountPaid: 0, notes: '',
            }),
            lines: awaitingInvLines, subtotal: repair.quote.subtotal, taxTotal: repair.quote.tax,
            total: repair.quote.total, saleOrderId: awaitingSoId, repairId,
            notes: `Repair ${repair.ref} — ${repair.productName} (awaiting parts)${repair.contactPersonName ? ` | Attn: ${repair.contactPersonName}${repair.contactPersonTitle ? ` (${repair.contactPersonTitle})` : ''}` : ''}`,
          }
          awaitingInvoiceId = invoicePatch.id
          setInvoices(p => existingInvoice ? p.map(inv => inv.id === existingInvoice.id ? invoicePatch : inv) : [invoicePatch, ...p])
          sync(existingInvoice ? `/api/invoices/${existingInvoice.id}` : '/api/invoices', { method: existingInvoice ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoicePatch) })
        }

        setRepairs(p => p.map(r => r.id === repairId ? { ...r, ...(awaitingInvoiceId ? { invoiceId: awaitingInvoiceId } : {}) } : r))

        if (repair.salesQuoteId) {
          setQuotes(p => {
            const next = p.map(q => q.id === repair.salesQuoteId ? {
              ...q, status: 'accepted', ...(awaitingInvoiceId ? { invoiceId: awaitingInvoiceId } : {}), acceptedDate: now(),
            } : q)
            const updated = next.find(q => q.id === repair.salesQuoteId)
            if (updated) sync(`/api/quotes/${repair.salesQuoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return next
          })
        }
        return
      }
      
      // Reserve parts — transfer bulk into repair_unit + assign serials
      const updatedLines = repair.quote.lines.map(line => ({
        ...line,
        reserved: line.type === 'part',
      }))

      const reserveLines = partLines
        .filter(line => line.productId)
        .map(line => {
          const product = prodRef.current.find(p => p.id === line.productId)
          return {
            productId: line.productId!,
            productName: line.productName ?? line.description,
            qty: line.qty,
            requiresSerial: Boolean(product?.requiresSerial),
          }
        })
      const reservePlan = planRepairPartReserve({
        repairRef: repair.ref,
        lines: reserveLines,
        stockFor: (productId) => {
          const product = prodRef.current.find(p => p.id === productId)
          const locs = calcStockByLocation(product, serialRef.current, bulkStock, productId)
          return { warehouse: locs.warehouse, shop: locs.shop, repair_unit: locs.repair_unit }
        },
        availableSerialsFor: (productId) => serialRef.current
          .filter(s => s.productId === productId && s.status === 'available'
            && (s.location === 'warehouse' || s.location === 'shop' || s.location === 'repair_unit'))
          .map(s => ({ id: s.id, serial: s.serial, location: s.location })),
      })
      for (const step of reservePlan.steps) {
        if (step.kind === 'assign_serial') {
          setSerials(p => p.map(s => s.id === step.serialId
            ? { ...s, status: 'assigned' as const, repairId, location: 'repair_unit' as LocationId }
            : s))
          addMove(step.productId, step.productName, 1, 'transfer', step.reason, repair.ref, step.from, 'repair_unit', [step.serialNumber])
        } else {
          setBulkStock(prev => {
            let next = upsertBulkStock(prev, step.productId, step.from, -step.qty)
            next = upsertBulkStock(next, step.productId, step.to, step.qty)
            return next
          })
          addMove(step.productId, step.productName, step.qty, 'transfer', step.reason, repair.ref, step.from, step.to, [])
        }
      }

      const partsUsedNow = partLines.map(line => ({
        productId: line.productId ?? '',
        productName: line.productName ?? line.description,
        qty: line.qty,
        price: line.unitPrice,
        reservedDate: now(),
      }))

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        quote: {
          ...r.quote!,
          approvedDate: now(),
          approvedBy: 'customer',
          lines: updatedLines,
        },
        status: 'approved',
        partsUsed: partsUsedNow,
      } : r))

      // Confirm SO + create Invoice
      const soLines = repair.quote.lines.map(l => ({
        id: uid(),
        productId: l.productId ?? '',
        productName: l.productName ?? l.description,
        qty: l.qty, unitPrice: l.unitPrice, discount: 0, taxRate: 0,
        subtotal: l.subtotal, serialIds: [] as string[],
      }))

      let soId: string
      let soRef: string
      const presetSoId = repair.saleOrderId ?? (repair as any).linkedSaleOrderId
      const presetSoRef = repair.saleOrderRef ?? (repair as any).linkedSaleOrderRef
      if (presetSoId) {
        soId = presetSoId
        soRef = presetSoRef ?? repair.ref
        setSaleOrders(p => {
          const next = p.map(s => s.id === soId ? {
            ...s, status: 'sale' as const, confirmedAt: s.confirmedAt ?? new Date().toISOString(),
            lines: soLines, subtotal: repair.quote!.subtotal, taxTotal: repair.quote!.tax, total: repair.quote!.total,
          } : s)
          sync(`/api/sale-orders/${soId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next.find(s => s.id === soId)) })
          return next
        })
      } else {
        soId = uid()
        soRef = await storeCtxRef.current!.allocateDocRef('SO')
        const newSo: SaleOrder = { id: soId, ref: soRef, status: 'sale', confirmedAt: new Date().toISOString(),
          customerId: repair.customerId, customerName: repair.customerName,
          date: now(), validUntil: addDays(now(), 30),
          lines: soLines, subtotal: repair.quote.subtotal, taxTotal: repair.quote.tax, total: repair.quote.total,
          notes: `Repair order ${repair.ref}`, createdByUserId: repair.createdBy }
        setSaleOrders(p => [newSo, ...p])
        sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSo) })
      }

      const invLines: InvoiceLine[] = repair.quote.lines.map(l => ({
        id: uid(), description: `[${l.type.toUpperCase()}] ${l.description}`,
        qty: l.qty, unitPrice: l.unitPrice, taxRate: repair.quote!.tax > 0 ? companySettings.vatRate : 0, subtotal: l.subtotal,
      }))
      const existingInvoice = (repair.invoiceId ? invRef.current.find(inv => inv.id === repair.invoiceId) : undefined)
        ?? ((repair as any).linkedInvoiceId ? invRef.current.find(inv => inv.id === (repair as any).linkedInvoiceId) : undefined)
        ?? invRef.current.find(inv => inv.repairId === repairId || inv.saleOrderId === soId)
      let invoiceId = existingInvoice?.id
      let invoiceRef = existingInvoice?.ref
      if (repair.quote.total >= 1) {
        const invoice: Invoice = {
          ...(existingInvoice ?? {
            id: uid(), ref: await storeCtxRef.current!.allocateDocRef('INV'), type: 'customer_invoice', status: 'posted',
            partnerId: repair.customerId, partnerName: repair.customerName,
            date: now(), dueDate: addDays(now(), 14), amountPaid: 0, notes: '',
          }),
          lines: invLines, subtotal: repair.quote.subtotal, taxTotal: repair.quote.tax,
          total: repair.quote.total, saleOrderId: soId, repairId,
          notes: `Repair ${repair.ref} — ${repair.productName}${repair.contactPersonName ? ` | Attn: ${repair.contactPersonName}${repair.contactPersonTitle ? ` (${repair.contactPersonTitle})` : ''}` : ''}`,
        }
        invoiceId = invoice.id
        invoiceRef = invoice.ref
        setInvoices(p => existingInvoice ? p.map(inv => inv.id === existingInvoice.id ? invoice : inv) : [invoice, ...p])
        sync(existingInvoice ? `/api/invoices/${existingInvoice.id}` : '/api/invoices', { method: existingInvoice ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })
      }

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r, saleOrderId: soId, saleOrderRef: soRef, ...(invoiceId ? { invoiceId, invoiceDate: now() } : {}),
      } : r))

      // Mark linked Sales Quote as accepted
      if (repair.salesQuoteId) {
        setQuotes(p => {
          const next = p.map(q => q.id === repair.salesQuoteId ? {
            ...q, status: 'accepted', saleOrderId: soId, ...(invoiceId ? { invoiceId } : {}), acceptedDate: now(),
          } : q)
          const updated = next.find(q => q.id === repair.salesQuoteId)
          if (updated) sync(`/api/quotes/${repair.salesQuoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      }

      addAuditLog('approve_quote', repairId, `Quote approved → ${soRef}${invoiceRef ? ` + ${invoiceRef}` : ' (no invoice: zero total)'}`)
      showToast(invoiceRef ? `Quote approved — ${soRef} & ${invoiceRef} ${existingInvoice ? 'updated' : 'created'}` : `Quote approved — ${soRef} created (no invoice for zero total)`)
    },

    startRepair: (repairId) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      if (blockIfOutsourced(repairId, 'start repair work')) return
      const isAssignedTech = repair.assignedTechnicianId === user.id
      if (!isAssignedTech) {
        showToast('Only the assigned technician can start the repair', 'error'); return
      }
      // Diagnosis First needs quote approval; Direct Repair / billing-exempt may start earlier
      const validStartStatuses = (
        isRepairBillingExempt(repair)
          ? startableStatusesWhenBillingExempt()
          : startableStatusesForPath(repair.repairPath)
      ) as RepairStatus[]
      if (!validStartStatuses.includes(repair.status)) {
        showToast(
          isRepairBillingExempt(repair) || isDirectRepairPath(repair.repairPath)
            ? 'Repair cannot start at this stage'
            : 'Client must approve the quote before repair can start',
          'error',
        )
        return
      }
      const defaultQA = repair.qcItems.length === 0 ? buildDefaultRepairQcItems(uid) : []
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'in_repair',
        repairStartDate: now(),
        ...(defaultQA.length ? { qcItems: defaultQA } : {}),
      } : r))

      syncRepairToPortal({ ...repair, status: 'in_repair', repairStartDate: now() }, 'Repair in progress')
      addAuditLog('start_repair', repairId, 'Repair work started')
      showToast('Repair work started')
    },

    markRepairComplete: (repairId) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      if (blockIfOutsourced(repairId, 'move to QC')) return
      if (repair.assignedTechnicianId !== user.id) {
        showToast('Only the assigned technician can mark the repair as complete', 'error'); return
      }
      if (repair.status !== 'in_repair') {
        showToast('Repair must be in progress to mark complete', 'error'); return
      }

      const completedAt = now()
      // Seed defaults if missing; clear prior pass ticks so re-QC cannot skip old checks
      const qcItems = prepareRepairQcItemsForRound(repair.qcItems, uid)
      const updated: RepairOrder = {
        ...repair,
        status: 'qc',
        repairCompletedDate: completedAt,
        qcItems,
        qcFailReason: undefined,
        qcFailedDate: undefined,
        qcFailedBy: undefined,
        qcPassedDate: undefined,
        qcApprovedBy: undefined,
        statusHistory: [
          ...(repair.statusHistory ?? []),
          { status: 'qc', date: completedAt, note: 'Repair complete — undergoing quality check', by: user.name },
        ],
      }
      setRepairs(p => p.map(r => r.id === repairId ? updated : r))
      syncRepairToPortal(updated, 'Repair complete — undergoing quality check')
      addAuditLog('complete_repair', repairId, 'Technician marked repair complete — awaiting QC')
      showToast('Repair marked complete — QC can now proceed')
    },

    addRepairQAItem: (repairId, description) => {
      const qaItem: RepairQAItem = {
        id: uid(),
        description,
        passed: false,
      }
      
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        qcItems: [...(r.qcItems ?? []), qaItem],
      } : r))
    },
    
    completeRepairQA: (repairId, qaResults, failReason) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      if (blockIfOutsourced(repairId, 'perform QC')) return
      if (repair.status !== 'qc') {
        showToast('Repair must be in QC to complete quality check', 'error'); return
      }
      // Directors/leads can always QA; technicians can QA any repair they did NOT work on
      const isAuthorized = ['director', 'technical_lead'].includes(user.role)
        || (user.role === 'technician' && repair.assignedTechnicianId !== user.id)
      if (!isAuthorized) {
        showToast('You cannot perform QA on a repair you worked on — a different technician must do QC', 'error'); return
      }

      const testedAt = now()
      const baseItems = (repair.qcItems?.length
        ? repair.qcItems
        : buildDefaultRepairQcItems(uid))
      const anyIdMatch = qaResults.some(res => baseItems.some(item => item.id === res.itemId))
      const updatedQCItems: RepairQAItem[] = anyIdMatch
        ? baseItems.map(item => {
            const result = qaResults.find(res => res.itemId === item.id)
            return result ? {
              ...item,
              passed: !!result.passed,
              testedBy: user.name,
              testedDate: testedAt,
              notes: result.notes,
            } : { ...item, passed: false, testedBy: user.name, testedDate: testedAt }
          })
        : (qaResults.length > 0
          ? qaResults.map(res => ({
              id: res.itemId || uid(),
              description: res.description || 'QC check',
              passed: !!res.passed,
              testedBy: user.name,
              testedDate: testedAt,
              notes: res.notes,
            }))
          : baseItems.map(item => ({
              ...item,
              passed: false,
              testedBy: user.name,
              testedDate: testedAt,
            })))

      // Never auto-pass an empty checklist
      const allPassed = updatedQCItems.length > 0 && updatedQCItems.every(item => item.passed)
      const failedSummary = summarizeFailedQcItems(updatedQCItems)
      const trimmedFailReason = String(failReason ?? '').trim()

      if (!allPassed && !trimmedFailReason) {
        showToast('A fail reason is required when QC does not pass', 'error')
        return
      }

      if (allPassed) {
        const partsToConsume = repair.partsUsed.filter(part => part.reservedDate && !part.usedDate) || []
        const consumeLines = partsToConsume.map(part => {
          const product = prodRef.current.find(p => p.id === part.productId)
          return {
            productId: part.productId,
            productName: part.productName,
            qty: part.qty,
            requiresSerial: Boolean(product?.requiresSerial),
          }
        })
        // Apply consume plan against a mutable local stock snapshot so multi-line
        // deductions don't over-allocate the same units in one QC pass.
        const localBulk = bulkStock.map(l => ({ ...l }))
        const consumePlan = planRepairPartConsume({
          repairRef: repair.ref,
          lines: consumeLines,
          stockFor: (productId) => {
            const product = prodRef.current.find(p => p.id === productId)
            const locs = calcStockByLocation(product, serialRef.current, localBulk, productId)
            return { warehouse: locs.warehouse, shop: locs.shop, repair_unit: locs.repair_unit }
          },
          assignedSerialsFor: (productId) => serialRef.current
            .filter(s => s.productId === productId && s.repairId === repairId && s.status === 'assigned')
            .map(s => ({ id: s.id, serial: s.serial, location: (s.location || 'repair_unit') as LocationId })),
        })
        for (const step of consumePlan.steps) {
          if (step.kind === 'consume_serial') {
            setSerials(p => p.map(s => s.id === step.serialId ? { ...s, status: 'sold' as const } : s))
            setProducts(p => p.map(x => x.id === step.productId ? { ...x, stockQty: Math.max(0, x.stockQty - 1) } : x))
            addMove(step.productId, step.productName, 1, 'out', step.reason, repair.ref ?? repairId, step.from, undefined, [step.serialNumber])
          } else {
            setBulkStock(prev => upsertBulkStock(prev, step.productId, step.from, -step.qty))
            // Keep local snapshot in sync for subsequent steps in this plan.
            const idx = localBulk.findIndex(l => l.productId === step.productId && l.location === step.from)
            if (idx >= 0) localBulk[idx] = { ...localBulk[idx], qty: Math.max(0, localBulk[idx].qty - step.qty) }
            setProducts(p => p.map(x => x.id === step.productId ? { ...x, stockQty: Math.max(0, x.stockQty - step.qty) } : x))
            addMove(step.productId, step.productName, step.qty, 'out', step.reason, repair.ref ?? repairId, step.from, undefined, [])
          }
        }

        const passedRepair: RepairOrder = {
          ...repair,
          qcItems: updatedQCItems,
          qcPassedDate: testedAt,
          qcApprovedBy: user.name,
          qcFailReason: undefined,
          qcFailedDate: undefined,
          qcFailedBy: undefined,
          status: 'ready',
          partsUsed: repair.partsUsed.map(part => ({
            ...part,
            usedDate: part.reservedDate && !part.usedDate ? testedAt : part.usedDate,
          })),
          statusHistory: [
            ...(repair.statusHistory ?? []),
            { status: 'ready', date: testedAt, note: 'QA passed — device ready for collection', by: user.name },
          ],
        }
        setRepairs(p => p.map(r => r.id === repairId ? passedRepair : r))
        syncRepairToPortal(passedRepair, 'Device ready for collection')
        notifyUsers({
          recipients: [
            repair.assignedTechnicianId,
            ...userIdsWithRoles(users, ['director', 'finance_officer']),
          ],
          type: 'repair',
          title: `Device ready: ${repair.ref}`,
          body: `${repair.productName} for ${repair.customerName} has passed QA and is ready for collection/delivery.`,
          module: 'repair', path: `?id=${repair.id}`,
          icon: '✅',
          entityKey: `repair:${repair.id}:qc_pass`,
          excludeUserId: user.id,
        })
        addAuditLog('complete_qc', repairId, 'QA passed — device ready for customer')
        showToast('QA passed — device ready for pickup')
      } else {
        const historyNote = `QA failed: ${trimmedFailReason}${failedSummary ? ` — ${failedSummary}` : ''}`
        const failedRepair: RepairOrder = {
          ...repair,
          qcItems: updatedQCItems,
          qcFailReason: trimmedFailReason,
          qcFailedDate: testedAt,
          qcFailedBy: user.name,
          qcPassedDate: undefined,
          qcApprovedBy: undefined,
          status: 'in_repair',
          // Do not stamp/overwrite repairCompletedDate on fail
          statusHistory: [
            ...(repair.statusHistory ?? []),
            { status: 'in_repair', date: testedAt, note: historyNote, by: user.name },
          ],
        }
        setRepairs(p => p.map(r => r.id === repairId ? failedRepair : r))

        if (repair.assignedTechnicianId) {
          notifyUsers({
            recipients: [repair.assignedTechnicianId],
            type: 'repair',
            title: '❌ Repair failed QA',
            body: `${repair.ref} requires rework. Reason: ${trimmedFailReason}${failedSummary ? `. Failed: ${failedSummary}` : ''}`,
            module: 'repair',
            path: `?id=${repair.id}`,
            icon: '❌',
            entityKey: `repair:${repair.id}:qc_fail`,
            excludeUserId: user.id,
          })
        }
        // Portal must mirror ERP — in_repair, not qc
        syncRepairToPortal(failedRepair, historyNote)
        addAuditLog('fail_qc', repairId, historyNote)
        showToast('QA failed — repair requires rework', 'error')
      }
    },
    
    markPartsArrived: (repairId) => {
      const actor = currentUser()
      if (!actor || !['technical_lead', 'director', 'inventory_officer'].includes(actor.role)) {
        showToast('Only the Technical Lead or Inventory Officer can mark parts as arrived', 'error'); return
      }
      const repair = repairs.find(r => r.id === repairId)
      if (!repair || repair.status !== 'awaiting_parts') return

      const partLines = (repair.quote?.lines ?? []).filter(l => l.type === 'part' && l.productId)

      // Reserve parts now that stock has arrived — into repair_unit
      const arrivedReserve = planRepairPartReserve({
        repairRef: repair.ref,
        lines: partLines.map(line => {
          const product = prodRef.current.find(p => p.id === line.productId)
          return {
            productId: line.productId!,
            productName: line.productName ?? line.description,
            qty: line.qty,
            requiresSerial: Boolean(product?.requiresSerial),
          }
        }),
        stockFor: (productId) => {
          const product = prodRef.current.find(p => p.id === productId)
          const locs = calcStockByLocation(product, serialRef.current, bulkStock, productId)
          return { warehouse: locs.warehouse, shop: locs.shop, repair_unit: locs.repair_unit }
        },
        availableSerialsFor: (productId) => serialRef.current
          .filter(s => s.productId === productId && s.status === 'available')
          .map(s => ({ id: s.id, serial: s.serial, location: s.location })),
      })
      for (const step of arrivedReserve.steps) {
        if (step.kind === 'assign_serial') {
          setSerials(p => p.map(s => s.id === step.serialId
            ? { ...s, status: 'assigned' as const, repairId, location: 'repair_unit' as LocationId }
            : s))
          addMove(step.productId, step.productName, 1, 'transfer', step.reason, repair.ref, step.from, 'repair_unit', [step.serialNumber])
        } else {
          setBulkStock(prev => {
            let next = upsertBulkStock(prev, step.productId, step.from, -step.qty)
            next = upsertBulkStock(next, step.productId, step.to, step.qty)
            return next
          })
          addMove(step.productId, step.productName, step.qty, 'transfer', step.reason, repair.ref, step.from, step.to, [])
        }
      }

      const updatedLines = (repair.quote?.lines ?? []).map(l => ({
        ...l,
        reserved: l.type === 'part' ? true : l.reserved,
      }))
      const partsUsedNow = partLines.map(line => ({
        productId: line.productId ?? '',
        productName: line.productName ?? line.description,
        qty: line.qty,
        price: line.unitPrice,
        reservedDate: now(),
      }))

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'approved',
        quote: r.quote ? { ...r.quote, lines: updatedLines } : r.quote,
        partsUsed: partsUsedNow,
        procurementRequests: (r.procurementRequests ?? []).map(req => req.status === 'pending' ? { ...req, status: 'received' as const } : req),
      } : r))

      if (repair.assignedTechnicianId) {
        notifyUsers({
          recipients: [repair.assignedTechnicianId],
          type: 'repair',
          title: '📦 Parts have arrived — ready to start',
          body: `${repair.ref} — ${repair.productName}`,
          module: 'repair',
          path: `?id=${repair.id}`,
          icon: '📦',
          entityKey: `repair:${repair.id}:parts_arrived`,
          excludeUserId: actor?.id,
        })
      }
      syncRepairToPortal({ ...repair, status: 'approved' }, 'Parts arrived — repair resuming')
      addAuditLog('parts_arrived', repairId, `${actor.name} confirmed parts arrived and reserved`)
      showToast('Parts received and reserved — technician notified')
    },

    markRepairReady: (repairId) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return
      }
      if (blockIfOutsourced(repairId, 'mark the repair ready')) return
      const missingSteps: string[] = []
      if (repair.status === 'pending_verification') {
        missingSteps.push('intake verification')
      }
      const requiresFullWorkflow = !repair.diagnosisStopped && repair.repairPath !== 'direct_repair' && !isRepairBillingExempt(repair)
      if (requiresFullWorkflow && !repair.diagnosis) {
        missingSteps.push('diagnosis')
      }
      if (requiresFullWorkflow && !repair.quote) {
        missingSteps.push('quote generation')
      }
      const quoteApproved =
        !repair.quote ||
        !!repair.quote.approvedDate ||
        ['approved', 'awaiting_parts', 'in_repair', 'qc', 'ready', 'delivered'].includes(repair.status)
      if (requiresFullWorkflow && repair.quote && !quoteApproved) {
        missingSteps.push('quote approval')
      }
      const qaPassed = (repair.qcItems?.length ?? 0) > 0 && repair.qcItems.every(item => item.passed)
      if (!repair.diagnosisStopped && !repair.qcPassedDate && !qaPassed) {
        missingSteps.push('QA sign-off')
      }
      if (missingSteps.length > 0) {
        showToast(`Complete required steps before ready: ${missingSteps.join(' → ')}`, 'error')
        return
      }
      setRepairs(p => p.map(r => r.id === repairId ? { ...r, status: 'ready' } : r))

      // Auto-post the draft invoice created at quote-approval time (Path B procurement flow).
      // Path A already creates the invoice as 'posted', so this only fires for drafts.
      if (repair?.invoiceId) {
        const inv = invRef.current.find(i => i.id === repair.invoiceId)
        if (inv && inv.status === 'draft' && inv.lines.length > 0) {
          setInvoices(p => {
            const next = p.map(i => i.id === inv.id ? { ...i, status: 'posted' as const } : i)
            const updated = next.find(i => i.id === inv.id)
            if (updated) sync(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return next
          })
          // Post GL journal: AR debit / Sales Revenue credit / VAT credit
          const journal: JournalEntry = {
            id: uid(), ref: `JRN/${inv.ref}`, date: now(), source: 'invoice',
            description: `Invoice ${inv.ref} — ${inv.partnerName} (auto-posted on repair ready)`,
            status: 'posted', invoiceId: inv.id,
            lines: [
              { id: uid(), account: '1800 - Accounts Receivable', description: `AR: ${inv.partnerName}`, debit: inv.total, credit: 0 },
              { id: uid(), account: '5000 - Sales Revenue', description: `Revenue: ${inv.ref}`, debit: 0, credit: inv.subtotal },
              ...(inv.taxTotal > 0 ? [{ id: uid(), account: '3301 - Output VAT Payable', description: `VAT on ${inv.ref}`, debit: 0, credit: inv.taxTotal }] : []),
            ],
            totalDebit: inv.total, totalCredit: inv.total,
          }
          setJournalEntries(p => [journal, ...p])
          addAuditLog('post_invoice', inv.ref, `Auto-posted on repair ready — ${repair.ref}`)
        }
      }

      // Confirm the Sale Order if it's still a quotation (Path B — parts were sourced)
      if (repair?.saleOrderId) {
        setSaleOrders(prev => {
          const next = prev.map(s => s.id === repair.saleOrderId && (s.status === 'quotation' || s.status === 'quotation_sent')
            ? { ...s, status: 'sale' as const, confirmedAt: new Date().toISOString() }
            : s
          )
          const updated = next.find(s => s.id === repair.saleOrderId)
          if (updated?.status === 'sale') sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      }

      if (repair?.assignedTechnicianId) {
        notifyUsers({
          recipients: [
            repair.assignedTechnicianId,
            ...userIdsWithRoles(users, ['director', 'finance_officer']),
          ],
          type: 'repair',
          title: `Device ready — ${repair.ref}`,
          body: `${repair.productName} for ${repair.customerName} has been marked ready for pickup/delivery.`,
          module: 'repair',
          path: `?id=${repair.id}`,
          icon: '✅',
          entityKey: `repair:${repair.id}:ready`,
          excludeUserId: currentUserId,
        })
      }
      if (repair) syncRepairToPortal({ ...repair, status: 'ready' }, 'Repair complete — device ready for collection')
      addAuditLog('mark_ready', repairId, 'Device ready for pickup')
      showToast('Device marked ready for pickup — invoice posted, technician notified')
    },
    
    scheduleDelivery: (repairId, method, scheduledDate, address, riderId, riderName) => {
      const repair = repairs.find(r => r.id === repairId)
      if (blockIfOutsourced(repairId, 'schedule delivery')) return
      let deliveryJobId: string | undefined

      if (method === 'delivery' && repair) {
        const user = currentUser()
        const rider = riderId ? riders.find(r => r.id === riderId) : undefined
        const jobId = uid()
        const job: DeliveryJob = {
          id: jobId,
          ref: seq('DJB', 'djb'),
          type: 'repair_dropoff',
          status: riderId ? 'assigned' : 'pending',
          repairOrderId: repairId,
          repairOrderRef: repair.ref,
          customerName: repair.contactPersonName || repair.customerName,
          customerPhone: repair.contactPersonPhone || repair.customerPhone || '',
          pickupAddress: `${companySettings.name}, ${companySettings.address}`,
          deliveryAddress: address || '',
          riderId: riderId || undefined,
          riderName: riderName || undefined,
          assignedAt: riderId ? now() : undefined,
          scheduledDate,
          riderFee: rider?.ratePerDelivery ?? 0,
          billedTo: 'customer',
          notes: `Repair ${repair.ref} — device drop-off to client`,
          createdByUserId: user?.id ?? '',
          createdByName: user?.name ?? 'System',
          createdAt: now(),
        }
        deliveryJobId = jobId
        setDeliveryJobs(p => [job, ...p])
        addAuditLog('create_delivery_job', job.ref, `repair_dropoff for ${job.customerName}`)
      }

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        deliveryMethod: method,
        deliveryScheduledDate: scheduledDate,
        deliveryAddress: address,
        deliveryRiderId: riderId,
        deliveryRiderName: riderName,
        ...(deliveryJobId ? { deliveryJobId } : {}),
      } : r))

      const toastMsg = method === 'delivery'
        ? `Delivery job created${riderName ? ` — ${riderName}` : ' — rider TBD'}`
        : `${method === 'courier' ? 'Courier' : 'Pickup'} scheduled for ${scheduledDate}`
      addAuditLog('schedule_delivery', repairId, `Scheduled ${method} for ${scheduledDate}${riderName ? ` via ${riderName}` : ''}`)
      showToast(toastMsg)
    },
    
    deliverRepair: (repairId, recipientName, recipientPhone, isRep = false, repRelationship, repIdNumber) => {
      const repair = repairs.find(r => r.id === repairId)
      if (blockIfOutsourced(repairId, 'deliver this repair')) return
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'delivered',
        deliveryActualDate: now(),
        deliveryMethod: r.deliveryMethod ?? 'pickup',
        deliveryRecipient: recipientName,
        deliveryRecipientPhone: recipientPhone || undefined,
        deliveryRecipientIsRep: isRep || undefined,
        deliveryRecipientRelationship: isRep ? repRelationship : undefined,
        deliveryRecipientIdNumber: repIdNumber || undefined,
      } : r))
      if (repair) syncRepairToPortal(
        { ...repair, status: 'delivered' },
        isRep
          ? `Device collected by ${recipientName} (${repRelationship || 'Representative'}) on behalf of client`
          : `Device collected by ${recipientName}`
      )
      const detail = isRep ? `${recipientName} (Rep — ${repRelationship || 'Representative'})` : recipientName
      addAuditLog('deliver_repair', repairId, `Collected by ${detail}`)
      showToast(`Device handed over to ${recipientName}`)
    },
    
    closeRepairJob: (repairId) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      if (blockIfOutsourced(repairId, 'close this repair')) return
      
      if (!['delivered', 'collected'].includes(repair.status)) {
        showToast('Device must be delivered or collected before closing the repair', 'error')
        return
      }
      
      if (!isRepairNoCharge(repair) && !repair.invoiceId) {
        showToast('Generate invoice before closing', 'error')
        return
      }
      
      const closedRepair = {
        ...repair,
        status: 'closed' as RepairStatus,
        closedDate: now(),
      }
      setRepairs(p => p.map(r => r.id === repairId ? closedRepair : r))
      syncRepairToPortal(closedRepair, 'Repair job closed')
      
      addAuditLog('close_repair', repair.ref, `Repair job closed`)
      showToast(`${repair.ref} closed successfully`)
    },
    
    createInvoiceFromRepair: async (repairId, applyVat = true) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return null
      if (blockIfOutsourced(repairId, 'invoice this repair')) return null
      
      if (isRepairNoCharge(repair)) {
        showToast(
          isRepairBillingExempt(repair)
            ? 'No invoice — this job is marked no-charge (company mistake / goodwill)'
            : 'No invoice needed for warranty repairs',
          'info',
        )
        return null
      }
      
      if (repair.invoiceId) {
        showToast('Invoice already exists for this repair', 'error')
        return null
      }
      
      const lines: InvoiceLine[] = [
        ...repair.partsUsed.map(part => ({
          id: uid(),
          description: `Part: ${part.productName}`,
          qty: part.qty,
          unitPrice: part.price,
          taxRate: applyVat ? companySettings.vatRate : 0,
          subtotal: part.qty * part.price,
        })),
        ...(repair.laborCost > 0 ? [{
          id: uid(),
          description: 'Labor & Service Charges',
          qty: 1,
          unitPrice: repair.laborCost,
          taxRate: 0,
          subtotal: repair.laborCost,
        }] : []),
        ...(repair.logisticsCost > 0 ? [{
          id: uid(),
          description: 'Delivery Service',
          qty: 1,
          unitPrice: repair.logisticsCost,
          taxRate: 0,
          subtotal: repair.logisticsCost,
        }] : []),
        // Corporate: fee on final invoice. Walk-in already paid upfront: omit (not double-billed; not credited against labour).
        ...((() => {
          if (!shouldChargeDiagnosisFee(repair) || !(repair.diagnosisFee ?? 0)) return []
          // Already collected separately (walk-in upfront) — do not re-bill on the repair invoice
          if (repair.diagnosisFeeStatus === 'paid' || !!repair.diagnosisFeePaidAt) return []
          if (repair.diagnosisFeeStatus === 'waived' || repair.diagnosisFeeStatus === 'not_applicable') return []
          return [{
            id: uid(),
            description: repair.diagnosisStopped
              ? 'Diagnosis Fee (repair not undertaken)'
              : 'Diagnosis Fee',
            qty: 1,
            unitPrice: repair.diagnosisFee!,
            taxRate: 0,
            subtotal: repair.diagnosisFee!,
          }]
        })()),
      ]
      
      const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
      const taxTotal = lines.reduce((sum, line) => sum + Math.round(line.subtotal * line.taxRate / 100), 0)

      if (subtotal + taxTotal < 1) {
        showToast('Invoice total must be at least KES 1 — invoices below KES 1 cannot be created', 'error')
        return null
      }

      const invoice: Invoice = {
        id: uid(),
        ref: await storeCtxRef.current!.allocateDocRef('INV'),
        type: 'customer_invoice',
        status: 'posted',
        partnerId: repair.customerId,
        partnerName: repair.customerName,
        date: now(),
        dueDate: now(),
        lines,
        subtotal,
        taxTotal,
        total: subtotal + taxTotal,
        amountPaid: 0,
        repairId,
        notes: `Repair invoice for ${repair.ref}${
          isDiagnosisFeeSettled(repair) && repair.diagnosisFeeStatus === 'paid'
            ? ` — diagnosis fee KES ${(repair.diagnosisFee ?? 0).toLocaleString('en-KE')} collected early (not credited against this bill)`
            : ''
        }`,
      }
      
      setInvoices(p => [invoice, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })

      // Post GL journal: DR Accounts Receivable / CR Sales Revenue [/ CR VAT]
      const glJournal: JournalEntry = {
        id: uid(), ref: `JRN/${invoice.ref}`,
        date: now(), source: 'invoice',
        description: `Repair invoice ${invoice.ref} — ${repair.customerName}`, status: 'posted', invoiceId: invoice.id,
        lines: [
          { id: uid(), account: '1800 - Accounts Receivable', description: `AR: ${repair.customerName}`, debit: invoice.total, credit: 0 },
          { id: uid(), account: '5000 - Sales Revenue', description: `Revenue: ${invoice.ref}`, debit: 0, credit: invoice.subtotal },
          ...(invoice.taxTotal > 0 ? [{ id: uid(), account: '3301 - Output VAT Payable', description: `VAT on ${invoice.ref}`, debit: 0, credit: invoice.taxTotal }] : []),
        ],
        totalDebit: invoice.total, totalCredit: invoice.total,
      }
      setJournalEntries(p => [glJournal, ...p])

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        invoiceId: invoice.id,
        invoiceDate: now(),
        status: 'invoiced',
        diagnosisFeeStatus: (() => {
          if (!shouldChargeDiagnosisFee(r) || !(r.diagnosisFee ?? 0)) return r.diagnosisFeeStatus
          if (r.diagnosisFeeStatus === 'paid' || r.diagnosisFeePaidAt) return 'paid'
          // Fee line included on this invoice
          if (r.diagnosisFeeStatus !== 'waived' && r.diagnosisFeeStatus !== 'not_applicable') return 'invoiced'
          return r.diagnosisFeeStatus
        })(),
      } : r))

      addAuditLog('invoice_repair', repair.ref, `Invoice ${invoice.ref} created`)
      showToast(`Invoice ${invoice.ref} generated`)
      return invoice
    },

    reviewPortalPayment: (repairId, approved, notes) => {
      const user = currentUser()
      if (!canManageFinance(user)) {
        showToast('Only Finance or Admin Officer can review payment confirmations', 'error'); return
      }
      const repair = repairsRef.current.find(r => r.id === repairId)
      if (!repair) return
      if (repair.paymentConfirmationStatus !== 'pending_review') {
        showToast('No pending payment confirmation to review', 'info'); return
      }
      const reviewedAt = new Date().toISOString()

      if (!approved) {
        const rejectedRepair = {
          ...repair,
          paymentConfirmationStatus: 'rejected' as const,
          paymentConfirmationReviewedAt: reviewedAt,
          paymentConfirmationReviewedBy: user!.name,
          paymentConfirmationNotes: notes?.trim() || 'Rejected by finance — confirmation could not be verified against the invoice.',
        }
        setRepairs(p => p.map(r => r.id === repairId ? rejectedRepair : r))
        syncRepairToPortal(rejectedRepair, 'Payment confirmation could not be verified — please contact us or resubmit')
        addAuditLog('reject_portal_payment', repair.ref, `Portal payment confirmation rejected${notes ? `: ${notes}` : ''}`)
        showToast('Payment confirmation rejected — customer can resubmit')
        return
      }

      // Confirm: register the payment against the linked invoice
      const invoiceId = repair.invoiceId ?? (repair as any).linkedInvoiceId
      const invoice = (invoiceId ? invRef.current.find(i => i.id === invoiceId) : undefined)
        ?? invRef.current.find(i => i.repairId === repairId)
      if (!invoice) {
        showToast('No linked invoice found for this repair — generate the invoice first', 'error'); return
      }
      const balance = invoice.total - invoice.amountPaid
      if (balance > 0) {
        const claimed = Number(repair.paymentConfirmationAmount ?? 0)
        const amount = claimed > 0 ? Math.min(claimed, balance) : balance
        storeCtxRef.current!.registerPayment(
          invoice.id, amount, 'mpesa', undefined,
          repair.paymentReceiptNumber ?? 'Portal M-PESA confirmation',
        )
      }
      const confirmedRepair = {
        ...repair,
        paymentConfirmationStatus: 'confirmed' as const,
        paymentConfirmationReviewedAt: reviewedAt,
        paymentConfirmationReviewedBy: user!.name,
        paymentConfirmationNotes: notes?.trim() || `Confirmed by ${user!.name} against ${invoice.ref}.`,
      }
      setRepairs(p => p.map(r => r.id === repairId ? confirmedRepair : r))
      syncRepairToPortal(confirmedRepair, 'Payment confirmed — thank you')
      addAuditLog('confirm_portal_payment', repair.ref, `Portal payment confirmed against ${invoice.ref}${notes ? ` — ${notes}` : ''}`)
      showToast(`Payment confirmed and registered against ${invoice.ref}`)
    },

    canViewRepair: (repairId) => {
      const user = currentUser()
      if (!user) return false
      
      if (['director', 'finance_officer', 'technical_lead'].includes(user.role)) return true

      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return false

      // Functional Firewall: Technicians can ONLY see their assigned repairs
      if (user.role === 'technician') {
        return repair.assignedTechnicianId === user.id
      }

      return true
    },

    getVisibleRepairs: () => {
      const user = currentUser()
      if (!user) return []
      const list = ensureArray<RepairOrder>(repairs)

      // Full visibility: admin, finance, lead techs see every repair
      if (['director', 'finance_officer', 'technical_lead'].includes(user.role)) return list

      // Functional Firewall: Technicians see their assigned jobs + QC-pending repairs they did NOT work on (for cross-tech QA)
      if (user.role === 'technician') {
        return list.filter(r => r.assignedTechnicianId === user.id || (r.status === 'qc' && r.assignedTechnicianId !== user.id))
      }

      return list
    },

    updateRepairProgress: async (repairId, newStatus, message, notifyCustomer) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return
      }

      const user = currentUser()
      if (!user) {
        showToast('User not authenticated', 'error')
        return
      }

      // Check permissions: technicians can only update their assigned repairs
      if (user.role === 'technician' && repair.assignedTechnicianId !== user.id) {
        showToast('You can only update repairs assigned to you', 'error')
        return
      }

      const blockedStatuses: RepairStatus[] = ['in_repair', 'qc', 'ready', 'invoiced', 'verified_released', 'delivered', 'collected', 'closed']
      if (blockedStatuses.includes(newStatus) && blockIfOutsourced(repairId, `set status to ${newStatus}`)) {
        return
      }

      // If cancelling, free up reserved serials and cancel linked financial documents
      if (newStatus === 'cancelled') {
        setSerials(p => p.map(s => s.repairId === repairId ? {
          ...s, status: 'available', repairId: undefined
        } : s))
        if (repair.saleOrderId) {
        setSaleOrders(p => p.map(so => {
          if (so.id !== repair.saleOrderId) return so
          const updated = { ...so, status: 'cancelled' as const }
          sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
        }
        if (repair.invoiceId) {
          setInvoices(p => p.map(inv => inv.id === repair.invoiceId ? { ...inv, status: 'cancelled' } : inv))
        }
      }

      // Update repair status
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: newStatus,
        ...(newStatus === 'in_repair' && !r.repairStartDate ? { repairStartDate: now() } : {}),
        ...(newStatus === 'qc' && !r.repairCompletedDate ? { repairCompletedDate: now() } : {}),
        ...(newStatus === 'ready' && !r.qcPassedDate ? { qcPassedDate: now(), qcApprovedBy: user.name } : {}),
        ...(newStatus === 'delivered' ? { deliveryActualDate: now() } : {}),
        ...(newStatus === 'closed' ? { closedDate: now() } : {}),
      } : r))

      const updatedRepair: RepairOrder = {
        ...repair,
        status: newStatus,
        ...(newStatus === 'in_repair' && !repair.repairStartDate ? { repairStartDate: now() } : {}),
        ...(newStatus === 'qc' && !repair.repairCompletedDate ? { repairCompletedDate: now() } : {}),
        ...(newStatus === 'ready' && !repair.qcPassedDate ? { qcPassedDate: now(), qcApprovedBy: user.name } : {}),
        ...(newStatus === 'delivered' ? { deliveryActualDate: now() } : {}),
        ...(newStatus === 'closed' ? { closedDate: now() } : {}),
      }
      syncRepairToPortal(updatedRepair, message || `Status changed to ${newStatus}`)

      // Log activity
      addAuditLog('update_repair_progress', repairId, `Status changed to ${newStatus} by ${user.name}`)

      // Send customer notification if requested
      if (notifyCustomer && repair.customerPhone) {
        try {
          const response = await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'repair',
              customerName: repair.customerName,
              customerPhone: repair.customerPhone,
              repairRef: repair.ref,
              deviceName: repair.productName,
              message,
              options: { priority: 'normal' }
            })
          })

          const result = await response.json()

          if (result.success) {
            showToast(`Status updated to ${newStatus} • Customer notified via ${result.channel?.toUpperCase()}`, 'success')
          } else {
            showToast(`Status updated to ${newStatus} • Notification failed: ${result.error}`, 'error')
          }
        } catch {
          showToast(`Status updated to ${newStatus} • Notification error`, 'error')
        }
      } else {
        showToast(`Status updated to ${newStatus}`, 'success')
      }
    },

    moveRepairToPreviousProgress: (repairId) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return
      }

      const user = currentUser()
      if (!user || !['technical_lead', 'director'].includes(user.role)) {
        showToast('Only the Lead Technician can move repair progress backwards', 'error')
        return
      }

      if (REPAIR_TERMINAL_STATUSES.includes(repair.status)) {
        showToast('Closed, cancelled, returned, or declined repairs cannot be moved backwards', 'error')
        return
      }

      if (blockIfOutsourced(repairId, 'move repair progress backwards')) return

      const previousStatus = getPreviousRepairProgressStatus(repair)
      if (!previousStatus || previousStatus === repair.status) {
        showToast('This repair is already at the first progress step', 'info')
        return
      }

      const changedAt = now()
      const note = `${user.name} moved progress back from ${repair.status.replace(/_/g, ' ')} to ${previousStatus.replace(/_/g, ' ')}`
      const updatedRepair: RepairOrder = {
        ...repair,
        status: previousStatus,
        statusHistory: [
          ...(repair.statusHistory ?? []),
          { status: previousStatus, date: changedAt, note, by: user.name },
        ],
      }

      setRepairs(prev => prev.map(r => r.id === repairId ? updatedRepair : r))
      syncRepairToPortal(updatedRepair, note)
      addAuditLog('repair_progress_back', repairId, note)
      showToast(`Repair moved back to ${previousStatus.replace(/_/g, ' ')}`, 'success')
    },

    requestProcurement: async (repairId, items, urgency, notes) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return 
      }

      const user = currentUser()
      if (!user) {
        showToast('User not authenticated', 'error')
        return
      }

      const newRequest = {
        id: uid(),
        repairId,
        repairRef: repair.ref,
        requestedBy: user.id,
        requestedByName: user.name,
        requestedDate: now(),
        urgency,
        status: 'pending' as const,
        notes,
        items: items.map((i: any) => ({
          type: i.type ?? 'part',
          productId: i.productId ?? '',
          productName: i.productName || i.name || 'Unknown item',
          description: i.description ?? '',
          qty: String(i.qty ?? 1),
          estimatedCost: String(i.estimatedCost ?? 0),
          supplier: i.supplier ?? '',
        })),
      }

      // Auto-create a draft PO (no vendor yet — admin will assign and process)
      const draftPo: PurchaseOrder = {
        id: uid(), ref: await storeCtxRef.current!.allocateDocRef('PO'), status: 'draft',
        vendorId: '', vendorName: '',
        date: now(), expectedDate: addDays(now(), 7),
        lines: [], subtotal: 0, taxTotal: 0, total: 0,
        notes: `Auto-created from repair procurement request ${newRequest.id} (${repair.ref})`,
        receiptIds: [],
        repairId, repairRef: repair.ref, procurementRequestId: newRequest.id,
      }
      // Add a line for each requested product
      const draftPoWithLines = { ...draftPo }
      const poLines: POLine[] = items
        .filter((i: any) => i.productId)
        .map((i: any) => {
          const prod = prodRef.current.find(p => p.id === i.productId)
          const catCfg = prod ? (CATEGORY_CONFIG[prod.category as CategoryId] ?? { serialRequired: false }) : { serialRequired: false }
          const unitPrice = parseFloat(i.estimatedCost || '0')
          const qty = parseInt(String(i.qty ?? 1), 10)
          const subtotal = unitPrice * qty
          return {
            id: uid(), productId: i.productId, productName: i.productName || i.name || 'Unknown',
            qty, qtyReceived: 0, unitPrice, taxRate: prod?.taxRate ?? 0,
            subtotal, requiresSerial: catCfg.serialRequired,
          }
        })
      const poTotals = calcPO(poLines)
      const finalDraftPo: PurchaseOrder = { ...draftPoWithLines, lines: poLines, ...poTotals }
      setPurchaseOrders(p => [finalDraftPo, ...p])
      sync('/api/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalDraftPo) })
      addAuditLog('create_po', finalDraftPo.ref, `Draft PO auto-created from repair procurement request for ${repair.ref}`)

      // Update repair status to awaiting parts and save the request
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'awaiting_parts',
        procurementRequests: [...(r.procurementRequests ?? []), newRequest],
      } : r))

      syncRepairToPortal({ ...repair, status: 'awaiting_parts' }, 'Awaiting parts from supplier')

      // Build a readable summary grouped by type
      const byType: Record<string, string[]> = {}
      items.forEach((i: any) => {
        const t = i.type ?? 'part'
        ;(byType[t] = byType[t] ?? []).push(i.productName || i.name)
      })
      const typeIcons: Record<string, string> = { part: '🔩', software: '💿', license: '🔑' }
      const summary = Object.entries(byType)
        .map(([t, names]) => `${typeIcons[t] ?? '📦'} ${names.join(', ')}`)
        .join(' · ')

      // Notify technical leads and inventory/procurement-facing staff in-app
      notifyUsers({
        recipients: userIdsWithRoles(users, ['technical_lead', 'inventory_officer', 'director'], user.id),
        type: 'repair',
        title: `${user.name} requested items for ${repair.ref}`,
        body: `${repair.productName} — ${summary}`,
        module: 'repair',
        path: `?id=${repair.id}`,
        icon: '📋',
        entityKey: `repair:${repair.id}:procurement`,
        excludeUserId: user.id,
      })

      addAuditLog('procurement_request', repairId, `${user.name} requested: ${summary}`)
      
      // Notify procurement team and customer
      try {
        // Notify procurement team
        const procResponse = await fetch('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'procurement',
            repairRef: repair.ref,
            technicianName: user.name,
            items,
            urgency,
            notes
          })
        })

        const procResult = await procResponse.json()

        // Notify customer about delay
        if (repair.customerPhone) {
          await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'repair',
              customerName: repair.customerName,
              customerPhone: repair.customerPhone,
              repairRef: repair.ref,
              deviceName: repair.productName,
              message: 'We are waiting for required parts to arrive for your repair. We will keep you updated on the progress.',
              options: { priority: 'normal' }
            })
          })
        }

        showToast(`Procurement request sent • Repair ${repair.ref} set to "Awaiting Parts"`, 'success')
      } catch {
        showToast(`Procurement request submitted • Repair ${repair.ref} set to "Awaiting Parts"`, 'success')
      }
    },

    appendRepairHistory: (repairId, entry) => {
      setRepairs(prev => prev.map(r => {
        if (r.id !== repairId) return r
        const existing = r.statusHistory ?? []
        // Replace any existing entry for same status+note-prefix to avoid duplicates
        const filtered = existing.filter(h => !(h.status === entry.status && h.note === entry.note))
        return { ...r, statusHistory: [...filtered, entry] }
      }))
    },

    declineQuote: async (repairId, reason) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return
      }
      const trimmedReason = String(reason ?? '').trim() || 'Declined by customer'

      const resolved = resolveDiagnosisFee(repair, systemSettings)
      const feeApplies = shouldChargeDiagnosisFee(repair) && resolved.amount > 0 && !!repair.diagnosis

      // Soft-terminal: stay on `declined` so staff can revise & re-send another
      // quote OR return the device. Diagnosis fee (if due) is stamped for collection
      // on return / invoice — we do not force `ready` here.
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'declined',
        notes: `${r.notes || ''}\n\nQuote declined: ${trimmedReason}${feeApplies ? ` (diagnosis fee KES ${resolved.amount} still due)` : ''}`.trim(),
        quote: r.quote
          ? { ...r.quote, rejectedDate: now(), rejectionReason: trimmedReason }
          : r.quote,
        ...(feeApplies ? {
          diagnosisFee: resolved.amount,
          // Keep paid if walk-in already settled; otherwise mark applicable for collection
          diagnosisFeeStatus: (r.diagnosisFeeStatus === 'paid' || r.diagnosisFeePaidAt)
            ? 'paid' as const
            : 'applicable' as const,
          diagnosisFeeBilling: r.diagnosisFeeBilling ?? resolved.billing,
          customerBillingType: r.customerBillingType ?? resolved.customerType,
        } : {}),
      } : r))

      addAuditLog(
        'decline_quote',
        repairId,
        feeApplies
          ? `Quote declined — diagnosis fee KES ${resolved.amount}${repair.diagnosisFeeStatus === 'paid' || repair.diagnosisFeePaidAt ? ' (already paid)' : ' still due'}: ${trimmedReason}`
          : `Quote declined by customer: ${trimmedReason}`,
      )

      // Notify customer
      if (repair.customerPhone) {
        try {
          const response = await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'repair',
              customerName: repair.customerName,
              customerPhone: repair.customerPhone,
              repairRef: repair.ref,
              deviceName: repair.productName,
              message: feeApplies
                ? `We understand you've declined the repair quote for ${repair.productName} (${repair.ref}). A diagnosis fee of KES ${resolved.amount.toLocaleString('en-KE')} still applies. We can send a revised quote, or arrange device return.`
                : `We understand you've declined the repair quote for ${repair.productName} (${repair.ref}). We can send a revised quote, or arrange device return pickup.`,
              options: { priority: 'normal' },
            }),
          })

          const result = await response.json()

          if (result.success) {
            showToast(
              feeApplies
                ? `Quote declined — KES ${resolved.amount.toLocaleString('en-KE')} diagnosis fee still due · customer notified`
                : `Quote declined · customer notified via ${result.channel?.toUpperCase()}`,
              'info',
            )
          } else {
            showToast('Quote declined · notification failed', 'error')
          }
        } catch {
          showToast('Quote declined · notification error', 'error')
        }
      } else {
        showToast(
          feeApplies
            ? `Quote declined — KES ${resolved.amount.toLocaleString('en-KE')} diagnosis fee still due. Revise quote or return device.`
            : 'Quote declined — revise quote or return device',
          'info',
        )
      }
    },

    waiveDiagnosisFee: (repairId, reason) => {
      const user = currentUser()
      if (!user) return
      if (!['director', 'technical_lead', 'admin_officer', 'finance_officer'].includes(normalizeClientRole(user.role))) {
        showToast('Only a manager can waive the diagnosis fee', 'error')
        return
      }
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      if (!reason.trim()) {
        showToast('Enter a reason for waiving the diagnosis fee', 'error')
        return
      }
      setRepairs(p => p.map(r => {
        if (r.id !== repairId) return r
        const nextLines = (r.quote?.lines ?? []).filter(l => !isDiagnosisFeeLine(l))
        const nextQuote = r.quote
          ? {
              ...r.quote,
              lines: nextLines,
              subtotal: nextLines.reduce((s, l) => s + l.subtotal, 0),
              tax: r.quote.tax,
              total: nextLines.reduce((s, l) => s + l.subtotal, 0) + (r.quote.tax || 0),
            }
          : r.quote
        return {
          ...r,
          diagnosisFee: 0,
          diagnosisFeeStatus: 'waived' as const,
          diagnosisFeeWaivedBy: user.name,
          diagnosisFeeWaivedReason: reason.trim(),
          quote: nextQuote,
          total: isRepairNoCharge(r)
            ? 0
            : (r.partsUsed?.reduce((a, x) => a + x.qty * x.price, 0) ?? 0) + (r.laborCost || 0),
          notes: `${r.notes || ''}\n[Diagnosis fee waived by ${user.name}] ${reason.trim()}`.trim(),
        }
      }))
      addAuditLog('waive_diagnosis_fee', repairId, `Diagnosis fee waived by ${user.name}: ${reason.trim()}`)
      showToast('Diagnosis fee waived', 'success')
    },

    markRepairNoCharge: (repairId, opts) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return
      }
      if (!canMarkRepairBillingExempt(normalizeClientRole(user.role), repair)) {
        showToast(
          isRepairBillingExempt(repair)
            ? 'This job is already marked no-charge'
            : 'Only a manager can mark a job as no-charge, and only while it is still open',
          'error',
        )
        return
      }
      const reason = normalizeBillingExemptReason(opts?.reason)
      const notes = String(opts?.notes ?? '').trim()
      if (!notes) {
        showToast('Enter notes explaining why this job is no-charge', 'error')
        return
      }
      if (reason === 'other' && notes.length < 8) {
        showToast('For “Other”, add a clearer explanation in the notes', 'error')
        return
      }
      if (blockIfOutsourced(repairId, 'mark this repair no-charge')) return

      const markedAt = now()
      const reasonLabel = BILLING_EXEMPT_REASON_LABELS[reason]
      const nextStatus: RepairStatus =
        ['awaiting_approval', 'declined', 'diagnosed'].includes(repair.status)
          ? 'approved'
          : repair.status

      const existingInv = repair.invoiceId
        ? invRef.current.find(i => i.id === repair.invoiceId)
        : undefined
      const clearInvoiceLink = !!existingInv && !['paid', 'partially_paid'].includes(String(existingInv.status))

      // Cancel any unpaid customer invoice — this job must not bill the client
      if (clearInvoiceLink && repair.invoiceId) {
        setInvoices(p => p.map(inv => {
          if (inv.id !== repair.invoiceId) return inv
          const updated = { ...inv, status: 'cancelled' as const }
          sync(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
      }

      setRepairs(p => p.map(r => {
        if (r.id !== repairId) return r
        let nextQuote = r.quote
        if (r.quote) {
          const nextLines = (r.quote.lines ?? []).filter(l => !isDiagnosisFeeLine(l))
          const sub = nextLines.reduce((s, l) => s + l.subtotal, 0)
          nextQuote = {
            ...r.quote,
            lines: nextLines,
            subtotal: sub,
            total: sub + (r.quote.tax || 0),
            approvedDate: r.quote.approvedDate || markedAt,
            approvedBy: r.quote.approvedBy || `No-charge (${reason}) — auto-approved`,
          }
        }
        return {
          ...r,
          billingExempt: true,
          billingExemptReason: reason,
          billingExemptNotes: notes,
          billingExemptBy: user.name,
          billingExemptAt: markedAt,
          diagnosisFee: 0,
          diagnosisFeeStatus: 'not_applicable' as const,
          total: 0,
          quote: nextQuote,
          quoteApprovalDeadline: undefined,
          status: nextStatus,
          ...(clearInvoiceLink ? { invoiceId: undefined, invoiceDate: undefined } : {}),
          notes: `${r.notes || ''}\n[No-charge — ${reasonLabel} by ${user.name}] ${notes}`.trim(),
          statusHistory: [
            ...(r.statusHistory ?? []),
            {
              status: nextStatus,
              date: markedAt,
              note: `Marked no-charge (${reasonLabel}): ${notes}`,
              by: user.name,
            },
          ],
        }
      }))

      addAuditLog(
        'mark_repair_no_charge',
        repairId,
        `No-charge (${reasonLabel}) by ${user.name}: ${notes}`,
      )
      showToast(
        nextStatus === 'approved' && repair.status !== 'approved'
          ? `${repair.ref} marked no-charge — quote skipped, ready to repair`
          : `${repair.ref} marked no-charge — no quote or invoice for the customer`,
        'success',
      )
    },

    markUnrepairable: async (repairId, reason) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return
      }
      if (blockIfOutsourced(repairId, 'mark this repair unrepairable')) return

      // Free up any reserved serials and cancel linked financial documents
      setSerials(p => p.map(s => s.repairId === repairId ? {
        ...s,
        status: 'available',
        repairId: undefined
      } : s))
      if (repair.saleOrderId) {
          setSaleOrders(p => p.map(so => {
            if (so.id !== repair.saleOrderId) return so
            const updated = { ...so, status: 'cancelled' as const }
            sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return updated
          }))
      }
      if (repair.invoiceId) {
        setInvoices(p => p.map(inv => inv.id === repair.invoiceId ? { ...inv, status: 'cancelled' } : inv))
      }

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'unrepairable',
        notes: r.notes + `\n\nUnrepairable: ${reason}`,
      } : r))

      addAuditLog('mark_unrepairable', repairId, `Marked unrepairable: ${reason}`)
      
      // Notify customer
      if (repair.customerPhone) {
        try {
          const response = await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'repair',
              customerName: repair.customerName,
              customerPhone: repair.customerPhone,
              repairRef: repair.ref,
              deviceName: repair.productName,
              message: `After thorough diagnosis, we regret to inform you that your device cannot be repaired due to: ${reason}\n\nYour device is ready for return. No charges apply.`,
              options: { priority: 'high' }
            })
          })

          const result = await response.json()

          if (result.success) {
            showToast(`Marked as unrepairable • Customer notified via ${result.channel?.toUpperCase()}`, 'info')
          } else {
            showToast('Marked as unrepairable • Notification failed', 'error')
          }
        } catch {
          showToast('Marked as unrepairable • Notification error', 'error')
        }
      } else {
        showToast('Marked as unrepairable', 'info')
      }
    },

    returnToCustomer: (repairId, reason) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return
      }
      if (blockIfOutsourced(repairId, 'return this device to customer')) return
      if (!returnableStatusesForPath(repair.repairPath).includes(repair.status)) {
        showToast('This repair cannot be returned at the current stage', 'error')
        return
      }
      if (!String(reason ?? '').trim()) {
        showToast('Enter a reason for returning the device', 'error')
        return
      }

      const resolved = resolveDiagnosisFee(repair, systemSettings)
      const feeAlreadyPaid = repair.diagnosisFeeStatus === 'paid' || !!repair.diagnosisFeePaidAt
      const feeStillDue =
        shouldChargeDiagnosisFee(repair) &&
        resolved.amount > 0 &&
        !!repair.diagnosis &&
        repair.diagnosisFeeStatus !== 'invoiced' &&
        repair.diagnosisFeeStatus !== 'waived' &&
        !feeAlreadyPaid

      const declineNote = isQuoteDeclinedReopenable(repair.status)
        ? ' (after quote decline)'
        : ''
      const feeNote = feeStillDue
        ? `\nDiagnosis fee still due — KES ${resolved.amount.toLocaleString('en-KE')}.`
        : feeAlreadyPaid
          ? `\nDiagnosis fee KES ${resolved.amount.toLocaleString('en-KE')} already paid.`
          : ''

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'returned',
        deliveryActualDate: now(),
        notes: `${r.notes || ''}\n\nReturned to customer${declineNote}: ${reason.trim()}${feeNote}`.trim(),
        closedDate: now(),
        ...(feeStillDue ? {
          diagnosisFee: resolved.amount,
          diagnosisFeeStatus: 'applicable' as const,
          diagnosisStopped: true,
          diagnosisFeeBilling: r.diagnosisFeeBilling ?? resolved.billing,
          customerBillingType: r.customerBillingType ?? resolved.customerType,
        } : feeAlreadyPaid ? {
          diagnosisStopped: true,
        } : {}),
        quote: r.quote && isQuoteDeclinedReopenable(r.status)
          ? { ...r.quote, rejectionReason: r.quote.rejectionReason || reason.trim() }
          : r.quote,
      } : r))

      addAuditLog(
        'return_device',
        repairId,
        `Device returned${declineNote}: ${reason.trim()}${feeStillDue ? ` · diagnosis fee KES ${resolved.amount} still due` : ''}`,
      )
      showToast(
        feeStillDue
          ? `${repair.ref} returned — diagnosis fee KES ${resolved.amount.toLocaleString('en-KE')} still due`
          : `${repair.ref} returned to customer`,
        feeStillDue ? 'info' : 'success',
      )
    },

    leaveDeviceWithDeed: (repairId, opts) => {
      const user = currentUser()
      if (!user) return { ok: false, message: 'Not signed in' }
      if (!['director', 'admin_officer', 'technical_lead'].includes(user.role)) {
        showToast('Only managers can record that a customer left a device with Deed', 'error')
        return { ok: false, message: 'Not authorized' }
      }
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return { ok: false, message: 'Repair not found' }
      }
      if (REPAIR_TERMINAL_STATUSES.includes(repair.status)) {
        showToast('This repair is already closed', 'error')
        return { ok: false, message: 'Already terminal' }
      }
      if (blockIfOutsourced(repairId, 'retain this device')) return { ok: false, message: 'Outsourced' }

      const convertToDonation = !!opts?.convertToDonation
      const convertToStock = !!opts?.convertToStock && !convertToDonation
      const extraNotes = String(opts?.notes ?? '').trim()
      const retainedAt = now()

      // Free reserved parts / cancel linked financial docs (same as unrepairable)
      setSerials(p => p.map(s => s.repairId === repairId ? {
        ...s,
        status: 'available',
        repairId: undefined,
      } : s))
      if (repair.saleOrderId) {
        setSaleOrders(p => p.map(so => {
          if (so.id !== repair.saleOrderId) return so
          const updated = { ...so, status: 'cancelled' as const }
          sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
      }
      if (repair.invoiceId) {
        setInvoices(p => p.map(inv => inv.id === repair.invoiceId ? { ...inv, status: 'cancelled' } : inv))
      }

      let buyBackId: string | undefined
      let buyBackRef: string | undefined
      let donationId: string | undefined
      let donationRef: string | undefined
      let convertMessage = ''

      if (convertToStock || convertToDonation) {
        const converted = convertRetainedDeviceIntoInventory({
          repair,
          mode: convertToDonation ? 'donation' : 'buyback',
          notes: extraNotes,
          at: retainedAt,
          byName: user.name,
        })
        if (!converted.ok) {
          convertMessage = ` Retained without convert — ${converted.message}`
        } else if (converted.mode === 'buyback') {
          buyBackId = converted.id
          buyBackRef = converted.ref
          convertMessage = ` Converted to stock via ${converted.ref}.`
        } else {
          donationId = converted.id
          donationRef = converted.ref
          convertMessage = ` Converted to donation ${converted.ref}.`
        }
      }

      const linkRef = donationRef || buyBackRef
      const noteLine = `Customer left device with Deed${extraNotes ? `: ${extraNotes}` : ''}${linkRef ? ` → ${linkRef}` : ''}`
      const retainedRepair: RepairOrder = {
        ...repair,
        status: 'retained',
        closedDate: retainedAt,
        retainedDate: retainedAt,
        retainedBy: user.name,
        retainedBuyBackId: buyBackId,
        retainedBuyBackRef: buyBackRef,
        retainedDonationId: donationId,
        retainedDonationRef: donationRef,
        notes: `${repair.notes || ''}\n\n${noteLine}`.trim(),
        statusHistory: [
          ...(repair.statusHistory ?? []),
          { status: 'retained', date: retainedAt, note: noteLine, by: user.name },
        ],
      }
      setRepairs(p => p.map(r => r.id === repairId ? retainedRepair : r))
      syncRepairToPortal(retainedRepair, noteLine)
      addAuditLog('retain_device', repairId, noteLine)
      showToast(`${repair.ref} retained by Deed.${convertMessage}`, 'success')
      return { ok: true, message: `Retained.${convertMessage}`, buyBackId, buyBackRef, donationId, donationRef }
    },

    convertRetainedRepairToDonation: (repairId, opts) => {
      const user = currentUser()
      if (!user) return { ok: false, message: 'Not signed in' }
      if (!['director', 'admin_officer', 'technical_lead', 'inventory_officer'].includes(user.role)) {
        showToast('Not authorized to convert retained repairs', 'error')
        return { ok: false, message: 'Not authorized' }
      }
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return { ok: false, message: 'Repair not found' }
      }
      if (!canConvertRetainedRepair(repair)) {
        const msg = repair.status !== 'retained'
          ? 'Only retained repairs can be converted'
          : 'This repair was already converted into stock or a donation'
        showToast(msg, 'error')
        return { ok: false, message: msg }
      }
      const at = now()
      const notes = String(opts?.notes ?? '').trim()
      const converted = convertRetainedDeviceIntoInventory({
        repair,
        mode: 'donation',
        notes,
        at,
        byName: user.name,
      })
      if (!converted.ok) {
        showToast(converted.message, 'error')
        return { ok: false, message: converted.message }
      }
      const noteLine = `Converted retained device to donation ${converted.ref}${notes ? ` — ${notes}` : ''}`
      const updated: RepairOrder = {
        ...repair,
        retainedDonationId: converted.id,
        retainedDonationRef: converted.ref,
        notes: `${repair.notes || ''}\n\n${noteLine}`.trim(),
        statusHistory: [
          ...(repair.statusHistory ?? []),
          { status: 'retained', date: at, note: noteLine, by: user.name },
        ],
      }
      setRepairs(p => p.map(r => r.id === repairId ? updated : r))
      syncRepairToPortal(updated, noteLine)
      addAuditLog('retain_to_donation', repairId, noteLine)
      showToast(`${repair.ref} → donation ${converted.ref}`, 'success')
      return { ok: true, message: noteLine, donationId: converted.id, donationRef: converted.ref }
    },

    convertRetainedRepairToBuyBack: (repairId, opts) => {
      const user = currentUser()
      if (!user) return { ok: false, message: 'Not signed in' }
      if (!['director', 'admin_officer', 'technical_lead', 'inventory_officer'].includes(user.role)) {
        showToast('Not authorized to convert retained repairs', 'error')
        return { ok: false, message: 'Not authorized' }
      }
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return { ok: false, message: 'Repair not found' }
      }
      if (!canConvertRetainedRepair(repair)) {
        const msg = repair.status !== 'retained'
          ? 'Only retained repairs can be converted'
          : 'This repair was already converted into stock or a donation'
        showToast(msg, 'error')
        return { ok: false, message: msg }
      }
      const at = now()
      const notes = String(opts?.notes ?? '').trim()
      const converted = convertRetainedDeviceIntoInventory({
        repair,
        mode: 'buyback',
        notes,
        at,
        byName: user.name,
      })
      if (!converted.ok) {
        showToast(converted.message, 'error')
        return { ok: false, message: converted.message }
      }
      const noteLine = `Converted retained device to buy-back ${converted.ref}${notes ? ` — ${notes}` : ''}`
      const updated: RepairOrder = {
        ...repair,
        retainedBuyBackId: converted.id,
        retainedBuyBackRef: converted.ref,
        notes: `${repair.notes || ''}\n\n${noteLine}`.trim(),
        statusHistory: [
          ...(repair.statusHistory ?? []),
          { status: 'retained', date: at, note: noteLine, by: user.name },
        ],
      }
      setRepairs(p => p.map(r => r.id === repairId ? updated : r))
      syncRepairToPortal(updated, noteLine)
      addAuditLog('retain_to_buyback', repairId, noteLine)
      showToast(`${repair.ref} → buy-back ${converted.ref}`, 'success')
      return { ok: true, message: noteLine, buyBackId: converted.id, buyBackRef: converted.ref }
    },

    createTradeInFromRepair: (repairId, opts) => {
      const user = currentUser()
      if (!user) return { ok: false, message: 'Not signed in' }
      if (!['director', 'admin_officer', 'technical_lead'].includes(user.role)) {
        showToast('Only managers can create a trade-in from a repair', 'error')
        return { ok: false, message: 'Not authorized' }
      }
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return { ok: false, message: 'Repair not found' }
      }
      if (!canCreateTradeInFromRepair(repair)) {
        const msg = repair.retainedBuyBackId || repair.retainedDonationId
          ? 'This repair is already linked to a buy-back or donation'
          : 'Trade-in is not available for this repair status'
        showToast(msg, 'error')
        return { ok: false, message: msg }
      }
      if (blockIfOutsourced(repairId, 'create a trade-in for this device')) {
        return { ok: false, message: 'Outsourced' }
      }

      const unitPrice = Number(opts.unitPrice)
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        showToast('Enter a valid trade-in offer amount', 'error')
        return { ok: false, message: 'Invalid unit price' }
      }

      const product = findRepairCatalogProduct(prodRef.current, repair)
      if (!product) {
        showToast('Link a catalog product on the repair first', 'error')
        return { ok: false, message: 'Missing catalog product' }
      }

      const at = now()
      const condition = opts.condition ?? buyBackConditionFromRepair(repair.deviceCondition)
      const extraNotes = String(opts.notes ?? '').trim()

      let serialId: string | undefined
      if (product.requiresSerial || repair.serialNumber?.trim()) {
        const matched = matchRepairDeviceSerial(serialRef.current, product.id, repair)
        if ('error' in matched) {
          showToast(matched.error, 'error')
          return { ok: false, message: matched.error }
        }
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
            serial: matched.serialText,
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            location: 'customer',
            status: 'sold',
            receivedDate: at,
            soldDate: at,
            barcode: buildInventoryBarcodeForProduct(product.id, matched.serialText),
          }
          setSerials(p => [...p, newSerial])
          sync('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
          serialId = newSerial.id
        }
      }
      if (product.requiresSerial && !serialId) {
        showToast('Serialized product needs a serial number', 'error')
        return { ok: false, message: 'Missing serial' }
      }

      // Release reserved parts / cancel linked docs when leaving an open job
      const alreadyTerminal = REPAIR_TERMINAL_STATUSES.includes(repair.status)
      if (!alreadyTerminal || repair.status === 'declined' || repair.status === 'unrepairable') {
        setSerials(p => p.map(s => s.repairId === repairId ? {
          ...s,
          status: 'available',
          repairId: undefined,
        } : s))
        if (repair.saleOrderId) {
          setSaleOrders(p => p.map(so => {
            if (so.id !== repair.saleOrderId) return so
            if (so.status === 'cancelled') return so
            const updated = { ...so, status: 'cancelled' as const }
            sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return updated
          }))
        }
        if (repair.invoiceId) {
          setInvoices(p => p.map(inv => inv.id === repair.invoiceId && inv.status !== 'cancelled'
            ? { ...inv, status: 'cancelled' }
            : inv))
        }
      }

      const bb: BuyBack = {
        id: uid(),
        ref: seq('BBK', 'bbk'),
        customerId: repair.customerId,
        customerName: repair.customerName,
        repairId: repair.id,
        repairRef: repair.ref,
        status: 'draft',
        date: at,
        lines: [{
          id: uid(),
          productId: product.id,
          productName: product.name,
          qty: 1,
          serialIds: serialId ? [serialId] : [],
          condition,
          unitPrice,
          notes: `Trade-in from repair ${repair.ref}`,
        }],
        total: unitPrice,
        destinationLocation: 'warehouse',
        notes: `Trade-in after evaluation from repair ${repair.ref}${extraNotes ? ` — ${extraNotes}` : ''}`,
      }
      setBuyBacks(p => [bb, ...p])

      const noteLine = `Trade-in after evaluation → draft ${bb.ref} (${fmtKes(unitPrice)}, ${condition})${extraNotes ? ` — ${extraNotes}` : ''}`
      const retainedRepair: RepairOrder = {
        ...repair,
        status: 'retained',
        closedDate: repair.closedDate || at,
        retainedDate: repair.retainedDate || at,
        retainedBy: repair.retainedBy || user.name,
        retainedBuyBackId: bb.id,
        retainedBuyBackRef: bb.ref,
        notes: `${repair.notes || ''}\n\n${noteLine}`.trim(),
        statusHistory: [
          ...(repair.statusHistory ?? []),
          { status: 'retained', date: at, note: noteLine, by: user.name },
        ],
      }
      setRepairs(p => p.map(r => r.id === repairId ? retainedRepair : r))
      syncRepairToPortal(retainedRepair, noteLine)
      addAuditLog('repair_tradein', repairId, noteLine)

      notifyUsers({
        recipients: userIdsWithRoles(users, ['director', 'finance_officer'], user.id),
        type: 'system',
        title: `Trade-in approval needed: ${bb.ref}`,
        body: `${repair.ref} — ${product.name} offered at ${fmtKes(unitPrice)}. Approve payout in Trade-in.`,
        module: 'after_sales',
        path: '?tab=tradein',
        icon: '💰',
        entityKey: `buyback:${bb.id}:from_repair`,
        excludeUserId: user.id,
      })

      showToast(`${repair.ref} → trade-in ${bb.ref} (draft). Approve & pay in Trade-in.`, 'success')
      return { ok: true, message: noteLine, buyBackId: bb.id, buyBackRef: bb.ref }
    },

    // ── POS ───────────────────────────────────────────────────────────────────
    openPOSSession: (openingCash) => {
      if (posSessionOpen && posSessionId) {
        showToast('A POS session is already open', 'error')
        return
      }
      const user = currentUser()
      const session: POSSession = {
        id: uid(),
        ref: seq('POSSESS', 'pos'),
        status: 'open',
        openedAt: new Date().toISOString(),
        openingCash: Math.max(0, Number(openingCash) || 0),
        totalSales: 0,
        totalCash: 0,
        totalMpesa: 0,
        totalCard: 0,
        orderCount: 0,
        openedBy: user?.name,
      }
      setPosSessions(p => [session, ...p])
      setPosSessionId(session.id)
      setPosSessionOpen(true)
      setPosSessionOpeningCash(session.openingCash)
      addAuditLog('open_pos_session', session.ref, `Opening cash ${fmtKes(session.openingCash)}`)
      showToast(`POS session ${session.ref} opened`)
    },
    closePOSSession: (closingCash) => {
      const user = currentUser()
      const sessionId = posSessionId
      if (!posSessionOpen || !sessionId) {
        showToast('No open POS session', 'error')
        return null
      }
      // Legacy orders used sessionId 'active' — include those while this session is open.
      const orders = posOrders.filter(o => o.sessionId === sessionId || o.sessionId === 'active')
      const totalCash = orders.filter(o => o.payment === 'cash').reduce((a, o) => a + o.total, 0)
      const totalMpesa = orders.filter(o => o.payment === 'mpesa').reduce((a, o) => a + o.total, 0)
      const totalCard = orders.filter(o => o.payment === 'card').reduce((a, o) => a + o.total, 0)
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
          controlLines.push(accountLine('6495 - Cash Over/Short', 'Cash over on session close', 0, cashDifference))
        } else {
          const short = Math.abs(cashDifference)
          controlLines.push(accountLine('6495 - Cash Over/Short', 'Cash short on session close', short, 0))
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
      if (totalCard > 0) {
        controlLines.push(accountLine('2201 - NCBA Bank', `Session card sales ${fmtKes(totalCard)}`, totalCard, 0))
        controlLines.push(accountLine('2201 - NCBA Bank', `Session card sales cleared`, 0, totalCard))
      }

      const openSession = posSessions.find(s => s.id === sessionId)
      const sessionRef = openSession?.ref || seq('POSSESS', 'pos')
      if (controlLines.length > 0) {
        const debit = controlLines.reduce((a, l) => a + l.debit, 0)
        const credit = controlLines.reduce((a, l) => a + l.credit, 0)
        const journal: JournalEntry = {
          id: uid(),
          ref: `JRN/${sessionRef}`,
          date: now(),
          source: 'pos_session',
          description: `POS session close ${sessionRef} · sales ${fmtKes(totalSales)} · cash ${fmtKes(totalCash)} · mpesa ${fmtKes(totalMpesa)} · card ${fmtKes(totalCard)} · variance ${fmtKes(cashDifference)}`,
          status: 'posted',
          bankAccountId: 'cash',
          lines: controlLines,
          totalDebit: debit,
          totalCredit: credit,
        }
        journalId = journal.id
        setJournalEntries(p => [journal, ...p])
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
        orderCount: orders.length,
        openedBy: openSession?.openedBy,
        closedBy: user?.name,
        journalId,
      }
      setPosSessions(p => {
        const exists = p.some(s => s.id === sessionId)
        return exists ? p.map(s => s.id === sessionId ? closed : s) : [closed, ...p]
      })
      setPosSessionOpen(false)
      setPosSessionId(null)
      showToast(
        cashDifference === 0
          ? `Session closed · ${orders.length} sales · ${fmtKes(totalSales)}`
          : `Session closed · cash variance ${fmtKes(cashDifference)}`,
        cashDifference === 0 ? 'success' : 'info',
      )
      return closed
    },
    createPOSOrder: async (lines, payment, customerId, customerName, pointsRedeemed = 0, applyVat = false) => {
      if (!posSessionOpen) {
        showToast('Open a POS session before charging', 'error')
        return null
      }
      const sessionId = posSessionId || 'active'
      const normalizedLines = lines.map(l => ({ ...l, subtotal: Number(l.price || 0) * Number(l.qty || 0) }))
      const sub = normalizedLines.reduce((a, l) => a + l.subtotal, 0)
      const vatRate = Number(companySettings.vatRate ?? 16)
      const tax = applyVat ? Math.round(sub * vatRate / 100) : 0
      const total = Math.max(0, sub + tax - pointsRedeemed)
      const user = currentUser()
      let pointsEarned = 0
      if (customerId) {
        pointsEarned = Math.floor(total / 100) // 1 point per 100 KES
        setContacts(prev => prev.map(c => c.id === customerId ? { ...c, loyaltyPoints: Math.max(0, (c.loyaltyPoints || 0) - pointsRedeemed) + pointsEarned } : c))
      }
      const order: POSOrder = {
        id: uid(), ref: seq('POS', 'pos'), sessionId,
        lines: normalizedLines, subtotal: sub, taxTotal: tax, total, payment,
        customerId, customerName, date: now(), createdAt: new Date().toISOString(),
        createdByUserId: user?.id, createdByName: user?.name, pointsEarned, pointsRedeemed,
      }
      // Authoritative stock deduction on the server before local UI mirror.
      const stockLines = normalizedLines.map(l => {
        const serialSource = l.serialId ? serialRef.current.find(s => s.id === l.serialId)?.location : undefined
        return {
          productId: l.productId,
          productName: l.productName,
          qty: l.qty,
          serialId: l.serialId,
          serialNumber: l.serialNumber,
          sourceLocation: (serialSource ?? 'shop') as string,
        }
      })
      try {
        const res = await fetch('/api/inventory/apply-pos-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderRef: order.ref, lines: stockLines }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null
          showToast(payload?.error || 'POS stock update failed', 'error')
          return null
        }
      } catch {
        showToast('Could not apply POS stock on server', 'error')
        return null
      }
      // Mirror server stock into local UI (moves already persisted server-side).
      normalizedLines.forEach(l => {
        const product = prodRef.current.find(x => x.id === l.productId)
        const serialSource = l.serialId ? serialRef.current.find(s => s.id === l.serialId)?.location : undefined
        const sourceLocation = (serialSource ?? 'shop') as LocationId
        if (!product?.requiresSerial) setBulkStock(prev => upsertBulkStock(prev, l.productId, sourceLocation, -l.qty))
        setProducts(p => p.map(x => x.id === l.productId ? { ...x, stockQty: Math.max(0, x.stockQty - l.qty) } : x))
        if (l.serialId) setSerials(p => p.map(s => s.id === l.serialId ? { ...s, status: 'sold', location: 'customer', soldDate: now() } : s))
      })
      const invRefAllocated = await storeCtxRef.current!.allocateDocRef('INV')
      const posInv: Invoice = {
        // Posted document, fully paid (amountPaid === total → derived Paid).
        id: uid(), ref: invRefAllocated, type: 'customer_invoice', status: 'posted',
        partnerId: customerId ?? 'walk-in', partnerName: customerName ?? 'Walk-in Customer',
        date: now(), dueDate: now(),
        lines: normalizedLines.map(l => {
          const product = prodRef.current.find(x => x.id === l.productId)
          return {
            id: uid(),
            description: `${l.productName} ×${l.qty}`,
            qty: l.qty,
            unitPrice: l.price,
            taxRate: applyVat ? vatRate : 0,
            subtotal: l.subtotal,
            productId: l.productId,
            accountCode: product ? resolveProductAccounts(product).saleAccountCode : undefined,
          }
        }),
        subtotal: sub, taxTotal: tax, total, amountPaid: total, notes: `POS ${order.ref}`,
      }
      setInvoices(p => [posInv, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(posInv) })
      setPosOrders(p => [order, ...p])
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
        bankAccountId: bankAccountIdForMethod(payment),
        lines: [
          accountLine(bankAccountLabel(bankAccountIdForMethod(payment), payment), `POS receipt ${order.ref}`, posInv.total, 0),
          ...(pointsRedeemed > 0 ? [accountLine('5200 - Sales Discounts', `Loyalty redemption ${order.ref}`, pointsRedeemed, 0)] : []),
          ...revenueLines,
          ...(tax > 0 ? [accountLine('3301 - Output VAT Payable', `VAT on ${order.ref}`, 0, tax)] : []),
        ],
        totalDebit: posInv.total + pointsRedeemed,
        totalCredit: sub + tax,
      }
      setJournalEntries(p => [posJournal, ...p])
      addAuditLog('post_pos', order.ref, `POS sale posted to journal ${posJournal.ref}`)
      showToast(`${order.ref} · ${fmtKes(order.total)} via ${payment.toUpperCase()}`)
      return order
    },

    // ── Stock Adjustments ─────────────────────────────────────────────────────
    createAdjustment: (productId, productName, type, qty, reason, notes) => {
      if (!canManageInventoryControl(currentUser())) { showToast('Only inventory-controlled roles can request adjustments', 'error'); throw new Error('Unauthorized adjustment request') }
      const prod = prodRef.current.find(x => x.id === productId)
      const resolved = prod ? resolveProductAccounts(prod) : null
      const varianceAccountCode = resolved?.adjustmentAccountCode || resolved?.costAccountCode
      const writeOffAccountCode = resolved?.writeOffAccountCode || resolved?.adjustmentAccountCode || resolved?.costAccountCode
      if (prod && type === 'add' && !resolved?.inventoryAccountCode) {
        showToast(`${prod.name} is missing an Inventory Asset account`, 'error')
        throw new Error('Missing inventory asset account')
      }
      if (prod && type === 'subtract' && !writeOffAccountCode) {
        showToast(`${prod.name} is missing a write-off or adjustment account`, 'error')
        throw new Error('Missing stock variance account')
      }
      const adj: StockAdjustment = {
        id: uid(), ref: seq('ADJ', 'adj'), productId, productName, type, qty, reason, notes,
        inventoryAccountCode: resolved?.inventoryAccountCode,
        varianceAccountCode,
        writeOffAccountCode,
        status: 'pending', requestedBy: currentUser()?.name ?? 'Unknown', date: now(),
      }
      setStockAdjustments(p => [adj, ...p])
      addAuditLog('create_adjustment', adj.ref, `Stock adjustment requested for ${productName}`)
      showToast(`${adj.ref} submitted for approval`)
      return adj
    },
    approveAdjustment: async (adjId, approved) => {
      if (!canApproveInventoryAction(currentUser())) { showToast('Only inventory approvers can approve adjustments', 'error'); return }
      const adj = adjRef.current.find(a => a.id === adjId)
      if (!adj) return
      if (approved) {
        const prod = prodRef.current.find(x => x.id === adj.productId)
        if (prod) {
          try {
            const res = await fetch('/api/inventory/apply-adjustment-stock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                adjustmentRef: adj.ref,
                productId: adj.productId,
                productName: adj.productName,
                type: adj.type,
                qty: adj.qty,
                reason: adj.reason,
                location: 'warehouse',
              }),
            })
            if (!res.ok) {
              const payload = await res.json().catch(() => null) as { error?: string } | null
              showToast(payload?.error || 'Adjustment stock update failed', 'error')
              return
            }
          } catch {
            showToast('Could not apply adjustment on server', 'error')
            return
          }
          const delta = adj.type === 'add' ? adj.qty : -adj.qty
          setBulkStock(prev => upsertBulkStock(prev, adj.productId, 'warehouse', delta))
          setProducts(p => p.map(x => x.id === adj.productId ? { ...x, stockQty: Math.max(0, x.stockQty + delta) } : x))
          const unitCost = prod.costPrice || 0
          const value = Math.abs(adj.qty * unitCost)
          if (value > 0 && prod.inventoryAccountCode) {
            const offsetCode = adj.type === 'subtract'
              ? (adj.writeOffAccountCode || adj.varianceAccountCode || prod.costAccountCode)
              : (adj.varianceAccountCode || prod.costAccountCode)
            if (offsetCode) {
              const offsetAccount = accountRef.current.find(a => a.code === offsetCode)
              const inventoryAccount = accountRef.current.find(a => a.code === prod.inventoryAccountCode)
              const journal: JournalEntry = {
                id: uid(),
                ref: seq('JE', 'je'),
                date: now(),
                source: 'adjustment',
                sourceId: adj.id,
                description: `${adj.type === 'add' ? 'Stock gain' : 'Stock write-off'} · ${adj.ref} · ${adj.productName}`,
                status: 'posted',
                lines: adj.type === 'add' ? [
                  { id: uid(), accountCode: prod.inventoryAccountCode, accountName: inventoryAccount?.name || 'Inventory Asset', debit: value, credit: 0, memo: adj.ref },
                  { id: uid(), accountCode: offsetCode, accountName: offsetAccount?.name || 'Inventory Variance', debit: 0, credit: value, memo: adj.ref },
                ] : [
                  { id: uid(), accountCode: offsetCode, accountName: offsetAccount?.name || 'Stock Write-off', debit: value, credit: 0, memo: adj.ref },
                  { id: uid(), accountCode: prod.inventoryAccountCode, accountName: inventoryAccount?.name || 'Inventory Asset', debit: 0, credit: value, memo: adj.ref },
                ],
                totalDebit: value,
                totalCredit: value,
                createdBy: currentUser()?.name || 'System',
                createdDate: now(),
              }
              setJournalEntries(p => [journal, ...p])
              addAuditLog('post_stock_adjustment', adj.ref, `Stock adjustment posted to journal ${journal.ref}`)
            }
          }
        }
      }
      setStockAdjustments(p => p.map(a => a.id === adjId ? { ...a, status: approved ? 'approved' : 'rejected', approvedBy: currentUser()?.name, approvedDate: now() } : a))
      addAuditLog('adjustment_decision', adj.ref, `Adjustment ${approved ? 'approved' : 'rejected'} for ${adj.productName}`)
      showToast(`Adjustment ${approved ? 'approved · stock updated' : 'rejected'}`)
    },

    // ── Reports ───────────────────────────────────────────────────────────────
    getStockByLocation: (productId) => {
      const prod = prodRef.current.find(x => x.id === productId)
      return calcStockByLocation(prod, serialRef.current, bulkStock, productId)
    },
    getMonthlyMovements: (productId) => {
      const moves = stockMoves.filter(m => m.productId === productId)
      const opening = 0
      const purchases = moves.filter(m => m.type === 'in').reduce((a, m) => a + m.qty, 0)
      const sales = moves.filter(m => m.type === 'out').reduce((a, m) => a + m.qty, 0)
      const usage = moves.filter(m => m.type === 'transfer').reduce((a, m) => a + m.qty, 0)
      return { opening, purchases, sales, usage, closing: opening + purchases - sales - usage }
    },

    // ── Stock Reservations ────────────────────────────────────────────────────
    reserveStock: (productId, qty, reservedFor, referenceId, referenceRef) => {
      const product = products.find(p => p.id === productId)
      if (!product) return null
      
      const reservation = {
        id: uid(),
        productId,
        productName: product.name,
        qty,
        reservedFor,
        referenceId,
        referenceRef,
        location: 'warehouse',
        reservedBy: currentUser()?.name ?? 'System',
        reservedDate: now(),
        expiresDate: addDays(now(), 7),
        status: 'reserved',
        fulfilledQty: 0,
        serialNumbers: [],
      }
      
      setStockReservations(prev => [...prev, reservation])
      addAuditLog('reserve_stock', referenceRef, `Reserved ${qty} × ${product.name}`)
      
      return reservation
    },
    
    getReservedQty: (productId) => {
      return stockReservations
        .filter(r => r.productId === productId && r.status === 'reserved')
        .reduce((sum, r) => sum + r.qty, 0)
    },
    
    getAvailableStock: (productId) => {
      const product = products.find(p => p.id === productId)
      if (!product) return 0
      
      const reservedQty = stockReservations
        .filter(r => r.productId === productId && r.status === 'reserved')
        .reduce((sum, r) => sum + r.qty, 0)
      
      return product.stockQty - reservedQty
    },
    
    fulfillReservation: (productId, referenceId, qty) => {
      const reservation = stockReservations.find(r =>
        r.productId === productId &&
        r.referenceId === referenceId &&
        r.status === 'reserved'
      )
      
      if (!reservation) return
      
      const newFulfilledQty = reservation.fulfilledQty + qty
      
      setStockReservations(prev => prev.map(r => {
        if (r.id !== reservation.id) return r
        
        return {
          ...r,
          fulfilledQty: newFulfilledQty,
          status: newFulfilledQty >= r.qty ? 'fulfilled' : 'reserved',
          fulfilledDate: newFulfilledQty >= r.qty ? now() : undefined,
        }
      }))
    },
    
    cancelReservation: (referenceId, reason) => {
      setStockReservations(prev => prev.map(r =>
        r.referenceId === referenceId
          ? { ...r, status: 'cancelled', notes: reason }
          : r
      ))
      
      addAuditLog('cancel_reservation', referenceId, `Cancelled: ${reason}`)
    },

    // ── Rider Management ────────────────────────────────────────────────────
    riders,
    deliveryJobs,
    riderWeeklyPays,
    addRider: (r) => {
      const rider: Rider = { ...r, id: uid(), createdAt: now() }
      setRiders(p => [...p, rider])
      showToast(`Rider ${rider.name} added`)
      return rider
    },
    updateRider: (id, p) => {
      setRiders(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
    },
    createDeliveryJob: (j) => {
      const user = currentUser()
      const job: DeliveryJob = {
        ...j, id: uid(), ref: seq('DJB', 'djb'), status: 'pending',
        createdByUserId: user?.id ?? '', createdByName: user?.name ?? 'System',
        createdAt: new Date().toISOString(),
      }
      setDeliveryJobs(p => [job, ...p])
      addAuditLog('create_delivery_job', job.ref, `${job.type} for ${job.customerName}`)
      showToast(`Delivery job ${job.ref} created`)
      return job
    },
    updateDeliveryJob: (id, p) => {
      setDeliveryJobs(prev => prev.map(j => j.id === id ? { ...j, ...p } : j))
    },
    deleteDeliveryJob: (id) => {
      setDeliveryJobs(prev => prev.filter(j => j.id !== id))
      showToast('Delivery job deleted')
    },
    scheduleInvoiceDelivery: (invoiceId, opts) => {
      const inv = invRef.current.find(i => i.id === invoiceId)
      if (!inv) { showToast('Invoice not found', 'error'); return null }
      if (inv.type !== 'customer_invoice') {
        showToast('Rider delivery can only be scheduled from a customer invoice', 'error')
        return null
      }
      if (inv.status === 'cancelled') {
        showToast('Cannot schedule delivery on a cancelled invoice', 'error')
        return null
      }
      const address = (opts.deliveryAddress || '').trim()
      if (!address) { showToast('Enter a delivery address', 'error'); return null }
      if (!opts.scheduledDate) { showToast('Enter a scheduled date', 'error'); return null }
      const riderFee = Number(opts.riderFee)
      if (!Number.isFinite(riderFee) || riderFee < 0) {
        showToast('Enter a valid rider fee for this trip', 'error')
        return null
      }
      const deliveryFee = Math.max(0, Number(opts.deliveryFee) || 0)
      const activeJob = deliveryJobs.find(j =>
        j.invoiceId === invoiceId && !['cancelled', 'failed'].includes(j.status)
      )
      if (activeJob) {
        showToast(`Delivery job ${activeJob.ref} already exists for this invoice`, 'info')
        return null
      }

      const contact = contacts.find(c => c.id === inv.partnerId)
      const so = inv.saleOrderId ? soRef.current.find(s => s.id === inv.saleOrderId) : undefined
      const pickup = [companySettings.name, companySettings.address, companySettings.city]
        .filter(Boolean).join(', ') || 'Deed Technologies'
      const phone = contact?.phone || contact?.mobile || ''
      const addCharge = opts.addChargeToInvoice !== false && deliveryFee > 0

      const job = storeCtxRef.current!.createDeliveryJob({
        type: 'sales_delivery',
        invoiceId: inv.id,
        invoiceRef: inv.ref,
        saleOrderId: so?.id || inv.saleOrderId,
        saleOrderRef: so?.ref,
        customerName: inv.partnerName,
        customerPhone: phone,
        pickupAddress: pickup,
        deliveryAddress: address,
        scheduledDate: opts.scheduledDate,
        riderFee,
        deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
        billedTo: deliveryFee > 0 ? 'customer' : 'company',
        notes: opts.notes?.trim()
          || `Invoice ${inv.ref}${so ? ` · ${so.ref}` : ''}${deliveryFee > 0 ? ` · customer delivery charge ${deliveryFee}` : ''}`,
      })

      if (opts.riderId) {
        storeCtxRef.current!.assignRiderToJob(job.id, opts.riderId, riderFee)
      }

      if (addCharge) {
        const vatRate = Number(companySettings.vatRate) || 0
        const chargeLine = buildDeliveryChargeInvoiceLine({
          id: uid(),
          amount: deliveryFee,
          taxRate: vatRate,
        })
        const { lines, subtotal, taxTotal, total } = appendDeliveryChargeToInvoice(inv, chargeLine)
        const deltaTax = Math.round(deliveryFee * vatRate / 100)
        const deltaTotal = deliveryFee + deltaTax

        // Always write the delivery line onto the invoice (including posted docs).
        setInvoices(prev => {
          const next = prev.map(i => i.id !== inv.id ? i : {
            ...i,
            lines,
            subtotal,
            taxTotal,
            total,
            deliveryAddress: address,
            deliveryJobId: job.id,
          })
          const updated = next.find(i => i.id === inv.id)
          if (updated) {
            invRef.current = next
            sync(`/api/invoices/${inv.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updated),
            })
          }
          return next
        })

        // Keep GL in sync for already-posted invoices (original JRN/ref stays; add DEL adj).
        if (inv.status === 'posted' && deltaTotal > 0) {
          const chartAccounts = accountRef.current.map(a => ({ code: a.code, name: a.name }))
          const saleLabel = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, chartAccounts)
          const adjLines = [
            accountLine('1800 - Accounts Receivable', `AR delivery: ${inv.partnerName}`, deltaTotal, 0),
            accountLine(saleLabel, `Delivery charge: ${inv.ref}`, 0, deliveryFee),
            ...(deltaTax > 0
              ? [accountLine('3301 - Output VAT Payable', `VAT delivery on ${inv.ref}`, 0, deltaTax)]
              : []),
          ]
          const adj: JournalEntry = {
            id: uid(),
            ref: `JRN/DEL/${inv.ref}`,
            date: now(),
            source: 'invoice',
            description: `Delivery charge on ${inv.ref} — ${inv.partnerName}`,
            status: 'posted',
            invoiceId: inv.id,
            lines: adjLines,
            totalDebit: deltaTotal,
            totalCredit: deltaTotal,
          }
          setJournalEntries(p => (p.some(j => j.ref === adj.ref) ? p : [adj, ...p]))
          addAuditLog('post_invoice', inv.ref, `Delivery charge ${deltaTotal} posted to journal ${adj.ref}`)
        }
      } else {
        storeCtxRef.current!.updateInvoice(inv.id, {
          deliveryAddress: address,
          deliveryJobId: job.id,
        })
      }

      addAuditLog('schedule_invoice_delivery', inv.ref, `Created ${job.ref} (rider fee ${riderFee}${deliveryFee > 0 ? `, customer charge ${deliveryFee}` : ''})`)
      return job
    },
    assignRiderToJob: (jobId, riderId, riderFee) => {
      const rider = riders.find(r => r.id === riderId)
      if (!rider) { showToast('Rider not found', 'error'); return }
      setDeliveryJobs(prev => prev.map(j => {
        if (j.id !== jobId) return j
        const fee = resolveAssignedRiderFee({
          existingFee: j.riderFee,
          overrideFee: riderFee,
          riderDefaultRate: rider.ratePerDelivery,
        })
        return {
          ...j,
          riderId,
          riderName: rider.name,
          riderFee: fee,
          status: 'assigned',
          assignedAt: new Date().toISOString(),
        }
      }))
      showToast(`${rider.name} assigned`)
    },
    advanceJobStatus: (jobId, newStatus, failureReason) => {
      // Read job synchronously before state updates so we can trigger side effects
      const job = deliveryJobs.find(j => j.id === jobId)

      setDeliveryJobs(prev => prev.map(j => {
        if (j.id !== jobId) return j
        const updates: Partial<DeliveryJob> = { status: newStatus }
        if (newStatus === 'in_transit') updates.pickedUpAt = now()
        if (newStatus === 'delivered')  updates.deliveredAt = now()
        if (newStatus === 'failed' && failureReason) updates.failureReason = failureReason
        return { ...j, ...updates }
      }))

      // When a repair drop-off job completes, mark the linked repair as delivered
      if (newStatus === 'delivered' && job?.type === 'repair_dropoff' && job.repairOrderId) {
        const repair = repairs.find(r => r.id === job.repairOrderId)
        setRepairs(prev => prev.map(r => r.id === job.repairOrderId ? {
          ...r,
          status: 'delivered' as RepairStatus,
          deliveryActualDate: now(),
          deliveryRecipient: r.contactPersonName || r.customerName,
          deliveryRecipientPhone: r.contactPersonPhone || r.customerPhone,
        } : r))
        if (repair) {
          syncRepairToPortal(
            { ...repair, status: 'delivered' },
            `Device delivered by rider ${job.riderName || 'rider'}`
          )
        }
        addAuditLog('deliver_repair', job.repairOrderId, `Delivered by rider ${job.riderName || 'rider'} via job ${job.ref}`)
        showToast(`${job.repairOrderRef} marked as delivered`)
      }

      addAuditLog('update_delivery_job', jobId, `Status → ${newStatus}`)
    },
    generateWeeklyPay: (riderId, weekStart) => {
      const rider = riders.find(r => r.id === riderId)
      if (!rider) return null
      // weekStart is a Monday (YYYY-MM-DD); compute Sunday
      const start = new Date(weekStart)
      const end   = new Date(start); end.setDate(end.getDate() + 6)
      const weekEnd = end.toISOString().slice(0, 10)
      const weekJobs = deliveryJobs.filter(j =>
        j.riderId === riderId &&
        j.status === 'delivered' &&
        j.deliveredAt &&
        j.deliveredAt.slice(0, 10) >= weekStart &&
        j.deliveredAt.slice(0, 10) <= weekEnd
      )
      if (weekJobs.length === 0) { showToast('No delivered jobs for this rider in that week', 'info'); return null }
      // Check for duplicate
      const existing = riderWeeklyPays.find(p => p.riderId === riderId && p.weekStart === weekStart)
      if (existing) { showToast('Weekly pay already generated for this period', 'info'); return null }
      const total = weekJobs.reduce((s, j) => s + j.riderFee, 0)
      const pay: RiderWeeklyPay = {
        id: uid(), ref: seq('RWP', 'rwp'), riderId, riderName: rider.name,
        weekStart, weekEnd, jobIds: weekJobs.map(j => j.id),
        deliveryCount: weekJobs.length, ratePerDelivery: rider.ratePerDelivery,
        totalAmount: total, status: 'pending', notes: '', createdAt: new Date().toISOString(),
      }
      setRiderWeeklyPays(p => [pay, ...p])
      showToast(`Pay of ${total.toLocaleString('en-KE', { style: 'currency', currency: 'KES' })} generated for ${rider.name}`)
      return pay
    },
    markWeeklyPayPaid: (id) => {
      const user = currentUser()
      const pay = riderWeeklyPays.find(p => p.id === id)
      if (!pay) return

      // Create accounting vendor_bill for this rider payment
      const billRef = seq('BILL', 'inv')
      const bill: Invoice = {
        id: uid(), ref: billRef, type: 'vendor_bill', status: 'posted',
        partnerId: pay.riderId, partnerName: pay.riderName,
        date: now(), dueDate: now(),
        lines: [{
          id: uid(),
          description: `Rider delivery fees — week of ${pay.weekStart} (${pay.deliveryCount} deliveries × KES ${pay.ratePerDelivery.toLocaleString()})`,
          qty: pay.deliveryCount,
          unitPrice: pay.ratePerDelivery,
          taxRate: 0,
          subtotal: pay.totalAmount,
        }],
        subtotal: pay.totalAmount, taxTotal: 0, total: pay.totalAmount,
        amountPaid: 0,
        notes: `Auto-generated from weekly pay ${pay.ref} · Confirmed by ${user?.name ?? 'staff'}`,
      }
      setInvoices(p => [bill, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bill) })
      addAuditLog('create_bill', bill.ref, `Rider bill ${pay.ref} confirmed — vendor bill ${bill.ref} created`)

      setRiderWeeklyPays(prev => prev.map(p =>
        p.id === id
          ? { ...p, status: 'paid', paidDate: now(), paidByUserId: user?.id, paidByName: user?.name, invoiceId: bill.id, invoiceRef: bill.ref }
          : p
      ))
      showToast(`Bill ${bill.ref} raised in accounting — mark paid when settled`)
    },

    // ── Delivery & Fulfillment ───────────────────────────────────────────────
    createDeliveryFromSO: async (salesOrderId, forcedRef) => {
      const so = soRef.current.find(s => s.id === salesOrderId) ?? saleOrders.find(s => s.id === salesOrderId)
      if (!so) {
        showToast('Sales order not found', 'error')
        return null
      }
      if (so.status !== 'sale') {
        showToast('Only a confirmed Sales Order can create a delivery', 'error')
        return null
      }
      const open = delRef.current.filter(d => d.saleOrderId === so.id && isOpenDeliveryStatus(d.status))
      if (open.length > 0) {
        showToast(`${so.ref} already has open delivery ${open[0].ref}`, 'info')
        return open[0]
      }
      const remaining = remainingUndeliveredByProduct(so.lines)
      const lines = (so.lines ?? [])
        .filter(line => (line as any).lineType !== 'section' && remaining[line.productId] > 0)
        .map(line => {
          const prod = prodRef.current.find(p => p.id === line.productId)
          const qty = remaining[line.productId]
          const selectedSource = (line as SaleOrderLine & { sourceLocation?: LocationId }).sourceLocation
          let sourceLocation: LocationId | undefined
          if (prod?.unit === 'service') {
            sourceLocation = undefined
          } else if (selectedSource) {
            sourceLocation = selectedSource
          } else if (prod && isSerialTracking(inferTrackingMethod(prod))) {
            const shopAvailable = serialRef.current.filter(s => s.productId === line.productId && s.status === 'available' && s.location === 'shop').length
            sourceLocation = shopAvailable >= qty ? 'shop' : 'warehouse'
          } else {
            sourceLocation = resolveBulkDeliverySourceLocation({
              product: prod,
              productId: line.productId,
              qty,
              preferred: 'warehouse',
              serials: serialRef.current,
              bulkStock,
              reservations: stockReservations,
              excludeReferenceId: so.id,
            }).location
          }
          return {
            productId: line.productId,
            productName: line.productName,
            qty,
            qtyDone: 0,
            serialIds: [] as string[],
            sourceLocation,
          }
        })
      if (lines.length === 0) {
        showToast(`${so.ref} is fully delivered — no new delivery needed`, 'info')
        return null
      }

      const delivery: Delivery = {
        id: uid(),
        ref: forcedRef ?? await storeCtxRef.current!.allocateDocRef('DN'),
        saleOrderId: so.id,
        saleOrderRef: so.ref,
        customerId: so.customerId,
        customerName: so.customerName,
        date: now(),
        status: 'ready',
        warrantyCreated: false,
        lines,
      }
      
      setDeliveries(prev => [delivery, ...prev])
      sync('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(delivery) })
      addAuditLog('create_delivery', delivery.ref, `Created from ${so.ref}`)
      showToast(`Delivery note ${delivery.ref} created`)
      
      return delivery
    },
    
    confirmDeliveryWithStockDeduction: async (deliveryId) => {
      const delivery = deliveries.find(d => d.id === deliveryId)
      if (!delivery) {
        showToast('Delivery not found', 'error')
        return
      }
      
      const user = currentUser()
      if (!user) return
      
      const hasIssues = delivery.lines.some(line => {
        const product = products.find(p => p.id === line.productId)
        if (product && isSerialTracking(inferTrackingMethod(product)) && line.serialIds.length !== line.qty) {
          showToast(`${line.productName} requires ${line.qty} serial numbers`, 'error')
          return true
        }
        return false
      })
      
      if (hasIssues) return
      
      const newWarranties: Warranty[] = []

      delivery.lines.forEach(line => {
        const product = products.find(p => p.id === line.productId)
        if (!product) return

        setProducts(prev => prev.map(p =>
          p.id === line.productId ? { ...p, stockQty: Math.max(0, p.stockQty - line.qty) } : p
        ))
        
        if (product.requiresSerial && line.serialIds.length > 0) {
          setSerials(prev => prev.map(s =>
            line.serialIds.includes(s.id) ? { ...s, status: 'sold', location: 'customer', soldDate: now() } : s
          ))

          if (product.warrantyMonths > 0) {
            line.serialIds.forEach(serialId => {
              const serial = serials.find(s => s.id === serialId)
              if (serial) {
                newWarranties.push({
                  id: uid(), ref: seq('WAR', 'war'),
                  customerId: delivery.customerId, customerName: delivery.customerName,
                  productId: line.productId, productName: line.productName,
                  serialId: serial.id, serialNumber: serial.serial,
                  deliveryId: delivery.id, saleOrderRef: delivery.saleOrderRef,
                  startDate: now(), endDate: addMonths(now(), product.warrantyMonths),
                  status: 'active', months: product.warrantyMonths,
                })
              }
            })
          }
        }
        
        const srcLoc = (line.sourceLocation as LocationId | undefined) ?? 'warehouse'
        if (!product.requiresSerial) {
          setBulkStock(prev => upsertBulkStock(prev, line.productId, srcLoc, -line.qty))
        }

        setStockReservations(prev => prev.map(r => 
          r.productId === line.productId && r.referenceId === delivery.saleOrderId && r.status === 'reserved'
            ? { ...r, status: 'fulfilled', fulfilledQty: line.qty } : r
        ))
        
        addMove(
          line.productId, line.productName, line.qty, 'out',
          `Delivery ${delivery.ref}`, delivery.ref, srcLoc, 'customer',
          line.serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial || '').filter(Boolean)
        )
      })

      if (newWarranties.length > 0) {
        setWarranties(prev => [...prev, ...newWarranties])
      }

      // Update delivery
      setDeliveries(prev => {
        const next = prev.map(d =>
          d.id === deliveryId
            ? { ...d, status: 'done' as const, warrantyCreated: newWarranties.length > 0 }
            : d
        )
        return next
      })

      // Track delivered quantities on the SO lines; the order stays a
      // Sales Order (delivery progress is not a sale status).
      setSaleOrders(prev => prev.map(so => {
        if (so.id !== delivery.saleOrderId) return so
        const doneByProduct: Record<string, number> = {}
        delivery.lines.forEach(l => { doneByProduct[l.productId] = (doneByProduct[l.productId] ?? 0) + l.qty })
        const lines = so.lines.map((l: any) => doneByProduct[l.productId]
          ? { ...l, qtyDelivered: Math.min(Number(l.qty) || 0, (Number(l.qtyDelivered) || 0) + doneByProduct[l.productId]) }
          : l)
        return { ...so, lines }
      }))

      addAuditLog('confirm_delivery', delivery.ref, `Delivered by ${user.name} • Stock deducted`)
      showToast(`${delivery.ref} confirmed • Stock deducted${newWarranties.length > 0 ? ` • ${newWarranties.length} warranties activated` : ''}`, 'success')

      // Auto-create invoice logic
      const so = soRef.current.find(s => s.id === delivery.saleOrderId)
      let hasExistingInvoice = false
      if (so) {
        const existing = invRef.current.find(i => i.notes?.includes(delivery.ref))
        hasExistingInvoice = !!existing
        if (!existing) {
          const soLineMap: Record<string, { unitPrice: number; subtotal: number }> = {}
          so.lines.forEach(l => { soLineMap[l.productId] = { unitPrice: l.unitPrice, subtotal: l.subtotal } })

          const invoice: Invoice = {
            id: uid(), ref: await storeCtxRef.current!.allocateDocRef('INV'), type: 'customer_invoice', status: 'posted',
            partnerId: delivery.customerId, partnerName: delivery.customerName,
            date: now(), dueDate: addDays(now(), 30),
            lines: delivery.lines.map(l => ({
              id: uid(), description: l.productName, qty: l.qty,
              unitPrice: soLineMap[l.productId]?.unitPrice ?? 0, taxRate: 16,
              subtotal: soLineMap[l.productId]?.subtotal ?? 0,
            })),
            subtotal: so.subtotal, taxTotal: so.taxTotal, total: so.total,
            amountPaid: 0, notes: `Invoice for ${so.ref} via ${delivery.ref}`,
          }
          setInvoices(prev => [invoice, ...prev])
          postInvoiceJournalOnce(invoice)
          setSaleOrders(prev => {
            const next = prev.map(s => {
              if (s.id !== so.id) return s
              const invoicedByProduct: Record<string, number> = {}
              delivery.lines.forEach(l => { invoicedByProduct[l.productId] = (invoicedByProduct[l.productId] ?? 0) + l.qty })
              const lines = s.lines.map((l: any) => invoicedByProduct[l.productId]
                ? { ...l, qtyInvoiced: (Number(l.qtyInvoiced) || 0) + invoicedByProduct[l.productId] }
                : l)
              return { ...s, lines, invoiceId: invoice.id }
            })
            return next
          })
          addAuditLog('auto_invoice', invoice.ref, `Auto-generated from ${delivery.ref}`)
          showToast(`Invoice ${invoice.ref} generated`, 'success')
        }
      }
      
      sync(`/api/deliveries/${deliveryId}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoInvoice: !!so && !hasExistingInvoice }) })
    },

    createInvoiceFromDelivery: async (deliveryId) => {
      const delivery = deliveries.find(d => d.id === deliveryId)
      if (!delivery) return null

      const so = saleOrders.find(s => s.id === delivery.saleOrderId)
      if (!so) return null

      // Check if invoice already exists
      const existing = invoices.find(i => i.notes?.includes(delivery.ref))
      if (existing) {
        showToast('Invoice already created for this delivery', 'info')
        return existing
      }

      if (Number(so.total ?? 0) < 1) {
        showToast('Invoice total must be at least KES 1 — invoices below KES 1 cannot be created', 'error')
        return null
      }

      // Build lines from SO lines, matching by productId in insertion order to handle duplicates
      const soLinesPool = [...so.lines]
      const vatRate = companySettings.vatRate

      const invoice: Invoice = {
        id: uid(),
        ref: await storeCtxRef.current!.allocateDocRef('INV'),
        type: 'customer_invoice',
        status: 'posted',
        partnerId: delivery.customerId,
        partnerName: delivery.customerName,
        date: now(),
        dueDate: addDays(now(), 30),
        lines: delivery.lines.map(line => {
          const idx = soLinesPool.findIndex(l => l.productId === line.productId)
          const soLine = idx >= 0 ? soLinesPool.splice(idx, 1)[0] : null
          return {
            id: uid(),
            description: line.productName,
            qty: line.qty,
            unitPrice: soLine?.unitPrice ?? 0,
            taxRate: vatRate,
            subtotal: (soLine?.unitPrice ?? 0) * line.qty,
          }
        }),
        subtotal: so.subtotal,
        taxTotal: so.taxTotal,
        total: so.total,
        amountPaid: 0,
        notes: `Invoice for ${so.ref} via ${delivery.ref}`,
      }

      setInvoices(prev => [invoice, ...prev])
      postInvoiceJournalOnce(invoice)
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })

      setSaleOrders(prev => {
        const next = prev.map(s => {
          if (s.id !== so.id) return s
          const invoicedByProduct: Record<string, number> = {}
          delivery.lines.forEach(l => { invoicedByProduct[l.productId] = (invoicedByProduct[l.productId] ?? 0) + l.qty })
          const lines = s.lines.map((l: any) => invoicedByProduct[l.productId]
            ? { ...l, qtyInvoiced: (Number(l.qtyInvoiced) || 0) + invoicedByProduct[l.productId] }
            : l)
          return { ...s, lines, invoiceId: invoice.id }
        })
        const updatedSo = next.find(s => s.id === so.id)
        if (updatedSo) sync(`/api/sale-orders/${so.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedSo) })
        return next
      })

      addAuditLog('auto_invoice', invoice.ref, `Auto-generated from ${delivery.ref}`)
      showToast(`Invoice ${invoice.ref} generated`, 'success')

      return invoice
    },
    
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
      addAuditLog('approval_request', request.ref, `${type} approval by ${user.name}`)
      showToast('Approval request created', 'info')
      
      return request
    },

    checkCreditLimit: (customerId, orderTotal) => {
      const customer = companies.find(c => c.id === customerId)
      if (!customer) return { ok: true }
      const availableCredits = customerCreditsRef.current
        .filter(c => c.customerId === customerId && ['available', 'partially_used'].includes(c.status))
        .reduce((sum, c) => sum + Math.max(0, c.balance), 0)

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

    getCustomerCreditStatus: (customerId, newOrderTotal = 0) => {
      const contact = contacts.find(c => c.id === customerId)
      const today = now()

      const unpaidInvoices = invoices.filter(inv =>
        inv.partnerId === customerId &&
        inv.type === 'customer_invoice' &&
        isOpenInvoice(inv)
      )

      const grossOutstandingBalance = unpaidInvoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.amountPaid), 0)
      const availableCredits = customerCreditsRef.current
        .filter(c => c.customerId === customerId && ['available', 'partially_used'].includes(c.status))
        .reduce((sum, c) => sum + Math.max(0, c.balance), 0)
      const outstandingBalance = Math.max(0, grossOutstandingBalance - availableCredits)

      const overdueInvoices = unpaidInvoices.filter(inv => inv.dueDate < today)
      const overdueBalance = Math.max(0, overdueInvoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.amountPaid), 0) - availableCredits)
      const overdueCount = overdueInvoices.length

      const isLocked = overdueBalance > 0

      const creditLimit = contact?.creditLimit ?? 0
      const creditAvailable = creditLimit > 0 ? Math.max(0, creditLimit - outstandingBalance) : -1
      const creditLimitExceeded = creditLimit > 0 && (outstandingBalance + newOrderTotal) > creditLimit

      let message = ''
      if (isLocked) {
        message = `Account locked — ${overdueCount} overdue invoice${overdueCount > 1 ? 's' : ''} totalling ${fmtKes(overdueBalance)}. Clear outstanding bills to unlock.`
      } else if (creditLimitExceeded) {
        message = `Credit limit of ${fmtKes(creditLimit)} exceeded. Available: ${fmtKes(creditAvailable)}. Outstanding after credits: ${fmtKes(outstandingBalance)}.`
      }

      return { ok: !isLocked && !creditLimitExceeded, isLocked, creditLimitExceeded, outstandingBalance, overdueBalance, overdueCount, creditLimit, creditAvailable, message }
    },
    
    approveRequest: (requestId, decision, comments) => {
      const user = currentUser()
      if (!user) return
      const request = approvalRequests.find(r => r.id === requestId)
      if (!request) return
      let updatedRequest: ApprovalRequest
      try {
        updatedRequest = processApproval(request, user.id, user.name, decision, comments)
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
        addAuditLog(`approval_${decision}`, request.ref, `${decision} by ${user.name}`)
        showToast(`Request ${decision}`, decision === 'approved' ? 'success' : 'error')
      }
    },
    
    getPendingApprovalsForUser: () => {
      const user = currentUser()
      if (!user) return []
      return getPendingApprovals(approvalRequests, user.id)
    },

    // ── Returns / RMA ─────────────────────────────────────────────────────────
    returnOrders, refundPayments,

    createReturnOrder: (saleOrderId, saleOrderRef, customerId, customerName, reason, lines) => {
      for (const line of lines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid return product') }
        if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid return quantity') }
        if (product.requiresSerial && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} returned serial number(s) for ${product.name}`, 'error')
          throw new Error('Missing return serials')
        }
      }
      const order: ReturnOrder = {
        id: uid(), ref: seq('RMA', 'rma'),
        saleOrderId, saleOrderRef, customerId, customerName,
        status: 'requested', requestDate: now(), reason,
        lines: lines.map(l => ({ ...l, id: uid() })),
      }
      setReturnOrders(p => [order, ...p])
      showToast(`Return ${order.ref} submitted`)
      return order
    },

    approveReturn: (id) => {
      const user = currentUser(); if (!user) return
      setReturnOrders(p => p.map(r => r.id === id
        ? { ...r, status: 'approved', approvedByName: user.name, approvedDate: now() }
        : r
      ))
      showToast('Return approved — customer may send back the item(s)')
    },

    receiveReturn: (id) => {
      const ro = returnOrders.find(r => r.id === id)
      if (!ro) return
      if (ro.status !== 'approved') { showToast('Approve the return before receiving items', 'error'); return }
      for (const line of ro.lines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName}`, 'error'); return }
        if (product.requiresSerial && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} returned serial number(s) for ${line.productName}`, 'error'); return
        }
        for (const sid of line.serialIds) {
          if (!serialRef.current.find(s => s.id === sid)) {
            showToast(`Serial missing for ${line.productName} — re-select returned serials`, 'error'); return
          }
        }
      }
      setReturnOrders(p => p.map(r => r.id === id ? { ...r, status: 'received', receivedDate: now() } : r))
      ro.lines.forEach(line => {
        line.serialIds.forEach(sid => {
          setSerials(p => p.map(s => s.id === sid
            ? { ...s, status: 'returned', location: 'warehouse' as LocationId }
            : s
          ))
        })
        if (line.serialIds.length === 0) {
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
          setBulkStock(prev => upsertBulkStock(prev, line.productId, 'warehouse', line.qty))
        } else {
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
        }
      })
      addAuditLog('rma_receive', ro.ref, `Received return ${ro.ref} for ${ro.customerName}`)
      showToast('Return received — items back in warehouse')
    },

    processReturn: async (id, resolution, refundAmount, processNotes, refundPaymentMethod) => {
      const user = currentUser(); if (!user) return
      const rma = returnOrders.find(r => r.id === id); if (!rma) return

      // Resolution 'credit_note' previously showed a "Credit note issued" toast without
      // creating anything — no CustomerCredit, journal or audit entry. Wire it up using
      // the same mechanism cancelInvoice() uses for a cancelled paid invoice.
      let creditNoteRef: string | null = null
      if (resolution === 'credit_note' && refundAmount && refundAmount > 0) {
        // Partial invoicing means a sale order can have several customer
        // invoices (often one posted plus draft rows for not-yet-invoiced
        // lines) — only posted invoices are real credit-note candidates.
        // Guessing among multiple POSTED invoices is still a
        // financial-correctness risk, so that case still requires exactly
        // one match rather than picking arbitrarily.
        const candidateInvoices = invRef.current.filter(i =>
          i.saleOrderId === rma.saleOrderId && i.type === 'customer_invoice' && invoiceDocState(i.status) === 'posted',
        )
        if (candidateInvoices.length === 0) {
          showToast(`No posted invoice found for sale order ${rma.saleOrderRef} — cannot issue a credit note`, 'error')
          return
        }
        if (candidateInvoices.length > 1) {
          showToast(`${rma.saleOrderRef} has ${candidateInvoices.length} posted invoices — issue this credit note manually from Finance so the right one is credited`, 'error')
          return
        }
        const sourceInvoice = candidateInvoices[0]
        const ref = await storeCtxRef.current!.allocateDocRef('CN')
        const credit: CustomerCredit = {
          id: uid(), ref,
          customerId: rma.customerId, customerName: rma.customerName,
          sourceInvoiceId: sourceInvoice.id, sourceInvoiceRef: sourceInvoice.ref,
          amount: refundAmount, balance: refundAmount, status: 'available',
          createdAt: now(), createdBy: user.name,
          notes: `Credit note issued from return ${rma.ref}`,
          applications: [],
        }
        setCustomerCredits(prev => [credit, ...prev])
        setJournalEntries(prev => [buildCustomerCreditJournal(sourceInvoice, ref, refundAmount), ...prev])
        addAuditLog('rma_credit_note', rma.ref, `Credit note ${ref} issued for ${fmtKes(refundAmount)} against return ${rma.ref}`)
        creditNoteRef = ref
      }

      // Only reached once any credit note (if requested) actually succeeded —
      // a return must never show as "processed" while its resolution failed.
      setReturnOrders(p => p.map(r => r.id === id
        ? { ...r, status: 'processed', resolution, refundAmount, notes: processNotes, processedDate: now(), processedByName: user.name }
        : r
      ))

      if (resolution === 'refund' && refundAmount && refundAmount > 0) {
        const method = refundPaymentMethod ?? 'cash'
        const refundBankAccountId = bankAccountIdForMethod(method)
        const creditAccount = bankAccountLabel(refundBankAccountId, method)
        const journal: JournalEntry = {
          id: uid(),
          ref: seq('JRN/RFD', 'jrn_rfd'),
          date: now(),
          source: 'refund',
          description: `Customer refund — ${rma.ref} (${rma.customerName})`,
          status: 'posted',
          rmaId: id,
          bankAccountId: refundBankAccountId,
          lines: [
            { id: uid(), account: '5099 — Sales Returns & Refunds', description: `Refund for ${rma.ref}`, debit: refundAmount, credit: 0 },
            { id: uid(), account: creditAccount, description: `Refund paid via ${method}`, debit: 0, credit: refundAmount },
          ],
          totalDebit: refundAmount,
          totalCredit: refundAmount,
        }
        setJournalEntries(p => [journal, ...p])

        const payment: RefundPayment = {
          id: uid(),
          ref: seq('RFD', 'rfd'),
          rmaId: id,
          rmaRef: rma.ref,
          customerName: rma.customerName,
          amount: refundAmount,
          paymentMethod: method,
          bankAccountId: refundBankAccountId,
          paymentDate: now(),
          notes: processNotes,
          journalEntryId: journal.id,
          createdBy: user.id,
          createdDate: now(),
        }
        setRefundPayments(p => [payment, ...p])
      }

      const label = resolution === 'refund' ? 'Refund recorded'
        : resolution === 'replacement' ? 'Replacement issued'
        : resolution === 'credit_note' ? `Credit note ${creditNoteRef} issued` : 'Repair initiated'
      showToast(`Return processed — ${label}`)
    },

    rejectReturn: (id, reason) => {
      setReturnOrders(p => p.map(r => r.id === id ? { ...r, status: 'rejected', notes: reason } : r))
      showToast('Return rejected')
    },

    // ── Buy-backs ─────────────────────────────────────────────────────────────
    buyBacks,

    registerCustomerReturnSerial: (productId, serialText, opts) => {
      const product = prodRef.current.find(p => p.id === productId)
      if (!product) { showToast('Product not found', 'error'); return null }
      const serial = String(serialText ?? '').trim()
      if (!serial) { showToast('Enter a serial number', 'error'); return null }
      const key = serial.toLowerCase()
      const existing = serialRef.current.find(s => s.productId === productId && s.serial.toLowerCase() === key)
      if (existing) {
        if (existing.status === 'sold' || existing.location === 'customer') {
          showToast(`Serial ${existing.serial} is already on file — select it from sold stock`, 'info')
          return existing
        }
        showToast(`Serial ${existing.serial} already exists (${existing.status})`, 'error')
        return null
      }
      const newSerial: SerialNumber = {
        id: uid(),
        serial,
        productId,
        productName: product.name,
        sku: product.sku,
        location: 'customer',
        status: 'sold',
        saleOrderId: opts?.saleOrderId,
        receivedDate: now(),
        soldDate: now(),
        barcode: buildInventoryBarcodeForProduct(productId, serial),
      }
      setSerials(p => [...p, newSerial])
      sync('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
      addAuditLog(
        'serial_return_intake',
        newSerial.serial,
        `Registered return serial for ${product.name} via ${opts?.source ?? 'trade-in'}`,
      )
      showToast(`Serial ${serial} registered for return`, 'success')
      return newSerial
    },

    createBuyBack: (customerId, customerName, lines, destination, notes, originalSOId, originalSORef) => {
      for (const line of lines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid buy-back product') }
        if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid buy-back quantity') }
        if (product.requiresSerial && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} serial number(s) for ${product.name}`, 'error')
          throw new Error('Missing buy-back serials')
        }
      }
      const bbLines: BuyBackLine[] = lines.map(l => ({ ...l, id: uid() }))
      const total = bbLines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
      const bb: BuyBack = {
        id: uid(), ref: seq('BBK', 'bbk'),
        customerId, customerName, originalSOId, originalSORef,
        status: 'draft', date: now(),
        lines: bbLines, total, destinationLocation: destination, notes,
      }
      setBuyBacks(p => [bb, ...p])
      showToast(`Buy-back ${bb.ref} created`)
      return bb
    },

    approveBuyBack: (id) => {
      const user = currentUser(); if (!user) return
      if (!['director', 'finance_officer'].includes(user.role)) { showToast('Only Director or Finance can approve buy-backs', 'error'); return }
      const bb = buyBacks.find(b => b.id === id)
      if (!bb || bb.status !== 'draft') { showToast('Only draft buy-backs can be approved', 'error'); return }
      setBuyBacks(p => p.map(b => b.id === id
        ? { ...b, status: 'approved', approvedByName: user.name, approvedDate: now() }
        : b
      ))
      showToast('Buy-back approved')
    },

    payBuyBack: (id, paymentMethod) => {
      const user = currentUser(); if (!user) return
      const bb = buyBacks.find(b => b.id === id)
      if (!bb || bb.status !== 'approved') { showToast('Approve the buy-back before recording payment', 'error'); return }
      const payment: RefundPayment = {
        id: uid(),
        ref: seq('RFD', 'rfd'),
        rmaId: bb.id,
        rmaRef: bb.ref,
        customerName: bb.customerName,
        amount: bb.total,
        paymentMethod: paymentMethod ?? 'cash',
        bankAccountId: bankAccountIdForMethod(paymentMethod),
        paymentDate: now(),
        notes: `Buy-back payout for ${bb.ref}`,
        journalEntryId: '',
        createdBy: user.name,
        createdDate: now(),
      }
      setRefundPayments(prev => [payment, ...prev])
      setBuyBacks(p => p.map(b => b.id === id ? { ...b, status: 'paid', paymentMethod, paidDate: now() } : b))
      showToast('Payment to customer recorded')
    },

    stockBuyBack: (id) => {
      const user = currentUser(); if (!user) return
      const bb = buyBacks.find(b => b.id === id)
      if (!bb) return
      if (bb.status !== 'paid') { showToast('Record customer payment before stocking buy-back items', 'error'); return }
      for (const line of bb.lines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName}`, 'error'); return }
        if (product.requiresSerial && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} serial number(s) for ${line.productName}`, 'error'); return
        }
        for (const sid of line.serialIds) {
          if (!serialRef.current.find(s => s.id === sid)) {
            showToast(`Serial missing for ${line.productName} — re-select or register returned serials`, 'error'); return
          }
        }
      }
      bb.lines.forEach(line => {
        // Restore serials — good/fair → available, poor → refurbishment
        line.serialIds.forEach(sid => {
          setSerials(p => p.map(s => s.id === sid
            ? { ...s, status: line.condition === 'poor' ? 'refurbishment' : 'available', location: bb.destinationLocation, soldDate: undefined, saleOrderId: undefined }
            : s
          ))
        })
        // Non-serialized: increase stock
        if (line.serialIds.length === 0) {
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
          setBulkStock(prev => upsertBulkStock(prev, line.productId, bb.destinationLocation, line.qty))
        } else {
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
        }
        addMove(line.productId, line.productName, line.qty, 'in', `Buy-back ${bb.ref}`, bb.ref, 'customer', bb.destinationLocation, line.serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id))
      })
      setBuyBacks(p => p.map(b => b.id === id ? { ...b, status: 'stocked', stockedDate: now(), stockedByName: user.name } : b))
      addAuditLog('buyback_stock', bb.ref, `Stocked buy-back ${bb.ref} for ${bb.customerName}`)
      showToast(`${bb.ref} stocked — inventory updated`)
    },

    deleteBuyBack: (id) => {
      const bb = buyBacks.find(b => b.id === id)
      setBuyBacks(p => p.filter(b => b.id !== id))
      if (bb?.repairId) {
        setRepairs(p => p.map(r => r.id === bb.repairId && r.retainedBuyBackId === id
          ? {
              ...r,
              retainedBuyBackId: undefined,
              retainedBuyBackRef: undefined,
              notes: `${r.notes || ''}\n\nDraft trade-in ${bb.ref} deleted — repair unlinked`.trim(),
            }
          : r))
      }
      showToast('Buy-back deleted')
    },

    // ── Donations ─────────────────────────────────────────────────────────────
    donations,

    createDonation: (type, party, location, lines, notes) => {
      for (const line of lines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid donation product') }
        if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid donation quantity') }
        if (product.requiresSerial && type === 'in' && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} serial number(s) for donation-in of ${product.name}`, 'error')
          throw new Error('Missing donation-in serials')
        }
        if (product.requiresSerial && type === 'out' && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} serial number(s) for ${product.name}`, 'error')
          throw new Error('Missing donation serials')
        }
      }
      const don: Donation = {
        id: uid(), ref: seq('DON', 'don'),
        type, party, date: now(),
        lines: lines.map(l => ({ ...l, id: uid() })),
        status: 'draft', location, notes,
      }
      setDonations(p => [don, ...p])
      showToast(`Donation ${don.ref} created`)
      return don
    },

    confirmDonation: (id) => {
      const user = currentUser(); if (!user) return
      const don = donations.find(d => d.id === id)
      if (!don) return
      if (don.status !== 'draft') { showToast('Donation already confirmed', 'info'); return }
      for (const line of don.lines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName}`, 'error'); return }
        if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
        if (product.requiresSerial && don.type === 'in' && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} serial number(s) for donation-in of ${product.name}`, 'error'); return
        }
        if (product.requiresSerial && don.type === 'out' && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} serial number(s) for ${product.name}`, 'error'); return
        }
        if (!product.requiresSerial && don.type === 'out') {
          const available = calcStockByLocation(product, serialRef.current, bulkStock, line.productId)[don.location] ?? 0
          if (available < line.qty) { showToast(`Only ${available} ${product.name} available at ${LOCATIONS[don.location].name}`, 'error'); return }
        }
      }
      don.lines.forEach(line => {
        if (don.type === 'in') {
          // Receive donated items into stock
          line.serialIds.forEach(sid => {
            setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'available', location: don.location, soldDate: undefined, saleOrderId: undefined } : s))
          })
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
          if (line.serialIds.length === 0) setBulkStock(prev => upsertBulkStock(prev, line.productId, don.location, line.qty))
          addMove(
            line.productId,
            line.productName,
            line.qty,
            'in',
            `Donation in ${don.ref}`,
            don.ref,
            'customer',
            don.location,
            line.serialIds.map(sid => serialRef.current.find(s => s.id === sid)?.serial ?? sid),
          )
        } else {
          // Donate items out of stock
          line.serialIds.forEach(sid => {
            setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'written_off', location: 'customer' as LocationId } : s))
          })
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: Math.max(0, x.stockQty - line.qty) } : x))
          if (line.serialIds.length === 0) setBulkStock(prev => upsertBulkStock(prev, line.productId, don.location, -line.qty))
          addMove(line.productId, line.productName, line.qty, 'out', `Donation out ${don.ref}`, don.ref, don.location, 'customer', line.serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id))
        }
      })
      setDonations(p => p.map(d => d.id === id ? { ...d, status: 'confirmed', confirmedByName: user.name, confirmedDate: now() } : d))
      showToast(`Donation ${don.ref} confirmed — stock updated`)
    },

    deleteDonation: (id) => {
      setDonations(p => p.filter(d => d.id !== id))
      showToast('Donation deleted')
    },

    // ── Client Exchanges ──────────────────────────────────────────────────────
    clientExchanges,

    createExchange: (customerId, customerName, returnLines, newLines, notes, originalSOId, originalSORef) => {
      for (const line of returnLines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid exchange return product') }
        if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid exchange return quantity') }
        if (product.requiresSerial && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} returned serial number(s) for ${product.name}`, 'error')
          throw new Error('Missing exchange return serials')
        }
      }
      for (const line of newLines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid exchange issue product') }
        if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid exchange issue quantity') }
        if (product.requiresSerial && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} outgoing serial number(s) for ${product.name}`, 'error')
          throw new Error('Missing exchange issue serials')
        }
      }
      const rLines: ExchangeLine[] = returnLines.map(l => ({ ...l, id: uid() }))
      const nLines: ExchangeLine[] = newLines.map(l => ({ ...l, id: uid() }))
      const returnTotal = rLines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
      const newTotal    = nLines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
      const exc: ClientExchange = {
        id: uid(), ref: seq('EXC', 'exc'),
        customerId, customerName, originalSOId, originalSORef,
        status: 'draft', date: now(),
        returnLines: rLines, newLines: nLines,
        returnTotal, newTotal, priceDiff: newTotal - returnTotal, notes,
      }
      setClientExchanges(p => [exc, ...p])
      showToast(`Exchange ${exc.ref} created`)
      return exc
    },

    approveExchange: (id) => {
      const user = currentUser(); if (!user) return
      if (!['director', 'finance_officer'].includes(user.role)) { showToast('Only Director or Finance can approve exchanges', 'error'); return }
      const exchange = clientExchanges.find(e => e.id === id)
      if (!exchange || exchange.status !== 'draft') { showToast('Only draft exchanges can be approved', 'error'); return }
      setClientExchanges(p => p.map(e => e.id === id
        ? { ...e, status: 'approved', approvedByName: user.name, approvedDate: now() }
        : e
      ))
      showToast('Exchange approved')
    },

    completeExchange: (id) => {
      const user = currentUser(); if (!user) return
      const exc = clientExchanges.find(e => e.id === id)
      if (!exc) return
      if (exc.status !== 'approved') { showToast('Approve the exchange before completing it', 'error'); return }
      for (const line of exc.returnLines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName}`, 'error'); return }
        if (product.requiresSerial && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} returned serial number(s) for ${product.name}`, 'error'); return
        }
      }
      for (const line of exc.newLines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName}`, 'error'); return }
        if (product.requiresSerial && line.serialIds.length !== line.qty) {
          showToast(`Select ${line.qty} outgoing serial number(s) for ${product.name}`, 'error'); return
        }
        if (!product.requiresSerial) {
          const available = calcStockByLocation(product, serialRef.current, bulkStock, line.productId).warehouse ?? 0
          if (available < line.qty) { showToast(`Only ${available} ${product.name} available in warehouse`, 'error'); return }
        }
      }

      // Return items → back to stock as available
      exc.returnLines.forEach(line => {
        line.serialIds.forEach(sid => {
          setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'available', location: 'warehouse' as LocationId, soldDate: undefined, saleOrderId: undefined } : s))
        })
        if (line.serialIds.length === 0) {
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
          setBulkStock(prev => upsertBulkStock(prev, line.productId, 'warehouse', line.qty))
        } else {
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
        }
        addMove(line.productId, line.productName, line.qty, 'in', `Exchange return ${exc.ref}`, exc.ref, 'customer', 'warehouse', line.serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id))
      })

      // New items → out to customer
      exc.newLines.forEach(line => {
        line.serialIds.forEach(sid => {
          setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'sold', location: 'customer' as LocationId, soldDate: now(), saleOrderId: exc.id } : s))
        })
        setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: Math.max(0, x.stockQty - line.qty) } : x))
        if (line.serialIds.length === 0) setBulkStock(prev => upsertBulkStock(prev, line.productId, 'warehouse', -line.qty))
        addMove(line.productId, line.productName, line.qty, 'out', `Exchange issue ${exc.ref}`, exc.ref, 'warehouse', 'customer', line.serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id))
      })

      setClientExchanges(p => p.map(e => e.id === id ? { ...e, status: 'completed', completedDate: now(), completedByName: user.name } : e))
      addAuditLog('exchange_complete', exc.ref, `Completed exchange ${exc.ref} for ${exc.customerName}`)
      showToast(`Exchange ${exc.ref} completed — stock updated`)
    },

    cancelExchange: (id) => {
      setClientExchanges(p => p.map(e => e.id === id ? { ...e, status: 'cancelled' } : e))
      showToast('Exchange cancelled')
    },
  }

  storeCtxRef.current = storeCtx

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
    ...commerceActions,
  }), [
    companySettings,
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
    commerceActions,
  ])

  const afterSalesStore = useMemo<AfterSalesStoreState>(() => ({
    buyBacks,
    clientExchanges,
    contacts,
    currentUserId,
    donations,
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

export function useDashboardStore() { return useFeatureStore(DashboardStoreCtx, 'useDashboardStore') }
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
  return `KSh ${Math.round(Number.isFinite(v) ? v : 0).toLocaleString('en-KE')}`
}
export const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d } }
