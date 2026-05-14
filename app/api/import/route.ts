// Bulk data import — accepts JSON arrays for any store key.
// Used to seed products, contacts, etc. from external sources.
// POST body: { "deed_products": [...], "deed_contacts": [...] }
// Merges by id (upsert) to avoid duplicates.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

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
    'deed_kilimallOrders', 'deed_expenses',
  ])

  const state   = await loadAppState()
  const updates: Record<string, string> = {}
  const summary: Record<string, { imported: number; total: number }> = {}

  for (const [key, incoming] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) continue
    if (!Array.isArray(incoming)) continue

    const existing = Array.isArray(state[key]) ? (state[key] as AnyRecord[]) : []
    const merged   = mergeById(existing, incoming as AnyRecord[])
    updates[key]   = JSON.stringify(merged)
    summary[key]   = { imported: incoming.length, total: merged.length }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid keys provided' }, { status: 422 })
  }

  await saveStoreKeys(updates)
  return NextResponse.json({ ok: true, summary })
}
