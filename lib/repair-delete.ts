export type RepairDeleteLike = {
  status?: string
  invoiceId?: string
  linkedInvoiceId?: string
  deliveryJobId?: string
  deliveryActualDate?: string
  retainedBuyBackId?: string
  retainedDonationId?: string
  warrantyClaimId?: string
  diagnosisFeeStatus?: string
  diagnosisFeePaidAt?: string
  paymentConfirmationStatus?: string
}

const AUDIT_SIGNIFICANT_STATUSES = new Set([
  'invoiced',
  'verified_released',
  'delivered',
  'closed',
])

/**
 * Hard delete is reserved for erroneous/test/duplicate repair records.
 * Once a repair has produced financially or operationally significant
 * downstream records, preserve the audit trail and cancel/close instead.
 */
export function repairHardDeleteBlocker(repair: RepairDeleteLike): string | null {
  const status = String(repair.status ?? '')
  if (AUDIT_SIGNIFICANT_STATUSES.has(status)) {
    return `This repair is ${status.replace(/_/g, ' ')} and must be cancelled/closed instead of deleted.`
  }
  if (repair.invoiceId || repair.linkedInvoiceId) {
    return 'This repair has a linked invoice. Remove/reverse the invoice relationship before deleting the repair.'
  }
  if (repair.deliveryJobId || repair.deliveryActualDate) {
    return 'This repair has delivery/handover history and cannot be hard-deleted.'
  }
  if (repair.retainedBuyBackId || repair.retainedDonationId) {
    return 'This repair has a linked trade-in/buy-back or donation record and cannot be hard-deleted.'
  }
  if (repair.warrantyClaimId) {
    return 'This repair has a linked warranty claim and cannot be hard-deleted.'
  }
  if (repair.diagnosisFeePaidAt || ['paid', 'invoiced'].includes(String(repair.diagnosisFeeStatus ?? ''))) {
    return 'This repair has diagnosis-fee financial history and cannot be hard-deleted.'
  }
  if (['approved', 'confirmed', 'paid'].includes(String(repair.paymentConfirmationStatus ?? '').toLowerCase())) {
    return 'This repair has confirmed payment activity and cannot be hard-deleted.'
  }
  return null
}
