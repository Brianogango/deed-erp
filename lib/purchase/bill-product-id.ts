/**
 * The product id to put on a vendor-bill line.
 *
 * A PO line keeps the product id it was created with. If that product was
 * since recreated or merged, the id no longer exists and the database rejects
 * the bill (`invoice_items_product_id_fkey`). Prefer the line's own id when the
 * catalogue still has it; otherwise use the one product with the same name; if
 * that is ambiguous or absent, leave the id off — the bill line still carries
 * its description and the PO line link.
 */
export function resolveBillProductId(
  line: { productId?: string | null; productName?: string | null },
  products: ReadonlyArray<{ id: string; name?: string | null }>,
): string | undefined {
  const own = String(line.productId ?? '').trim()
  if (own && products.some(p => p.id === own)) return own

  const name = String(line.productName ?? '').trim().toLowerCase()
  if (!name) return undefined
  const sameName = products.filter(p => String(p.name ?? '').trim().toLowerCase() === name)
  return sameName.length === 1 ? sameName[0].id : undefined
}
