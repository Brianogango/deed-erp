import prisma from '@/lib/prisma'
import type { z } from 'zod'
import type { productSchema } from '@/lib/validation'
import { isSerialOnlyCategory } from '@/lib/inventory-identifiers'
import { createZeroStockLevel } from '@/lib/inventory/stock-level'
import { deviceConfigFromProductSpecs, withCatalogDeviceConfig } from '@/lib/reconfiguration/unit-config'

export type ValidatedProductInput = z.infer<typeof productSchema>

const skuSeed = (value: string) =>
  value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 24) || 'PRODUCT'

export async function buildUniqueSku(name: string) {
  const base = skuSeed(name)
  let candidate = `${base}-${Date.now().toString(36).toUpperCase().slice(-6)}`
  let suffix = 1
  while (await prisma.product.findFirst({ where: { sku: { equals: candidate, mode: 'insensitive' } }, select: { id: true } })) {
    candidate = `${base}-${Date.now().toString(36).toUpperCase().slice(-6)}-${suffix++}`
  }
  return candidate
}

export async function findProductDuplicate(
  name: string,
  sku?: string | null,
  barcode?: string | null,
  client: { product: { findFirst: typeof prisma.product.findFirst } } = prisma,
) {
  const or: Record<string, unknown>[] = [
    { name: { equals: name, mode: 'insensitive' } },
  ]
  if (sku) or.push({ sku: { equals: sku, mode: 'insensitive' } })
  if (barcode) or.push({ barcode: { equals: barcode, mode: 'insensitive' } })
  return client.product.findFirst({
    where: { OR: or },
    select: { id: true, name: true, sku: true, barcode: true },
  })
}

function productIdentityLockKey(name: string, sku?: string | null, barcode?: string | null) {
  const parts = [`name:${name.trim().toLowerCase()}`]
  if (sku?.trim()) parts.push(`sku:${sku.trim().toLowerCase()}`)
  if (barcode?.trim()) parts.push(`bc:${barcode.trim().toLowerCase()}`)
  return `product:${parts.join('|')}`
}

export function resolveTrackingMethod(
  trackingMethod: 'NONE' | 'QUANTITY' | 'BATCH' | 'SERIAL' | null | undefined,
  productKind: 'storable' | 'consumable' | 'service' | null | undefined,
  category?: string | null,
) {
  if (isSerialOnlyCategory(category)) return 'SERIAL' as const
  if (trackingMethod) return trackingMethod
  if (productKind === 'service') return 'NONE' as const
  if (productKind === 'consumable') return 'QUANTITY' as const
  return 'QUANTITY' as const
}

export function uniqueTargetLabel(meta: unknown): string {
  const target = (meta as { target?: string | string[] } | undefined)?.target
  const fields = Array.isArray(target) ? target : target ? [target] : []
  if (fields.some(f => /sku/i.test(String(f)))) return 'SKU'
  if (fields.some(f => /barcode/i.test(String(f)))) return 'barcode'
  return 'product identity'
}

/** Map driver/Prisma schema drift into an actionable publish error (not a generic 500). */
export function schemaDriftMessage(err: unknown): string | null {
  const anyErr = err as { code?: string; meta?: { column?: string }; message?: string } | null
  const message = String(anyErr?.message || '')
  const column = String(anyErr?.meta?.column || '')
  const missingColumn =
    anyErr?.code === 'P2022' ||
    /column ["'].*["'] of relation ["']products["'] does not exist/i.test(message) ||
    /column .* does not exist/i.test(message)
  if (!missingColumn) return null
  const hint = /tracking_method/i.test(`${column} ${message}`)
    ? ' Missing products.tracking_method — run scripts/apply-sql-as-postgres.sh database/migrations/20260625_inventory_foundation_safe.sql on the server.'
    : ''
  return `Database product schema is out of date.${hint}`.trim()
}

export function duplicateFieldLabel(
  duplicate: { name: string; sku: string; barcode: string | null },
  requestedSku: string,
  name: string,
) {
  if (requestedSku && duplicate.sku.toLowerCase() === requestedSku.toLowerCase()) return 'SKU' as const
  if (duplicate.name.toLowerCase() === name.toLowerCase()) return 'name' as const
  return 'barcode' as const
}

async function resolveCategoryId(category: string | null | undefined): Promise<string | undefined> {
  if (!category) return undefined
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(category)) {
    return category
  }
  const existing = await prisma.category.findFirst({ where: { name: { equals: category, mode: 'insensitive' } } })
  const row = existing ?? await prisma.category.create({ data: { name: category, isActive: true } })
  return row.id
}

export type PublishProductResult =
  | { status: 'created'; product: any }
  | { status: 'exists'; product: { id: string; name: string; sku: string; barcode: string | null }; field: 'SKU' | 'name' | 'barcode' }
  | { status: 'error'; message: string }

/** Check-if-exists then create. Used by single POST and bulk publish. */
export async function publishProduct(validated: ValidatedProductInput): Promise<PublishProductResult> {
  const requestedSku = validated.sku?.trim() || ''
  const barcode = validated.barcode?.trim() || null

  const trackingMethod = resolveTrackingMethod(validated.trackingMethod, validated.productKind, validated.category)
  const trackStock = validated.productKind === 'service' ? false : validated.trackStock
  // Explicit productType avoids Prisma @default(new), which mis-floors refurb Laptops/Desktops.
  const productType = validated.productType === 'new' ? 'new' : 'refurbished'
  const pricingCategoryId = validated.pricingCategoryId?.trim() || null
  // Client/Excel fields (salePrice, minStock, productKind, unit) map onto Prisma columns.
  // salePrice → sellingPrice, minStock → reorderLevel; kind/unit/pricing band live in specs JSON.
  const data: Record<string, unknown> = {
    name: validated.name,
    sku: requestedSku || await buildUniqueSku(validated.name),
    barcode,
    description: validated.description || null,
    productType,
    sellingPrice: validated.salePrice,
    costPrice: validated.costPrice,
    wholesalePrice: Number(validated.wholesalePrice) > 0 ? Number(validated.wholesalePrice) : null,
    commissionRatePercent: Number(validated.commissionRatePercent) > 0 ? Number(validated.commissionRatePercent) : null,
    reorderLevel: validated.minStock,
    trackStock,
    trackingMethod,
    isActive: validated.isActive,
    invoicePolicy: validated.invoicePolicy || 'order',
    specs: withCatalogDeviceConfig(
      {
        productKind: validated.productKind || null,
        unit: validated.unit || null,
        taxRatePct: validated.taxRate ?? 0,
        pricingCategoryId,
      },
      validated.name,
      validated.category,
      {
        totalRamGb: validated.deviceRamGb,
        primaryStorageGb: validated.deviceStorageGb,
        storageType: validated.deviceStorageType,
      },
    ),
  }

  const categoryId = await resolveCategoryId(validated.category)
  if (categoryId) data.categoryId = categoryId

  const createLocked = async (tx: {
    product: { findFirst: typeof prisma.product.findFirst; create: typeof prisma.product.create }
    $executeRawUnsafe?: (...args: any[]) => Promise<unknown>
  }): Promise<PublishProductResult> => {
    if (typeof tx.$executeRawUnsafe === 'function') {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        productIdentityLockKey(validated.name, requestedSku, barcode),
      )
    }
    const duplicate = await findProductDuplicate(validated.name, requestedSku, barcode, tx)
    if (duplicate) {
      return {
        status: 'exists',
        product: duplicate,
        field: duplicateFieldLabel(duplicate, requestedSku, validated.name),
      }
    }
    const created = await tx.product.create({ data: data as any })
    await createZeroStockLevel(tx as any, created.id)
    return { status: 'created', product: created }
  }

  try {
    return await prisma.$transaction(async tx => createLocked(tx as any))
  } catch (err: any) {
    const drift = schemaDriftMessage(err)
    if (drift) return { status: 'error', message: drift }

    if (err?.code === 'P2002') {
      // Re-check — another request may have won the race.
      const again = await findProductDuplicate(validated.name, requestedSku, barcode)
      if (again) {
        return {
          status: 'exists',
          product: again,
          field: duplicateFieldLabel(again, requestedSku, validated.name),
        }
      }
      if (!requestedSku) {
        data.sku = await buildUniqueSku(validated.name)
        try {
          const product = await prisma.$transaction(async tx => {
            const created = await tx.product.create({ data: data as any })
            await createZeroStockLevel(tx, created.id)
            return created
          })
          return { status: 'created', product }
        } catch (retryErr: any) {
          const retryDrift = schemaDriftMessage(retryErr)
          if (retryDrift) return { status: 'error', message: retryDrift }
          if (retryErr?.code === 'P2002') {
            return { status: 'error', message: `${uniqueTargetLabel(retryErr.meta)} is already in use` }
          }
          throw retryErr
        }
      }
      return {
        status: 'error',
        message: `${uniqueTargetLabel(err.meta)} "${requestedSku || barcode || validated.name}" is already in use`,
      }
    }
    throw err
  }
}

export function toClientProduct(product: any, categoryName?: string) {
  const specs = product?.specs && typeof product.specs === 'object' ? product.specs as Record<string, unknown> : {}
  return {
    ...product,
    salePrice: Number(product.sellingPrice ?? product.salePrice ?? 0),
    wholesalePrice: product.wholesalePrice != null ? Number(product.wholesalePrice) || 0 : undefined,
    commissionRatePercent: product.commissionRatePercent != null ? Number(product.commissionRatePercent) : undefined,
    minStock: Number(product.reorderLevel ?? product.minStock ?? 0),
    stockQty: product.stockQty ?? 0,
    productType: product.productType === 'new' ? 'new' : product.productType === 'refurbished' ? 'refurbished' : undefined,
    pricingCategoryId: typeof specs.pricingCategoryId === 'string' ? specs.pricingCategoryId : null,
    productKind: typeof specs.productKind === 'string' ? specs.productKind : undefined,
    unit: typeof specs.unit === 'string' ? specs.unit : product.unit,
    taxRate: Number(specs.taxRatePct ?? product.taxRate ?? 0),
    deviceConfig: deviceConfigFromProductSpecs(specs),
    category: product.category?.name
      ? product.category
      : categoryName
        ? { name: categoryName }
        : product.category,
  }
}
