import { describe, expect, it } from 'vitest'
import type { DeliveryJobType } from '@/lib/store'
import {
  DELIVERY_JOB_TYPE_LABELS,
  deliveryJobTypeUsesDocumentLink,
  isGeneralDeliveryJob,
} from '@/lib/delivery-job-type'

const ALL_TYPES: DeliveryJobType[] = [
  'repair_pickup',
  'repair_dropoff',
  'sales_delivery',
  'general',
]

describe('delivery job types', () => {
  it('labels every DeliveryJobType including general', () => {
    expect(Object.keys(DELIVERY_JOB_TYPE_LABELS).sort()).toEqual([...ALL_TYPES].sort())
    expect(DELIVERY_JOB_TYPE_LABELS.general).toBe('General')
  })

  it('only sales and repair drop-off use document link pickers', () => {
    expect(deliveryJobTypeUsesDocumentLink('sales_delivery')).toBe(true)
    expect(deliveryJobTypeUsesDocumentLink('repair_dropoff')).toBe(true)
    expect(deliveryJobTypeUsesDocumentLink('repair_pickup')).toBe(false)
    expect(deliveryJobTypeUsesDocumentLink('general')).toBe(false)
  })

  it('treats general as ad-hoc (no document link)', () => {
    expect(isGeneralDeliveryJob('general')).toBe(true)
    expect(isGeneralDeliveryJob('sales_delivery')).toBe(false)
  })
})
