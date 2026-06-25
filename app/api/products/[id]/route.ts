import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

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
const toNumber = (value: unknown, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
const categoryFromName = (value: unknown, trackStock = true) => {
  const name = String(value ?? '').trim()
  const match = STORE_CATEGORIES.find(category => category.toLowerCase() === name.toLowerCase())
  if (match) return match
  return trackStock ? 'Parts & Components' : 'Services'
}

async function resolveCategoryId(category: unknown) {
  const trimmed = String(category ?? '').trim()
  if (!trimmed) return undefined
  if (isUuid(trimmed)) return trimmed
  const name = categoryFromName(trimmed)
  const existing = await prisma.category.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await prisma.category.create({ data: { name }, select: { id: true } })
  return created.id
}

function toApiProduct(product: any) {
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

async function mapBody(body: any) {
  const data: Record<string, any> = {}
  if (body.name       !== undefined) data.name         = String(body.name)
  if (body.sku        !== undefined) data.sku          = String(body.sku)
  if (body.barcode    !== undefined) data.barcode       = body.barcode || null
  if (body.description !== undefined) data.description = body.description || null
  if (body.salePrice  !== undefined) data.sellingPrice = Number(body.salePrice)
  else if (body.sellingPrice !== undefined) data.sellingPrice = Number(body.sellingPrice)
  if (body.costPrice  !== undefined) data.costPrice    = Number(body.costPrice)
  if (body.minStock   !== undefined) data.reorderLevel = Number(body.minStock)
  else if (body.reorderLevel !== undefined) data.reorderLevel = Number(body.reorderLevel)
  if (body.isActive   !== undefined) data.isActive     = Boolean(body.isActive)
  if (body.trackStock !== undefined) data.trackStock   = Boolean(body.trackStock)
  if (body.category !== undefined) {
    const category = categoryFromName(body.category)
    const categoryId = await resolveCategoryId(body.category)
    if (categoryId) data.categoryId = categoryId
    if (body.trackStock === undefined) data.trackStock = CATEGORY_CONFIG[category].trackStock
  }
  return data
}

async function handleUpdate(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    const data = await mapBody(body)
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
    const product = await prisma.product.update({ where: { id }, data, include: productInclude })
    return NextResponse.json(toApiProduct(product))
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
    await prisma.product.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  })
}
