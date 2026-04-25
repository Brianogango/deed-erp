import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const state = await loadAppState()
  return NextResponse.json(state)
}

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    entries[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }

  await saveStoreKeys(entries)
  return NextResponse.json({ ok: true })
}
