import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { inferTrackingMethod, isStockTracked } from '@/lib/inventory-identifiers'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

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

function mapBody(body: any) {
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
  if (body.trackingMethod !== undefined) data.trackingMethod = body.trackingMethod
  return data
}

async function handleUpdate(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    const data = mapBody(body)
    const current = await prisma.product.findUnique({
      where: { id },
      select: { id: true, trackingMethod: true, trackStock: true },
    })
    if (!current) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const hasTrackingPatch = data.trackingMethod !== undefined
    const nextTracking = hasTrackingPatch
      ? inferTrackingMethod({
          trackingMethod: data.trackingMethod,
          category: body.category,
          requiresSerial: body.requiresSerial,
          unit: body.unit,
        })
      : (current.trackingMethod as any)
    if ((current.trackingMethod ?? null) !== nextTracking) {
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
          { error: 'Tracking method cannot be changed after stock or transactions exist. Use admin migration flow.' },
          { status: 409 },
        )
      }
      data.trackStock = isStockTracked(nextTracking)
      data.trackingMethod = nextTracking
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
    const product = await prisma.product.update({ where: { id }, data })
    return NextResponse.json({
      ...product,
      salePrice: Number(product.sellingPrice),
      minStock: product.reorderLevel ?? 0,
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
