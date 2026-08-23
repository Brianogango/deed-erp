import 'server-only'
import { promises as fs } from 'fs'
import path from 'path'
import { CATALOG_PHOTO_PACKS, catalogPhotoRelPath } from '@/lib/catalog-photos'
import type { ProductImageSlot } from '@/lib/product-images'

export async function readCatalogPhotoFile(
  packId: string,
  slot: ProductImageSlot,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!CATALOG_PHOTO_PACKS.some(pack => pack.id === packId)) return null
  const rel = catalogPhotoRelPath(packId, slot)
  const file = path.join(process.cwd(), rel)
  try {
    const buffer = await fs.readFile(file)
    if (!buffer.length) return null
    return { buffer, contentType: 'image/jpeg' }
  } catch {
    return null
  }
}
