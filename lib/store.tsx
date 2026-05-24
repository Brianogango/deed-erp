// @ts-nocheck
'use client'
import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef } from 'react'
import { requestCreateUser, requestDeleteUser, requestUpdateUser, requestDeactivateUser, requestReactivateUser } from '@/lib/auth/client-users'
import { getFirstAllowedModule, hasModuleAccess as userHasModuleAccess } from '@/lib/auth/access'
import type { CreateUserInput, ModuleId as AuthModuleId, PublicUser, UpdateUserInput, UserRole as AuthUserRole } from '@/lib/auth/types'

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

export interface ContactPerson {
  id: string
  clientId: string
  firstName: string
  lastName: string
  jobTitle?: string
  email: string
  phone: string
  mobile?: string
  isPrimary?: boolean
  isDecisionMaker?: boolean
  preferredChannel?: 'email' | 'phone' | 'whatsapp'
  notes?: string
  // Relations
  client?: Client
}

export interface Opportunity {
  id: string
  name: string
  clientId: string
  contactPersonId?: string
  assignedToId?: string
  status: OpportunityStage
  probability: number
  expectedValue: number
  expectedCloseDate?: string
  actualCloseDate?: string
  leadSource?: LeadSource
  description?: string
  notes?: string
  createdAt: string
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
  clientId: string
  assignedToId?: string
  status: QuoteStatus
  quoteDate: string
  validUntil?: string
  opportunityId?: string
  subject?: string
  subtotal: number
  discountAmount: number
  discountPct: number
  taxAmount: number
  totalAmount: number
  notes?: string
  internalNotes?: string
  terms?: string
  approvedById?: string
  approvedAt?: string
  convertedToId?: string
  createdById: string
  createdAt: string
  updatedAt: string
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
  description?: string
  scheduledAt?: string
  createdById: string
  createdAt: string
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
  sourceType: 'customer_invoice' | 'vendor_bill' | 'pos' | 'expense' | 'payroll' | 'purchase'
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

export type SOStatus = 'quotation' | 'confirmed' | 'delivered' | 'invoiced' | 'cancelled'

export interface SaleOrder {
  id: string
  orderNumber: string
  clientId: string
  quoteId?: string
  status: SOStatus
  orderDate: string
  deliveryDate?: string
  subtotal: number
  taxAmount: number
  discountAmount: number
  totalAmount: number
  amountPaid: number
  notes?: string
  createdById: string
  createdAt: string
  updatedAt: string
  // Relations
  client?: Client
  quote?: Quote
  createdBy?: User
  items?: SaleOrderItem[]
  invoices?: Invoice[]
  deliveries?: DeliveryNote[]
}

export type InvoiceType = 'customer_invoice' | 'vendor_bill'
export type InvoiceStatus = 'draft' | 'posted' | 'paid' | 'overdue' | 'cancelled'

export interface InvoiceLine {
  id: string; description: string; qty: number; unitPrice: number; taxRate: number; subtotal: number
  productId?: string    // original product (for account lookup)
  accountCode?: string  // revenue account code (e.g. '5001')
}

export interface Invoice {
  id: string; ref: string; type: InvoiceType; status: InvoiceStatus
  partnerId: string; partnerName: string
  date: string; dueDate: string
  lines: InvoiceLine[]; subtotal: number; taxTotal: number; total: number; amountPaid: number
  saleOrderId?: string; purchaseOrderId?: string; receiptId?: string; notes: string
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
  | 'invoiced'           // Invoice generated
  | 'delivered'          // Handed over to customer
  | 'closed'             // Job completed and closed
  | 'cancelled'          // Job cancelled
  | 'declined'           // Customer declined the quote
  | 'unrepairable'       // Device cannot be repaired
  | 'returned'           // Device returned to customer without repair

export type IntakeChannel = 'walk_in' | 'website' | 'whatsapp' | 'call' | 'email' | 'rider_pickup'

export interface RepairDiagnosis {
  findings: string
  faultDescription: string
  recommendedAction: string
  estimatedHours: number
  diagnosedBy: string
  diagnosedDate: string
}

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
  productId: string
  productName: string
  serialNumber: string
  serialId?: string
  deviceCondition?: 'good' | 'fair' | 'poor' | 'damaged'
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
  warrantyClaimId?: string
  clientCausedDamage?: boolean
  clientDamageReason?: string
  
  // Assignment
  assignedTechnicianId?: string
  assignedTechnicianName?: string
  assignedDate?: string
  
  // Diagnosis
  diagnosis?: RepairDiagnosis
  
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
  deliveryNotes?: string
  deliveryRiderId?: string
  deliveryRiderName?: string
  
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
  leaveType: 'annual' | 'sick' | 'maternity_paternity' | 'unpaid' | 'december_leave' | 'flexible_leave'
  year: number
  entitlement: number
  used: number
  pending: number
  carryForward: number
}

export interface LeaveRequest {
  id: string
  ref: string
  employeeId: string
  employeeName: string
  leaveType: LeaveBalance['leaveType']
  startDate: string
  endDate: string
  days: number
  reason: string
  status: 'pending_hr' | 'approved' | 'rejected'
  submittedDate: string
  hrApprovalBy?: string
  hrDecisionDate?: string
  submittedByUserId?: string
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
  process: 'leave' | 'expense' | 'salary_change' | 'hiring' | 'payroll'
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
  netPay: number
  status: 'draft' | 'published'
  generatedDate: string
  downloadUrl?: string
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
  source: 'payroll' | 'refund'
  description: string
  status: 'posted'
  lines: JournalEntryLine[]
  totalDebit: number
  totalCredit: number
  payrollRunId?: string
  rmaId?: string
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

const canManageProcurement = (user: User | null) =>
  !!user && ['director', 'inventory_officer'].includes(user.role)

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
  notes?: string
  createdAt: string
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

  // Outsource repair
  outsourceVendors: OutsourceVendor[]
  outsourceJobs: OutsourceJob[]
  outsourcePayments: OutsourcePayment[]
  addOutsourceVendor: (v: Omit<OutsourceVendor, 'id' | 'createdAt'>) => OutsourceVendor
  updateOutsourceVendor: (id: string, p: Partial<OutsourceVendor>) => void
  addOutsourceJob: (j: Omit<OutsourceJob, 'id' | 'ref' | 'createdAt' | 'sentByUserId' | 'sentByName' | 'status'>) => OutsourceJob
  returnOutsourceJob: (id: string, p: { returnedDate: string; isResolved: boolean; returnNotes?: string; finalCost?: number }) => void
  recordOutsourcePayment: (p: Omit<OutsourcePayment, 'id' | 'ref' | 'createdAt' | 'paidByUserId' | 'paidByName'>) => OutsourcePayment

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
  createCompany: (c: Omit<Company, 'id' | 'creditUsed' | 'createdDate' | 'createdBy'>) => Company
  updateCompany: (id: string, p: Partial<Company>) => void
  deleteCompany: (id: string) => void
  
  // CRM - Contact Persons
  createContactPerson: (c: Omit<ContactPerson, 'id' | 'fullName' | 'createdDate'>) => ContactPerson
  updateContactPerson: (id: string, p: Partial<ContactPerson>) => void
  deleteContactPerson: (id: string) => void
  
  // CRM - Opportunities
  createOpportunity: (opp: Omit<Opportunity, 'id' | 'ref' | 'createdDate' | 'quoteIds' | 'actualValue'>) => Opportunity
  updateOpportunity: (id: string, p: Partial<Opportunity>) => void
  moveOpportunityStage: (id: string, stage: OpportunityStage) => void
  markOpportunityWon: (id: string, actualValue: number) => void
  markOpportunityLost: (id: string, reason: string, competitor?: string) => void
  deleteOpportunity: (id: string) => void
  
  // CRM - Opportunity Activities
  logActivity: (activity: Omit<OpportunityActivity, 'id' | 'createdDate' | 'createdBy' | 'createdByName'>) => OpportunityActivity
  completeActivity: (id: string, outcome?: string) => void
  
  // Customer Contracts
  createCustomerContract: (contract: Omit<CustomerContract, 'id' | 'ref'>) => CustomerContract
  updateCustomerContract: (id: string, patch: Partial<CustomerContract>) => void
  renewCustomerContract: (id: string) => CustomerContract
  terminateCustomerContract: (id: string, reason: string) => void
  
  // Sales - Quotes
  createQuote: (quote: Omit<Quote, 'id' | 'ref' | 'version' | 'issueDate' | 'viewCount' | 'createdBy' | 'createdByName'>) => Quote
  updateQuote: (id: string, p: Partial<Quote>) => void
  addQuoteLine: (quoteId: string, product: Product, qty: number, discount?: number, customPrice?: number) => void
  removeQuoteLine: (quoteId: string, lineId: string) => void
  sendQuote: (id: string) => void
  acceptQuote: (id: string) => void
  rejectQuote: (id: string, reason: string) => void
  convertQuoteToSaleOrder: (quoteId: string) => SaleOrder
  convertRepairQuoteToSOAndInvoice: (quoteId: string) => { so: SaleOrder; invoice: Invoice } | null
  reviseQuote: (quoteId: string, changes: string) => Quote
  deleteQuote: (id: string) => void

  // Products
  addProduct: (p: Omit<Product, 'id'>) => Product
  updateProduct: (id: string, p: Partial<Product>) => void
  deleteProduct: (id: string) => void
  importOpeningStock: (items: { productId: string; qty: number; serials?: string[]; location?: LocationId }[]) => void

  // Serials
  getProductSerials: (productId: string, location?: LocationId) => SerialNumber[]
   getAvailableSerials: (productId: string) => SerialNumber[]
  updateSerial: (id: string, patch: Partial<SerialNumber>) => void

  // Sale Orders
  createSaleOrder: (customerId: string, customerName: string) => SaleOrder
  updateSaleOrder: (id: string, p: Partial<SaleOrder>) => void
  addSOLine: (orderId: string, product: Product, qty: number, discount?: number, defaultTaxRate?: number) => void
  assignSerialToSOLine: (orderId: string, lineId: string, serialId: string) => void
  removeSOLine: (orderId: string, lineId: string) => void
  confirmSO: (id: string) => void
  resetSOToDraft: (id: string) => void
  cancelSO: (id: string) => void
  validateDelivery: (deliveryId: string) => void
  createInvoiceFromSO: (orderId: string) => Invoice
  deleteSaleOrder: (id: string) => void

  // Invoices
  updateInvoice: (id: string, p: Partial<Invoice>) => void
  postInvoice: (id: string) => void
  registerPayment: (invoiceId: string, amount: number, method?: string, bankAccountId?: string, reference?: string) => void
  deleteInvoice: (id: string) => void

  // Audit logs
  addAuditLog: (action: string, documentRef: string, details: string) => void

  // Purchase Orders
  createPO: (vendorId: string, vendorName: string) => PurchaseOrder
  updatePO: (id: string, p: Partial<PurchaseOrder>) => void
  addPOLine: (poId: string, product: Product, qty: number, unitPrice: number, taxRate?: number) => void
  removePOLine: (poId: string, lineId: string) => void
  updatePOLine: (poId: string, lineId: string, updates: Partial<Pick<POLine, 'qty' | 'unitPrice' | 'taxRate' | 'productName' | 'accountCode'>>) => void
  bulkAddPOLines: (poId: string, rows: { productId: string; productName: string; qty: number; unitPrice: number; taxRate: number; requiresSerial: boolean; importedSerials?: string[]; specs?: string; accountCode?: string }[]) => void
  sendPO: (id: string) => void
  confirmPO: (id: string) => void
  // Create receipt from PO (opens receiving dialog)
  createReceiptFromPO: (poId: string) => Receipt
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
  addLeaveRequest: (request: Omit<LeaveRequest, 'id' | 'ref' | 'submittedDate' | 'status'>) => LeaveRequest
  decideLeaveRequest: (id: string, approved: boolean, note?: string) => void
  createPayrollRun: (month: string, year: number) => PayrollRun
  approvePayrollRun: (id: string) => void
  postPayrollRun: (id: string) => void
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
  deliverRepair: (repairId: string, recipientName: string, recipientPhone: string) => void
  closeRepairJob: (repairId: string) => void
  createInvoiceFromRepair: (repairId: string, applyVat?: boolean) => Invoice | null
  
  // Repair Access Control
  canViewRepair: (repairId: string) => boolean
  getVisibleRepairs: () => RepairOrder[]
  updateRepairProgress: (repairId: string, newStatus: RepairStatus, message: string, notifyCustomer: boolean) => void
  
  // Parts Procurement
  requestProcurement: (repairId: string, items: any[], urgency: string, notes: string) => void
  
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
   createAdjustment: (productId: string, productName: string, type: 'subtract', qty: number, reason: AdjReason, notes: string) => StockAdjustment
  approveAdjustment: (adjId: string, approved: boolean) => void
  
  // Stock Reservations
  stockReservations: any[]
  reserveStock: (productId: string, qty: number, reservedFor: string, referenceId: string, referenceRef: string) => any
  getReservedQty: (productId: string) => number
  getAvailableStock: (productId: string) => number
  fulfillReservation: (productId: string, referenceId: string, qty: number) => void
  cancelReservation: (referenceId: string, reason: string) => void
  
  // Delivery & Fulfillment
  createDeliveryFromSO: (salesOrderId: string) => Delivery | null
  confirmDeliveryWithStockDeduction: (deliveryId: string) => void
  createInvoiceFromDelivery: (deliveryId: string) => Invoice | null
  
  // Approval Workflows
  approvalRequests: any[]
  checkDiscountApproval: (discountPercent: number) => { requiresApproval: boolean; roles: string[] }
  requestApproval: (type: string, details: any) => any
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
const uid = () => Math.random().toString(36).slice(2, 9)
const now = () => new Date().toISOString().slice(0, 10)
const addDays = (d: string, n: number) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10) }
const addMonths = (d: string, m: number) => { const dt = new Date(d); dt.setMonth(dt.getMonth() + m); return dt.toISOString().slice(0, 10) }

const makeC = () => ({
  so: 88, inv: 88, po: 39, rep: 0, del: 26, pos: 12, war: 10, rec: 0, tr: 0, ret: 0, adj: 0, rma: 0,
  opp: 15, quote: 24, activity: 0, outsource: 4, outsource_pay: 1, exp: 5, sop: 3, refurb: 0,
  djb: 3, rwp: 0, bbk: 0, don: 0, exc: 0, ko: 0, kd: 0, ks: 0, rfd: 0,
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

const calcStockByLocation = (product: Product | undefined, serials: SerialNumber[], bulkStock: BulkStockLevel[], productId: string): Record<LocationId, number> => {
  const locs: Record<LocationId, number> = { warehouse: 0, shop: 0, repair_unit: 0, vendor: 0, customer: 0, employee: 0 }
  if (!product) return locs
  if (product.requiresSerial) {
    serials.filter(s => s.productId === productId && s.status !== 'returned').forEach(s => { locs[s.location] = (locs[s.location] || 0) + 1 })
  } else {
    bulkStock.filter(level => level.productId === productId).forEach(level => { locs[level.location] = level.qty })
  }
  return locs
}

const upsertBulkStock = (levels: BulkStockLevel[], productId: string, location: LocationId, delta: number) => {
  const current = levels.find(level => level.productId === productId && level.location === location)?.qty ?? 0
  const nextQty = Math.max(0, current + delta)
  const remaining = levels.filter(level => !(level.productId === productId && level.location === location))
  return nextQty > 0 ? [...remaining, { productId, location, qty: nextQty }] : remaining
}

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

// ─── Server sync (debounced, 3s) ─────────────────────────────────────────────
const _pendingSync: Record<string, string> = {}
let _syncTimer: ReturnType<typeof setTimeout> | null = null
let _syncInstalled = false
let _serverHydrated = false

async function flushServerSync() {
  if (Object.keys(_pendingSync).length === 0) return
  const entries = { ..._pendingSync }
  Object.keys(entries).forEach(k => delete _pendingSync[k])
  try {
    const res = await fetch('/api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    })
    if (!res.ok) throw new Error('Sync failed')
  } catch { 
    // offline or failed — restore data to _pendingSync so it tries again
    Object.entries(entries).forEach(([k, v]) => {
      if (!_pendingSync[k]) _pendingSync[k] = v
    })
  }
}

function debouncedServerSync(key: string, value: string) {
  _pendingSync[key] = value
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
        fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
      }
    })
  }
}

// ─── Persistence helper ───────────────────────────────────────────────────────
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
    try {
      const serialized = JSON.stringify(state)
      window.localStorage.setItem(key, serialized)
      debouncedServerSync(key, serialized)
    } catch { /* quota exceeded */ }
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

    // 1. Hydrate from serverState immediately on mount
    if (serverState && Object.keys(serverState).length > 0 && !_serverHydrated) {
      for (const [k, v] of Object.entries(serverState)) {
        try {
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
      if (Object.keys(_pendingSync).length > 0) return // Skip if local changes are pending
      for (const [k, v] of Object.entries(remoteState)) {
        if (k.startsWith('deed_')) {
          const local     = window.localStorage.getItem(k)
          const remoteStr = typeof v === 'string' ? v : JSON.stringify(v)
          if (local !== remoteStr) {
            window.localStorage.setItem(k, remoteStr)
            window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key: k, value: remoteStr } }))
          }
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
  const [contacts, setContacts] = useState<Contact[]>(seedContacts)
  useEffect(() => {
    const fetchContacts = async () => {
      const res = await fetch('/api/contacts')
      if (res.ok) setContacts(await res.json())
    }
    fetchContacts()
  }, [])

  const [companies, setCompanies] = useState<Company[]>(seedCompanies)
  useEffect(() => {
    fetch('/api/companies').then(r => r.ok && r.json().then(setCompanies))
  }, [])

  const [contactPersons, setContactPersons] = useState<ContactPerson[]>(seedContactPersons)
  useEffect(() => {
    fetch('/api/contact-persons').then(r => r.ok && r.json().then(setContactPersons))
  }, [])

  const [opportunities, setOpportunities] = useState<Opportunity[]>(seedOpportunities)
  useEffect(() => {
    const fetchOpps = async () => {
      const res = await fetch('/api/opportunities')
      if (res.ok) setOpportunities(await res.json())
    }
    fetchOpps()
  }, [])

  const [opportunityActivities, setOpportunityActivities] = useState<OpportunityActivity[]>(seedOpportunityActivities)
  useEffect(() => {
    const fetchActs = async () => {
      const res = await fetch('/api/activities')
      if (res.ok) setOpportunityActivities(await res.json())
    }
    fetchActs()
  }, [])

  const [quotes, setQuotes] = useState<Quote[]>(seedQuotes)
  useEffect(() => {
    const fetchQuotes = async () => {
      const res = await fetch('/api/quotes')
      if (res.ok) setQuotes(await res.json())
    }
    fetchQuotes()
  }, [])
  
  // Products & Inventory
  const [products, setProducts] = useLS('deed_products', seedProducts)
  
  const [serials, setSerials] = useState<SerialNumber[]>(seedSerials)
  useEffect(() => {
    const fetchSerials = async () => {
      const res = await fetch('/api/serials')
      if (res.ok) setSerials(await res.json())
    }
    fetchSerials()
  }, [])
  
  // Sales & Invoicing
  const [saleOrders, setSaleOrders] = useState<SaleOrder[]>(seedSOs)
  useEffect(() => {
    const fetchSOs = async () => {
      const res = await fetch('/api/sales')
      if (res.ok) setSaleOrders(await res.json())
    }
    fetchSOs()
  }, [])

  const [deliveries, setDeliveries] = useState<Delivery[]>(seedDeliveries)
  useEffect(() => {
    const fetchDeliveries = async () => {
      const res = await fetch('/api/deliveries')
      if (res.ok) setDeliveries(await res.json())
    }
    fetchDeliveries()
  }, [])

  const [invoices, setInvoices] = useState<Invoice[]>(seedInvoices)
  useEffect(() => {
    const fetchInvoices = async () => {
      const res = await fetch('/api/invoices')
      if (res.ok) setInvoices(await res.json())
    }
    fetchInvoices()
  }, [])

  const [payments, setPayments] = useState<Payment[]>([])
  useEffect(() => {
    const fetchPayments = async () => {
      const res = await fetch('/api/payments')
      if (res.ok) setPayments(await res.json())
    }
    fetchPayments()
  }, [])

  // Purchasing
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(seedPOs)
  useEffect(() => {
    const fetchPOs = async () => {
      const res = await fetch('/api/purchase')
      if (res.ok) setPurchaseOrders(await res.json())
    }
    fetchPOs()
  }, [])

  const [receipts, setReceipts] = useState<Receipt[]>(seedReceipts)
  useEffect(() => {
    const fetchReceipts = async () => {
      const res = await fetch('/api/receipts')
      if (res.ok) setReceipts(await res.json())
    }
    fetchReceipts()
  }, [])

  const [stockTransfers, setStockTransfers] = useLS('deed_stockTransfers', seedTransfers)
  const [purchaseReturns, setPurchaseReturns] = useLS<PurchaseReturn[]>('deed_purchaseReturns', [])
  const [refurbishmentJobs, setRefurbishmentJobs] = useLS<RefurbishmentJob[]>('deed_refurbishmentJobs', seedRefurbishmentJobs)

  // Repairs
  const [repairs, setRepairs] = useLS<RepairOrder[]>('deed_repairs_v2', seedRepairs)

  // HR
  const [departments, setDepartments]   = useLS('deed_departments', seedDepartments)
  const [contracts, setContracts]       = useLS('deed_contracts', seedContracts)
  const [customerContracts, setCustomerContracts] = useLS('deed_customerContracts', seedCustomerContracts)
  const [hrDocuments, setHRDocuments]       = useLS('deed_hrDocuments', seedHRDocuments)
  const [workflowApprovals, setWorkflowApprovals] = useLS('deed_workflowApprovals', seedWorkflowApprovals)
  const [employeeAssetAssignments, setEmployeeAssetAssignments] = useLS('deed_employeeAssets', seedEmployeeAssetAssignments)

  const [employees, setEmployees] = useState<Employee[]>(seedEmployees)
  useEffect(() => {
    fetch('/api/employees').then(r => r.ok && r.json().then(setEmployees))
  }, [])

  const [leaveBalances, setLeaveBalances] = useLS<LeaveBalance[]>('deed_leaveBalances', seedLeaveBalances)
  const [leaveRequests, setLeaveRequests] = useLS<LeaveRequest[]>('deed_leaveRequests', seedLeaveRequests)
  useEffect(() => {
    fetch('/api/leave-requests').then(r => r.ok && r.json().then(data => {
      if (data.requests) setLeaveRequests(data.requests)
      if (data.balances) setLeaveBalances(data.balances)
    }))
  }, [])

  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>(seedPayrollRuns)
  const [payslips, setPayslips] = useState<Payslip[]>(seedPayslips)
  useEffect(() => {
    fetch('/api/payroll').then(r => r.ok && r.json().then(data => {
      if (data.runs) setPayrollRuns(data.runs)
      if (data.payslips) setPayslips(data.payslips)
    }))
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
      if (res.ok) setStockMoves(await res.json())
    }
    fetchMoves()
  }, [])
  
  const [stockAdjustments, setStockAdjustments] = useLS<StockAdjustment[]>('deed_stockAdjustments', [])
  const [stockReservations, setStockReservations] = useLS<any[]>('deed_stockReservations', [])

  // POS
  const [posOrders, setPosOrders]           = useLS<POSOrder[]>('deed_posOrders', []) // To be migrated
  const [posSessionOpen, setPosSessionOpen] = useLS<boolean>('deed_posSessionOpen', false)
  const [posSessionOpeningCash, setPosSessionOpeningCash] = useLS<number>('deed_posSessionOpeningCash', 0)

  // Approvals & Audit
  const [approvalRequests, setApprovalRequests] = useLS<any[]>('deed_approvalRequests', [])
  const [auditLogs, setAuditLogs]               = useLS<AuditLog[]>('deed_auditLogs', []) // To be migrated
  const [notifications, setNotifications]       = useLS<AppNotification[]>('deed_notifications', [])
  const [profileImages, setProfileImages]       = useLS<Record<string, string>>('deed_profileImages', {})

  // Delivery / Riders
  const [riders, setRiders]               = useLS<Rider[]>('deed_riders', seedRiders)
  const [deliveryJobs, setDeliveryJobs]   = useLS<DeliveryJob[]>('deed_deliveryJobs', seedDeliveryJobs)
  const [riderWeeklyPays, setRiderWeeklyPays] = useLS<RiderWeeklyPay[]>('deed_riderWeeklyPays', [])

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
        findings: r.diagnosis.findings,
        faultDescription: r.diagnosis.faultDescription,
        recommendedAction: r.diagnosis.recommendedAction,
        estimatedHours: r.diagnosis.estimatedHours,
        diagnosedDate: r.diagnosis.diagnosedDate,
      } : undefined,
      quote: r.quote ? {
        lines: r.quote.lines.map(l => ({ type: l.type as 'part' | 'labor' | 'logistics', description: l.description, qty: l.qty, unitPrice: l.unitPrice, subtotal: l.subtotal })),
        subtotal: r.quote.subtotal,
        tax: r.quote.tax,
        total: r.quote.total,
        validUntil: r.quote.validUntil,
        sentDate: r.quote.sentDate,
        approvedDate: r.quote.approvedDate,
        approvedBy: r.quote.approvedBy,
        rejectedDate: r.quote.rejectedDate,
        rejectionReason: r.quote.rejectionReason,
      } : undefined,
      statusHistory: [{ status: r.status as any, date: now(), note: historyNote }],
      repairStartDate: r.repairStartDate,
      slaMissed: r.slaMissed ?? false,
      underWarranty: r.underWarranty ?? false,
      notes: r.notes,
      preRepairPhotos: r.preRepairPhotos,
      qcReportData: r.qcReportData,
      qcReportName: r.qcReportName,
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
  const serialRef = useRef(serials);    serialRef.current = serials
  const repairsRef = useRef(repairs); repairsRef.current = repairs
  const soRef      = useRef(saleOrders); soRef.current   = saleOrders
  const invRef    = useRef(invoices);  invRef.current    = invoices
  const poRef     = useRef(purchaseOrders); poRef.current = purchaseOrders
  const recRef    = useRef(receipts);   recRef.current    = receipts
  const warRef    = useRef(warranties); warRef.current    = warranties
  const delRef    = useRef(deliveries); delRef.current    = deliveries
  const adjRef    = useRef(stockAdjustments); adjRef.current = stockAdjustments
  const empRef    = useRef(employees); empRef.current = employees
  const leaveBalRef = useRef(leaveBalances); leaveBalRef.current = leaveBalances
  const payrollRef = useRef(payrollRuns); payrollRef.current = payrollRuns
  const assetRef = useRef(employeeAssetAssignments); assetRef.current = employeeAssetAssignments
  const kilimallOrdersRef = useRef(kilimallOrders); kilimallOrdersRef.current = kilimallOrders
  const kilimallSettlementsRef = useRef(kilimallSettlements); kilimallSettlementsRef.current = kilimallSettlements

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
          setRepairs(prev => prev.map(r => {
            if (r.id !== repair.id || r.status !== 'awaiting_approval') return r
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
    const move: StockMove = { id: uid(), type, productId, productName, qty, reason, fromLocation: fromLoc, toLocation: toLoc, serialNumbers: serNums, date: now(), userId: 'James Kamau', documentRef: docRef }
    setStockMoves(p => [move, ...p])
    fetch('/api/stock-moves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(move) })
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
    products, serials,
    
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
      fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payment) })
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
        if (updatedP) fetch(`/api/payments/${paymentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedP) })
        return next
      })
      setInvoices(prev => {
        const next = prev.map(i => {
          if (i.id !== invoiceId) return i
          const newAmountPaid = i.amountPaid + amount
          return { ...i, amountPaid: newAmountPaid, status: newAmountPaid >= i.total ? 'paid' as const : 'posted' as const }
        })
        const updatedI = next.find(i => i.id === invoiceId)
        if (updatedI) fetch(`/api/invoices/${invoiceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedI) })
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
    payrollRuns, payslips, employeeAssetAssignments,
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
      setProfileImages(prev => ({ ...prev, [userId]: dataUrl }))
    },

    // Cashbook & bank reconciliation
    bankAccounts, bankRecons, bankStatementLines,
    addStatementLine: (line) => {
      setBankStatementLines(prev => [...prev, { ...line, id: uid() }])
    },
    updateStatementLine: (id, p) => setBankStatementLines(prev => prev.map(l => l.id === id ? { ...l, ...p } : l)),
    deleteStatementLine: (id) => setBankStatementLines(prev => prev.filter(l => l.id !== id)),
    matchStatementLine: (statementId, entryId) => {
      setBankStatementLines(prev => prev.map(l =>
        l.id === statementId ? { ...l, matchedEntryId: entryId } : l
      ))
    },
    unmatchStatementLine: (statementId) => {
      setBankStatementLines(prev => prev.map(l =>
        l.id === statementId ? { ...l, matchedEntryId: undefined } : l
      ))
    },
    autoMatchStatements: (bankAccountId, month, cashbookEntries) => {
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
      if (existing) {
        setBankRecons(prev => prev.map(r => r.id === existing.id
          ? { ...r, ...recon, reconciledBy: user?.name, reconciledAt: now() }
          : r))
      } else {
        const newRecon: BankRecon = { ...recon, id: uid(), reconciledBy: user?.name, reconciledAt: now() }
        setBankRecons(prev => [...prev, newRecon])
      }
      showToast('Bank reconciliation saved', 'success')
    },
    updateBankRecon: (id, p) => setBankRecons(prev => prev.map(r => r.id === id ? { ...r, ...p } : r)),
    updateBankAccount: (id, p) => setBankAccountsState(prev => prev.map(a => a.id === id ? { ...a, ...p } : a)),
    addBankAccount: (a) => setBankAccountsState(prev => [...prev, { ...a, id: uid() }]),
    deleteBankAccount: (id) => setBankAccountsState(prev => prev.filter(a => a.id !== id)),
    companySettings,
    updateCompanySettings: (p) => setCompanySettings(prev => ({ ...prev, ...p })),
    systemSettings,
    updateSystemSettings: (p) => setSystemSettings(prev => ({ ...prev, ...p })),

    sops, sopActuals,

    hrSops,
    hrPerfTargets,
    saveHrSops: setHrSops,
    saveHrPerfTargets: setHrPerfTargets,

    createSOP: (s) => {
      const user = currentUser()
      if (!user) throw new Error('Not authenticated')
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
      if (!user) throw new Error('Not authenticated')
      const expense: Expense = {
        ...e,
        id: uid(),
        ref: seq('EXP', 'exp'),
        submittedByUserId: user.id,
        submittedByName: user.name,
        submittedDate: now(),
        status: 'submitted',
        createdAt: now(),
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
      setExpenses(prev => prev.map(e =>
        e.id === id
          ? { ...e, status: approved ? 'approved' : 'rejected', reviewedByUserId: user.id, reviewedByName: user.name, reviewedDate: now(), reviewNotes: notes }
          : e
      ))
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
      showToast(approved ? 'Expense approved' : 'Expense rejected', approved ? 'success' : 'error')
    },

    reimburseExpense: (id, notes, method, bankAccountId, reference) => {
      const user = currentUser()
      if (!user) return
      const append = method ? `[Paid via ${method}${bankAccountId ? ` (Bank: ${bankAccountId})` : ''}${reference ? ` Ref: ${reference}` : ''}] ` : ''
      setExpenses(prev => prev.map(e =>
        e.id === id
          ? { ...e, status: 'reimbursed', reviewNotes: append + (notes ?? e.reviewNotes ?? '') }
          : e
      ))
      showToast('Expense marked as reimbursed', 'success')
    },

    outsourceVendors, outsourceJobs, outsourcePayments,

    addOutsourceVendor: (v) => {
      const vendor: OutsourceVendor = { ...v, id: uid(), createdAt: now() }
      setOutsourceVendors(prev => [...prev, vendor])
      showToast('Vendor added', 'success')
      return vendor
    },

    updateOutsourceVendor: (id, p) => {
      setOutsourceVendors(prev => prev.map(v => v.id === id ? { ...v, ...p } : v))
    },

    addOutsourceJob: (j) => {
      const user = currentUser()
      if (!user) throw new Error('Not authenticated')
      const job: OutsourceJob = {
        ...j,
        id: uid(),
        ref: seq('OUT', 'outsource'),
        sentByUserId: user.id,
        sentByName: user.name,
        status: 'sent',
        createdAt: now(),
      }
      setOutsourceJobs(prev => [job, ...prev])
      showToast(`Job ${job.ref} created`, 'success')
      return job
    },

    returnOutsourceJob: (id, p) => {
      setOutsourceJobs(prev => prev.map(j =>
        j.id === id
          ? { ...j, ...p, status: p.isResolved ? 'returned_resolved' : 'returned_unresolved' }
          : j
      ))
      showToast('Job marked as returned', 'success')
    },

    recordOutsourcePayment: (p) => {
      const user = currentUser()
      if (!user) throw new Error('Not authenticated')
      const payment: OutsourcePayment = {
        ...p,
        id: uid(),
        ref: seq('OPAY', 'outsource_pay'),
        paidByUserId: user.id,
        paidByName: user.name,
        createdAt: now(),
      }
      setOutsourcePayments(prev => [payment, ...prev])
      showToast(`Payment ${payment.ref} recorded`, 'success')
      return payment
    },

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
      if (temporaryPassword) {
        window.alert(`User created for ${user.name}.\n\nAutomatic credential delivery is disabled.\n\nTemporary password (share securely):\n\n${temporaryPassword}`)
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
          window.alert(`Credentials reset for ${data.user?.name || 'the user'}.\n\nAutomatic credential delivery is disabled.\n\nNew temporary password (share securely):\n\n${temporaryPassword}`)
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
          fetch(`/api/employees/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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

      // December leave may only be taken in December
      if (request.leaveType === 'december_leave') {
        const startMonth = new Date(request.startDate).getMonth() + 1 // 1-12
        const endMonth   = new Date(request.endDate).getMonth() + 1
        if (startMonth !== 12 || endMonth !== 12) {
          showToast('December leave can only be taken in December', 'error'); throw new Error('December leave outside December')
        }
      }

      // Check available balance
      const year = new Date(request.startDate).getFullYear()
      const bal  = leaveBalRef.current.find(b => b.employeeId === request.employeeId && b.leaveType === request.leaveType && b.year === year)
      if (bal) {
        const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
        if (request.days > available) {
          showToast(`Insufficient ${request.leaveType === 'december_leave' ? 'December' : 'flexible'} leave balance (${available} day(s) available)`, 'error')
          throw new Error('Insufficient balance')
        }
      }

      const leave: LeaveRequest = { ...request, id: uid(), ref: seq('LV', 'ret'), submittedDate: now(), status: 'pending_hr', submittedByUserId: user.id }
      setLeaveRequests(prev => [leave, ...prev])
      setLeaveBalances(prev => prev.map(b => b.employeeId === leave.employeeId && b.leaveType === leave.leaveType && b.year === year ? { ...b, pending: b.pending + leave.days } : b))
      const approval: WorkflowApproval = { id: uid(), process: 'leave', ref: leave.ref, targetId: leave.id, targetName: `${leave.employeeName} ${leave.leaveType === 'december_leave' ? 'December' : 'Flexible'} leave`, stepName: 'HR Approval', approverRole: 'director', status: 'pending', requestedBy: leave.employeeName, requestedDate: now() }
      setWorkflowApprovals(prev => [approval, ...prev])
      // Notify directors who handle leave approval
      users.filter(u => u.role === 'director').forEach(u => pushNotif({
        userId: u.id, type: 'leave',
        title: `Leave request from ${leave.employeeName}`,
        body: `${leave.days} day(s) ${leave.leaveType.replace(/_/g, ' ')} — ${leave.startDate} to ${leave.endDate}. Reason: ${leave.reason}`,
        module: 'hr', path: '?tab=leave',
        icon: '🌴',
      }))
      addAuditLog('create_leave', leave.ref, `Leave request created for ${leave.employeeName}`)
      showToast('Leave application submitted — awaiting HR approval')
      return leave
    },
    decideLeaveRequest: (id, approved, note) => {
      const leave = leaveRequests.find(req => req.id === id)
      if (!leave) return
      const user = currentUser()
      
      let canApprove = false;
      if (user?.role === 'director') canApprove = true;
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
              if (updatedReq) fetch(`/api/leave-requests/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: updatedReq, balances: nextBals.filter(b => b.employeeId === leave.employeeId) }) })
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
    createPayrollRun: (month, year) => {
      if (!canManageHR(currentUser())) { showToast('Only HR admins can prepare payroll', 'error'); throw new Error('Unauthorized payroll run creation') }
      const lines = empRef.current.filter(emp => emp.status === 'active').map(emp => {
        const allowances = emp.housingAllowance + emp.transportAllowance
        const deductions = Math.round(emp.basicSalary * 0.18)
        return { employeeId: emp.id, employeeName: emp.fullName, basicSalary: emp.basicSalary, allowances, deductions, netPay: emp.basicSalary + allowances - deductions }
      })
      const totalGross = lines.reduce((sum, line) => sum + line.basicSalary + line.allowances, 0)
      const totalDeductions = lines.reduce((sum, line) => sum + line.deductions, 0)
      const totalNet = lines.reduce((sum, line) => sum + line.netPay, 0)
      const payroll: PayrollRun = { id: uid(), ref: `PAY/${year}/${month}`, month, year, status: 'pending_approval', lines, totalGross, totalDeductions, totalNet }
      setPayrollRuns(prev => [payroll, ...prev])
          
          const newPayslips = lines.map((line, index) => ({ id: uid(), ref: `PS/${year}/${month}/${String(index + 1).padStart(3, '0')}`, payrollRunId: payroll.id, employeeId: line.employeeId, employeeName: line.employeeName, month, year, grossPay: line.basicSalary + line.allowances, deductions: line.deductions, netPay: line.netPay, status: 'draft' as const, generatedDate: now(), downloadUrl: `/payslips/${year}-${month}-${line.employeeId}.pdf` }))
          setPayslips(prev => [...newPayslips, ...prev])
          fetch('/api/payroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: payroll, payslips: newPayslips }) })
          
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
            fetch(`/api/payroll/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) })
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
            fetch(`/api/payroll/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'posted', postedJournalId: journal.id }) })
            return next
          })
      setPayslips(prev => prev.map(payslip => payslip.payrollRunId === payroll.id ? { ...payslip, status: 'published' } : payslip))
      addAuditLog('post_payroll', payroll.ref, `Payroll posted to accounting journal ${journal.ref}`)
      showToast('Payroll posted to accounting journal')
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
      setContacts(p => [contact, ...p])
      showToast(`${contact.name} added`, 'success')
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
      fetch('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(company) })
      addAuditLog('create_company', company.name, `Company ${company.name} added to CRM`)
      showToast(`Company ${company.name} created`)
      return company
    },
    updateCompany: (id, p) => {
      setCompanies(prev => {
        const next = prev.map(c => c.id === id ? { ...c, ...p } : c)
        const updated = next.find(c => c.id === id)
        if (updated) fetch(`/api/companies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('update_company', id, `Company updated`)
      showToast('Company updated')
    },
    deleteCompany: (id) => {
      const company = companies.find(c => c.id === id)
      setCompanies(p => p.filter(c => c.id !== id))
      fetch(`/api/companies/${id}`, { method: 'DELETE' })
      addAuditLog('delete_company', id, `Company ${company?.name} deleted`)
      showToast('Company deleted')
    },
    
    // ── CRM - Contact Persons ──────────────────────────────────────────────────
    createContactPerson: (c) => {
      const contactPerson: ContactPerson = {
        ...c,
        id: uid(),
        fullName: `${c.firstName} ${c.lastName}`,
        createdDate: now(),
      }
      setContactPersons(p => [contactPerson, ...p])
      fetch('/api/contact-persons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contactPerson) })
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
        if (updatedObj) fetch(`/api/contact-persons/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedObj) })
        return next
      })
      showToast('Contact person updated')
    },
    deleteContactPerson: (id) => {
      setContactPersons(p => p.filter(c => c.id !== id))
      fetch(`/api/contact-persons/${id}`, { method: 'DELETE' })
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
      fetch('/api/opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opportunity) })
      return opportunity
    },
    updateOpportunity: (id, p) => setOpportunities(prev => {
      const next = prev.map(o => o.id === id ? { ...o, ...p, lastActivityDate: now() } : o)
      const updated = next.find(o => o.id === id)
      if (updated) fetch(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
      if (updated) fetch(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
      if (updated) fetch(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
      if (updated) fetch(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      addAuditLog('lose_opportunity', id, `Opportunity lost - Reason: ${reason}`)
      showToast('Opportunity marked as lost')
      return next
    }),
    deleteOpportunity: (id) => {
      setOpportunities(p => p.filter(o => o.id !== id))
      fetch(`/api/opportunities/${id}`, { method: 'DELETE' })
      addAuditLog('delete_opportunity', id, `Opportunity deleted`)
      showToast('Opportunity deleted')
    },
    
    // ── CRM - Opportunity Activities ───────────────────────────────────────────
    logActivity: (activity) => {
      const user = currentUser()
      if (!user) return {} as OpportunityActivity
      
      const act: OpportunityActivity = {
        ...activity,
        id: uid(),
        createdBy: user.id,
        createdByName: user.name,
        createdDate: now(),
      }
      setOpportunityActivities(p => [act, ...p])
      fetch('/api/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(act) })
      setOpportunities(prev => {
        const next = prev.map(o => o.id === activity.opportunityId ? { ...o, lastActivityDate: now() } : o)
        const updated = next.find(o => o.id === activity.opportunityId)
        if (updated) fetch(`/api/opportunities/${activity.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
      if (updated) fetch(`/api/activities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) }) // If you want to build this PUT endpoint later, else it falls back gracefully
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
      if (!user) return {} as Quote
      
      const quote: Quote = {
        ...quoteInput,
        id: uid(),
        ref: seq('QTE', 'quote'),
        version: 1,
        issueDate: now(),
        viewCount: 0,
        createdBy: user.id,
        createdByName: user.name,
      }
      setQuotes(p => [quote, ...p])
      fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quote) })
      setOpportunities(prev => {
        const next = prev.map(o => o.id === quote.opportunityId ? { ...o, quoteIds: [...o.quoteIds, quote.id] } : o)
        const updated = next.find(o => o.id === quote.opportunityId)
        if (updated) fetch(`/api/opportunities/${quote.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('create_quote', quote.ref, `Quote created for ${quote.companyName}`)
      showToast(`Quote ${quote.ref} created`)
      return quote
    },
    updateQuote: (id, p) => setQuotes(prev => {
      const next = prev.map(q => q.id === id ? { ...q, ...p } : q)
      const updated = next.find(q => q.id === id)
      if (updated) fetch(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        if (updated) fetch(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        if (updated) fetch(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      
      showToast('Line item removed')
    },
    sendQuote: (id) => setQuotes(prev => {
      const next = prev.map(q => q.id === id ? { ...q, status: 'sent', sentDate: now() } : q)
      const updated = next.find(q => q.id === id)
      if (updated) fetch(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      const quote = quotes.find(q => q.id === id)
      addAuditLog('send_quote', quote?.ref ?? id, `Quote sent to ${quote?.contactPersonName}`)
      showToast('Quote sent to customer')
      return next
    }),
    acceptQuote: (id) => setQuotes(prev => {
      const next = prev.map(q => q.id === id ? { ...q, status: 'accepted', acceptedDate: now() } : q)
      const updated = next.find(q => q.id === id)
      if (updated) fetch(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      const quote = quotes.find(q => q.id === id)
      setOpportunities(p => {
        const n = p.map(o => o.id === quote?.opportunityId ? { ...o, stage: 'closed_won', probability: 100, lastActivityDate: now() } : o)
        const up = n.find(o => o.id === quote?.opportunityId)
        if (up) fetch(`/api/opportunities/${quote?.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(up) })
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
      if (updated) fetch(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      const quote = quotes.find(q => q.id === id)
      addAuditLog('reject_quote', quote?.ref ?? id, `Quote rejected: ${reason}`)
      showToast('Quote rejected by customer')
      return next
    }),
    convertQuoteToSaleOrder: (quoteId) => {
      const quote = quotes.find(q => q.id === quoteId)
      if (!quote) return {} as SaleOrder
      
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
      fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })
      setQuotes(prev => {
        const next = prev.map(q => q.id === quoteId ? {
          ...q, status: 'accepted', saleOrderId: so.id, convertedDate: now(),
        } : q)
        const updated = next.find(q => q.id === quoteId)
        if (updated) fetch(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
          if (updated) fetch(`/api/opportunities/${quote.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
      fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })

      const invLines: InvoiceLine[] = quote.lines.map(ql => ({
        id: uid(),
        description: ql.description ?? ql.productName,
        qty: ql.qty,
        unitPrice: ql.unitPrice,
        taxRate: quote.tax > 0 ? companySettings.vatRate : 0,
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
      fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })

      setQuotes(p => {
        const next = p.map(q => q.id === quoteId ? {
          ...q, status: 'accepted', saleOrderId: soId, invoiceId: invoice.id, acceptedDate: now(), convertedDate: now(),
        } : q)
        const updated = next.find(q => q.id === quoteId)
        if (updated) fetch(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        fetch(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next.find(q => q.id === quoteId)) })
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
      fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newQuote) })
      addAuditLog('revise_quote', newQuote.ref, `Quote revised from ${originalQuote.ref} - v${newQuote.version}`)
      showToast(`Revised quote ${newQuote.ref} (v${newQuote.version}) created`)
      return newQuote
    },
    deleteQuote: (id) => {
      const quote = quotes.find(q => q.id === id)
      setQuotes(p => p.filter(q => q.id !== id))
      fetch(`/api/quotes/${id}`, { method: 'DELETE' })
      addAuditLog('delete_quote', quote?.ref ?? id, `Quote deleted`)
      showToast('Quote deleted')
    },

    // ── Products ─────────────────────────────────────────────────────────────
    addProduct: async (p) => {
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
      // This will be migrated to a PUT /api/products/[id] call next.
      // For now, we keep the client-side logic to avoid breaking things.
      setProducts(prev => prev.map(x => {
        if (x.id !== id) return x
        const updated = { ...x, ...p }
        const catCfg = CATEGORY_CONFIG[updated.category as CategoryId]
        if (catCfg) updated.requiresSerial = catCfg.serialRequired
        return updated
      }))
      showToast('Product master updated')
    },
    deleteProduct: (id) => {
      if (!canApproveInventoryAction(currentUser())) { showToast('Only inventory approvers can delete product masters', 'error'); return }
      setProducts(p => p.filter(x => x.id !== id))
      setBulkStock(p => p.filter(level => level.productId !== id))
      showToast('Product deleted')
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
            fetch('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
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
      if (updated) fetch(`/api/serials/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      return next
    }),

    // ── Sale Orders ───────────────────────────────────────────────────────────
    createSaleOrder: (customerId, customerName) => {
      const user = currentUser()
      const so: SaleOrder = { id: uid(), ref: seq('SO', 'so'), status: 'quotation', customerId, customerName, date: now(), validUntil: addDays(now(), 30), lines: [], subtotal: 0, taxTotal: 0, total: 0, notes: '', createdByUserId: user?.id, createdByName: user?.name }
      setSaleOrders(p => [so, ...p]); showToast(`${so.ref} created`); return so
      fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })
      return so
    },
    updateSaleOrder: (id, p) => setSaleOrders(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...p } : s)
      const updated = next.find(s => s.id === id)
      if (updated) fetch(`/api/sales/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      return next
    }),
    addSOLine: (orderId, product, qty, discount = 0, defaultTaxRate = 0) => {
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
        fetch(`/api/sales/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        fetch(`/api/sales/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        fetch(`/api/sales/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
    },
    confirmSO: (id) => {
      const user = currentUser()
      if (!user || !['director', 'sales_rep', 'admin_officer'].includes(user.role)) {
        showToast('Unauthorized to confirm Sales Orders', 'error'); return;
      }
      const so = soRef.current.find(s => s.id === id)!
      // Validate serial assignment for serialized products
      for (const line of so.lines) {
        const prod = prodRef.current.find(p => p.id === line.productId)
        if (prod?.requiresSerial && line.serialIds.length < line.qty) {
          showToast(`Assign all serial numbers for ${line.productName} (${line.serialIds.length}/${line.qty} assigned)`, 'error'); return
        }
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
      fetch('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(del) })
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s;
        const updated = { ...s, status: 'confirmed' as const, deliveryId: del.id }
        fetch(`/api/sales/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
      setDeliveries(p => {
        const next = p.map(d => d.id === deliveryId ? { ...d, status: 'done' as const, warrantyCreated: newWarranties.length > 0, lines: d.lines.map(l => ({ ...l, qtyDone: l.qty })) } : d)
        return next
      })
      setSaleOrders(p => p.map(s => {
        if (s.id !== del.saleOrderId) return s;
        const updated = { ...s, status: 'delivered' as const }
        return updated
      }))
      fetch(`/api/deliveries/${deliveryId}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoInvoice: false }) }).catch(console.error)
      showToast(`Delivery done · stock updated${newWarranties.length > 0 ? ` · ${newWarranties.length} warranty(ies) created` : ''}`)
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
      fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv) })
      setSaleOrders(p => p.map(s => {
        if (s.id !== orderId) return s;
        const updated = { ...s, invoiceId: inv.id, status: 'invoiced' as const }
        fetch(`/api/sales/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      showToast(`Invoice ${inv.ref} created`); return inv
    },
    deleteSaleOrder: (id) => { 
      setSaleOrders(p => p.filter(s => s.id !== id)); 
      fetch(`/api/sales/${id}`, { method: 'DELETE' })
      showToast('Order deleted') 
    },
    resetSOToDraft: (id) => {
      setSaleOrders(p => p.map(s => {
        if (s.id !== id) return s;
        const updated = { ...s, status: 'quotation' as const, savedAt: undefined, deliveryId: undefined }
        fetch(`/api/sales/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        fetch(`/api/sales/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return updated
      }))
      showToast('Order cancelled')
    },

    // ── Invoices ──────────────────────────────────────────────────────────────
    updateInvoice: (id, p) => setInvoices(prev => {
      const next = prev.map(i => i.id === id ? { ...i, ...p } : i)
      const updated = next.find(i => i.id === id)
      if (updated) fetch(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      return next
    }),
    postInvoice: (id) => {
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance can post invoices', 'error'); return;
      }
      setInvoices(p => {
        const next = p.map(i => i.id === id ? { ...i, status: 'posted' as const } : i)
        const updated = next.find(i => i.id === id)
        if (updated) fetch(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      showToast('Invoice posted')
    },
    registerPayment: (invoiceId, amount, method, bankAccountId, reference) => {
      if (!canManageFinance(currentUser())) {
        showToast('Only Finance can register payments', 'error'); return;
      }
      setInvoices(p => {
        const next = p.map(inv => {
          if (inv.id !== invoiceId) return inv
          const paid = inv.amountPaid + amount
          const append = method ? `\nPaid ${fmtKes(amount)} via ${method}${bankAccountId ? ` (Bank: ${bankAccountId})` : ''}${reference ? ` Ref: ${reference}` : ''}` : ''
          return { ...inv, amountPaid: paid, status: paid >= inv.total ? 'paid' as const : 'posted' as const, notes: (inv.notes || '') + append }
        })
        const updated = next.find(i => i.id === invoiceId)
        if (updated) fetch(`/api/invoices/${invoiceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('register_payment', invoiceId, `Registered payment of KES ${amount} for invoice ${invoiceId}${reference ? ` (Ref: ${reference})` : ''}`)
      showToast('Payment registered')
    },
    deleteInvoice: (id) => { 
      setInvoices(p => p.filter(i => i.id !== id)); 
      fetch(`/api/invoices/${id}`, { method: 'DELETE' })
      showToast('Invoice deleted') 
    },
    addAuditLog: (action, documentRef, details) => { addAuditLog(action, documentRef, details) },

    // ── Purchase Orders ───────────────────────────────────────────────────────
    createPO: (vendorId, vendorName) => {
      if (!canManageProcurement(currentUser())) {
        showToast('Only Inventory or Admin can create Purchase Orders', 'error'); return {} as PurchaseOrder;
      }
      const po: PurchaseOrder = {
        id: uid(), ref: seq('PO', 'po'), status: 'draft', vendorId, vendorName,
        date: now(), expectedDate: addDays(now(), 7),
        lines: [], subtotal: 0, taxTotal: 0, total: 0, notes: '', receiptIds: [],
      }
      setPurchaseOrders(p => [po, ...p]); addAuditLog('create_po', po.ref, `Draft purchase order created for vendor ${vendorName}`)
      showToast(`${po.ref} created`);
      fetch('/api/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(po) })
      return po
    },
    updatePO: (id, p) => setPurchaseOrders(prev => {
      const next = prev.map(po => po.id === id ? { ...po, ...p } : po)
      const updated = next.find(po => po.id === id)
      if (updated) fetch(`/api/purchase/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        if (updated) fetch(`/api/purchase/${poId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
    },
    removePOLine: (poId, lineId) => {
      setPurchaseOrders(p => {
        const next = p.map(po => { if (po.id !== poId) return po; const lines = po.lines.filter(l => l.id !== lineId); return { ...po, lines, ...calcPO(lines) } })
        const updated = next.find(po => po.id === poId)
        if (updated) fetch(`/api/purchase/${poId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        if (updated) fetch(`/api/purchase/${poId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        if (updated) fetch(`/api/purchase/${poId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        if (updated) fetch(`/api/purchase/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('send_po', po.ref, `PO sent to vendor ${po.vendorName}`)
      showToast('PO sent to vendor')
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
      fetch('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) })
      setPurchaseOrders(p => {
        const next = p.map(po => po.id === id ? { ...po, status: 'confirmed' as const } : po)
        const updated = next.find(po => po.id === id)
        if (updated) fetch(`/api/purchase/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('confirm_po', po.ref, `PO confirmed — receipt ${receipt.ref} created automatically`)
      showToast(`Order confirmed · Receipt ${receipt.ref} ready for goods receiving`)
    },
    createReceiptFromPO: (poId) => {
      const po = poRef.current.find(p => p.id === poId)!
      const receipt: Receipt = {
        id: uid(), ref: seq('REC', 'rec'), poId, poRef: po.ref,
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
      fetch('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) })
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
            fetch('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
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
        const updated = next.find(r => r.id === receiptId)
        if (updated) fetch(`/api/receipts/${receiptId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })

      // Update PO quantities and status (receiptId already added in confirmPO)
      setPurchaseOrders(p => {
        const next = p.map(po => {
          if (po.id !== receipt.poId) return po
          const updatedLines = po.lines.map(l => {
            const rl = lines.find(x => x.productId === l.productId)
            if (!rl) return l
            return { ...l, qtyReceived: l.qtyReceived + rl.qtyReceived }
          })
          const allReceived = updatedLines.every(l => l.qtyReceived >= l.qty)
          const anyReceived = updatedLines.some(l => l.qtyReceived > 0)
          const newReceiptIds = po.receiptIds.includes(receiptId) ? po.receiptIds : [...po.receiptIds, receiptId]
          return { ...po, lines: updatedLines, status: allReceived ? 'received' as const : anyReceived ? 'partial' as const : po.status, receiptIds: newReceiptIds }
        })
        const updated = next.find(po => po.id === receipt.poId)
        if (updated) fetch(`/api/purchase/${receipt.poId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      })
      addAuditLog('validate_receipt', receipt.ref, `Stock received from ${receipt.vendorName}`)
      showToast(`Stock received · use "Create Bill" to generate the vendor invoice`)
    },
    deletePO: (id) => { 
      setPurchaseOrders(p => p.filter(po => po.id !== id)); 
      fetch(`/api/purchase/${id}`, { method: 'DELETE' })
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
      fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bill) })
      setPurchaseOrders(p => {
        const next = p.map(x => x.id === poId ? { ...x, billId: bill.id } : x)
        const updated = next.find(x => x.id === poId)
        if (updated) fetch(`/api/purchase/${poId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
      setPurchaseReturns(p => [ret, ...p]); showToast(`Return ${ret.ref} created`); return ret
    },
    addReturnLine: (returnId, productId, productName, qty, serialIds, requiresSerial) => {
      setPurchaseReturns(p => p.map(r => r.id !== returnId ? r : { ...r, lines: [...r.lines, { productId, productName, qty, serialIds, requiresSerial }] }))
    },
    confirmPurchaseReturn: (returnId) => {
      const ret = purchaseReturns.find(r => r.id === returnId)!
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
          return { id: uid(), description: `RETURN: ${l.productName} ×${l.qty}`, qty: l.qty, unitPrice: -up, taxRate: 16, subtotal: -(l.qty * up) }
        }),
        subtotal: -creditTotal, taxTotal: -Math.round(creditTotal * 0.16), total: -(creditTotal + Math.round(creditTotal * 0.16)), amountPaid: 0,
        purchaseOrderId: ret.poId, notes: `Purchase return ${ret.ref}`,
      }
      setInvoices(p => [creditNote, ...p])
      fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creditNote) })
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
        ref: `REP-TEMP-${Date.now()}`,
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
        // Sync portal when report fields change so customers can download them
        if ('qcReportData' in p || 'diagnosisReportData' in p || 'preRepairPhotos' in p) {
          setTimeout(() => syncRepairToPortal(updated), 0)
        }
        return updated
      }))
    },
    deleteRepair: (_id) => {
      showToast('Booked repairs cannot be deleted', 'error')
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
        showToast('Only the assigned technician can log a diagnosis', 'error'); return
      }
      
      const diagnosis: RepairDiagnosis = {
        ...diagnosisInput,
        diagnosedBy: user.name,
        diagnosedDate: now(),
      }
      
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        diagnosis,
        status: 'diagnosed',
      } : r))

      if (repair) syncRepairToPortal({ ...repair, diagnosis, status: 'diagnosed' }, 'Diagnosis completed')
      addAuditLog('diagnose_repair', repairId, `Diagnosis logged: ${diagnosis.findings}`)
      showToast('Diagnosis logged — choose to proceed to repair or stop here')
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
      // Restricted to technical roles only for accuracy
      const canGenerate = ['director', 'technical_lead'].includes(user.role) || repair.assignedTechnicianId === user.id
      if (!canGenerate) {
        showToast('Only the assigned technician or lead technician can generate a quote', 'error'); return
      }
      const QUOTABLE_STATUSES = repair.repairPath === 'direct_repair'
        ? ['assigned', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair']
        : ['diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair']
      if (!QUOTABLE_STATUSES.includes(repair.status)) {
        showToast('Cannot generate a new quote at this stage', 'error'); return
      }
      const isUpdate = !!repair.quote

      const lines: RepairQuoteLine[] = incomingLines.map(line => ({
        ...line,
        id: uid(),
        reserved: false,
      }))
      
      const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
      const tax = applyVat ? Math.round(subtotal * (companySettings.vatRate / 100)) : 0
      
      const quote: RepairQuote = {
        id: uid(),
        lines,
        subtotal,
        tax,
        total: subtotal + tax,
        validUntil: addDays(now(), 7),
        sentDate: now(),
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

      if (isUpdate && repair.saleOrderId) {
        // Update the existing sale order lines/totals
        setSaleOrders(p => p.map(s => s.id === repair.saleOrderId ? {
          ...s, lines: soLines, subtotal: quote.subtotal, taxTotal: 0,
          total: repair.underWarranty ? 0 : quote.total,
        } : s))
      } else {
        // First-time quote — create a Sale Order (quotation status) in Sales module
        const soId = uid()
        const soRef = seq('SO', 'so')
        setSaleOrders(p => [{
          id: soId, ref: soRef, status: 'quotation' as const,
          customerId: repair.customerId, customerName: repair.customerName,
          date: now(), validUntil: addDays(now(), 7),
          lines: soLines, subtotal: quote.subtotal, taxTotal: 0,
          total: repair.underWarranty ? 0 : quote.total,
          notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
          createdByUserId: user.id,
        }, ...p])
        linkedSaleOrderId = soId
        linkedSaleOrderRef = soRef
      }

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        quote,
        laborCost: derivedLaborCost,
        logisticsCost: derivedLogisticsCost,
        total: repair.underWarranty ? 0 : quote.total,
        status: 'awaiting_approval',
        quoteApprovalDeadline: quote.validUntil,
        saleOrderId: linkedSaleOrderId,
        saleOrderRef: linkedSaleOrderRef,
      } : r))

      syncRepairToPortal({ ...repair, quote, laborCost: derivedLaborCost, logisticsCost: derivedLogisticsCost, total: repair.underWarranty ? 0 : quote.total, status: 'awaiting_approval', quoteApprovalDeadline: quote.validUntil }, isUpdate ? 'Quote updated — awaiting your approval' : 'Quote sent — awaiting your approval')
      addAuditLog(isUpdate ? 'update_quote' : 'generate_quote', repairId, `Quote ${isUpdate ? 'updated' : 'generated'}: KES ${quote.total}`)
      // Notify customer via SMS with tracking link
      if (repair.customerPhone) {
        const trackingUrl = typeof window !== 'undefined' ? `${window.location.origin}/portal/repair/${encodeURIComponent(repair.ref)}` : undefined
        fetch('/api/notifications/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'quote', customerName: repair.customerName, customerPhone: repair.customerPhone, repairRef: repair.ref, deviceName: repair.productName, quoteTotal: quote.total, quoteUrl: trackingUrl }),
        }).catch(() => {})
      }
      showToast(isUpdate ? 'Quote updated — customer re-notified via SMS' : 'Quote generated — customer notified via SMS')
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
      
      // Send via WhatsApp/SMS
      if (repair.customerPhone) {
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
              customerPhone: repair.customerPhone,
              repairRef: repair.ref,
              deviceName: repair.productName,
              quoteTotal: repair.quote.total,
              quoteUrl: portalUrl
            })
          })

          const result = await response.json()

          if (result.success) {
            showToast(`Quote sent to ${repair.customerName} via ${result.channel?.toUpperCase()}`, 'success')
          } else {
            showToast(`Quote sent • Notification failed: ${result.error}`, 'error')
          }
        } catch (error) {
          console.error('Quote notification error:', error)
          showToast('Quote sent • Notification error', 'error')
        }
      } else {
        showToast(`Quote prepared • No phone number for ${repair.customerName}`, 'info')
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
        // Automatically request procurement if parts are missing
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

        if (missingItems.length > 0) {
          const { requestProcurement } = useApp.getState()
          requestProcurement(repairId, missingItems, 'normal', `Auto-generated due to quote approval for ${repair.ref}`)
          showToast('Insufficient stock. Procurement request auto-generated.', 'info')
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
          fetch(`/api/sales/${soId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next.find(s => s.id === soId)) })
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
        fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSo) })
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
        total: repair.quote.total, amountPaid: 0, saleOrderId: soId,
        notes: `Repair ${repair.ref} — ${repair.productName}`,
      }
      setInvoices(p => [invoice, ...p])

      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r, saleOrderId: soId, saleOrderRef: soRef, invoiceId: invoice.id, invoiceDate: now(),
      } : r))

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
      if (!['director', 'technical_lead'].includes(user.role)) {
        showToast('Only the Technical Lead or Admin can perform QA', 'error'); return
      }
      const repair = repairs.find(r => r.id === repairId)
      // The technician who worked on this repair CANNOT do QC — must be a different person
      if (repair?.assignedTechnicianId === user.id) {
        showToast('You cannot perform QC on a repair you worked on — assign a different technician for QC', 'error'); return
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
              setSerials(p => p.map(s => s.id === serial.id ? {
                ...s,
                status: 'available',
                location: 'repair_unit',
                repairId: undefined,
              } : s))
              
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
      if (!actor || !['technical_lead', 'director'].includes(actor.role)) {
        showToast('Only the Technical Lead can mark parts as arrived', 'error'); return
      }
      const repair = repairs.find(r => r.id === repairId)
      if (!repair || repair.status !== 'awaiting_parts') return
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'approved',
        procurementRequests: (r.procurementRequests ?? []).map(req => req.status === 'pending' ? { ...req, status: 'received' as const } : req),
      } : r))
      // Notify the assigned technician
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
      addAuditLog('parts_arrived', repairId, `${actor.name} confirmed parts arrived`)
      showToast('Parts marked as arrived — technician notified')
    },

    markRepairReady: (repairId) => {
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'ready',
      } : r))
      
      addAuditLog('mark_ready', repairId, 'Device ready for pickup')
      showToast('Device marked ready for pickup — notify customer')
    },
    
    scheduleDelivery: (repairId, method, scheduledDate, address, riderId, riderName) => {
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        deliveryMethod: method,
        deliveryScheduledDate: scheduledDate,
        deliveryAddress: address,
        deliveryRiderId: riderId,
        deliveryRiderName: riderName,
      } : r))

      addAuditLog('schedule_delivery', repairId, `Scheduled ${method} for ${scheduledDate}${riderName ? ` via ${riderName}` : ''}`)
      showToast(`Delivery scheduled for ${scheduledDate}${riderName ? ` — ${riderName}` : ''}`)
    },
    
    deliverRepair: (repairId, recipientName, recipientPhone) => {
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'delivered',
        deliveryActualDate: now(),
        deliveryRecipient: recipientName,
      } : r))
      
      addAuditLog('deliver_repair', repairId, `Delivered to ${recipientName}`)
      showToast(`Device delivered to ${recipientName}`)
    },
    
    closeRepairJob: (repairId) => {
      const repair = repairs.find(r => r.id === repairId)
      if (!repair) return
      
      if (repair.status !== 'delivered' && repair.status !== 'invoiced') {
        showToast('Complete delivery and invoicing before closing', 'error')
        return
      }
      
      if (!repair.underWarranty && !repair.invoiceId) {
        showToast('Generate invoice before closing', 'error')
        return
      }
      
      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        status: 'closed',
        closedDate: now(),
      } : r))
      
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
          taxRate: applyVat ? companySettings.vatRate : 0,
          subtotal: repair.laborCost,
        }] : []),
        ...(repair.logisticsCost > 0 ? [{
          id: uid(),
          description: 'Delivery Service',
          qty: 1,
          unitPrice: repair.logisticsCost,
          taxRate: applyVat ? companySettings.vatRate : 0,
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
        notes: `Repair invoice for ${repair.ref}`,
      }
      
      setInvoices(p => [invoice, ...p])
      fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })
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

      // Functional Firewall: Technicians ONLY see their assigned jobs
      if (user.role === 'technician') {
        return repairs.filter(r => r.assignedTechnicianId === user.id)
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

      // If cancelling, free up reserved serials and cancel linked financial documents
      if (newStatus === 'cancelled') {
        setSerials(p => p.map(s => s.repairId === repairId ? {
          ...s, status: 'available', repairId: undefined
        } : s))
        if (repair.saleOrderId) {
        setSaleOrders(p => p.map(so => {
          if (so.id !== repair.saleOrderId) return so
          const updated = { ...so, status: 'cancelled' as const }
          fetch(`/api/sales/${repair.saleOrderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        } catch (error) {
          console.error('Notification error:', error)
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
      } catch (error) {
        console.error('Procurement notification error:', error)
        // In-app notification to lead tech was already sent above; only external API failed
        showToast(`Procurement request submitted • Repair ${repair.ref} set to "Awaiting Parts"`, 'success')
      }
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
        } catch (error) {
          console.error('Notification error:', error)
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
            fetch(`/api/sales/${repair.saleOrderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
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
        } catch (error) {
          console.error('Notification error:', error)
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
      fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(posInv) })
      setPosOrders(p => [order, ...p])
      showToast(`${order.ref} · ${fmtKes(order.total)} via ${payment.toUpperCase()}`)
    },

    // ── Stock Adjustments ─────────────────────────────────────────────────────
    createAdjustment: (productId, productName, type, qty, reason, notes) => {
      if (!canManageInventoryControl(currentUser())) { showToast('Only inventory-controlled roles can request adjustments', 'error'); throw new Error('Unauthorized adjustment request') }
      const adj: StockAdjustment = {
        id: uid(), ref: seq('ADJ', 'adj'), productId, productName, type, qty, reason, notes,
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
          const delta = -adj.qty
          setBulkStock(prev => upsertBulkStock(prev, adj.productId, 'warehouse', delta))
          setProducts(p => p.map(x => x.id === adj.productId ? { ...x, stockQty: Math.max(0, x.stockQty + delta) } : x))
          addMove(adj.productId, adj.productName, adj.qty, 'adjustment', `Adj ${adj.ref}: ${adj.reason}`, adj.ref)
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
      let repairToMark: string | undefined
      setDeliveryJobs(prev => prev.map(j => {
        if (j.id !== jobId) return j
        const updates: Partial<DeliveryJob> = { status: newStatus }
        if (newStatus === 'in_transit') updates.pickedUpAt = new Date().toISOString()
        if (newStatus === 'delivered') {
          updates.deliveredAt = new Date().toISOString()
          if (j.type === 'repair_dropoff' && j.repairOrderId) repairToMark = j.repairOrderId
        }
        if (newStatus === 'failed' && failureReason) updates.failureReason = failureReason
        return { ...j, ...updates }
      }))
      if (repairToMark) {
        setRepairs(prev => prev.map(r => r.id === repairToMark ? {
          ...r, status: 'delivered' as RepairStatus,
          deliveryActualDate: new Date().toISOString().slice(0, 10),
        } : r))
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
      fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bill) })
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
      fetch('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(delivery) })
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
      
      fetch(`/api/deliveries/${deliveryId}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoInvoice: !!so && !hasExistingInvoice }) }).catch(console.error)
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

      // Build lines from SO lines (DeliveryLine has no unitPrice/subtotal)
      const soLineMap: Record<string, { unitPrice: number; subtotal: number }> = {}
      so.lines.forEach(l => { soLineMap[l.productId] = { unitPrice: l.unitPrice, subtotal: l.subtotal } })

      const invoice: Invoice = {
        id: uid(),
        ref: seq('INV', 'inv'),
        type: 'customer_invoice',
        status: 'posted',
        partnerId: delivery.customerId,
        partnerName: delivery.customerName,
        date: now(),
        dueDate: addDays(now(), 30),
        lines: delivery.lines.map(line => ({
          id: uid(),
          description: line.productName,
          qty: line.qty,
          unitPrice: soLineMap[line.productId]?.unitPrice ?? 0,
          taxRate: 16,
          subtotal: soLineMap[line.productId]?.subtotal ?? 0,
        })),
        subtotal: so.subtotal,
        taxTotal: so.taxTotal,
        total: so.total,
        amountPaid: 0,
        notes: `Invoice for ${so.ref} via ${delivery.ref}`,
      }

      setInvoices(prev => [invoice, ...prev])
      fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })

      setSaleOrders(prev => {
        const next = prev.map(s =>
          s.id === so.id ? { ...s, status: 'invoiced' as const } : s
        )
        const updatedSo = next.find(s => s.id === so.id)
        if (updatedSo) fetch(`/api/sales/${so.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedSo) })
        return next
      })

      addAuditLog('auto_invoice', invoice.ref, `Auto-generated from ${delivery.ref}`)
      showToast(`Invoice ${invoice.ref} generated`, 'success')

      return invoice
    },
    
    // ── Approval Workflows ────────────────────────────────────────────────────
    checkDiscountApproval: (discountPercent) => {
      if (discountPercent <= 10) return { requiresApproval: false, roles: [] }
      if (discountPercent <= 20) return { requiresApproval: true, roles: ['sales_rep'] }
      if (discountPercent <= 50) return { requiresApproval: true, roles: ['sales_rep', 'finance_officer'] }
      return { requiresApproval: true, roles: ['sales_rep', 'finance_officer', 'director'] }
    },
    
    requestApproval: (type, details) => {
      const user = currentUser()
      if (!user) return null
      
      const request = {
        id: uid(),
        ref: `APR-${Date.now()}`,
        type,
        requestedBy: user.id,
        requestedByName: user.name,
        requestedDate: now(),
        details,
        status: 'pending',
        currentLevel: 1,
      }
      
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
      
      setApprovalRequests(prev => prev.map(r =>
        r.id === requestId
          ? {
              ...r,
              status: decision === 'approved' ? 'approved' : 'rejected',
              decidedBy: user.name,
              decidedDate: now(),
              comments,
            }
          : r
      ))
      
      const request = approvalRequests.find(r => r.id === requestId)
      if (request) {
        addAuditLog(`approval_${decision}`, request.ref, `${decision} by ${user.name}`)
        showToast(`Request ${decision}`, decision === 'approved' ? 'success' : 'error')
      }
    },
    
    getPendingApprovalsForUser: () => {
      const user = currentUser()
      if (!user) return []

      return approvalRequests.filter(r =>
        r.status === 'pending' &&
        ['director', 'finance_officer'].includes(user.role)
      )
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
        const creditAccount = method === 'bank_transfer' ? '2201 — ABSA Bank' : '2211 — Petty Cash / Mobile Money'
        const journal: JournalEntry = {
          id: uid(),
          ref: seq('JRN/RFD', 'jrn_rfd'),
          date: now(),
          source: 'refund',
          description: `Customer refund — ${rma.ref} (${rma.customerName})`,
          status: 'posted',
          rmaId: id,
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
      setBuyBacks(p => p.map(b => b.id === id
        ? { ...b, status: 'approved', approvedByName: user.name, approvedDate: now() }
        : b
      ))
      showToast('Buy-back approved')
    },

    payBuyBack: (id, paymentMethod) => {
      setBuyBacks(p => p.map(b => b.id === id ? { ...b, status: 'paid', paymentMethod, paidDate: now() } : b))
      showToast('Payment to customer recorded')
    },

    stockBuyBack: (id) => {
      const user = currentUser(); if (!user) return
      const bb = buyBacks.find(b => b.id === id)
      if (!bb) return
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
      showToast(`${bb.ref} stocked — inventory updated`)
    },

    deleteBuyBack: (id) => {
      setBuyBacks(p => p.filter(b => b.id !== id))
      showToast('Buy-back deleted')
    },

    // ── Donations ─────────────────────────────────────────────────────────────
    donations,

    createDonation: (type, party, location, lines, notes) => {
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
          addMove(line.productId, line.productName, line.qty, 'out', `Donation out ${don.ref}`, don.ref, don.location, 'customer', [])
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
