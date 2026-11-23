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
  /** Bank-specific M-Pesa paybill (must match this bank — never mix with another bank's). */
  mpesaPaybill?: string
  /** Account / till reference for that paybill. */
  mpesaAccount?: string
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
  /** Tooltip for the category badge — e.g. every revenue account a sale was posted to. */
  categoryTitle?: string
  /** A sale's money by product line (sales account), e.g. Laptops 7,500 + Accessories 2,500. */
  salesLines?: Array<{ code: string; name: string; amount: number }>
  /** What a supplier payment paid for: product lines for stock, expense accounts for overheads. */
  billLines?: Array<{ key: string; name: string; amount: number }>
  bankAccountId: string  // which bank/cash account
  debit: number          // money out
  credit: number         // money in
  sourceType: 'customer_invoice' | 'vendor_bill' | 'deposit' | 'pos' | 'expense' | 'payroll' | 'purchase' | 'bank_charge' | 'bank_interest'
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
  /** Set when a bank charge / interest line was booked to the ledger from reconciliation. */
  bookedAs?: 'bank_charge' | 'interest_earned'
  bookedJournalRef?: string
  bookedAt?: string
  bookedBy?: string
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
  /** When set, this liquidity CoA line is linked to a cashbook bank wallet. */
  bankAccountId?: string
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
  purchaseOrderItemId?: string
  serialNumberId?: string
  accountCode?: string  // revenue account code (e.g. '5001')
  /** Statutory VAT category. PO bills set this from taxRate (16 → standard_16). */
  taxCategory?: string
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
  /** Money a supplier paid back on a supplier credit note (comes in, not out). */
  supplierRefund?: boolean
  /** Set on entries in Invoice.voidedPayments (lib/accounting/payment-reversal.ts). */
  reversedAt?: string
  reversedBy?: string
  reversalReason?: string
}

export interface Invoice {
  id: string; ref: string; type: InvoiceType; status: InvoiceStatus
  partnerId: string; partnerName: string
  date: string; dueDate: string
  lines: InvoiceLine[]; subtotal: number; taxTotal: number; total: number; amountPaid: number
  /** Header-level discount (e.g. prorated from the source SO's discountAmount), applied after tax. */
  discountAmount?: number
  /** Migrated from an old system: a receivable/payable carried over, not a sale or purchase (lib/finance/opening-balance.ts). */
  isOpeningBalance?: boolean
  saleOrderId?: string; purchaseOrderId?: string; receiptId?: string; repairId?: string; notes: string
  payments?: InvoicePayment[]
  /** Payments registered by mistake and reversed — kept for the record, not counted as received. */
  voidedPayments?: InvoicePayment[]
  /** Document currency snapshot (KES-first). */
  currencyCode?: string
  baseCurrencyCode?: string
  exchangeRateToBase?: number
  /** Customer's own purchase order number (optional), printed on the invoice. */
  customerPoNumber?: string
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
  /** Optimistic lock from Prisma; omitted on persist so sequential edits cannot 409 Confirm. */
  lockVersion?: number
  /** POS till invoice created already posted; commission uses salespersonId. */
  isPosInvoice?: boolean
  salespersonId?: string
  salespersonName?: string
  /** Odoo-style down payment / deposit invoice against a Sale Order. */
  isDownPayment?: boolean
  downPaymentPercent?: number | null
  downPaymentAppliedToId?: string | null
  subject?: string
  downPaymentDeduction?: number
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
  /** Invoice credit notes vs buy-back "Add as credit". Older rows omit this and are invoice-sourced. */
  sourceType?: 'invoice' | 'buyback'
  sourceInvoiceId?: string
  sourceInvoiceRef?: string
  /** Set when the credit is the buy-back payout (not a cash/M-Pesa/bank payment). */
  sourceBuyBackId?: string
  sourceBuyBackRef?: string
  amount: number
  balance: number
  status: 'available' | 'partially_used' | 'used' | 'void'
  createdAt: string
  createdBy: string
  notes?: string
  /** Money paid back to the customer out of this credit (server: /api/customer-credits/[id]/refund). */
  refunds?: Array<{ id: string; date: string; amount: number; method: string; reference?: string; bankAccountId?: string; journalRef?: string; refundedBy?: string }>
  applications: {
    invoiceId: string
    invoiceRef: string
    amount: number
    date: string
    appliedBy: string
    /** Set when the payment that applied it was reversed: the amount is back on the balance. */
    reversedAt?: string
    reversedBy?: string
    reverseReason?: string
  }[]
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
  source: 'payroll' | 'payroll_payment' | 'refund' | 'invoice' | 'payment' | 'bill' | 'purchase_payment' | 'expense' | 'pos' | 'pos_session' | 'purchase' | 'manual' | 'adjustment'
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
  /** Its old number, when that repeated another's (moves and journals carry it). */
  formerRef?: string
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

export type VendorJournalOpts = {
  /** Clear GRNI instead of expensing stocked PO-linked purchases. */
  perpetual?: boolean
  /** PO lines for receipt unit-cost lookup. */
  poLines?: Array<{ productId?: string; unitPrice?: number }>
}

export type ExpensePaymentMethod = 'reimbursement' | 'petty_cash' | 'mpesa_company' | 'company_card'

export type ExpenseStatus = 'submitted' | 'approved' | 'rejected' | 'paid' | 'reimbursed' | 'withdrawn'

export type ExpenseApprovalStep = {
  role: string
  status: 'pending' | 'approved' | 'rejected'
  by?: string
  at?: string
}
