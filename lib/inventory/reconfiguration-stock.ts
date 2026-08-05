/**
 * Pure stock planners for device reconfiguration component movements.
 */

export type ReconfigLocationId =
  | 'warehouse'
  | 'shop'
  | 'repair_unit'
  | 'vendor'
  | 'customer'
  | 'employee'
  | 'pending_testing'
  | 'quarantine'

export type ReconfigStockMovePlan =
  | {
      kind: 'return_bulk_to_testing'
      productId: string
      productName: string
      qty: number
      to: 'pending_testing' | 'quarantine'
      documentRef: string
      reason: string
    }
  | {
      kind: 'return_serial_to_testing'
      productId: string
      productName: string
      serialId?: string
      serialNumber?: string
      to: 'pending_testing' | 'quarantine'
      documentRef: string
      reason: string
      /** When component was never a separate stock unit, create inbound qty/serial */
      createIfMissing: boolean
    }
  | {
      kind: 'consume_bulk'
      productId: string
      productName: string
      qty: number
      from: ReconfigLocationId
      documentRef: string
      reason: string
    }
  | {
      kind: 'consume_serial'
      productId: string
      productName: string
      serialId: string
      serialNumber: string
      from: ReconfigLocationId
      documentRef: string
      reason: string
    }

export function planComponentRemoval(params: {
  documentRef: string
  productId: string
  productName: string
  qty: number
  componentSerialId?: string | null
  componentSerialText?: string | null
  disposition: 'pending_testing' | 'quarantine' | string
}): ReconfigStockMovePlan {
  const to = params.disposition === 'quarantine' ? 'quarantine' : 'pending_testing'
  if (params.componentSerialId || params.componentSerialText) {
    return {
      kind: 'return_serial_to_testing',
      productId: params.productId,
      productName: params.productName,
      serialId: params.componentSerialId || undefined,
      serialNumber: params.componentSerialText || undefined,
      to,
      documentRef: params.documentRef,
      reason: `Removed during ${params.documentRef}`,
      createIfMissing: true,
    }
  }
  return {
    kind: 'return_bulk_to_testing',
    productId: params.productId,
    productName: params.productName,
    qty: Math.max(1, params.qty || 1),
    to,
    documentRef: params.documentRef,
    reason: `Removed during ${params.documentRef}`,
  }
}

export function planComponentInstall(params: {
  documentRef: string
  productId: string
  productName: string
  qty: number
  from: ReconfigLocationId
  componentSerialId?: string | null
  componentSerialText?: string | null
}): ReconfigStockMovePlan {
  if (params.componentSerialId) {
    return {
      kind: 'consume_serial',
      productId: params.productId,
      productName: params.productName,
      serialId: params.componentSerialId,
      serialNumber: params.componentSerialText || params.componentSerialId,
      from: params.from,
      documentRef: params.documentRef,
      reason: `Installed during ${params.documentRef}`,
    }
  }
  return {
    kind: 'consume_bulk',
    productId: params.productId,
    productName: params.productName,
    qty: Math.max(1, params.qty || 1),
    from: params.from,
    documentRef: params.documentRef,
    reason: `Installed during ${params.documentRef}`,
  }
}

/** Sellable free qty excludes pending_testing and quarantine. */
export function isSellableLocation(location: string): boolean {
  return location === 'warehouse' || location === 'shop'
}

export function freeQtyAtSellableLocations(
  byLocation: Record<string, number>,
  reservationsHeldElsewhere: number,
): number {
  const sellable =
    Math.max(0, Number(byLocation.warehouse) || 0) + Math.max(0, Number(byLocation.shop) || 0)
  return Math.max(0, sellable - Math.max(0, reservationsHeldElsewhere))
}
