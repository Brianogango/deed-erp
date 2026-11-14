/**
 * Moving one machine (a serial) to another product — e.g. it was received
 * under the wrong model or specs. Client-safe rule, shared by the screen and
 * the server: only a machine sitting in our stock moves. Anything that ties it
 * to a document (sale order, repair, delivery, a vendor) is cleared first, or
 * that document would point at the wrong model.
 */
export type MovableUnit = { status?: string; saleOrderId?: string | null; repairId?: string | null; identityPending?: boolean | null }

export function unitMoveBlocker(unit: MovableUnit): string | null {
  if (unit.identityPending) return 'Identify it first (Refurbishment → Identify)'
  if (unit.status !== 'available') return `It is ${String(unit.status || 'not in stock').replace(/_/g, ' ')} — only a machine in stock can move`
  if (unit.saleOrderId) return 'It is reserved on a sale order — release it first'
  if (unit.repairId) return 'It is on a repair — finish or release it first'
  return null
}
