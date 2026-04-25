import 'server-only'
import { getPortalRepair, approvalDecisions, type PortalRepair, type PortalRepairStatus } from './portal-repairs'
import { loadAppState } from './server-store'
import type { RepairOrder } from './repair-types'

function erpToPortal(r: RepairOrder): PortalRepair {
  const statusHistory: PortalRepair['statusHistory'] = []
  if (r.intakeDate) statusHistory.push({ status: 'received', date: r.intakeDate })
  if (r.assignedDate) statusHistory.push({ status: 'assigned', date: r.assignedDate, note: r.assignedTechnicianName ? `Assigned to ${r.assignedTechnicianName}` : undefined })
  if (r.diagnosis?.diagnosedDate) statusHistory.push({ status: 'diagnosed', date: r.diagnosis.diagnosedDate })
  if (r.quote?.sentDate) statusHistory.push({ status: 'awaiting_approval', date: r.quote.sentDate, note: 'Quote sent to customer' })
  if (r.quote?.approvedDate) statusHistory.push({ status: 'approved', date: r.quote.approvedDate })
  if (r.repairStartDate) statusHistory.push({ status: 'in_repair', date: r.repairStartDate })
  if (r.qcPassedDate) statusHistory.push({ status: 'qc', date: r.qcPassedDate })
  if (r.closedDate) statusHistory.push({ status: 'closed', date: r.closedDate })

  const portal: PortalRepair = {
    ref: r.ref,
    status: r.status as PortalRepairStatus,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    productName: r.productName,
    serialNumber: r.serialNumber,
    deviceCondition: r.deviceCondition,
    intakeChannel: r.intakeChannel,
    intakeDate: r.intakeDate,
    estimatedCompletionDate: r.estimatedCompletionDate,
    issueDescription: r.issueDescription,
    accessories: r.accessories,
    assignedTechnicianName: r.assignedTechnicianName,
    diagnosis: r.diagnosis
      ? {
          findings: r.diagnosis.findings,
          faultDescription: r.diagnosis.faultDescription,
          recommendedAction: r.diagnosis.recommendedAction,
          estimatedHours: r.diagnosis.estimatedHours,
          diagnosedDate: r.diagnosis.diagnosedDate,
        }
      : undefined,
    quote: r.quote
      ? {
          lines: r.quote.lines.map(l => ({
            type: l.type,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            subtotal: l.subtotal,
          })),
          subtotal: r.quote.subtotal,
          tax: r.quote.tax,
          total: r.quote.total,
          validUntil: r.quote.validUntil,
          sentDate: r.quote.sentDate,
          approvedDate: r.quote.approvedDate,
          approvedBy: r.quote.approvedBy,
          rejectedDate: r.quote.rejectedDate,
          rejectionReason: r.quote.rejectionReason,
        }
      : undefined,
    statusHistory,
    repairStartDate: r.repairStartDate,
    delivery: r.delivery
      ? {
          method: r.delivery.method,
          scheduledDate: r.delivery.scheduledDate,
          address: r.delivery.address,
        }
      : undefined,
    closedDate: r.closedDate,
    slaMissed: r.slaMissed,
    underWarranty: r.underWarranty,
    notes: r.notes || undefined,
  }

  const decision = approvalDecisions.get(r.ref.toUpperCase())
  if (!decision) return portal

  if (decision.approved) {
    return {
      ...portal,
      status: 'approved',
      quote: portal.quote
        ? { ...portal.quote, approvedDate: decision.date, approvedBy: 'customer' }
        : portal.quote,
      statusHistory: [
        ...portal.statusHistory,
        { status: 'approved', date: decision.date, note: 'Quote approved by customer via portal' },
      ],
    }
  } else {
    return {
      ...portal,
      status: 'declined',
      quote: portal.quote
        ? { ...portal.quote, rejectedDate: decision.date, rejectionReason: decision.reason }
        : portal.quote,
      statusHistory: [
        ...portal.statusHistory,
        { status: 'declined', date: decision.date, note: decision.reason ?? 'Quote declined by customer' },
      ],
    }
  }
}

export async function lookupRepair(ref: string): Promise<PortalRepair | null> {
  // 1. Static demo data + registered in-memory repairs
  const found = getPortalRepair(ref)
  if (found) return found

  // 2. Fall back to live ERP repairs in server-store
  try {
    const state = await loadAppState()
    const repairs = (state['deed_repairs'] ?? []) as RepairOrder[]
    const decoded = decodeURIComponent(ref)
    const erp = repairs.find(r => r.ref.toLowerCase() === decoded.toLowerCase())
    if (erp) return erpToPortal(erp)
  } catch {}

  return null
}
