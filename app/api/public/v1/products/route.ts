import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticatePartnerRequest, PUBLIC_API_CORS_HEADERS } from '@/lib/partner-api'
import { loadAppState } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

// ── Public partner catalog — GET /api/public/v1/products ─────────────────────
// Authenticated with a partner API key (Authorization: Bearer <key> or
// X-API-Key). Returns only reseller-safe fields: no cost prices, no supplier
// data, no internal accounts. "Ready for sale" means active, priced, and (by
// default) in stock.
//
// Query params:
//   page          1-based page number                     (default 1)
//   pageSize      items per page, max 100                 (default 50)
//   category      exact category name filter              (optional)
//   q             search in name/SKU/description          (optional)
//   inStock       'all' to include out-of-stock items     (default: in-stock only)

const json = (body: unknown, init?: ResponseInit) =>
  NextResponse.json(body, { ...init, headers: { ...PUBLIC_API_CORS_HEADERS, ...(init?.headers ?? {}) } })

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_API_CORS_HEADERS })
}

type JsonSerial = { productId?: string; status?: string }
type JsonBulkLevel = { productId?: string; qty?: number | string }
type JsonProduct = { id?: string; warrantyMonths?: number | string }

/** Units available per product, combining the relational stock tables with the
 *  synced JSON store (which is where serials/bulk levels currently live). */
async function availabilityByProduct(): Promise<Map<string, number>> {
  const [relSerials, stockLevels, appState] = await Promise.all([
    prisma.serialNumber.groupBy({
      by: ['productId'],
      where: { status: { in: ['in_stock', 'available'] } },
      _count: { _all: true },
    }).catch(() => [] as { productId: string; _count: { _all: number } }[]),
    prisma.stockLevel.findMany({ select: { productId: true, qtyOnHand: true, qtyReserved: true } }).catch(() => []),
    loadAppState(['deed_serials', 'deed_bulkStock']),
  ])

  const rel = new Map<string, number>()
  for (const row of relSerials) rel.set(row.productId, row._count._all)

  const jsonSerialCounts = new Map<string, number>()
  const jsonSerials = appState.deed_serials
  if (Array.isArray(jsonSerials)) {
    for (const s of jsonSerials as JsonSerial[]) {
      if (s?.status === 'available' && s.productId) {
        jsonSerialCounts.set(s.productId, (jsonSerialCounts.get(s.productId) ?? 0) + 1)
      }
    }
  }

  const bulk = new Map<string, number>()
  for (const level of stockLevels) {
    bulk.set(level.productId, (bulk.get(level.productId) ?? 0) + Math.max(0, level.qtyOnHand - level.qtyReserved))
  }
  const jsonBulk = appState.deed_bulkStock
  if (Array.isArray(jsonBulk)) {
    for (const level of jsonBulk as JsonBulkLevel[]) {
      const qty = Number(level?.qty) || 0
      if (level?.productId && qty > 0) bulk.set(level.productId, Math.max(bulk.get(level.productId) ?? 0, qty))
    }
  }

  const result = new Map<string, number>()
  const ids = new Set([...rel.keys(), ...jsonSerialCounts.keys(), ...bulk.keys()])
  for (const id of ids) {
    // Serialized stock may exist in both stores for the same units — take the
    // larger count rather than double-counting.
    const serialised = Math.max(rel.get(id) ?? 0, jsonSerialCounts.get(id) ?? 0)
    result.set(id, serialised + (bulk.get(id) ?? 0))
  }
  return result
}

export async function GET(request: Request) {
  const auth = await authenticatePartnerRequest(request)
  if (!auth.ok) return json({ error: auth.error }, { status: auth.status })

  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 50))
  const category = url.searchParams.get('category')?.trim() || null
  const q = url.searchParams.get('q')?.trim() || null
  const includeOutOfStock = url.searchParams.get('inStock') === 'all'

  const [rows, availability, appState] = await Promise.all([
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
        sellingPrice: true, updatedAt: true,
        category: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    availabilityByProduct(),
    loadAppState(['deed_products']),
  ])

  const warrantyById = new Map<string, number>()
  const jsonProducts = appState.deed_products
  if (Array.isArray(jsonProducts)) {
    for (const p of jsonProducts as JsonProduct[]) {
      const months = Number(p?.warrantyMonths)
      if (p?.id && Number.isFinite(months) && months > 0) warrantyById.set(p.id, months)
    }
  }

  const catalog = rows.map(row => {
    const quantityAvailable = availability.get(row.id) ?? 0
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
      inStock: quantityAvailable > 0,
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
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  )
}
