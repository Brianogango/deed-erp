// ─── Sales Process Flow Types ─────────────────────────────────────────────────

/**
 * Approval workflow + stock reservation types shared across the sales
 * approval engine (lib/sales-approvals.ts, lib/sales/margin-approval.ts,
 * lib/store.tsx). Kept minimal — only types with live importers belong here.
 */

// ─── Approval Workflow ────────────────────────────────────────────────────────

export type ApprovalType = 'discount' | 'special_pricing' | 'credit_override' | 'corporate_deal' | 'backorder' | 'purchase_high_value'

export interface ApprovalRequest {
  id: string
  ref: string
  type: ApprovalType

  documentType: 'quote' | 'sales_order' | 'invoice' | 'purchase_order'
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
  /**
   * When set, any of these roles may approve this level (Director OR Finance
   * for price approvals). Defaults to `[role]` when omitted.
   */
  roles?: Array<'sales_rep' | 'finance_officer' | 'director' | 'technical_lead'>
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

  reservedFor: 'sales_order' | 'repair' | 'transfer' | 'employee' | 'reconfiguration'
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
