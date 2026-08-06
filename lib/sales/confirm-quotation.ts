/**
 * Confirm-quotation UX helpers.
 * Backend `confirmSO` / `prepareDelivery` remain authoritative — these only
 * gate which dialog actions the UI offers.
 */

const CONFIRM_ROLES = new Set(['director', 'sales_rep', 'admin_officer'])

/** Roles that may confirm a quotation into a sales order (matches store.confirmSO). */
export function canConfirmQuotation(role?: string | null): boolean {
  return !!role && CONFIRM_ROLES.has(role)
}

/**
 * Roles that may run prepare/reserve after confirm.
 * Mirrors `canApproveInventoryAction` in lib/store.tsx.
 */
export function canConfirmAndReserve(role?: string | null): boolean {
  return !!role && ['director', 'admin_officer', 'inventory_officer', 'technical_lead'].includes(role)
}

/**
 * "Confirm without reservation" — proposed for directors / inventory officers
 * so they can create the SO + waiting DN without allocating stock yet.
 */
export function canConfirmWithoutReservation(role?: string | null): boolean {
  return role === 'director' || role === 'inventory_officer'
}

export type ConfirmQuotationMode = 'reserve' | 'no_reserve'

export function stockShortageLines(
  lines: Array<{ lineType?: string; productId?: string; productName?: string; description?: string; qty: number }>,
  availableOf: (productId: string) => number,
): Array<{ productName: string; qty: number; available: number }> {
  const shortages: Array<{ productName: string; qty: number; available: number }> = []
  for (const line of lines) {
    if (line.lineType === 'section' || !line.productId) continue
    const available = availableOf(line.productId)
    if (available < line.qty) {
      shortages.push({
        productName: line.productName ?? line.description ?? 'Item',
        qty: line.qty,
        available,
      })
    }
  }
  return shortages
}
