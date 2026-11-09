/**
 * Pure helpers of the product master form (components/inventory/ProductFormModal.tsx),
 * shared with Inventory's bulk import.
 */
import type { Product } from '@/lib/store'
import { autoSalePriceFromCost, suggestWholesalePriceFromCost } from '@/lib/sale-price-calculator'

export function applyCostBandPrices<T extends Record<string, any>>(
  next: T,
  systemSettings: {
    pricingMarginPolicy?: unknown
    invCategorySaleMarkupPct?: Partial<Record<string, number>>
  },
): T {
  const isService = next.productKind === 'service' || next.category === 'Services'
  if (isService) return next
  const opts = {
    policy: systemSettings.pricingMarginPolicy as any,
    pricingCategoryId: next.pricingCategoryId || undefined,
    productType: next.productType,
    legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
  }
  const suggested = autoSalePriceFromCost(systemSettings.invCategorySaleMarkupPct, next.category, next.costPrice, opts)
  const wholesale = suggestWholesalePriceFromCost(systemSettings.invCategorySaleMarkupPct, next.category, next.costPrice, opts)
  return {
    ...next,
    ...(suggested !== null ? { salePrice: String(suggested) } : {}),
    ...(wholesale !== null ? { wholesalePrice: String(wholesale) } : {}),
  }
}

// New products start empty: category, and everything derived from it
// (product kind, tracking, unit, account codes), is only filled in after the
// user picks a category. Numbers/choices (min stock, warranty, VAT, condition,
// invoicing policy) must be set explicitly — see validateNewProductFields.
export const blankProduct = () => {
  return {
    name: '', sku: '', barcode: '', category: '',
    productKind: '',
    trackingMethod: '',
    salePrice: '', costPrice: '', wholesalePrice: '', commissionRatePercent: '', taxRate: '',
    minStock: '',
    unit: '',
    invoicePolicy: '' as 'order' | 'delivery' | '',
    pricingCategoryId: '',
    productType: '',
    description: '', canBeSold: true, canBePurchased: true, image: '',
    isActive: true, warrantyMonths: '',
    saleAccountCode: '',
    costAccountCode: '',
    inventoryAccountCode: '',
    cogsAccountCode: '',
    adjustmentAccountCode: '',
    writeOffAccountCode: '',
    priceDifferenceAccountCode: '',
    parentId: '',
    deviceRamGb: '',
    deviceStorageGb: '',
  }
}

export const normalizeBarcodeSeed = (value: string) => value.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8)
export const buildProductSku = (name: string, existing: Product[] = [], salt = 0) => {
  const seed = normalizeBarcodeSeed(name).slice(0, 18) || 'PRODUCT'
  // Include salt so bulk rows generated in the same millisecond never collide.
  let candidate = `${seed}-${Date.now().toString(36).toUpperCase().slice(-5)}${salt ? `-${salt}` : ''}`
  let suffix = 1
  while (existing.some(p => p.sku?.toUpperCase() === candidate.toUpperCase())) {
    candidate = `${seed}-${Date.now().toString(36).toUpperCase().slice(-5)}-${salt || suffix++}`
    suffix++
  }
  return candidate
}

export const buildProductBarcode = (sku: string, name: string, existing: Product[] = [], currentId?: string) => {
  const seed = normalizeBarcodeSeed(sku || name) || 'ITEM'
  let candidate = `DEED-${seed}-${Date.now().toString().slice(-5)}`
  let suffix = 1
  while (existing.some(p => p.id !== currentId && p.barcode?.toUpperCase() === candidate.toUpperCase())) {
    candidate = `DEED-${seed}-${Date.now().toString().slice(-5)}-${suffix++}`
  }
  return candidate
}

export const normKey = (value: unknown) => String(value ?? '').trim().toLowerCase()
