import { type ModuleId, type WorkflowApproval, type AuditLog, type User, type LocationId } from './core'
import { type Contact, type Company, type ContactPerson, type Opportunity, type OpportunityActivity, type Quote, type SaleOrder, type CustomerContract, type POSOrder, type KilimallOrder, type KilimallDispatch, type KilimallSettlement, type POSSession, type OpportunityStage } from './sales'
import { type Product, type ProductPriceHistory, type SerialNumber, type RefurbishmentJob, type StockMove, type BulkStockLevel, type StockAdjustment, type Holdover, type OutboundRelease, type SignatureMethod, type RefurbPart, type TaggedIntakeInput, type AdjReason } from './inventory'
import { type Invoice, type Payment, type CustomerCredit, type JournalEntry, type Account, type BankAccount, type BankRecon, type BankStatementLine, type Deposit, type CreateDepositInput, type DepositPayment, type InvoiceType, type RefundPayment, type RefundPaymentMethod } from './finance'
import { type Delivery, type Rider, type DeliveryJob, type RiderWeeklyPay, type DeliveryJobStatus } from './delivery'
import { type PurchaseOrder, type Receipt, type StockTransfer, type PurchaseReturn, type POLine } from './purchasing'
import { type RepairOrder, type Warranty, type OutsourceVendor, type OutsourceJob, type OutsourcePayment } from './repairs'
import { type Contract, type PayrollRun, type Payslip, type SalaryAdvance, type EmployeeAssetAssignment, type HRSOP, type PerformanceTarget, type RefSOP, type HRDocument } from './hr'
import { type KilimallReturnInput } from '@/lib/kilimall/kilimall-return'
import { type DocumentPaymentDetailsMap, type DocumentPaymentDetails } from '@/lib/document-payment-details'
import { type CompanySettings, type SystemSettings } from './settings'
import { type SOPDocument, type SOP, type SOPActual } from './sop'
import type { AppNotification } from '@/lib/in-app-notifications'
import { type Expense } from './expenses'
import { type CompanyAsset, type CompanyAssetInput, type CompanyAssetStatus } from '@/lib/company-property'
import { type CreateUserInput, type UpdateUserInput } from '@/lib/auth/types'
import { type RepairDiagnosis, type RepairQuoteLine, type RepairQuote, type RepairStatus } from '@/lib/repair-types'
import { type DiagnosisLogRepairPatch } from '@/lib/repair-diagnosis-log'
import { type BillingExemptReason } from '@/lib/repair-billing-exempt'
import { type PartsRequestKind } from '@/lib/repair/parts-request'
import { type StockReservation, type ApprovalRequest, type ApprovalType } from '@/lib/sales-flow-types'
import { type ReturnOrder, type ReturnOrderLine, type RMAResolution, type BuyBack, type BuyBackLine, type Donation, type DonationType, type DonationLine, type ClientExchange, type ExchangeLine } from './after-sales'

/** The full store state and the per-area views each screen context exposes. */

// Monthly inventory snapshot

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
  applyCustomerCreditToInvoice: (invoiceId: string, amount?: number) => void | Promise<void>
  checkCreditLimit: (customerId: string, orderTotal: number) => { ok: boolean; message?: string; requiresApproval?: boolean; creditAvailable?: number }
  getCustomerCreditStatus: (customerId: string, newOrderTotal?: number, opts?: { document?: 'quote' | 'order' | 'invoice' }) => {
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
  /** Issue a customer credit note against the single posted invoice on a sale order. */
  issueCreditNoteFromSaleOrder: (saleOrderId: string, amount: number, reason?: string) => Promise<string | null>

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
  createKilimallOrder: (p: Omit<KilimallOrder, 'id' | 'ref' | 'status' | 'createdDate' | 'createdBy'>) => Promise<KilimallOrder | null>
  updateKilimallOrder: (id: string, p: Partial<KilimallOrder>) => void
  /** A Kilimall order came back: device to the warehouse (awaiting inspection), cost reversed; refund or exchange. */
  returnKilimallOrder: (id: string, input: KilimallReturnInput) => Promise<boolean>
  confirmKilimallDispatch: (
    orderId: string,
    serialId: string,
    serialNumber: string,
    opts?: {
      fulfilledProductId?: string
      substitutionReason?: string
      courier?: string
      dispatchDate?: string
      trackingReference?: string
      dispatchNotes?: string
    },
  ) => Promise<KilimallDispatch | null>
  createKilimallSettlement: (p: Omit<KilimallSettlement, 'id' | 'ref' | 'status' | 'createdDate' | 'createdBy'>) => Promise<KilimallSettlement | null>
  updateKilimallSettlement: (id: string, p: Partial<KilimallSettlement>) => void
  reconcileKilimallSettlement: (settlementId: string) => void
  matchKilimallSettlementLine: (settlementId: string, lineId: string, orderId: string, note: string) => boolean
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
  /** Async: the job ref is allocated atomically server-side (DJB/NNNN). Returns null when the ref could not be allocated. */
  createDeliveryJob: (j: Omit<DeliveryJob, 'id' | 'ref' | 'status' | 'createdByUserId' | 'createdByName' | 'createdAt'>) => Promise<DeliveryJob | null>
  updateDeliveryJob: (id: string, p: Partial<DeliveryJob>) => void
  deleteDeliveryJob: (id: string) => void
  assignRiderToJob: (jobId: string, riderId: string, riderFee?: number) => void
  /** The customer paid the rider the delivery charge directly: take it off the invoice and off the rider's pay. */
  recordCustomerPaidRider: (jobId: string, input: { amount: number; method: 'cash' | 'mpesa'; reference?: string }) => Promise<boolean>
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
  }) => Promise<DeliveryJob | null>
  advanceJobStatus: (jobId: string, newStatus: DeliveryJobStatus, failureReason?: string) => void
  generateWeeklyPay: (riderId: string, weekStart: string) => RiderWeeklyPay | null
  markWeeklyPayPaid: (id: string) => void

  // Cashbook & bank reconciliation
  bankAccounts: BankAccount[]
  bankRecons: BankRecon[]
  bankStatementLines: BankStatementLine[]
  saveBankRecon: (recon: Omit<BankRecon, 'id' | 'reconciledBy' | 'reconciledAt'>) => void
  updateBankRecon: (id: string, p: Partial<BankRecon>) => void
  updateBankAccount: (id: string, p: Partial<Pick<BankAccount, 'name' | 'bankName' | 'accountNo' | 'openingBalance' | 'openingDate' | 'active' | 'mpesaPaybill' | 'mpesaAccount'>>) => void
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
  createSOP: (s: Omit<SOP, 'id' | 'createdByUserId' | 'createdByName' | 'createdAt'>) => SOP | null
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
  submitExpense: (e: Omit<Expense, 'id' | 'ref' | 'submittedByUserId' | 'submittedByName' | 'submittedDate' | 'status' | 'createdAt'>) => Expense | null
  reviewExpense: (id: string, approved: boolean, notes?: string) => void
  payExpense: (id: string, method?: string, bankAccountId?: string, reference?: string, paymentDate?: string, notes?: string) => void
  reimburseExpense: (id: string, notes?: string, method?: string, bankAccountId?: string, reference?: string, paymentDate?: string) => void

  // Deposits
  deposits: Deposit[]
  createDeposit: (d: CreateDepositInput) => Promise<Deposit>
  addDepositPayment: (depositId: string, p: Omit<DepositPayment, 'id'>) => void
  completeDeposit: (depositId: string) => void
  cancelDeposit: (depositId: string, reason: string) => void

  // Holdovers (device loans)
  holdovers: Holdover[]
  addHoldover: (h: Holdover) => void
  updateHoldover: (id: string, patch: Partial<Holdover>) => void

  // Company property (office furniture / fittings — not HR trading-stock custody)
  companyAssets: CompanyAsset[]
  createCompanyAsset: (input: CompanyAssetInput) => CompanyAsset | null
  updateCompanyAsset: (id: string, input: CompanyAssetInput) => void
  deleteCompanyAsset: (id: string) => void
  moveCompanyAsset: (id: string, locationName: string, note?: string) => void
  setCompanyAssetCustodian: (id: string, custodian: { employeeId?: string; name?: string }, note?: string) => void
  setCompanyAssetStatus: (id: string, status: CompanyAssetStatus, note?: string, opts?: { createRepair?: boolean }) => void | Promise<void>
  disposeCompanyAsset: (id: string, qty: number, opts?: { reason?: string; proceedsKes?: number }) => void
  writeOffCompanyAsset: (id: string, reason?: string) => void
  runCompanyAssetDepreciation: (period?: string) => void
  linkSerialToCompanyAsset: (assetId: string, serialId: string) => void

  // Outsource repair
  outsourceVendors: OutsourceVendor[]
  outsourceJobs: OutsourceJob[]
  outsourcePayments: OutsourcePayment[]
  addOutsourceVendor: (v: Omit<OutsourceVendor, 'id' | 'createdAt'>) => OutsourceVendor
  updateOutsourceVendor: (id: string, p: Partial<OutsourceVendor>) => void
  addOutsourceJob: (j: Omit<OutsourceJob, 'id' | 'ref' | 'createdAt' | 'sentByUserId' | 'sentByName' | 'status'>) => OutsourceJob | null
  returnOutsourceJob: (id: string, p: { returnedDate: string; isResolved: boolean; returnNotes?: string; finalCost?: number; repairNextStep?: 'keep' | 'in_repair' | 'unrepairable' }) => boolean
  /** Called back or sent by mistake: closes the job, frees the repair, brings a stock machine home. */
  cancelOutsourceJob: (id: string, reason: string) => boolean
  /** Change an open job (vendor, service, quote, promised date, notes). */
  updateOutsourceJob: (id: string, p: Partial<Pick<OutsourceJob, 'vendorId' | 'vendorName' | 'serviceType' | 'issueDescription' | 'quotedCost' | 'expectedReturnDate' | 'notes' | 'accessories' | 'sentDate'>>) => boolean
  /** Remove a vendor no job has used; otherwise it can only be made inactive. */
  deleteOutsourceVendor: (id: string) => boolean
  /** Add the vendor's work, at a price for the customer, to the linked repair's quote. */
  chargeOutsourceToRepair: (jobId: string, amount: number) => boolean
  /** Tell the sender and the technical lead about jobs past their promised date (once per promise). */
  remindLateOutsourceJobs: () => void
  recordOutsourcePayment: (p: Omit<OutsourcePayment, 'id' | 'ref' | 'createdAt' | 'paidByUserId' | 'paidByName' | 'postedToAccounts' | 'billRefs'>) => Promise<OutsourcePayment | null>
  /** Create the draft vendor bill for a returned job that has a cost but no bill yet. */
  createOutsourceJobBill: (jobId: string) => void

  // Outbound Release Checkpoint
  outboundReleases: OutboundRelease[]
  initRelease: (p: { invoiceId?: string; repairId?: string; deliveryNoteId?: string; clientId: string; clientName: string; sourceRef: string; sourceType: OutboundRelease['sourceType']; serials: { serialNumberId?: string; expectedSerial: string }[] }) => OutboundRelease
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
  /** Merge a server opportunity (e.g. lead convert response) into local CRM state without re-POSTing. */
  ingestOpportunity: (raw: unknown) => void
  updateOpportunity: (id: string, p: Partial<Opportunity>) => void
  moveOpportunityStage: (id: string, stage: OpportunityStage) => void
  markOpportunityWon: (id: string, actualValue: number) => void
  markOpportunityLost: (id: string, reason: string, competitor?: string) => void
  deleteOpportunity: (id: string) => void
  
  // CRM - Opportunity Activities
  logActivity: (activity: Omit<OpportunityActivity, 'id' | 'createdAt' | 'createdDate' | 'createdById' | 'createdByName'>) => OpportunityActivity | null
  completeActivity: (id: string, outcome?: string) => void
  
  // Customer Contracts
  createCustomerContract: (contract: Omit<CustomerContract, 'id' | 'ref'>) => CustomerContract
  updateCustomerContract: (id: string, patch: Partial<CustomerContract>) => void
  renewCustomerContract: (id: string) => CustomerContract
  terminateCustomerContract: (id: string, reason: string) => void
  
  // Sales - Quotes
  createQuote: (quote: Omit<Quote, 'id' | 'ref' | 'quoteNumber' | 'quoteDate' | 'totalAmount' | 'version' | 'issueDate' | 'viewCount' | 'createdBy' | 'createdById' | 'createdByName' | 'createdAt' | 'updatedAt'>) => Promise<Quote | null>
  updateQuote: (id: string, p: Partial<Quote>) => void
  addQuoteLine: (quoteId: string, product: Product, qty: number, discount?: number, customPrice?: number) => void
  removeQuoteLine: (quoteId: string, lineId: string) => void
  sendQuote: (id: string) => void
  acceptQuote: (id: string) => void
  rejectQuote: (id: string, reason: string) => void
  convertQuoteToSaleOrder: (quoteId: string) => Promise<SaleOrder | null>
  convertRepairQuoteToSOAndInvoice: (quoteId: string) => Promise<{ so: SaleOrder; invoice: Invoice } | null>
  reviseQuote: (quoteId: string, changes: string) => Promise<Quote>
  deleteQuote: (id: string) => void

  // Products
  addProduct: (p: Omit<Product, 'id'>) => Promise<Product | null>
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
  updateSerial: (id: string, patch: Partial<SerialNumber>, opts?: { persist?: boolean }) => void
  /** Return a held (assigned) serial to available on-hand stock and detach from SO lines. */
  releaseSerialToStock: (serialId: string, destination?: LocationId) => boolean

  // Sale Orders
  createSaleOrder: (customerId: string, customerName: string, initial?: Partial<Pick<SaleOrder, 'lines' | 'deliveryDate' | 'notes' | 'paymentTerms' | 'validUntil' | 'customerRef' | 'opportunityId' | 'invoiceAddress' | 'deliveryAddress' | 'pricelist' | 'salespersonId' | 'salespersonName' | 'salesTeam' | 'discountAmount' | 'termsAndConditions' | 'optionalProducts'>>) => SaleOrder | Promise<SaleOrder>
  updateSaleOrder: (
    id: string,
    p: Partial<SaleOrder>,
    opts?: { persist?: boolean; soft?: boolean },
  ) => void | Promise<boolean>
  addSOLine: (orderId: string, product: Product, qty: number, discount?: number, defaultTaxRate?: number) => boolean | void | Promise<boolean>
  assignSerialToSOLine: (orderId: string, lineId: string, serialId: string) => void
  assignSerialsToSOLine: (orderId: string, lineId: string, serialIds: string[]) => void
  unassignSerialFromSOLine: (orderId: string, lineId: string, serialId: string) => void
  removeSOLine: (orderId: string, lineId: string) => boolean | void | Promise<boolean>
  /** Reorder a quotation line (product or section) up/down. Quotation stage only. */
  moveSOLine: (orderId: string, lineId: string, direction: -1 | 1) => boolean | void | Promise<boolean>
  /** Insert a section heading on a quotation. */
  addSOSection: (orderId: string, title?: string) => boolean | void | Promise<boolean>
  confirmSO: (id: string, opts?: { reserveStock?: boolean; qtyByLineId?: Record<string, number> }) => void | Promise<void>
  /** Create a waiting delivery when a confirmed SO has none (heal / retry). */
  ensureWaitingDeliveryForSO: (id: string) => Promise<Delivery | null>
  /** Send by Email succeeded → Quotation Sent (records date/user/recipient). */
  markQuotationSent: (id: string, recipient?: string, message?: string) => void | Promise<void>
  /** Lock/unlock a confirmed sales order (Lock Confirmed Sales setting). */
  setSaleOrderLock: (id: string, locked: boolean) => void
  resetSOToDraft: (id: string) => void | Promise<boolean>
  cancelSO: (id: string) => void
  /** Quotation revisioning: clone the latest quotation into a new editable revision (v2, v3, …). Confirmed Sales Orders cannot be revised. */
  createNewSOVersion: (orderId: string) => Promise<SaleOrder | null>
  /** Reserve quantity / assigned serials for this delivery. */
  prepareDelivery: (deliveryId: string, qtysDone?: Record<string, number>) => boolean
  /** Validate a delivery; partial quantities create a backorder unless cancelRemaining is set. */
  validateDelivery: (deliveryId: string, qtysDone?: Record<string, number>, opts?: { cancelRemaining?: boolean }) => void
  /** Undo a delivery: a validated one returns stock, serials and the COGS journal; an open one is simply cancelled. */
  reverseDelivery: (deliveryId: string, reason?: string) => Promise<boolean>
  /** Persist successful final DN generation before enabling invoicing. */
  markDeliveryNoteGenerated: (deliveryId: string) => Promise<boolean>
  updateDelivery: (deliveryId: string, p: Partial<Pick<Delivery, 'status' | 'recipientName' | 'recipientPhone' | 'recipientIdNumber' | 'deliveryAddress' | 'notes' | 'deliveryNoteGeneratedAt' | 'deliveryNoteGeneratedByUserId'>>) => void
  /** lineOverrides: partial-invoice qty picker — { itemId, qty } per SO line, capped server-side. Omit to invoice everything currently invoiceable. */
  createInvoiceFromSO: (
    orderId: string,
    lineOverridesOrOpts?: Array<{ itemId: string; qty: number }> | {
      mode?: 'regular' | 'down_payment_percent' | 'down_payment_fixed' | 'final'
      percent?: number
      amount?: number
      lines?: Array<{ itemId: string; qty: number }>
    },
  ) => Promise<Invoice> | Invoice
  deleteSaleOrder: (id: string) => void

  // Invoices
  createManualInvoice: (type: InvoiceType, partnerId: string, partnerName: string, dueDate: string, lines: { type?: 'item' | 'section'; desc: string; qty: string; price: string; tax: string; discount?: string; account?: string }[], vatRate: number, notes?: string, documentDate?: string, customerPoNumber?: string) => Invoice | null
  /** Migration opening balances: saved to the server one by one (which posts each journal once), then shown. */
  importOpeningBalances: (invoices: Invoice[]) => Promise<{ saved: Invoice[]; failed: string[] }>
  updateInvoice: (id: string, p: Partial<Invoice>) => void
  /** Reorder a draft invoice line (product or section) up/down. */
  moveInvoiceLine: (invoiceId: string, lineId: string, direction: -1 | 1) => void
  /** Insert a section heading on a draft invoice. */
  addInvoiceSection: (invoiceId: string, title?: string) => void
  postInvoice: (id: string, forcedRef?: string) => void | Promise<void>
  /** Finance dispute flag — Odoo "Blocked" payment status. */
  setInvoicePaymentBlocked: (id: string, blocked: boolean) => void
  /** Resolves true once the server has recorded the payment; false when it was refused (the reason is shown). */
  registerPayment: (invoiceId: string, amount: number, method?: string, bankAccountId?: string, reference?: string, paymentDate?: string) => Promise<boolean>
  /** Reverse a payment registered by mistake; the invoice owes the money again. */
  reverseInvoicePayment: (invoiceId: string, paymentId: string, reason: string) => Promise<boolean>
  resetInvoiceToDraft: (id: string) => void
  /** Bring a cancelled invoice or bill back as a draft, to check and confirm again. */
  restoreCancelledInvoice: (id: string) => void
  cancelInvoice: (id: string, forcedCreditRef?: string) => void
  deleteInvoice: (id: string) => void

  // Audit logs
  addAuditLog: (action: string, documentRef: string, details: string) => void

  /** Fetch a server-allocated document ref; when the server cannot give one, a stand-in that cannot clash (allocateDocNumberSync). */
  allocateDocRef: (prefix: string) => Promise<string>

  // Purchase Orders
  createPO: (vendorId: string, vendorName: string, initial?: Partial<Pick<PurchaseOrder, 'lines' | 'expectedDate' | 'notes' | 'repairId' | 'repairRef' | 'procurementRequestId' | 'refurbJobId' | 'refurbJobRef' | 'refurbPartId'>>, forcedRef?: string) => Promise<PurchaseOrder>
  updatePO: (id: string, p: Partial<PurchaseOrder>) => void
  addPOLine: (poId: string, product: Product, qty: number, unitPrice: number, taxRate?: number) => void
  removePOLine: (poId: string, lineId: string) => void
  updatePOLine: (poId: string, lineId: string, updates: Partial<Pick<POLine, 'qty' | 'unitPrice' | 'taxRate' | 'productName' | 'accountCode'>>) => void
  bulkAddPOLines: (poId: string, rows: { productId: string; productName: string; qty: number; unitPrice: number; taxRate: number; requiresSerial: boolean; importedSerials?: string[]; specs?: string; accountCode?: string }[]) => void
  sendPO: (id: string) => void
  revertPOToDraft: (id: string) => void
  confirmPO: (id: string) => void
  // Create receipt from PO (opens receiving dialog)
  createReceiptFromPO: (poId: string, forcedRef?: string) => Promise<Receipt | null>
  // Validate receipt — the CRITICAL stock entry step
  // serialAccessories: map of serial string → accessories array (e.g. { 'SN001': ['Charger','Bag'] })
  // serialIssues: map of serial string → issue description (non-empty = received with issues → refurbishment)
  validateReceipt: (receiptId: string, lines: Receipt['lines'], destination: LocationId, serialAccessories?: Record<string, string[]>, serialAccessoryNotes?: Record<string, string>, serialSpecs?: Record<string, string>, serialIssues?: Record<string, string>) => Promise<boolean>
  deletePO: (id: string) => void
  /** lineOverrides caps each line's bill qty (still clamped to billableQty) — omit to bill everything billable, matching prior one-click behaviour. */
  createBillFromPO: (poId: string, lineOverrides?: Array<{ lineId: string; qty: number }>) => Promise<Invoice | null>

  // Purchase Returns
  createPurchaseReturn: (receiptId: string, reason: PurchaseReturn['reason']) => PurchaseReturn | null
  addReturnLine: (returnId: string, productId: string, productName: string, qty: number, serialIds: string[], requiresSerial: boolean) => void
  /** Returns false (with a toast) if a required credit note failed to save — caller must not treat the return as done. */
  confirmPurchaseReturn: (returnId: string) => Promise<boolean>
  logReturnPickup: (returnId: string, collectedByUserId: string, collectedByName: string, collectedDate: string, pickupNotes?: string) => void

  // Refurbishment
  createRefurbishmentJob: (serialId: string, issueDescription: string, opts?: { silent?: boolean }) => void
  assignRefurbishmentJob: (jobId: string, techId: string, techName: string) => void
  updateRefurbishmentJob: (jobId: string, patch: Partial<Pick<RefurbishmentJob, 'techNotes' | 'issuesFound' | 'status' | 'completedDate' | 'productId' | 'productName'>>) => void
  /** `request`: ask stores for it straight away (taken from stock, or the lead is alerted). */
  addRefurbishmentPart: (jobId: string, part: Omit<RefurbPart, 'id'>, opts?: { request?: boolean }) => void
  updateRefurbishmentPart: (jobId: string, partId: string, patch: Partial<RefurbPart>) => void
  removeRefurbishmentPart: (jobId: string, partId: string) => void
  requestPartFromInventory: (jobId: string, partId: string, part?: RefurbPart) => void   // tech → checks stock; allocates or alerts lead
  allocateRefurbPart: (jobId: string, partId: string) => void         // lead tech → deducts stock, marks allocated
  notifyTechPartAvailable: (jobId: string, partId: string) => void    // lead tech → stamps notified date
  markRefurbishmentReady: (jobId: string) => void
  transferToSell: (jobId: string) => void
  /** Server write-off: device leaves stock and its cost is booked as a write-off. False if it failed. */
  writeOffRefurbishmentJob: (jobId: string, reason: string) => Promise<boolean>
  /** Bring a written-off device back: stock and the write-off booking are reversed. */
  restoreRefurbishmentJob: (jobId: string) => Promise<boolean>
  /** Machines with no readable serial: tagged (UNK-…) and queued for refurbishment. Returns the tags. */
  /** Give server numbers to jobs with a duplicate or temporary REF number. Returns how many. */
  fixRefurbJobNumbers: () => number
  /** Repeated or stand-in adjustment numbers get server numbers; also lists approved ones whose stock value may not have posted. */
  fixAdjustmentNumbers: () => { renumbered: number; missingValuation: Array<{ id: string; ref: string; formerRef?: string; productName: string; type: string; qty: number }> }
  intakeTaggedMachines: (input: TaggedIntakeInput) => Promise<string[] | null>
  /** Record a tagged machine's real serial (and model / specs). */
  identifyRefurbUnit: (jobId: string, input: { serial: string; productId?: string; specs?: string }) => Promise<boolean>
  /** Not repairable: strip it; kept parts go to stock carrying part of its cost. */
  harvestRefurbishmentJob: (jobId: string, reason: string, parts: Array<{ productId: string; qty: number; unitValue: number }>) => Promise<boolean>

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
  postPayrollRun: (id: string) => void | Promise<void>
  payPayrollRun: (id: string, bankAccountId?: string, reference?: string, paymentDate?: string) => void | Promise<void>
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
  /** Optional `intake` is merged into the created job before the authoritative POST (path, warranty, accessories, etc.). */
  createRepair: (customerId: string, customerName: string, productName: string, serial: string, desc: string, intake?: Partial<RepairOrder>) => Promise<RepairOrder>
  updateRepair: (id: string, p: Partial<RepairOrder>) => void
  deleteRepair: (id: string) => Promise<boolean>
  checkWarrantyForRepair: (repairId: string, serial: string) => boolean
  fileWarrantyClaim: (repairId: string, notes: string) => void
  
  // Repair Workflow Actions
  verifyRepairIntake: (repairId: string, notes?: string) => void
  assignTechnicianToRepair: (repairId: string, technicianId: string) => void | Promise<void>
  logDiagnosis: (repairId: string, diagnosis: Omit<RepairDiagnosis, 'diagnosedBy' | 'diagnosedDate'>, extras?: DiagnosisLogRepairPatch) => void | Promise<void>
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
  generateRepairQuote: (repairId: string, lines: Omit<RepairQuoteLine, 'id' | 'reserved'>[], applyVat?: boolean) => Promise<RepairQuote | undefined>
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
  scheduleDelivery: (repairId: string, method: 'pickup' | 'delivery' | 'courier', scheduledDate: string, address?: string, riderId?: string, riderName?: string) => Promise<boolean>
  deliverRepair: (repairId: string, recipientName: string, recipientPhone: string, isRep?: boolean, repRelationship?: string, repIdNumber?: string, closeAfter?: boolean) => void
  closeRepairJob: (repairId: string) => void | Promise<void>
  createInvoiceFromRepair: (repairId: string, applyVat?: boolean) => Promise<Invoice | null>
  // Bill several of one client's finished repairs on a single invoice, by
  // merging them into one sale order. See lib/repair/consolidation-plan.ts.
  consolidateRepairInvoices: (repairIds: string[]) => Promise<Invoice | null>
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
  /** `kind` 'refurb': repairId is the refurbishment job, requestId the part. */
  correctPartsCount: (repairId: string, requestId: string, line: { itemIndex: number; productId: string; productName: string; qtyMissing: number }, kind?: PartsRequestKind) => boolean
  raisePartsPurchaseOrder: (repairId: string, requestId: string, vendorId: string, vendorName: string, lines: { itemIndex: number; productId: string; productName: string; qty: number; unitPrice: number }[], kind?: PartsRequestKind) => Promise<PurchaseOrder | null>
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
  createPOSOrder: (
    lines: POSOrder['lines'],
    payment: POSOrder['payment'],
    customerId?: string,
    customerName?: string,
    pointsRedeemed?: number,
    applyVat?: boolean,
    paymentMeta?: {
      bankAccountId?: string
      paymentReference?: string
      salespersonId?: string
      salespersonName?: string
      /** Deed Express agent who brought the customer (no employee commission then). */
      agentId?: string
      agentName?: string
      agentCommission?: number
      /** Optional client credit portion; remaining total is collected via `payment`. */
      customerCreditAmount?: number
    },
  ) => POSOrder | null | Promise<POSOrder | null>

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
  createDeliveryFromSO: (salesOrderId: string, forcedRef?: string) => Promise<Delivery | null>
  createInvoiceFromDelivery: (deliveryId: string) => Promise<Invoice | null>
  
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
  /** Ends a warranty by hand (e.g. the customer returned the machine for good). Managers only. */
  cancelWarranty: (id: string, reason: string) => void

  // Buy-backs
  buyBacks: BuyBack[]
  createBuyBack: (customerId: string, customerName: string, lines: Omit<BuyBackLine, 'id'>[], destination: LocationId, notes?: string, originalSOId?: string, originalSORef?: string) => BuyBack
  approveBuyBack: (id: string) => void
  /** Cash / M-Pesa / bank payout. Refuses `store_credit` — that path is `creditBuyBack`. */
  payBuyBack: (id: string, paymentMethod: BuyBack['paymentMethod']) => void | Promise<void>
  /** After approve: add the buy-back amount as store credit (3102) instead of paying cash. Marks the BBK paid so stocking can follow. */
  creditBuyBack: (id: string) => void | Promise<void>
  receiveFreeBuyBack: (id: string) => void
  /** Intake serials/qty after either pay or add-as-credit (`status === 'paid'`). */
  stockBuyBack: (id: string) => void
  deleteBuyBack: (id: string) => void
  /** Register a serial that is not yet in Deed for a customer return / buyback / exchange / RMA. */
  registerCustomerReturnSerial: (
    productId: string,
    serialText: string,
    opts?: { saleOrderId?: string; source?: string; identityPending?: boolean },
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
  | 'fixAdjustmentNumbers'
>

export type SalesStoreState = Pick<AppState,
  | 'saleOrders'
  | 'repairs'
  | 'contacts'
  | 'products'
  | 'serials'
  | 'invoices'
  | 'deliveries'
  | 'returnOrders'
  | 'stockReservations'
  | 'posOrders'
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
  | 'postInvoice'
  | 'prepareDelivery'
  | 'validateDelivery'
  | 'reverseDelivery'
  | 'markDeliveryNoteGenerated'
  | 'deleteSaleOrder'
  | 'showToast'
  | 'getStockByLocation'
  | 'resetSOToDraft'
  | 'cancelSO'
  | 'createNewSOVersion'
  | 'getCustomerCreditStatus'
  | 'issueCreditNoteFromSaleOrder'
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
  | 'quotes'
  | 'saleOrders'
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
  | 'consolidateRepairInvoices'
  | 'getVisibleRepairs'
  | 'updateRepairProgress'
  | 'moveRepairToPreviousProgress'
  | 'requestProcurement'
  | 'correctPartsCount'
  | 'raisePartsPurchaseOrder'
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
  | 'remindLateOutsourceJobs'
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
  | 'customerCredits'
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
  | 'ingestOpportunity'
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
  | 'importOpeningBalances'
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
  | 'updateStatementLine'
  | 'postInvoice'
  | 'recordOutsourcePayment'
  | 'createOutsourceJobBill'
  | 'registerPayment'
  | 'reverseInvoicePayment'
  | 'setInvoicePaymentBlocked'
  | 'payExpense'
  | 'payPayrollRun'
  | 'reimburseExpense'
  | 'removePOLine'
  | 'resetInvoiceToDraft'
  | 'restoreCancelledInvoice'
  | 'returnOutsourceJob'
  | 'cancelOutsourceJob'
  | 'updateOutsourceJob'
  | 'deleteOutsourceVendor'
  | 'chargeOutsourceToRepair'
  | 'remindLateOutsourceJobs'
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
  | 'companyAssets'
  | 'createCompanyAsset'
  | 'updateCompanyAsset'
  | 'deleteCompanyAsset'
  | 'moveCompanyAsset'
  | 'setCompanyAssetCustodian'
  | 'setCompanyAssetStatus'
  | 'disposeCompanyAsset'
  | 'writeOffCompanyAsset'
  | 'runCompanyAssetDepreciation'
  | 'linkSerialToCompanyAsset'
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
  | 'recordCustomerPaidRider'
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
  | 'systemSettings'
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
  | 'bankAccounts'
  | 'closePOSSession'
  | 'confirmKilimallDispatch'
  | 'createKilimallOrder'
  | 'createKilimallSettlement'
  | 'createPOSOrder'
  | 'getCustomerCreditStatus'
  | 'openPOSSession'
  | 'matchKilimallSettlementLine'
  | 'reconcileKilimallSettlement'
  | 'setModule'
  | 'showToast'
  | 'updateKilimallOrder'
  | 'returnKilimallOrder'
  | 'updateKilimallSettlement'
  | 'updateProduct'
>

export type AfterSalesStoreState = Pick<AppState,
  | 'buyBacks'
  | 'clientExchanges'
  | 'contacts'
  | 'currentUserId'
  | 'donations'
  | 'invoices'
  | 'posOrders'
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
  | 'creditBuyBack'
  | 'receiveFreeBuyBack'
  | 'deleteBuyBack'
  | 'deleteDonation'
  | 'payBuyBack'
  | 'processReturn'
  | 'receiveReturn'
  | 'registerCustomerReturnSerial'
  | 'rejectReturn'
  | 'cancelWarranty'
  | 'releaseSerialToStock'
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
  | 'deleteContactPerson'
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
  | 'restoreRefurbishmentJob'
  | 'intakeTaggedMachines'
  | 'fixRefurbJobNumbers'
  | 'identifyRefurbUnit'
  | 'harvestRefurbishmentJob'
>
