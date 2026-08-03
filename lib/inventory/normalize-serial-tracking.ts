/**
 * Force SERIAL tracking on all products in serial-only categories
 * (Laptops, Desktops, Printers, Networking, Mobile Devices).
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { SERIAL_ONLY_CATEGORIES, isSerialOnlyCategory } from '@/lib/inventory-identifiers'

export type NormalizeSerialTrackingResult = {
  prismaUpdated: number
  blobUpdated: number
  categories: string[]
}

export async function normalizeSerialOnlyProductTracking(): Promise<NormalizeSerialTrackingResult> {
  const allCategories = await prisma.category.findMany({ select: { id: true, name: true } })
  const serialCategoryIds = allCategories
    .filter(c => isSerialOnlyCategory(c.name))
    .map(c => c.id)

  let prismaUpdated = 0
  if (serialCategoryIds.length > 0) {
    const result = await prisma.product.updateMany({
      where: {
        categoryId: { in: serialCategoryIds },
        trackingMethod: { not: 'SERIAL' },
      },
      data: { trackingMethod: 'SERIAL' },
    })
    prismaUpdated = result.count
  }

  const state = await loadAppState(['deed_products'])
  const products = Array.isArray(state.deed_products) ? [...(state.deed_products as any[])] : []
  let blobUpdated = 0
  const next = products.map(product => {
    if (!isSerialOnlyCategory(product?.category)) return product
    if (String(product?.trackingMethod ?? '').toUpperCase() === 'SERIAL' && product?.requiresSerial === true) {
      return product
    }
    blobUpdated += 1
    return {
      ...product,
      trackingMethod: 'SERIAL',
      requiresSerial: true,
    }
  })
  if (blobUpdated > 0) {
    await saveStoreKeys({ deed_products: JSON.stringify(next) })
  }

  return {
    prismaUpdated,
    blobUpdated,
    categories: [...SERIAL_ONLY_CATEGORIES],
  }
}
