import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

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
      include: { serials: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(products)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()

    // Map store field names to Prisma schema field names
    const data: Record<string, unknown> = {
      name: body.name,
      sku: body.sku,
      barcode: body.barcode || null,
      description: body.description || null,
      // Store uses salePrice; Prisma schema uses sellingPrice
      sellingPrice: Number(body.salePrice ?? body.sellingPrice ?? 0),
      costPrice: Number(body.costPrice ?? 0),
      // Store uses minStock; Prisma schema uses reorderLevel
      reorderLevel: Number(body.minStock ?? body.reorderLevel ?? 0),
      isActive: body.isActive !== false,
      trackStock: body.trackStock !== false,
    }

    // Strip undefined/null keys to avoid Prisma validation errors on required fields
    Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k] })

    const product = await prisma.product.create({ data: data as any })
    return NextResponse.json(
      // Return using store field names so the client can map cleanly
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
