import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { ApiProduct } from '../route'

async function loadProducts(): Promise<ApiProduct[]> {
  const state = await loadAppState()
  const raw = state['deed_products']
  return Array.isArray(raw) ? (raw as ApiProduct[]) : []
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const products = await loadProducts()
  const idx = products.findIndex(p => p.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  products[idx] = { ...products[idx], ...(body as Partial<ApiProduct>), id: params.id }
  await saveStoreKeys({ deed_products: JSON.stringify(products) })

  return NextResponse.json({ product: products[idx] })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const products = await loadProducts()
  const filtered = products.filter(p => p.id !== params.id)
  if (filtered.length === products.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await saveStoreKeys({ deed_products: JSON.stringify(filtered) })
  return NextResponse.json({ ok: true })
}
