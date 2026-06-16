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

async function mapBody(body: any) {
  const data: Record<string, any> = {}
  if (body.name       !== undefined) data.name         = String(body.name)
  if (body.sku        !== undefined) data.sku          = String(body.sku)
  if (body.barcode    !== undefined) data.barcode       = body.barcode || null
  if (body.description !== undefined) data.description = body.description || null
  if (body.shortDescription !== undefined) data.shortDescription = body.shortDescription || null
  if (body.salePrice  !== undefined) data.sellingPrice = Number(body.salePrice)
  else if (body.sellingPrice !== undefined) data.sellingPrice = Number(body.sellingPrice)
  if (body.costPrice  !== undefined) data.costPrice    = Number(body.costPrice)
  if (body.minStock   !== undefined) data.reorderLevel = Number(body.minStock)
  else if (body.reorderLevel !== undefined) data.reorderLevel = Number(body.reorderLevel)
  if (body.isActive   !== undefined) data.isActive     = Boolean(body.isActive)
  if (body.trackStock !== undefined) data.trackStock   = Boolean(body.trackStock)
  if (body.modelNumber !== undefined) data.modelNumber = body.modelNumber || null
  if (body.image !== undefined) data.primaryImageUrl = body.image || null

  // Handle category
  if (body.category !== undefined) {
    if (body.category && body.category.length !== 36) {
      // It's a human-readable category name, find or create it
      let category = await prisma.category.findFirst({
        where: { name: body.category, isActive: true },
      })
      if (!category) {
        category = await prisma.category.create({
          data: { name: body.category, isActive: true },
        })
      }
      data.categoryId = category.id
    } else if (body.category && body.category.length === 36) {
      // It's already a UUID
      data.categoryId = body.category
    }
  }

  // Handle tax rate
  if (body.taxRate !== undefined) {
    const taxRateNum = Number(body.taxRate ?? 16)
    let taxRate = await prisma.taxRate.findFirst({
      where: { rate: taxRateNum.toString(), isActive: true },
    })
    if (!taxRate) {
      taxRate = await prisma.taxRate.create({
        data: { 
          name: `${taxRateNum}% VAT`,
          rate: taxRateNum.toString(),
          taxType: 'vat',
          isActive: true,
        },
      })
    }
    data.taxRateId = taxRate.id
  }

  // Handle specs (warranty, account mapping, etc.)
  if (body.warrantyMonths !== undefined || body.saleAccountCode !== undefined) {
    const currentProduct = await prisma.product.findUnique({ where: { id: body._id } })
    const currentSpecs = currentProduct?.specs && typeof currentProduct.specs === 'object' && !Array.isArray(currentProduct.specs)
      ? currentProduct.specs as Record<string, any>
      : {}
    
    const newSpecs = { ...currentSpecs }
    if (body.warrantyMonths !== undefined) {
      newSpecs.warrantyMonths = Number(body.warrantyMonths)
    }
    
    if (body.saleAccountCode !== undefined || body.costAccountCode !== undefined || 
        body.inventoryAccountCode !== undefined || body.cogsAccountCode !== undefined) {
      newSpecs.accountMapping = {
        saleAccountCode: body.saleAccountCode || null,
        costAccountCode: body.costAccountCode || null,
        inventoryAccountCode: body.inventoryAccountCode || null,
        cogsAccountCode: body.cogsAccountCode || null,
        adjustmentAccountCode: body.adjustmentAccountCode || null,
        writeOffAccountCode: body.writeOffAccountCode || null,
      }
    }
    
    data.specs = newSpecs
  }

  return data
}

async function handleUpdate(request: NextRequest, id: string) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    body._id = id // Pass id to mapBody for specs handling
    const data = await mapBody(body)
    const duplicate = await findProductDuplicate(id, data.sku, data.barcode)
    if (duplicate) {
      const field = data.sku && duplicate.sku.toLowerCase() === String(data.sku).toLowerCase() ? 'SKU' : 'barcode'
      const value = field === 'SKU' ? data.sku : data.barcode
      return NextResponse.json(
        { error: `${field} "${value}" is already used by "${duplicate.name}"` },
        { status: 409 },
      )
    }
    const product = await prisma.product.update({ 
      where: { id }, 
      data,
      include: {
        category: true,
        taxRate: true,
      }
    })
    return NextResponse.json({
      ...product,
      salePrice: Number(product.sellingPrice),
      minStock: product.reorderLevel ?? 0,
      category: product.category?.name,
      taxRate: product.taxRate?.rate ? Number(product.taxRate.rate) : 16,
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
