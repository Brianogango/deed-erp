

/** Statuses that count as free on-hand for allocation / delivery. */
export function isOnHandSerialStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase()
  return s === 'available' || s === 'in_stock'
}

