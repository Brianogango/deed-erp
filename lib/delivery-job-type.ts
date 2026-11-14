import type { DeliveryJobType } from '@/lib/store'

/** Human labels for delivery job types (list filters, badges, job sheet). */
export const DELIVERY_JOB_TYPE_LABELS: Record<DeliveryJobType, string> = {
  repair_pickup: 'Repair Pickup',
  repair_dropoff: 'Repair Drop-off',
  sales_delivery: 'Sales Delivery',
  general: 'General',
}

/** Ad-hoc trips: no SO / repair / invoice; company-paid rider fee; no stock/DN. */
export function isGeneralDeliveryJob(type: DeliveryJobType): boolean {
  return type === 'general'
}
