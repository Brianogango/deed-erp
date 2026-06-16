import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

async function findProductDuplicate(id: string, sku?: string | null, barcode?: string | null) {
  const or: any[] = []
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
  return data
}

async function handleUpdate(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    const data = mapBody(body)
    const duplicate = await findProductDuplicate(id, data.sku, data.barcode)
    if (duplicate) {
      const field = data.sku && duplicate.sku.toLowerCase() === String(data.sku).toLowerCase() ? 'SKU' : 'barcode'
      const value = field === 'SKU' ? data.sku : data.barcode
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
    await prisma.product.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  })
}
