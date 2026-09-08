import { isRepairNoCharge, type BillingExemptRepair } from '@/lib/repair-billing-exempt'
import type { DeliveryMethod } from '@/lib/repair-types'

export type RepairHandoverInput = BillingExemptRepair & {
  invoiceId?: string | null
  linkedInvoiceId?: string | null
  deliveryMethod?: DeliveryMethod | string | null
}

export type RepairHandoverFields = {
  status: 'delivered' | 'closed'
  deliveryActualDate: string
  deliveryMethod: DeliveryMethod
  deliveryRecipient: string
  deliveryRecipientPhone?: string
  deliveryRecipientIsRep?: boolean
  deliveryRecipientRelationship?: string
  deliveryRecipientIdNumber?: string
  closedDate?: string
}

export type RepairPrimaryActionId =
  | 'verify'
  | 'parts_arrived'
  | 'start'
  | 'complete'
  | 'qc'
  | 'invoice'
  | 'prepare_release'
  | 'collect'
  | 'close'
  | 'diagnose'
  | 'quote'
  | 'assign'

/** No-charge / warranty jobs, and jobs with no serial, should not be blocked on the ORC checkpoint. */
export function canCollectWithoutReleaseCheckpoint(opts: {
  noCharge?: boolean
  serialNumber?: string | null
}): boolean {
  if (opts.noCharge) return true
  return !String(opts.serialNumber ?? '').trim()
}

export function collectActionAvailable(opts: {
  canMarkCollected: boolean
  repairOrcStatus?: string | null
}): boolean {
  return opts.canMarkCollected && (!opts.repairOrcStatus || opts.repairOrcStatus === 'verified')
}

export function canCloseRepairAfterHandover(repair: RepairHandoverInput | null | undefined): boolean {
  if (!repair) return false
  return isRepairNoCharge(repair) || repairHasInvoiceLink(repair)
}

export function repairHasInvoiceLink(repair: {
  invoiceId?: string | null
  linkedInvoiceId?: string | null
} | null | undefined): boolean {
  if (!repair) return false
  return Boolean(String(repair.invoiceId ?? '').trim() || String(repair.linkedInvoiceId ?? '').trim())
}

export function shouldDefaultCloseAfterHandover(repair: RepairHandoverInput | null | undefined): boolean {
  return isRepairNoCharge(repair)
}

/**
 * Dominant repair-detail CTA. Collect beats Prepare release when the job is
 * no-charge or has no serial — otherwise the serial checkpoint hides handover.
 */
export function pickRepairPrimaryAction(flags: {
  canVerify?: boolean
  canMarkPartsArrived?: boolean
  canStart?: boolean
  canComplete?: boolean
  canPerformQA?: boolean
  canInvoice?: boolean
  canPrepareRelease?: boolean
  canMarkCollected?: boolean
  canCloseJob?: boolean
  canDiagnose?: boolean
  canUpdateDiagnosis?: boolean
  canQuote?: boolean
  canAssign?: boolean
  quoteDeclinedReopenable?: boolean
  noCharge?: boolean
  serialNumber?: string | null
  repairOrcStatus?: string | null
}): RepairPrimaryActionId | null {
  if (flags.canVerify) return 'verify'
  if (flags.canMarkPartsArrived) return 'parts_arrived'
  if (flags.canStart) return 'start'
  if (flags.canComplete) return 'complete'
  if (flags.canPerformQA) return 'qc'
  if (flags.canInvoice) return 'invoice'

  const collectAvailable = collectActionAvailable({
    canMarkCollected: !!flags.canMarkCollected,
    repairOrcStatus: flags.repairOrcStatus,
  })
  const skipCheckpoint = canCollectWithoutReleaseCheckpoint({
    noCharge: !!flags.noCharge,
    serialNumber: flags.serialNumber,
  })

  if (collectAvailable && skipCheckpoint) return 'collect'
  if (flags.canPrepareRelease) return 'prepare_release'
  if (collectAvailable) return 'collect'
  if (flags.canCloseJob) return 'close'
  if (flags.canDiagnose) return 'diagnose'
  if (flags.canUpdateDiagnosis && !flags.canQuote) return 'diagnose'
  if (flags.quoteDeclinedReopenable && flags.canQuote) return 'quote'
  if (flags.canQuote) return 'quote'
  if (flags.canAssign) return 'assign'
  return null
}

export function applyRepairHandover(
  repair: RepairHandoverInput,
  opts: {
    recipientName: string
    recipientPhone?: string
    isRep?: boolean
    repRelationship?: string
    repIdNumber?: string
    closeAfter?: boolean
    now: string
  },
): RepairHandoverFields {
  const close = !!opts.closeAfter && canCloseRepairAfterHandover(repair)
  const fields: RepairHandoverFields = {
    status: close ? 'closed' : 'delivered',
    deliveryActualDate: opts.now,
    deliveryMethod: (repair.deliveryMethod as DeliveryMethod) || 'pickup',
    deliveryRecipient: opts.recipientName,
    deliveryRecipientPhone: opts.recipientPhone || undefined,
    deliveryRecipientIsRep: opts.isRep || undefined,
    deliveryRecipientRelationship: opts.isRep ? opts.repRelationship : undefined,
    deliveryRecipientIdNumber: opts.repIdNumber || undefined,
  }
  if (close) fields.closedDate = opts.now
  return fields
}
