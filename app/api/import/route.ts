// Bulk data import — accepts JSON arrays for any store key.
// Used to seed products, contacts, etc. from external sources.
// POST body: { "deed_products": [...], "deed_contacts": [...] }
// Merges by id (upsert) to avoid duplicates. Contacts go to the clients table;
// keys whose screen copy is frozen (invoices, sale orders…) are refused.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { FROZEN_STORE_KEYS, loadAppState, saveStoreKeys } from '@/lib/server-store'
import { upsertContact, type ContactInput } from '@/lib/contact-prisma'

type AnyRecord = Record<string, unknown>

function mergeById(existing: AnyRecord[], incoming: AnyRecord[]): AnyRecord[] {
  const map = new Map<string, AnyRecord>()
  for (const item of existing) map.set(String(item.id ?? ''), item)
  for (const item of incoming) {
    const id = String(item.id ?? `import_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    map.set(id, { ...map.get(id), ...item, id })
  }
  return Array.from(map.values())
}

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

function productIdentity(item: AnyRecord) {
  return {
    name: norm(item.name),
    sku: norm(item.sku),
    barcode: norm(item.barcode),
  }
}

function mergeProductsWithoutDuplicates(existing: AnyRecord[], incoming: AnyRecord[]) {
  const merged = [...existing]
  const seenNames = new Set(existing.map(p => productIdentity(p).name).filter(Boolean))
  const seenSkus = new Set(existing.map(p => productIdentity(p).sku).filter(Boolean))
  const seenBarcodes = new Set(existing.map(p => productIdentity(p).barcode).filter(Boolean))
  let imported = 0
  let skipped = 0

  for (const item of incoming) {
    const ident = productIdentity(item)
    const duplicate =
      (ident.name && seenNames.has(ident.name)) ||
      (ident.sku && seenSkus.has(ident.sku)) ||
      (ident.barcode && seenBarcodes.has(ident.barcode))
    if (duplicate) {
      skipped++
      continue
    }

    const id = String(item.id ?? `import_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    const next = { ...item, id }
    merged.push(next)
    if (ident.name) seenNames.add(ident.name)
    if (ident.sku) seenSkus.add(ident.sku)
    if (ident.barcode) seenBarcodes.add(ident.barcode)
    imported++
  }

  return { merged, imported, skipped }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Director only
  if (session.user.role !== 'director') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  let body: Record<string, unknown> | null = null
  try { body = await request.json() } catch {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected object of { storeKey: item[] }' }, { status: 400 })
  }

  const ALLOWED_KEYS = new Set([
    'deed_products', 'deed_contacts', 'deed_saleOrders', 'deed_purchaseOrders',
    'deed_repairs', 'deed_employees', 'deed_warranties', 'deed_serials',
    'deed_kilimallOrders', 'deed_expenses', 'deed_invoices',
  ])

  const state   = await loadAppState()
  const updates: Record<string, string> = {}
  const summary: Record<string, { imported: number; skipped: number; total: number }> = {}

  const refused: string[] = []
  for (const [key, incoming] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) continue
    if (!Array.isArray(incoming)) continue
    if (key === 'deed_contacts') {
      // Contacts live in the clients table (the screen copy is frozen).
      const prisma = (await import('@/lib/prisma')).default
      let imported = 0
      let skipped = 0
      for (const item of incoming as ContactInput[]) {
        const result = await upsertContact(prisma, item).catch(() => 'failed')
        if (typeof result === 'string' || !result.created) skipped++
        else imported++
      }
      summary[key] = { imported, skipped, total: incoming.length }
      continue
    }
    if (FROZEN_STORE_KEYS.has(key)) {
      // Saved through their own screens / routes now; a write here would be dropped.
      refused.push(key)
      continue
    }

    const existing = Array.isArray(state[key]) ? (state[key] as AnyRecord[]) : []
    const result = key === 'deed_products'
      ? mergeProductsWithoutDuplicates(existing, incoming as AnyRecord[])
      : { merged: mergeById(existing, incoming as AnyRecord[]), imported: (incoming as AnyRecord[]).length, skipped: 0 }
    const merged = result.merged
    updates[key]   = JSON.stringify(merged)
    summary[key]   = { imported: result.imported, skipped: result.skipped, total: merged.length }
  }

  if (Object.keys(updates).length === 0 && !summary.deed_contacts) {
    return NextResponse.json({
      error: refused.length ? `${refused.join(', ')} can no longer be bulk-imported here` : 'No valid keys provided',
    }, { status: 422 })
  }

  try {
    if (Object.keys(updates).length) await saveStoreKeys(updates)
  } catch (err) {
    // e.g. the bulk-delete guard refusing a save that would drop records.
    console.error('[import] save failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import could not be saved' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, summary, ...(refused.length ? { refused } : {}) })
}
