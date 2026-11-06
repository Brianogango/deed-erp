import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { productSchema } from '@/lib/validation'
import { publishProduct, toClientProduct } from '@/lib/product-catalog-write'
import { PLACEHOLDER_KINDS, placeholderProductName, type PlaceholderKind } from '@/lib/refurbishment/unidentified'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'technical_lead', 'admin_officer', 'inventory_officer']

/**
 * POST { kind } — the "<Device> — unidentified" product unknown machines are
 * filed under until the bench finds their model. Created once, then reused.
 * It has no price, so nothing on it can be sold; identified units move off it.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const body = await req.json().catch(() => ({})) as { kind?: string }
    const kind = PLACEHOLDER_KINDS.find(k => k.id === body.kind)
    if (!kind) return NextResponse.json({ error: 'Choose the device type' }, { status: 422 })
    const name = placeholderProductName(kind.id as PlaceholderKind)
    return withAppStateKeyLock('deed_products', async () => {
      let row = await prisma.product.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, include: { category: true } })
      let created = false
      if (!row) {
        const result = await publishProduct(productSchema.parse({
          name,
          category: kind.category,
          salePrice: 0,
          costPrice: 0,
          productKind: 'storable',
          productType: 'refurbished',
          trackingMethod: 'SERIAL',
          requiresSerial: true,
          minStock: 0,
          canBeSold: false,
          description: 'Machines taken in without a readable serial or model. Identify them in Refurbishment.',
        }))
        if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 409 })
        row = await prisma.product.findUnique({ where: { id: result.product.id }, include: { category: true } })
        created = result.status === 'created'
      }
      if (!row) return NextResponse.json({ error: 'Could not set up the product' }, { status: 409 })
      // Screens list products from the catalog copy; put it there as the
      // Inventory form does, or nothing could be filed under it.
      const state = await loadAppStateForWrite(['deed_products'])
      const products = Array.isArray(state.deed_products) ? [...(state.deed_products as Array<Record<string, unknown>>)] : []
      if (!products.some(p => p.id === row!.id)) {
        products.push({
          id: row.id, name: row.name, sku: row.sku, barcode: row.barcode ?? undefined,
          category: kind.category, description: row.description ?? '',
          salePrice: 0, costPrice: 0, wholesalePrice: 0, stockQty: 0, minStock: 0, unit: 'pcs',
          requiresSerial: true, trackingMethod: 'SERIAL', productKind: 'storable', productType: 'refurbished',
          canBeSold: false, canBePurchased: false, isActive: true, warrantyMonths: 0, taxRate: 0,
          createdAt: row.createdAt.toISOString(),
        })
        await saveStoreKeys({ deed_products: JSON.stringify(products) })
        created = true
      }
      return NextResponse.json({ product: toClientProduct(row), created }, { status: created ? 201 : 200 })
    })
  })
}
