import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { isSerialOnlyCategory } from '@/lib/inventory-identifiers'
import { resolveListSaleFromMargin } from '@/lib/pricing/apply-margin-sale-price'
import { loadServerMarginPolicy } from '@/lib/pricing/sync-product-list-from-cost.server'
import { deviceConfigFromProductSpecs, withCatalogDeviceConfig } from '@/lib/reconfiguration/unit-config'
import { productUpdateSchema, validate } from '@/lib/validation'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead', 'finance_officer']

async function findProductDuplicate(id: string, name?: string | null, sku?: string | null, barcode?: string | null) {
  const or: any[] = []
  if (name) or.push({ name: { equals: name, mode: 'insensitive' } })
  if (sku) or.push({ sku: { equals: sku, mode: 'insensitive' } })
  if (barcode) or.push({ barcode: { equals: barcode, mode: 'insensitive' } })
  if (or.length === 0) return null
  return prisma.product.findFirst({
    where: { id: { not: id }, OR: or },
    select: { id: true, name: true, sku: true, barcode: true },
  })
}

function asSpecs(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
}

function mapBody(body: any, existingSpecs: Record<string, unknown>) {
  const data: Record<string, any> = {}
  if (body.name       !== undefined) data.name         = String(body.name)
  if (body.sku        !== undefined) data.sku          = String(body.sku)
  if (body.barcode    !== undefined) data.barcode       = body.barcode || null
  if (body.description !== undefined) data.description = body.description || null
  if (body.salePrice  !== undefined) data.sellingPrice = Number(body.salePrice)
  else if (body.sellingPrice !== undefined) data.sellingPrice = Number(body.sellingPrice)
  if (body.costPrice  !== undefined) data.costPrice    = Number(body.costPrice)
  if (body.wholesalePrice !== undefined) {
    const wholesale = Number(body.wholesalePrice)
    data.wholesalePrice = Number.isFinite(wholesale) && wholesale > 0 ? wholesale : null
  }
  if (body.commissionRatePercent !== undefined) {
    const rate = Number(body.commissionRatePercent)
    data.commissionRatePercent = Number.isFinite(rate) && rate > 0 ? rate : null
  }
  if (body.minStock   !== undefined) data.reorderLevel = Number(body.minStock)
  else if (body.reorderLevel !== undefined) data.reorderLevel = Number(body.reorderLevel)
  if (body.isActive   !== undefined) data.isActive     = Boolean(body.isActive)
  if (body.trackStock !== undefined) data.trackStock   = Boolean(body.trackStock)
  if (body.productType !== undefined) {
    const t = String(body.productType).toLowerCase()
    if (t === 'new' || t === 'refurbished') data.productType = t
  }
  if (body.trackingMethod !== undefined) {
    const method = String(body.trackingMethod).toUpperCase()
    if (method === 'NONE' || method === 'QUANTITY' || method === 'BATCH' || method === 'SERIAL') {
      data.trackingMethod = method
    }
  }
  if (body.invoicePolicy !== undefined) {
    const policy = String(body.invoicePolicy)
    if (policy === 'order' || policy === 'delivery') data.invoicePolicy = policy
  }

  const specs = asSpecs(existingSpecs)
  let specsChanged = false
  if (body.productKind !== undefined) {
    specs.productKind = body.productKind || null
    specsChanged = true
  }
  if (body.unit !== undefined) {
    specs.unit = body.unit || null
    specsChanged = true
  }
  if (body.taxRate !== undefined) {
    specs.taxRatePct = Number(body.taxRate)
    specsChanged = true
  }
  if (body.pricingCategoryId !== undefined) {
    const band = String(body.pricingCategoryId || '').trim()
    specs.pricingCategoryId = band || null
    specsChanged = true
  }
  if (specsChanged) data.specs = specs

  return data
}

async function handleUpdate(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const rawBody = await request.json()
    const body = await validate(productUpdateSchema, rawBody)
    const existing = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        costPrice: true,
        sellingPrice: true,
        productType: true,
        specs: true,
        category: { select: { name: true } },
      },
    })
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const data = mapBody(body, asSpecs(existing.specs))
    const categoryName = body.category ?? existing.category?.name
    if (isSerialOnlyCategory(categoryName)) {
      data.trackingMethod = 'SERIAL'
    }

    const nameForConfig = data.name != null ? String(data.name) : existing.name
    const deviceRamGb = body.deviceRamGb != null ? Number(body.deviceRamGb) : undefined
    const deviceStorageGb = body.deviceStorageGb != null ? Number(body.deviceStorageGb) : undefined
    const deviceStorageType = body.deviceStorageType != null ? String(body.deviceStorageType) : undefined
    const shouldRefreshDeviceConfig =
      body.name !== undefined
      || body.category !== undefined
      || body.deviceRamGb !== undefined
      || body.deviceStorageGb !== undefined
      || body.deviceStorageType !== undefined
    if (shouldRefreshDeviceConfig) {
      data.specs = withCatalogDeviceConfig(
        asSpecs(data.specs ?? existing.specs),
        nameForConfig,
        categoryName,
        {
          totalRamGb: deviceRamGb,
          primaryStorageGb: deviceStorageGb,
          storageType: deviceStorageType,
        },
      )
    }

    const duplicate = await findProductDuplicate(id, data.name, data.sku, data.barcode)
    if (duplicate) {
      const field = data.sku && duplicate.sku.toLowerCase() === String(data.sku).toLowerCase()
        ? 'SKU'
        : data.name && duplicate.name.toLowerCase() === String(data.name).toLowerCase()
          ? 'name'
          : 'barcode'
      const value = field === 'SKU' ? data.sku : field === 'name' ? data.name : data.barcode
      return NextResponse.json(
        { error: `${field} "${value}" is already used by "${duplicate.name}"` },
        { status: 409 },
      )
    }

    // When cost changes and caller did not send an explicit sale, refresh list from margin policy.
    const costChanging = body.costPrice !== undefined && Number(body.costPrice) !== Number(existing.costPrice)
    const saleExplicit = body.salePrice !== undefined || body.sellingPrice !== undefined
    if (costChanging && !saleExplicit) {
      const specs = asSpecs(data.specs ?? existing.specs)
      const { policy, legacyMarkupMap } = await loadServerMarginPolicy()
      const resolved = resolveListSaleFromMargin({
        costPrice: Number(body.costPrice),
        erpCategory: categoryName,
        pricingCategoryId: typeof specs.pricingCategoryId === 'string' ? specs.pricingCategoryId : null,
        productType: data.productType ?? existing.productType,
        productKind: typeof specs.productKind === 'string' ? specs.productKind : null,
        unit: typeof specs.unit === 'string' ? specs.unit : null,
        policy,
        legacyMarkupMap,
      })
      if (resolved.salePrice != null) data.sellingPrice = resolved.salePrice
    }

    const product = await prisma.product.update({ where: { id }, data })
    const specs = asSpecs(product.specs)
    return NextResponse.json({
      ...product,
      salePrice: Number(product.sellingPrice),
      minStock: product.reorderLevel ?? 0,
      productType: product.productType,
      pricingCategoryId: typeof specs.pricingCategoryId === 'string' ? specs.pricingCategoryId : null,
      productKind: typeof specs.productKind === 'string' ? specs.productKind : null,
      taxRate: Number(specs.taxRatePct ?? 0),
      unit: typeof specs.unit === 'string' ? specs.unit : undefined,
      deviceConfig: deviceConfigFromProductSpecs(specs),
    })
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return handleUpdate(request, params.id)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return handleUpdate(request, params.id)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const id = params.id
    const [stockLevel, serialCount, movementCount, poLineCount, saleLineCount, invoiceLineCount] = await Promise.all([
      prisma.stockLevel.findUnique({ where: { productId: id }, select: { qtyOnHand: true, qtyReserved: true, qtyOnOrder: true } }),
      prisma.serialNumber.count({ where: { productId: id } }),
      prisma.stockMovement.count({ where: { productId: id } }),
      prisma.purchaseOrderItem.count({ where: { productId: id } }),
      prisma.saleOrderItem.count({ where: { productId: id } }),
      prisma.invoiceItem.count({ where: { productId: id } }),
    ])
    const hasStock = !!stockLevel && (stockLevel.qtyOnHand > 0 || stockLevel.qtyReserved > 0 || stockLevel.qtyOnOrder > 0)
    const hasTransactions = serialCount > 0 || movementCount > 0 || poLineCount > 0 || saleLineCount > 0 || invoiceLineCount > 0
    if (hasStock || hasTransactions) {
      return NextResponse.json(
        { error: 'Cannot delete product master with stock or transactions. Archive it instead.' },
        { status: 409 },
      )
    }
    await prisma.product.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  })
}
