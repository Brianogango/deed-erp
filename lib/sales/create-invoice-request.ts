/**
 * Ask the server to bill a Sales Order, recovering an order that never
 * reached it.
 *
 * Repair billing mints the Sales Order in the browser and pushes it with a
 * fire-and-forget POST. When that POST never landed — a dropped request, a
 * browser that could not save — the order exists only in that browser, and
 * every invoice attempt answers "Sale order not found" with a finished repair
 * stuck behind it. A 404 is therefore not the end: push the local copy, then
 * bill it.
 */
export type CreateInvoiceAttempt = {
  res: Response
  /** The id that was billed — the server may mint its own for a legacy id. */
  saleOrderId: string
  recovered: boolean
}

export async function requestSaleOrderInvoice(input: {
  saleOrderId: string
  invoiceBody: unknown
  /** The browser's copy of the order, used only if the server does not have it. */
  localOrder?: unknown
  fetchImpl?: typeof fetch
}): Promise<CreateInvoiceAttempt> {
  const doFetch = input.fetchImpl ?? fetch
  const bill = (orderId: string) => doFetch(`/api/sale-orders/${orderId}/create-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input.invoiceBody),
  })

  const first = await bill(input.saleOrderId)
  if (first.status !== 404 || !input.localOrder) {
    return { res: first, saleOrderId: input.saleOrderId, recovered: false }
  }

  const created = await doFetch('/api/sale-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input.localOrder),
  })
  if (!created.ok) return { res: first, saleOrderId: input.saleOrderId, recovered: false }

  const body = await created.json().catch(() => null) as { id?: string; item?: { id?: string } } | null
  const serverId = body?.id ?? body?.item?.id ?? input.saleOrderId
  const retry = await bill(serverId)
  return { res: retry, saleOrderId: serverId, recovered: true }
}
