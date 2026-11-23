/**
 * Moving one machine (a serial) to another product — e.g. it was received
 * under the wrong model or specs. Client-safe rule, shared by the screen and
 * the server: only a machine sitting in our stock moves. Anything that ties it
 * to a document (sale order, repair, delivery, a vendor) is cleared first, or
 * that document would point at the wrong model.
 */
export type MovableUnit = { status?: string; saleOrderId?: string | null; repairId?: string | null; identityPending?: boolean | null }

export function unitMoveBlocker(unit: MovableUnit): string | null {
  // A machine without a readable serial yet (UNK- tag) can still be given its
  // model and specs — often the model is known long before the serial is. It
  // keeps its tag until the serial is recorded (Identify).
  // On the refurbishment bench is still ours and in the building: a machine
  // that came in under a vague or wrong name ("lenovo tm") is corrected there,
  // where it is first looked at properly.
  if (unit.status !== 'available' && unit.status !== 'refurbishment') return `It is ${String(unit.status || 'not in stock').replace(/_/g, ' ')} — only a machine in stock or on the refurbishment bench can move`
  if (unit.saleOrderId) return 'It is reserved on a sale order — release it first'
  if (unit.repairId) return 'It is on a repair — finish or release it first'
  return null
}
