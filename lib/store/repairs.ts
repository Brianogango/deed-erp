import type { RepairStatus, IntakeChannel, RepairDiagnosis, RepairQuote, RepairQAItem, RepairPaymentConfirmationStatus } from '@/lib/repair-types'
import type { InvoiceReissue } from '@/lib/repair/invoice-reissue'
import type { LocationId } from './core'

export interface RepairOrder {
  id: string
  ref: string
  /** Timestamp tickets (`REP-227532`) replaced when an official ref was allocated. */
  previousRefs?: string[]
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
  issuePhotos?: { url: string; name: string; date: string }[]
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

  // Posted invoice waiting to be credited and reissued after a re-quote
  // (lib/repair/invoice-reissue.ts)
  invoiceReissue?: InvoiceReissue | null
  previousInvoiceIds?: string[]

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
    // Parts queue follow-up (lib/repair/parts-request.ts)
    adjustmentRefs?: string[]
    countCheckedProductIds?: string[]
    purchaseOrderId?: string
    orderReference?: string
    orderedDate?: string
    receivedDate?: string
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
  /** Server-authored user id of the intake creator; used for row-level access. */
  createdByUserId?: string
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
  /** "cancelled": the customer no longer owns the machine (traded in / exchanged). */
  status: 'active' | 'expiring' | 'expired' | 'cancelled'
  months: number
  cancelledAt?: string
  cancelledReason?: string
  /** Buy-back or exchange that ended it (BBK/… / EXC/…). */
  cancelledByRef?: string
  /** Where it was sold (issued on the server, lib/warranty/e-warranty.ts). */
  source?: 'delivery' | 'pos' | 'kilimall'
  sourceKey?: string
  issuedAt?: string
  specs?: string
}

export type OutsourceJobStatus = 'sent' | 'returned_resolved' | 'returned_unresolved' | 'cancelled'

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
  /**
   * Paid against the vendor's bills through Finance (cash/bank posted, bills
   * marked paid). Older payments lack this: they were recorded here only.
   */
  postedToAccounts?: boolean
  billRefs?: string[]
}


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
  /** Inactive vendors stay on old jobs and bills but are not offered for new jobs. */
  active?: boolean
  /** The Contacts record bills are raised against. */
  contactId?: string
}

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
  /** When the vendor promised it back; overdue counts from here. */
  expectedReturnDate?: string
  /** Who took the machine back in (not who sent it). */
  returnedByUserId?: string
  returnedByName?: string
  cancelledDate?: string
  cancelledByName?: string
  cancelReason?: string
  /** A stock machine (no repair): the serial record and where it sat before it left. */
  stockSerialId?: string
  stockFromLocation?: LocationId
  /** Accessories handed over with the machine, listed on the handover slip. */
  accessories?: string
  /** The vendor's cost added to the customer's repair quote. */
  customerChargeAmount?: number
  customerChargeAddedAt?: string
  /** The promised date a "late" reminder was sent for (one reminder per promise). */
  lateReminderFor?: string
  /** Changes made while the job was out (vendor, cost, dates). */
  editLog?: { date: string; by: string; note: string }[]
}
