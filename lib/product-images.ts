import { matchCatalogPhotoPack } from '@/lib/catalog-photos'

export const PRODUCT_IMAGE_SLOTS = [1, 2] as const
export type ProductImageSlot = (typeof PRODUCT_IMAGE_SLOTS)[number]
export type ProductImageRole = 'hero' | 'detail'

export const PRODUCT_IMAGE_ROLES: Record<ProductImageSlot, ProductImageRole> = {
  1: 'hero',
  2: 'detail',
}

export type PartnerProductImage = {
  url: string
  role: ProductImageRole
}

export function isProductImageSlot(value: unknown): value is ProductImageSlot {
  return value === 1 || value === 2 || value === '1' || value === '2'
}

export function parseProductImageSlot(value: unknown): ProductImageSlot | null {
  const n = Number(value)
  return n === 1 || n === 2 ? n : null
}

export function productImageRole(slot: ProductImageSlot): ProductImageRole {
  return PRODUCT_IMAGE_ROLES[slot]
}

export function productImageBlobKey(productId: string): string {
  return `product_photos_${String(productId).trim()}`
}

export function productImagePublicPath(productId: string, slot: ProductImageSlot): string {
  return `/api/public/v1/products/${encodeURIComponent(productId)}/images/${slot}`
}

export function catalogPhotoPublicPath(packId: string, slot: ProductImageSlot): string {
  return `/api/public/v1/catalog-photos/${encodeURIComponent(packId)}/${slot}`
}

export function isProductPhotoUrl(value: unknown): boolean {
  const url = String(value ?? '').trim()
  if (!url) return false
  if (url.startsWith('data:image/')) return true
  if (/^https?:\/\//i.test(url)) return true
  return url.startsWith('/api/public/v1/products/') || url.startsWith('/api/public/v1/catalog-photos/')
}

export function partnerImagesFromSlots(
  productId: string,
  slots: Partial<Record<ProductImageSlot, boolean>>,
  packId?: string | null,
): PartnerProductImage[] {
  const images: PartnerProductImage[] = []
  for (const slot of PRODUCT_IMAGE_SLOTS) {
    if (slots[slot]) {
      images.push({ url: productImagePublicPath(productId, slot), role: productImageRole(slot) })
    } else if (packId) {
      images.push({ url: catalogPhotoPublicPath(packId, slot), role: productImageRole(slot) })
    }
  }
  return images
}

export type ProductThumbInput = {
  id?: unknown
  name?: unknown
  sku?: unknown
  image?: unknown
}

export type ProductThumbSource = {
  src: string
  /** True when the URL may 404 (upload not confirmed on the client). */
  speculative: boolean
}

/** Hero photo for POS/catalog thumbs: uploaded URL, then name-matched pack, then the public product image route. */
export function productThumbSource(product: ProductThumbInput): ProductThumbSource | null {
  if (isProductPhotoUrl(product.image)) {
    return { src: String(product.image).trim(), speculative: false }
  }
  const pack = matchCatalogPhotoPack(product.name, product.sku)
  if (pack) {
    return { src: catalogPhotoPublicPath(pack.id, 1), speculative: false }
  }
  const id = String(product.id ?? '').trim()
  if (!id) return null
  return { src: productImagePublicPath(id, 1), speculative: true }
}

export function productThumbUrl(product: ProductThumbInput): string | null {
  return productThumbSource(product)?.src ?? null
}
