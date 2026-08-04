import type { DeliveryJob, Invoice } from '@/lib/store'

/** Active (non-cancelled/failed) delivery job linked to an invoice. */
export function findInvoiceDeliveryJob(
  jobs: DeliveryJob[],
  invoice: Pick<Invoice, 'id' | 'deliveryJobId'>,
): DeliveryJob | undefined {
  if (invoice.deliveryJobId) {
    const byId = jobs.find(j => j.id === invoice.deliveryJobId)
    if (byId && !['cancelled', 'failed'].includes(byId.status)) return byId
  }
  return jobs.find(j =>
    j.invoiceId === invoice.id && !['cancelled', 'failed'].includes(j.status),
  )
}

export function canScheduleInvoiceDelivery(
  invoice: Pick<Invoice, 'type' | 'status'>,
  existingJob?: DeliveryJob | null,
): boolean {
  if (invoice.type !== 'customer_invoice') return false
  if (invoice.status === 'cancelled') return false
  if (existingJob) return false
  return true
}
