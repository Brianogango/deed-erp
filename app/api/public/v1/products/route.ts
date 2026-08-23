import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticatePartnerRequest, partnerCorsHeaders } from '@/lib/partner-api'
import { loadAppState } from '@/lib/server-store'
import { availableSellableQty, isListedInPartnerCatalog, type BulkStockLevel, type SerialNumber, type StockProduct } from '@/lib/business-logic'
import type { LocationId } from '@/lib/store'
import { resolveResellerPrice } from '@/lib/pricing/reseller-price'
import { loadServerMarginPolicy } from '@/lib/pricing/sync-product-list-from-cost.server'
import { partnerImagesFromSlots, type ProductImageSlot } from '@/lib/product-images'
import { matchCatalogPhotoPack } from '@/lib/catalog-photos'

export const dynamic = 'force-dynamic'

// ── Public partner catalog — GET /api/public/v1/products ─────────────────────
// Authenticated with a partner API key (Authorization: Bearer <key> or
// X-API-Key). Returns only reseller-safe fields: no cost prices, no supplier
// data, no internal accounts. `price` is wholesale / reseller (saved wholesale
// or min GP band from cost) — never walk-in retail. Default: active, priced
// SKUs including warehouse qty 0 so partners can list vendor-sourced items.
// Blocked categories are omitted. `quantityAvailable` is Warehouse (Main)
// only. `inStock` is true when that qty is >= 1. `inStock=all` is ignored.
//
// Query params:
//   page          1-based page number                     (default 1)
//   pageSize      items per page, max 100                 (default 50)
//   category      exact category name filter              (optional)
//   q             search in name/SKU/description          (optional)

const json = (body: unknown, request: Request, init?: ResponseInit) =>
  NextResponse.json(body, {
    ...init,
    headers: { ...partnerCorsHeaders(request), ...(init?.headers ?? {}) },
  })

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: partnerCorsHeaders(request) })
}

type JsonSerial = { productId?: string; status?: string; location?: string }
type JsonBulkLevel = { productId?: string; location?: string; qty?: number | string }
type JsonProduct = {
  id?: string
  warrantyMonths?: number | string
  unit?: string
  requiresSerial?: boolean
  trackingMethod?: string
  category?: string
  costPrice?: number | string
  wholesalePrice?: number | string
  salePrice?: number | string
  sellingPrice?: number | string
  pricingCategoryId?: string
  productType?: string
  productKind?: string
  isActive?: boolean
  canBeSold?: boolean
}

function specsRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function asLocation(value: string | undefined): LocationId {
  return (value || 'warehouse') as LocationId
}

function partnerStockProduct(
  row: { id: string; trackingMethod?: string | null; category?: { name: string } | null },
  jsonProduct: JsonProduct | undefined,
): StockProduct & { isActive?: boolean; canBeSold?: boolean } {
  return {
    trackingMethod: jsonProduct?.trackingMethod ?? row.trackingMethod,
    category: jsonProduct?.category ?? row.category?.name ?? null,
    requiresSerial: jsonProduct?.requiresSerial,
    unit: jsonProduct?.unit,
    isActive: jsonProduct?.isActive,
    canBeSold: jsonProduct?.canBeSold,
  }
}

export async function GET(request: Request) {
  const auth = await authenticatePartnerRequest(request)
  if (!auth.ok) return json({ error: auth.error }, request, { status: auth.status })

  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 50))
  const category = url.searchParams.get('category')?.trim() || null
  const q = url.searchParams.get('q')?.trim() || null

  const [rows, appState, { policy }] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { wholesalePrice: { gt: 0 } },
          { costPrice: { gt: 0 } },
        ],
        ...(category ? { category: { is: { name: { equals: category, mode: 'insensitive' } } } } : {}),
        ...(q ? {
          AND: [{
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { sku: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          }],
        } : {}),
      },
      select: {
        id: true, sku: true, barcode: true, name: true, description: true,
        sellingPrice: true, costPrice: true, wholesalePrice: true,
        productType: true, specs: true, updatedAt: true, trackingMethod: true,
        category: { select: { name: true } },
        images: { select: { sortOrder: true, isPrimary: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { name: 'asc' },
    }),
    loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_companySettings']),
    loadServerMarginPolicy(),
  ])

  // Merchant-hidden categories: whole categories (e.g. Parts, Components,
  // Accessories) the merchant chose to keep out of the reseller feed. Matched
  // case-insensitively by category name. Empty/unset → nothing hidden.
  const companySettings = appState.deed_companySettings as { partnerHiddenCategories?: unknown } | undefined
  const hiddenCategories = new Set(
    (Array.isArray(companySettings?.partnerHiddenCategories) ? companySettings!.partnerHiddenCategories : [])
      .map(name => String(name).trim().toLowerCase())
      .filter(Boolean),
  )

  const jsonById = new Map<string, JsonProduct>()
  const warrantyById = new Map<string, number>()
  const jsonProducts = appState.deed_products
  if (Array.isArray(jsonProducts)) {
    for (const p of jsonProducts as JsonProduct[]) {
      if (!p?.id) continue
      jsonById.set(p.id, p)
      const months = Number(p.warrantyMonths)
      if (Number.isFinite(months) && months > 0) warrantyById.set(p.id, months)
    }
  }

  const serials: SerialNumber[] = Array.isArray(appState.deed_serials)
    ? (appState.deed_serials as JsonSerial[])
        .filter((s): s is JsonSerial & { productId: string } => Boolean(s?.productId))
        .map(s => ({
          productId: s.productId,
          status: String(s.status || ''),
          location: asLocation(s.location),
        }))
    : []

  const bulkStock: BulkStockLevel[] = Array.isArray(appState.deed_bulkStock)
    ? (appState.deed_bulkStock as JsonBulkLevel[])
        .filter((level): level is JsonBulkLevel & { productId: string } => Boolean(level?.productId))
        .map(level => ({
          productId: level.productId,
          location: asLocation(level.location),
          qty: Math.max(0, Number(level.qty) || 0),
        }))
    : []

  const catalog = rows.flatMap(row => {
    const jsonProduct = jsonById.get(row.id)
    // Drop whole categories the merchant hid from the partner feed.
    const effectiveCategory = jsonProduct?.category ?? row.category?.name ?? null
    if (effectiveCategory && hiddenCategories.has(effectiveCategory.trim().toLowerCase())) return []
    const specs = specsRecord(row.specs)
    const jsonPricingBand = typeof jsonProduct?.pricingCategoryId === 'string' ? jsonProduct.pricingCategoryId : null
    const specPricingBand = typeof specs.pricingCategoryId === 'string' ? specs.pricingCategoryId : null
    const reseller = resolveResellerPrice({
      cost: jsonProduct?.costPrice ?? Number(row.costPrice),
      salePrice: jsonProduct?.salePrice ?? jsonProduct?.sellingPrice ?? Number(row.sellingPrice),
      wholesalePrice: jsonProduct?.wholesalePrice ?? (row.wholesalePrice != null ? Number(row.wholesalePrice) : null),
      category: jsonProduct?.category ?? row.category?.name,
      pricingCategoryId: jsonPricingBand || specPricingBand,
      productType: jsonProduct?.productType ?? row.productType,
      productKind: jsonProduct?.productKind ?? (typeof specs.productKind === 'string' ? specs.productKind : null),
      unit: jsonProduct?.unit ?? (typeof specs.unit === 'string' ? specs.unit : null),
      policy,
    })
    if (!reseller) return []
    const stockProduct = partnerStockProduct(row, jsonProduct)
    if (!isListedInPartnerCatalog(stockProduct)) return []
    const quantityAvailable = availableSellableQty(stockProduct, serials, bulkStock, row.id)
    const uploaded: Partial<Record<ProductImageSlot, boolean>> = {}
    for (const image of row.images ?? []) {
      const slot = image.sortOrder === 2 ? 2 : image.isPrimary || image.sortOrder === 1 ? 1 : null
      if (slot) uploaded[slot] = true
    }
    const pack = Object.keys(uploaded).length ? null : matchCatalogPhotoPack(row.name, row.sku)
    return [{
      id: row.id,
      sku: row.sku,
      barcode: row.barcode || null,
      name: row.name,
      description: row.description || '',
      category: row.category?.name ?? null,
      price: reseller.price,
      currency: 'KES',
      warrantyMonths: warrantyById.get(row.id) ?? null,
      quantityAvailable,
      inStock: quantityAvailable >= 1,
      images: partnerImagesFromSlots(row.id, uploaded, pack?.id ?? null),
      updatedAt: row.updatedAt.toISOString(),
    }]
  })

  const total = catalog.length
  const items = catalog.slice((page - 1) * pageSize, page * pageSize)

  return json(
    {
      items,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      meta: { currency: 'KES', generatedAt: new Date().toISOString() },
    },
    request,
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  )
}
