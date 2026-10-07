/**
 * Where a sale may take stock from.
 *
 * Only Ready for Sale — the warehouse location, and for serials the
 * `available` status — may be sold, reserved for an order, or shipped on a
 * delivery note. "With Issues" (the legacy `shop` location), Refurbishment
 * (`repair_unit`), Pending Testing and Quarantine hold devices that have not
 * passed, or failed, their checks.
 *
 * POS and the server-side order reservation already sold from the warehouse
 * only; sale-order fallbacks, the serial pickers and delivery notes also took
 * from With Issues and Refurbishment. They all use this now.
 */

export const SALE_PICK_LOCATIONS = ['warehouse'] as const

type SalePickLocation = (typeof SALE_PICK_LOCATIONS)[number]

export function isSalePickLocation(location: unknown): location is SalePickLocation {
  return (SALE_PICK_LOCATIONS as readonly string[]).includes(String(location ?? ''))
}

/** A serial that may be sold now: ready for sale and not held for anything. */
export function isSellableSerial(serial: { status?: unknown; location?: unknown } | null | undefined): boolean {
  return Boolean(serial) && String(serial!.status ?? '') === 'available' && isSalePickLocation(serial!.location)
}

/** The stage names people see, for messages about where a device is. */
const STOCK_STAGE_LABELS: Record<string, string> = {
  warehouse: 'Ready for Sale',
  shop: 'With Issues',
  repair_unit: 'Inbound — Work in progress',
  pending_testing: 'Inbound — Awaiting tests',
  quarantine: 'Inbound — Rejected',
  computer_aid: 'Computer Aid',
  vendor: 'Vendor',
  customer: 'Customer',
}

export function stockStageLabel(location: unknown): string {
  const key = String(location ?? '')
  return STOCK_STAGE_LABELS[key] ?? (key || 'an unknown location')
}
