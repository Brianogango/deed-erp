import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { CATEGORY_CONFIG } from '@/lib/store'

// GET /api/products?q=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')

  const products = await prisma.product.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { sku: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(products)
}

// POST /api/products
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, sku, category, salePrice, costPrice, taxRate, minStock, description, canBeSold, canBePurchased, isActive, warrantyMonths } = body

    if (!name || !sku || !category) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const catCfg = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG] ?? { serialRequired: false, trackStock: true }

    const product = await prisma.product.create({
      data: {
        ...body,
        requiresSerial: catCfg.serialRequired,
        unit: catCfg.trackStock ? 'pcs' : 'service',
      },
    })
    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    console.error('[API_PRODUCTS_POST]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}