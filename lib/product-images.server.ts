import 'server-only'
import { ImageNormalizationError, normalizeUploadedRepairPhoto } from '@/lib/server-image-normalization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import prisma from '@/lib/prisma'
import {
  PRODUCT_IMAGE_SLOTS,
  type ProductImageSlot,
  type PartnerProductImage,
  productImageBlobKey,
  productImagePublicPath,
  productImageRole,
  partnerImagesFromSlots,
} from '@/lib/product-images'
import { matchCatalogPhotoPack } from '@/lib/catalog-photos'

export type StoredProductPhoto = {
  slot: ProductImageSlot
  role: 'hero' | 'detail'
  dataUrl: string
  contentType: 'image/jpeg'
  bytes: number
  updatedAt: string
}

export { ImageNormalizationError }

export async function normalizeProductPhoto(dataUrl: string) {
  return normalizeUploadedRepairPhoto(dataUrl)
}

function asPhotos(raw: unknown): StoredProductPhoto[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((row): row is StoredProductPhoto => {
    if (!row || typeof row !== 'object') return false
    const slot = Number((row as StoredProductPhoto).slot)
    const dataUrl = String((row as StoredProductPhoto).dataUrl || '')
    return (slot === 1 || slot === 2) && dataUrl.startsWith('data:image/')
  })
}

export async function loadProductPhotos(productId: string): Promise<StoredProductPhoto[]> {
  const key = productImageBlobKey(productId)
  const state = await loadAppState([key])
  return asPhotos(state[key])
}

export async function saveProductPhoto(
  productId: string,
  slot: ProductImageSlot,
  dataUrl: string,
): Promise<{ photo: StoredProductPhoto; publicPath: string }> {
  const normalized = await normalizeProductPhoto(dataUrl)
  const key = productImageBlobKey(productId)
  const existing = await loadProductPhotos(productId)
  const photo: StoredProductPhoto = {
    slot,
    role: productImageRole(slot),
    dataUrl: normalized.dataUrl,
    contentType: 'image/jpeg',
    bytes: normalized.bytes,
    updatedAt: new Date().toISOString(),
  }
  const next = [...existing.filter(p => p.slot !== slot), photo].sort((a, b) => a.slot - b.slot)
  await saveStoreKeys({ [key]: JSON.stringify(next) })

  const publicPath = productImagePublicPath(productId, slot)
  await prisma.productImage.deleteMany({ where: { productId, sortOrder: slot } }).catch(() => {})
  await prisma.productImage.create({
    data: {
      productId,
      imageUrl: publicPath,
      isPrimary: slot === 1,
      sortOrder: slot,
    },
  }).catch(() => {})
  if (slot === 1) {
    await prisma.product.update({
      where: { id: productId },
      data: { primaryImageUrl: publicPath },
    }).catch(() => {})
  }
  return { photo, publicPath }
}

export async function deleteProductPhoto(productId: string, slot: ProductImageSlot): Promise<void> {
  const key = productImageBlobKey(productId)
  const existing = await loadProductPhotos(productId)
  const next = existing.filter(p => p.slot !== slot)
  await saveStoreKeys({ [key]: JSON.stringify(next) })
  await prisma.productImage.deleteMany({ where: { productId, sortOrder: slot } }).catch(() => {})
  if (slot === 1) {
    const hero = next.find(p => p.slot === 1)
    await prisma.product.update({
      where: { id: productId },
      data: { primaryImageUrl: hero ? productImagePublicPath(productId, 1) : null },
    }).catch(() => {})
  }
}

export async function uploadedSlotsFor(productId: string): Promise<Partial<Record<ProductImageSlot, boolean>>> {
  const photos = await loadProductPhotos(productId)
  const slots: Partial<Record<ProductImageSlot, boolean>> = {}
  for (const photo of photos) slots[photo.slot] = true
  return slots
}

export async function partnerImagesForProduct(input: {
  id: string
  name?: string | null
  sku?: string | null
}): Promise<PartnerProductImage[]> {
  const uploaded = await uploadedSlotsFor(input.id)
  const hasUpload = PRODUCT_IMAGE_SLOTS.some(slot => uploaded[slot])
  const pack = hasUpload ? null : matchCatalogPhotoPack(input.name, input.sku)
  return partnerImagesFromSlots(input.id, uploaded, pack?.id ?? null)
}
