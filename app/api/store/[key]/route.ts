import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

type Params = { params: { key: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key   = decodeURIComponent(params.key)
  const state = await loadAppState()
  const value = state[key] ?? null

  return NextResponse.json({ key, value })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { value: unknown } | null = null
  try { body = await request.json() } catch {}
  if (!body || !('value' in body)) {
    return NextResponse.json({ error: 'Expected { value: ... }' }, { status: 400 })
  }

  const key = decodeURIComponent(params.key)
  const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value)
  await saveStoreKeys({ [key]: value })

  return NextResponse.json({ ok: true, key })
}
