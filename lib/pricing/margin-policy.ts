/**
 * Deed margin-from-cost pricing policy (source: Margins spreadsheet).
 *
 * Selling (ex VAT) = buyCost / (1 - overheadRate - effectiveTargetMargin)
 * where effectiveTargetMargin = categoryTargetMargin - tierReduction(buyCost).
 */

import type { CategoryId } from '@/lib/store-types'

export type PricingCondition = 'new' | 'refurbished' | 'any'

export interface PricingMarginCategory {
  id: string
  name: string
  /** Target profit margin after overhead, as percent points (5 = 5%). */
  minGpMarginPct: number
  maxGpMarginPct: number
  itemsIncluded?: string
}

export interface PricingTier {
  /** Inclusive lower bound of buy (cost) price in KES. */
  priceFromKes: number
  /** Subtracted from category target margins (percent points). */
  reductionPct: number
  label: string
}

export interface PricingCategoryMapRule {
  erpCategory: CategoryId | '*'
  /** Reserved for future new/refurb flags; currently always 'any'. */
  condition?: PricingCondition
  pricingCategoryId: string
}

export interface PricingMarginPolicy {
  /** When false, Inventory falls back to legacy invCategorySaleMarkupPct. */
  enabled: boolean
  annualRevenueEstimateKes: number
  annualOverheadKes: number
  /** Invoice VAT rate percent (Kenya standard 16). */
  vatRatePct: number
  /** Round recommended sell prices up to this KES step (spreadsheet: 500). */
  roundUpKes: number
  categories: PricingMarginCategory[]
  tiers: PricingTier[]
  categoryMap: PricingCategoryMapRule[]
}

/** Spreadsheet defaults (Margins tab, Aug 2026). */
export const DEFAULT_PRICING_MARGIN_POLICY: PricingMarginPolicy = {
  enabled: true,
  annualRevenueEstimateKes: 70_000_000,
  annualOverheadKes: 9_240_000,
  vatRatePct: 16,
  roundUpKes: 500,
  categories: [
    {
      id: 'accessories',
      name: 'Accessories',
      minGpMarginPct: 5,
      maxGpMarginPct: 10,
      itemsIncluded: 'Chargers, cables, mice, keyboards, bags, adapters, headphones',
    },
    {
      id: 'consumer_electronics',
      name: 'Consumer Electronics',
      minGpMarginPct: 7,
      maxGpMarginPct: 10,
      itemsIncluded: 'Tablets, smartphones, smart TVs, smart devices',
    },
    {
      id: 'refurb_desktops',
      name: 'Refurb Desktops / Combos',
      minGpMarginPct: 5,
      maxGpMarginPct: 10,
      itemsIncluded: 'CPUs, all-in-ones, desktop bundles (CPU + monitor)',
    },
    {
      id: 'refurb_laptops',
      name: 'Refurb Laptops',
      minGpMarginPct: 7,
      maxGpMarginPct: 12,
      itemsIncluded: 'All notebooks (new/refurb), ultrabooks, business & consumer',
    },
    {
      id: 'monitors',
      name: 'Monitors(New & Refurb)',
      minGpMarginPct: 10,
      maxGpMarginPct: 15,
      itemsIncluded: 'LED, IPS, gaming and office display units',
    },
    {
      id: 'networking',
      name: 'Networking',
      minGpMarginPct: 20,
      maxGpMarginPct: 25,
      itemsIncluded: 'Routers, switches, access points, LAN equipment',
    },
    {
      id: 'power_backup',
      name: 'Power Backup',
      minGpMarginPct: 15,
      maxGpMarginPct: 20,
      itemsIncluded: 'UPS units, inverters, power banks, surge protectors',
    },
    {
      id: 'printer_consumables',
      name: 'Printer Consumables',
      minGpMarginPct: 15,
      maxGpMarginPct: 20,
      itemsIncluded: 'Toners, ink cartridges, drum units, maintenance kits',
    },
    {
      id: 'printers',
      name: 'Printers(New & Refurb)',
      minGpMarginPct: 5,
      maxGpMarginPct: 10,
      itemsIncluded: 'Inkjet, laser, multifunction printers (MFPs)',
    },
    {
      id: 'repair_parts',
      name: 'Repair Parts',
      minGpMarginPct: 5,
      maxGpMarginPct: 10,
      itemsIncluded: 'Batteries, screens, keyboards, hinges, ports, RAM, storage',
    },
    {
      id: 'servers',
      name: 'Servers',
      minGpMarginPct: 15,
      maxGpMarginPct: 20,
      itemsIncluded: 'Enterprise, rack/tower, storage servers',
    },
    {
      id: 'brand_new_pcs',
      name: 'Brand New PCs',
      minGpMarginPct: 3,
      maxGpMarginPct: 5,
      itemsIncluded: 'Brand New Laptops, Desktops, AIOs',
    },
    {
      id: 'software_licenses',
      name: 'Software Licenses',
      minGpMarginPct: 25,
      maxGpMarginPct: 30,
      itemsIncluded: 'OS licenses, antivirus, Microsoft 365, business software',
    },
  ],
  tiers: [
    { priceFromKes: 0, reductionPct: 0, label: 'Under KES 30,000' },
    { priceFromKes: 35_001, reductionPct: 0.5, label: 'KES 35,001 – 50,000' },
    { priceFromKes: 50_001, reductionPct: 7, label: 'KES 50,001 – 90,000' },
    { priceFromKes: 90_001, reductionPct: 7, label: 'KES 90,001 – 110,000' },
    { priceFromKes: 110_001, reductionPct: 8.5, label: 'KES 110,001 – 130,000' },
    { priceFromKes: 130_001, reductionPct: 12, label: 'KES 130,001 – 160,000' },
    { priceFromKes: 160_001, reductionPct: 13, label: 'KES 160,001 – 200,000' },
    { priceFromKes: 200_001, reductionPct: 14, label: 'Above KES 200,000' },
  ],
  // Deed catalog categories → spreadsheet pricing bands.
  // Laptops/Desktops: productType new → Brand New PCs; refurbished (default) → refurb bands.
  categoryMap: [
    { erpCategory: 'Accessories', condition: 'any', pricingCategoryId: 'accessories' },
    { erpCategory: 'Mobile Devices', condition: 'any', pricingCategoryId: 'consumer_electronics' },
    { erpCategory: 'Laptops', condition: 'new', pricingCategoryId: 'brand_new_pcs' },
    { erpCategory: 'Laptops', condition: 'refurbished', pricingCategoryId: 'refurb_laptops' },
    { erpCategory: 'Laptops', condition: 'any', pricingCategoryId: 'refurb_laptops' },
    { erpCategory: 'Desktops', condition: 'new', pricingCategoryId: 'brand_new_pcs' },
    { erpCategory: 'Desktops', condition: 'refurbished', pricingCategoryId: 'refurb_desktops' },
    { erpCategory: 'Desktops', condition: 'any', pricingCategoryId: 'refurb_desktops' },
    { erpCategory: 'Complete Desktops', condition: 'new', pricingCategoryId: 'brand_new_pcs' },
    { erpCategory: 'Complete Desktops', condition: 'refurbished', pricingCategoryId: 'refurb_desktops' },
    { erpCategory: 'Complete Desktops', condition: 'any', pricingCategoryId: 'refurb_desktops' },
    { erpCategory: 'Monitors', condition: 'any', pricingCategoryId: 'monitors' },
    { erpCategory: 'Servers', condition: 'any', pricingCategoryId: 'servers' },
    { erpCategory: 'Power Backup Solutions', condition: 'any', pricingCategoryId: 'power_backup' },
    { erpCategory: 'Consumer Electronics', condition: 'any', pricingCategoryId: 'consumer_electronics' },
    { erpCategory: 'Printers', condition: 'any', pricingCategoryId: 'printers' },
    { erpCategory: 'Printer Consumables', condition: 'any', pricingCategoryId: 'printer_consumables' },
    { erpCategory: 'Networking', condition: 'any', pricingCategoryId: 'networking' },
    { erpCategory: 'Parts & Components', condition: 'any', pricingCategoryId: 'repair_parts' },
    { erpCategory: 'Software & Licences', condition: 'any', pricingCategoryId: 'software_licenses' },
  ],
}

export function overheadRateFromPolicy(policy: Pick<PricingMarginPolicy, 'annualRevenueEstimateKes' | 'annualOverheadKes'>): number {
  const revenue = Number(policy.annualRevenueEstimateKes)
  const overhead = Number(policy.annualOverheadKes)
  if (!Number.isFinite(revenue) || revenue <= 0) return 0
  if (!Number.isFinite(overhead) || overhead < 0) return 0
  return overhead / revenue
}

export function normalizePricingMarginPolicy(
  raw: Partial<PricingMarginPolicy> | null | undefined,
): PricingMarginPolicy {
  const base = DEFAULT_PRICING_MARGIN_POLICY
  if (!raw || typeof raw !== 'object') return { ...base, categories: [...base.categories], tiers: [...base.tiers], categoryMap: [...base.categoryMap] }

  const categories =
    Array.isArray(raw.categories) && raw.categories.length > 0
      ? raw.categories.map(c => ({
          id: String(c.id || '').trim() || slugify(String(c.name || 'category')),
          name: String(c.name || c.id || 'Category').trim(),
          minGpMarginPct: clampPct(c.minGpMarginPct),
          maxGpMarginPct: Math.max(clampPct(c.minGpMarginPct), clampPct(c.maxGpMarginPct)),
          itemsIncluded: c.itemsIncluded ? String(c.itemsIncluded) : undefined,
        }))
      : [...base.categories]

  const tiers =
    Array.isArray(raw.tiers) && raw.tiers.length > 0
      ? [...raw.tiers]
          .map(t => ({
            priceFromKes: Math.max(0, Number(t.priceFromKes) || 0),
            reductionPct: Math.max(0, Number(t.reductionPct) || 0),
            label: String(t.label || '').trim() || `From ${Number(t.priceFromKes) || 0}`,
          }))
          .sort((a, b) => a.priceFromKes - b.priceFromKes)
      : [...base.tiers]

  const categoryMap =
    Array.isArray(raw.categoryMap) && raw.categoryMap.length > 0
      ? raw.categoryMap.map(r => ({
          erpCategory: r.erpCategory,
          condition: r.condition || 'any',
          pricingCategoryId: String(r.pricingCategoryId || ''),
        }))
      : [...base.categoryMap]

  return {
    enabled: raw.enabled !== false,
    annualRevenueEstimateKes: Math.max(0, Number(raw.annualRevenueEstimateKes) || base.annualRevenueEstimateKes),
    annualOverheadKes: Math.max(0, Number(raw.annualOverheadKes) || base.annualOverheadKes),
    vatRatePct: Math.max(0, Number(raw.vatRatePct ?? base.vatRatePct) || 0),
    roundUpKes: Math.max(1, Number(raw.roundUpKes ?? base.roundUpKes) || 500),
    categories,
    tiers,
    categoryMap,
  }
}

function clampPct(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(-100, Math.min(100, v))
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'category'
}

export function resolvePricingCategoryId(opts: {
  policy: PricingMarginPolicy
  erpCategory?: string | null
  pricingCategoryId?: string | null
  /** Prisma / catalog productType — selects Brand New PCs vs refurb bands. */
  productType?: 'new' | 'refurbished' | string | null
}): string | null {
  const explicit = String(opts.pricingCategoryId || '').trim()
  if (explicit && opts.policy.categories.some(c => c.id === explicit)) return explicit

  const erp = String(opts.erpCategory || '').trim()
  if (!erp) return null

  const condition: PricingCondition =
    opts.productType === 'new' || opts.productType === 'refurbished'
      ? opts.productType
      : 'any'

  const rulesForErp = opts.policy.categoryMap.filter(
    r => r.erpCategory === erp && r.pricingCategoryId && opts.policy.categories.some(c => c.id === r.pricingCategoryId),
  )
  const byCondition =
    rulesForErp.find(r => (r.condition || 'any') === condition) ||
    rulesForErp.find(r => (r.condition || 'any') === 'any')
  if (byCondition) return byCondition.pricingCategoryId

  const wildcard = opts.policy.categoryMap.find(r => r.erpCategory === '*' && r.pricingCategoryId)
  if (wildcard?.pricingCategoryId && opts.policy.categories.some(c => c.id === wildcard.pricingCategoryId)) {
    return wildcard.pricingCategoryId
  }

  // Name fallback: match spreadsheet category name loosely to ERP category.
  const erpLower = erp.toLowerCase()
  const byName = opts.policy.categories.find(c => {
    const n = c.name.toLowerCase()
    return n === erpLower || n.includes(erpLower) || erpLower.includes(n.split('(')[0].trim())
  })
  return byName?.id ?? null
}
