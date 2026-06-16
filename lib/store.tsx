// @ts-nocheck
'use client'
import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef } from 'react'
import { requestCreateUser, requestDeleteUser, requestUpdateUser, requestDeactivateUser, requestReactivateUser } from '@/lib/auth/client-users'
import { getFirstAllowedModule, hasModuleAccess as userHasModuleAccess, normalizeClientRole } from '@/lib/auth/access'
import type { CreateUserInput, ModuleId as AuthModuleId, PublicUser, UpdateUserInput, UserRole as AuthUserRole } from '@/lib/auth/types'
import { calcStockByLocation as _calcStockByLocation, upsertBulkStock as _upsertBulkStock, computePayrollLine, aggregatePayroll } from '@/lib/business-logic'
import { APPROVAL_RULES, createApprovalRequest, getPendingApprovals, processApproval, validateSalesOrderCreation } from '@/lib/sales-approvals'
import type { ApprovalRequest, ApprovalType, StockReservation } from '@/lib/sales-flow-types'
import { LEAVE_ENTITLEMENTS, NOTICE_EXEMPT_TYPES, CALENDAR_DAY_TYPES, calcWorkingDays, calcCalendarDays, noticeDaysGiven, requiredNotice, decemberClosureDays } from '@/lib/leave-utils'
import type { StoreLeaveType } from '@/lib/leave-utils'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'

export type ModuleId = AuthModuleId

export type UserRole = AuthUserRole

export type User = PublicUser

// ─── Stock Locations ──────────────────────────────────────────────────────────
export type LocationId = 'warehouse' | 'shop' | 'repair_unit' | 'vendor' | 'customer' | 'employee'

export const LOCATIONS: Record<LocationId, { name: string; icon: string; color: string }> = {
  warehouse:    { name: 'Warehouse (Main)',  icon: '🏭', color: '#875BF7' },
  shop:         { name: 'With Issues',        icon: '⚠️',  color: '#F59E0B' },
  repair_unit:  { name: 'Repair Unit',       icon: '🔧', color: '#F04438' },
  vendor:       { name: 'Vendor',            icon: '🚚', color: '#F79009' },
  customer:     { name: 'Customer',          icon: '👤', color: '#2E90FA' },
  employee:     { name: 'Employee Asset',    icon: '🧑', color: '#7F56D9' },
}

// ─── Category Config ──────────────────────────────────────────────────────────
export type CategoryId = 'Laptops' | 'Desktops' | 'Parts & Components' | 'Accessories' | 'Printers' | 'Networking' | 'Services'

export const CATEGORY_CONFIG: Record<CategoryId, { serialRequired: boolean; trackStock: boolean }> = {
  Laptops:              { serialRequired: true,  trackStock: true  },
  Desktops:             { serialRequired: true,  trackStock: true  },
  'Parts & Components': { serialRequired: false, trackStock: true  },
  Accessories:          { serialRequired: false, trackStock: true  },
  Printers:             { serialRequired: true,  trackStock: true  },
  Networking:           { serialRequired: true,  trackStock: true  },
  Services:             { serialRequired: false, trackStock: false },
}

export const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as CategoryId[]

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
}

export interface AuditLog {
  id: string; date: string; user: string; action: string; documentRef: string; details: string
}

// ── In-app Notifications ──────────────────────────────────────────────────────
export type NotifType = 'assignment' | 'leave' | 'asset' | 'expense' | 'system' | 'repair'

export interface AppNotification {
  id: string
  userId: string          // recipient user id
  type: NotifType
  title: string
  body: string
  module?: ModuleId       // navigate here on click
  path?: string           // deep link path/query to navigate to
  read: boolean
  createdAt: string
  icon: string            // emoji
}

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
  currency: string
  invoiceFooter: string
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
  // Inventory
  invProductsMasterOnly: boolean
  invNoDirectStockEdits: boolean
  invMultiStepRoutes: boolean
  invStorageLocations: string[]
  invSerialNumbers: boolean
  invLots: boolean
  invAutomatedValuation: boolean
  invCostingMethod: 'fifo' | 'average' | 'standard'
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
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  multiUserRoles: true, enforceDeptAccess: true, auditLogs: true, fiscalYearStart: 'January',
  crmLeads: true, crmLeadScoring: false, crmTags: true, crmSourceTracking: true,
  crmPipelineStages: ['Inquiry Received', 'Assigned', 'Contacted', 'Qualified', 'Needs Confirmed', 'Quote Sent', 'Follow-up', 'Won', 'Lost'],
  crmEnforceNextActivity: true, crmAutoAssignLeads: false, crmAutoFollowUpAfterQuote: true,
  salesQuotationTemplates: true, salesOptionalProducts: true, salesDigitalSignature: false,
  salesOnlineAcceptance: false, salesPricelists: false, salesDiscountControl: true, salesConfirmedQuotesToOrders: true,
  invProductsMasterOnly: true, invNoDirectStockEdits: true, invMultiStepRoutes: true,
  invStorageLocations: ['Incoming', 'Workshop', 'Ready for Sale', 'Faulty / Scrap'],
  invSerialNumbers: true, invLots: false, invAutomatedValuation: true, invCostingMethod: 'fifo',
  purPurchaseAgreements: false, purVendorPricelists: true, purRequireApprovalHighValue: true,
  purHighValueThreshold: 50000, purEnforceRFQFlow: true, purStoreLeadTimes: true,
  repRepairOrders: true, repWarrantyTracking: true, repPartsConsumption: true,
  repEnforceFlow: true, repOnlyAssignedTechSeesJob: true, repAdminAssignsJobs: true,
  accCustomerInvoices: true, accVendorBills: true, accCreditNotes: true, accVatEnabled: true,
  accBankJournals: true, accMpesaJournals: true, accReconciliation: true,
  accLockDates: true, accApprovalForRefunds: true,
  hrAttendance: false, hrLeaves: true, hrRestrictSalaryInfo: true, hrRoleBasedVisibility: true,
  posSessionControl: true, posCashControl: true, posReceiptPrinting: true,
  secDisableProductDeletion: true, secDisableStockManipulation: true, secDisableInvoiceEditAfterValidation: true,
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
  invoiceFooter: 'Thank you for your business.',
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
  // stockQty is derived from serials+moves — kept for display/quick access
  stockQty: number; minStock: number; unit: string
  description: string; canBeSold: boolean; canBePurchased: boolean
  image: string; isActive: boolean; warrantyMonths: number
  requiresSerial: boolean  // set automatically from category
  saleAccountCode?: string  // revenue account code e.g. '5001'
  costAccountCode?: string  // cost/purchase account code e.g. '6101'
  inventoryAccountCode?: string  // inventory asset account code e.g. '1200'
  cogsAccountCode?: string       // cost of goods sold account code e.g. '6001'
  adjustmentAccountCode?: string // stock gain/variance account code
  writeOffAccountCode?: string   // damage, theft, expiry, and write-off expense account code
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
  location: LocationId
  status: 'available' | 'assigned' | 'sold' | 'under_repair' | 'returned' | 'written_off' | 'refurbishment'
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

export type SOStatus = 'quotation' | 'pending_approval' | 'approved' | 'confirmed' | 'reserved' | 'delivered' | 'invoiced' | 'paid' | 'cancelled' | 'on_hold'

export interface SaleOrder {
  id: string
  orderNumber?: string
  ref?: string
  clientId?: string
  customerId: string
  customerName: string
  quoteId?: string
  invoiceId?: string
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
  lines: any[]
  subtotal: number
  taxAmount: number
  taxTotal: number
  discountAmount: number
  totalAmount: number
  total: number
  amountPaid: number
  notes?: string
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
export type InvoiceStatus = 'draft' | 'posted' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'

export interface InvoiceLine {
  id: string; description: string; qty: number; unitPrice: number; taxRate: number; subtotal: number
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

export interface DeliveryLine {
  productId: string; productName: string; qty: number; qtyDone: number; serialIds: string[]; sourceLocation?: LocationId
}

export interface Delivery {
  id: string; ref: string
  saleOrderId: string; saleOrderRef: string
  customerId: string; customerName: string
  status: 'ready' | 'done' | 'cancelled'
  date: string; lines: DeliveryLine[]
  warrantyCreated: boolean
  // Recipient info — saved when DN is printed/signed
  recipientName?: string
  recipientPhone?: string
  recipientIdNumber?: string
  deliveryAddress?: string
  notes?: string
}

// ── Rider Delivery ────────────────────────────────────────────────────────────
export type DeliveryJobType =
  | 'repair_pickup'    // collect device from customer for repair
  | 'repair_dropoff'   // return repaired device to customer
  | 'sales_delivery'   // deliver items from a confirmed sale order

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
  qty: number; qtyReceived: number; unitPrice: number; taxRate: number; subtotal: number
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
export type RepairPaymentConfirmationStatus = 'pending_review' | 'auto_paid' | 'rejected'

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
  diagnosisFee?: number                               // KES 1500 if stops at diagnosis
  diagnosisStopped?: boolean                          // true if repair closed at diagnosis stage
  
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
  qcReportData?: string      // base64 PDF data URL
  qcReportName?: string
  qcReportUrl?: string       // lightweight server download URL for QC reports
  qcReportId?: string
  qcReportSize?: number
  qcReportType?: string
  qcReportUploadedAt?: string

  // Reports
  diagnosisReportData?: string   // base64 PDF data URL
  diagnosisReportName?: string
  
  // Billing
  invoiceId?: string
  invoiceDate?: string
  // Sales quote / SO / Invoice links (set when repair quote is promoted to sales quote)
  salesQuoteId?: string
  salesQuoteRef?: string
  saleOrderId?: string
  saleOrderRef?: string

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
  productId: string; productName: string
  qty: number; unitPrice: number; total: number
  status: KilimallOrderStatus
  serialId?: string; serialNumber?: string
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
  productId: string; productName: string
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
  source: 'payroll' | 'refund' | 'invoice' | 'payment' | 'bill' | 'purchase_payment' | 'expense' | 'pos' | 'purchase' | 'manual'
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
  !!user && ['director', 'inventory_officer', 'technical_lead'].includes(user.role)

const canManageInventoryControl = (user: User | null) =>
  !!user && ['director', 'inventory_officer', 'technical_lead', 'finance_officer'].includes(user.role)

const canManageHR = (user: User | null) =>
  !!user && user.role === 'director'

const canApprovePayroll = (user: User | null) =>
  !!user && ['director', 'finance_officer'].includes(user.role)

const canManageHRAssets = (user: User | null) =>
  !!user && ['director', 'inventory_officer', 'technical_lead'].includes(user.role)

const canManageFinance = (user: User | null) =>
  !!user && ['director', 'finance_officer'].includes(user.role)

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

const buildInvoicePostingJournal = (inv: Invoice): JournalEntry => {
  if (inv.type === 'customer_invoice') {
    const lines = [
      accountLine('1800 - Accounts Receivable', `AR: ${inv.partnerName}`, inv.total, 0),
      accountLine('5000 - Sales Revenue', `Revenue: ${inv.ref}`, 0, inv.subtotal),
      ...(inv.taxTotal > 0 ? [accountLine('3301 - Output VAT Payable', `VAT on ${inv.ref}`, 0, inv.taxTotal)] : []),
    ]
    return { id: uid(), ref: `JRN/${inv.ref}`, date: now(), source: 'invoice', description: `Invoice ${inv.ref} — ${inv.partnerName}`, status: 'posted', invoiceId: inv.id, lines, totalDebit: inv.total, totalCredit: inv.total }
  }

  const lines = [
    accountLine('6101 - Local Purchases', `Purchase: ${inv.partnerName}`, inv.subtotal, 0),
    ...(inv.taxTotal > 0 ? [accountLine('1150 - VAT Input', `VAT input on ${inv.ref}`, inv.taxTotal, 0)] : []),
    accountLine('3000 - Accounts Payable', `AP: ${inv.partnerName}`, 0, inv.total),
  ]
  return { id: uid(), ref: `JRN/${inv.ref}`, date: now(), source: 'bill', description: `Bill ${inv.ref} — ${inv.partnerName}`, status: 'posted', invoiceId: inv.id, lines, totalDebit: inv.total, totalCredit: inv.total }
}

const buildInvoicePaymentJournal = (inv: Invoice, amount: number, method?: string, bankAccountId?: string, paymentDate?: string): JournalEntry => {
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
    ref: `JRN/PAY/${inv.ref}/${Date.now()}`,
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
  createPayment: (customerId: string, customerName: string, amount: number, method: Payment['method'], reference: string, notes?: string) => Payment
  allocatePaymentToInvoice: (paymentId: string, invoiceId: string, amount: number) => void
  generateReceipt: (paymentId: string) => void
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
  departments: Department[]
  employees: Employee[]
  contracts: Contract[]
  customerContracts: CustomerContract[]
  leaveBalances: LeaveBalance[]
  leaveRequests: LeaveRequest[]
  hrDocuments: HRDocument[]
  workflowApprovals: WorkflowApproval[]
  payrollRuns: PayrollRun[]
  payslips: Payslip[]
  salaryAdvances: SalaryAdvance[]
  journalEntries: JournalEntry[]
  accounts: Account[]
  employeeAssetAssignments: EmployeeAssetAssignment[]
  jobPostings: JobPosting[]
  candidates: Candidate[]
  trainingPrograms: TrainingProgram[]
  employeeTrainings: EmployeeTraining[]
  warranties: Warranty[]; posOrders: POSOrder[]

  // Kilimall
  kilimallOrders: KilimallOrder[]
  kilimallDispatches: KilimallDispatch[]
  kilimallSettlements: KilimallSettlement[]
  createKilimallOrder: (p: Omit<KilimallOrder, 'id' | 'ref' | 'status' | 'createdDate' | 'createdBy'>) => KilimallOrder
  updateKilimallOrder: (id: string, p: Partial<KilimallOrder>) => void
  confirmKilimallDispatch: (orderId: string, serialId: string, serialNumber: string) => KilimallDispatch | null
  createKilimallSettlement: (p: Omit<KilimallSettlement, 'id' | 'ref' | 'status' | 'createdDate' | 'createdBy'>) => KilimallSettlement
  updateKilimallSettlement: (id: string, p: Partial<KilimallSettlement>) => void
  reconcileKilimallSettlement: (settlementId: string) => void
  posSessionOpen: boolean; posSessionOpeningCash: number
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
  assignRiderToJob: (jobId: string, riderId: string) => void
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
  addBankAccount: (a: Omit<BankAccount, 'id'>) => void
  deleteBankAccount: (id: string) => void
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
  updateContact: (id: string, p: Partial<Contact>) => Promise<void>
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
  updateProduct: (id: string, p: Partial<Product>) => void
  updateProductPrice: (id: string, salePrice: number, costPrice: number, reason: string, effectiveDate?: string) => ProductPriceHistory | null
  deleteProduct: (id: string) => void
  importOpeningStock: (items: { productId: string; qty: number; serials?: string[]; location?: LocationId }[]) => void

  // Serials
  getProductSerials: (productId: string, location?: LocationId) => SerialNumber[]
   getAvailableSerials: (productId: string) => SerialNumber[]
  updateSerial: (id: string, patch: Partial<SerialNumber>) => void

  // Sale Orders
  createSaleOrder: (customerId: string, customerName: string, initial?: Partial<Pick<SaleOrder, 'lines' | 'deliveryDate' | 'notes' | 'paymentTerms' | 'validUntil'>>) => SaleOrder
  updateSaleOrder: (id: string, p: Partial<SaleOrder>) => void
  addSOLine: (orderId: string, product: Product, qty: number, discount?: number, defaultTaxRate?: number) => void
  assignSerialToSOLine: (orderId: string, lineId: string, serialId: string) => void
  removeSOLine: (orderId: string, lineId: string) => void
  confirmSO: (id: string) => void
  resetSOToDraft: (id: string) => void
  cancelSO: (id: string) => void
  validateDelivery: (deliveryId: string) => void
  updateDelivery: (deliveryId: string, p: Partial<Pick<Delivery, 'recipientName' | 'recipientPhone' | 'recipientIdNumber' | 'deliveryAddress' | 'notes'>>) => void
  createInvoiceFromSO: (orderId: string) => Invoice
  deleteSaleOrder: (id: string) => void

  // Invoices
  createManualInvoice: (type: InvoiceType, partnerId: string, partnerName: string, dueDate: string, lines: { desc: string; qty: string; price: string; tax: string }[], vatRate: number, notes?: string) => Invoice
  updateInvoice: (id: string, p: Partial<Invoice>) => void
  postInvoice: (id: string) => void
  registerPayment: (invoiceId: string, amount: number, method?: string, bankAccountId?: string, reference?: string, paymentDate?: string) => void
  deleteInvoice: (id: string) => void

  // Audit logs
  addAuditLog: (action: string, documentRef: string, details: string) => void

  // Purchase Orders
  createPO: (vendorId: string, vendorName: string, initial?: Partial<Pick<PurchaseOrder, 'lines' | 'expectedDate' | 'notes'>>) => PurchaseOrder
  updatePO: (id: string, p: Partial<PurchaseOrder>) => void
  addPOLine: (poId: string, product: Product, qty: number, unitPrice: number, taxRate?: number) => void
  removePOLine: (poId: string, lineId: string) => void
  updatePOLine: (poId: string, lineId: string, updates: Partial<Pick<POLine, 'qty' | 'unitPrice' | 'taxRate' | 'productName' | 'accountCode'>>) => void
  bulkAddPOLines: (poId: string, rows: { productId: string; productName: string; qty: number; unitPrice: number; taxRate: number; requiresSerial: boolean; importedSerials?: string[]; specs?: string; accountCode?: string }[]) => void
  sendPO: (id: string) => void
  revertPOToDraft: (id: string) => void
  confirmPO: (id: string) => void
  // Create receipt from PO (opens receiving dialog)
  createReceiptFromPO: (poId: string) => Receipt | null
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
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<Employee>
  updateEmployee: (id: string, patch: Partial<Employee>) => void
  addLeaveRequest: (request: Omit<LeaveRequest, 'id' | 'ref' | 'submittedDate' | 'status' | 'isSystemGenerated'>) => LeaveRequest
  decideLeaveRequest: (id: string, approved: boolean, note?: string) => void
  cancelLeaveRequest: (id: string) => void
  updateLeaveBalance: (id: string, patch: Partial<Pick<LeaveBalance, 'entitlement' | 'used' | 'carryForward'>>) => void
  initYearBalances: (year: number) => void
  applyDecemberClosure: (year: number) => void
  expireYearEndBalances: (year: number) => void
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
  addHRDocument: (document: Omit<HRDocument, 'id'>) => HRDocument
  uploadMyDocument: (document: Omit<HRDocument, 'id' | 'employeeId' | 'uploadedByUserId' | 'uploadedByName' | 'uploadedDate'>) => HRDocument

  // Recruitment & Training
  addJobPosting: (p: Omit<JobPosting, 'id' | 'postedDate'>) => void
  updateJobPosting: (id: string, p: Partial<JobPosting>) => void
  addCandidate: (c: Omit<Candidate, 'id' | 'appliedDate'>) => void
  updateCandidate: (id: string, p: Partial<Candidate>) => void
  addTrainingProgram: (t: Omit<TrainingProgram, 'id'>) => void
  enrollEmployeeTraining: (employeeId: string, trainingId: string) => void
  updateTrainingStatus: (id: string, status: TrainingStatus, score?: number) => void

  // Stock Transfers (internal moves)
  createTransfer: (from: LocationId, to: LocationId, notes?: string) => StockTransfer
  addTransferLine: (transferId: string, productId: string, productName: string, qty: number, serialIds: string[]) => void
  validateTransfer: (transferId: string) => void
  submitTransfer: (from: LocationId, to: LocationId, productId: string, productName: string, qty: number, serialIds: string[], notes?: string) => boolean

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
  stopAtDiagnosis: (repairId: string) => void          // Close job at diagnosis stage, charge KES 1,500 fee
  generateRepairQuote: (repairId: string, lines: Omit<RepairQuoteLine, 'id' | 'reserved'>[], applyVat?: boolean) => void
  sendQuoteToCustomer: (repairId: string) => void
  approveRepairQuote: (repairId: string, approved: boolean, reason?: string) => void
  startRepair: (repairId: string) => void
  markRepairComplete: (repairId: string) => void
  addRepairQAItem: (repairId: string, description: string) => void
  completeRepairQA: (repairId: string, qaResults: { itemId: string; passed: boolean; notes?: string }[]) => void
  markPartsArrived: (repairId: string) => void
  markRepairReady: (repairId: string) => void
  scheduleDelivery: (repairId: string, method: 'pickup' | 'delivery' | 'courier', scheduledDate: string, address?: string, riderId?: string, riderName?: string) => void
  deliverRepair: (repairId: string, recipientName: string, recipientPhone: string, isRep?: boolean, repRelationship?: string, repIdNumber?: string) => void
  closeRepairJob: (repairId: string) => void
  createInvoiceFromRepair: (repairId: string, applyVat?: boolean) => Invoice | null
  
  // Repair Access Control
  canViewRepair: (repairId: string) => boolean
  getVisibleRepairs: () => RepairOrder[]
  updateRepairProgress: (repairId: string, newStatus: RepairStatus, message: string, notifyCustomer: boolean) => void
  
  // Parts Procurement
  requestProcurement: (repairId: string, items: any[], urgency: string, notes: string) => void
  appendRepairHistory: (repairId: string, entry: { status: string; date: string; note?: string; by?: string }) => void
  
  // Quote Management
  declineQuote: (repairId: string, reason: string) => void
  markUnrepairable: (repairId: string, reason: string) => void
  returnToCustomer: (repairId: string, reason: string) => void

  // POS
  openPOSSession: (openingCash: number) => void
  closePOSSession: (closingCash: number) => void
  createPOSOrder: (lines: POSOrder['lines'], payment: POSOrder['payment'], customerId?: string, customerName?: string, pointsRedeemed?: number) => void

  // Inventory reports
  getStockByLocation: (productId: string) => Record<LocationId, number>
  getMonthlyMovements: (productId: string) => { opening: number; purchases: number; sales: number; usage: number; closing: number }

  // Stock adjustments
  createAdjustment: (productId: string, productName: string, type: 'add' | 'subtract', qty: number, reason: AdjReason, notes: string) => StockAdjustment
  approveAdjustment: (adjId: string, approved: boolean) => void
  
  // Stock Reservations
  stockReservations: StockReservation[]
  reserveStock: (productId: string, qty: number, reservedFor: string, referenceId: string, referenceRef: string) => StockReservation | null
  getReservedQty: (productId: string) => number
  getAvailableStock: (productId: string) => number
  fulfillReservation: (productId: string, referenceId: string, qty: number) => void
  cancelReservation: (referenceId: string, reason: string) => void
  
  // Delivery & Fulfillment
  createDeliveryFromSO: (salesOrderId: string) => Delivery | null
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString().slice(0, 10)
const addDays = (d: string, n: number) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10) }
const addMonths = (d: string, m: number) => { const dt = new Date(d); dt.setMonth(dt.getMonth() + m); return dt.toISOString().slice(0, 10) }

const makeC = () => ({
  so: 88, inv: 88, po: 39, rep: 0, del: 26, pos: 12, war: 10, rec: 0, tr: 0, ret: 0, adj: 0, rma: 0,
  opp: 15, quote: 24, activity: 0, outsource: 4, outsource_pay: 1, exp: 5, sop: 3, refurb: 0,
  djb: 3, rwp: 0, bbk: 0, don: 0, exc: 0, ko: 0, kd: 0, ks: 0, rfd: 0,
  dep: 0, proc: 0, jrn_rfd: 0, orc: 0,
})
let C = makeC()
const seq = (prefix: string, key: keyof ReturnType<typeof makeC>) => {
  const lsKey = `deed_seq2_${key}`
  const stored = typeof window !== 'undefined' ? localStorage.getItem(lsKey) : null
  const current = stored !== null ? parseInt(stored, 10) : C[key]
  const next = current + 1
  if (typeof window !== 'undefined') localStorage.setItem(lsKey, String(next))
  C[key] = next
  return `${prefix}/${String(next).padStart(4, '0')}`
}

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

// ── Dirty key tracking ────────────────────────────────────────────────────────
// Persisted in localStorage so a page-reload still knows which keys need to be
// pushed to the server before accepting remote state — even after _pendingSync
// was cleared from memory (e.g. the tab was closed while offline).
const DIRTY_KEYS_LS = 'deed_dirty_keys'

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
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`)
    // Only remove from _pendingSync once the server has confirmed receipt.
    // If a newer write arrived for the same key while in-flight, leave it.
    Object.keys(entries).forEach(k => {
      if (_pendingSync[k] === entries[k]) delete _pendingSync[k]
    })
    removeDirtyKeys(Object.keys(entries))
  } catch {
    // offline or failed — entries remain in _pendingSync for retry on next debouncedServerSync call
  }
}

function debouncedServerSync(key: string, value: string) {
  _pendingSync[key] = value
  addDirtyKey(key)
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
 */
function useLS<T>(key: string, seed: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return seed
    try {
      const stored = window.localStorage.getItem(key)
      if (stored !== null) return JSON.parse(stored) as T
    } catch { /* corrupted — fall through to seed */ }
    return seed
  })

  const isFirstRender = useRef(true)
  const skipNextSync = useRef(false)

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

  // Listen for cross-device updates (from our polling) or cross-tab updates
  useEffect(() => {
    const handleUpdate = (newValue: string) => {
      try {
        skipNextSync.current = true
        setState(JSON.parse(newValue))
      } catch {}
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

const DATA_VERSION = 'v4'

// Fire-and-forget server sync — swallows network errors so local state is never blocked
const sync = (url: string, opts: RequestInit) => fetch(url, opts).catch(() => {})

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
  // On version mismatch wipe all deed_ data keys so stale seed data is flushed
  if (typeof window !== 'undefined' && localStorage.getItem('deed_data_version') !== DATA_VERSION) {
    Object.keys(localStorage)
      .filter(k => k.startsWith('deed_') && k !== 'deed_data_version')
      .forEach(k => localStorage.removeItem(k))
    localStorage.setItem('deed_data_version', DATA_VERSION)
  }


  // Real-time sync via Server-Sent Events (replaces 3-second polling)
  useEffect(() => {
    if (typeof window === 'undefined') return

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
          if (dirty.has(k)) continue // local unsynced write — server state is stale for this key
          const remoteStr = typeof v === 'string' ? v : JSON.stringify(v)
          const localStr  = window.localStorage.getItem(k)
          if (localStr !== remoteStr) {
            window.localStorage.setItem(k, remoteStr)
            window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key: k, value: remoteStr } }))
          }
        } catch { /* quota — ignore */ }
      }
      _serverHydrated = true
    }

    const applyRemoteState = (remoteState: Record<string, unknown>) => {
      const pendingKeys = new Set(Object.keys(_pendingSync))
      const dirtyKeys   = getDirtyKeys()
      for (const [k, v] of Object.entries(remoteState)) {
        if (!k.startsWith('deed_')) continue
        // Skip keys that have an unconfirmed local write — server state is stale for those
        if (pendingKeys.has(k) || dirtyKeys.has(k)) continue
        const local     = window.localStorage.getItem(k)
        const remoteStr = typeof v === 'string' ? v : JSON.stringify(v)
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
  useEffect(() => {
    fetch('/api/contacts').then(r => r.ok && r.json().then(d => setContacts(Array.isArray(d) ? d : (d.items ?? [])))).catch(() => {})
  }, [])

  const [companies, setCompanies] = useLS<Company[]>('deed_companies', seedCompanies)
  useEffect(() => {
    fetch('/api/companies').then(r => r.ok && r.json().then(d => setCompanies(Array.isArray(d) ? d : (d.items ?? [])))).catch(() => {})
  }, [])

  const [contactPersons, setContactPersons] = useLS<ContactPerson[]>('deed_contactPersons', seedContactPersons)
  useEffect(() => {
    fetch('/api/contact-persons').then(r => r.ok && r.json().then(d => setContactPersons(Array.isArray(d) ? d : (d.items ?? [])))).catch(() => {})
  }, [])

  const [opportunities, setOpportunities] = useLS<Opportunity[]>('deed_opportunities', seedOpportunities)
  useEffect(() => {
    fetch('/api/opportunities').then(r => r.ok && r.json().then(d => setOpportunities(Array.isArray(d) ? d : []))).catch(() => {})
  }, [])

  const [opportunityActivities, setOpportunityActivities] = useLS<OpportunityActivity[]>('deed_oppActivities', seedOpportunityActivities)
  useEffect(() => {
    fetch('/api/opportunity-activities').then(r => r.ok && r.json().then(d => setOpportunityActivities(Array.isArray(d) ? d : []))).catch(() => {})
  }, [])

  const [quotes, setQuotes] = useLS<Quote[]>('deed_quotes', seedQuotes)
  useEffect(() => {
    fetch('/api/quotes').then(r => r.ok && r.json().then(d => setQuotes(Array.isArray(d) ? normalizeQuotesForClient(d) as Quote[] : []))).catch(() => {})
  }, [])
  
  // Products & Inventory
  const [products, setProducts] = useLS('deed_products', seedProducts)
  const [productPriceHistory, setProductPriceHistory] = useLS<ProductPriceHistory[]>('deed_productPriceHistory', [])
  
  const [serials, setSerials] = useLS<SerialNumber[]>('deed_serials', seedSerials)
  
  // Sales & Invoicing
  const [saleOrders, setSaleOrders] = useLS<SaleOrder[]>('deed_saleOrders', seedSOs)
  useEffect(() => {
    fetch('/api/sale-orders').then(r => r.ok && r.json().then(d => setSaleOrders(Array.isArray(d) ? d : (d.items ?? [])))).catch(() => {})
  }, [])

  const [deliveries, setDeliveries] = useLS<Delivery[]>('deed_deliveries', seedDeliveries)

  const [invoices, setInvoices] = useLS<Invoice[]>('deed_invoices', seedInvoices)

  const [payments, setPayments] = useLS<Payment[]>('deed_payments', [])

  // Purchasing
  const [purchaseOrders, setPurchaseOrders] = useLS<PurchaseOrder[]>('deed_purchaseOrders', seedPOs)
  const [receipts, setReceipts] = useLS<Receipt[]>('deed_receipts', seedReceipts)

  const [stockTransfers, setStockTransfers] = useLS('deed_stockTransfers', seedTransfers)
  const [purchaseReturns, setPurchaseReturns] = useLS<PurchaseReturn[]>('deed_purchaseReturns', [])
  const [refurbishmentJobs, setRefurbishmentJobs] = useLS<RefurbishmentJob[]>('deed_refurbishmentJobs', seedRefurbishmentJobs)

  // Repairs
  const [repairs, setRepairs] = useLS<RepairOrder[]>('deed_repairs_v2', seedRepairs)
  useEffect(() => {
    // SSE keeps repairs in sync in real-time; this ensures fresh state on mount only
    fetch('/api/repairs')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!Array.isArray(data)) return
        setRepairs(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data)
      })
      .catch(() => {})
  }, [setRepairs])

  // HR
  const [departments, setDepartments]   = useLS('deed_departments', seedDepartments)
  const [contracts, setContracts]       = useLS('deed_contracts', seedContracts)
  const [customerContracts, setCustomerContracts] = useLS('deed_customerContracts', seedCustomerContracts)
  const [hrDocuments, setHRDocuments]       = useLS('deed_hrDocuments', seedHRDocuments)
  const [workflowApprovals, setWorkflowApprovals] = useLS('deed_workflowApprovals', seedWorkflowApprovals)
  const [employeeAssetAssignments, setEmployeeAssetAssignments] = useLS('deed_employeeAssets', seedEmployeeAssetAssignments)

  // Employee records are fetched from the API so self-service can link the user
  // to their employee profile; payroll remains fetched only for privileged roles.
  const HR_ROLES = ['director', 'finance_officer']
  const [employees, setEmployees] = useState<Employee[]>(seedEmployees)
  useEffect(() => {
    if (!initialUser) return
    fetch('/api/employees').then(r => r.ok && r.json().then(d => setEmployees(Array.isArray(d) ? d : (d.items ?? [])))).catch(() => {})
  }, [])

  // Never stored in localStorage/app_state — each user only receives their own data from the API
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>(seedLeaveBalances)
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(seedLeaveRequests)
  useEffect(() => {
    const fetchLeave = () => fetch('/api/leave-requests').then(r => r.ok && r.json().then(data => {
      if (data.requests) setLeaveRequests(data.requests)
      if (data.balances) setLeaveBalances(data.balances)
    })).catch(() => {})
    fetchLeave()
    // Managers need frequent refresh to see new approval requests promptly
    if (['director', 'admin_officer'].includes(initialUser.role)) {
      const id = setInterval(fetchLeave, 30_000)
      return () => clearInterval(id)
    }
  }, [])

  // Sensitive: never stored in localStorage/app_state — fetched only for privileged roles
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>(seedPayrollRuns)
  const [payslips, setPayslips] = useState<Payslip[]>(seedPayslips)
  const [salaryAdvances, setSalaryAdvances] = useLS<SalaryAdvance[]>('deed_salaryAdvances', [])
  useEffect(() => {
    if (!['director', 'finance_officer'].includes(initialUser.role)) return
    fetch('/api/payroll').then(r => r.ok && r.json().then(data => {
      if (data.runs) setPayrollRuns(data.runs)
      if (data.payslips) setPayslips(data.payslips)
    })).catch(() => {})
  }, [])

  const [jobPostings, setJobPostings] = useLS('deed_jobPostings', seedJobPostings)
  const [candidates, setCandidates] = useLS('deed_candidates', seedCandidates)
  const [trainingPrograms, setTrainingPrograms] = useLS('deed_trainingPrograms', seedTrainingPrograms)
  const [employeeTrainings, setEmployeeTrainings] = useLS('deed_employeeTrainings', seedEmployeeTrainings)

  // Accounting
  const [journalEntries, setJournalEntries] = useLS('deed_journalEntries', seedJournalEntries)
  const [accounts, setAccounts]             = useLS('deed_accounts', seedAccounts)
  const [bankAccounts, setBankAccountsState] = useLS<BankAccount[]>('deed_bankAccounts', DEFAULT_BANK_ACCOUNTS)
  const [companySettings, setCompanySettings] = useLS<CompanySettings>('deed_companySettings', DEFAULT_COMPANY_SETTINGS)
  const [systemSettings, setSystemSettings] = useLS<SystemSettings>('deed_systemSettings', DEFAULT_SYSTEM_SETTINGS)
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
  useEffect(() => {
    const fetchMoves = async () => {
      const res = await fetch('/api/stock-moves')
      if (res.ok) {
        const d = await res.json()
        setStockMoves(Array.isArray(d) ? d : (d.items ?? []))
      }
    }
    fetchMoves()
  }, [])
  
  const [stockAdjustments, setStockAdjustments] = useLS<StockAdjustment[]>('deed_stockAdjustments', [])
  const [stockReservations, setStockReservations] = useLS<StockReservation[]>('deed_stockReservations', [])

  // POS
  const [posOrders, setPosOrders]           = useLS<POSOrder[]>('deed_posOrders', []) // To be migrated
  const [posSessionOpen, setPosSessionOpen] = useLS<boolean>('deed_posSessionOpen', false)
  const [posSessionOpeningCash, setPosSessionOpeningCash] = useLS<number>('deed_posSessionOpeningCash', 0)

  // Approvals & Audit
  const [approvalRequests, setApprovalRequests] = useLS<ApprovalRequest[]>('deed_approvalRequests', [])
  const [auditLogs, setAuditLogs]               = useLS<AuditLog[]>('deed_auditLogs', []) // To be migrated
  const [notifications, setNotifications]       = useLS<AppNotification[]>('deed_notifications', [])
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

  // ── Internal notification pusher ───────────────────────────────────────────
  const pushNotif = useCallback((n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    const notif: AppNotification = { ...n, id: uid(), createdAt: new Date().toISOString(), read: false }
    setNotifications(prev => [notif, ...prev])
  }, [])

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
  const leaveBalRef = useRef(leaveBalances); leaveBalRef.current = leaveBalances
  const leaveReqRef = useRef(leaveRequests); leaveReqRef.current = leaveRequests
  const payrollRef = useRef(payrollRuns); payrollRef.current = payrollRuns
  const salaryAdvancesRef = useRef(salaryAdvances); salaryAdvancesRef.current = salaryAdvances
  const assetRef = useRef(employeeAssetAssignments); assetRef.current = employeeAssetAssignments
  const kilimallOrdersRef = useRef(kilimallOrders); kilimallOrdersRef.current = kilimallOrders
  const kilimallSettlementsRef = useRef(kilimallSettlements); kilimallSettlementsRef.current = kilimallSettlements
  const outsourceJobsRef = useRef(outsourceJobs); outsourceJobsRef.current = outsourceJobs
  const outsourcePaymentsRef = useRef(outsourcePayments); outsourcePaymentsRef.current = outsourcePayments

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
            pushNotif({
              userId: repair.assignedTechnicianId,
              type: 'repair',
              title: approved ? '✅ Quote approved by customer' : '❌ Quote declined by customer',
              body: `${repair.ref} — ${repair.productName}`,
              module: 'repair',
              path: `?id=${repair.id}`,
              icon: approved ? '✅' : '❌',
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
    const id = setInterval(check, 15_000) // Reduced: portal approvals checked every 15s
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll server for new notifications every 15 seconds to sync across computers
  useEffect(() => {
    if (!currentUserId) return
    const checkNotifications = async () => {
      try {
        const res = await fetch(`/api/notifications?userId=${currentUserId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data?.notifications && Array.isArray(data.notifications)) {
          setNotifications(prev => {
            const existingIds = new Set(prev.map(n => n.id))
            const newNotifs = data.notifications.filter((n: AppNotification) => !existingIds.has(n.id))
            if (newNotifs.length > 0) {
              return [...newNotifs, ...prev]
            }
            return prev
          })
        }
      } catch { /* silent */ }
    }
    const id = setInterval(checkNotifications, 30_000) // SSE handles real-time; this is a fallback
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
  }

const storeCtx: AppState = {
    activeModule, sidebarOpen, toast,
    
    // CRM & Contacts
    contacts, companies, contactPersons, opportunities, opportunityActivities, quotes,
    
    // Products & Inventory
    products, productPriceHistory, serials,
    
   // Sales & Invoicing
    saleOrders, invoices, deliveries,

    // Payments & Credit
    payments,
    createPayment: (customerId, customerName, amount, method, reference, notes) => {
      const user = currentUser()
      const payment: Payment = {
        id: uid(), ref: seq('PAY', 'rec'), customerId, customerName, amount, method,
        reference, receiptNumber: seq('RCT', 'rec'), invoices: [], status: 'cleared',
        receivedBy: user?.name ?? 'System', receivedDate: now(), clearedDate: now(),
        accountingDate: now(), notes
      }
      setPayments(prev => [payment, ...prev])
      sync('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payment) })
      addAuditLog('create_payment', payment.ref, `Payment of ${fmtKes(amount)} received from ${customerName}`)
      showToast(`Payment ${payment.ref} recorded successfully`, 'success')
      return payment
    },
    allocatePaymentToInvoice: (paymentId, invoiceId, amount) => {
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance can allocate payments', 'error'); return;
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
          const newAmountPaid = i.amountPaid + amount
          const newStatus = newAmountPaid >= i.total ? 'paid' as const : 'partially_paid' as const
          return { ...i, amountPaid: newAmountPaid, status: newStatus }
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
    
    // Purchasing
    purchaseOrders, receipts, stockTransfers, purchaseReturns, refurbishmentJobs,
    
    // Repairs
    repairs,

    // HR
    departments, employees, contracts, customerContracts,
    leaveBalances, leaveRequests, hrDocuments, workflowApprovals,
    payrollRuns, payslips, salaryAdvances, employeeAssetAssignments,
    jobPostings, candidates, trainingPrograms, employeeTrainings,
    
    addJobPosting: (p) => {
      setJobPostings(prev => [{ ...p, id: uid(), postedDate: now() }, ...prev])
      showToast('Job posting added', 'success')
    },
    updateJobPosting: (id, p) => {
      setJobPostings(prev => prev.map(j => j.id === id ? { ...j, ...p } : j))
      showToast('Job posting updated')
    },
    addCandidate: (c) => {
      setCandidates(prev => [{ ...c, id: uid(), appliedDate: now() }, ...prev])
      showToast('Candidate added', 'success')
    },
    updateCandidate: (id, p) => {
      setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...p } : c))
      showToast('Candidate updated')
    },
    addTrainingProgram: (t) => {
      setTrainingPrograms(prev => [{ ...t, id: uid() }, ...prev])
      showToast('Training program added', 'success')
    },
    enrollEmployeeTraining: (employeeId, trainingId) => {
      setEmployeeTrainings(prev => [{ id: uid(), employeeId, trainingId, status: 'not_started', enrolledDate: now() }, ...prev])
      showToast('Employee enrolled in training', 'success')
    },
    updateTrainingStatus: (id, status, score) => {
      setEmployeeTrainings(prev => prev.map(t => t.id === id ? { ...t, status, score, completedDate: status === 'completed' ? now() : t.completedDate } : t))
      showToast('Training status updated')
    },

    // Accounting
    journalEntries, accounts,

    // Inventory
    warranties, bulkStock, openingStockPosted, stockMoves, stockAdjustments,

    // POS
    posOrders, posSessionOpen, posSessionOpeningCash,

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
    confirmKilimallDispatch: (orderId, serialId, serialNumber) => {
      const user = currentUser()
      if (!user || !['director', 'inventory_officer', 'kilimall_officer'].includes(user.role)) {
        showToast('Unauthorized to dispatch orders', 'error'); return null;
      }
      const order = kilimallOrdersRef.current.find(o => o.id === orderId)
      if (!order) { showToast('Order not found', 'error'); return null }
      if (order.status !== 'pending') { showToast('Order already dispatched', 'error'); return null }
      const dispatch: KilimallDispatch = {
        id: uid(), ref: seq('KD', 'kd'), date: now(),
        orderId: order.id, orderRef: order.ref, kilimallRef: order.kilimallRef,
        productId: order.productId, productName: order.productName,
        serialId, serialNumber, status: 'dispatched',
        createdBy: currentUserId ?? 'system', createdDate: now(),
      }
      setKilimallDispatches(prev => [dispatch, ...prev])
      setKilimallOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, status: 'dispatched', dispatchId: dispatch.id, serialId, serialNumber } : o))
      setSerials(prev => prev.map(s => s.id === serialId ? { ...s, status: 'sold', location: 'customer' } : s))
      showToast(`Dispatched ${order.ref} — serial ${serialNumber}`)
      addAuditLog('kilimall_dispatch', dispatch.id, `Dispatch ${dispatch.ref} for ${order.ref}`)
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
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    },
    markAllNotificationsRead: () => {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
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
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance can save bank reconciliations', 'error'); return;
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
    addBankAccount: (a) => setBankAccountsState(prev => [...prev, { ...a, id: uid() }]),
    deleteBankAccount: (id) => setBankAccountsState(prev => prev.filter(a => a.id !== id)),
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
      // Notify finance officers and admin officers that a new expense needs review
      users.filter(u => ['director', 'finance_officer'].includes(u.role)).forEach(u => pushNotif({
        userId: u.id, type: 'expense',
        title: `Expense claim from ${expense.submittedByName}`,
        body: `${expense.ref} — ${expense.description} · KES ${expense.amount.toLocaleString()}`,
        module: 'expenses',
        icon: '💰',
      }))
      showToast(`Expense ${expense.ref} submitted`, 'success')
      return expense
    },

    reviewExpense: (id, approved, notes) => {
      const user = currentUser()
      if (!user) return
      const expense = expenses.find(e => e.id === id)
      if (!expense) return
      if (expense.status === 'reimbursed') { showToast('Reimbursed expenses cannot be reviewed again', 'error'); return }
      const reviewedExpense: Expense = { ...expense, status: approved ? 'approved' : 'rejected', reviewedByUserId: user.id, reviewedByName: user.name, reviewedDate: now(), reviewNotes: notes }
      setExpenses(prev => prev.map(e => e.id === id ? reviewedExpense : e))
      if (approved && !journalEntries.some(j => j.ref === `JRN/EXP/${expense.ref}`)) {
        const journal = buildExpenseApprovalJournal(reviewedExpense)
        setJournalEntries(prev => [journal, ...prev])
        addAuditLog('post_expense', expense.ref, `Expense ${expense.ref} posted to journal ${journal.ref}`)
      }
      if (expense?.submittedByUserId) {
        pushNotif({
          userId: expense.submittedByUserId,
          type: 'expense',
          title: approved ? 'Expense claim approved ✓' : 'Expense claim rejected',
          body: `Your expense claim ${expense.ref} (${expense.description}) has been ${approved ? 'approved' : 'rejected'} by ${user.name}.${notes ? ' Note: ' + notes : ''}`,
          module: 'expenses',
          path: `?id=${expense.id}`,
          icon: approved ? '💰' : '❌',
        })
      }
      showToast(approved ? 'Expense approved and posted' : 'Expense rejected', approved ? 'success' : 'error')
    },

    reimburseExpense: (id, notes, method, bankAccountId, reference) => {
      const user = currentUser()
      if (!user) return
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
        status: 'sent',
        createdAt: now(),
      }
      setOutsourceJobs(prev => [job, ...prev])
      showToast(`Job ${job.ref} created`, 'success')

      // Notify directors and technical leads — internal only, not visible to client
      const notifBody = `${job.ref}: ${job.deviceDescription} → ${job.vendorName} for ${OUTSOURCE_SERVICE_TYPES.find(t => t.value === job.serviceType)?.label ?? job.serviceType}. Sent by ${user.name}.`
      users.filter(u => ['director', 'technical_lead'].includes(u.role) && u.id !== user.id).forEach(u =>
        pushNotif({ userId: u.id, type: 'info', title: `Repair Outsourced${job.repairOrderId ? '' : ''}`, body: notifBody, module: 'outsource', icon: '🔧' })
      )

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

        if (p.isResolved) {
          setRepairs(prev => prev.map(r =>
            r.id === job.repairOrderId ? { ...r, status: 'qc' as const } : r
          ))
          addAuditLog('advance_repair', job.repairOrderId, `Advanced to QC after outsource job ${job.ref} resolved`)

          // Notify assigned tech + TL/director
          if (repair?.assignedTechnicianId) {
            pushNotif({
              userId: repair.assignedTechnicianId, type: 'repair',
              title: `Outsource returned — ready for QC`,
              body: `${job.ref}: ${job.deviceDescription} came back fixed from ${job.vendorName}. Repair ${repair.ref} is now in QC.`,
              module: 'repair', icon: '✅',
            })
          }
          users.filter(u => ['director', 'technical_lead'].includes(u.role) && u.id !== repair?.assignedTechnicianId).forEach(u =>
            pushNotif({
              userId: u.id, type: 'repair',
              title: `Outsource job ${job.ref} resolved`,
              body: `${job.deviceDescription} returned fixed from ${job.vendorName}. ${repair ? `Repair ${repair.ref} advanced to QC.` : ''}`,
              module: 'outsource', icon: '✅',
            })
          )
        } else {
          // Unresolved — apply next-step to the linked repair
          const nextStep = p.repairNextStep ?? 'keep'
          if (nextStep !== 'keep' && repair) {
            const newStatus = nextStep === 'unrepairable' ? 'unrepairable' as const : 'in_repair' as const
            setRepairs(prev => prev.map(r =>
              r.id === job.repairOrderId ? { ...r, status: newStatus } : r
            ))
            addAuditLog('advance_repair', job.repairOrderId,
              `Status set to ${newStatus} after outsource job ${job.ref} returned unresolved`)
          }

          // Notify assigned tech + TL/director
          const nextLabel = p.repairNextStep === 'unrepairable' ? 'marked unrepairable'
            : p.repairNextStep === 'in_repair' ? 'moved back to in-repair'
            : 'status unchanged'
          if (repair?.assignedTechnicianId) {
            pushNotif({
              userId: repair.assignedTechnicianId, type: 'repair',
              title: `Outsource returned — not fixed`,
              body: `${job.ref}: ${job.deviceDescription} came back unfixed from ${job.vendorName}. Repair ${repair?.ref ?? ''} ${nextLabel}.`,
              module: 'repair', icon: '⚠️',
            })
          }
          users.filter(u => ['director', 'technical_lead'].includes(u.role) && u.id !== repair?.assignedTechnicianId).forEach(u =>
            pushNotif({
              userId: u.id, type: 'repair',
              title: `Outsource job ${job.ref} unresolved`,
              body: `${job.deviceDescription} returned unfixed from ${job.vendorName}. ${repair ? `Repair ${repair.ref} ${nextLabel}.` : ''}`,
              module: 'outsource', icon: '⚠️',
            })
          )
        }
      }

      if (!billId) showToast('Job marked as returned', 'success')
    },

    // Deposits
    deposits,
    createDeposit: (d) => {
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
        const soRef = seq('SO', 'so')
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

    addEmployee: async (employee) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can create employees', 'error'); throw new Error('Unauthorized employee creation') }
      const tempId = uid()
      const record = { ...employee, id: tempId }
      setEmployees(prev => [record, ...prev])

      try {
        const response = await fetch('/api/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(employee),
        })

        if (!response.ok) {
          const payload = await response.json().catch(async () => ({ message: await response.text() }))
          throw new Error(payload?.message ?? 'Unable to save employee')
        }

        const saved = await response.json() as Employee
        setEmployees(prev => prev.map(emp => emp.id === tempId ? saved : emp))
        addAuditLog('create_employee', saved.employeeNo, `Created employee ${saved.fullName}`)
        showToast('Employee created')
        return saved
      } catch (error) {
        setEmployees(prev => prev.filter(emp => emp.id !== tempId))
        showToast(`Employee was not saved to the database: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
        throw error
      }
    },
    updateEmployee: (id, patch) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can update employees', 'error'); return }
      setEmployees(prev => {
        const before = prev.find(e => e.id === id)
        const next = prev.map(emp => emp.id === id ? { ...emp, ...patch } : emp)
        const updated = next.find(e => e.id === id)
        if (updated) {
          sync(`/api/employees/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            .then(async response => {
              if (!response.ok) throw new Error(await response.text())
              return response.json() as Promise<Employee>
            })
            .then(saved => setEmployees(current => current.map(emp => emp.id === id ? saved : emp)))
            .catch(error => {
              if (before) setEmployees(current => current.map(emp => emp.id === id ? before : emp))
              showToast(`Employee update was not saved to the database: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
            })
        }
        return next
      })
      addAuditLog('update_employee', id, `Updated employee ${id}`)
      showToast('Employee updated')
    },
    addLeaveRequest: (request) => {
      const user = currentUser()
      if (!user) { showToast('You must be logged in to apply for leave', 'error'); throw new Error('Not authenticated') }

      // Block system-only type from manual submission
      if (request.leaveType === 'december_closure') {
        showToast('December closure is applied automatically — no manual request needed', 'error')
        throw new Error('december_closure is system-managed')
      }

      // ── Notice period check ──────────────────────────────────────────────
      const required = requiredNotice(request.leaveType, request.days)
      if (required > 0) {
        const given = noticeDaysGiven(request.startDate)
        if (given < required) {
          showToast(
            `Insufficient notice: ${request.days <= 3 ? '≤3 day leave requires 5' : '>3 day leave requires 14'} working days notice. ` +
            `Only ${given} working day${given !== 1 ? 's' : ''} until your start date.`,
            'error'
          )
          throw new Error('Insufficient notice period')
        }
      }

      // ── Overlap detection ────────────────────────────────────────────────
      const conflict = leaveReqRef.current.find(r =>
        r.employeeId === request.employeeId &&
        r.status !== 'rejected' && r.status !== 'cancelled' &&
        new Date(r.startDate) <= new Date(request.endDate) &&
        new Date(r.endDate)   >= new Date(request.startDate)
      )
      if (conflict) {
        showToast(`Dates overlap with existing request ${conflict.ref} (${conflict.startDate} – ${conflict.endDate})`, 'error')
        throw new Error('Leave dates overlap')
      }

      // ── Balance check (skip for unpaid) ───────────────────────────────────
      const year = new Date(request.startDate).getFullYear()
      const existingBalance = leaveBalRef.current.find(b => b.employeeId === request.employeeId && b.leaveType === request.leaveType && b.year === year)
      if (request.leaveType !== 'unpaid') {
        const bal = existingBalance ?? {
          id: uid(),
          employeeId: request.employeeId,
          leaveType: request.leaveType,
          year,
          entitlement: LEAVE_ENTITLEMENTS[request.leaveType] ?? 0,
          carryForward: 0,
          used: 0,
          pending: 0,
        }
        if (bal) {
          const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
          if (request.days > available) {
            showToast(`Insufficient ${request.leaveType.replace(/_/g, ' ')} balance — ${available} day(s) available, ${request.days} requested`, 'error')
            throw new Error('Insufficient balance')
          }
        }
      }

      const isHRBooking = ['director', 'admin_officer'].includes(user.role)
      const leave: LeaveRequest = {
        ...request,
        id: uid(),
        ref: seq('LV', 'ret'),
        submittedDate: now(),
        status: isHRBooking ? 'approved' : 'pending_hr',
        submittedByUserId: user.id,
        ...(isHRBooking ? { hrApprovalBy: user.name, hrDecisionDate: now() } : {}),
      }
      setLeaveRequests(prev => [leave, ...prev])
      let nextBalancesForEmployee: LeaveBalance[] = []
      setLeaveBalances(prev => {
        const hasExisting = prev.some(b => b.employeeId === leave.employeeId && b.leaveType === leave.leaveType && b.year === year)
        const base = hasExisting ? prev : [
          ...prev,
          {
            id: uid(),
            employeeId: leave.employeeId,
            leaveType: leave.leaveType,
            year,
            entitlement: LEAVE_ENTITLEMENTS[leave.leaveType] ?? 0,
            carryForward: 0,
            used: 0,
            pending: 0,
          } as LeaveBalance,
        ]
        const next = base.map(b =>
          b.employeeId === leave.employeeId && b.leaveType === leave.leaveType && b.year === year
            ? isHRBooking
              ? { ...b, used: b.used + leave.days }
              : { ...b, pending: b.pending + leave.days }
            : b
        )
        nextBalancesForEmployee = next.filter(b => b.employeeId === leave.employeeId)
        return next
      })
      if (!isHRBooking) {
        const approval: WorkflowApproval = { id: uid(), process: 'leave', ref: leave.ref, targetId: leave.id, targetName: `${leave.employeeName} — ${leave.leaveType.replace(/_/g, ' ')}`, stepName: 'HR Approval', approverRole: 'director', status: 'pending', requestedBy: leave.employeeName, requestedDate: now() }
        setWorkflowApprovals(prev => [approval, ...prev])
        users.filter(u => u.role === 'director').forEach(u => pushNotif({
          userId: u.id, type: 'leave',
          title: `Leave request from ${leave.employeeName}`,
          body: `${leave.days} day(s) ${leave.leaveType.replace(/_/g, ' ')} — ${leave.startDate} to ${leave.endDate}. Reason: ${leave.reason}`,
          module: 'hr', path: '?tab=leave', icon: '🌴',
        }))
      } else {
        // Notify the employee that HR has booked leave on their behalf
        const emp = empRef.current.find(e => e.id === leave.employeeId)
        if (emp?.userId) pushNotif({
          userId: emp.userId, type: 'leave',
          title: 'Leave booked for you',
          body: `${user.name} has booked ${leave.days} day(s) ${leave.leaveType.replace(/_/g, ' ')} for you — ${leave.startDate} to ${leave.endDate}.`,
          module: 'hr', path: '?tab=self_service', icon: '🌴',
        })
      }
      addAuditLog('create_leave', leave.ref, isHRBooking ? `Leave booked for ${leave.employeeName} by ${user.name} (auto-approved)` : `Leave request created for ${leave.employeeName}`)
      showToast(isHRBooking ? `Leave booked and approved for ${leave.employeeName}` : 'Leave application submitted — awaiting HR approval')
      // ── Persist to DB ──────────────────────────────────────────────────────
      sync('/api/leave-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...leave, balances: nextBalancesForEmployee }) })
      return leave
    },
    decideLeaveRequest: (id, approved, note) => {
      const leave = leaveRequests.find(req => req.id === id)
      if (!leave) return
      const user = currentUser()
      
      let canApprove = false;
      if (['director', 'admin_officer', 'finance_officer'].includes(user?.role ?? '')) canApprove = true;
      if (user?.role === 'technical_lead') {
        const targetEmp = empRef.current.find(e => e.id === leave.employeeId);
        const targetUser = users.find(u => u.id === targetEmp?.userId);
        if (targetUser?.role === 'technician') canApprove = true;
      }

      if (!canApprove) {
        showToast('Only an Admin or Lead Tech (for Technicians) can approve or reject leave requests', 'error'); return
      }
      const nextStatus: LeaveRequest['status'] = approved ? 'approved' : 'rejected'
      const year = new Date(leave.startDate).getFullYear()
          
          setLeaveRequests(prev => {
            const nextReqs = prev.map(req => req.id === id ? { ...req, status: nextStatus, hrApprovalBy: user.name, hrDecisionDate: now() } : req)
            const updatedReq = nextReqs.find(r => r.id === id)
            
            setLeaveBalances(balPrev => {
              const nextBals = balPrev.map(b => b.employeeId === leave.employeeId && b.leaveType === leave.leaveType && b.year === year 
                ? (approved ? { ...b, pending: Math.max(0, b.pending - leave.days), used: b.used + leave.days } : { ...b, pending: Math.max(0, b.pending - leave.days) }) : b)
              if (updatedReq) sync(`/api/leave-requests/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: updatedReq, balances: nextBals.filter(b => b.employeeId === leave.employeeId) }) })
              return nextBals
            })
            return nextReqs
          })

      setWorkflowApprovals(prev => prev.map(flow => flow.targetId === id && flow.status === 'pending' ? { ...flow, status: approved ? 'approved' : 'rejected', approverUserId: user.id, decisionDate: now() } : flow))
      // Notify the employee whose leave was decided
      const emp = empRef.current.find(e => e.id === leave.employeeId)
      const empUserId = emp?.userId
      if (empUserId) {
        pushNotif({
          userId: empUserId,
          type: 'leave',
          title: approved ? 'Leave request approved ✓' : 'Leave request rejected',
          body: `Your ${leave.leaveType.replace(/_/g, ' ')} request (${leave.days} day${leave.days !== 1 ? 's' : ''}, ${leave.startDate} – ${leave.endDate}) has been ${approved ? 'approved' : 'rejected'} by ${user.name}.`,
          module: 'hr',
          path: '?tab=self_service',
          icon: approved ? '✅' : '❌',
        })
      }
      addAuditLog('decide_leave', leave.ref, `Leave request ${approved ? 'approved' : 'rejected'} by ${user.name}${note ? ': ' + note : ''}`)
      showToast(`Leave ${approved ? 'approved' : 'rejected'} successfully`)
    },

    cancelLeaveRequest: (id) => {
      const user = currentUser()
      const req = leaveReqRef.current.find(r => r.id === id)
      if (!req) return
      if (req.status === 'rejected' || req.status === 'cancelled') { showToast('This request is already closed', 'error'); return }
      const isHR  = ['director', 'admin_officer', 'finance_officer'].includes(user?.role ?? '')
      const isOwn = req.submittedByUserId === user?.id
      if (!isHR && !isOwn) { showToast('You can only cancel your own leave requests', 'error'); return }
      const year = new Date(req.startDate).getFullYear()
      setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' as const } : r))
      setLeaveBalances(prev => prev.map(b => {
        if (b.employeeId !== req.employeeId || b.leaveType !== req.leaveType || b.year !== year) return b
        if (req.status === 'pending_hr') return { ...b, pending: Math.max(0, b.pending - req.days) }
        if (req.status === 'approved')   return { ...b, used:    Math.max(0, b.used    - req.days) }
        return b
      }))
      addAuditLog('cancel_leave', req.ref, `Leave request cancelled by ${user?.name}`)
      showToast('Leave request cancelled')
      // ── Persist to DB ──────────────────────────────────────────────────────
      const cancelledBals = leaveBalRef.current.filter(b => b.employeeId === req.employeeId)
      sync(`/api/leave-requests/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: { ...req, status: 'cancelled' }, balances: cancelledBals }) })
    },

    updateLeaveBalance: (id, patch) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can adjust leave balances', 'error'); return }
      setLeaveBalances(prev => {
        const next = prev.map(b => b.id === id ? { ...b, ...patch } : b)
        // ── Persist to DB ──────────────────────────────────────────────────────
        const bal = next.find(b => b.id === id)
        if (bal) sync('/api/leave-requests/balances', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ balances: next.filter(b => b.employeeId === bal.employeeId) }) })
        return next
      })
      addAuditLog('adjust_leave_balance', id, `Balance adjusted by ${currentUser()?.name}`)
      showToast('Leave balance updated')
    },

    initYearBalances: (year) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can initialise leave balances', 'error'); return }
      const ALL_TYPES: StoreLeaveType[] = ['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid', 'december_closure']
      const activeEmps = empRef.current.filter(e => e.status === 'active')
      let created = 0
      setLeaveBalances(prev => {
        const next = [...prev]
        for (const emp of activeEmps) {
          for (const type of ALL_TYPES) {
            if (!next.find(b => b.employeeId === emp.id && b.leaveType === type && b.year === year)) {
              next.push({ id: uid(), employeeId: emp.id, leaveType: type, year, entitlement: LEAVE_ENTITLEMENTS[type], used: 0, pending: 0, carryForward: 0 })
              created++
            }
          }
        }
        return next
      })
      addAuditLog('init_leave_balances', String(year), `Balances initialised for ${year} (${created} records)`)
      showToast(`Leave balances initialised for ${year} — ${created} record(s) created`)
      // ── Persist to DB ──────────────────────────────────────────────────────
      sync('/api/leave-requests/balances', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ balances: leaveBalRef.current }) })
    },

    applyDecemberClosure: (year) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can apply December closure', 'error'); return }
      const activeEmps = empRef.current.filter(e => e.status === 'active')
      const startDate  = `${year}-12-23`
      const endDate    = `${year + 1}-01-02`
      const days       = decemberClosureDays(year)  // actual working days excl. public holidays
      let applied = 0
      const newReqs: LeaveRequest[] = []
      for (const emp of activeEmps) {
        const alreadyApplied = leaveReqRef.current.some(r =>
          r.employeeId === emp.id && r.leaveType === 'december_closure' &&
          r.startDate === startDate && r.status !== 'rejected' && r.status !== 'cancelled'
        )
        if (alreadyApplied) continue
        newReqs.push({
          id: uid(), ref: seq('LV', 'ret'),
          employeeId: emp.id, employeeName: emp.fullName,
          leaveType: 'december_closure',
          startDate, endDate, days,
          reason: `Deed Technologies mandatory year-end closure ${year}/${year + 1}`,
          status: 'approved', submittedDate: now(), isSystemGenerated: true,
        })
        applied++
      }
      if (newReqs.length > 0) {
        setLeaveRequests(prev => [...newReqs, ...prev])
        setLeaveBalances(prev => prev.map(b => {
          if (b.leaveType !== 'december_closure' || b.year !== year) return b
          if (!newReqs.find(r => r.employeeId === b.employeeId)) return b
          return { ...b, used: b.used + days }
        }))
      }
      addAuditLog('apply_dec_closure', String(year), `December closure ${year} applied to ${applied} employees (${days} working days each)`)
      showToast(applied > 0
        ? `December closure applied to ${applied} employee${applied !== 1 ? 's' : ''} (${days} working days)`
        : 'December closure already applied to all active employees'
      )
      // ── Persist to DB ──────────────────────────────────────────────────────
      if (newReqs.length > 0) {
        sync('/api/leave-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bulkRequests: newReqs, balances: leaveBalRef.current }) })
      }
    },

    expireYearEndBalances: (year) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can expire leave balances', 'error'); return }
      let expired = 0
      setLeaveBalances(prev => prev.map(b => {
        if (b.leaveType !== 'annual' || b.year !== year) return b
        const remaining = b.entitlement + b.carryForward - b.used - b.pending
        if (remaining <= 0) return b
        expired++
        // Forfeit remaining days: set used = entitlement + carryForward - pending
        return { ...b, used: b.entitlement + b.carryForward - b.pending }
      }))
      addAuditLog('expire_leave', String(year), `Year-end forfeiture: ${expired} employee(s) lost unused annual days for ${year}`)
      showToast(expired > 0
        ? `Expired: ${expired} employee${expired !== 1 ? 's' : ''} forfeited unused annual days for ${year}`
        : `No unused annual leave to expire for ${year}`
      )
      // ── Persist to DB ──────────────────────────────────────────────────────
      sync('/api/leave-requests/balances', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ balances: leaveBalRef.current }) })
    },

    createPayrollRun: (month, year) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can prepare payroll', 'error'); throw new Error('Unauthorized payroll run creation') }
      const periodKey = `${year}-${month}`
      const recoveryUpdates = new Map<string, SalaryAdvance>()
      const lines = empRef.current.filter(emp => emp.status === 'active').map(emp => {
        const baseLine = computePayrollLine(emp)
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
      if (!['director', 'finance_officer', 'admin_officer'].includes(user?.role ?? '')) {
        showToast('Only HR or Finance approvers can review salary advances', 'error')
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
      addAuditLog('salary_advance_paid', advance.ref, `Marked paid by ${user?.name}`)
      showToast('Salary advance marked as paid')
    },
    cancelSalaryAdvance: (id) => {
      const user = currentUser()
      const advance = salaryAdvancesRef.current.find(item => item.id === id)
      if (!advance) return
      if (advance.status !== 'pending') { showToast('Only pending advances can be cancelled', 'error'); return }
      if (advance.createdByUserId !== user?.id && !['director', 'finance_officer', 'admin_officer'].includes(user?.role ?? '')) {
        showToast('You can only cancel your own pending advance', 'error')
        return
      }
      salaryAdvancesRef.current = salaryAdvancesRef.current.map(item => item.id === id ? { ...item, status: 'cancelled' as const } : item)
      setSalaryAdvances(prev => prev.map(item => item.id === id ? { ...item, status: 'cancelled' as const } : item))
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
        pushNotif({
          userId: empUserId2,
          type: 'asset',
          title: 'Asset assigned to you',
          body: `${product.name}${serial ? ` (S/N: ${serial.serial})` : ` ×${qty}`} has been issued to you. Please acknowledge receipt.`,
          module: 'hr',
          path: '?tab=self_service',
          icon: '💻',
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
          intakeDate: now(),
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
    addHRDocument: (document) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can add HR documents', 'error'); throw new Error('Unauthorized HR document creation') }
      const doc = { ...document, id: uid() }
      setHRDocuments(prev => [doc, ...prev])
      addAuditLog('add_hr_document', doc.title, `Added document ${doc.title}`)
      showToast('HR document added')
      return doc
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
      setHRDocuments(prev => [doc, ...prev])
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
      if (res.ok) {
        const updated = await res.json()
        setContacts(prev => prev.map(c => c.id === id ? updated : c))
        showToast('Contact updated', 'success')
      }
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
    createQuote: (quoteInput) => {
      const user = currentUser()
      if (!user) { showToast('Please log in to continue', 'error'); return null }
      
      const quoteRef = seq('QTE', 'quote')
      const createdAt = now()
      const quote: Quote = {
        ...quoteInput,
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
      
      const unitPrice = customPrice ?? product.salePrice
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
        listPrice: product.salePrice,
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
        request.approvers[0]?.approverIds.forEach(approverId => pushNotif({
          userId: approverId,
          type: 'system',
          title: `Quote approval needed: ${existing.ref ?? existing.quoteNumber}`,
          body: request.details.reason,
          module: 'sales',
          icon: '⚠️',
        }))
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
    convertQuoteToSaleOrder: (quoteId) => {
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
        ref: seq('SO', 'so'),
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

      // NEW: Reserve stock after SO creation (Phase 1 Step 2)
      so.lines.forEach(line => {
        reserveStock(line.productId, line.qty, 'sales_order', so.id, so.ref)
      })
      
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

    convertRepairQuoteToSOAndInvoice: (quoteId) => {
      const quote = quotes.find(q => q.id === quoteId)
      if (!quote || quote.source !== 'repair') return null

      const soId = uid()
      const soRef = seq('SO', 'so')
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
        status: 'confirmed',
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
        ref: seq('INV', 'inv'),
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

    reviseQuote: (quoteId, changes) => {
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
        ref: seq('QTE', 'quote'),
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
      // Auto-generate barcode if not provided
      const barcode = p.barcode?.trim() || `DEED${Date.now().toString(36).toUpperCase().slice(-8)}`
      p = { ...p, barcode }
      // Optimistic update — add immediately so the UI responds
      const tempId = uid()
      const optimistic = { ...p, id: tempId, stockQty: 0, createdAt: new Date().toISOString() }
      setProducts(prev => [...prev, optimistic as any])
      showToast(`${p.name} created`, 'success')

      // Background sync to database
      try {
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        })
        if (res.ok) {
          const saved = await res.json()
          // Replace temp record with the real DB record (has the real id)
          setProducts(prev => prev.map(x => x.id === tempId ? { ...saved, stockQty: saved.stockQty ?? 0 } : x))
          return saved
        }
        // API failed — keep optimistic record in local state
      } catch {
        // Network error — keep optimistic record in local state
      }
      return optimistic as any
    },
    updateProduct: (id, p) => {
      setProducts(prev => prev.map(x => {
        if (x.id !== id) return x
        const updated = { ...x, ...p }
        const catCfg = CATEGORY_CONFIG[updated.category as CategoryId]
        if (catCfg) updated.requiresSerial = catCfg.serialRequired
        return updated
      }))
      showToast('Product master updated')
      fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
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
      const patch: Partial<Product> = { salePrice, costPrice, priceUpdatedAt: updatedAt, priceUpdatedBy: updatedByName }
      setProducts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
      setProductPriceHistory(prev => [history, ...prev])
      fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(() => {})
      addAuditLog('update_product_price', product.sku || product.name, `Price updated for ${product.name}: ${fmtKes(history.oldSalePrice)} → ${fmtKes(salePrice)}. Reason: ${history.reason}`)
      showToast(`Price updated for ${product.name}`, 'success')
      return history
    },
    deleteProduct: (id) => {
      if (!canApproveInventoryAction(currentUser())) { showToast('Only inventory approvers can delete product masters', 'error'); return }
      setProducts(p => p.filter(x => x.id !== id))
      setBulkStock(p => p.filter(level => level.productId !== id))
      showToast('Product deleted')
      fetch(`/api/products/${id}`, { method: 'DELETE' }).catch(() => {})
    },
    importOpeningStock: (items) => {
      if (!canApproveInventoryAction(currentUser())) { showToast('Only inventory approvers can post opening stock', 'error'); return }
      if (openingStockPosted) { showToast('Opening stock has already been posted and is locked', 'error'); return }
      items.forEach(item => {
        const prod = prodRef.current.find(x => x.id === item.productId)
        if (!prod) return
        const loc = item.location ?? 'warehouse'
      if (prod.requiresSerial && item.serials) {
        if (item.serials.length !== item.qty) {
          showToast(`Opening stock for ${prod.name} requires one serial per unit`, 'error')
          return
        }
        if (item.serials.some(serial => serialRef.current.find(x => x.serial === serial))) {
          showToast(`Duplicate serial detected while posting opening stock for ${prod.name}`, 'error')
          return
        }
        item.serials.forEach(s => {
            const newSerial: SerialNumber = { id: uid(), serial: s, productId: item.productId, productName: prod.name, location: loc, status: 'available', receivedDate: now(), barcode: s }
            setSerials(p => [...p, newSerial])
            sync('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
          })
          setProducts(p => p.map(x => x.id === item.productId ? { ...x, stockQty: x.stockQty + (item.serials?.length ?? 0) } : x))
          addMove(item.productId, prod.name, item.serials.length, 'in', 'Opening stock', 'OPENING', undefined, loc, item.serials)
        } else {
          setBulkStock(prev => upsertBulkStock(prev, item.productId, loc, item.qty))
          setProducts(p => p.map(x => x.id === item.productId ? { ...x, stockQty: x.stockQty + item.qty } : x))
          addMove(item.productId, prod.name, item.qty, 'in', 'Opening stock', 'OPENING', undefined, loc)
        }
      })
      setOpeningStockPosted(true)
      addAuditLog('opening_stock', 'OPENING', `Opening stock posted — ${items.length} product(s)`)
      showToast('Opening stock posted · locked against further changes')
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

    getSalesApprovalState: (documentId: string) => {
      const requests = approvalRequests.filter(r => r.documentId === documentId && ['discount', 'credit_override', 'backorder'].includes(r.type))
      if (requests.length === 0) return { status: 'not_required', requests }
      if (requests.some(r => r.status === 'rejected')) return { status: 'rejected', requests }
      if (requests.some(r => r.status === 'pending')) return { status: 'pending', requests }
      return { status: 'approved', requests }
    },

    // ── Sale Orders ───────────────────────────────────────────────────────────
    createSaleOrder: (customerId, customerName, initial = {}) => {
      const user = currentUser()
      const initialLines = initial.lines ?? []
      const totals = calcSO(initialLines)
      const so: SaleOrder = {
        id: uid(), ref: seq('SO', 'so'), status: 'quotation', customerId, customerName,
        date: now(), validUntil: initial.validUntil ?? addDays(now(), 30), lines: initialLines, ...totals,
        approvalStatus: 'not_required', approvalRequestIds: [], stockReservationIds: [],
        deliveryDate: initial.deliveryDate,
        paymentTerms: initial.paymentTerms,
        notes: initial.notes ?? '',
        createdByUserId: user?.id, createdByName: user?.name,
      }
      setSaleOrders(p => [so, ...p])
      sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })
      showToast(`${so.ref} created`)
      return so
    },
    updateSaleOrder: (id, p) => setSaleOrders(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...p } : s)
      const updated = next.find(s => s.id === id)
      if (updated) sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      return next
    }),
    addSOLine: (orderId, product, qty, discount = 0, defaultTaxRate = 0) => {
      if (qty <= 0) {
        showToast('Quantity must be greater than zero', 'error')
        return
      }
      const locs = calcStockByLocation(product, serialRef.current, bulkStock, product.id)
      const shopQty = locs.shop
      const warehouseQty = locs.warehouse
      const avail = serialRef.current.filter(s => s.productId === product.id && s.status === 'available' && (s.location === 'warehouse' || s.location === 'shop')).length
      if (product.requiresSerial && avail < qty) { showToast(`Only ${avail} units available for stock out`, 'error'); return }
      if (!product.requiresSerial && product.unit !== 'service' && shopQty + warehouseQty < qty) { showToast(`Only ${shopQty + warehouseQty} units available for stock out`, 'error'); return }
      setSaleOrders(p => p.map(so => {
        if (so.id !== orderId) return so
        const ex = so.lines.find(l => l.productId === product.id)
        let lines: SaleOrderLine[]
        if (ex) {
          lines = so.lines.map(l => l.productId === product.id ? { ...l, qty: l.qty + qty, subtotal: Math.round(product.salePrice * (l.qty + qty) * (1 - l.discount / 100)) } : l)
        } else {
          const sub = Math.round(product.salePrice * qty * (1 - discount / 100))
          lines = [...so.lines, { id: uid(), productId: product.id, productName: product.name, qty, unitPrice: product.salePrice, discount, taxRate: product.taxRate > 0 ? product.taxRate : defaultTaxRate, subtotal: sub, serialIds: [], accountCode: product.saleAccountCode }]
        }
        const updated = { ...so, lines, ...calcSO(lines) }
        sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
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
        sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      setSerials(p => p.map(s => s.id === serialId ? { ...s, status: 'assigned' } : s))
    },
    removeSOLine: (orderId, lineId) => {
      const so = soRef.current.find(s => s.id === orderId)
      const line = so?.lines.find(l => l.id === lineId)
      if (line?.serialIds.length) {
        setSerials(p => p.map(s => line.serialIds.includes(s.id) ? { ...s, status: 'available' } : s))
      }
      setSaleOrders(p => p.map(so => { 
        if (so.id !== orderId) return so; 
        const lines = so.lines.filter(l => l.id !== lineId); 
        const updated = { ...so, lines, ...calcSO(lines) }
        sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
    },
    confirmSO: (id) => {
      const user = currentUser()
      if (!user || !['director', 'sales_rep', 'admin_officer'].includes(user.role)) {
        showToast('Unauthorized to confirm Sales Orders', 'error'); return;
      }
      const so = soRef.current.find(s => s.id === id)!
      const salesApprovalRequests = approvalRequests.filter(r =>
        r.documentId === id && ['discount', 'credit_override', 'backorder'].includes(r.type)
      )
      if (salesApprovalRequests.some(r => r.status === 'rejected')) {
        showToast(`${so.ref} has a rejected approval request. Revise the order before confirming.`, 'error')
        return
      }
      if (salesApprovalRequests.some(r => r.status === 'pending')) {
        showToast(`${so.ref} is awaiting approval before confirmation`, 'info')
        return
      }

      const approvers = users.map(u => ({ id: u.id, name: u.name, role: u.role }))
      const newApprovalRequests: ApprovalRequest[] = []
      const existingTypes = new Set(salesApprovalRequests.map(r => r.type))
      const maxDiscount = so.lines.reduce((max, line) => Math.max(max, Number(line.discount) || 0), 0)
      if (maxDiscount > 10 && !existingTypes.has('discount')) {
        const discountDetails = {
          reason: `Sales order ${so.ref} includes discount above 10%`,
          discountPercent: maxDiscount,
          discountAmount: so.lines.reduce((sum, line) => {
            const listTotal = Number(line.unitPrice || 0) * Number(line.qty || 0)
            return sum + Math.max(0, listTotal - Number(line.subtotal || 0))
          }, 0),
          currentValue: so.total,
          proposedValue: so.total,
        }
        newApprovalRequests.push(createApprovalRequest('discount', 'sales_order', so.id, so.ref, user.id, user.name, discountDetails, approvers))
      }

      const customerCredit = (() => {
        const contact = contacts.find(c => c.id === so.customerId)
        const unpaidInvoices = invoices.filter(inv =>
          inv.partnerId === so.customerId &&
          inv.type === 'customer_invoice' &&
          inv.status !== 'paid' &&
          inv.status !== 'cancelled'
        )
        const outstandingBalance = unpaidInvoices.reduce((sum, inv) => sum + Math.max(0, inv.total - inv.amountPaid), 0)
        const overdueBalance = unpaidInvoices
          .filter(inv => inv.dueDate < now())
          .reduce((sum, inv) => sum + Math.max(0, inv.total - inv.amountPaid), 0)
        const creditLimit = contact?.creditLimit ?? 0
        const creditAvailable = creditLimit > 0 ? Math.max(0, creditLimit - outstandingBalance) : -1
        return { creditLimit, creditAvailable, outstandingBalance, overdueBalance, creditLimitExceeded: creditLimit > 0 && outstandingBalance + so.total > creditLimit }
      })()
      if (customerCredit.overdueBalance > 0) {
        showToast(`Account locked by overdue balance of ${fmtKes(customerCredit.overdueBalance)}. Clear overdue invoices before confirming.`, 'error')
        return
      }
      if (customerCredit.creditLimitExceeded && !existingTypes.has('credit_override')) {
        newApprovalRequests.push(createApprovalRequest('credit_override', 'sales_order', so.id, so.ref, user.id, user.name, {
          reason: `Credit limit override required for ${so.customerName}`,
          creditRequested: so.total,
          creditAvailable: customerCredit.creditAvailable,
          currentValue: customerCredit.outstandingBalance,
          proposedValue: customerCredit.outstandingBalance + so.total,
        }, approvers))
      }

      const stockValidation = validateSalesOrderCreation(so.lines, prodRef.current, stockReservations, {
        allowSaleWithoutStock: false,
        allowBackorders: true,
        requireSerialForTrackedItems: false,
      })
      const backorderLines = so.lines.flatMap(line => {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product || product.unit === 'service') return []
        const reserved = stockReservations
          .filter(r => r.productId === line.productId && r.status === 'reserved')
          .reduce((sum, r) => sum + r.qty, 0)
        const available = Math.max(0, product.stockQty - reserved)
        return available < line.qty ? [{ productId: line.productId, productName: line.productName, qtyOrdered: line.qty, qtyAvailable: available, qtyBackordered: line.qty - available }] : []
      })
      if (stockValidation.requiresApproval && !existingTypes.has('backorder')) {
        newApprovalRequests.push(createApprovalRequest('backorder', 'sales_order', so.id, so.ref, user.id, user.name, {
          reason: stockValidation.approvalReasons.join('; '),
          backorderQty: backorderLines.reduce((sum, line) => sum + line.qtyBackordered, 0),
          currentValue: backorderLines.reduce((sum, line) => sum + line.qtyAvailable, 0),
          proposedValue: backorderLines.reduce((sum, line) => sum + line.qtyOrdered, 0),
        }, approvers))
      }

      if (newApprovalRequests.length > 0) {
        const allRequestIds = [...salesApprovalRequests.map(r => r.id), ...newApprovalRequests.map(r => r.id)]
        setApprovalRequests(prev => [...newApprovalRequests, ...prev])
        const approvalRequiredReason = newApprovalRequests.map(req => `${req.type}: ${req.details.reason}`).join(' | ')
        setSaleOrders(prev => prev.map(s => {
          if (s.id !== id) return s
          const updated = {
            ...s,
            status: 'pending_approval' as const,
            approvalStatus: 'pending' as const,
            approvalRequestIds: allRequestIds,
            approvalRequiredReason,
            backorderLines: backorderLines.length ? backorderLines : s.backorderLines,
            discountApprovalId: newApprovalRequests.find(r => r.type === 'discount')?.id ?? s.discountApprovalId,
            creditOverrideApprovalId: newApprovalRequests.find(r => r.type === 'credit_override')?.id ?? s.creditOverrideApprovalId,
            backorderApprovalId: newApprovalRequests.find(r => r.type === 'backorder')?.id ?? s.backorderApprovalId,
          }
          sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
        newApprovalRequests.forEach(req => {
          req.approvers[0]?.approverIds.forEach(approverId => pushNotif({
            userId: approverId,
            type: 'system',
            title: `Approval needed: ${so.ref}`,
            body: req.details.reason,
            module: 'sales',
            icon: '⚠️',
          }))
        })
        addAuditLog('sales_approval_requested', so.ref, approvalRequiredReason)
        showToast(`${so.ref} sent for approval`, 'info')
        return
      }

      // Validate serial assignment for serialized products
      for (const line of so.lines) {
        const prod = prodRef.current.find(p => p.id === line.productId)
        if (prod?.requiresSerial && line.serialIds.length < line.qty) {
          showToast(`Assign all serial numbers for ${line.productName} (${line.serialIds.length}/${line.qty} assigned)`, 'error'); return
        }
      }
      const reservationsToCreate = so.lines.flatMap(line => {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product || product.unit === 'service') return []
        const existing = stockReservations.find(r =>
          r.productId === line.productId &&
          r.referenceId === so.id &&
          r.status === 'reserved'
        )
        if (existing) return []
        const reservation: StockReservation = {
          id: uid(),
          productId: line.productId,
          productName: line.productName,
          qty: line.qty,
          reservedFor: 'sales_order',
          referenceId: so.id,
          referenceRef: so.ref,
          referenceType: 'sales_order',
          location: (line.sourceLocation ?? 'warehouse') as string,
          reservedBy: user.id,
          reservedDate: now(),
          expiresDate: addDays(now(), 7),
          status: 'reserved',
          fulfilledQty: 0,
          serialNumbers: line.serialIds.map((sid: string) => serialRef.current.find(s => s.id === sid)?.serial ?? sid),
          notes: `Reserved during confirmation of ${so.ref}`,
        }
        return [reservation]
      })
      if (reservationsToCreate.length > 0) {
        setStockReservations(prev => [...reservationsToCreate, ...prev])
        addAuditLog('reserve_stock', so.ref, `Reserved ${reservationsToCreate.reduce((sum, r) => sum + r.qty, 0)} item(s) for sales order confirmation`)
      }
      const del: Delivery = {
        id: uid(), ref: seq('OUT', 'del'), saleOrderId: id, saleOrderRef: so.ref,
        customerId: so.customerId, customerName: so.customerName,
        status: 'ready', date: now(),
        lines: so.lines.map(l => {
          const prod = prodRef.current.find(p => p.id === l.productId)
          const shopAvailable = serialRef.current.filter(s => s.productId === l.productId && s.status === 'available' && s.location === 'shop').length
          const sourceLocs = calcStockByLocation(prod, serialRef.current, bulkStock, l.productId)
          const selectedSource = (so.lines.find(line => line.id === l.id) as (SaleOrderLine & { sourceLocation?: LocationId }) | undefined)?.sourceLocation
          const sourceLocation: LocationId | undefined = prod?.unit === 'service' ? undefined : (selectedSource ?? (prod?.requiresSerial ? (shopAvailable >= l.qty ? 'shop' : 'warehouse') : (sourceLocs.shop >= l.qty ? 'shop' : 'warehouse')))
          return { productId: l.productId, productName: l.productName, qty: l.qty, qtyDone: 0, serialIds: l.serialIds, sourceLocation }
        }),
        warrantyCreated: false,
      }
      setDeliveries(p => [del, ...p])
      sync('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(del) })
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s;
        const updated = {
          ...s,
          status: 'confirmed' as const,
          approvalStatus: salesApprovalRequests.length ? 'approved' as const : 'not_required' as const,
          stockReservationIds: Array.from(new Set([...(s.stockReservationIds ?? []), ...reservationsToCreate.map(r => r.id)])),
          deliveryId: del.id,
        }
        sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      showToast(`${so.ref} confirmed — delivery ${del.ref} created`)
    },
    validateDelivery: (deliveryId) => {
      if (!canApproveInventoryAction(currentUser())) {
        showToast('Only Inventory or Admin can validate deliveries', 'error'); return;
      }
      const del = delRef.current.find(d => d.id === deliveryId)!
      const so  = soRef.current.find(s => s.id === del.saleOrderId)!
      // Mark serials as sold
      const newWarranties: Warranty[] = []
      del.lines.forEach(l => {
        const prod = prodRef.current.find(x => x.id === l.productId)
        // Update stock qty
        if (prod) {
          if (!prod.requiresSerial && l.sourceLocation !== undefined) setBulkStock(prev => upsertBulkStock(prev, l.productId, l.sourceLocation as LocationId, -l.qty))
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
        if (r.referenceId !== so.id || r.status !== 'reserved') return r
        const deliveredLine = del.lines.find(line => line.productId === r.productId)
        if (!deliveredLine) return r
        const fulfilledQty = Math.min(r.qty, r.fulfilledQty + deliveredLine.qty)
        return {
          ...r,
          fulfilledQty,
          status: fulfilledQty >= r.qty ? 'fulfilled' as const : 'reserved' as const,
          fulfilledDate: fulfilledQty >= r.qty ? now() : r.fulfilledDate,
        }
      }))
      setDeliveries(p => {
        const next = p.map(d => d.id === deliveryId ? { ...d, status: 'done' as const, warrantyCreated: newWarranties.length > 0, lines: d.lines.map(l => ({ ...l, qtyDone: l.qty })) } : d)
        return next
      })
      setSaleOrders(p => p.map(s => {
        if (s.id !== del.saleOrderId) return s;
        const updated = { ...s, status: 'delivered' as const }
        return updated
      }))
      sync(`/api/deliveries/${deliveryId}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoInvoice: false }) })
      showToast(`Delivery done · stock updated${newWarranties.length > 0 ? ` · ${newWarranties.length} warranty(ies) created` : ''}`)
    },
    updateDelivery: (deliveryId, p) => {
      setDeliveries(prev => prev.map(d => d.id === deliveryId ? { ...d, ...p } : d))
      sync(`/api/deliveries/${deliveryId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
    },
    createInvoiceFromSO: (orderId) => {
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance can create invoices', 'error'); return {} as Invoice;
      }
      const so = soRef.current.find(s => s.id === orderId)!
      const inv: Invoice = {
        id: uid(), ref: seq('INV', 'inv'), type: 'customer_invoice', status: 'posted',
        partnerId: so.customerId, partnerName: so.customerName,
        date: now(), dueDate: addDays(now(), 30),
        lines: so.lines.map(l => ({ id: uid(), description: `${l.productName} ×${l.qty}`, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate, subtotal: l.subtotal, productId: l.productId, accountCode: l.accountCode })),
        subtotal: so.subtotal, taxTotal: so.taxTotal, total: so.total, amountPaid: 0,
        saleOrderId: orderId, notes: '',
      }
      setInvoices(p => [inv, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv) })
      setSaleOrders(p => p.map(s => {
        if (s.id !== orderId) return s;
        const updated = { ...s, invoiceId: inv.id, status: 'invoiced' as const }
        sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      showToast(`Invoice ${inv.ref} created`); return inv
    },
    deleteSaleOrder: (id) => { 
      setSaleOrders(p => p.filter(s => s.id !== id)); 
      sync(`/api/sale-orders/${id}`, { method: 'DELETE' })
      showToast('Order deleted') 
    },
    resetSOToDraft: (id) => {
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s;
        const updated = { ...s, status: 'quotation' as const, savedAt: undefined, deliveryId: undefined }
        sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      showToast('Order reset to draft')
    },
    cancelSO: (id) => {
      const so = soRef.current.find(s => s.id === id)
      if (so) {
        const allSerialIds = so.lines.flatMap(l => l.serialIds)
        if (allSerialIds.length > 0) {
          setSerials(p => p.map(s => allSerialIds.includes(s.id) ? { ...s, status: 'available' } : s))
        }
      }
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s;
        const updated = { ...s, status: 'cancelled' as const }
        sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      showToast('Order cancelled')
    },

    // ── Invoices ──────────────────────────────────────────────────────────────
    createManualInvoice: (type, partnerId, partnerName, dueDate, lines, vatRate, notes = '') => {
      const builtLines: InvoiceLine[] = lines.map(l => {
        const qty = Number(l.qty) || 1
        const unitPrice = Number(l.price) || 0
        const taxRate = vatRate > 0 ? vatRate : Number(l.tax) || 0
        const subtotal = qty * unitPrice
        return { id: uid(), description: l.desc, qty, unitPrice, taxRate, subtotal }
      })
      const subtotal = builtLines.reduce((s, l) => s + l.subtotal, 0)
      const taxTotal = builtLines.reduce((s, l) => s + Math.round(l.subtotal * l.taxRate / 100), 0)
      const invoice: Invoice = {
        id: uid(),
        ref: seq(type === 'vendor_bill' ? 'BILL' : 'INV', 'inv'),
        type,
        status: 'draft',
        partnerId,
        partnerName,
        date: now(),
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

    updateInvoice: (id, p) => {
      const existing = invRef.current.find(i => i.id === id)
      if (!existing) return
      const protectedStatus = existing.status !== 'draft' && existing.status !== 'cancelled'
      const cancelling = p.status === 'cancelled'
      if (protectedStatus && !cancelling && systemSettings.secDisableInvoiceEditAfterValidation) {
        showToast('Posted finance documents are locked. Cancel or reverse instead of editing.', 'error')
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
        if (updated) sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
    },
    postInvoice: (id) => {
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance can post invoices', 'error'); return
      }
      const inv = invRef.current.find(i => i.id === id)
      if (!inv) return
      if (!inv.lines || inv.lines.length === 0) {
        showToast('Cannot post an invoice with no line items', 'error'); return
      }
      setInvoices(p => {
        const next = p.map(i => i.id === id ? { ...i, status: 'posted' as const } : i)
        const updated = next.find(i => i.id === id)
        if (updated) sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      // Auto-post GL journal using the shared posting engine.
      if (!journalEntries.some(j => j.ref === `JRN/${inv.ref}`)) {
        const journal = buildInvoicePostingJournal(inv)
        setJournalEntries(p => [journal, ...p])
        addAuditLog('post_invoice', inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} posted to journal ${journal.ref}`)
      }
      showToast(`${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} posted to accounting`)
    },
    registerPayment: (invoiceId, amount, method, bankAccountId, reference, paymentDate) => {
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance can register payments', 'error'); return
      }
      const actor = currentUser()
      const inv = invRef.current.find(i => i.id === invoiceId)
      if (!inv) return
      const balance = inv.total - inv.amountPaid
      if (balance <= 0) { showToast('Invoice is already fully paid', 'info'); return }
      const capped = Math.min(amount, balance)
      setInvoices(p => {
        const next = p.map(i => {
          if (i.id !== invoiceId) return i
          const paid = i.amountPaid + capped
          const newPayment: InvoicePayment = {
            id: crypto.randomUUID(),
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
            status: (paid >= i.total ? 'paid' : 'partially_paid') as const,
            notes: (i.notes || '') + append,
            payments: [...(i.payments || []), newPayment],
          }
        })
        return next
      })
      // Auto-post GL journal through the shared bank-aware posting engine.
      const journal = buildInvoicePaymentJournal(inv, capped, method, bankAccountId, paymentDate)
      setJournalEntries(p => [journal, ...p])
      fetch(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: capped, paymentMethod: method || 'cash', reference: reference || undefined, paidAt: paymentDate, bankAccountId }),
      })
      addAuditLog('register_payment', invoiceId, `Registered payment of KES ${capped} for ${inv.ref}${reference ? ` (Ref: ${reference})` : ''}`)
      showToast('Payment registered')
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
      const related = journalEntries.filter(j => j.invoiceId === id && !j.ref.startsWith('REV/'))
      const reversals = related
        .filter(j => !journalEntries.some(existingJournal => existingJournal.ref === `REV/${j.ref}`))
        .map(j => buildReversalJournal(j, inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`))
      if (reversals.length > 0) setJournalEntries(prev => [...reversals, ...prev])
      const cancelled = { ...inv, status: 'cancelled' as const, notes: `${inv.notes || ''}
Cancelled instead of deleted to preserve audit trail.` }
      setInvoices(p => p.map(i => i.id === id ? cancelled : i))
      sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cancelled) })
      addAuditLog('cancel_invoice', inv.ref, `Protected ${inv.type === 'vendor_bill' ? 'bill' : 'invoice'} cancelled instead of deleted${reversals.length ? ` with ${reversals.length} reversal journal${reversals.length === 1 ? '' : 's'}` : ''}`)
      showToast('Posted document cancelled with audit trail')
    },
    addAuditLog: (action, documentRef, details) => { addAuditLog(action, documentRef, details) },

    // ── Purchase Orders ───────────────────────────────────────────────────────
    createPO: (vendorId, vendorName, initial = {}) => {
      if (!canManageProcurement(currentUser())) {
        showToast('Only Inventory or Admin can create Purchase Orders', 'error'); return {} as PurchaseOrder;
      }
      const initialLines = initial.lines ?? []
      const po: PurchaseOrder = {
        id: uid(), ref: seq('PO', 'po'), status: 'draft', vendorId, vendorName,
        date: now(), expectedDate: initial.expectedDate ?? addDays(now(), 7),
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
          const line: POLine = { id: uid(), productId: product.id, productName: product.name, qty, qtyReceived: 0, unitPrice, taxRate: effectiveTaxRate, subtotal: qty * unitPrice, requiresSerial: catCfg.serialRequired, accountCode: product.costAccountCode }
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
    confirmPO: (id) => {
      if (!canManageProcurement(currentUser())) {
        showToast('Only Inventory or Admin can confirm Purchase Orders', 'error'); return;
      }
      const po = poRef.current.find(p => p.id === id)
      if (!po) return
      const vendor = contacts.find(c => c.id === po.vendorId)
   
      // Auto-create incoming shipment (receipt) when PO is confirmed — Odoo behaviour
      const receipt: Receipt = {
        id: uid(), ref: seq('REC', 'rec'), poId: id, poRef: po.ref,
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
        const next = p.map(po => po.id === id ? { ...po, status: 'confirmed' as const } : po)
        const updated = next.find(po => po.id === id)
        if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('confirm_po', po.ref, `PO confirmed — receipt ${receipt.ref} created automatically`)
      showToast(`Order confirmed · Receipt ${receipt.ref} ready for goods receiving`)
    },
    createReceiptFromPO: (poId) => {
      const po = poRef.current.find(p => p.id === poId)!
      const outstandingLines = po.lines.filter(l => l.qtyReceived < l.qty)
      if (outstandingLines.length === 0) {
        showToast('All ordered quantities have already been received', 'info')
        return recRef.current.find(r => r.poId === poId && r.status === 'draft') ?? null
      }
      const receipt: Receipt = {
        id: uid(), ref: seq('REC', 'rec'), poId, poRef: po.ref,
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
    validateReceipt: (receiptId, lines, destination, serialAccessories, serialAccessoryNotes, serialSpecs, serialIssues) => {
      if (!canApproveInventoryAction(currentUser())) { showToast('Only inventory approvers can validate GRNs', 'error'); return }
      const receipt = recRef.current.find(r => r.id === receiptId)!
      const po = poRef.current.find(p => p.id === receipt.poId)!

      // Validate: serialized products need all serial numbers
      for (const line of lines) {
        if (line.requiresSerial && line.serials.length < line.qtyReceived) {
          showToast(`Enter all serial numbers for ${line.productName} (${line.serials.length}/${line.qtyReceived})`, 'error'); return
        }
        // Check duplicate serials
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
      const followUpReceipt: Receipt | null = !allReceived && anyReceived && !hasOtherDraftReceipt && followUpLines.length > 0
        ? {
            id: uid(), ref: seq('REC', 'rec'), poId: receipt.poId, poRef: receipt.poRef,
            vendorId: receipt.vendorId, vendorName: receipt.vendorName,
            status: 'draft', date: now(),
            lines: followUpLines,
            destinationLocation: destination,
          }
        : null

      // Add stock and serials
      lines.forEach(line => {
        const prod = prodRef.current.find(x => x.id === line.productId)!
        if (line.requiresSerial) {
          line.serials.forEach(s => {
            const issueDesc = serialIssues?.[s]?.trim() ?? ''
            const hasIssue  = issueDesc.length > 0
            const newSerial: SerialNumber = {
              id: uid(), serial: s, productId: line.productId, productName: line.productName,
              location: hasIssue ? 'warehouse' : destination,
              status: hasIssue ? 'refurbishment' : 'available',
              purchaseOrderId: po.id, receiptId: receiptId, receivedDate: now(), barcode: s,
              accessories: serialAccessories?.[s] ?? [],
              accessoryNotes: serialAccessoryNotes?.[s],
              specs: serialSpecs?.[s],
            }
            setSerials(p => [...p, newSerial])
            sync('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
            if (hasIssue) {
              const job: RefurbishmentJob = {
                id: uid(), ref: seq('REF', 'refurb'),
                status: 'queued',
                serialId: newSerial.id, serialNumber: s,
                productId: line.productId, productName: line.productName,
                specs: serialSpecs?.[s],
                receiptId, receiptRef: receipt.ref,
                intakeDate: now(),
                intakeIssueDescription: issueDesc,
                partsNeeded: [],
              }
              setRefurbishmentJobs(p => [...p, job])
            }
          })
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.serials.length } : x))
          addMove(line.productId, line.productName, line.serials.length, 'in', `Receipt ${receipt.ref}`, receipt.ref, 'vendor', destination, line.serials)
        } else {
          setBulkStock(prev => upsertBulkStock(prev, line.productId, destination, line.qtyReceived))
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qtyReceived } : x))
          addMove(line.productId, line.productName, line.qtyReceived, 'in', `Receipt ${receipt.ref}`, receipt.ref, 'vendor', destination, [])
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
          // Reserve parts and move repair back to approved; notify technician
          const partLines = (linkedRepair.quote?.lines ?? []).filter(l => l.type === 'part' && l.productId)
          partLines.forEach(line => {
            const product = prodRef.current.find(p => p.id === line.productId)
            if (!product) return
            if (product.requiresSerial) {
              const availableSerials = serialRef.current
                .filter(s => s.productId === line.productId && s.status === 'available')
                .slice(0, line.qty)
              availableSerials.forEach(serial => {
                setSerials(p => p.map(s => s.id === serial.id ? { ...s, status: 'assigned' as const, repairId: po.repairId } : s))
              })
            } else {
              setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: Math.max(0, x.stockQty - line.qty) } : x))
              addMove(line.productId!, line.productName ?? line.description, line.qty, 'out',
                `Parts reserved — repair ${linkedRepair.ref}`, linkedRepair.ref, undefined, 'repair_unit')
            }
          })
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
            pushNotif({
              userId: linkedRepair.assignedTechnicianId, type: 'repair',
              title: `Parts arrived — ${linkedRepair.ref} ready to start`,
              body: `${linkedRepair.productName} · Parts received via ${receipt.ref}`,
              module: 'repair', path: `?id=${linkedRepair.id}`, icon: '📦',
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
        showToast('Only Finance can create vendor bills', 'error'); return null;
      }
      const po = poRef.current.find(p => p.id === poId)
      if (!po) return null
      if (po.billId) { showToast('A bill already exists for this purchase order', 'error'); return null }
      const hasValidatedReceipt = recRef.current.some(r => r.poId === poId && r.status === 'validated')
      if (!hasValidatedReceipt) { showToast('Receive goods before creating a vendor bill', 'error'); return null }
      const sub = po.lines.reduce((a, l) => a + l.qtyReceived * l.unitPrice, 0)
      const tax = po.lines.reduce((a, l) => a + Math.round(l.qtyReceived * l.unitPrice * l.taxRate / 100), 0)
      const bill: Invoice = {
        id: uid(), ref: seq('BILL', 'inv'), type: 'vendor_bill', status: 'draft',
        partnerId: po.vendorId, partnerName: po.vendorName,
        date: now(), dueDate: addDays(now(), 30),
        lines: po.lines.filter(l => l.qtyReceived > 0).map(l => ({
          id: uid(), description: `${l.productName} ×${l.qtyReceived}`, qty: l.qtyReceived,
          unitPrice: l.unitPrice, taxRate: l.taxRate, subtotal: l.qtyReceived * l.unitPrice,
        })),
        subtotal: sub, taxTotal: tax, total: sub + tax, amountPaid: 0,
        purchaseOrderId: po.id, notes: '',
      }
      setInvoices(p => [bill, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bill) })
      setPurchaseOrders(p => {
        const next = p.map(x => x.id === poId ? { ...x, billId: bill.id } : x)
        const updated = next.find(x => x.id === poId)
        if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('create_bill', bill.ref, `Vendor bill created from PO ${po.ref}`)
      showToast(`Bill ${bill.ref} created · validate to post liability`)
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
        intakeDate: now(),
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
        pushNotif({
          userId: techId,
          type: 'assignment',
          title: 'Refurbishment job assigned',
          body: `${job.productName} (${job.serialNumber}) has been assigned to you for refurbishment.`,
          module: 'refurbishment',
          path: '?tab=refurb',
          icon: '🔧',
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
        users.filter(u => u.role === 'technical_lead').forEach(u => pushNotif({
          userId: u.id,
          type: 'repair',
          title: 'Part requested for refurb job',
          body: `${job.ref} — ${part.partName} × ${part.qty} (out of stock)`,
          module: 'refurbishment',
          path: '?tab=refurb',
          icon: '🔧',
        }))
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
      setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
        ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
          ...pt, status: 'received', notifiedTechDate: now(), allocatedByName: user.name,
        })
      }))
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
    validateTransfer: (transferId) => {
      if (!canManageInventoryControl(currentUser())) { showToast('Only inventory-controlled roles can validate transfers', 'error'); return }
      const tr = stockTransfers.find(t => t.id === transferId)!
      tr.lines.forEach(l => {
        if (l.serialIds.length > 0) {
          l.serialIds.forEach(sid => setSerials(p => p.map(s => s.id === sid ? { ...s, location: tr.toLocation } : s)))
        } else {
          setBulkStock(prev => upsertBulkStock(upsertBulkStock(prev, l.productId, tr.fromLocation, -l.qty), l.productId, tr.toLocation, l.qty))
        }
        addMove(l.productId, l.productName, l.qty, 'transfer', `Transfer ${tr.ref}`, tr.ref, tr.fromLocation, tr.toLocation, l.serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id))
      })
      setStockTransfers(p => p.map(t => t.id === transferId ? { ...t, status: 'done' } : t))
      showToast(`Transfer ${tr.ref} validated — stock moved to ${LOCATIONS[tr.toLocation].name}`)
    },

    // ── Combined create+validate in one atomic step (avoids React batching race) ──
    submitTransfer: (from, to, productId, productName, qty, serialIds, notes = '') => {
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
      // Move stock immediately — no state read-back needed
      if (serialIds.length > 0) {
        serialIds.forEach(sid => setSerials(p => p.map(s => s.id === sid ? { ...s, location: to } : s)))
      } else {
        setBulkStock(prev => upsertBulkStock(upsertBulkStock(prev, productId, from, -qty), productId, to, qty))
      }
      addMove(productId, productName, qty, 'transfer', `Transfer ${ref}`, ref, from, to,
        serialIds.map(sid => serialRef.current.find(s => s.id === sid)?.serial ?? sid))
      // Persist the completed transfer record
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
        intakeDate: now(),
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
          setRepairs(prev => prev.map(item => item.id === rep.id ? serverRepair : item))
          syncRepairToPortal(serverRepair, 'Repair booked in')
        })
        .catch(() => { /* local/app_state sync remains available offline */ })
      addAuditLog('create_repair', rep.ref, `Repair job created for ${customerName} - ${productName}`)
      // Notify all lead techs of the new job
      users.filter(u => u.role === 'technical_lead').forEach(u => pushNotif({
        userId: u.id,
        type: 'repair',
        title: 'New repair job booked',
        body: `${customerName} — ${productName}`,
        module: 'repair',
        path: `?id=${rep.id}`,
        icon: '🛠️',
      }))
      showToast(`${rep.ref} created`)
      return rep
    },
    updateRepair: (id, p) => {
      setRepairs(prev => prev.map(r => {
        if (r.id !== id) return r
        const updated = { ...r, ...p }
        const partsTotal = updated.partsUsed.reduce((a, x) => a + x.qty * x.price, 0)
        updated.total = updated.underWarranty ? 0 : partsTotal + updated.laborCost
        // Sync portal when report/photo fields change so customers can see them
        if ('qcReportData' in p || 'diagnosisReportData' in p || 'preRepairPhotos' in p || 'issuePhotos' in p) {
          setTimeout(() => syncRepairToPortal(updated), 0)
        }
        return updated
      }))
    },
    deleteRepair: (id) => {
      const user = currentUser()
      if (!user || user.role !== 'director') {
        showToast('Only a director can delete a repair', 'error'); return
      }
      const repair = repairs.find(r => r.id === id)
      if (!repair) return
      setRepairs(p => p.filter(r => r.id !== id))
      setOutsourceJobs(p => p.map(j => j.repairId === id ? { ...j, repairId: undefined } : j))
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
      users.filter(u => u.role === 'technical_lead').forEach(u => pushNotif({
        userId: u.id,
        type: 'repair',
        title: `Repair intake verified: ${repair.ref}`,
        body: `${repair.productName} for ${repair.customerName} is ready for assignment.`,
        module: 'repair',
        path: `?id=${repair.id}`,
        icon: '✅',
      }))
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
        pushNotif({
          userId: technicianId,
          type: 'assignment',
          title: 'Repair job assigned to you',
          body: `${repair.productName} — ${repair.issueDescription?.slice(0, 80) ?? 'See repair details'}.`,
          module: 'repair',
          path: `?id=${repair.id}`,
          icon: '🛠️',
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
      const isAssignedTech = repair?.assignedTechnicianId === user.id
      if (!isAssignedTech) {
        showToast('Only the assigned technician can log or update a diagnosis', 'error'); return
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
      const nextStatus = isRevision ? repair.status : 'diagnosed'

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
      if (!user || repair?.assignedTechnicianId !== user.id) {
        showToast('Only the assigned technician can stop at diagnosis', 'error'); return
      }
      // Repair closes at diagnosis stage — charge flat KES 1,500 diagnosis fee
      const DIAGNOSIS_FEE = 1500
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        diagnosisStopped: true,
        diagnosisFee: DIAGNOSIS_FEE,
        laborCost: 0,
        logisticsCost: 0,
        total: DIAGNOSIS_FEE,
        status: 'ready',
      } : r))
      addAuditLog('stop_at_diagnosis', repairId, `Repair stopped at diagnosis — KES ${DIAGNOSIS_FEE} charged`)
      showToast(`Repair closed at diagnosis — KES 1,500 diagnosis fee charged`)
    },

    generateRepairQuote: (repairId, incomingLines, applyVat = true) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      const canGenerate = ['director', 'technical_lead', 'admin_officer', 'sales_rep', 'finance_officer'].includes(user.role) || repair.assignedTechnicianId === user.id
      if (!canGenerate) {
        showToast('Only the assigned technician or authorised staff can generate a quote', 'error'); return
      }
      const QUOTABLE_STATUSES = repair.repairPath === 'direct_repair'
        ? ['assigned', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair']
        : ['diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair']
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

      const lines: RepairQuoteLine[] = incomingLines.map(line => ({
        ...line,
        id: uid(),
        reserved: false,
      }))

      const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
      const tax = applyVat ? Math.round(subtotal * (companySettings.vatRate / 100)) : 0

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
        changeSummary = diffLines.join('\n')
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

      let linkedSaleOrderId = repair.saleOrderId
      let linkedSaleOrderRef = repair.saleOrderRef

      const soLines = quote.lines.map(l => ({
        id: uid(), productId: l.productId ?? '', productName: l.productName ?? l.description,
        qty: l.qty, unitPrice: l.unitPrice, discount: 0, taxRate: 0,
        subtotal: l.subtotal, serialIds: [] as string[],
      }))

      // Full warranty = company pays everything; partial/void/none = client pays quote total
      const isFullWarranty = repair.underWarranty && repair.warrantyCoverage === 'full'
      const chargeTotal = isFullWarranty ? 0 : quote.total
      // Full warranty quotes are auto-approved — no client approval needed
      const quoteStatus: RepairStatus = isFullWarranty ? 'approved' : 'awaiting_approval'

      if (isUpdate && repair.saleOrderId) {
        setSaleOrders(p => p.map(s => s.id === repair.saleOrderId ? {
          ...s, lines: soLines, subtotal: quote.subtotal, taxTotal: 0, total: chargeTotal,
        } : s))
      } else {
        const soId = uid()
        const soRef = seq('SO', 'so')
        setSaleOrders(p => [{
          id: soId, ref: soRef, status: 'quotation' as const,
          customerId: repair.customerId, customerName: repair.customerName,
          date: now(), validUntil: addDays(now(), 7),
          lines: soLines, subtotal: quote.subtotal, taxTotal: 0, total: chargeTotal,
          notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
          createdByUserId: user.id,
        }, ...p])
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
      const existingSalesQuoteId = repair.salesQuoteId
      const salesQuoteId = existingSalesQuoteId ?? uid()
      const salesQuoteRef = repair.salesQuoteRef ?? seq('QTE', 'quote')
      const salesQuoteRecord = {
        id: salesQuoteId,
        ref: salesQuoteRef,
        companyId: repair.customerId,
        companyName: repair.customerName,
        contactPersonId: repair.contactPersonId ?? repair.customerId,
        contactPersonName: repair.contactPersonName ?? repair.customerName,
        opportunityName: `Repair — ${repair.ref}`,
        ownerId: user.id,
        ownerName: user.name,
        status: isFullWarranty ? 'accepted' : 'sent',
        source: 'repair',
        repairId: repair.id,
        repairRef: repair.ref,
        lines: salesQuoteLines,
        subtotal: quote.subtotal,
        discountAmount: 0,
        discountPercent: 0,
        taxTotal: quote.tax,
        total: chargeTotal,
        saleOrderId: linkedSaleOrderId,
        version: isUpdate && existingSalesQuoteId ? ((quotes.find(q => q.id === existingSalesQuoteId)?.version ?? 1) + 1) : 1,
        issueDate: now(),
        validUntil: quote.validUntil,
        sentDate: now(),
        createdBy: user.id,
        createdByName: user.name,
      }
      if (isUpdate && existingSalesQuoteId) {
        setQuotes(p => {
          const next = p.map(q => q.id === existingSalesQuoteId ? { ...q, ...salesQuoteRecord } : q)
          const updated = next.find(q => q.id === existingSalesQuoteId)
          if (updated) sync(`/api/quotes/${existingSalesQuoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      } else {
        setQuotes(p => [salesQuoteRecord, ...p])
        sync('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(salesQuoteRecord) })
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
        status: quoteStatus,
        quoteApprovalDeadline: isFullWarranty ? undefined : quote.validUntil,
        saleOrderId: linkedSaleOrderId,
        saleOrderRef: linkedSaleOrderRef,
        salesQuoteId,
        salesQuoteRef,
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
        users.filter(u => ['director', 'finance_officer'].includes(u.role)).forEach(u => pushNotif({
          userId: u.id, type: 'repair',
          title: `Warranty repair approved: ${repair.ref}`,
          body: `${repair.productName} (${repair.customerName}) is fully covered under warranty. Quote auto-approved — KES 0 charge.`,
          module: 'repair', path: `?id=${repair.id}`, icon: '🛡️',
        }))
        syncRepairToPortal({ ...repair, quote, status: 'approved', total: 0 }, 'Repair is fully covered under warranty — no charge')
        addAuditLog('generate_quote', repairId, `Warranty quote auto-approved (full coverage): KES 0`)
        showToast('Quote auto-approved — repair is fully covered under warranty')
      } else {
        const coverageLabel = repair.underWarranty ? (repair.warrantyCoverage === 'partial' ? ' (partial warranty — uncovered items)' : ' (warranty voided — client pays)') : ''
        const portalMsg = isUpdate
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
        showToast(isUpdate ? 'Quote revised — customer re-notified, procurement requests reset' : `Quote generated — customer notified via ${repair.customerEmail ? 'email' : 'SMS'}`)
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
    
    approveRepairQuote: (repairId, approved, reason) => {
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
            users.filter(u => u.role === 'technical_lead').forEach(u => pushNotif({
              userId: u.id, type: 'repair',
              title: 'Part needed for repair',
              body: `${repair.ref} — ${product.name} × ${line.qty} (only ${available} in stock)`,
              module: 'repair',
              path: `?id=${repair.id}`,
              icon: '🔧',
            }))
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
            id: uid(), ref: seq('PO', 'po'), status: 'draft',
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

          users.filter(u => u.role === 'technical_lead').forEach(u => pushNotif({
            userId: u.id, type: 'repair',
            title: `Parts needed: ${repair.ref}`,
            body: `Client approved quote. ${missingItems.length} part(s) need procurement before repair can start.`,
            module: 'repair', path: `?id=${repair.id}`, icon: '📦',
          }))
          showToast('Quote approved — parts sourcing required before repair can start', 'info')
        }

        // Create a quotation-status SO if one doesn't exist yet
        let awaitingSoId = repair.saleOrderId
        let awaitingSoRef = repair.saleOrderRef
        if (!awaitingSoId) {
          awaitingSoId = uid()
          awaitingSoRef = seq('SO', 'so')
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
        const awaitingInvoice: Invoice = {
          id: uid(), ref: seq('INV', 'inv'), type: 'customer_invoice', status: 'draft',
          partnerId: repair.customerId, partnerName: repair.customerName,
          date: now(), dueDate: addDays(now(), 14),
          lines: awaitingInvLines, subtotal: repair.quote.subtotal, taxTotal: repair.quote.tax,
          total: repair.quote.total, amountPaid: 0, saleOrderId: awaitingSoId, repairId,
          notes: `Repair ${repair.ref} — ${repair.productName} (awaiting parts)${repair.contactPersonName ? ` | Attn: ${repair.contactPersonName}${repair.contactPersonTitle ? ` (${repair.contactPersonTitle})` : ''}` : ''}`,
        }
        setInvoices(p => [awaitingInvoice, ...p])
        sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(awaitingInvoice) })

        setRepairs(p => p.map(r => r.id === repairId ? { ...r, invoiceId: awaitingInvoice.id } : r))

        if (repair.salesQuoteId) {
          setQuotes(p => {
            const next = p.map(q => q.id === repair.salesQuoteId ? {
              ...q, status: 'accepted', invoiceId: awaitingInvoice.id, acceptedDate: now(),
            } : q)
            const updated = next.find(q => q.id === repair.salesQuoteId)
            if (updated) sync(`/api/quotes/${repair.salesQuoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return next
          })
        }
        return
      }
      
      // Reserve parts
      const updatedLines = repair.quote.lines.map(line => ({
        ...line,
        reserved: line.type === 'part',
      }))
      
      // Mark serials as assigned to repair
      partLines.forEach(line => {
        if (!line.productId) return
        
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product?.requiresSerial) return
        
        const availableSerials = serialRef.current
          .filter(s => s.productId === line.productId && s.status === 'available')
          .slice(0, line.qty)
        
        availableSerials.forEach(serial => {
          setSerials(p => p.map(s => s.id === serial.id ? {
            ...s,
            status: 'assigned',
            repairId,
          } : s))
        })
      })
      
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
      if (repair.saleOrderId) {
        soId = repair.saleOrderId
        soRef = repair.saleOrderRef!
        setSaleOrders(p => {
          const next = p.map(s => s.id === soId ? {
            ...s, status: 'confirmed' as const,
            lines: soLines, subtotal: repair.quote!.subtotal, taxTotal: repair.quote!.tax, total: repair.quote!.total,
          } : s)
          sync(`/api/sale-orders/${soId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next.find(s => s.id === soId)) })
          return next
        })
      } else {
        soId = uid()
        soRef = seq('SO', 'so')
        const newSo: SaleOrder = { id: soId, ref: soRef, status: 'confirmed',
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
      const invoice: Invoice = {
        id: uid(), ref: seq('INV', 'inv'), type: 'customer_invoice', status: 'posted',
        partnerId: repair.customerId, partnerName: repair.customerName,
        date: now(), dueDate: addDays(now(), 14),
        lines: invLines, subtotal: repair.quote.subtotal, taxTotal: repair.quote.tax,
        total: repair.quote.total, amountPaid: 0, saleOrderId: soId, repairId,
        notes: `Repair ${repair.ref} — ${repair.productName}${repair.contactPersonName ? ` | Attn: ${repair.contactPersonName}${repair.contactPersonTitle ? ` (${repair.contactPersonTitle})` : ''}` : ''}`,
      }
      setInvoices(p => [invoice, ...p])

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r, saleOrderId: soId, saleOrderRef: soRef, invoiceId: invoice.id, invoiceDate: now(),
      } : r))

      // Mark linked Sales Quote as accepted
      if (repair.salesQuoteId) {
        setQuotes(p => {
          const next = p.map(q => q.id === repair.salesQuoteId ? {
            ...q, status: 'accepted', saleOrderId: soId, invoiceId: invoice.id, acceptedDate: now(),
          } : q)
          const updated = next.find(q => q.id === repair.salesQuoteId)
          if (updated) sync(`/api/quotes/${repair.salesQuoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      }

      addAuditLog('approve_quote', repairId, `Quote approved → ${soRef} + ${invoice.ref}`)
      showToast(`Quote approved — ${soRef} & ${invoice.ref} created`)
    },

    startRepair: (repairId) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      const isAssignedTech = repair.assignedTechnicianId === user.id
      if (!isAssignedTech) {
        showToast('Only the assigned technician can start the repair', 'error'); return
      }
      // Must have client approval unless it is a direct_repair path (no quote required)
      const validStartStatuses: RepairStatus[] = ['approved', 'awaiting_parts']
      const isDirectRepair = repair.repairPath === 'direct_repair' && repair.status === 'assigned'
      if (!validStartStatuses.includes(repair.status) && !isDirectRepair) {
        showToast('Client must approve the quote before repair can start', 'error'); return
      }
      const defaultQA: RepairQAItem[] = repair.qcItems.length === 0 ? [
        { id: uid(), description: 'Device powers on successfully', passed: false },
        { id: uid(), description: 'Reported issue(s) fully resolved', passed: false },
        { id: uid(), description: 'No new issues introduced during repair', passed: false },
        { id: uid(), description: 'All accessories present and returned', passed: false },
        { id: uid(), description: 'Device cleaned and presentable', passed: false },
      ] : []
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
      const pendingOutsource = outsourceJobsRef.current.find(job => job.repairOrderId === repairId && job.status === 'sent')
      if (pendingOutsource) {
        showToast(`Cannot move to QC until outsource job ${pendingOutsource.ref} is marked returned`, 'error'); return
      }
      if (repair.assignedTechnicianId !== user.id) {
        showToast('Only the assigned technician can mark the repair as complete', 'error'); return
      }
      if (repair.status !== 'in_repair') {
        showToast('Repair must be in progress to mark complete', 'error'); return
      }

      const completedAt = now()
      setRepairs(p => p.map(r => r.id === repairId ? { ...r, status: 'qc', repairCompletedDate: completedAt } : r))
      syncRepairToPortal({ ...repair, status: 'qc', repairCompletedDate: completedAt }, 'Repair complete — undergoing quality check')
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
        qcItems: [...r.qcItems, qaItem],
      } : r))
    },
    
    completeRepairQA: (repairId, qaResults) => {
      const user = currentUser()
      if (!user) return
      const repair = repairs.find(r => r.id === repairId)
      // Directors/leads can always QA; technicians can QA any repair they did NOT work on
      const isAuthorized = ['director', 'technical_lead'].includes(user.role)
        || (user.role === 'technician' && repair?.assignedTechnicianId !== user.id)
      if (!isAuthorized) {
        showToast('You cannot perform QA on a repair you worked on — a different technician must do QC', 'error'); return
      }

      setRepairs(p => p.map(r => {
        if (r.id !== repairId) return r
        
        const updatedQCItems = r.qcItems.map(item => {
          const result = qaResults.find(res => res.itemId === item.id)
          return result ? {
            ...item,
            passed: result.passed,
            testedBy: user.name,
            testedDate: now(),
            notes: result.notes,
          } : item
        })
        
        const allPassed = updatedQCItems.every(item => item.passed)
        
        return {
          ...r,
          qcItems: updatedQCItems,
          qcPassedDate: allPassed ? now() : undefined,
          qcApprovedBy: allPassed ? user.name : undefined,
          status: allPassed ? 'ready' : 'in_repair',
          repairCompletedDate: now(),
        }
      }))
      
      const allPassed = qaResults.every(r => r.passed)

      if (allPassed) {
        // Consume reserved parts
        const partsToConsume = repair?.partsUsed.filter(part => part.reservedDate && !part.usedDate) || []
        
        partsToConsume.forEach(part => {
          const product = prodRef.current.find(p => p.id === part.productId)
          if (!product) return
          
          if (product.requiresSerial) {
            const assignedSerials = serialRef.current
              .filter(s => s.productId === part.productId && s.repairId === repairId && s.status === 'assigned')
              .slice(0, part.qty)
            
            assignedSerials.forEach(serial => {
              setSerials(p => p.map(s => s.id === serial.id ? { ...s, status: 'sold' as const } : s))
              setProducts(p => p.map(x => x.id === part.productId ? { ...x, stockQty: Math.max(0, x.stockQty - 1) } : x))
            })
            
            addMove(part.productId, part.productName, part.qty, 'out', `Repair ${repair?.ref}`, repair?.ref ?? repairId, 'repair_unit', undefined, assignedSerials.map(s => s.serial))
          } else {
            // Bulk stock wasn't moved to repair_unit during quote approval, so we deduct from where it actually is
            const locs = calcStockByLocation(product, serialRef.current, bulkStock, part.productId)
            const deductLocation = locs.shop >= part.qty ? 'shop' : 'warehouse'
            setBulkStock(prev => upsertBulkStock(prev, part.productId, deductLocation, -part.qty))
            setProducts(p => p.map(x => x.id === part.productId ? { ...x, stockQty: Math.max(0, x.stockQty - part.qty) } : x))
            addMove(part.productId, part.productName, part.qty, 'out', `Repair ${repair?.ref}`, repair?.ref ?? repairId, deductLocation, undefined, [])
          }
        })
        
        setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          partsUsed: r.partsUsed.map(part => ({
            ...part,
            usedDate: now(),
          })),
        } : r))
        
        if (repair) syncRepairToPortal({ ...repair, status: 'ready', repairCompletedDate: now() }, 'Device ready for collection')
        // Notify admin and finance that the device is ready — they can now invoice and schedule delivery
        if (repair) {
          users.filter(u => ['director', 'finance_officer'].includes(u.role)).forEach(u => pushNotif({
            userId: u.id, type: 'repair',
            title: `Device ready: ${repair.ref}`,
            body: `${repair.productName} for ${repair.customerName} has passed QA and is ready for collection/delivery.`,
            module: 'repair', path: `?id=${repair.id}`,
            icon: '✅',
          }))
        }
        addAuditLog('complete_qc', repairId, 'QA passed — device ready for customer')
        showToast('QA passed — device ready for pickup')
      } else {
        // Notify the technician that rework is required
        if (repair?.assignedTechnicianId) {
          pushNotif({
            userId: repair.assignedTechnicianId,
            type: 'repair',
            title: '❌ Repair failed QA',
            body: `${repair.ref} requires rework. Please review the failed QA items.`,
            module: 'repair',
            path: `?id=${repair.id}`,
            icon: '❌',
          })
        }
        if (repair) syncRepairToPortal({ ...repair, status: 'qc' }, 'QA failed — rework in progress')
        addAuditLog('fail_qc', repairId, 'QA failed — rework required')
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

      // Reserve parts now that stock has arrived
      partLines.forEach(line => {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) return
        if (product.requiresSerial) {
          const availableSerials = serialRef.current
            .filter(s => s.productId === line.productId && s.status === 'available')
            .slice(0, line.qty)
          availableSerials.forEach(serial => {
            setSerials(p => p.map(s => s.id === serial.id ? { ...s, status: 'assigned' as const, repairId } : s))
          })
        } else {
          setProducts(p => p.map(x => x.id === line.productId
            ? { ...x, stockQty: Math.max(0, x.stockQty - line.qty) }
            : x
          ))
          addMove(line.productId!, line.productName ?? line.description, line.qty, 'out',
            `Parts reserved — repair ${repair.ref}`, repair.ref, undefined, 'repair_unit')
        }
      })

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
        pushNotif({
          userId: repair.assignedTechnicianId,
          type: 'repair',
          title: '📦 Parts have arrived — ready to start',
          body: `${repair.ref} — ${repair.productName}`,
          module: 'repair',
          path: `?id=${repair.id}`,
          icon: '📦',
        })
      }
      syncRepairToPortal({ ...repair, status: 'approved' }, 'Parts arrived — repair resuming')
      addAuditLog('parts_arrived', repairId, `${actor.name} confirmed parts arrived and reserved`)
      showToast('Parts received and reserved — technician notified')
    },

    markRepairReady: (repairId) => {
      const repair = repairs.find(r => r.id === repairId)
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

      // Confirm the Sale Order if it's still in 'quotation' status (Path B — parts were sourced)
      if (repair?.saleOrderId) {
        setSaleOrders(prev => {
          const next = prev.map(s => s.id === repair.saleOrderId && s.status === 'quotation'
            ? { ...s, status: 'confirmed' as const }
            : s
          )
          const updated = next.find(s => s.id === repair.saleOrderId)
          if (updated?.status === 'confirmed') sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      }

      if (repair?.assignedTechnicianId) {
        pushNotif({
          userId: repair.assignedTechnicianId,
          type: 'repair',
          title: `Device ready — ${repair.ref}`,
          body: `${repair.productName} for ${repair.customerName} has been marked ready for pickup/delivery.`,
          module: 'repair',
          path: `?id=${repair.id}`,
          icon: '✅',
        })
      }
      if (repair) syncRepairToPortal({ ...repair, status: 'ready' }, 'Repair complete — device ready for collection')
      addAuditLog('mark_ready', repairId, 'Device ready for pickup')
      showToast('Device marked ready for pickup — invoice posted, technician notified')
    },
    
    scheduleDelivery: (repairId, method, scheduledDate, address, riderId, riderName) => {
      const repair = repairs.find(r => r.id === repairId)
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
      
      if (!['delivered', 'collected'].includes(repair.status)) {
        showToast('Device must be delivered or collected before closing the repair', 'error')
        return
      }
      
      if (!repair.underWarranty && !repair.invoiceId) {
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
    
    createInvoiceFromRepair: (repairId, applyVat = true) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return null
      
      if (repair.underWarranty) {
        showToast('No invoice needed for warranty repairs', 'info')
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
      ]
      
      const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
      const taxTotal = lines.reduce((sum, line) => sum + Math.round(line.subtotal * line.taxRate / 100), 0)
      
      const invoice: Invoice = {
        id: uid(),
        ref: seq('INV', 'inv'),
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
        notes: `Repair invoice for ${repair.ref}`,
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
      } : r))

      addAuditLog('invoice_repair', repair.ref, `Invoice ${invoice.ref} created`)
      showToast(`Invoice ${invoice.ref} generated`)
      return invoice
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

      // Full visibility: admin, finance, lead techs see every repair
      if (['director', 'finance_officer', 'technical_lead'].includes(user.role)) return repairs

      // Functional Firewall: Technicians see their assigned jobs + QC-pending repairs they did NOT work on (for cross-tech QA)
      if (user.role === 'technician') {
        return repairs.filter(r => r.assignedTechnicianId === user.id || (r.status === 'qc' && r.assignedTechnicianId !== user.id))
      }

      return repairs
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

      if (newStatus === 'qc') {
        const pendingOutsource = outsourceJobsRef.current.find(job => job.repairOrderId === repairId && job.status === 'sent')
        if (pendingOutsource) {
          showToast(`Cannot move to QC until outsource job ${pendingOutsource.ref} is marked returned`, 'error')
          return
        }
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
        id: uid(), ref: seq('PO', 'po'), status: 'draft',
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
      users.filter(u => ['technical_lead', 'inventory_officer', 'director'].includes(u.role)).forEach(u => pushNotif({
        userId: u.id,
        type: 'repair',
        title: `${user.name} requested items for ${repair.ref}`,
        body: `${repair.productName} — ${summary}`,
        module: 'repair',
        path: `?id=${repair.id}`,
        icon: '📋',
      }))

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

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'declined',
        notes: r.notes + `\n\nQuote declined: ${reason}`,
      } : r))

      addAuditLog('decline_quote', repairId, `Quote declined by customer: ${reason}`)
      
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
              message: "We understand you've declined the repair quote. Your device is ready for return pickup at our service center.",
              options: { priority: 'normal' }
            })
          })

          const result = await response.json()

          if (result.success) {
            showToast(`Quote declined • Customer notified via ${result.channel?.toUpperCase()}`, 'info')
          } else {
            showToast('Quote declined • Notification failed', 'error')
          }
        } catch {
          showToast('Quote declined • Notification error', 'error')
        }
      } else {
        showToast('Quote marked as declined', 'info')
      }
    },

    markUnrepairable: async (repairId, reason) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) {
        showToast('Repair not found', 'error')
        return
      }

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

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'returned',
        deliveryActualDate: now(),
        notes: r.notes + `\n\nReturned to customer: ${reason}`,
        closedDate: now(),
      } : r))

      addAuditLog('return_device', repairId, `Device returned: ${reason}`)
      showToast(`${repair.ref} returned to customer`, 'success')
    },

    // ── POS ───────────────────────────────────────────────────────────────────
    openPOSSession: (openingCash) => { setPosSessionOpen(true); setPosSessionOpeningCash(openingCash); showToast('POS session opened') },
    closePOSSession: (_) => { setPosSessionOpen(false); showToast('Session closed') },
    createPOSOrder: (lines, payment, customerId, customerName, pointsRedeemed = 0) => {
      const sub = lines.reduce((a, l) => a + l.subtotal, 0)
      const tax = Math.round(sub * 0.16)
      const total = Math.max(0, sub + tax - pointsRedeemed)
      const user = currentUser()
    let pointsEarned = 0
    if (customerId) {
      pointsEarned = Math.floor(total / 100) // 1 point per 100 KES
        setContacts(prev => prev.map(c => c.id === customerId ? { ...c, loyaltyPoints: Math.max(0, (c.loyaltyPoints || 0) - pointsRedeemed) + pointsEarned } : c))
    }
        const order: POSOrder = { id: uid(), ref: seq('POS', 'pos'), sessionId: 'active', lines, subtotal: sub, taxTotal: tax, total, payment, customerId, customerName, date: now(), createdAt: new Date().toISOString(), createdByUserId: user?.id, createdByName: user?.name, pointsEarned, pointsRedeemed }
      lines.forEach(l => {
        const product = prodRef.current.find(x => x.id === l.productId)
        const sourceLocation = product?.requiresSerial ? 'shop' : 'shop'
        if (!product?.requiresSerial) setBulkStock(prev => upsertBulkStock(prev, l.productId, sourceLocation, -l.qty))
        setProducts(p => p.map(x => x.id === l.productId ? { ...x, stockQty: Math.max(0, x.stockQty - l.qty) } : x))
        if (l.serialId) setSerials(p => p.map(s => s.id === l.serialId ? { ...s, status: 'sold', location: 'customer', soldDate: now() } : s))
        addMove(l.productId, l.productName, l.qty, 'out', `POS ${order.ref}`, order.ref, sourceLocation, 'customer', l.serialNumber ? [l.serialNumber] : [])
      })
      const posInv: Invoice = {
        id: uid(), ref: seq('INV', 'inv'), type: 'customer_invoice', status: 'paid',
        partnerId: customerId ?? 'walk-in', partnerName: customerName ?? 'Walk-in Customer',
        date: now(), dueDate: now(),
        lines: lines.map(l => ({ id: uid(), description: `${l.productName} ×${l.qty}`, qty: l.qty, unitPrice: l.price, taxRate: 16, subtotal: l.subtotal })),
        subtotal: sub, taxTotal: tax, total: sub + tax, amountPaid: sub + tax, notes: `POS ${order.ref}`,
      }
      setInvoices(p => [posInv, ...p])
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(posInv) })
      setPosOrders(p => [order, ...p])
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
          accountLine('5000 - Sales Revenue', `POS revenue ${order.ref}`, 0, sub),
          ...(tax > 0 ? [accountLine('3301 - Output VAT Payable', `VAT on ${order.ref}`, 0, tax)] : []),
        ],
        totalDebit: posInv.total,
        totalCredit: posInv.total,
      }
      setJournalEntries(p => [posJournal, ...p])
      addAuditLog('post_pos', order.ref, `POS sale posted to journal ${posJournal.ref}`)
      showToast(`${order.ref} · ${fmtKes(order.total)} via ${payment.toUpperCase()}`)
    },

    // ── Stock Adjustments ─────────────────────────────────────────────────────
    createAdjustment: (productId, productName, type, qty, reason, notes) => {
      if (!canManageInventoryControl(currentUser())) { showToast('Only inventory-controlled roles can request adjustments', 'error'); throw new Error('Unauthorized adjustment request') }
      const prod = prodRef.current.find(x => x.id === productId)
      const varianceAccountCode = prod?.adjustmentAccountCode || prod?.costAccountCode
      const writeOffAccountCode = prod?.writeOffAccountCode || prod?.adjustmentAccountCode || prod?.costAccountCode
      if (prod && type === 'add' && !prod.inventoryAccountCode) {
        showToast(`${prod.name} is missing an Inventory Asset account`, 'error')
        throw new Error('Missing inventory asset account')
      }
      if (prod && type === 'subtract' && !writeOffAccountCode) {
        showToast(`${prod.name} is missing a write-off or adjustment account`, 'error')
        throw new Error('Missing stock variance account')
      }
      const adj: StockAdjustment = {
        id: uid(), ref: seq('ADJ', 'adj'), productId, productName, type, qty, reason, notes,
        inventoryAccountCode: prod?.inventoryAccountCode,
        varianceAccountCode,
        writeOffAccountCode,
        status: 'pending', requestedBy: currentUser()?.name ?? 'Unknown', date: now(),
      }
      setStockAdjustments(p => [adj, ...p])
      addAuditLog('create_adjustment', adj.ref, `Stock adjustment requested for ${productName}`)
      showToast(`${adj.ref} submitted for approval`)
      return adj
    },
    approveAdjustment: (adjId, approved) => {
      if (!canApproveInventoryAction(currentUser())) { showToast('Only inventory approvers can approve adjustments', 'error'); return }
      const adj = adjRef.current.find(a => a.id === adjId)
      if (!adj) return
      if (approved) {
        const prod = prodRef.current.find(x => x.id === adj.productId)
        if (prod) {
          const delta = adj.type === 'add' ? adj.qty : -adj.qty
          setBulkStock(prev => upsertBulkStock(prev, adj.productId, 'warehouse', delta))
          setProducts(p => p.map(x => x.id === adj.productId ? { ...x, stockQty: Math.max(0, x.stockQty + delta) } : x))
          addMove(adj.productId, adj.productName, adj.qty, adj.type === 'add' ? 'in' : 'adjustment', `Adj ${adj.ref}: ${adj.reason}`, adj.ref)
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
    assignRiderToJob: (jobId, riderId) => {
      const rider = riders.find(r => r.id === riderId)
      if (!rider) { showToast('Rider not found', 'error'); return }
      setDeliveryJobs(prev => prev.map(j =>
        j.id === jobId
          ? { ...j, riderId, riderName: rider.name, riderFee: rider.ratePerDelivery, status: 'assigned', assignedAt: new Date().toISOString() }
          : j
      ))
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
    createDeliveryFromSO: (salesOrderId) => {
      const so = saleOrders.find(s => s.id === salesOrderId)
      if (!so) {
        showToast('Sales order not found', 'error')
        return null
      }
      
      const delivery: Delivery = {
        id: uid(),
        ref: seq('DN', 'del'),
        saleOrderId: so.id,
        saleOrderRef: so.ref,
        customerId: so.customerId,
        customerName: so.customerName,
        date: now(),
        status: 'ready',
        warrantyCreated: false,
        lines: so.lines.map(line => ({
          productId: line.productId,
          productName: line.productName,
          qty: line.qty,
          qtyDone: 0,
          serialIds: [],
        })),
      }
      
      setDeliveries(prev => [...prev, delivery])
      sync('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(delivery) })
      addAuditLog('create_delivery', delivery.ref, `Created from ${so.ref}`)
      showToast(`Delivery note ${delivery.ref} created`)
      
      return delivery
    },
    
    confirmDeliveryWithStockDeduction: (deliveryId) => {
      const delivery = deliveries.find(d => d.id === deliveryId)
      if (!delivery) {
        showToast('Delivery not found', 'error')
        return
      }
      
      const user = currentUser()
      if (!user) return
      
      const hasIssues = delivery.lines.some(line => {
        const product = products.find(p => p.id === line.productId)
        if (product?.requiresSerial && line.serialIds.length !== line.qty) {
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

      // Update SO
      setSaleOrders(prev => {
        const next = prev.map(so =>
          so.id === delivery.saleOrderId
            ? { ...so, status: 'delivered' as const }
            : so
        )
        return next
      })
      
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
            id: uid(), ref: seq('INV', 'inv'), type: 'customer_invoice', status: 'posted',
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
          setSaleOrders(prev => {
            const next = prev.map(s => s.id === so.id ? { ...s, invoiceId: invoice.id, status: 'invoiced' as const } : s)
            return next
          })
          addAuditLog('auto_invoice', invoice.ref, `Auto-generated from ${delivery.ref}`)
          showToast(`Invoice ${invoice.ref} generated`, 'success')
        }
      }
      
      sync(`/api/deliveries/${deliveryId}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoInvoice: !!so && !hasExistingInvoice }) })
    },

    createInvoiceFromDelivery: (deliveryId) => {
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

      // Build lines from SO lines, matching by productId in insertion order to handle duplicates
      const soLinesPool = [...so.lines]
      const vatRate = companySettings.vatRate

      const invoice: Invoice = {
        id: uid(),
        ref: seq('INV', 'inv'),
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
      sync('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })

      setSaleOrders(prev => {
        const next = prev.map(s =>
          s.id === so.id ? { ...s, status: 'invoiced' as const } : s
        )
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

      const outstanding = invoices
        .filter(inv => inv.partnerId === customerId && inv.status === 'posted')
        .reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0)

      const creditUsed = outstanding + orderTotal
      const creditAvailable = customer.creditLimit - outstanding

      if (creditUsed > customer.creditLimit) {
        return { ok: false, message: `Credit limit exceeded. Limit: ${fmtKes(customer.creditLimit)}, Used: ${fmtKes(outstanding)}, Available: ${fmtKes(creditAvailable)}`, requiresApproval: true }
      }
      return { ok: true, creditAvailable }
    },

    getCustomerCreditStatus: (customerId, newOrderTotal = 0) => {
      const contact = contacts.find(c => c.id === customerId)
      const today = now()

      const unpaidInvoices = invoices.filter(inv =>
        inv.partnerId === customerId &&
        inv.type === 'customer_invoice' &&
        inv.status !== 'paid' &&
        inv.status !== 'cancelled'
      )

      const outstandingBalance = unpaidInvoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.amountPaid), 0)

      const overdueInvoices = unpaidInvoices.filter(inv => inv.dueDate < today)
      const overdueBalance = overdueInvoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.amountPaid), 0)
      const overdueCount = overdueInvoices.length

      const isLocked = overdueBalance > 0

      const creditLimit = contact?.creditLimit ?? 0
      const creditAvailable = creditLimit > 0 ? Math.max(0, creditLimit - outstandingBalance) : -1
      const creditLimitExceeded = creditLimit > 0 && (outstandingBalance + newOrderTotal) > creditLimit

      let message = ''
      if (isLocked) {
        message = `Account locked — ${overdueCount} overdue invoice${overdueCount > 1 ? 's' : ''} totalling ${fmtKes(overdueBalance)}. Clear outstanding bills to unlock.`
      } else if (creditLimitExceeded) {
        message = `Credit limit of ${fmtKes(creditLimit)} exceeded. Available: ${fmtKes(creditAvailable)}. Outstanding: ${fmtKes(outstandingBalance)}.`
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
            const updated = {
              ...so,
              approvalStatus: docStatus,
              status: docStatus === 'approved' && so.status === 'pending_approval' ? 'approved' as const : so.status,
            }
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
      setReturnOrders(p => p.map(r => r.id === id ? { ...r, status: 'received', receivedDate: now() } : r))
      if (ro) {
        ro.lines.forEach(line => {
          line.serialIds.forEach(sid => {
            setSerials(p => p.map(s => s.id === sid
              ? { ...s, status: 'returned', location: 'warehouse' as LocationId }
              : s
            ))
          })
        })
      }
      showToast('Return received — items back in warehouse')
    },

    processReturn: (id, resolution, refundAmount, processNotes, refundPaymentMethod) => {
      const user = currentUser(); if (!user) return
      const rma = returnOrders.find(r => r.id === id); if (!rma) return
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

      const label = resolution === 'refund' ? 'Refund recorded' : resolution === 'replacement' ? 'Replacement issued' : resolution === 'credit_note' ? 'Credit note issued' : 'Repair initiated'
      showToast(`Return processed — ${label}`)
    },

    rejectReturn: (id, reason) => {
      setReturnOrders(p => p.map(r => r.id === id ? { ...r, status: 'rejected', notes: reason } : r))
      showToast('Return rejected')
    },

    // ── Buy-backs ─────────────────────────────────────────────────────────────
    buyBacks,

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
        ref: seq('RFD', 'refund'),
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
      }
      bb.lines.forEach(line => {
        const product = prodRef.current.find(p => p.id === line.productId)
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
      showToast(`${bb.ref} stocked — inventory updated`)
    },

    deleteBuyBack: (id) => {
      setBuyBacks(p => p.filter(b => b.id !== id))
      showToast('Buy-back deleted')
    },

    // ── Donations ─────────────────────────────────────────────────────────────
    donations,

    createDonation: (type, party, location, lines, notes) => {
      for (const line of lines) {
        const product = prodRef.current.find(p => p.id === line.productId)
        if (!product) { showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid donation product') }
        if (line.qty <= 0) { showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid donation quantity') }
        if (product.requiresSerial && type === 'in') {
          showToast(`Serialized donation-in for ${product.name} needs serial intake before confirmation`, 'error')
          throw new Error('Serialized donation-in requires serial intake')
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
        if (product.requiresSerial && don.type === 'in') {
          showToast(`Serialized donation-in for ${product.name} needs serial intake before confirmation`, 'error'); return
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
            setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'available', location: don.location } : s))
          })
          setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
          if (line.serialIds.length === 0) setBulkStock(prev => upsertBulkStock(prev, line.productId, don.location, line.qty))
          addMove(line.productId, line.productName, line.qty, 'in', `Donation in ${don.ref}`, don.ref, 'customer', don.location, [])
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
      showToast(`Exchange ${exc.ref} completed — stock updated`)
    },

    cancelExchange: (id) => {
      setClientExchanges(p => p.map(e => e.id === id ? { ...e, status: 'cancelled' } : e))
      showToast('Exchange cancelled')
    },
  }

  return <StoreCtx.Provider value={storeCtx}>{children}</StoreCtx.Provider>
}

export { StoreProvider as AppProvider }

export function useApp() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}

export const fmtKes = (n: number) => `KSh ${Math.round(n).toLocaleString('en-KE')}`
export const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d } }
