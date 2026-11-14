import type { LocationId } from './core'

export interface DeliveryLine {
  productId: string; productName: string; qty: number; qtyDone: number;
  /** Cumulative qty received back via customer RMA — DN stays historical. */
  qtyReturned?: number
  serialIds: string[]; sourceLocation?: LocationId
}

export interface Delivery {
  id: string; ref: string
  saleOrderId: string; saleOrderRef: string
  customerId: string; customerName: string
  // Odoo-style stock states. 'waiting' = stock not fully reservable yet.
  status: 'draft' | 'waiting' | 'ready' | 'done' | 'cancelled'
  date: string; lines: DeliveryLine[]
  warrantyCreated: boolean
  /** Set when this delivery is the backorder of a partially validated one. */
  backorderOfId?: string
  backorderOfRef?: string
  // Recipient info — saved when DN is printed/signed
  recipientName?: string
  recipientPhone?: string
  recipientIdNumber?: string
  deliveryAddress?: string
  notes?: string
  /** Inventory allocation completed; delivery can now be validated. */
  preparedAt?: string
  preparedByUserId?: string
  /** Final delivery note popup/document was generated successfully. */
  deliveryNoteGeneratedAt?: string
  deliveryNoteGeneratedByUserId?: string
}

// ── Rider Delivery ────────────────────────────────────────────────────────────
export type DeliveryJobType =
  | 'repair_pickup'    // collect device from customer for repair
  | 'repair_dropoff'   // return repaired device to customer
  | 'sales_delivery'   // deliver items from a confirmed sale order
  | 'general'

          // ad-hoc rider trip with no SO / repair / invoice link

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
  /** Secret part of the rider's personal job link (set by the server). */
  portalToken?: string
  /** Set by the server on reads instead of the token (which only the link API returns). */
  hasPortalLink?: boolean
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
  /** Customer invoice that scheduled this rider delivery. */
  invoiceId?: string
  invoiceRef?: string
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
  /** Amount charged to the customer for delivery (may differ from riderFee). */
  deliveryFee?: number
  riderFee: number       // amount paid to rider for this job
  // Metadata
  notes: string
  failureReason?: string
  /** Name of the person who received it, entered by the rider. */
  recipientName?: string
  /** Money the customer paid the rider on delivery. */
  cashCollected?: { amount: number; method: 'cash' | 'mpesa'; reference?: string; at: string }
  /**
   * The customer paid the rider the delivery charge themselves (the rider
   * keeps it): it settles that much of the invoice and comes off the rider's
   * pay for this trip. See lib/delivery/rider-direct-pay.ts.
   */
  customerPaidRider?: {
    amount: number; method: 'cash' | 'mpesa'; reference?: string; at: string; by: string
    invoiceId?: string; invoiceRef?: string
    /** Off the books: credit note on a posted invoice, or amount cut from a draft. */
    creditNoteRef?: string; removedFromDraft?: number; customerCredit?: number; offBooksNote?: string
    /** Could not be taken off the invoice yet (why). */
    pending?: string
    /** First version only: settled by a payment on the invoice (fixed by /api/delivery-jobs/paid-to-rider-fix). */
    settled?: number; fixedAt?: string
  }
  /** When the rider last changed this job from their link. */
  riderUpdatedAt?: string
  /** Stops in order (drop off / collect / exchange). Jobs without stops are one stop. See lib/delivery/trip.ts. */
  stops?: import('@/lib/delivery/trip').Stop[]
  stopsFinishedAt?: string
  backAtShopAt?: string
  returnConfirmedAt?: string
  returnConfirmedBy?: string
  /** Last server-side change (rider link or office check-in / follow-up). */
  tripUpdatedAt?: string
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
