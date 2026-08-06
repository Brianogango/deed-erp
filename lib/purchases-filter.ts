/** Document type derived from lifecycle status (draft/sent = RFQ; otherwise PO). */
export type PurchaseDocType = 'rfq' | 'po'

export type PurchaseTypeFilter = 'all' | PurchaseDocType

/** Actual purchase-order lifecycle statuses in the data model. */
export type PurchaseLifecycleStatus =
  | 'draft'
  | 'sent'
  | 'confirmed'
  | 'partial'
  | 'received'
  | 'cancelled'

export type PurchaseStatusFilter = 'all' | PurchaseLifecycleStatus

export const PURCHASE_LIFECYCLE_STATUSES: PurchaseLifecycleStatus[] = [
  'draft',
  'sent',
  'confirmed',
  'partial',
  'received',
  'cancelled',
]

export const PURCHASE_STATUS_FILTER_LABELS: Record<PurchaseLifecycleStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  confirmed: 'Confirmed',
  partial: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
}

export interface PurchaseFilterRow {
  status: string
}

export function purchaseDocType(status: string): PurchaseDocType {
  return status === 'draft' || status === 'sent' ? 'rfq' : 'po'
}

export function matchesPurchaseTypeFilter(
  status: string,
  typeFilter: PurchaseTypeFilter,
): boolean {
  if (typeFilter === 'all') return true
  return purchaseDocType(status) === typeFilter
}

export function matchesPurchaseStatusFilter(
  status: string,
  statusFilter: PurchaseStatusFilter,
): boolean {
  if (statusFilter === 'all') return true
  return status === statusFilter
}

export function matchesPurchaseFilters(
  status: string,
  typeFilter: PurchaseTypeFilter,
  statusFilter: PurchaseStatusFilter,
): boolean {
  return (
    matchesPurchaseTypeFilter(status, typeFilter) &&
    matchesPurchaseStatusFilter(status, statusFilter)
  )
}

export function filterPurchaseOrders<T extends PurchaseFilterRow>(
  orders: T[],
  typeFilter: PurchaseTypeFilter,
  statusFilter: PurchaseStatusFilter,
): T[] {
  return orders.filter(po => matchesPurchaseFilters(po.status, typeFilter, statusFilter))
}

export interface PurchaseFilterFacetCounts {
  type: { all: number; rfq: number; po: number }
  status: Record<'all' | PurchaseLifecycleStatus, number>
}

/**
 * Facet counts use AND logic: each facet's option counts are constrained by the
 * other facet's current selection (so counts match visible rows if that option
 * were selected).
 */
export function countPurchaseFilterFacets(
  orders: PurchaseFilterRow[],
  typeFilter: PurchaseTypeFilter,
  statusFilter: PurchaseStatusFilter,
): PurchaseFilterFacetCounts {
  const forTypeFacet = orders.filter(po =>
    matchesPurchaseStatusFilter(po.status, statusFilter),
  )
  const forStatusFacet = orders.filter(po =>
    matchesPurchaseTypeFilter(po.status, typeFilter),
  )

  const statusCounts = Object.fromEntries(
    PURCHASE_LIFECYCLE_STATUSES.map(s => [
      s,
      forStatusFacet.filter(po => po.status === s).length,
    ]),
  ) as Record<PurchaseLifecycleStatus, number>

  return {
    type: {
      all: forTypeFacet.length,
      rfq: forTypeFacet.filter(po => purchaseDocType(po.status) === 'rfq').length,
      po: forTypeFacet.filter(po => purchaseDocType(po.status) === 'po').length,
    },
    status: {
      all: forStatusFacet.length,
      ...statusCounts,
    },
  }
}
