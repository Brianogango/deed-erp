import 'server-only'
import { getPortalRepair, approvalDecisions, type PortalRepair, type PortalRepairStatus } from './portal-repairs'
import { loadAppState } from './server-store'
import type { RepairOrder } from './repair-types'

async function loadStoredPhotos(ref: string): Promise<{ url: string; name: string; date: string }[]> {
  try {
    const key = `repair_photos_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
    const state = await loadAppState()
    const rows = state[key]
    if (!Array.isArray(rows)) return []
    return rows.map((p: any) => ({ url: p.url, name: p.name ?? '', date: p.uploaded_at ?? '' }))
  } catch {
    return []
  }
}

async function restoreApprovalIfMissing(ref: string): Promise<void> {
  const key = ref.toUpperCase()
  if (approvalDecisions.has(key)) return
  try {
    const state = await loadAppState()
    const stored = state[`portal_approval_${key}`]
    if (stored) {
      const d = typeof stored === 'string' ? JSON.parse(stored) : stored
      if (d && typeof d.approved === 'boolean') {
        approvalDecisions.set(key, { approved: d.approved, reason: d.reason, date: d.date })
      }
    }
  } catch { /* ignore DB errors */ }
}

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
    preRepairPhotos: r.preRepairPhotos?.length ? r.preRepairPhotos : undefined,
    issuePhotos: r.issuePhotos?.length ? r.issuePhotos : undefined,
    qcReportData: r.qcReportData,
    qcReportName: r.qcReportName,
    diagnosisReportData: r.diagnosisReportData,
    diagnosisReportName: r.diagnosisReportName,
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
  // Restore persisted approval decision to in-memory map if this is a fresh server process
  await restoreApprovalIfMissing(ref)

  // Photos stored separately to avoid the 4MB body-size limit on deed_repairs_v2 sync
  const storedPhotos = await loadStoredPhotos(ref)

  // 1. Static demo data + registered in-memory repairs
  const found = getPortalRepair(ref)
  if (found) {
    return storedPhotos.length > 0 ? { ...found, issuePhotos: storedPhotos } : found
  }

  // 2. Fall back to live ERP repairs in server-store
  // Note: store key is deed_repairs_v2 (legacy key was deed_repairs)
  try {
    const state = await loadAppState()
    const repairs = (state['deed_repairs_v2'] ?? state['deed_repairs'] ?? []) as RepairOrder[]
    const decoded = decodeURIComponent(ref)
    const erp = repairs.find(r => r.ref.toLowerCase() === decoded.toLowerCase())
    if (erp) {
      const portal = erpToPortal(erp)
      return storedPhotos.length > 0 ? { ...portal, issuePhotos: storedPhotos } : portal
    }
  } catch {}

  return null
}
