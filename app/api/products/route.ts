import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { productSchema, validate } from '@/lib/validation'
import { publishProduct, toClientProduct } from '@/lib/product-catalog-write'

export const dynamic = 'force-dynamic'

export type ApiProduct = {
  id: string; name: string; sku: string; category: string
  salePrice: number; costPrice: number; taxRate: number; stockQty: number
  minStock: number; unit: string; description?: string | null
  requiresSerial: boolean; warrantyMonths: number
  canBeSold: boolean; canBePurchased: boolean; isActive: boolean; createdAt: string
}

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const products = await prisma.product.findMany({
      include: { serials: true, category: { select: { name: true } } },
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

    const validated = await validate(productSchema, {
      ...body,
      salePrice: Number(body.salePrice ?? body.sellingPrice ?? 0),
      costPrice: Number(body.costPrice ?? 0),
      minStock: Number(body.minStock ?? body.reorderLevel ?? 5),
      taxRate: Number(body.taxRate ?? 16),
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
