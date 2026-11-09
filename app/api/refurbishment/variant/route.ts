import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { productSchema } from '@/lib/validation'
import { publishProduct, toClientProduct } from '@/lib/product-catalog-write'
import { variantName } from '@/lib/refurbishment/variant'
import { isPlaceholderProductName } from '@/lib/refurbishment/unidentified'

export const dynamic = 'force-dynamic'

// The bench creates variants while identifying machines; it cannot create
// any other product (that stays with Inventory).
const ROLES = ['director', 'technical_lead', 'admin_officer', 'inventory_officer', 'technician', 'lead_tech', 'repair_tech']

type Row = Record<string, unknown>

/**
 * POST { baseProductId, specs, name? } — a variant of an existing
 * serial-tracked model for a machine whose specs differ (e.g. 16GB instead
 * of 8GB): "Model - specs", same category and condition, priced like the
 * model until Inventory sets its own price. Reused when it already exists.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const body = await req.json().catch(() => ({})) as { baseProductId?: string; specs?: string; name?: string }
    const specs = String(body.specs ?? '').trim().slice(0, 300)
    if (!body.baseProductId) return NextResponse.json({ error: 'Choose the model first' }, { status: 422 })
    if (specs.length < 3) return NextResponse.json({ error: 'Enter the machine specs the variant is for' }, { status: 422 })

    return withAppStateKeyLock('deed_products', async () => {
      const state = await loadAppStateForWrite(['deed_products'])
      const products = Array.isArray(state.deed_products) ? [...(state.deed_products as Row[])] : []
      const base = products.find(p => p.id === body.baseProductId)
      if (!base || base.isActive === false) return NextResponse.json({ error: 'That model is not in the catalog' }, { status: 404 })
      if (!(base.requiresSerial === true || base.trackingMethod === 'SERIAL') || isPlaceholderProductName(String(base.name ?? ''))) {
        return NextResponse.json({ error: 'Variants are made from a serial-tracked model' }, { status: 422 })
      }
      const name = (String(body.name ?? '').trim() || variantName(String(base.name), specs)).slice(0, 200)
      if (name.length < 3 || name.toLowerCase() === String(base.name).trim().toLowerCase()) {
        return NextResponse.json({ error: 'The variant needs a name different from the model' }, { status: 422 })
      }

      let row = await prisma.product.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, include: { category: true } })
      let created = false
      if (!row) {
        const parsed = productSchema.safeParse({
          name,
          // Some catalog rows have no category; a machine is a laptop unless the model says otherwise.
          category: String(base.category || '').trim() || 'Laptops',
          salePrice: Math.max(0, Number(base.salePrice) || 0),
          costPrice: 0,
          taxRate: Math.max(0, Number(base.taxRate) || 0),
          productKind: 'storable',
          productType: base.productType === 'new' ? 'new' : 'refurbished',
          trackingMethod: 'SERIAL',
          requiresSerial: true,
          minStock: 0,
          canBeSold: true,
          canBePurchased: true,
          warrantyMonths: Math.max(0, Math.floor(Number(base.warrantyMonths) || 0)),
          description: `${specs}\nVariant of ${String(base.name)}.`.slice(0, 1000),
        })
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'The variant details are not valid' }, { status: 422 })
        const result = await publishProduct(parsed.data)
        if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 409 })
        row = await prisma.product.findUnique({ where: { id: result.product.id }, include: { category: true } })
        created = result.status === 'created'
      }
      if (!row) return NextResponse.json({ error: 'Could not create the variant' }, { status: 409 })
      // Screens list products from the catalog copy.
      if (!products.some(p => p.id === row!.id)) {
        // Copies the model's catalog fields, but not its RAM/SSD defaults.
        const { deviceConfig: _baseConfig, ...baseFields } = base
        void _baseConfig
        products.push({
          ...baseFields,
          id: row.id, name: row.name, sku: row.sku, barcode: row.barcode ?? undefined,
          description: row.description ?? '',
          costPrice: 0, stockQty: 0, minStock: 0,
          variantOfProductId: base.id,
          createdAt: row.createdAt.toISOString(),
        })
        await saveStoreKeys({ deed_products: JSON.stringify(products) })
        created = true
      }
      return NextResponse.json({ product: { ...toClientProduct(row), variantOfProductId: base.id }, created }, { status: created ? 201 : 200 })
    })
  })
}
