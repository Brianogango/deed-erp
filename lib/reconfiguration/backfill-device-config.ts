/**
 * Idempotent heal for catalog products and serials created before
 * deviceConfig was saved from the product name.
 *
 * Products: write products.specs.deviceConfig from the title (Laptops/Desktops).
 * Serials: stamp serial.specs only when it is blank — never overwrite a
 * unit that already has live specs after reconfiguration.
 */
import 'server-only'

import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import {
  fillEmptySerialSpecs,
  fillMissingCatalogDeviceConfig,
  type DeviceConfigDefault,
} from '@/lib/reconfiguration/unit-config'

export type BackfillDeviceConfigResult = {
  productsUpdated: number
  serialsUpdated: number
  productsSkippedBare: number
  serials: Array<Record<string, unknown>>
}

type BlobProduct = {
  id: string
  name?: string
  category?: string
  specs?: unknown
  deviceConfig?: DeviceConfigDefault | null
  [key: string]: unknown
}

type BlobSerial = {
  id: string
  serial?: string
  productId?: string
  productName?: string
  specs?: string
  [key: string]: unknown
}

export async function backfillInventoryDeviceConfig(): Promise<BackfillDeviceConfigResult> {
  const prismaProducts = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      specs: true,
      category: { select: { name: true } },
    },
  })

  let productsUpdated = 0
  let productsSkippedBare = 0
  const prismaDeviceConfig = new Map<string, DeviceConfigDefault | null>()

  for (const row of prismaProducts) {
    const category = row.category?.name || ''
    const filled = fillMissingCatalogDeviceConfig(row.specs, row.name, category)
    prismaDeviceConfig.set(row.id, filled.deviceConfig)
    if (!filled.changed) {
      if (!filled.deviceConfig && /^(laptops|desktops)$/i.test(category)) productsSkippedBare += 1
      continue
    }
    await prisma.product.update({
      where: { id: row.id },
      data: { specs: filled.specs as any },
    })
    productsUpdated += 1
  }

  const state = await loadAppState(['deed_products', 'deed_serials'])
  const products = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
  const serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []

  let blobProductsChanged = 0
  const nextProducts = products.map(product => {
    const category = String(product.category || '')
    const filled = fillMissingCatalogDeviceConfig(
      product.specs || (product.deviceConfig ? { deviceConfig: product.deviceConfig } : {}),
      String(product.name || ''),
      category,
    )
    const deviceConfig = filled.deviceConfig
      || prismaDeviceConfig.get(product.id)
      || product.deviceConfig
      || null
    const sameDevice =
      Number(product.deviceConfig?.totalRamGb || 0) === Number(deviceConfig?.totalRamGb || 0)
      && Number(product.deviceConfig?.primaryStorageGb || 0) === Number(deviceConfig?.primaryStorageGb || 0)
    if (sameDevice && !filled.changed) return product
    blobProductsChanged += 1
    return {
      ...product,
      specs: filled.changed ? filled.specs : product.specs,
      deviceConfig,
    }
  })

  const productById = new Map(nextProducts.map(p => [p.id, p]))
  let serialsUpdated = 0
  const nextSerials = serials.map(serial => {
    const product = productById.get(String(serial.productId || ''))
    const filled = fillEmptySerialSpecs(serial, {
      name: product?.name || serial.productName,
      specs: product?.specs || (product?.deviceConfig ? { deviceConfig: product.deviceConfig } : undefined),
      deviceConfig: product?.deviceConfig || prismaDeviceConfig.get(String(serial.productId || '')) || null,
    })
    if (!filled.changed) return serial
    serialsUpdated += 1
    return { ...serial, specs: filled.specs }
  })

  const writes: Record<string, string> = {}
  if (blobProductsChanged > 0) writes.deed_products = JSON.stringify(nextProducts)
  if (serialsUpdated > 0) writes.deed_serials = JSON.stringify(nextSerials)
  if (Object.keys(writes).length > 0) {
    await saveStoreKeys(writes)
  }

  return {
    productsUpdated: productsUpdated + blobProductsChanged,
    serialsUpdated,
    productsSkippedBare,
    serials: nextSerials,
  }
}
