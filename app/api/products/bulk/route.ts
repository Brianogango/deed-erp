import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { productSchema, validate } from '@/lib/validation'
import { publishProduct, toClientProduct } from '@/lib/product-catalog-write'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']
const MAX_BULK = 200

/**
 * Bulk publish products to the relational catalog.
 * For each row: if name/sku/barcode already exists → skip; otherwise create.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const items = Array.isArray(body?.products) ? body.products : Array.isArray(body) ? body : null
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'No products to publish' }, { status: 400 })
    }
    if (items.length > MAX_BULK) {
      return NextResponse.json({ error: `Bulk import is limited to ${MAX_BULK} products at a time` }, { status: 400 })
    }

    const created: any[] = []
    const skipped: { name: string; reason: string }[] = []
    const failed: { name: string; reason: string }[] = []

    for (const raw of items) {
      const label = String(raw?.name ?? 'Product').trim() || 'Product'
      try {
        const validated = await validate(productSchema, {
          ...raw,
          salePrice: Number(raw.salePrice ?? raw.sellingPrice ?? 0),
          costPrice: Number(raw.costPrice ?? 0),
          wholesalePrice: raw.wholesalePrice === '' || raw.wholesalePrice == null
            ? undefined
            : Number(raw.wholesalePrice),
          commissionRatePercent: raw.commissionRatePercent === '' || raw.commissionRatePercent == null
            ? undefined
            : Number(raw.commissionRatePercent),
          minStock: Number(raw.minStock ?? raw.reorderLevel ?? 5),
          taxRate: Number(raw.taxRate ?? 16),
          sku: raw.skuProvided === false ? '' : (raw.sku ?? ''),
        })
        const result = await publishProduct(validated)
        if (result.status === 'created') {
          created.push(toClientProduct(result.product, validated.category))
        } else if (result.status === 'exists') {
          skipped.push({
            name: label,
            reason: `${result.field} already used by "${result.product.name}"`,
          })
        } else {
          failed.push({ name: label, reason: result.message })
        }
      } catch (err: any) {
        failed.push({ name: label, reason: err?.message || 'Could not publish' })
      }
    }

    return NextResponse.json({
      created: created.length,
      skipped: skipped.length,
      failed: failed.length,
      products: created,
      skippedRows: skipped,
      failedRows: failed,
    })
  })
}
