import type { KilimallReturnEntry } from '@/lib/kilimall/kilimall-return'
import type { User } from './core'
import type { Delivery } from './delivery'
import type { Invoice } from './finance'
import type { Product, SerialNumber } from './inventory'

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
  createdAt?: string
  createdDate?: string
  createdBy?: string
  updatedAt?: string
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
  /** First and last name joined, as contact persons are derived from Contacts. */
  fullName?: string
  createdDate?: string
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
  contactEmail?: string
  contactPhone?: string
  /** The lead this deal was converted from. */
  leadId?: string
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
  /** Quotations / sale orders raised from this deal. */
  saleOrderIds?: string[]
  lostReason?: string
  lostToCompetitor?: string
  wonReason?: string
  createdAt?: string
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
  convertedDate?: string
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
  createdBy?: User | string
  items?: QuoteLineItem[]
  invoices?: Invoice[]
  opportunity?: Opportunity
  saleOrders?: SaleOrder[]
  /** What changed, recorded when the quote is revised. */
  revisionNotes?: string
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
  createdById?: string
  createdByName?: string
  createdAt?: string
  createdDate?: string
  // Relations
  opportunity?: Opportunity
  createdBy?: User | string
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
  /** none (pay on receipt) | approved | suspended | revoked | legacy — set by credit applications. */
  creditStatus?: string
  creditReviewDue?: string
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

/** One line of a sale order as the store keeps it. The fields are not modelled yet. */
export type SaleOrderLine = SaleOrder['lines'][number]

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
  orderDate?: string
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
  // Customer acceptance — immutable commercial snapshot until Reset / Confirm
  acceptedAt?: string
  acceptedById?: string
  acceptedByName?: string
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
  /** The CRM deal this quotation came from. */
  opportunityId?: string
  invoiceAddress?: string
  deliveryAddress?: string
  /** Where the order came from when not typed in Sales (e.g. 'repair'). */
  source?: string
  repairId?: string
  repairRef?: string
  lines: any[]
  subtotal: number
  taxAmount?: number
  taxTotal: number
  discountAmount?: number
  totalAmount?: number
  total: number
  amountPaid?: number
  notes?: string
  termsAndConditions?: string
  optionalProducts?: Array<{ id: string; productId?: string; productName: string; qty: number; unitPrice: number }>
  lockVersion?: number
  createdById?: string
  createdByUserId?: string
  createdByName?: string
  createdAt?: string
  updatedAt?: string
  // Relations
  client?: Client
  quote?: Quote
  createdBy?: User | string
  items?: SaleOrderItem[]
  invoices?: Invoice[]
  deliveries?: Delivery[]
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
  /** Each time the order came back (refund or exchange). */
  returns?: KilimallReturnEntry[]
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
  courier?: string
  dispatchDate?: string
  trackingReference?: string
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
  manuallyMatched?: boolean
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
  status: 'draft' | 'posted' | 'partially_matched' | 'reconciled'
  lines: KilimallSettlementLine[]
  createdDate: string; createdBy: string
}

export interface POSOrder {
  id: string; ref: string; sessionId: string
  lines: {
    productId: string; productName: string; barcode: string
    qty: number; price: number; subtotal: number; serialId?: string; serialNumber?: string
  }[]
  subtotal: number; taxTotal: number; total: number
  /** `card` kept for legacy sessions; new charges use `bank`. */
  payment: 'cash' | 'mpesa' | 'bank' | 'card'
  /** Selected company bank when payment is `bank`. */
  bankAccountId?: string
  /** Optional transfer / deposit reference for bank (or M-Pesa code). */
  paymentReference?: string
  /**
   * Paid in parts, e.g. KES 5,000 cash and the rest by bank. `payment` is
   * then the part that took the most; totals read the parts (lib/pos-tenders).
   */
  splitPayments?: import('@/lib/pos-tenders').PosTender[]
  customerId?: string; customerName?: string; date: string
  createdByUserId?: string; createdByName?: string
  /** Person who closed the sale for commission (may differ from cashier). */
  salespersonId?: string
  salespersonName?: string
  /** Deed Xpress agent who brought the customer; earns agentCommission (KES) once the sale is fully paid. */
  agentId?: string
  agentName?: string
  agentCommission?: number
  pointsEarned?: number
  pointsRedeemed?: number
  /** Client/store credit applied to this POS sale; the remainder is the selected tender. */
  customerCreditAmount?: number
  customerCreditRefs?: string[]
  createdAt?: string
  invoiceId?: string
  invoiceRef?: string
}

export interface POSSession {
  /** Its old number, when that repeated another's (its close journal carries it). */
  formerRef?: string
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
  /** Bank tender total (includes legacy `card` payments). */
  totalCard: number
  /** Alias of totalCard for new closes; optional on older sessions. */
  totalBank?: number
  orderCount: number
  openedBy?: string
  closedBy?: string
  journalId?: string
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
