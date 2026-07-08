import 'server-only'
import { getPortalRepair, approvalDecisions, type PortalRepair, type PortalRepairStatus } from './portal-repairs'
import { loadAppState } from './server-store'
import type { RepairOrder } from './repair-types'

async function loadStoredPhotos(ref: string): Promise<{ url: string; name: string; date: string }[]> {
  try {
    const key = `repair_photos_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
    const state = await loadAppState([key])
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
    const state = await loadAppState([`portal_approval_${key}`])
    const stored = state[`portal_approval_${key}`]
    if (stored) {
      const d = typeof stored === 'string' ? JSON.parse(stored) : stored
      // null stored value means the decision was cleared (e.g. quote was revised)
      if (d && typeof d.approved === 'boolean') {
        approvalDecisions.set(key, { approved: d.approved, reason: d.reason, date: d.date })
      }
    }
  } catch { /* ignore DB errors */ }
}

function erpToPortal(r: RepairOrder, linkedInvoice?: any): PortalRepair {
  const statusHistory: PortalRepair['statusHistory'] = []
  if (r.intakeDate) statusHistory.push({ status: 'received', date: r.intakeDate })
  if (r.assignedDate) statusHistory.push({ status: 'assigned', date: r.assignedDate, note: r.assignedTechnicianName ? `Assigned to ${r.assignedTechnicianName}` : undefined })
  const diagnosisHistory = (r.diagnosisHistory?.length ? r.diagnosisHistory : r.diagnosis ? [r.diagnosis] : [])
  diagnosisHistory.forEach((d: any) => {
    if (d.diagnosedDate) statusHistory.push({ status: 'diagnosed', date: d.diagnosedDate, note: d.revision && d.revision > 1 ? `Diagnosis update #${d.revision}` : 'Diagnosis completed' })
  })
  if (r.quote?.sentDate) statusHistory.push({ status: 'awaiting_approval', date: r.quote.sentDate, note: 'Quote sent to customer' })
  if (r.quote?.approvedDate) statusHistory.push({ status: 'approved', date: r.quote.approvedDate })
  if (r.repairStartDate) statusHistory.push({ status: 'in_repair', date: r.repairStartDate })
  if (r.qcPassedDate) statusHistory.push({ status: 'qc', date: r.qcPassedDate })
  if ((r as any).collectedDate) statusHistory.push({ status: 'collected', date: (r as any).collectedDate, note: 'Device collected by customer/representative' })
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
          id: r.diagnosis.id,
          revision: r.diagnosis.revision,
          revisionType: r.diagnosis.revisionType,
          revisionReason: r.diagnosis.revisionReason,
          findings: r.diagnosis.findings,
          faultDescription: r.diagnosis.faultDescription,
          recommendedAction: r.diagnosis.recommendedAction,
          estimatedHours: r.diagnosis.estimatedHours,
          diagnosedBy: r.diagnosis.diagnosedBy,
          diagnosedDate: r.diagnosis.diagnosedDate,
        }
      : undefined,
    diagnosisHistory: diagnosisHistory.map((d: any) => ({
      id: d.id,
      revision: d.revision,
      revisionType: d.revisionType,
      revisionReason: d.revisionReason,
      findings: d.findings,
      faultDescription: d.faultDescription,
      recommendedAction: d.recommendedAction,
      estimatedHours: d.estimatedHours,
      diagnosedBy: d.diagnosedBy,
      diagnosedDate: d.diagnosedDate,
    })),
    quote: r.quote
      ? {
          lines: r.quote.lines.map(l => ({
            id: l.id,
            type: l.type,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            subtotal: l.subtotal,
            lineDecision: l.decision,
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
          partiallyApproved: r.quote.partiallyApproved,
          approvedTotal: r.quote.approvedTotal,
          changeSummary: r.quote.changeSummary,
          prevTotal: r.quote.prevTotal,
          diagnosisRevision: r.quote.diagnosisRevision,
          diagnosisFaultSummary: r.quote.diagnosisFaultSummary,
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
    qcReportUrl: (r as any).qcReportUrl,
    qcReportId: (r as any).qcReportId,
    qcReportSize: (r as any).qcReportSize,
    qcReportType: (r as any).qcReportType,
    qcReportUploadedAt: (r as any).qcReportUploadedAt,
    diagnosisReportData: r.diagnosisReportData,
    diagnosisReportName: r.diagnosisReportName,
    invoiceId: r.invoiceId ?? (r as any).linkedInvoiceId,
    invoiceRef: (r as any).linkedInvoiceRef ?? linkedInvoice?.ref ?? linkedInvoice?.invoiceNumber,
    invoiceTotal: linkedInvoice ? Number(linkedInvoice.total ?? linkedInvoice.totalAmount ?? 0) : undefined,
    paymentStatus: r.paymentConfirmationStatus === 'auto_paid' ? 'auto_paid'
      : r.paymentConfirmationStatus === 'confirmed' ? 'paid'
      : r.paymentConfirmationStatus ?? (linkedInvoice && Number(linkedInvoice.amountPaid ?? 0) >= Number(linkedInvoice.total ?? linkedInvoice.totalAmount ?? 0) ? 'paid' : 'unpaid'),
    paymentAmount: linkedInvoice ? Number(linkedInvoice.amountPaid ?? 0) : r.paymentConfirmationAmount,
    paymentReceiptNumber: r.paymentReceiptNumber,
    paymentConfirmationSubmittedAt: r.paymentConfirmationSubmittedAt,
  }

  // NOTE: no approval-decision overlay here. For live ERP repairs the record
  // itself already carries the true status (approved → awaiting_parts →
  // in_repair → qc → ready → …) and quote.approvedDate. Overlaying the stored
  // approval decision would pin the portal to "approved" forever and hide later
  // progress, so the payment prompt (which appears at ready/invoiced) never
  // shows. The overlay remains only on the static demo path in getPortalRepair.
  return portal
}

export async function lookupRepair(ref: string): Promise<PortalRepair | null> {
  // Restore persisted approval decision to in-memory map if this is a fresh server process
  await restoreApprovalIfMissing(ref)

  // Photos stored separately to avoid the 4MB body-size limit on deed_repairs_v2 sync
  const storedPhotos = await loadStoredPhotos(ref)

  // 1. Prefer the LIVE ERP record (deed_repairs_v2) so the portal always shows
  //    the current status. The in-memory registry only holds a snapshot pushed
  //    by the staff app and can go stale, so it must not shadow live data.
  //    deed_invoices is loaded alongside so the payment prompt/amount populate.
  try {
    const state = await loadAppState(['deed_repairs_v2', 'deed_repairs', 'deed_invoices'])
    const repairs = (state['deed_repairs_v2'] ?? state['deed_repairs'] ?? []) as RepairOrder[]
    const invoices = (state['deed_invoices'] ?? []) as any[]
    const decoded = decodeURIComponent(ref)
    const erp = repairs.find(r => r.ref.toLowerCase() === decoded.toLowerCase())
    if (erp) {
      const invoiceKey = erp.invoiceId ?? (erp as any).linkedInvoiceId
      const linkedInvoice = invoices.find(inv => inv.id === invoiceKey || inv.ref === (erp as any).linkedInvoiceRef || inv.invoiceNumber === (erp as any).linkedInvoiceRef)
      const portal = erpToPortal(erp, linkedInvoice)
      return storedPhotos.length > 0 ? { ...portal, issuePhotos: storedPhotos } : portal
    }
  } catch {}

  // 2. Fall back to the in-memory registry + static demo data for refs that are
  //    not present in the live store (e.g. demo repairs REP/0038–0040).
  const found = getPortalRepair(ref)
  if (found) {
    return storedPhotos.length > 0 ? { ...found, issuePhotos: storedPhotos } : found
  }

  return null
}
