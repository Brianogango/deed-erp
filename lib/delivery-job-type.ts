import type { DeliveryJobType } from '@/lib/store'

/** Human labels for delivery job types (list filters, badges, job sheet). */
export const DELIVERY_JOB_TYPE_LABELS: Record<DeliveryJobType, string> = {
  repair_pickup: 'Repair Pickup',
  repair_dropoff: 'Repair Drop-off',
  sales_delivery: 'Sales Delivery',
  general: 'General',
}

/** Types that may optionally link to an SO / repair document in the create modal. */
export function deliveryJobTypeUsesDocumentLink(type: DeliveryJobType): boolean {
  return type === 'sales_delivery' || type === 'repair_dropoff'
}

/** Ad-hoc trips: no SO / repair / invoice; company-paid rider fee; no stock/DN. */
export function isGeneralDeliveryJob(type: DeliveryJobType): boolean {
  return type === 'general'
}
