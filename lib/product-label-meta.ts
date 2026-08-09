/**
 * Shared label meta helpers (no print CSS) — category, condition, specs truncation.
 */

export type ProductLabelCondition = 'new' | 'refurbished' | string | null | undefined

export type SerialLabelItem = {
  serial: string
  barcode?: string
  productName: string
  sku: string
  salePrice?: number
  category?: string
  /** Product master condition — New / Refurbished */
  productType?: ProductLabelCondition
  /** Unit specs e.g. "8GB RAM, 256GB SSD, i5-10th" */
  specs?: string
}

/** Short condition text for labels and catalogue chips. */
export function formatConditionLabel(productType?: ProductLabelCondition): string {
  const t = String(productType || '').toLowerCase()
  if (t === 'new') return 'NEW'
  if (t === 'refurbished') return 'REFURB'
  return ''
}

export function truncateLabelText(value: string, max: number): string {
  const s = String(value || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function categoryConditionLine(
  category?: string | null,
  productType?: ProductLabelCondition,
): string {
  const cat = String(category || '').trim()
  const cond = formatConditionLabel(productType)
  if (cat && cond) return `${cat} · ${cond}`
  return cat || cond || ''
}

export function resolveProductSpecs(product: {
  specs?: string | null
  description?: string | null
}): string {
  const fromProduct = String(product.specs || '').trim()
  if (fromProduct) return fromProduct
  return String(product.description || '').trim()
}
