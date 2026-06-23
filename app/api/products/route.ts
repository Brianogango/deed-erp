import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { productSchema, validate } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export type ApiProduct = {
  id: string; name: string; sku: string; barcode: string; category: string
  salePrice: number; costPrice: number; taxRate: number; stockQty: number
  minStock: number; unit: string; description?: string | null
  requiresSerial: boolean; warrantyMonths: number
  canBeSold: boolean; canBePurchased: boolean; image: string
  isActive: boolean; createdAt: string
}

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']
const STORE_CATEGORIES = ['Laptops', 'Desktops', 'Parts & Components', 'Accessories', 'Printers', 'Networking', 'Services'] as const
const CATEGORY_CONFIG: Record<typeof STORE_CATEGORIES[number], { serialRequired: boolean; trackStock: boolean }> = {
  Laptops: { serialRequired: true, trackStock: true },
  Desktops: { serialRequired: true, trackStock: true },
  'Parts & Components': { serialRequired: false, trackStock: true },
  Accessories: { serialRequired: false, trackStock: true },
  Printers: { serialRequired: true, trackStock: true },
  Networking: { serialRequired: true, trackStock: true },
  Services: { serialRequired: false, trackStock: false },
}
const productInclude = { category: true, taxRate: true, stockLevel: true, serials: true } as const

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const categoryFromName = (value: unknown, trackStock = true) => {
  const name = String(value ?? '').trim()
  const match = STORE_CATEGORIES.find(category => category.toLowerCase() === name.toLowerCase())
  if (match) return match
  return trackStock ? 'Parts & Components' : 'Services'
}
const toNumber = (value: unknown, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

async function resolveCategoryId(category: string | null | undefined) {
  const trimmed = category?.trim()
  if (!trimmed) return undefined
  if (isUuid(trimmed)) return trimmed

  const name = categoryFromName(trimmed)
  const existing = await prisma.category.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await prisma.category.create({
    data: { name },
    select: { id: true },
  })
  return created.id
}

function toApiProduct(product: any): ApiProduct {
  const category = categoryFromName(product.category?.name, product.trackStock !== false)
  const cfg = CATEGORY_CONFIG[category]
  const serialQty = Array.isArray(product.serials)
    ? product.serials.filter((serial: any) => serial.status === 'available').length
    : 0
  const stockQty = product.stockLevel?.qtyOnHand ?? serialQty

  return {
    id: String(product.id),
    name: String(product.name ?? ''),
    sku: String(product.sku ?? ''),
    barcode: String(product.barcode ?? ''),
    category,
    salePrice: toNumber(product.sellingPrice),
    costPrice: toNumber(product.costPrice),
    taxRate: toNumber(product.taxRate?.rate, 16),
    stockQty: toNumber(stockQty),
    minStock: toNumber(product.reorderLevel, 0),
    unit: product.trackStock === false ? 'service' : 'pcs',
    description: product.description ?? product.shortDescription ?? '',
    requiresSerial: cfg.serialRequired,
    warrantyMonths: 12,
    canBeSold: true,
    canBePurchased: true,
    image: '\u{1F4E6}',
    isActive: product.isActive !== false,
    createdAt: product.createdAt instanceof Date ? product.createdAt.toISOString() : String(product.createdAt ?? new Date().toISOString()),
  }
}

const skuSeed = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 24) || 'PRODUCT'

async function buildUniqueSku(name: string) {
  const base = skuSeed(name)
  let candidate = `${base}-${Date.now().toString(36).toUpperCase().slice(-6)}`
  let suffix = 1
  while (await prisma.product.findFirst({ where: { sku: { equals: candidate, mode: 'insensitive' } }, select: { id: true } })) {
    candidate = `${base}-${Date.now().toString(36).toUpperCase().slice(-6)}-${suffix++}`
  }
  return candidate
}

async function findProductDuplicate(name: string, sku?: string | null, barcode?: string | null) {
  const or: any[] = [
    { name: { equals: name, mode: 'insensitive' } },
  ]
  if (sku) or.push({ sku: { equals: sku, mode: 'insensitive' } })
  if (barcode) or.push({ barcode: { equals: barcode, mode: 'insensitive' } })
  return prisma.product.findFirst({
    where: { OR: or },
    select: { id: true, name: true, sku: true, barcode: true },
  })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const products = await prisma.product.findMany({
      include: productInclude,
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(products.map(toApiProduct))
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

    // Validate input using Zod schema
    const validated = await validate(productSchema, {
      ...body,
      salePrice: Number(body.salePrice ?? body.sellingPrice ?? 0),
      costPrice: Number(body.costPrice ?? 0),
      minStock: Number(body.minStock ?? body.reorderLevel ?? 5),
      taxRate: Number(body.taxRate ?? 16),
    })

    const requestedSku = validated.sku?.trim() || ''
    const storeCategory = categoryFromName(validated.category)
    const duplicate = await findProductDuplicate(validated.name, requestedSku, validated.barcode)
    if (duplicate) {
      const field = requestedSku && duplicate.sku.toLowerCase() === requestedSku.toLowerCase()
        ? 'SKU'
        : duplicate.name.toLowerCase() === validated.name.toLowerCase()
          ? 'name'
          : 'barcode'
      const value = field === 'SKU' ? requestedSku : field === 'name' ? validated.name : validated.barcode
      return NextResponse.json(
        { error: `${field} "${value}" is already used by "${duplicate.name}"` },
        { status: 409 },
      )
    }

    // Map to Prisma schema - note: category is a relationship in the schema
    const data: any = {
      name: validated.name,
      sku: requestedSku || await buildUniqueSku(validated.name),
      barcode: validated.barcode || null,
      description: validated.description || null,
      sellingPrice: validated.salePrice,
      costPrice: validated.costPrice,
      reorderLevel: validated.minStock,
      trackStock: body.trackStock !== undefined ? validated.trackStock : CATEGORY_CONFIG[storeCategory].trackStock,
    }

    const categoryId = await resolveCategoryId(validated.category)
    if (categoryId) data.categoryId = categoryId

    const product = await prisma.product.create({ data, include: productInclude })
    
    return NextResponse.json(
      toApiProduct(product),
      { status: 201 },
    )
  })
}
