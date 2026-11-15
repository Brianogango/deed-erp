import { isSlimRow, SLIM_MARK } from '@/lib/store-slim'
import { loadFullRecord } from '@/lib/full-record'
import { now } from './ids'
import type { RepairOrder } from './repairs'

/**
 * Mirror a repair to the customer portal. Best-effort: the portal copy is a
 * read-only view, so a failed push is never allowed to break the ERP write
 * that triggered it.
 */
export function syncRepairToPortal(input: RepairOrder, historyNote?: string) {
  // A finished repair's list row is slimmed (lib/store-slim.ts): the portal
  // copy must carry the real diagnosis log, so fetch the full row first and
  // overlay this change on it.
  if (isSlimRow(input)) {
    void loadFullRecord('deed_repairs_v2', String(input.id)).then(full => {
      const { [SLIM_MARK]: _mark, qcItems: _qc, statusHistory: _sh, diagnosisHistory: _dh, ...changes } = input as any
      syncRepairToPortal({ ...(full ?? {}), ...changes, ...(full ? {} : { diagnosisHistory: undefined }) } as RepairOrder, historyNote)
    })
    return
  }
  const r = input
  const portalRepair = {
    ref: r.ref,
    status: r.status,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    productName: r.productName,
    serialNumber: r.serialNumber ?? '',
    deviceCondition: r.deviceCondition,
    intakeChannel: r.intakeChannel,
    intakeDate: r.intakeDate,
    estimatedCompletionDate: r.estimatedCompletionDate,
    issueDescription: r.issueDescription ?? r.description ?? '',
    accessories: r.accessories ?? [],
    assignedTechnicianName: r.assignedTechnicianName || r.technicianName || undefined,
    repairPath: r.repairPath === 'direct_repair' ? 'direct_repair' : 'diagnosis_first',
    deviceTier: r.deviceTier === 'high_end' ? 'high_end' : r.deviceTier === 'regular' ? 'regular' : undefined,
    diagnosisFee: r.diagnosisFee,
    diagnosisFeeStatus: r.diagnosisFeeStatus,
    diagnosisFeeBilling: r.diagnosisFeeBilling,
    customerBillingType: r.customerBillingType,
    diagnosisFeePaidAt: r.diagnosisFeePaidAt,
    billingExempt: r.billingExempt,
    warrantyCoverage: r.warrantyCoverage,
    diagnosisStopped: r.diagnosisStopped,
    liabilityWaiverAccepted: r.liabilityWaiverAccepted,
    liabilityWaiverAcceptedAt: r.liabilityWaiverAcceptedAt,
    diagnosis: r.diagnosis ? {
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
    } : undefined,
    diagnosisHistory: (r.diagnosisHistory?.length ? r.diagnosisHistory : r.diagnosis ? [r.diagnosis] : []).map(d => ({
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
    quote: r.quote ? {
      lines: r.quote.lines.map(l => ({ id: l.id, type: l.type as 'part' | 'labor' | 'logistics' | 'software' | 'license' | 'service', description: l.description, qty: l.qty, unitPrice: l.unitPrice, subtotal: l.subtotal, lineDecision: l.decision })),
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
    } : undefined,
    statusHistory: [{ status: r.status as any, date: now(), note: historyNote }],
    repairStartDate: r.repairStartDate,
    slaMissed: r.slaMissed ?? false,
    underWarranty: r.underWarranty ?? false,
    notes: r.notes,
    preRepairPhotos: r.preRepairPhotos,
    qcReportData: r.qcReportData,
    qcReportName: r.qcReportName,
    qcReportUrl: r.qcReportUrl,
    qcReportId: r.qcReportId,
    qcReportSize: r.qcReportSize,
    qcReportType: r.qcReportType,
    qcReportUploadedAt: r.qcReportUploadedAt,
    issuePhotos: r.issuePhotos,
    diagnosisReportData: r.diagnosisReportData,
    diagnosisReportName: r.diagnosisReportName,
    diagnosisReportUrl: r.diagnosisReportUrl,
  }
  fetch('/api/portal/repair/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repair: portalRepair }),
  }).catch(() => { /* silent — portal sync is best-effort */ })
}
