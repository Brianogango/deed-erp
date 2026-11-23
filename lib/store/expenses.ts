import { type ExpensePaymentMethod, type ExpenseStatus, type ExpenseApprovalStep } from './finance'

/** Expense categories and the expense record. */

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
  { value: 'rent', label: 'Rent' },
  { value: 'service_charge', label: 'Service Charge' },
  { value: 'electricity', label: 'Electricity' },
  { value: 'internet', label: 'Telephone & Internet' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'bank_charges', label: 'Bank Charges' },
  { value: 'interest', label: 'Loan Interest' },
  { value: 'other',           label: 'Other' },
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]['value']

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
  reimbursementDate?: string
  // Direct company-funded expenses are approved first, then paid separately.
  paymentBankAccount?: string
  paymentReference?: string
  paidDate?: string
  /** Who the company is paying (landlord, KPLC, supplier) — for expenses that are not an employee's. */
  payeeName?: string
  notes?: string
  createdAt: string
  /** Several expenses submitted together (a trip): same id and title. */
  reportId?: string
  reportTitle?: string
  /** One payment that settled several claims (EXPB/NNNN). */
  paymentBatchRef?: string
  /** What happened to the claim: edited, approved, rejected, sent again, paid… */
  history?: { date: string; by: string; action: string; note?: string }[]
}
