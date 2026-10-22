import { describe, expect, it } from 'vitest'
import { buildSaleOrderItemsNestedWrite, lineSerialIds } from '@/lib/sale-order-items-write'

const ids = Array.from({ length: 15 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
const line = (o: Record<string, any> = {}) => ({ id: 'a0000000-0000-4000-8000-000000000001', productId: 'b0000000-0000-4000-8000-000000000001', description: 'Laptop', qty: 15, unitPrice: 30000, taxRate: 0, ...o })

describe('sale order line serials', () => {
  it('keeps all 15 serials of a 15-laptop line, not just the first', () => {
    const write = buildSaleOrderItemsNestedWrite([line({ serialIds: ids })], [{ id: line().id, serialIds: [], serialNumberId: null }])
    expect(write.update?.[0].data.serialIds).toEqual(ids)
    expect(write.update?.[0].data.serialNumberId).toBe(ids[0])
  })

  it('never more serials than the line quantity, no duplicates', () => {
    expect(lineSerialIds({ serialIds: [ids[0], ids[0], ids[1], ids[2]] }, null, 2)).toEqual([ids[0], ids[1]])
  })

  it('a save that sends no serials keeps the ones already on the line', () => {
    const write = buildSaleOrderItemsNestedWrite([line()], [{ id: line().id, serialIds: ids.slice(0, 3), serialNumberId: ids[0] }])
    expect(write.update?.[0].data.serialIds).toEqual(ids.slice(0, 3))
  })

  it('removing every serial clears the line, including the first-serial link', () => {
    const write = buildSaleOrderItemsNestedWrite([line({ serialIds: [] })], [{ id: line().id, serialIds: ids.slice(0, 3), serialNumberId: ids[0] }])
    expect(write.update?.[0].data.serialIds).toEqual([])
    expect(write.update?.[0].data.serialNumberId).toBeNull()
  })

  it('older lines with only the single serial link still carry it', () => {
    expect(lineSerialIds({}, { serialIds: [], serialNumberId: ids[4] }, 3)).toEqual([ids[4]])
  })
})
