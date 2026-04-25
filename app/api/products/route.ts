import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export type ApiProduct = {
  id: string
  name: string
  sku: string
  category: string
  salePrice: number
  costPrice: number
  taxRate: number
  stockQty: number
  minStock: number
  unit: string
  description?: string | null
  requiresSerial: boolean
  warrantyMonths: number
  canBeSold: boolean
  canBePurchased: boolean
  isActive: boolean
  createdAt: string
}

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      include: { serials: true },
      orderBy: { name: 'asc' }
    })
    return NextResponse.json(products)
  } catch (error) {
    console.error('Failed to fetch products:', error)
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const product = await prisma.product.create({
      data: {
        ...body,
        stockQty: body.stockQty || 0,
      }
    })
    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    console.error('Failed to create product:', error)
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 })
  }
}