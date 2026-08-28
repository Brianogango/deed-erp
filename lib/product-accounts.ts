/**
 * Resolve product ↔ chart-of-accounts mapping with category defaults.
 * Precedence: product override → category default → company fallback codes.
 */

import { inferProductKind, type ProductKind } from '@/lib/product-kind'

export interface ProductAccountCodes {
  saleAccountCode?: string
  costAccountCode?: string
  inventoryAccountCode?: string
  cogsAccountCode?: string
  adjustmentAccountCode?: string
  writeOffAccountCode?: string
  priceDifferenceAccountCode?: string
}

export interface CategoryAccountDefaults extends ProductAccountCodes {
  productKind?: ProductKind
}

/** Sensible Kenya CoA defaults used when neither product nor category sets an account. */
export const COMPANY_ACCOUNT_FALLBACKS: Required<ProductAccountCodes> = {
  saleAccountCode: '5000',
  costAccountCode: '6101',
  inventoryAccountCode: '1200',
  cogsAccountCode: '6001',
  adjustmentAccountCode: '6305',
  writeOffAccountCode: '6306',
  priceDifferenceAccountCode: '6307',
}

/**
 * Per-category commercial defaults. Products inherit these unless overridden.
 * Codes match the seeded Chart of Accounts where possible.
 */
export const CATEGORY_ACCOUNT_DEFAULTS: Record<string, CategoryAccountDefaults> = {
  Laptops: {
    productKind: 'storable',
    saleAccountCode: '5001',
    costAccountCode: '6101',
    inventoryAccountCode: '1200',
    cogsAccountCode: '6001',
    adjustmentAccountCode: '6305',
    writeOffAccountCode: '6306',
    priceDifferenceAccountCode: '6307',
  },
  Desktops: {
    productKind: 'storable',
    saleAccountCode: '5003',
    costAccountCode: '6103',
    inventoryAccountCode: '1200',
    cogsAccountCode: '6001',
    adjustmentAccountCode: '6305',
    writeOffAccountCode: '6306',
    priceDifferenceAccountCode: '6307',
  },
  'Parts & Components': {
    productKind: 'consumable',
    saleAccountCode: '5010',
    costAccountCode: '6110',
    inventoryAccountCode: '1200',
    cogsAccountCode: '6001',
    adjustmentAccountCode: '6305',
    writeOffAccountCode: '6306',
    priceDifferenceAccountCode: '6307',
  },
  Accessories: {
    productKind: 'consumable',
    saleAccountCode: '5002',
    costAccountCode: '6102',
    inventoryAccountCode: '1200',
    cogsAccountCode: '6001',
    adjustmentAccountCode: '6305',
    writeOffAccountCode: '6306',
    priceDifferenceAccountCode: '6307',
  },
  Printers: {
    productKind: 'storable',
    saleAccountCode: '5008',
    costAccountCode: '6108',
    inventoryAccountCode: '1200',
    cogsAccountCode: '6001',
    adjustmentAccountCode: '6305',
    writeOffAccountCode: '6306',
    priceDifferenceAccountCode: '6307',
  },
  Networking: {
    productKind: 'storable',
    saleAccountCode: '5012',
    costAccountCode: '6112',
    inventoryAccountCode: '1200',
    cogsAccountCode: '6001',
    adjustmentAccountCode: '6305',
    writeOffAccountCode: '6306',
    priceDifferenceAccountCode: '6307',
  },
  'Mobile Devices': {
    productKind: 'storable',
    saleAccountCode: '5013',
    costAccountCode: '6113',
    inventoryAccountCode: '1200',
    cogsAccountCode: '6001',
    adjustmentAccountCode: '6305',
    writeOffAccountCode: '6306',
    priceDifferenceAccountCode: '6307',
  },
  'Software & Licences': {
    productKind: 'service',
    saleAccountCode: '5009',
    costAccountCode: '6109',
  },
  Services: {
    productKind: 'service',
    saleAccountCode: '5101',
    costAccountCode: '6301',
  },
}

export function categoryDefaults(category?: string | null): CategoryAccountDefaults {
  if (!category) return {}
  return CATEGORY_ACCOUNT_DEFAULTS[category] ?? {}
}

function pickCode(
  productValue: string | undefined | null,
  categoryValue: string | undefined | null,
  fallback: string,
): string {
  const p = String(productValue ?? '').trim()
  if (p) return p
  const c = String(categoryValue ?? '').trim()
  if (c) return c
  return fallback
}

export type AccountableProduct = ProductAccountCodes & {
  category?: string | null
  productKind?: string | null
  trackingMethod?: string | null
  unit?: string | null
  requiresSerial?: boolean | null
  costPrice?: number
  name?: string
}

/** Fully resolved account codes for a product (never empty strings). */
export function resolveProductAccounts(product: AccountableProduct): Required<ProductAccountCodes> & { productKind: ProductKind } {
  const cat = categoryDefaults(product.category)
  const kind = inferProductKind({
    productKind: product.productKind ?? cat.productKind,
    trackingMethod: product.trackingMethod,
    category: product.category,
    unit: product.unit,
    requiresSerial: product.requiresSerial,
  })
  return {
    productKind: kind,
    saleAccountCode: pickCode(product.saleAccountCode, cat.saleAccountCode, COMPANY_ACCOUNT_FALLBACKS.saleAccountCode),
    costAccountCode: pickCode(product.costAccountCode, cat.costAccountCode, COMPANY_ACCOUNT_FALLBACKS.costAccountCode),
    inventoryAccountCode: pickCode(product.inventoryAccountCode, cat.inventoryAccountCode, COMPANY_ACCOUNT_FALLBACKS.inventoryAccountCode),
    cogsAccountCode: pickCode(product.cogsAccountCode, cat.cogsAccountCode, COMPANY_ACCOUNT_FALLBACKS.cogsAccountCode),
    adjustmentAccountCode: pickCode(product.adjustmentAccountCode, cat.adjustmentAccountCode, COMPANY_ACCOUNT_FALLBACKS.adjustmentAccountCode),
    writeOffAccountCode: pickCode(product.writeOffAccountCode, cat.writeOffAccountCode, COMPANY_ACCOUNT_FALLBACKS.writeOffAccountCode),
    priceDifferenceAccountCode: pickCode(product.priceDifferenceAccountCode, cat.priceDifferenceAccountCode, COMPANY_ACCOUNT_FALLBACKS.priceDifferenceAccountCode),
  }
}

/** Apply category defaults into empty product account fields (for form prefill). */
export function applyCategoryAccountDefaults(
  category: string,
  current: ProductAccountCodes & { productKind?: string },
): ProductAccountCodes & { productKind: ProductKind } {
  const cat = categoryDefaults(category)
  const kind = (current.productKind as ProductKind)
    || cat.productKind
    || inferProductKind({ category })
  const fill = (key: keyof ProductAccountCodes) =>
    String(current[key] ?? '').trim() || String(cat[key] ?? '').trim() || ''
  return {
    productKind: kind,
    saleAccountCode: fill('saleAccountCode'),
    costAccountCode: fill('costAccountCode'),
    inventoryAccountCode: fill('inventoryAccountCode'),
    cogsAccountCode: fill('cogsAccountCode'),
    adjustmentAccountCode: fill('adjustmentAccountCode'),
    writeOffAccountCode: fill('writeOffAccountCode'),
    priceDifferenceAccountCode: fill('priceDifferenceAccountCode'),
  }
}

/** Format `code` or `code - Name` for journal lines using CoA list when available. */
export function formatAccountLabel(
  code: string,
  accounts: Array<{ code: string; name: string }> = [],
): string {
  const trimmed = String(code ?? '').trim()
  if (!trimmed) return COMPANY_ACCOUNT_FALLBACKS.saleAccountCode
  if (trimmed.includes(' - ')) return trimmed
  const match = accounts.find(a => a.code === trimmed)
  return match ? `${match.code} - ${match.name}` : trimmed
}

export interface InvoiceLineForPosting {
  productId?: string
  description?: string
  subtotal: number
  accountCode?: string
  lineType?: 'item' | 'section'
}

/**
 * Aggregate invoice line amounts by revenue (or purchase) account code.
 * Falls back to product → category → company defaults via `resolveProduct`.
 */
export function aggregateLinesByAccount(args: {
  lines: InvoiceLineForPosting[]
  resolveProduct?: (productId: string) => AccountableProduct | undefined
  side: 'revenue' | 'purchase'
  accounts?: Array<{ code: string; name: string }>
}): Array<{ account: string; amount: number }> {
  const buckets = new Map<string, number>()
  for (const line of args.lines) {
    if (line.lineType === 'section') continue
    const amount = Number(line.subtotal) || 0
    if (!amount) continue
    let code = String(line.accountCode ?? '').trim()
    if (!code && line.productId && args.resolveProduct) {
      const product = args.resolveProduct(line.productId)
      if (product) {
        const resolved = resolveProductAccounts(product)
        code = args.side === 'revenue' ? resolved.saleAccountCode : resolved.costAccountCode
      }
    }
    if (!code) {
      code = args.side === 'revenue'
        ? COMPANY_ACCOUNT_FALLBACKS.saleAccountCode
        : COMPANY_ACCOUNT_FALLBACKS.costAccountCode
    }
    const label = formatAccountLabel(code, args.accounts)
    buckets.set(label, (buckets.get(label) || 0) + amount)
  }
  return Array.from(buckets.entries()).map(([account, amount]) => ({ account, amount }))
}
