import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { isAdmin } from '@/lib/auth/access'

const MIGRATION_CONFIRMATION = 'MIGRATE DEED ERP DATA'

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const state = await loadAppState()
  return NextResponse.json(state)
}

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const confirmation = request.headers.get('x-deed-confirmation')?.trim() ?? ''
  if (confirmation !== MIGRATION_CONFIRMATION) {
    return NextResponse.json({ error: `Type ${MIGRATION_CONFIRMATION} to confirm migration` }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected object' }, { status: 400 })
  }

  const entries: Record<string, string> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!k.startsWith('deed_')) continue
    entries[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }

  if (Object.keys(entries).length === 0) {
    return NextResponse.json({ error: 'No valid deed_ keys supplied' }, { status: 400 })
  }

  await saveStoreKeys(entries)
  return NextResponse.json({ ok: true, savedKeys: Object.keys(entries).length })
}
