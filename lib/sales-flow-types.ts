// ─── Sales Process Flow Types ─────────────────────────────────────────────────

/**
 * Complete end-to-end sales process types
 * Lead → Opportunity → Quote → Approval → SO → Delivery → Invoice → Payment
 */

import type { Invoice } from '@/lib/store'
export type { Invoice }

// ─── Approval Workflow ────────────────────────────────────────────────────────

export type ApprovalType = 'discount' | 'special_pricing' | 'credit_override' | 'corporate_deal' | 'backorder'

export interface ApprovalRequest {
  id: string
  ref: string
  type: ApprovalType
  
  documentType: 'quote' | 'sales_order' | 'invoice'
  documentId: string
  documentRef: string
  
  requestedBy: string
  requestedByName: string
  requestedDate: string
  
  details: {
    reason: string
    currentValue?: number
    proposedValue?: number
    discountPercent?: number
    discountAmount?: number
    originalPrice?: number
    specialPrice?: number
    creditRequested?: number
    creditAvailable?: number
    backorderQty?: number
  }
  
  approvers: ApprovalLevel[]
  currentLevel: number
  
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  
  finalApprovedBy?: string
  finalApprovedDate?: string
  rejectedBy?: string
  rejectedDate?: string
  rejectionReason?: string
  
  notes?: string
}

export interface ApprovalLevel {
  level: number
  role: 'sales_rep' | 'finance_officer' | 'director' | 'technical_lead'
  approverIds: string[] // Can be approved by any of these
  decision?: 'approved' | 'rejected'
  decidedBy?: string
  decidedByName?: string
  comments?: string
  decidedDate?: string
}

// ─── Stock Reservation ────────────────────────────────────────────────────────

export interface StockReservation {
  id: string
  productId: string
  productName: string
  qty: number
  
  reservedFor: 'sales_order' | 'repair' | 'transfer' | 'employee'
  referenceId: string
  referenceRef: string
  referenceType: string
  /** Exact delivery/picking that owns this reservation (sales flow). */
  deliveryId?: string
  
  location: string
  
  reservedBy: string
  reservedDate: string
  expiresDate?: string
  
  status: 'reserved' | 'fulfilled' | 'cancelled' | 'expired'
  
  fulfilledQty: number
  fulfilledDate?: string
  
  serialNumbers: string[] // If requires serial tracking
  
  notes?: string
}

// ─── Delivery & Fulfillment ──────────────────────────────────────────────────

export type DeliveryMethod = 'pickup' | 'dispatch' | 'courier'
export type DeliveryStatus = 'pending' | 'picking' | 'picked' | 'in_transit' | 'delivered' | 'failed' | 'returned'

export interface DeliveryNote {
  id: string
  ref: string
  
  salesOrderId: string
  salesOrderRef: string
  
  customerId: string
  customerName: string
  
  deliveryMethod: DeliveryMethod
  scheduledDate: string
  actualDate?: string
  
  status: DeliveryStatus
  
  lines: DeliveryLine[]
  
  // Picking
  pickingListPrinted: boolean
  pickingStartedBy?: string
  pickingStartedDate?: string
  pickingCompletedBy?: string
  pickingCompletedDate?: string
  
  // Dispatch
  dispatchedBy?: string
  dispatchedDate?: string
  
  // Delivery
  deliveredBy?: string
  deliveredTo?: string
  receivedBy?: string
  signature?: string
  
  // Address (for dispatch/courier)
  deliveryAddress?: string
  deliveryCity?: string
  deliveryPhone?: string
  deliveryInstructions?: string
  
  // Courier
  courierCompany?: string
  trackingNumber?: string
  courierCost?: number
  
  // Validation
  validated: boolean
  validatedBy?: string
  validatedDate?: string
  
  notes?: string
  createdBy: string
  createdDate: string
}

export interface DeliveryLine {
  id: string
  
  productId: string
  productName: string
  sku: string
  
  qtyOrdered: number
  qtyPicked: number
  qtyDelivered: number
  
  requiresSerial: boolean
  serialNumbers: string[]
  serialIds: string[]
  
  sourceLocation: string
  
  pickedBy?: string
  validated: boolean
  
  notes?: string
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'bank_transfer' | 'mpesa' | 'card' | 'cheque' | 'credit'

export interface Payment {
  id: string
  ref: string
  
  customerId: string
  customerName: string
  
  amount: number
  method: PaymentMethod
  
  // Payment Details
  reference: string // Bank ref, M-Pesa code, cheque number
  transactionDate: string
  
  // Allocation to invoices
  allocations: PaymentAllocation[]
  
  unallocatedAmount: number
  
  status: 'pending' | 'cleared' | 'bounced' | 'cancelled'
  
  // Bank clearing
  receivedBy: string
  receivedDate: string
  clearedDate?: string
  
  // For cheques
  chequeNumber?: string
  chequeDate?: string
  bankName?: string
  
  // For mobile money
  mpesaCode?: string
  mpesaPhone?: string
  
  accountingDate: string
  
  receiptNumber?: string
  receiptIssued: boolean
  
  notes?: string
  createdDate: string
}

export interface PaymentAllocation {
  id: string
  invoiceId: string
  invoiceRef: string
  invoiceAmount: number // Total invoice amount
  amountAllocated: number
  allocationDate: string
}

// ─── Warranty & After-Sales ───────────────────────────────────────────────────

export interface WarrantyActivation {
  id: string
  ref: string
  
  productId: string
  productName: string
  
  serialNumber: string
  serialId: string
  
  customerId: string
  customerName: string
  
  salesOrderId: string
  salesOrderRef: string
  deliveryId: string
  deliveryDate: string
  
  warrantyType: 'manufacturer' | 'dealer' | 'extended'
  warrantyPeriodMonths: number
  coverageType: 'full' | 'parts_only' | 'labor_only'
  
  startDate: string
  endDate: string
  
  status: 'active' | 'expired' | 'claimed' | 'voided'
  
  claimCount: number
  lastClaimDate?: string
  
  terms?: string
  notes?: string
  
  activatedBy: string
  activatedDate: string
}

export interface WarrantyClaim {
  id: string
  ref: string
  
  warrantyId: string
  warrantyRef: string
  
  customerId: string
  customerName: string
  
  productId: string
  productName: string
  serialNumber: string
  
  claimDate: string
  issueDescription: string
  
  repairOrderId?: string
  repairOrderRef?: string
  
  status: 'submitted' | 'approved' | 'rejected' | 'completed'
  
  resolution?: 'repaired' | 'replaced' | 'refunded' | 'denied'
  resolutionDate?: string
  resolutionNotes?: string
  
  cost: number // Cost to company
  recoverable: boolean // Can claim from supplier
  
  approvedBy?: string
  approvedDate?: string
  completedDate?: string
  
  notes?: string
}

// ─── Returns (RMA) ────────────────────────────────────────────────────────────

export type ReturnReason = 'defective' | 'wrong_item' | 'not_as_described' | 'damaged' | 'customer_changed_mind' | 'warranty_claim'
export type ReturnResolution = 'repair' | 'replace' | 'refund' | 'credit_note' | 'exchange'

export interface ReturnRequest {
  id: string
  ref: string // RMA-2024-0001
  
  customerId: string
  customerName: string
  
  salesOrderId: string
  salesOrderRef: string
  deliveryId: string
  originalDeliveryDate: string
  
  items: ReturnLine[]
  
  reason: ReturnReason
  reasonDetail: string
  
  requestDate: string
  requestedBy: string
  requestedByName: string
  
  approvalRequired: boolean
  approvedDate?: string
  approvedBy?: string
  approvalNotes?: string
  
  status: 'requested' | 'approved' | 'rejected' | 'received' | 'inspected' | 'processed' | 'closed'
  
  // Receipt
  receivedDate?: string
  receivedBy?: string
  receivedCondition?: 'good' | 'damaged' | 'defective'
  inspectionNotes?: string
  
  // Resolution
  resolution?: ReturnResolution
  resolutionDetails?: string
  
  refundAmount?: number
  refundDate?: string
  refundMethod?: PaymentMethod
  
  creditNoteId?: string
  creditNoteRef?: string
  
  replacementSOId?: string
  replacementSORef?: string
  
  repairOrderId?: string
  repairOrderRef?: string
  
  restockingFee?: number
  refundDeduction?: number
  
  closedDate?: string
  
  notes?: string
}

export interface ReturnLine {
  id: string
  
  productId: string
  productName: string
  sku: string
  
  serialNumber?: string
  serialId?: string
  
  qtyOrdered: number
  qtyDelivered: number
  qtyReturning: number
  qtyAccepted?: number
  
  unitPrice: number
  lineTotal: number
  
  reason: string
  condition?: 'good' | 'damaged' | 'defective'
  
  photoUrl?: string
  
  notes?: string
}

// ─── Sales Performance & Analytics ────────────────────────────────────────────

export interface SalesMetrics {
  period: 'today' | 'week' | 'month' | 'quarter' | 'year'
  startDate: string
  endDate: string
  
  // Revenue
  totalRevenue: number
  invoicedRevenue: number
  collectedRevenue: number
  
  // Orders
  totalOrders: number
  completedOrders: number
  pendingOrders: number
  cancelledOrders: number
  
  // Products
  totalItemsSold: number
  uniqueProducts: number
  averageOrderValue: number
  
  // Customers
  totalCustomers: number
  newCustomers: number
  repeatCustomers: number
  
  // Pipeline
  leadsCreated: number
  opportunitiesCreated: number
  quotesCreated: number
  quotesAccepted: number
  quoteConversionRate: number
  
  // Performance
  averageSalesCycle: number // days
  winRate: number
  
  // Top performers
  topProducts: { productId: string; productName: string; qtySold: number; revenue: number }[]
  topCustomers: { customerId: string; customerName: string; orderCount: number; revenue: number }[]
  topSalesReps: { userId: string; userName: string; ordersWon: number; revenue: number }[]
}

// ─── Control & Validation Rules ──────────────────────────────────────────────

export interface SalesControlRules {
  // Stock controls
  allowSaleWithoutStock: boolean
  allowBackorders: boolean
  requireSerialForTrackedItems: boolean
  
  // Pricing controls
  maxDiscountWithoutApproval: number
  requireApprovalForSpecialPricing: boolean
  enforceMinimumMargin: boolean
  minimumMarginPercent: number
  
  // Credit controls
  enforceCreditLimit: boolean
  allowOverLimit: boolean
  requireApprovalForCreditOverride: boolean
  
  // Document controls
  allowDeleteTransactions: boolean
  allowModifyAfterDelivery: boolean
  requireReasonForCancellation: boolean
  lockPricingAfterSOConfirmation: boolean
  
  // Delivery controls
  requireSerialValidation: boolean
  allowPartialDelivery: boolean
  requireSignatureProof: boolean
  autoInvoiceOnDelivery: boolean
  
  // Payment controls
  requirePaymentBeforeDelivery: boolean // For COD
  allowPartialPayments: boolean
  sendPaymentReminders: boolean
  reminderDaysBeforeDue: number
}

// ─── Document Linkage ─────────────────────────────────────────────────────────

export interface DocumentLink {
  sourceType: 'lead' | 'opportunity' | 'quote' | 'sales_order' | 'delivery' | 'invoice' | 'payment' | 'return'
  sourceId: string
  sourceRef: string
  
  targetType: 'lead' | 'opportunity' | 'quote' | 'sales_order' | 'delivery' | 'invoice' | 'payment' | 'return'
  targetId: string
  targetRef: string
  
  linkType: 'converted_to' | 'delivered_via' | 'invoiced_as' | 'paid_by' | 'revised_from' | 'returned_via'
  linkDate: string
}

// ─── Sales Order Status Extended ─────────────────────────────────────────────

export type SalesOrderStatus = 
  | 'draft'              // Being created
  | 'quotation'          // Sent to customer as quote
  | 'pending_approval'   // Awaiting internal approval
  | 'approved'           // Approved, not yet confirmed
  | 'confirmed'          // Customer confirmed (locked)
  | 'reserved'           // Stock reserved
  | 'picking'            // Warehouse picking
  | 'ready_to_ship'      // Picked and ready
  | 'in_transit'         // Dispatched/in delivery
  | 'partially_delivered'// Some items delivered
  | 'delivered'          // Fully delivered
  | 'invoiced'           // Invoice generated
  | 'paid'               // Fully paid
  | 'cancelled'          // Cancelled
  | 'on_hold'            // Temporarily paused

// ─── Backorder ───────────────────────────────────────────────────────────────

export interface BackorderItem {
  id: string
  
  salesOrderId: string
  salesOrderRef: string
  salesOrderLineId: string
  
  productId: string
  productName: string
  sku: string
  
  qtyOrdered: number
  qtyAvailable: number
  qtyBackordered: number
  
  customerId: string
  customerName: string
  
  expectedDate?: string
  
  status: 'pending' | 'procurement_ordered' | 'stock_arrived' | 'fulfilled' | 'cancelled'
  
  procurementOrderId?: string
  procurementOrderRef?: string
  
  createdDate: string
  fulfilledDate?: string
  
  notifyCustomer: boolean
  customerNotified: boolean
  
  notes?: string
}

// ─── Delivery Validation ─────────────────────────────────────────────────────

export interface DeliveryValidation {
  deliveryId: string
  
  validatedBy: string
  validatedDate: string
  
  checks: ValidationCheck[]
  
  allChecksPass: boolean
  
  stockDeducted: boolean
  invoiceGenerated: boolean
  warrantyActivated: boolean
  
  issues: string[]
}

export interface ValidationCheck {
  item: string
  expected: string | number
  actual: string | number
  pass: boolean
  notes?: string
}

// ─── Sales Rep Performance ───────────────────────────────────────────────────

export interface SalesRepTarget {
  userId: string
  userName: string
  role: string
  
  period: 'monthly' | 'quarterly' | 'yearly'
  year: number
  month?: number
  quarter?: number
  
  targetRevenue: number
  targetOrders: number
  targetNewCustomers: number
  
  actualRevenue: number
  actualOrders: number
  actualNewCustomers: number
  
  achievementPercent: number
  
  commission: number
  commissionRate: number
  
  bonusEligible: boolean
  bonusAmount?: number
}

// ─── Credit Management ───────────────────────────────────────────────────────

export interface CustomerCredit {
  customerId: string
  customerName: string
  
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  
  outstandingInvoices: {
    invoiceId: string
    invoiceRef: string
    amount: number
    dueDate: string
    daysOverdue: number
  }[]
  
  totalOutstanding: number
  overdueAmount: number
  
  oldestInvoiceDate?: string
  oldestOverdueDays?: number
  
  paymentTerms: number
  averagePaymentDays: number
  
  status: 'good' | 'moderate' | 'high_risk' | 'suspended'
  
  lastPaymentDate?: string
  lastPaymentAmount?: number
  
  creditScore: number // 0-100
  
  lastReviewDate: string
  nextReviewDate: string
  reviewedBy?: string
}

// ─── Product Pricing ─────────────────────────────────────────────────────────

export interface PricelistItem {
  id: string
  productId: string
  productName: string
  
  customerSegment?: 'retail' | 'wholesale' | 'enterprise' | 'government'
  customerId?: string // Customer-specific pricing
  
  unitPrice: number
  minimumQty: number
  maximumDiscount: number
  
  validFrom: string
  validUntil?: string
  
  currency: 'KES'
  
  active: boolean
  
  createdBy: string
  createdDate: string
}

// ─── Sales Process State ─────────────────────────────────────────────────────

export interface SalesProcessState {
  // Core documents
  quotes: Quote[]
  salesOrders: SaleOrder[]
  deliveryNotes: DeliveryNote[]
  invoices: Invoice[]
  payments: Payment[]
  
  // Supporting
  stockReservations: StockReservation[]
  approvalRequests: ApprovalRequest[]
  backorderItems: BackorderItem[]
  returnRequests: ReturnRequest[]
  warrantyActivations: WarrantyActivation[]
  warrantyClaims: WarrantyClaim[]
  
  // Performance
  salesMetrics: SalesMetrics
  salesRepTargets: SalesRepTarget[]
  
  // Controls
  controlRules: SalesControlRules
  creditLimits: CustomerCredit[]
  pricelists: PricelistItem[]
}

// ─── Helper Types ─────────────────────────────────────────────────────────────

export interface Quote {
  // ... existing Quote type from sales-types.ts
  
  // Add these fields
  approvalRequestId?: string
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  
  convertedToSOId?: string
  convertedDate?: string
  
  linkedOpportunityId?: string
}

export interface SaleOrder {
  // ... existing SaleOrder type
  
  // Add these fields
  approvalRequestId?: string
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  
  reservationIds: string[]
  reservationStatus?: 'reserved' | 'partial' | 'none'
  
  deliveryIds: string[]
  
  fullyDelivered: boolean
  fullyInvoiced: boolean
  fullyPaid: boolean
  
  linkedQuoteId?: string
  linkedOpportunityId?: string
}
