import { describe, it, expect, vi } from 'vitest'
import { requestSaleOrderInvoice } from '@/lib/sales/create-invoice-request'

/**
 * REGRESSION 24-Sep-2026 — a finished repair (REP-NLGR8EBA) could not be
 * billed: "Sale order not found". Its Sales Order was minted in the browser
 * and pushed fire-and-forget; that POST never landed, so the order existed
 * only in that browser and every invoice attempt 404'd.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const SO = 'so-1'
const localOrder = { id: SO, ref: 'SO/2026/0191', lines: [] }

describe('requestSaleOrderInvoice', () => {
  it('bills directly when the server knows the order', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ invoice: { id: 'inv-1' } }))
    const out = await requestSaleOrderInvoice({ saleOrderId: SO, invoiceBody: {}, localOrder, fetchImpl: fetchImpl as any })
    expect(out.recovered).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(out.res.status).toBe(200)
  })

  it('pushes the browser copy and retries when the server has never seen it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: 'Sale order not found' }, 404))
      .mockResolvedValueOnce(json({ id: SO, ref: 'SO/2026/0191' }, 201))
      .mockResolvedValueOnce(json({ invoice: { id: 'inv-1' } }))
    const out = await requestSaleOrderInvoice({ saleOrderId: SO, invoiceBody: {}, localOrder, fetchImpl: fetchImpl as any })
    expect(out.recovered).toBe(true)
    expect(out.saleOrderId).toBe(SO)
    expect(out.res.status).toBe(200)
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/sale-orders')
  })

  it('follows the id the server minted for a legacy local one', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: 'Sale order not found' }, 404))
      .mockResolvedValueOnce(json({ id: 'server-uuid' }, 201))
      .mockResolvedValueOnce(json({ invoice: { id: 'inv-1' } }))
    const out = await requestSaleOrderInvoice({ saleOrderId: 'legacy-7', invoiceBody: {}, localOrder, fetchImpl: fetchImpl as any })
    expect(out.saleOrderId).toBe('server-uuid')
    expect(fetchImpl.mock.calls[2][0]).toBe('/api/sale-orders/server-uuid/create-invoice')
  })

  it('keeps the original error when the order cannot be created either', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: 'Sale order not found' }, 404))
      .mockResolvedValueOnce(json({ error: 'Forbidden' }, 403))
    const out = await requestSaleOrderInvoice({ saleOrderId: SO, invoiceBody: {}, localOrder, fetchImpl: fetchImpl as any })
    expect(out.recovered).toBe(false)
    expect(out.res.status).toBe(404)
  })

  it('does not invent an order when the browser has no copy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'Sale order not found' }, 404))
    const out = await requestSaleOrderInvoice({ saleOrderId: SO, invoiceBody: {}, fetchImpl: fetchImpl as any })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(out.res.status).toBe(404)
  })

  it('leaves other failures alone — only a missing order is recovered', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'Nothing to invoice' }, 409))
    const out = await requestSaleOrderInvoice({ saleOrderId: SO, invoiceBody: {}, localOrder, fetchImpl: fetchImpl as any })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(out.res.status).toBe(409)
  })
})
