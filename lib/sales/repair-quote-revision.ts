/**
 * Rules for a repair quote revision reaching the repair's sale order.
 *
 * The repair quote is the source; the sale order in Sales is its copy. When
 * the technician revises the quote the repair goes back to awaiting the
 * client's approval, so the copy must follow — even if it was already
 * confirmed or sent — unless something has been delivered or invoiced
 * against it, in which case Finance has to credit it first.
 *
 * Without these rules the ordinary Sales locks refused every such revision
 * (technicians may not edit sale orders; confirmed and sent orders are frozen)
 * and the repair screen never heard about it.
 *
 * Pure: the route loads the repair and the blockers and passes them in.
 */

/** Staff who may revise any repair's quote; technicians only their own job. */
const REPAIR_REVISION_STAFF_ROLES = ['director', 'technical_lead', 'admin_officer', 'finance_officer', 'sales_rep']

type RevisionRepair = {
  id: string
  ref?: string | null
  saleOrderId?: string | null
  assignedTechnicianId?: string | null
}

type RevisionOrder = {
  id: string
  notes?: string | null
}

function isRepairsSaleOrder(repair: RevisionRepair, order: RevisionOrder): boolean {
  if (repair.saleOrderId && repair.saleOrderId === order.id) return true
  const ref = String(repair.ref ?? '').trim()
  return Boolean(ref) && String(order.notes ?? '').includes(ref)
}

export function repairRevisionAccessError(input: {
  role: string
  userId: string
  /** users.acts_as_technician — revises their own job's quotation like a technician. */
  actsAsTechnician?: boolean
  repair: RevisionRepair | null | undefined
  order: RevisionOrder
}): string | null {
  const { repair } = input
  if (!repair) return 'The repair for this quotation was not found'
  if (!isRepairsSaleOrder(repair, input.order)) return 'This sale order does not belong to that repair'
  if (REPAIR_REVISION_STAFF_ROLES.includes(input.role)) return null
  if ((input.role === 'technician' || input.actsAsTechnician === true) && repair.assignedTechnicianId && repair.assignedTechnicianId === input.userId) return null
  return 'Only the assigned technician or repair staff can revise this repair quotation'
}

/**
 * Whether the revision may reopen the order. `blockers` are the deliveries
 * and invoices already made against it.
 */
export function repairRevisionStatusError(fromStatus: string, blockers: string[]): string | null {
  if (fromStatus === 'cancelled') return 'The sale order for this repair was cancelled — the revised quote was not copied to Sales'
  if (fromStatus === 'sale' && blockers.length) {
    return `The sale order for this repair already has ${blockers.join('; ')} — Finance must credit it before the quote can change`
  }
  return null
}

/** Fields that return an order to an unsent draft quotation. */
export function reopenAsQuotationData(fromStatus: string): Record<string, unknown> {
  if (fromStatus === 'quotation') return {}
  return {
    status: 'quotation',
    locked: false,
    confirmedAt: null,
    confirmedById: null,
    sentAt: null,
    sentById: null,
    sentTo: null,
    sentMessage: null,
    acceptedAt: null,
    acceptedById: null,
  }
}
