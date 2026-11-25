import type { LocationId } from './core'

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
  /** Its old number, when that repeated another's (stock moves and valuation carry it). */
  formerRef?: string
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
  /** VAT-aware credit total computed on receive (posted-invoice slice). */
  creditTotalHint?: number
  requiresCreditNote?: boolean
  sourceInvoiceId?: string
  sourceInvoiceRef?: string
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
  /** When created from a retained repair (customer left device with Deed). */
  repairId?: string
  repairRef?: string
  status: BuyBackStatus
  date: string
  lines: BuyBackLine[]
  total: number
  /** How the approved BBK was settled. `store_credit` means 3102, not cash out. Mutually exclusive with cash/M-Pesa/bank. */
  paymentMethod?: 'cash' | 'bank_transfer' | 'mpesa' | 'store_credit'
  destinationLocation: LocationId
  notes?: string
  approvedByName?: string; approvedDate?: string
  paidDate?: string
  /** CustomerCredit created by Add as credit; absent when the customer was paid in cash. */
  creditId?: string
  creditRef?: string
  /** Cash / M-Pesa / bank payout: the vendor bill (to the customer) that booked and paid it. */
  billId?: string; billRef?: string
  /** The reference Finance entered when paying the bill (M-Pesa code, transfer ref). */
  paymentReference?: string
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
  /** Its old number, when that repeated another's (moves and journals carry it). */
  formerRef?: string
  id: string; ref: string
  type: DonationType
  party: string          // donor name (in) or recipient name (out)
  date: string
  lines: DonationLine[]
  status: 'draft' | 'confirmed'
  location: LocationId   // destination for 'in', source for 'out'
  notes?: string
  /** When created from a retained repair (customer left device with Deed). */
  repairId?: string
  repairRef?: string
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
