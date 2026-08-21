import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticatePartnerRequest, partnerCorsHeaders } from '@/lib/partner-api'
import { loadAppState } from '@/lib/server-store'
import { availableSellableQty, type BulkStockLevel, type SerialNumber, type StockProduct } from '@/lib/business-logic'
import type { LocationId } from '@/lib/store'

export const dynamic = 'force-dynamic'

// ── Public partner catalog — GET /api/public/v1/products ─────────────────────
// Authenticated with a partner API key (Authorization: Bearer <key> or
// X-API-Key). Returns only reseller-safe fields: no cost prices, no supplier
// data, no internal accounts. Default: active, priced, and quantityAvailable
// >= 1 using the same on-hand rule as Inventory (JSON available serials /
// sellable bulk), not leftover Prisma in_stock serials.
//
// Query params:
//   page          1-based page number                     (default 1)
//   pageSize      items per page, max 100                 (default 50)
//   category      exact category name filter              (optional)
//   q             search in name/SKU/description          (optional)
//   inStock       'all' to include out-of-stock items     (default: qty >= 1)

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
}

function asLocation(value: string | undefined): LocationId {
  return (value || 'warehouse') as LocationId
}

function partnerQtyForProduct(
  row: { id: string; trackingMethod?: string | null; category?: { name: string } | null },
  jsonProduct: JsonProduct | undefined,
  serials: SerialNumber[],
  bulkStock: BulkStockLevel[],
): number {
  const product: StockProduct = {
    trackingMethod: jsonProduct?.trackingMethod ?? row.trackingMethod,
    category: jsonProduct?.category ?? row.category?.name ?? null,
    requiresSerial: jsonProduct?.requiresSerial,
    unit: jsonProduct?.unit,
  }
  return availableSellableQty(product, serials, bulkStock, row.id)
}

export async function GET(request: Request) {
  const auth = await authenticatePartnerRequest(request)
  if (!auth.ok) return json({ error: auth.error }, request, { status: auth.status })

  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 50))
  const category = url.searchParams.get('category')?.trim() || null
  const q = url.searchParams.get('q')?.trim() || null
  const includeOutOfStock = url.searchParams.get('inStock') === 'all'

  const [rows, appState] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        sellingPrice: { gt: 0 },
        ...(category ? { category: { is: { name: { equals: category, mode: 'insensitive' } } } } : {}),
        ...(q ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id: true, sku: true, barcode: true, name: true, description: true,
        sellingPrice: true, updatedAt: true, trackingMethod: true,
        category: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock']),
  ])

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

  const catalog = rows.map(row => {
    const quantityAvailable = partnerQtyForProduct(row, jsonById.get(row.id), serials, bulkStock)
    return {
      id: row.id,
      sku: row.sku,
      barcode: row.barcode || null,
      name: row.name,
      description: row.description || '',
      category: row.category?.name ?? null,
      price: Number(row.sellingPrice) || 0,
      currency: 'KES',
      warrantyMonths: warrantyById.get(row.id) ?? null,
      quantityAvailable,
      inStock: quantityAvailable >= 1,
      updatedAt: row.updatedAt.toISOString(),
    }
  }).filter(item => includeOutOfStock || item.inStock)

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
