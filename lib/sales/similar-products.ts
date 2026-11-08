/**
 * Quote line product search helpers: close matches when the exact search finds
 * nothing ("hp 840 g5" → "HP EliteBook 840 G5 i5 8GB"), and who may create a
 * product from a quote. Pure.
 */

/** Same roles the products API lets create products. */
export const PRODUCT_CREATE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead'] as const
export const canCreateProductFromSales = (role?: string | null) => (PRODUCT_CREATE_ROLES as readonly string[]).includes(String(role ?? ''))

const words = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)

type P = { id: string; name: string; sku?: string; isActive?: boolean }

/**
 * Products sharing most of the typed words (a word matches the start of a
 * product word, so "eli" finds "EliteBook"). Best first.
 */
export function similarProducts<T extends P>(products: T[], query: string, limit = 5): T[] {
  const q = words(query).filter(w => w.length >= 2 || /\d/.test(w))
  if (!q.length) return []
  const need = q.length <= 2 ? 1 : Math.ceil(q.length / 2)
  return products
    .filter(p => p.isActive !== false)
    .map(p => {
      const pw = [...words(p.name), ...words(p.sku ?? '')]
      const hits = q.filter(w => pw.some(x => x.startsWith(w) || (w.length >= 4 && x.includes(w)))).length
      return { p, hits }
    })
    .filter(r => r.hits >= need)
    .sort((a, b) => b.hits - a.hits || a.p.name.length - b.p.name.length)
    .slice(0, limit)
    .map(r => r.p)
}

/** True when a product with this exact name (ignoring case and spacing) exists. */
export const hasExactProduct = (products: P[], name: string) => {
  const key = words(name).join(' ')
  return Boolean(key) && products.some(p => words(p.name).join(' ') === key)
}
