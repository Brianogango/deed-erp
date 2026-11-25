// Shared types for the Sales module.
//
// Split out of components/modules/Sales.tsx, which had grown to 5342 lines.
// Moved verbatim — no behaviour change.

import { SaleOrder, SerialNumber } from '@/lib/store'

export type SalesView = 'list' | 'form' | 'new' | 'delivery'

export type SalesOrderLineView = {
  id: string
  productId?: string
  productName?: string
  description?: string
  qty: number
  qtyDelivered?: number
  unitPrice: number
  subtotal: number
  taxRate?: number
  discount?: number
  discountPercent?: number
  serials?: SerialNumber[]
  serialIds?: string[]
}
export type SalesOrderView = SaleOrder & {
  ref: string
  customerId?: string
  customerName: string
  date: string
  deliveryDate?: string
  subtotal: number
  taxTotal: number
  total: number
  lines: SalesOrderLineView[]
  notes?: string
  validUntil?: string
  paymentTerms?: string
  createdByName?: string
}
/** Optional product row on a new quotation; qty stays '' until the user enters it. */
export type OptionalProductDraft = { id: string; productId: string; productName: string; qty: number | ''; unitPrice: number }
export type DraftLine = {
  type: 'item' | 'section'
  id: string
  productId: string
  productName: string
  description: string
  qty: string
  unitPrice: string
  discount: string
  taxRate: string
}

export type MoreAction = {
  label: string
  icon?: any
  onClick: () => void
  disabled?: boolean
  title?: string
  tone?: 'default' | 'danger'
}
