/**
 * Which purchase-order lines a goods receipt fills.
 *
 * Lines were matched by product alone, so a PO with the same product on two
 * lines (two price tiers of one laptop model, say) had the whole received
 * quantity added to both — 3 received showed as 3 + 3 — and every unit was
 * costed at the first line's price. Received units now fill the lines in
 * order, each up to what is still outstanding on it, and the stock is costed
 * at the prices of the lines it actually filled.
 */

type PoLine = { id?: string; productId?: string | null; qty?: unknown; qtyReceived?: unknown; unitPrice?: unknown }
type ReceiptLine = { productId?: string | null; qtyReceived?: unknown; poLineId?: string | null }

const n = (v: unknown) => Math.max(0, Number(v) || 0)

export function allocateReceiptToPoLines<T extends PoLine>(poLines: T[], receiptLines: ReceiptLine[]): {
  lines: T[]
  /** Received beyond what the PO still has open, per product. */
  overReceived: Array<{ productId: string; qty: number }>
  /** Weighted unit cost of what this receipt brought in, per product. */
  unitCostByProduct: Map<string, number>
} {
  const lines = poLines.map(l => ({ ...l }))
  const open = (l: PoLine) => Math.max(0, n(l.qty) - n(l.qtyReceived))
  const cost = new Map<string, { qty: number; value: number }>()
  const over = new Map<string, number>()
  const book = (productId: string, qty: number, price: unknown) => {
    const c = cost.get(productId) ?? { qty: 0, value: 0 }
    c.qty += qty
    c.value += qty * n(price)
    cost.set(productId, c)
  }

  for (const r of receiptLines) {
    const productId = String(r.productId ?? '')
    let remaining = n(r.qtyReceived)
    if (!productId || remaining <= 0) continue
    // A receipt line that names its PO line fills that line first.
    const order = [
      ...lines.filter(l => r.poLineId && l.id === r.poLineId),
      ...lines.filter(l => String(l.productId ?? '') === productId && !(r.poLineId && l.id === r.poLineId)),
    ]
    for (const line of order) {
      if (remaining <= 0) break
      const take = Math.min(remaining, open(line))
      if (take <= 0) continue
      line.qtyReceived = n(line.qtyReceived) + take
      book(productId, take, line.unitPrice)
      remaining -= take
    }
    if (remaining > 0) {
      over.set(productId, (over.get(productId) ?? 0) + remaining)
      // Priced like the product's last line, so the stock still carries a cost.
      const last = [...lines].reverse().find(l => String(l.productId ?? '') === productId)
      book(productId, remaining, last?.unitPrice)
    }
  }

  const unitCostByProduct = new Map<string, number>()
  for (const [productId, c] of cost) unitCostByProduct.set(productId, c.qty > 0 ? Math.round((c.value / c.qty) * 100) / 100 : 0)
  return {
    lines,
    overReceived: [...over].map(([productId, qty]) => ({ productId, qty })),
    unitCostByProduct,
  }
}

type BillLine = { productId?: string | null; purchaseOrderItemId?: string | null; description?: string | null; qty?: unknown }

/**
 * Units already billed against each PO line. A bill line that names its PO
 * line counts there; an older one that only names a product (or a
 * description) fills that product's lines in order. Counting by product alone
 * made each of two same-product lines count the other's bills too, so goods
 * received and never billed could no longer be billed.
 */
export function billedQtyByPoLine(
  poLines: Array<{ id: string; productId?: string | null; productName?: string | null; qty?: unknown }>,
  billLines: BillLine[],
): Map<string, number> {
  const billed = new Map<string, number>(poLines.map(l => [l.id, 0]))
  const loose: BillLine[] = []
  for (const b of billLines) {
    if (b.purchaseOrderItemId && billed.has(b.purchaseOrderItemId)) {
      billed.set(b.purchaseOrderItemId, (billed.get(b.purchaseOrderItemId) ?? 0) + Math.floor(n(b.qty)))
    } else {
      loose.push(b)
    }
  }
  for (const b of loose) {
    let remaining = Math.floor(n(b.qty))
    const matches = poLines.filter(l =>
      (b.productId && l.productId && b.productId === l.productId)
      || (!b.productId && l.productName && String(b.description ?? '').includes(l.productName)))
    for (const l of matches) {
      if (remaining <= 0) break
      const room = Math.max(0, Math.floor(n(l.qty)) - (billed.get(l.id) ?? 0))
      const take = Math.min(room, remaining)
      billed.set(l.id, (billed.get(l.id) ?? 0) + take)
      remaining -= take
    }
    // Over-billed legacy lines land on the last match so they are not lost.
    if (remaining > 0 && matches.length) {
      const last = matches[matches.length - 1].id
      billed.set(last, (billed.get(last) ?? 0) + remaining)
    }
  }
  return billed
}
