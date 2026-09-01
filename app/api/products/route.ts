import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { productSchema, validate } from '@/lib/validation'
import { publishProduct, toClientProduct } from '@/lib/product-catalog-write'
import { parsePaginationParams, paginatedResponse } from '@/lib/api-pagination'

export const dynamic = 'force-dynamic'

export type ApiProduct = {
  id: string; name: string; sku: string; category: string
  salePrice: number; costPrice: number; taxRate: number; stockQty: number
  minStock: number; unit: string; description?: string | null
  requiresSerial: boolean; warrantyMonths: number
  canBeSold: boolean; canBePurchased: boolean; isActive: boolean; createdAt: string
}

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const url = new URL(request.url)
    const searchParams = url.searchParams
    // Catalog boot / merge never reads serial rows — skip them to cut payload size.
    const lite = searchParams.get('lite') === '1' || searchParams.get('lite') === 'true'
    const include = lite
      ? {
        category: { select: { name: true } },
        images: { select: { imageUrl: true, isPrimary: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } as const },
      }
      : {
        serials: true,
        category: { select: { name: true } },
        images: { select: { imageUrl: true, isPrimary: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } as const },
      }

    // Opt-in paginated mode: any pagination/filter param switches the response
    // to the shared { items, total, page, limit, totalPages } envelope with the
    // filtering pushed down to Postgres. The bare (?lite=1) boot path keeps the
    // legacy raw-array shape — store hydration and catalog-merge depend on it.
    const paged = ['page', 'limit', 'pageSize', 'q', 'category', 'active', 'kilimall']
      .some(key => searchParams.has(key))
    if (!paged) {
      const products = await prisma.product.findMany({ include, orderBy: { name: 'asc' } })
      return NextResponse.json(products)
    }

    // Accept pageSize as an alias for the shared contract's limit.
    if (!searchParams.has('limit') && searchParams.has('pageSize')) {
      searchParams.set('limit', searchParams.get('pageSize')!)
    }
    const { page, limit, skip, sort, order } = parsePaginationParams(searchParams, {
      defaultSort: 'name',
      allowedSorts: ['name', 'sku', 'sellingPrice', 'costPrice', 'createdAt', 'updatedAt'],
    })

    const q = searchParams.get('q')?.trim()
    const category = searchParams.get('category')?.trim()
    const active = searchParams.get('active')
    const where: Record<string, unknown> = {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { sku: { contains: q, mode: 'insensitive' } },
              { barcode: { contains: q, mode: 'insensitive' } },
              { modelNumber: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(category ? { category: { is: { name: { equals: category, mode: 'insensitive' } } } } : {}),
      ...(active === 'true' || active === 'false' ? { isActive: active === 'true' } : {}),
      ...(searchParams.has('kilimall')
        ? { isListedKilimall: searchParams.get('kilimall') !== 'false' }
        : {}),
    }

    // A catalog reads A→Z by default; only an explicit sort/order falls back
    // to the shared contract's recency-first default.
    const orderBy = {
      [sort ?? 'name']: searchParams.has('sort') || searchParams.has('order') ? order : 'asc',
    }
    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include,
        orderBy,
        skip,
        take: limit,
      }),
    ])
    return NextResponse.json(paginatedResponse(products, total, page, limit))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 })
    }

    const validated = await validate(productSchema, {
      ...body,
      salePrice: Number(body.salePrice ?? body.sellingPrice ?? 0),
      costPrice: Number(body.costPrice ?? 0),
      wholesalePrice: body.wholesalePrice === '' || body.wholesalePrice == null
        ? undefined
        : Number(body.wholesalePrice),
      commissionRatePercent: body.commissionRatePercent === '' || body.commissionRatePercent == null
        ? undefined
        : Number(body.commissionRatePercent),
      minStock: Number(body.minStock ?? body.reorderLevel ?? 5),
      taxRate: Number(body.taxRate ?? 0),
    })

    const result = await publishProduct(validated)
    if (result.status === 'exists') {
      const value = result.field === 'SKU'
        ? validated.sku
        : result.field === 'name'
          ? validated.name
          : validated.barcode
      return NextResponse.json(
        { error: `${result.field} "${value}" is already used by "${result.product.name}"` },
        { status: 409 },
      )
    }
    if (result.status === 'error') {
      const schemaIssue = /schema is out of date|tracking_method/i.test(result.message)
      return NextResponse.json(
        { error: result.message },
        { status: schemaIssue ? 503 : 409 },
      )
    }

    return NextResponse.json(toClientProduct(result.product), { status: 201 })
  })
}
