import 'server-only'
import { getPortalRepair, approvalDecisions, type PortalRepair, type PortalRepairStatus } from './portal-repairs'
import { resolvePortalPaymentStatus } from './portal-payment'
import { loadAppState } from './server-store'
import type { RepairOrder } from './repair-types'
import {
  isDiagnosisFeeLine,
  normalizeQuoteWithDiagnosisFee,
  type DiagnosisFeeSettings,
} from './diagnosis-fee'

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

function erpToPortal(r: RepairOrder, linkedInvoice?: any, settings?: DiagnosisFeeSettings | null): PortalRepair {
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
    repairPath: r.repairPath === 'direct_repair' ? 'direct_repair' : r.repairPath === 'diagnosis_first' ? 'diagnosis_first' : undefined,
    deviceTier: r.deviceTier === 'high_end' ? 'high_end' : r.deviceTier === 'regular' ? 'regular' : undefined,
    diagnosisFee: r.diagnosisFee,
    diagnosisFeeStatus: r.diagnosisFeeStatus as PortalRepair['diagnosisFeeStatus'],
    diagnosisStopped: r.diagnosisStopped,
    liabilityWaiverAccepted: r.liabilityWaiverAccepted,
    liabilityWaiverAcceptedAt: r.liabilityWaiverAcceptedAt,
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
      ? (() => {
          const applyVat = Number(r.quote.tax) > 0
          // Prefer company VAT from linked invoice tax pattern; portal totals use stored quote tax flag.
          const vatRatePercent = applyVat && Number(r.quote.subtotal) > 0
            ? Math.round((Number(r.quote.tax) / Math.max(1, Number(r.quote.subtotal) - Number(r.quote.tax))) * 100) || 16
            : 16
          // Safer: if tax was computed on taxable-only base, derive rate from non-fee subtotal.
          const nonFeeSubtotal = (r.quote.lines || [])
            .filter(l => !isDiagnosisFeeLine(l))
            .reduce((s, l) => s + (Number(l.subtotal) || 0), 0)
          const derivedVat = applyVat && nonFeeSubtotal > 0
            ? (Number(r.quote.tax) / nonFeeSubtotal) * 100
            : 16
          const normalized = normalizeQuoteWithDiagnosisFee(
            (r.quote.lines || []).map(l => ({
              ...l,
              isDiagnosisFee: !!(l as any).isDiagnosisFee || isDiagnosisFeeLine(l),
            })),
            {
              repairPath: r.repairPath,
              intakeDate: r.intakeDate,
              diagnosisFee: r.diagnosisFee,
              diagnosisFeeStatus: r.diagnosisFeeStatus,
              diagnosisFeePaidAt: r.diagnosisFeePaidAt,
              underWarranty: r.underWarranty,
              warrantyCoverage: (r as any).warrantyCoverage,
              billingExempt: (r as any).billingExempt,
              customerBillingType: (r as any).customerBillingType,
            },
            settings,
            { applyVat, vatRatePercent: derivedVat || vatRatePercent },
          )
          return {
            lines: normalized.lines.map(l => ({
              id: String(l.id ?? ''),
              type: (l.type || 'service') as 'part' | 'labor' | 'logistics' | 'software' | 'license' | 'service',
              description: String(l.description ?? ''),
              qty: Number(l.qty) || 0,
              unitPrice: Number(l.unitPrice) || 0,
              subtotal: Number(l.subtotal) || 0,
              lineDecision: (l as any).decision ?? (l as any).lineDecision,
              isDiagnosisFee: isDiagnosisFeeLine(l),
            })),
            subtotal: normalized.subtotal,
            tax: normalized.tax,
            total: normalized.total,
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
        })()
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
  // Restore persisted approval decision to in-memory map if this is a fresh server process
  await restoreApprovalIfMissing(ref)

  // Photos stored separately to avoid the 4MB body-size limit on deed_repairs_v2 sync
  const storedPhotos = await loadStoredPhotos(ref)

  // 1. Prefer the LIVE ERP record (deed_repairs_v2) so the portal always shows
  //    the current status. The in-memory registry only holds a snapshot pushed
  //    by the staff app and can go stale, so it must not shadow live data.
  //    deed_invoices is loaded alongside so the payment prompt/amount populate.
  try {
    const state = await loadAppState(['deed_repairs_v2', 'deed_repairs', 'deed_invoices', 'deed_systemSettings'])
    const repairs = (state['deed_repairs_v2'] ?? state['deed_repairs'] ?? []) as RepairOrder[]
    const invoices = (state['deed_invoices'] ?? []) as any[]
    const settings = (state['deed_systemSettings'] ?? null) as DiagnosisFeeSettings | null
    const decoded = decodeURIComponent(ref)
    const erp = repairs.find(r => r.ref.toLowerCase() === decoded.toLowerCase())
    if (erp) {
      const invoiceKey = erp.invoiceId ?? (erp as any).linkedInvoiceId
      const linkedInvoice = invoices.find(inv => inv.id === invoiceKey || inv.ref === (erp as any).linkedInvoiceRef || inv.invoiceNumber === (erp as any).linkedInvoiceRef)
      const portal = erpToPortal(erp, linkedInvoice, settings)
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
