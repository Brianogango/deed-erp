import type { LocationId } from './core'

// Enhanced Purchase Order Line with serial tracking
export interface POLine {
  id: string; productId: string; productName: string
  qty: number; qtyReceived: number; qtyBilled?: number; unitPrice: number; taxRate: number; subtotal: number
  requiresSerial: boolean
  importedSerials?: string[]   // serials pre-loaded from CSV import (auto-fills GRN)
  specs?: string               // product specs from import (e.g. "Intel i5, 8GB RAM, 512GB SSD")
  accountCode?: string         // cost account code (e.g. '6101')
}

export type POStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'received' | 'cancelled'

export interface PurchaseOrder {
  id: string; ref: string; status: POStatus
  vendorId: string; vendorName: string
  date: string; expectedDate: string
  lines: POLine[]; subtotal: number; taxTotal: number; total: number
  billId?: string; notes: string; receiptIds: string[]
  lockVersion?: number
  approvalStatus?: 'not_required' | 'pending' | 'approved' | 'rejected'
  approvalRequestIds?: string[]
  // Repair procurement link — set when auto-created from a repair procurement request
  repairId?: string; repairRef?: string; procurementRequestId?: string
  // Refurbishment part link — receiving the order marks that part received
  refurbJobId?: string; refurbJobRef?: string; refurbPartId?: string
}

// Receipt (Goods Receipt Note) — created when PO is received
export interface Receipt {
  id: string; ref: string; poId: string; poRef: string
  vendorId: string; vendorName: string
  status: 'draft' | 'validated'
  date: string
  lines: {
    productId: string; productName: string
    /** The PO line this fills — several PO lines can carry the same product. */
    poLineId?: string
    qtyExpected: number; qtyReceived: number
    serials: string[]       // serial numbers entered/confirmed during receipt
    requiresSerial: boolean
    importedSerials?: string[]  // pre-loaded from CSV/PO import — shown as pre-filled in GRN
    specs?: string              // specs from import — shown in GRN for reference
  }[]
  destinationLocation: LocationId
  billId?: string
}

// Stock Transfer between internal locations
export interface StockTransfer {
  /** Its old number, when that repeated another's (moves and journals carry it). */
  formerRef?: string
  id: string; ref: string
  fromLocation: LocationId; toLocation: LocationId
  status: 'draft' | 'done'
  date: string
  lines: {
    productId: string; productName: string
    qty: number; serialIds: string[]
  }[]
  notes: string
}

// Purchase Return
export interface PurchaseReturn {
  id: string; ref: string
  poId: string; poRef: string; receiptId: string; receiptRef: string
  vendorId: string; vendorName: string
  status: 'draft' | 'confirmed'
  date: string
  reason: 'damaged' | 'wrong_supply' | 'excess' | 'other'
  lines: {
    productId: string; productName: string
    qty: number; serialIds: string[]
    requiresSerial: boolean
  }[]
  creditNoteId?: string
  // Pickup / dispatch tracking
  collectedByUserId?: string
  collectedByName?: string
  collectedDate?: string
  pickupNotes?: string
}
