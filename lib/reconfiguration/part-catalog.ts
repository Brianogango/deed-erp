/**
 * Which catalog products belong in the bench RAM / SSD pickers.
 * Laptop titles often contain "16GB RAM, 256GB SSD" and must not appear.
 */

import { inferTrackingMethod, isSerialOnlyCategory, isSerialTracking } from '@/lib/inventory-identifiers'
import { looksLikeCompleteDevice } from '@/lib/reconfiguration/product-effect'

export type PartCatalogProduct = {
  id: string
  name?: string | null
  sku?: string | null
  category?: string | null
  trackingMethod?: string | null
  requiresSerial?: boolean | null
  unit?: string | null
  isActive?: boolean | null
  specs?: unknown
}

function isActiveProduct(product: PartCatalogProduct): boolean {
  return product.isActive !== false
}

function isSerializedDevice(product: PartCatalogProduct): boolean {
  if (isSerialOnlyCategory(product.category)) return true
  return isSerialTracking(inferTrackingMethod(product))
}

function isPartsCategory(product: PartCatalogProduct): boolean {
  return /part/i.test(String(product.category || ''))
}

export function isRamComponentProduct(product: PartCatalogProduct): boolean {
  if (!isActiveProduct(product)) return false
  const name = String(product.name || '')
  if (!name || looksLikeCompleteDevice(name) || isSerializedDevice(product)) return false
  if (/\b(ddr\d?|sodimm|so-dimm|udimm|dimm)\b/i.test(name)) return true
  if (/\b(ram|memory)\b/i.test(name) && (
    isPartsCategory(product) || /\b(module|stick|upgrade|kit|sodimm|dimm)\b/i.test(name)
  )) return true
  return false
}

export function isStorageComponentProduct(product: PartCatalogProduct): boolean {
  if (!isActiveProduct(product)) return false
  const name = String(product.name || '')
  if (!name || looksLikeCompleteDevice(name) || isSerializedDevice(product)) return false
  if (/\b(nvme|m\.?2|sata)\b/i.test(name)) return true
  if (/\b(ssd|hdd)\b/i.test(name) && (
    isPartsCategory(product) || /\b(drive|module|upgrade|kit|nvme|sata)\b/i.test(name)
  )) return true
  return false
}

export function ramComponentProducts<T extends PartCatalogProduct>(products: T[] | null | undefined): T[] {
  return (products || []).filter(isRamComponentProduct)
}

export function storageComponentProducts<T extends PartCatalogProduct>(products: T[] | null | undefined): T[] {
  return (products || []).filter(isStorageComponentProduct)
}
