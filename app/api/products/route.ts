import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

// Shape mirrors lib/store.tsx Product type — keep in sync
export interface ApiProduct {
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
  description?: string
  requiresSerial: boolean
  warrantyMonths: number
  active: boolean
}

function loadProducts(): ApiProduct[] {
  const state = loadAppState()
  const raw = state['deed_products']
  if (!Array.isArray(raw)) return []
  return raw as ApiProduct[]
}

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.toLowerCase()
  const category = searchParams.get('category')

  let products = loadProducts()
  if (q) products = products.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
  if (category) products = products.filter(p => p.category === category)

  return NextResponse.json({ products, total: products.length })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const products = loadProducts()
  const input = body as Partial<ApiProduct>

  const newProduct: ApiProduct = {
    id: `prod_${Date.now()}`,
    name: String(input.name ?? ''),
    sku: String(input.sku ?? ''),
    category: String(input.category ?? 'Accessories'),
    salePrice: Number(input.salePrice ?? 0),
    costPrice: Number(input.costPrice ?? 0),
    taxRate: Number(input.taxRate ?? 16),
    stockQty: Number(input.stockQty ?? 0),
    minStock: Number(input.minStock ?? 0),
    unit: String(input.unit ?? 'unit'),
    description: input.description,
    requiresSerial: Boolean(input.requiresSerial),
    warrantyMonths: Number(input.warrantyMonths ?? 0),
    active: true,
  }

  if (!newProduct.name || !newProduct.sku) {
    return NextResponse.json({ error: 'name and sku are required' }, { status: 422 })
  }

  products.push(newProduct)
  saveStoreKeys({ deed_products: JSON.stringify(products) })

  return NextResponse.json({ product: newProduct }, { status: 201 })
}
