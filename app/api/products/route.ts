import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { productSchema, validate } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export type ApiProduct = {
  id: string; name: string; sku: string; category: string
  salePrice: number; costPrice: number; taxRate: number; stockQty: number
  minStock: number; unit: string; description?: string | null
  requiresSerial: boolean; warrantyMonths: number
  canBeSold: boolean; canBePurchased: boolean; isActive: boolean; createdAt: string
}

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

async function findProductDuplicate(sku: string, barcode?: string | null) {
  const or: any[] = [{ sku: { equals: sku, mode: 'insensitive' } }]
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
      include: { serials: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(products)
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

    const duplicate = await findProductDuplicate(validated.sku, validated.barcode)
    if (duplicate) {
      const field = duplicate.sku.toLowerCase() === validated.sku.toLowerCase() ? 'SKU' : 'barcode'
      const value = field === 'SKU' ? validated.sku : validated.barcode
      return NextResponse.json(
        { error: `${field} "${value}" is already used by "${duplicate.name}"` },
        { status: 409 },
      )
    }

    // Map to Prisma schema - note: category is a relationship in the schema
    const data: any = {
      name: validated.name,
      sku: validated.sku,
      barcode: validated.barcode || null,
      description: validated.description || null,
      sellingPrice: validated.salePrice,
      costPrice: validated.costPrice,
      reorderLevel: validated.minStock,
      trackStock: validated.trackStock,
    }

    // If category is a UUID, link it; otherwise we might need to find or create it.
    // For now, we'll assume the frontend sends a categoryId if it's a UUID.
    if (validated.category && validated.category.length === 36) {
      data.categoryId = validated.category
    }

    const product = await prisma.product.create({ data })
    
    return NextResponse.json(
      {
        ...product,
        salePrice: product.sellingPrice,
        minStock: product.reorderLevel ?? 0,
        stockQty: 0,
      },
      { status: 201 },
    )
  })
}
