import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission, SENSITIVE_STORE_KEY_PERMISSIONS, SENSITIVE_STORE_KEY_READ_PERMISSIONS, CLIENT_IMMUTABLE_STORE_KEYS } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

type Params = { params: { key: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key   = decodeURIComponent(params.key)

  const readAction = SENSITIVE_STORE_KEY_READ_PERMISSIONS[key]
  if (readAction && !hasPermission(session.user, readAction)) {
    return NextResponse.json({ error: `Forbidden — insufficient role to read: ${key}` }, { status: 403 })
  }

  const state = await loadAppState([key])
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

  if (CLIENT_IMMUTABLE_STORE_KEYS.has(key)) {
    return NextResponse.json({ error: `Forbidden — ${key} is server-managed and cannot be written by a client` }, { status: 403 })
  }

  const restrictedAction = SENSITIVE_STORE_KEY_PERMISSIONS[key]
  if (restrictedAction && !hasPermission(session.user, restrictedAction)) {
    return NextResponse.json({ error: `Forbidden — insufficient role to write: ${key}` }, { status: 403 })
  }

  const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value)
  await saveStoreKeys({ [key]: value })

  return NextResponse.json({ ok: true, key })
}
