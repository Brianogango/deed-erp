import { describe, expect, it } from 'vitest'
import { assertSaleOrderReconfigAllowsDelivery } from '@/lib/reconfiguration/sales-bridge'

describe('assertSaleOrderReconfigAllowsDelivery', () => {
  it('never blocks sales delivery on reconfiguration', async () => {
    await expect(assertSaleOrderReconfigAllowsDelivery(null)).resolves.toEqual({ ok: true })
    await expect(assertSaleOrderReconfigAllowsDelivery('so-1')).resolves.toEqual({ ok: true })
  })
})
