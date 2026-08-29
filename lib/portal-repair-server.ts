import 'server-only'
import { getPortalRepair, approvalDecisions, type PortalRepair, type PortalRepairStatus } from './portal-repairs'
import { resolvePortalPaymentStatus } from './portal-payment'
import { findRepairLinkedInvoice } from './portal-invoice-link'
import { loadAppState } from './server-store'
import type { RepairOrder } from './repair-types'
import { portalDiagnosisFeeFields } from './diagnosis-fee'
import { collectStoredRepairRefAliases, findRepairByPortalRef, normalizePortalRepairRef } from './repair-ref'
import { findRepairInPrisma } from './repair-mirror'

async function loadStoredPhotos(repair: { ref?: unknown; previousRefs?: unknown }, requestedRef?: string): Promise<{ url: string; name: string; date: string }[]> {
  const aliases = collectStoredRepairRefAliases({
    ref: repair.ref,
    previousRefs: [
      ...(Array.isArray(repair.previousRefs) ? repair.previousRefs : []),
      requestedRef,
    ],
  })
  const photos: { url: string; name: string; date: string }[] = []
  const seen = new Set<string>()
  for (const alias of aliases) {
    try {
      const key = `repair_photos_${normalizePortalRepairRef(alias).toUpperCase().replace(/\//g, '_')}`
      const state = await loadAppState([key])
      const rows = state[key]
      if (!Array.isArray(rows)) continue
      for (const photo of rows) {
        const url = String(photo?.url ?? '')
        if (!url || seen.has(url)) continue
        seen.add(url)
        photos.push({ url, name: photo.name ?? '', date: photo.uploaded_at ?? '' })
      }
    } catch { /* ignore missing photo blobs */ }
  }
  return photos
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
    previousRefs: Array.isArray(r.previousRefs) ? r.previousRefs.map(String) : undefined,
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
    ...portalDiagnosisFeeFields(r),
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
    diagnosisReportUrl: (r as any).diagnosisReportUrl,
    invoiceId: r.invoiceId ?? (r as any).linkedInvoiceId,
    invoiceRef: (r as any).linkedInvoiceRef ?? linkedInvoice?.ref ?? linkedInvoice?.invoiceNumber,
    invoiceTotal: linkedInvoice ? Number(linkedInvoice.total ?? linkedInvoice.totalAmount ?? 0) : undefined,
    // While a revised quote awaits re-approval, do not map a prior confirmation
    // to paid/auto_paid — that would show "Payment confirmed" next to approval.
    // paymentAmount still carries the actual amount previously paid.
    paymentStatus: resolvePortalPaymentStatus({
      status: r.status,
      changeSummary: r.quote?.changeSummary,
      paymentConfirmationStatus: r.paymentConfirmationStatus,
      invoiceAmountPaid: linkedInvoice ? Number(linkedInvoice.amountPaid ?? 0) : r.paymentConfirmationAmount,
      invoiceTotal: linkedInvoice ? Number(linkedInvoice.total ?? linkedInvoice.totalAmount ?? 0) : r.quote?.total,
    }),
    paymentAmount: linkedInvoice
      ? Number(linkedInvoice.amountPaid ?? 0)
      : (r.paymentConfirmationAmount != null ? Number(r.paymentConfirmationAmount) : undefined),
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
  const decoded = normalizePortalRepairRef(ref)
  await restoreApprovalIfMissing(decoded)

  try {
    // Phase 2a: the relational table carries the full job in payload.
    const fromPrisma = await findRepairInPrisma(decoded)
    if (fromPrisma) {
      await restoreApprovalIfMissing(fromPrisma.ref ?? decoded)
      const storedPhotos = await loadStoredPhotos(fromPrisma, decoded)
      const state = await loadAppState(['deed_invoices'])
      const invoices = (state['deed_invoices'] ?? []) as any[]
      const linkedInvoice = findRepairLinkedInvoice(invoices, fromPrisma as any)
      const portal = erpToPortal(fromPrisma as RepairOrder, linkedInvoice)
      return storedPhotos.length > 0 ? { ...portal, issuePhotos: storedPhotos } : portal
    }

    const state = await loadAppState(['deed_repairs_v2', 'deed_repairs', 'deed_invoices'])
    const repairs = (state['deed_repairs_v2'] ?? state['deed_repairs'] ?? []) as RepairOrder[]
    const invoices = (state['deed_invoices'] ?? []) as any[]
    const erp = findRepairByPortalRef(repairs, decoded)
    if (erp) {
      await restoreApprovalIfMissing(erp.ref)
      const storedPhotos = await loadStoredPhotos(erp, decoded)
      const linkedInvoice = findRepairLinkedInvoice(invoices, erp as any)
      const portal = erpToPortal(erp, linkedInvoice)
      return storedPhotos.length > 0 ? { ...portal, issuePhotos: storedPhotos } : portal
    }
  } catch {}

  const storedPhotos = await loadStoredPhotos({ ref: decoded }, decoded)
  const found = getPortalRepair(decoded)
  if (found) {
    return storedPhotos.length > 0 ? { ...found, issuePhotos: storedPhotos } : found
  }

  return null
}
