/**
 * GET /api/store/record?key=deed_repairs_v2&id=…
 *
 * One full record of a collection whose list form is slimmed
 * (lib/store-slim.ts) — what a record view loads when it opens.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { canReadStoreKey, CONTENT_FILTERED_STORE_KEYS, filterStoreValueForRole } from '@/lib/auth/authorization'
import { loadAppState } from '@/lib/server-store'
import { SLIM_RULES } from '@/lib/store-slim'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = request.nextUrl.searchParams.get('key') ?? ''
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!SLIM_RULES[key] || !id) return NextResponse.json({ error: 'key and id required' }, { status: 400 })
  if (!canReadStoreKey(session.user, key)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = await loadAppState([key])
  let rows: unknown = state[key]
  if (CONTENT_FILTERED_STORE_KEYS.has(key)) rows = filterStoreValueForRole(session.user, key, rows)
  const row = Array.isArray(rows) ? rows.find(r => r && typeof r === 'object' && String((r as { id?: unknown }).id) === id) : undefined
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ row }, { headers: { 'Cache-Control': 'private, no-store' } })
}
