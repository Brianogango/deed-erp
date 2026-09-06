/** ERP product categories — safe to import from server routes (not from `lib/store`). */

export type CategoryId =
  | 'Laptops'
  | 'Accessories'
  | 'Desktops'
  | 'Complete Desktops'
  | 'Monitors'
  | 'Servers'
  | 'Power Backup Solutions'
  | 'Printers'
  | 'Software & Licences'
  | 'Parts & Components'
  | 'Printer Consumables'
  | 'Networking'
  | 'Consumer Electronics'
  | 'Mobile Devices'
  | 'Services'

export const CATEGORY_CONFIG: Record<CategoryId, { serialRequired: boolean; trackStock: boolean }> = {
  Laptops: { serialRequired: true, trackStock: true },
  Accessories: { serialRequired: false, trackStock: true },
  Desktops: { serialRequired: true, trackStock: true },
  'Complete Desktops': { serialRequired: true, trackStock: true },
  Monitors: { serialRequired: true, trackStock: true },
  Servers: { serialRequired: true, trackStock: true },
  'Power Backup Solutions': { serialRequired: true, trackStock: true },
  Printers: { serialRequired: true, trackStock: true },
  'Software & Licences': { serialRequired: false, trackStock: false },
  'Parts & Components': { serialRequired: false, trackStock: true },
  'Printer Consumables': { serialRequired: false, trackStock: true },
  Networking: { serialRequired: true, trackStock: true },
  'Consumer Electronics': { serialRequired: true, trackStock: true },
  'Mobile Devices': { serialRequired: true, trackStock: true },
  Services: { serialRequired: false, trackStock: false },
}

export const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as CategoryId[]

/**
 * Controlled choices shown while creating a sale product.
 * Labels follow the commercial hierarchy requested by the business; values stay
 * canonical so tracking, accounts, pricing rules and existing reports remain stable.
 */
export const PRODUCT_CREATION_CATEGORY_OPTIONS: Array<{ value: CategoryId; label: string }> = [
  { value: 'Laptops', label: 'Sale - Laptops' },
  { value: 'Accessories', label: 'Sale - Accessories' },
  { value: 'Desktops', label: 'Sale - Desktops' },
  { value: 'Complete Desktops', label: 'Sale - Complete Desktops' },
  { value: 'Monitors', label: 'Sale - Monitors' },
  { value: 'Servers', label: 'Sale - Servers' },
  { value: 'Power Backup Solutions', label: 'Sale - Power Backup Solutions' },
  { value: 'Printers', label: 'Sale - Printers' },
  { value: 'Software & Licences', label: 'Sale - Software Licenses' },
  { value: 'Parts & Components', label: 'Sale - Parts and Components' },
  { value: 'Printer Consumables', label: 'Sale - Printer Consumables' },
  { value: 'Networking', label: 'Sale - Networking Equipment' },
  { value: 'Consumer Electronics', label: 'Sale - Consumer Electronics' },
]


export type ProductCategorySetting = {
  value: string
  label: string
  enabled: boolean
}

/**
 * Normalizes administrator-managed category settings while protecting the
 * canonical identifiers used by stock, accounting and pricing logic.
 */
export function normalizeProductCategorySettings(raw?: unknown): ProductCategorySetting[] {
  if (!Array.isArray(raw)) {
    return PRODUCT_CREATION_CATEGORY_OPTIONS.map(option => ({ ...option, enabled: true }))
  }

  const defaults = new Map(PRODUCT_CREATION_CATEGORY_OPTIONS.map(option => [option.value, option]))
  const seen = new Set<CategoryId>()
  const normalized: ProductCategorySetting[] = []

  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object') continue
    const value = String((candidate as { value?: unknown }).value || '').trim()
    const fallback = defaults.get(value as CategoryId)
    const isCustom = value.startsWith('custom:') && value.length > 'custom:'.length
    if ((!fallback && !isCustom) || seen.has(value as CategoryId)) continue
    seen.add(value as CategoryId)
    normalized.push({
      value,
      label: String((candidate as { label?: unknown }).label || '').trim() || fallback?.label || 'New category',
      enabled: (candidate as { enabled?: unknown }).enabled !== false,
    })
  }

  for (const option of PRODUCT_CREATION_CATEGORY_OPTIONS) {
    if (!seen.has(option.value)) normalized.push({ ...option, enabled: false })
  }

  return normalized
}

export function resolveProductCreationCategoryOptions(raw?: unknown): Array<{ value: string; label: string }> {
  return normalizeProductCategorySettings(raw)
    .filter(option => option.enabled)
    .map(({ value, label }) => ({ value, label }))
}
