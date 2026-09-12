import { saleOrderPersistBody } from '@/lib/sale-order-persist'

/**
 * PATCH body written after a delivery is validated.
 *
 * Must not send `lockVersion`: handleValidate already wrote the sale order
 * (heal + /deliver-lines) so the client copy is stale and a 409
 * "Record was modified by another user" would drop qtyDelivered / totals.
 */
export function fulfillmentSaleOrderPatch(
  order: Record<string, unknown>,
  opts?: { cancelRemaining?: boolean; trimmedChanged?: boolean },
) {
  return {
    ...saleOrderPersistBody(order),
    fulfillmentTrim: Boolean(opts?.cancelRemaining && opts?.trimmedChanged),
  }
}
