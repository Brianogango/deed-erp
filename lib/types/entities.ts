/**
 * Entity types for Deed ERP
 */

import type { ISODateTime, DateString } from './common'

/**
 * User roles in the system
 */
export type UserRole = 'admin' | 'manager' | 'user' | 'viewer'

/**
 * User entity
 */
export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  avatar?: string
  phone?: string
  department?: string
  active: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Invoice status
 */
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled'

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
  taxRate: number
}

/**
 * Invoice entity
 */
export interface Invoice {
  id: string
  invoiceNo: string
  customerId: string
  amount: number
  tax: number
  total: number
  status: InvoiceStatus
  dueDate: DateString
  issuedDate: DateString
  items: InvoiceLineItem[]
  notes?: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Account type
 */
export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense'
  | 'other'

/**
 * Account entity
 */
export interface Account {
  id: string
  code: string
  name: string
  type: AccountType
  group: string
  balance: number
  isActive: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Journal line
 */
export interface JournalLine {
  id: string
  accountId: string
  debit: number
  credit: number
  description?: string
}

/**
 * Journal entry status
 */
export type JournalEntryStatus = 'draft' | 'posted'

/**
 * Journal entry
 */
export interface JournalEntry {
  id: string
  date: DateString
  description: string
  reference?: string
  lines: JournalLine[]
  status: JournalEntryStatus
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Contact type
 */
export type ContactType = 'customer' | 'supplier' | 'partner' | 'employee'

/**
 * Contact entity
 */
export interface Contact {
  id: string
  name: string
  email?: string
  phone?: string
  type: ContactType
  address?: string
  city?: string
  country?: string
  taxId?: string
  active: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Product entity
 */
export interface Product {
  id: string
  code: string
  name: string
  description?: string
  category: string
  price: number
  cost: number
  quantity: number
  unit: string
  active: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Payment status
 */
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled'

/**
 * Payment method
 */
export type PaymentMethod = 'cash' | 'bank' | 'mpesa' | 'check' | 'credit'

/**
 * Payment entity
 */
export interface Payment {
  id: string
  invoiceId: string
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  reference?: string
  notes?: string
  paidAt: ISODateTime
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Expense category
 */
export type ExpenseCategory =
  | 'travel'
  | 'meals'
  | 'supplies'
  | 'utilities'
  | 'maintenance'
  | 'other'

/**
 * Expense status
 */
export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid'

/**
 * Expense entity
 */
export interface Expense {
  id: string
  category: ExpenseCategory
  amount: number
  description: string
  status: ExpenseStatus
  submittedBy: string
  approvedBy?: string
  receiptUrl?: string
  date: DateString
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Leave type
 */
export type LeaveType = 'annual' | 'sick' | 'maternity' | 'unpaid' | 'other'

/**
 * Leave status
 */
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

/**
 * Leave request entity
 */
export interface LeaveRequest {
  id: string
  employeeId: string
  type: LeaveType
  startDate: DateString
  endDate: DateString
  reason?: string
  status: LeaveStatus
  approvedBy?: string
  approvedAt?: ISODateTime
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Refund payment entity
 */
export interface RefundPayment {
  id: string
  invoiceId: string
  amount: number
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'processed'
  requestedBy: string
  approvedBy?: string
  processedAt?: ISODateTime
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Bank account entity
 */
export interface BankAccount {
  id: string
  bankName: string
  accountNo: string
  accountHolder: string
  balance: number
  openingBalance: number
  active: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Company settings entity
 */
export interface CompanySettings {
  id: string
  name: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  website: string
  kraPin: string
  mpesaPaybill: string
  mpesaAccount: string
  logo?: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Dashboard stat
 */
export interface DashboardStat {
  label: string
  value: number
  change: number
  changePercent: number
  trend: 'up' | 'down' | 'neutral'
}

/**
 * Chart data point
 */
export interface ChartDataPoint {
  label: string
  value: number
  [key: string]: string | number
}

/**
 * Report data
 */
export interface ReportData {
  title: string
  subtitle?: string
  generatedAt: ISODateTime
  data: Record<string, unknown>
}
