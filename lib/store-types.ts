/**
 * store-types.ts
 * Canonical re-export of all domain types from the store.
 *
 * Components that only need TYPE information (not store functions) should
 * import from here instead of '@/lib/store'. This decouples type-only
 * consumers from the full provider bundle and makes future type migrations
 * (e.g. moving definitions here) a one-line change per type.
 *
 * Usage:
 *   import type { Company, Employee, LeaveRequest } from '@/lib/store-types'
 */

export type {
  // Core
  ModuleId,
  UserRole,
  User,
  LocationId,
  CategoryId,

  // CRM
  OpportunityStage,
  LeadSource,
  QuoteStatus,
  Company,
  ContactPerson,
  Opportunity,
  OpportunityActivity,
  Quote,
  QuoteLineItem,
  CustomerContract,

  // Contacts / Vendors
  Contact,
  AuditLog,

  // Products & Inventory
  Product,
  SerialNumber,
  BulkStockLevel,
  StockMove,

  // Sales
  SaleOrder,
  SaleOrderItem,
  Delivery,
  DeliveryLine,

  // Purchase
  PurchaseOrder,
  POStatus,
  POLine,
  Receipt,
  PurchaseReturn,

  // Repairs & Outsource
  RepairOrder,
  RepairDiagnosis,
  RepairQuote,
  RepairQuoteLine,
  OutsourceVendor,
  OutsourceJob,
  OutsourcePayment,

  // Accounting / Finance
  Account,
  JournalEntry,
  Invoice,
  InvoiceLine,
  BankAccount,
  CashbookEntry,
  Warranty,

  // HR
  Department,
  Employee,
  LeaveRequest,
  LeaveBalance,
  PayrollRun,
  PayrollLine,
  Payslip,
  HRDocument,
  EmployeeAssetAssignment,
  WorkflowApproval,

  // Expenses
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
  ExpenseStatus,

  // Notifications
  AppNotification,

  // Kilimall / E-commerce
  KilimallOrder,

  // Other
  BuyBack,
  Donation,
  ClientExchange,
  ExchangeLine,
  RefSOP,
} from '@/lib/store'
