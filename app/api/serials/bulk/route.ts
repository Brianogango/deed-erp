import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { SerialNumber } from '@/lib/store'
import { buildInventoryBarcode } from '@/lib/inventory-identifiers'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

/**
 * Atomic multi-serial create for GRN validation.
 * Avoids lost updates from N concurrent POST /api/serials read-modify-writes.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)

    let body: { items?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) {
      return NextResponse.json({ error: 'items required' }, { status: 400 })
    }
    if (items.length > 500) {
      return NextResponse.json({ error: 'Too many serials in one request (max 500)' }, { status: 400 })
    }

    const state = await loadAppState(['deed_serials'])
    const existing = (Array.isArray(state.deed_serials) ? state.deed_serials : []) as SerialNumber[]
    const bySerial = new Map(
      existing.map(item => [String(item.serial ?? '').toLowerCase(), item]),
    )
    const byBarcode = new Map(
      existing
        .filter(item => item.barcode)
        .map(item => [String(item.barcode).toLowerCase(), item]),
    )

    const created: SerialNumber[] = []
    const errors: string[] = []

    for (const raw of items) {
      if (!raw || typeof raw !== 'object') {
        errors.push('Invalid serial row')
        continue
      }
      const row = raw as Record<string, unknown>
      const productId = String(row.productId ?? '').trim()
      const serial = String(row.serial ?? '').trim()
      if (!productId) {
        errors.push('productId is required')
        continue
      }
      if (!serial) {
        errors.push('serial is required')
        continue
      }
      if (bySerial.has(serial.toLowerCase())) {
        errors.push(`Serial "${serial}" already exists`)
        continue
      }

      const requestedBarcode = String(row.barcode ?? '').trim()
      const barcode = requestedBarcode || buildInventoryBarcode({
        existingBarcodes: [
          ...existing.map(item => item.barcode),
          ...created.map(item => item.barcode),
        ],
        manufacturerSerial: serial,
        productSku: productId,
      })
      if (byBarcode.has(barcode.toLowerCase())) {
        errors.push(`Inventory barcode "${barcode}" already exists`)
        continue
      }

      const record = {
        ...(row as unknown as SerialNumber),
        id: String(row.id ?? crypto.randomUUID()),
        serial,
        productId,
        barcode,
        status: String(row.status ?? 'available') as SerialNumber['status'],
        receivedDate: String(row.receivedDate ?? new Date().toISOString().slice(0, 10)),
      } as SerialNumber

      created.push(record)
      bySerial.set(serial.toLowerCase(), record)
      byBarcode.set(barcode.toLowerCase(), record)
    }

    if (errors.length > 0 && created.length === 0) {
      return NextResponse.json({ ok: false, errors, created: [] }, { status: 422 })
    }

    if (created.length > 0) {
      await saveStoreKeys({
        deed_serials: JSON.stringify([...existing, ...created]),
      })
    }

    return NextResponse.json({
      ok: errors.length === 0,
      created,
      createdCount: created.length,
      errors,
    }, { status: created.length > 0 ? 201 : 422 })
  })
}
