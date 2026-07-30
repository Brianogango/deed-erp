import prisma from '@/lib/prisma'
import type { z } from 'zod'
import type { productSchema } from '@/lib/validation'

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

export async function findProductDuplicate(name: string, sku?: string | null, barcode?: string | null) {
  const or: Record<string, unknown>[] = [
    { name: { equals: name, mode: 'insensitive' } },
  ]
  if (sku) or.push({ sku: { equals: sku, mode: 'insensitive' } })
  if (barcode) or.push({ barcode: { equals: barcode, mode: 'insensitive' } })
  return prisma.product.findFirst({
    where: { OR: or },
    select: { id: true, name: true, sku: true, barcode: true },
  })
}

export function resolveTrackingMethod(
  trackingMethod: 'NONE' | 'QUANTITY' | 'BATCH' | 'SERIAL' | null | undefined,
  productKind: 'storable' | 'consumable' | 'service' | null | undefined,
) {
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
  const duplicate = await findProductDuplicate(validated.name, requestedSku, barcode)
  if (duplicate) {
    return {
      status: 'exists',
      product: duplicate,
      field: duplicateFieldLabel(duplicate, requestedSku, validated.name),
    }
  }

  const trackingMethod = resolveTrackingMethod(validated.trackingMethod, validated.productKind)
  const trackStock = validated.productKind === 'service' ? false : validated.trackStock
  const data: Record<string, unknown> = {
    name: validated.name,
    sku: requestedSku || await buildUniqueSku(validated.name),
    barcode,
    description: validated.description || null,
    sellingPrice: validated.salePrice,
    costPrice: validated.costPrice,
    reorderLevel: validated.minStock,
    trackStock,
    trackingMethod,
    isActive: validated.isActive,
    invoicePolicy: validated.invoicePolicy || 'order',
  }

  const categoryId = await resolveCategoryId(validated.category)
  if (categoryId) data.categoryId = categoryId

  try {
    const product = await prisma.product.create({ data: data as any })
    return { status: 'created', product }
  } catch (err: any) {
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
          const product = await prisma.product.create({ data: data as any })
          return { status: 'created', product }
        } catch (retryErr: any) {
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
  return {
    ...product,
    salePrice: Number(product.sellingPrice ?? product.salePrice ?? 0),
    minStock: Number(product.reorderLevel ?? product.minStock ?? 0),
    stockQty: product.stockQty ?? 0,
    category: product.category?.name
      ? product.category
      : categoryName
        ? { name: categoryName }
        : product.category,
  }
}
