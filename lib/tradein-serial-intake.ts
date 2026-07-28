/**
 * Helpers for buyback / exchange / RMA returned-serial resolution.
 * Supports picking already-sold serials and registering intake serials
 * that are not yet in the system.
 */

export type SerialLike = {
  id: string
  serial: string
  productId: string
  status: string
  location: string
  saleOrderId?: string
}

export type SaleOrderLike = {
  id: string
  customerId?: string
}

export function normSerial(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/** Prefer serials sold on this customer's orders / this SO when ranking picker results. */
export function scoreCustomerReturnSerial(
  serial: SerialLike,
  opts?: { customerId?: string; saleOrderId?: string; saleOrders?: SaleOrderLike[] },
): number {
  let score = 0
  if (opts?.saleOrderId && serial.saleOrderId === opts.saleOrderId) score += 100
  if (opts?.customerId && opts.saleOrders?.length && serial.saleOrderId) {
    const so = opts.saleOrders.find(o => o.id === serial.saleOrderId)
    if (so?.customerId === opts.customerId) score += 50
  }
  return score
}

export function isCustomerReturnEligible(serial: SerialLike): boolean {
  return serial.status === 'sold' || serial.location === 'customer'
}

export function isStockOutEligible(serial: SerialLike, location?: string): boolean {
  return ['available', 'refurbishment'].includes(serial.status) && (!location || serial.location === location)
}

export function findDuplicateSerial(
  serials: SerialLike[],
  productId: string,
  serialText: string,
): SerialLike | undefined {
  const key = normSerial(serialText)
  if (!key) return undefined
  return serials.find(s => s.productId === productId && normSerial(s.serial) === key)
}

/**
 * Parse comma-separated serial tokens for a serialized product line.
 * When `allowIntake` is true, unknown tokens are returned in `pendingIntake`
 * instead of hard errors (caller registers them into inventory).
 */
export function parseReturnSerialTokens(args: {
  raw: string
  productId: string
  productName: string
  requiresSerial: boolean
  qty: number
  serials: SerialLike[]
  mode: 'customer_return' | 'stock_out'
  location?: string
  allowIntake?: boolean
}): { serialIds: string[]; pendingIntake: string[]; errors: string[] } {
  const { raw, productId, productName, requiresSerial, qty, serials, mode, location, allowIntake } = args
  const tokens = raw.split(',').map(s => s.trim()).filter(Boolean)
  const errors: string[] = []
  const serialIds: string[] = []
  const pendingIntake: string[] = []

  if (!requiresSerial) return { serialIds, pendingIntake, errors }
  if (tokens.length !== qty) errors.push(`expected ${qty} serial(s)`)

  tokens.forEach(token => {
    const serial = serials.find(s =>
      s.productId === productId &&
      (normSerial(s.serial) === normSerial(token) || normSerial(s.id) === normSerial(token)) &&
      (mode === 'customer_return' ? isCustomerReturnEligible(s) : isStockOutEligible(s, location)),
    )
    if (serial) {
      serialIds.push(serial.id)
      return
    }
    if (mode === 'customer_return' && allowIntake) {
      const dup = findDuplicateSerial(serials, productId, token)
      if (dup && !isCustomerReturnEligible(dup)) {
        errors.push(`serial "${token}" exists but is not a customer return (${dup.status})`)
      } else if (dup) {
        serialIds.push(dup.id)
      } else {
        pendingIntake.push(token)
      }
      return
    }
    errors.push(`serial "${token}" not available for ${productName}`)
  })

  return { serialIds, pendingIntake, errors }
}
