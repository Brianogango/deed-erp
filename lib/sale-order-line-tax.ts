/**
 * Resolve the tax rate for a quotation line when adding / merging a product.
 *
 * The Add Product modal always passes an explicit rate (0 or company VAT).
 * That value is authoritative — catalog product.taxRate must not override an
 * unchecked VAT box, and re-adding the same product with VAT checked must
 * upgrade a previously zero-rated merged line (qty-only merge used to drop it).
 */
export function resolveAddSaleOrderLineTaxRate(opts: {
  explicitTaxRate?: number | null
  existingTaxRate?: number | null
  merging?: boolean
}): number {
  const explicit = Math.max(0, Number(opts.explicitTaxRate) || 0)
  if (opts.merging) {
    if (explicit > 0) return explicit
    return Math.max(0, Number(opts.existingTaxRate) || 0)
  }
  return explicit
}
